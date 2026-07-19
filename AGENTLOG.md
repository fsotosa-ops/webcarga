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

**Sesión cerrada 2026-07-18 a pedido del usuario** — la próxima arranca directo en el punto 1 del checklist, ya con la síntesis de `trips_context.md`/`uat-ux-minuta-modulo-diario.md`/`AGENTLOG_ARCHIVE.md` hecha esta sesión (no releer los 3 documentos de cero, la síntesis ya está en el punto 1 y en `project_db_cleanup_audit_2026_07`). Único cabo suelto de esa síntesis sin resolver: `AGENTLOG_ARCHIVE.md` línea ~534 dice que el auto-refresh del Diario está "pendiente", pero línea ~355 dice que la Fase F2 (2026-07-05) ya lo implementó vía TanStack Query — contradicción sin verificar contra el código real, chequear al empezar si importa para el rediseño.

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

### 2026-07-18 (cont.) — Decimoquinta ronda: rediseño de la experiencia de documentos de compliance (Empresas/Conductores/Vehículos/Seguros)

**Pedido del usuario** (verbatim, resumen): 7 puntos de feedback de UX sobre el panel de documentos — (1) unificar el link+ícono de "Ver archivo" entre Empresas y Seguros, (2) preview embebido en vez de pestaña nueva, (3) descarga/edición/borrado no existían, (4) el estado "En Revisión" no tiene sentido (no hay due diligence del negocio hoy), (5) el badge "manual" en Empresas sobra, (6) la fecha sin label no se entiende + el estado "Falta" debería permitir cargar directo desde ahí (best practice de UX), (7) Seguros necesita el mismo split Activo/Inactivo que Empresas (no "Activo/Legacy", que es mala nomenclatura).

**Investigación previa** confirmó: (1) Seguros (`PolicyFileRow`) ya tenía la coexistencia correcta, sin bug; (3) no existía ningún endpoint de borrado en el backend — capacidad nueva de punta a punta, no solo un botón.

**Implementado, con tests reales (backend 226/226, frontend `tsc`/`build`/`vitest` 367/367 en verde):**
- **Backend**: `POST .../file` (compliance + pólizas) pasa de forzar `PENDING_REVIEW` a `APPROVED_MANUAL` — decisión explícita del usuario ("si subiste un archivo es porque ya lo revisaste"). Nuevos `DELETE .../file` para `compliance_records` y pólizas/endosos (borra el blob de Storage, vuelve el registro a `MISSING`/limpia la columna). `GET /carriers/insurance-overview` gana `operational_status`, mismo eje que `/carriers`.
- **Frontend**: `DocumentPreviewModal` nuevo (preview PDF/imagen embebido, descarga forzada real vía fetch+blob, borrado con confirmación inline) — compartido entre `TransporterDocumentsPanel`, `DocumentChecklist` (conductores/vehículos) y `PolicyFileRow` (Seguros). `PENDING_REVIEW` quitado de los 2 selectores de estado manual (sigue válido en el CHECK constraint para datos legacy). Badge "manual" quitado en Empresas. Fecha con prefijo "Vence:" explícito. CTA de carga visible (borde punteado, "Subir documento") en vez de ícono chico cuando el estado es "Falta" — una vez cargado, el trigger pasa a ser el ícono secundario de "reemplazar". Tabs Activo/Inactivo agregados a `/dashboard/seguros`; "Legacy" renombrado a "Inactivo" en toda la UI de Empresas (concepto único, aunque `INACTIVE`/`LEGACY_INACTIVE` sigan siendo 2 valores distintos en la DB).

**Explícitamente NO implementado** (fuera de alcance de "borrar"): edición de metadata del documento (el usuario no aclaró qué significaría más allá de reemplazar, que ya existía) — no se preguntó de nuevo, se asumió cubierto por "Reemplazar".

**Sin verificar en navegador contra datos reales**: hubiera requerido correr el backend contra Supabase de producción y mutar `compliance_records`/pólizas reales para probar el flujo de borrado — se cubrió en cambio con tests de componente que simulan la interacción completa (click → confirmación → llamada a la API → refresco), más `tsc`/`build` limpios. Pendiente si el usuario quiere una verificación en vivo.

Comiteado en `dev`: commit `1e65a53`. **Sin pushear** — pendiente de confirmación del usuario.

#### Próximo paso exacto (histórico — ver ronda siguiente, el punto 3 ya se resolvió)
1. [ ] Confirmar push de `1e65a53` a `dev`.
2. [ ] Decidir si se quiere verificación manual en navegador de los flujos de preview/descarga/borrado (implica mutar datos reales de Storage/compliance_records).
3. [x] Abrir brainstorming dedicado para el rediseño del modelo lógico/datos del Diario — hecho, ver ronda siguiente.

---

### 2026-07-18 (cont.) — Decimosexta ronda: auditoría + plan de hardening del Diario (modo plan, sin implementación)

**Pedido del usuario**: auditar el módulo Diario (modelo lógico/datos + UX) contra el estándar ya alcanzado en Empresas/Seguros, con 9 puntos concretos de UX/trazabilidad más una pregunta de arquitectura sobre disponibilidad de flota. Explícito: solo auditoría y plan, sin implementar nada esta sesión.

**Metodología**: 3 exploraciones paralelas (frontend del detalle de viaje, backend/DB de trips, arquitectura de referencia Empresas/Seguros) + verificación de los scripts dbt reales **contra el pipeline vivo en Mage** (no las copias locales en `monitor-app/docs/`/raíz del repo, confirmadas desactualizadas en el proceso).

**2 bugs de datos nuevos encontrados con evidencia dura, no documentados en ningún lado hasta ahora**:
- **Wingsuite**: el origen del viaje (`accion='Carga'`) queda mezclado dentro del array de paradas en `app.trip_stops` HOY en producción — confirma el punto 1 del usuario. Un comentario en `dbt/tms/models/app/trips.sql` (live) dice que esto ya estaba filtrado (caso `398410`), pero el filtro no existe en el código real — regresión, no percepción de UX.
- **IANSA**: pérdida silenciosa de origen/destino/estado para el 100% de sus viajes — el branch de ingesta de IANSA (`qanalytics_endpoint_scraper_iansa`) cae en el modelo genérico `stg_qanalytics_trips.sql`, que lee keys (`Local`, milestone SAP) distintas a las que usa el payload real de IANSA (`trip_metadata.Origen`, `stops[].Destino`). Verificado con un viaje real (`IA148820`).

**Decisiones de arquitectura tomadas** (confirmadas por el usuario vía preguntas dirigidas):
1. Unificar origen como "parada 0" en `app.trip_stops` (no solo arreglar el orden visual) — mismo patrón que la Fase 2 del hardening, con excepción explícita de tocar la capa `stg_*`/`int_tms_trips_conformed` para corregir los bugs de Wingsuite/IANSA (esas capas siguen congeladas para todo lo demás).
2. Columna "Indicadores" de la tabla → tabs de filtro arriba (patrón `AlertStatTiles` ya usado en Empresas), edición exclusiva en el detalle del viaje.
3. Bootstrap de `trip_fleet_links.driver_id` (0/609 hoy): el usuario corrigió el enfoque original del plan — NO depender de `bronze.raw_bd_ot` (legacy) como vía principal, sino matchear contra `public.drivers`/`public.assets`, que ya cubren ~90% de los conductores visibles gracias al directorio de Empresas. `raw_bd_ot` queda solo como bootstrap residual.
4. Alcance unificado: el roadmap de esta auditoría se fusiona con el backlog ya existente en `AGENTLOG.md` (F30_MULTAS, vista no asignados, rediseño Configuración, etc.) en un solo plan priorizado, no queda como lista aparte.
5. Hallazgo nuevo aportado por el usuario en revisión: la carga masiva de viajes manuales (`TripBulkUpload.tsx`, CSV) es un flujo completamente desconectado del directorio de empresas/conductores/vehículos (solo texto libre, sin `carrier_id`/`driver_id`/`asset_id`) — a diferencia del alta individual (`TripCreateSlideOver.tsx`, que sí usa `EmpresaSelector`). Se agrega como punto 10 del plan: unificar ambos flujos al mismo mecanismo de resolución contra el directorio real.
6. Principio transversal agregado a pedido del usuario (pregunta sobre deuda técnica futura): sin un mecanismo de contrato/validación en la ingesta, cualquier TMS o cliente nuevo puede repetir el bug de Wingsuite/IANSA en silencio. Se agregan al roadmap (Fase 0, bajo costo): tests de completitud dbt segmentados por `(tms_name, source_client)` (no solo por TMS — hubiera atrapado IANSA de inmediato) y cuarentena explícita de payloads no reconocidos en vez de descarte silencioso. Declarar el mapeo de campos como configuración (en vez de SQL bespoke por TMS) queda como decisión de mediano plazo, no bloqueante.

**Plan completo, aprobado por el usuario**, guardado en `/Users/usuario/.claude/plans/necesito-que-actues-como-lucky-bentley.md` — incluye los 10 hallazgos verificados, el modelo de datos objetivo, el rediseño UX (reusando patrones de Empresas: diálogos centrados tipo Attio, `AlertStatTiles`, `DocumentPreviewModal`), y un roadmap de 6 fases (0: bugs críticos de datos → 1: modelo de datos → 2: UX detalle de viaje → 3: indicadores/disponibilidad → 4: consolidación de componentes → 5: backlog heredado).

**Sin cambios de código esta sesión** — modo plan estricto, a pedido explícito del usuario.

#### Próximo paso exacto (histórico — Fase 0 ejecutada y verificada, ver ronda siguiente)
1. [x] Fase 0 del plan — hecha, ver ronda siguiente.
2. [ ] (heredado, sin cambios) Confirmar push de `1e65a53` a `dev`.
3. [ ] (heredado, sin cambios) Decidir si se quiere verificación manual en navegador de los flujos de preview/descarga/borrado de documentos de compliance.
4. [ ] Barrer `source_client` dentro de `tms_name='qanalytics'` para descartar más casos silenciosos tipo IANSA (pregunta abierta del plan).
5. [ ] Re-medir el % de match real de `driver_name`/`tractor_plate` contra `public.drivers`/`public.assets` antes de decidir si hace falta el bootstrap residual vía `raw_bd_ot` (prerrequisito de la Fase 1 del plan).

---

### 2026-07-18 (cont.) — Decimoséptima ronda: Fase 0 del hardening del Diario ejecutada y verificada en producción

**Pedido del usuario**: "dale, arranca con la Fase 0" (fix Wingsuite + fix IANSA + tests de completitud por cliente + cuarentena de payloads no reconocidos).

**Ejecución**: se usó `mage-agent sync_project_to_local` para bajar el proyecto dbt real completo (325 archivos, vive solo en Mage — confirmado una vez más que no está versionado en este repo). Cambios aplicados sobre esa copia y sincronizados de vuelta con `sync_local_to_remote` (10 archivos, sin conflictos):

1. **Fix Wingsuite** (`dbt/tms/models/silver/stg_wingsuite_trips.sql`): agregado `FILTER (WHERE p.accion NOT IN ('Carga','Recolección','Pickup'))` al `jsonb_agg` que arma `trip_stops` — el origen ya no queda mezclado como parada `PICKUP`. Corregido también el comentario obsoleto en `dbt/tms/models/app/trips.sql` que afirmaba (falso) que ese filtro ya existía ahí.
2. **Fix IANSA** (`dbt/tms/models/silver/stg_qanalytics_trips.sql`): fallback genérico vía `COALESCE` — `raw_local` ahora cae a `elemento->>'Destino'` cuando `'Local'` no existe, y `origin_location_name` cae a `trip_metadata->>'Origen'` cuando no hay match de milestone SAP. Implementado como COALESCE genérico, no como rama `WHEN source_client='iansa'`, a propósito (cualquier cliente futuro con esa misma forma de payload queda cubierto sin código nuevo — alineado con el principio transversal del plan).
3. **Tests de completitud por cliente** (`dbt/tms/tests/assert_qanalytics_trips_{origin,stop_names}_completeness_by_client.sql`, tests singulares nuevos): fallan si algún `source_client` de `stg_qanalytics_trips` tiene el 100% de sus viajes/paradas sin origen/nombre — el control que hubiera atrapado IANSA el mismo día.
4. **Cuarentena de payloads no reconocidos**: mismo bug (`extract_timestamp` devolvía `0` en vez de señalizar fallo de parseo, indistinguible de "archivo viejo", confirmado duplicado idéntico en los 5 `data_loaders/processor(_qanalytics)_*.py`) corregido en los 5 a la vez — ahora devuelve `None` y el loop principal loguea explícitamente `⚠️ N archivo(s) con nombre no reconocido, EXCLUIDOS` con el nombre de cada uno. **Nota de alcance**: esto es visibilidad en el log de la corrida, no una tabla de rechazados persistida — la versión completa (tabla dead-letter con alerta) queda para cuando se decida invertir en eso, no se armó sin acordarlo primero.

**Bloqueo de tooling encontrado y resuelto**: `run_block` vía API falló con el mismo bug interno de Mage ya documentado en la ronda 12 (`NoResultFound` buscando un `pipeline_schedule` tipo "api" — no relacionado a estos cambios). Mismo patrón de resolución que la vez anterior: se le pidió al usuario correr los 2 bloques (`stg_wingsuite_trips`, `stg_qanalytics_trips`) manualmente en la UI de Mage — sin disparar scraping real (son bloques `dbt` puros, sin upstream de scraper). El usuario los corrió.

**Verificación en vivo contra Supabase real** (`viclzoftiudkepqnhekv`):
- Wingsuite `398410`: `pickup_entries_in_stops = 0`, origen (`CD Tambores`) intacto por separado.
- IANSA `IA148820`: `origin_location_name` pasó de NULL a `"CD Noviciado"`, parada de destino pasó de NULL a `"NESTLE CHILE S.A. (Maipú)..."`.
- A escala: IANSA pasó de **0/66 a 65/66** viajes con origen resuelto (el único caso restante es plausible — un archivo puntual sin la key `Origen`, no un fallo del fix). Walmart no se vio afectado (2126/2162, mismo ratio de antes).
- Los 2 tests de completitud nuevos: 0 filas (pasan) contra los datos reales actuales.
- `trip_status` de IANSA sigue en NULL — su payload no trae ningún campo de estado a nivel de viaje ni matchea SAP; **fuera de alcance de esta fase** (el plan solo prometía origen/destino), queda como gap conocido y documentado, no una promesa incumplida.

**Decisión de arquitectura**: el fallback de IANSA se implementó genérico (COALESCE de keys alternativas) en vez de una rama condicional por `source_client`, siguiendo el principio transversal acordado en el plan — reduce el riesgo de que el próximo cliente con un payload "distinto" repita el mismo bug en silencio.

**No se tocaron** las copias locales "espejo manual" del repo (`monitor-app/docs/`, raíz) — quedan desactualizadas como ya estaban (deuda ya documentada, "versionar el proyecto dbt en git" sigue como accionable de `trips_context.md`, no incluido en el alcance de esta Fase 0).

#### Próximo paso exacto (histórico — ver ronda siguiente, Fase 1 en curso)
1. [x] Fase 1 del plan arrancada — 3 de 5 ítems hechos, ver ronda siguiente.
2. [ ] (heredado, sin cambios) Confirmar push de `1e65a53` a `dev`.
3. [ ] (heredado, sin cambios) Decidir si se quiere verificación manual en navegador de los flujos de preview/descarga/borrado de documentos de compliance.
4. [ ] Barrer `source_client` dentro de `tms_name='qanalytics'` para descartar más casos silenciosos tipo IANSA.
6. [ ] Evaluar si vale la pena versionar el proyecto dbt real en git (deuda ya documentada, no resuelta esta ronda).

---

### 2026-07-18 (cont.) — Decimoctava ronda: Fase 1 del hardening en curso — bug crítico de trazabilidad encontrado y corregido, bootstrap masivo de driver_id/carrier_id/tractor_asset_id

**Pedido del usuario**: "dale, arranca con la Fase 1".

**Corrección del usuario sobre el bootstrap de driver_id**: medí el match real por nombre/RUT contra `public.drivers` (29-37%, lejos del ~90% que el usuario recordaba) y lo reporté honestamente en vez de asumir. El usuario aclaró el dato clave: **QAnalytics (86% del volumen) nunca reporta RUT, Sodimac (13%) no reporta NADA de conductor (limitación estructural del TMS, no de matching), solo Wingsuite (0.4%) reporta RUT** — y pidió específicamente evaluar `bronze.raw_bd_ot` para reconstruir la trazabilidad histórica. Verificado en vivo: match temporal patente+fecha (usando `f_despacho`, no `f_h_asignar_camion` — este último resultó ser un artefacto del batch de sync, mismo valor repetido entre viajes distintos) contra `raw_bd_ot` resolvió candidato para 2361 viajes, mediana de 0.2 días de diferencia, 99.4% dentro de 30 días — el usuario tenía razón, el ~90% era alcanzable, solo que la vía correcta era el bootstrap histórico, no el match directo contra el payload del TMS.

**Bug crítico encontrado en el camino, no buscado**: al medir el estado de `trip_fleet_links`, se descubrió que `app.trips.fleet_link_id` (la columna que usa `trips.py` para el JOIN) estaba en NULL para **608 de 609 vínculos reales** — `trip_fleet_links.trip_id` apuntaba correctamente a viajes válidos, pero el JOIN `fl.id = t.fleet_link_id` nunca los encontraba. Causa raíz: `fleet_link_id` está protegido en el MERGE incremental de dbt (`merge_exclude_columns`) pero NO en un `--full-refresh` (siempre computa `NULL::uuid` en el SELECT base), y el pipeline pasó por varios full-refresh durante el hardening de julio. Consecuencia real y verificada: la funcionalidad de "empresa transportista vinculada" era invisible vía API para casi todos los viajes pese a que el dato existía, y además **reasignar o desvincular una empresa en cualquiera de esos 608 viajes fallaba en silencio o con 500** (`assign_fleet_link`/`remove_fleet_link` también dependían de `trips.fleet_link_id` para encontrar el link a reemplazar/borrar).

**Fix aplicado** (confirmado por el usuario: invertir el JOIN + resincronizar, no solo parchear el dato):
- `trips.py`: los 2 JOINs de lectura (`_TRIP_FROM`, `available_drivers`) y los 5 lookups de escritura (PATCH driver_name/driver_phone/plates, POST fleet-link, DELETE fleet-link) ahora resuelven contra `app.trip_fleet_links.trip_id` directamente, no contra `trips.fleet_link_id` — inmune a futuros full-refresh, mismo principio que ya se aplicó con `post_hook` para PK/RLS/trigger.
- `_TRIP_FROM` gana además `LEFT JOIN public.drivers`/`public.assets` (tractor y trailer) — el dato resuelto de la tabla maestra ahora tiene prioridad sobre el texto libre de `trip_fleet_links` y sobre el texto crudo del TMS (`COALESCE(d.full_name, fl.driver_name_raw, tms_raw)`, mismo patrón para patentes).
- Tests: 226/226 backend en verde tras el cambio.

**Migración aplicada y versionada** (`20260718060000_bootstrap_trip_fleet_links_via_raw_bd_ot.sql`): resincroniza `fleet_link_id` para los 608 huérfanos + bootstrap de 1737 vínculos nuevos vía match temporal contra `raw_bd_ot` (carrier_id vía `eett_id`↔`legacy_admin_id`, driver_id vía RUT, tractor_asset_id vía patente). **Resultado verificado en vivo**: `app.trips.fleet_link_id` pasó de 1/2734 a 2346/2734 (85.8%); de esos 2346 vínculos, `driver_id` resuelto en 2161 (**92.1%** — confirma el ~90% que decía el usuario), `carrier_id` en 2345 (99.9%), `tractor_asset_id` en 2306 (98.3%). Sin duplicados (verificado). `raw_bd_ot` usado exclusivamente como bootstrap de una sola vez, sin crear ningún job/trigger que la consulte de nuevo (consistente con `trips_context.md` §5.3 — es una plataforma legacy a dar de baja).

**Sin commitear a git todavía** — cambios en `trips.py` y la migración nueva están en el working tree, pendientes de confirmación del usuario para commit.

#### Próximo paso exacto (histórico — ver ronda siguiente, gap de mecanismo ongoing resuelto)
1. [ ] Confirmar commit de los cambios de `trips.py` + la migración nueva.
2. [x] Exponer `origin_operation_type` — sigue pendiente, ver ronda siguiente para el resto.
3. [ ] Unificar origen como parada 0 en `app.trip_stops` — pendiente.
4. [ ] Unificar carga masiva CSV con el alta individual — pendiente.
5. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.

---

### 2026-07-18 (cont.) — Decimonovena ronda: mecanismo ongoing de trazabilidad (sin depender de raw_bd_ot)

**Objeción del usuario, justificada**: el bootstrap de la ronda anterior resolvía el histórico, pero `raw_bd_ot` es una plataforma legacy que se va a dar de baja — no sirve como dependencia permanente. El usuario preguntó explícitamente cómo se controla esto hacia adelante, sin asignación manual viaje por viaje, usando lo que ya existe en `public.*` + lo que reporta cada viaje nuevo.

**Diagnóstico**: `public.driver_assignments` vincula conductor↔EMPRESA y `public.asset_assignments` vincula vehículo↔EMPRESA — ninguna de las dos dice qué conductor maneja qué vehículo específico. Ese es el dato real que falta, y no había forma de derivarlo sin construir algo nuevo (confirmado revisando el schema de las 4 tablas relevantes en `public`).

**Solución implementada, separada en dos partes con confirmación del usuario en ambas**:

1. **Vehículo + empresa — resolución en vivo, sin tabla nueva**: `_TRIP_FROM` y `available_drivers` en `trips.py` ganan un fallback que resuelve `tractor_asset_id`/`carrier_id` por match de patente contra `public.assets`/`public.asset_assignments` cuando no hay un `trip_fleet_links` explícito. Funciona para CUALQUIER viaje nuevo, sin cron ni dependencia externa — verificado en vivo contra viajes reales sin vínculo (`CRGD44` → `Transporte Cribas Transporte Spa`, resuelto en el momento de la consulta).

2. **Conductor — tabla nueva `public.vehicle_driver_assignments`** (migración `20260718070000`): mismo patrón que `driver_assignments`/`asset_assignments` (status ACTIVE/INACTIVE, índice único parcial 1 activo por vehículo). Nuevos endpoints `POST`/`GET`/`DELETE /assets/{asset_id}/driver-assignment` en `assets.py` (mismo patrón de reasignación que `carriers.py assign_driver`). Operaciones asigna el conductor **una vez por vehículo**, no viaje por viaje — `_TRIP_FROM` la consulta automáticamente vía `vehicle_driver_assignments` para cualquier viaje que reporte esa patente. Reemplaza la necesidad de `raw_bd_ot` para todo viaje futuro.

**Nota de alcance**: la tabla nueva existe y el backend ya la consulta, pero **no hay UI todavía** para que operaciones cargue la asignación — el endpoint existe, falta el componente de frontend (candidato natural: junto a `DriverDetailPanel`/`VehicleDetailPanel` en Empresas, o un flujo dedicado en el Diario). No se construyó en esta ronda por alcance/tiempo — queda como pendiente explícito, no como decisión de que no hace falta.

Tests backend: 226/226 en verde. Verificado con queries reales contra Supabase (no solo mocks).

#### Próximo paso exacto (histórico — UI de asignación construida, ver ronda siguiente)
1. [x] Construir la UI de asignación vehículo→conductor — hecho, ver ronda siguiente.
2. [ ] Confirmar commit de todos los cambios de esta sesión (`trips.py`, `assets.py`, 2 migraciones nuevas).
3. [ ] Exponer `origin_operation_type` en el frontend — pendiente, ítem de la Fase 1.
4. [ ] Unificar origen como parada 0 en `app.trip_stops` — pendiente, el ítem más grande de la Fase 1.
5. [ ] Unificar carga masiva CSV con el alta individual — pendiente.
6. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
7. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
8. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.

---

### 2026-07-18 (cont.) — Vigésima ronda: UI de asignación vehículo→conductor

**Pedido del usuario**: "si haz la asignacion UI" — construir el frontend para `POST /assets/{id}/driver-assignment` (backend ya existía desde la ronda anterior).

**Implementado**: sección "Conductor habitual" agregada a `VehicleDetailPanel.tsx` (modal de detalle de vehículo en Empresas, `/dashboard/transportistas/empresa/[id]`) — reusa el roster de conductores de la empresa ya cargado en la página (`carriersApi.listDrivers`, sin fetch nuevo ni componente de búsqueda duplicado #4). Muestra el conductor asignado con botón de quitar, o un `<select>` + confirmar cuando no hay ninguno. Nuevos métodos en `lib/api/assets.ts` (`getDriverAssignment`/`assignDriver`/`unassignDriver`) y tipo `VehicleDriverAssignment` en `lib/types.ts`.

**Decisión de tipos**: el prop `drivers` se tipó como `{id, full_name}[]` mínimo (no el `Driver` completo) porque `carriersApi.listDrivers` devuelve `CarrierDriverRosterItem[]`, un shape más angosto — evita forzar un tipo más ancho del que hace falta.

**Verificación**:
- `tsc --noEmit`: limpio.
- `vitest`: 370/370 (14 nuevos tests en `VehicleDetailPanel.test.tsx` para el flujo completo: asignar, quitar, permisos `canEdit`).
- `npm run build`: exitoso.
- **Sin verificación en navegador autenticado** — la app usa SSO real (Google/Microsoft) contra Supabase de producción, sin credenciales de test ni bypass de auth disponibles en este entorno. Los servidores dev (backend :8001, frontend :3000) arrancaron limpios sin errores, pero no se pudo hacer click-through real. Queda pendiente que el usuario lo prueбe en vivo o provea credenciales de test.

**Commiteado**: sí, commit `7741ffe` en `dev` (10 archivos: Fase 0 + Fase 1 parcial hasta acá). Sin pushear — pendiente de confirmación del usuario.

#### Próximo paso exacto (histórico — ver ronda siguiente, Fase 1 completa)
1. [x] Confirmar commit de los cambios acumulados — hecho (`7741ffe`).
2. [ ] Verificación manual en navegador del flujo de asignación (requiere credenciales reales del usuario).
3. [x] Exponer `origin_operation_type` — hecho, ver ronda siguiente.
4. [x] Unificar origen como parada 0 en `app.trip_stops` — hecho, ver ronda siguiente.
5. [x] Unificar carga masiva CSV con el alta individual — hecho, ver ronda siguiente.
6. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
7. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
8. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.

---

### 2026-07-18 (cont.) — Ronda 21: Fase 1 del hardening del Diario — CERRADA. Origen unificado como parada 0, con 2 regresiones de datos históricas encontradas y corregidas en el camino

**Pedido del usuario**: "sigue con los 3 ítems que quedan" (origin_operation_type, origen como parada 0, unificar CSV). Los 2 primeros salieron rápido; el tercero (origen como parada 0) resultó ser mucho más profundo de lo planeado — encontró y corrigió 2 bugs reales de datos históricos en el camino, más un tercero preexistente ajeno a la tarea.

**Ítems chicos, hechos sin sorpresas**:
- `origin_operation_type`: badge agregado junto a "Ubicación de origen" en `TripSlideOver.tsx`, reusando `OperationTypeBadge` ya existente.
- Unificar CSV con alta individual: viajes manuales/CSV sin empresa explícita ahora auto-resuelven `carrier_id`/`tractor_asset_id`/`driver_id` por patente al crearse (`_auto_resolve_fleet_link`, mismo mecanismo que el fallback en vivo de la ronda anterior).

**Origen como parada 0 — el trabajo grande**:

1. **Modelo de datos**: `app.trip_stops` gana `stop_type` (ORIGIN/DESTINATION, migración `20260718080000`). `dbt/tms/models/app/trip_stops.sql` reescrito para emitir la fila ORIGIN (stop_order=0) leyendo `origin_location_name`/`planned_departure_at`/`actual_departure_at` directo de `silver.int_tms_trips_conformed` (no de `app.trips`, que se iba a dejar de tener esas columnas). Viajes manuales: `_insert_trip_stops` en `trips.py` inserta la fila ORIGIN directo (mismo patrón dual TMS/manual que ya usan las paradas de destino desde Fase 2).

2. **Bug real encontrado #1 — dbt incremental nunca reprocesa el historial viejo**: el modelo `trip_stops` (y `trips`) son incrementales con watermark basado en `MAX(updated_at)` del target. Apenas corre una vez, el watermark salta a "hoy" y el resto del historial (viajes cerrados sin actividad reciente) queda huérfano para siempre — el caso de prueba `398410` se quedó sin fila ORIGIN. Se resolvió con una migración de backfill directa en SQL (`20260718090000`, no `--full-refresh`, que hubiera borrado `desc_inicio_manual`/`desc_fin_manual` reales de operaciones al ignorar `merge_exclude_columns`).

3. **Bug real encontrado #2 — el fix de Wingsuite de la Fase 0 nunca se propagó al historial**: mismo problema de raíz que el bug #1, un nivel más abajo — `app.trips.stops` (el jsonb que alimenta `trip_stops`) es TAMBIÉN incremental, así que los 12 viajes de Wingsuite (100% de ese TMS) seguían con el origen duplicado como parada de destino (el bug que se creía cerrado en Fase 0). Corregido con un DELETE dirigido + renumeración (`20260718100000`), verificado caso por caso contra los 12 afectados antes de aplicar.

4. **Bug real preexistente encontrado #3, ajeno a esta tarea**: `PATCH /trips/{id}/stops/{stop_id}` hacía `SELECT id FROM app.trip_stops` — esa tabla nunca tuvo columna `id` (solo `stop_id`, su PK). Tiraba error real en cualquier llamada; los tests nunca lo agarraron porque mockean el pool. Corregido de paso porque bloqueaba directamente la edición de Carga Inicio/Fin del origen.

5. **Cutover final**: `origin`/`cag_inicio_at`/`cag_fin_at` eliminados de `app.trips` y `app.trips_manual` (migración `20260718110000`, verificado sin vistas/funciones dependientes antes de aplicar). `origin_region`/`origin_city` **NO se tocaron** — siguen siendo un filtro real y activo del Diario, sin relación con la unificación de timing. El nombre de origen ahora se deriva en runtime (`_attach_origin`, desde la parada ORIGIN) para no romper consumidores que solo necesitan el string (`TripTable.tsx`).

6. **Frontend**: `stop_type` en `TripStop`; `StopTimeline`/`RouteProgress` tratan la salida (no la llegada) como señal de completitud del origen; `describeStopTiming` no dice "llega ~X" para el origen (no tiene noción de llegada); el contador "N/M paradas" y `StopProgressDots` cuentan solo destinos (el origen no es una "parada" en el vocabulario operativo); "Datos operativos" perdió Origen/Carga Inicio/Fin (ahora se editan en la fila ORIGIN de la tabla técnica de Ruta, con badge "ORIGEN" visible). Esto resuelve de raíz los puntos 1 y 2 del plan original (origen mezclado con paradas, orden narrativo invertido) — la Ruta ahora cuenta la historia en orden cronológico real.

**Verificación**: 228/228 backend, 371/371 frontend, `tsc` limpio, `npm run build` exitoso. Todas las migraciones probadas con dry-run antes de aplicar. La query real de `_TRIP_SELECT`/`_TRIP_FROM` se corrió contra Supabase en vivo (no solo mocks) para confirmar que compila contra el schema ya recortado.

**Push**: `7741ffe`+`882c216` pusheados a `origin/dev` (confirmado por el usuario).

#### Próximo paso exacto (histórico — ver ronda siguiente)
1. [x] Confirmar commit y push de todos los cambios de hoy a `dev` — hecho.
2. [ ] (heredado) Confirmar push de `1e65a53` a `dev` (commit más viejo, arrastrado de varias rondas — sigue sin confirmarse, sigue pendiente).
3. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
4. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
5. [ ] (heredado) Decidir si se quiere verificación manual en navegador — ninguna ronda de la Fase 0/1 pudo probarse con clic real (sin credenciales de test para la app con SSO real).
6. [x] Fase 2 del plan, ítem 1 ("Ingresó al sistema") — hecho, ver ronda siguiente. Profesionalización general de la bitácora sigue pendiente.

---

### 2026-07-18 (cont.) — Ronda 22: Fase 2 — "Ingresó al sistema" fuera del footer invisible

**Pedido del usuario**: "continua" (tras confirmar el push).

**Implementado**: `trip.created_at` se movió del footer (`text-[9px] text-gray-300`, la tipografía más chica del componente, al final de todo el panel) al hero, junto a "TMS reportó X · sync Y" — misma familia de info de timing ("¿cuándo supimos esto?"), mismo tratamiento visual (`text-[11px] text-gray-400`). El footer ahora solo tiene el UUID técnico del viaje, que sí amerita quedar de referencia discreta.

**Verificación**: `tsc` limpio, 372/372 tests frontend, `npm run build` exitoso. Test viejo que buscaba el label "Ingresó al sistema" (MetaField) actualizado para buscar el texto nuevo "en el Diario desde".

**Pendiente de la Fase 2**: la "profesionalización general de la bitácora" (punto 6 del plan original) sigue sin abordarse — es un ítem más grande y menos definido (el plan lo dejó como "evaluar si el patrón de diálogo centrado tipo Attio aplica mejor... para reclamos de sobreestadía con adjuntos", sin decisión tomada todavía).

#### Próximo paso exacto (histórico — ver ronda siguiente)
1. [x] Commit de esta ronda — hecho. Push pendiente de confirmación (ver ronda siguiente).
2. [x] "Los más fáciles y simples" → Indicadores a tabs de filtro (Fase 3) — hecho, ver ronda siguiente.
3. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
4. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
5. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
6. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---

### 2026-07-18 (cont.) — Ronda 23: Indicadores → tabs de filtro (Fase 3, el ítem "más fácil y simple")

**Pedido del usuario**: "vamos por los mas faciles y simples de ajustar" — de lo que quedaba del roadmap (bitácora sin alcance definido, Indicadores→tabs, vista de disponibilidad, consolidar 3 selectores duplicados), el más acotado era Indicadores→tabs: ya estaba decidido en el plan original y reusa un patrón visual ya existente en la propia página del Diario (las KPI cards), no algo importado de otro módulo.

**Implementado**:
- `FLAGS` (Activo/Trabajando/Asignado/1ra Vuelta) se movió de una constante duplicada dentro de `FilterPopover.tsx` a `useDiarioFilters.ts` (fuente única).
- Nueva fila de tiles clickeables sobre la tabla del Diario (`page.tsx`), mismo patrón visual y de interacción que las KPI cards ya existentes en esa misma página (conteo + tile con color + disabled si count=0) — no truje un componente de otro módulo, reusé el patrón nativo de esta página porque calzaba mejor (los 4 indicadores no son mutuamente excluyentes, a diferencia de `AlertStatTiles` que sí lo es).
- Filtro "Indicadores" sacado del popover (quedaba escondido pese a ser de los más usados).
- `IndicatorDots` (edición inline con clic) removido de `TripTable.tsx` (columna completa + 2 usos) y `TripCard.tsx` — la columna sticky derecha de la tabla ahora es solo el chevron de apertura.
- `TripSlideOver.tsx`: la sección "Indicadores" ya no se restringe a viajes manuales — es la única superficie de edición ahora, tiene que estar disponible siempre (corrige la inconsistencia real que ya estaba documentada: la tabla editaba para cualquier origen, el detalle no).

**Verificación**: `tsc` limpio, 367/367 tests frontend (5 tests obsoletos del comportamiento inline removidos/reescritos en `TripTable.test.tsx`, `TripCard.test.tsx`, `TripSlideOver.test.tsx`), `npm run build` exitoso.

#### Próximo paso exacto (histórico — ver ronda siguiente, vista de disponibilidad hecha)
1. [x] Vista de disponibilidad roster-driven (Fase 3) — hecha, ver ronda siguiente.
2. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
3. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
4. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
5. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---

### 2026-07-18 (cont.) — Ronda 24: vista de disponibilidad de conductores/equipos, roster-driven (Fase 3, cierra el punto 9 del plan original)

**Pedido del usuario**: "sigamos con la vista de disponibilidad de conductores/equipos" — reemplazar `GET /trips/available-drivers` (agrupaba por nombre de texto libre dentro de los viajes del día, invisibilizando a cualquier conductor sin NINGÚN viaje ese día) por el diseño correcto que el plan ya había identificado: partir del directorio real de conductores/equipos activos y recién ahí cruzar contra los viajes del día. Quedaba bloqueado hasta que `trip_fleet_links.driver_id` tuviera cobertura suficiente — la Ronda 18 ya lo dejó en 92.1%.

**Backend**:
- `available_drivers` reescrito: CTE `active_roster` (`public.drivers` JOIN `public.driver_assignments` status=ACTIVE JOIN `public.carriers` operational_status=ACTIVE) LEFT JOIN `today_trips` (viajes del día vía `trip_fleet_links.driver_id`, excluye sodimac por no reportar flota). `WHERE tt.driver_id IS NULL OR tt.trips_total = tt.closed_count` — así un conductor sin ningún viaje hoy ya no queda invisible, que era el bug de fondo del diseño anterior. Ahora expone `driver_id`.
- `available_assets` (endpoint nuevo, mismo diseño exacto sobre `public.assets`/`public.asset_assignments`).
- Tests: `test_available_drivers_returns_rows_and_excludes_sodimac_in_query` actualizado (aserciones sobre `public.driver_assignments`/`operational_status = 'ACTIVE'` en vez de `HAVING`, que ya no existe en la query nueva); 2 tests nuevos para `available_assets`. 230/230 backend en verde.
- Verificado en vivo contra Supabase real: 79 conductores en el roster activo, 76 sin ningún viaje hoy (invisibles en el diseño anterior), 3 ocupados — mismo patrón confirmado para equipos.

**Frontend**:
- `AvailableDriver` gana `driver_id`; tipo nuevo `AvailableAsset` (`asset_id`, `tractor_plate`, `asset_type`, `carrier_name`, `trips_total`, `last_report_at`, `driver_name`).
- `tripsApi.availableAssets(fecha)` agregado junto al ya existente `availableDrivers`.
- `AvailableDriversPanel.tsx` → renombrado y reescrito como `AvailabilityPanel.tsx`: mismo panel, con tabs Conductores/Equipos (decisión del usuario vía pregunta dirigida — no dos paneles separados). Cada tab tiene su propio fetch (`useAvailableDrivers`/`useAvailableAssets`, solo el tab activo hace query), su propio estado vacío, y el mismo botón "Asignar a viaje nuevo" que pre-llena `TripCreateSlideOver` (misma acción confirmada por el usuario: pre-llenar el formulario con la patente, sin forzar `carrier_id`/`driver_id` directo porque `AvailableAsset`/`AvailableDriver` no traen `carrier_id` real, solo el nombre — evita dejar el form con un `driver_id`/`tractor_asset_id` sin `carrier_id` correspondiente).
- `page.tsx`: `showDrivers` → `showAvailability`; el tile de "conductores disponibles" pasa a "disponibles" (cuenta conductores + equipos combinados, abre el panel en la tab Conductores por default); nuevo `handleAssignAsset` análogo a `handleAssignDriver`.
- Tests nuevos: `AvailabilityPanel.test.tsx` (7 tests — tab por defecto, cambio de tab, ambas acciones de asignar, ambos estados vacíos, cerrado no renderiza).

**Verificación**: `tsc --noEmit` limpio, 374/374 tests frontend (7 nuevos, 0 regresiones), `npm run build` exitoso, 230/230 backend.

**Con esto, del roadmap original de la auditoría (`necesito-que-actues-como-lucky-bentley.md`) solo quedan**: Fase 2 "profesionalización general de la bitácora" (sin alcance definido todavía) y Fase 4 "consolidar los 3 selectores de empresa duplicados" (`CarrierAssignSection`/`EmpresaSelector`/`TransferModal`).

**Comiteado y pusheado**: commit `884f9e6` en `dev`, pusheado a `origin/dev` a pedido explícito del usuario.

#### Próximo paso exacto (histórico — Fase 4 hecha, ver ronda siguiente)
1. [x] Confirmar commit y push de esta ronda — hecho (`884f9e6`).
2. [x] Fase 4: consolidar `CarrierAssignSection`/`EmpresaSelector`/`TransferModal` — hecho, ver ronda siguiente.
3. [ ] Fase 2 restante: profesionalización de la bitácora (sin alcance definido — evaluar si el patrón de diálogo centrado tipo Attio aplica mejor que el slide-over actual, decisión pendiente).
4. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
5. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
6. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
7. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---

### 2026-07-18 (cont.) — Ronda 25: Fase 4 — consolidación de los 3 selectores de empresa duplicados

**Pedido del usuario**: "dale, arranca con la Fase 4" — `CarrierAssignSection` (`TripSlideOver.tsx`), `EmpresaSelector` (`TripCreateSlideOver.tsx`) y `TransferModal.tsx` implementaban cada uno, por separado, el mismo patrón de búsqueda debounced de empresa transportista (`carriersApi.list`) con su propio estado, su propio `useQuery`, y una lista de resultados casi idéntica (ícono `Building2` + nombre + RUT + loading/vacío).

**Diseño**: se extrajo el denominador común real — la caja de búsqueda + la lista de resultados con sus estados de carga/vacío/error — a un componente nuevo, `CarrierSearchPicker.tsx`. Lo que cada uno de los 3 hacía *después* de elegir una empresa seguía siendo genuinamente distinto (swap a card resumen + carga de roster async en `EmpresaSelector`; swap a selects de conductor/tracto + botón "Vincular" que llama a la API en `CarrierAssignSection`; fila resaltada + botón "Confirmar transferencia" separado en `TransferModal`) — esa lógica quedó en cada consumidor, no se forzó a una abstracción única que no calzaba.

**Decisión de diseño clave**: `onPick` del componente compartido acepta un callback `void | Promise<void>`. Esto le permitió absorber también el spinner-por-fila y el manejo de error que `EmpresaSelector` tenía escrito a mano para su carga async de roster — quedó gratis al migrar, sin tener que replicar esa lógica en el componente compartido de forma especial.

**Props de variación cubiertas**: `size` (`sm`/`md`, difieren tamaños de fuente/input entre uso embebido en panel vs. diálogo), `excludeId` (no ofrecer la empresa actual como destino en `TransferModal`), `selectedId` (resaltar fila sin sacarla de la lista, patrón exclusivo de `TransferModal` — los otros 2 swapean a una vista resumen en vez de resaltar), `showMinCharsHint` (`TransferModal` muestra "Escribe al menos 2 caracteres…" en vez de no renderizar nada), `maxHeightClass`, `autoFocus`, `helperText`.

**Resultado**: -178 líneas / +45 en los 3 consumidores (neto -133), + el componente compartido nuevo (~120 líneas) con su propio test file. Sin cambios de comportamiento visible — mismos 3 flujos, mismo texto, mismos endpoints.

**Verificación**: `tsc --noEmit` limpio, 381/381 tests frontend (7 nuevos en `CarrierSearchPicker.test.tsx`; los tests existentes de `TripCreateSlideOver.test.tsx`/`TripSlideOver.test.tsx` que ejercitan el flujo de búsqueda end-to-end pasaron sin modificarse, confirmando que el refactor no cambió el comportamiento observable), `npm run build` exitoso. `TransferModal.tsx` no tenía tests propios antes de esta ronda y sigue sin tenerlos — fuera de alcance de "consolidar", su comportamiento queda cubierto indirectamente por los tests del componente compartido que ahora usa.

**Con esto, del roadmap original de la auditoría del Diario solo queda**: Fase 2 "profesionalización general de la bitácora" (sin alcance definido).

**Comiteado y pusheado**: commit `a6176cc` en `dev`, pusheado a `origin/dev`.

#### Próximo paso exacto (histórico — ver ronda siguiente, requerimientos nuevos de UX abrieron un spec propio)
1. [x] Confirmar commit y push de esta ronda — hecho (`a6176cc`).
2. [ ] Fase 2 restante: profesionalización de la bitácora — sigue sin alcance definido, ver ronda siguiente para requerimientos nuevos relacionados que sí se definieron.
3. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
4. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
5. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
6. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---

### 2026-07-18 (cont.) — Ronda 26: brainstorm + spec de rediseño driver-first del Diario, Plan 1 (driver_leg_number) ejecutado — CERRADA, ver `AGENTLOG_ARCHIVE.md`

Los 3 planes del spec (`driver_leg_number`, `TripAssignDialog`, escalabilidad de filtros) quedaron completos y pusheados (`7c3ea85`, `aacfa65`, `f4e773d`). Detalle completo movido al archivo — checkpoint cerrado, sin pasos pendientes propios (el ítem 3 de "Fase 2 restante" que quedaba abierto se retoma formalmente en la Ronda 27).

---

### 2026-07-19 — Ronda 27: spec grande de Fase 2 (unificación crear/editar viaje + bitácora) aprobado, Plan 1 de 7 (fundamentos de backend) ejecutado

**Pedido del usuario**: al usar `TripAssignDialog` (Ronda 26), reportó que la patente a veces no se sincroniza al elegir conductor, y pidió que el formulario de creación tenga los mismos campos que el detalle del viaje (que funcione "como template"), con una UX integrada, fluida y de baja carga cognitiva — además de que la tabla del Diario no está a la altura de una SaaS world-class. Esto abrió la "Fase 2" (profesionalización de la bitácora) que quedaba indefinida desde la Ronda 21.

**Proceso**: brainstorm formal (`superpowers:brainstorming`), ~10 rondas de preguntas dirigidas + hallazgos propios verificados contra código/DB real, cerrado en un spec grande aprobado: `docs/superpowers/specs/2026-07-19-diario-fase2-bitacora-design.md` (gitignored, no se pushea, mismo patrón que el resto de `docs/superpowers/`). Decisiones clave del spec:

1. **Unificación del contrato crear/editar**: el origen pasa de `TripCreateBody.origin` (string suelto) a una fila más de `stops[]` (`stop_type: 'ORIGIN'`), igualando el modelo que el detalle ya usa desde la Ronda 21 (origen como parada 0 en `app.trip_stops`).
2. **Gap real de reconciliación manual↔TMS encontrado durante el diseño** (no buscado): cuando un viaje manual con TMS integrado es reportado después por su TMS real, las filas `is_manual_stop=true` de ese trip_id quedan huérfanas — el backend calcula `stop_id` con el texto que tipeó el operador, dbt lo calcula con el nombre real de la TMS, casi nunca coinciden. Fix diseñado con el usuario en 2 iteraciones: la primera propuesta (borrado simple) el usuario la rechazó por incompleta ("como asi no lo resuelves del todo") — la versión final preserva `desc_inicio_manual`/`desc_fin_manual` del ORIGEN manual (match unívoco garantizado: 1 solo origen por viaje) antes de borrar todas las filas manuales del viaje ya reconciliado; para destinos no hay match unívoco posible, se acepta la pérdida con aviso al operador en el momento de crear el viaje.
3. **Cliente/shipper real**: `client_name` era texto libre sin vínculo a `public.shippers` (11 shippers reales) — se agrega `shipper_id`/`shipper_name` resuelto **en vivo** (LEFT JOIN por nombre normalizado, mismo patrón "resolución en vivo" de las Rondas 18-19, sin tocar dbt) + `POST /shippers` para crear un cliente nuevo al vuelo desde el formulario.
4. **Componentes compartidos nuevos** (Plan 2, todavía no escrito): `RouteEditor` (origen+paradas) y `FleetAssignSection` (conductor→empresa/vehículo, driver-first) — usados por `TripAssignDialog` (crear) Y `TripSlideOver` (editar), unificando de raíz el problema original de la patente sin sincronizar.
5. **`origin_region`/`origin_city` reemplazados por `origin_operation_type`** (RM/Zona Cero) en el formulario de creación y en el detalle, más el filtro correspondiente en `FilterPopover` — corrección propia del usuario en pleno diseño: "no aplica región ciudad, si no que es el operation_type de public.locations". Ya se resuelve en backend, cero trabajo nuevo del lado de datos.
6. **Link a la TMS desde el detalle del viaje — momento de seguridad manejado explícitamente**: el usuario pidió esto referenciando `extraction_service/.env` (credenciales reales de scraping). Se marcó el riesgo antes de diseñar nada (cuenta de servicio compartida = sin trazabilidad por usuario, evasión de Cloudflare de Sodimac pensada para scraping automatizado, no sesiones humanas) y se descartó cualquier flujo autenticado. El usuario eligió la opción segura: un link plano a la página pública de login de cada TMS (`QANALYTICS_URL`/`WINGSUITE_URL`/`SODIMAC_URL`, no son secretos), sin manejo de credenciales en ningún punto de la app.
7. **"EETT TMS" retirado** de "Datos operativos" — su única función real (detectar divergencia de transportista a nivel TMS) se absorbe en el banner de reconciliación ya existente, extendido para comparar también `carrier_name_tms`.
8. **Indicadores rediseñados** (4 puntos crípticos de una letra → 3 switches con etiqueta + estado de override explícito), **"1ra Vuelta" retirado** (ya estaba muerto desde el Plan 3 de la Ronda 26), **Bitácora rediseñada** (ancho completo en vez de sidebar de 360px, texto legacy `trip.notes`/`trip.comments` retirado — verificado 0/2734 viajes con datos ahí —, incidentes con ciclo de vida real: `resolved_at` + endpoint de resolución + badge de incidentes abiertos en el hero).
9. **`RouteProgress` retirado por completo** — único consumidor era `TripSlideOver`, duplicaba la lógica exacta de `StopTimeline` en una metáfora visual competidora (dots horizontales vs. timeline vertical); `StopTimeline` queda como única visualización canónica de ruta.
10. **`TripTable` pasa a ser de solo lectura** — se retiran los 3 editores inline (`ConductorCell`/`PhoneTagCell`/`PlateCell`); clic en la fila abre el detalle, toda edición se concentra ahí.
11. Auditoría UX adicional pedida explícitamente al cierre del diseño (5 hallazgos, todos aprobados): Estado duplicado (hero+Gestión) con microcopy aclaratorio; "Motivo de no asignación" agrupado bajo el switch "Asignado"; los 2 mecanismos de copiar ID (externo en header, UUID interno casi invisible en el footer) unificados en el header; "Datos operativos" se muda a la aside angosta de Gestión ahora que Bitácora libera espacio; el link a la TMS cuelga del chip de TMS ya existente en vez de agregar un elemento nuevo.

**Decomposición en 7 planes secuenciales** (mismo criterio que la Ronda 26, por tamaño del spec): 1) fundamentos de backend, 2) componentes compartidos frontend, 3) `TripAssignDialog` reconstruido, 4) `TripSlideOver` reconstrucción estructural, 5) Indicadores + Bitácora, 6) `TripTable` solo lectura, 7) filtro `operation_type`. Solo el Plan 1 se escribió y ejecutó esta ronda — los planes 2-7 se escriben cuando corresponda ejecutarlos, no antes.

**Plan 1 (fundamentos de backend) — 4 tareas, todas ejecutadas inline (`superpowers:executing-plans`), con el orden corregido por el propio self-review del plan (Tarea 2 antes que Tarea 1, por la dependencia cruzada de `is_manual_stop`):**

- **Tarea 2 — `is_manual_stop` + limpieza de reconciliación**: columna nueva en `app.trip_stops` (migración `20260719000000`, aplicada y verificada — 7240 filas existentes, todas `false`). Modelo dbt real `dbt/tms/models/app/trip_stops.sql` (sincronizado desde Mage, editado, sincronizado de vuelta) gana la columna en sus 2 CTEs (obligatorio por `on_schema_change='sync_all_columns'` — si no aparece en el `SELECT`, dbt la elimina) + 2 entradas de `post_hook` (preserva horario de origen manual, borra filas manuales huérfanas tras reconciliación). El usuario corrió el bloque a mano en la UI de Mage (mismo patrón de esta sesión, `run_block` sigue roto por API) — verificado que la columna sobrevivió (7240 filas, 2696 ORIGIN + 4544 DESTINATION, todas `false` porque hoy no hay viajes manuales insertados por el flujo nuevo).
- **Tarea 1 — `TripCreateBody` unificado**: `TripStopCreate` gana `stop_type` (default `'DESTINATION'`); `TripCreateBody` pierde `origin` (`origin_region`/`origin_city` quedan intactos, los sigue usando la carga CSV, fuera de alcance); `_validate_create_body` rechaza más de 1 ORIGIN; `_insert_trip_stops` reescrito para insertar ambos tipos desde `stops[]`, marcando `is_manual_stop=true`. 3 tests nuevos.
- **Tarea 3 — `shipper_id`/`shipper_name` en vivo + `POST /shippers`**: `_TRIP_FROM` gana el `LEFT JOIN public.shippers` (match por nombre normalizado), `_TRIP_SELECT` expone los 2 campos nuevos. `shippers.py` gana `POST` (`require_editor`, 409 en nombre duplicado). **Bug propio encontrado y corregido en plena ejecución**: al escribir el test de `_TRIP_SELECT`, un `Edit` mal delimitado dejó una aserción (`leg_number >= 2`) del test anterior colgando dentro del test nuevo — detectado porque el test falló con un mensaje que no correspondía a lo que se estaba probando, corregido antes de seguir. También se descubrió que `test_shippers.py` ya existía de una ronda previa (con su propio `make_client` sin `require_editor`) — se extendió en vez de sobrescribir, para no perder el test existente. Verificado en vivo: `client_name='iansa'` resuelve correctamente contra `shipper_name='Iansa'`.
- **Tarea 4 — ciclo de vida de incidentes**: columna `resolved_at` en `app.trip_notes` (migración `20260719010000`), endpoint `PATCH /trips/{id}/notes/{note_id}/resolve` (`{resolved: bool}` → `{ok, resolved}`, 404 si no existe), mismo patrón exacto que `pin_trip_note` ya existente.

**Verificación**: 244/244 backend (era 236 antes del plan). 4 commits (`597a0f6`, `0e6aff6`, `b5d71ab`, `24f6525`) en `dev`.

**Sin pushear** — restricción explícita del propio plan (`Global Constraints`): el frontend actual todavía manda `origin` como string suelto; si se pushea esta rama sola, los viajes manuales creados en producción quedarían sin parada de origen hasta que el Plan 3 (frontend) también esté andando. Pushear junto con o inmediatamente antes del Plan 3, no antes.

#### Próximo paso exacto (histórico — Plan 2 hecho, ver Ronda 28)
1. [x] Escribir y ejecutar el Plan 2 (componentes compartidos frontend: `RouteEditor`, `FleetAssignSection`, `ClientPicker`) — hecho, ver Ronda 28.
2. [ ] Plan 3 (`TripAssignDialog` reconstruido sobre los componentes compartidos + aviso de reconciliación en modo TMS integrado) — **antes de pushear el Plan 1**, ver restricción de secuenciación arriba.
3. [ ] Plan 4 (`TripSlideOver` reconstrucción estructural), Plan 5 (Indicadores + Bitácora), Plan 6 (`TripTable` solo lectura), Plan 7 (filtro `operation_type`) — en ese orden, cada uno escrito recién al momento de ejecutarlo.
4. [ ] Confirmar con el usuario el push conjunto de los Planes 1+2+3 una vez el Plan 3 esté listo.
5. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---

### 2026-07-19 (cont.) — Ronda 28: Fase 2 Plan 2 — 3 componentes compartidos de frontend

**Pedido del usuario**: "si continua" (tras el reporte de cierre del Plan 1 backend).

**Proceso**: `writing-plans` con research directo de los archivos reales (`TripAssignDialog.tsx`, `TripSlideOver.tsx` sección `CarrierAssignSection`, `DriverSearchPicker.tsx`, `CarrierSearchPicker.tsx`, `lib/types.ts`, `lib/api/trips.ts`/`locations.ts`) antes de escribir el plan — el spec describe el qué, no las signatures exactas. Plan guardado en `docs/superpowers/plans/2026-07-19-diario-fase2-shared-components-plan.md`, ejecutado inline (`executing-plans`) en la misma sesión, TDD estricto por componente.

**3 componentes nuevos, ninguno todavía consumido** (Plan 3/4 los wirean después):
- **`RouteEditor`** (`components/dashboard/RouteEditor.tsx`): origen + paradas en un solo componente controlado (`stops: TripStopCreatePayload[]`/`onChange`), reemplaza la combinación actual de input de origen suelto + lista de destinos separada de `TripAssignDialog`. `TripStopCreatePayload` (`lib/types.ts`) gana `stop_type?: 'ORIGIN' | 'DESTINATION'` (opcional, aditivo — `TripAssignDialog.tsx:425` sigue construyendo el tipo sin ese campo y sigue compilando).
- **`FleetAssignSection`** (`components/dashboard/FleetAssignSection.tsx`): conductor→empresa/vehículo driver-first, completamente controlado (`FleetAssignValue`/`onChange`, sin llamada a API propia) — reusa `DriverSearchPicker` ya existente. Diseñado a propósito sin lógica de guardado embebida: el Plan 3 lo usa para poblar el `form` local de `TripAssignDialog` (igual que hoy `handlePickDriver`); el Plan 4 lo va a envolver en su propio `draft` + botón "Vincular" que llama a `tripsApi.assignFleetLink`, reemplazando recién ahí el `CarrierAssignSection` carrier-first actual de `TripSlideOver` (no tocado en esta ronda).
- **`ClientPicker`** (`components/dashboard/ClientPicker.tsx`): combobox controlado sobre el string `client_name` (sin cambiar el contrato de `POST /trips`, que sigue esperando solo el nombre) — busca contra `public.shippers` (11 reales, fetch único sin debounce) y ofrece "Crear cliente" al vuelo cuando no hay match exacto, vía `shippersApi.create` (nuevo, `lib/api/locations.ts`, consume `POST /shippers` del Plan 1 de esta Fase). Maneja el caso de carrera en la creación (409 → refetch + selecciona igual, no error).

**Verificación**: 420/420 frontend (era 401 antes de esta ronda — 19 tests nuevos, 0 regresiones), `tsc --noEmit` limpio. Sin verificación en navegador (mismo motivo de siempre — SSO real, sin credenciales de test).

**3 commits en `dev`** (`d0d83b9`, `8f4a5a8`, `1611e9b`). **Sin pushear** — misma restricción del Plan 1: el frontend real (`TripAssignDialog`/`TripSlideOver`) no usa todavía estos componentes, así que no hay riesgo funcional en producción por no pushear, pero se mantiene agrupado con el Plan 1 (que sí tiene una razón real para no pushear aislado) hasta que el Plan 3 los conecte.

#### Próximo paso exacto (histórico — Plan 3 hecho, ver Ronda 29)
1. [x] Escribir y ejecutar el Plan 3 (`TripAssignDialog` reconstruido sobre `RouteEditor`/`FleetAssignSection`/`ClientPicker` + aviso de reconciliación en modo TMS integrado) — hecho, ver Ronda 29.
2. [ ] Plan 4 (`TripSlideOver` reconstrucción estructural), Plan 5 (Indicadores + Bitácora), Plan 6 (`TripTable` solo lectura), Plan 7 (filtro `operation_type`) — en ese orden, cada uno escrito recién al momento de ejecutarlo.
3. [ ] Confirmar con el usuario el push conjunto de los Planes 1+2+3 (ver Ronda 29 — recién ahora quedaron efectivamente conectados).
4. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
5. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
6. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
7. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---

### 2026-07-19 (cont.) — Ronda 29: Fase 2 Plan 3 — TripAssignDialog reconstruido, cierra el bug original de la sesión

**Pedido del usuario**: "si, continua con el plan 3".

**Proceso**: `writing-plans` con research puntual (confirmar que `TripBulkUpload.tsx` no usa `TripCreatePayload.origin` — 0 referencias, seguro eliminarlo del tipo) + extracción del texto exacto de 2 decisiones del spec (aviso de reconciliación de destinos, retiro de región/ciudad de origen del form de creación). Plan guardado en `docs/superpowers/plans/2026-07-19-diario-fase2-trip-assign-dialog-plan.md`, ejecutado inline, 2 tareas.

**Tarea 1 — ajuste chico a un componente ya commiteado**: `FleetAssignSection` (Plan 2, Ronda 28) ganó un prop `notFoundHint?: React.ReactNode`, mostrado bajo la búsqueda cuando el query interno tiene ≥2 caracteres y no hay conductor elegido. Necesario porque el componente encapsula su propio estado de búsqueda — el padre ya no puede condicionar ese aviso por sí mismo como hacía el código viejo.

**Tarea 2 — reconstrucción completa de `TripAssignDialog.tsx`**: mismo diálogo centrado, mismo comportamiento driver-first-bloqueante de la Ronda 26, pero:
- `MANUAL_CLIENTS`/`OTHER_CLIENT` (dropdown hardcodeado de 4 clientes) → `ClientPicker` (directorio real de `public.shippers`, crea uno nuevo al vuelo).
- Origen (input suelto) + Destinos (lista separada, sin origen) → un solo `RouteEditor` bajo "Ruta", con el origen viviendo dentro de `stops[]` (mismo contrato que ya acepta el backend desde el Plan 1). **Esto cierra el bug original que abrió toda esta Fase 2**: conductor→empresa/vehículo ahora es un solo componente controlado (`FleetAssignSection`) en vez de 2 copias de estado (`pickedDriver` + campos sueltos) que podían desincronizarse — la patente ya no puede quedar sin sincronizar porque no hay 2 lugares donde viva.
- "Región / ciudad de origen" (`RegionCityPicker`) retirado del formulario de creación — decisión explícita del spec (no aplica al crear, `origin_region`/`origin_city` siguen existiendo como campos válidos para la carga CSV, fuera de alcance).
- Nuevo aviso ámbar junto al de reconciliación ya existente: cuando el origen es un TMS integrado, avisa que los destinos cargados pueden reemplazarse por lo que reporte la TMS (el origen se preserva siempre — mecanismo real del Plan 1, `is_manual_stop` + `post_hook`).
- `TripCreatePayload.origin` eliminado del tipo (`lib/types.ts`) — cierra el ciclo que el propio Plan 1 (backend) dejó abierto: el campo ya no existe en `TripCreateBody` desde ese plan, y ahora tampoco en el frontend.

**Verificación**: 423/423 frontend (era 420 antes de esta ronda), `tsc --noEmit` limpio. Sin verificación en navegador (mismo motivo de siempre).

**2 commits en `dev`** (`660bc93`, `6357c87`). **Con esto, los Planes 1+2+3 quedan efectivamente conectados** — es el primer punto de esta Fase 2 donde pushear tendría sentido real (el frontend ya manda el contrato nuevo que el backend espera desde el Plan 1). Sigue sin pushear, pendiente de confirmación explícita del usuario.

#### Próximo paso exacto
1. [ ] Confirmar con el usuario el push conjunto de los Planes 1+2+3 (`597a0f6`..`6357c87`) — primer momento real donde tiene sentido, ver nota de arriba.
2. [ ] Escribir y ejecutar el Plan 4 (`TripSlideOver` reconstrucción estructural — acordeones aplanados, reorden de columnas, `FleetAssignSection` reemplazando `CarrierAssignSection`, origen solo `operation_type`, EETT TMS retirado + banner de reconciliación extendido a `carrier_name_tms`, link a TMS colgando del chip, IDs unificados en el header, `RouteProgress` retirado).
3. [ ] Plan 5 (Indicadores + Bitácora), Plan 6 (`TripTable` solo lectura), Plan 7 (filtro `operation_type`) — en ese orden, cada uno escrito recién al momento de ejecutarlo.
4. [ ] (heredado) Confirmar push de `1e65a53` a `dev`.
5. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
6. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
7. [ ] (heredado) Verificación manual en navegador — sigue sin poder hacerse (sin credenciales de test).

---
