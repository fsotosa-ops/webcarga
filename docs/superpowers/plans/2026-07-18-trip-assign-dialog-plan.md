# TripAssignDialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reemplazar `AvailabilityPanel.tsx` + `TripCreateSlideOver.tsx` por un solo diálogo centrado (`TripAssignDialog.tsx`), driver-first — buscar/elegir un conductor primero, empresa y vehículo se autocompletan editables desde sus asignaciones activas, bloquea la creación si el conductor no está en el directorio (`public.drivers`).

**Architecture:** `TripCreateSlideOver.tsx` YA es un diálogo centrado (`max-w-4xl`, no un slide-over lateral — corrección real encontrada al escribir el spec, el "slide-over" que rompía la experiencia SaaS era específicamente `AvailabilityPanel.tsx`, `w-[380px]` lateral). Por eso la mayoría de la columna izquierda del formulario (fecha, cliente, origen/TMS, destinos) se **conserva intacta** — el rediseño real es la columna derecha: sale `EmpresaSelector` (búsqueda por empresa), entra una búsqueda de conductor (`DriverSearchPicker`, nuevo, mismo patrón que `CarrierSearchPicker` de la Fase 4) que autocompleta empresa/vehículo en los mismos inputs de texto editables que ya existían. La lista de "conductores disponibles hoy" (antes en `AvailabilityPanel`) se muestra como sugerencia dentro del mismo picker cuando el campo de búsqueda está vacío — sin pantalla intermedia.

**Tech Stack:** FastAPI + asyncpg (backend), React + TanStack Query (frontend), Vitest + Testing Library.

## Global Constraints

- **El bloqueo "conductor no encontrado" es solo frontend** (el botón "Crear viaje" queda deshabilitado sin `form.driver_id`) — `POST /trips`/`TripCreateBody` NO se tocan, siguen aceptando `driver_name` en texto libre sin `driver_id`. Razón: `TripBulkUpload.tsx` (fuera de alcance de este plan) sigue creando viajes vía el mismo endpoint sin pasar por este diálogo, y hoy sí permite conductor en texto libre — endurecer el backend rompería ese flujo.
- La tab "Equipos" de `AvailabilityPanel` **no se migra** — el conductor es el único punto de entrada de este diálogo (decisión del spec). El endpoint backend `GET /trips/available-assets` (Ronda 24) se deja intacto. **Ajuste durante la ejecución del Task 6**: el cliente frontend (`AvailableAsset` en `types.ts`, `tripsApi.availableAssets()`) sí se retiró — quedaba sin ningún consumidor tras borrar `AvailabilityPanel.tsx` (su único usuario), y el propio Step 6 de este plan esperaba 0 referencias a `AvailableAsset` en el grep de verificación final. Recrearlo es trivial (6+3 líneas) el día que exista una vista de flota real.
- Todo objeto nuevo en `lib/types.ts` sigue la convención de nombres ya usada en `AvailableDriver`/`Trip` para este dominio (`driver_name`/`driver_rut`/`tractor_plate`, no `full_name`/`license_plate` como en `Driver`/`Asset`) — son tipos de "conductor en contexto de viaje", no el master data completo.
- `npm run build` + `tsc --noEmit` + `vitest run` limpios al final de cada task que toque frontend; `pytest` limpio al final de cada task que toque backend.

---

### Task 1: Extender `available_drivers` con `carrier_id`/`tractor_asset_id` (no solo nombres)

**Por qué**: hoy `available_drivers` solo devuelve `tractor_plate` derivado de los viajes de HOY (`today_trips`) — un conductor con 0 viajes hoy pero con un vehículo estándar asignado (`vehicle_driver_assignments`) muestra `tractor_plate: null`, aunque el dato exista. Y no devuelve `carrier_id`/`tractor_asset_id` en absoluto (solo el nombre de la empresa) — el diálogo nuevo necesita los IDs reales para vincular `trip_fleet_links` correctamente al crear el viaje, no solo texto.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:624-680` (`available_drivers`)
- Test: `monitor-app/backend/api/tests/test_config_monitor.py`

**Interfaces:**
- Produces: `available_drivers` gana `carrier_id: str | None` y `tractor_asset_id: str | None` en cada fila; `tractor_plate` ahora cae al vehículo estándar del conductor cuando no hay viaje hoy.

- [x] **Step 1: Actualizar el test existente para exigir los campos nuevos**

En `monitor-app/backend/api/tests/test_config_monitor.py`, reemplazar `test_available_drivers_returns_rows_and_excludes_sodimac_in_query`:

```python
def test_available_drivers_returns_rows_and_excludes_sodimac_in_query():
    # Fase 3 del hardening del Diario (2026-07-18): la query dejó de agrupar
    # por nombre de texto libre dentro de los viajes del día — ahora parte
    # del directorio real (conductor activo de empresa activa) y recién ahí
    # cruza contra los viajes del día, para no perder a los conductores sin
    # NINGÚN viaje hoy. Ronda 26 (TripAssignDialog): suma carrier_id/
    # tractor_asset_id reales (no solo texto) y cae al vehículo estándar del
    # conductor (vehicle_driver_assignments) cuando no hay viaje hoy.
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "driver_id": "d1", "driver_name": "Juan Pérez", "driver_rut": "12345678-9",
        "driver_phone": "+56911112222", "carrier_id": "c1", "carrier_name": "TransCargo",
        "tractor_asset_id": "a1", "tractor_plate": "ABCD12", "trips_total": 2,
        "last_report_at": "2026-07-06T18:00:00",
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-drivers?fecha=2026-07-06")
    assert res.status_code == 200
    data = res.json()
    assert data[0]["driver_name"] == "Juan Pérez"
    assert data[0]["carrier_id"] == "c1"
    assert data[0]["tractor_asset_id"] == "a1"
    query = pool.fetch.call_args.args[0]
    assert "sodimac" in query                        # exclusión de la fuente sin flota
    assert "public.driver_assignments" in query       # directorio real, no texto libre
    assert "operational_status = 'ACTIVE'" in query    # solo conductores/empresas activas
    assert "public.vehicle_driver_assignments" in query  # vehículo estándar, no solo el de hoy
```

- [x] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_config_monitor.py::test_available_drivers_returns_rows_and_excludes_sodimac_in_query -v`
Expected: FAIL — `assert data[0]["carrier_id"] == "c1"` (KeyError o `None`, el campo no existe en la respuesta real todavía) y/o `"public.vehicle_driver_assignments" in query` (no aparece)

- [x] **Step 3: Extender la query de `available_drivers`**

En `monitor-app/backend/api/app/routers/trips.py`, reemplazar el cuerpo completo de la función (líneas 624-680, desde `@router.get("/available-drivers")` hasta el `return`):

```python
@router.get("/available-drivers")
async def available_drivers(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT d.id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name
            FROM public.drivers d
            JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE d.operational_status = 'ACTIVE'
        ),
        -- Vehículo que el conductor maneja habitualmente (migración
        -- 20260718070000) — independiente de si tuvo viaje hoy, para no
        -- perder la patente de alguien con 0 viajes hoy pero con equipo fijo.
        standing_vehicle AS (
            SELECT vda.driver_id, a.id AS tractor_asset_id, a.license_plate AS tractor_plate
            FROM public.vehicle_driver_assignments vda
            JOIN public.assets a ON a.id = vda.asset_id
            WHERE vda.status = 'ACTIVE'
        ),
        today_trips AS (
            SELECT
                fl.driver_id,
                count(*) AS trips_total,
                count(*) FILTER (
                    WHERE t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')
                ) AS closed_count,
                max(t.status_reported_at) AS last_report_at,
                max(COALESCE(fl.tractor_plate, t.fleet->>'tractor_plate')) AS tractor_plate
            FROM app.trips t
            JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
            WHERE t.planning_date = $1
              AND t.source_system != 'sodimac'
              AND fl.driver_id IS NOT NULL
            GROUP BY fl.driver_id
        )
        SELECT
            ar.id            AS driver_id,
            ar.full_name     AS driver_name,
            ar.tax_id        AS driver_rut,
            -- Último teléfono capturado para este conductor en cualquier
            -- viaje anterior — public.drivers no tiene columna de teléfono
            -- propia, y no hay un viaje de hoy del que tomarlo si está libre.
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = ar.id AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            )                AS driver_phone,
            ar.carrier_id,
            ar.carrier_name,
            sv.tractor_asset_id,
            COALESCE(tt.tractor_plate, sv.tractor_plate) AS tractor_plate,
            COALESCE(tt.trips_total, 0) AS trips_total,
            tt.last_report_at
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.driver_id = ar.id
        LEFT JOIN standing_vehicle sv ON sv.driver_id = ar.id
        WHERE tt.driver_id IS NULL OR tt.trips_total = tt.closed_count
        ORDER BY tt.last_report_at DESC NULLS LAST, ar.full_name
        """,
        day,
    )
    return [dict(r) for r in rows]
```

- [x] **Step 4: Correr el test y confirmar que pasa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_config_monitor.py::test_available_drivers_returns_rows_and_excludes_sodimac_in_query -v`
Expected: PASS

- [x] **Step 5: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan (233 antes de este plan)

- [x] **Step 6: Verificar en vivo contra Supabase**

Vía `mcp__claude_ai_Supabase__execute_sql`, proyecto `viclzoftiudkepqnhekv`:

```sql
WITH active_roster AS (
    SELECT d.id, d.full_name, c.id AS carrier_id, c.business_name AS carrier_name
    FROM public.drivers d
    JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
    JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
    WHERE d.operational_status = 'ACTIVE'
),
standing_vehicle AS (
    SELECT vda.driver_id, a.id AS tractor_asset_id, a.license_plate AS tractor_plate
    FROM public.vehicle_driver_assignments vda
    JOIN public.assets a ON a.id = vda.asset_id
    WHERE vda.status = 'ACTIVE'
)
SELECT ar.driver_id, ar.full_name, ar.carrier_id, sv.tractor_asset_id, sv.tractor_plate
FROM active_roster ar
JOIN standing_vehicle sv ON sv.driver_id = ar.id
LIMIT 5;
```

Expected: al menos algunas filas con `tractor_asset_id`/`tractor_plate` no nulos — confirma que el JOIN a `vehicle_driver_assignments` trae datos reales, no solo NULLs.

- [x] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_config_monitor.py
git commit -m "feat(diario): available-drivers expone carrier_id/tractor_asset_id reales"
```

---

### Task 2: Nuevo endpoint `GET /drivers` — búsqueda de conductores por nombre/RUT

**Por qué**: no existe ningún endpoint para buscar conductores por texto libre hoy — `driversApi.get(id)` requiere el id de antemano, y `carriersApi.listDrivers(carrierId)` está acotado a una empresa. El diálogo driver-first necesita buscar en TODO el directorio, sin empresa preseleccionada.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/drivers.py`
- Test: `monitor-app/backend/api/tests/test_drivers.py`

**Interfaces:**
- Produces: `GET /drivers?q=<texto>&limit=<n>` → `list[{driver_id, driver_name, driver_rut, driver_phone, carrier_id, carrier_name, tractor_asset_id, tractor_plate}]`, mismo shape que la respuesta extendida de `available_drivers` (Task 1) menos `trips_total`/`last_report_at`.

- [x] **Step 1: Escribir el test que falla**

Agregar a `monitor-app/backend/api/tests/test_drivers.py`:

```python
# ── GET /drivers — búsqueda por nombre/RUT (TripAssignDialog, Ronda 26) ──────

def test_list_drivers_requires_min_query_length():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/drivers?q=a")
    assert res.status_code == 200
    assert res.json() == []
    pool.fetch.assert_not_called()


def test_list_drivers_searches_active_roster_with_resolved_carrier_and_vehicle():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "driver_id": "d1", "driver_name": "Juan Pérez", "driver_rut": "12345678-9",
        "driver_phone": "+56911112222", "carrier_id": "c1", "carrier_name": "TransCargo",
        "tractor_asset_id": "a1", "tractor_plate": "ABCD12",
    }]
    client = make_client(pool)
    res = client.get("/api/v1/drivers?q=Juan")
    assert res.status_code == 200
    data = res.json()
    assert data[0]["driver_name"] == "Juan Pérez"
    assert data[0]["carrier_id"] == "c1"
    query = pool.fetch.call_args.args[0]
    assert "operational_status = 'ACTIVE'" in query
    assert "public.vehicle_driver_assignments" in query
    assert "d.full_name ILIKE" in query
    assert "d.tax_id ILIKE" in query
```

- [x] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_drivers.py::test_list_drivers_requires_min_query_length tests/test_drivers.py::test_list_drivers_searches_active_roster_with_resolved_carrier_and_vehicle -v`
Expected: FAIL con 404 (la ruta `GET /drivers` no existe todavía — solo existe `GET /drivers/{driver_id}`)

- [x] **Step 3: Agregar el endpoint**

En `monitor-app/backend/api/app/routers/drivers.py`, cambiar el import de FastAPI y agregar el endpoint nuevo antes de `get_driver`:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
```

```python
router = APIRouter(prefix="/drivers", tags=["drivers"])


# Declarado ANTES de /{driver_id} para que FastAPI no matchee "" como un id
# (incluso vacío, path distinto — no colisiona, pero se agrupa acá por
# convención con el resto del router: colección primero, item después).
@router.get("")
async def list_drivers(
    q: str = Query(""),
    limit: int = Query(10, ge=1, le=50),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Búsqueda de conductores activos por nombre/RUT, con su empresa y
    vehículo estándar ya resueltos — usada por TripAssignDialog (Ronda 26,
    hardening del Diario) para el flujo driver-first de creación de viajes.
    Mismo shape que GET /trips/available-drivers menos trips_total/
    last_report_at (acá no importa si tuvo viajes hoy, es búsqueda general)."""
    if len(q.strip()) < 2:
        return []
    rows = await pool.fetch(
        """
        SELECT
            d.id       AS driver_id,
            d.full_name AS driver_name,
            d.tax_id    AS driver_rut,
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = d.id AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            )          AS driver_phone,
            c.id       AS carrier_id,
            c.business_name AS carrier_name,
            a.id       AS tractor_asset_id,
            a.license_plate AS tractor_plate
        FROM public.drivers d
        LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
        LEFT JOIN public.vehicle_driver_assignments vda ON vda.driver_id = d.id AND vda.status = 'ACTIVE'
        LEFT JOIN public.assets a ON a.id = vda.asset_id
        WHERE d.operational_status = 'ACTIVE'
          AND (d.full_name ILIKE '%'||$1||'%' OR d.tax_id ILIKE '%'||$1||'%')
        ORDER BY d.full_name
        LIMIT $2
        """,
        q.strip(), limit,
    )
    return [dict(r) for r in rows]
```

- [x] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_drivers.py::test_list_drivers_requires_min_query_length tests/test_drivers.py::test_list_drivers_searches_active_roster_with_resolved_carrier_and_vehicle -v`
Expected: PASS

- [x] **Step 5: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan

- [x] **Step 6: Verificar en vivo contra Supabase**

Vía `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT d.id, d.full_name, c.business_name, a.license_plate
FROM public.drivers d
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
LEFT JOIN public.vehicle_driver_assignments vda ON vda.driver_id = d.id AND vda.status = 'ACTIVE'
LEFT JOIN public.assets a ON a.id = vda.asset_id
WHERE d.operational_status = 'ACTIVE' AND d.full_name ILIKE '%a%'
ORDER BY d.full_name LIMIT 5;
```

Expected: filas reales de conductores activos con nombre conteniendo "a", empresa/patente resueltas cuando existan.

- [x] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/drivers.py monitor-app/backend/api/tests/test_drivers.py
git commit -m "feat(diario): endpoint GET /drivers — búsqueda por nombre/RUT para TripAssignDialog"
```

---

### Task 3: Tipos y API client (frontend)

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/lib/api/drivers.ts`

**Interfaces:**
- Produces: `AvailableDriver` gana `carrier_id`/`tractor_asset_id`; tipo nuevo `DriverSearchResult`; tipo nuevo `DriverPickCandidate` (shape común mínimo entre ambos, usado por `DriverSearchPicker`); `driversApi.search(q, limit?)`.

- [x] **Step 1: Actualizar `AvailableDriver` y agregar `DriverSearchResult`/`DriverPickCandidate` en `lib/types.ts`**

Reemplazar el bloque actual:

```typescript
/** Conductor activo del directorio de empresas sin viaje abierto hoy — reasignable */
export type AvailableDriver = {
  driver_id:      string
  driver_name:    string
  driver_rut:     string | null
  driver_phone:   string | null
  tractor_plate:  string | null
  carrier_name:   string | null
  trips_total:    number
  last_report_at: string | null
}
```

Por:

```typescript
/** Shape común mínimo entre AvailableDriver y DriverSearchResult — lo que
 *  DriverSearchPicker necesita para autocompletar empresa/vehículo al
 *  elegir un conductor, sin importar si vino de la lista sugerida (hoy
 *  disponible) o de una búsqueda libre. */
export type DriverPickCandidate = {
  driver_id:         string
  driver_name:       string
  driver_rut:        string | null
  driver_phone:      string | null
  carrier_id:        string | null
  carrier_name:      string | null
  tractor_asset_id:  string | null
  tractor_plate:     string | null
}

/** Conductor activo del directorio de empresas sin viaje abierto hoy — reasignable */
export type AvailableDriver = DriverPickCandidate & {
  trips_total:    number
  last_report_at: string | null
}

/** Resultado de GET /drivers?q= — búsqueda general de conductores activos */
export type DriverSearchResult = DriverPickCandidate
```

- [x] **Step 2: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: puede fallar acá si algún consumidor de `AvailableDriver` construye el objeto sin `carrier_id`/`tractor_asset_id` — el único consumidor hoy es `AvailabilityPanel.tsx`/`AvailabilityPanel.test.tsx`, que este mismo plan retira en el Task 6. Si falla por eso, es esperado — sigue al Task 6 para que quede en verde, no lo arregles acá.

- [x] **Step 3: Agregar `driversApi.search` en `lib/api/drivers.ts`**

Agregar al objeto `driversApi`:

```typescript
import type { ComplianceRecord, Contact, Driver, DriverSearchResult, OperationalStatus } from '@/lib/types'
```

```typescript
  search: (q: string, limit = 10) =>
    apiFetch<DriverSearchResult[]>(`/api/v1/drivers?q=${encodeURIComponent(q)}&limit=${limit}`),
```

- [x] **Step 4: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/drivers.ts
git commit -m "feat(diario): tipos DriverSearchResult/DriverPickCandidate + driversApi.search"
```

---

### Task 4: `DriverSearchPicker.tsx` — componente compartido de búsqueda de conductor

**Files:**
- Create: `monitor-app/frontend/components/dashboard/DriverSearchPicker.tsx`
- Create: `monitor-app/frontend/components/dashboard/DriverSearchPicker.test.tsx`

**Interfaces:**
- Consumes: `driversApi.search` (Task 3), tipo `DriverPickCandidate` (Task 3).
- Produces: componente `DriverSearchPicker` — consumido por `TripAssignDialog` (Task 5).

- [x] **Step 1: Escribir el componente**

```tsx
'use client'

import { useState } from 'react'
import { Search, Loader2, User } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import type { DriverPickCandidate } from '@/lib/types'

interface Props {
  query:          string
  onQueryChange:  (q: string) => void
  onPick:         (d: DriverPickCandidate) => void
  /** Mostrado cuando el campo está vacío (ej: conductores disponibles hoy) */
  suggested?:     DriverPickCandidate[]
  suggestedLabel?: string
  placeholder?:   string
  minChars?:      number
  autoFocus?:     boolean
}

export function DriverSearchPicker({
  query, onQueryChange, onPick, suggested = [], suggestedLabel = 'Disponibles hoy',
  placeholder = 'Buscar conductor (nombre o RUT)…', minChars = 2, autoFocus,
}: Props) {
  const qDebounced = useDebouncedValue(query, 250)
  const searching = query.trim().length >= minChars

  const searchQuery = useQuery({
    queryKey: ['drivers', 'search', qDebounced],
    queryFn: () => driversApi.search(qDebounced),
    enabled: searching && qDebounced.trim().length >= minChars,
  })

  const results = searching ? (searchQuery.data ?? []) : suggested
  const label   = searching ? null : (suggested.length > 0 ? suggestedLabel : null)

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar conductor"
          className="w-full text-sm border border-border rounded-lg pl-8 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
        />
      </div>

      {label && (
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-2 mb-1">{label}</p>
      )}

      <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5">
        {searching && searchQuery.isFetching && (
          <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Buscando…
          </p>
        )}
        {searching && !searchQuery.isFetching && results.length === 0 && (
          <p className="px-3 py-2 text-center text-[11px] text-gray-400">
            Sin resultados en el directorio de Empresas
          </p>
        )}
        {!searching && results.length === 0 && (
          <p className="px-3 py-2 text-center text-[11px] text-gray-300 italic">
            Escribe para buscar…
          </p>
        )}
        {results.map(d => (
          <button
            key={d.driver_id}
            type="button"
            onClick={() => onPick(d)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
          >
            <User size={12} className="text-gray-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-text-primary truncate">{d.driver_name}</p>
              <p className="text-[10px] text-gray-400">
                {d.carrier_name ?? 'Sin empresa'}{d.tractor_plate ? ` · ${d.tractor_plate}` : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [x] **Step 2: Escribir los tests**

```tsx
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverSearchPicker } from './DriverSearchPicker'
import { driversApi } from '@/lib/api/drivers'
import type { DriverPickCandidate } from '@/lib/types'

vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

const SUGGESTED: DriverPickCandidate = {
  driver_id: 's1', driver_name: 'Pedro Soto', driver_rut: '11111111-1', driver_phone: null,
  carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ZZZZ11',
}
const FOUND: DriverPickCandidate = {
  driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: null,
  carrier_id: 'c2', carrier_name: 'Transportes Sur', tractor_asset_id: null, tractor_plate: null,
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Controlled(props: Partial<React.ComponentProps<typeof DriverSearchPicker>> = {}) {
  const [q, setQ] = useState('')
  return (
    <Wrapper>
      <DriverSearchPicker query={q} onQueryChange={setQ} onPick={vi.fn()} {...props} />
    </Wrapper>
  )
}

beforeEach(() => {
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([FOUND])
})

describe('DriverSearchPicker', () => {
  it('shows the suggested list when the query is empty', () => {
    render(<Controlled suggested={[SUGGESTED]} />)
    expect(screen.getByText('Pedro Soto')).toBeInTheDocument()
    expect(driversApi.search).not.toHaveBeenCalled()
  })

  it('searches and shows results once minChars is reached, hiding the suggested list', async () => {
    render(<Controlled suggested={[SUGGESTED]} />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.queryByText('Pedro Soto')).not.toBeInTheDocument()
  })

  it('calls onPick with the full candidate when a row is clicked', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} suggested={[SUGGESTED]} />)
    fireEvent.click(screen.getByText('Pedro Soto'))
    expect(onPick).toHaveBeenCalledWith(SUGGESTED)
  })

  it('shows an empty state distinct from the suggested-list empty state when a search has no results', async () => {
    vi.mocked(driversApi.search).mockResolvedValue([])
    render(<Controlled />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Nadie' } })
    expect(await screen.findByText('Sin resultados en el directorio de Empresas')).toBeInTheDocument()
  })
})
```

- [x] **Step 3: Correr los tests**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/DriverSearchPicker.test.tsx`
Expected: 4 passed

- [x] **Step 4: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: limpio

- [x] **Step 5: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/DriverSearchPicker.tsx monitor-app/frontend/components/dashboard/DriverSearchPicker.test.tsx
git commit -m "feat(diario): componente DriverSearchPicker (búsqueda de conductor, TripAssignDialog)"
```

---

### Task 5: `TripAssignDialog.tsx` — fusión driver-first

**Files:**
- Create: `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx` (basado en `TripCreateSlideOver.tsx` — columna izquierda casi sin cambios, columna derecha reescrita)
- Create: `monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx`

**Interfaces:**
- Consumes: `DriverSearchPicker` (Task 4), `useAvailableDrivers` (ya existe en `AvailabilityPanel.tsx`, se mueve acá en el Task 6), `tripsApi.create`.
- Produces: componente `TripAssignDialog` — consumido por `page.tsx` (Task 6).

- [x] **Step 1: Crear el componente**

Copiar `monitor-app/frontend/components/dashboard/TripCreateSlideOver.tsx` a `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx`, y aplicar estos cambios:

1. Renombrar `export function TripCreateSlideOver(...)` → `export function TripAssignDialog(...)`.

2. Los imports actuales del archivo (verificado, no asumido) son:

```typescript
import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Plus, Search, Building2, User, Truck,
  MapPin, Trash2, Link2,
} from 'lucide-react'
import type {
  Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload,
} from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { carriersApi } from '@/lib/api/carriers'
import { useQuery } from '@tanstack/react-query'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'
import { CarrierSearchPicker, type CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'
```

Cambiar a:

```typescript
import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Plus, Search, User, Truck,
  MapPin, Trash2, Link2,
} from 'lucide-react'
import type {
  Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload, DriverPickCandidate,
} from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { useQuery } from '@tanstack/react-query'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'
import { DriverSearchPicker } from '@/components/dashboard/DriverSearchPicker'
```

(`Building2` se quita — sin consumidores después de este cambio, ver puntos 3 y 9 más abajo; `User` ya estaba importado, se reusa para el ícono de la nueva sección "Conductor"; `carriersApi`/`CarrierSearchPicker`/`CarrierSearchResult` se quitan — solo los usaba `EmpresaSelector`; `tripsApi` y `useQuery` ya estaban, se mantienen tal cual).

3. Quitar el tipo `EmpresaSeleccionada` y la función `EmpresaSelector` completa (lo que hoy son las líneas ~17-140 de `TripCreateSlideOver.tsx`).

4. Cambiar la firma de `Props` — quitar `prefill`, agregar `fecha`:

```typescript
interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
  /** Fecha activa del Diario — para sugerir conductores disponibles hoy */
  fecha:     string
}
```

5. En el cuerpo del componente, quitar el estado `empresa`/`EmpresaSeleccionada` y reemplazar por:

```typescript
  const [driverQuery, setDriverQuery] = useState('')
  const [pickedDriver, setPickedDriver] = useState<DriverPickCandidate | null>(null)

  const availableQuery = useQuery({
    queryKey: ['available-drivers', fecha],
    queryFn: () => tripsApi.availableDrivers(fecha),
    enabled: open,
  })
```

6. Cambiar el `useEffect` de apertura — quitar las líneas de `prefill`/`clientChoice` derivadas de `prefill?.client_name` (ya no existe `prefill`) y quitar `setEmpresa(null)`, agregar `setPickedDriver(null)`/`setDriverQuery('')`:

```typescript
  useEffect(() => {
    if (open) {
      setForm({ planning_date: todayISO() })
      setClientChoice(''); setClientOther('')
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setPickedDriver(null)
      setDriverQuery('')
      setErr(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
```

7. Quitar `handleSelectEmpresa`/`handleClearEmpresa`, agregar:

```typescript
  function handlePickDriver(d: DriverPickCandidate) {
    setPickedDriver(d)
    setDriverQuery('')
    setForm(f => ({
      ...f,
      driver_id:         d.driver_id,
      driver_name:       d.driver_name,
      driver_rut:        d.driver_rut ?? undefined,
      driver_phone:      d.driver_phone ?? undefined,
      carrier_id:        d.carrier_id ?? undefined,
      transporter_name:  d.carrier_name ?? undefined,
      tractor_asset_id:  d.tractor_asset_id ?? undefined,
      tractor_plate:     d.tractor_plate ?? undefined,
    }))
  }

  function handleClearDriver() {
    setPickedDriver(null)
    setForm(f => ({
      ...f,
      driver_id: undefined, driver_name: undefined, driver_rut: undefined,
      driver_phone: undefined, carrier_id: undefined, transporter_name: undefined,
      tractor_asset_id: undefined, tractor_plate: undefined,
    }))
  }
```

8. En `handleCreate`, agregar la validación de bloqueo (después de la validación existente de `planning_date`):

```typescript
    if (!form.driver_id) { setErr('Elegí un conductor del directorio de Empresas antes de crear el viaje'); return }
```

9. Reemplazar toda la columna derecha del JSX (`{/* RIGHT — Empresa & Flota ... */}` hasta el `</div>` que la cierra, justo antes del `</div>` que cierra el `grid md:grid-cols-2`) por:

```tsx
            {/* RIGHT — Conductor primero (llave real de la operación diaria);
                empresa/vehículo se autocompletan editables desde sus
                asignaciones activas — Ronda 26, TripAssignDialog */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>

              {pickedDriver ? (
                <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{pickedDriver.driver_name}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{pickedDriver.driver_rut ?? ''}</p>
                  </div>
                  <button type="button" onClick={handleClearDriver} className="text-xs text-gray-400 hover:text-red-400 transition-colors shrink-0 ml-3">
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <DriverSearchPicker
                    query={driverQuery}
                    onQueryChange={setDriverQuery}
                    onPick={handlePickDriver}
                    suggested={availableQuery.data ?? []}
                    suggestedLabel="Disponibles hoy"
                    autoFocus
                  />
                  {driverQuery.trim().length >= 2 && (
                    <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                      Si no aparece en la lista, hay que darlo de alta primero en{' '}
                      <a href="/dashboard/transportistas" className="underline font-semibold">Empresas</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
                    </p>
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Empresa de transporte">
                  <input type="text" value={form.transporter_name ?? ''} onChange={e => set('transporter_name', e.target.value)} placeholder="Se autocompleta al elegir conductor" className={INPUT} disabled={!pickedDriver} />
                </Field>
                <Field label="Teléfono">
                  <input type="text" value={form.driver_phone ?? ''} onChange={e => set('driver_phone', e.target.value)} placeholder="+56912345678" className={INPUT} disabled={!pickedDriver} />
                </Field>
              </div>

              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Truck size={14} />}>Vehículo</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Patente tracto">
                    <input type="text" value={form.tractor_plate ?? ''} onChange={e => set('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" className={INPUT + ' uppercase'} disabled={!pickedDriver} />
                  </Field>
                  <Field label="Patente rampla">
                    <input type="text" value={form.trailer_plate ?? ''} onChange={e => set('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" className={INPUT + ' uppercase'} />
                  </Field>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Autocompletado editable desde la asignación activa del conductor — corregí acá si ese día manejó otro equipo.
                </p>
              </div>
            </div>
```

10. En el botón de submit del footer, agregar `|| !form.driver_id` a la condición `disabled`:

```tsx
              disabled={saving || !form.planning_date || !form.driver_id}
```

- [x] **Step 2: Escribir los tests**

Copiar `TripCreateSlideOver.test.tsx` a `TripAssignDialog.test.tsx` y ajustar. El archivo real hoy (verificado, no asumido) mockea así:

```tsx
vi.mock('@/lib/api/trips', () => ({
  tripsApi: { create: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn(), listDrivers: vi.fn(), listAssets: vi.fn() },
}))
```

y en `beforeEach`:

```tsx
beforeEach(() => {
  vi.mocked(tripsApi.create).mockReset()
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: [], count: 0, page: 1, limit: 10 } as never)
  vi.mocked(carriersApi.listDrivers).mockReset()
  vi.mocked(carriersApi.listAssets).mockReset()
})
```

Cambios:
- Reemplazar todo `import { TripCreateSlideOver }` por `import { TripAssignDialog }`, y `renderCreate` (la función helper que hoy renderiza `<TripCreateSlideOver open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} {...props} />`) para que renderice `<TripAssignDialog open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} fecha="2026-07-18" {...props} />` (nueva prop obligatoria `fecha`).
- Borrar `import { carriersApi } from '@/lib/api/carriers'`, el `vi.mock('@/lib/api/carriers', ...)` completo, y sus 3 líneas en `beforeEach` — ya no se usa.
- Agregar `import { driversApi } from '@/lib/api/drivers'` y:

```tsx
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))
```

- Extender el mock de `tripsApi` (agregar `availableDrivers`, mismo objeto):

```tsx
vi.mock('@/lib/api/trips', () => ({
  tripsApi: { create: vi.fn(), availableDrivers: vi.fn() },
}))
```

- En `beforeEach`, agregar junto a los `vi.mocked(tripsApi.create).mockReset()` existentes:

```tsx
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([])
  vi.mocked(tripsApi.availableDrivers).mockReset().mockResolvedValue([])
```

- El test `'searches carriers, fetches its roster on selection, and sends carrier_id on create'` se reemplaza por:

```tsx
  it('requires picking a driver from the directory before Crear viaje is enabled', async () => {
    render(<TripAssignDialog open onClose={vi.fn()} onCreated={vi.fn()} meta={null} fecha="2026-07-18" />)
    expect(screen.getByText('Crear viaje')).toBeDisabled()
  })

  it('picks a driver, autofills empresa/vehículo, and sends driver_id + carrier_id on create', async () => {
    vi.mocked(driversApi.search).mockResolvedValue([{
      driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: null,
      carrier_id: 'c1', carrier_name: 'Transportes Sur', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
    }])
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't1' } as never)
    render(<TripAssignDialog open onClose={vi.fn()} onCreated={vi.fn()} meta={null} fecha="2026-07-18" />)

    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
    fireEvent.click(await screen.findByText('Juan Pérez'))

    expect(screen.getByDisplayValue('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Crear viaje')).not.toBeDisabled()

    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ driver_id: 'd1', carrier_id: 'c1', tractor_asset_id: 'a1' })
    ))
  })

  it('shows a warning with a link to Empresas when the driver search has no matches', async () => {
    vi.mocked(driversApi.search).mockResolvedValue([])
    render(<TripAssignDialog open onClose={vi.fn()} onCreated={vi.fn()} meta={null} fecha="2026-07-18" />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Nadie Real' } })
    expect(await screen.findByText(/no se puede crear el viaje sin un conductor vinculado/)).toBeInTheDocument()
  })
```

Cualquier otro test existente de `TripCreateSlideOver.test.tsx` que dependa de `empresa`/roster de empresa se elimina (ya no aplica); los que prueban campos no relacionados (fecha, cliente, TMS, destinos, región/ciudad) se conservan tal cual, ajustando solo el render a `<TripAssignDialog fecha="2026-07-18" .../>`.

- [x] **Step 3: Correr los tests**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TripAssignDialog.test.tsx`
Expected: todos pasan — ajustar cualquier test heredado que falle por el cambio de columna derecha antes de seguir.

- [x] **Step 4: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: limpio (todavía puede fallar por `AvailabilityPanel.tsx`/`TripCreateSlideOver.tsx` sin tocar — se resuelve en el Task 6)

- [x] **Step 5: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/components/dashboard/TripAssignDialog.tsx monitor-app/frontend/components/dashboard/TripAssignDialog.test.tsx
git commit -m "feat(diario): TripAssignDialog — fusión driver-first de disponibilidad + creación de viaje"
```

---

### Task 6: Wirear en `page.tsx`, retirar `AvailabilityPanel`/`TripCreateSlideOver`, verificación final

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/diario/page.tsx`
- Delete: `monitor-app/frontend/components/dashboard/AvailabilityPanel.tsx`
- Delete: `monitor-app/frontend/components/dashboard/AvailabilityPanel.test.tsx`
- Delete: `monitor-app/frontend/components/dashboard/TripCreateSlideOver.tsx`
- Delete: `monitor-app/frontend/components/dashboard/TripCreateSlideOver.test.tsx`

- [x] **Step 1: Actualizar imports en `page.tsx`**

Cambiar:

```typescript
import { TripCreateSlideOver } from '@/components/dashboard/TripCreateSlideOver'
```

y

```typescript
import { AvailabilityPanel, useAvailableDrivers, useAvailableAssets } from '@/components/dashboard/AvailabilityPanel'
import type { AvailableDriver, AvailableAsset, TripCreatePayload } from '@/lib/types'
```

Por:

```typescript
import { TripAssignDialog } from '@/components/dashboard/TripAssignDialog'
```

(la línea `import type { AvailableDriver, AvailableAsset, TripCreatePayload } from '@/lib/types'` se borra entera — ninguno de esos 3 tipos se usa más en `page.tsx`)

- [x] **Step 2: Simplificar el estado de disponibilidad/creación**

`page.tsx` hoy solo importa `useQueryClient` de `@tanstack/react-query` (no `useQuery`). Cambiar esa línea:

```typescript
import { useQueryClient } from '@tanstack/react-query'
```

a:

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query'
```

Y agregar `import { tripsApi } from '@/lib/api/trips'` a los imports (hoy `page.tsx` solo importa el tipo `TripListResponse` de ese módulo, no el valor `tripsApi`).

Reemplazar:

```typescript
  // ── Conductores/equipos disponibles (sin viaje abierto hoy) ─────────────────
  const [showAvailability, setShowAvailability] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<Partial<TripCreatePayload> | null>(null)
  const driversQuery = useAvailableDrivers(f.fecha, f.tab === 'en_curso')
  const assetsQuery  = useAvailableAssets(f.fecha, f.tab === 'en_curso')
  const availableCount = (driversQuery.data?.length ?? 0) + (assetsQuery.data?.length ?? 0)

  function handleAssignDriver(d: AvailableDriver) {
    setCreatePrefill({
      driver_name:   d.driver_name,
      driver_rut:    d.driver_rut ?? undefined,
      driver_phone:  d.driver_phone ?? undefined,
      tractor_plate: d.tractor_plate ?? undefined,
    })
    setShowAvailability(false)
    setShowCreate(true)
  }

  function handleAssignAsset(a: AvailableAsset) {
    setCreatePrefill({
      tractor_plate: a.tractor_plate,
    })
    setShowAvailability(false)
    setShowCreate(true)
  }
```

Por:

```typescript
  // ── Conductores disponibles (sin viaje abierto hoy) — solo para el conteo
  // del tile, la lista sugerida vive dentro de TripAssignDialog (Ronda 26)
  const availableCountQuery = useQuery({
    queryKey: ['available-drivers', f.fecha],
    queryFn: () => tripsApi.availableDrivers(f.fecha),
    enabled: f.tab === 'en_curso',
  })
  const availableCount = availableCountQuery.data?.length ?? 0
```

(agregar `import { tripsApi } from '@/lib/api/trips'` a los imports si no está ya — verificar, `useTrips`/`TripListResponse` ya importan de `@/lib/api/trips` como tipos, agregar el valor `tripsApi` explícito)

- [x] **Step 3: Simplificar el tile y quitar el `onClick` que abría el panel**

Cambiar:

```tsx
              {/* Conductores/equipos liberados — reasignables a viajes nuevos */}
              {availableCount > 0 && (
                <button
                  onClick={() => setShowAvailability(true)}
                  className="flex items-center gap-2 bg-white border border-green-200 rounded-xl px-3.5 py-2 transition-all hover:border-green-400 ml-auto"
                >
                  <UserCheck size={14} className="text-green-600" />
                  <span className="text-lg font-bold leading-none text-green-600">{availableCount}</span>
                  <span className="text-[11px] font-medium text-gray-500">
                    disponible{availableCount !== 1 ? 's' : ''}
                  </span>
                </button>
              )}
```

Por (el tile ahora abre el mismo diálogo de creación, ya con la lista de disponibles precargada adentro):

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

- [x] **Step 4: Reemplazar el render de los diálogos**

Cambiar:

```tsx
      <TripCreateSlideOver
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreatePrefill(null) }}
        onCreated={handleCreated}
        meta={tripsMeta}
        prefill={createPrefill}
      />
      <AvailabilityPanel
        open={showAvailability}
        fecha={f.fecha}
        onClose={() => setShowAvailability(false)}
        onAssignDriver={handleAssignDriver}
        onAssignAsset={handleAssignAsset}
      />
```

Por:

```tsx
      <TripAssignDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
        meta={tripsMeta}
        fecha={f.fecha}
      />
```

- [x] **Step 5: Borrar los 4 archivos retirados**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git rm monitor-app/frontend/components/dashboard/AvailabilityPanel.tsx
git rm monitor-app/frontend/components/dashboard/AvailabilityPanel.test.tsx
git rm monitor-app/frontend/components/dashboard/TripCreateSlideOver.tsx
git rm monitor-app/frontend/components/dashboard/TripCreateSlideOver.test.tsx
```

- [x] **Step 6: Verificación completa**

Run, en orden:
```bash
cd monitor-app/frontend
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: los 3 comandos limpios, sin referencias residuales a `AvailabilityPanel`/`TripCreateSlideOver`/`AvailableAsset`/`createPrefill` en ningún archivo (`grep -rn "AvailabilityPanel\|TripCreateSlideOver" --include="*.tsx" --include="*.ts" .` debe devolver 0 resultados).

- [x] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/app/dashboard/diario/page.tsx
git add monitor-app/frontend/components/dashboard/AvailabilityPanel.tsx monitor-app/frontend/components/dashboard/AvailabilityPanel.test.tsx
git add monitor-app/frontend/components/dashboard/TripCreateSlideOver.tsx monitor-app/frontend/components/dashboard/TripCreateSlideOver.test.tsx
git commit -m "feat(diario): wirear TripAssignDialog en page.tsx, retirar AvailabilityPanel/TripCreateSlideOver"
```

---

## Self-Review

**1. Cobertura del spec**: cubre íntegramente la sección "1. Diálogo de asignación fusionado" del spec — entrada única por conductor, autocompletado editable de empresa/vehículo, bloqueo sin `driver_id`, ambas entradas ("+ Nuevo viaje" y tile) abren el mismo diálogo. La corrección real encontrada durante el diseño (TripCreateSlideOver ya es un diálogo centrado, no un slide-over) está reflejada en la Architecture de este plan.
**2. Placeholders**: ninguno — cada paso de código está completo. Las instrucciones de "copiar X a Y y aplicar estos cambios" en el Task 5 no son placeholders — son ediciones exactas y completas sobre un archivo ya escrito en su totalidad (leído íntegro esta sesión), no un resumen de qué hacer.
**3. Consistencia de tipos**: `DriverPickCandidate` se usa igual en `types.ts` (Task 3), `DriverSearchPicker` (Task 4) y `TripAssignDialog` (Task 5). `AvailableDriver`/`DriverSearchResult` ambos extienden `DriverPickCandidate`, consistente con Task 1/2 del backend (mismo shape de columnas).
**4. Alcance**: depende de que el Plan 1 (`driver_leg_number`) ya esté hecho — no lo usa directamente, pero comparte el mismo `trip_fleet_links`/`driver_assignments`. Independiente del Plan 3 (escalabilidad de filtros) — no lo bloquea ni lo necesita.
**5. Fuera de alcance, explícito**: `CarrierAssignSection` (reasignar empresa a un viaje YA existente, dentro de `TripSlideOver`) no se toca — sigue usando `CarrierSearchPicker` tal cual, es un flujo distinto (edición, no alta).
