# Badge "necesita seguimiento en bitácora" — diseño

**Fecha**: 2026-07-28
**Contexto**: uno de los 3 gaps encontrados al releer la minuta completa contra el Artifact de cierre de Hito 3 (ver `AGENTLOG.md` Ronda 56, sección "Otros puntos de la minuta"). No es un criterio duro de Hito 3 — es un ítem propio de la minuta (§6.5, reunión 10/07: "indicador visual en vista principal de que un viaje tiene observaciones").

## Por qué y qué pidió el usuario

La bitácora (llamadas, WhatsApp, incidentes, adjuntos) funciona en el detalle del viaje (`TripSlideOver`/`TripNotesFeed`), pero no hay ningún indicador de eso en la tabla principal del Diario (`TripTable`) — confirmado por grep, no existe. La minuta original solo pedía "un indicador de que hay observaciones".

Al brainstormear el alcance con el usuario, la idea original (badge con conteo de notas) se descartó por dos razones que dio el usuario directamente:
- **Saturaría la tabla**: con el tiempo, la mayoría de los viajes van a acumular alguna nota rutinaria — un badge "tiene notas" dejaría de aportar señal (mismo problema que ya evitó `PendingDocsBadge` en su momento, ver comentario en ese archivo).
- **No debe duplicar el sistema de alertas ya existente**: `alertSignals.ts`/`kpis.ts` ya calculan alertas automáticas (Atraso de llegada, Detenido en local, Sin reporte, Temp fuera de rango, etc.) como tiles filtrables. Un indicador de bitácora que no se relacione con eso sería una señal paralela y redundante.

**Reformulación acordada**: el indicador no muestra "¿tiene notas?" sino "¿tiene una alerta automática activa que todavía nadie atendió con una nota humana?" — cruza las alertas ya calculadas con la bitácora en vez de tratarlas como sistemas separados.

## Alcance

**Adentro:**
- Badge en `TripTable` que aparece solo cuando un viaje tiene ≥1 de 4 alertas activas (`late_arrival`, `dwell`, `stale`, `temp_out`) sin ninguna nota humana posterior al momento exacto en que esa alerta se disparó.
- Nuevo campo agregado `last_human_note_at` expuesto por el backend en el listado de viajes.
- Click en el badge navega al detalle del viaje con el tab Bitácora abierto.

**Afuera:**
- `unassigned` y `fleet_unmatched` — no tienen un ancla temporal natural (son flags estructurales, no basados en un timestamp que "vence"), y ya tienen su propio flujo de atención (Centro de Flota). No se fuerza un ancla artificial para incluirlos.
- `off_time` — es un rollup de `on_time_status` por parada, ya cubierto en la práctica por `late_arrival`/`dwell`; se deja fuera para no duplicar señal.
- Cualquier cambio al sistema de tiles/filtros de `alertSignals.ts` — este indicador vive solo en la fila de la tabla, no se agrega como una tile más ni como un filtro nuevo.
- Distinguir tipos de nota en el badge (llamada vs. WhatsApp vs. observación) — cualquier nota humana cuenta igual como "atendido". `note_type='incidente'`/`resolved_at` sigue existiendo y siendo útil dentro de la bitácora misma, pero no es lo que determina este badge.

## Modelo de datos y anclas por alerta

Ninguna alerta hoy persiste "desde cuándo" — se derivan en vivo (`kpis.ts`, client-side) comparando timestamps ya presentes en `Trip`/`TripStop` contra `now`. Cada una de las 4 alertas en alcance ya null-checkea su propio timestamp antes de devolver `true`, así que el ancla siempre existe cuando la alerta está activa — no hace falta ningún fallback:

| Alerta | Ancla (timestamp "desde cuándo") | Origen |
|---|---|---|
| `late_arrival` | `planning_date` de la parada vencida | `TripStop` |
| `dwell` | `arrival_date ?? gps_arrival_date` de la parada detenida | `TripStop` |
| `stale` | `status_reported_at` | `Trip` |
| `temp_out` | `arrival_date ?? gps_arrival_date` de la parada que originó la lectura (mismo stop que usa `getLatestTemp`) | `TripStop` |

Cuando un viaje tiene más de una de estas 4 alertas activas a la vez, el ancla relevante es la **más reciente** de las que apliquen — si una nota ya cubre la alerta más vieja pero apareció una nueva alerta después, el badge debe volver a aparecer (la situación cambió después del último contacto humano).

## Backend (`monitor-app/backend/api/app/routers/trips.py`)

Nuevo `LEFT JOIN LATERAL` en `_TRIP_FROM`, mismo patrón que el lateral existente de `insurance_alert` (líneas 399-407):

```sql
LEFT JOIN LATERAL (
    SELECT MAX(created_at) AS last_human_note_at
    FROM app.trip_notes
    WHERE trip_id = t.id AND note_type != 'sistema'
) notes ON true
```

`note_type != 'sistema'` es obligatorio: `app.trip_notes` ya tiene notas auto-generadas (ej. "Divergencia TMS: ...", ver línea 1434-1436 del mismo archivo) — sin ese filtro, una nota de sistema contaría falsamente como "un humano ya atendió esto".

- `_TRIP_SELECT` suma `notes.last_human_note_at`.
- Schema `Trip` (backend) y tipo `Trip` (frontend, `lib/types.ts`) suman `last_human_note_at: string | null`.
- Sin endpoint nuevo, sin query param nuevo — un campo más en el listado que ya se pagina.

## Frontend

**`lib/utils/kpis.ts`**: hoy `matchesKpi()` devuelve solo `boolean`. Se agrega una función hermana `kpiAnchorTimestamp(trip, kpi): number | null` que reusa la misma lógica de cada `case` para devolver el timestamp en vez del booleano, evitando duplicar las reglas de negocio. Solo se implementa para los 4 KPIs en alcance (los otros 3 devuelven `null`, no se usan en este flujo).

**Nueva función `needsBitacoraFollowup(trip, ranges, rules)`** (mismo archivo o `alertSignals.ts`, a definir en el plan de implementación):
1. Evalúa los 4 KPIs en alcance con `matchesKpi`.
2. Si ninguno está activo → `false`.
3. Si alguno está activo, toma el máximo de `kpiAnchorTimestamp` entre los activos.
4. `true` si `trip.last_human_note_at` es `null` o anterior a ese máximo.

**`components/dashboard/TripTable.tsx`**: nuevo badge, mismo patrón visual que `PendingDocsBadge` (`compact`) — pill pequeño, ícono sin conteo (es binario). Tono propio y fijo (no heredado de la alerta que lo disparó): el badge representa un concepto distinto ("nadie dejó una nota humana desde que esto empezó a sonar"), no una alerta específica, y no hay un orden de severidad definido entre `late_arrival`/`dwell`/`stale`/`temp_out` para elegir de cuál heredar el color cuando hay más de una activa a la vez. Ícono sugerido: `MessageCircleWarning` o similar de `lucide-react` (a confirmar visualmente durante la implementación), tono ámbar — mismo criterio de "atención, no crítico" que ya usa `PendingDocsBadge` no-`critical`. Se oculta por completo cuando `needsBitacoraFollowup` es `false` — nunca un estado neutro visible, para no repetir el problema de saturación que ya se evitó en `PendingDocsBadge`.

**Click-through**: abre `TripSlideOver` con la Bitácora como sección visible/con foco — mismo patrón de deep-link ya usado para "Revisar en Empresas/Seguros" (Ronda 47).

## Testing

- `kpis.ts`: `kpiAnchorTimestamp` devuelve el timestamp correcto para cada uno de los 4 casos, y `null` para los 3 fuera de alcance.
- `needsBitacoraFollowup`: sin alertas activas → `false`; alerta activa sin notas → `true`; alerta activa con nota humana posterior al ancla → `false`; alerta activa con nota humana anterior al ancla → `true`; nota tipo `sistema` no cuenta como atendido; dos alertas activas con anchors distintos, nota cubre solo la más vieja → `true` (debe reabrir).
- Backend: el lateral de `last_human_note_at` excluye notas `sistema`, devuelve `NULL` cuando no hay ninguna nota humana, devuelve el máximo correcto con múltiples notas.
- Frontend componente: badge no se renderiza cuando `needsBitacoraFollowup` es `false`; click navega y abre la Bitácora.

## Riesgos aceptados

- El ancla de `temp_out` asume que la lectura de temperatura relevante siempre viene acompañada de una llegada de parada (mismo supuesto que ya usa `getLatestTemp` hoy) — si algún día se reporta temperatura sin parada asociada, ese caso no calcula ancla y queda fuera del alcance de este badge (no del resto del sistema de alertas).
- `unassigned`/`fleet_unmatched`/`off_time` quedan fuera del cruce con bitácora en este v1 — si el usuario pide después ampliarlo, cada uno necesita su propia decisión de ancla (o de fallback sin ancla), no es una extensión automática.
