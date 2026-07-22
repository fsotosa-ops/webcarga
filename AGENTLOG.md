# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-22 (cont.) — Ronda 42: feedback post-weekly v2 (8 ítems) — Fase A + Fase B, cerradas con 3 fixes adicionales

**Contexto**: con el roadmap de refinamiento de las 17 HU cerrado (Ronda 41), el usuario compartió feedback real de uso en producción — `monitor-app/docs/user-stories/20260720/refinamiento-weekly-20260720-v2.md`, 8 ítems agregados incrementalmente por el usuario en la propia sesión. Cada ítem se investigó en el código real (no se adivinó ningún fix) antes de proponer solución; 4 mockups de Figma (`NW7aAqbiCxML2HLd8uMTzf`) y una re-lectura de `transcript-meeting.md`/`notes-meeting.md` (vía fork) informaron el diagnóstico de varios ítems.

Spec: `docs/superpowers/specs/2026-07-22-post-weekly-refinamiento-v2-design.md`. Plan: `docs/superpowers/plans/2026-07-22-post-weekly-refinamiento-v2-plan.md` (6 tareas, Fases A/B/C).

**Hallazgo clave que cambió el alcance del ítem 5**: el usuario pidió invertir el modelo a "el vehículo es la entidad, no el conductor" citando los transcripts. La re-investigación (fork dedicado) encontró que Pablo **nunca asentó eso** — lo exploró como opción (drivers rotan de camión) y se retractó en la misma conversación ("en estricto rigor, el que manda es el conductor"). Lo firme: conductor+tracto como **par** validado bajo la misma empresa, y el término real **"Equipo OVNI"** (nunca usado en la app) para un par sin cruce. Se presentó este hallazgo al usuario antes de codear — confirmó proceder con el alcance corregido (consolidación + terminología, no inversión de modelo).

**Fase A — 4 fixes iniciales + 3 fixes de seguimiento, todos verificados contra el problema real** (commits `26513b0`, `b37ae49`, `feca604`, `3c6d2d6`, y luego `26513b0`→`ee714b3`, `feca604`→`63cfc81`, `b37ae49`→`aa73f90`; todos pusheados):
1. **Seguros — crear póliza fallaba**: primer fix (`26513b0`) agregó `try/catch` a `handleAddPolicy` en `InsurancePolicyModal.tsx` (no lo tenía, a diferencia de `handleGenerateSchedule`). Con el error ya visible, apareció un **500 real** en producción — root cause encontrado en logs de Cloud Run (`webcarga-monitor-api-dev`): `create_carrier_policy` pasaba un `uuid.UUID` crudo de asyncpg a `log_change()`, que hace `json.dumps()` sin `str()` — único call site del proyecto con ese patrón. Corregido en `ee714b3`, con test que reproduce el bug exacto (el test viejo usaba un string, nunca lo disparaba).
2. **Badges de compliance sin identificar entidad**: primer fix (`b37ae49`) agregó prefijo de 1 letra (`C2`/`T7`/`E11`). El usuario preguntó directamente qué significaba — la ambigüedad no era "a quién" (ya se resuelve por posición) sino "qué es el número". Corregido en `aa73f90`: ícono de documento + número, sin convención de letras que memorizar.
3. **Columnas fijas del Diario**: primer fix (`feca604`) agregó sombra/gradiente en los bordes. Root cause real encontrado después: Estado y el chevron eran 2 columnas `sticky` separadas con offset fijo en px (`right-[90px]`/`right-0`) sobre una tabla `table-layout: auto` — el ancho real podía desalinearse. Corregido en `63cfc81` fusionando ambas en una sola columna sticky en el **header** — **el fix quedó incompleto: el `<tbody>` nunca se actualizó** (ver Ronda 43 abajo, Hallazgo E).
4. **"Revisar en Empresas" no interactivo**: era texto estático en `CloseDayDialog.tsx` — ahora es un link real a `/dashboard/transportistas/empresa/{carrier_id}` (`3c6d2d6`, backend ya resolvía `carrier_id` en `_DETAIL_SQL` pero no lo seleccionaba). Sin seguimiento posterior.

**Fase B — consolidación + terminología** (commits `f7ed75d`, `752d284`, `3c434b4`, ya pusheados) — la más delicada de esta ronda, verificada exhaustivamente contra datos reales antes y después de aplicar:
- **`app.v_trip_fleet_resolution`** (migración `20260722030000`): consolida la cadena de resolución driver/tracto/carrier (stored → auto por patente → auto por `vehicle_driver_assignments` → match exacto de nombre), duplicada hasta ahora en 4 lugares — la duplicación fue la causa raíz del bug de Ronda 38. Confirmado con `EXPLAIN` que el planner la inlinea (cero costo de performance) antes de aplicar.
- **Impacto real medido** (2026-07-21): `available_drivers` pasó de 79/79 (100%, bug prácticamente total) a 68/79 tras la vista.
- **"Equipo OVNI"** adoptado como label visible en `TripSlideOver.tsx` para `fleet_match_status === 'UNMATCHED'`. **Solo el label — ver Ronda 43, Hallazgo F: la detección y la terminología están, pero falta la superficie (no aparece en la cuadratura) y la resolución (sigue siendo 100% manual, sin datos del TMS pre-cargados).** (Corrección posterior en Ronda 43: el label pasó a ser "Sin identificar" — "Equipo OVNI" no es nomenclatura de producto ni estándar de industria, fue la forma coloquial en que Pablo lo explicó en la reunión.)

Verificación en cada tarea: backend 306→308 tests, frontend 497→500 tests, `tsc`/`build` limpios.

**Explícitamente fuera de esta ronda** (documentado en la spec, no es deuda silenciosa):
- **Ítem 1b** (subida de documentos en Seguros) — dos hipótesis reales (RBAC vs. mensaje de error del límite de 7MB poco visible), bloqueado en una pregunta al usuario: ¿qué rol tienen los usuarios afectados?
- **Ítem 6** (Reportería según mockups de Figma) — su propio brainstorming, tamaño de cambio distinto.

---

### 2026-07-22 — Ronda 43: auditoría de pendientes vs. `user-stories/20260720/` + hallazgos nuevos

**Contexto**: el usuario pidió una auditoría — qué queda pendiente del plan de Ronda 42 y qué inconsistencias hay entre el material de `monitor-app/docs/user-stories/20260720/` (2 refinamientos, backlog de 17 HU, transcript + notas de la reunión con Pablo, 3 reportes de referencia, 3 capturas de bugs) y lo realmente desarrollado. Se cruzó todo contra `git log` real, no solo contra lo que decía este archivo.

**Hallazgos**:
1. Este archivo había quedado un paso atrás de 3 commits reales ya hechos y pusheados (`ee714b3`, `63cfc81`, `aa73f90` — ver Ronda 42 arriba, ya integrados en el relato). `dev` estaba al día con `origin/dev` — el push de Fase B ya no era una acción pendiente.
2. `bug-date-wingsuite.png` en la carpeta 20260720 es una captura reciclada del 3 de julio (bug de timezone ya resuelto tres veces — ver `AGENTLOG_ARCHIVE.md`), no un bug nuevo. El usuario redirigió: el bug real a revisar es la inestabilidad del scroll horizontal del Diario (ver Hallazgo E).
3. El ítem 6 (Reportería) es un **rediseño** de una página que ya existe (`reporteria/page.tsx`, pivot genérico desde Ronda 41), no una construcción desde cero — el feedback pide reemplazarlo/extenderlo con los 3 formatos fijos de los reportes reales de Pablo (Sider Botelleros, Sodimac, Walmart/Spot — ver capturas `reporte-1/2/3-cierre-diario.png`) más los 4 mockups de Figma.
4. **Hallazgo E — bug de columnas confirmado y con causa raíz real**: `TripTable.tsx`, el `<thead>` fusionó Estado+chevron en un solo `<th>` sticky (`63cfc81`) pero el `<tbody>` sigue con 2 `<td>` separados (`right-[90px]` y `right-0`, líneas 460/483) — mismatch real de conteo de columnas entre header y body. El usuario pidió además un criterio de diseño más simple: sin sticky del lado derecho, solo `Patente` (columna izquierda) queda fija.
5. **Hallazgo F — "Equipo OVNI" quedó parcial**: la detección (`fleet_match_status = UNMATCHED`) y el término visible existen, pero (a) no aparece en ningún tile/KPI de la cuadratura — confirmado que no está en `alertSignals.ts` ni `kpis.ts`, solo como banner pasivo dentro del detalle de un viaje — y (b) no hay ninguna acción de resolución guiada (crear empresa/conductor/tracto con datos del TMS pre-cargados); el propio código admite "la resolución sigue siendo manual". Esto es el corazón del pedido original de Pablo (transcript, línea 605).

El usuario aprobó incluir el fix de Hallazgo E y F en el alcance de ejecución inmediata, junto con Fase C (Tarifario) e Ítem 6 (Reportería). Plan completo: `~/.claude/plans/necesito-que-veas-que-silly-octopus.md`.

**Corrección de terminología (durante la ejecución)**: el usuario cuestionó "Equipo OVNI" como copy real de producto — es la forma coloquial en que Pablo explicó la idea en la reunión (transcript línea 605), no un término de producto ni nomenclatura estándar de industria/logtech. Reemplazado por **"Sin identificar"** en todo lo visible (banner de `TripSlideOver.tsx`, label del KPI en `alertSignals.ts`, tests). El id interno (`fleet_unmatched`) no cambia — solo el copy.

**Ejecución de los 3 primeros puntos, completa** (commits `1019f33`, `c37f471`, `afa52a0`, `af73bb8`, ya en `dev`):
1. **Hallazgo E (bug de columnas)**: `TripTable.tsx` — se retiró el sticky del lado derecho por completo (Estado+chevron vuelven a ser una columna normal fusionada, ya no 2 `<td>` desalineados con el header). Solo `Patente` (izquierda) queda fija. `TripTable.test.tsx` actualizado.
2. **Hallazgo F ("Sin identificar")**: nuevo KPI `fleet_unmatched` en `kpis.ts`/`alertSignals.ts` — cuenta y filtra como el resto de las alertas del Diario, ya no solo un banner pasivo. Flujo de alta guiado real: el link desde `TripSlideOver.tsx` pre-carga razón social/conductor/patente ya reportados por el TMS (`carrier_name_tms`/`driver_name_tms`/`tractor_plate_tms`) directo en el formulario de alta de Empresas (`?create=1&business_name=…`), y reenvía conductor/patente a la ficha de la empresa recién creada para pre-cargar también "+ Conductor"/"+ Equipo" ahí — sin re-tipear nada. Investigado antes de codear: en UNMATCHED no hay ninguna empresa resuelta (ni conductor ni tracto), así que el punto de partida real es crear la empresa, no buscar (la búsqueda de Empresas filtra por razón social/tax_id, no por nombre de conductor).
3. **Fase C (Tareas 7-8)**: `TarifarioPage` rediseñada tipo SaaS — paginación de servidor (verificado antes: 566 locales en el generador de carga con más volumen, no "decenas"), búsqueda `?q=`, botón de creación en el header, densidad/hover al estilo `TripTable`. Absorbe por completo los campos de la ex-pestaña Locales de Configuración (Formato/Dirección/Región/Clasificación/Activo, filtro "Solo sin clasificar" HU-16) — `locales-tab.tsx` borrado, tab retirado de Configuración.

Verificación en cada tarea: backend 308→311 tests, frontend 505→514 tests, `tsc`/`vitest`/`build` limpios (frontend y backend).

#### Próximo paso exacto
1. [ ] Ítem 6 (Reportería) — requiere traer primero el contenido real de los 4 mockups de Figma (`NW7aAqbiCxML2HLd8uMTzf`, nodos `19-17067`/`24-18435`/`25-9068`/`35-15699`) antes de decidir si `reporteria/page.tsx` (pivot genérico, Ronda 41) se reemplaza por presets fijos (Sider Botelleros/Sodimac/Walmart-Spot, ver `reporte-1/2/3-cierre-diario.png`) o los mantiene como modo avanzado. Es su propio brainstorming (`superpowers:brainstorming` o Plan agent dedicado) — no ejecutar a ciegas.
2. [ ] Ítem 1b — pendiente de que el usuario confirme el rol de los usuarios que no pueden subir documentación.
3. [ ] (no bloqueante) Confirmar con el usuario si `bug-date-wingsuite.png` refleja una regresión real vista hoy en producción, o si fue un archivo reciclado sin intención — quedó sin resolver, el usuario redirigió la conversación hacia el bug de columnas (Hallazgo E, ya cerrado).
4. [ ] (no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run — siguen describiendo el flujo viejo de Vercel.
5. [ ] (no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
6. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
7. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
8. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
9. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
