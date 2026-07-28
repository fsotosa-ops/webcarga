# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-28 — Ronda 51: "Centro de Flota" — brainstorming + spec + plan + implementación completa

**Contexto**: el usuario pidió entender "cerrar el día" y los estados de conductor/equipo (disponible/asignado/no asignado), señalando que el botón "conductores disponibles" del Diario estaba mal configurado y debía formar parte del User Journey de cierre. Sesión completa vía `superpowers:brainstorming` (con visual companion, 3 rondas de mockups) → `superpowers:writing-plans` → `superpowers:executing-plans` (modo inline, pedido explícito).

**Hallazgo clave de la investigación** (`monitor-app/docs/user-stories/20260720/`, transcript completo de la reunión con Pablo + los 3 reportes reales que el equipo ya le envía por correo — Sodimac, Walmart, Sider/Iansa): la unidad correcta para "disponibilidad" es el **EQUIPO (tracto)**, no el conductor — cita textual de Pablo: *"el problema es que el conductor, de repente, hoy se montó a un camión, mañana se monta a otro"*. Los 3 reportes reales ya usan "equipos disponibles/asignados" como métrica, no "conductores". El backend ya tenía `GET /trips/available-assets` con el diseño correcto pero **ningún componente frontend lo consumía** — todo el flujo de creación de viaje era conductor-primero.

**Decisión de arquitectura confirmada con el usuario** (brainstorming, 2 preguntas + 3 rondas de visual companion): "Cerrar el día" (`app.driver_day_status`) se mantiene 100% ancorado al conductor — coincide con HU-01 literal y con cómo Pablo cuenta cabezas en el transcript. Se agrega un modal nuevo y **separado**, "Centro de Flota", cruzado por link (no fusionado) con `CloseDayDialog` — evita mezclar la reconciliación de fin de día (con bloqueos/override) con la acción operativa de asignar un viaje ahora. Ese modal absorbe además "Agregar viaje" + "Carga masiva CSV" (antes 2 botones sueltos que creaban el mismo objeto) como un split-button "+ Nuevo viaje ▾", patrón estándar en SaaS operacional (Onfleet, Samsara Dispatch). Dentro de "disponibles", 3 tiles clickeables separan **Nunca asignados hoy** (alerta real — nadie los usó) de **Liberados tras viaje** (operación normal) y **En viaje hoy** — pedido explícito del usuario tras notar que esta distinción es "lo relevante y crítico".

**Spec**: `docs/superpowers/specs/2026-07-28-centro-de-flota-design.md`. **Plan**: `docs/superpowers/plans/2026-07-28-centro-de-flota-plan.md` (7 tareas TDD, todas ejecutadas):
1. **Backend** (`trips.py`): `GET /trips/available-assets` pasa de lista pelada a `{total_active, items}` — `total_active` permite calcular "en viaje hoy" sin duplicar la cuenta. Se agrega `standing_driver` (mismo patrón que `standing_vehicle` de `available-drivers`, en dirección inversa) para que un equipo sin viajes hoy siga mostrando su conductor habitual.
2. **Backend** (`daily_closures.py`): `_DETAIL_SQL` suma `trip_id` vía LATERAL para filas MISMATCH — el viaje real que causó el descuadre (más reciente si hay más de uno), mismo criterio que ya usa `_RECOMPUTE_SQL` para marcar el estado.
3. **Frontend — tipos/cliente**: `AvailableAsset`, `AvailableAssetsResponse`, `tripsApi.availableAssets()`, `DriverDayStatusRow.trip_id`.
4. **`FleetCenterDialog.tsx`** (nuevo): tiles/búsqueda/tabla/split-button/cross-link.
5. **`TripAssignDialog.tsx`**: prop `initialFleet` — al abrir desde "Asignar viaje" en Centro de Flota, el equipo/conductor llegan precargados.
6. **`CloseDayDialog.tsx`**: link "Ver equipos disponibles" (cross-link) + filas MISMATCH ahora abren el viaje real (`TripSlideOver`) en vez de linkear genéricamente a la ficha de empresa — resuelve el ítem 4 del refinamiento v2 del 20/07 ("no permite interactuar con los viajes que aparecen ahí").
7. **`page.tsx`**: el pill "conductores disponibles" + los botones "Agregar viaje" y "Carga masiva (CSV)" se funden en un solo botón "Flota — N disponibles"; nuevo estado orquesta los 4 modales (Centro de Flota ↔ Cerrar el día ↔ Asignar viaje ↔ Detalle del viaje).

**Decisiones explícitas de alcance** (todas confirmadas con el usuario durante el brainstorming, no asumidas): nomenclatura "Por regularizar" del estado MISMATCH se mantiene sin cambios (se evaluó "En el aire", frase textual de Pablo, pero el usuario prefirió lo que ya está en producción); promover "Centro de Flota" a módulo de navegación de primer nivel quedó **fuera de alcance**, para un checkpoint separado.

**Deploy y verificación en vivo — bug real de producción encontrado y corregido en el momento**: tras el primer deploy, `GET /trips/available-assets` devolvía **500** en el Diario real (confirmado con Playwright + consola). Causa raíz diagnosticada contra la base real (`execute_sql`, no solo el mock de los tests): `max(vfr.resolved_driver_id)` — Postgres no tiene un agregado `max(uuid)`. Corregido con cast (`max(...::text)::uuid`), test de regresión agregado, verificado en vivo (200 + datos reales: 117 equipos activos, 79 conductores activos). **Lección de proceso**: los tests con `AsyncMock` no ejecutan SQL real y no detectan errores de tipo de Postgres — a partir de ahora, toda query nueva no trivial se verifica contra la base real (`mcp__claude_ai_Supabase__execute_sql`) antes de darla por buena, no solo con los tests unitarios.

---

### 2026-07-28 (cont.) — Ronda 52: feedback post-deploy de Centro de Flota — 3 puntos + 1 pregunta, todos resueltos

**Contexto**: el usuario probó Centro de Flota en producción y devolvió 3 puntos: (1) el tile "En viaje hoy" mostraba un número pero ninguna fila al clickearlo, (2) los números de "Cerrar el día" y "Flota" no cuadran entre sí — ¿es normal?, (3) el "Ruta" del modal de Agregar viaje no está sincronizado con `public.locations`. Más una pregunta suelta: ¿por qué `vehicle_driver_assignments` está casi vacía?

**Punto 2 — explicado, no era un bug**: verificado contra la base real: **117 equipos activos** vs. **79 conductores activos** — son dos rosters distintos (`public.assets` vs. `public.drivers`), no hay ninguna razón para que el total coincida (decisión de arquitectura de la Ronda 51: conductor para cerrar el día, equipo para disponibilidad). Dato relevante encontrado de paso: de esos 117 equipos, solo 1 tiene `vehicle_driver_assignments` activa — por eso casi todas las filas de Centro de Flota muestran "Sin conductor asignado hoy".

**Pregunta suelta — `vehicle_driver_assignments` casi vacía**: no es un feature faltante. Existe un flujo real y completo: `VehicleDetailPanel.tsx` (abierto desde la ficha de empresa, `/dashboard/transportistas/empresa/[id]`, vía `VehicleRosterCard`) permite asignar/cambiar el conductor habitual de un equipo, llamando `POST/DELETE /assets/{id}/driver-assignment` (`assets.py`, con `is_manual_override`). Es un gap de **adopción/carga de datos** por parte de operaciones, no de desarrollo — nadie ha ido equipo por equipo a cargarlo todavía.

**Punto 1 — resuelto con Opción B (elegida por el usuario)**: `GET /trips/available-assets` ahora también devuelve `busy: BusyAsset[]` — el complemento real de `items` (equipo con viaje ABIERTO hoy: patente, empresa, cliente, `trip_status`), calculado con una query nueva (`busy_trip`, `DISTINCT ON` por equipo, más reciente si hay más de un viaje). **Segundo bug real encontrado y corregido antes de aplicar** (verificado con `execute_sql` primero, como quedó como lección de la Ronda 51): la columna real es `t.trip_status`, no `t.current_status` como se escribió al principio. `FleetCenterDialog.tsx` — la tabla ahora cambia de columnas según la categoría activa (Patente/Empresa/Cliente/Estado actual para "En viaje hoy", con acción "Ver viaje" que abre el detalle real); `page.tsx` — handler compartido `handleSelectTrip` entre `CloseDayDialog` (fila MISMATCH) y `FleetCenterDialog` (equipo ocupado).

**Punto 3 — resuelto, priorizado por el usuario**: `RouteEditor.tsx` (Origen + cada Destino del modal "Agregar viaje") era 100% texto libre, sin ninguna relación con el diccionario real de locales de Tarifario — un operador podía tipear un nombre existente con formato distinto y generar un duplicado. Nuevo componente `LocationPicker.tsx` (mismo patrón que `ClientPicker.tsx`: input + dropdown de sugerencias contra `GET /locations?q=`, el valor sigue siendo texto libre, sin auto-relleno de región/ciudad — `public.locations` no guarda ciudad y `region_name` no está garantizado que calce 1:1 con el picker de región/ciudad de Chile, se dejó fuera para no arriesgar un match silenciosamente incorrecto).

**Verificación de toda la ronda**: backend 337/337, frontend 559/559, `tsc --noEmit` y `npm run build` limpios en cada commit. Las 2 queries nuevas (busy equipment, y la del fix de Ronda 51) se verificaron contra la base real antes de aplicarlas — 0 bugs de tipo/columna en producción esta vez. Todos los commits en `dev` local, sin push todavía de esta ronda (Ronda 51 sí está pusheada y desplegada).

#### Próximo paso exacto
1. [ ] **Decidir con el usuario si se pushea Ronda 52** (tile "En viaje hoy" con datos reales + LocationPicker en Ruta) y verificar en vivo: clickear "En viaje hoy" muestra el equipo real y "Ver viaje" abre el detalle correcto; el campo Origen/Destino del modal "Agregar viaje" sugiere locales existentes al tipear 2+ caracteres.
2. [ ] Confirmar con el cliente a qué campo se refiere "LSS" — único punto sin resolver de los 10 criterios duros de Hito 3.
3. [ ] Diseñar el rediseño de `/dashboard/operaciones` como hub de Diario+Reportería (dirección de producto confirmada en Ronda 47 — ver archivo, sin spec todavía).
4. [ ] Diseñar (spec nuevo) `app.equipment_day_status` — desbloquea el rediseño real de Reportería (3 formatos fijos según mockups de Figma, refinamiento v2 ítem 6). Distinto del "Centro de Flota" de la Ronda 51, que usa disponibilidad calculada en vivo, no un modelo persistido por día.
5. [ ] Evaluar si "Centro de Flota" pasa a ser módulo de navegación de primer nivel (con espacio para alertas de póliza/documentación de equipo) — explícitamente dejado fuera de la Ronda 51.
6. [ ] (opcional, negocio) Si se quiere que "Conductor habitual" deje de estar casi siempre vacío en Centro de Flota, hace falta que operaciones cargue `vehicle_driver_assignments` equipo por equipo desde la ficha de cada empresa (`VehicleDetailPanel.tsx`) — no es una tarea de desarrollo.
7. [ ] Borrar a mano en la UI de Mage el bloque `wingsuite_has_new_data` (desconectado).
8. [ ] Revisar en la UI de Mage por qué `centralizer_eett_sharepoint`/`load_compliance_records_08` siguen en `status: failed` (no bloqueante, datos fluyen igual).
9. [ ] Tarea 9 de status_taxonomies (DROP tablas legacy) — diferida, gated por tiempo en producción + confirmación explícita del usuario.
10. [ ] Ítem 1b — pendiente de que el usuario confirme el rol de los usuarios que no pueden subir documentación.
11. [ ] (no bloqueante) Reescribir `/deploy` y `/check-env` (`monitor-app/.claude/commands/`) para reflejar Cloud Run.
12. [ ] (no bloqueante) Confirmar si `webcarga-frontend-prod` ya tuvo un primer deploy a `main`.
13. [ ] (heredado) Barrer `source_client` dentro de `qanalytics` para descartar más casos tipo IANSA.
14. [ ] (heredado) Evaluar si vale la pena versionar el proyecto dbt real en git.
15. [ ] (heredado) Decidir si se retiran del pipeline `legacy_drivers_transporters` los bloques `snapshot_transporters_data`/`webapp_transporter_porfiles`.
16. [ ] (heredado) `ops.pipeline_rejects`/`ops.pipeline_runs` — sin auditar, no bloqueante.
