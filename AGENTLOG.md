# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-18 — Decimosegunda ronda: intento de reanudar el pipeline en Mage — bloqueado por un bug de infraestructura preexistente, ajeno a Fase 2

**Pedido del usuario**: *"dale, retoma el pipeline en Mage"*. Confirmado antes de actuar: no existe ninguna tool de `mage-agent` para reactivar el trigger recurrente (~15 min) que el usuario pausó en la UI — solo `execute_pipeline`/`run_pipeline` para disparar una corrida manual puntual real. El usuario confirmó proceder con la corrida manual.

**3 corridas reales del pipeline** (`batch_tms_monitor_trips`), todas con el mismo resultado — **falla siempre en el mismo punto, antes de llegar a cualquier bloque dbt de la capa `app.*`** (mi código de Fase 2 nunca llegó a ejecutarse):

1. **Primera corrida**: falló en el scraping (`qanalytics_endpoint_sap`/`qanalytics_endpoint_scraper_iansa`, `KeyError: 'status'`). Causa probable: `extraction_service` (Cloud Run separado, `app/jobs/store.py` — job store **en memoria**) frío tras ~1 día pausado; el polling del job pudo pegarle a una instancia distinta a la que lo creó. Ajeno a `monitor-app`, no se tocó.
2. **Segunda corrida**: el scraping pasó completo (contenedor ya caliente, confirma la hipótesis anterior). Pero **`int_tms_trips_conformed` falló** — `silver.stg_qanalytics_sap_only_trips` no existía pese a que el log del bloque decía explícitamente `"1 of 1 OK created sql view model silver.stg_qanalytics_sap_only_trips ... [CREATE VIEW in 1.59s]"`. Verificado por SQL directo contra Supabase: la vista no existe en ningún schema.
3. **Tercera corrida** (a pedido del usuario, para descartar que fuera puntual): **mismo fallo exacto**, y esta vez ni siquiera `stg_qanalytics_trips` (que sí había persistido después de la corrida 2) seguía existiendo. Confirma que el problema es sistemático, no de una vista puntual — **las vistas de la capa `silver` se crean con éxito (el log lo confirma) y desaparecen poco después, de forma reproducible**.

**Hallazgo de infraestructura, sin causa raíz confirmada**: cada bloque dbt corre en su **propio pod de Kubernetes efímero e independiente** (`Failed to execute k8s job mageai-...-job-block-...` en los logs), cada uno con su propio `dbt deps` + `dbt run --select <un solo modelo>` desde cero, compartiendo el mismo filesystem (`dbt_packages`/`target`). Consistente con una condición de carrera entre bloques corriendo en paralelo, pero **no se pudo confirmar con certeza** — requeriría logs del lado del servidor de Kubernetes/Postgres, fuera del alcance de las tools de `mage-agent` disponibles. Se intentó aislar el problema con `run_block` (ejecución sincrónica de un solo bloque) pero la tool falló con un error interno de Mage no relacionado (`NoResultFound` buscando un pipeline_schedule tipo "api").

**Decisión**: se frenaron los reintentos después de la 3ª corrida — cada intento dispara scraping real contra los 3 TMS de producción, no es una operación gratuita ni sin efectos. El fix de dbt de la ronda anterior (agregar `trip_stops` al `--select` de `app_trips_update.yaml`, sincronizado a Mage) sigue aplicado y correcto, pero **no se pudo verificar en un pipeline real** porque el fallo ocurre en una capa muy anterior (`int_tms_trips_conformed`, congelada, no tocada por Fase 2).

**Explícitamente fuera de esta ronda**: arreglar `extraction_service` (job store en memoria) o investigar más a fondo la condición de carrera de Kubernetes — ambos requieren su propia exploración dedicada y acceso que no está disponible vía las tools actuales (logs de servidor, acceso directo a la UI de Mage).

#### Próximo paso exacto (histórico — ver ronda siguiente, los 3 bugs de esta ronda se resolvieron el mismo día)
1. [x] Revisar directamente en la UI de Mage — el usuario lo hizo, ver ronda siguiente para las 3 causas raíz reales encontradas y corregidas.
2. [x] Verificar que `app/trip_stops.sql` corre bien — causa raíz encontrada (bug propio, no de infraestructura), corregida, ver ronda siguiente.
3. [ ] Considerar investigar `extraction_service` (job store en memoria, `app/jobs/store.py`) — patrón confirmado más fuerte: falló en 5 de 10 corridas reales del pipeline en la jornada. Sigue sin investigar a fondo, out of scope de `monitor-app`.
4. [ ] Sync recurrente `bronze.raw_shipper_locations` → `public.locations` — sigue pendiente.
5. [ ] Cargar compliance real de conductores — sigue en `MISSING` 100%.
6. [ ] F30_MULTAS — sigue sin confirmar.

---

### 2026-07-18 (cont.) — Decimotercera ronda: 3 bugs reales de infraestructura del pipeline encontrados y corregidos + higienización de bloques dbt redundantes

**Pedido del usuario**: preguntas exploratorias sobre si convenía rediseñar el pipeline (global data products, unificar bloques dbt) → *"primero higieniza los bloques con esas redundancias y por unos días testeemos como va antes de unificar en 1-2 bloques. Prueba con actualizar la dependencia nuevamente"*. 10 corridas reales del pipeline en la jornada (scraping real de los 3 TMS cada vez) — costo asumido explícitamente por el usuario dado el valor de la información.

**Bug real #1 — pooler de Supabase en modo Transaction (puerto 6543)**: causa raíz del misterio de la ronda anterior ("las vistas se crean y desaparecen"). Supabase no recomienda el pooler modo Transaction para DDL — cada conexión corta desde un pod distinto puede no ver el `CREATE VIEW` de otra conexión. Cambiado a puerto 5432 (modo Session) en `dbt/tms/profiles.yml`, sincronizado a Mage. **Resultado inmediato**: `int_tms_trips_conformed` pasó por primera vez en toda la sesión.

**Bug real #2 — `UNION ALL` con conteo de columnas distinto en `app_trips.sql`** (preexistente, de la ronda de "campos híbridos de fecha", no de Fase 2): la rama de viajes manuales (`app.trips_manual`) nunca recibió `cag_inicio_at`/`cag_fin_at`/`stop_manual_fields` cuando se agregaron a la rama TMS. Estaba dormido porque el pipeline no había corrido con éxito desde que se agregaron esos campos. Corregido en `app_trips.sql` (repo + Mage): mismo default `NULL`/`'{}'` que la rama TMS. **Resultado: `app.trips` hizo `MERGE` exitoso por primera vez desde la pausa del pipeline** (17 filas, luego 1 fila en corridas siguientes).

**Bug real #3 — 2 conexiones de dependencia faltantes en el grafo de bloques de Mage** (distinto del grafo de `ref()` de dbt): `stg_qanalytics_trips` no tenía `slv_milestone_trips` como upstream pese a que el modelo lo necesita (`{{ ref('slv_milestone_trips') }}`); `stg_qanalytics_sap_trips` no tenía ni `slv_milestone_trips` ni `stg_qanalytics_trips`. Mapeado sistemáticamente: se cruzó cada modelo dbt contra su `ref()` real vs. `upstream_blocks` declarado en Mage para los 9 bloques tipo `dbt` — estos 2 fueron los únicos con gap real. **`block_update` vía `mage-agent` no aplicó el fix por API** (2 intentos, `200 OK` sin error pero sin efecto persistido, confirmado con `block_get`) — se descartó `pipeline_update` por riesgo de *replace* del grafo completo de 34 bloques sin garantía de que sea *merge*. El usuario agregó las 2 conexiones a mano en la UI de Mage; verificado por API que quedaron bien (la segunda queda satisfecha transitivamente: `stg_qanalytics_sap_trips` → `stg_qanalytics_trips` → `slv_milestone_trips`).

**Higienización de redundancia** (a pedido explícito, sin llegar a unificar bloques todavía): `app_trips_update` corría `dbt run --select +trips trip_stops`, donde `+trips` reconstruía desde cero los 6 modelos de `silver` que YA habían corrido como bloques separados segundos antes en la misma corrida — 100% de trabajo duplicado. Cambiado a `--select trips trip_stops` (sin `+`) una vez confirmado que las dependencias del punto anterior ya garantizan que esos modelos existen antes de que este bloque arranque.

**Bug real #4 (el que realmente bloqueaba Fase 2) — comentario SQL mal cerrado en `trip_stops.sql`**: después de descartar exhaustivamente lógica del `SELECT` (`EXPLAIN` limpio), el `MERGE` completo simulado a mano (funciona), el `CREATE TABLE AS SELECT` exacto vía la misma conexión/pooler/credenciales que usa dbt (funciona), y datos sucios en todo el dataset (limpio, 0 nulls/duplicados en 4481 filas) — el usuario corrió el bloque en la UI de Mage y pegó el log completo (sin el límite de truncado de la API de `mage-agent`, que venía cortando todos los logs a 8013 caracteres y ocultando el error real toda la sesión). Error real: `syntax error at or near "int_tms_trips_conformed"` — el comentario descriptivo del modelo tenía el texto `stg_*/int_tms_trips_conformed`, donde `*` seguido de `/` forma literalmente `*/`, cerrando el bloque `/* ... */` a mitad de camino. Todo el texto siguiente quedaba como SQL crudo inválido. Corregido con un espacio (`stg_* / int_tms_trips_conformed`). Sincronizado a Mage.

**Verificación final**: 2 corridas más después del fix de `trip_stops.sql` fallaron, pero **ambas en `extraction_service`** (el bug ya documentado en la ronda anterior, `KeyError: 'status'`) — nunca llegaron a la capa dbt para poder confirmar `trip_stops` de punta a punta en un pipeline real. Se frenaron los reintentos en 10 corridas totales de la jornada. **Confianza alta en el fix igual**: el error de sintaxis encontrado es explícito, inequívoco, y la corrección es mínima y directa (no una hipótesis).

**Patrón confirmado, no solo sospechado**: `extraction_service` falló en 5 de 10 corridas reales de hoy — job store en memoria (`app/jobs/store.py`) más que probablemente incompatible con el comportamiento multi-instancia de Cloud Run. Merece su propia investigación dedicada, fuera de `monitor-app`.

**Lección de proceso para sesiones futuras**: las tools de `mage-agent` (`execute_pipeline`, `run_logs`) truncan cada archivo de log a ~8013 caracteres sin aviso — en un pipeline con muchos bloques y errores tempranos en la cadena, el mensaje de error real casi nunca entra en esa ventana. Cuando un error de dbt no se puede explicar con evidencia (SQL que funciona a mano pero falla dentro de dbt), pedirle al usuario que corra el bloque en la UI de Mage y pegue el log completo es más rápido y confiable que seguir iterando corridas completas del pipeline por API.

`app.trips.stops`/`stop_manual_fields` (jsonb legacy) siguen intactas sin uso — ninguna migración/rollback necesario pase lo que pase con `trip_stops`.

**Cierre**: el usuario corrió el bloque `app_trips_update` manualmente en la UI de Mage tras el fix del comentario — **pasó limpio**. Verificado contra la DB real: `app.trip_stops` existe, 4481 filas, `updated_at` de la corrida manual. Fase 2 del hardening (normalizar `stops`) queda **verificada de punta a punta en el pipeline real**, no solo en tests. El trigger recurrente (~15 min) del pipeline sigue pausado — reanudarlo sigue siendo acción del usuario, sin relación con este fix.

#### Próximo paso exacto
1. [x] Confirmar que `app/trip_stops.sql` corre limpio — **verificado en vivo, pasó**.
2. [ ] Reanudar el trigger recurrente del pipeline en la UI de Mage — sigue siendo acción del usuario, sin bloqueos técnicos conocidos ahora.
3. [ ] Investigar `extraction_service` (job store en memoria) — patrón confirmado, 5/10 fallos el 2026-07-18. Fuera de `monitor-app`, requiere su propia sesión.
4. [ ] Reevaluar unificación de bloques dbt en 1-2 bloques `dbt build` — el usuario pidió esperar "unos días" con la higienización actual antes de decidir. No iniciar sin pedido explícito.
5. [ ] Sync recurrente `bronze.raw_shipper_locations` → `public.locations` — sigue pendiente.
6. [ ] Cargar compliance real de conductores — sigue en `MISSING` 100%.
7. [ ] F30_MULTAS — sigue sin confirmar.

---

### 2026-07-18 (cont.) — Decimocuarta ronda: fix de visualización de documentos en Empresas, refuerzo de tests dbt (Fase 3), y 6 rondas de auditoría/limpieza de DB

**1. Bug de visualización de documentos en Empresas**: `TransporterDocumentsPanel.tsx` mostraba el link "Ver archivo" solo cuando `canEdit === false` — oculto justo para editores/owners, que son quienes suben los archivos. Causa secundaria encontrada al investigar: el ícono "Ver archivo/versiones" que sí ten­ían los editores dependía de `get_document_history()` (`document_storage.py`), que solo lee `audit_log.action='document_replace'` — un log que nunca se escribe en la primera subida (`compliance.py:146`, `if old_storage_path:`), así que ese panel mostraba "Sin archivos" incluso con un archivo real cargado. Fix: el link ahora se muestra siempre que exista `file_url`, junto al select de estado. Commit `bc3a036`.

**2. Fase 3 — refuerzo de tests dbt sobre `app.trip_stops`**: tests `not_null`/`unique` en `stop_id`, `not_null`+`relationships(to: trips, field: id)` en `trip_id`, `not_null` en `stop_order` (`dbt/tms/models/app/schema.yml`). Verificado contra datos reales antes de sincronizar (4481/4481 filas limpias, 0 nulls, 0 duplicados, 0 huérfanos). Sincronizado a Mage.

**3. Auditoría y limpieza de DB — 6 rondas, 37 objetos eliminados, dos correcciones de método reales encontradas por el usuario**:

El usuario pidió limpiar tablas/vistas sin uso "en base a lo que tenemos configurado en mage y supabase". Un primer barrido (fork) cruzó 104 relaciones contra 2 proyectos dbt + 3 pipelines Mage + backend/frontend. El usuario desconfió del resultado **tres veces seguidas, y tenía razón las tres**:

- **Corrección 1 — bloque huérfano de Mage sigue siendo ejecutable a mano**: `bronze.raw_centralizer_drivers/vehicles/transporter` y `app.carrier_compliance_status` fueron marcados "sin uso" por no estar en el DAG de ningún pipeline (`upstream_blocks`), pero el usuario confirmó que sigue corriendo esos bloques manualmente desde la UI de Mage sin que estén cableados a nada — Mage permite ejecutar cualquier archivo de bloque suelto. La señal que lo delató: `pg_stat_user_tables` mostraba churn real de INSERT/DELETE que el chequeo del DAG no veía. Quedan fuera de la limpieza (ver `feedback_mage_orphaned_block_still_runnable`).
- **Corrección 2 — grep de palabra suelta da falsos positivos**: una ronda posterior había dado por "activas" `app.drivers/vehicles/transporters/insurance_policies/insurance_installments/transporter_contacts` citando `routers/drivers.py` etc., pero el grep contaba la palabra suelta ("drivers" aparece en cualquier archivo llamado así) sin verificar el schema calificado real. Grep estricto (`(app|public)\.[a-z_]+` literal, descartando comentarios) confirmó que Empresas/Seguros usa exclusivamente `public.drivers/assets/carriers/insurance_policies` — el backend actual **nunca** referencia esas 6 tablas `app.*` (ver `feedback_schema_qualified_grep_only`).
- **Corrección 3 — auditoría de triggers/funciones/RPC antes del drop final**: esas mismas 6 tablas tenían actividad de escritura real (hasta 132k idx_scans) sin escritor identificable en dbt/Mage/backend de este repo. El usuario confirmó que hay un deployment/script legacy externo activo — pidió, antes de decidir, auditar triggers/funciones/RPC que pudieran conectarlas al sistema vivo. Resultado: solo triggers de housekeeping genérico (`set_updated_at`) más un trigger de auditoría en `insurance_installments` que está **roto** (escribe a `app.audit_log`, tabla que ya no existe — solo existe `public.audit_log`); cero funciones/RPC en cualquier schema las tocan; todas las FK entrantes son internas al cluster. Con esa evidencia el usuario autorizó el drop final.

**Objetos eliminados (6 migraciones aplicadas y versionadas, todas con verificación de FK/dependientes antes de aplicar y `pytest` 216/216 después de cada una)**:
- `20260718000000`: Centralizer retirado (`centralizer_uploads`, `centralizer_column_mappings`), tablas sin dueño (`notifications`, `trip_events`, `insurance_policy_documents`), 7 vistas obsoletas (`v_compliance_alerts`/`v_driver_eligibility`/`v_insurance_installments_flat`/`v_transporter_compliance`/`v_transporter_eligibility`/`v_transporter_operational_status`/`v_vehicle_eligibility`), `silver.tms_trips`.
- `20260718010000`: `app.transporter_profiles` + `silver_app.transporter_profiles` (schema completo) — snapshot huérfano de antes de que el modelo dbt se redirigiera a `silver.transporter_profiles_legacy`.
- `20260718020000`: 8 vistas `silver.stg_centralizer_*` (callejón sin salida, nada lee su output) + cluster de 7 tablas de un sistema de documentos/compliance anterior (`transporter_documents`, `compliance_doc_catalog`, `client_document_requirements`, `transporter_client_accounts`, `driver_documents`, `vehicle_documents`, `sync_config`) — superado por `public.compliance_records`/`public.contacts`, sin tráfico en logs de API de las últimas 24h pese a scans acumulados altos.
- `20260718030000`: `silver.fct_walmart_qanalytics_stop_timeline` (reporte puntual histórico, confirmado sin uso).
- `20260718040000`: `silver.transporter_profiles_legacy` + `snapshot_silver_drivers/trailers/transporters/vehicles` — a pedido explícito del usuario, pese a ser el target vivo de un modelo dbt que Mage sigue corriendo (pipeline `legacy_drivers_transporters`), nada los lee. **El pipeline sigue wireado y va a recrearlos en la próxima corrida** — falta decidir si también se retiran esos 2 bloques de Mage.
- `20260718050000`: cluster final `app.transporters/drivers/vehicles/insurance_policies/insurance_installments/transporter_contacts`.

**Excluido de la limpieza (decisiones explícitas, no descuidos)**: `bronze.raw_insurance_vehicles` + pipeline `bronze_to_silver_insurance_sync` (puente intencional hasta que Seguros opere completo desde el frontend); `bronze.raw_centralizer_*` + `app.carrier_compliance_status` (uso manual activo confirmado). El cluster `app.transporters/...` sí se terminó dropeando (ver arriba) tras la auditoría de triggers/funciones.

**Lo que queda vivo en `app`** (19 tablas + 6 matviews, cadena end-to-end verificada frontend→backend→tabla): config (`alert_thresholds`/`filter_groups`/`monitor_alert_rules`/`operational_states`/`temperature_ranges`/`trip_statuses`, usados por `configuracion/{estados,umbrales}-tabs.tsx`), Diario (`trip_fleet_links`/`trip_note_attachments`/`trip_notes`/`trip_stops`/`trips`/`trips_manual`/`unassigned_reasons`, usados por 16 archivos del módulo Diario), 5 matviews de compliance leídas por los endpoints de listado de Empresas, `carrier_compliance_status` (uso manual).

**No investigado**: `ops.pipeline_rejects`/`ops.pipeline_runs` — sin verificar, no bloqueante.

Detalle completo de las 6 rondas, evidencia por objeto y las 2 memorias de método nuevas en `project_db_cleanup_audit_2026_07`, `feedback_mage_orphaned_block_still_runnable`, `feedback_schema_qualified_grep_only`.

**Decisión de arquitectura — accionable siguiente, explícito del usuario al cerrar esta ronda**: el modelo lógico y de datos del Diario (tablas `trips`/`trip_stops`/`trip_notes`/`trip_fleet_links`/`unassigned_reasons` + las de config/filtros) **no cumple el estándar de la industria ni el nivel de robustez/mantenibilidad que sí tienen Empresas/Seguros**. Converge con la investigación de `trips_context.md`/`uat-ux-minuta-modulo-diario.md`/`AGENTLOG_ARCHIVE.md` ya hecha esta misma sesión: Empresas/Seguros llegó a ese nivel vía diálogo grande centrado tipo Airtable/Attio (no slide-over) + `public.audit_log`/`services/audit.py` (reusable para historial de cambios del Diario, hoy inexistente) + ficha de detalle propia (`empresa/[id]/page.tsx`, 915 líneas) — el Diario concentra todo en un slide-over sin página de ficha dedicada. También quedan sin resolver: `F30_MULTAS` (no documentado en ningún lado, hay que definirlo desde cero), vista dedicada "no asignados" con conteo (pedida en 3 reuniones UAT, hoy solo filtro), calidad de diseño del módulo de Configuración (diferida dos veces, nunca retomada). **No iniciar sin abrir una conversación de brainstorming dedicada** — es explícitamente un "rediseñemos X", no una tarea chica.

`pytest` 216/216 en las 6 rondas de DB. `vitest`/`tsc`/`build` no se corrieron esta ronda salvo para el fix del punto 1 (verificado ahí, en verde).

#### Próximo paso exacto
1. [ ] **Abrir brainstorming dedicado para el rediseño del modelo lógico/datos del Diario** (accionable explícito del usuario) — cubre: modelo de datos de `trips`/config/filtros, historial de cambios por campo (reusar `public.audit_log`), `F30_MULTAS` (definir desde cero, no documentado en ningún lado), vista "no asignados" con conteo, calidad de diseño del módulo de Configuración. No iniciar implementación sin el diseño aprobado primero.
2. [ ] Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles` — si no, van a recrear las tablas dropeadas en `20260718040000` en la próxima corrida.
3. [ ] `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
4. [ ] Reanudar el trigger recurrente del pipeline en la UI de Mage — sigue siendo acción del usuario.
5. [ ] Investigar `extraction_service` (job store en memoria) — sigue fuera de `monitor-app`, requiere su propia sesión.
6. [ ] Reevaluar unificación de bloques dbt en 1-2 bloques — el usuario pidió esperar unos días con la higienización actual.
7. [ ] Sync recurrente `bronze.raw_shipper_locations` → `public.locations` — sigue pendiente.
8. [ ] Cargar compliance real de conductores — sigue en `MISSING` 100%.

---
