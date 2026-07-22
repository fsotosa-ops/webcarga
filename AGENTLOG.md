# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-22 (cont.) — Ronda 42: feedback post-weekly v2 (8 ítems) — Fase A + Fase B completas

**Contexto**: con el roadmap de refinamiento de las 17 HU cerrado (Ronda 41), el usuario compartió feedback real de uso en producción — `monitor-app/docs/user-stories/20260720/refinamiento-weekly-20260720-v2.md`, 8 ítems agregados incrementalmente por el usuario en la propia sesión. Cada ítem se investigó en el código real (no se adivinó ningún fix) antes de proponer solución; 4 mockups de Figma (`NW7aAqbiCxML2HLd8uMTzf`) y una re-lectura de `transcript-meeting.md`/`notes-meeting.md` (vía fork) informaron el diagnóstico de varios ítems.

Spec: `docs/superpowers/specs/2026-07-22-post-weekly-refinamiento-v2-design.md`. Plan: `docs/superpowers/plans/2026-07-22-post-weekly-refinamiento-v2-plan.md` (6 tareas, Fases A/B/C).

**Hallazgo clave que cambió el alcance del ítem 5**: el usuario pidió invertir el modelo a "el vehículo es la entidad, no el conductor" citando los transcripts. La re-investigación (fork dedicado) encontró que Pablo **nunca asentó eso** — lo exploró como opción (drivers rotan de camión) y se retractó en la misma conversación ("en estricto rigor, el que manda es el conductor"). Lo firme: conductor+tracto como **par** validado bajo la misma empresa, y el término real **"Equipo OVNI"** (nunca usado en la app) para un par sin cruce. Se presentó este hallazgo al usuario antes de codear — confirmó proceder con el alcance corregido (consolidación + terminología, no inversión de modelo).

**Fase A completa** (4 fixes independientes, commits `26513b0`, `b37ae49`, `feca604`, `3c6d2d6`, ya pusheados):
1. **Seguros — crear póliza fallaba en silencio**: `InsurancePolicyModal.tsx`'s `handleAddPolicy` no tenía `try/catch` (a diferencia de su hermana `handleGenerateSchedule`) — un error dejaba el modal abierto sin ningún mensaje. Bug real confirmado por inspección, no hipótesis.
2. **Badges de compliance sin identificar entidad**: `PendingDocsBadge` ya recibía `label` pero solo lo usaba en el `title` (tooltip, invisible sin hover). Ahora es texto visible: prefijo de 1 letra en compacto (`C2`/`T7`/`E11`), `"{label}: N pendientes"` en completo — mismo criterio que la columna "Estado Certificación" del mockup de Figma "Listado de Recursos".
3. **Columnas fijas del Diario**: sombra/gradiente en los bordes de la tabla, visible solo mientras hay contenido oculto de ese lado.
4. **"Revisar en Empresas" no interactivo**: era texto estático en `CloseDayDialog.tsx` — ahora es un link real a `/dashboard/transportistas/empresa/{carrier_id}` (backend agregó `carrier_id` a `_DETAIL_SQL`, ya se resolvía pero no se seleccionaba).

**Fase B completa** (ítem 5, commits `f7ed75d`, `752d284`, `3c434b4`, ya pusheados) — la más delicada de esta ronda, verificada exhaustivamente contra datos reales antes y después de aplicar:
- **`app.v_trip_fleet_resolution`** (migración `20260722030000`): consolida la cadena de resolución driver/tracto/carrier (stored → auto por patente → auto por `vehicle_driver_assignments` → match exacto de nombre), duplicada hasta ahora en 4 lugares (`_TRIP_FROM`, `available_drivers`, `available_assets`, `daily_closures.py`) — la duplicación fue la causa raíz del bug de Ronda 38. Confirmado con `EXPLAIN` que el planner la inlinea (mismo plan de ejecución, mismos índices, cero costo de performance) antes de aplicar — respuesta directa al pedido explícito del usuario de "arquitectura estándar, robusta, mantenible, escalable, nada de solución parche".
- **Impacto real medido** (2026-07-21): `available_drivers` mostraba **79/79** (100%) del roster como "disponible" — el bug era prácticamente total. Con la vista: **68/79**, excluyendo correctamente a los 11 con viaje ya resuelto. `daily_closures` se mantuvo en 17/1/61 (ya tenía la cadena completa desde Ronda 38) — confirma que la consolidación no rompió nada donde ya funcionaba.
- Efecto colateral positivo: la detección de MISMATCH (`_FLEET_MATCH_CASE`) usaba la empresa propia del conductor resuelta con solo 2 niveles; ahora usa la misma resolución de 3 niveles que el resto — corrige una inconsistencia menor que existía sin que nadie la hubiera reportado.
- **"Equipo OVNI"** adoptado como label visible en `TripSlideOver.tsx` para `fleet_match_status === 'UNMATCHED'` (antes sin ninguna superficie en el frontend). El enum interno no cambia.

Verificación en cada tarea: backend 306→308 tests, frontend 497→500 tests, `tsc`/`build` limpios.

**Explícitamente fuera de esta ronda** (documentado en la spec, no es deuda silenciosa):
- **Ítem 1b** (subida de documentos en Seguros) — dos hipótesis reales encontradas (RBAC gateando el control entero vs. mensaje de error del límite de 7MB poco visible), bloqueado en una pregunta al usuario: ¿qué rol tienen los usuarios afectados?
- **Ítem 6** (Reportería según mockups de Figma — tablas planas por dominio, tabs, export XML) — su propio brainstorming, tamaño de cambio distinto.

#### Próximo paso exacto
1. [ ] Fase C del plan (ítems 7+8): rediseño de `TarifarioPage` tipo SaaS (filtro, paginación si corresponde, acción primaria en el header) + absorber campos completos de Locales + retirar esa pestaña de Configuración. Depende de 7 antes que 8.
2. [ ] Ítem 1b — pendiente de que el usuario confirme el rol de los usuarios que no pueden subir documentación.
3. [ ] Ítem 6 (Reportería/Figma) — brainstorming propio, no iniciado.
4. [ ] Push de los últimos 3 commits de Fase B (`f7ed75d`, `752d284`, `3c434b4`) a `origin/dev` — confirmar con el usuario (Fase A ya está pusheada).
5. [ ] (nuevo, no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run — siguen describiendo el flujo viejo de Vercel.
6. [ ] (nuevo, no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
7. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
8. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
9. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
10. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
