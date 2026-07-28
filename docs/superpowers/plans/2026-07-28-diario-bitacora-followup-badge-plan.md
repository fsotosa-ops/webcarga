# Badge "necesita seguimiento en bitácora" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a badge in the Diario's trip table only when a trip has an active automatic alert (late arrival, dwell, stale report, or temperature out of range) that no human has followed up on in the bitácora yet, and let clicking it open the trip's detail scrolled straight to the Bitácora section.

**Architecture:** Backend adds one aggregate column (`last_human_note_at`) to the existing trips list/get query via a `LEFT JOIN LATERAL`, mirroring the pattern already used for `insurance_alert`. Frontend derives, per trip and per active KPI, the exact timestamp that triggered it (reusing the existing `matchesKpi` logic instead of duplicating it), compares the most recent of those against `last_human_note_at`, and renders a badge only when the alert is newer than the last human note.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js/React + TypeScript + Vitest + Testing Library (frontend). No new dependencies.

## Global Constraints

- No new backend endpoint or query param — one new column on the existing trips list/get query.
- `note_type = 'sistema'` (auto-generated notes, e.g. "Divergencia TMS: ...") must never count as a human follow-up.
- Only 4 KPIs are in scope for this badge: `late_arrival`, `dwell`, `stale`, `temp_out`. `unassigned`, `fleet_unmatched`, `off_time` are explicitly out of scope (see spec, section "Afuera").
- The badge must be completely absent (not rendered, not a neutral/zero state) when a trip doesn't need follow-up — this table already has `PendingDocsBadge`, which was deliberately designed the same way to avoid saturating rows.
- Any human note (llamada/whatsapp/observación/incidente) counts as follow-up — not only `note_type='incidente'`.
- Full spec: `docs/superpowers/specs/2026-07-28-diario-bitacora-followup-badge-design.md`.

---

## Task 1: Backend — expose `last_human_note_at` on the trips query

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:276-283` (`_TRIP_SELECT`), `:399-410` (`_TRIP_FROM`)
- Test: Create `monitor-app/backend/api/tests/test_trip_bitacora_followup_field.py`

**Interfaces:**
- Produces: every row returned by `GET /api/v1/trips` and `GET /api/v1/trips/{id}` gains a key `last_human_note_at: str | None` (ISO timestamp string or `None`), consumed by Task 3's frontend logic via the `Trip` type.

- [ ] **Step 1: Write the failing test**

Create `monitor-app/backend/api/tests/test_trip_bitacora_followup_field.py`:

```python
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None, "last_human_note_at": "2026-07-28T10:00:00+00:00"}
    pool.fetch.return_value = []  # _load_trip_stops / _load_operation_type_buckets
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_trip_select_queries_last_human_note_at():
    pool = make_pool()
    client = make_client(pool)
    client.get("/api/v1/trips/trip-1")
    query = pool.fetchrow.call_args.args[0]
    assert "last_human_note_at" in query
    assert "note_type != 'sistema'" in query


def test_get_trip_endpoint_returns_last_human_note_at():
    pool = make_pool()
    client = make_client(pool)
    res = client.get("/api/v1/trips/trip-1")
    assert res.status_code == 200
    assert res.json()["last_human_note_at"] == "2026-07-28T10:00:00+00:00"


def test_get_trip_endpoint_returns_null_when_no_human_notes():
    pool = make_pool()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None, "last_human_note_at": None}
    client = make_client(pool)
    res = client.get("/api/v1/trips/trip-1")
    assert res.json()["last_human_note_at"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_trip_bitacora_followup_field.py -v`
Expected: FAIL — `last_human_note_at` not in query / `KeyError: 'last_human_note_at'` on the response JSON.

- [ ] **Step 3: Add the lateral join and the SELECT column**

In `monitor-app/backend/api/app/routers/trips.py`, inside `_TRIP_FROM` (the string that starts at line 362), add a new lateral immediately after the existing `ins` lateral closes (after the line `    ) ins ON true` at line 407) and before the `+ _compliance_alert_lateral(...)` chain:

```python
    LEFT JOIN LATERAL (
        SELECT MAX(created_at) AS last_human_note_at
        FROM app.trip_notes
        WHERE trip_id = t.id AND note_type != 'sistema'
    ) notes ON true
""" + _compliance_alert_lateral("dcomp", "DRIVER", "vfr.resolved_driver_id", _DRIVER_CRITICAL_DOC_CODES) \
```

(Note: only the new `LEFT JOIN LATERAL` block is added — the `_compliance_alert_lateral(...)` chain that follows it already exists, keep it as-is; the `"""` that used to close `_TRIP_FROM` right before that chain moves to close after the new lateral instead.)

In `_TRIP_SELECT` (the string starting at line 201), add one line right before the closing `"""` at line 283:

```python
    ccomp.pending_count AS carrier_pending_docs,
    ccomp.has_critical_pending AS carrier_pending_docs_critical,
    notes.last_human_note_at
"""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_trip_bitacora_followup_field.py -v`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Run the full backend suite to check nothing broke**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/ -q`
Expected: PASS, same count as before + 3 new tests. `_TRIP_FROM`/`_TRIP_SELECT` are shared by `list_trips` and `get_trip` — this also implicitly covers the list endpoint's query shape.

- [ ] **Step 6: Verify the query against the real database before committing**

Per project convention (SQL changes have broken on real Postgres despite passing `AsyncMock` tests before — e.g. `max(uuid)`, non-existent columns), run the modified query directly against the real database with the Supabase MCP `execute_sql` tool:

```sql
SELECT t.id, notes.last_human_note_at
FROM app.trips t
LEFT JOIN LATERAL (
    SELECT MAX(created_at) AS last_human_note_at
    FROM app.trip_notes
    WHERE trip_id = t.id AND note_type != 'sistema'
) notes ON true
LIMIT 5;
```

Expected: runs without error, returns a mix of real timestamps and `NULL`.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_bitacora_followup_field.py
git commit -m "feat(api): expose last_human_note_at on trips list/get"
```

---

## Task 2: Frontend — extract `getLatestTempStop` in `temperature.ts`

Today `getLatestTemp` picks a temperature value using fallback logic (active stop first, then most recently visited stop with a non-null reading) but only returns the number — Task 3 needs the *stop* that reading came from, to anchor `temp_out`'s timestamp. Extracting the stop-picking logic avoids duplicating it.

**Files:**
- Modify: `monitor-app/frontend/lib/utils/temperature.ts:13-22`
- Test: Modify `monitor-app/frontend/lib/utils/temperature.test.ts`

**Interfaces:**
- Produces: `getLatestTempStop(stops: TripStop[]): TripStop | null`, exported. `getLatestTemp` keeps its exact existing signature and behavior (`(stops: TripStop[]) => number | null`).
- Consumes (Task 3): `getLatestTempStop`, `stopWasVisited` is unaffected.

- [ ] **Step 1: Write the failing test**

Add to `monitor-app/frontend/lib/utils/temperature.test.ts` (uses the `makeStop` helper already defined at the top of that file):

```ts
import { getLatestTemp, getLatestTempStop } from './temperature'

describe('getLatestTempStop', () => {
  it('returns the active stop when it has a temperature reading', () => {
    const active = makeStop({ stop_id: 'active', arrival_date: '2026-07-28 10:00:00', temperature: 3 })
    expect(getLatestTempStop([active])?.stop_id).toBe('active')
  })

  it('falls back to the most recently visited stop with a reading', () => {
    const noTemp = makeStop({ stop_id: 'current', arrival_date: '2026-07-28 12:00:00', temperature: null })
    const visited = makeStop({ stop_id: 'visited', arrival_date: '2026-07-28 09:00:00', departure_date: '2026-07-28 10:00:00', temperature: 4 })
    expect(getLatestTempStop([visited, noTemp])?.stop_id).toBe('visited')
  })

  it('returns null when no stop has a temperature reading', () => {
    expect(getLatestTempStop([makeStop({ arrival_date: '2026-07-28 10:00:00' })])).toBeNull()
  })

  it('getLatestTemp still returns the same value as before the refactor', () => {
    const stop = makeStop({ arrival_date: '2026-07-28 10:00:00', temperature: 3 })
    expect(getLatestTemp([stop])).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/temperature.test.ts`
Expected: FAIL — `getLatestTempStop` is not exported.

- [ ] **Step 3: Extract the function**

In `monitor-app/frontend/lib/utils/temperature.ts`, replace lines 13-22:

```ts
// Returns the temperature at the active stop (current reading).
// Falls back to the most recently visited stop if the active stop has no temp.
export function getLatestTemp(stops: TripStop[]): number | null {
  const active = getActiveStop(stops)
  if (active?.temperature != null) return active.temperature
  const visited = stops.filter(s => s.arrival_date || s.gps_arrival_date)
  for (let i = visited.length - 1; i >= 0; i--) {
    if (visited[i].temperature != null) return visited[i].temperature!
  }
  return null
}
```

with:

```ts
// Returns the stop whose temperature reading is "the current one" — active
// stop first, falling back to the most recently visited stop with a
// non-null reading. Extracted from getLatestTemp so callers that need the
// stop itself (not just the number, e.g. to anchor a timestamp) don't have
// to duplicate this fallback order.
export function getLatestTempStop(stops: TripStop[]): TripStop | null {
  const active = getActiveStop(stops)
  if (active?.temperature != null) return active
  const visited = stops.filter(s => s.arrival_date || s.gps_arrival_date)
  for (let i = visited.length - 1; i >= 0; i--) {
    if (visited[i].temperature != null) return visited[i]
  }
  return null
}

// Returns the temperature at the active stop (current reading).
// Falls back to the most recently visited stop if the active stop has no temp.
export function getLatestTemp(stops: TripStop[]): number | null {
  return getLatestTempStop(stops)?.temperature ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/temperature.test.ts`
Expected: PASS (all tests, including pre-existing `describeStopTiming` ones)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/temperature.ts monitor-app/frontend/lib/utils/temperature.test.ts
git commit -m "refactor(diario): extract getLatestTempStop from getLatestTemp"
```

---

## Task 3: Frontend — `kpiAnchorTimestamp` and `needsBitacoraFollowup` in `kpis.ts`

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (add field to `Trip`)
- Modify: `monitor-app/frontend/lib/utils/kpis.ts`
- Test: Modify `monitor-app/frontend/lib/utils/kpis.test.ts`

**Interfaces:**
- Consumes: `getLatestTempStop` (Task 2), `matchesKpi`/`isOpenTrip`/`toMs`/`stopArrival`/`stopDeparture`/`DEFAULT_ALERT_RULES` (already in this file).
- Produces:
  - `kpiAnchorTimestamp(trip: Trip, kpi: KpiId, ranges: TemperatureRangeMeta[], rules?: MonitorAlertRules, now?: number): number | null` — exported. Returns non-null exactly when `matchesKpi` would return `true` for the same arguments (same thresholds re-applied, not just "does some stop lack this timestamp") — a trip with two candidate stops where only one has actually crossed the threshold must anchor on that one, not on whichever stop happens to come first in the array.
  - `needsBitacoraFollowup(trip: Trip, ranges: TemperatureRangeMeta[], rules?: MonitorAlertRules, now?: number): boolean` — exported. Consumed by Task 7 (`TripTable.tsx`).
  - `Trip.last_human_note_at?: string | null` — new optional field, consumed by Task 7 and by this task's own logic.

- [ ] **Step 1: Add the field to the `Trip` type**

In `monitor-app/frontend/lib/types.ts`, find the `insurance_alert?:` line (around line 387) and add immediately after the pending-docs block that follows it (around line 398, after `carrier_pending_docs_critical?: boolean | null`):

```ts
  /** Nota humana más reciente en la bitácora del viaje (excluye notas
   *  note_type='sistema') — usado para saber si una alerta activa ya tuvo
   *  seguimiento. Ver kpis.ts:needsBitacoraFollowup. */
  last_human_note_at?: string | null
```

- [ ] **Step 2: Write the failing tests**

First, extend the existing import line at the top of `monitor-app/frontend/lib/utils/kpis.test.ts` (currently `import { deriveKpis, matchesKpi, DEFAULT_ALERT_RULES, isOpenTrip } from './kpis'`) to also pull in the two new functions:

```ts
import { deriveKpis, matchesKpi, DEFAULT_ALERT_RULES, isOpenTrip, kpiAnchorTimestamp, needsBitacoraFollowup } from './kpis'
```

Then add the following (uses the `makeTrip`/`makeStop`/`RANGES`/`RULES`/`NOW` fixtures already defined at the top of that file):

```ts
describe('kpiAnchorTimestamp', () => {
  it('late_arrival: anchors on the overdue stop\'s planning_date', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ planning_date: '2026-07-04 10:00:00' })], // 8h before NOW, past 60min grace
    })
    expect(kpiAnchorTimestamp(trip, 'late_arrival', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T10:00:00Z'))
  })

  it('late_arrival: does not anchor on a stop that has a plan but has not exceeded the grace period yet', () => {
    const notYetLate = makeStop({ stop_id: 's1', planning_date: '2026-07-04 17:30:00' }) // 30min before NOW, under 60min grace
    const trip = makeTrip('a', { stops: [notYetLate] })
    expect(kpiAnchorTimestamp(trip, 'late_arrival', RANGES, RULES, NOW)).toBeNull()
  })

  it('late_arrival: with two candidate stops, anchors on the one that is actually overdue, not the first in the array', () => {
    const notYetLate = makeStop({ stop_id: 's1', planning_date: '2026-07-04 17:30:00' }) // under grace
    const overdue    = makeStop({ stop_id: 's2', planning_date: '2026-07-04 10:00:00' }) // well past grace
    const trip = makeTrip('a', { stops: [notYetLate, overdue] })
    expect(kpiAnchorTimestamp(trip, 'late_arrival', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T10:00:00Z'))
  })

  it('dwell: anchors on the stuck stop\'s arrival_date', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: null })], // 3h before NOW
    })
    expect(kpiAnchorTimestamp(trip, 'dwell', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T15:00:00Z'))
  })

  it('dwell: does not anchor when the stop has not been stuck past the threshold yet', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ arrival_date: '2026-07-04 17:30:00', departure_date: null })], // 30min before NOW, under 2h dwell_hours
    })
    expect(kpiAnchorTimestamp(trip, 'dwell', RANGES, RULES, NOW)).toBeNull()
  })

  it('stale: anchors on status_reported_at', () => {
    const trip = makeTrip('a', { status_reported_at: '2026-07-04 15:00:00' }) // 3h before NOW
    expect(kpiAnchorTimestamp(trip, 'stale', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T15:00:00Z'))
  })

  it('temp_out: anchors on the reporting stop\'s arrival_date', () => {
    const trip = makeTrip('a', {
      cargo_type: 'FRIO',
      stops: [makeStop({ arrival_date: '2026-07-04 16:00:00', temperature: 9 })], // out of 2-5 range
    })
    expect(kpiAnchorTimestamp(trip, 'temp_out', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T16:00:00Z'))
  })

  it('returns null when the KPI is not actually active', () => {
    const trip = makeTrip('a', { status_reported_at: '2026-07-04 17:50:00' }) // 10min before NOW, not stale
    expect(kpiAnchorTimestamp(trip, 'stale', RANGES, RULES, NOW)).toBeNull()
  })

  it('returns null for KPIs outside the followup badge scope', () => {
    const trip = makeTrip('a', { tractor_plate: null, trailer_plate: null, driver_name: null })
    expect(kpiAnchorTimestamp(trip, 'unassigned', RANGES, RULES, NOW)).toBeNull()
  })

  it('matches matchesKpi exactly: anchor is non-null if and only if matchesKpi is true', () => {
    for (const kpi of ['late_arrival', 'dwell', 'stale', 'temp_out'] as const) {
      const trip = makeTrip('a', {
        status_reported_at: '2026-07-04 15:00:00',
        stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: null, planning_date: '2026-07-04 10:00:00', temperature: 9 })],
        cargo_type: 'FRIO',
      })
      const anchor = kpiAnchorTimestamp(trip, kpi, RANGES, RULES, NOW)
      expect(anchor != null).toBe(matchesKpi(trip, kpi, RANGES, RULES, NOW))
    }
  })
})

describe('needsBitacoraFollowup', () => {
  it('false when no in-scope KPI is active', () => {
    const trip = makeTrip('a', { last_human_note_at: null })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(false)
  })

  it('true when a KPI is active and there is no human note at all', () => {
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 15:00:00', // stale, 3h before NOW
      last_human_note_at: null,
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(true)
  })

  it('false when a human note came after the alert started', () => {
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 15:00:00', // stale, 3h before NOW
      last_human_note_at: '2026-07-04T16:00:00Z', // 1h after the alert's anchor
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(false)
  })

  it('true when the last human note predates the alert', () => {
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 15:00:00', // stale, anchor 15:00
      last_human_note_at: '2026-07-04T12:00:00Z', // note is older than the alert
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(true)
  })

  it('reopens when a second alert fires after the note that covered the first one', () => {
    // stale since 14:00 (4h before NOW, past the 2h threshold); note at 14:30 covers it.
    // dwell since 15:00 (3h before NOW, also past its 2h threshold) fires AFTER that note —
    // latest anchor becomes 15:00, which the 14:30 note does not cover.
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 14:00:00',
      stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: null })],
      last_human_note_at: '2026-07-04T14:30:00Z',
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/kpis.test.ts`
Expected: FAIL — `kpiAnchorTimestamp`/`needsBitacoraFollowup` are not exported.

- [ ] **Step 4: Implement**

In `monitor-app/frontend/lib/utils/kpis.ts`:

1. Update the import line at the top to add `getLatestTempStop`:

```ts
import { getLatestTemp, getLatestTempStop, classifyTemperature } from './temperature'
```

2. Add, after `matchesKpi` (after its closing `}` — end of the function that starts at line 37):

```ts
/** Los mismos 4 KPIs que puede disparar el badge de bitácora (ver
 *  needsBitacoraFollowup) — unassigned/fleet_unmatched no tienen un ancla
 *  temporal natural, off_time ya está cubierto en la práctica por
 *  late_arrival/dwell. */
const FOLLOWUP_KPI_IDS: KpiId[] = ['late_arrival', 'dwell', 'stale', 'temp_out']

/** Timestamp (ms) desde el que un KPI activo lleva sonando. Re-aplica el
 *  mismo umbral que matchesKpi usa para decidir si el KPI está activo (no
 *  alcanza con "hay un stop sin este dato" — si hay varios stops candidatos
 *  y solo uno cruzó el umbral, el ancla tiene que ser la de ESE, no la del
 *  primero del arreglo). Es una duplicación deliberada y acotada a estos 4
 *  casos — no se tocó matchesKpi (usado también por tiles/filtros/conteos
 *  en todo el Diario) para no ampliar el blast radius de este cambio; el
 *  test "matches matchesKpi exactly" de abajo existe para que estas dos
 *  implementaciones no se desalineen en silencio. Devuelve null para los 3
 *  KPIs sin ancla temporal (unassigned, fleet_unmatched, off_time). */
export function kpiAnchorTimestamp(
  trip: Trip,
  kpi: KpiId,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): number | null {
  switch (kpi) {
    case 'late_arrival': {
      if (!isOpenTrip(trip)) return null
      for (const s of trip.stops ?? []) {
        if (stopArrival(s) != null) continue
        const plan = toMs(s.planning_date)
        if (plan != null && now - plan > rules.late_arrival_grace_min * 60_000) return plan
      }
      return null
    }

    case 'dwell': {
      if (!isOpenTrip(trip)) return null
      for (const s of trip.stops ?? []) {
        const arr = stopArrival(s)
        if (arr != null && stopDeparture(s) == null && now - arr > rules.dwell_hours * 3600_000) return arr
      }
      return null
    }

    case 'stale': {
      if (!isOpenTrip(trip)) return null
      const t = toMs(trip.status_reported_at)
      if (t == null || now - t <= rules.stale_report_hours * 3600_000) return null
      return t
    }

    case 'temp_out': {
      const stop = getLatestTempStop(trip.stops ?? [])
      if (!stop) return null
      if (classifyTemperature(stop.temperature ?? null, trip.cargo_type, ranges) !== 'out_of_range') return null
      return stopArrival(stop)
    }

    default:
      return null
  }
}

/** true si el viaje tiene alguna de las 4 alertas en alcance (ver
 *  FOLLOWUP_KPI_IDS) activa y ningún humano dejó una nota en la bitácora
 *  desde que esa alerta empezó a sonar. Si hay más de una alerta activa a
 *  la vez, compara contra la más reciente — si una nota ya cubrió la más
 *  vieja pero apareció una alerta nueva después, vuelve a pedir
 *  seguimiento. Notas note_type='sistema' no cuentan (ya excluidas por el
 *  backend en last_human_note_at). No hace falta llamar matchesKpi acá:
 *  kpiAnchorTimestamp ya devuelve null exactamente cuando matchesKpi
 *  devolvería false, para los 4 KPIs en alcance. */
export function needsBitacoraFollowup(
  trip: Trip,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): boolean {
  let latestAnchor: number | null = null
  for (const kpi of FOLLOWUP_KPI_IDS) {
    const anchor = kpiAnchorTimestamp(trip, kpi, ranges, rules, now)
    if (anchor != null && (latestAnchor == null || anchor > latestAnchor)) {
      latestAnchor = anchor
    }
  }
  if (latestAnchor == null) return false
  const lastNote = toMs(trip.last_human_note_at)
  return lastNote == null || lastNote < latestAnchor
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd monitor-app/frontend && npx vitest run lib/utils/kpis.test.ts`
Expected: PASS (all tests, including all pre-existing `matchesKpi`/`deriveKpis`/`isOpenTrip` ones)

- [ ] **Step 6: Type-check**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: no errors (confirms the new optional `Trip.last_human_note_at` field doesn't break any existing object literal).

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/utils/kpis.ts monitor-app/frontend/lib/utils/kpis.test.ts
git commit -m "feat(diario): add kpiAnchorTimestamp and needsBitacoraFollowup"
```

---

## Task 4: Frontend — `BitacoraFollowupBadge` component

**Files:**
- Create: `monitor-app/frontend/components/ui/BitacoraFollowupBadge.tsx`
- Test: Create `monitor-app/frontend/components/ui/BitacoraFollowupBadge.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure presentational component).
- Produces: `BitacoraFollowupBadge({ show, onClick, compact }: { show: boolean; onClick: (e: React.MouseEvent) => void; compact?: boolean })`, consumed by Task 7 (`TripTable.tsx`).

- [ ] **Step 1: Write the failing test**

Create `monitor-app/frontend/components/ui/BitacoraFollowupBadge.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BitacoraFollowupBadge } from './BitacoraFollowupBadge'

describe('BitacoraFollowupBadge', () => {
  it('renders nothing when show is false', () => {
    render(<BitacoraFollowupBadge show={false} onClick={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a button when show is true', () => {
    render(<BitacoraFollowupBadge show onClick={vi.fn()} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<BitacoraFollowupBadge show onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('compact variant still renders a clickable button', () => {
    const onClick = vi.fn()
    render(<BitacoraFollowupBadge show onClick={onClick} compact />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd monitor-app/frontend && npx vitest run components/ui/BitacoraFollowupBadge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `monitor-app/frontend/components/ui/BitacoraFollowupBadge.tsx`:

```tsx
'use client'

import { MessageCircleWarning } from 'lucide-react'

/** Aparece solo cuando un viaje tiene una alerta activa (late_arrival/
 *  dwell/stale/temp_out) sin ninguna nota humana en la bitácora desde que
 *  empezó — ver needsBitacoraFollowup en lib/utils/kpis.ts. A propósito NO
 *  hereda el color de la alerta que lo disparó: representa un concepto
 *  distinto ("nadie dejó nota todavía"), no una alerta específica, y no hay
 *  un orden de severidad definido entre las 4 que puedan dispararlo. Se
 *  oculta por completo cuando show=false — nunca un estado neutro visible,
 *  mismo criterio que ya usa PendingDocsBadge para no saturar la tabla. */
interface Props {
  show:     boolean
  onClick:  (e: React.MouseEvent) => void
  compact?: boolean
}

export function BitacoraFollowupBadge({ show, onClick, compact = false }: Props) {
  if (!show) return null
  const title = 'Hay una alerta activa sin seguimiento en la bitácora — click para abrir'

  if (compact) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-50 text-amber-600 shrink-0 hover:bg-amber-100"
      >
        <MessageCircleWarning size={9} />
      </button>
    )
  }

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-amber-50 text-amber-600 hover:bg-amber-100"
    >
      <MessageCircleWarning size={9} /> Sin seguimiento
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd monitor-app/frontend && npx vitest run components/ui/BitacoraFollowupBadge.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/ui/BitacoraFollowupBadge.tsx monitor-app/frontend/components/ui/BitacoraFollowupBadge.test.tsx
git commit -m "feat(diario): add BitacoraFollowupBadge component"
```

---

## Task 5: Frontend — `TripSlideOver` scrolls to Bitácora on demand

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx:49-56` (Props/signature), `:902-909` (Bitácora section)
- Test: Modify `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx`

**Interfaces:**
- Produces: `TripSlideOver` gains an optional prop `focusNotes?: boolean`. When `true` and `trip` is set, scrolls the Bitácora section into view on mount/trip-change. Consumed by Task 6 (`page.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx` (reuses the `baseTrip`/`makeStop`/mocked `tripsApi`/`QueryClientProvider` wrapper already set up at the top of that file — check how existing tests render the component, e.g. via a `renderSlideOver(props)` helper if one exists, otherwise wrap with `<QueryClientProvider client={new QueryClient()}>` same as the rest of the file):

```tsx
it('scrolls the Bitácora section into view when focusNotes is true', () => {
  const scrollIntoViewMock = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoViewMock
  vi.mocked(tripsApi.listNotes).mockResolvedValue([])

  renderSlideOver({ trip: baseTrip, focusNotes: true })

  expect(scrollIntoViewMock).toHaveBeenCalled()
})

it('does not scroll when focusNotes is false or omitted', () => {
  const scrollIntoViewMock = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoViewMock
  vi.mocked(tripsApi.listNotes).mockResolvedValue([])

  renderSlideOver({ trip: baseTrip })

  expect(scrollIntoViewMock).not.toHaveBeenCalled()
})
```

(Use whatever render helper/wrapper the existing tests in this file already use to pass `trip`/`onClose`/`onSaved`/`meta` — match that exact call shape, just adding `focusNotes` to the props object.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripSlideOver.test.tsx -t "focusNotes"`
Expected: FAIL — `scrollIntoView` never called (prop doesn't exist yet, is ignored).

- [ ] **Step 3: Implement**

In `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`:

1. Update the `Props` interface (lines 49-54) and function signature (line 56):

```ts
interface Props {
  trip:        Trip | null
  onClose:     () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
}

export function TripSlideOver({ trip, onClose, onSaved, meta, focusNotes = false }: Props) {
```

2. Add a ref near the other refs at the top of the component (alongside `panelRef` — find its declaration a few lines below the signature and add next to it):

```ts
  const notesRef = useRef<HTMLElement>(null)
```

3. Add a new `useEffect`, right after the existing focus-trap `useEffect` (the one ending at line 116 with `}, [trip?.id, onClose])`):

```ts
  // Ítem 6.5 de la minuta (10/07): el badge de la tabla principal abre el
  // detalle directo en la Bitácora en vez de que el operador tenga que
  // scrollear a buscarla — no hay tabs en este panel, así que "abrir en la
  // Bitácora" es llevar el scroll ahí, no cambiar de vista.
  useEffect(() => {
    if (!trip || !focusNotes) return
    notesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [trip?.id, focusNotes])
```

4. Attach the ref to the Bitácora `<section>` (lines 906-909):

```tsx
            <section ref={notesRef}>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Bitácora</h4>
              <TripNotesFeed trip={trip} />
            </section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripSlideOver.test.tsx`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripSlideOver.tsx monitor-app/frontend/components/dashboard/TripSlideOver.test.tsx
git commit -m "feat(diario): TripSlideOver scrolls to Bitácora when focusNotes is set"
```

---

## Task 6: Frontend — wire `focusNotes` through the monitor page

Pure prop-plumbing between the two pieces built in Tasks 4/5/7 — this page has no existing test file (`app/dashboard/operations/monitor/page.test.tsx` doesn't exist, unlike some other dashboard pages), and this project's own convention for page-level wiring like this is manual/live verification rather than a new test harness (see AGENTLOG.md, e.g. Ronda 51-53's Centro de Flota wiring). No automated test step in this task for that reason — verify manually in Step 3.

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx`

**Interfaces:**
- Consumes: `TripSlideOver`'s `focusNotes` prop (Task 5), `TripTable`'s `onSelectFocusNotes` prop (Task 7 — implement this task together with or immediately after Task 7, since this file passes a prop Task 7 defines).
- Produces: nothing consumed by later tasks — this is the last piece.

- [ ] **Step 1: Add state**

In `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx`, next to the existing `const [selected, setSelected] = useState<Trip | null>(null)` (line 100):

```ts
  const [focusNotes, setFocusNotes] = useState(false)
```

- [ ] **Step 2: Add a handler and wire it into both components**

Next to `handleSelectTrip` (defined around line 287):

```ts
  function handleSelectTripFocusNotes(trip: Trip) {
    setSelected(trip)
    setFocusNotes(true)
  }
```

Update the `<TripSlideOver>` mount (line 643) to pass `focusNotes` and reset it on close:

```tsx
      <TripSlideOver
        trip={selected}
        onClose={() => { setSelected(null); setFocusNotes(false) }}
        onSaved={handleSaved}
        meta={tripsMeta}
        focusNotes={focusNotes}
      />
```

Update the `<TripTable>` mount (lines 602-608 — it's the only one in this file; the `onSelectTrip={handleSelectTrip}` props on `<CloseDayDialog>` at line 665 and `<FleetCenterDialog>` at line 675 are a different, id-based callback unrelated to this badge, and don't need any change) to also pass the new callback and make sure a plain row click (`onSelect`) does *not* focus notes:

```tsx
                <TripTable
                  trips={visibleTrips}
                  selectedId={selected?.id ?? null}
                  onSelect={trip => { setSelected(trip); setFocusNotes(false) }}
                  onSelectFocusNotes={handleSelectTripFocusNotes}
                  meta={tripsMeta}
                  updatedIds={updatedIds}
                />
```

- [ ] **Step 3: Verify manually**

Run: `cd monitor-app/frontend && npm run dev`, open the Monitor page.
- Click a normal trip row → detail opens, scrolled to the top (unchanged behavior).
- Click a trip's `BitacoraFollowupBadge` (visible once Task 7 lands — if testing this step before Task 7 is merged, temporarily render `<BitacoraFollowupBadge show onClick={() => handleSelectTripFocusNotes(trip)} />` anywhere to confirm the wiring) → detail opens, already scrolled to the Bitácora section.
- Close the detail, click the same badge again → still scrolls (state was reset on close).

- [ ] **Step 4: Type-check**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/dashboard/operations/monitor/page.tsx
git commit -m "feat(diario): wire focusNotes from the trip table to the slide-over"
```

---

## Task 7: Frontend — render the badge in `TripTable`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx:124-133` (Props), `:241-245` (mobile row), `:499-509` (desktop row)
- Test: Modify `monitor-app/frontend/components/dashboard/TripTable.test.tsx`

**Interfaces:**
- Consumes: `needsBitacoraFollowup` (Task 3), `BitacoraFollowupBadge` (Task 4).
- Produces: `TripTable` gains a required prop `onSelectFocusNotes: (trip: Trip) => void`, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Add to `monitor-app/frontend/components/dashboard/TripTable.test.tsx` (reuses the `makeTrip` helper already defined at the top of that file):

```tsx
import { BitacoraFollowupBadge } from '@/components/ui/BitacoraFollowupBadge'

const NOW = Date.parse('2026-07-04T18:00:00Z')

describe('BitacoraFollowupBadge in TripTable', () => {
  it('shows the badge when a trip has a stale alert with no human note', () => {
    vi.setSystemTime(NOW)
    const trip = makeTrip('t1', { status_reported_at: '2026-07-04T15:00:00Z', last_human_note_at: null })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.getAllByRole('button', { name: /sin seguimiento en la bitácora/i }).length).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('hides the badge when the last human note is after the alert started', () => {
    vi.setSystemTime(NOW)
    const trip = makeTrip('t1', { status_reported_at: '2026-07-04T15:00:00Z', last_human_note_at: '2026-07-04T16:00:00Z' })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByRole('button', { name: /sin seguimiento en la bitácora/i })).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('clicking the badge calls onSelectFocusNotes without also triggering the row onSelect', () => {
    vi.setSystemTime(NOW)
    const onSelect = vi.fn()
    const onSelectFocusNotes = vi.fn()
    const trip = makeTrip('t1', { status_reported_at: '2026-07-04T15:00:00Z', last_human_note_at: null })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={onSelectFocusNotes} meta={null} />)
    fireEvent.click(screen.getAllByRole('button', { name: /sin seguimiento en la bitácora/i })[0])
    expect(onSelectFocusNotes).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(onSelect).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
```

Add `vi` to the existing `import { describe, it, expect, vi } from 'vitest'` if any of these helpers (`vi.setSystemTime`, `vi.useRealTimers`) aren't already imported — check the top of the file first, it already imports `vi` per the earlier `onSelect = vi.fn()` usage.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripTable.test.tsx -t "BitacoraFollowupBadge"`
Expected: FAIL — `onSelectFocusNotes` prop doesn't exist (TS error) and/or no matching button found.

- [ ] **Step 3: Implement**

In `monitor-app/frontend/components/dashboard/TripTable.tsx`:

1. Add the import:

```ts
import { BitacoraFollowupBadge } from '@/components/ui/BitacoraFollowupBadge'
import { needsBitacoraFollowup } from '@/lib/utils/kpis'
```

2. Update `Props` (lines 124-131) and the function signature (line 133):

```ts
interface Props {
  trips:              Trip[]
  selectedId:         string | null
  onSelect:           (trip: Trip) => void
  onSelectFocusNotes: (trip: Trip) => void
  meta?:              TripsMeta | null
  /** Viajes cuyo último reporte TMS cambió en el refetch más reciente — glow sutil */
  updatedIds?:        Set<string>
}

export function TripTable({ trips, selectedId, onSelect, onSelectFocusNotes, meta, updatedIds }: Props) {
```

3. There are two separate `trips.map(trip => { ... })` blocks in this file — one for the mobile card list (starting at line 198) and one for the desktop table (starting around line 336), each rendering its own copy of the row. Both need the same computation added once per block, right after each block's own `const currentStatus = ...` line:

```ts
          const needsFollowup = needsBitacoraFollowup(trip, meta?.temperature_ranges ?? [], meta?.monitor_alert_rules ?? undefined)
```

4. In the mobile row's status cluster (lines 241-244), add the badge after the OFF TIME span:

```tsx
                  <StatusBadge status={currentStatus} meta={meta} />
                  {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">OFF TIME</span>
                  )}
                  <BitacoraFollowupBadge
                    show={needsFollowup}
                    compact
                    onClick={e => { e.stopPropagation(); onSelectFocusNotes(trip) }}
                  />
```

5. In the desktop table's status cell (lines 506-508), add the badge after the OFF TIME span:

```tsx
                          {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                            <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full block mt-0.5 w-fit">OFF TIME</span>
                          )}
                          <BitacoraFollowupBadge
                            show={needsFollowup}
                            onClick={e => { e.stopPropagation(); onSelectFocusNotes(trip) }}
                          />
```

- [ ] **Step 4: Update the existing test call sites**

The pre-existing tests in `TripTable.test.tsx` (e.g. `calls onSelect directly when a row is clicked`) construct `<TripTable ... />` without `onSelectFocusNotes` — since it's now a required prop, add `onSelectFocusNotes={vi.fn()}` to every existing `render(<TripTable ...>)` call in this file so they keep compiling.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripTable.test.tsx`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 6: Type-check and run the full frontend suite**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run`
Expected: no type errors; full suite passes (this also catches any other place in the codebase that constructs `<TripTable>` without the new required prop — update those call sites the same way if any show up, following Step 4's pattern).

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripTable.tsx monitor-app/frontend/components/dashboard/TripTable.test.tsx
git commit -m "feat(diario): render BitacoraFollowupBadge in the trip table"
```

---

## Final verification (after all 7 tasks)

- [ ] Backend: `cd monitor-app/backend/api && venv/bin/pytest tests/ -q` — full suite passes.
- [ ] Frontend: `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build` — no type errors, full suite passes, production build succeeds.
- [ ] Manual click-through against a real/dev backend (per `AGENTLOG.md` convention of verifying in the live app before calling a Diario change done): find or create a trip with a stale/dwell/late-arrival/temp-out condition and no recent note, confirm the badge appears; add a bitácora note, refetch, confirm the badge disappears; confirm clicking the badge opens the trip already scrolled to Bitácora.
- [ ] Update `AGENTLOG.md` with what was built, and close out the corresponding item in the "Otros puntos de la minuta" section of the Hito 3 closure Artifact if the user wants that reflected there too.
