# Diario Alerts Filter Scalability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reemplazar las 2 filas de tiles del Diario (6 KPI cards + 4 flags operativos, 10 controles crecientes) por 3 tiles fijas con jerarquía visual por severidad + un popover "Alertas (N)" que agrupa el resto, con semántica OR entre alertas de condición y AND con los flags operativos — sin saturar visualmente a medida que se agreguen más señales.

**Architecture:** Todas las señales (6 KPI + 3 flags + "2ª+ vuelta", que reemplaza a `is_first_leg` como fuente) se unifican en un solo array `activeSignals: AlertSignalId[]` dentro de `useDiarioFilters` — un único reducer action (`toggleSignal`) en vez de los 2 actuales (`toggleKpi`/`toggleFlag`). El filtrado por KPI (client-side, como hoy) pasa de comparar contra un solo `kpiFilter` a hacer OR sobre el subconjunto de `activeSignals` que sean IDs de KPI; los flags operativos siguen viajando como query params al backend (AND), igual que hoy — solo cambia de dónde leen su valor (`activeSignals.includes(id)` en vez de campos sueltos). "2ª+ vuelta" es el único cambio real de backend: reemplaza el query param `is_first_leg` por `second_leg_plus`, resuelto contra la vista `app.v_driver_daily_trip_legs` del Plan 1 (no contra la columna manual `is_first_leg`, que sigue intacta en la base sin relación con este filtro).

**Tech Stack:** FastAPI + asyncpg (backend), React + `useReducer` (frontend), `localStorage` para personalización (mismo patrón que `VIEW_MODE_STORAGE_KEY`).

## Global Constraints

- **"Estado" (pills en_ruta/en_local/... + grupos personalizados) no se toca** — sigue como fila separada, single-select, fuera de este plan (es la dimensión de navegación primaria, no una alerta — decisión ya tomada en el spec).
- **La columna `app.trips.is_first_leg` no se toca** — sigue en la base. Solo se reemplaza el query param de filtro `is_first_leg` de `GET /trips` por `second_leg_plus`, resuelto contra `app.v_driver_daily_trip_legs` (Plan 1). Los otros usos de la columna (`_TRIP_SELECT`, `_insert_trip`, `_mirror_manual_trip`, `patch_trip`) no cambian.
- **3 señales pineadas por default**: `off_time`, `unassigned`, `stale` — el resto arranca sin pinear. Personalización vía `localStorage`, clave `diario:alertas-pineadas` (mismo mecanismo que `VIEW_MODE_STORAGE_KEY` en `page.tsx`).
- **Semántica**: OR entre señales de tipo KPI (`off_time`, `late_arrival`, `dwell`, `stale`, `temp_out`, `unassigned`) activas simultáneamente; AND entre señales de tipo flag (`active`, `working`, `assigned`, `second_leg_plus`) activas simultáneamente; AND entre el resultado de ambos grupos.
- **Contexto de tendencia (vs. hace 1h/ayer) queda fuera de este plan** — fast-follow ya documentado en el spec, requiere un mecanismo de snapshot que no existe.
- `npm run build` + `tsc --noEmit` + `vitest run` limpios al final de cada task que toque frontend; `pytest` limpio al final de cada task que toque backend.

---

### Task 1: Backend — reemplazar el query param `is_first_leg` por `second_leg_plus`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:328-390` (`list_trips`)
- Test: `monitor-app/backend/api/tests/test_config_monitor.py`

**Interfaces:**
- Produces: `GET /trips?second_leg_plus=true` filtra a viajes con `driver_leg_number >= 2` (vía `app.v_driver_daily_trip_legs`, Plan 1) — reemplaza a `GET /trips?is_first_leg=...`, que se retira.

- [x] **Step 1: Escribir el test que falla**

Agregar a `monitor-app/backend/api/tests/test_config_monitor.py`, junto a `test_list_trips_q_matches_client_name`:

```python
def test_list_trips_second_leg_plus_filters_against_driver_daily_trip_legs_view():
    # Ronda 26 (escalabilidad de filtros): reemplaza is_first_leg (columna
    # manual/TMS) como fuente del filtro "2ª+ vuelta" — la columna sigue
    # existiendo en la base, solo dejó de ser lo que este filtro consulta.
    # driver_leg_number es un alias de SELECT (Plan 1), no una columna real
    # de app.trips — no se puede referenciar directo en un WHERE del mismo
    # nivel, por eso la query real vuelve a resolver contra la vista.
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?second_leg_plus=true&view=historial")
    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "app.v_driver_daily_trip_legs" in query
    assert "leg_number >= 2" in query
```

- [x] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_config_monitor.py::test_list_trips_second_leg_plus_filters_against_driver_daily_trip_legs_view -v`
Expected: FAIL — `second_leg_plus` no es un parámetro reconocido, la query no contiene la vista

- [x] **Step 3: Reemplazar el parámetro y su filtro**

En `monitor-app/backend/api/app/routers/trips.py`, la firma de `list_trips` tiene hoy (línea 338):

```python
    is_first_leg: str = Query(""),
```

Cambiar a:

```python
    second_leg_plus: str = Query(""),
```

Y el bloque de filtro (líneas 387-390 hoy):

```python
    if is_first_leg == "true":
        filters.append("t.is_first_leg = true")
    elif is_first_leg == "false":
        filters.append("t.is_first_leg = false")
```

Cambiar a:

```python
    # "2ª+ vuelta" — reemplaza a is_first_leg (columna manual/TMS, que sigue
    # existiendo sin relación con este filtro) como fuente. driver_leg_number
    # es un alias de _TRIP_SELECT (subconsulta contra la vista), no una
    # columna real — no se puede referenciar en este WHERE, así que se
    # resuelve de nuevo contra app.v_driver_daily_trip_legs (Plan 1).
    if second_leg_plus == "true":
        filters.append(
            "EXISTS (SELECT 1 FROM app.v_driver_daily_trip_legs vdtl "
            "WHERE vdtl.trip_id = t.id AND vdtl.leg_number >= 2)"
        )
    elif second_leg_plus == "false":
        filters.append(
            "NOT EXISTS (SELECT 1 FROM app.v_driver_daily_trip_legs vdtl "
            "WHERE vdtl.trip_id = t.id AND vdtl.leg_number >= 2)"
        )
```

- [x] **Step 4: Correr el test y confirmar que pasa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_config_monitor.py::test_list_trips_second_leg_plus_filters_against_driver_daily_trip_legs_view -v`
Expected: PASS

- [x] **Step 5: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan (235 antes de este plan — ningún test existente cubría el query param `is_first_leg` de `list_trips` directamente, solo la columna en otros contextos, que no se tocan)

- [x] **Step 6: Verificar en vivo contra Supabase**

Vía `mcp__claude_ai_Supabase__execute_sql`, proyecto `viclzoftiudkepqnhekv` — confirmar que el `EXISTS` filtra correctamente contra un conductor con 2+ viajes ya verificado en el Plan 1 (`driver_id = '6838d16d-8c93-4b20-8a6e-ba984d6b8c3f'`, `planning_date = '2026-05-20'`, 6 viajes):

```sql
SELECT t.id, t.planning_date
FROM app.trips t
WHERE EXISTS (
    SELECT 1 FROM app.v_driver_daily_trip_legs vdtl
    WHERE vdtl.trip_id = t.id AND vdtl.leg_number >= 2
)
AND t.id IN (SELECT trip_id FROM app.v_driver_daily_trip_legs WHERE driver_id = '6838d16d-8c93-4b20-8a6e-ba984d6b8c3f' AND planning_date = '2026-05-20');
```

Expected: 5 filas (de los 6 viajes de ese conductor ese día, todos menos el de `leg_number = 1`).

- [x] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_config_monitor.py
git commit -m "feat(diario): filtro second_leg_plus reemplaza is_first_leg en GET /trips"
```

---

### Task 2: Frontend — registro unificado de señales (`alertSignals.ts`)

**Files:**
- Create: `monitor-app/frontend/lib/utils/alertSignals.ts`
- Create: `monitor-app/frontend/lib/utils/alertSignals.test.ts`

**Interfaces:**
- Consumes: `Trip`, `KpiId`, `matchesKpi`, `deriveKpis`, `DEFAULT_ALERT_RULES`, `MonitorAlertRules`, `TemperatureRangeMeta` (de `@/lib/types` y `@/lib/utils/kpis`).
- Produces: `AlertSignalId`, `AlertSignalDef`, `alertSignalDefs(rules)`, `computeSignalCounts(trips, ranges, rules)`, `severityBand(count)` — consumidos por `useDiarioFilters` (Task 3), `AlertsPopover` (Task 5) y `page.tsx` (Task 6).

- [x] **Step 1: Escribir el archivo**

```typescript
import type { Trip, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'
import { matchesKpi, deriveKpis, type KpiId, DEFAULT_ALERT_RULES } from './kpis'

/** IDs de tipo KPI (evaluados client-side sobre trips ya cargados, OR entre
 *  ellos) — mismos 6 de siempre. IDs de tipo flag (query param server-side,
 *  AND entre ellos) — 3 heredados + "2ª+ vuelta" (reemplaza a is_first_leg). */
export type FlagSignalId = 'active' | 'working' | 'assigned' | 'second_leg_plus'
export type AlertSignalId = KpiId | FlagSignalId

export const KPI_SIGNAL_IDS: KpiId[] =
  ['off_time', 'late_arrival', 'dwell', 'stale', 'temp_out', 'unassigned']
export const FLAG_SIGNAL_IDS: FlagSignalId[] =
  ['active', 'working', 'assigned', 'second_leg_plus']

export function isKpiSignal(id: AlertSignalId): id is KpiId {
  return (KPI_SIGNAL_IDS as string[]).includes(id)
}

export interface AlertSignalDef {
  id:         AlertSignalId
  label:      string
  colorCls:   string  // texto del conteo cuando > 0, ej. 'text-red-600'
  activeCls:  string  // borde/ring/bg cuando la tile está activa como filtro
}

export function alertSignalDefs(rules: MonitorAlertRules): AlertSignalDef[] {
  return [
    { id: 'off_time',     label: 'OFF TIME',                                  colorCls: 'text-red-600',    activeCls: 'border-red-400 ring-2 ring-red-100 bg-red-50' },
    { id: 'late_arrival', label: 'Atraso de llegada',                         colorCls: 'text-red-600',    activeCls: 'border-red-400 ring-2 ring-red-100 bg-red-50' },
    { id: 'dwell',        label: `Detenido en local > ${rules.dwell_hours}h`, colorCls: 'text-orange-600', activeCls: 'border-orange-400 ring-2 ring-orange-100 bg-orange-50' },
    { id: 'stale',        label: `Sin reporte > ${rules.stale_report_hours}h`, colorCls: 'text-amber-600', activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
    { id: 'temp_out',     label: 'Temp fuera de rango',                       colorCls: 'text-blue-600',   activeCls: 'border-blue-400 ring-2 ring-blue-100 bg-blue-50' },
    ...(rules.unassigned_enabled
      ? [{ id: 'unassigned' as const, label: 'Sin asignación', colorCls: 'text-violet-600', activeCls: 'border-violet-400 ring-2 ring-violet-100 bg-violet-50' }]
      : []),
    { id: 'active',           label: 'Activo',       colorCls: 'text-blue-600',   activeCls: 'border-blue-400 ring-2 ring-blue-100 bg-blue-50' },
    { id: 'working',          label: 'Trabajando',   colorCls: 'text-green-600',  activeCls: 'border-green-400 ring-2 ring-green-100 bg-green-50' },
    { id: 'assigned',         label: 'Asignado',     colorCls: 'text-violet-600', activeCls: 'border-violet-400 ring-2 ring-violet-100 bg-violet-50' },
    { id: 'second_leg_plus',  label: '2ª+ vuelta',   colorCls: 'text-amber-600',  activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
  ]
}

/** Conteo de cada señal sobre los trips ya cargados — mismo dato para las
 *  tiles pineadas y las filas del popover. Los 4 flags leen directo de
 *  columnas de Trip (mismo criterio que ya usaba page.tsx); los 6 KPI usan
 *  el evaluador existente de kpis.ts, sin duplicar esa lógica. */
export function computeSignalCounts(
  trips: Trip[],
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
): Record<AlertSignalId, number> {
  const kpiCounts = deriveKpis(trips, ranges, rules)
  return {
    ...kpiCounts,
    active:           trips.filter(t => t.is_active).length,
    working:          trips.filter(t => t.is_working).length,
    assigned:         trips.filter(t => t.is_assigned).length,
    second_leg_plus:  trips.filter(t => (t.driver_leg_number ?? 0) >= 2).length,
  }
}

/** true si el trip matchea la señal dada — usa matchesKpi para las 6 KPI,
 *  lee la columna directo para los 4 flags (mismo criterio que
 *  computeSignalCounts, para que conteo y filtro nunca diverjan). */
export function matchesSignal(
  trip: Trip,
  id: AlertSignalId,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
): boolean {
  if (isKpiSignal(id)) return matchesKpi(trip, id, ranges, rules)
  switch (id) {
    case 'active':          return trip.is_active
    case 'working':         return trip.is_working
    case 'assigned':        return trip.is_assigned
    case 'second_leg_plus': return (trip.driver_leg_number ?? 0) >= 2
  }
}

/** true si el trip pasa el conjunto de señales activas — OR entre las de
 *  tipo KPI, AND con cada flag activo. Los flags ya se filtran server-side
 *  (query params, ver page.tsx) — esta función solo importa para las de
 *  tipo KPI, que siguen siendo 100% client-side; se evalúa igual para los
 *   4 flags acá porque es barato y mantiene el resultado correcto aunque se
 *  use fuera del flujo de query params en algún caso futuro. */
export function matchesActiveSignals(
  trip: Trip,
  activeSignals: AlertSignalId[],
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
): boolean {
  const kpiActive  = activeSignals.filter(isKpiSignal)
  const flagActive = activeSignals.filter(id => !isKpiSignal(id))
  const kpiOk  = kpiActive.length === 0 || kpiActive.some(id => matchesKpi(trip, id, ranges, rules))
  const flagOk = flagActive.every(id => matchesSignal(trip, id, ranges, rules))
  return kpiOk && flagOk
}

export type SeverityBand = 'neutral' | 'elevated' | 'critical'

/** Banda simple por conteo — 0 = neutro, 1-2 = elevado, 3+ = crítico. Valores
 *  de corte fijos por ahora (no configurables), aplicados igual a las 3
 *  tiles pineadas para dar peso visual proporcional a la gravedad actual,
 *  no solo a la categoría. */
export function severityBand(count: number): SeverityBand {
  if (count >= 3) return 'critical'
  if (count >= 1) return 'elevated'
  return 'neutral'
}
```

- [x] **Step 2: Escribir los tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  alertSignalDefs, computeSignalCounts, matchesActiveSignals, severityBand,
  isKpiSignal, KPI_SIGNAL_IDS, FLAG_SIGNAL_IDS,
} from './alertSignals'
import { DEFAULT_ALERT_RULES } from './kpis'
import type { Trip } from '@/lib/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1', source_system: 'qanalytics', client_name: null, planning_date: '2026-07-18',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: null, tractor_plate_tms: null,
    trailer_plate: null, driver_name: null, driver_name_tms: null, driver_tax_id: null, driver_phone: null,
    carrier_name: null, carrier_name_tms: null, origin: null, cargo_type: null, stops: [],
    is_active: false, is_working: false, is_assigned: false, is_first_leg: false,
    manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null,
    manually_edited_fields: [], edited_at: null, edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('alertSignals', () => {
  it('alertSignalDefs returns 6 KPI + 4 flag = 10 signals when unassigned is enabled', () => {
    const defs = alertSignalDefs(DEFAULT_ALERT_RULES)
    expect(defs.map(d => d.id)).toEqual([
      'off_time', 'late_arrival', 'dwell', 'stale', 'temp_out', 'unassigned',
      'active', 'working', 'assigned', 'second_leg_plus',
    ])
  })

  it('alertSignalDefs drops unassigned when the rule is disabled, keeping 9', () => {
    const defs = alertSignalDefs({ ...DEFAULT_ALERT_RULES, unassigned_enabled: false })
    expect(defs.map(d => d.id)).not.toContain('unassigned')
    expect(defs).toHaveLength(9)
  })

  it('isKpiSignal classifies both groups correctly', () => {
    for (const id of KPI_SIGNAL_IDS) expect(isKpiSignal(id)).toBe(true)
    for (const id of FLAG_SIGNAL_IDS) expect(isKpiSignal(id)).toBe(false)
  })

  it('computeSignalCounts counts flags directly from Trip columns', () => {
    const trips = [makeTrip({ is_active: true }), makeTrip({ is_active: false })]
    const counts = computeSignalCounts(trips, [])
    expect(counts.active).toBe(1)
  })

  it('computeSignalCounts counts second_leg_plus from driver_leg_number >= 2', () => {
    const trips = [
      makeTrip({ driver_leg_number: 1 }),
      makeTrip({ driver_leg_number: 2 }),
      makeTrip({ driver_leg_number: null }),
    ]
    expect(computeSignalCounts(trips, []).second_leg_plus).toBe(1)
  })

  it('matchesActiveSignals: OR between KPI signals', () => {
    const offTimeTrip = makeTrip({ stops: [{ stop_id: 's1', local: 'A', planning_date: null, arrival_date: null, departure_date: null, departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null, on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null, temperature: null, milestone_status: null }] })
    // off_time matchea, unassigned no (tiene patente/conductor por default acá) — con ambos activos, debe matchear igual (OR)
    expect(matchesActiveSignals(offTimeTrip, ['off_time', 'unassigned'], [])).toBe(true)
  })

  it('matchesActiveSignals: AND between flag signals', () => {
    const trip = makeTrip({ is_active: true, is_working: false })
    expect(matchesActiveSignals(trip, ['active', 'working'], [])).toBe(false)
    expect(matchesActiveSignals(trip, ['active'], [])).toBe(true)
  })

  it('matchesActiveSignals: empty array matches everything', () => {
    expect(matchesActiveSignals(makeTrip(), [], [])).toBe(true)
  })

  it('severityBand bands 0/1-2/3+', () => {
    expect(severityBand(0)).toBe('neutral')
    expect(severityBand(1)).toBe('elevated')
    expect(severityBand(2)).toBe('elevated')
    expect(severityBand(3)).toBe('critical')
    expect(severityBand(10)).toBe('critical')
  })
})
```

- [x] **Step 3: Correr los tests**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/alertSignals.test.ts`
Expected: 9 passed

- [x] **Step 4: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: limpio

- [x] **Step 5: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/utils/alertSignals.ts monitor-app/frontend/lib/utils/alertSignals.test.ts
git commit -m "feat(diario): registro unificado de señales de alerta (alertSignals.ts)"
```

---

### Task 3: Frontend — unificar `useDiarioFilters` a `activeSignals`

**Files:**
- Modify: `monitor-app/frontend/hooks/useDiarioFilters.ts`
- Modify: `monitor-app/frontend/hooks/useDiarioFilters.test.ts`

**Interfaces:**
- Consumes: `AlertSignalId` (Task 2).
- Produces: `DiarioFilters.activeSignals: AlertSignalId[]` (reemplaza `kpiFilter`/`fIsActive`/`fIsWorking`/`fIsAssigned`/`fIsFirstLeg`), acción `toggleSignal` (reemplaza `toggleKpi`/`toggleFlag`) — consumido por `page.tsx` (Task 6).

- [x] **Step 1: Reescribir el test**

Reemplazar `monitor-app/frontend/hooks/useDiarioFilters.test.ts` completo:

```typescript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiarioFilters, countActiveFilters } from './useDiarioFilters'

describe('useDiarioFilters', () => {
  it('starts on en_curso with the given date and no filters', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    const [f] = result.current
    expect(f.tab).toBe('en_curso')
    expect(f.fecha).toBe('2026-07-04')
    expect(countActiveFilters(f)).toBe(0)
  })

  it('patch resets page to 1 unless page is in the patch', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { page: 3 } }))
    expect(result.current[0].page).toBe(3)
    act(() => result.current[1]({ type: 'patch', patch: { q: 'ABCD' } }))
    expect(result.current[0].page).toBe(1)
    expect(result.current[0].q).toBe('ABCD')
  })

  it('toggleGroup activates and deactivates the same key', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBe('default:en_ruta')
    act(() => result.current[1]({ type: 'toggleGroup', key: 'default:en_ruta' }))
    expect(result.current[0].activeGroup).toBeNull()
  })

  it('toggleTms adds and removes sources', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    act(() => result.current[1]({ type: 'toggleTms', id: 'sodimac' }))
    expect(result.current[0].fTms).toEqual(['wingsuite', 'sodimac'])
    act(() => result.current[1]({ type: 'toggleTms', id: 'wingsuite' }))
    expect(result.current[0].fTms).toEqual(['sodimac'])
  })

  it('toggleSignal adds and removes signals, any kind, same action', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'off_time' }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    expect(result.current[0].activeSignals).toEqual(['off_time', 'active'])
    act(() => result.current[1]({ type: 'toggleSignal', id: 'off_time' }))
    expect(result.current[0].activeSignals).toEqual(['active'])
  })

  it('clear wipes filters (incluyendo activeSignals) but keeps tab and fecha', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { q: 'x' } }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'off_time' }))
    act(() => result.current[1]({ type: 'clear' }))
    const [f] = result.current
    expect(countActiveFilters(f)).toBe(0)
    expect(f.activeSignals).toEqual([])
    expect(f.fecha).toBe('2026-07-04')
    expect(f.tab).toBe('en_curso')
  })

  it('fRegion/fCity cuentan como filtros activos y clear los resetea', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'patch', patch: { fRegion: 'Biobío', fCity: 'Concepción' } }))
    expect(countActiveFilters(result.current[0])).toBe(2)
    act(() => result.current[1]({ type: 'clear' }))
    expect(result.current[0].fRegion).toBe('')
    expect(result.current[0].fCity).toBe('')
    expect(countActiveFilters(result.current[0])).toBe(0)
  })

  it('activeSignals cuenta en activeCount, cada señal por separado', () => {
    const { result } = renderHook(() => useDiarioFilters('2026-07-04'))
    act(() => result.current[1]({ type: 'toggleSignal', id: 'stale' }))
    expect(countActiveFilters(result.current[0])).toBe(1)
    act(() => result.current[1]({ type: 'toggleSignal', id: 'active' }))
    expect(countActiveFilters(result.current[0])).toBe(2)
  })
})
```

- [x] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/frontend && npx vitest run hooks/useDiarioFilters.test.ts`
Expected: FAIL — `activeSignals`/`toggleSignal` no existen todavía

- [x] **Step 3: Reescribir `useDiarioFilters.ts`**

Reemplazar el archivo completo:

```typescript
'use client'

import { useReducer } from 'react'
import type { AlertSignalId } from '@/lib/utils/alertSignals'

export type Tab = 'en_curso' | 'historial'

export interface DiarioFilters {
  tab:            Tab
  fecha:          string
  q:              string
  fechaDesde:     string
  fechaHasta:     string
  /** 'default:id' o 'custom:id' */
  activeGroup:    string | null
  /** Unifica las 6 alertas KPI (OR entre sí) + los 4 flags operativos (AND
   *  entre sí) en un solo array — un único mecanismo de toggle sin importar
   *  el tipo de señal (Ronda 26, escalabilidad de filtros). */
  activeSignals:  AlertSignalId[]
  fTms:           string[]
  /** Ubicación de origen (dropdown región/ciudad de Chile) */
  fRegion:        string
  fCity:          string
  page:           number
}

export type DiarioFiltersAction =
  /** Cualquier cambio de filtro resetea page a 1, salvo que el patch traiga page explícito */
  | { type: 'patch'; patch: Partial<DiarioFilters> }
  | { type: 'toggleGroup'; key: string }
  | { type: 'toggleSignal'; id: AlertSignalId }
  | { type: 'toggleTms'; id: string }
  | { type: 'clear' }

function reducer(state: DiarioFilters, action: DiarioFiltersAction): DiarioFilters {
  switch (action.type) {
    case 'patch':
      return { ...state, page: 1, ...action.patch }
    case 'toggleGroup':
      return { ...state, page: 1, activeGroup: state.activeGroup === action.key ? null : action.key }
    case 'toggleSignal':
      return {
        ...state,
        page: 1,
        activeSignals: state.activeSignals.includes(action.id)
          ? state.activeSignals.filter(s => s !== action.id)
          : [...state.activeSignals, action.id],
      }
    case 'toggleTms':
      return {
        ...state,
        page: 1,
        fTms: state.fTms.includes(action.id)
          ? state.fTms.filter(t => t !== action.id)
          : [...state.fTms, action.id],
      }
    case 'clear':
      return {
        ...state,
        q: '', fechaDesde: '', fechaHasta: '', activeGroup: null,
        activeSignals: [], fTms: [], fRegion: '', fCity: '', page: 1,
      }
  }
}

export function countActiveFilters(f: DiarioFilters): number {
  return [
    f.q, f.fechaDesde, f.fechaHasta, f.activeGroup, f.fRegion, f.fCity,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length + f.activeSignals.length
}

/** Filtros que viven dentro del popover "Filtros" (para su badge contador) */
export function countPopoverFilters(f: DiarioFilters): number {
  return [
    f.fechaDesde, f.fechaHasta, f.fRegion, f.fCity,
  ].filter(v => v !== '' && v !== null).length + f.fTms.length
}

export function useDiarioFilters(initialFecha: string) {
  return useReducer(reducer, {
    tab: 'en_curso', fecha: initialFecha, q: '', fechaDesde: '', fechaHasta: '',
    activeGroup: null, activeSignals: [], fTms: [], fRegion: '', fCity: '', page: 1,
  } satisfies DiarioFilters)
}
```

Nota: `FLAGS`/`FlagField`/`BoolFilter`/`KpiId` re-export ya no se necesitan acá — `page.tsx` (Task 6) importa `AlertSignalId`/`alertSignalDefs` directo de `alertSignals.ts`.

- [x] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/frontend && npx vitest run hooks/useDiarioFilters.test.ts`
Expected: 8 passed

- [x] **Step 5: Verificar tipos (fallará en `page.tsx`, esperado — se resuelve en el Task 6)**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: errores en `page.tsx` (`kpiFilter`/`FLAGS`/`fIsActive`/etc. ya no existen) — no corregir acá, seguir al Task 6.

- [x] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/hooks/useDiarioFilters.ts monitor-app/frontend/hooks/useDiarioFilters.test.ts
git commit -m "feat(diario): unificar useDiarioFilters a activeSignals (reemplaza kpiFilter + 4 flags)"
```

---

### Task 4: Frontend — `usePinnedAlertSignals` (personalización vía localStorage)

**Files:**
- Create: `monitor-app/frontend/hooks/usePinnedAlertSignals.ts`
- Create: `monitor-app/frontend/hooks/usePinnedAlertSignals.test.ts`

**Interfaces:**
- Consumes: `AlertSignalId` (Task 2).
- Produces: hook `usePinnedAlertSignals()` → `{ pinned: AlertSignalId[], togglePin: (id: AlertSignalId) => void }` — consumido por `page.tsx`/`AlertsPopover` (Tasks 5-6).

- [x] **Step 1: Escribir el hook**

```typescript
'use client'

import { useEffect, useState } from 'react'
import type { AlertSignalId } from '@/lib/utils/alertSignals'

const STORAGE_KEY = 'diario:alertas-pineadas'
const DEFAULT_PINNED: AlertSignalId[] = ['off_time', 'unassigned', 'stale']

/** Qué señales quedan siempre visibles como tile fuera del popover "Alertas"
 *  — personalizable por usuario, persistido en localStorage. Mismo mecanismo
 *  que VIEW_MODE_STORAGE_KEY en page.tsx (sin backend, sin tabla de
 *  preferencias nueva). El preset de fábrica (OFF TIME, Sin asignación, Sin
 *  reporte) es el que ve cualquier usuario que nunca tocó el pin. */
export function usePinnedAlertSignals() {
  const [pinned, setPinned] = useState<AlertSignalId[]>(DEFAULT_PINNED)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) setPinned(parsed)
    } catch {
      // localStorage corrupto/editado a mano — se ignora, queda el default
    }
  }, [])

  function togglePin(id: AlertSignalId) {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return { pinned, togglePin }
}
```

- [x] **Step 2: Escribir los tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePinnedAlertSignals } from './usePinnedAlertSignals'

beforeEach(() => {
  localStorage.clear()
})

describe('usePinnedAlertSignals', () => {
  it('defaults to off_time/unassigned/stale when localStorage is empty', () => {
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['off_time', 'unassigned', 'stale'])
  })

  it('togglePin adds and removes, persisting to localStorage', () => {
    const { result } = renderHook(() => usePinnedAlertSignals())
    act(() => result.current.togglePin('active'))
    expect(result.current.pinned).toContain('active')
    expect(JSON.parse(localStorage.getItem('diario:alertas-pineadas')!)).toContain('active')

    act(() => result.current.togglePin('off_time'))
    expect(result.current.pinned).not.toContain('off_time')
  })

  it('reads a previously saved preference on mount', () => {
    localStorage.setItem('diario:alertas-pineadas', JSON.stringify(['dwell']))
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['dwell'])
  })

  it('ignores corrupted localStorage and keeps the default', () => {
    localStorage.setItem('diario:alertas-pineadas', 'not json{')
    const { result } = renderHook(() => usePinnedAlertSignals())
    expect(result.current.pinned).toEqual(['off_time', 'unassigned', 'stale'])
  })
})
```

- [x] **Step 3: Correr los tests**

Run: `cd monitor-app/frontend && npx vitest run hooks/usePinnedAlertSignals.test.ts`
Expected: 4 passed

- [x] **Step 4: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/hooks/usePinnedAlertSignals.ts monitor-app/frontend/hooks/usePinnedAlertSignals.test.ts
git commit -m "feat(diario): usePinnedAlertSignals — personalización de tiles fijas vía localStorage"
```

---

### Task 5: Frontend — `AlertsPopover.tsx`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/AlertsPopover.tsx`
- Create: `monitor-app/frontend/components/dashboard/AlertsPopover.test.tsx`

**Interfaces:**
- Consumes: `AlertSignalDef`/`AlertSignalId` (Task 2), `{ pinned, togglePin }` (Task 4).
- Produces: componente `AlertsPopover` — consumido por `page.tsx` (Task 6).

- [x] **Step 1: Escribir el componente**

Mismo patrón de interacción que `FilterPopover.tsx` (trigger + badge de conteo + panel posicionado + click-outside/Escape):

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, X, Star } from 'lucide-react'
import type { AlertSignalDef, AlertSignalId } from '@/lib/utils/alertSignals'

interface Props {
  defs:          AlertSignalDef[]
  counts:        Record<AlertSignalId, number>
  active:        AlertSignalId[]
  pinned:        AlertSignalId[]
  onToggle:      (id: AlertSignalId) => void
  onTogglePin:   (id: AlertSignalId) => void
}

export function AlertsPopover({ defs, counts, active, pinned, onToggle, onTogglePin }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef  = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
          active.length > 0
            ? 'text-accent border-accent/40 bg-accent/5'
            : 'text-gray-500 border-border bg-white hover:border-gray-300'
        }`}
      >
        <Bell size={13} />
        Alertas
        {active.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold bg-accent text-white rounded-full">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Alertas"
          className="absolute left-0 top-full mt-1.5 z-30 w-80 bg-white border border-border rounded-xl shadow-xl p-2 animate-modal-in"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Alertas</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar alertas"
              className="text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
            {defs.map(def => {
              const isActive = active.includes(def.id)
              const isPinned = pinned.includes(def.id)
              const count = counts[def.id] ?? 0
              return (
                <div key={def.id} className="flex items-center gap-2 px-2 py-2">
                  <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => onToggle(def.id)}
                      className="shrink-0"
                    />
                    <span className="text-xs text-gray-700 truncate">{def.label}</span>
                  </label>
                  <span className={`text-xs font-bold ${count > 0 ? def.colorCls : 'text-gray-300'}`}>{count}</span>
                  <button
                    type="button"
                    onClick={() => onTogglePin(def.id)}
                    aria-label={isPinned ? `Quitar ${def.label} de las tiles fijas` : `Fijar ${def.label} como tile visible`}
                    aria-pressed={isPinned}
                    className={`shrink-0 p-1 rounded transition-colors ${isPinned ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    <Star size={13} fill={isPinned ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 2: Escribir los tests**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertsPopover } from './AlertsPopover'
import { alertSignalDefs, type AlertSignalId } from '@/lib/utils/alertSignals'
import { DEFAULT_ALERT_RULES } from '@/lib/utils/kpis'

const defs = alertSignalDefs(DEFAULT_ALERT_RULES)
const counts = Object.fromEntries(defs.map(d => [d.id, 0])) as Record<AlertSignalId, number>

function renderPopover(props: Partial<React.ComponentProps<typeof AlertsPopover>> = {}) {
  return render(
    <AlertsPopover
      defs={defs}
      counts={{ ...counts, off_time: 5 }}
      active={[]}
      pinned={['off_time']}
      onToggle={vi.fn()}
      onTogglePin={vi.fn()}
      {...props}
    />,
  )
}

describe('AlertsPopover', () => {
  it('opens on click and lists all 10 signals with their counts', () => {
    renderPopover()
    fireEvent.click(screen.getByText('Alertas'))
    expect(screen.getByText('OFF TIME')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2ª+ vuelta')).toBeInTheDocument()
  })

  it('calls onToggle when a checkbox is clicked', () => {
    const onToggle = vi.fn()
    renderPopover({ onToggle })
    fireEvent.click(screen.getByText('Alertas'))
    fireEvent.click(screen.getByText('OFF TIME').closest('label')!.querySelector('input')!)
    expect(onToggle).toHaveBeenCalledWith('off_time')
  })

  it('calls onTogglePin when the star is clicked, without also toggling the filter', () => {
    const onToggle = vi.fn()
    const onTogglePin = vi.fn()
    renderPopover({ onToggle, onTogglePin })
    fireEvent.click(screen.getByText('Alertas'))
    fireEvent.click(screen.getByLabelText('Quitar OFF TIME de las tiles fijas'))
    expect(onTogglePin).toHaveBeenCalledWith('off_time')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows the active-count badge on the trigger button', () => {
    renderPopover({ active: ['off_time', 'active'] })
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderPopover()
    fireEvent.click(screen.getByText('Alertas'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [x] **Step 3: Correr los tests**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/AlertsPopover.test.tsx`
Expected: 5 passed

- [x] **Step 4: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: mismos errores pendientes de `page.tsx` (se resuelven en el Task 6), ninguno nuevo en `AlertsPopover.tsx`

- [x] **Step 5: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/AlertsPopover.tsx monitor-app/frontend/components/dashboard/AlertsPopover.test.tsx
git commit -m "feat(diario): componente AlertsPopover (checkbox + conteo + pin por señal)"
```

---

### Task 6: Wirear en `page.tsx`, retirar código viejo, verificación final

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`

- [x] **Step 1: Actualizar imports**

Quitar:

```typescript
import { useDiarioFilters, countActiveFilters, FLAGS, type FlagField } from '@/hooks/useDiarioFilters'
...
import { deriveKpis, matchesKpi, DEFAULT_ALERT_RULES, type KpiId } from '@/lib/utils/kpis'
```

Cambiar a:

```typescript
import { useDiarioFilters, countActiveFilters } from '@/hooks/useDiarioFilters'
...
import { DEFAULT_ALERT_RULES } from '@/lib/utils/kpis'
import {
  alertSignalDefs, computeSignalCounts, matchesActiveSignals, severityBand,
  type AlertSignalId,
} from '@/lib/utils/alertSignals'
import { usePinnedAlertSignals } from '@/hooks/usePinnedAlertSignals'
import { AlertsPopover } from '@/components/dashboard/AlertsPopover'
```

(dejar el resto de los imports tal cual — `filterGroupsApi`, `fetchTripsMeta`, `tripsApi`, componentes de tabla/tablero, etc. no cambian)

- [x] **Step 2: Quitar las constantes viejas**

Borrar por completo (hoy líneas ~58-90, verificar contra el archivo real al ejecutar):

```typescript
const FLAG_TRIP_KEY: Record<FlagField, 'is_active' | 'is_working' | 'is_assigned' | 'is_first_leg'> = { ... }
const FLAG_ACTIVE_CLS: Record<FlagField, string> = { ... }
const FLAG_COUNT_CLS: Record<FlagField, string> = { ... }

function kpiCards(rules: typeof DEFAULT_ALERT_RULES): { id: KpiId; label: string; activeCls: string; countCls: string }[] {
  ...
}
```

(`alertSignalDefs`, importado en el Step 1, reemplaza a `kpiCards` — ya no hace falta esta función local)

- [x] **Step 3: Reemplazar `kpiFilter`/`visibleTrips` por `activeSignals`/`matchesActiveSignals`**

Cambiar:

```typescript
  const KPI_CARDS = useMemo(() => kpiCards(alertRules), [alertRules])
  const kpis = useMemo(
    () => deriveKpis(trips, tripsMeta?.temperature_ranges ?? [], alertRules),
    [trips, tripsMeta?.temperature_ranges, alertRules],
  )
  const visibleTrips = useMemo(() => {
    if (f.tab !== 'en_curso' || !f.kpiFilter) return trips
    return trips.filter(t => matchesKpi(t, f.kpiFilter!, tripsMeta?.temperature_ranges ?? [], alertRules))
  }, [trips, f.tab, f.kpiFilter, tripsMeta?.temperature_ranges, alertRules])
```

Por:

```typescript
  const signalDefs = useMemo(() => alertSignalDefs(alertRules), [alertRules])
  const signalCounts = useMemo(
    () => computeSignalCounts(trips, tripsMeta?.temperature_ranges ?? [], alertRules),
    [trips, tripsMeta?.temperature_ranges, alertRules],
  )
  const { pinned, togglePin } = usePinnedAlertSignals()
  const visibleTrips = useMemo(() => {
    if (f.tab !== 'en_curso' || f.activeSignals.length === 0) return trips
    return trips.filter(t => matchesActiveSignals(t, f.activeSignals, tripsMeta?.temperature_ranges ?? [], alertRules))
  }, [trips, f.tab, f.activeSignals, tripsMeta?.temperature_ranges, alertRules])
```

- [x] **Step 4: Enviar los 4 flags como query params leyendo `activeSignals`**

Ubicar el bloque `boolParams` (hoy lee `f.fIsActive`/etc.):

```typescript
  const boolParams = {
    ...(f.fIsActive   != null ? { is_active:    f.fIsActive }   : {}),
    ...(f.fIsWorking  != null ? { is_working:   f.fIsWorking }  : {}),
    ...(f.fIsAssigned != null ? { is_assigned:  f.fIsAssigned } : {}),
    ...(f.fIsFirstLeg != null ? { is_first_leg: f.fIsFirstLeg } : {}),
  }
```

Cambiar a:

```typescript
  const boolParams = {
    ...(f.activeSignals.includes('active')          ? { is_active:        true } : {}),
    ...(f.activeSignals.includes('working')         ? { is_working:       true } : {}),
    ...(f.activeSignals.includes('assigned')        ? { is_assigned:      true } : {}),
    ...(f.activeSignals.includes('second_leg_plus') ? { second_leg_plus:  true } : {}),
  }
```

`TripListParams`/`tripsApi.list` (en `lib/api/trips.ts`) usan hoy la key `is_first_leg` para ese query param — renombrar a `second_leg_plus` ahí también (mismo archivo tocado en el Task 1 del lado backend, ahora el lado frontend):

```typescript
    is_first_leg?:   boolean
```

**Cuidado**: `is_first_leg` aparece **3 veces** en `lib/api/trips.ts`, no 2 — la de `export type TripPatch = { ... is_first_leg?: boolean ... }` (línea ~15) es el campo para editar manualmente la columna real desde `IndicatorDots.tsx` (el toggle "1V" dentro del detalle del viaje, `PATCH /trips/{id}`) — **esa NO se toca**, es un feature distinto que sigue editando `app.trips.is_first_leg` sin relación con este filtro (mismo criterio que el Global Constraint de este plan). Solo cambian las 2 apariciones dentro de `TripListParams`/el método `list()` (query param de filtro de listado): el campo `is_first_leg?: boolean` dentro de la firma de `list: (params?: {...})` y el bloque `if (params?.is_first_leg != null) qs.set('is_first_leg', String(params.is_first_leg))` — ambas cambian a `second_leg_plus`.

- [x] **Step 5: Reemplazar el render de las 2 filas (KPI_CARDS + FLAGS) por tiles pineadas + AlertsPopover + chips**

Ubicar el bloque completo (hoy desde `{/* ── KPIs accionables ── */}` hasta el `</div>` que cierra la fila de FLAGS, antes de `{/* ── Barra de filtros compacta ── */}`) y reemplazarlo por:

```tsx
          {/* ── Alertas: 3 tiles pineadas (severidad visual) + popover para
              el resto — reemplaza las 2 filas crecientes de KPI cards/flags
              (Ronda 26, escalabilidad de filtros). Estado no se toca, sigue
              como fila separada más abajo — es la dimensión de navegación
              primaria, no una alerta. */}
          {f.tab === 'en_curso' && !loading && (
            <div className="flex items-center gap-2 flex-wrap">
              {signalDefs.filter(d => pinned.includes(d.id)).map(def => {
                const count  = signalCounts[def.id] ?? 0
                const active = f.activeSignals.includes(def.id)
                const band   = severityBand(count)
                return (
                  <button
                    key={def.id}
                    onClick={() => dispatch({ type: 'toggleSignal', id: def.id })}
                    disabled={count === 0 && !active}
                    aria-pressed={active}
                    className={`flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2 transition-all disabled:opacity-40 disabled:cursor-default ${
                      active ? def.activeCls : band === 'critical' ? 'border-gray-300' : 'border-border hover:border-gray-300'
                    }`}
                  >
                    <span className={`leading-none font-bold ${
                      band === 'neutral'  ? 'text-sm text-gray-300' :
                      band === 'elevated' ? `text-base ${def.colorCls}` :
                                             `text-lg ${def.colorCls}`
                    }`}>
                      {count}
                    </span>
                    <span className="text-[11px] font-medium text-gray-500">{def.label}</span>
                    {active && <X size={11} className="text-gray-400" />}
                  </button>
                )
              })}

              <AlertsPopover
                defs={signalDefs}
                counts={signalCounts}
                active={f.activeSignals}
                pinned={pinned}
                onToggle={id => dispatch({ type: 'toggleSignal', id })}
                onTogglePin={togglePin}
              />

              {f.activeSignals.filter(id => !pinned.includes(id)).map(id => {
                const def = signalDefs.find(d => d.id === id)
                if (!def) return null
                return (
                  <span key={id} className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent bg-accent/10 rounded-full pl-2.5 pr-1.5 py-1">
                    {def.label}
                    <button type="button" onClick={() => dispatch({ type: 'toggleSignal', id })} aria-label={`Quitar filtro ${def.label}`}>
                      <X size={11} />
                    </button>
                  </span>
                )
              })}

              {/* Conductores disponibles hoy — atajo directo a crear viaje,
                  con la lista ya sugerida dentro del diálogo (Ronda 26) */}
              {availableCount > 0 && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 bg-white border border-green-200 rounded-xl px-3.5 py-2 transition-all hover:border-green-400 ml-auto"
                >
                  <UserCheck size={14} className="text-green-600" />
                  <span className="text-lg font-bold leading-none text-green-600">{availableCount}</span>
                  <span className="text-[11px] font-medium text-gray-500">
                    conductor{availableCount !== 1 ? 'es' : ''} disponible{availableCount !== 1 ? 's' : ''}
                  </span>
                </button>
              )}
            </div>
          )}
```

Nota: el comentario/bloque `{/* ── Indicadores como tabs de filtro (Fase 3...) ── */}` con el `FLAGS.map(...)` completo se borra entero — queda reemplazado por lo de arriba.

- [x] **Step 6: Verificación completa**

Run, en orden:
```bash
cd monitor-app/frontend
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: los 3 comandos limpios. Confirmar además `grep -rn "kpiFilter\|fIsActive\|fIsWorking\|fIsAssigned\|fIsFirstLeg\|FlagField\|kpiCards\b" --include="*.tsx" --include="*.ts" .` devuelve 0 resultados (salvo, si aparece, un comentario histórico inofensivo — revisar caso por caso, no debería haber ninguno funcional).

- [x] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/app/dashboard/diario/page.tsx monitor-app/frontend/lib/api/trips.ts
git commit -m "feat(diario): wirear tiles pineadas + AlertsPopover en page.tsx, retirar KPI_CARDS/FLAGS"
```

---

## Self-Review

**1. Cobertura del spec**: cubre íntegramente la sección "3. Escalabilidad de filtros" — popover unificado, OR entre alertas/AND con flags, 3 tiles pineadas por default, personalización vía localStorage, jerarquía visual por severidad. "Estado" no se toca (confirmado en Global Constraints). Contexto de tendencia queda explícitamente fuera (fast-follow ya documentado).
**2. Placeholders**: ninguno — cada paso tiene código completo. Las referencias a "líneas ~58-90, verificar contra el archivo real" en el Task 6 Step 2 no son placeholders — es una instrucción de ubicar contenido exacto ya mostrado en este mismo plan (visto en la sesión que lo escribió), con la salvedad honesta de que el número de línea puede haber corrido levemente por ediciones previas de los Planes 1-2.
**3. Consistencia de tipos**: `AlertSignalId` se usa igual en `alertSignals.ts` (Task 2), `useDiarioFilters.ts` (Task 3), `usePinnedAlertSignals.ts` (Task 4), `AlertsPopover.tsx` (Task 5) y `page.tsx` (Task 6). `second_leg_plus` como nombre de query param es igual en el backend (Task 1) y en `boolParams`/`lib/api/trips.ts` (Task 6).
**4. Alcance**: depende del Plan 1 (`driver_leg_number`/`app.v_driver_daily_trip_legs`, ya cerrado) para el filtro "2ª+ vuelta" — sin eso, esa única señal quedaría siempre en 0. Independiente del Plan 2 (`TripAssignDialog`) — no lo toca ni depende de él.
**5. Riesgo identificado y ya resuelto en el diseño**: `driver_leg_number` es un alias de `SELECT`, no una columna real — no se puede filtrar en el mismo nivel de `WHERE` sin repetir la subconsulta o usar `EXISTS` contra la vista (Task 1, Step 3) — evita el mismo tipo de error de "alias no visible en WHERE" que hubiera fallado en producción con un error real de Postgres, no silenciosamente.
