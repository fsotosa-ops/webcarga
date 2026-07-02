# Diario — rediseño completo de la experiencia (Monitor de Viajes)

**Fecha:** 2026-07-02
**Estado:** Aprobado por el usuario, pendiente revisión final del documento
**Módulo:** Monitor de Viajes / Diario (`monitor-app/frontend`) — Empresas y Configuración excluidos
**Precede a:** plan de implementación (writing-plans)
**Reemplaza el enfoque de:** `specs/2026-07-02-diario-fila-detalle-design.md` (la sesión anterior implementó fila expandible + ficha sin tabs; el usuario evaluó el resultado en producción y lo consideró insuficiente — ver Contexto)

## Contexto y problema

La sesión anterior implementó y desplegó un rediseño de la fila y el detalle de viaje (indicadores clickeables, fila expandible in-place, ficha completa sin tabs). Al verlo en uso real, el usuario dio este feedback: **"está pésimo el diseño del diario, no me dice nada y no refleja la información de app.trips y el dropdown de cada fila no muestra nada relevante."**

Investigación (comparando el schema real de `app.trips`/`stops` contra lo efectivamente mostrado) confirmó el problema con datos concretos, no solo percepción:

1. **`manually_edited_fields`** (qué campos quedaron protegidos de sobrescritura del pipeline por edición manual) no se mostraba en ningún lado salvo para `estado_manual` — si un operador tildaba "Activo" a mano, ese campo dejaba de seguir al TMS sin ningún aviso visual.
2. **`edited_by`** (quién hizo el último cambio manual) existe en `app.trips` — se agregó en una corrida reciente del pipeline dbt, después de que la sesión anterior asumiera que no existía — y nunca se expuso por API ni frontend.
3. El **timeline compacto de la fila expandida** (el "dropdown" que el usuario menciona) en modo compacto solo mostraba el nombre de la parada y "en camino"/nada más — muy poca información real.
4. **`on_time_status`** (ON TIME / OFF TIME) y **`milestone_status`** por parada — el estado de cumplimiento real de cada entrega — quedaron enterrados en un acordeón colapsado "Ver detalle técnico", no visibles a primera vista pese a ser información operativa central.
5. `created_at` de `app.trips` (cuándo entró el viaje al sistema) tampoco se mostraba en ningún lado.

El usuario, consultado sobre si mantener la estructura de 3 niveles (indicadores en fila → fila expandible → ficha completa) y solo llenarla de datos, o reconsiderar todo, eligió **reconsiderar todo desde cero**.

⚠️ **Hallazgo de seguridad, fuera de alcance de esta spec pero comunicado**: el advisor de Supabase marca `app.trips` con **RLS deshabilitada** (severidad crítica) — cualquiera con la anon key podría leer/modificar toda la tabla. El usuario pidió tratarlo como un ajuste aparte, no mezclado con este rediseño de UI. Se resuelve en un cambio de backend separado, no cubierto por este documento.

## Exploración visual y decisión

Se compararon 3 estructuras (mockups en `.superpowers/brainstorm/`, sesión 2026-07-02):
- **A — Tabla enriquecida**: la fila ya trae la señal importante (progreso por parada, badge de excepción, candados), detalle sin acordeones para info operativa.
- **B — Tablero (kanban) por estado**: reemplaza la tabla por columnas de estado con tarjetas ricas; no escala para miles de registros históricos.
- **C — Híbrido forzado**: tablero fijo en "En Curso", tabla fija en "Historial".

**Decisión del usuario**: ni A ni B ni C tal como se plantearon — quiere **A y B disponibles ambas, con un selector para que el operador elija cómo visualizar**, y que seleccionar cualquier viaje (desde cualquiera de las dos vistas) abra el mismo detalle. Se acotó el selector a la pestaña "En Curso" únicamente (Historial, con volumen de miles de registros, queda fijo en tabla mejorada — decisión del usuario tras evaluar el trade-off de escala).

## Decisión de arquitectura: se elimina el paso intermedio de "fila expandida"

La sesión anterior introdujo un nivel intermedio (`TripRowExpanded`, la fila se expande in-place antes de abrir el detalle completo). Con el nuevo diseño, la fila/tarjeta ya muestra la señal operativa relevante directamente (sin necesidad de expandir), así que seleccionar un viaje —desde tabla o desde tablero— **abre el detalle completo directo, sin paso intermedio**. `TripRowExpanded.tsx` se elimina (ya no tiene función: lo que mostraba de forma pobre, ahora vive enriquecido en la fila/tarjeta misma).

El detalle completo se mantiene como panel superpuesto (no panel fijo persistente estilo email — descartado en la sesión anterior por el ancho que exige una tabla ya densa, y porque no funciona en la vista mobile existente).

## Componentes

### Nuevos

| Componente | Responsabilidad |
|---|---|
| `lib/utils/compliance.ts` | Función pura `stopComplianceSummary(stops: TripStop[]): 'ok' \| 'warn' \| null` — agrega `on_time_status`/`milestone_status` de todas las paradas en una sola señal. `null` si no hay paradas o ninguna tiene datos de cumplimiento aún; `'warn'` si al menos una parada está `OFF TIME`; `'ok'` en caso contrario. Reutilizada por fila, tarjeta y detalle — una sola fuente de verdad para "¿este viaje tiene un problema de cumplimiento?". |
| `components/dashboard/TripCard.tsx` | Tarjeta de viaje para el tablero: patente, conductor, cliente, temp (con clasificación ya existente), progreso por parada (puntos verdes/rojos/grises según `on_time_status`), badge de cumplimiento (`stopComplianceSummary`), indicadores con candado si están en `manually_edited_fields`. Borde rojo si `stopComplianceSummary === 'warn'`. Click abre el detalle. |
| `components/dashboard/TripBoard.tsx` | Tablero: agrupa los viajes recibidos por `defaultGroups` (mismo cálculo que ya existe en `page.tsx` para los chips de filtro — `GROUP_ORDER`/`GROUP_DISPLAY`), una columna por grupo, renderiza `TripCard` por viaje. |
| `components/dashboard/ViewToggle.tsx` | Selector Tabla/Tablero, dos botones. Preferencia persistida en `localStorage` (clave propia, ej. `diario:vista-en-curso`) para no tener que re-elegir en cada visita. Solo se renderiza cuando `tab === 'en_curso'`. |

### Modificados

| Componente | Cambio |
|---|---|
| `TripTable.tsx` | Fila enriquecida: puntos de progreso por parada (mismo criterio que `TripCard`), badge de cumplimiento, candado en indicadores congelados (mismo criterio que `IndicatorDots` ya aplica internamente). Click en la fila abre el detalle directo (ya no expande in-place — se elimina el estado `expandedId` y el uso de `TripRowExpanded`). |
| `StopTimeline.tsx` | Cada parada de la línea de tiempo muestra su badge de cumplimiento (`on_time_status`/`milestone_status`) inline, ya no solo en el acordeón "detalle técnico". El acordeón técnico se mantiene, pero acotado a lo genuinamente raro de necesitar (timestamps GPS exactos, código S2S) — cumplimiento se promueve a la vista principal. |
| `IndicatorDots.tsx` | Candado visual + tooltip (`"congelado por {editor} el {fecha}"`) sobre el punto cuando `trip.manually_edited_fields` incluye ese campo. Necesita recibir `trip.manually_edited_fields` y `trip.edited_by`/`trip.edited_at` (ya recibe `trip` completo, no requiere cambio de firma). |
| `TripSlideOver.tsx` | Se abre directo al seleccionar un viaje (ya no depende de que la fila esté expandida — cambia el punto de entrada, no la estructura interna ya aprobada la sesión anterior). Resumen gana `created_at`. El override manual (`estado_manual`) y cualquier otro campo en `manually_edited_fields` muestran atribución completa: `"confirmado manualmente por {edited_by} el {edited_at}"`, no solo la fecha. |
| `app/dashboard/diario/page.tsx` | Nuevo estado `viewMode: 'tabla' \| 'tablero'` (leído/escrito a `localStorage`), renderiza `ViewToggle` + `TripBoard`/`TripTable` condicionalmente en la pestaña "En Curso". "Historial" sigue usando solo `TripTable` (con las mismas mejoras de fila enriquecida). |

### Eliminados

- `components/dashboard/TripRowExpanded.tsx` y su test — sin reemplazo directo, su función pasa a vivir en la fila/tarjeta enriquecida.

## Datos: cambios de backend

`_TRIP_SELECT` en `monitor-app/backend/api/app/routers/trips.py` no expone hoy `edited_by` ni `created_at`, pese a que ambas columnas existen en `app.trips` (confirmado contra el schema real vía Supabase). Cambios:

1. Agregar `t.edited_by`, `t.created_at` a `_TRIP_SELECT`.
2. `edited_by` es un `uuid` que referencia `auth.users.id` — resolver a un email/nombre legible con un `LEFT JOIN auth.users` (mismo patrón ya usado en este proyecto para `app.transporter_profiles.edited_by`, no es territorio nuevo). Exponer como `edited_by_email` (o el campo que `auth.users` tenga más legible) en vez del uuid crudo.
3. `Trip` (frontend, `lib/types.ts`) gana `edited_by: string | null` y `created_at: string | null`.

`on_time_status`/`milestone_status` por parada **ya existen** en `stops` (jsonb) y ya están tipados en `TripStop` — el trabajo ahí es 100% reorganización de UI (promover de un acordeón a la vista principal), sin cambios de backend.

`GET /trips` (`list_trips`) no cambia su forma de filtrado/paginación — este rediseño no toca la Fase D (performance) documentada aparte.

## Manejo de errores

Mismo estándar ya establecido: ningún error de `PATCH`/`DELETE` se silencia (`IndicatorDots`, override manual, etc. ya lo cumplen desde la sesión anterior, sin cambios de comportamiento acá). El toggle Tabla/Tablero es puramente de presentación sobre los mismos datos que ya trae `GET /trips` — no agrega superficie de error nueva.

## Testing

- `stopComplianceSummary`: función pura, tests directos con Vitest cubriendo los 3 casos (`ok`/`warn`/`null`) y el caso "algunas paradas sin datos de cumplimiento todavía".
- `TripCard`/`TripBoard`: tests con Vitest+RTL (ya instalado) siguiendo el patrón de `IndicatorDots`/`TripRowExpanded` — verificar agrupación por estado, borde de alerta cuando `stopComplianceSummary === 'warn'`, click abre el detalle.
- `ViewToggle`: test de que persiste la preferencia en `localStorage` y la respeta al montar.
- `TripTable`/`StopTimeline`: extender los tests existentes para cubrir los badges de cumplimiento y el candado de campos congelados.

## Fuera de alcance de esta spec

- RLS deshabilitada en `app.trips` — se resuelve aparte, backend puro, sin relación con esta UI.
- Rediseño de Configuración — ya pospuesto explícitamente por el usuario en la sesión anterior.
- Fase D (performance de `GET /trips`) — no se toca acá.
- Auto-refresh/polling — mencionado en el plan original de Fase C, no retomado en esta ronda.

## Preguntas abiertas para el plan de implementación

1. `auth.users` — ¿qué campo exacto usar para mostrar el editor (`email` es lo más seguro que existe siempre; si hay un `raw_user_meta_data` con nombre de pila, sería más legible pero menos garantizado)? A confirmar al implementar el join.
2. ¿El acordeón "detalle técnico" en `StopTimeline` sigue siendo necesario una vez que cumplimiento se promueve a la vista principal, o directamente se elimina y esos campos (GPS exacto, S2S) se muestran siempre? Se mantiene la decisión conservadora de la sesión anterior (dejarlo como accordion) salvo que se decida lo contrario en el plan.
3. ¿El tablero (`TripBoard`) respeta los mismos filtros de la barra (búsqueda, flags, fuente, cliente) que hoy aplican a `TripTable`, o tiene sus propios controles? Asunción por defecto: comparte exactamente los mismos filtros y datos ya cargados por `page.tsx` — el toggle solo cambia la presentación, no la fuente de datos ni los filtros aplicados.
