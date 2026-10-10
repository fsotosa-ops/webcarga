# Cierre: anulación con motivo y firma versionada — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un día firmado nunca cambia. Los viajes manuales se anulan con motivo, en vez de borrarse. Cada firma queda como copia inmutable y versionada. Lo que cambia después de firmar se muestra como lista de ajustes.

**Architecture:**
- **Anulación:** tres columnas en `app.trips_manual` y `app.trips`, con el mismo patrón que `unassigned_reason_id`: las escribe la API, la rama manual de dbt las lleva y están en `merge_exclude_columns`.
- **Filtro de anulados:** va solo en las definiciones únicas, que son `trips_del_dia`, `SQL_VIAJES_DEL_DIA`, `SQL_BASE` y el listado del Monitor.
- **Firma:** son tres tablas de solo inserción, protegidas por un trigger. Las escribe `cerrar`, en su transacción atómica.
- **Ajustes posteriores:** son la diferencia entre los viajes firmados y los viajes del día de hoy.

**Tech Stack:** FastAPI + asyncpg (`monitor-app/backend/api`, `venv/bin/python -m pytest`), Postgres en Supabase (proyecto `viclzoftiudkepqnhekv`, migraciones vía MCP), dbt en Mage (espejo `.mage-agent/local_sync/dbt/tms`, sync con el MCP mage-agent), Next.js + vitest (`monitor-app/frontend`).

**Spec:** `docs/superpowers/specs/2026-10-10-cierre-anulacion-y-firma-versionada-design.md` (incluye el ajuste del 10/10: los viajes del día son `planning_date = D`).

## Global Constraints

- Objetos de base en inglés, con verbo + objeto (`trg_reject_signature_changes`, `app.reject_signature_changes()`). Los archivos de migración y el código Python van en español, como el resto del repo.
- Rutas en inglés y etiquetas en español ("Anular", "Anulado"). Español neutral, nunca voseo. Sin emojis; los íconos son de `lucide-react`.
- Un día `CLOSED` nunca se recalcula ni se reabre para corregir: los cambios son ajustes posteriores.
- Las tablas de firma son solo de inserción: un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`.
- Solo se anulan viajes con `source_system = 'manual'`; el motivo es obligatorio (422 si está vacío).
- Día del viaje = `planning_date`.
  - Si está abierto, anula quien lo creó (`trips.void`) o quien tiene `trips.void_any`.
  - Si está firmado, solo `closures.sign`.
- La migración de anulación y el cambio de Mage van en la misma ventana entre corridas de dbt.
  - **Por qué:** el modelo `trips` tiene `on_schema_change='sync_all_columns'`, que borra de `app.trips` las columnas que el modelo no conoce.
  - **Riesgo:** `app.trips_del_dia` es SQL sin dependencias registradas. Si se borra la columna, el Cierre queda roto en tiempo de ejecución.
- Tests de integración: transacción revertida con `conexion_revertida` contra la base real. Cada test crea sus datos en días que Operaciones nunca firma (2099). Antes de dar por bueno un test, se rompe el código y se confirma que falla (mutación).
- No ejecutar el contract (retirar las columnas de firma de `closure_periods` y las 4 tablas viejas): queda fuera de este plan.

## Review Focus

1. **Revertir en un día firmado.** Revertir una anulación cuyo `planning_date` está firmado exige `closures.sign`, igual que anular. El viaje aparece en ajustes como "agregado" si no estaba en la firma, o deja de aparecer como "quitado" si estaba. Lo prueba la Task 4, `test_revertir_en_dia_firmado_exige_firmar_y_vuelve_a_la_firma`.
2. **Un lote mezclado.** Un lote con un viaje de día abierto propio y otro de día firmado, enviado por un operador sin `closures.sign`, no anula ninguno y lista el motivo de cada viaje. Lo prueba la Task 4, `test_lote_mezclado_no_anula_ninguno`.
3. **Firmar dos veces sin reabrir.** El segundo `cerrar` responde 409 y no crea una versión 2. Lo prueba la Task 5, `test_firmar_dos_veces_no_crea_otra_version`.
4. **Una corrida de dbt después de anular.** El merge no vuelve a poner `voided_at` en NULL en `app.trips`, porque está en `merge_exclude_columns`. Lo pruebas en la Task 1, con la guarda sobre el modelo, y en la Task 9, con la verificación en vivo después de una corrida.
5. **Un día reabierto.** Un día reabierto no muestra ajustes, porque no está firmado. Su historial sigue mostrando la versión anterior. Lo prueba la Task 6, `test_dia_reabierto_no_tiene_ajustes`.

---

### Task 1: Columnas de anulación en la base y en dbt, y `trips_del_dia` sin anulados

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261010230000_anulacion_de_viajes.sql`
- Modify: `.mage-agent/local_sync/dbt/tms/models/app/trips.sql` (config `merge_exclude_columns`, rama TMS ~l. 527, rama manual ~l. 766)
- Test: `monitor-app/backend/api/tests/test_anulacion_en_la_base_integracion.py`, `monitor-app/backend/api/tests/test_dbt_anulacion.py`

**Interfaces:**
- Produces:
  - columnas `voided_at timestamptz`, `voided_by uuid` y `void_reason text` en `app.trips_manual` y `app.trips`, con el CHECK `ck_*_void_complete`;
  - `app.trips_del_dia(date)` excluye `voided_at IS NOT NULL`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_dbt_anulacion.py`:

```python
"""Las columnas de anulación en el modelo dbt de app.trips (spec 2026-10-10 anulación, §2.1).

Mismo patrón que unassigned_reason_id: la API las escribe en app.trips y en
app.trips_manual; la rama manual del modelo las lleva desde trips_manual y el
merge no las toca. Sin esto, `sync_all_columns` las borra de app.trips en la
corrida siguiente. Ningún pipeline corre `dbt test`, así que la guarda va acá,
sobre el espejo de Mage (no está en git: sin espejo, se salta)."""
from __future__ import annotations

from pathlib import Path

import pytest

MODELO = Path(__file__).resolve().parents[4] / ".mage-agent/local_sync/dbt/tms/models/app/trips.sql"
COLUMNAS = ("voided_at", "voided_by", "void_reason")


def _texto() -> str:
    if not MODELO.exists():
        pytest.skip("espejo de Mage no sincronizado en esta máquina")
    return MODELO.read_text()


def test_las_columnas_de_anulacion_estan_en_merge_exclude_columns():
    config = _texto().split("schema='app'")[0]
    for col in COLUMNAS:
        assert f"'{col}'" in config, col


def test_la_rama_manual_las_lleva_desde_trips_manual():
    texto = _texto()
    for col in COLUMNAS:
        assert f"m.{col}" in texto, col
```

`tests/test_anulacion_en_la_base_integracion.py`:

```python
"""La anulación en la base: columnas, su CHECK y trips_del_dia (spec 2026-10-10 anulación, §2)."""
from __future__ import annotations

import uuid
from datetime import date

import asyncpg
import pytest

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 3)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=DIA.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


async def test_trips_del_dia_excluye_los_anulados(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    del_dia = "SELECT $2::uuid IN (SELECT trip_id FROM app.trips_del_dia($1))"
    assert await conn.fetchval(del_dia, DIA, tid) is True

    await conn.execute(
        "UPDATE app.trips SET voided_at = now(), voided_by = $2::uuid, void_reason = 'Duplicado' WHERE id = $1::uuid",
        tid, usuario["sub"])

    assert await conn.fetchval(del_dia, DIA, tid) is False


@pytest.mark.parametrize("tabla", ["app.trips", "app.trips_manual"])
async def test_la_anulacion_va_completa_o_no_va(conexion_revertida, tabla):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await conn.execute(f"UPDATE {tabla} SET voided_at = now() WHERE id = $1::uuid", tid)
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_dbt_anulacion.py tests/test_anulacion_en_la_base_integracion.py -v`
Expected:
- `test_dbt_anulacion.py`: FAIL (`'voided_at'` no está en la config).
- Integración: FAIL con `UndefinedColumnError: column "voided_at" ... does not exist`.

- [ ] **Step 3: Escribir la migración**

`monitor-app/backend/supabase/migrations/20261010230000_anulacion_de_viajes.sql`:

```sql
-- Anulación con motivo de viajes manuales (spec 2026-10-10 anulación y firma versionada, §2).
--
-- Reemplaza el borrado físico: el viaje queda, con quién, cuándo y por qué se anuló.
-- Mismo patrón que unassigned_reason_id: la API escribe app.trips_manual y app.trips en
-- la misma transacción; la rama manual del modelo dbt `trips` las lleva desde
-- trips_manual y están en merge_exclude_columns. El modelo se actualiza en Mage en la
-- MISMA ventana entre corridas: con on_schema_change='sync_all_columns', una corrida
-- con el modelo viejo borra estas columnas de app.trips, y trips_del_dia (SQL sin
-- dependencias registradas) fallaría en tiempo de ejecución.

BEGIN;

ALTER TABLE app.trips_manual
    ADD COLUMN voided_at timestamptz,
    ADD COLUMN voided_by uuid,
    ADD COLUMN void_reason text,
    ADD CONSTRAINT ck_trips_manual_void_complete CHECK (
        (voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));

ALTER TABLE app.trips
    ADD COLUMN voided_at timestamptz,
    ADD COLUMN voided_by uuid,
    ADD COLUMN void_reason text,
    ADD CONSTRAINT ck_trips_void_complete CHECK (
        (voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));

COMMENT ON COLUMN app.trips.voided_at IS
    'Cuándo se anuló el viaje (solo manuales). NULL = vigente. Lo escribe la API; dbt no lo toca (merge_exclude_columns).';

-- Los viajes que ocupan el día D, sin los anulados. Mismo cuerpo que el vigente
-- (20260916233000 y sucesivas) más `t.voided_at IS NULL`.
CREATE OR REPLACE FUNCTION app.trips_del_dia(p_fecha date)
 RETURNS TABLE(trip_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT t.id
    FROM app.trips t
    LEFT JOIN app.trip_statuses s ON s.id = t.trip_status
    LEFT JOIN app.trip_stops st ON st.trip_id = t.id
    LEFT JOIN LATERAL (VALUES
        (st.arrival_date), (st.departure_date),
        (st.gps_arrival_date), (st.gps_departure_date),
        (st.unload_start), (st.unload_end),
        (st.desc_inicio_manual), (st.desc_fin_manual),
        (st.arrival_date_manual), (st.departure_date_manual),
        (st.gps_arrival_date_manual), (st.gps_departure_date_manual)
    ) AS m(ts) ON true
    WHERE t.planning_date BETWEEN p_fecha - 45 AND p_fecha
      AND t.unassigned_reason_id IS NULL
      AND t.voided_at IS NULL
      AND COALESCE(s.counts_as_load, true)
    GROUP BY t.id, t.planning_date, t.is_active, t.status_reported_at
    HAVING GREATEST(
        t.planning_date,
        (max(m.ts) AT TIME ZONE 'America/Santiago')::date,
        CASE WHEN t.is_active THEN t.status_reported_at::date END
    ) >= p_fecha
$function$;

COMMIT;
```

Antes de aplicarla, compara el cuerpo con el vigente, que debe ser idéntico salvo la línea nueva:

```sql
SELECT pg_get_functiondef('app.trips_del_dia(date)'::regprocedure);
```

Si difiere en algo más, copia el cuerpo vigente y agrégale solo `AND t.voided_at IS NULL`.

- [ ] **Step 4: Cambiar el modelo dbt**

En `.mage-agent/local_sync/dbt/tms/models/app/trips.sql`:

1. En `merge_exclude_columns`, reemplaza `'unassigned_reason_id'` por:

```
            'unassigned_reason_id',
            'voided_at', 'voided_by', 'void_reason'
```

2. En la rama TMS, después de `NULL::uuid          AS unassigned_reason_id,`, agrega:

```sql
    -- Anulación (spec 2026-10-10): solo viajes manuales; la escribe la API.
    NULL::timestamptz   AS voided_at,
    NULL::uuid          AS voided_by,
    NULL::text          AS void_reason,
```

3. En la rama manual, después de `m.unassigned_reason_id                              AS unassigned_reason_id,`, agrega:

```sql
    m.voided_at                                         AS voided_at,
    m.voided_by                                         AS voided_by,
    m.void_reason                                       AS void_reason,
```

Las dos ramas del `UNION ALL` deben tener las columnas en el mismo orden. Confírmalo leyendo las dos listas completas.

- [ ] **Step 5: Ensayar la migración con ROLLBACK y aplicarla en la ventana**

1. Consulta el horario de corridas del pipeline que corre el modelo `trips`, con `mcp__mage-agent__pipeline_list` / `pipeline_get` y `mcp__mage-agent__run_logs`. No sigas si hay una corrida en vuelo.
2. Ensaya con `mcp__claude_ai_Supabase__execute_sql`: el contenido de la migración, cambiando `COMMIT` por `ROLLBACK`.
   Expected: sin error.
3. Aplica con `mcp__claude_ai_Supabase__apply_migration` (name `anulacion_de_viajes`).
4. Inmediatamente después, sube el modelo con `mcp__mage-agent__sync_local_to_remote`, siguiendo la skill `skill://sync`.
5. Espera la corrida siguiente y verifica que salió bien y que las columnas siguen ahí:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = 'trips' AND column_name IN ('voided_at','voided_by','void_reason');
```

Expected: 3 filas.

- [ ] **Step 6: Correr los tests y verificar que pasan; mutación**

Run: `venv/bin/python -m pytest tests/test_dbt_anulacion.py tests/test_anulacion_en_la_base_integracion.py -v`
Expected: PASS (4 tests).

Mutación: quita `'void_reason'` de `merge_exclude_columns` en el espejo y vuelve a correr `test_dbt_anulacion.py`. Expected: FAIL. Restáuralo.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261010230000_anulacion_de_viajes.sql \
        monitor-app/backend/api/tests/test_dbt_anulacion.py \
        monitor-app/backend/api/tests/test_anulacion_en_la_base_integracion.py
git commit -m "feat(db): columnas de anulación de viajes y trips_del_dia sin anulados"
```

(El espejo de Mage no está en git; se versiona en Mage.)

---

### Task 2: Tablas de firma inmutables y carga de la versión 1

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261010233000_firma_versionada_del_cierre.sql`
- Test: `monitor-app/backend/api/tests/test_firma_inmutable_integracion.py`

**Interfaces:**
- Produces:
  - `app.closure_signatures (id bigint identity, business_date date, version int, signed_by uuid, signed_at timestamptz, override_count int, override_note text, totals jsonb, captured_from text)`, con `UNIQUE (business_date, version)`;
  - `app.closure_signature_lines (signature_id bigint, subject_type, subject_id, status, requires_reason, reason_id, valid_until, comentario, resolved_by, resolved_at, computed_at, home_location_id, reason_from_driver_id)`. Las columnas copian las de `closure_lines` con el mismo nombre, porque es una copia;
  - `app.closure_signature_trips (signature_id bigint, trip_id uuid)`;
  - la función `app.reject_signature_changes()`.

- [ ] **Step 1: Escribir el test que falla**

`tests/test_firma_inmutable_integracion.py`:

```python
"""La firma del Cierre es inmutable y cada día firmado tiene su versión 1 (spec §3)."""
from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.integracion

TABLAS = ("app.closure_signatures", "app.closure_signature_lines", "app.closure_signature_trips")


async def _una_firma(conn) -> int:
    return await conn.fetchval("SELECT id FROM app.closure_signatures ORDER BY id LIMIT 1")


@pytest.mark.parametrize("tabla", TABLAS)
async def test_la_firma_no_se_modifica(conexion_revertida, tabla):
    conn = conexion_revertida
    firma = await _una_firma(conn)
    col = "id" if tabla == "app.closure_signatures" else "signature_id"
    with pytest.raises(asyncpg.RaiseError, match="inmutable"):
        async with conn.transaction():
            await conn.execute(f"UPDATE {tabla} SET {col} = {col} WHERE {col} = $1", firma)


@pytest.mark.parametrize("tabla", TABLAS)
async def test_la_firma_no_se_borra(conexion_revertida, tabla):
    conn = conexion_revertida
    firma = await _una_firma(conn)
    col = "id" if tabla == "app.closure_signatures" else "signature_id"
    with pytest.raises(asyncpg.RaiseError, match="inmutable"):
        async with conn.transaction():
            await conn.execute(f"DELETE FROM {tabla} WHERE {col} = $1", firma)


async def test_cada_dia_firmado_tiene_su_version_1_con_sus_lineas(conexion_revertida):
    conn = conexion_revertida
    faltan = await conn.fetch(
        """
        SELECT p.business_date
        FROM app.closure_periods p
        LEFT JOIN app.closure_signatures s ON s.business_date = p.business_date AND s.version = 1
        WHERE p.status = 'CLOSED'
          AND (s.id IS NULL
               OR (SELECT count(*) FROM app.closure_signature_lines l WHERE l.signature_id = s.id)
                  <> (SELECT count(*) FROM app.closure_lines c WHERE c.business_date = p.business_date)
               OR (SELECT count(*) FROM app.closure_signature_trips v WHERE v.signature_id = s.id)
                  <> (s.totals->>'viajes')::int)
        """)
    assert faltan == []
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `venv/bin/python -m pytest tests/test_firma_inmutable_integracion.py -v`
Expected: FAIL con `UndefinedTableError: relation "app.closure_signatures" does not exist`.

- [ ] **Step 3: Escribir la migración**

`monitor-app/backend/supabase/migrations/20261010233000_firma_versionada_del_cierre.sql`:

```sql
-- Firma versionada e inmutable del Cierre (spec 2026-10-10 anulación y firma versionada, §3).
--
-- Cada firma guarda su copia: quién y cuándo (closure_signatures), las líneas tal como se
-- firmaron (closure_signature_lines, mismas columnas que closure_lines) y los viajes del
-- día al firmar (closure_signature_trips: app.trips con planning_date = D y sin anular, el
-- universo de totals.viajes). Reabrir no las toca; volver a firmar crea la versión N+1.
-- Solo inserciones: el trigger rechaza UPDATE, DELETE y TRUNCATE (estándar de tablas de
-- auditoría, verificado en la base y no en el código).
--
-- Carga inicial: cada día CLOSED recibe su versión 1 (captured_from = 'backfill'). Los
-- viajes se reconstruyen con created_at <= closed_at (created_at está en
-- merge_exclude_columns: es la primera vez que el viaje entró). Medido el 10/10: los 25
-- días coinciden con frozen_totals.viajes. Si alguno no coincide, la migración aborta.

BEGIN;

CREATE TABLE app.closure_signatures (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_date  date        NOT NULL,
    version        int         NOT NULL CHECK (version >= 1),
    signed_by      uuid        NOT NULL,
    signed_at      timestamptz NOT NULL,
    override_count int         NOT NULL DEFAULT 0,
    override_note  text,
    totals         jsonb       NOT NULL,
    captured_from  text        NOT NULL CHECK (captured_from IN ('signing', 'backfill')),
    UNIQUE (business_date, version)
);

CREATE TABLE app.closure_signature_lines (
    signature_id          bigint      NOT NULL REFERENCES app.closure_signatures (id),
    subject_type          text        NOT NULL,
    subject_id            uuid        NOT NULL,
    status                text        NOT NULL,
    requires_reason       boolean     NOT NULL,
    reason_id             uuid,
    valid_until           date,
    comentario            text,
    resolved_by           uuid,
    resolved_at           timestamptz,
    computed_at           timestamptz NOT NULL,
    home_location_id      uuid,
    reason_from_driver_id uuid,
    PRIMARY KEY (signature_id, subject_type, subject_id)
);

-- Sin FK a app.trips: el --full-refresh de dbt recrea esa tabla y borra las FK.
CREATE TABLE app.closure_signature_trips (
    signature_id bigint NOT NULL REFERENCES app.closure_signatures (id),
    trip_id      uuid   NOT NULL,
    PRIMARY KEY (signature_id, trip_id)
);

COMMENT ON TABLE app.closure_signatures IS
    'Una fila por firma del Cierre, versionada por día. Solo inserciones. La firma vigente '
    'de un día es la de mayor versión.';
COMMENT ON TABLE app.closure_signature_lines IS
    'Copia de app.closure_lines al firmar (mismas columnas). Solo inserciones.';
COMMENT ON TABLE app.closure_signature_trips IS
    'Viajes del día al firmar: app.trips con planning_date = D y sin anular. Solo inserciones.';

CREATE FUNCTION app.reject_signature_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'La firma del Cierre es inmutable: % en % no está permitido', TG_OP, TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE
    tabla text;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'app.closure_signatures', 'app.closure_signature_lines', 'app.closure_signature_trips'
    ] LOOP
        EXECUTE format('CREATE TRIGGER trg_reject_signature_changes BEFORE UPDATE OR DELETE ON %s '
                       'FOR EACH ROW EXECUTE FUNCTION app.reject_signature_changes()', tabla);
        EXECUTE format('CREATE TRIGGER trg_reject_signature_truncate BEFORE TRUNCATE ON %s '
                       'FOR EACH STATEMENT EXECUTE FUNCTION app.reject_signature_changes()', tabla);
        -- Acceso solo por la API (memoria "acceso solo por invitación"): sin grants públicos.
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tabla);
        EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated', tabla);
    END LOOP;
END $$;

-- Carga inicial: versión 1 de cada día firmado.
INSERT INTO app.closure_signatures
    (business_date, version, signed_by, signed_at, override_count, override_note, totals, captured_from)
SELECT p.business_date, 1, p.closed_by, p.closed_at, COALESCE(p.override_count, 0), p.override_note,
       p.frozen_totals, 'backfill'
FROM app.closure_periods p
WHERE p.status = 'CLOSED';

INSERT INTO app.closure_signature_lines
    (signature_id, subject_type, subject_id, status, requires_reason, reason_id, valid_until, comentario,
     resolved_by, resolved_at, computed_at, home_location_id, reason_from_driver_id)
SELECT s.id, l.subject_type, l.subject_id, l.status, l.requires_reason, l.reason_id, l.valid_until, l.comentario,
       l.resolved_by, l.resolved_at, l.computed_at, l.home_location_id, l.reason_from_driver_id
FROM app.closure_signatures s
JOIN app.closure_lines l ON l.business_date = s.business_date;

INSERT INTO app.closure_signature_trips (signature_id, trip_id)
SELECT s.id, t.id
FROM app.closure_signatures s
JOIN app.trips t ON t.planning_date = s.business_date AND t.created_at <= s.signed_at;

DO $$
DECLARE
    distintos text;
BEGIN
    SELECT string_agg(s.business_date::text, ', ' ORDER BY s.business_date) INTO distintos
    FROM app.closure_signatures s
    WHERE (SELECT count(*) FROM app.closure_signature_trips v WHERE v.signature_id = s.id)
          <> (s.totals->>'viajes')::int
       OR (SELECT count(*) FROM app.closure_signature_lines l WHERE l.signature_id = s.id)
          <> (SELECT count(*) FROM app.closure_lines c WHERE c.business_date = s.business_date);
    IF distintos IS NOT NULL THEN
        RAISE EXCEPTION 'La versión 1 no coincide con lo firmado en: %', distintos;
    END IF;
END $$;

COMMIT;
```

- [ ] **Step 4: Ensayar con ROLLBACK y aplicar**

1. Ensaya con `mcp__claude_ai_Supabase__execute_sql`, cambiando `COMMIT` por `ROLLBACK`. Expected: sin error. Si aparece "La versión 1 no coincide", detente y reporta los días, sin forzar.
2. Aplica con `mcp__claude_ai_Supabase__apply_migration` (name `firma_versionada_del_cierre`). No depende de Mage.

- [ ] **Step 5: Correr el test y verificar que pasa; mutación**

Run: `venv/bin/python -m pytest tests/test_firma_inmutable_integracion.py -v`
Expected: PASS (7 tests).

Mutación, en una transacción revertida vía MCP:

```sql
BEGIN; DROP TRIGGER trg_reject_signature_changes ON app.closure_signatures; ... ROLLBACK;
```

No se puede correr pytest dentro de esa transacción. Por eso la mutación se verifica directo en SQL: dentro del mismo `BEGIN`, sin el trigger, el `DELETE` sobre `closure_signatures` debe pasar; con el trigger, debe fallar.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261010233000_firma_versionada_del_cierre.sql \
        monitor-app/backend/api/tests/test_firma_inmutable_integracion.py
git commit -m "feat(db): firma versionada e inmutable del Cierre, con la versión 1 de cada día firmado"
```

---

### Task 3: Permisos `trips.void` y `trips.void_any`

**Files:**
- Modify: `monitor-app/backend/api/app/authz/permissions.py:26-27,71-72,115,123-126`
- Modify: `monitor-app/backend/api/tests/test_authz_catalogo.py:59,94,98`
- Regenerate: `monitor-app/frontend/lib/authz/permisos.generated.ts`

**Interfaces:**
- Produces: `Permission.TRIPS_VOID = "trips.void"` y `Permission.TRIPS_VOID_ANY = "trips.void_any"`; `TRIPS_DELETE` y `TRIPS_DELETE_ANY` dejan de existir.

Ruling ya tomado: no hay migración de permisos. `sync_catalog` (`app/authz/sync.py`) reconstruye, al arrancar, el catálogo y los roles de sistema desde el código. En producción, solo los roles de sistema tienen `trips.delete*`: lo verificó una consulta del 10/10 sobre `admin`, `operations_operator` y `operations_supervisor`.

- [ ] **Step 1: Cambiar el test del catálogo para que falle**

En `tests/test_authz_catalogo.py`, reemplaza `Permission.TRIPS_DELETE_ANY` por `Permission.TRIPS_VOID_ANY` (l. 94 y 98) y `Permission.TRIPS_DELETE` por `Permission.TRIPS_VOID` (l. 59). Agrega al final:

```python
def test_eliminar_viajes_ya_no_es_un_permiso():
    """Eliminar pasó a anular con motivo (spec 2026-10-10): el borrado físico no existe."""
    assert not any(p.value.startswith("trips.delete") for p in Permission)
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `venv/bin/python -m pytest tests/test_authz_catalogo.py -v`
Expected: FAIL con `AttributeError: TRIPS_VOID`.

- [ ] **Step 3: Implementar**

En `app/authz/permissions.py`:

```python
    TRIPS_VOID = "trips.void"
    TRIPS_VOID_ANY = "trips.void_any"
```

Reemplaza las dos entradas de `TRIPS_DELETE*` en el enum. En `PERMISSION_META`:

```python
    P.TRIPS_VOID: PermissionMeta("operations", "Anular con motivo los viajes manuales que creó uno mismo, en días abiertos"),
    P.TRIPS_VOID_ANY: PermissionMeta("operations", "Anular con motivo viajes manuales creados por otra persona, en días abiertos"),
```

En `_OPS_OPERADOR`, `P.TRIPS_DELETE` pasa a ser `P.TRIPS_VOID`. En el rol `admin`, `P.TRIPS_DELETE_ANY` pasa a ser `P.TRIPS_VOID_ANY`, y el comentario de arriba dice `TRIPS_VOID_ANY` y `services/anular_viajes.py`.

Regenera el archivo del frontend:

Run: `venv/bin/python scripts/generar_permisos_ts.py`
Expected: `permisos.generated.ts` con `'trips.void'` y `'trips.void_any'`.

Este paso deja rotas las referencias a `Permission.TRIPS_DELETE` en `app/routers/trips.py` y a `"trips.delete_any"` en `app/services/eliminar_viajes.py`. La Task 4 las reemplaza, y por eso las dos tasks se comitean juntas: no hagas commit aquí.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `venv/bin/python -m pytest tests/test_authz_catalogo.py -v`
Expected: PASS.

---

### Task 4: Servicio `anular_viajes` y endpoints; se retira el borrado físico

**Files:**
- Create: `monitor-app/backend/api/app/services/anular_viajes.py`
- Delete: `monitor-app/backend/api/app/services/eliminar_viajes.py`, `monitor-app/backend/api/tests/test_eliminar_viajes_integracion.py`
- Modify: `monitor-app/backend/api/app/routers/trips.py`:
  - imports, l. 21-22;
  - `_TRIP_FROM`, l. 664-668;
  - `_TRIP_SELECT`, l. 608;
  - filtros de `list_trips`, l. 789;
  - `anotar_eliminable`, l. 941 y 2373;
  - `_eliminar`, `bulk_delete_trips` y `delete_trip`, l. 2377-2407.
- Modify: `monitor-app/backend/api/app/schemas/trip.py:59-62` (`TripBulkDeleteBody` → `TripVoidBody`, `TripVoidRevertBody`)
- Test: `monitor-app/backend/api/tests/test_anular_viajes_integracion.py`

**Interfaces:**
- Consumes: columnas de la Task 1; `Permission.TRIPS_VOID` de la Task 3.
- Produces:
  - `anular_viajes(conn, trip_ids: list[str], reason: str, user: dict) -> int`
  - `revertir_anulacion(conn, trip_ids: list[str], user: dict) -> int`
  - `anotar_anulable(d: dict, user: dict) -> None`, que deja en cada viaje: `can_void: bool`, `void_blocked_reason: str | None`, `can_revert_void: bool`, `voided_at`, `voided_by_name` y `void_reason`.
  - Constantes `SQL_COLUMNAS_ANULABLE` y `SQL_JOIN_ANULABLE`.
  - Endpoints:
    - `POST /api/v1/trips/void`, con body `{trip_ids: UUID[], reason: str}`; responde `{"ok": true, "voided": n}`;
    - `POST /api/v1/trips/void/revert`, con body `{trip_ids: UUID[]}`; responde `{"ok": true, "reverted": n}`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_anular_viajes_integracion.py`:

```python
"""Anular viajes manuales con motivo (spec 2026-10-10 anulación y firma versionada, §2).

Reemplaza a test_eliminar_viajes_integracion.py: el viaje no se borra, queda con
quién, cuándo y por qué. Quién anula depende del día del viaje (planning_date):
abierto, el creador o trips.void_any; firmado, closures.sign. Todo corre en la
transacción revertida de `conexion_revertida`; cada test crea su viaje con el
endpoint real en un día que Operaciones nunca firma."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip, get_trip, list_trips
from app.services.anular_viajes import anular_viajes, revertir_anulacion
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 1)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=DIA.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


def _otro(*roles: str) -> dict:
    return con_roles({"sub": str(uuid.uuid4()), "email": "otro@webcarga.cl"}, *roles)


async def _firmar_dia(conn, usuario) -> None:
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status) VALUES ($1, 'CLOSED') "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED'", DIA)


async def _anulado(conn, tid: str):
    return await conn.fetchrow(
        "SELECT t.voided_at, t.voided_by::text, t.void_reason, m.voided_at AS m_voided_at, m.void_reason AS m_reason "
        "FROM app.trips t JOIN app.trips_manual m ON m.id = t.id WHERE t.id = $1::uuid", tid)


async def test_quien_lo_creo_lo_anula_con_motivo_y_queda_auditado(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    assert (await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario))["can_void"] is True

    assert await anular_viajes(conn, [tid], "Duplicado", usuario) == 1

    fila = await _anulado(conn, tid)
    assert fila["voided_at"] is not None and fila["m_voided_at"] is not None
    assert (fila["voided_by"], fila["void_reason"], fila["m_reason"]) == (usuario["sub"], "Duplicado", "Duplicado")
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='void'",
        tid) == 1
    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert (detalle["void_reason"], detalle["can_void"], detalle["can_revert_void"]) == ("Duplicado", False, True)


async def test_el_monitor_no_lista_los_anulados(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], "Duplicado", usuario)

    respuesta = await list_trips(
        search="", page=1, limit=500, date_from=DIA.isoformat(), date_to=DIA.isoformat(),
        pool=PoolDeUnaConexion(conn), user=usuario)
    assert tid not in {str(d["id"]) for d in respuesta["data"]}


async def test_sin_motivo_no_se_anula(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "   ", usuario)
    assert err.value.status_code == 422
    assert (await _anulado(conn, tid))["voided_at"] is None


async def test_otro_operador_no_puede_y_void_any_si(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "Duplicado", _otro("operations_operator"))
    assert err.value.status_code == 403

    admin = {**_otro(*ADMIN_EQUIVALENTE), "sub": str((await conn.fetchrow("SELECT id FROM public.profiles LIMIT 1"))["id"])}
    assert await anular_viajes(conn, [tid], "Duplicado", admin) == 1


async def test_un_viaje_del_tms_no_se_anula(conexion_revertida):
    conn = conexion_revertida
    tms = str(await conn.fetchval("SELECT id FROM app.trips WHERE source_system <> 'manual' LIMIT 1"))
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tms], "Duplicado", _otro("owner"))
    assert err.value.status_code == 409


async def test_en_dia_firmado_lo_anula_solo_quien_firma(conexion_revertida):
    """Sin reabrir: el día sigue firmado y la anulación es un ajuste posterior."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await _firmar_dia(conn, usuario)
    sin_firma = con_roles({**usuario}, "operations_supervisor")
    sin_firma["permissions"] = [p for p in sin_firma["permissions"] if p != "closures.sign"]

    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "Duplicado", sin_firma)
    assert err.value.status_code == 403
    assert "firmado" in str(err.value.detail)

    assert await anular_viajes(conn, [tid], "Duplicado", con_roles({**usuario}, "operations_operator")) == 1
    assert await conn.fetchval("SELECT status FROM app.closure_periods WHERE business_date = $1", DIA) == "CLOSED"


async def test_revertir_en_dia_firmado_exige_firmar_y_vuelve_a_la_firma(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], "Duplicado", usuario)
    await _firmar_dia(conn, usuario)
    sin_firma = con_roles({**usuario}, "operations_supervisor")
    sin_firma["permissions"] = [p for p in sin_firma["permissions"] if p != "closures.sign"]

    with pytest.raises(HTTPException) as err:
        await revertir_anulacion(conn, [tid], sin_firma)
    assert err.value.status_code == 403

    assert await revertir_anulacion(conn, [tid], con_roles({**usuario}, "operations_operator")) == 1
    assert (await _anulado(conn, tid))["voided_at"] is None
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='void_revert'",
        tid) == 1


async def test_lote_mezclado_no_anula_ninguno(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    propio = await _viaje_manual(conn, usuario)
    inexistente = str(uuid.uuid4())
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [propio, inexistente], "Duplicado", usuario)
    assert err.value.status_code == 404
    assert [e["trip_id"] for e in err.value.detail["errors"]] == [inexistente]
    assert (await _anulado(conn, propio))["voided_at"] is None


async def test_anular_dos_veces_es_conflicto(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], "Duplicado", usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "Otra vez", usuario)
    assert err.value.status_code == 409
```

Antes de correrlo, lee `con_roles` en `tests/conftest.py`: los tests de día firmado le quitan `closures.sign` a un supervisor que es el creador. Si `con_roles` suma roles en vez de reemplazarlos, arma ese usuario con `usuario("operations_supervisor", sub=...)` para que tenga solo los permisos del supervisor. Confirma la firma real de `list_trips` (`app/routers/trips.py:753`) y ajusta solo los nombres de los parámetros de la llamada (`search`, `page`, `limit`, `date_from`, `date_to`), si difieren. El test pide los viajes de `DIA` y verifica que el anulado no esté.

- [ ] **Step 2: Correr y verificar que falla**

Run: `venv/bin/python -m pytest tests/test_anular_viajes_integracion.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.services.anular_viajes'`.

- [ ] **Step 3: Escribir el servicio**

`app/services/anular_viajes.py`:

```python
"""Anular viajes manuales con motivo: una regla, un lugar (spec 2026-10-10 anulación y firma versionada, §2).

Reemplaza al borrado físico (eliminar_viajes.py). El viaje queda, con quién, cuándo y
por qué se anuló; app.trips_del_dia y los viajes del día (SQL_VIAJES_DEL_DIA) lo
excluyen, así que el Cierre, el reporte y los disponibles dejan de contarlo.

Qué: sólo lo que la app creó (source_system = 'manual'). Un viaje del TMS vuelve en
la próxima ingesta: anularlo sería mentir.

Quién, según el día del viaje (planning_date):
  - abierto: quien lo creó (app.trips_manual.created_by) o trips.void_any;
  - firmado: closures.sign. El día NO se reabre: la firma es una copia inmutable
    (app.closure_signatures) y la anulación aparece como ajuste posterior al cierre.
Revertir pide lo mismo.

La regla que decide `can_void` en el listado es `_bloqueo`, la misma que aplica la
escritura: la UI nunca ofrece algo que el backend va a rechazar.

Escribe app.trips_manual y app.trips en la misma transacción: app.trips se reconstruye
desde trips_manual (rama manual del modelo dbt), y el merge no toca estas columnas
(merge_exclude_columns), igual que unassigned_reason_id.
"""
from __future__ import annotations

from fastapi import HTTPException

from .audit import log_change

MAXIMO_POR_LOTE = 200

# Columnas que el listado y el detalle agregan a cada viaje para decidir sin otra
# consulta. `dia_firmado` mira el día del viaje (planning_date), el mismo que firma
# sus viajes (closure_signature_trips).
SQL_COLUMNAS_ANULABLE = """
    tm.created_by::text AS manual_created_by,
    t.voided_at, t.void_reason,
    void_by.full_name AS voided_by_name,
    (void_cp.status IS NOT DISTINCT FROM 'CLOSED') AS dia_firmado
"""

SQL_JOIN_ANULABLE = """
    LEFT JOIN app.trips_manual tm ON tm.id = t.id
    LEFT JOIN public.profiles void_by ON void_by.id = t.voided_by
    LEFT JOIN app.closure_periods void_cp ON void_cp.business_date = t.planning_date
"""


def _bloqueo(fila: dict, user: dict, *, revertir: bool) -> tuple[int, str] | None:
    """(status HTTP, motivo en español) si `user` NO puede anular (o revertir) el viaje."""
    if fila.get("source_system") != "manual":
        return 409, "Sólo se pueden anular viajes creados manualmente en la app"
    if revertir and fila.get("voided_at") is None:
        return 409, "El viaje no está anulado"
    if not revertir and fila.get("voided_at") is not None:
        return 409, "El viaje ya está anulado"
    permisos = user.get("permissions", ())
    if fila.get("dia_firmado"):
        if "closures.sign" in permisos:
            return None
        dia = fila["planning_date"].strftime("%d/%m")
        return 403, f"El cierre del {dia} está firmado: lo anula quien puede firmar el cierre"
    if "trips.void_any" not in permisos and fila.get("manual_created_by") != user.get("sub"):
        return 403, "Sólo quien creó el viaje o Administración puede anularlo"
    return None


def anotar_anulable(d: dict, user: dict) -> None:
    """Deja en el viaje `can_void`, `void_blocked_reason` y `can_revert_void`, y quita
    las columnas de apoyo (no son parte del contrato)."""
    anulado = d.get("voided_at") is not None
    bloqueo = _bloqueo(d, user, revertir=anulado)
    d["can_void"] = not anulado and bloqueo is None
    d["void_blocked_reason"] = None if anulado or bloqueo is None else bloqueo[1]
    d["can_revert_void"] = anulado and bloqueo is None
    d.pop("manual_created_by", None)
    d.pop("dia_firmado", None)


async def _validar(conn, trip_ids: list[str], user: dict, *, revertir: bool) -> list[str]:
    ids = list(dict.fromkeys(trip_ids))
    if not ids:
        raise HTTPException(422, "Selecciona al menos un viaje")
    if len(ids) > MAXIMO_POR_LOTE:
        raise HTTPException(422, f"Máximo {MAXIMO_POR_LOTE} viajes por anulación")
    # FOR UPDATE: que nadie edite ni firme el día de estos viajes mientras se decide.
    filas = await conn.fetch(
        f"""
        SELECT t.id::text AS id, t.source_system, t.planning_date, {SQL_COLUMNAS_ANULABLE}
        FROM app.trips t
        {SQL_JOIN_ANULABLE}
        WHERE t.id = ANY($1::uuid[])
        FOR UPDATE OF t
        """,
        ids,
    )
    por_id = {f["id"]: dict(f) for f in filas}
    errores, estados = [], set()
    for tid in ids:
        fila = por_id.get(tid)
        bloqueo = (404, "Viaje no encontrado") if fila is None else _bloqueo(fila, user, revertir=revertir)
        if bloqueo:
            estados.add(bloqueo[0])
            errores.append({"trip_id": tid, "error": bloqueo[1]})
    if errores:
        accion = "revirtió" if revertir else "anuló"
        # Un solo tipo de rechazo conserva su status; una mezcla es conflicto.
        raise HTTPException(
            estados.pop() if len(estados) == 1 else 409,
            {"message": f"No se {accion} ningún viaje", "errors": errores},
        )
    return ids


async def anular_viajes(conn, trip_ids: list[str], reason: str, user: dict) -> int:
    """Anula los viajes, todo o nada. Debe correr dentro de una transacción."""
    motivo = (reason or "").strip()
    if not motivo:
        raise HTTPException(422, "Anular exige un motivo")
    ids = await _validar(conn, trip_ids, user, revertir=False)
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = now(), voided_by = $2::uuid, void_reason = $3 "
            "WHERE id = ANY($1::uuid[])",
            ids, user["sub"], motivo,
        )
    for tid in ids:
        await log_change(conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                         action="void", field="voided_at", new_value={"reason": motivo})
    return len(ids)


async def revertir_anulacion(conn, trip_ids: list[str], user: dict) -> int:
    """Devuelve los viajes al día, todo o nada. Debe correr dentro de una transacción."""
    ids = await _validar(conn, trip_ids, user, revertir=True)
    anteriores = {r["id"]: r["void_reason"] for r in await conn.fetch(
        "SELECT id::text, void_reason FROM app.trips WHERE id = ANY($1::uuid[])", ids)}
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = NULL, voided_by = NULL, void_reason = NULL "
            "WHERE id = ANY($1::uuid[])",
            ids,
        )
    for tid in ids:
        await log_change(conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                         action="void_revert", field="voided_at", old_value={"reason": anteriores.get(tid)})
    return len(ids)
```

- [ ] **Step 4: Conectar el router y los schemas; retirar el borrado**

En `app/schemas/trip.py`, reemplaza `TripBulkDeleteBody` por:

```python
class TripVoidBody(BaseModel):
    """Viajes manuales a anular, con el motivo. UUID, no str: un id mal formado es
    un 422 de validación, no un DataError de asyncpg convertido en 500."""
    trip_ids: list[UUID]
    reason: str


class TripVoidRevertBody(BaseModel):
    trip_ids: list[UUID]
```

En `app/routers/trips.py`:

1. El import de schemas pasa de `TripBulkDeleteBody` a `TripVoidBody, TripVoidRevertBody`. El de servicios pasa a:

```python
from ..services.anular_viajes import (
    SQL_COLUMNAS_ANULABLE, SQL_JOIN_ANULABLE, anotar_anulable, anular_viajes, revertir_anulacion,
)
```

2. En `_TRIP_FROM`, el comentario y el join quedan así:

```python
    FROM app.trips t
    -- Quién creó un viaje manual, quién lo anuló y si su día está firmado: deciden
    -- si se puede anular (ver services/anular_viajes.py). 1:1, no multiplican filas.
    """ + SQL_JOIN_ANULABLE + """
```

Antes, confirma que `_TRIP_SELECT` y `_TRIP_FROM` no usan ya los alias `tm`, `void_by` ni `void_cp`:

Run: `grep -n " tm\b\| tm\.\|void_by\|void_cp" app/routers/trips.py`

Expected: solo las apariciones que vienen de `SQL_JOIN_ANULABLE` y `SQL_COLUMNAS_ANULABLE`.

3. En l. 608, `SQL_COLUMNAS_ELIMINABLE` pasa a ser `SQL_COLUMNAS_ANULABLE`.
4. En `list_trips`, agrega como primer elemento de `filters`:

```python
        # Los anulados no se listan (spec 2026-10-10 anulación §2.2); el detalle sí los abre.
        "t.voided_at IS NULL",
```

5. En l. 941 y 2373, `anotar_eliminable(d, user)` pasa a ser `anotar_anulable(d, user)`.
6. Reemplaza `_eliminar`, `bulk_delete_trips` y `delete_trip` (l. 2377-2407) por:

```python
@router.post("/void")
async def void_trips(body: TripVoidBody, pool=Depends(get_pool), user=Depends(require(Permission.TRIPS_VOID))):
    """Anula viajes manuales con motivo, todo o nada. El permiso fino (creador,
    trips.void_any o closures.sign si su día está firmado) se decide por viaje en
    services/anular_viajes.py. Declarado antes de las rutas /{trip_id}."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            n = await anular_viajes(conn, [str(t) for t in body.trip_ids], body.reason, user)
    return {"ok": True, "voided": n}


@router.post("/void/revert")
async def revert_void_trips(
    body: TripVoidRevertBody, pool=Depends(get_pool), user=Depends(require(Permission.TRIPS_VOID)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            n = await revertir_anulacion(conn, [str(t) for t in body.trip_ids], user)
    return {"ok": True, "reverted": n}
```

Si `ATTACHMENT_BUCKET` o `get_supabase` quedan sin uso en el archivo, borra sus imports. Los adjuntos ya no se borran: el viaje queda.

7. Borra `app/services/eliminar_viajes.py` y `tests/test_eliminar_viajes_integracion.py`.
8. Busca lo que haya quedado colgado:

Run: `grep -rn "eliminar_viajes\|ELIMINABLE\|eliminable\|can_delete\|delete_blocked_reason\|TRIPS_DELETE\|trips.delete\|bulk-delete" app tests`
Expected: sin resultados. Si queda un test de la guarda de rutas que nombre `delete_trip` o `bulk_delete_trips`, actualízalo a `void_trips` y `revert_void_trips`.

- [ ] **Step 5: Correr y verificar que pasa; mutación**

Run: `venv/bin/python -m pytest tests/test_anular_viajes_integracion.py tests/test_authz_catalogo.py -v`
Expected: PASS.

Mutación: en `_bloqueo`, cambia `if fila.get("dia_firmado"):` por `if False:` y corre `test_en_dia_firmado_lo_anula_solo_quien_firma`. Expected: FAIL. Restáuralo.

Run (suite completa): `venv/bin/python -m pytest tests/ -q > /tmp/suite_t4.txt 2>&1; tail -5 /tmp/suite_t4.txt`
Expected: sin fallas.

- [ ] **Step 6: Commit (Tasks 3 y 4)**

```bash
git add -A monitor-app/backend/api/app monitor-app/backend/api/tests monitor-app/frontend/lib/authz/permisos.generated.ts
git commit -m "feat(viajes): anular con motivo reemplaza al borrado físico; permisos trips.void y trips.void_any"
```

---

### Task 5: La firma se escribe al cerrar y los lectores leen la firma

**Files:**
- Modify: `monitor-app/backend/api/app/services/cierre_viajes.py:27-33` (`SQL_TOTAL_TRIPS_DEL_DIA` → `SQL_VIAJES_DEL_DIA`) y el `WHERE` de `SQL_BASE` (l. 93)
- Modify: `monitor-app/backend/api/app/services/cierre_lineas.py`:
  - import, l. 31;
  - `periodo`, l. 308-327;
  - `cerrar`, l. 571-607;
  - funciones nuevas `ultima_firma` y `firmas_del_dia`.
- Modify: `monitor-app/backend/api/app/routers/trips.py:2586-2603` (bulk-reopen: `cp.closed_at` → firma)
- Modify: `monitor-app/backend/api/app/routers/closures.py` (`GET /closures/{fecha}/signatures`)
- Test: `monitor-app/backend/api/tests/test_firma_versionada_integracion.py`

**Interfaces:**
- Consumes: tablas de la Task 2; `anular_viajes` de la Task 4.
- Produces:
  - `SQL_VIAJES_DEL_DIA: str`: `SELECT t.id FROM app.trips t WHERE t.planning_date = $1 AND t.voided_at IS NULL`;
  - `ultima_firma(dia: str, alias: str) -> str`: fragmento `LEFT JOIN LATERAL`;
  - `firmas_del_dia(pool, fecha: date) -> list[dict]`, con las claves `version`, `signed_by_name`, `signed_at` (ISO), `override_count`, `totals` y `captured_from`;
  - `periodo(pool, fecha)` conserva sus claves (`closed_by`, `closed_at`, `override_count`, `frozen_totals`, `closed_by_name`), ahora leídas de la última firma;
  - `cerrar` devuelve además `"version": int`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_firma_versionada_integracion.py`:

```python
"""Firmar escribe una copia inmutable y versionada; reabrir no la toca (spec §3)."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services import cierre_lineas
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

D = date(2099, 1, 2)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=D.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


async def _firmas(conn):
    return await conn.fetch(
        "SELECT id, version, captured_from, totals FROM app.closure_signatures WHERE business_date = $1 ORDER BY version", D)


async def test_firmar_crea_la_version_1_con_lineas_y_viajes(conexion_revertida):
    conn = conexion_revertida
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)

    resultado = await cierre_lineas.cerrar(PoolDeUnaConexion(conn), D, override=True, override_note="prueba", user=admin)

    firmas = await _firmas(conn)
    assert [(f["version"], f["captured_from"]) for f in firmas] == [(1, "signing")]
    assert resultado["version"] == 1
    firma = firmas[0]["id"]
    assert await conn.fetchval("SELECT count(*) FROM app.closure_signature_lines WHERE signature_id = $1", firma) == \
        await conn.fetchval("SELECT count(*) FROM app.closure_lines WHERE business_date = $1", D)
    assert await conn.fetchval(
        "SELECT $2::uuid IN (SELECT trip_id FROM app.closure_signature_trips WHERE signature_id = $1)", firma, tid)


async def test_reabrir_y_volver_a_firmar_crea_la_version_2_y_la_1_sigue_igual(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    v1 = (await _firmas(conn))[0]
    lineas_v1 = await conn.fetch(
        "SELECT * FROM app.closure_signature_lines WHERE signature_id = $1 ORDER BY subject_type, subject_id", v1["id"])

    await cierre_lineas.reabrir(pool, D, nota="faltaba un viaje", user=admin)
    await _viaje_manual(conn, admin)
    await cierre_lineas.recalcular(pool, D)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    firmas = await _firmas(conn)
    assert [f["version"] for f in firmas] == [1, 2]
    assert await conn.fetch(
        "SELECT * FROM app.closure_signature_lines WHERE signature_id = $1 ORDER BY subject_type, subject_id",
        v1["id"]) == lineas_v1
    assert (await conn.fetchval(
        "SELECT count(*) FROM app.closure_signature_trips WHERE signature_id = $1", firmas[1]["id"])) == \
        (await conn.fetchval("SELECT count(*) FROM app.closure_signature_trips WHERE signature_id = $1", v1["id"])) + 1


async def test_firmar_dos_veces_no_crea_otra_version(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    with pytest.raises(HTTPException) as err:
        await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    assert err.value.status_code == 409
    assert [f["version"] for f in await _firmas(conn)] == [1]


async def test_el_periodo_y_el_historial_leen_la_firma(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    info = await cierre_lineas.periodo(pool, D)
    firma = (await conn.fetch(
        "SELECT signed_by::text, signed_at, totals FROM app.closure_signatures WHERE business_date = $1", D))[0]
    assert (str(info["closed_by"]), info["closed_at"]) == (firma["signed_by"], firma["signed_at"])
    assert info["frozen_totals"]["viajes"] == __import__("json").loads(firma["totals"])["viajes"]

    historial = await cierre_lineas.firmas_del_dia(pool, D)
    assert [h["version"] for h in historial] == [1]
    assert historial[0]["captured_from"] == "signing"


async def test_la_firma_no_cuenta_los_anulados(conexion_revertida):
    from app.services.anular_viajes import anular_viajes
    conn = conexion_revertida
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)
    await anular_viajes(conn, [tid], "Duplicado", admin)

    await cierre_lineas.cerrar(PoolDeUnaConexion(conn), D, override=True, override_note="prueba", user=admin)

    firma = (await _firmas(conn))[0]["id"]
    assert not await conn.fetchval(
        "SELECT $2::uuid IN (SELECT trip_id FROM app.closure_signature_trips WHERE signature_id = $1)", firma, tid)


async def test_la_pestana_viajes_del_cierre_no_lista_los_anulados(conexion_revertida):
    from app.services.anular_viajes import anular_viajes
    from app.services.cierre_viajes import SQL_CON_MOTIVO, SQL_GRUPOS_CIERRE
    conn = conexion_revertida
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)
    consulta = f"SELECT g.trip_id::text AS trip_id FROM (({SQL_GRUPOS_CIERRE}) UNION ALL ({SQL_CON_MOTIVO})) g"
    assert tid in {r["trip_id"] for r in await conn.fetch(consulta, D)}

    await anular_viajes(conn, [tid], "Duplicado", admin)

    assert tid not in {r["trip_id"] for r in await conn.fetch(consulta, D)}
```

Los parámetros de `SQL_GRUPOS_CIERRE` y `SQL_CON_MOTIVO` son los mismos que les pasa `app/routers/trips.py:2309`. Confírmalos ahí antes de correr el test y, si llevan más de uno, pásalos igual.

- [ ] **Step 2: Correr y verificar que falla**

Run: `venv/bin/python -m pytest tests/test_firma_versionada_integracion.py -v`
Expected:
- FAIL: la lista de firmas está vacía (`[] == [(1, 'signing')]`).
- FAIL: `KeyError 'version'`.
- FAIL: `AttributeError: firmas_del_dia`.
- `test_firmar_dos_veces_no_crea_otra_version` puede pasar hoy en su 409. Sigue siendo válido, porque además fija que no hay versión 2. Ningún test pasa por accidente sin las tablas.

- [ ] **Step 3: Implementar**

En `app/services/cierre_viajes.py`, reemplaza el bloque de `SQL_TOTAL_TRIPS_DEL_DIA` por:

```python
# Los viajes del día D: los planificados para D y sin anular. Es el universo que firma
# el Cierre (app.closure_signature_trips, totals.viajes) y contra el que se calculan
# los ajustes posteriores. Una sola definición (Importante 4, revisión de rama
# 2026-08-18; spec 2026-10-10 anulación §3). Parámetro: $1 = D.
SQL_VIAJES_DEL_DIA = "SELECT t.id FROM app.trips t WHERE t.planning_date = $1 AND t.voided_at IS NULL"
```

En `SQL_BASE`, el `WHERE` final queda así:

```python
    WHERE (t.planning_date <= $1::date OR (t.planning_date IS NULL AND NOT t.is_active))
      -- Los anulados no se cierran (spec 2026-10-10 anulación §2.2).
      AND t.voided_at IS NULL
```

En `app/services/cierre_lineas.py`:

1. El import queda `from .cierre_viajes import SQL_VIAJES_DEL_DIA`.
2. Agrega, antes de `periodo`:

```python
def ultima_firma(dia: str, alias: str) -> str:
    """La última firma de un día, como LEFT JOIN LATERAL (patrón de
    `_compliance_alert_lateral`). `dia` es la expresión SQL de la fecha."""
    return f"""
    LEFT JOIN LATERAL (
        SELECT s.id, s.version, s.signed_by, s.signed_at, s.override_count, s.override_note, s.totals
        FROM app.closure_signatures s
        WHERE s.business_date = {dia}
        ORDER BY s.version DESC
        LIMIT 1
    ) {alias} ON true
    """


_SQL_FIRMAR = """
INSERT INTO app.closure_signatures
    (business_date, version, signed_by, signed_at, override_count, override_note, totals, captured_from)
SELECT $1, COALESCE(max(version), 0) + 1, $2::uuid, now(), $3, $4, $5::jsonb, 'signing'
FROM app.closure_signatures WHERE business_date = $1
RETURNING id, version, signed_at
"""

_SQL_COPIAR_LINEAS = """
INSERT INTO app.closure_signature_lines
    (signature_id, subject_type, subject_id, status, requires_reason, reason_id, valid_until, comentario,
     resolved_by, resolved_at, computed_at, home_location_id, reason_from_driver_id)
SELECT $2, l.subject_type, l.subject_id, l.status, l.requires_reason, l.reason_id, l.valid_until, l.comentario,
       l.resolved_by, l.resolved_at, l.computed_at, l.home_location_id, l.reason_from_driver_id
FROM app.closure_lines l
WHERE l.business_date = $1
"""

_SQL_COPIAR_VIAJES = f"""
INSERT INTO app.closure_signature_trips (signature_id, trip_id)
SELECT $2, v.id FROM ({SQL_VIAJES_DEL_DIA}) v
"""
```

3. `periodo` queda así:

```python
async def periodo(pool, fecha: date) -> dict | None:
    """El estado del día y su última firma (app.closure_signatures). Las claves
    closed_by/closed_at/override_count/frozen_totals se conservan para los lectores;
    vienen de la firma, no de closure_periods (sus columnas se retiran en el contract)."""
    fila = await pool.fetchrow(
        f"""
        SELECT p.status, p.reopened_by, p.reopened_at, p.reopen_note,
               s.signed_by AS closed_by, s.signed_at AS closed_at, s.override_count,
               s.totals AS frozen_totals, s.version AS signature_version,
               cp.full_name AS closed_by_name
        FROM app.closure_periods p
        {ultima_firma('p.business_date', 's')}
        LEFT JOIN public.profiles cp ON cp.id = s.signed_by
        WHERE p.business_date = $1
        """,
        fecha,
    )
    if not fila:
        return None
    datos = dict(fila)
    if isinstance(datos["frozen_totals"], str):
        datos["frozen_totals"] = json.loads(datos["frozen_totals"])
    return datos


async def firmas_del_dia(pool, fecha: date) -> list[dict]:
    """Historial de firmas del día, de la más reciente a la más antigua."""
    filas = await pool.fetch(
        """
        SELECT s.version, s.signed_at, s.override_count, s.totals, s.captured_from,
               p.full_name AS signed_by_name
        FROM app.closure_signatures s
        LEFT JOIN public.profiles p ON p.id = s.signed_by
        WHERE s.business_date = $1
        ORDER BY s.version DESC
        """,
        fecha,
    )
    return [
        {**dict(f), "signed_at": f["signed_at"].isoformat(),
         "totals": json.loads(f["totals"]) if isinstance(f["totals"], str) else f["totals"]}
        for f in filas
    ]
```

4. En `cerrar`, desde `total_trips = await conn.fetchval(SQL_TOTAL_TRIPS_DEL_DIA, fecha)` hasta el `return`:

```python
            total_trips = await conn.fetchval(f"SELECT count(*) FROM ({SQL_VIAJES_DEL_DIA}) v", fecha)
            totales = {
                "conductores": conteos["conductores"],
                "conductores_resueltos": conteos["conductores"] - len(conductores_pendientes),
                "tractos": conteos["tractos"],
                "tractos_resueltos": conteos["tractos"] - len(tractos_pendientes),
                "viajes": total_trips,
            }
            await conn.execute(
                "UPDATE app.closure_periods SET status = 'CLOSED', updated_at = now() WHERE business_date = $1",
                fecha,
            )
            # La copia inmutable de lo firmado (spec 2026-10-10 §3). El bloqueo del
            # período serializa las firmas del día, así que max(version)+1 no choca;
            # UNIQUE (business_date, version) lo respalda.
            firma = await conn.fetchrow(
                _SQL_FIRMAR, fecha, user["sub"], forzados if override else 0,
                override_note if forzados else None, json.dumps(totales),
            )
            await conn.execute(_SQL_COPIAR_LINEAS, fecha, firma["id"])
            await conn.execute(_SQL_COPIAR_VIAJES, fecha, firma["id"])

            await conn.execute("DELETE FROM app.closure_recompute_queue WHERE business_date = $1", fecha)

    return {
        "business_date": fecha.isoformat(),
        "closed_at": firma["signed_at"].isoformat(),
        "version": firma["version"],
        "totales": totales,
        "overridden": forzados if override else 0,
    }
```

5. En `app/routers/daily_closures.py`, el import de `SQL_TOTAL_TRIPS_DEL_DIA` (l. 31) y su uso (l. 247) los reemplaza la Task 6. Para no romper la suite entre tasks, cambia ya el import a `SQL_VIAJES_DEL_DIA`. En l. 247 queda:

```python
        ahora = await pool.fetchval(f"SELECT count(*) FROM ({SQL_VIAJES_DEL_DIA}) v", business_date)
```

6. En `app/routers/trips.py` (bulk-reopen, l. 2586-2603), cambia la condición de firma para leer la última firma:

```python
            firmados = await conn.fetch(
                f"""
                SELECT DISTINCT cp.business_date
                FROM app.trips t
                JOIN app.closure_periods cp
                  ON cp.status = 'CLOSED'
                 AND cp.business_date BETWEEN t.planning_date AND t.planning_date + 45
                {ultima_firma('cp.business_date', 'firma')}
                LEFT JOIN LATERAL (
                    SELECT max(a.occurred_at) AS declarado_at
                    FROM public.audit_log a
                    WHERE a.entity_type = 'TRIP' AND a.entity_id = t.id
                      AND a.action = 'no_asignado_por_webcarga'
                      AND a.field = 'unassigned_reason_id'
                ) decl ON true
                WHERE t.id = ANY($1::uuid[])
                  AND t.id IN (SELECT trip_id FROM app.trips_del_dia(cp.business_date))
                  AND (decl.declarado_at IS NULL OR firma.signed_at >= decl.declarado_at)
                ORDER BY 1
                """,
                ids,
            )
```

Agrega `ultima_firma` al import de `..services.cierre_lineas` en `trips.py`.

7. En `app/routers/closures.py`:

```python
from ..services.cierre_lineas import cerrar, firmas_del_dia, reabrir


@router.get("/{fecha}/signatures")
async def firmas(fecha: str, pool=Depends(get_pool), user=Depends(require(Permission.OPERATIONS_READ))):
    """Historial de firmas del día (spec 2026-10-10 §3.2): versión, quién, cuándo, totales."""
    return {"business_date": fecha, "signatures": await firmas_del_dia(pool, _fecha(fecha))}
```

8. Confirma que ya nadie lee las columnas de firma de `closure_periods`:

Run: `grep -rn "p\.closed_by\|p\.closed_at\|cp\.closed_at\|p\.frozen_totals\|closed_by = \$\|frozen_totals = " app`
Expected: sin resultados.

- [ ] **Step 4: Correr y verificar que pasa; mutación**

Run: `venv/bin/python -m pytest tests/test_firma_versionada_integracion.py tests/test_cierre_lineas.py -v`
Expected: PASS.

Mutación: comenta `await conn.execute(_SQL_COPIAR_VIAJES, fecha, firma["id"])` y corre `test_firmar_crea_la_version_1_con_lineas_y_viajes`. Expected: FAIL. Restáuralo.

Run (suite completa): `venv/bin/python -m pytest tests/ -q > /tmp/suite_t5.txt 2>&1; tail -5 /tmp/suite_t5.txt`
Expected: sin fallas.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app monitor-app/backend/api/tests/test_firma_versionada_integracion.py
git commit -m "feat(cierre): firmar guarda una copia inmutable y versionada; los lectores leen la firma"
```

---

### Task 6: Ajustes posteriores al cierre en el backend

**Files:**
- Modify: `monitor-app/backend/api/app/services/cierre_lineas.py` (función nueva `ajustes_posteriores`)
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py:240-258`
- Test: `monitor-app/backend/api/tests/test_ajustes_posteriores_integracion.py`

**Interfaces:**
- Consumes:
  - `SQL_VIAJES_DEL_DIA` y `ultima_firma` de la Task 5;
  - `anular_viajes` y `revertir_anulacion` de la Task 4.
- Produces:
  - `ajustes_posteriores(conn_o_pool, fecha: date) -> list[dict]`. Cada ítem trae `trip_id: str`, `tipo: 'agregado' | 'quitado'`, `source_system_trip_id`, `client_name`, `voided_at: str | None` (ISO), `voided_by_name` y `void_reason`.
  - `GET /daily-closures` devuelve `cierre: {"total_trips_al_firmar": int | None, "ajustes": [...]}`, sin `posteriores_al_cierre`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_ajustes_posteriores_integracion.py`:

```python
"""Lo que cambió en un día firmado, viaje por viaje (spec §4).

Reemplaza la resta de totales (viajes de hoy − viajes firmados), que con un viaje
agregado y otro quitado daba 0."""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services import cierre_lineas
from app.services.anular_viajes import anular_viajes
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

D = date(2099, 1, 4)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=D.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


async def test_uno_que_entra_y_otro_que_sale_aparecen_los_dos(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    sale = await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    entra = await _viaje_manual(conn, admin)
    await anular_viajes(conn, [sale], "Duplicado", admin)

    ajustes = {a["trip_id"]: a for a in await cierre_lineas.ajustes_posteriores(pool, D)}
    assert set(ajustes) == {entra, sale}
    assert ajustes[entra]["tipo"] == "agregado"
    assert (ajustes[sale]["tipo"], ajustes[sale]["void_reason"]) == ("quitado", "Duplicado")
    assert ajustes[sale]["voided_by_name"] is not None


async def test_un_dia_firmado_sin_cambios_no_tiene_ajustes(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    assert await cierre_lineas.ajustes_posteriores(pool, D) == []


async def test_dia_reabierto_no_tiene_ajustes(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    await cierre_lineas.reabrir(pool, D, nota="corrección", user=admin)
    await _viaje_manual(conn, admin)

    assert await cierre_lineas.ajustes_posteriores(pool, D) == []
    assert [f["version"] for f in await cierre_lineas.firmas_del_dia(pool, D)] == [1]


async def test_get_daily_closures_devuelve_la_lista(conexion_revertida):
    from app.routers.daily_closures import get_daily_closure_status
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    entra = await _viaje_manual(conn, admin)

    respuesta = await get_daily_closure_status(fecha=D.isoformat(), pool=pool, user=admin)
    assert "posteriores_al_cierre" not in respuesta["cierre"]
    assert [a["trip_id"] for a in respuesta["cierre"]["ajustes"]] == [entra]
```

Antes de correrlo, confirma el nombre y los parámetros del handler de `GET /daily-closures` (`app/routers/daily_closures.py:206`) y ajusta solo la llamada del último test.

- [ ] **Step 2: Correr y verificar que falla**

Run: `venv/bin/python -m pytest tests/test_ajustes_posteriores_integracion.py -v`
Expected: FAIL con `AttributeError: module 'app.services.cierre_lineas' has no attribute 'ajustes_posteriores'`.

- [ ] **Step 3: Implementar**

En `app/services/cierre_lineas.py`, después de `firmas_del_dia`:

```python
_SQL_AJUSTES = f"""
WITH firma AS (
    SELECT s.id
    FROM app.closure_periods p
    {ultima_firma('p.business_date', 's')}
    WHERE p.business_date = $1 AND p.status = 'CLOSED' AND s.id IS NOT NULL
),
firmados AS (SELECT v.trip_id FROM app.closure_signature_trips v WHERE v.signature_id = (SELECT id FROM firma)),
del_dia AS (SELECT d.id AS trip_id FROM ({SQL_VIAJES_DEL_DIA}) d),
cambios AS (
    (SELECT trip_id, 'agregado' AS tipo FROM del_dia EXCEPT SELECT trip_id, 'agregado' FROM firmados)
    UNION ALL
    (SELECT trip_id, 'quitado' FROM firmados EXCEPT SELECT trip_id, 'quitado' FROM del_dia)
)
SELECT c.trip_id::text AS trip_id, c.tipo, t.source_system_trip_id, t.client_name,
       t.voided_at, p.full_name AS voided_by_name, t.void_reason
FROM cambios c
LEFT JOIN app.trips t ON t.id = c.trip_id
LEFT JOIN public.profiles p ON p.id = t.voided_by
WHERE EXISTS (SELECT 1 FROM firma)
ORDER BY c.tipo, t.source_system_trip_id NULLS LAST
"""


async def ajustes_posteriores(pool, fecha: date) -> list[dict]:
    """Lo que cambió en un día firmado desde su última firma (spec 2026-10-10 §4):
    viajes del día que no estaban en la firma (agregados) y viajes firmados que ya no
    están (quitados; si fue por anulación, quién, cuándo y el motivo). Un día abierto
    no tiene ajustes: lo que cambia entra en su recálculo."""
    return [
        {**dict(f), "voided_at": f["voided_at"].isoformat() if f["voided_at"] else None}
        for f in await pool.fetch(_SQL_AJUSTES, fecha)
    ]
```

En `app/routers/daily_closures.py`, reemplaza el bloque desde `# El dia sigue cerrado` hasta el armado de `"cierre"` por:

```python
    # El día sigue cerrado: la firma es una copia inmutable de lo que existía al
    # firmar y no se recalcula. Lo que cambió después se muestra viaje por viaje,
    # como ajuste posterior al cierre (spec 2026-10-10 §4), sin invalidar la firma.
    total_trips_al_firmar = closure_dict.get("total_trips") if closure_dict else None
    ajustes = await ajustes_posteriores(pool, business_date) if cerrado else []
```

En el `return`:

```python
        "cierre": {
            "total_trips_al_firmar": total_trips_al_firmar,
            "ajustes": ajustes,
        },
```

Importa `ajustes_posteriores` desde `..services.cierre_lineas` y borra el import de `SQL_VIAJES_DEL_DIA`, si quedó sin uso. Verifica que la variable que dice si el día está cerrado se llama `cerrado`, como en el `return` existente (`"closed": cerrado`).

- [ ] **Step 4: Correr y verificar que pasa; mutación**

Run: `venv/bin/python -m pytest tests/test_ajustes_posteriores_integracion.py -v`
Expected: PASS (4 tests).

Mutación: borra la rama `UNION ALL (SELECT ... 'quitado' ...)` y corre `test_uno_que_entra_y_otro_que_sale_aparecen_los_dos`. Expected: FAIL. Restáurala.

Run (suite completa): `venv/bin/python -m pytest tests/ -q > /tmp/suite_t6.txt 2>&1; tail -5 /tmp/suite_t6.txt`
Expected: sin fallas.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app monitor-app/backend/api/tests/test_ajustes_posteriores_integracion.py
git commit -m "feat(cierre): ajustes posteriores al cierre viaje por viaje, en vez de una resta de totales"
```

---

### Task 7: Frontend — anular con motivo, revertir e insignia "Anulado"

**Files:**
- Modify: `monitor-app/frontend/lib/api/trips.ts:146-154` (`remove` y `bulkRemove` → `voidTrips` y `revertVoid`)
- Modify: `monitor-app/frontend/lib/types.ts:420-425` (campos de `Trip`)
- Modify: `monitor-app/frontend/components/ui/BarraDeSeleccion.tsx` (prop `pideMotivo`)
- Rename+rewrite:
  - `monitor-app/frontend/hooks/useEliminarViajes.ts` → `useAnularViajes.ts`, con su test;
  - `monitor-app/frontend/components/dashboard/EliminarViaje.tsx` → `AnularViaje.tsx`, con un test nuevo.
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx:199,397-400`, `monitor-app/frontend/components/dashboard/TripTable.test.tsx:427-449`, `monitor-app/frontend/components/dashboard/TripDetailView.tsx:18,161`, `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx:32,243-245,618-643`

**Interfaces:**
- Consumes: `POST /api/v1/trips/void` y `POST /api/v1/trips/void/revert` de la Task 4. Campos de `Trip`: `can_void`, `void_blocked_reason`, `can_revert_void`, `voided_at`, `voided_by_name` y `void_reason`.
- Produces:
  - `tripsApi.voidTrips(tripIds: string[], reason: string)`;
  - `tripsApi.revertVoid(tripIds: string[])`;
  - `useAnularViajes(visibles: Trip[])`, con la misma forma que `useEliminarViajes`, salvo que `anularSeleccion(motivo: string)` reemplaza a `eliminarSeleccion()`;
  - `<AnularViaje trip onCambio />`.

- [ ] **Step 1: Escribir los tests que fallan**

Renombra `hooks/useEliminarViajes.test.tsx` a `hooks/useAnularViajes.test.tsx` y adáptalo:
- el mock pasa a `tripsApi: { voidTrips: vi.fn() }`;
- `viaje(id, can_void)` construye `{ id, can_void }`;
- los motivos de rechazo pasan a `'El cierre del 22/09 está firmado: lo anula quien puede firmar el cierre'`;
- `eliminarSeleccion()` pasa a `anularSeleccion('Duplicado')`;
- agrega este caso:

```tsx
  it('manda el motivo con los marcados', async () => {
    voidTrips.mockResolvedValue({ ok: true, voided: 1 })
    const { result } = montar([viaje('a', true)])
    act(() => result.current.seleccion.onToggle('a'))

    await act(async () => { await result.current.anularSeleccion('Duplicado') })

    expect(voidTrips).toHaveBeenCalledWith(['a'], 'Duplicado')
    expect(result.current.seleccion.ids.size).toBe(0)
  })
```

Crea `components/dashboard/AnularViaje.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({ tripsApi: { voidTrips: vi.fn(), revertVoid: vi.fn() } }))

import { AnularViaje } from './AnularViaje'
import { tripsApi } from '@/lib/api/trips'

const voidTrips = vi.mocked(tripsApi.voidTrips)
const revertVoid = vi.mocked(tripsApi.revertVoid)

function montar(trip: Partial<Trip>) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <AnularViaje trip={{ id: 't1', ...trip } as Trip} onCambio={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { voidTrips.mockReset(); revertVoid.mockReset() })

describe('AnularViaje', () => {
  it('no aparece si no se puede anular ni revertir', () => {
    const { container } = montar({ can_void: false, can_revert_void: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('no anula sin motivo', () => {
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    expect(screen.getByRole('button', { name: /sí, anular/i })).toBeDisabled()
  })

  it('anula con el motivo escrito', async () => {
    voidTrips.mockResolvedValue({ ok: true, voided: 1 })
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'Duplicado' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular/i }))
    await waitFor(() => expect(voidTrips).toHaveBeenCalledWith(['t1'], 'Duplicado'))
  })

  it('un viaje anulado ofrece deshacer la anulación', async () => {
    revertVoid.mockResolvedValue({ ok: true, reverted: 1 })
    montar({ can_revert_void: true, voided_at: '2026-10-10T20:00:00Z', void_reason: 'Duplicado' })
    fireEvent.click(screen.getByRole('button', { name: /deshacer anulación/i }))
    await waitFor(() => expect(revertVoid).toHaveBeenCalledWith(['t1']))
  })
})
```

En `components/dashboard/TripDetailView.test.tsx`, agrega:

```tsx
  it('un viaje anulado lo dice, con quién y el motivo', () => {
    renderDetalle({ ...tripBase, voided_at: '2026-10-10T20:00:00Z', voided_by_name: 'Ana Pérez', void_reason: 'Duplicado' })
    expect(screen.getByText(/anulado/i)).toBeInTheDocument()
    expect(screen.getByText(/duplicado/i)).toBeInTheDocument()
    expect(screen.getByText(/ana pérez/i)).toBeInTheDocument()
  })
```

Antes, abre `TripDetailView.test.tsx` y usa sus helpers reales de render y de viaje base (`renderDetalle` y `tripBase` son nombres de referencia); los nombres pueden diferir. En `TripTable.test.tsx` (l. 427-449), `can_delete` pasa a `can_void` y `delete_blocked_reason` pasa a `void_blocked_reason`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/frontend && npx vitest run hooks/useAnularViajes.test.tsx components/dashboard/AnularViaje.test.tsx components/dashboard/TripDetailView.test.tsx components/dashboard/TripTable.test.tsx`
Expected: FAIL. Los módulos `./useAnularViajes` y `./AnularViaje` no existen, y no aparece el texto "Anulado".

- [ ] **Step 3: Implementar**

`lib/types.ts`, en `Trip`: reemplaza `can_delete` y `delete_blocked_reason` por:

```ts
  /** Si quien mira puede anular este viaje: manual, no anulado, y según su día
   *  (abierto: creador o trips.void_any; firmado: closures.sign). Lo decide el
   *  backend (services/anular_viajes.py), la misma regla que aplica la anulación. */
  can_void?:            boolean
  /** Por qué no, en español, cuando `can_void` es false. */
  void_blocked_reason?: string | null
  /** Si quien mira puede deshacer la anulación (misma regla). */
  can_revert_void?:     boolean
  /** Anulación con motivo (spec 2026-10-10): null si el viaje está vigente. */
  voided_at?:           string | null
  voided_by_name?:      string | null
  void_reason?:         string | null
```

`lib/api/trips.ts`: reemplaza `remove` y `bulkRemove` por:

```ts
  /** Sólo viajes manuales; todo o nada. Ver services/anular_viajes.py. */
  voidTrips: (tripIds: string[], reason: string) =>
    apiFetch<{ ok: boolean; voided: number }>(`/api/v1/trips/void`, {
      method: 'POST',
      body: JSON.stringify({ trip_ids: tripIds, reason }),
    }),

  revertVoid: (tripIds: string[]) =>
    apiFetch<{ ok: boolean; reverted: number }>(`/api/v1/trips/void/revert`, {
      method: 'POST',
      body: JSON.stringify({ trip_ids: tripIds }),
    }),
```

`components/ui/BarraDeSeleccion.tsx`: agrega a `AccionDestructiva` la prop `pideMotivo`, y cambia la firma de `onConfirmar`:

```ts
  /** Si la acción exige un motivo: la etiqueta del campo. El botón de confirmar
   *  queda deshabilitado mientras esté vacío, y `onConfirmar` recibe el texto. */
  pideMotivo?:  string
  onConfirmar:  (motivo: string) => void
```

En el componente, agrega `const [motivo, setMotivo] = useState('')`. Dentro de la rama `confirmando`, antes del botón de confirmar:

```tsx
          {destructiva.pideMotivo && (
            <label className="flex items-center gap-1.5 text-[11px] text-white/80">
              {destructiva.pideMotivo}
              <input
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                className="rounded bg-white/10 px-2 py-1 text-[11px] text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/40"
                autoFocus
              />
            </label>
          )}
```

El botón de confirmar queda con `disabled={destructiva.ocupado || (!!destructiva.pideMotivo && !motivo.trim())}` y `onClick={() => { setConfirmando(false); destructiva.onConfirmar(motivo.trim()); setMotivo('') }}`. `TriageBulkBar` no pasa `pideMotivo` y su `onConfirmar` ignora el argumento: no requiere cambios. Confírmalo corriendo su test.

`hooks/useAnularViajes.ts`: es `useEliminarViajes.ts` con estos cambios:
- `can_delete` → `can_void`;
- `tripsApi.bulkRemove(tripIds)` → `tripsApi.voidTrips(tripIds, motivo)`;
- `eliminar(tripIds)` → `anular(tripIds: string[], motivo: string)`;
- `eliminarSeleccion: () => eliminar([...ids])` → `anularSeleccion: (motivo: string) => anular([...ids], motivo)`;
- `hayEliminables` → `hayAnulables`;
- `mensajeDeRechazo` cae por defecto a `'No se pudo anular'`;
- el docstring dice "anulación con motivo".

Agrega `['trip']` a `CLAVES_AFECTADAS`, porque el detalle muestra la insignia. Borra `useEliminarViajes.ts` y su test.

`components/dashboard/AnularViaje.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, Loader2, Undo2 } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'
import { CLAVES_AFECTADAS, mensajeDeRechazo } from '@/hooks/useAnularViajes'

interface Props {
  trip:     Trip
  /** Después de anular o revertir: el detalle se vuelve a pedir. */
  onCambio: () => void
}

/** Anular un viaje manual con motivo, o deshacer la anulación, desde su detalle.
 *
 *  Confirma en el mismo lugar, como la barra de selección del Monitor. El viaje no
 *  se borra: queda con quién, cuándo y por qué. Sólo aparece si el backend dice que
 *  quien mira puede (`can_void` / `can_revert_void`). */
export function AnularViaje({ trip, onCambio }: Props) {
  const queryClient = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!trip.can_void && !trip.can_revert_void) return null

  async function correr(accion: () => Promise<unknown>) {
    setOcupado(true)
    setError(null)
    try {
      await accion()
      setConfirmando(false)
      setMotivo('')
      await Promise.all(CLAVES_AFECTADAS.map(queryKey => queryClient.invalidateQueries({ queryKey })))
      onCambio()
    } catch (e) {
      setError(mensajeDeRechazo(e))
    } finally {
      setOcupado(false)
    }
  }

  const boton = 'flex items-center gap-1.5 text-etiqueta font-semibold text-white/60 hover:text-white transition-colors rounded px-1.5 py-1 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40'

  return (
    <span className="flex items-center gap-2 shrink-0">
      {error && <span role="alert" className="text-etiqueta text-white bg-status-incidente rounded px-1.5 py-0.5 max-w-[260px] truncate" title={error}>{error}</span>}
      {trip.can_revert_void ? (
        <button type="button" disabled={ocupado} onClick={() => correr(() => tripsApi.revertVoid([trip.id]))} className={boton}>
          {ocupado ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Deshacer anulación
        </button>
      ) : confirmando ? (
        <>
          <label className="flex items-center gap-1.5 text-etiqueta text-white/70">
            Motivo
            <input
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              autoFocus
              className="rounded bg-white/10 px-2 py-1 text-etiqueta text-white focus:outline-none focus:ring-2 focus:ring-white/40"
            />
          </label>
          <button
            type="button"
            disabled={ocupado || !motivo.trim()}
            onClick={() => correr(() => tripsApi.voidTrips([trip.id], motivo.trim()))}
            className="flex items-center gap-1 text-etiqueta font-bold bg-status-incidente hover:bg-status-incidente/90 disabled:opacity-60 text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {ocupado && <Loader2 size={11} className="animate-spin" />}
            Sí, anular
          </button>
          <button type="button" disabled={ocupado} onClick={() => setConfirmando(false)} className="text-etiqueta font-semibold text-white/60 hover:text-white transition-colors">
            Cancelar
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirmando(true)} className={boton}>
          <Ban size={12} /> Anular viaje
        </button>
      )}
    </span>
  )
}
```

Borra `EliminarViaje.tsx`.

`components/dashboard/TripDetailView.tsx`:
- el import pasa de `EliminarViaje` a `AnularViaje`;
- la l. 161 pasa a ser `<AnularViaje trip={trip} onCambio={() => queryClient.invalidateQueries({ queryKey: ['trip', trip.id] })} />`, con `queryClient` vía `useQueryClient()`, si el componente no lo tiene ya. Un viaje anulado sigue abierto en el detalle, y por eso ya no se llama a `onDismiss`.

Inmediatamente debajo de la barra del encabezado, agrega:

```tsx
      {trip.voided_at && (
        <div role="status" className="flex items-center gap-2 border-b border-status-incidente/20 bg-status-incidente/5 px-4 py-2 text-dato text-text-primary">
          <Ban size={13} className="text-status-incidente shrink-0" />
          <span>
            <strong>Anulado</strong>
            {trip.voided_by_name && <> por {trip.voided_by_name}</>}
            {' · '}{new Date(trip.voided_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
            {trip.void_reason && <> · Motivo: {trip.void_reason}</>}
          </span>
        </div>
      )}
```

Importa `Ban` de `lucide-react`.

`components/dashboard/TripTable.tsx`: `can_delete` pasa a `can_void` y `delete_blocked_reason` pasa a `void_blocked_reason` (l. 199 y 397-400). El nombre `eliminables` pasa a `anulables`.

`app/dashboard/operations/monitor/page.tsx`: el import y el uso pasan a `useAnularViajes` (`const anulacion = useAnularViajes(visibleTrips)`). La barra queda así:

```tsx
                {anulacion.hayAnulables && (
                  <div className="mb-2 rounded-lg overflow-hidden border border-border bg-white">
                    <BarraDeSeleccion
                      seleccionados={anulacion.seleccion.ids.size}
                      ayuda="marca los viajes manuales que quieras anular"
                      onLimpiar={anulacion.limpiar}
                      destructiva={{
                        etiqueta:     `Anular ${cuantos(anulacion.seleccion.ids.size, 'viaje')}`,
                        advertencia:  'Quedan anulados, con el motivo; no se borran',
                        pideMotivo:   'Motivo',
                        confirmacion: `Sí, anular ${anulacion.seleccion.ids.size}`,
                        onConfirmar:  motivo => { void anulacion.anularSeleccion(motivo) },
                        ocupado:      anulacion.ocupado,
                      }}
                    />
                    {anulacion.error && (
                      <p role="alert" className="px-3 py-2 text-[11px] text-status-incidente bg-status-incidente/5 border-t border-status-incidente/20">
                        {anulacion.error}
                      </p>
                    )}
                  </div>
                )}
```

`seleccion={eliminacion.seleccion}` pasa a ser `seleccion={anulacion.seleccion}`. Actualiza el comentario de l. 243.

Busca lo que haya quedado:

Run: `grep -rn "can_delete\|delete_blocked_reason\|useEliminarViajes\|EliminarViaje\|bulkRemove\|tripsApi.remove" --include='*.ts' --include='*.tsx' app components hooks lib`
Expected: sin resultados.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run > /tmp/vitest_t7.txt 2>&1; tail -8 /tmp/vitest_t7.txt && npx tsc --noEmit`
Expected: todos los tests en verde y `tsc` sin errores.

Mutación: en `AnularViaje.tsx`, quita `|| !motivo.trim()` del `disabled` y corre `AnularViaje.test.tsx`. Expected: FAIL en "no anula sin motivo". Restáuralo.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/hooks monitor-app/frontend/app/dashboard/operations/monitor
git commit -m "feat(monitor): anular con motivo y deshacer, con la insignia Anulado en el detalle"
```

---

### Task 8: Frontend — ajustes posteriores al cierre e historial de firmas

**Files:**
- Rename+rewrite: `monitor-app/frontend/components/dashboard/AvisoPosteriorAlCierre.tsx` → `AjustesPosterioresAlCierre.tsx`, con su test
- Create: `monitor-app/frontend/components/dashboard/HistorialDeFirmas.tsx`, `HistorialDeFirmas.test.tsx`
- Modify: `monitor-app/frontend/lib/types.ts:1370-1381`, `monitor-app/frontend/lib/api/closures.ts` (`signatures`), `monitor-app/frontend/app/dashboard/operations/closures/page.tsx:124-125,299-303`, `monitor-app/frontend/app/dashboard/operations/closures/page.test.tsx:65`

**Interfaces:**
- Consumes:
  - `cierre.ajustes` de `GET /daily-closures` (Task 6);
  - `GET /api/v1/closures/{fecha}/signatures` (Task 5);
  - `urlDelViaje(tripId, volverA)` de `lib/navegacion/viaje.ts`.
- Produces:
  - `type AjustePosterior = { trip_id: string; tipo: 'agregado' | 'quitado'; source_system_trip_id: string | null; client_name: string | null; voided_at: string | null; voided_by_name: string | null; void_reason: string | null }`;
  - `type FirmaDelDia = { version: number; signed_at: string; signed_by_name: string | null; override_count: number; totals: Record<string, number>; captured_from: 'signing' | 'backfill' }`;
  - `closuresApi.signatures(fecha) => Promise<{ business_date: string; signatures: FirmaDelDia[] }>`.

- [ ] **Step 1: Escribir los tests que fallan**

`components/dashboard/AjustesPosterioresAlCierre.test.tsx`, que reemplaza a `AvisoPosteriorAlCierre.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AjustesPosterioresAlCierre } from './AjustesPosterioresAlCierre'
import type { AjustePosterior } from '@/lib/types'

const ajuste = (x: Partial<AjustePosterior>): AjustePosterior => ({
  trip_id: 't1', tipo: 'agregado', source_system_trip_id: 'M-1', client_name: 'Iansa',
  voided_at: null, voided_by_name: null, void_reason: null, ...x,
})

describe('AjustesPosterioresAlCierre', () => {
  it('no dice nada cuando no cambió nada', () => {
    const { container } = render(<AjustesPosterioresAlCierre ajustes={[]} volverA="/x" />)
    expect(container).toBeEmptyDOMElement()
  })

  // El día NO se reabre: la firma sigue siendo verdadera sobre lo que existía
  // cuando se firmó. Esto es un ajuste, y "reabierto" sería mentir.
  it('no dice que el día se reabrió', () => {
    render(<AjustesPosterioresAlCierre ajustes={[ajuste({})]} volverA="/x" />)
    expect(screen.queryByText(/reabiert/i)).toBeNull()
    expect(screen.getByText(/posterior al cierre/i)).toBeInTheDocument()
  })

  it('dice qué viaje entró y cuál salió, con el motivo de la anulación', () => {
    render(<AjustesPosterioresAlCierre volverA="/x" ajustes={[
      ajuste({ trip_id: 'a', tipo: 'agregado', source_system_trip_id: 'Q-9' }),
      ajuste({ trip_id: 'b', tipo: 'quitado', source_system_trip_id: 'M-2', voided_at: '2026-10-10T20:00:00Z',
               voided_by_name: 'Ana Pérez', void_reason: 'Duplicado' }),
    ]} />)
    expect(screen.getByText(/Q-9/)).toBeInTheDocument()
    expect(screen.getByText(/agregado/i)).toBeInTheDocument()
    expect(screen.getByText(/anulado/i)).toBeInTheDocument()
    expect(screen.getByText(/duplicado/i)).toBeInTheDocument()
  })

  it('cada viaje lleva a su detalle y vuelve al Cierre', () => {
    render(<AjustesPosterioresAlCierre ajustes={[ajuste({ trip_id: 'a' })]} volverA="/dashboard/operations/closures?fecha=2026-09-23" />)
    const link = screen.getByRole('link', { name: /ver viaje/i })
    expect(link.getAttribute('href')).toContain('/trips/a')
    expect(link.getAttribute('href')).toContain(encodeURIComponent('/dashboard/operations/closures'))
  })
})
```

`components/dashboard/HistorialDeFirmas.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistorialDeFirmas } from './HistorialDeFirmas'
import type { FirmaDelDia } from '@/lib/types'

const firma = (x: Partial<FirmaDelDia>): FirmaDelDia => ({
  version: 1, signed_at: '2026-09-24T01:51:08Z', signed_by_name: 'Cristian Castillo',
  override_count: 0, totals: { viajes: 38 }, captured_from: 'backfill', ...x,
})

describe('HistorialDeFirmas', () => {
  it('con una sola firma no muestra historial', () => {
    const { container } = render(<HistorialDeFirmas firmas={[firma({})]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('con varias, lista cada versión con quién firmó', () => {
    render(<HistorialDeFirmas firmas={[
      firma({ version: 2, signed_by_name: 'Ana Pérez', captured_from: 'signing' }),
      firma({ version: 1 }),
    ]} />)
    expect(screen.getByText(/versión 2/i)).toBeInTheDocument()
    expect(screen.getByText(/versión 1/i)).toBeInTheDocument()
    expect(screen.getByText(/ana pérez/i)).toBeInTheDocument()
    expect(screen.getByText(/cristian castillo/i)).toBeInTheDocument()
  })
})
```

Antes, confirma la ruta real que arma `urlDelViaje` (`lib/navegacion/viaje.ts`) y ajusta el `toContain('/trips/a')`, si el formato difiere.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run components/dashboard/AjustesPosterioresAlCierre.test.tsx components/dashboard/HistorialDeFirmas.test.tsx`
Expected: FAIL, porque los módulos no existen.

- [ ] **Step 3: Implementar**

`lib/types.ts`: en el tipo de `cierre` (l. 1375-1381), `posteriores_al_cierre: number` pasa a ser `ajustes: AjustePosterior[]`. El comentario dice que son los ajustes posteriores al cierre, viaje por viaje, según la spec 2026-10-10 §4. Agrega los tipos `AjustePosterior` y `FirmaDelDia` de las Interfaces de esta task.

`lib/api/closures.ts`, dentro de `closuresApi`:

```ts
  /** Historial de firmas del día, de la más reciente a la más antigua (spec 2026-10-10 §3.2). */
  signatures: (fecha: string) =>
    apiFetch<{ business_date: string; signatures: FirmaDelDia[] }>(
      `/api/v1/closures/${encodeURIComponent(fecha)}/signatures`,
    ),
```

`components/dashboard/AjustesPosterioresAlCierre.tsx`:

```tsx
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { AjustePosterior } from '@/lib/types'
import { urlDelViaje } from '@/lib/navegacion/viaje'

interface Props {
  /** `cierre.ajustes` de GET /daily-closures. */
  ajustes: AjustePosterior[]
  /** La URL del Cierre, para que "Ver viaje" vuelva acá. */
  volverA: string
}

/**
 * Lo que cambió en un día firmado, viaje por viaje (spec 2026-10-10 §4).
 *
 * El día NO se reabre: la firma es una copia inmutable de lo que existía al firmar.
 * Lo que cambió después es un ajuste posterior al cierre, nunca "reabierto": esa
 * palabra mentiría sobre lo que pasó. El encabezado sigue diciendo "Cerrado"; esto va
 * al lado, no lo reemplaza.
 *
 * Reemplaza al aviso que restaba totales (viajes de hoy − firmados): un viaje que
 * entraba y otro que salía daban 0. Cada fila lleva al detalle del viaje, que abre
 * también los anulados.
 */
export function AjustesPosterioresAlCierre({ ajustes, volverA }: Props) {
  if (ajustes.length === 0) return null

  return (
    <section className="rounded-xl border border-espera/20 bg-espera/5 px-4 py-3" aria-label="Ajustes posteriores al cierre">
      <p className="flex items-center gap-2 text-dato font-semibold text-text-primary">
        <AlertTriangle size={14} className="text-espera shrink-0" />
        {ajustes.length === 1 ? '1 ajuste posterior al cierre' : `${ajustes.length} ajustes posteriores al cierre`}
      </p>
      <ul className="mt-2 divide-y divide-espera/10">
        {ajustes.map(a => (
          <li key={a.trip_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-dato text-text-primary">
            <span className="font-identificador tabular-nums">{a.source_system_trip_id ?? '—'}</span>
            {a.client_name && <span className="text-text-secondary">{a.client_name}</span>}
            <span className="text-etiqueta font-semibold uppercase tracking-wide text-text-secondary">
              {a.tipo === 'agregado' ? 'Agregado' : a.voided_at ? 'Anulado' : 'Ya no está en el día'}
            </span>
            {a.voided_at && (
              <span className="text-text-secondary">
                {a.voided_by_name ?? 'Alguien'} · {new Date(a.voided_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                {a.void_reason && <> · Motivo: {a.void_reason}</>}
              </span>
            )}
            <Link href={urlDelViaje(a.trip_id, volverA)} className="ml-auto text-etiqueta font-semibold text-accent hover:underline">
              Ver viaje
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

`components/dashboard/HistorialDeFirmas.tsx`:

```tsx
import type { FirmaDelDia } from '@/lib/types'

interface Props {
  /** De la más reciente a la más antigua (GET /closures/{fecha}/signatures). */
  firmas: FirmaDelDia[]
}

/** Las veces que se firmó el día (spec 2026-10-10 §3). Con una sola firma no hay
 *  historia que contar: el encabezado ya dice quién y cuándo. */
export function HistorialDeFirmas({ firmas }: Props) {
  if (firmas.length < 2) return null
  return (
    <details className="rounded-xl border border-border bg-white px-4 py-2 text-dato text-text-primary">
      <summary className="cursor-pointer font-semibold">Firmado {firmas.length} veces</summary>
      <ol className="mt-2 space-y-1">
        {firmas.map(f => (
          <li key={f.version} className="flex flex-wrap gap-x-3 text-text-secondary">
            <span className="font-semibold text-text-primary">Versión {f.version}</span>
            <span>{f.signed_by_name ?? '—'}</span>
            <span className="tabular-nums">{new Date(f.signed_at).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
            {f.totals.viajes !== undefined && <span className="tabular-nums">{f.totals.viajes} viajes</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}
```

`app/dashboard/operations/closures/page.tsx`:
1. Reemplaza el import de `AvisoPosteriorAlCierre` por los de `AjustesPosterioresAlCierre` y `HistorialDeFirmas`.
2. Agrega la query del historial, junto a `cierreQuery`:

```tsx
  const firmasQuery = useQuery({
    queryKey: ['closure-signatures', fecha],
    queryFn: () => closuresApi.signatures(fecha),
    enabled: !!cierreQuery.data?.closed,
  })
```

3. En l. 299-303, reemplaza `<AvisoPosteriorAlCierre ... />` por:

```tsx
      <AjustesPosterioresAlCierre
        ajustes={cierreQuery.data?.cierre?.ajustes ?? []}
        volverA={urlDelCierre}
      />
      <HistorialDeFirmas firmas={firmasQuery.data?.signatures ?? []} />
```

`urlDelCierre` es la URL actual del Cierre que ya arma la página para `handleSelectTrip` (la que se pasa a `urlDelViaje`). Reutiliza esa misma expresión, sin armar otra. Actualiza el comentario de l. 124-125: `ajustes` son los cambios posteriores a la firma.

4. Invalidación: agrega `['closure-signatures']` a las claves que se invalidan al firmar y reabrir. Búscalas en el handler que llama a `closuresApi.close` y `closuresApi.reopen`.

`page.test.tsx` (l. 65): `cierre: { total_trips_al_firmar: null, posteriores_al_cierre: 0 }` pasa a `cierre: { total_trips_al_firmar: null, ajustes: [] }`. Si el test mockea `closuresApi`, agrega `signatures: vi.fn().mockResolvedValue({ business_date: '', signatures: [] })`.

Borra `AvisoPosteriorAlCierre.tsx` y su test.

Run: `grep -rn "posteriores_al_cierre\|AvisoPosteriorAlCierre" --include='*.ts' --include='*.tsx' app components hooks lib`
Expected: sin resultados.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run > /tmp/vitest_t8.txt 2>&1; tail -8 /tmp/vitest_t8.txt && npx tsc --noEmit && npx next build > /tmp/build_t8.txt 2>&1; tail -5 /tmp/build_t8.txt`
Expected: tests en verde, `tsc` limpio y build OK.

Mutación: en `AjustesPosterioresAlCierre.tsx`, cambia `a.voided_at ? 'Anulado'` por `'Ya no está en el día'` y corre su test. Expected: FAIL. Restáuralo.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend/components monitor-app/frontend/lib monitor-app/frontend/app/dashboard/operations/closures
git commit -m "feat(cierre): lista de ajustes posteriores al cierre e historial de firmas"
```

---

### Task 9: Despliegue, verificación en vivo y anulación de los duplicados del 23/09

**Files:**
- Modify: `AGENTLOG.md`

- [ ] **Step 1: Push a `dev` sin jobs en vuelo**

Run: `gh run list --branch dev --limit 5`. Confirma que no hay nada `in_progress`. Luego `git push origin dev`.

Run: `gh run watch` sobre las corridas "Deploy Monitor API" y "Deploy Frontend".
Expected: las dos `success`. Si "Deploy Frontend" falla bajando Google Fonts, es un flake de red conocido: reintenta una vez con `gh run rerun --failed`.

- [ ] **Step 2: Verificar la corrida de dbt con las columnas nuevas**

Después de la siguiente corrida del pipeline del modelo `trips` (`mcp__mage-agent__run_logs`):

```sql
SELECT count(*) FILTER (WHERE voided_at IS NOT NULL) AS anulados,
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='app' AND table_name='trips' AND column_name LIKE 'void%') AS columnas
FROM app.trips;
```

Expected: `columnas = 3` y la corrida en `completed`. También verifica que existan los seis triggers de la cola: `SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_enqueue_closure_recompute_%' AND tgrelid IN ('app.trips'::regclass, 'app.trip_stops'::regclass);`. Expected: 6 filas. Esto cierra el pendiente de la sesión anterior.

- [ ] **Step 3: Verificación en la app (Playwright, dev)**

Con el MCP de Playwright, sobre `webcarga-frontend-dev`, con la sesión del usuario:
1. En el Cierre del 23/09, que está firmado, la lista de ajustes está vacía y no hay historial (una sola firma).
2. En el Monitor, el detalle de un duplicado (038cd817…) muestra "Anular viaje". La barra del Monitor pide motivo.

No anules todavía desde el navegador: el paso 4 lo hace con la sesión del usuario y su autorización explícita.

- [ ] **Step 4: Anular los 6 duplicados del 23/09 (requiere confirmación del usuario)**

Detente y pide confirmación antes: es una acción sobre datos reales.

Con la confirmación, desde el Monitor (barra de selección) o desde el detalle de cada viaje, con motivo "Duplicado", anula:
- 038cd817…
- 4371e9c1…
- 26c2cea0…
- 7bb5a2fe…
- 9ec39f27…
- 9cfca7b6…

**No** anules 747ebcec… (14:40:49) ni e6151201… (24/09).

Verifica:

```sql
SELECT p.status,
       (SELECT count(*) FROM app.closure_signatures WHERE business_date = '2026-09-23') AS firmas,
       (SELECT count(*) FROM app.closure_lines WHERE business_date = '2026-09-23') AS lineas,
       (SELECT count(*) FROM app.trips WHERE planning_date = '2026-09-23' AND voided_at IS NOT NULL) AS anulados
FROM app.closure_periods p WHERE p.business_date = '2026-09-23';
```

Expected: `CLOSED`, 1 firma, 123 líneas y 6 anulados. En el Cierre del 23/09, la lista muestra 6 ajustes "Anulado · Motivo: Duplicado", y el encabezado sigue diciendo "Cerrado" por Cristian Castillo.

- [ ] **Step 5: Revisión final de la rama y AGENTLOG**

Revisión de la rama completa (executing-plans / subagent-driven-development, "Final Review") contra la spec y la sección Review Focus de este plan.

Actualiza `AGENTLOG.md`, según la regla de CLAUDE.md: qué se hizo, el siguiente paso exacto y las decisiones.
- **Hecho:** anulación con motivo, firma versionada, ajustes, y los 23/09 anulados sin reabrir.
- **Siguiente paso:** el contract. Retirar las columnas de firma de `closure_periods` y las 4 tablas viejas, con respaldo previo. Issue #13: restaurar una firma anterior.
- **Pendiente:** la decisión A (regla de 15 días).

Si el checkpoint de la spec queda cerrado, muévelo a `AGENTLOG_ARCHIVE.md`.

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): anulación con motivo y firma versionada, desplegadas; 23/09 corregido sin reabrir"
git push origin dev
```
