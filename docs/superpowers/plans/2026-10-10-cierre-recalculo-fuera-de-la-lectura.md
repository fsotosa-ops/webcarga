# Cierre: el recálculo sale de la lectura — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `GET /daily-closures`, `GET /equipment-closures` y `GET /status-report` sean `SELECT` puros, y que
el recálculo del día corra cuando cambian sus datos de entrada: triggers que encolan, y un ejecutor llamado por
Cloud Scheduler.

**Architecture:** triggers por sentencia (en la migración para las tablas de la API; en el `post_hook` de dbt
para `app.trips` y `app.trip_stops`) llaman a `app.marcar_cierre_pendiente()`, que encola días abiertos en
`app.closure_recompute_queue` con un contador de versión. `POST /api/v1/internal/closures/recompute` (OIDC de
Google) vacía la cola con `cierre_lineas.recalcular(..., version=, saltar_si_ocupado=True)`. El pre-cierre se
separa en correcciones (dentro del recálculo, con lecturas por conjuntos y escrituras en lote) y avisos (lectura
pura). Se borra la proyección a las 4 tablas viejas.

**Tech Stack:** FastAPI + asyncpg (Python 3.13), Postgres 17 (Supabase), dbt-postgres en Mage, Next.js + React
Query + Vitest, Cloud Run + Cloud Scheduler (GCP `webcarga-dev-493220`, `us-central1`).

**Spec:** `docs/superpowers/specs/2026-10-10-cierre-recalculo-fuera-de-la-lectura-design.md`

## Global Constraints

- `cierre_lineas` sigue siendo el único que escribe `app.closure_lines`. Un día `CLOSED` no se recalcula.
- Los GET del Cierre no escriben nunca (ni la cola).
- Las reglas del pre-cierre no cambian: `_normalize`, `_single_value`, `_looks_like_webcarga_itself`, el override
  manual y las mismas filas de auditoría (`source = 'pre_cierre_auto'`, mismas `action`, `field`, `old_value`,
  `new_value`).
- "Hoy" en SQL es siempre `public.hoy_chile()`, nunca `CURRENT_DATE`.
- Ventana de días abiertos: `public.hoy_chile() - 45` a `public.hoy_chile()` (la cota de `app.trips_del_dia`).
- Origen del recálculo: `SET LOCAL app.origen_escritura = 'recalculo_cierre'`.
- Sin dependencias Python nuevas: el `Dockerfile` las instala a mano (memoria `feedback_dockerfile_dependency_drift`).
- Presupuesto del ejecutor: 45 s (`--timeout=60` del servicio).
- Rutas en inglés; textos en español neutral, sin voseo; vocabulario de la pantalla; cero emojis (lucide-react).
- Base de producción: lecturas con `psql`; escrituras (migraciones) con `mcp__claude_ai_Supabase__execute_sql`
  (proyecto `viclzoftiudkepqnhekv`), primero ensayadas con `ROLLBACK`.
- Mage: `sync_project_to_local` → editar → `sync_local_to_remote`, entre corridas. Solo se toca el `post_hook`
  de `models/app/trips.sql` y `models/app/trip_stops.sql`.
- Backend: `cd monitor-app/backend/api && venv/bin/python -m pytest …`. Frontend: `cd monitor-app/frontend && npx vitest run …`.
- Commits que terminan con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Medianoche en Chile (21:00–24:00 UTC):** la marca, la siembra y el "hoy" del ejecutor usan
   `public.hoy_chile()`; un trigger a las 22:00 CL encola el día de Chile y no el de UTC. Test en Task 1.
2. **Dos corridas del Scheduler superpuestas** (una tarda más de 1 min): la segunda salta el día que tiene la
   primera (`SKIP LOCKED`) y no lo calcula dos veces. Test con dos conexiones en Task 5.
3. **Firmar mientras el ejecutor recalcula ese día:** la firma espera el bloqueo (no lo salta), recalcula dentro
   de su transacción y borra la entrada. Al ejecutor que llegue después le toca un día `CLOSED`: borra la entrada
   sin calcular. Tests en Tasks 4 y 5.
4. **Reabrir un día:** queda encolado, y el ejecutor lo recalcula sin que nadie abra la pantalla. Test en Task 4.
5. **La ingesta reescribe filas sin cambios cada 15 min:** encola los días abiertos (es correcto y barato), pero
   un `UPDATE` que no toca filas no encola, y el recálculo no se reencola a sí mismo aunque corrija el
   directorio. Tests en Tasks 1 y 4.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `monitor-app/backend/supabase/migrations/20261010120000_cola_de_recalculo_del_cierre.sql` (crear) | Cola, función de marca, triggers de las tablas de la API, siembra |
| `monitor-app/backend/supabase/migrations/20261011120000_retira_tablas_viejas_del_cierre.sql` (crear, Task 9) | Contract: retira las 4 tablas |
| `.mage-agent/local_sync/dbt/tms/models/app/trips.sql`, `trip_stops.sql` (modificar `post_hook`) | Triggers de marca en las tablas de dbt |
| `monitor-app/backend/api/app/services/audit.py` (modificar) | `auditar_en_lote` junto a `log_change` |
| `monitor-app/backend/api/app/services/pre_cierre.py` (reescribir) | Señales por conjuntos, `clasificar` (pura), `aplicar_correcciones`, `avisos_del_dia` |
| `monitor-app/backend/api/app/services/cierre_lineas.py` (modificar) | `Resultado`, `bloquear_periodo`, `recalcular_en`, `recalcular(version, saltar_si_ocupado)`, `cerrar` atómico, `reabrir` encola, sin proyección |
| `monitor-app/backend/api/app/services/cola_del_cierre.py` (crear) | `procesar_cola`: recorre la cola con presupuesto y aísla fallos por día |
| `monitor-app/backend/api/app/authz/servicio_interno.py` (crear) | Verificación del token OIDC de Cloud Scheduler |
| `monitor-app/backend/api/app/routers/internal.py` (crear) | `POST /api/v1/internal/closures/recompute` |
| `monitor-app/backend/api/app/routers/{daily_closures,equipment_closures,status_report}.py` (modificar) | GET puros + `frescura_del_dia` |
| `monitor-app/frontend/components/dashboard/AvisoDeActualizacion.tsx` (crear) | Aviso "Actualizando…" / "No se pudo actualizar desde HH:MM" |
| `monitor-app/frontend/app/dashboard/operations/closures/page.tsx` (modificar) | Muestra el aviso y vuelve a pedir mientras está pendiente |

---

### Task 1: Cola, función de marca y triggers de las tablas de la API (migración expand)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261010120000_cola_de_recalculo_del_cierre.sql`
- Test: `monitor-app/backend/api/tests/test_cola_del_cierre_integracion.py`

**Interfaces:**
- Produces: tabla `app.closure_recompute_queue (business_date date PK, requested_at timestamptz, version bigint)`;
  función `app.marcar_cierre_pendiente() RETURNS trigger` que lee la tabla de transición `cambiadas`; triggers
  `trg_marcar_cierre_{ins,upd,del}` en `app.trip_fleet_links`, `public.assets`, `public.asset_assignments`,
  `public.drivers`, `public.driver_assignments`, `public.vehicle_driver_assignments`, `public.carriers`,
  `app.trip_statuses`.

- [ ] **Step 1: Write the failing tests**

```python
# monitor-app/backend/api/tests/test_cola_del_cierre_integracion.py
"""La marca del Cierre contra Postgres de verdad (spec 2026-10-10, §3.1).

Los triggers encolan días abiertos cuando cambia un dato de entrada de las
líneas. No calculan nada: el recálculo lo hace el ejecutor."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.integracion

TABLAS_DE_LA_MIGRACION = [
    "app.trip_fleet_links", "public.assets", "public.asset_assignments", "public.drivers",
    "public.driver_assignments", "public.vehicle_driver_assignments", "public.carriers", "app.trip_statuses",
]


async def _cola(conn) -> dict:
    filas = await conn.fetch("SELECT business_date, version FROM app.closure_recompute_queue")
    return {f["business_date"]: f["version"] for f in filas}


async def _vaciar_cola(conn) -> None:
    await conn.execute("DELETE FROM app.closure_recompute_queue")


async def test_escribir_en_cada_tabla_de_entrada_encola_hoy(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    for tabla in TABLAS_DE_LA_MIGRACION:
        await _vaciar_cola(conexion_revertida)
        # Un UPDATE que sí toca una fila, sin cambiar su valor: la marca no mira
        # el contenido, solo si la sentencia cambió alguna fila.
        # Las 8 tablas tienen `id` (verificado el 10/10 en information_schema).
        tocadas = await conexion_revertida.execute(
            f"UPDATE {tabla} SET id = id WHERE id = (SELECT id FROM {tabla} LIMIT 1)")
        assert tocadas == "UPDATE 1", f"{tabla}: el escenario necesita una fila"
        assert hoy in await _cola(conexion_revertida), f"{tabla} no encoló el día"


async def test_un_update_que_no_toca_filas_no_encola(conexion_revertida):
    await _vaciar_cola(conexion_revertida)
    await conexion_revertida.execute(
        "UPDATE public.carriers SET business_name = business_name WHERE id = $1", uuid.uuid4())
    assert await _cola(conexion_revertida) == {}


async def test_lo_que_escribe_el_recalculo_no_encola(conexion_revertida):
    await _vaciar_cola(conexion_revertida)
    await conexion_revertida.execute("SET LOCAL app.origen_escritura = 'recalculo_cierre'")
    await conexion_revertida.execute(
        "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)")
    assert await _cola(conexion_revertida) == {}


async def test_un_dia_firmado_nunca_entra_y_uno_abierto_si(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    abierto, firmado = hoy - 3, hoy - 2
    actor = await conexion_revertida.fetchval("SELECT id FROM auth.users LIMIT 1")
    await conexion_revertida.execute(
        "INSERT INTO app.closure_periods (business_date, status) VALUES ($1, 'OPEN') "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'OPEN', closed_by = NULL, closed_at = NULL", abierto)
    await conexion_revertida.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) VALUES ($1, 'CLOSED', $2, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2, closed_at = now()",
        firmado, actor)
    await _vaciar_cola(conexion_revertida)
    await conexion_revertida.execute(
        "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)")
    cola = await _cola(conexion_revertida)
    assert abierto in cola and hoy in cola
    assert firmado not in cola


async def test_cada_marca_sube_la_version_y_conserva_desde_cuando(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    await _vaciar_cola(conexion_revertida)
    tocar = "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)"
    await conexion_revertida.execute(tocar)
    primera = await conexion_revertida.fetchrow(
        "SELECT version, requested_at FROM app.closure_recompute_queue WHERE business_date = $1", hoy)
    await conexion_revertida.execute(tocar)
    segunda = await conexion_revertida.fetchrow(
        "SELECT version, requested_at FROM app.closure_recompute_queue WHERE business_date = $1", hoy)
    assert segunda["version"] == primera["version"] + 1
    assert segunda["requested_at"] == primera["requested_at"]


async def test_la_marca_usa_el_dia_de_chile(conexion_revertida):
    """Review Focus 1: entre las 21:00 y las 24:00 de Chile, CURRENT_DATE ya es mañana."""
    fuente = await conexion_revertida.fetchval(
        "SELECT prosrc FROM pg_proc WHERE proname = 'marcar_cierre_pendiente'")
    assert "hoy_chile()" in fuente
    assert "current_date" not in fuente.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cola_del_cierre_integracion.py -v`
Expected: FAIL with `relation "app.closure_recompute_queue" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- monitor-app/backend/supabase/migrations/20261010120000_cola_de_recalculo_del_cierre.sql
--
-- El recálculo del Cierre sale de la lectura (spec 2026-10-10).
--
-- Hasta hoy cada GET del Cierre recalculaba el día completo: 139 consultas,
-- tres veces por sesión. Desde acá, cuando cambia un dato de entrada de las
-- líneas, un trigger ENCOLA los días abiertos; un ejecutor llamado por Cloud
-- Scheduler los recalcula. Los GET leen.
--
-- La cola es una tabla propia y no una columna de closure_periods: recalcular,
-- firmar y poner un motivo toman esa fila con FOR UPDATE durante todo su
-- trabajo, y una marca ahí haría esperar a cada escritura de dbt y de la API, y
-- abriría un ciclo de bloqueos (spec §3.2).
--
-- `version` sube con cada marca; el ejecutor borra la entrada solo si la versión
-- que leyó no cambió. `requested_at` se fija al encolar: es "pendiente desde".
--
-- Los triggers de app.trips y app.trip_stops NO van acá: los crea el post_hook
-- de dbt, porque un --full-refresh borra lo que cree una migración (memoria
-- reference_dbt_post_hook_owns_db_objects).

BEGIN;

CREATE TABLE app.closure_recompute_queue (
    business_date date PRIMARY KEY,
    requested_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    version       bigint      NOT NULL DEFAULT 1
);

-- Sin políticas: la usan la API y los triggers (rol postgres), nadie desde PostgREST.
ALTER TABLE app.closure_recompute_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.closure_recompute_queue IS
    'Días del Cierre con cambios pendientes de recalcular. La llenan los triggers '
    'trg_marcar_cierre_*; la vacía POST /api/v1/internal/closures/recompute.';

CREATE OR REPLACE FUNCTION app.marcar_cierre_pendiente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'app', 'public', 'pg_catalog'
AS $$
BEGIN
    -- Lo que escribe el propio recálculo (correcciones del pre-cierre) no lo
    -- vuelve a encolar: ya está calculando ese día.
    IF current_setting('app.origen_escritura', true) = 'recalculo_cierre' THEN
        RETURN NULL;
    END IF;
    -- Un trigger por sentencia se dispara aunque la sentencia no toque filas.
    IF NOT EXISTS (SELECT 1 FROM cambiadas) THEN
        RETURN NULL;
    END IF;

    INSERT INTO app.closure_recompute_queue (business_date)
    SELECT dias.d
    FROM (
        SELECT p.business_date AS d
        FROM app.closure_periods p
        WHERE p.status = 'OPEN'
          AND p.business_date BETWEEN public.hoy_chile() - 45 AND public.hoy_chile()
        UNION
        SELECT public.hoy_chile()
    ) dias
    WHERE NOT EXISTS (
        SELECT 1 FROM app.closure_periods c WHERE c.business_date = dias.d AND c.status = 'CLOSED'
    )
    ON CONFLICT (business_date) DO UPDATE
        SET version = app.closure_recompute_queue.version + 1;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app.marcar_cierre_pendiente() IS
    'Encola los días abiertos de los últimos 45 días y hoy (Chile). La usan todos '
    'los trg_marcar_cierre_*; espera la tabla de transición "cambiadas".';

-- Tres triggers por tabla (uno por evento), todos con la tabla de transición
-- llamada "cambiadas", para que una sola función sirva a todos.
DO $$
DECLARE
    tabla text;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'app.trip_fleet_links', 'public.assets', 'public.asset_assignments', 'public.drivers',
        'public.driver_assignments', 'public.vehicle_driver_assignments', 'public.carriers',
        'app.trip_statuses'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_ins ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_marcar_cierre_ins AFTER INSERT ON %s '
                       'REFERENCING NEW TABLE AS cambiadas FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.marcar_cierre_pendiente()', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_upd ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_marcar_cierre_upd AFTER UPDATE ON %s '
                       'REFERENCING NEW TABLE AS cambiadas FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.marcar_cierre_pendiente()', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_del ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_marcar_cierre_del AFTER DELETE ON %s '
                       'REFERENCING OLD TABLE AS cambiadas FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.marcar_cierre_pendiente()', tabla);
    END LOOP;
END $$;

-- Siembra: los días abiertos de la ventana y hoy arrancan encolados.
INSERT INTO app.closure_recompute_queue (business_date)
SELECT p.business_date FROM app.closure_periods p
WHERE p.status = 'OPEN' AND p.business_date BETWEEN public.hoy_chile() - 45 AND public.hoy_chile()
UNION
SELECT public.hoy_chile()
WHERE NOT EXISTS (SELECT 1 FROM app.closure_periods c WHERE c.business_date = public.hoy_chile() AND c.status = 'CLOSED')
ON CONFLICT (business_date) DO NOTHING;

COMMIT;
```

- [ ] **Step 4: Rehearse with ROLLBACK, then apply**

Ensayo: `mcp__claude_ai_Supabase__execute_sql` con el contenido del archivo, cambiando el `COMMIT;` final por
`SELECT count(*) FROM app.closure_recompute_queue; ROLLBACK;`. Esperado: ningún error y una cuenta ≥ 1.
Aplicar: el mismo SQL con su `COMMIT;`. Verificar con `psql` (solo lectura):
`SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE 'trg_marcar_cierre_%' ORDER BY 1, 2;`
Esperado: 24 filas (8 tablas × 3).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cola_del_cierre_integracion.py -v`
Expected: 6 PASS. Mutación: en una transacción revertida, `CREATE OR REPLACE` la función sin la línea del
`SET LOCAL` y comprobar que `test_lo_que_escribe_el_recalculo_no_encola` falla. Se revierte sola.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261010120000_cola_de_recalculo_del_cierre.sql monitor-app/backend/api/tests/test_cola_del_cierre_integracion.py
git commit -m "feat(cierre): cola de recálculo y triggers que marcan el día pendiente"
```

---

### Task 2: Triggers de marca en el `post_hook` de dbt (Mage)

**Files:**
- Modify: `.mage-agent/local_sync/dbt/tms/models/app/trips.sql` (lista `post_hook`)
- Modify: `.mage-agent/local_sync/dbt/tms/models/app/trip_stops.sql` (lista `post_hook`)
- Test: `monitor-app/backend/api/tests/test_dbt_marca_el_cierre.py`

**Interfaces:**
- Consumes: `app.marcar_cierre_pendiente()` (Task 1, ya aplicada: si no existe, el `post_hook` hace fallar la corrida de dbt).

- [ ] **Step 1: Sync the Mage project to local**

Leer `skill://sync` del MCP de mage-agent y ejecutar `mcp__mage-agent__sync_project_to_local`. Verificar que
`trips.sql` y `trip_stops.sql` locales coinciden con lo remoto (`mcp__mage-agent__sync_status`).

- [ ] **Step 2: Write the failing guard test**

```python
# monitor-app/backend/api/tests/test_dbt_marca_el_cierre.py
"""Los triggers de marca del Cierre en las tablas de dbt (spec 2026-10-10, §3.1).

Viven en el post_hook porque un --full-refresh borra lo que cree una migración.
Ningún pipeline corre `dbt test`, así que la guarda va acá, sobre el espejo de
Mage (no está en git: sin espejo, se salta)."""
from __future__ import annotations

from pathlib import Path

import pytest

DBT = Path(__file__).resolve().parents[4] / ".mage-agent/local_sync/dbt/tms/models/app"


@pytest.mark.parametrize("modelo", ["trips.sql", "trip_stops.sql"])
def test_el_post_hook_crea_los_tres_triggers_de_marca(modelo):
    ruta = DBT / modelo
    if not ruta.exists():
        pytest.skip("espejo de Mage no sincronizado en esta máquina")
    texto = ruta.read_text()
    for evento, tabla in (("ins", "NEW"), ("upd", "NEW"), ("del", "OLD")):
        assert f"DROP TRIGGER IF EXISTS trg_marcar_cierre_{evento} ON {{{{ this }}}}" in texto
        assert (f"REFERENCING {tabla} TABLE AS cambiadas FOR EACH STATEMENT "
                "EXECUTE FUNCTION app.marcar_cierre_pendiente()") in texto
```

Run: `venv/bin/python -m pytest tests/test_dbt_marca_el_cierre.py -v` → Expected: 2 FAIL.

- [ ] **Step 3: Add the triggers to both `post_hook` lists**

Agregar al final de la lista `post_hook` de `trips.sql` (después de la línea
`"SELECT app.resolve_trip_fleet(...)"`) y al final de la de `trip_stops.sql`:

```python
            "DROP TRIGGER IF EXISTS trg_marcar_cierre_ins ON {{ this }}",
            "CREATE TRIGGER trg_marcar_cierre_ins AFTER INSERT ON {{ this }} REFERENCING NEW TABLE AS cambiadas FOR EACH STATEMENT EXECUTE FUNCTION app.marcar_cierre_pendiente()",
            "DROP TRIGGER IF EXISTS trg_marcar_cierre_upd ON {{ this }}",
            "CREATE TRIGGER trg_marcar_cierre_upd AFTER UPDATE ON {{ this }} REFERENCING NEW TABLE AS cambiadas FOR EACH STATEMENT EXECUTE FUNCTION app.marcar_cierre_pendiente()",
            "DROP TRIGGER IF EXISTS trg_marcar_cierre_del ON {{ this }}",
            "CREATE TRIGGER trg_marcar_cierre_del AFTER DELETE ON {{ this }} REFERENCING OLD TABLE AS cambiadas FOR EACH STATEMENT EXECUTE FUNCTION app.marcar_cierre_pendiente()"
```

(La línea anterior a las nuevas necesita su coma.) En el comentario de cabecera del modelo, sumar una línea:
`trg_marcar_cierre_*: encolan el Cierre (spec 2026-10-10); la función vive en la migración 20261010120000.`

Run: `venv/bin/python -m pytest tests/test_dbt_marca_el_cierre.py -v` → Expected: 2 PASS.

- [ ] **Step 4: Push to Mage between runs and verify**

1. `mcp__mage-agent__run_logs` del pipeline `batch_tms_monitor_trips`: confirmar que no hay una corrida en vuelo
   (corre cada 15 min, dura 7-8 min).
2. `mcp__mage-agent__sync_local_to_remote` solo con los 2 archivos. Esperado: 0 conflictos.
3. Después de la corrida siguiente, con `psql`:
   `SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE 'trg_marcar_cierre_%' AND tgrelid::regclass::text IN ('app.trips','app.trip_stops');`
   Esperado: 6 filas. Y `SELECT business_date, version FROM app.closure_recompute_queue;` muestra hoy con una
   versión mayor que la de la siembra.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/tests/test_dbt_marca_el_cierre.py
git commit -m "feat(cierre): dbt encola el Cierre al escribir viajes y paradas"
```

(El espejo de Mage no está en git; el cambio vive en Mage.)

---

### Task 3: El pre-cierre por conjuntos (correcciones y avisos separados)

**Files:**
- Modify: `monitor-app/backend/api/app/services/audit.py` (agregar `auditar_en_lote`)
- Rewrite: `monitor-app/backend/api/app/services/pre_cierre.py`
- Rewrite: `monitor-app/backend/api/tests/test_pre_cierre.py` (unitarios de `clasificar`)
- Create: `monitor-app/backend/api/tests/test_pre_cierre_integracion.py`

**Interfaces:**
- Produces:
  - `async def auditar_en_lote(conn, *, entity_type: str, action: str, field: str | None, filas: list[tuple[str, object, object]], source: str) -> None`
  - `def clasificar(s: Senales) -> Clasificacion` (pura)
  - `async def aplicar_correcciones(conn, fecha: date) -> None` (la llama `recalcular_en`, Task 4, dentro de su transacción)
  - `async def avisos_del_dia(conn, fecha: date) -> dict` → `{"auto_resolved": [...], "escalations": {...}}`, con
    la misma forma que `PreCierreResult` del frontend. Las seis llaves de `escalations` siempre presentes.
  - Se elimina `run_pre_cierre`.

- [ ] **Step 1: Write the failing unit tests for `clasificar`**

```python
# monitor-app/backend/api/tests/test_pre_cierre.py
"""Las reglas del pre-cierre, sin base de datos (spec 2026-10-10, §4).

`clasificar` es pura: recibe las señales leídas por conjuntos y decide qué
corregir y qué avisar. Las reglas son las mismas de antes del 10/10; cambió
cómo se leen y se escriben los datos, no qué se decide."""
from app.services.pre_cierre import (
    Conductor, ParCliente, Patente, Senales, clasificar,
)

C1, C2, A1, D1, S1 = "c1", "c2", "a1", "d1", "s1"


def senales(**kw) -> Senales:
    base = dict(patentes=[], conductores=[], pares_cliente=[], empresas_por_clave={},
                clientes_por_clave={}, vinculos_activos=set(), nombres_empresa={})
    base.update(kw)
    return Senales(**base)


def patente(**kw) -> Patente:
    base = dict(plate="ABCD12", carrier_names=["Trans Sur"], asset_id=A1, carrier_id=C1,
                carrier_name="Trans Norte", is_manual_override=False)
    base.update(kw)
    return Patente(**base)


def test_patente_inexistente_es_aviso_con_la_empresa_del_tms():
    c = clasificar(senales(patentes=[patente(asset_id=None, carrier_id=None, carrier_name=None)]))
    assert c.escalations["PATENTE_NO_REGISTRADA"] == [{
        "tractor_plate": "ABCD12", "reason": "La patente no existe en public.assets",
        "tms_carrier_name": "Trans Sur"}]
    assert c.reasignaciones == []


def test_patente_sin_empresa_es_aviso():
    c = clasificar(senales(patentes=[patente(carrier_id=None, carrier_name=None)]))
    assert c.escalations["PATENTE_NO_REGISTRADA"][0]["reason"] == "La patente existe pero no tiene empresa asignada"


def test_un_solo_candidato_reasigna_la_patente():
    c = clasificar(senales(patentes=[patente()], empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur")]}))
    assert [(r.asset_id, r.old_carrier_id, r.new_carrier_id) for r in c.reasignaciones] == [(A1, C1, C2)]
    assert c.carrier_por_patente == {"ABCD12": C2}


def test_dos_candidatos_es_aviso_de_empresa_no_reconocida():
    c = clasificar(senales(patentes=[patente()],
                           empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur"), ("c3", "Trans Sur")]}))
    assert c.reasignaciones == []
    assert c.escalations["EMPRESA_NO_RECONOCIDA"] == [{
        "tractor_plate": "ABCD12", "tms_carrier_name": "Trans Sur",
        "directory_carrier_name": "Trans Norte", "directory_carrier_id": C1}]


def test_override_manual_nunca_se_reasigna():
    c = clasificar(senales(patentes=[patente(is_manual_override=True)],
                           empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur")]}))
    assert c.reasignaciones == [] and c.escalations["EMPRESA_NO_RECONOCIDA"] == []


def test_webcarga_como_empresa_del_tms_no_dispara_nada():
    c = clasificar(senales(patentes=[patente(carrier_names=["WEBCARGA SPA"])]))
    assert c.reasignaciones == [] and c.escalations["EMPRESA_NO_RECONOCIDA"] == []


def test_senal_ambigua_no_se_corrige():
    c = clasificar(senales(patentes=[patente(carrier_names=["Trans Sur", "Otra"])],
                           empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur")]}))
    assert c.reasignaciones == []


def test_mismo_nombre_con_acentos_y_espacios_no_se_corrige():
    c = clasificar(senales(patentes=[patente(carrier_names=["Tráns   Norte"])]))
    assert c.reasignaciones == [] and c.escalations["EMPRESA_NO_RECONOCIDA"] == []


def test_rut_invalido_es_aviso_y_rut_sin_conductor_propone_el_nombre():
    c = clasificar(senales(conductores=[
        Conductor(rut="X", es_canonico=False, names=["Ana"], driver_id=None, full_name=None, is_manual_override=False),
        Conductor(rut="11111111-1", es_canonico=True, names=["Ana Paz"], driver_id=None, full_name=None, is_manual_override=False),
    ]))
    assert c.escalations["CONDUCTOR_NO_REGISTRADO"] == [
        {"driver_rut": "X", "reason": "El TMS informó un RUT que no es válido"},
        {"driver_rut": "11111111-1", "driver_name_tms": "Ana Paz"},
    ]


def test_nombre_distinto_para_el_mismo_rut_se_corrige():
    c = clasificar(senales(conductores=[Conductor(
        rut="11111111-1", es_canonico=True, names=[" Ana Paz "], driver_id=D1,
        full_name="Ana", is_manual_override=False)]))
    assert [(r.driver_id, r.old_name, r.new_name) for r in c.renombres] == [(D1, "Ana", "Ana Paz")]


def test_cliente_nuevo_de_una_patente_resuelta_se_vincula():
    c = clasificar(senales(patentes=[patente(carrier_names=["WEBCARGA"])],
                           pares_cliente=[ParCliente(plate="ABCD12", client_name="walmart")],
                           clientes_por_clave={"WALMART": (S1, "Walmart")},
                           nombres_empresa={C1: "Trans Norte"}))
    assert [(v.carrier_id, v.shipper_id) for v in c.vinculos] == [(C1, S1)]


def test_cliente_ya_vinculado_no_se_repite():
    c = clasificar(senales(patentes=[patente(carrier_names=["WEBCARGA"])],
                           pares_cliente=[ParCliente(plate="ABCD12", client_name="walmart")],
                           clientes_por_clave={"WALMART": (S1, "Walmart")}, vinculos_activos={(C1, S1)}))
    assert c.vinculos == []
```

Run: `venv/bin/python -m pytest tests/test_pre_cierre.py -v` → Expected: FAIL with `ImportError: cannot import name 'Conductor'`.

- [ ] **Step 2: Add `auditar_en_lote` to `audit.py`**

Debajo de `log_change`, con la misma codificación de valores:

```python
async def auditar_en_lote(
    conn: asyncpg.Connection,
    *,
    entity_type: str,
    action: str,
    field: str | None,
    filas: list[tuple[UUID | str, object, object]],
    source: str,
) -> None:
    """Las mismas filas que `log_change`, en una sola sentencia: (entity_id,
    old_value, new_value) por cada cambio. Sin actor: es lo que escribe el
    sistema (pre-cierre)."""
    if not filas:
        return
    await conn.execute(
        """
        INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        SELECT NULL, $1, x.entity_id, $2, $3, x.old_value, x.new_value, $4
        FROM unnest($5::uuid[], $6::jsonb[], $7::jsonb[]) AS x(entity_id, old_value, new_value)
        """,
        entity_type, action, field, source,
        [str(e) for e, _, _ in filas],
        [None if o is None else json.dumps(o, default=str) for _, o, _ in filas],
        [None if n is None else json.dumps(n, default=str) for _, _, n in filas],
    )
```

(Si `audit.py` no importa `json` o `asyncpg`, se agregan arriba; `log_change` ya serializa con
`json.dumps(..., default=str)`: se usa lo mismo.)

- [ ] **Step 3: Rewrite `pre_cierre.py`**

Se conservan `_normalize`, `_looks_like_webcarga_itself` y `_single_value`, sin cambios. El docstring del módulo se
reescribe: dice que las correcciones corren dentro de `recalcular_en` y los avisos en la lectura, y se borran los
párrafos sobre `_recompute`, el "contrapunto deliberado" y "Sodimac trae 0 patentes". El resto del archivo:

```python
from dataclasses import dataclass, field
from datetime import date as _date

from .audit import auditar_en_lote

FUENTE = "pre_cierre_auto"
ESCALACIONES = (
    "PATENTE_NO_REGISTRADA", "EMPRESA_NO_RECONOCIDA", "CONDUCTOR_NO_REGISTRADO",
    "EMPRESA_ONBOARDING", "SIN_TIPO_OPERACION", "CONDUCTOR_SIN_EMPRESA",
)


@dataclass(frozen=True)
class Patente:
    plate: str
    carrier_names: list[str]
    asset_id: str | None
    carrier_id: str | None
    carrier_name: str | None
    is_manual_override: bool


@dataclass(frozen=True)
class Conductor:
    rut: str
    es_canonico: bool
    names: list[str]
    driver_id: str | None
    full_name: str | None
    is_manual_override: bool


@dataclass(frozen=True)
class ParCliente:
    plate: str
    client_name: str


@dataclass(frozen=True)
class Senales:
    patentes: list[Patente]
    conductores: list[Conductor]
    pares_cliente: list[ParCliente]
    # clave = upper(trim(business_name)) → [(id, business_name)]
    empresas_por_clave: dict[str, list[tuple[str, str]]]
    # clave = upper(trim(name)) → (id, name); el primero, como el fetchrow de antes
    clientes_por_clave: dict[str, tuple[str, str]]
    vinculos_activos: set[tuple[str, str]]
    nombres_empresa: dict[str, str]


@dataclass(frozen=True)
class Reasignacion:
    plate: str
    asset_id: str
    old_carrier_id: str
    old_name: str
    new_carrier_id: str
    new_name: str


@dataclass(frozen=True)
class Renombre:
    rut: str
    driver_id: str
    old_name: str
    new_name: str


@dataclass(frozen=True)
class Vinculo:
    carrier_id: str
    carrier_name: str | None
    shipper_id: str
    shipper_name: str


@dataclass
class Clasificacion:
    reasignaciones: list[Reasignacion] = field(default_factory=list)
    renombres: list[Renombre] = field(default_factory=list)
    vinculos: list[Vinculo] = field(default_factory=list)
    carrier_por_patente: dict[str, str] = field(default_factory=dict)
    escalations: dict[str, list[dict]] = field(default_factory=lambda: {k: [] for k in ESCALACIONES})


def clasificar(s: Senales) -> Clasificacion:
    """Las reglas de siempre (Tipo A corrige lo claro, Tipo B avisa), sin E/S."""
    c = Clasificacion()

    for p in s.patentes:
        tms_carrier_name = _single_value(p.carrier_names)
        if not p.asset_id:
            c.escalations["PATENTE_NO_REGISTRADA"].append({
                "tractor_plate": p.plate, "reason": "La patente no existe en public.assets",
                "tms_carrier_name": tms_carrier_name,
            })
            continue
        if not p.carrier_id:
            c.escalations["PATENTE_NO_REGISTRADA"].append({
                "tractor_plate": p.plate, "reason": "La patente existe pero no tiene empresa asignada",
                "tms_carrier_name": tms_carrier_name,
            })
            continue
        c.carrier_por_patente[p.plate] = p.carrier_id
        tms_name = tms_carrier_name
        if not tms_name or _looks_like_webcarga_itself(tms_name):
            continue
        if _normalize(tms_name) == _normalize(p.carrier_name):
            continue
        if p.is_manual_override:
            continue
        candidatos = s.empresas_por_clave.get(_normalize(tms_name), [])
        if len(candidatos) != 1:
            c.escalations["EMPRESA_NO_RECONOCIDA"].append({
                "tractor_plate": p.plate, "tms_carrier_name": tms_name,
                "directory_carrier_name": p.carrier_name, "directory_carrier_id": str(p.carrier_id),
            })
            continue
        nuevo_id, nuevo_nombre = candidatos[0]
        c.reasignaciones.append(Reasignacion(
            plate=p.plate, asset_id=p.asset_id, old_carrier_id=p.carrier_id, old_name=p.carrier_name,
            new_carrier_id=nuevo_id, new_name=nuevo_nombre,
        ))
        c.carrier_por_patente[p.plate] = nuevo_id

    for d in s.conductores:
        if not d.es_canonico:
            c.escalations["CONDUCTOR_NO_REGISTRADO"].append(
                {"driver_rut": d.rut, "reason": "El TMS informó un RUT que no es válido"})
            continue
        tms_name = _single_value(d.names)
        if not d.driver_id:
            c.escalations["CONDUCTOR_NO_REGISTRADO"].append({"driver_rut": d.rut, "driver_name_tms": tms_name})
            continue
        if not tms_name or d.is_manual_override:
            continue
        if _normalize(tms_name) == _normalize(d.full_name):
            continue
        c.renombres.append(Renombre(rut=d.rut, driver_id=d.driver_id, old_name=d.full_name,
                                    new_name=tms_name.strip()))

    vistos: set[tuple[str, str]] = set()
    for par in s.pares_cliente:
        carrier_id = c.carrier_por_patente.get(par.plate)
        if not carrier_id:
            continue
        cliente = s.clientes_por_clave.get(_normalize(par.client_name))
        if not cliente:
            continue
        shipper_id, shipper_name = cliente
        clave = (carrier_id, shipper_id)
        if clave in s.vinculos_activos or clave in vistos:
            continue
        vistos.add(clave)
        nombre = s.nombres_empresa.get(carrier_id)
        c.vinculos.append(Vinculo(carrier_id=carrier_id, carrier_name=nombre,
                                  shipper_id=shipper_id, shipper_name=shipper_name))
    return c


_SQL_PATENTES = """
WITH p AS (
    SELECT upper(trim(t.fleet->>'tractor_plate')) AS plate,
           array_agg(t.fleet->>'transporter_name_tms') AS carrier_names
    FROM app.trips t
    WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'tractor_plate' IS NOT NULL
    GROUP BY 1
)
SELECT p.plate, p.carrier_names, a.id::text AS asset_id,
       asg.carrier_id::text AS carrier_id, asg.business_name AS carrier_name,
       COALESCE(asg.is_manual_override, false) AS is_manual_override
FROM p
LEFT JOIN LATERAL (
    SELECT id FROM public.assets WHERE upper(trim(license_plate)) = p.plate LIMIT 1
) a ON true
LEFT JOIN LATERAL (
    SELECT aa.carrier_id, c.business_name, aa.is_manual_override
    FROM public.asset_assignments aa JOIN public.carriers c ON c.id = aa.carrier_id
    WHERE aa.asset_id = a.id AND aa.status = 'ACTIVE' LIMIT 1
) asg ON true
"""

# La llave del GROUP BY es el RUT canónico cuando existe, y el crudo cuando no
# (27/08): dos formatos del mismo RUT colapsan en un caso.
_SQL_CONDUCTORES = """
WITH r AS (
    SELECT COALESCE(public.canonical_rut(t.fleet->>'driver_rut_tms'),
                    upper(trim(t.fleet->>'driver_rut_tms'))) AS rut,
           bool_or(public.canonical_rut(t.fleet->>'driver_rut_tms') IS NOT NULL) AS es_canonico,
           array_agg(t.fleet->>'driver_name_tms') AS names
    FROM app.trips t
    WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'driver_rut_tms' IS NOT NULL
      AND trim(t.fleet->>'driver_rut_tms') != ''
    GROUP BY 1
)
SELECT r.rut, r.es_canonico, r.names, d.id::text AS driver_id, d.full_name,
       COALESCE(d.is_manual_override, false) AS is_manual_override
FROM r
LEFT JOIN LATERAL (
    SELECT id, full_name, is_manual_override FROM public.drivers WHERE tax_id = r.rut LIMIT 1
) d ON r.es_canonico
"""

_SQL_PARES_CLIENTE = """
SELECT DISTINCT upper(trim(t.fleet->>'tractor_plate')) AS plate, t.client_name
FROM app.trips t
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'tractor_plate' IS NOT NULL
  AND t.client_name IS NOT NULL
"""


async def leer_senales(conn, fecha: _date) -> Senales:
    """Todas las señales del día en un número fijo de consultas (antes, ~4 por fila)."""
    patentes = [Patente(**dict(r)) for r in await conn.fetch(_SQL_PATENTES, fecha)]
    conductores = [Conductor(**dict(r)) for r in await conn.fetch(_SQL_CONDUCTORES, fecha)]
    pares = [ParCliente(**dict(r)) for r in await conn.fetch(_SQL_PARES_CLIENTE, fecha)]

    claves_empresa = sorted({_normalize(n) for p in patentes if (n := _single_value(p.carrier_names))})
    empresas: dict[str, list[tuple[str, str]]] = {}
    for r in await conn.fetch(
        "SELECT id::text AS id, business_name, upper(trim(business_name)) AS clave "
        "FROM public.carriers WHERE upper(trim(business_name)) = ANY($1::text[]) ORDER BY id",
        claves_empresa,
    ):
        empresas.setdefault(r["clave"], []).append((r["id"], r["business_name"]))

    claves_cliente = sorted({_normalize(p.client_name) for p in pares})
    clientes: dict[str, tuple[str, str]] = {}
    for r in await conn.fetch(
        "SELECT id::text AS id, name, upper(trim(name)) AS clave "
        "FROM public.shippers WHERE upper(trim(name)) = ANY($1::text[]) ORDER BY id",
        claves_cliente,
    ):
        clientes.setdefault(r["clave"], (r["id"], r["name"]))

    ids_empresa = sorted({p.carrier_id for p in patentes if p.carrier_id}
                         | {i for lista in empresas.values() for i, _ in lista})
    vinculos = {(r["carrier_id"], r["shipper_id"]) for r in await conn.fetch(
        "SELECT carrier_id::text AS carrier_id, shipper_id::text AS shipper_id FROM public.carrier_shippers "
        "WHERE status = 'ACTIVE' AND carrier_id = ANY($1::uuid[])", ids_empresa)}
    nombres = {r["id"]: r["business_name"] for r in await conn.fetch(
        "SELECT id::text AS id, business_name FROM public.carriers WHERE id = ANY($1::uuid[])", ids_empresa)}

    return Senales(patentes=patentes, conductores=conductores, pares_cliente=pares,
                   empresas_por_clave=empresas, clientes_por_clave=clientes,
                   vinculos_activos=vinculos, nombres_empresa=nombres)


async def aplicar_correcciones(conn, fecha: _date) -> None:
    """Tipo A, en lote. La llama `cierre_lineas.recalcular_en` dentro de su
    transacción, con el período tomado y el origen declarado: estas escrituras
    no vuelven a encolar el día."""
    c = clasificar(await leer_senales(conn, fecha))

    if c.reasignaciones:
        activos = [r.asset_id for r in c.reasignaciones]
        await conn.execute(
            """
            UPDATE public.asset_assignments aa SET status = 'INACTIVE'
            FROM unnest($1::uuid[], $2::uuid[]) AS x(asset_id, carrier_id)
            WHERE aa.asset_id = x.asset_id AND aa.carrier_id = x.carrier_id
              AND aa.status = 'ACTIVE' AND NOT aa.is_manual_override
            """,
            activos, [r.old_carrier_id for r in c.reasignaciones],
        )
        await conn.execute(
            """
            INSERT INTO public.asset_assignments (asset_id, carrier_id, status)
            SELECT x.asset_id, x.carrier_id, 'ACTIVE' FROM unnest($1::uuid[], $2::uuid[]) AS x(asset_id, carrier_id)
            ON CONFLICT (asset_id, carrier_id) DO UPDATE SET status = 'ACTIVE'
            WHERE NOT asset_assignments.is_manual_override
            """,
            activos, [r.new_carrier_id for r in c.reasignaciones],
        )
        await auditar_en_lote(conn, entity_type="ASSET", action="pre_cierre_reasignar_empresa",
                              field="carrier_id", source=FUENTE,
                              filas=[(r.asset_id, r.old_name, r.new_name) for r in c.reasignaciones])

    if c.renombres:
        await conn.execute(
            "UPDATE public.drivers d SET full_name = x.nombre "
            "FROM unnest($1::uuid[], $2::text[]) AS x(id, nombre) WHERE d.id = x.id",
            [r.driver_id for r in c.renombres], [r.new_name for r in c.renombres],
        )
        await auditar_en_lote(conn, entity_type="DRIVER", action="pre_cierre_actualizar_nombre",
                              field="full_name", source=FUENTE,
                              filas=[(r.driver_id, r.old_name, r.new_name) for r in c.renombres])

    if c.vinculos:
        await conn.execute(
            """
            INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status)
            SELECT x.carrier_id, x.shipper_id, 'ACTIVE' FROM unnest($1::uuid[], $2::uuid[]) AS x(carrier_id, shipper_id)
            ON CONFLICT (carrier_id, shipper_id) DO UPDATE SET status = 'ACTIVE'
            WHERE NOT carrier_shippers.is_manual_override
            """,
            [v.carrier_id for v in c.vinculos], [v.shipper_id for v in c.vinculos],
        )
        await auditar_en_lote(conn, entity_type="CARRIER", action="pre_cierre_agregar_cliente",
                              field="carrier_shippers", source=FUENTE,
                              filas=[(v.carrier_id, None, v.shipper_name) for v in c.vinculos])


_SQL_ONBOARDING = """
SELECT DISTINCT c.id::text AS carrier_id, c.business_name AS carrier_name
FROM app.trips t
JOIN public.assets a ON upper(trim(a.license_plate)) = upper(trim(t.fleet->>'tractor_plate'))
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
JOIN public.carriers c ON c.id = aa.carrier_id
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND c.operational_status != 'ACTIVE'
"""

# Trae la PATENTE: la acción es abrir ese tracto y clasificarlo.
_SQL_SIN_TIPO = """
SELECT DISTINCT c.id::text AS carrier_id, c.business_name AS carrier_name, a.license_plate AS tractor_plate
FROM app.trips t
JOIN public.assets a ON upper(trim(a.license_plate)) = upper(trim(t.fleet->>'tractor_plate'))
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND a.webcarga_operation_type_id IS NULL
"""

# PROPONE, no escribe (minuta 25/08): solo con el padrón en silencio y una sola
# empresa en todos sus viajes. El vínculo lo escribe una persona desde el panel.
_SQL_SIN_EMPRESA = """
SELECT vfr.resolved_driver_id::text AS driver_id, d.full_name AS driver_name,
       min(vfr.resolved_carrier_id::text) AS carrier_id, min(c.business_name) AS carrier_name,
       count(*) AS viajes
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
JOIN public.drivers d ON d.id = vfr.resolved_driver_id AND d.operational_status = 'ACTIVE'
JOIN public.carriers c ON c.id = vfr.resolved_carrier_id AND c.operational_status = 'ACTIVE'
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
  AND NOT EXISTS (SELECT 1 FROM public.driver_assignments da
                  WHERE da.driver_id = vfr.resolved_driver_id AND da.status = 'ACTIVE')
GROUP BY vfr.resolved_driver_id, d.full_name
HAVING count(DISTINCT vfr.resolved_carrier_id) = 1
"""

# Lo que el sistema corrigió solo, desde el día D (mismo patrón que
# cierre_viajes.SQL_CON_MOTIVO): se lee de la bitácora, no se guarda aparte.
_SQL_RESUELTAS = """
SELECT a.action, a.old_value, a.new_value, ast.license_plate, d.tax_id, c.business_name
FROM public.audit_log a
LEFT JOIN public.assets ast ON a.entity_type = 'ASSET' AND ast.id = a.entity_id
LEFT JOIN public.drivers d ON a.entity_type = 'DRIVER' AND d.id = a.entity_id
LEFT JOIN public.carriers c ON a.entity_type = 'CARRIER' AND c.id = a.entity_id
WHERE a.source = 'pre_cierre_auto'
  AND (a.occurred_at AT TIME ZONE 'America/Santiago')::date >= $1
ORDER BY a.occurred_at
"""


def _resuelta(r) -> dict:
    viejo = json.loads(r["old_value"]) if r["old_value"] else None
    nuevo = json.loads(r["new_value"]) if r["new_value"] else None
    if r["action"] == "pre_cierre_reasignar_empresa":
        return {"type": "PATENTE_EMPRESA", "tractor_plate": r["license_plate"],
                "old_carrier_name": viejo, "new_carrier_name": nuevo,
                "message": (f"Se actualizó la empresa asociada a la patente {r['license_plate']} de "
                            f"'{viejo}' a '{nuevo}'. Revisar que los documentos asociados (permiso de "
                            "circulación, contrato de conductor) estén vigentes para la nueva empresa.")}
    if r["action"] == "pre_cierre_actualizar_nombre":
        return {"type": "CONDUCTOR_DATOS", "driver_rut": r["tax_id"], "old_value": viejo, "new_value": nuevo,
                "message": f"Se actualizó el nombre del conductor {r['tax_id']} de '{viejo}' a '{nuevo}'."}
    return {"type": "CLIENTE_EMPRESA", "carrier_name": r["business_name"], "client_name": nuevo,
            "message": f"Se agregó '{nuevo}' a la lista de clientes de '{r['business_name']}'."}


async def avisos_del_dia(conn, fecha: _date) -> dict:
    """Tipo B y lo resuelto solo, en lectura pura: no escribe nada."""
    c = clasificar(await leer_senales(conn, fecha))
    escalations = c.escalations
    escalations["EMPRESA_ONBOARDING"] = [dict(r) for r in await conn.fetch(_SQL_ONBOARDING, fecha)]
    escalations["SIN_TIPO_OPERACION"] = [dict(r) for r in await conn.fetch(_SQL_SIN_TIPO, fecha)]
    escalations["CONDUCTOR_SIN_EMPRESA"] = [dict(r) for r in await conn.fetch(_SQL_SIN_EMPRESA, fecha)]
    auto_resolved = [_resuelta(r) for r in await conn.fetch(_SQL_RESUELTAS, fecha)]
    return {"auto_resolved": auto_resolved, "escalations": escalations}
```

(Agregar `import json` arriba. Las llaves de `ESCALACIONES` incluyen todas las de `ESCALACIONES_QUE_BLOQUEAN` de
`cierre_lineas.py`, que no cambia.)

- [ ] **Step 4: Run the unit tests**

Run: `venv/bin/python -m pytest tests/test_pre_cierre.py -v` → Expected: 12 PASS.

- [ ] **Step 5: Write the integration tests (one per correction, plus purity of the notices)**

```python
# monitor-app/backend/api/tests/test_pre_cierre_integracion.py
"""El pre-cierre contra Postgres de verdad: las correcciones escriben lo mismo
que antes y en lote, y los avisos no escriben nada."""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.services import pre_cierre

pytestmark = pytest.mark.integracion
D = date.fromisoformat("2026-06-11")
P = "ZZ-TEST-PRECIERRE"


async def _empresa(conn, nombre):
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id", nombre)


async def _viaje(conn, *, plate=None, transporter=None, rut=None, driver_name=None, client="Walmart"):
    fleet = {k: v for k, v in {"tractor_plate": plate, "transporter_name_tms": transporter,
                               "driver_rut_tms": rut, "driver_name_tms": driver_name}.items() if v}
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, "
        "trip_status, is_active, is_assigned, fleet) VALUES ($1, $2, $3, 'qanalytics', $4, 'RUTA', true, true, $5::jsonb)",
        uuid.uuid4(), D, client, f"{P}-{uuid.uuid4().hex[:6]}", __import__("json").dumps(fleet))


async def test_reasigna_la_patente_y_audita_en_lote(conexion_revertida):
    vieja = await _empresa(conexion_revertida, f"{P} Vieja")
    nueva = await _empresa(conexion_revertida, f"{P} Nueva")
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conexion_revertida.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
    await conexion_revertida.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, vieja)
    await _viaje(conexion_revertida, plate=plate, transporter=f"{P} Nueva")

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    activa = await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.asset_assignments WHERE asset_id = $1 AND status = 'ACTIVE'", asset)
    assert activa == nueva
    fila = await conexion_revertida.fetchrow(
        "SELECT action, field, old_value, new_value, source, actor FROM public.audit_log "
        "WHERE entity_id = $1 ORDER BY id DESC LIMIT 1", asset)
    assert (fila["action"], fila["field"], fila["source"], fila["actor"]) == (
        "pre_cierre_reasignar_empresa", "carrier_id", "pre_cierre_auto", None)
    assert fila["old_value"] == f'"{P} Vieja"' and fila["new_value"] == f'"{P} Nueva"'


async def test_corrige_el_nombre_del_conductor_por_rut(conexion_revertida):
    rut = "11.111.111-1"
    canon = await conexion_revertida.fetchval("SELECT public.canonical_rut($1)", rut)
    await conexion_revertida.execute("DELETE FROM public.drivers WHERE tax_id = $1", canon)
    conductor = await conexion_revertida.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ('Ana', $1, 'ACTIVE') RETURNING id", canon)
    await _viaje(conexion_revertida, rut=rut, driver_name="Ana Paz")

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    assert await conexion_revertida.fetchval("SELECT full_name FROM public.drivers WHERE id = $1", conductor) == "Ana Paz"


async def test_los_avisos_no_escriben_nada(conexion_revertida):
    await _viaje(conexion_revertida, plate=f"ZZ{uuid.uuid4().hex[:4].upper()}", transporter="Otra")
    antes = await conexion_revertida.fetchrow(
        "SELECT sum(n_tup_ins) i, sum(n_tup_upd) u, sum(n_tup_del) d FROM pg_stat_xact_user_tables")

    avisos = await pre_cierre.avisos_del_dia(conexion_revertida, D)

    despues = await conexion_revertida.fetchrow(
        "SELECT sum(n_tup_ins) i, sum(n_tup_upd) u, sum(n_tup_del) d FROM pg_stat_xact_user_tables")
    assert tuple(antes) == tuple(despues)
    assert set(avisos["escalations"]) == set(pre_cierre.ESCALACIONES)
    assert avisos["escalations"]["PATENTE_NO_REGISTRADA"], "la patente inventada tiene que avisarse"
```

Run: `venv/bin/python -m pytest tests/test_pre_cierre_integracion.py -v` → Expected: 3 PASS.
Mutación de `test_reasigna…`: cambiar `NOT aa.is_manual_override` por `aa.is_manual_override` en el `UPDATE` y ver
que falla. Revertir.

- [ ] **Step 6: One-time equivalence check against the old code (not kept as a test)**

Con un script en el scratchpad: importar el `run_pre_cierre` viejo desde `git show HEAD:monitor-app/backend/api/app/services/pre_cierre.py`
(guardado como módulo temporal) y, para cada día abierto y para hoy, en **una** transacción revertida:
ejecutar el viejo, guardar `escalations` y las filas de `audit_log` que agregó, `ROLLBACK TO SAVEPOINT`, ejecutar
`aplicar_correcciones` + `avisos_del_dia` y comparar. Esperado: las mismas escalaciones (como multiconjuntos) y las
mismas filas de auditoría (`entity_id`, `action`, `old_value`, `new_value`). Si difieren, la tarea no está
terminada.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/services/audit.py monitor-app/backend/api/app/services/pre_cierre.py monitor-app/backend/api/tests/test_pre_cierre.py monitor-app/backend/api/tests/test_pre_cierre_integracion.py
git commit -m "refactor(cierre): el pre-cierre lee por conjuntos y escribe en lote; los avisos no escriben"
```

(`recalcular` todavía llama a `run_pre_cierre`, que ya no existe: este commit deja la suite roja en
`cierre_lineas` hasta el Task 4. **Hacer los Tasks 3 y 4 seguidos y empujar recién después del Task 4.**)

---

### Task 4: `cierre_lineas`: recálculo dentro del período, firma atómica, sin proyección

**Files:**
- Modify: `monitor-app/backend/api/app/services/cierre_lineas.py`
- Modify: `monitor-app/backend/api/tests/test_cierre_lineas.py` (los tests de la proyección y de `recalcular`)

**Interfaces:**
- Consumes: `aplicar_correcciones`, `avisos_del_dia` (Task 3).
- Produces:
  - `class Resultado(StrEnum): RECALCULADO = "recalculado"; CERRADO = "cerrado"; OCUPADO = "ocupado"`
  - `async def bloquear_periodo(conn, fecha: date, *, saltar_si_ocupado: bool = False) -> str | None` (`None` = lo tiene otro)
  - `async def recalcular_en(conn, fecha: date) -> None` (quien llama ya tomó el período `OPEN`)
  - `async def recalcular(pool, fecha: date, *, version: int | None = None, saltar_si_ocupado: bool = False) -> Resultado`
  - `SQL_ENCOLAR` (constante usada por `reabrir`)

- [ ] **Step 1: Write the failing tests**

En `tests/test_cierre_lineas.py`:
- Borrar `test_las_tablas_viejas_quedan_como_proyeccion_de_las_lineas`.
- En `test_cerrar_firma_los_dos_ejes_en_el_periodo_y_en_las_cabeceras_viejas`: renombrar a
  `test_cerrar_firma_los_dos_ejes_en_el_periodo` y quitar las aserciones sobre `app.daily_closures` / `app.equipment_closures`.
- En `test_un_dia_cerrado_no_se_recalcula_ni_se_edita`: donde se espera `None` de `recalcular`, esperar `Resultado.CERRADO`.
- Agregar:

```python
async def test_firmar_saca_el_dia_de_la_cola(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    actor = await _usuario_real(conexion_revertida)
    await conexion_revertida.execute(cierre_lineas.SQL_ENCOLAR, D)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="test", user=con_roles(actor, *ADMIN_EQUIVALENTE))
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 0


async def test_reabrir_deja_el_dia_encolado(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    actor = await _usuario_real(conexion_revertida)
    admin = con_roles(actor, *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="test", user=admin)
    await cierre_lineas.reabrir(pool, D, nota="llegó una asignación tarde", user=admin)
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 1


async def test_recalcular_con_la_version_leida_desencola(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    await conexion_revertida.execute(cierre_lineas.SQL_ENCOLAR, D)
    v = await conexion_revertida.fetchval("SELECT version FROM app.closure_recompute_queue WHERE business_date = $1", D)
    assert await cierre_lineas.recalcular(pool, D, version=v) is cierre_lineas.Resultado.RECALCULADO
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 0


async def test_una_marca_posterior_a_la_lectura_sobrevive(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    await conexion_revertida.execute(cierre_lineas.SQL_ENCOLAR, D)
    v = await conexion_revertida.fetchval("SELECT version FROM app.closure_recompute_queue WHERE business_date = $1", D)
    await conexion_revertida.execute(cierre_lineas.SQL_ENCOLAR, D)   # llega otra marca
    await cierre_lineas.recalcular(pool, D, version=v)
    assert await conexion_revertida.fetchval(
        "SELECT version FROM app.closure_recompute_queue WHERE business_date = $1", D) == v + 1


async def test_el_recalculo_no_se_reencola_aunque_corrija_el_directorio(conexion_revertida):
    """Review Focus 5: las correcciones escriben en tablas con trigger de marca.
    El escenario fuerza una corrección real (reasignar una patente) y comprueba
    las dos cosas: que corrigió, y que el día no volvió a la cola."""
    pool = PoolDeUnaConexion(conexion_revertida)
    vieja = await conexion_revertida.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ('ZZ-TEST Vieja', 'ACTIVE') RETURNING id")
    nueva = await conexion_revertida.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ('ZZ-TEST Nueva', 'ACTIVE') RETURNING id")
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conexion_revertida.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
    await conexion_revertida.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, vieja)
    await conexion_revertida.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "is_active, is_assigned, fleet) VALUES ($1, $2, 'Walmart', 'qanalytics', $3, 'RUTA', true, true, $4::jsonb)",
        uuid.uuid4(), D, f"ZZ-{plate}", json.dumps({"tractor_plate": plate, "transporter_name_tms": "ZZ-TEST Nueva"}))
    await conexion_revertida.execute("DELETE FROM app.closure_recompute_queue WHERE business_date = $1", D)

    await cierre_lineas.recalcular(pool, D)

    assert await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.asset_assignments WHERE asset_id = $1 AND status = 'ACTIVE'", asset) == nueva
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 0
```

(`D`, `PoolDeUnaConexion`, `_usuario_real`, `con_roles` y `ADMIN_EQUIVALENTE` ya están importados en ese archivo;
si falta alguno, importarlo de `tests.conftest` como hace `test_cierre_por_origen_integracion.py`. Agregar
`import json` e `import uuid` si faltan. Nota: insertar el viaje en `app.trips` dispara el trigger de marca de
dbt (Task 2); por eso el test vacía la cola de `D` después de armar el escenario y antes de recalcular.)

Run: `venv/bin/python -m pytest tests/test_cierre_lineas.py -v` → Expected: los nuevos FAIL (`AttributeError: SQL_ENCOLAR`).

- [ ] **Step 2: Implement in `cierre_lineas.py`**

1. Docstring del módulo: reemplazar el párrafo "Transición (olas 2-3…)" por:
   `Cuándo corre (spec 2026-10-10): los triggers trg_marcar_cierre_* encolan el día en app.closure_recompute_queue y el ejecutor (services/cola_del_cierre.py) llama a recalcular. Los GET solo leen.`
2. Borrar `_SQL_PROYECTAR_CONDUCTORES`, `_SQL_PROYECTAR_TRACTOS`, `_proyectar` y su sección.
3. Reemplazar el import `from .pre_cierre import run_pre_cierre` por `from .pre_cierre import aplicar_correcciones, avisos_del_dia`, y agregar `from enum import StrEnum`.
4. Reemplazar `_bloquear_periodo` y `recalcular` por:

```python
class Resultado(StrEnum):
    RECALCULADO = "recalculado"
    CERRADO = "cerrado"
    OCUPADO = "ocupado"


SQL_ENCOLAR = """
INSERT INTO app.closure_recompute_queue (business_date) VALUES ($1)
ON CONFLICT (business_date) DO UPDATE SET version = app.closure_recompute_queue.version + 1
"""


async def bloquear_periodo(conn, fecha: date, *, saltar_si_ocupado: bool = False) -> str | None:
    """Crea el período si no existe y lo toma con FOR UPDATE: firmar, poner un
    motivo y recalcular el mismo día se serializan acá. Con `saltar_si_ocupado`
    (el ejecutor) no espera: devuelve None si otro lo tiene."""
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date) VALUES ($1) ON CONFLICT DO NOTHING", fecha,
    )
    sql = "SELECT status FROM app.closure_periods WHERE business_date = $1 FOR UPDATE"
    return await conn.fetchval(sql + (" SKIP LOCKED" if saltar_si_ocupado else ""), fecha)


async def recalcular_en(conn, fecha: date) -> None:
    """Deriva las líneas del día. Quien llama ya tomó el período ABIERTO con
    `bloquear_periodo`, dentro de una transacción.

    El origen declarado hace que las correcciones del pre-cierre (que escriben
    en tablas con trigger de marca) no vuelvan a encolar el día."""
    await conn.execute("SET LOCAL app.origen_escritura = 'recalculo_cierre'")
    await aplicar_correcciones(conn, fecha)
    await conn.execute(_SQL_UPSERT_CONDUCTORES, fecha)
    await conn.execute(_SQL_UPSERT_TRACTOS, fecha)
    await conn.execute(_SQL_HEREDAR_VIGENCIA, fecha)
    await conn.execute(_SQL_SINCRONIZAR_TRACTOS, fecha)


async def recalcular(pool, fecha: date, *, version: int | None = None,
                     saltar_si_ocupado: bool = False) -> Resultado:
    """Recalcula el día en su propia transacción. Con `version` (la que leyó el
    ejecutor), saca el día de la cola solo si nadie volvió a marcarlo mientras
    calculaba. Un día firmado no se recalcula: si estaba en la cola, sale."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            estado = await bloquear_periodo(conn, fecha, saltar_si_ocupado=saltar_si_ocupado)
            if estado is None:
                return Resultado.OCUPADO
            if estado == "OPEN":
                await recalcular_en(conn, fecha)
            if version is not None:
                await conn.execute(
                    "DELETE FROM app.closure_recompute_queue WHERE business_date = $1 AND version = $2",
                    fecha, version,
                )
            return Resultado.RECALCULADO if estado == "OPEN" else Resultado.CERRADO
```

5. Reemplazar cada `_bloquear_periodo(` restante por `bloquear_periodo(` (`poner_motivo`, `cerrar`, `reabrir`) y
   borrar la llamada `await _proyectar(conn, fecha)` de `poner_motivo`.
6. En `cerrar`: borrar `pre_cierre = await recalcular(pool, fecha)`. Dentro de la transacción, justo después de
   `if await bloquear_periodo(conn, fecha) == "CLOSED": raise …`, agregar:

```python
            # La firma recalcula en SU transacción: nunca congela un estado viejo,
            # aunque el día esté en la cola esperando al ejecutor.
            await recalcular_en(conn, fecha)
            avisos = await avisos_del_dia(conn, fecha)
```

   cambiar `sin_flota = pendientes_de_flota(pre_cierre)` por `sin_flota = pendientes_de_flota(avisos)` (y borrar el
   comentario "Si el día ya se había recalculado cerrado por otro camino…"), borrar los dos
   `INSERT INTO app.daily_closures` / `app.equipment_closures` y su comentario, y después del `UPDATE app.closure_periods … RETURNING closed_at` agregar:

```python
            await conn.execute("DELETE FROM app.closure_recompute_queue WHERE business_date = $1", fecha)
```

7. En `reabrir`: borrar los dos `DELETE FROM app.daily_closures` / `app.equipment_closures` y agregar, después del
   `UPDATE app.closure_periods SET status = 'OPEN'…`:

```python
            # Reabrir es para corregir: el ejecutor lo recalcula sin que nadie abra la pantalla.
            await conn.execute(SQL_ENCOLAR, fecha)
```

- [ ] **Step 3: Run the cierre tests**

Run: `venv/bin/python -m pytest tests/test_cierre_lineas.py tests/test_cierre_por_origen_integracion.py tests/test_cierre_sodimac_integracion.py tests/test_pre_cierre.py tests/test_pre_cierre_integracion.py -v`
Expected: PASS. Si un test viejo esperaba el dict del pre-cierre como retorno de `recalcular`, cambiarlo para
leer `avisos_del_dia` (no dejarlo comprobando algo que ya no existe).

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/app/services/cierre_lineas.py monitor-app/backend/api/tests/test_cierre_lineas.py
git commit -m "refactor(cierre): recalcular dentro del período, firma atómica y sin proyección a las tablas viejas"
```

---

### Task 5: El ejecutor de la cola

**Files:**
- Create: `monitor-app/backend/api/app/services/cola_del_cierre.py`
- Test: `monitor-app/backend/api/tests/test_cola_del_cierre_ejecutor_integracion.py`

**Interfaces:**
- Consumes: `cierre_lineas.recalcular(pool, fecha, version=, saltar_si_ocupado=True) -> Resultado`.
- Produces: `async def procesar_cola(pool, *, presupuesto_s: float = 45.0) -> dict` →
  `{"recalculados": [iso], "cerrados": [iso], "ocupados": [iso], "fallidos": [{"fecha": iso, "error": str}], "pendientes": int}`.

- [ ] **Step 1: Write the failing tests**

```python
# monitor-app/backend/api/tests/test_cola_del_cierre_ejecutor_integracion.py
"""El ejecutor de la cola del Cierre (spec 2026-10-10, §3.3)."""
from __future__ import annotations

from datetime import date

import asyncpg
import pytest

from app.services import cierre_lineas, cola_del_cierre
from tests.conftest import PoolDeUnaConexion, _usuario_real, credenciales_integracion

pytestmark = pytest.mark.integracion
D = date.fromisoformat("2026-06-11")


async def _solo_d_en_la_cola(conn):
    await conn.execute("DELETE FROM app.closure_recompute_queue")
    await conn.execute(cierre_lineas.SQL_ENCOLAR, D)


async def test_recalcula_y_vacia_la_cola(conexion_revertida):
    await _solo_d_en_la_cola(conexion_revertida)
    r = await cola_del_cierre.procesar_cola(PoolDeUnaConexion(conexion_revertida))
    assert D.isoformat() in r["recalculados"]
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 0


async def test_un_dia_firmado_sale_sin_calcular(conexion_revertida):
    actor = (await _usuario_real(conexion_revertida))["sub"]
    await conexion_revertida.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) VALUES ($1, 'CLOSED', $2::uuid, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2::uuid, closed_at = now()", D, actor)
    await _solo_d_en_la_cola(conexion_revertida)
    r = await cola_del_cierre.procesar_cola(PoolDeUnaConexion(conexion_revertida))
    assert D.isoformat() in r["cerrados"]


async def test_un_dia_que_falla_queda_en_la_cola_y_los_demas_siguen(conexion_revertida, monkeypatch):
    otro = date.fromisoformat("2026-06-12")
    await _solo_d_en_la_cola(conexion_revertida)
    await conexion_revertida.execute(cierre_lineas.SQL_ENCOLAR, otro)
    real = cierre_lineas.recalcular

    async def falla_en_d(pool, fecha, **kw):
        if fecha == D:
            raise RuntimeError("boom")
        return await real(pool, fecha, **kw)

    monkeypatch.setattr(cierre_lineas, "recalcular", falla_en_d)
    r = await cola_del_cierre.procesar_cola(PoolDeUnaConexion(conexion_revertida))
    assert r["fallidos"] == [{"fecha": D.isoformat(), "error": "boom"}]
    assert otro.isoformat() in r["recalculados"]
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 1


async def test_un_dia_tomado_por_otra_conexion_se_salta(conexion_revertida):
    """Review Focus 2 y 3: otra corrida o una firma tienen el período.

    Usa un período que YA existe en firme: si lo creara la transacción revertida,
    la otra conexión quedaría esperando su INSERT sin confirmar."""
    fecha = await conexion_revertida.fetchval(
        "SELECT business_date FROM app.closure_periods WHERE status = 'OPEN' ORDER BY 1 LIMIT 1")
    if fecha is None:
        pytest.skip("no hay un período abierto en firme")
    otra = await asyncpg.connect(**credenciales_integracion())
    tx = otra.transaction()
    await tx.start()
    try:
        await otra.fetchval("SELECT status FROM app.closure_periods WHERE business_date = $1 FOR UPDATE", fecha)
        r = await cierre_lineas.recalcular(PoolDeUnaConexion(conexion_revertida), fecha, saltar_si_ocupado=True)
        assert r is cierre_lineas.Resultado.OCUPADO
    finally:
        await tx.rollback()
        await otra.close()
```

Run: `venv/bin/python -m pytest tests/test_cola_del_cierre_ejecutor_integracion.py -v` → Expected: FAIL
(`ModuleNotFoundError: app.services.cola_del_cierre`).

- [ ] **Step 2: Implement `cola_del_cierre.py`**

```python
"""El ejecutor de la cola del Cierre (spec 2026-10-10, §3.3).

Lo llama Cloud Scheduler cada minuto vía POST /api/v1/internal/closures/recompute.
Recorre los días encolados por los triggers trg_marcar_cierre_* y recalcula cada
uno con la versión que leyó: si alguien lo volvió a marcar mientras tanto, la
entrada queda para la próxima corrida. Un día que falla no detiene a los demás."""
from __future__ import annotations

import logging
import time

from . import cierre_lineas

log = logging.getLogger(__name__)

# Hoy entra aunque nadie lo haya encolado si todavía no tiene líneas: así cada
# día arranca calculado sin que nadie abra la pantalla.
_SQL_PENDIENTES = """
SELECT q.business_date, q.version
FROM app.closure_recompute_queue q
UNION ALL
SELECT public.hoy_chile(), NULL
WHERE NOT EXISTS (SELECT 1 FROM app.closure_lines WHERE business_date = public.hoy_chile())
  AND NOT EXISTS (SELECT 1 FROM app.closure_recompute_queue WHERE business_date = public.hoy_chile())
ORDER BY 1
"""


async def procesar_cola(pool, *, presupuesto_s: float = 45.0) -> dict:
    inicio = time.monotonic()
    resumen: dict = {"recalculados": [], "cerrados": [], "ocupados": [], "fallidos": [], "pendientes": 0}
    filas = await pool.fetch(_SQL_PENDIENTES)
    for i, fila in enumerate(filas):
        if time.monotonic() - inicio > presupuesto_s:
            resumen["pendientes"] = len(filas) - i
            break
        fecha, version = fila["business_date"], fila["version"]
        try:
            resultado = await cierre_lineas.recalcular(pool, fecha, version=version, saltar_si_ocupado=True)
        except Exception as exc:  # aislar el día: los demás siguen y este se reintenta
            log.exception("recalculo_del_cierre_fallido", extra={"business_date": fecha.isoformat()})
            resumen["fallidos"].append({"fecha": fecha.isoformat(), "error": str(exc)})
            continue
        clave = {cierre_lineas.Resultado.RECALCULADO: "recalculados",
                 cierre_lineas.Resultado.CERRADO: "cerrados",
                 cierre_lineas.Resultado.OCUPADO: "ocupados"}[resultado]
        resumen[clave].append(fecha.isoformat())
    return resumen
```

- [ ] **Step 3: Run the tests**

Run: `venv/bin/python -m pytest tests/test_cola_del_cierre_ejecutor_integracion.py -v` → Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/app/services/cola_del_cierre.py monitor-app/backend/api/tests/test_cola_del_cierre_ejecutor_integracion.py
git commit -m "feat(cierre): ejecutor de la cola de recálculo"
```

---

### Task 6: El endpoint interno y la autenticación de Cloud Scheduler

**Files:**
- Create: `monitor-app/backend/api/app/authz/servicio_interno.py`
- Create: `monitor-app/backend/api/app/routers/internal.py`
- Modify: `monitor-app/backend/api/app/config.py`, `monitor-app/backend/api/app/main.py`,
  `monitor-app/backend/api/tests/test_toda_ruta_declara_permiso.py`, `.github/workflows/deploy-monitor-api.yml`
- Test: `monitor-app/backend/api/tests/test_endpoint_interno_del_cierre.py`

**Interfaces:**
- Consumes: `procesar_cola(pool) -> dict` (Task 5).
- Produces: `POST /api/v1/internal/closures/recompute` → 200 con el resumen, 500 si hubo `fallidos`, 401/403 sin
  token válido. Settings `scheduler_service_account: str = ""`, `scheduler_audience: str = ""`.

- [ ] **Step 1: Write the failing tests**

```python
# monitor-app/backend/api/tests/test_endpoint_interno_del_cierre.py
"""POST /api/v1/internal/closures/recompute solo para Cloud Scheduler."""
from __future__ import annotations

import time
from unittest.mock import AsyncMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.authz import servicio_interno
from app.config import Settings, get_settings
from app.db import get_pool
from app.main import app

AUD = "https://api.test/api/v1/internal/closures/recompute"
CUENTA = "cierre-scheduler@webcarga-dev-493220.iam.gserviceaccount.com"
LLAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(**claims) -> str:
    base = {"iss": "https://accounts.google.com", "aud": AUD, "email": CUENTA, "email_verified": True,
            "iat": int(time.time()), "exp": int(time.time()) + 300}
    base.update(claims)
    return jwt.encode(base, LLAVE, algorithm="RS256", headers={"kid": "k1"})


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setattr(servicio_interno, "_llave_de_google", lambda token: LLAVE.public_key())
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="x", supabase_url="https://s", supabase_service_role_key="x",
        scheduler_service_account=CUENTA, scheduler_audience=AUD)
    pool = AsyncMock()
    app.dependency_overrides[get_pool] = lambda: pool
    monkeypatch.setattr("app.routers.internal.procesar_cola",
                        AsyncMock(return_value={"recalculados": [], "cerrados": [], "ocupados": [],
                                                "fallidos": [], "pendientes": 0}))
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_sin_token_es_401(cliente):
    assert cliente.post("/api/v1/internal/closures/recompute").status_code == 401


def test_otra_cuenta_es_403(cliente):
    r = cliente.post("/api/v1/internal/closures/recompute",
                     headers={"Authorization": f"Bearer {_token(email='otro@x.iam.gserviceaccount.com')}"})
    assert r.status_code == 403


def test_otra_audiencia_es_401(cliente):
    r = cliente.post("/api/v1/internal/closures/recompute",
                     headers={"Authorization": f"Bearer {_token(aud='https://otra')}"})
    assert r.status_code == 401


def test_el_token_del_scheduler_procesa_la_cola(cliente):
    r = cliente.post("/api/v1/internal/closures/recompute", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200 and r.json()["fallidos"] == []


def test_si_un_dia_falla_responde_500(cliente, monkeypatch):
    monkeypatch.setattr("app.routers.internal.procesar_cola", AsyncMock(return_value={
        "recalculados": [], "cerrados": [], "ocupados": [], "pendientes": 0,
        "fallidos": [{"fecha": "2026-10-10", "error": "boom"}]}))
    r = cliente.post("/api/v1/internal/closures/recompute", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 500


def test_sin_configuracion_nadie_entra(cliente):
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="x", supabase_url="https://s", supabase_service_role_key="x")
    r = cliente.post("/api/v1/internal/closures/recompute", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 403
```

Run: `venv/bin/python -m pytest tests/test_endpoint_interno_del_cierre.py -v` → Expected: FAIL (import).

- [ ] **Step 2: Implement**

`app/config.py`, dentro de `Settings` (después de `sharepoint_tenant_id`):

```python
    # Cloud Scheduler → POST /api/v1/internal/closures/recompute (spec
    # 2026-10-10). Vacíos: el endpoint no deja entrar a nadie.
    scheduler_service_account: str = ""
    scheduler_audience: str = ""
```

`app/authz/servicio_interno.py`:

```python
"""Quién puede llamar a los endpoints internos: Cloud Scheduler, con un token
OIDC de Google emitido para su cuenta de servicio (spec 2026-10-10, §3.3).

Mismo mecanismo que `auth.verificar_token` para Supabase: la firma se verifica
localmente con las llaves públicas del emisor (PyJWT + JWKS), sin dependencias
nuevas."""
from __future__ import annotations

import asyncio
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..config import Settings, get_settings

_GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
_EMISORES = ("https://accounts.google.com", "accounts.google.com")
_bearer = HTTPBearer(auto_error=False)


@lru_cache
def _cliente_jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(_GOOGLE_JWKS, cache_keys=True, lifespan=3600)


def _llave_de_google(token: str):
    return _cliente_jwks().get_signing_key_from_jwt(token).key


async def requiere_scheduler(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    if not settings.scheduler_service_account or not settings.scheduler_audience:
        raise HTTPException(403, "Endpoint interno sin configurar")
    if cred is None:
        raise HTTPException(401, "Falta el token")
    try:
        llave = await asyncio.to_thread(_llave_de_google, cred.credentials)
        claims = jwt.decode(cred.credentials, llave, algorithms=["RS256"],
                            audience=settings.scheduler_audience, options={"require": ["exp", "iss", "aud"]})
    except (jwt.PyJWKClientError, jwt.InvalidTokenError):
        raise HTTPException(401, "Token inválido")
    if claims.get("iss") not in _EMISORES:
        raise HTTPException(401, "Token inválido")
    if claims.get("email") != settings.scheduler_service_account or not claims.get("email_verified"):
        raise HTTPException(403, "Cuenta no autorizada")
    return claims["email"]
```

`app/routers/internal.py`:

```python
"""Endpoints que solo llama la infraestructura (Cloud Scheduler)."""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..authz.servicio_interno import requiere_scheduler
from ..db import get_pool
from ..services.cola_del_cierre import procesar_cola

router = APIRouter(prefix="/internal", tags=["internal"])


@router.post("/closures/recompute")
async def recalcular_cola_del_cierre(pool=Depends(get_pool), _=Depends(requiere_scheduler)):
    resumen = await procesar_cola(pool)
    # 500 si algún día falló, para que el Scheduler lo registre; la entrada
    # queda en la cola y se reintenta en la corrida siguiente.
    return JSONResponse(resumen, status_code=500 if resumen["fallidos"] else 200)
```

`app/main.py`: `from .routers.internal import router as internal_router` junto a los demás imports, y
`app.include_router(internal_router, prefix="/api/v1")` junto a los demás `include_router`.

`tests/test_toda_ruta_declara_permiso.py`, en `EXCEPCIONES`:

```python
    "/api/v1/internal/closures/recompute",  # Cloud Scheduler: token OIDC, no persona (servicio_interno.py)
```

`.github/workflows/deploy-monitor-api.yml`: la línea `--set-env-vars=ENVIRONMENT=${{ env.ENV_SUFFIX }}` pasa a

```yaml
            --set-env-vars=ENVIRONMENT=${{ env.ENV_SUFFIX }},SCHEDULER_SERVICE_ACCOUNT=${{ env.ENV_SUFFIX == 'dev' && format('cierre-scheduler@{0}.iam.gserviceaccount.com', env.PROJECT_ID) || '' }},SCHEDULER_AUDIENCE=${{ env.ENV_SUFFIX == 'dev' && 'https://webcarga-monitor-api-dev-zcdyyci7ta-uc.a.run.app/api/v1/internal/closures/recompute' || '' }}
```

Solo dev (decisión del 09/10): en `main` quedan vacías y el endpoint no deja entrar a nadie. La URL es la del
servicio de dev (verificada el 10/10 con `gcloud run services describe`).

- [ ] **Step 3: Run the tests**

Run: `venv/bin/python -m pytest tests/test_endpoint_interno_del_cierre.py tests/test_toda_ruta_declara_permiso.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/app/authz/servicio_interno.py monitor-app/backend/api/app/routers/internal.py monitor-app/backend/api/app/config.py monitor-app/backend/api/app/main.py monitor-app/backend/api/tests/test_endpoint_interno_del_cierre.py monitor-app/backend/api/tests/test_toda_ruta_declara_permiso.py .github/workflows/deploy-monitor-api.yml
git commit -m "feat(cierre): endpoint interno que vacía la cola, solo para Cloud Scheduler"
```

---

### Task 7: Los GET del Cierre pasan a ser lecturas puras

**Files:**
- Modify: `monitor-app/backend/api/app/services/cierre_lineas.py` (agregar `frescura_del_dia`)
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py`, `equipment_closures.py`, `status_report.py`
- Modify: `monitor-app/backend/api/tests/test_daily_closures.py`, `test_equipment_closures.py` (los que mockean `_recompute`)
- Test: `monitor-app/backend/api/tests/test_get_del_cierre_no_escribe_integracion.py`

**Interfaces:**
- Consumes: `avisos_del_dia(conn, fecha)` (Task 3).
- Produces: `async def frescura_del_dia(pool, fecha) -> dict` → `{"calculado_a": datetime|None, "pendiente_desde": datetime|None}`;
  las tres respuestas suman `calculado_a` y `pendiente_desde`; `daily-closures.pre_cierre` = `avisos_del_dia` (o `None`
  si el día está firmado); `equipment-closures` ya no tiene `pre_cierre`.

- [ ] **Step 1: Write the failing test**

```python
# monitor-app/backend/api/tests/test_get_del_cierre_no_escribe_integracion.py
"""RFC 9110 §9.2.1: leer el Cierre no escribe (spec 2026-10-10, §3.4)."""
from __future__ import annotations

import pytest

from app.routers.daily_closures import get_daily_closure_status
from app.routers.equipment_closures import get_equipment_closure_status
from app.routers.status_report import get_status_report
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

_CONTADORES = "SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_xact_user_tables"


@pytest.mark.parametrize("leer", [
    lambda pool, f: get_daily_closure_status(fecha=f, pool=pool, _=None),
    lambda pool, f: get_equipment_closure_status(fecha=f, pool=pool, _=None),
    lambda pool, f: get_status_report(fecha=f, client=None, pool=pool, _=None),   # firma real: status_report.py:535
])
async def test_leer_el_cierre_no_escribe_ninguna_fila(conexion_revertida, leer):
    fecha = (await conexion_revertida.fetchval("SELECT public.hoy_chile()")).isoformat()
    antes = await conexion_revertida.fetchval(_CONTADORES)
    respuesta = await leer(PoolDeUnaConexion(conexion_revertida), fecha)
    assert await conexion_revertida.fetchval(_CONTADORES) == antes
    assert "pendiente_desde" in respuesta and "calculado_a" in respuesta
```


Run: `venv/bin/python -m pytest tests/test_get_del_cierre_no_escribe_integracion.py -v` → Expected: FAIL (escriben).

- [ ] **Step 2: Implement**

En `cierre_lineas.py`, junto a `periodo`:

```python
async def frescura_del_dia(pool, fecha: date) -> dict:
    """Cuándo se calcularon las líneas del día y desde cuándo hay cambios
    pendientes (null = al día). Lo leen las tres pantallas del Cierre."""
    fila = await pool.fetchrow(
        """
        SELECT (SELECT max(computed_at) FROM app.closure_lines WHERE business_date = $1) AS calculado_a,
               (SELECT requested_at FROM app.closure_recompute_queue WHERE business_date = $1) AS pendiente_desde
        """,
        fecha,
    )
    return dict(fila)
```

En `daily_closures.py`:
- Borrar `_recompute` y el import de `recalcular`; importar `frescura_del_dia` de `cierre_lineas` y
  `avisos_del_dia` de `..services.pre_cierre`.
- En `get_daily_closure_status`: borrar `pre_cierre = await _recompute(...)`. Después de calcular `cerrado`:

```python
    if cerrado:
        pre_cierre = None   # un día firmado no muestra avisos: ya no se puede corregir sin reabrir
    else:
        async with pool.acquire() as conn:
            pre_cierre = await avisos_del_dia(conn, business_date)
    frescura = await frescura_del_dia(pool, business_date)
```

  y en el `return` sumar `**frescura` (y conservar `"pre_cierre": pre_cierre`).
- Docstring del módulo: reemplazar "app.driver_day_status se recalcula en cada GET (…)" por
  "Las líneas las calcula el ejecutor de la cola (services/cola_del_cierre.py); este GET solo lee."

En `equipment_closures.py`: borrar `_recompute`, su import, la línea `pre_cierre = await _recompute(...)` y
`"pre_cierre": pre_cierre` del `return`; sumar `**await frescura_del_dia(pool, business_date)` al `return`.

En `status_report.py`: borrar `await recalcular(pool, business_date)` y su comentario (HU-02…), el import de
`recalcular`; en el handler que arma la respuesta, sumar `**await frescura_del_dia(pool, business_date)`.

En `tests/test_daily_closures.py` y `tests/test_equipment_closures.py`: borrar los `patch`/`monkeypatch` de
`_recompute` y `recalcular`. Donde se aseguraba que el GET recalculaba, asegurar lo contrario: que `recalcular` no
se llama (`AsyncMock` con `assert_not_called()`). En `test_equipment_closures.py`, la aserción sobre
`pre_cierre` en la respuesta pasa a `assert "pre_cierre" not in body`.

- [ ] **Step 3: Run the tests**

Run: `venv/bin/python -m pytest tests/test_get_del_cierre_no_escribe_integracion.py tests/test_daily_closures.py tests/test_equipment_closures.py -v`
Expected: PASS.

- [ ] **Step 4: Run the full backend suite**

Run: `venv/bin/python -m pytest tests/ -q -p no:cacheprovider` (en segundo plano: unos 27 min).
Expected: verde, salvo `test_cargar_catalogo_webcarga.py::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar`
(deuda ajena registrada el 09/10). Cualquier otro rojo se resuelve antes del commit.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/services/cierre_lineas.py monitor-app/backend/api/app/routers/daily_closures.py monitor-app/backend/api/app/routers/equipment_closures.py monitor-app/backend/api/app/routers/status_report.py monitor-app/backend/api/tests/
git commit -m "refactor(cierre): leer el Cierre ya no recalcula ni escribe"
```

---

### Task 8: El aviso de actualización en pantalla

**Files:**
- Create: `monitor-app/frontend/components/dashboard/AvisoDeActualizacion.tsx`
- Create: `monitor-app/frontend/components/dashboard/AvisoDeActualizacion.test.tsx`
- Modify: `monitor-app/frontend/lib/types.ts` (`DailyClosureStatus`, `EquipmentClosureStatus`, `StatusReport`)
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx`

**Interfaces:**
- Consumes: `pendiente_desde: string | null`, `calculado_a: string | null` de las tres respuestas (Task 7).
- Produces: `export function estadoDeFrescura(pendienteDesde: string | null, ahora: Date): 'al_dia' | 'actualizando' | 'atrasado'`
  y `<AvisoDeActualizacion pendienteDesde={...} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// monitor-app/frontend/components/dashboard/AvisoDeActualizacion.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvisoDeActualizacion, estadoDeFrescura } from './AvisoDeActualizacion'

const AHORA = new Date('2026-10-10T15:00:00Z')

describe('estadoDeFrescura', () => {
  it('sin pendiente está al día', () => {
    expect(estadoDeFrescura(null, AHORA)).toBe('al_dia')
  })
  it('pendiente hace menos de 5 minutos se está actualizando', () => {
    expect(estadoDeFrescura('2026-10-10T14:57:00Z', AHORA)).toBe('actualizando')
  })
  it('pendiente hace más de 5 minutos está atrasado', () => {
    expect(estadoDeFrescura('2026-10-10T14:50:00Z', AHORA)).toBe('atrasado')
  })
})

describe('AvisoDeActualizacion', () => {
  it('no muestra nada si está al día', () => {
    const { container } = render(<AvisoDeActualizacion pendienteDesde={null} ahora={AHORA} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('dice Actualizando mientras está pendiente', () => {
    render(<AvisoDeActualizacion pendienteDesde="2026-10-10T14:58:00Z" ahora={AHORA} />)
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando')
  })
  it('dice desde cuándo no se pudo actualizar', () => {
    render(<AvisoDeActualizacion pendienteDesde="2026-10-10T14:40:00Z" ahora={AHORA} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar desde 11:40')
  })
})
```

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/AvisoDeActualizacion.test.tsx` → Expected: FAIL (módulo no existe).

- [ ] **Step 2: Implement the component**

Antes de escribirlo, correr `ui-ux-pro-max --design-system` y su checklist sobre el aviso (memoria
`feedback_always_pair_frontend_design_with_ui_ux_pro_max`) y reutilizar los tokens de `AvisoPosteriorAlCierre`
(`border-espera/20 bg-espera/5`, `text-dato`).

```tsx
// monitor-app/frontend/components/dashboard/AvisoDeActualizacion.tsx
import { AlertTriangle, RefreshCw } from 'lucide-react'

/** Cuánto puede tardar el ejecutor antes de que "Actualizando…" sea una mentira
 *  (corre cada minuto; spec 2026-10-10, §3.5). */
const ATRASO_MS = 5 * 60_000

export type Frescura = 'al_dia' | 'actualizando' | 'atrasado'

export function estadoDeFrescura(pendienteDesde: string | null, ahora: Date): Frescura {
  if (!pendienteDesde) return 'al_dia'
  return ahora.getTime() - new Date(pendienteDesde).getTime() > ATRASO_MS ? 'atrasado' : 'actualizando'
}

const HORA = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })

type Props = { pendienteDesde: string | null; ahora?: Date }

/** El Cierre se calcula en segundo plano: este aviso dice si lo que se ve tiene
 *  cambios por entrar. Una sola pieza con la variante como dato, no dos avisos. */
export function AvisoDeActualizacion({ pendienteDesde, ahora = new Date() }: Props) {
  const estado = estadoDeFrescura(pendienteDesde, ahora)
  if (estado === 'al_dia') return null

  if (estado === 'actualizando') {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-espera/20 bg-espera/5 px-4 py-3">
        <RefreshCw size={14} className="text-espera shrink-0 motion-safe:animate-spin" />
        <p className="text-dato text-text-primary">Actualizando con los últimos cambios…</p>
      </div>
    )
  }
  return (
    <div role="alert" className="flex items-center gap-2 rounded-xl border border-status-incidente/20 bg-status-incidente/5 px-4 py-3">
      <AlertTriangle size={14} className="text-status-incidente shrink-0" />
      <p className="text-dato text-text-primary">
        No se pudo actualizar desde {HORA.format(new Date(pendienteDesde!))}. Lo que ves puede no incluir los últimos cambios.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Types and page**

En `lib/types.ts`, sumar a `DailyClosureStatus`, `EquipmentClosureStatus` y `StatusReport`:

```ts
  /** Spec 2026-10-10: cuándo se calcularon las líneas del día, y desde cuándo hay
   *  cambios esperando al ejecutor (null = al día). */
  calculado_a?:     string | null
  pendiente_desde?: string | null
```

y borrar `pre_cierre` de `EquipmentClosureStatus` si figura.

En `app/dashboard/operations/closures/page.tsx`:
- En `cierreQuery`, agregar
  `refetchInterval: q => (q.state.data?.pendiente_desde ? 15_000 : false),`
- Debajo de `<AvisoPosteriorAlCierre … />`:
  `<AvisoDeActualizacion pendienteDesde={cierreQuery.data?.pendiente_desde ?? null} />`
- Cuando `pendiente_desde` pasa de un valor a `null`, refrescar las otras dos consultas del mismo día:

```tsx
  const pendiente = cierreQuery.data?.pendiente_desde ?? null
  const pendienteAnterior = useRef<string | null>(null)
  useEffect(() => {
    if (pendienteAnterior.current && !pendiente) {
      queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
      queryClient.invalidateQueries({ queryKey: ['status-report', fecha] })
    }
    pendienteAnterior.current = pendiente
  }, [pendiente, fecha, queryClient])
```

(Importar `useRef` si falta y `AvisoDeActualizacion` desde `@/components/dashboard/AvisoDeActualizacion`.)

- [ ] **Step 4: Run frontend tests, types and build**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard app/dashboard/operations/closures && npx tsc --noEmit && npx next build`
Expected: PASS y build limpio.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/AvisoDeActualizacion.tsx monitor-app/frontend/components/dashboard/AvisoDeActualizacion.test.tsx monitor-app/frontend/lib/types.ts monitor-app/frontend/app/dashboard/operations/closures/page.tsx
git commit -m "feat(cierre): la pantalla avisa cuando hay cambios por entrar"
```

---

### Task 9: Despliegue en dev, verificación y contract

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261011120000_retira_tablas_viejas_del_cierre.sql`
- Modify: `monitor-app/backend/api/app/schemas/daily_closures.py`, `app/schemas/equipment_closures.py` (docstrings que nombran las tablas)
- Modify: `AGENTLOG.md`

- [ ] **Step 1: Infra de Cloud Scheduler (comandos; confirmar con el usuario antes de activar APIs y crear la cuenta)**

```bash
P=webcarga-dev-493220
gcloud services enable cloudscheduler.googleapis.com --project $P
gcloud iam service-accounts create cierre-scheduler --project $P --display-name "Cloud Scheduler: recálculo del Cierre"
URL=$(gcloud run services describe webcarga-monitor-api-dev --region us-central1 --project $P --format='value(status.url)')
gcloud scheduler jobs create http cierre-recalculo-dev --project $P --location us-central1 \
  --schedule "* * * * *" --time-zone "America/Santiago" \
  --http-method POST --uri "$URL/api/v1/internal/closures/recompute" \
  --oidc-service-account-email "cierre-scheduler@$P.iam.gserviceaccount.com" \
  --oidc-token-audience "$URL/api/v1/internal/closures/recompute" \
  --attempt-deadline 60s
```

Hasta el deploy, el job da 404 sin efecto.

- [ ] **Step 2: Deploy (push a `dev`), sin jobs en vuelo**

Confirmar con `mcp__mage-agent__run_logs` que no hay corrida de Mage en curso. `git push origin dev`. Esperar
**Deploy Monitor API** y **Deploy Frontend** en verde (`gh run watch`).

- [ ] **Step 3: Verify against the success criteria (measured)**

1. `gcloud scheduler jobs describe cierre-recalculo-dev …` → último intento `200`.
2. `psql`: `SELECT count(*) FROM app.closure_recompute_queue;` baja a 0 (o a hoy recién marcado) en menos de 2 min
   después de una corrida de dbt.
3. Playwright en dev: abrir el Cierre de hoy; medir con `performance.getEntriesByType('resource')` los tiempos de
   `daily-closures` y `equipment-closures` (objetivo < 500 ms en caliente). Captura.
4. Al día siguiente: medianas en logs de Cloud Run (mismo script del 10/10) para `daily-closures` y
   `equipment-closures` < 0,5 s, y sin 504 del Monitor mientras se usa el Cierre.

- [ ] **Step 4: Contract (un día después de verificar)**

```sql
-- monitor-app/backend/supabase/migrations/20261011120000_retira_tablas_viejas_del_cierre.sql
--
-- Ola 5 del modelo de cierre (spec 2026-09-14) y contract de la spec 2026-10-10.
-- Las cuatro tablas eran una proyección de app.closure_lines sin lectores:
-- verificado el 10/10 en la API, en vistas y funciones de la base, en dbt y en
-- el frontend. Desde 20261010 ya nadie las escribe. Es dato derivado: no se respalda.
BEGIN;
DROP TABLE IF EXISTS app.driver_day_status;
DROP TABLE IF EXISTS app.equipment_day_status;
DROP TABLE IF EXISTS app.daily_closures;
DROP TABLE IF EXISTS app.equipment_closures;
COMMIT;
```

Antes: repetir con `psql` la búsqueda de lectores (vistas, funciones, `pg_stat_user_tables.seq_scan/idx_scan` que
no crecen desde el deploy) y `grep -rn "driver_day_status\|equipment_day_status\|app.daily_closures\|app.equipment_closures" monitor-app .mage-agent/local_sync`
(solo deben quedar comentarios históricos). Ensayar con `ROLLBACK`, aplicar con el MCP. Actualizar los docstrings
de `app/schemas/daily_closures.py` y `equipment_closures.py` para que hablen de las líneas del cierre y no de las
tablas retiradas.

- [ ] **Step 5: AGENTLOG and commit**

Actualizar `AGENTLOG.md` (qué se hizo, mediciones antes/después, siguiente paso: la minuta del 09/10) y commit:

```bash
git add monitor-app/backend/supabase/migrations/20261011120000_retira_tablas_viejas_del_cierre.sql monitor-app/backend/api/app/schemas/ AGENTLOG.md
git commit -m "chore(db): retira las tablas viejas del cierre (contract)"
```
