# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-21 — Ronda 34: análisis del backlog de 17 HU (weekly + reunión real de Pablo/Fabián/Felipe) + Fase 0 del roadmap + 2 bugs de producción encontrados y corregidos

**Pedido del usuario**: analizar el alcance/refinamiento de las 17 HU en `monitor-app/docs/user-stories/20260720/` contra el modelo de datos y pipelines ya construidos, para un roadmap que priorice mantenibilidad/trazabilidad/escalabilidad. A mitad de camino, el usuario aportó la reunión real (`notes-meeting.md`/`transcript-meeting.md`, Pablo CEO + Fabián + Felipe) y 3 reportes de cierre diario hoy armados 100% a mano en Excel — esto amplió sustancialmente el alcance real de la Épica 1 ("cuadrar la caja") respecto del backlog escrito.

**Plan aprobado**: `/Users/usuario/.claude/plans/necesito-que-en-base-velvet-flamingo.md`. Mapea las 17 HU contra lo ya construido (mucho de Épica 3/4/5 ya resuelto por el hardening de julio; Épica 1 casi toda nueva), evalúa críticamente los 3 riesgos transversales del refinamiento previo (deadlock operativo → adoptar con `audit_log` existente, no un esquema nuevo; data drift → rechazar bitemporalidad genérica, `trip_fleet_links` ya es snapshot de facto; garbage-in del TMS → flags locales por dominio, no un módulo de cuarentena polimórfico), y deja abierto el diseño de `driver_day_status`/`daily_closures` para la Fase 1 (cuadratura diaria real, con "en el aire"/mismatch como estados de primera clase).

**Fase 0 ejecutada y verificada** (commits `597d2cb`, `45913a8` en `dev`):
- **HU-10** (bug real confirmado por Fabián en la reunión): `GET /compliance-records/{id}/files` omitía la versión vigente cuando un documento nunca fue reemplazado — `get_document_history()` ahora antepone el estado actual (`is_current`).
- **HU-04**: `fleet_match_status` (MATCHED/UNMATCHED/MISMATCH) nuevo en la query principal de `GET /trips`, filtrable (`?fleet_match=`). Verificado contra datos reales: 2624 MATCHED, **86 MISMATCH** (conductor y tracto calzan cada uno por su lado pero bajo empresas distintas — señal real, no ruido), 24 UNMATCHED. Banner en `TripSlideOver` para el caso MISMATCH. **Decisión de mecanismo para HU-04/05 pendiente de preguntar al usuario cuando se implemente** (Pablo dejó 2 opciones abiertas en la reunión: auto-crear vs. solo alertar).
- **HU-08**: `GET /compliance-records/pending-summary` — agrega documentos pendientes cruzando CARRIER/DRIVER/ASSET por empresa (antes solo existía el conteo dentro de la ficha de cada empresa).
- **HU-07**: tests explícitos de que transferir conductor/tracto entre empresas nunca toca `trip_fleet_links` (ya era así por diseño).
- **HU-14**: reordenadas/renombradas las columnas de fecha del detalle de viaje (Plan. → GPS Llegada/Salida → Llegada/Salida TR) según lo acordado con Fabián — el orden anterior ponía GPS después del campo híbrido. Los datos ya eran correctos (verificado: 0 filas con `gps_departure_date = planning_date` en 7240 paradas); era el frontend.
- Verificación: 255/255 backend, 445/445 frontend, `tsc`/`build` limpios en cada paso.

**Queda de la Fase 0, sin empezar**: export en bloque de documentos (zip, pedido por Fabián en la reunión), política de tamaño/compresión de archivos subidos.

**2 bugs de producción encontrados y corregidos en el camino** (reportados por el usuario mientras se trabajaba la Fase 0), commit `4e8331d`:
1. **308 Permanent Redirect en el Diario**: `lib/api/trips.ts` armaba `` `/api/v1/trips/${suffix}` `` (slash de más antes del query string) → con cualquier filtro quedaba `/api/v1/trips/?fecha=...` → Next.js (`trailingSlash: false`) devolvía 308 antes de que el proxy catch-all llegara a ejecutarse. Confirmado con `gcloud logging read` contra `webcarga-frontend-dev` (proyecto real: `webcarga-dev-493220`, no `sumados-data` — el CLI estaba en otro proyecto). El Diario nunca cargaba viajes filtrados en producción. Corregido + 3 tests nuevos (`lib/api/trips.test.ts`, primer test de este tipo en el proyecto).
2. **`SUPABASE_SERVICE_ROLE_KEY` no montada en el frontend de Cloud Run**: `deploy-frontend.yml` nunca la incluía en `--set-secrets` (sí estaba en `deploy-monitor-api.yml`) — `lib/actions/users.ts` (crear/eliminar usuarios) fallaba siempre ahí. Corregido reusando el secret ya existente `monitor-api-supabase-service-role-key` (no se duplicó). Grant de IAM (`secretAccessor` para `webcarga-frontend-sa`) aplicado en vivo contra el proyecto real y agregado a `scripts/infra-init.sh` para que quede idempotente a futuro. Verificado: nueva revisión de `webcarga-frontend-dev` ya expone el secret; el endpoint de trips con filtros ya no da 308.

**Hallazgo de infra, no resuelto todavía**: el frontend se despliega en **dos lugares** — Cloud Run (`webcarga-frontend-{dev,prod}`, vía `.github/workflows/deploy-frontend.yml`, confirmado el real/vigente) y lo que dice `CLAUDE.md` (Vercel) — probablemente documentación desactualizada de antes de una migración a Cloud Run. El nombre del workflow en GitHub (`gh workflow list`) sigue mostrando "Deploy Frontend to Vercel" por cacheo de GitHub, aunque el archivo real (`name: Deploy Frontend`) y sus pasos son 100% Cloud Run. **No se confirmó si Vercel sigue activo/es el dominio real que usan los usuarios** — solo se investigó lo suficiente para resolver el 308 reportado, que sí era contra Cloud Run.

**Pipeline de ingesta diagnosticado como pausado (no un bug de código)**: `app.trips`/`bronze.tms_trips_snapshot` sin datos nuevos desde 2026-07-18 07:23 UTC (~sábado) — coincide con el trigger recurrente (~15 min) de `batch_tms_monitor_trips` que quedó pausado durante las sesiones de hardening de la semana pasada y nadie reanudó. El usuario lo reactivó en la UI de Mage durante esta sesión — **verificación de que volvió a fluir programada para más tarde en esta misma sesión** (`ScheduleWakeup`, ~15 min), ver checklist.

**Nota de proceso**: `gcloud` en esta sesión requirió cambiar de proyecto activo (`sumados-data` → `webcarga-dev-493220`, vía `--project=` explícito) — el proyecto real de webcarga NO es el default de la cuenta. Sirvió `gcloud projects list` para encontrarlo. Igual con `mage-agent`, ver `reference_mage_agent_cluster_config` — dos sistemas separados con el mismo síntoma ("conectado a otra cosa por default").

**Rediseño de roles/permisos**: el usuario mencionó que es momento de separar ambientes/vistas por rol — anotado como tema real pero de alcance grande, no iniciado, requiere su propia conversación de diseño.

#### Próximo paso exacto (histórico — ver Ronda 35, Fase 0 cerrada y Fase 1 completa)
1. [x] Verificar si el pipeline volvió a ingestar datos tras reactivar el trigger — ver Ronda 35.
2. [ ] Confirmar con el usuario si Vercel sigue siendo un deploy target real o si `CLAUDE.md` debe actualizarse a Cloud Run como fuente de verdad.
3. [x] Terminar Fase 0 — hecho, ver Ronda 35.
4. [x] Fase 1 (cuadratura diaria) — hecha, ver Ronda 35.
5. [ ] Fases 1.5 → 5 del plan (reporte por cliente, Seguros↔Diario, fuzzy match HU-06, locales+sync Mage, tarifario) — sin empezar.
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
9. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.

---

### 2026-07-21 (cont.) — Ronda 35: cierre de Fase 0 + Fase 1 completa (cuadratura diaria de conductores)

**Fase 0, últimos 2 ítems** (commit `82d316f`): export en bloque de documentos de una empresa (`GET /carriers/{id}/documents/export`, zip in-memory, botón "Exportar todo" en la ficha) — pedido de Fabián en la reunión; límite de archivo bajado de 10MB a 7MB (pedido de Pablo, obligar a comprimir). Verificado HU-09/HU-11 ya cubiertas por la UI existente (`TransporterAlertBanner`/`mandatoryProblems` ya filtran por `LEGAL_MANDATORY`; `/dashboard/seguros` ya tiene tabs Vencidas/Por vencer/Al día) — no requirieron cambios.

**Decisión confirmada por el usuario para HU-04/05**: solo alertar, resolución manual — sin auto-creación de conductor/tracto/empresa cuando no cruza. Coordinador busca/asigna empresa existente o crea a mano.

**Fase 1 completa — cuadratura diaria** (commit `ded4ba4`), implementa "cuadrar la caja" (HU-01/02/03):
- Migración `app.driver_day_status` (grano conductor×día: ASSIGNED/UNASSIGNED/MISMATCH) + `app.daily_closures` (snapshot de cierre) — aplicada y verificada en vivo contra Supabase (2026-07-18: 3 ASIGNADOS, 76 NO ASIGNADOS, coherente con el roster real).
- `GET/PATCH/POST /daily-closures` (`daily_closures.py`) — recompute en vivo sin watermark incremental (mismo criterio que `available_drivers`), captura de motivo (HU-02), bloqueo de cierre real con override admin+comentario obligatorio vía `audit_log` (HU-03) — sin esquema de excepciones nuevo.
- Frontend: `/dashboard/diario/cuadratura` (tiles clickeables + tabla + selector de motivo + botón de cierre con flujo de override).
- **Nomenclatura corregida a pedido del usuario**: el router/schema/tests se llamaban `cuadratura.py`/`/cuadratura` — rompía con la convención en inglés del resto del backend (`trips.py`→`/trips`, `compliance.py`→`/compliance-records`). Renombrado a `daily_closures.py`/`/daily-closures` antes de comitear.
- **Sidebar reestructurado a pedido del usuario**: en vez de sumar "Cuadratura" como 4º item plano, se agrupó con Diario bajo un item expandible "Monitor de Viajes" (con Empresas/Seguros quedando planos) — deja lugar para el futuro reporte por cliente de Fase 1.5 sin seguir apilando items sueltos.
- Verificación: 276/276 backend, 453/453 frontend, `tsc`/`build` limpios.

**Pipeline confirmado en vivo (ver Ronda 36)**: volvió a fluir de punta a punta tras la reactivación del usuario.

#### Próximo paso exacto (histórico — ver Ronda 36)
1. [x] Confirmar si el pipeline volvió a ingestar datos — confirmado, ver Ronda 36.
2. [x] Fase 1.5 — hecha, ver Ronda 36.
3. [ ] Fase 2 (Seguros↔Diario, badge/banner de póliza crítica en el Diario) — sin empezar.
4. [ ] Fase 3 (HU-05 gatillo desde alerta + HU-06 fuzzy match, diseño ya aprobado por Pablo: ~80% similitud + confirmación humana) — sin empezar.
5. [ ] Fase 4 (locales + sync recurrente Mage `bronze.raw_shipper_locations → public.locations`) — sin empezar, requiere tocar Mage.
6. [ ] Fase 5 (tarifario, módulo nuevo "Tarifario 1.0" separado en el menú) — sin empezar.
7. [ ] Confirmar con el usuario si Vercel sigue siendo un deploy target real o si `CLAUDE.md` debe actualizarse a Cloud Run como fuente de verdad (heredado, Ronda 34).

---

### 2026-07-21 (cont.) — Ronda 36: pipeline confirmado en vivo + Fase 1.5 (cuadratura por empresa/cliente + export CSV)

**Pipeline verificado tras la reactivación del usuario**: `bronze.tms_trips_snapshot` avanzó de `2026-07-18 07:23 UTC` → `2026-07-21 21:32 UTC`; `app.trips` con `planning_date` hasta `2026-07-22`. Confirmado fluyendo de punta a punta, no solo en la capa cruda.

**Fase 1.5 completa** (commit `43790be`): sobre `driver_day_status`, agrega `client_names` por conductor/día (`trip_fleet_links` → `trips` → `public.shippers`, mismo criterio de nombre prolijo que `trips.py`) y una vista "Por empresa"/"Por cliente" con conteos asignado/no asignado/mismatch — el denominador común de los 3 reportes manuales (Sider/Lansa, Sodimac, Walmart). Deliberadamente **no** se replican las categorías propias de cada cliente (ej. "Equipo Completo"/"Z0" de Walmart) — vocabulario específico no modelado, la unificación total queda iterativa (palabras de Pablo: "hay que ver cómo lo armamos"). Export CSV de la vista activa agregado.

Verificación: 277/277 backend, 456/456 frontend, `tsc`/`build` limpios. Query de `client_names` verificada contra datos reales antes de codear.

#### Próximo paso exacto (histórico — ver Ronda 37, rediseño de Cuadratura)
1. [x] Fase 2/3/4/5 siguen sin empezar — ver Ronda 37 para el rediseño intermedio de Cuadratura que las precede.
2. [ ] Confirmar con el usuario si Vercel sigue siendo un deploy target real o si `CLAUDE.md` debe actualizarse a Cloud Run como fuente de verdad (heredado, Ronda 34).
3. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
4. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
5. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
6. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.

---

### 2026-07-21 (cont.) — Ronda 37: rediseño de Cuadratura — "Cerrar el día" (overlay en el Diario) + Reportería (tabla dinámica)

**Pedido del usuario**: rechazó la página de Cuadratura (Fase 1/1.5) — *"no me cierra que la cuadratura funcione así... ese dropdown no me dice nada y la UI es horrible"*. Pidió pensar UX/arquitectura antes de tocar código (pros/contras, estándar de industria, mantenibilidad).

**Brainstorming** (skill `superpowers:brainstorming`, spec aprobada en `docs/superpowers/specs/2026-07-21-cuadratura-reporteria-redesign-design.md`, gitignored): se identificaron 2 necesidades mezcladas en una sola pantalla — una acción operativa rápida (cerrar el día) vs. una vista analítica/BI (ver el global en el tiempo). Decisiones confirmadas por el usuario:
- **"Cerrar el día"**: overlay dentro del Diario (no página aparte), hereda la fecha activa ahí.
- **Reportería**: página nueva y separada, hermana de Diario en "Monitor de Viajes", con pivot **real** (filas/columnas/filtros configurables, no un dropdown de 3 opciones fijas) — incluye granularidad de fecha (Día/Semana/Mes/Trimestre/Semestre) y presets de período, a pedido del usuario.
- **Build vs. librería de pivot**: componente propio y liviano, no una librería externa (`react-pivottable` está poco mantenida y su estilo no calza con Tailwind sin pelear CSS — mismo tipo de fricción ya rechazada).

**Implementado** (commit `ea88732`):
- Eliminada `/dashboard/diario/cuadratura` completa.
- `CloseDayDialog.tsx` — diálogo centrado (mismo patrón que Empresas), reusa `daily_closures.py` sin cambios de backend. Botón "Cerrar día" agregado al header del Diario.
- `lib/utils/pivot.ts` — motor de pivot propio: `bucketDate` (con quarter/semester correctos), `fieldValues` (multi-valor para Cliente), `buildPivot` (claves compuestas, cartesian product). 17 tests unitarios puros.
- `/dashboard/diario/reporteria` — página nueva con constructor de Filas/Columnas/Filtros (chips + selects, sin drag-and-drop) + presets de período + export CSV.
- Backend: `GET /daily-closures/report?fecha_desde=&fecha_hasta=` — dataset plano por rango, **sin recompute** (solo lectura sobre lo ya calculado al cerrar cada día).
- Sidebar: "Cuadratura" → "Reportería" dentro de "Monitor de Viajes".

**Gaps conocidos, documentados en la spec, no bloquean**: categorías de tipo de equipo específicas de Walmart (Equipo Completo/Tracto-Región/Z0/Se retira sin carga) y zona/región de destino como campo de pivot — ninguna modelada hoy, quedan para cuando se defina con el usuario.

Verificación: 281/281 backend, 475/475 frontend, `tsc`/`build` limpios.

#### Próximo paso exacto
1. [ ] Fase 2 (Seguros↔Diario, badge/banner de póliza crítica en el Diario) — sin empezar.
2. [ ] Fase 3 (HU-05 gatillo desde alerta + HU-06 fuzzy match, diseño ya aprobado por Pablo: ~80% similitud + confirmación humana) — sin empezar.
3. [ ] Fase 4 (locales + sync recurrente Mage `bronze.raw_shipper_locations → public.locations`) — sin empezar, requiere tocar Mage.
4. [ ] Fase 5 (tarifario, módulo nuevo "Tarifario 1.0" separado en el menú) — sin empezar.
5. [ ] Confirmar con el usuario si Vercel sigue siendo un deploy target real o si `CLAUDE.md` debe actualizarse a Cloud Run como fuente de verdad (heredado, Ronda 34).
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
9. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
