# "Activo" y "asignado" del viaje en la base — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un viaje manual nuevo y cualquier cambio de flota hecho desde la app dejen `is_active`/`is_assigned`
correctos en la misma transacción, con una sola definición de la regla, y que la copia a `app.trips_manual` deje de
perder ediciones en silencio.

**Architecture:**
- Dos funciones SQL en `app` son la única definición de la regla. Las llaman tres escritores:
  - las macros de dbt, en cada corrida de Mage;
  - el `INSERT` del alta manual;
  - tres triggers de sentencia sobre `app.trip_fleet_links`.
- Las cuatro rutas de edición de un viaje escriben en una sola transacción.

**Tech Stack:** Postgres 17 (Supabase), FastAPI + asyncpg, dbt-postgres en Mage, y pytest con integración contra la
base real (fixture `conexion_revertida`).

**Spec:** `docs/superpowers/specs/2026-10-11-trip-assignment-in-the-database-design.md`

## Global Constraints

- **Nombres:** todo nombre nuevo va en inglés estándar (funciones, triggers, archivos y tests nuevos). Lo que ve el
  usuario y los comentarios van en español neutral, nunca voseo.
- **La regla de negocio no cambia:** asignado = no "Publicada" Y (patente de tracto o rampla, o nombre o RUT del
  conductor en `fleet`, o un vínculo con tracto, rampla o conductor). Abierto = no `CERRADO%` y no
  `CANCELADO`/`Declinada`/`Removida`; con NULL da NULL.
- **Cada test nuevo se hace fallar primero.** Cuando el test se escribe después del código, se aplica una mutación.
- **Qué se corre:** solo los tests del área, sin suite completa y sin `npm run build` (no hay frontend). Venv:
  `monitor-app/backend/api/venv`.
- **Fechas de los viajes de prueba:** `2099-01-15`, un día que nadie firma.
- **Mage** se toca solo con OK explícito del usuario y entre dos corridas.
- **La migración** se ensaya con `ROLLBACK` en la base real antes de aplicarla con `apply_migration`, y es
  re-ejecutable (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`), porque los tests la ejecutan dentro de su transacción.

## Review Focus

1. **Tormenta de escrituras en la ingesta.** dbt reescribe miles de viajes, `resolve_trip_fleet` reescribe sus
   vínculos automáticos y el trigger nuevo corre. Se espera que no haga ningún `UPDATE` de `app.trips` cuando no hay
   diferencia. Test: `test_link_change_without_effect_does_not_touch_trip` (Task 1).
2. **Override manual de "Asignado".** Quien lo marcó a mano no debe verlo cambiar al editar la flota. Test:
   `test_manual_override_is_respected` (Task 1).
3. **Borrar el vínculo.** Un `DELETE` en `trip_fleet_links` (tabla de transición OLD) debe dejar el viaje no
   asignado si no le queda flota. Test: `test_removing_link_unassigns` (Task 1) y por la ruta HTTP en Task 3.
4. **Una "Publicada" de Sodimac con vínculo.** Aunque Operaciones le vincule un camión, sigue no asignada. Test:
   `test_published_offer_never_assigned_even_with_link` (Task 1).
5. **Falla a mitad de una edición.** Si la copia a `trips_manual` revienta, nada de la edición queda escrito. Test:
   `test_patch_rolls_back_when_mirror_fails` (Task 3).

---

### Task 1: La regla y los triggers en la base

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261012090000_trip_assignment_in_the_database.sql`
- Test: `monitor-app/backend/api/tests/test_trip_assignment_integration.py`

**Interfaces:**
- Produces:
  - `app.is_trip_open(p_status text) RETURNS boolean`;
  - `app.is_trip_assigned(p_status text, p_fleet jsonb, p_trip_id uuid) RETURNS boolean`;
  - `app.sync_trip_assignment()`, una función de trigger;
  - los triggers `trg_sync_trip_assignment_ins/_upd/_del` sobre `app.trip_fleet_links`.
- Test helper (en el archivo de test): `apply_migration(conn)`, que ejecuta el `.sql` dentro de la transacción del
  test, y `insert_tms_trip(conn, status, fleet) -> str`.

- [ ] **Step 1: Write the failing tests**

```python
"""Activo y asignado del viaje: una sola definición en la base (spec 2026-10-11,
trip-assignment-in-the-database). La migración se ejecuta dentro de la
transacción revertida de cada test, así que esto prueba el archivo antes de
aplicarlo en la base real."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from tests.conftest import cliente_de_prueba

pytestmark = pytest.mark.integracion

MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261012090000_trip_assignment_in_the_database.sql"
)
TEST_DATE = "2099-01-15"


async def apply_migration(conn) -> None:
    await conn.execute(MIGRATION.read_text())


async def open_status(conn) -> str:
    return await conn.fetchval(
        "SELECT id FROM app.trip_statuses WHERE active AND group_id = 'en_ruta' ORDER BY id LIMIT 1")


async def insert_tms_trip(conn, status: str, fleet: dict) -> str:
    trip_id = str(uuid.uuid4())
    client = await cliente_de_prueba(conn)
    await conn.execute(
        """
        INSERT INTO app.trips (id, source_system, source_system_trip_id, client_name, planning_date,
                               trip_status, fleet, is_active, is_working, is_assigned, is_first_leg,
                               manually_edited_fields)
        VALUES ($1::uuid, 'qanalytics', $2, $3, $4::date, $5, $6::jsonb, true, false, false, false, '{}')
        """,
        trip_id, f"TEST-{trip_id[:8]}", client, TEST_DATE, status, json.dumps(fleet))
    return trip_id


async def any_driver_id(conn) -> str:
    return str(await conn.fetchval(
        "SELECT id FROM public.drivers WHERE operational_status = 'ACTIVE' ORDER BY id LIMIT 1"))


async def is_assigned(conn, trip_id: str) -> bool:
    return await conn.fetchval("SELECT is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)


async def test_is_trip_open(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    assert await conn.fetchval("SELECT app.is_trip_open('CERRADO FINALIZADO')") is False
    assert await conn.fetchval("SELECT app.is_trip_open('Declinada')") is False
    assert await conn.fetchval("SELECT app.is_trip_open('ORIGEN')") is True
    assert await conn.fetchval("SELECT app.is_trip_open(NULL)") is None


async def test_is_trip_assigned_reads_fleet_and_link(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    status = await open_status(conn)
    with_plate = await insert_tms_trip(conn, status, {"tractor_plate": "ZZZZ99"})
    with_rut = await insert_tms_trip(conn, status, {"driver_rut_tms": "11111111-1"})
    empty = await insert_tms_trip(conn, status, {"tractor_plate": ""})
    q = "SELECT app.is_trip_assigned(trip_status, fleet, id) FROM app.trips WHERE id = $1::uuid"
    assert await conn.fetchval(q, with_plate) is True
    assert await conn.fetchval(q, with_rut) is True
    assert await conn.fetchval(q, empty) is False


async def test_published_offer_never_assigned_even_with_link(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, "Publicada", {"tractor_plate": "ZZZZ99"})
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))
    assert await is_assigned(conn, trip_id) is False


async def test_linking_a_driver_assigns_in_the_same_transaction(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    assert await is_assigned(conn, trip_id) is False
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))
    assert await is_assigned(conn, trip_id) is True


async def test_removing_link_unassigns(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))
    assert await is_assigned(conn, trip_id) is True
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1::uuid", trip_id)
    assert await is_assigned(conn, trip_id) is False


async def test_manual_override_is_respected(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    await conn.execute(
        "UPDATE app.trips SET is_assigned = false, manually_edited_fields = ARRAY['is_assigned'] "
        "WHERE id = $1::uuid", trip_id)
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))
    assert await is_assigned(conn, trip_id) is False


async def test_link_change_without_effect_does_not_touch_trip(conexion_revertida):
    """Un cambio del vínculo que no altera "asignado" no reescribe el viaje: la
    ingesta reescribe miles de vínculos automáticos por corrida (Disk IO)."""
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {"tractor_plate": "ZZZZ99"})
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))
    before = await conn.fetchval("SELECT ctid::text FROM app.trips WHERE id = $1::uuid", trip_id)
    await conn.execute(
        "UPDATE app.trip_fleet_links SET driver_phone = '+56900000000' WHERE trip_id = $1::uuid", trip_id)
    after = await conn.fetchval("SELECT ctid::text FROM app.trips WHERE id = $1::uuid", trip_id)
    assert after == before
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_trip_assignment_integration.py -q`
Expected: los 7 fallan con `FileNotFoundError` (todavía no existe la migración).

- [ ] **Step 3: Write the migration**

```sql
-- "Activo" y "asignado" del viaje: una sola definición, en la base.
-- Spec: docs/superpowers/specs/2026-10-11-trip-assignment-in-the-database-design.md
-- (minuta 09/10, ítem 5).
--
-- Hasta acá la regla vivía solo en dbt (macros/viaje_activo_y_asignado.sql,
-- decisión del 09/10), así que un cambio de flota hecho desde la app tardaba
-- hasta 15 min en verse, y el alta manual escribía true/false fijos. Ahora la
-- regla es una función, y la llaman tres escritores: las macros de dbt, el alta
-- manual de la API y los triggers de abajo. La regla de negocio no cambia.
--
-- Re-ejecutable: los tests la corren dentro de su transacción revertida.

-- Sin SET search_path a propósito: no lee tablas y así Postgres puede
-- expandirla en línea dentro del modelo de dbt.
CREATE OR REPLACE FUNCTION app.is_trip_open(p_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT p_status NOT LIKE 'CERRADO%'
       AND p_status NOT IN ('CANCELADO', 'Declinada', 'Removida')
$$;

COMMENT ON FUNCTION app.is_trip_open(text) IS
  'Abierto por estado (NULL con estado NULL: decide quien llama). Llamadores: macros de dbt '
  '(viaje_abierto_por_estado, viaje_activo_tms) y el alta manual de la API.';

CREATE OR REPLACE FUNCTION app.is_trip_assigned(p_status text, p_fleet jsonb, p_trip_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'app', 'pg_catalog'
AS $$
    SELECT p_status IS DISTINCT FROM 'Publicada'
       AND (   NULLIF(p_fleet->>'tractor_plate', '')   IS NOT NULL
            OR NULLIF(p_fleet->>'trailer_plate', '')   IS NOT NULL
            OR NULLIF(p_fleet->>'driver_name_tms', '') IS NOT NULL
            OR NULLIF(p_fleet->>'driver_rut_tms', '')  IS NOT NULL
            OR EXISTS (
                SELECT 1 FROM app.trip_fleet_links link
                WHERE link.trip_id = p_trip_id
                  AND (   link.tractor_asset_id IS NOT NULL OR NULLIF(link.tractor_plate, '') IS NOT NULL
                       OR link.trailer_asset_id IS NOT NULL OR NULLIF(link.trailer_plate, '') IS NOT NULL
                       OR link.driver_id IS NOT NULL)))
$$;

COMMENT ON FUNCTION app.is_trip_assigned(text, jsonb, uuid) IS
  'Asignado: patente o conductor, del TMS (fleet) o del vínculo de Operaciones; una Publicada nunca. '
  'Llamadores: macro de dbt viaje_asignado, alta manual de la API y app.sync_trip_assignment().';

-- Recalcula "asignado" de los viajes cuyo vínculo cambió. Primero mira si hay
-- diferencia y solo entonces escribe: la ingesta reescribe miles de vínculos
-- automáticos por corrida, y un UPDATE sin filas igual dispara los triggers
-- de sentencia de app.trips. El override manual no se toca.
CREATE OR REPLACE FUNCTION app.sync_trip_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'app', 'pg_catalog'
AS $$
DECLARE
    v_trip_ids uuid[];
BEGIN
    SELECT array_agg(t.id) INTO v_trip_ids
    FROM app.trips t
    WHERE t.id IN (SELECT c.trip_id FROM changed c)
      AND NOT ('is_assigned' = ANY(COALESCE(t.manually_edited_fields, '{}')))
      AND t.is_assigned IS DISTINCT FROM app.is_trip_assigned(t.trip_status, t.fleet, t.id);

    IF v_trip_ids IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE app.trips t
       SET is_assigned = app.is_trip_assigned(t.trip_status, t.fleet, t.id)
     WHERE t.id = ANY(v_trip_ids);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_trip_assignment_ins ON app.trip_fleet_links;
CREATE TRIGGER trg_sync_trip_assignment_ins
    AFTER INSERT ON app.trip_fleet_links
    REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.sync_trip_assignment();

DROP TRIGGER IF EXISTS trg_sync_trip_assignment_upd ON app.trip_fleet_links;
CREATE TRIGGER trg_sync_trip_assignment_upd
    AFTER UPDATE ON app.trip_fleet_links
    REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.sync_trip_assignment();

DROP TRIGGER IF EXISTS trg_sync_trip_assignment_del ON app.trip_fleet_links;
CREATE TRIGGER trg_sync_trip_assignment_del
    AFTER DELETE ON app.trip_fleet_links
    REFERENCING OLD TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.sync_trip_assignment();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_trip_assignment_integration.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Mutation check**

Hacer cada mutación por separado, verificar el fallo esperado y revertir:
- Borrar la línea `AND t.is_assigned IS DISTINCT FROM …` del `SELECT` del trigger: debe fallar
  `test_link_change_without_effect_does_not_touch_trip`.
- Borrar la línea `AND NOT ('is_assigned' = ANY(…))`: debe fallar `test_manual_override_is_respected`.
- Borrar el trigger `_del`: debe fallar `test_removing_link_unassigns`.

Al terminar, `git diff` del `.sql` debe quedar vacío respecto del Step 3.

- [ ] **Step 6: Rehearse against the real database with ROLLBACK**

```bash
cd monitor-app/backend && set -a && . ./.env >/dev/null 2>&1; set +a; export PGPASSWORD="$SUPABASE_DB_PASSWORD"
psql "postgresql://postgres.viclzoftiudkepqnhekv@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i supabase/migrations/20261012090000_trip_assignment_in_the_database.sql
SELECT count(*) FILTER (WHERE NOT ('is_assigned' = ANY(manually_edited_fields))
                        AND is_assigned IS DISTINCT FROM app.is_trip_assigned(trip_status, fleet, id)) AS differ
FROM app.trips;
ROLLBACK;
SQL
```
Expected: sin errores y `differ = 1`, el huérfano `add6d7dc`, conocido.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261012090000_trip_assignment_in_the_database.sql \
        monitor-app/backend/api/tests/test_trip_assignment_integration.py
git commit -m "feat(db): activo y asignado del viaje con una sola definición en la base, y trigger sobre el vínculo de flota"
```

---

### Task 2: El alta manual calcula activo y asignado con la regla

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py`, el `INSERT INTO app.trips` de `_insert_trip` (~1915-1929)
- Test: `monitor-app/backend/api/tests/test_trip_assignment_integration.py` (agregar)
- Test: `monitor-app/backend/api/tests/test_trip_flags_single_definition.py` (nuevo, guarda de grep)

**Interfaces:**
- Consumes: `app.is_trip_open`, `app.is_trip_assigned` (Task 1); `create_trip(body, pool, user)`; `SQL_GRUPOS_CIERRE`
  de `app/services/cierre_viajes.py` (parámetro `$1` = fecha).

- [ ] **Step 1: Write the failing tests**

Agregar a `test_trip_assignment_integration.py`:

```python
from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services.cierre_viajes import SQL_GRUPOS_CIERRE
from tests.conftest import PoolDeUnaConexion, _usuario_real


async def create_manual_trip(conn, status: str | None, tractor_plate: str | None) -> str:
    trip = await create_trip(
        TripCreateBody(
            planning_date=TEST_DATE,
            client_name=await cliente_de_prueba(conn),
            current_status=status,
            driver_name="CONDUCTOR DE PRUEBA SIN MATCH" if tractor_plate else None,
            tractor_plate=tractor_plate,
            stops=[TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn),
        user=await _usuario_real(conn),
    )
    return trip["id"]


async def test_closed_manual_trip_with_fleet_is_born_inactive_and_assigned(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await create_manual_trip(conn, "CERRADO FINALIZADO", "ZZZZ99")
    row = await conn.fetchrow("SELECT is_active, is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)
    assert (row["is_active"], row["is_assigned"]) == (False, True)
    in_closure = {str(r["trip_id"]) for r in await conn.fetch(SQL_GRUPOS_CIERRE, TEST_DATE)}
    assert trip_id not in in_closure


async def test_manual_trip_without_fleet_is_born_active_and_unassigned(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await create_manual_trip(conn, await open_status(conn), None)
    row = await conn.fetchrow("SELECT is_active, is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)
    assert (row["is_active"], row["is_assigned"]) == (True, False)
```

Si `SQL_GRUPOS_CIERRE` exige `$1` de tipo `date`, pasar `datetime.date(2099, 1, 15)`.

Crear `tests/test_trip_flags_single_definition.py`:

```python
"""Activo y asignado tienen una sola definición: app.is_trip_open y
app.is_trip_assigned (spec 2026-10-11). Ningún INSERT de app.trips en la API
puede escribirlos con un literal: ese fue el segundo escritor que dejaba un
viaje manual "activo, no asignado" hasta la corrida de Mage."""
from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
INSERT = re.compile(r"INSERT INTO app\.trips\s*\((?P<cols>[^)]*)\)\s*VALUES\s*\((?P<vals>.*?)\)\s*\"\"\"", re.S)


def test_no_insert_into_trips_hardcodes_the_flags():
    found = 0
    for path in APP.rglob("*.py"):
        for match in INSERT.finditer(path.read_text()):
            cols = match["cols"]
            if "is_assigned" not in cols and "is_active" not in cols:
                continue
            found += 1
            vals = match["vals"]
            assert "app.is_trip_open(" in vals, f"{path.name}: is_active sin app.is_trip_open"
            assert "app.is_trip_assigned(" in vals, f"{path.name}: is_assigned sin app.is_trip_assigned"
    assert found >= 1, "la guarda no encontró el INSERT del alta manual: revisar la expresión regular"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_trip_assignment_integration.py tests/test_trip_flags_single_definition.py -q`
Expected: fallan los dos tests del alta (`(True, False) != (False, True)` y el viaje sí aparece en el Cierre) y la
guarda ("is_active sin app.is_trip_open"). El test sin flota puede pasar ya: es el comportamiento que se conserva.

- [ ] **Step 3: Implement**

En `_insert_trip`, reemplazar el `INSERT INTO app.trips` por:

```python
    # Activo y asignado los calcula la regla (app.is_trip_open / is_trip_assigned),
    # la misma que usa dbt; nunca un literal (spec 2026-10-11). El vínculo de
    # flota que se escribe más abajo lo recoge el trigger trg_sync_trip_assignment.
    await conn.execute(
        """
        INSERT INTO app.trips (
            id, source_system, origin_tms, source_system_trip_id, client_name, shipper_id,
            planning_date, origin_region, origin_city, cargo_type,
            trip_status, fleet, stops,
            is_active, is_working, is_assigned, is_first_leg,
            status_reported_at, pipeline_updated_at, created_at, updated_at,
            manually_edited_fields
        ) VALUES ($1,'manual',$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
                  COALESCE(app.is_trip_open($10), true), false,
                  app.is_trip_assigned($10, $11::jsonb, $1::uuid), false,
                  NOW(),NOW(),NOW(),NOW(),'{}')
        """,
        trip_id, body.origin_tms, body.source_system_trip_id, body.client_name, body.shipper_id,
        body.planning_date, body.origin_region, body.origin_city,
        body.cargo_type, body.current_status,
        fleet_json, stops_json,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_trip_assignment_integration.py tests/test_trip_flags_single_definition.py tests/test_crear_viaje_manual_integracion.py -q`
Expected: todo en verde (los 9 de integración, la guarda y los 3 del alta que ya existían).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_assignment_integration.py \
        monitor-app/backend/api/tests/test_trip_flags_single_definition.py
git commit -m "fix(viajes): el alta manual calcula activo y asignado con la regla de la base (minuta 09/10, ítem 5)"
```

---

### Task 3: Las ediciones de un viaje, en una transacción y sin tragarse errores

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py`:
  - `_mirror_manual_trip` (~1962-1990);
  - `patch_trip` (~2658-2841);
  - `assign_fleet_link` (~2894-2953);
  - `remove_fleet_link` (~2956-2978);
  - `reset_field` (~2981-3008).
- Test: `monitor-app/backend/api/tests/test_trip_assignment_integration.py` (agregar)

**Interfaces:**
- Consumes: Task 1 (trigger). Firmas de las rutas sin cambios: `patch_trip(trip_id, body: TripPatch, pool, user)`,
  `assign_fleet_link(trip_id, body: dict, pool, user)`, `remove_fleet_link(trip_id, pool, user)`,
  `reset_field(trip_id, field, pool, user)`.
- Produces: `_mirror_manual_trip(conn, trip_id: str) -> None`, que propaga cualquier error.

**Diseño de cada ruta** (patrón de `create_trip`):
- Las validaciones previas quedan fuera de la transacción y con `pool`: `exigir_vigentes`, el `404` y
  `require_fields`.
- Las escrituras y `_mirror_manual_trip(conn, …)` van dentro de
  `async with pool.acquire() as conn: async with conn.transaction():`.
- `_log_system_note(pool, …)` y `get_trip(…)` van **después** del commit. La nota es best-effort a propósito, igual
  que en `create_trip`: adentro de la transacción, su `except: pass` dejaría la transacción abortada sin aviso.
- En `assign_fleet_link`, las consultas de nombre para la nota (`full_name`, `business_name`) se hacen después del
  commit, con `pool`.

- [ ] **Step 1: Write the failing tests**

```python
from app.routers import trips as trips_router
from app.routers.trips import TripPatch, assign_fleet_link, patch_trip, remove_fleet_link


async def test_linking_driver_via_endpoint_assigns_immediately(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await create_manual_trip(conn, await open_status(conn), None)
    pool = PoolDeUnaConexion(conn)
    user = await _usuario_real(conn)
    await assign_fleet_link(trip_id, {"driver_id": await any_driver_id(conn)}, pool=pool, user=user)
    assert await is_assigned(conn, trip_id) is True
    await remove_fleet_link(trip_id, pool=pool, user=user)
    assert await is_assigned(conn, trip_id) is False


async def test_patch_rolls_back_when_mirror_fails(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await create_manual_trip(conn, await open_status(conn), None)

    async def failing_mirror(_conn, _trip_id):
        raise RuntimeError("mirror failed")

    monkeypatch.setattr(trips_router, "_mirror_manual_trip", failing_mirror)
    with pytest.raises(RuntimeError, match="mirror failed"):
        await patch_trip(trip_id, TripPatch(comments="edición que no debe quedar"),
                         pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))
    assert await conn.fetchval("SELECT comments FROM app.trips WHERE id = $1::uuid", trip_id) is None


async def test_mirror_error_is_not_swallowed(conexion_revertida):
    """Sin el except: pass, un error de la copia llega a quien llama."""
    conn = conexion_revertida
    with pytest.raises(Exception):
        await trips_router._mirror_manual_trip(conn, "no-es-un-uuid")
```

Antes de correrlos, confirmar en `TripPatch` (`app/schemas/trip.py`) que `comments` es un campo del PATCH. Si no lo es,
usar `notes`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_trip_assignment_integration.py -q -k "endpoint or mirror"`
Expected:
- `test_patch_rolls_back_when_mirror_fails` falla: la edición queda escrita, porque hoy el PATCH no corre en una
  transacción.
- `test_mirror_error_is_not_swallowed` falla: no se lanza nada, por el `except: pass`.
- `test_linking_driver_via_endpoint_assigns_immediately` puede pasar ya, porque el trigger de Task 1 actúa con o sin
  transacción. Queda como regresión de la ruta HTTP.

- [ ] **Step 3: Implement `_mirror_manual_trip`**

```python
async def _mirror_manual_trip(conn, trip_id: str) -> None:
    """Copia los campos editables de un viaje manual de app.trips a
    app.trips_manual, de donde dbt lo reconstruye. Sin copia, la siguiente
    corrida pisa la edición del operador. No hace nada en un viaje del TMS (no
    tiene fila en trips_manual).

    Corre dentro de la transacción de la edición y propaga cualquier error:
    antes se lo tragaba un `except Exception: pass`, y la edición se perdía en
    silencio en la corrida siguiente (spec 2026-10-11)."""
    await conn.execute(
        """
        UPDATE app.trips_manual m SET
            trip_status            = t.trip_status,
            manual_status          = t.manual_status,
            origin_region          = t.origin_region,
            origin_city            = t.origin_city,
            is_active              = COALESCE(t.is_active, m.is_active),
            is_working             = COALESCE(t.is_working, m.is_working),
            is_assigned            = COALESCE(t.is_assigned, m.is_assigned),
            is_first_leg           = COALESCE(t.is_first_leg, m.is_first_leg),
            notes                  = t.notes,
            comments               = t.comments,
            unassigned_reason_id   = t.unassigned_reason_id,
            fleet_link_id          = t.fleet_link_id,
            manually_edited_fields = COALESCE(t.manually_edited_fields, '{}'),
            updated_at             = NOW()
        FROM app.trips t
        WHERE m.id = t.id AND m.id = $1
        """,
        trip_id,
    )
```

- [ ] **Step 4: Implement the four routes in a transaction**

`patch_trip`:
- Desde `# driver_name goes to trip_fleet_links` hasta el `UPDATE app.trips SET {', '.join(sets)}` inclusive, el
  cuerpo pasa a estar dentro de `async with pool.acquire() as conn: async with conn.transaction():`, cambiando cada
  `pool.fetchval`/`pool.execute` de ese bloque por `conn.`.
- La última línea dentro del bloque es `await _mirror_manual_trip(conn, trip_id)`.
- Después del bloque quedan, en este orden, la nota de `manual_status` (con `pool`) y `return await get_trip(trip_id, pool, user)`.

`assign_fleet_link`:

```python
    async with pool.acquire() as conn:
        async with conn.transaction():
            tractor_asset_id, tractor_plate = await _activo_de_la_patente(
                conn, body.get("tractor_plate"), body.get("tractor_asset_id"))
            trailer_asset_id, trailer_plate = await _activo_de_la_patente(
                conn, body.get("trailer_plate"), body.get("trailer_asset_id"))
            await _escribir_link_manual(
                conn, trip_id, user=user,
                carrier_id=carrier_id, driver_id=driver_id,
                tractor_asset_id=tractor_asset_id, tractor_plate=tractor_plate,
                trailer_asset_id=trailer_asset_id, trailer_plate=trailer_plate,
                driver_name=body.get("driver_name"),
            )
            await _mirror_manual_trip(conn, trip_id)
```

Lo que sigue (los nombres para la nota, `_log_system_note(pool, …)` y `get_trip`) queda igual, después del bloque.

`remove_fleet_link`:

```python
    async with pool.acquire() as conn:
        async with conn.transaction():
            link_id = await conn.fetchval(
                "SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id
            )
            if link_id:
                await conn.execute("DELETE FROM app.trip_fleet_links WHERE id = $1", link_id)
                await conn.execute(
                    "UPDATE app.trips SET fleet_link_id = NULL, updated_at = NOW() WHERE id = $1",
                    trip_id,
                )
                await _mirror_manual_trip(conn, trip_id)
    if link_id:
        await _log_system_note(pool, trip_id, user, "Desvinculó la empresa transportista")
    return {"ok": True}
```

`reset_field`: el `UPDATE app.trips … array_remove` y `_mirror_manual_trip(conn, trip_id)` van dentro del bloque
transaccional. La nota de `manual_status` va después, con `pool`.

- [ ] **Step 5: Run the area tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_trip_assignment_integration.py tests/test_crear_viaje_manual_integracion.py tests/test_asignar_conductor.py tests/test_cierre_viajes.py tests/test_activo_lo_define_el_tms_integracion.py tests/test_anular_viajes_integracion.py tests/test_permisos_por_campo.py -q`
Expected: todo en verde. Si un test mockeado de `patch_trip` usa un `AsyncMock` como pool sin `acquire()`, adaptarlo
con `wire_transactional_conn` de `conftest.py`, que es el patrón vigente. No se cambia su aserción.

- [ ] **Step 6: Mutation check**

- Volver a poner `try: … except Exception: pass` en `_mirror_manual_trip`: debe fallar
  `test_mirror_error_is_not_swallowed`.
- Sacar el `UPDATE app.trips SET {sets}` de `patch_trip` fuera del bloque transaccional: debe fallar
  `test_patch_rolls_back_when_mirror_fails`.
- Revertir las dos mutaciones.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_assignment_integration.py
git commit -m "fix(viajes): editar un viaje escribe todo en una transacción y la copia al viaje manual ya no se traga errores"
```

---

### Task 4: Aplicar la migración y desplegar la API a dev

**Files:** ninguno nuevo.

- [ ] **Step 1: Apply the migration** con `mcp__claude_ai_Supabase__apply_migration`:
  - `name`: `trip_assignment_in_the_database`;
  - `query`: el contenido íntegro del `.sql` de Task 1.
- [ ] **Step 2: Verify in the database** (solo lectura):

```sql
SELECT proname FROM pg_proc WHERE pronamespace = 'app'::regnamespace
  AND proname IN ('is_trip_open','is_trip_assigned','sync_trip_assignment');            -- 3 filas
SELECT tgname FROM pg_trigger WHERE tgrelid = 'app.trip_fleet_links'::regclass
  AND tgname LIKE 'trg_sync_trip_assignment_%';                                          -- 3 filas
SELECT count(*) FILTER (WHERE NOT ('is_assigned' = ANY(manually_edited_fields))
  AND is_assigned IS DISTINCT FROM app.is_trip_assigned(trip_status, fleet, id)) FROM app.trips;  -- 1
```

- [ ] **Step 3: Push** `git push origin dev` y esperar a que `Deploy Monitor API` termine en `success`
  (`gh run watch <id> --exit-status`).

---

### Task 5: Las macros de dbt llaman a la regla (Mage, con OK del usuario)

**Files:**
- Modify: `.mage-agent/local_sync/dbt/tms/macros/viaje_activo_y_asignado.sql` (mirror de Mage, fuera de git)
- Modify: `monitor-app/backend/api/tests/test_dbt_activo_y_asignado_una_definicion.py`

- [ ] **Step 1: Sync the mirror** con `mcp__mage-agent__sync_project_to_local`, para editar sobre la versión real y
  no sobre una copia vieja.
- [ ] **Step 2: Write the failing guard** (agregar al test existente):

```python
MACROS = DBT / "macros/viaje_activo_y_asignado.sql"


def test_las_macros_llaman_a_la_regla_de_la_base():
    if not MACROS.exists():
        pytest.skip("mirror de Mage no sincronizado en esta máquina")
    macros = MACROS.read_text()
    assert "app.is_trip_open(" in macros
    assert "app.is_trip_assigned(" in macros
    # La regla ya no se repite en dbt: vive en la base (spec 2026-10-11).
    assert "->>'tractor_plate'" not in macros
    assert "NOT IN ('CANCELADO', 'Declinada', 'Removida')" not in macros
```

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_dbt_activo_y_asignado_una_definicion.py -q`
Expected: falla el test nuevo; los demás siguen en verde.

- [ ] **Step 3: Rewrite the macros.** Se conservan el comentario de cabecera y el historial, más una línea que dice
  que la regla pasó a la base el 11/10.

```jinja
{% macro viaje_abierto_por_estado(estado) %}
    app.is_trip_open({{ estado }})
{% endmacro %}

{% macro viaje_activo_tms(estado, source_system, status_reported_at) %}
    COALESCE(
        app.is_trip_open({{ estado }})
        AND (
            NOT {{ is_live_tracked_source(source_system) }}
            OR {{ status_reported_at }} > now() - interval '7 days'
        ),
        false
    )
{% endmacro %}

{% macro viaje_asignado(estado, fleet, trip_id) %}
    app.is_trip_assigned({{ estado }}, {{ fleet }}, {{ trip_id }})
{% endmacro %}
```

Si alguna llamada pasa como `estado` una columna que no es `text`, se agrega `::text` en la macro.

- [ ] **Step 4: Run the guard** con el mismo comando del Step 2. Expected: todo en verde.
- [ ] **Step 5: STOP. Pedir el OK explícito del usuario para subir a Mage.** Mostrar el diff de la macro. Esperar a que
  no haya una corrida de `batch_tms_monitor_trips` en vuelo: los minutos 0, 15, 30 y 45 más ~8 min de duración, así que
  la ventana segura es del minuto ~9 al ~14 de cada cuarto.
- [ ] **Step 6: Push to Mage** con `mcp__mage-agent__sync_local_to_remote`, solo con el OK del usuario.
- [ ] **Step 7: Verify the next run.**
  - En la base, `max(pipeline_updated_at)` de `app.trips` debe avanzar después de la corrida siguiente.
  - La paridad de Task 4, Step 2, debe seguir en `1`.
  - Si la corrida falla, revisar los logs con `mcp__mage-agent__run_logs`, revertir la macro con
    `sync_local_to_remote` y avisar al usuario.
- [ ] **Step 8: Commit the guard**

```bash
git add monitor-app/backend/api/tests/test_dbt_activo_y_asignado_una_definicion.py
git commit -m "test(dbt): las macros de activo y asignado llaman a la regla de la base"
```

---

### Task 6: Verificación en dev y registro

- [ ] **Step 1: Pedir autorización al usuario** para crear dos viajes manuales de prueba en dev.
- [ ] **Step 2: Verificar en dev** con Playwright, en `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app`:
  - **Viaje A:** alta manual en "CERRADO FINALIZADO" con tracto y conductor, con fecha de hoy. No debe aparecer en
    Cierre › Viajes › Por resolver.
  - **Viaje B:** alta manual en un estado abierto, sin flota. Debe aparecer en Por resolver. Después, desde el
    detalle, "Vincular flota" con un conductor: al recargar el Cierre debe estar en En seguimiento o fuera de Por
    resolver, sin esperar a Mage.
  - Anular A y B con el motivo "Cargado por error".
- [ ] **Step 3: Actualizar `AGENTLOG.md`**: qué se hizo, las decisiones (B en vez de Mage por demanda, y por qué) y el
  siguiente paso (P2: grupo `incomplete_assignment`). Después, commit y push.
