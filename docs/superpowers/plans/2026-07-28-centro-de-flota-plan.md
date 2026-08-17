# Centro de Flota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el pill "N conductores disponibles" (atajo ciego a "Agregar viaje", sin conexión con "Cerrar el día") por un modal "Centro de Flota" ancorado en EQUIPO (no conductor), cruzado por link con la cuadratura de conductores, que además absorbe "Agregar viaje" + "Carga masiva CSV" como un solo punto de entrada.

**Architecture:** Dos modales con propósito distinto y cross-link explícito (no fusionados): `CloseDayDialog` (cuadratura de conductores, sin cambios de lógica) y `FleetCenterDialog` (nuevo — disponibilidad de equipo hoy, split-button de creación de viajes). El backend ya tiene `GET /trips/available-assets` pero ningún consumidor lo usa hoy — se enriquece sin riesgo de romper nada.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js App Router + React Query + TypeScript (frontend), pytest (`AsyncMock`), vitest + Testing Library.

## Global Constraints

- Cero emojis — ni en copy de UI ni en comentarios de código. Toda iconografía usa `lucide-react` (`Truck` para equipo/flota).
- `app.driver_day_status` y la lógica de bloqueo/override de `POST /daily-closures/close` no se tocan.
- La nomenclatura "Por regularizar" (estado MISMATCH) se mantiene igual — decisión ya tomada en el spec, no reabrir.
- `GET /trips/available-assets` no tiene ningún consumidor frontend hoy (verificado) — el cambio de forma de su respuesta es seguro.
- Ver `docs/superpowers/specs/2026-07-28-centro-de-flota-design.md` para el detalle de decisiones y su razón de ser.

---

### Task 1: Backend — `GET /trips/available-assets` enriquecido

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py` (función `available_assets`, líneas ~844-902)
- Test: `monitor-app/backend/api/tests/test_config_monitor.py` (sección `/trips/available-assets`, líneas ~178-213)

**Interfaces:**
- Produces: `GET /trips/available-assets?fecha=YYYY-MM-DD` devuelve `{"total_active": int, "items": [{"asset_id", "tractor_plate", "asset_type", "carrier_id", "carrier_name", "trips_total", "last_report_at", "driver_id", "driver_name", "driver_rut", "driver_phone"}]}` en vez de una lista pelada.

- [ ] **Step 1: Actualizar los 2 tests existentes que asumen la forma vieja (lista pelada)**

En `monitor-app/backend/api/tests/test_config_monitor.py`, reemplazar `test_available_assets_returns_rows_from_active_roster` y `test_available_assets_today_trips_uses_shared_resolution_view`:

```python
def test_available_assets_returns_rows_from_active_roster():
    pool = AsyncMock()
    pool.fetchval.return_value = 1
    pool.fetch.return_value = [{
        "asset_id": "a1", "tractor_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "carrier_id": "c1", "carrier_name": "TransCargo", "trips_total": 0, "last_report_at": None,
        "driver_id": None, "driver_name": None, "driver_rut": None, "driver_phone": None,
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    assert res.status_code == 200
    body = res.json()
    assert body["total_active"] == 1
    assert body["items"][0]["tractor_plate"] == "ABCD12"
    query = pool.fetch.call_args.args[0]
    assert "public.asset_assignments" in query
    assert "sodimac" in query


def test_available_assets_today_trips_uses_shared_resolution_view():
    """Fase B (feedback post-weekly 2026-07-22, ítem 5): mismo fix que
    available-drivers, para el lado del equipo/tracto."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    query = pool.fetch.call_args.args[0]
    assert "app.v_trip_fleet_resolution" in query
    assert "vfr.resolved_tractor_asset_id" in query
```

- [ ] **Step 2: Correr los tests actualizados para verificar que fallan**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_config_monitor.py -k available_assets -v`
Expected: FAIL — la respuesta real sigue siendo una lista pelada, `body["total_active"]` no existe (`TypeError: list indices must be integers`).

- [ ] **Step 3: Agregar los 2 tests nuevos (total_active separado + conductor habitual desde equipo idle)**

En el mismo archivo, después de los dos tests de arriba:

```python
def test_available_assets_response_shape_has_total_active_and_items():
    pool = AsyncMock()
    pool.fetchval.return_value = 5
    pool.fetch.return_value = [{
        "asset_id": "a1", "tractor_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "carrier_id": "c1", "carrier_name": "TransCargo", "trips_total": 0, "last_report_at": None,
        "driver_id": "d1", "driver_name": "Juan Pérez", "driver_rut": "12345678-9", "driver_phone": None,
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    body = res.json()
    assert body["total_active"] == 5
    assert body["items"][0]["carrier_id"] == "c1"
    assert body["items"][0]["driver_id"] == "d1"


def test_available_assets_includes_standing_driver_for_idle_equipment():
    """Centro de Flota (2026-07-28): un equipo sin viajes hoy debe traer su
    conductor habitual — antes solo se llenaba si el equipo tuvo un viaje hoy,
    dejando la mitad de la lista sin conductor en la UI."""
    pool = AsyncMock()
    pool.fetchval.return_value = 1
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    query = pool.fetch.call_args.args[0]
    assert "public.vehicle_driver_assignments" in query
    assert "standing_driver" in query
    assert "c.id AS carrier_id" in query
```

- [ ] **Step 4: Correr los tests nuevos para verificar que fallan**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_config_monitor.py -k available_assets -v`
Expected: FAIL en los 4 tests de `available-assets` (endpoint todavía no cambió).

- [ ] **Step 5: Reescribir `available_assets` en `trips.py`**

Reemplazar la función completa (líneas ~844-902 de `monitor-app/backend/api/app/routers/trips.py`):

```python
@router.get("/available-assets")
async def available_assets(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Mismo diseño que /available-drivers, para equipos: parte de
    public.assets activos de una empresa transportista activa
    (asset_assignments) y cruza contra los viajes del día.

    Centro de Flota (2026-07-28): la respuesta pasa de lista pelada a
    {total_active, items} — total_active permite calcular "en viaje hoy" en
    el cliente (= total_active - len(items), ya que este endpoint solo
    devuelve equipo IDLE) sin duplicar esa cuenta en dos lugares. Se agrega
    standing_driver (mismo patrón que standing_vehicle en available_drivers,
    en la dirección inversa) para que un equipo sin viajes hoy siga
    mostrando su conductor habitual — antes quedaba en blanco."""
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    total_active = await pool.fetchval(
        """
        SELECT count(*)
        FROM public.assets a
        JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
        JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
        WHERE a.operational_status = 'ACTIVE'
        """
    )

    rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT a.id, a.license_plate, a.asset_type, c.id AS carrier_id, c.business_name AS carrier_name
            FROM public.assets a
            JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE a.operational_status = 'ACTIVE'
        ),
        -- Centro de Flota (2026-07-28): conductor habitual de este equipo,
        -- para cuando no tuvo ningún viaje hoy (ver docstring de arriba).
        standing_driver AS (
            SELECT vda.asset_id, d.id AS driver_id, d.full_name AS driver_name, d.tax_id AS driver_rut
            FROM public.vehicle_driver_assignments vda
            JOIN public.drivers d ON d.id = vda.driver_id
            WHERE vda.status = 'ACTIVE'
        ),
        today_trips AS (
            SELECT
                vfr.resolved_tractor_asset_id AS asset_id,
                count(*) AS trips_total,
                count(*) FILTER (
                    WHERE t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')
                ) AS closed_count,
                max(t.status_reported_at) AS last_report_at,
                max(COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms')) AS driver_name,
                max(vfr.resolved_driver_id) AS driver_id
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
            WHERE t.planning_date = $1
              AND t.source_system != 'sodimac'
              AND vfr.resolved_tractor_asset_id IS NOT NULL
            GROUP BY vfr.resolved_tractor_asset_id
        )
        SELECT
            ar.id            AS asset_id,
            ar.license_plate AS tractor_plate,
            ar.asset_type,
            ar.carrier_id,
            ar.carrier_name,
            COALESCE(tt.trips_total, 0) AS trips_total,
            tt.last_report_at,
            COALESCE(tt.driver_name, sd.driver_name) AS driver_name,
            COALESCE(tt.driver_id, sd.driver_id)     AS driver_id,
            sd.driver_rut,
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = COALESCE(tt.driver_id, sd.driver_id) AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            ) AS driver_phone
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.asset_id = ar.id
        LEFT JOIN standing_driver sd ON sd.asset_id = ar.id
        WHERE tt.asset_id IS NULL OR tt.trips_total = tt.closed_count
        ORDER BY tt.last_report_at DESC NULLS LAST, ar.license_plate
        """,
        day,
    )
    return {"total_active": total_active, "items": [dict(r) for r in rows]}
```

- [ ] **Step 6: Correr los tests para verificar que pasan**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_config_monitor.py -k available_assets -v`
Expected: PASS (4/4)

- [ ] **Step 7: Correr toda la suite de backend para descartar regresiones**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/ -v`
Expected: PASS (todos)

- [ ] **Step 8: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_config_monitor.py
git commit -m "feat(trips): available-assets trae total_active + conductor habitual del equipo"
```

---

### Task 2: Backend — `trip_id` en filas MISMATCH de la cuadratura

**Files:**
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py` (`_DETAIL_SQL`, líneas ~104-137)
- Test: `monitor-app/backend/api/tests/test_daily_closures.py`

**Interfaces:**
- Consumes: `app.v_trip_fleet_resolution` (ya usada en `_RECOMPUTE_SQL`), `c.id` (carrier_id ya resuelto en `_DETAIL_SQL`).
- Produces: cada fila de `GET /daily-closures?fecha=...` (`drivers[]`) suma `trip_id: str | None` — el viaje más reciente que causó el MISMATCH, `null` para ASSIGNED/UNASSIGNED.

- [ ] **Step 1: Agregar `trip_id: None` al helper `_driver_row` y escribir el test que falla**

En `monitor-app/backend/api/tests/test_daily_closures.py`, modificar `_driver_row`:

```python
def _driver_row(**overrides):
    base = {
        "driver_id": "d1", "full_name": "Juan Pérez", "tax_id": "11111111-1",
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa", "status": "ASSIGNED",
        "unassigned_reason_id": None, "unassigned_reason_label": None,
        "resolved_by": None, "resolved_at": None, "client_names": [],
        "driver_pending_docs_critical": None, "suggested_reason_id": None,
        "trip_id": None,
    }
    base.update(overrides)
    return base
```

Agregar, después de `test_get_daily_closure_status_includes_carrier_id_for_linking_to_empresas`:

```python
def test_get_daily_closure_status_includes_trip_id_for_mismatch():
    """Centro de Flota (2026-07-28) / ítem 4 del refinamiento v2: la fila
    MISMATCH en Cerrar el día debe poder abrir el viaje real que causó el
    descuadre, no solo linkear genéricamente a la ficha de empresa."""
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d3", status="MISMATCH", trip_id="t-99")]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.json()["drivers"][0]["trip_id"] == "t-99"
    detail_sql = pool.fetch.call_args_list[0].args[0]
    assert "mismatch_trip.trip_id" in detail_sql
    assert "app.v_trip_fleet_resolution" in detail_sql
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_daily_closures.py -v`
Expected: FAIL en `test_get_daily_closure_status_includes_trip_id_for_mismatch` (`"mismatch_trip.trip_id" not in detail_sql`) — el resto sigue en PASS porque `trip_id: None` no rompe nada existente.

- [ ] **Step 3: Agregar el LATERAL de `trip_id` a `_DETAIL_SQL`**

En `monitor-app/backend/api/app/routers/daily_closures.py`, modificar `_DETAIL_SQL`:

```python
_DETAIL_SQL = f"""
SELECT dds.driver_id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name,
       dds.status, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       dds.resolved_by, dds.resolved_at,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names,
       dcomp.has_critical_pending AS driver_pending_docs_critical,
       sugg.id AS suggested_reason_id,
       mismatch_trip.trip_id
FROM app.driver_day_status dds
JOIN public.drivers d ON d.id = dds.driver_id
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id
LEFT JOIN app.status_taxonomies ur ON ur.id = dds.unassigned_reason_id
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT COALESCE(sh.name, t.client_name)) AS client_names
    FROM app.trip_fleet_links fl
    JOIN app.trips t ON t.id = fl.trip_id
    LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE fl.driver_id = dds.driver_id AND t.planning_date = dds.business_date AND t.client_name IS NOT NULL
) clients ON true
{_compliance_alert_lateral('dcomp', 'DRIVER', 'dds.driver_id', _DRIVER_CRITICAL_DOC_CODES)}
LEFT JOIN app.status_taxonomies sugg
       ON sugg.domain = 'DRIVER_REASON' AND sugg.suggested_alert_source = 'compliance_expired' AND sugg.active = true
-- Centro de Flota (2026-07-28): viaje real que causó el MISMATCH ese día —
-- mismo criterio que _RECOMPUTE_SQL usa para marcar el estado (carrier nulo
-- o distinto al del roster), pero a nivel de una fila puntual en vez de un
-- bool_or agregado. El más reciente si hubo más de uno.
LEFT JOIN LATERAL (
    SELECT t.id AS trip_id
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    WHERE vfr.resolved_driver_id = dds.driver_id
      AND t.planning_date = dds.business_date
      AND (vfr.resolved_carrier_id IS NULL OR vfr.resolved_carrier_id IS DISTINCT FROM c.id)
    ORDER BY t.status_reported_at DESC NULLS LAST
    LIMIT 1
) mismatch_trip ON true
WHERE dds.business_date = $1
ORDER BY d.full_name
"""
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/test_daily_closures.py -v`
Expected: PASS (todos)

- [ ] **Step 5: Correr toda la suite de backend**

Run: `cd monitor-app/backend/api && venv/bin/pytest tests/ -v`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/daily_closures.py monitor-app/backend/api/tests/test_daily_closures.py
git commit -m "feat(daily-closures): trip_id real en filas MISMATCH para linkear al viaje"
```

---

### Task 3: Frontend — tipos y cliente API

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/lib/api/trips.ts`

**Interfaces:**
- Produces: `AvailableAsset`, `AvailableAssetsResponse`, `tripsApi.availableAssets(fecha)`, `DriverDayStatusRow.trip_id: string | null`. Estos tipos los consumen las Tasks 4, 5 y 6.

Sin test dedicado — mismo criterio que el resto de tipos/cliente del proyecto (verificado por `tsc`, sin archivo de test para wrappers simples de `apiFetch`).

- [ ] **Step 1: Agregar los tipos nuevos en `lib/types.ts`**

Después de `AvailableDriver` (línea 147):

```typescript
/** Equipo (tracto) activo del directorio de empresas sin viaje abierto hoy —
 *  Centro de Flota (2026-07-28). driver_* viene del viaje de hoy si tuvo
 *  alguno, o del conductor habitual asignado al equipo si no. */
export type AvailableAsset = {
  asset_id:       string
  tractor_plate:  string
  asset_type:     string | null
  carrier_id:     string | null
  carrier_name:   string | null
  trips_total:    number
  last_report_at: string | null
  driver_id:      string | null
  driver_name:    string | null
  driver_rut:     string | null
  driver_phone:   string | null
}

export type AvailableAssetsResponse = {
  total_active: number
  items:        AvailableAsset[]
}
```

En `DriverDayStatusRow` (línea 765), agregar el campo después de `suggested_reason_id`:

```typescript
  suggested_reason_id:         string | null
  /** Viaje real que causó el MISMATCH ese día (Centro de Flota, 2026-07-28)
   *  — null para ASSIGNED/UNASSIGNED. Reemplaza el link genérico a Empresas
   *  en CloseDayDialog por un link directo al viaje. */
  trip_id:                     string | null
}
```

En `DailyClosureReportRow` (línea ~816), sumar `'trip_id'` a los campos omitidos (Reportería no lo trae, `_REPORT_SQL` no lo selecciona):

```typescript
export type DailyClosureReportRow = Omit<
  DriverDayStatusRow, 'resolved_by' | 'resolved_at' | 'driver_pending_docs_critical' | 'suggested_reason_id' | 'trip_id'
> & {
  business_date: string
```

- [ ] **Step 2: Agregar el método en `lib/api/trips.ts`**

Cambiar el import del encabezado:

```typescript
import type { Trip, TripCreatePayload, TripNote, AvailableDriver, AvailableAssetsResponse } from '@/lib/types'
```

Agregar después de `availableDrivers` (línea 135):

```typescript
  availableAssets: (fecha: string) =>
    apiFetch<AvailableAssetsResponse>(`/api/v1/trips/available-assets?fecha=${encodeURIComponent(fecha)}`),
```

- [ ] **Step 3: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: errores en `CloseDayDialog.test.tsx` (literales de `DriverDayStatusRow` sin `trip_id`) — esperado, se corrige en Task 6. Ningún otro error nuevo.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/trips.ts
git commit -m "feat(trips): tipos y cliente para disponibilidad de equipo"
```

---

### Task 4: Frontend — `FleetCenterDialog.tsx` (componente nuevo)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/FleetCenterDialog.tsx`
- Test: `monitor-app/frontend/components/dashboard/FleetCenterDialog.test.tsx`

**Interfaces:**
- Consumes: `tripsApi.availableAssets(fecha)` (Task 3), `AlertStatTiles` (`components/dashboard/AlertStatTiles.tsx`, ya existe), `FleetAssignValue` (`components/dashboard/FleetAssignSection.tsx`, ya existe).
- Produces: `FleetCenterDialog({ open, fecha, onClose, onOpenCloseDay, onAssign, onNewTrip, onImportCsv })` — usado por Task 7.

- [ ] **Step 1: Escribir el test completo (falla porque el componente no existe)**

Crear `monitor-app/frontend/components/dashboard/FleetCenterDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FleetCenterDialog } from './FleetCenterDialog'
import { tripsApi } from '@/lib/api/trips'
import type { AvailableAssetsResponse } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { availableAssets: vi.fn() },
}))

const DATA: AvailableAssetsResponse = {
  total_active: 5,
  items: [
    {
      asset_id: 'a1', tractor_plate: 'ABCD12', asset_type: 'TRACTOCAMION',
      carrier_id: 'c1', carrier_name: 'Transportes Sur', trips_total: 0, last_report_at: null,
      driver_id: null, driver_name: null, driver_rut: null, driver_phone: null,
    },
    {
      asset_id: 'a2', tractor_plate: 'WXYZ99', asset_type: 'TRACTOCAMION',
      carrier_id: 'c2', carrier_name: 'RPS Logística', trips_total: 1, last_report_at: '2026-07-28T12:00:00Z',
      driver_id: 'd2', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: '+56911112222',
    },
  ],
}

function renderDialog(props: Partial<Parameters<typeof FleetCenterDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FleetCenterDialog
        open fecha="2026-07-28"
        onClose={vi.fn()} onOpenCloseDay={vi.fn()} onAssign={vi.fn()} onNewTrip={vi.fn()} onImportCsv={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(tripsApi.availableAssets).mockReset().mockResolvedValue(DATA)
})

describe('FleetCenterDialog', () => {
  it('no renderiza nada cuando open=false', () => {
    renderDialog({ open: false })
    expect(screen.queryByText(/Centro de Flota/)).not.toBeInTheDocument()
  })

  it('muestra los equipos disponibles y los 3 tiles con los conteos correctos', async () => {
    renderDialog()
    expect(await screen.findByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nunca asignados hoy/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /Liberados tras viaje/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /En viaje hoy/ })).toHaveTextContent('3')
  })

  it('clickear "Nunca asignados hoy" filtra la tabla a solo esos equipos', async () => {
    renderDialog()
    await screen.findByText('WXYZ99')
    fireEvent.click(screen.getByRole('button', { name: /Nunca asignados hoy/ }))
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.queryByText('WXYZ99')).not.toBeInTheDocument()
  })

  it('clickear "En viaje hoy" no filtra sobre datos inexistentes, muestra el aviso explicativo', async () => {
    renderDialog()
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: /En viaje hoy/ }))
    expect(screen.getByText(/revisalos en el Diario/)).toBeInTheDocument()
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
  })

  it('la búsqueda filtra por patente, empresa o conductor', async () => {
    renderDialog()
    await screen.findByText('ABCD12')
    fireEvent.change(screen.getByLabelText('Buscar equipo'), { target: { value: 'Juan' } })
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
  })

  it('un equipo sin conductor habitual muestra el aviso correspondiente', async () => {
    renderDialog()
    expect(await screen.findByText('Sin conductor asignado hoy')).toBeInTheDocument()
  })

  it('"Asignar viaje" llama a onAssign con el FleetAssignValue completo del equipo', async () => {
    const onAssign = vi.fn()
    renderDialog({ onAssign })
    await screen.findByText('WXYZ99')
    const row = screen.getByText('WXYZ99').closest('tr')!
    fireEvent.click(within(row).getByText('Asignar viaje'))
    expect(onAssign).toHaveBeenCalledWith({
      driver_id: 'd2', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: '+56911112222',
      carrier_id: 'c2', carrier_name: 'RPS Logística',
      tractor_asset_id: 'a2', tractor_plate: 'WXYZ99', trailer_plate: null,
    })
  })

  it('el botón principal "Nuevo viaje" llama a onNewTrip directamente', async () => {
    const onNewTrip = vi.fn()
    renderDialog({ onNewTrip })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByText('Nuevo viaje'))
    expect(onNewTrip).toHaveBeenCalled()
  })

  it('el split-button abre un menú con Viaje individual e Importar CSV', async () => {
    const onImportCsv = vi.fn()
    renderDialog({ onImportCsv })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByLabelText('Más opciones de creación'))
    fireEvent.click(screen.getByText('Importar CSV (varios)'))
    expect(onImportCsv).toHaveBeenCalled()
  })

  it('el link "Ver cuadratura de conductores" llama a onOpenCloseDay', async () => {
    const onOpenCloseDay = vi.fn()
    renderDialog({ onOpenCloseDay })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByText('Ver cuadratura de conductores'))
    expect(onOpenCloseDay).toHaveBeenCalled()
  })

  it('llama a onClose al hacer click en la X', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await screen.findByText(/Centro de Flota/)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FleetCenterDialog.test.tsx`
Expected: FAIL — `Cannot find module './FleetCenterDialog'`

- [ ] **Step 3: Crear el componente**

Crear `monitor-app/frontend/components/dashboard/FleetCenterDialog.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Truck, X, Search, ChevronDown, ArrowRight, ClipboardCheck } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { AlertStatTiles } from './AlertStatTiles'
import type { AvailableAsset } from '@/lib/types'
import type { FleetAssignValue } from './FleetAssignSection'

type Category = 'never' | 'released' | 'busy' | ''

interface Props {
  open:           boolean
  fecha:          string
  onClose:        () => void
  onOpenCloseDay: () => void
  onAssign:       (fleet: FleetAssignValue) => void
  onNewTrip:      () => void
  onImportCsv:    () => void
}

function toFleetValue(a: AvailableAsset): FleetAssignValue {
  return {
    driver_id: a.driver_id, driver_name: a.driver_name, driver_rut: a.driver_rut, driver_phone: a.driver_phone,
    carrier_id: a.carrier_id, carrier_name: a.carrier_name,
    tractor_asset_id: a.asset_id, tractor_plate: a.tractor_plate, trailer_plate: null,
  }
}

/** "Centro de Flota" (spec 2026-07-28-centro-de-flota-design.md) — disponibilidad
 *  de EQUIPO (no de conductor, ver spec) para hoy. Cruzado con CloseDayDialog
 *  por link, no fusionado: la cuadratura de conductores sigue ahí sin cambios.
 *  Reemplaza el pill "conductores disponibles" + los botones "Agregar viaje"
 *  y "Carga masiva (CSV)" del Diario — un solo punto de entrada. */
export function FleetCenterDialog({ open, fecha, onClose, onOpenCloseDay, onAssign, onNewTrip, onImportCsv }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [category, setCategory] = useState<Category>('')
  const [q, setQ] = useState('')
  const [showNewMenu, setShowNewMenu] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['available-assets', fecha],
    queryFn: () => tripsApi.availableAssets(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setCategory(''); setQ(''); setShowNewMenu(false)
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const items = data?.items ?? []
  const neverAssigned = items.filter(i => i.trips_total === 0)
  const released = items.filter(i => i.trips_total > 0)
  const busyCount = Math.max(0, (data?.total_active ?? 0) - items.length)

  const byCategory =
    category === 'never'    ? neverAssigned :
    category === 'released' ? released :
    category === 'busy'     ? [] :
    items

  const qLower = q.trim().toLowerCase()
  const filtered = qLower === '' ? byCategory : byCategory.filter(a =>
    a.tractor_plate.toLowerCase().includes(qLower)
    || (a.carrier_name ?? '').toLowerCase().includes(qLower)
    || (a.driver_name ?? '').toLowerCase().includes(qLower)
  )

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Centro de Flota"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-3xl max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Truck size={16} className="text-accent" /> Centro de Flota — {fecha}
            </h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onOpenCloseDay}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-accent transition-colors"
              >
                <ClipboardCheck size={12} /> Ver cuadratura de conductores
              </button>

              <div className="relative shrink-0">
                <div className="flex">
                  <button
                    type="button"
                    onClick={onNewTrip}
                    className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold px-3.5 py-2 rounded-l-lg hover:bg-accent/90 transition-colors"
                  >
                    Nuevo viaje
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewMenu(v => !v)}
                    aria-label="Más opciones de creación"
                    aria-expanded={showNewMenu}
                    className="flex items-center bg-accent text-white px-2 rounded-r-lg border-l border-white/25 hover:bg-accent/90 transition-colors"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                {showNewMenu && (
                  <div className="absolute right-0 mt-1 w-48 bg-white border border-border rounded-lg shadow-lg z-10 text-xs overflow-hidden">
                    <button type="button" onClick={() => { setShowNewMenu(false); onNewTrip() }} className="w-full text-left px-3 py-2 hover:bg-gray-50">
                      Viaje individual
                    </button>
                    <button type="button" onClick={() => { setShowNewMenu(false); onImportCsv() }} className="w-full text-left px-3 py-2 hover:bg-gray-50 border-t border-border/60">
                      Importar CSV (varios)
                    </button>
                  </div>
                )}
              </div>
            </div>

            {isLoading || !data ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <>
                <AlertStatTiles
                  tiles={[
                    { id: 'never', label: 'Nunca asignados hoy', value: neverAssigned.length, tone: 'danger' },
                    { id: 'released', label: 'Liberados tras viaje', value: released.length, tone: 'success' },
                    { id: 'busy', label: 'En viaje hoy', value: busyCount, tone: 'neutral' },
                  ]}
                  active={category}
                  onSelect={id => { if (id === 'busy') return; setCategory(prev => (prev === id ? '' : id) as Category) }}
                />

                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Buscar patente, conductor o empresa…"
                    aria-label="Buscar equipo"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
                  />
                </div>

                <div className="bg-white rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                        <th className="text-left px-3 py-2">Patente</th>
                        <th className="text-left px-3 py-2">Empresa</th>
                        <th className="text-left px-3 py-2">Conductor habitual</th>
                        <th className="text-left px-3 py-2">Última actividad</th>
                        <th className="text-right px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {category === 'busy' ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">
                          En viaje ahora — revisalos en el Diario, no en Centro de Flota
                        </td></tr>
                      ) : filtered.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos en esta categoría</td></tr>
                      ) : filtered.map(a => (
                        <tr key={a.asset_id}>
                          <td className="px-3 py-2 font-semibold text-text-primary">{a.tractor_plate}</td>
                          <td className="px-3 py-2">{a.carrier_name ?? '—'}</td>
                          <td className="px-3 py-2">
                            {a.driver_name ?? <span className="text-amber-600">Sin conductor asignado hoy</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-400">
                            {a.trips_total === 0
                              ? 'Sin viajes hoy'
                              : a.last_report_at
                                ? `Cerró viaje ${new Date(a.last_report_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
                                : 'Liberado'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => onAssign(toFleetValue(a))}
                              className="flex items-center gap-1 ml-auto text-[11px] font-semibold text-accent hover:text-accent/80"
                            >
                              Asignar viaje <ArrowRight size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/FleetCenterDialog.test.tsx`
Expected: PASS (11/11)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/FleetCenterDialog.tsx monitor-app/frontend/components/dashboard/FleetCenterDialog.test.tsx
git commit -m "feat(diario): Centro de Flota — disponibilidad de equipo, split-button de creación"
```

---

### Task 5: Frontend — `TripAssignDialog` acepta equipo precargado

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx`
- Test: `monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx`

**Interfaces:**
- Consumes: `FleetAssignValue` (ya existe).
- Produces: `TripAssignDialog` gana prop opcional `initialFleet?: FleetAssignValue` — usado por Task 7 al abrir desde `FleetCenterDialog`.

- [ ] **Step 1: Escribir el test que falla**

En `monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx`, agregar al final del `describe`, antes del cierre:

```tsx
  it('con initialFleet (Centro de Flota → Asignar viaje), abre con el equipo ya cargado', () => {
    renderCreate({
      initialFleet: {
        driver_id: 'd9', driver_name: 'Pedro Soto', driver_rut: '9-9', driver_phone: null,
        carrier_id: 'c9', carrier_name: 'RPS Logística', tractor_asset_id: 'a9', tractor_plate: 'WXYZ99', trailer_plate: null,
      },
    })
    expect(screen.getByText('Pedro Soto')).toBeInTheDocument()
    expect(screen.getByDisplayValue('RPS Logística')).toBeInTheDocument()
    expect(screen.getByDisplayValue('WXYZ99')).toBeInTheDocument()
    expect(screen.getByText('Crear viaje')).not.toBeDisabled()
  })
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripAssignDialog.test.tsx`
Expected: FAIL — `initialFleet` no existe en las props (error de TypeScript) y el conductor no aparece precargado.

- [ ] **Step 3: Agregar el prop y usarlo en el efecto de apertura**

En `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx`, modificar la interfaz `Props`:

```tsx
interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
  /** Fecha activa del Diario — para sugerir conductores disponibles hoy */
  fecha:     string
  /** Precarga de equipo/conductor cuando se abre desde "Asignar viaje" en
   *  Centro de Flota (2026-07-28) — sin esto, abre en blanco como siempre. */
  initialFleet?: FleetAssignValue
}
```

Y la firma del componente + el efecto de apertura:

```tsx
export function TripAssignDialog({ open, onClose, onCreated, meta, fecha, initialFleet }: Props) {
  ...
  useEffect(() => {
    if (open) {
      setForm({ planning_date: todayISO() })
      setClientName('')
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setFleet(initialFleet ?? EMPTY_FLEET_ASSIGN_VALUE)
      setErr(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripAssignDialog.test.tsx`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/TripAssignDialog.tsx monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx
git commit -m "feat(diario): TripAssignDialog admite equipo precargado desde Centro de Flota"
```

---

### Task 6: Frontend — `CloseDayDialog` cruzado con Centro de Flota + link real al viaje MISMATCH

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/CloseDayDialog.tsx`
- Test: `monitor-app/frontend/components/dashboard/CloseDayDialog.test.tsx`

**Interfaces:**
- Produces: `CloseDayDialog` gana props `onOpenFleetCenter: () => void` y `onSelectTrip: (tripId: string) => void` — usados por Task 7.

- [ ] **Step 1: Actualizar los fixtures existentes y escribir los 2 tests que fallan**

En `monitor-app/frontend/components/dashboard/CloseDayDialog.test.tsx`:

Agregar `trip_id: null` a los 4 objetos de `STATUS.drivers` (líneas 24-27) y a los 2 objetos inline de los tests de sugerencia de motivo (líneas ~147-152 y ~168-173) — mismo patrón que agregar un campo nuevo a un fixture existente en este proyecto.

Actualizar `renderDialog` para pasar las 2 props nuevas por default:

```tsx
function renderDialog(props: Partial<Parameters<typeof CloseDayDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CloseDayDialog
        open fecha="2026-07-21" canAdmin={false} unassignedReasons={REASONS}
        onClose={vi.fn()} onOpenFleetCenter={vi.fn()} onSelectTrip={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}
```

Agregar, después del test `'"Revisar en Empresas" en un conductor MISMATCH es un link real a su empresa, no texto estático'`:

```tsx
  it('un conductor MISMATCH con trip_id abre el viaje real en vez de linkear a Empresas', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...STATUS,
      drivers: STATUS.drivers.map(d => d.driver_id === 'd3' ? { ...d, trip_id: 't-77' } : d),
    })
    const onSelectTrip = vi.fn()
    renderDialog({ onSelectTrip })
    await screen.findByText('Luis Rojas')
    expect(screen.queryByRole('link', { name: /Revisar en Empresas/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ver viaje/ }))
    expect(onSelectTrip).toHaveBeenCalledWith('t-77')
  })

  it('el link "Ver equipos disponibles" llama a onOpenFleetCenter', async () => {
    const onOpenFleetCenter = vi.fn()
    renderDialog({ onOpenFleetCenter })
    await screen.findByText(/Cerrar el día/)
    fireEvent.click(screen.getByText('Ver equipos disponibles'))
    expect(onOpenFleetCenter).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/CloseDayDialog.test.tsx`
Expected: FAIL en los 2 tests nuevos (props/comportamiento no existen todavía) y errores de tipo por `onOpenFleetCenter`/`onSelectTrip` faltantes.

- [ ] **Step 3: Agregar las props y el cross-link en `CloseDayDialog.tsx`**

Modificar el import de iconos y la interfaz `Props`:

```tsx
import { Loader2, ClipboardCheck, AlertTriangle, CheckCircle2, X, Truck } from 'lucide-react'
...
interface Props {
  open:               boolean
  fecha:              string
  canAdmin:           boolean
  unassignedReasons:  UnassignedReasonMeta[]
  onClose:            () => void
  /** Centro de Flota (2026-07-28) — cross-link, no fusión: cuadratura de
   *  conductores y disponibilidad de equipo son vistas separadas. */
  onOpenFleetCenter:  () => void
  /** Abre el viaje real que causó un MISMATCH puntual (ver trip_id en
   *  DriverDayStatusRow) — reemplaza el link genérico a Empresas cuando hay
   *  un viaje concreto al que apuntar. */
  onSelectTrip:       (tripId: string) => void
}
```

Agregar el link cruzado, dentro del `<div className="flex-1 overflow-y-auto p-5 space-y-4">`, justo antes del bloque `{data.closed && data.closure && (...)}`:

```tsx
                <button
                  type="button"
                  onClick={onOpenFleetCenter}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-accent transition-colors"
                >
                  <Truck size={12} /> Ver equipos disponibles
                </button>

```

Reemplazar la celda de acción MISMATCH:

```tsx
                                {d.status === 'MISMATCH' && (
                                  d.trip_id ? (
                                    <button
                                      type="button"
                                      onClick={() => onSelectTrip(d.trip_id!)}
                                      className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                    >
                                      <AlertTriangle size={11} /> Ver viaje
                                    </button>
                                  ) : (
                                    <a
                                      href={d.carrier_id ? `/dashboard/transportistas/empresa/${d.carrier_id}` : '/dashboard/transportistas'}
                                      className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                                    >
                                      <AlertTriangle size={11} /> Revisar en Empresas
                                    </a>
                                  )
                                )}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/CloseDayDialog.test.tsx`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/CloseDayDialog.tsx monitor-app/frontend/components/dashboard/CloseDayDialog.test.tsx
git commit -m "feat(diario): CloseDayDialog cruzado con Centro de Flota + link real al viaje MISMATCH"
```

---

### Task 7: Frontend — orquestación en `app/dashboard/diario/page.tsx`

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`

**Interfaces:**
- Consumes: `FleetCenterDialog` (Task 4), `TripAssignDialog.initialFleet` (Task 5), `CloseDayDialog.onOpenFleetCenter`/`onSelectTrip` (Task 6), `tripsApi.availableAssets`/`tripsApi.get` (ya existe).

Sin test dedicado — `page.tsx` no tiene archivo de test en este proyecto (verificado: solo `reporteria/page.test.tsx` existe bajo `app/dashboard/diario/`). Se verifica con `tsc`, `npm run build` y chequeo visual en el navegador, mismo criterio que el resto de los cambios a este archivo en las rondas anteriores de esta sesión.

- [ ] **Step 1: Actualizar imports**

Reemplazar la línea de imports de `lucide-react` (línea 5) y quitar el import suelto de `UserCheck` (línea 30):

```tsx
import { Search, Loader2, ChevronLeft, ChevronRight, X, Plus, PenLine, ClipboardCheck, Truck } from 'lucide-react'
```

Se quita `Upload` (verificado: solo lo usaba el botón "Carga masiva (CSV)" que se elimina en el Step 5 de esta task — `Plus` y `PenLine` siguen en uso en otras partes del archivo, ej. botones de `GroupBuilder`, no tocarlos). Se quita el import suelto de `UserCheck` en la línea 30 — solo lo usaba el pill viejo que se elimina en el Step 5.

Agregar el import del componente nuevo, junto a los demás diálogos:

```tsx
import { FleetCenterDialog } from '@/components/dashboard/FleetCenterDialog'
```

Y el tipo `FleetAssignValue`:

```tsx
import type { FleetAssignValue } from '@/components/dashboard/FleetAssignSection'
```

- [ ] **Step 2: Reemplazar el estado y la query del pill viejo**

Reemplazar (líneas 101-104):

```tsx
  const [showCreate,      setShowCreate]      = useState(false)
  const [showBulkUpload,  setShowBulkUpload]  = useState(false)
  const [showCloseDay,    setShowCloseDay]    = useState(false)
  const [showFleetCenter, setShowFleetCenter] = useState(false)
  const [prefillFleet,    setPrefillFleet]    = useState<FleetAssignValue | null>(null)
  const [canAdmin,        setCanAdmin]        = useState(false)
```

Reemplazar el bloque de `availableCountQuery` (líneas ~195-202):

```tsx
  // Centro de Flota (2026-07-28) — mismo queryKey que usa FleetCenterDialog
  // internamente, así el badge del botón y el modal comparten cache y no
  // duplican el fetch cuando se abre.
  const fleetAvailableQuery = useQuery({
    queryKey: ['available-assets', f.fecha],
    queryFn: () => tripsApi.availableAssets(f.fecha),
    enabled: f.tab === 'en_curso',
  })
  const fleetAvailableCount = fleetAvailableQuery.data?.items.length ?? 0
```

- [ ] **Step 3: Agregar los handlers de orquestación cruzada**

Agregar, junto a `handleCreated`/`handleBulkImported` (después de la línea ~269):

```tsx
  function openFleetCenter() {
    setShowCloseDay(false)
    setShowFleetCenter(true)
  }

  function openCloseDayFromFleet() {
    setShowFleetCenter(false)
    setShowCloseDay(true)
  }

  async function handleSelectTripFromCloseDay(tripId: string) {
    setShowCloseDay(false)
    try {
      const trip = await tripsApi.get(tripId)
      setSelected(trip)
    } catch {
      // silencioso — el operador puede reabrir Cerrar el día y reintentar
    }
  }

  function handleAssignFromFleet(fleet: FleetAssignValue) {
    setShowFleetCenter(false)
    setPrefillFleet(fleet)
    setShowCreate(true)
  }

  function handleNewTripFromFleet() {
    setShowFleetCenter(false)
    setPrefillFleet(null)
    setShowCreate(true)
  }

  function handleImportCsvFromFleet() {
    setShowFleetCenter(false)
    setShowBulkUpload(true)
  }
```

- [ ] **Step 4: Reemplazar la barra de acciones (quitar "Carga masiva" y "Agregar viaje", agregar "Flota")**

Reemplazar el bloque (líneas ~356-385):

```tsx
          {/* Barra de acciones — vista + gestión de flota */}
          <div className="flex items-center justify-between gap-3">
            {f.tab === 'en_curso' ? (
              <ViewToggle value={viewMode} onChange={handleViewModeChange} />
            ) : <div />}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowCloseDay(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-accent border border-border rounded-lg px-3 py-1.5 transition-colors"
                title="Revisar pendientes y cerrar la cuadratura del día"
              >
                <ClipboardCheck size={13} />
                Cerrar día
              </button>
              <button
                onClick={() => setShowFleetCenter(true)}
                className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
              >
                <Truck size={13} />
                Flota
                {fleetAvailableCount > 0 && (
                  <span className="bg-white/25 rounded-full px-1.5 text-[10px] font-bold">{fleetAvailableCount}</span>
                )}
              </button>
            </div>
          </div>
```

- [ ] **Step 5: Quitar el pill viejo de "conductores disponibles"**

Eliminar el bloque completo (líneas ~443-456, dentro de la fila de alertas):

```tsx
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
```

- [ ] **Step 6: Actualizar el render de los diálogos al final del archivo**

Reemplazar el bloque final (líneas ~619-638):

```tsx
      <TripAssignDialog
        open={showCreate}
        onClose={() => { setShowCreate(false); setPrefillFleet(null) }}
        onCreated={handleCreated}
        meta={tripsMeta}
        fecha={f.fecha}
        initialFleet={prefillFleet ?? undefined}
      />
      <TripBulkUpload
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onImported={handleBulkImported}
        meta={tripsMeta}
      />
      <CloseDayDialog
        open={showCloseDay}
        fecha={f.fecha}
        canAdmin={canAdmin}
        unassignedReasons={tripsMeta?.unassigned_reasons ?? []}
        onClose={() => setShowCloseDay(false)}
        onOpenFleetCenter={openFleetCenter}
        onSelectTrip={handleSelectTripFromCloseDay}
      />
      <FleetCenterDialog
        open={showFleetCenter}
        fecha={f.fecha}
        onClose={() => setShowFleetCenter(false)}
        onOpenCloseDay={openCloseDayFromFleet}
        onAssign={handleAssignFromFleet}
        onNewTrip={handleNewTripFromFleet}
        onImportCsv={handleImportCsvFromFleet}
      />
    </div>
  )
}
```

- [ ] **Step 7: Verificar tipos y build**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores. Si `Plus`/`Upload`/`UserCheck` quedan importados sin uso, `tsc` no lo marca (solo lint) — revisar a mano que no queden imports muertos.

Run: `cd monitor-app/frontend && npm run build`
Expected: build limpio.

- [ ] **Step 8: Correr toda la suite de frontend**

Run: `cd monitor-app/frontend && npx vitest run`
Expected: PASS (todos, incluyendo los de las Tasks 4/5/6)

- [ ] **Step 9: Verificación visual manual**

Con el dev server local o contra `webcarga-frontend-dev` ya desplegado: abrir el Diario, confirmar que el botón "Flota" reemplaza al pill viejo y a "Agregar viaje"/"Carga masiva", que abre Centro de Flota con los 3 tiles y la tabla, que "Asignar viaje" precarga `TripAssignDialog`, que el split-button ofrece las 2 opciones, y que los links cruzados con "Cerrar el día" funcionan en ambas direcciones.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/frontend/app/dashboard/diario/page.tsx
git commit -m "feat(diario): un solo botón de Flota — reemplaza pill de conductores + Agregar viaje + CSV"
```

---

## Self-Review

- **Cobertura del spec**: Approach A (modales cruzados, no fusionados) — Tasks 4/6/7. Split-button de creación — Task 4. Separación "nunca asignado"/"liberado" — Task 4 (tiles). Backend enriquecido sin romper contrato — Tasks 1/2. Link real al viaje MISMATCH — Tasks 2/6. Nomenclatura "Por regularizar" sin cambios — no se tocó en ninguna task. `driver_day_status`/lógica de bloqueo intactos — confirmado, solo se agregó una columna de lectura en `_DETAIL_SQL`.
- **Placeholders**: ninguno — cada step tiene código completo, no hay "TODO" ni "similar a la task N".
- **Consistencia de tipos**: `FleetAssignValue` (Task 4/5) usa los mismos 9 campos en las 3 tasks que lo tocan. `AvailableAsset`/`AvailableAssetsResponse` (Task 3) coinciden exactamente con lo que devuelve el backend de la Task 1 y lo que consume `FleetCenterDialog` en la Task 4. `trip_id` se agrega en Task 2 (backend), Task 3 (tipo) y Task 6 (uso) de forma consistente.
- **Sin emojis**: verificado en todo el código de UI (iconos vía `lucide-react` únicamente) y en los mensajes de commit.
