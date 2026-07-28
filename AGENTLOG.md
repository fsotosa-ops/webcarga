# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-27 — Ronda 46: auditoría en vivo (Playwright) vs. minuta consolidada + backlog 20/07

**Contexto**: el usuario pidió una auditoría real contra `webcarga-frontend-dev`, cruzando `monitor-app/docs/minuta_consolidado_20260720.md` (checklist §8 + tabla de pendientes §7) y el backlog de 17 HU + refinamiento v2 de `monitor-app/docs/user-stories/20260720/`, con evidencia en vivo (screenshots, consola, network) y acciones de escritura reversibles donde hiciera falta. Reporte completo publicado como Artifact (tabla `# | Ítem | Fuente | Estado | Evidencia | Bloqueante Hito 3`) — pedirle el link al usuario si se necesita retomar el detalle punto por punto, este resumen es solo lo accionable.

**De paso, esta ronda resolvió la verificación manual pendiente desde Ronda 44/45**: tab "Estados de Equipo" (6 semillas ✓), hint de motivo sugerido en `CloseDayDialog` (✓), rediseño de Tarifario (✓ paginación/búsqueda/"+ Nuevo local" arriba), tiles clickeables de `CloseDayDialog` (✓, incluye bloqueo real de "Cerrar día" con 69 no asignados pendientes) — los 4 puntos que quedaban con "cobertura solo de tests, sin click-through real" ya están confirmados en producción.

**Hallazgos de negocio (bloqueantes reales para Hito 3, ninguno es código complejo)**:
1. **Rangos de Temperatura vacíos** — `/dashboard/admin/configuracion` → tab correspondiente muestra "Sin rangos configurados". El CRUD funciona, es tarea de Pablo/WebCarga cargar Frío 2-5°C / Congelado -18/-22°C, no de desarrollo.
2. **Reporte diario automático por mail no existe** — confirmado que no hay SMTP/cron en ningún punto del backend, solo el dataset vía `daily-closures/report` + export CSV manual en Reportería. Es desarrollo real pendiente, sin empezar.
3. **RM/Zona Cero sigue sin ser un diccionario por comuna** — la clasificación que se ve en pantalla es un valor pre-cargado por local en la planilla del generador de carga (`public.locations.operation_type`), no una regla `comuna → zona` como pidió la reunión del 10/07. Confirmado en vivo: **262 locales "sin clasificar"** en el Tarifario hoy.
4. **Normalización de fecha QAnalytics↔WingSuite**: no hay lógica condicional por `source_system` en el backend (confirmado por grep). En cambio, comparando un viaje WingSuite/Colun real contra uno QAnalytics, el campo "Plan." por parada ya resuelve la ambigüedad de forma implícita (origen = plan de salida, destino = plan de llegada) — funciona en el caso verificado, pero es una solución distinta a la que pedía literalmente la minuta. Confirmar con el usuario si esto se da por bueno o si falta cerrar el diseño explícitamente.

**Hallazgos de calidad, no bloqueantes**:
- El fix de Ronda 42 ("Revisar en Empresas" clickeable) solo llegó a `CloseDayDialog.tsx` — los mismos textos dentro de `TripSlideOver.tsx` (detalle de viaje) siguen siendo texto plano sin `href` ni handler.
- Columna "Última actualización" de Empresas muestra "sin actualizar hace 10 días" en **todas** las filas visibles — la minuta dice sync cada ~24h, vale la pena confirmar si el pipeline de SharePoint sigue corriendo.
- Rutas legacy huérfanas `/dashboard/conductores/[id]` y `/dashboard/transportistas/[slug]` (schema `gold` vacío) siguen desplegadas — no crashean (manejan "no encontrado" con gracia) pero son código muerto.
- `/dashboard/operaciones` es un `redirect()` vacío sin contenido propio, no está en el nav.
- No se encontró ningún campo/columna "LSS" en ninguna pantalla — confirmar con el cliente a qué se refiere exactamente.

**Gap real encontrado y corregido en la misma sesión (no pedido, autorizado explícitamente por el usuario)**: al crear una póliza de prueba en Seguros para confirmar el fix del bug de creación de pólizas (refinamiento v2 #1 — confirmado arreglado, se creó sin error), se encontró que **no existía ningún botón de eliminar póliza en toda la UI**. Se agregó:
- Backend: `DELETE /api/v1/policies/{policy_id}` en `policies.py` — borra la póliza (cascada real vía FK `ON DELETE CASCADE` a cuotas/coberturas/activos, confirmado contra el schema real) y los archivos físicos en Storage si existen. 3 tests nuevos.
- Frontend: botón papelera en `InsurancePolicyModal.tsx`, gateado a `canAdmin`, con `window.confirm` (mismo patrón que `UsersTable.tsx`/`GroupBuilder.tsx`/`umbrales-tabs.tsx`, no un modal custom nuevo). 3 tests nuevos.
- Verificado: backend 324/324, frontend 525/525, `tsc` + `npm run build` limpios.
- La póliza de prueba (`TEST-AUDIT-0727`) se borró vía SQL directo en Supabase (`viclzoftiudkepqnhekv`) antes de que existiera el botón, verificando primero que no tenía cuotas/coberturas/activos dependientes.

---

### 2026-07-27 (cont.) — Ronda 47: feedback del usuario sobre el Artifact de Ronda 46 — 14 puntos, corregidos/ejecutados

**Contexto**: el usuario revisó el reporte de Ronda 46 y devolvió 14 puntos de feedback: 3 pedidos de fix directo, 1 pedido de re-verificar contra Mage+Supabase (no solo frontend), y 10 correcciones/matices al reporte (algunos porque mi lectura estaba mal, otros porque cambió el foco de negocio). Se procesó uno por uno, sin asumir ninguno como "menor".

**Fixes de código ejecutados y verificados** (backend 324/324, frontend 528/528, tsc + `npm run build` limpios en cada paso, commiteados y pusheados a `origin/dev` a pedido explícito del usuario):
1. **Rutas legacy huérfanas eliminadas** (`/dashboard/conductores/[id]`, `/dashboard/transportistas/[slug]`) — junto con `createGoldClient()` (`lib/supabase/client.ts`/`server.ts`) y los tipos `DiarioTrip`/`DiarioManualFields`/`DiarioRow`/`NormalizedStatus` en `lib/types.ts`, que solo esas 2 rutas consumían.
2. **Links "revisar en Seguros/Empresas" en `TripSlideOver.tsx`** — los 3 banners (póliza vencida/cuotas impagas, licencia de conducir faltante, empresa distinta conductor/viaje) ahora son `<a href>` reales a `/dashboard/transportistas/empresa/{carrier_id}?tab=seguros|conductores`, mismo patrón que ya usaba `CloseDayDialog.tsx`. Se agregó soporte de `?tab=` en `empresa/[id]/page.tsx`.
3. **Hipervínculo patente→TMS**: `TmsChip` en `TripTable.tsx` ahora es un link real (antes solo estaba en el detalle) — abre el login del TMS de origen y copia el ID externo del viaje al portapapeles en el mismo click. **No** es un deep-link autenticado a un viaje específico — se respetó la decisión de seguridad ya documentada en `lib/utils/tmsLinks.ts` (cuenta de scraping compartida sin trazabilidad por usuario; Sodimac usa evasión de Cloudflare no apta para sesión humana).

**Re-verificación contra Mage + Supabase (pedido explícito del usuario)** — usando `sync_project_to_local` (la API `pipeline_list` sigue devolviendo grafos incompletos) y `execute_sql` directo contra `viclzoftiudkepqnhekv`:
- **Hallazgo real: "Última actualización" de Empresas no medía lo que yo creía.** La columna lee `MAX(compliance_records.updated_at)` — cuándo se tocó un documento de compliance, no cuándo se sincronizó la empresa desde SharePoint. Mi hallazgo original ("sin actualizar hace 10 días") era una mala lectura de la UI, no un bug del producto.
- **Confirmado que el pipeline SÍ sigue corriendo**: `custom/load_carriers_02.sql` (bloque real que puebla `public.carriers`, invisible en `pipeline_list` pero presente en `metadata.yaml` sincronizado) hace upsert real. `bronze.raw_centralizer_vehicles` pasó de 119→121 filas — evidencia directa de datos frescos entrando. Nota menor sin resolver: `centralizer_eett_sharepoint` y `load_compliance_records_08` siguen con `status: failed` en el metadata sincronizado — no bloqueante, datos fluyen igual.

**Correcciones al reporte (Artifact)**: SSO Microsoft, modelo de fechas QAnalytics/WingSuite, y "Vista detalle rediseñada" pasan a **✓ OK**. Reporte diario automático por mail deja de listarse como bloqueante (ideal, no MVP). "Consultar a María Eugenia" pasa a ✓ (ya resuelto en la minuta §6.1). Bloqueantes reales de Hito 3 quedan en **2**: rangos de temperatura, RM/Zona Cero.

**Dirección de producto capturada, no implementada todavía**: `/dashboard/operaciones` debe convertirse en el hub real de Diario+Reportería. El gap de RM/Zona Cero es más amplio que "cargar un diccionario" — repensar `public.locations`/Tarifario de fondo.

---

### 2026-07-27 (cont.) — Ronda 48: umbrales de temperatura cargados, bug de cache corregido, Artifact reescrito a lenguaje de negocio

**Contexto**: el usuario devolvió 6 puntos: visión de negocio de Tarifario/`public.locations`, pedido de precargar los umbrales de temperatura y validar que las alertas realmente monitoreen, confirmación de que Pablo ya es owner, pedido de explicar 3 puntos del checklist, corrección de que el Artifact mezclaba contenido técnico con contenido de negocio, y pedido de push.

**Umbrales de temperatura cargados en producción vía la app** (flujo real de Configuración, rol Owner): Frío 2-5°C, Congelado -22 a -18°C, exactamente los valores que mencionó Pablo. Verificado contra `app.temperature_ranges` en Supabase.

**Bug real encontrado al validar "¿está monitoreando alertas?"**: un viaje CONGELADO con -22.06°C seguía mostrando el pill azul ("dentro de rango") varios minutos después de guardar los umbrales. Causa raíz: `GET /trips/meta` queda cacheado 5 minutos en Redis y ningún endpoint de escritura en `config.py`/`status_taxonomies.py` invalidaba esa cache — afecta a todo lo que Configuración expone ahí, no solo temperatura. Corregido: `invalidate_trips_meta_cache()` en `cache.py`, llamado desde los 9 endpoints de escritura relevantes. Backend 329/329. Commit `21a7f2e`, pusheado a `origin/dev`.

**Reescritura completa del Artifact**: se retiró toda la sección "Hallazgos" (bugs, nombres de archivo, commits, tests) y se reescribió sin jerga técnica — el reporte debe contener solo información explicable al usuario de negocio (Pablo/Fabián). Ese detalle vive en AGENTLOG y en la memoria del proyecto, no en el Artifact. Alertas de temperatura pasan a ✓ OK. RM/Zona Cero queda como el **único bloqueante real restante**, reencuadrado con contexto de negocio: `public.locations` es el diccionario compartido de locales/destinos; Tarifario debe centralizar la creación de locales nuevos y la gestión de tarifas; el desafío es robustecer ese módulo completo, no solo cargar un diccionario — "no estamos muy lejos de eso".

---

### 2026-07-27 (cont.) — Ronda 49: brainstorming + plan + implementación completa de "robustecer Tarifario"

**Contexto**: el usuario pidió un plan para robustecer Tarifario. Sesión completa vía `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` (modo inline, pedido explícito).

**Hallazgo clave del brainstorming que cambió el enfoque**: la minuta pedía un diccionario comuna→zona construido a mano. Investigado antes de proponer nada: cada parada de un viaje ya trae `app.trip_stops.destination_region` (número de región real, reportado por el TMS). De los 262 locales sin clasificar, **240 ya tenían región disponible en su historial de viajes** — nunca se había propagado a `public.locations`. Se descartó construir un diccionario de ~346 comunas y se usó la región que el TMS ya reporta como fuente automática, dejando elección manual solo para el residual real (22 locales sin ningún viaje histórico).

**Spec**: `docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md`. Mapeo de regiones confirmado por el usuario en la misma sesión: RM=región 13, Zona Cero=regiones 5/6/7, Región Norte=1/2/3/4/15, Región Sur=8/9/10/11/12/14/16 (coincidió exacto con lo que ya proponía el spec).

**Plan**: `docs/superpowers/plans/2026-07-27-tarifario-robustecimiento-plan.md` (8 tareas TDD). Ejecutado completo en modo inline:
1. **Migración** (`20260727100000_locations_auto_classification.sql`): `app.classify_operation_type()`, backfill, trigger de auto-registro extendido (clasifica locales nuevos de una, completa los existentes sin pisar `is_manual_override=true`). Aplicada contra `viclzoftiudkepqnhekv` — **verificado en vivo: 262 → 22 sin clasificar**, exacto a lo previsto en el spec.
2. **Backend** (`locations.py`): filtro `needs_manual_classification` (el residual real, subconjunto de `incomplete`), `PATCH` con `operation_type` explícito marca `is_manual_override`/`overridden_by`/`overridden_at`. 3 tests nuevos, backend 332/332.
3. **Frontend — tipos/cliente**: `Location.is_manual_override`, `locationsApi.list({ needs_manual_classification })`.
4. **`LocationsTable.tsx`** (nuevo, extraído de `page.tsx`): tabla completa sin cambio de comportamiento, suma tag "auto" junto a la clasificación cuando no fue manual. 6 tests.
5. **`LocationCreateForm.tsx`**: el selector de generador de carga se mueve adentro del formulario (antes vivía afuera, gateado por la página) — "+ Nuevo local" queda visible siempre. 7 tests.
6. **`LocationsPendingTab.tsx`** (nuevo): tarjetas de triage solo para el residual sin señal de región — nada de tabla de 10 columnas. 3 tests.
7. **`TarifarioPage` reescrita**: tabs "Por revisar" (default, sin gate)/"Todos los locales" (generador de carga como filtro opcional, no obligatorio). 4 tests.

**Verificación final**: backend 332/332, frontend 534/534, `tsc` y `npm run build` limpios en cada tarea. Todos los commits en `dev` (locales, sin push todavía — pendiente decisión del usuario, ver checklist).

**Nota de proceso**: durante la ejecución hubo 2 tropiezos propios sin impacto en el resultado — corrí `vitest` desde el directorio equivocado dos veces (error "document is not defined", no un bug real) y el spec inicial decía por error que había que agregar la columna `region_number` (ya existía desde la migración original, solo faltaba poblarla) — corregido en el spec antes de escribir el plan.

#### Próximo paso exacto
1. [ ] **Decidir con el usuario si se commitea el push de esta ronda** (Ronda 49 — migración + backend + frontend de Tarifario, todo en `dev` local) y hacer la verificación en navegador contra `webcarga-frontend-dev` una vez desplegado (pendiente: tabs sin gate, tag "auto", triage de los 22 residuales, "+ Nuevo local" sin filtro previo).
2. [ ] Confirmar con el cliente a qué campo se refiere "LSS" — único punto sin resolver de los 10 criterios duros de Hito 3, ahora que RM/Zona Cero y temperatura ya cerraron.
3. [ ] Diseñar el rediseño de `/dashboard/operaciones` como hub de Diario+Reportería (dirección de producto confirmada en Ronda 47, sin spec todavía).
4. [ ] Diseñar (spec nuevo) `app.equipment_day_status` — desbloquea el rediseño real de Reportería (3 formatos fijos).
5. [ ] Borrar a mano en la UI de Mage el bloque `wingsuite_has_new_data` (desconectado).
6. [ ] Revisar en la UI de Mage por qué `centralizer_eett_sharepoint`/`load_compliance_records_08` siguen en `status: failed` (no bloqueante, datos fluyen igual).
7. [ ] Tarea 9 de status_taxonomies (DROP tablas legacy) — diferida, gated por tiempo en producción + confirmación explícita del usuario.
8. [ ] Ítem 1b — pendiente de que el usuario confirme el rol de los usuarios que no pueden subir documentación.
9. [ ] (no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run.
10. [ ] (no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
11. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
12. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
13. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
14. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
