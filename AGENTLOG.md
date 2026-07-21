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

#### Próximo paso exacto
1. [ ] Verificar (vía el wakeup programado) si el pipeline volvió a ingestar datos tras reactivar el trigger — si no, revisar la corrida en la UI de Mage.
2. [ ] Confirmar con el usuario si Vercel sigue siendo un deploy target real o si `CLAUDE.md` debe actualizarse a Cloud Run como fuente de verdad.
3. [ ] Terminar Fase 0: export en bloque de documentos (zip), política de tamaño/compresión de archivos.
4. [ ] Fase 1 (cuadratura diaria): diseñar e implementar `app.driver_day_status` + `app.daily_closures`, con override auditado vía `audit_log` — preguntar al usuario el mecanismo de HU-04/05 (auto-crear vs. solo alertar) antes de construir esa parte.
5. [ ] Fases 1.5 → 5 del plan (reporte por cliente, Seguros↔Diario, fuzzy match HU-06, locales+sync Mage, tarifario) — sin empezar.
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
9. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
