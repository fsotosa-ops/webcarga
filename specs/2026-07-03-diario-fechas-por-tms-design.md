# Diario — Fechas por TMS (Ruta, Tabla/Tablero, TripCard)

**Fecha:** 2026-07-03
**Estado:** Aprobado por el usuario, pendiente revisión final del documento
**Módulo:** Monitor de Viajes / Diario (`monitor-app/frontend`) — Empresas y Configuración excluidos
**Precede a:** plan de implementación (writing-plans)
**Se apoya en:** `specs/2026-07-02-diario-detalle-rediseno-design.md` (rediseño del modal, ya implementado — este documento extiende la sección "Ruta" que ese rediseño ya reordenó, sin deshacer nada de esa spec)

## Contexto y problema

Investigando un reporte del usuario sobre un bug de fechas en Wingsuite (`monitor-app/docs/bug-date-wingsuite.png`, `payload_wingsuite.json`), se confirmó y corrigió un bug de timezone en `silver.stg_wingsuite_trips` (aparte, no cubierto por este documento). Durante esa investigación surgieron 3 pedidos relacionados sobre cómo el frontend maneja las fechas:

1. **"el modal no muestra todas las fechas que tiene wingsuite... y para cada una de las TMS son relevantes manejar"** — cada TMS (qanalytics/wingsuite/sodimac) reporta fechas distintas, con distinta cobertura, y hoy el modal no las aprovecha todas.
2. **"hay fechas que deben ser visibles en la vista tabla y tablero, pues tienen que ser monitoreables fácilmente"**.
3. **"tampoco tienen tags las tarjetas a que TMS pertenecen como tampoco el client name"** — `TripCard` (vista Tablero) no muestra ni el TMS de origen ni el cliente.

### Hallazgos de la investigación (antes de diseñar)

**Cobertura real de campos por TMS**, verificada con datos reales de `app.trips.stops` (primera parada de un viaje real de cada fuente):

| Campo | Qanalytics | Sodimac | Wingsuite |
|---|---|---|---|
| `planning_date` (llegada planificada) | no (sin ETA por parada) | sí (única fecha que reporta) | sí |
| `arrival_date` (llegada real) | sí | no | sí |
| `departure_date` (salida real) | sí (cuando ocurre) | no | sí (cuando ocurre) |
| `gps_arrival_date`/`gps_departure_date` | sí | no | no |
| `on_time_status`, `destination_city/region` | sí (vía milestone SAP) | no | no |
| `s2s`, `temperature`, `unload_start/end` | sí (cuando aplica) | no | no |

**Hallazgo crítico — `departure_date` es ambiguo para Wingsuite hoy**: cuando la salida real todavía no ocurrió, el paso que mapea `stg_wingsuite_trips` → `app.trips.stops` (Python en Mage, invisible desde este repo) hace `COALESCE(actual_departure_at, planned_departure_at)` y guarda ese valor en `departure_date` — sin distinguir si es un dato real o solo una promesa. Se verificó que `stg_wingsuite_trips` (la vista real desplegada, no solo el mirror de `docs/`) **sí expone los 4 conceptos por separado** en su `trip_stops` (jsonb): `planned_arrival_at`, `actual_arrival_at`, `planned_departure_at`, `actual_departure_at` — el dato no se pierde en dbt, se pierde en el paso posterior que arma `app.trips.stops`.

**Se descartó `docs/int_tms_trips_conformed.sql` como referencia**: ese archivo asume una arquitectura de staging por-parada (columnas planas `tr.local`, `tr.planning_date`, etc.) que no coincide con las `stg_*_trips` reales, que son 1 fila por viaje con un array `trip_stops` (jsonb). Es un artefacto de una iteración anterior, no algo desplegable tal cual — se descarta como guía para este trabajo.

### Decisión: agregar el campo, preparar el frontend

El usuario decidió **agregar un campo nuevo** (`departure_date_prog`, salida planificada) al schema de `app.trips.stops`/`TripStop`, y que este trabajo **prepare el frontend para consumirlo**, aunque el paso que realmente lo puebla (Mage, fuera de este repo) todavía no se haya actualizado. El campo debe comportarse igual que cualquier campo opcional por-TMS ya existente: `null` para Qanalytics/Sodimac (que no tienen ese concepto), poblado solo para Wingsuite una vez que Mage se actualice — sin romper nada mientras tanto.

## Diseño aprobado

### 1. `TripStop` (frontend) gana `departure_date_prog`

`lib/types.ts` → `TripStop.departure_date_prog: string | null` — mismo patrón que el resto de los campos opcionales (nunca requerido, siempre puede ser `null`). No requiere cambio de backend: `_TRIP_SELECT` en `trips.py` ya selecciona `t.stops` completo (jsonb), cualquier key nueva que Mage agregue al array llega automáticamente al frontend sin tocar el backend.

### 2. `describeStopTiming(stop)` — fórmula única de "mejor fecha disponible"

Nueva función pura en `lib/utils/temperature.ts` (junto a `getActiveStop`/`getLatestTemp`/`stopWasVisited`, mismo archivo de utilidades de paradas) que reemplaza las 3 ramas por estado (done/active/pending) que hoy tiene `StopTimeline` para el texto de fecha — **una sola fórmula, agnóstica al estado, agnóstica al TMS**:

```
arrival:   arrival_date ? "llegó {fmtShort(arrival_date)}" : (planning_date ? "llega ~{fmtShort(planning_date)}" : null)
departure: departure_date ? "salió {fmtShort(departure_date)}" : (departure_date_prog ? "sale ~{fmtShort(departure_date_prog)}" : null)
resultado: [arrival, departure] filtrados por null, unidos con " · "
```

Si ninguno de los 4 campos tiene dato (TMS que no reporta nada para esa parada — ej. Sodimac sin llegada/salida), la función devuelve `null` y no se muestra ninguna línea de fecha — evita mostrar "—" vacíos sin sentido.

Esta es la pieza reutilizada tanto por el modal (`StopTimeline`) como por la tabla/tablero (punto 4).

### 3. `StopTimeline` usa `describeStopTiming` para todas las paradas

El punto de color (verde/azul/gris) sigue reflejando el estado (done/active/pending) igual que hoy — no cambia. Lo que cambia es el texto bajo el nombre de la parada: en vez de "en camino"/"pendiente" sin fecha, ahora siempre muestra `describeStopTiming(stop)` cuando devuelve algo, con un fallback a "en camino"/"pendiente" (el texto actual) solo si la función devuelve `null` (para no dejar el texto vacío cuando de verdad no hay ningún dato).

### 4. Tabla/Tablero — 2 señales nuevas + la ya existente

Ambas reutilizan piezas ya construidas esta sesión, ninguna requiere lógica nueva de fondo:

- **Cumplimiento** (ya existe: badge OFF TIME vía `stopComplianceSummary`, sin cambios).
- **ETA compacto**: `describeStopTiming` aplicado al resultado de `getActiveStop(trip.stops)` (función ya existente en `lib/utils/temperature.ts`, ya usada para resolver "la parada relevante ahora mismo" en otras partes del código). Se muestra como texto chico junto al badge de estado, en `TripTable` (fila) y `TripCard` (tarjeta del tablero).
- **"hace X" desde el último reporte TMS**: `formatRelativeTime(trip.status_reported_at)` (ya construida para el modal en la spec anterior) — mismo texto chico, mismo lugar.

Ambas señales se ocultan solas cuando no hay dato (`describeStopTiming` devuelve `null`, o `status_reported_at` es `null`) — ningún elemento vacío/roto por TMS que no reporta ese dato.

### 5. `TripCard` gana tag de TMS + `client_name`

Mismo patrón visual que el chip de TMS ya usado en `TripTable` (`TmsChip`, reutiliza `meta.tms_sources` para color/label) — se agrega junto a la patente. `client_name` se agrega como texto chico junto al conductor (mismo lugar donde `TripTable` ya lo muestra en su vista mobile).

## Componentes

### Nuevos

Ninguno — todo son modificaciones a componentes/tipos existentes.

### Modificados

| Archivo | Cambio |
|---|---|
| `lib/types.ts` | `TripStop` gana `departure_date_prog: string \| null`. |
| `lib/utils/temperature.ts` | Nueva función pura `describeStopTiming(stop: TripStop): string \| null`. |
| `components/dashboard/StopTimeline.tsx` | Usa `describeStopTiming` para el texto de fecha de cada parada, con fallback a "en camino"/"pendiente" cuando la función devuelve `null`. |
| `components/dashboard/TripTable.tsx` | Agrega ETA compacto (`describeStopTiming` de la parada activa) y "hace X" (`formatRelativeTime(status_reported_at)`) junto al badge de estado, en mobile y desktop. |
| `components/dashboard/TripCard.tsx` | Agrega chip de TMS (mismo patrón que `TmsChip` de `TripTable`) + `client_name`. Agrega ETA compacto + "hace X", mismo criterio que `TripTable`. |

### Sin cambios

- Backend (`trips.py`) — `t.stops` ya se selecciona completo, sin cambios necesarios.
- `TripBoard.tsx`, `TripSlideOver.tsx` (fuera de la sección Ruta que ya usa `StopTimeline`, sin cambios propios) — consumen los componentes de arriba sin lógica propia que tocar.
- `IndicatorDots.tsx`, `ViewToggle.tsx` — sin relación con este cambio.

## Manejo de errores

No aplica — todo este trabajo es de solo lectura/presentación (ninguna acción nueva de `PATCH`/`DELETE`), no hay superficie de error nueva.

## Testing

- `describeStopTiming`: tests puros con Vitest cubriendo las 4 combinaciones de presencia/ausencia de `arrival_date`/`planning_date` y de `departure_date`/`departure_date_prog`, más el caso "ningún campo presente → `null`".
- `StopTimeline.test.tsx`: extender para cubrir el nuevo texto de fecha en paradas pendientes/activas (hoy solo se testea el estado "done").
- `TripTable.test.tsx`/`TripCard.test.tsx`: extender para cubrir el ETA compacto, el "hace X", el chip de TMS y `client_name` en `TripCard`.

## Fuera de alcance de esta spec

- **El paso de Mage que puebla `departure_date_prog`** — fuera de este repo, responsabilidad del usuario. El campo queda listo en el tipo `TripStop` y en la fórmula `describeStopTiming`, pero permanecerá `null` en producción hasta que ese paso se actualice.
- **Reescribir `docs/int_tms_trips_conformed.sql`** — se descartó como artefacto obsoleto de una arquitectura anterior; no se toca en este documento.
- El fix de timezone de `stg_wingsuite_trips` — ya resuelto aparte (mismo día, sesión anterior a este documento).
- Rediseño de Configuración, adjuntos en Bitácora, auto-refresh — ya documentados fuera de alcance en specs anteriores.

## Preguntas abiertas para el plan de implementación

Ninguna — todas las decisiones de diseño quedaron cerradas durante el brainstorming (fórmula de `describeStopTiming`, dónde se muestra cada señal, alcance del campo nuevo).
