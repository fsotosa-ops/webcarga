# Cierre: motivos de anulación de catálogo, ajustes sin ruido y vuelta visible — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al anular un viaje, el motivo se elige de un catálogo configurable, con comentario opcional (obligatorio con "Otro"). Los ajustes posteriores al cierre pasan de bloque fijo a indicador más sección en "Viajes". El detalle de un viaje muestra un vínculo con texto para volver.

**Architecture:**
- **Motivos:** un dominio nuevo `TRIP_VOID_REASON` en `app.status_taxonomies`, con el mismo patrón que `TRIP_UNASSIGNED_REASON`. Las columnas `void_reason_id` y `void_note` reemplazan a `void_reason` en tres fases:
  - **expand** (migración + Mage en una ventana);
  - **despliegue** de la API y el frontend;
  - **contract** (migración + Mage en otra ventana).

  Así ninguna versión desplegada lee una columna que ya no existe.
- **Frontend:** reutiliza `TaxonomyTab`, `taxonomiesApi` y `urlDelViaje`/`volverDesdeElViaje`.

**Tech Stack:** FastAPI + asyncpg (`monitor-app/backend/api`, `venv/bin/python -m pytest`), Postgres en Supabase (`viclzoftiudkepqnhekv`, migraciones vía MCP), dbt en Mage (espejo `.mage-agent/local_sync/dbt/tms`), Next.js + vitest (`monitor-app/frontend`).

**Spec:** `docs/superpowers/specs/2026-10-10-cierre-motivos-de-anulacion-y-ajustes-design.md`

## Global Constraints

- **Nombres:** los objetos de base van en inglés (`TRIP_VOID_REASON`, `void_reason_id`, `void_note`); los archivos de migración y el código Python, en español, como el resto del repo.
- **Texto de la interfaz:** rutas en inglés y etiquetas en español ("Motivos de anulación", `void-reasons`). Español neutral, nunca voseo; lo revisa `lib/copy/espanol-neutral.test.ts`. Sin emojis: solo `lucide-react`. No agregar tamaños de letra ni colores nuevos; usar los tokens existentes.
- **Catálogo:** los valores iniciales con `code` son DUPLICADO / Duplicado, CARGADO_POR_ERROR / Cargado por error, DATOS_INCORRECTOS / Datos incorrectos (se registró de nuevo) y OTRO / Otro.
- **Comentario:** `note` es obligatorio solo si el motivo tiene `code = 'OTRO'`.
- **Permisos:** la regla de quién anula no cambia.
- **Mage:** el modelo `trips` tiene `on_schema_change='sync_all_columns'`, así que cada migración que cambia columnas de `app.trips` va en la misma ventana entre corridas que el cambio del modelo en Mage (`sync_local_to_remote`). Antes de aplicar, confirmar la cadencia (~:06, :20, :36, :50) con `max(pipeline_updated_at)`.
- **Tests de integración:** van en una transacción revertida (`conexion_revertida`), con datos propios en días de 2099. Antes de dar por bueno un test, se rompe el código y se confirma que falla (mutación).

## Review Focus

1. **"Otro" renombrado.** Si en Configuración se renombra "Otro" (por ejemplo, a "Otra razón"), el comentario sigue siendo obligatorio, porque la regla mira `code`, no la etiqueta. Lo prueba la Task 2, `test_otro_renombrado_sigue_exigiendo_nota`.
2. **Motivo desactivado después de usarse.** Un viaje anulado con un motivo que luego se desactiva sigue mostrando su etiqueta en el detalle y en los ajustes, porque el join no filtra `active`. Ya no se ofrece para anulaciones nuevas. Lo prueba la Task 2, `test_motivo_desactivado_se_sigue_leyendo_y_no_se_ofrece`.
3. **Un motivo de otro dominio.** Si se manda un `reason_id` de `TRIP_UNASSIGNED_REASON` al anular, responde 422 y no anula nada. Lo prueba la Task 2, `test_motivo_de_otro_dominio_es_422`.
4. **Rechazo del backend con la barra.** Si el backend rechaza la anulación desde la barra, el motivo y el comentario se conservan para reintentar. Lo prueba la Task 4, `conserva el motivo si el backend rechaza`.
5. **Volver con un `next` externo.** Con `?next=https://evil.com`, el vínculo dice "Volver al Monitor" y lleva al Monitor, por el mismo resguardo de `destinoSeguro`. Lo prueba la Task 6, `etiquetaDeVuelta` con destino externo.

---

### Task 1: Expand — catálogo `TRIP_VOID_REASON`, columnas nuevas y modelo dbt

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261011000000_motivos_de_anulacion.sql`
- Modify: `.mage-agent/local_sync/dbt/tms/models/app/trips.sql` (`merge_exclude_columns`, rama TMS, rama manual)
- Modify: `monitor-app/backend/api/tests/test_dbt_anulacion.py`
- Test: `monitor-app/backend/api/tests/test_motivos_de_anulacion_integracion.py`

**Interfaces:**
- Produces:
  - filas `app.status_taxonomies (domain='TRIP_VOID_REASON', code IN ('DUPLICADO','CARGADO_POR_ERROR','DATOS_INCORRECTOS','OTRO'))`;
  - columnas `void_reason_id uuid` y `void_note text` en `app.trips_manual` y `app.trips`;
  - el CHECK de transición `ck_*_void_complete`;
  - `void_reason` (texto) sigue existiendo hasta la Task 7.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_motivos_de_anulacion_integracion.py`:

```python
"""El catálogo de motivos de anulación y la carga de los anulados existentes
(spec 2026-10-10 motivos de anulación, §2.1)."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integracion


async def test_el_catalogo_tiene_los_cuatro_motivos_iniciales(conexion_revertida):
    filas = await conexion_revertida.fetch(
        "SELECT code, label FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' ORDER BY sort_order")
    assert [(f["code"], f["label"]) for f in filas] == [
        ("DUPLICADO", "Duplicado"),
        ("CARGADO_POR_ERROR", "Cargado por error"),
        ("DATOS_INCORRECTOS", "Datos incorrectos (se registró de nuevo)"),
        ("OTRO", "Otro"),
    ]


async def test_todo_viaje_anulado_tiene_motivo_de_catalogo(conexion_revertida):
    """Los 6 duplicados del 23/09 quedan con DUPLICADO, en las dos tablas."""
    for tabla in ("app.trips", "app.trips_manual"):
        sin_motivo = await conexion_revertida.fetchval(
            f"SELECT count(*) FROM {tabla} t LEFT JOIN app.status_taxonomies r ON r.id = t.void_reason_id "
            "WHERE t.voided_at IS NOT NULL AND (r.domain IS DISTINCT FROM 'TRIP_VOID_REASON')")
        assert sin_motivo == 0, tabla
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.trips t JOIN app.status_taxonomies r ON r.id = t.void_reason_id "
        "WHERE t.planning_date = '2026-09-23' AND r.code = 'DUPLICADO'") == 6
```

En `tests/test_dbt_anulacion.py`, reemplaza `COLUMNAS = ("voided_at", "voided_by", "void_reason")` por:

```python
COLUMNAS = ("voided_at", "voided_by", "void_reason_id", "void_note")
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_dbt_anulacion.py tests/test_motivos_de_anulacion_integracion.py -q`
Expected: FAIL. Faltan `'void_reason_id'` en el modelo, el catálogo está vacío (`[] == [...]`) y la columna `void_reason_id` no existe.

- [ ] **Step 3: Escribir la migración**

`monitor-app/backend/supabase/migrations/20261011000000_motivos_de_anulacion.sql`:

```sql
-- Motivos de anulación de catálogo (spec 2026-10-10 motivos de anulación, §2). EXPAND.
--
-- El motivo deja de ser texto libre: se elige de TRIP_VOID_REASON (mismo catálogo que
-- TRIP_UNASSIGNED_REASON, dominio aparte: anular corrige un registro, no es un resultado
-- de negocio). void_reason_id + void_note reemplazan a void_reason en tres fases:
-- este expand (columnas nuevas, carga, CHECK de transición), el despliegue de la API que
-- ya no lee void_reason, y el contract (20261011010000) que la retira. El modelo dbt
-- `trips` se actualiza en Mage en la MISMA ventana (sync_all_columns).

BEGIN;

INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order, active)
VALUES
    ('TRIP_VOID_REASON', 'DUPLICADO',         'Duplicado',                               '#f3f4f6', '#374151', 1, true),
    ('TRIP_VOID_REASON', 'CARGADO_POR_ERROR', 'Cargado por error',                       '#f3f4f6', '#374151', 2, true),
    ('TRIP_VOID_REASON', 'DATOS_INCORRECTOS', 'Datos incorrectos (se registró de nuevo)', '#f3f4f6', '#374151', 3, true),
    ('TRIP_VOID_REASON', 'OTRO',              'Otro',                                    '#f3f4f6', '#374151', 4, true);

ALTER TABLE app.trips_manual
    ADD COLUMN void_reason_id uuid REFERENCES app.status_taxonomies (id),
    ADD COLUMN void_note text;
-- Sin FK en app.trips: el --full-refresh de dbt la recrea y borra las FK.
ALTER TABLE app.trips
    ADD COLUMN void_reason_id uuid,
    ADD COLUMN void_note text;

-- Los anulados existentes (los 6 duplicados del 23/09) pasan a DUPLICADO.
DO $$
DECLARE
    otros int;
BEGIN
    SELECT count(*) INTO otros FROM app.trips_manual
    WHERE voided_at IS NOT NULL AND void_reason IS DISTINCT FROM 'Duplicado';
    IF otros > 0 THEN
        RAISE EXCEPTION 'Hay % anulados con un motivo distinto de "Duplicado": mapearlos a mano', otros;
    END IF;
END $$;

UPDATE app.trips_manual SET void_reason_id = r.id
FROM app.status_taxonomies r
WHERE r.domain = 'TRIP_VOID_REASON' AND r.code = 'DUPLICADO' AND app.trips_manual.voided_at IS NOT NULL;

UPDATE app.trips SET void_reason_id = r.id
FROM app.status_taxonomies r
WHERE r.domain = 'TRIP_VOID_REASON' AND r.code = 'DUPLICADO' AND app.trips.voided_at IS NOT NULL;

-- CHECK de transición: mientras la API vieja siga desplegada escribe void_reason sin
-- void_reason_id. El contract deja el definitivo.
ALTER TABLE app.trips_manual DROP CONSTRAINT ck_trips_manual_void_complete;
ALTER TABLE app.trips_manual ADD CONSTRAINT ck_trips_manual_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NOT NULL OR (void_reason IS NULL AND void_reason_id IS NULL AND void_note IS NULL))
    AND (voided_at IS NULL OR void_reason IS NOT NULL OR void_reason_id IS NOT NULL));
ALTER TABLE app.trips DROP CONSTRAINT ck_trips_void_complete;
ALTER TABLE app.trips ADD CONSTRAINT ck_trips_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NOT NULL OR (void_reason IS NULL AND void_reason_id IS NULL AND void_note IS NULL))
    AND (voided_at IS NULL OR void_reason IS NOT NULL OR void_reason_id IS NOT NULL));

COMMIT;
```

- [ ] **Step 4: Cambiar el modelo dbt (agregar sin quitar)**

En `.mage-agent/local_sync/dbt/tms/models/app/trips.sql`:
- En `merge_exclude_columns`, `'voided_at', 'voided_by', 'void_reason'` pasa a ser `'voided_at', 'voided_by', 'void_reason', 'void_reason_id', 'void_note'`.
- En la rama TMS, después de `NULL::text          AS void_reason,`, agrega:

```sql
    NULL::uuid          AS void_reason_id,
    NULL::text          AS void_note,
```

- En la rama manual, después de `m.void_reason                                       AS void_reason,`, agrega:

```sql
    m.void_reason_id                                    AS void_reason_id,
    m.void_note                                         AS void_note,
```

- [ ] **Step 5: Ensayar con ROLLBACK y aplicar en la ventana**

1. Consulta la cadencia con `SELECT max(pipeline_updated_at) FROM app.trips`. Elige una ventana justo después de una escritura de Mage.
2. Ensaya con `mcp__claude_ai_Supabase__execute_sql`: el cuerpo de la migración con `ROLLBACK` en vez de `COMMIT`. Expected: sin error.
3. Aplica con `mcp__claude_ai_Supabase__apply_migration` (name `motivos_de_anulacion`, el cuerpo sin `BEGIN`/`COMMIT`). Inmediatamente después, `mcp__mage-agent__sync_local_to_remote` sobre `/Users/usuario/Desktop/projects/webcarga/.mage-agent/local_sync`.
4. Después de la corrida siguiente, verifica:

```sql
SELECT max(pipeline_updated_at),
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='app' AND table_name='trips'
        AND column_name IN ('void_reason','void_reason_id','void_note')) AS columnas
FROM app.trips;
```

Expected: una escritura posterior a la sincronización y `columnas = 3`.

- [ ] **Step 6: Correr y verificar que pasan; mutación**

Run: `venv/bin/python -m pytest tests/test_dbt_anulacion.py tests/test_motivos_de_anulacion_integracion.py -q`
Expected: PASS (4 tests).

Mutación: en el espejo, quita `'void_note'` de `merge_exclude_columns`, corre `test_dbt_anulacion.py` y confirma que falla (FAIL). Restáuralo.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261011000000_motivos_de_anulacion.sql \
        monitor-app/backend/api/tests/test_dbt_anulacion.py \
        monitor-app/backend/api/tests/test_motivos_de_anulacion_integracion.py
git commit -m "feat(db): catálogo de motivos de anulación y columnas void_reason_id/void_note (expand)"
```

---

### Task 2: Backend — anular con motivo de catálogo, lectura de etiqueta y nota

**Files:**
- Modify: `monitor-app/backend/api/app/services/anular_viajes.py`
- Modify: `monitor-app/backend/api/app/schemas/trip.py` (`TripVoidBody`)
- Modify: `monitor-app/backend/api/app/routers/trips.py` (`void_trips`)
- Modify: `monitor-app/backend/api/app/services/cierre_lineas.py` (`_SQL_AJUSTES`)
- Modify: `monitor-app/backend/api/tests/test_anular_viajes_integracion.py`, `test_firma_versionada_integracion.py`, `test_ajustes_posteriores_integracion.py`, `test_cierre_viajes.py` (llamadas a `anular_viajes`)
- Modify: `monitor-app/backend/api/tests/test_daily_closures.py` (forma del ajuste)

**Interfaces:**
- Consumes: el catálogo y las columnas de la Task 1.
- Produces:
  - `anular_viajes(conn, trip_ids: list[str], reason_id: str, note: str | None, user: dict) -> int`;
  - `TripVoidBody {trip_ids: list[UUID], reason_id: UUID, note: str | None = None}`;
  - el detalle y el listado agregan `void_reason_id: str | None`, `void_reason_label: str | None` y `void_note: str | None`, y ya no `void_reason`;
  - cada ítem de `cierre.ajustes` tiene `trip_id`, `tipo`, `source_system_trip_id`, `client_name`, `voided_at`, `voided_by_name`, `void_reason_label` y `void_note`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_anular_viajes_integracion.py`, agrega un helper y cambia la firma de todas las llamadas existentes. `anular_viajes(conn, ids, "Duplicado", user)` pasa a `anular_viajes(conn, ids, await _motivo(conn), None, user)`, y `"Otra vez"` pasa a `await _motivo(conn, "CARGADO_POR_ERROR")`:

```python
async def _motivo(conn, code: str = "DUPLICADO") -> str:
    return str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' AND code = $1", code))
```

Cambia los asserts que leen el texto:
- `_anulado` lee `t.void_reason_id::text, t.void_note, m.void_reason_id::text AS m_reason`, en vez de `t.void_reason` y `m.void_reason AS m_reason`.
- En `test_quien_lo_creo_lo_anula_con_motivo_y_queda_auditado`, la comparación pasa a `(fila["voided_by"], fila["void_reason_id"], fila["m_reason"]) == (usuario["sub"], motivo, motivo)` con `motivo = await _motivo(conn)`, y el detalle a `(detalle["void_reason_label"], detalle["can_void"], detalle["can_revert_void"]) == ("Duplicado", False, True)`.
- `test_sin_motivo_no_se_anula` pasa a `test_sin_motivo_de_catalogo_no_se_anula`: llama a `anular_viajes(conn, [tid], "", None, usuario)` y espera 422.

Agrega:

```python
async def test_motivo_de_otro_dominio_es_422(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    no_asignacion = str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_UNASSIGNED_REASON' AND active LIMIT 1"))
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], no_asignacion, None, usuario)
    assert err.value.status_code == 422
    assert (await _anulado(conn, tid))["voided_at"] is None


async def test_otro_exige_nota_y_con_nota_anula(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    otro = await _motivo(conn, "OTRO")
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], otro, "  ", usuario)
    assert err.value.status_code == 422

    assert await anular_viajes(conn, [tid], otro, "El cliente lo canceló por correo", usuario) == 1
    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert (detalle["void_reason_label"], detalle["void_note"]) == ("Otro", "El cliente lo canceló por correo")


async def test_otro_renombrado_sigue_exigiendo_nota(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    otro = await _motivo(conn, "OTRO")
    await conn.execute("UPDATE app.status_taxonomies SET label = 'Otra razón' WHERE id = $1::uuid", otro)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], otro, None, usuario)
    assert err.value.status_code == 422


async def test_motivo_desactivado_se_sigue_leyendo_y_no_se_ofrece(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    motivo = await _motivo(conn, "CARGADO_POR_ERROR")
    await anular_viajes(conn, [tid], motivo, None, usuario)
    await conn.execute("UPDATE app.status_taxonomies SET active = false WHERE id = $1::uuid", motivo)

    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert detalle["void_reason_label"] == "Cargado por error"
    otro_viaje = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [otro_viaje], motivo, None, usuario)
    assert err.value.status_code == 422


async def test_revertir_limpia_motivo_y_nota(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn, "OTRO"), "nota", usuario)
    await revertir_anulacion(conn, [tid], usuario)
    fila = await _anulado(conn, tid)
    assert (fila["voided_at"], fila["void_reason_id"], fila["void_note"]) == (None, None, None)
```

En `tests/test_ajustes_posteriores_integracion.py`:
- `anular_viajes(conn, [sale], "Duplicado", admin)` pasa a `anular_viajes(conn, [sale], await _motivo(conn), None, admin)`. Copia el mismo helper `_motivo`.
- El assert pasa a `(ajustes[sale]["tipo"], ajustes[sale]["void_reason_label"]) == ("quitado", "Duplicado")`.

En `tests/test_firma_versionada_integracion.py`, en los dos tests que anulan, cambia la llamada a `anular_viajes(conn, [tid], await _motivo(conn), None, admin)`, con el mismo helper.

En `tests/test_daily_closures.py`, en `test_get_daily_closure_status_reports_closed_day`, el dict `ajuste` reemplaza `"void_reason": "Duplicado"` por `"void_reason_label": "Duplicado", "void_note": None`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `venv/bin/python -m pytest tests/test_anular_viajes_integracion.py tests/test_ajustes_posteriores_integracion.py -q`
Expected: FAIL con `TypeError: anular_viajes() takes 4 positional arguments but 5 were given` (o parecido) y `KeyError: 'void_reason_label'`.

- [ ] **Step 3: Implementar**

En `app/services/anular_viajes.py`:

1. Docstring: el motivo se elige del catálogo `TRIP_VOID_REASON` (app.status_taxonomies); el comentario es opcional y pasa a obligatorio con `code = 'OTRO'`. La regla mira el `code`, no la etiqueta, para que renombrar "Otro" no la rompa.
2. `SQL_COLUMNAS_ANULABLE`: reemplaza `t.voided_at, t.void_reason,` por:

```python
    t.voided_at, t.void_reason_id::text AS void_reason_id, void_rs.label AS void_reason_label, t.void_note,
```

3. `SQL_JOIN_ANULABLE` agrega, sin filtrar `active`, para que un motivo desactivado se siga leyendo:

```python
    LEFT JOIN app.status_taxonomies void_rs ON void_rs.id = t.void_reason_id
```

4. Agrega, antes de `anular_viajes`:

```python
async def _motivo_valido(conn, reason_id: str | None, note: str | None) -> tuple[str, str, str | None]:
    """(id, etiqueta, nota limpia) del motivo, o 422. El motivo es del catálogo
    TRIP_VOID_REASON y está activo; la nota es obligatoria si su código es OTRO."""
    if not reason_id:
        raise HTTPException(422, "Elige un motivo de anulación")
    try:
        fila = await conn.fetchrow(
            "SELECT id::text AS id, label, code FROM app.status_taxonomies "
            "WHERE id = $1::uuid AND domain = 'TRIP_VOID_REASON' AND active",
            reason_id,
        )
    except (asyncpg.DataError, ValueError):
        fila = None
    if fila is None:
        raise HTTPException(422, "Motivo de anulación inválido")
    nota = (note or "").strip() or None
    if fila["code"] == "OTRO" and nota is None:
        raise HTTPException(422, "Con «Otro» escribe un comentario que diga por qué")
    return fila["id"], fila["label"], nota
```

Agrega `import asyncpg` arriba.

5. `anular_viajes` queda así:

```python
async def anular_viajes(conn, trip_ids: list[str], reason_id: str | None, note: str | None, user: dict) -> int:
    """Anula los viajes, todo o nada. Debe correr dentro de una transacción."""
    motivo_id, etiqueta, nota = await _motivo_valido(conn, reason_id, note)
    ids = await _validar(conn, trip_ids, user, revertir=False)
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = now(), voided_by = $2::uuid, "
            "void_reason_id = $3::uuid, void_note = $4 WHERE id = ANY($1::uuid[])",
            ids, user["sub"], motivo_id, nota,
        )
    for tid in ids:
        await log_change(conn, actor=user["sub"], entity_type="TRIP", entity_id=tid, action="void",
                         field="voided_at", new_value={"reason_id": motivo_id, "reason": etiqueta, "note": nota})
    return len(ids)
```

6. En `revertir_anulacion`:
   - La lectura previa pasa a `SELECT t.id::text, r.label AS motivo, t.void_note FROM app.trips t LEFT JOIN app.status_taxonomies r ON r.id = t.void_reason_id WHERE t.id = ANY($1::uuid[])`.
   - El `UPDATE` limpia `voided_at = NULL, voided_by = NULL, void_reason_id = NULL, void_note = NULL`. No toca `void_reason`, que la Task 7 retira y en este momento ya es NULL para toda anulación nueva.
   - El `old_value` queda `{"reason": motivo, "note": nota}`.

En `app/schemas/trip.py`:

```python
class TripVoidBody(BaseModel):
    """Viajes manuales a anular, con el motivo del catálogo TRIP_VOID_REASON y un
    comentario (obligatorio si el motivo es «Otro»). UUID, no str: un id mal formado
    es un 422 de validación, no un DataError de asyncpg convertido en 500."""
    trip_ids:  list[UUID]
    reason_id: UUID
    note:      str | None = None
```

En `app/routers/trips.py` (`void_trips`), la llamada queda así:

```python
            n = await anular_viajes(conn, [str(t) for t in body.trip_ids], str(body.reason_id), body.note, user)
```

En `app/services/cierre_lineas.py` (`_SQL_AJUSTES`), reemplaza `t.voided_at, p.full_name AS voided_by_name, t.void_reason` por `t.voided_at, p.full_name AS voided_by_name, r.label AS void_reason_label, t.void_note`, y agrega `LEFT JOIN app.status_taxonomies r ON r.id = t.void_reason_id` después del join de `profiles`.

Run: `grep -rn "void_reason\b" app` (el `\b` excluye `void_reason_id` y `void_reason_label`).
Expected: sin resultados.

- [ ] **Step 4: Correr y verificar que pasan; mutación**

Run: `venv/bin/python -m pytest tests/test_anular_viajes_integracion.py tests/test_ajustes_posteriores_integracion.py tests/test_firma_versionada_integracion.py tests/test_daily_closures.py -q`
Expected: PASS.

Mutación: en `_motivo_valido`, cambia `fila["code"] == "OTRO"` por `fila["label"] == "Otro"`, corre `test_otro_renombrado_sigue_exigiendo_nota` y confirma que falla (FAIL). Restáuralo.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app monitor-app/backend/api/tests
git commit -m "feat(viajes): anular con motivo de catálogo y comentario (obligatorio con Otro)"
```

---

### Task 3: Configuración — sección "Motivos de anulación"

**Files:**
- Modify: `monitor-app/frontend/lib/api/config.ts:77-86` (`TaxonomyDomain`)
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/flota-tabs.tsx` (`MotivosAnulacionTab`)
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/dominios.ts:92-93`
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/secciones.ts` (permiso de la sección, si `ClaveDeSeccion` lo exige)
- Modify: `monitor-app/backend/api/app/services/revisiones.py:90`, `monitor-app/backend/api/app/routers/config.py:433,485`
- Test: el test existente de `dominios`/`secciones` (`app/dashboard/admin/settings/*.test.ts*`) y `tests/test_revisiones*.py`

**Interfaces:**
- Produces: `TaxonomyDomain` incluye `'TRIP_VOID_REASON'`; existe la sección `void-reasons` en el dominio de Operaciones.

- [ ] **Step 1: Escribir los tests que fallan**

Abre los tests existentes de `dominios.ts` (`grep -rln "unassigned-reasons" monitor-app/frontend/app/dashboard/admin/settings`) y agrega, con su estilo:

```ts
it('Operaciones tiene "Motivos de anulación", aparte de los de no asignación', () => {
  const ops = DOMINIOS.find(d => d.clave === 'operations')!
  const claves = ops.secciones.map(s => s.clave)
  expect(claves).toContain('void-reasons')
  expect(claves.indexOf('void-reasons')).toBe(claves.indexOf('unassigned-reasons') + 1)
})
```

(Usa el nombre real del arreglo exportado, `DOMINIOS` u otro, y la clave real del dominio de Operaciones.)

En backend, en el test que recorre los revisables (`grep -rln "unassigned-reasons" monitor-app/backend/api/tests`), agrega `("operations", "void-reasons")` a la lista esperada. Si no hay un test así, agrega en `tests/test_revisiones.py`:

```python
def test_los_motivos_de_anulacion_se_revisan_como_los_demas_vocabularios():
    from app.services.revisiones import REVISABLES
    assert any(r.dominio == "operations" and r.seccion == "void-reasons" and r.vocabulario == "TRIP_VOID_REASON"
               for r in REVISABLES)
```

(Usa el nombre real de la colección y de los atributos de `Revisable`, que se leen en `app/services/revisiones.py`.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/frontend && npx vitest run app/dashboard/admin/settings` y `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_revisiones.py -q`
Expected: FAIL, porque la clave `void-reasons` no existe.

- [ ] **Step 3: Implementar**

`lib/api/config.ts`, en el tipo `TaxonomyDomain`, después de `| 'TRIP_UNASSIGNED_REASON'`:

```ts
  // Por qué se anuló un viaje manual (spec 2026-10-10): corrige un registro mal
  // cargado. No confundir con TRIP_UNASSIGNED_REASON, que es un resultado de negocio.
  | 'TRIP_VOID_REASON'
```

`flota-tabs.tsx`:

```tsx
export function MotivosAnulacionTab() {
  return (
    <TaxonomyTab
      domain="TRIP_VOID_REASON"
      title="Motivos de anulación"
      hint="Por qué se anula un viaje cargado en la app: un duplicado, un error. Con «Otro» se exige un comentario."
      newLabel="motivo"
    />
  )
}
```

`dominios.ts`: importa `MotivosAnulacionTab` y, después de la sección `unassigned-reasons`, agrega:

```ts
      { clave: 'void-reasons', titulo: 'Motivos de anulación',
        proposito: 'Por qué se anula un viaje cargado en la app', Panel: MotivosAnulacionTab },
```

Si `ClaveDeSeccion` y `PERMISO_DE_SECCION` (`secciones.ts`) exigen declarar la clave, agrégala con el mismo permiso que `unassigned-reasons`.

`app/services/revisiones.py`, después de la línea de `unassigned-reasons`:

```python
    _taxonomia("operations", "void-reasons", "TRIP_VOID_REASON"),
```

`app/routers/config.py`, en `_INVENTARIO_SQL`, después de `motivos_no_asignacion`:

```python
  (SELECT count(*) FROM app.status_taxonomies WHERE domain='TRIP_VOID_REASON' AND active) AS motivos_anulacion,
```

Y en `"operations": _pares(...)`, después del par de no asignación:

```python
            ("motivos_anulacion", "motivo de anulación", "motivos de anulación"),
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run app/dashboard/admin/settings && npx tsc --noEmit` y `venv/bin/python -m pytest tests/test_revisiones.py tests/test_config*.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/api/config.ts monitor-app/frontend/app/dashboard/admin/settings \
        monitor-app/backend/api/app/services/revisiones.py monitor-app/backend/api/app/routers/config.py monitor-app/backend/api/tests
git commit -m "feat(config): sección Motivos de anulación, aparte de los de no asignación"
```

---

### Task 4: Frontend — elegir el motivo al anular (detalle y barra)

**Files:**
- Create: `monitor-app/frontend/hooks/useMotivosDeAnulacion.ts`
- Modify: `monitor-app/frontend/components/ui/BarraDeSeleccion.tsx`
- Modify: `monitor-app/frontend/components/dashboard/AnularViaje.tsx`, `AnularViaje.test.tsx`
- Modify: `monitor-app/frontend/hooks/useAnularViajes.ts`, `useAnularViajes.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx` (barra)
- Modify: `monitor-app/frontend/lib/api/trips.ts` (`voidTrips`), `monitor-app/frontend/lib/types.ts` (`Trip`)
- Modify: `monitor-app/frontend/components/dashboard/TripDetailView.tsx` (aviso), `TripDetailView.test.tsx`
- Test: `monitor-app/frontend/components/ui/BarraDeSeleccion.test.tsx` (crear si no existe)

**Interfaces:**
- Consumes: `POST /api/v1/trips/void {trip_ids, reason_id, note?}` de la Task 2; `taxonomiesApi.list('TRIP_VOID_REASON')` de la Task 3.
- Produces:
  - `type MotivoDeAnulacion = { id: string; label: string; pideNota: boolean }`;
  - `useMotivosDeAnulacion(): { motivos: MotivoDeAnulacion[]; cargando: boolean }`;
  - `tripsApi.voidTrips(tripIds: string[], reasonId: string, note?: string)`;
  - `useAnularViajes(...).anularSeleccion(eleccion: EleccionDeMotivo)` y `anular(ids, eleccion)`, con `type EleccionDeMotivo = { motivoId: string; nota: string }`;
  - `BarraDeSeleccion`: `destructiva.motivos?: { etiqueta: string; opciones: MotivoDeAnulacion[] }` y `onConfirmar: (eleccion?: EleccionDeMotivo) => void | Promise<boolean | void>`;
  - `Trip` agrega `void_reason_id`, `void_reason_label` y `void_note`, y ya no `void_reason`.

- [ ] **Step 1: Escribir los tests que fallan**

`components/ui/BarraDeSeleccion.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BarraDeSeleccion } from './BarraDeSeleccion'

const opciones = [
  { id: 'dup', label: 'Duplicado', pideNota: false },
  { id: 'otro', label: 'Otro', pideNota: true },
]

function montar(onConfirmar = vi.fn()) {
  render(
    <BarraDeSeleccion seleccionados={2} ayuda="marca" onLimpiar={() => {}}
      destructiva={{ etiqueta: 'Anular 2 viajes', advertencia: 'Quedan anulados', confirmacion: 'Sí, anular 2',
                     motivos: { etiqueta: 'Motivo', opciones }, onConfirmar }} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /anular 2 viajes/i }))
  return onConfirmar
}

describe('BarraDeSeleccion con motivo de catálogo', () => {
  it('no confirma sin motivo', () => {
    montar()
    expect(screen.getByRole('button', { name: /sí, anular 2/i })).toBeDisabled()
  })

  it('con «Otro» no confirma sin comentario', () => {
    montar()
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'otro' } })
    expect(screen.getByRole('button', { name: /sí, anular 2/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/comentario/i), { target: { value: 'por correo' } })
    expect(screen.getByRole('button', { name: /sí, anular 2/i })).toBeEnabled()
  })

  it('manda el motivo y el comentario', async () => {
    const onConfirmar = montar(vi.fn().mockResolvedValue(true))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'dup' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular 2/i }))
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith({ motivoId: 'dup', nota: '' }))
  })

  it('conserva el motivo si el backend rechaza', async () => {
    montar(vi.fn().mockResolvedValue(false))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'otro' } })
    fireEvent.change(screen.getByLabelText(/comentario/i), { target: { value: 'por correo' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular 2/i }))
    await waitFor(() => expect(screen.getByLabelText(/comentario/i)).toHaveValue('por correo'))
    expect(screen.getByLabelText(/motivo/i)).toHaveValue('otro')
  })
})
```

En `AnularViaje.test.tsx`:
- Agrega el mock de `@/hooks/useMotivosDeAnulacion`:

```tsx
vi.mock('@/hooks/useMotivosDeAnulacion', () => ({
  useMotivosDeAnulacion: () => ({ cargando: false, motivos: [
    { id: 'dup', label: 'Duplicado', pideNota: false },
    { id: 'otro', label: 'Otro', pideNota: true },
  ] }),
}))
```

- Reemplaza el test "anula con el motivo escrito" por:

```tsx
  it('anula con el motivo elegido', async () => {
    voidTrips.mockResolvedValue({ ok: true, voided: 1 })
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'dup' } })
    fireEvent.click(screen.getByRole('button', { name: /sí, anular/i }))
    await waitFor(() => expect(voidTrips).toHaveBeenCalledWith(['t1'], 'dup', undefined))
  })

  it('con «Otro» exige comentario', () => {
    montar({ can_void: true })
    fireEvent.click(screen.getByRole('button', { name: /anular viaje/i }))
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'otro' } })
    expect(screen.getByRole('button', { name: /sí, anular/i })).toBeDisabled()
  })
```

En `useAnularViajes.test.tsx`:
- `anularSeleccion('Duplicado')` pasa a `anularSeleccion({ motivoId: 'dup', nota: '' })`.
- La expectativa pasa a `toHaveBeenCalledWith(['a', 'c'], 'dup', undefined)`; en el otro test, `(['a'], 'dup', undefined)`.

En `TripDetailView.test.tsx`, el test de anulación usa `void_reason_label: 'Duplicado', void_note: 'por correo'` en vez de `void_reason`, y además espera `screen.getByText(/por correo/i)`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/ui/BarraDeSeleccion.test.tsx components/dashboard/AnularViaje.test.tsx hooks/useAnularViajes.test.tsx components/dashboard/TripDetailView.test.tsx`
Expected: FAIL. No existe un campo con etiqueta "Motivo" de tipo select, y la firma de `voidTrips` no coincide.

- [ ] **Step 3: Implementar**

`hooks/useMotivosDeAnulacion.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import { taxonomiesApi } from '@/lib/api/config'

/** Un motivo del catálogo TRIP_VOID_REASON. `pideNota`: el comentario es
 *  obligatorio. Lo decide el código (OTRO), no la etiqueta, así renombrar
 *  "Otro" en Configuración no rompe la regla — la misma que aplica el backend
 *  (services/anular_viajes.py). */
export type MotivoDeAnulacion = { id: string; label: string; pideNota: boolean }

export type EleccionDeMotivo = { motivoId: string; nota: string }

/** Los motivos activos de anulación, en el orden de Configuración. */
export function useMotivosDeAnulacion(): { motivos: MotivoDeAnulacion[]; cargando: boolean } {
  const q = useQuery({
    queryKey: ['taxonomies', 'TRIP_VOID_REASON'],
    queryFn: () => taxonomiesApi.list('TRIP_VOID_REASON'),
    staleTime: 5 * 60_000,
  })
  return {
    cargando: q.isLoading,
    motivos: (q.data ?? []).map(r => ({ id: r.id, label: r.label, pideNota: r.code === 'OTRO' })),
  }
}

/** Si la elección alcanza para confirmar: hay motivo y, si lo pide, comentario. */
export function eleccionCompleta(motivos: MotivoDeAnulacion[], e: EleccionDeMotivo): boolean {
  const m = motivos.find(x => x.id === e.motivoId)
  return !!m && (!m.pideNota || e.nota.trim().length > 0)
}
```

Antes, confirma que `GET /config/taxonomies` devuelve `code` (`backend/api/app/routers/status_taxonomies.py:21`). Si no lo incluye en el SELECT, agrégalo en esa línea y en su test.

`lib/types.ts`, en `Trip`, reemplaza `void_reason?: string | null` por:

```ts
  void_reason_id?:      string | null
  /** Etiqueta del motivo del catálogo TRIP_VOID_REASON (aunque después se desactive). */
  void_reason_label?:   string | null
  /** Comentario de la anulación; obligatorio con «Otro». */
  void_note?:           string | null
```

`lib/api/trips.ts`, en `voidTrips`:

```ts
  voidTrips: (tripIds: string[], reasonId: string, note?: string) =>
    apiFetch<{ ok: boolean; voided: number }>(`/api/v1/trips/void`, {
      method: 'POST',
      body: JSON.stringify({ trip_ids: tripIds, reason_id: reasonId, note: note || undefined }),
    }),
```

`components/ui/BarraDeSeleccion.tsx`:
- Reemplaza `pideMotivo?: string` y la firma de `onConfirmar` en `AccionDestructiva` por:

```ts
  /** Si la acción exige un motivo de catálogo: la etiqueta y las opciones. El
   *  comentario aparece debajo y es obligatorio si la opción lo pide. */
  motivos?:     { etiqueta: string; opciones: MotivoDeAnulacion[] }
  /** Devuelve `false` si el backend rechazó: la barra conserva lo elegido para
   *  reintentar. Sin motivo, se llama sin argumentos. */
  onConfirmar:  (eleccion?: EleccionDeMotivo) => void | boolean | Promise<boolean | void>
```

- El estado pasa de `motivo` a `const [eleccion, setEleccion] = useState<EleccionDeMotivo>({ motivoId: '', nota: '' })`. Calcula `const listo = !destructiva?.motivos || eleccionCompleta(destructiva.motivos.opciones, eleccion)`.
- En la rama `confirmando`, reemplaza el `<label>` de texto por:

```tsx
          {destructiva.motivos && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-white/80">
                {destructiva.motivos.etiqueta}
                <select
                  value={eleccion.motivoId}
                  onChange={e => setEleccion(prev => ({ ...prev, motivoId: e.target.value }))}
                  className="rounded bg-white/10 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                  autoFocus
                >
                  <option value="" className="text-text-primary">Elige…</option>
                  {destructiva.motivos.opciones.map(o => (
                    <option key={o.id} value={o.id} className="text-text-primary">{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-white/80">
                Comentario
                <input
                  value={eleccion.nota}
                  onChange={e => setEleccion(prev => ({ ...prev, nota: e.target.value }))}
                  className="rounded bg-white/10 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                />
              </label>
            </>
          )}
```

- El botón de confirmar queda así:

```tsx
          <button
            type="button"
            disabled={destructiva.ocupado || !listo}
            onClick={async () => {
              const ok = await destructiva.onConfirmar(destructiva.motivos ? eleccion : undefined)
              if (ok !== false) { setConfirmando(false); setEleccion({ motivoId: '', nota: '' }) }
            }}
            className="text-[11px] font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
          >
```

- "Cancelar" queda con `onClick={() => { setConfirmando(false); setEleccion({ motivoId: '', nota: '' }) }}`.
- Importa `MotivoDeAnulacion`, `EleccionDeMotivo` y `eleccionCompleta` desde `@/hooks/useMotivosDeAnulacion`.
- `TriageBulkBar` no pasa `motivos`, y su `onConfirmar` sin argumentos sigue sirviendo. Confírmalo con su test.

`hooks/useAnularViajes.ts`: `anular(tripIds: string[], eleccion: EleccionDeMotivo): Promise<boolean>` llama a `tripsApi.voidTrips(tripIds, eleccion.motivoId, eleccion.nota.trim() || undefined)`. `anularSeleccion: (eleccion: EleccionDeMotivo) => anular([...ids], eleccion)`.

`app/dashboard/operations/monitor/page.tsx`: agrega `const { motivos: motivosDeAnulacion } = useMotivosDeAnulacion()`. En `destructiva`:
- reemplaza `pideMotivo: 'Motivo',` por `motivos: { etiqueta: 'Motivo', opciones: motivosDeAnulacion },`;
- `onConfirmar` pasa a `eleccion => anulacion.anularSeleccion(eleccion!)`;
- `advertencia` queda `'Quedan anulados con su motivo; no se borran'`.

`components/dashboard/AnularViaje.tsx`:
- Reemplaza el estado `motivo` por `eleccion: EleccionDeMotivo` y usa `useMotivosDeAnulacion()`.
- En la confirmación, en vez del input de texto, va el mismo par select + "Comentario", con las clases `text-etiqueta` del componente.
- `disabled={ocupado || !eleccionCompleta(motivos, eleccion)}`.
- La acción es `correr(() => tripsApi.voidTrips([trip.id], eleccion.motivoId, eleccion.nota.trim() || undefined))`.
- Si `correr` falla, no se limpia la elección; al cancelar o al tener éxito, sí.

`components/dashboard/TripDetailView.tsx`: en el aviso "Anulado", reemplaza `{trip.void_reason && <> · Motivo: {trip.void_reason}</>}` por:

```tsx
            {trip.void_reason_label && <> · Motivo: {trip.void_reason_label}</>}
            {trip.void_note && <> · {trip.void_note}</>}
```

Run: `grep -rn "void_reason\b\|pideMotivo" --include='*.ts' --include='*.tsx' app components hooks lib`
Expected: sin resultados.

- [ ] **Step 4: Correr y verificar que pasan; mutación**

Run: `npx vitest run > /tmp/vitest_t4.txt 2>&1; tail -5 /tmp/vitest_t4.txt && npx tsc --noEmit`
Expected: todo verde y `tsc` limpio.

Mutación: en `eleccionCompleta`, quita `(!m.pideNota || ...)` (deja `return !!m`), corre `BarraDeSeleccion.test.tsx` y confirma que falla en "con «Otro» no confirma sin comentario" (FAIL). Restáuralo.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend/hooks monitor-app/frontend/components monitor-app/frontend/lib monitor-app/frontend/app/dashboard/operations/monitor
git commit -m "feat(monitor): al anular se elige el motivo del catálogo; comentario obligatorio con Otro"
```

---

### Task 5: Ajustes posteriores — indicador junto a "Cerrado" y sección en "Viajes"

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/AjustesPosterioresAlCierre.tsx`, `AjustesPosterioresAlCierre.test.tsx`
- Create: `monitor-app/frontend/components/dashboard/IndicadorDeAjustes.tsx`, `IndicadorDeAjustes.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx` (bloque superior, pestañas, `tab === 'viajes'`, `DiaCerrado`)
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.test.tsx`
- Modify: `monitor-app/frontend/lib/types.ts` (`AjustePosterior`)

**Interfaces:**
- Consumes: `cierre.ajustes` con `void_reason_label` y `void_note` (Task 2).
- Produces:
  - `<IndicadorDeAjustes cantidad onVer />`;
  - `<AjustesPosterioresAlCierre ajustes volverA />`, titulado "Después de la firma", que se renderiza dentro de la pestaña "Viajes".

- [ ] **Step 1: Escribir los tests que fallan**

`components/dashboard/IndicadorDeAjustes.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IndicadorDeAjustes } from './IndicadorDeAjustes'

describe('IndicadorDeAjustes', () => {
  it('sin ajustes no aparece', () => {
    const { container } = render(<IndicadorDeAjustes cantidad={0} onVer={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dice cuántos y lleva a verlos', () => {
    const onVer = vi.fn()
    render(<IndicadorDeAjustes cantidad={12} onVer={onVer} />)
    fireEvent.click(screen.getByRole('button', { name: /12 ajustes posteriores al cierre/i }))
    expect(onVer).toHaveBeenCalled()
  })

  it('en singular no dice "1 ajustes"', () => {
    render(<IndicadorDeAjustes cantidad={1} onVer={() => {}} />)
    expect(screen.getByRole('button', { name: /1 ajuste posterior al cierre/i })).toBeInTheDocument()
  })
})
```

En `AjustesPosterioresAlCierre.test.tsx`:
- El helper `ajuste` usa `void_reason_label: null, void_note: null`, en vez de `void_reason`.
- El caso de anulado usa `void_reason_label: 'Duplicado', void_note: 'por correo'` y además espera `getByText(/por correo/)`.
- El caso "no dice que el día se reabrió" busca `/después de la firma/i`, en vez de `/posterior al cierre/i`.

En `page.test.tsx`, agrega estos casos:

```tsx
  it('un día firmado con ajustes los cuenta junto a "Cerrado" y en la pestaña Viajes, sin bloque fijo arriba', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const ajuste = { trip_id: 'a', tipo: 'agregado' as const, source_system_trip_id: 'Q-9', client_name: 'walmart',
                     voided_at: null, voided_by_name: null, void_reason_label: null, void_note: null }
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...EMPTY_STATUS, closed: true, cierre: { total_trips_al_firmar: 3, ajustes: [ajuste, { ...ajuste, trip_id: 'b' }] },
    })
    renderPage()
    expect(await screen.findByRole('button', { name: /2 ajustes posteriores al cierre/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /viajes.*2/i })).toBeInTheDocument()
    expect(screen.queryByText(/después de la firma/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /2 ajustes posteriores al cierre/i }))
    expect(screen.getByRole('tab', { name: /viajes/i })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText(/después de la firma/i)).toBeInTheDocument()
  })

  it('un día abierto no muestra ajustes ni número en Viajes, aunque la respuesta los traiga', async () => {
    // Un día reabierto no está firmado: lo que cambió entra en su recálculo.
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const ajuste = { trip_id: 'a', tipo: 'agregado' as const, source_system_trip_id: 'Q-9', client_name: 'walmart',
                     voided_at: null, voided_by_name: null, void_reason_label: null, void_note: null }
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...EMPTY_STATUS, cierre: { total_trips_al_firmar: null, ajustes: [ajuste] },
    })
    renderPage()
    expect(await screen.findByRole('tab', { name: 'Viajes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ajustes posteriores/i })).toBeNull()
  })
```

(Si `DailyClosureStatus` exige `periodo` para renderizar `DiaCerrado`, agrégale al mock `periodo: { status: 'CLOSED', closed_by_name: 'Pablo', closed_at: '2026-08-04T23:00:00Z', override_count: 0, frozen_totals: {} }`. La forma está en el tipo `PeriodoDeCierre` de `lib/types.ts`.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run components/dashboard/IndicadorDeAjustes.test.tsx components/dashboard/AjustesPosterioresAlCierre.test.tsx app/dashboard/operations/closures/page.test.tsx`
Expected: FAIL. El módulo `IndicadorDeAjustes` no existe, no aparece el texto "Después de la firma" y el bloque sigue arriba.

- [ ] **Step 3: Implementar**

`lib/types.ts`, en `AjustePosterior`, reemplaza `void_reason: string | null` por `void_reason_label: string | null` y `void_note: string | null`.

`components/dashboard/IndicadorDeAjustes.tsx`:

```tsx
import { History } from 'lucide-react'

interface Props {
  /** Cuántos ajustes posteriores tiene la firma vigente del día. */
  cantidad: number
  /** Lleva a la pestaña "Viajes", donde está la lista. */
  onVer:    () => void
}

/** Junto al estado "Cerrado": cuántos ajustes posteriores al cierre tiene el día
 *  (spec 2026-10-10 §3). No es un aviso: el día sigue firmado y nada pide acción.
 *  Estándar de cierre de período (SAP, NetSuite): un indicador en el encabezado,
 *  el detalle en su lugar. Sin ajustes, no aparece. */
export function IndicadorDeAjustes({ cantidad, onVer }: Props) {
  if (cantidad === 0) return null
  return (
    <button
      type="button"
      onClick={onVer}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30 rounded"
    >
      <History size={13} className="shrink-0" />
      {cantidad === 1 ? '1 ajuste posterior al cierre' : `${cantidad} ajustes posteriores al cierre`}
    </button>
  )
}
```

`components/dashboard/AjustesPosterioresAlCierre.tsx`:
- El contenedor pasa de bloque de alerta a sección neutra:
  - quita el `AlertTriangle` y las clases `border-espera/20 bg-espera/5`;
  - usa `<section aria-label="Después de la firma" className="mb-5">`;
  - el título queda `<h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">Después de la firma</h3>`;
  - debajo del título, `<p className="text-xs text-text-secondary">Lo que cambió en el día desde que se firmó. La firma no cambia.</p>`.
- La lista conserva las filas y "Ver viaje", con `divide-border`.
- En cada fila, el motivo pasa a `{a.void_reason_label && <> · Motivo: {a.void_reason_label}</>}{a.void_note && <> · {a.void_note}</>}` y la fecha usa `fmtDT(a.voided_at)` (`@/lib/utils/datetime`), en vez de `toLocaleString`.
- Actualiza el docstring: ya no va arriba como aviso; vive en la pestaña "Viajes" (spec §3).

`app/dashboard/operations/closures/page.tsx`:
1. Quita `<AjustesPosterioresAlCierre ... />` del bloque superior. `HistorialDeFirmas` se queda donde está.
2. Agrega `const ajustes = diaCerrado ? (cierreQuery.data?.cierre?.ajustes ?? []) : []`.
3. En el `TABS.map`, después de `{t.label}`:

```tsx
                {t.id === 'viajes' && ajustes.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-gray-200 px-1.5 text-[10px] font-bold tabular-nums text-text-secondary">
                    {ajustes.length}
                  </span>
                )}
```

4. En `{tab === 'viajes' && (...)}`, antes de `cierreViajesQuery.isError ? ...`, envuelve en un fragmento y antepone:

```tsx
            <>
              <AjustesPosterioresAlCierre ajustes={ajustes} volverA={urlDeEsteCierre()} />
              {/* lo que ya estaba: Estado de error o PasoViajesSection */}
            </>
```

5. `DiaCerrado` recibe `ajustes: number` y `onVerAjustes: () => void`. Debajo del primer `<p>`, renderiza `<IndicadorDeAjustes cantidad={ajustes} onVer={onVerAjustes} />`. Se llama con `<DiaCerrado periodo={...} ajustes={ajustes.length} onVerAjustes={() => setTab('viajes')} />`.

- [ ] **Step 4: Correr y verificar que pasan; mutación**

Run: `npx vitest run > /tmp/vitest_t5.txt 2>&1; tail -5 /tmp/vitest_t5.txt && npx tsc --noEmit`
Expected: verde.

Mutación: en `page.tsx`, cambia `const ajustes = diaCerrado ? (...) : []` por `const ajustes = cierreQuery.data?.cierre?.ajustes ?? []`, corre `page.test.tsx` y confirma que falla en "un día abierto no muestra ajustes…" (FAIL). Restáuralo.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/frontend/components monitor-app/frontend/lib monitor-app/frontend/app/dashboard/operations/closures
git commit -m "feat(cierre): ajustes posteriores como indicador junto a Cerrado y sección en Viajes, sin bloque fijo"
```

---

### Task 6: Vuelta visible desde el detalle del viaje

**Files:**
- Modify: `monitor-app/frontend/lib/navegacion/viaje.ts`, `viaje.test.ts`
- Modify: `monitor-app/frontend/components/dashboard/TripDetailView.tsx` (prop `etiquetaVolver`), `TripDetailView.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/monitor/trips/[id]/page.tsx`, su test

**Interfaces:**
- Produces:
  - `etiquetaDeVuelta(next: string | null | undefined): string`;
  - `TripDetailView` gana `etiquetaVolver?: string`.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/navegacion/viaje.test.ts`:

```ts
describe('etiquetaDeVuelta', () => {
  it('desde el Cierre dice "Volver al Cierre"', () => {
    expect(etiquetaDeVuelta('/dashboard/operations/closures?fecha=2026-09-23&tab=viajes')).toBe('Volver al Cierre')
  })
  it('sin destino, o desde el Monitor, dice "Volver al Monitor"', () => {
    expect(etiquetaDeVuelta(null)).toBe('Volver al Monitor')
    expect(etiquetaDeVuelta('/dashboard/operations/monitor')).toBe('Volver al Monitor')
  })
  it('un destino externo no se respeta: dice "Volver al Monitor"', () => {
    expect(etiquetaDeVuelta('https://evil.com/dashboard/operations/closures')).toBe('Volver al Monitor')
  })
})
```

En `TripDetailView.test.tsx`:

```tsx
  it('con etiqueta de vuelta muestra un vínculo con texto que cierra el detalle', () => {
    const onDismiss = vi.fn()
    renderDetailView(baseTrip, { onDismiss, etiquetaVolver: 'Volver al Cierre' })
    fireEvent.click(screen.getByRole('button', { name: /volver al cierre/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
```

En el test de la página del viaje (`app/dashboard/operations/monitor/trips/[id]/page.test.tsx`), agrega un caso: con `next=/dashboard/operations/closures?fecha=2026-09-23`, aparece el botón "Volver al Cierre". Sigue el patrón del test existente que verifica `volver`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run lib/navegacion/viaje.test.ts components/dashboard/TripDetailView.test.tsx "app/dashboard/operations/monitor/trips"`
Expected: FAIL. `etiquetaDeVuelta` no existe y no hay un botón con ese texto.

- [ ] **Step 3: Implementar**

`lib/navegacion/viaje.ts`:

```ts
export const CIERRE = '/dashboard/operations/closures'

/** Qué dice el vínculo de vuelta del detalle (spec 2026-10-10 §4): adónde lleva,
 *  no un ícono suelto (NN/g). Usa el mismo destino seguro que `volverDesdeElViaje`,
 *  así la etiqueta nunca promete un lugar distinto del que se abre. */
export function etiquetaDeVuelta(next: string | null | undefined): string {
  return volverDesdeElViaje(next).startsWith(CIERRE) ? 'Volver al Cierre' : 'Volver al Monitor'
}
```

`components/dashboard/TripDetailView.tsx`:
- Agrega a `Props`:

```ts
  /** Texto del vínculo de vuelta ("Volver al Cierre"). Sin él, sólo queda el ✕. */
  etiquetaVolver?: string
```

- Al comienzo de la barra superior (antes de la insignia "Manual"/TMS), agrega:

```tsx
        {etiquetaVolver && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex items-center gap-1 text-etiqueta font-semibold text-white/70 hover:text-white shrink-0 rounded px-1.5 py-1 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            <ArrowLeft size={13} /> {etiquetaVolver}
          </button>
        )}
```

- Importa `ArrowLeft` de `lucide-react` y desestructura `etiquetaVolver` en la firma.

`app/dashboard/operations/monitor/trips/[id]/page.tsx`:
- Importa `etiquetaDeVuelta` y calcula `const etiqueta = etiquetaDeVuelta(searchParams.get('next'))`.
- Pásala como `etiquetaVolver={etiqueta}`.
- En la pantalla de error, el botón "Volver" pasa a `{etiqueta}`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run > /tmp/vitest_t6.txt 2>&1; tail -5 /tmp/vitest_t6.txt && npx tsc --noEmit && npx next build > /tmp/build_t6.txt 2>&1; tail -3 /tmp/build_t6.txt`
Expected: verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/navegacion monitor-app/frontend/components/dashboard/TripDetailView.tsx \
        monitor-app/frontend/components/dashboard/TripDetailView.test.tsx "monitor-app/frontend/app/dashboard/operations/monitor/trips"
git commit -m "feat(viaje): vínculo con texto para volver a la pantalla que abrió el detalle"
```

---

### Task 7: Despliegue, contract de `void_reason` y verificación en vivo

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261011010000_motivos_de_anulacion_contract.sql`
- Modify: `.mage-agent/local_sync/dbt/tms/models/app/trips.sql`
- Modify: `monitor-app/backend/api/tests/test_dbt_anulacion.py`
- Modify: `AGENTLOG.md`

- [ ] **Step 1: Suite completa y push**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q > /tmp/suite.txt 2>&1; tail -5 /tmp/suite.txt`
Expected: sin fallas, salvo la preexistente `test_cargar_catalogo_webcarga.py::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar`.

Run: `gh run list --branch dev --limit 3` (nada en curso), luego `git push origin dev`, y espera que "Deploy Monitor API" y "Deploy Frontend" terminen en `success` (`gh run watch`).

- [ ] **Step 2: Escribir el test del contract que falla**

En `tests/test_dbt_anulacion.py`, agrega:

```python
def test_el_texto_libre_void_reason_ya_no_esta_en_el_modelo():
    texto = _texto()
    assert "'void_reason'" not in texto
    assert "AS void_reason," not in texto
```

En `tests/test_motivos_de_anulacion_integracion.py`, agrega:

```python
async def test_la_columna_de_texto_libre_ya_no_existe(conexion_revertida):
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name IN ('trips', 'trips_manual') AND column_name = 'void_reason'") == 0
```

Run: `venv/bin/python -m pytest tests/test_dbt_anulacion.py tests/test_motivos_de_anulacion_integracion.py -q`
Expected: FAIL en los dos tests nuevos.

- [ ] **Step 3: Migración del contract y modelo**

`monitor-app/backend/supabase/migrations/20261011010000_motivos_de_anulacion_contract.sql`:

```sql
-- Motivos de anulación: CONTRACT (spec 2026-10-10 motivos de anulación, §2.1).
-- La API desplegada ya no lee ni escribe void_reason. Se retira y el CHECK queda
-- definitivo: anulado ⇔ quién y motivo de catálogo; el comentario es opcional.
-- El modelo dbt `trips` deja de llevarla en la MISMA ventana (sync_all_columns).

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app.trips_manual WHERE voided_at IS NOT NULL AND void_reason_id IS NULL)
       OR EXISTS (SELECT 1 FROM app.trips WHERE voided_at IS NOT NULL AND void_reason_id IS NULL) THEN
        RAISE EXCEPTION 'Hay anulados sin motivo de catálogo: no se puede retirar void_reason';
    END IF;
END $$;

ALTER TABLE app.trips_manual DROP CONSTRAINT ck_trips_manual_void_complete;
ALTER TABLE app.trips DROP CONSTRAINT ck_trips_void_complete;
ALTER TABLE app.trips_manual DROP COLUMN void_reason;
ALTER TABLE app.trips DROP COLUMN void_reason;

ALTER TABLE app.trips_manual ADD CONSTRAINT ck_trips_manual_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NULL) = (void_reason_id IS NULL)
    AND (voided_at IS NOT NULL OR void_note IS NULL));
ALTER TABLE app.trips ADD CONSTRAINT ck_trips_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NULL) = (void_reason_id IS NULL)
    AND (voided_at IS NOT NULL OR void_note IS NULL));

COMMIT;
```

En el modelo dbt:
- quita `'void_reason', ` de `merge_exclude_columns`;
- quita `NULL::text          AS void_reason,` de la rama TMS;
- quita `m.void_reason                                       AS void_reason,` de la rama manual.

- [ ] **Step 4: Ensayar, aplicar en la ventana y verificar**

1. Ensaya con ROLLBACK vía MCP. Expected: sin error.
2. Justo después de una escritura de Mage, aplica `motivos_de_anulacion_contract` y sincroniza el modelo.
3. Verifica la corrida siguiente: una escritura posterior y `void_reason` ausente.

Run: `venv/bin/python -m pytest tests/test_dbt_anulacion.py tests/test_motivos_de_anulacion_integracion.py tests/test_anular_viajes_integracion.py -q`
Expected: PASS.

- [ ] **Step 5: Verificación en dev (Playwright)**

Con la sesión del usuario en `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app`:
1. Configuración › Operaciones › "Motivos de anulación" lista los 4 motivos.
2. Cierre del 23/09:
   - junto a "Día cerrado" aparece "12 ajustes posteriores al cierre", y la pestaña "Viajes" muestra 12;
   - no hay bloque arriba;
   - al hacer clic en el indicador, se abre "Viajes" con "Después de la firma", y los 6 anulados dicen "Motivo: Duplicado".
3. "Ver viaje" desde un ajuste muestra "← Volver al Cierre", y al hacer clic vuelve al 23/09 en la pestaña "Viajes".
4. **No anules nada nuevo** sin pedirlo al usuario. La barra con motivo se probó en vitest; probarla en vivo exige un viaje manual de prueba que el usuario autorice.

- [ ] **Step 6: Commit y AGENTLOG**

```bash
git add monitor-app/backend/supabase/migrations/20261011010000_motivos_de_anulacion_contract.sql monitor-app/backend/api/tests
git commit -m "feat(db): retira el texto libre void_reason (contract de motivos de anulación)"
```

Actualiza `AGENTLOG.md`:
- **Hecho:** catálogo de motivos, indicador de ajustes y vuelta visible.
- **Siguiente paso:** los minors diferidos de la ronda anterior (menos BarraDeSeleccion, ya resuelto), el contract de `closure_periods` y el issue #13.

Si el checkpoint previo queda cerrado, muévelo a `AGENTLOG_ARCHIVE.md`. Luego `git push origin dev`.
