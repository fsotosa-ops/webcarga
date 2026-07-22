# driver_leg_number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Expose a computed `driver_leg_number` field on every trip (1 = primer viaje del conductor ese día, 2 = segundo, etc.), calculado en el momento de la consulta a partir de `trip_fleet_links`/`vehicle_driver_assignments` (driver resuelto) + la parada ORIGIN de `app.trip_stops` (orden cronológico), sin tocar dbt/Mage ni agregar columnas persistidas.

**Architecture:** Ventana SQL (`ROW_NUMBER() OVER (PARTITION BY driver_id, planning_date ORDER BY salida de origen)`) vive dentro de una vista nueva y autocontenida, `app.v_driver_daily_trip_legs` — ahí la ventana es segura (FROM fijo, sin WHERE externo que la afecte). `_TRIP_SELECT` (compartido por `GET /trips` y `GET /trips/{id}`) solo hace un lookup de una fila contra esa vista, con un `LEFT JOIN` nuevo hacia `app.trip_stops` (solo `stop_type='ORIGIN'`) agregado a `_TRIP_FROM` para el ordenamiento interno de la vista.

**Tech Stack:** FastAPI + asyncpg (backend), subconsulta correlacionada Postgres (no window function — ver nota del Task 2), TypeScript (frontend, solo el tipo).

## Global Constraints

- No se modifica ningún modelo dbt ni se sincroniza nada a Mage — la Ronda 21 de esta sesión ya dejó documentado 2 veces el riesgo del watermark incremental; este cálculo vive exclusivamente en `trips.py`.
- `driver_leg_number` es `NULL` para cualquier viaje sin `trip_fleet_links.driver_id` explícito (la vista `app.v_driver_daily_trip_legs` no lo incluye) — nunca se le asigna un número arbitrario a viajes sin trazabilidad real. No reproduce el fallback de resolución en vivo por patente (`d_auto`) que sí usa `_TRIP_SELECT` para otros campos.
- El campo nuevo en el tipo `Trip` de TypeScript debe ser opcional (`driver_leg_number?:`), mismo patrón ya usado para `origin_operation_type?:`/`stop_type?:` en este proyecto — evita romper los fixtures `makeTrip()` de los tests existentes en `TripTable.test.tsx`/`TripCard.test.tsx`/etc., que construyen objetos `Trip` completos a mano.
- No se toca `is_first_leg` (columna existente) — sigue en la base, sin relación con este campo nuevo. Su reemplazo como fuente del filtro "vuelta N" es trabajo de un plan posterior (escalabilidad de filtros), no de este.

---

### Task 1: Agregar el JOIN a la parada ORIGIN en `_TRIP_FROM`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:262-301` (`_TRIP_FROM`)
- Test: `monitor-app/backend/api/tests/test_trip_hybrid_fields.py`

**Interfaces:**
- Produces: alias SQL `ots` (origin trip stop) disponible en `_TRIP_FROM`, con columnas `ots.departure_date`, `ots.gps_departure_date`, `ots.desc_inicio_manual`, `ots.departure_date_prog`, `ots.planning_date` — usadas por el Task 2 para ordenar la subconsulta de `driver_leg_number`.

- [x] **Step 1: Escribir el test que falla — el JOIN nuevo aparece en la query**

Agregar al final de `monitor-app/backend/api/tests/test_trip_hybrid_fields.py`:

```python
# ── driver_leg_number — "vuelta N" calculada, no is_first_leg manual ────────

def test_trip_from_joins_origin_stop_for_leg_number_ordering():
    pool = make_pool()
    client = make_client(pool)
    client.get("/api/v1/trips/trip-1")
    query = pool.fetchrow.call_args.args[0]
    assert "LEFT JOIN app.trip_stops ots" in query
    assert "ots.stop_type = 'ORIGIN'" in query
```

- [x] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_hybrid_fields.py::test_trip_from_joins_origin_stop_for_leg_number_ordering -v`
Expected: FAIL — `assert "LEFT JOIN app.trip_stops ots" in query` (el JOIN todavía no existe)

- [x] **Step 3: Agregar el JOIN a `_TRIP_FROM`**

En `monitor-app/backend/api/app/routers/trips.py`, el bloque `_TRIP_FROM` termina hoy en:

```python
    LEFT JOIN public.drivers d_auto ON d_auto.id = vda_auto.driver_id
    LEFT JOIN public.profiles p ON p.id = t.edited_by
"""
```

Agregar el nuevo JOIN entre esas dos líneas:

```python
    LEFT JOIN public.drivers d_auto ON d_auto.id = vda_auto.driver_id
    -- "Vuelta N" (driver_leg_number, ver _TRIP_SELECT): orden cronológico de
    -- los viajes de un conductor en el día, basado en cuándo salió del
    -- origen — trae solo la fila ORIGIN de trip_stops (a lo sumo 1 por viaje,
    -- ver assert_trip_stops_at_most_one_origin_per_trip, Ronda 21).
    LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
    LEFT JOIN public.profiles p ON p.id = t.edited_by
"""
```

- [x] **Step 4: Correr el test y confirmar que pasa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_hybrid_fields.py::test_trip_from_joins_origin_stop_for_leg_number_ordering -v`
Expected: PASS

- [x] **Step 5: Correr la suite completa de trips para confirmar cero regresiones**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos los tests pasan (230 antes de este plan + 1 nuevo)

- [x] **Step 6: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_hybrid_fields.py
git commit -m "feat(diario): join a la parada ORIGIN para ordenar driver_leg_number"
```

---

### Task 2: Vista `app.v_driver_daily_trip_legs` + `driver_leg_number` en `_TRIP_SELECT`

**Corrección encontrada al revisar el plan antes de ejecutar**: una ventana `ROW_NUMBER() OVER (PARTITION BY ...)` calculada directo sobre `_TRIP_SELECT` se rompe en los dos usos reales de esa constante. `GET /trips/{id}` filtra `WHERE t.id = $1` *antes* de que la ventana vea los demás viajes del conductor — daría siempre 1. `GET /trips` aplica los filtros del usuario (estado, flags) antes de numerar — si un viaje del conductor queda afuera por un filtro activo, los que quedan se renumeran entre sí, dando un número inestable que cambia según qué filtro esté prendido.

**Fix, mejorado durante la ejecución** (a pedido del usuario, para no rehacer trabajo cuando se arme el reporte de monitoreo diario/semanal/mensual con histórico — fast-follow ya documentado en el spec como "contexto de tendencia"): en vez de una subconsulta ad-hoc duplicando joins dentro de `_TRIP_SELECT`, la ventana vive en una **vista** nueva (`app.v_driver_daily_trip_legs`), con su propio FROM fijo — ahí la ventana SÍ es segura, porque Postgres no puede empujar un WHERE externo hacia adentro de una ventana (barrera de optimización conocida), así que el filtro que aplique `list_trips`/`get_trip` después nunca cambia lo que la ventana ya calculó. `_TRIP_SELECT` pasa a hacer solo un lookup de una fila contra esa vista. El día que se arme el reporte agregado con historia, parte de la misma vista (`GROUP BY driver_id, planning_date` sobre ella) en vez de reinventar la lógica de conteo — la vista queda como la única fuente de verdad de "qué número de viaje fue este para este conductor ese día".

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260718120000_driver_daily_trip_legs_view.sql`
- Modify: `monitor-app/backend/api/app/routers/trips.py:201-260` (`_TRIP_SELECT`)
- Test: `monitor-app/backend/api/tests/test_trip_hybrid_fields.py`

**Interfaces:**
- Produces (migración): vista `app.v_driver_daily_trip_legs(trip_id uuid, driver_id uuid, planning_date date, leg_number int)` — una fila por cada viaje con `trip_fleet_links.driver_id` explícito.
- Consumes (trips.py): la vista de arriba, vía `t.id`.
- Produces (trips.py): columna `driver_leg_number` (integer o NULL) en toda fila de `_TRIP_SELECT` — consumida por `GET /trips` y `GET /trips/{id}` sin cambios adicionales en esos endpoints.

- [x] **Step 1: Crear y aplicar la migración de la vista**

Crear `monitor-app/backend/supabase/migrations/20260718120000_driver_daily_trip_legs_view.sql`:

```sql
-- "Vuelta N" por conductor/día — fuente única de verdad, reusable por el
-- futuro reporte de monitoreo diario/semanal/mensual (fast-follow "contexto
-- de tendencia" del spec 2026-07-18-diario-assign-dialog-redesign-design.md)
-- sin duplicar esta lógica de conteo. Vista simple (no materializada): se
-- recalcula en vivo en cada lectura, mismo criterio "resolución en vivo" ya
-- usado esta sesión — sin job de refresco, sin riesgo de watermark
-- incremental (el mismo tipo de bug que esta sesión encontró 2 veces con
-- modelos dbt incrementales).
--
-- Solo incluye viajes con trip_fleet_links.driver_id explícito (92% de los
-- vínculos, Ronda 18 del hardening del Diario) — no intenta reproducir acá
-- el fallback de resolución en vivo por patente que sí usa trips.py para
-- otros campos.
CREATE VIEW app.v_driver_daily_trip_legs AS
SELECT
    fl.trip_id,
    fl.driver_id,
    t.planning_date,
    ROW_NUMBER() OVER (
        PARTITION BY fl.driver_id, t.planning_date
        ORDER BY COALESCE(
            ots.departure_date, ots.gps_departure_date, ots.desc_inicio_manual,
            ots.departure_date_prog, ots.planning_date, t.created_at
        )
    ) AS leg_number
FROM app.trip_fleet_links fl
JOIN app.trips t ON t.id = fl.trip_id
LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
WHERE fl.driver_id IS NOT NULL;
```

Aplicar con `mcp__claude_ai_Supabase__apply_migration` (proyecto `viclzoftiudkepqnhekv`, `name: "driver_daily_trip_legs_view"`).

- [x] **Step 2: Verificar la vista en vivo antes de tocar `trips.py`**

Correr vía `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT driver_id, planning_date, array_agg(leg_number ORDER BY leg_number) AS legs, count(*)
FROM app.v_driver_daily_trip_legs
GROUP BY driver_id, planning_date
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 10;
```

Expected: cada `legs` es una secuencia `{1,2,...,N}` sin huecos ni repetidos (ej. `{1,2}`, `{1,2,3}`) — confirma que la partición por conductor/día no tiene bugs antes de conectar el endpoint.

- [x] **Step 3: Escribir el test que falla — el campo aparece en la respuesta y la query hace lookup contra la vista**

Agregar a `monitor-app/backend/api/tests/test_trip_hybrid_fields.py`:

```python
def test_get_trip_endpoint_returns_driver_leg_number():
    pool = make_pool()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None, "driver_leg_number": 2}
    client = make_client(pool)
    res = client.get("/api/v1/trips/trip-1")
    assert res.status_code == 200
    assert res.json()["driver_leg_number"] == 2


def test_trip_select_looks_up_driver_leg_number_from_view():
    pool = make_pool()
    client = make_client(pool)
    client.get("/api/v1/trips/trip-1")
    query = pool.fetchrow.call_args.args[0]
    assert "driver_leg_number" in query
    assert "app.v_driver_daily_trip_legs" in query
    # Lookup de una fila (no una ventana recalculada acá) — la ventana ya
    # vive adentro de la vista, ver Task 2 arriba.
    assert "OVER (" not in query
```

- [x] **Step 4: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_hybrid_fields.py::test_get_trip_endpoint_returns_driver_leg_number tests/test_trip_hybrid_fields.py::test_trip_select_looks_up_driver_leg_number_from_view -v`
Expected: la segunda falla — `app.v_driver_daily_trip_legs` no aparece en la query todavía. La primera puede pasar igual sin cambios de código (el mock ya trae `driver_leg_number` en el dict y `get_trip` solo hace `dict(row)`) — igual correr ambas para confirmar el punto de partida.

- [x] **Step 5: Agregar el lookup a `_TRIP_SELECT`**

En `monitor-app/backend/api/app/routers/trips.py`, `_TRIP_SELECT` termina hoy en:

```python
    t.source_system_trip_id,
    t.milestone_status,
    t.pipeline_updated_at
"""
```

Cambiar a:

```python
    t.source_system_trip_id,
    t.milestone_status,
    t.pipeline_updated_at,
    -- "Vuelta N" del conductor ese día — reemplaza a is_first_leg (manual/
    -- TMS) como fuente del filtro "2ª+ vuelta" (ver plan de escalabilidad de
    -- filtros). Lookup de una fila contra app.v_driver_daily_trip_legs
    -- (migración 20260718120000) — la ventana vive adentro de esa vista, no
    -- acá, para que el resultado sea estable sin importar qué WHERE aplique
    -- la consulta de afuera. NULL si el viaje no tiene fl.driver_id
    -- explícito (la vista no lo incluye).
    (SELECT vdtl.leg_number FROM app.v_driver_daily_trip_legs vdtl WHERE vdtl.trip_id = t.id) AS driver_leg_number
"""
```

Nota: `ots` (el JOIN agregado en el Task 1) queda sin uso directo en `_TRIP_SELECT`/`_TRIP_FROM` después de este cambio — la vista tiene su propio JOIN interno a `trip_stops`, independiente. Se deja igual en `_TRIP_FROM` porque no molesta y documenta la intención; si algún lint de SQL no usado importara acá, se podría quitar, pero no es necesario para que esto funcione.

- [x] **Step 6: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_hybrid_fields.py::test_get_trip_endpoint_returns_driver_leg_number tests/test_trip_hybrid_fields.py::test_trip_select_looks_up_driver_leg_number_from_view -v`
Expected: PASS

- [x] **Step 7: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan

- [x] **Step 8: Verificar en vivo contra Supabase (no solo mocks)**

Correr la query real armada con las 2 constantes ya modificadas, directo contra Supabase, para un día con conductores con 2+ viajes (mismo dataset que la Ronda 18 verificó con `trip_fleet_links.driver_id` poblado):

```sql
-- Pegar acá el contenido literal actualizado de _TRIP_SELECT y _TRIP_FROM
-- desde trips.py (ya con los cambios del Task 1 y 2 aplicados), vía
-- mcp__claude_ai_Supabase__execute_sql, proyecto viclzoftiudkepqnhekv:
SELECT id, planning_date, driver_id, driver_leg_number
FROM ( SELECT <pegar _TRIP_SELECT> <pegar _TRIP_FROM> ) sub
WHERE driver_id IS NOT NULL
ORDER BY driver_id, planning_date, driver_leg_number
LIMIT 50;
```

Confirmar manualmente: agrupando por `(driver_id, planning_date)`, los `driver_leg_number` de cada grupo son una secuencia `1, 2, 3...` sin huecos ni repetidos, en el mismo orden que las horas reales de salida de esos viajes.

Expected: para un conductor con 2 viajes el mismo `planning_date`, uno tiene `driver_leg_number: 1` y el otro `driver_leg_number: 2`, ordenados por hora real de salida de origen; viajes sin `driver_id` explícito muestran `driver_leg_number: null`. Ya verificado en el Step 2, esto solo confirma el pass-through end-to-end vía el endpoint real.

- [x] **Step 9: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_hybrid_fields.py monitor-app/backend/supabase/migrations/20260718120000_driver_daily_trip_legs_view.sql
git commit -m "feat(diario): vista v_driver_daily_trip_legs + driver_leg_number (vuelta N) por conductor/día"
```

---

### Task 3: Exponer el campo en el tipo `Trip` del frontend

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts:376-436` (`Trip`)

**Interfaces:**
- Consumes: nada (solo tipo).
- Produces: `Trip.driver_leg_number?: number | null` — consumido por el plan de escalabilidad de filtros (Plan 3, todavía no escrito) para el filtro "2ª+ vuelta".

- [x] **Step 1: Agregar el campo al tipo**

En `monitor-app/frontend/lib/types.ts`, el tipo `Trip` termina hoy en:

```typescript
  /** Clasificación RM/Zona Cero del origen — mismo mecanismo que
   *  TripStop.operation_type. Casi siempre null para orígenes tipo CD (no
   *  son locales de cliente, no están en el catálogo). */
  origin_operation_type?: string | null
}
```

Cambiar a:

```typescript
  /** Clasificación RM/Zona Cero del origen — mismo mecanismo que
   *  TripStop.operation_type. Casi siempre null para orígenes tipo CD (no
   *  son locales de cliente, no están en el catálogo). */
  origin_operation_type?: string | null
  /** Nº de viaje del conductor ese día (1 = primero, 2 = segundo...),
   *  calculado en vivo por trips.py — null si no hay conductor resuelto.
   *  Reemplaza a is_first_leg como fuente del filtro "2ª+ vuelta". */
  driver_leg_number?:      number | null
}
```

- [x] **Step 2: Verificar tipos**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores (campo opcional, no rompe ningún fixture `makeTrip()` existente)

- [x] **Step 3: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/frontend/lib/types.ts
git commit -m "feat(diario): tipo driver_leg_number en Trip (frontend)"
```

---

## Self-Review

**1. Cobertura del spec**: este plan cubre íntegramente la sección "2. Vuelta N calculada" del spec (`docs/superpowers/specs/2026-07-18-diario-assign-dialog-redesign-design.md`) — cálculo sin migración a dbt/Mage (la migración nueva de este plan es una vista propia de `app.*`, no toca el pipeline), campo nuevo `driver_leg_number`, `is_first_leg` intacto. Tres correcciones se aplicaron respecto al spec original: (a) columnas reales de `app.trip_stops` (`departure_date`/`gps_departure_date`/`desc_inicio_manual`/`departure_date_prog`, no `actual_departure_at`/`planned_departure_at`), ya corregido también en el spec; (b) mecanismo de cálculo — el spec describe una ventana SQL directo sobre `_TRIP_SELECT`, pero la revisión crítica de este plan (antes de ejecutar) encontró que eso da resultados incorrectos/inestables en los 2 usos reales de esa constante; (c) mejora pedida por el usuario durante la ejecución — en vez de una subconsulta ad-hoc duplicando joins, la ventana vive en una vista nueva (`app.v_driver_daily_trip_legs`), reusable sin rehacer trabajo por el futuro reporte de monitoreo con histórico (fast-follow "contexto de tendencia" ya documentado en el spec). El spec queda con la descripción de "ventana directa" desactualizada — no se corrigió ahí porque el detalle de implementación exacto es propiedad de este plan, no del spec.
**2. Placeholders**: ninguno — cada paso tiene código completo, comandos exactos, resultado esperado.
**3. Consistencia de tipos**: `driver_leg_number` se usa igual en la vista (Task 2, columna `leg_number` renombrada al hacer el lookup), `_TRIP_SELECT` (Task 2) y el tipo frontend (Task 3) — mismo nombre externo en los 3.
**4. Alcance**: autocontenido — no depende de ningún otro plan, y no incluye nada de UI (eso es el plan de escalabilidad de filtros, todavía no escrito). La vista nueva es intencionalmente reusable por un futuro plan de monitoreo agregado, pero ese plan no es parte de este ni se escribe acá.
