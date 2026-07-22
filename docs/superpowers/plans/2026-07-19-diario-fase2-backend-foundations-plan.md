# Diario Fase 2 — Backend Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sentar las 4 bases de backend que el resto de la Fase 2 necesita: contrato de creación unificado (origen dentro de `stops[]`), fix del gap de reconciliación manual↔TMS en `app.trip_stops`, cliente/shipper real resuelto en vivo, y ciclo de vida de incidentes en la bitácora.

**Architecture:** 4 piezas independientes entre sí (no hay dependencias cruzadas dentro de este plan), todas backend-only — ningún cambio de frontend en este plan. Sigue el mismo criterio "resolución en vivo, no columna dbt" ya probado en Rondas 18-19 y 26 donde alcanza, y el mismo patrón de `post_hook` ya usado para PK/RLS/índices/trigger donde sí hace falta tocar el modelo dbt real (Task 2).

**Tech Stack:** FastAPI + asyncpg (backend), dbt/Postgres (Task 2 solamente, vía Mage).

## Global Constraints

- **Este plan es backend-only.** El frontend (`TripAssignDialog`) todavía manda el contrato VIEJO (`origin` como string, sin `stop_type` en las paradas) hasta que se ejecute el Plan 3 de esta Fase — ver la nota de secuenciación abajo.
- **Advertencia de secuenciación real, no solo teórica**: una vez que la Task 1 de este plan quite el campo `origin` de `TripCreateBody`, el frontend actual (que todavía lo manda) simplemente lo vería ignorado por Pydantic (los campos no declarados se descartan silenciosamente) — **los viajes creados manualmente quedarían sin parada de origen** hasta que el Plan 3 (frontend) también esté andando. **No pushear este plan a producción de forma aislada** — el commit puede quedar listo, pero confirmar con el usuario antes de cualquier `git push`, y lo ideal es tenerlo pusheado junto con (o inmediatamente antes de, en el mismo empujón de trabajo) el Plan 3.
- Ningún cambio de este plan modifica `app.trips.is_first_leg` ni ninguna otra columna ya protegida por `merge_exclude_columns`/`protect_manual_overrides` — se construye sobre esos mecanismos, no se tocan.
- `pytest`/verificación en vivo contra Supabase al final de cada task — mismo estándar que el resto de la sesión.

---

### Task 1: `TripCreateBody` unificado — origen dentro de `stops[]`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py:768-1011` (`TripStopCreate`, `TripCreateBody`, `_build_manual_stops`, `_insert_trip_stops`, `_validate_create_body`, `_insert_trip`)
- Test: `monitor-app/backend/api/tests/test_trip_create.py`

**Interfaces:**
- Produces: `TripStopCreate` gana `stop_type: str = 'DESTINATION'` (`'ORIGIN'` | `'DESTINATION'`); `TripCreateBody` pierde el campo `origin`; `_insert_trip_stops(conn, stops: list[TripStopCreate], trip_id: str)` — pierde el parámetro `origin`, ahora todo viene en `stops`. Todas las filas que inserta llevan `is_manual_stop = true` (columna que crea la Task 2 de este mismo plan — si se ejecuta esta Task 1 antes que la Task 2, el `INSERT` de abajo fallaría por columna inexistente; **ejecutar la Task 2 primero, o fusionar el orden si se corre todo en la misma sesión** — este plan las presenta en el orden de dependencia real, no en el orden del enunciado original).

- [ ] **Step 1: Escribir los tests que fallan**

En `monitor-app/backend/api/tests/test_trip_create.py`, reemplazar `test_stops_payload_builds_pipeline_shape` (línea 80) y `test_create_persists_origin_location_and_stop_destination` (línea 212, leer el archivo completo para copiar el resto del test tal cual antes de tocarlo) — el cambio puntual es cómo se arma el `TripStopCreate`/payload de origen. Agregar, junto a `test_stops_payload_builds_pipeline_shape`:

```python
def test_stops_payload_ignores_origin_type_entries():
    # _build_manual_stops sigue armando SOLO el jsonb legacy de destinos
    # (app.trips.stops) — el origen unificado vive en app.trip_stops (tabla),
    # insertado por _insert_trip_stops, no en este jsonb.
    stops = [
        TripStopCreate(local="CD Origen", stop_type="ORIGIN"),
        TripStopCreate(local="Local Maipú", stop_type="DESTINATION"),
    ]
    destinations = [s for s in stops if s.stop_type != "ORIGIN"]
    parsed = json.loads(_build_manual_stops(destinations, "trip-1"))
    assert len(parsed) == 1
    assert parsed[0]["local"] == "Local Maipú"


def test_trip_create_body_has_no_origin_field():
    body = TripCreateBody(
        planning_date="2026-07-06",
        stops=[{"local": "CD Origen", "stop_type": "ORIGIN"}, {"local": "Destino 1"}],
    )
    assert not hasattr(body, "origin")
    assert body.stops[0].stop_type == "ORIGIN"
    assert body.stops[1].stop_type == "DESTINATION"  # default


def test_validate_create_body_rejects_more_than_one_origin():
    from app.routers.trips import _validate_create_body
    body = TripCreateBody(
        planning_date="2026-07-06",
        stops=[
            {"local": "Origen 1", "stop_type": "ORIGIN"},
            {"local": "Origen 2", "stop_type": "ORIGIN"},
        ],
    )
    try:
        _validate_create_body(body, set())
        assert False, "debía levantar HTTPException"
    except Exception as e:
        assert "422" in str(e.status_code) if hasattr(e, "status_code") else True
        assert e.status_code == 422
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_create.py::test_stops_payload_ignores_origin_type_entries tests/test_trip_create.py::test_trip_create_body_has_no_origin_field tests/test_trip_create.py::test_validate_create_body_rejects_more_than_one_origin -v`
Expected: FAIL — `TripStopCreate` no tiene `stop_type` todavía, `TripCreateBody` todavía tiene `origin`.

- [ ] **Step 3: Agregar `stop_type` a `TripStopCreate`, quitar `origin` de `TripCreateBody`**

En `monitor-app/backend/api/app/routers/trips.py`, `TripStopCreate` (línea 768) pasa de:

```python
class TripStopCreate(BaseModel):
    local:              str
    planning_date:      Optional[str] = None  # 'YYYY-MM-DD HH:mm' o ISO
    # Ubicación del destino (dropdown región/ciudad de Chile) — van a las
    # claves destination_region/destination_city que ya existen en el jsonb
    # stops del pipeline (hoy solo qanalytics las trae)
    destination_region: Optional[str] = None
    destination_city:   Optional[str] = None
```

A:

```python
class TripStopCreate(BaseModel):
    local:              str
    planning_date:      Optional[str] = None  # 'YYYY-MM-DD HH:mm' o ISO
    # Ubicación del destino (dropdown región/ciudad de Chile) — van a las
    # claves destination_region/destination_city que ya existen en el jsonb
    # stops del pipeline (hoy solo qanalytics las trae)
    destination_region: Optional[str] = None
    destination_city:   Optional[str] = None
    # 'ORIGIN' | 'DESTINATION' — el origen del viaje se manda como una parada
    # más (Ronda 26, Fase 2, unificación crear/editar), no como un campo
    # aparte. Default 'DESTINATION' para no romper a nadie que no lo mande.
    stop_type:          str = 'DESTINATION'
```

Y `TripCreateBody` (línea 778) pierde la línea `origin: Optional[str] = None`:

```python
class TripCreateBody(BaseModel):
    planning_date:          _date
    origin_tms:             Optional[str] = None
    source_system_trip_id:  Optional[str] = None
    source_system:          str           = 'manual'
    client_name:            Optional[str] = None
    origin_region:          Optional[str] = None
    origin_city:            Optional[str] = None
    cargo_type:             Optional[str] = None
    current_status:         Optional[str] = None
    stops:                  list[TripStopCreate] = []
    tractor_plate:          Optional[str] = None
    trailer_plate:          Optional[str] = None
    driver_name:            Optional[str] = None
    driver_rut:             Optional[str] = None
    driver_phone:           Optional[str] = None
    transporter_name:       Optional[str] = None
    carrier_id:             Optional[str] = None
    driver_id:              Optional[str] = None
    tractor_asset_id:       Optional[str] = None
    trailer_asset_id:       Optional[str] = None
```

(`origin_region`/`origin_city` NO se tocan — siguen siendo campos válidos del body, los sigue usando `TripBulkUpload`/la carga CSV, fuera de alcance de este spec; lo único que cambia es que el diálogo interactivo `TripAssignDialog` deja de mostrarlos, eso es un cambio de frontend del Plan 3, no de acá)

- [ ] **Step 4: Validar como máximo un ORIGIN en `_validate_create_body`**

En `monitor-app/backend/api/app/routers/trips.py`, `_validate_create_body` (línea 903) pasa de:

```python
def _validate_create_body(body: TripCreateBody, valid_statuses: set[str]) -> None:
    if body.current_status and body.current_status not in valid_statuses:
        raise HTTPException(
            422,
            f"Estado inválido: '{body.current_status}'. Válidos: {', '.join(sorted(valid_statuses))}",
        )
    stops_sin_nombre = [s for s in body.stops if not s.local.strip()]
    if stops_sin_nombre:
        raise HTTPException(422, "Cada destino debe tener un nombre")
```

A:

```python
def _validate_create_body(body: TripCreateBody, valid_statuses: set[str]) -> None:
    if body.current_status and body.current_status not in valid_statuses:
        raise HTTPException(
            422,
            f"Estado inválido: '{body.current_status}'. Válidos: {', '.join(sorted(valid_statuses))}",
        )
    stops_sin_nombre = [s for s in body.stops if not s.local.strip()]
    if stops_sin_nombre:
        raise HTTPException(422, "Cada destino debe tener un nombre")
    origins = [s for s in body.stops if s.stop_type == 'ORIGIN']
    if len(origins) > 1:
        raise HTTPException(422, "Un viaje no puede tener más de un origen")
```

- [ ] **Step 5: Reescribir `_insert_trip_stops` — todo viene de `stops`, sin parámetro `origin` aparte**

`_insert_trip_stops` (línea 853) pasa de:

```python
async def _insert_trip_stops(conn, stops: list[TripStopCreate], trip_id: str, origin: str | None = None) -> None:
    """Espeja las paradas de un viaje manual en app.trip_stops (Fase 2 del
    hardening H2.6) — el pipeline dbt solo puebla esta tabla para viajes
    TMS (vía app.trips.stops), los viajes 100% manuales nunca pasan por
    ahí. Mismo stop_id que _build_manual_stops (misma fórmula que usa el
    pipeline: md5(trip_id + local + índice)).

    FIX 2026-07-18 (Fase 1, origen como parada 0): si `origin` viene
    seteado, inserta también la fila ORIGIN (stop_order=0) — mismo patrón
    dual que el pipeline dbt usa para viajes TMS (app/trip_stops.sql),
    donde el origen lo arma el modelo pero las paradas manuales las inserta
    este mismo backend. Sin esto, un viaje manual/CSV nacería sin origen en
    el timeline unificado."""
    if origin:
        origin_stop_id = hashlib.md5(f"{trip_id}{origin}|origin".encode()).hexdigest()
        await conn.execute(
            """
            INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local)
            VALUES ($1, $2, 0, 'ORIGIN', $3)
            ON CONFLICT (stop_id) DO UPDATE SET local = EXCLUDED.local, updated_at = NOW()
            """,
            origin_stop_id, trip_id, origin,
        )
    for i, s in enumerate(stops):
        stop_id = hashlib.md5(f"{trip_id}{s.local}{i}".encode()).hexdigest()
        await conn.execute(
            """
            INSERT INTO app.trip_stops
                (stop_id, trip_id, stop_order, stop_type, local, planning_date, destination_region, destination_city)
            VALUES ($1, $2, $3, 'DESTINATION', $4, $5::timestamptz, $6, $7)
            ON CONFLICT (stop_id) DO UPDATE SET
                local               = EXCLUDED.local,
                planning_date       = EXCLUDED.planning_date,
                destination_region  = EXCLUDED.destination_region,
                destination_city    = EXCLUDED.destination_city,
                updated_at          = NOW()
            """,
            stop_id, trip_id, i + 1, s.local, _parse_timestamptz(s.planning_date),
            s.destination_region, s.destination_city,
        )
```

A:

```python
async def _insert_trip_stops(conn, stops: list[TripStopCreate], trip_id: str) -> None:
    """Espeja las paradas de un viaje manual en app.trip_stops (Fase 2 del
    hardening H2.6) — el pipeline dbt solo puebla esta tabla para viajes
    TMS, los viajes 100% manuales nunca pasan por ahí. Mismo stop_id que
    _build_manual_stops para destinos (misma fórmula que usa el pipeline:
    md5(trip_id + local + índice entre los destinos, 0-based)).

    UNIFICADO (Ronda 26, Fase 2): el origen ya no es un parámetro aparte —
    viene como una fila más de `stops` con stop_type='ORIGIN'. Todas las
    filas que inserta esta función quedan marcadas is_manual_stop=true
    (columna nueva, ver migración de la Task 2 de este plan) — así el
    post_hook de app/trip_stops.sql sabe cuáles limpiar cuando el viaje se
    reconcilia con datos reales de una TMS."""
    dest_index = 0
    for s in stops:
        if s.stop_type == 'ORIGIN':
            stop_id = hashlib.md5(f"{trip_id}{s.local}|origin".encode()).hexdigest()
            await conn.execute(
                """
                INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local, is_manual_stop)
                VALUES ($1, $2, 0, 'ORIGIN', $3, true)
                ON CONFLICT (stop_id) DO UPDATE SET local = EXCLUDED.local, updated_at = NOW()
                """,
                stop_id, trip_id, s.local,
            )
        else:
            stop_id = hashlib.md5(f"{trip_id}{s.local}{dest_index}".encode()).hexdigest()
            await conn.execute(
                """
                INSERT INTO app.trip_stops
                    (stop_id, trip_id, stop_order, stop_type, local, planning_date, destination_region, destination_city, is_manual_stop)
                VALUES ($1, $2, $3, 'DESTINATION', $4, $5::timestamptz, $6, $7, true)
                ON CONFLICT (stop_id) DO UPDATE SET
                    local               = EXCLUDED.local,
                    planning_date       = EXCLUDED.planning_date,
                    destination_region  = EXCLUDED.destination_region,
                    destination_city    = EXCLUDED.destination_city,
                    updated_at          = NOW()
                """,
                # planning_date pasa tal cual (sin macro de huso horario propio,
                # mismo criterio que el resto de fechas manuales), solo parseado
                # a datetime porque asyncpg lo exige para un parámetro ::timestamptz.
                stop_id, trip_id, dest_index + 1, s.local, _parse_timestamptz(s.planning_date),
                s.destination_region, s.destination_city,
            )
            dest_index += 1
```

- [ ] **Step 6: Actualizar los 2 call sites en `_insert_trip`**

En `monitor-app/backend/api/app/routers/trips.py:968` cambiar:

```python
    stops_json = _build_manual_stops(body.stops, trip_id)
```

A:

```python
    # app.trips.stops (jsonb legacy, espejo del pipeline) sigue siendo
    # solo-destinos — el origen unificado vive en app.trip_stops (tabla),
    # no en este jsonb. Se filtra acá para no cambiar el shape de ese
    # campo, que otros consumidores (si los hay) siguen esperando igual.
    destination_stops = [s for s in body.stops if s.stop_type != 'ORIGIN']
    stops_json = _build_manual_stops(destination_stops, trip_id)
```

Y en `monitor-app/backend/api/app/routers/trips.py:1011` cambiar:

```python
    await _insert_trip_stops(conn, body.stops, trip_id, origin=body.origin)
```

A:

```python
    await _insert_trip_stops(conn, body.stops, trip_id)
```

- [ ] **Step 7: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_create.py -v`
Expected: todos pasan, incluyendo los 3 nuevos y los existentes ya adaptados.

- [ ] **Step 8: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan (236 antes de este plan).

- [ ] **Step 9: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_create.py
git commit -m "feat(diario): contrato de creación unificado — origen dentro de stops[]"
```

---

### Task 2: `is_manual_stop` + limpieza de reconciliación en `app/trip_stops.sql`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260719000000_trip_stops_is_manual_stop.sql`
- Modify (vía sync de Mage): `dbt/tms/models/app/trip_stops.sql`

**Interfaces:**
- Produces: `app.trip_stops.is_manual_stop boolean NOT NULL DEFAULT false` — consumida por `_insert_trip_stops` (Task 1, la marca `true`) y por el `post_hook` nuevo de este modelo.

- [ ] **Step 1: Crear y aplicar la migración de la columna**

Crear `monitor-app/backend/supabase/migrations/20260719000000_trip_stops_is_manual_stop.sql`:

```sql
-- Marca las filas de app.trip_stops insertadas directo por el backend
-- (_insert_trip_stops, viajes manuales) vs. las que genera el pipeline dbt.
-- Necesaria para el post_hook de reconciliación de app/trip_stops.sql — sin
-- esto no hay forma de distinguir "esta fila hay que limpiarla cuando el
-- viaje deja de ser manual" de "esta fila la generó la TMS, no tocar".
ALTER TABLE app.trip_stops ADD COLUMN is_manual_stop boolean NOT NULL DEFAULT false;
```

Aplicar con `mcp__claude_ai_Supabase__apply_migration` (proyecto `viclzoftiudkepqnhekv`, `name: "trip_stops_is_manual_stop"`).

- [ ] **Step 2: Verificar la columna en vivo**

Vía `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT is_manual_stop, count(*) FROM app.trip_stops GROUP BY is_manual_stop;
```

Expected: todas las filas existentes en `false` (default aplicado retroactivamente).

- [ ] **Step 3: Sincronizar el proyecto dbt real desde Mage**

Usar `mcp__mage-agent__sync_project_to_local` con `local_project_dir` apuntando al scratchpad de esta sesión (mismo directorio ya usado antes: `/private/tmp/claude-501/-Users-usuario-Desktop-projects-webcarga/fc251307-0973-4c94-9f59-f8a04fe298ba/scratchpad/mage_project`).

- [ ] **Step 4: Agregar `is_manual_stop` a las 2 CTEs de `app/trip_stops.sql`**

En `dbt/tms/models/app/trip_stops.sql`, la CTE `destination_stops` termina hoy en:

```sql
        NULL::timestamptz                                          AS desc_inicio_manual,
        NULL::timestamptz                                          AS desc_fin_manual
    FROM base_trips bt
    CROSS JOIN LATERAL jsonb_array_elements(bt.stops) WITH ORDINALITY AS s(elem, ord)
    WHERE bt.stops IS NOT NULL
),
```

Cambiar a:

```sql
        NULL::timestamptz                                          AS desc_inicio_manual,
        NULL::timestamptz                                          AS desc_fin_manual,
        false                                                       AS is_manual_stop
    FROM base_trips bt
    CROSS JOIN LATERAL jsonb_array_elements(bt.stops) WITH ORDINALITY AS s(elem, ord)
    WHERE bt.stops IS NOT NULL
),
```

Y la CTE `origin_stops` termina hoy en:

```sql
        NULL::timestamptz                                            AS desc_inicio_manual,
        NULL::timestamptz                                            AS desc_fin_manual
    FROM base_trips bt
    JOIN {{ ref('int_tms_trips_conformed') }} c
        ON c.trip_id = bt.id AND c.is_current = true
    WHERE c.origin_location_name IS NOT NULL
)
```

Cambiar a:

```sql
        NULL::timestamptz                                            AS desc_inicio_manual,
        NULL::timestamptz                                            AS desc_fin_manual,
        false                                                        AS is_manual_stop
    FROM base_trips bt
    JOIN {{ ref('int_tms_trips_conformed') }} c
        ON c.trip_id = bt.id AND c.is_current = true
    WHERE c.origin_location_name IS NOT NULL
)
```

**Por qué es obligatorio, no cosmético**: el modelo usa `on_schema_change='sync_all_columns'` — dbt sincroniza el esquema de la tabla real para que coincida EXACTAMENTE con las columnas que el `SELECT` del modelo declara. Si `is_manual_stop` no aparece acá, dbt la **elimina** de `app.trip_stops` en la próxima corrida (mismo mecanismo por el que `desc_inicio_manual`/`desc_fin_manual` sí están en el `SELECT` pese a estar excluidas del `UPDATE` vía `merge_exclude_columns` — una cosa es no tocarla en el `UPDATE`, otra muy distinta es que sobreviva al chequeo de esquema).

- [ ] **Step 5: Agregar el `post_hook` de limpieza**

En `dbt/tms/models/app/trip_stops.sql`, el bloque `config()` tiene hoy:

```sql
        post_hook=[
            "ALTER TABLE {{ this }} ENABLE ROW LEVEL SECURITY",
            "DROP POLICY IF EXISTS trip_stops_read ON {{ this }}",
            "CREATE POLICY trip_stops_read ON {{ this }} FOR SELECT TO authenticated USING (true)",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema = 'app' AND table_name = 'trip_stops' AND constraint_type = 'PRIMARY KEY') THEN ALTER TABLE app.trip_stops ADD PRIMARY KEY (stop_id); END IF; END $$",
            "CREATE INDEX IF NOT EXISTS idx_trip_stops_trip_id ON {{ this }} (trip_id)",
            "CREATE INDEX IF NOT EXISTS idx_trip_stops_stop_type ON {{ this }} (trip_id, stop_type)"
        ]
```

Cambiar a (agregando 2 entradas al final de la lista):

```sql
        post_hook=[
            "ALTER TABLE {{ this }} ENABLE ROW LEVEL SECURITY",
            "DROP POLICY IF EXISTS trip_stops_read ON {{ this }}",
            "CREATE POLICY trip_stops_read ON {{ this }} FOR SELECT TO authenticated USING (true)",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema = 'app' AND table_name = 'trip_stops' AND constraint_type = 'PRIMARY KEY') THEN ALTER TABLE app.trip_stops ADD PRIMARY KEY (stop_id); END IF; END $$",
            "CREATE INDEX IF NOT EXISTS idx_trip_stops_trip_id ON {{ this }} (trip_id)",
            "CREATE INDEX IF NOT EXISTS idx_trip_stops_stop_type ON {{ this }} (trip_id, stop_type)",
            "UPDATE {{ this }} new_origin SET desc_inicio_manual = old_origin.desc_inicio_manual, desc_fin_manual = old_origin.desc_fin_manual FROM {{ this }} old_origin WHERE new_origin.trip_id = old_origin.trip_id AND new_origin.stop_order = 0 AND old_origin.stop_order = 0 AND new_origin.is_manual_stop = false AND old_origin.is_manual_stop = true AND new_origin.trip_id IN (SELECT id FROM {{ ref('trips') }} WHERE source_system != 'manual') AND (old_origin.desc_inicio_manual IS NOT NULL OR old_origin.desc_fin_manual IS NOT NULL)",
            "DELETE FROM {{ this }} WHERE is_manual_stop = true AND trip_id IN (SELECT id FROM {{ ref('trips') }} WHERE source_system != 'manual')"
        ]
```

Agregar también el comentario de cabecera del modelo explicando el mecanismo — al final del bloque `/* ... */` que ya existe (después de "ORIGEN COMO PARADA 0..."), agregar:

```sql
  RECONCILIACIÓN MANUAL→TMS (Ronda 26, Fase 2, 2026-07-19): cuando un viaje
  manual (creado con TMS integrado + id externo, mismo id canónico que
  usaría el pipeline real) es reportado después por su TMS real, las filas
  is_manual_stop=true de ese trip_id quedan huérfanas — el backend calculó
  su stop_id con el texto que tipeó el operador, dbt lo calcula con el
  nombre real de la TMS, casi nunca coinciden. El post_hook de arriba: (1)
  preserva desc_inicio_manual/desc_fin_manual de la fila ORIGEN manual hacia
  la fila ORIGEN nueva que este modelo acaba de generar en la misma corrida
  (match unívoco: mismo trip_id, stop_order=0 siempre existe un solo
  origen), (2) borra todas las filas manuales del viaje ya reconciliado. Sin
  match unívoco posible para destinos (el operador puede tipear
  nombres/orden distintos a los que reporta la TMS) — se acepta la pérdida
  ahí, con aviso al operador en el momento de crear el viaje (frontend,
  TripAssignDialog).
*/
```

- [ ] **Step 6: Sincronizar de vuelta a Mage**

Usar `mcp__mage-agent__sync_local_to_remote`.

- [ ] **Step 7: Pedir al usuario que corra el bloque `app_trip_stops_update` (o el bloque dbt correspondiente a `app/trip_stops.sql`) manualmente en la UI de Mage**

`run_block` vía API está roto desde rondas anteriores de esta sesión (`NoResultFound` en `pipeline_schedule`) — mismo patrón de resolución ya usado: pedirle al usuario que lo corra a mano en la UI de Mage. Es un bloque dbt puro, sin scraping, sin costo.

- [ ] **Step 8: Verificar en vivo contra Supabase que el `post_hook` corrió sin errores**

Vía `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='app' AND table_name='trip_stops' AND column_name='is_manual_stop';
```

Expected: 1 fila — confirma que `sync_all_columns` no la eliminó (si el Step 4 se hizo mal, esta columna directamente no existiría más).

- [ ] **Step 9: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/supabase/migrations/20260719000000_trip_stops_is_manual_stop.sql
git commit -m "feat(diario): is_manual_stop + limpieza post-corrida de reconciliación en app/trip_stops.sql"
```

Nota: el cambio real de `dbt/tms/models/app/trip_stops.sql` vive en Mage, no en este repo (proyecto dbt no versionado en git, deuda ya documentada) — el commit de este step es solo la migración de la columna.

---

### Task 3: Cliente/shipper real — `shipper_id` en vivo + `POST /shippers`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py` (`_TRIP_SELECT`, `_TRIP_FROM`)
- Modify: `monitor-app/backend/api/app/routers/shippers.py`
- Test: `monitor-app/backend/api/tests/test_config_monitor.py`, nuevo `monitor-app/backend/api/tests/test_shippers.py`

**Interfaces:**
- Produces: `GET /trips`/`GET /trips/{id}` ganan `shipper_id`/`shipper_name` en cada fila (`null` si `client_name` no matchea ningún shipper activo). `POST /shippers` (nuevo) → `{id, name, status}`, 201; 409 si el nombre ya existe.

- [ ] **Step 1: Escribir el test que falla — `shipper_id`/`shipper_name` en la query**

Agregar a `monitor-app/backend/api/tests/test_config_monitor.py`, junto a `test_list_trips_second_leg_plus_filters_against_driver_daily_trip_legs_view`:

```python
def test_trip_select_resolves_shipper_id_live_via_client_name_match():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": "Walmart", "shipper_id": "s1", "shipper_name": "Walmart"}
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/trip-1")
    assert res.status_code == 200
    assert res.json()["shipper_id"] == "s1"
    query = pool.fetchrow.call_args.args[0]
    assert "public.shippers" in query
    assert "lower(trim(" in query
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_config_monitor.py::test_trip_select_resolves_shipper_id_live_via_client_name_match -v`
Expected: FAIL — `shipper_id`/`public.shippers` no están en la query todavía.

- [ ] **Step 3: Agregar el JOIN a `_TRIP_FROM` y las columnas a `_TRIP_SELECT`**

En `monitor-app/backend/api/app/routers/trips.py`, `_TRIP_FROM` termina hoy en (el bloque que agregó la Task 1 del Plan 1 anterior, "vuelta N"):

```python
    -- "Vuelta N" (driver_leg_number, ver _TRIP_SELECT): orden cronológico de
    -- los viajes de un conductor en el día, basado en cuándo salió del
    -- origen — trae solo la fila ORIGIN de trip_stops (a lo sumo 1 por viaje,
    -- ver assert_trip_stops_at_most_one_origin_per_trip, Ronda 21).
    LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
    LEFT JOIN public.profiles p ON p.id = t.edited_by
"""
```

Cambiar a:

```python
    -- "Vuelta N" (driver_leg_number, ver _TRIP_SELECT): orden cronológico de
    -- los viajes de un conductor en el día, basado en cuándo salió del
    -- origen — trae solo la fila ORIGIN de trip_stops (a lo sumo 1 por viaje,
    -- ver assert_trip_stops_at_most_one_origin_per_trip, Ronda 21).
    LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
    -- Cliente/shipper real, resuelto en vivo (Ronda 26, Fase 2) — mismo
    -- patrón "resolución en vivo" que driver_id/carrier_id/tractor_asset_id
    -- (Rondas 18-19), sin tocar el pipeline dbt. client_name va a estar
    -- garantizado como el nombre exacto de un shipper real desde que el
    -- formulario de creación usa el directorio real (ClientPicker) — el
    -- match por texto alcanza, no hace falta una columna persistida.
    LEFT JOIN public.shippers sh
        ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    LEFT JOIN public.profiles p ON p.id = t.edited_by
"""
```

Y `_TRIP_SELECT` termina hoy en (el bloque agregado por el mismo plan anterior):

```python
    -- "Vuelta N" del conductor ese día — reemplaza a is_first_leg (manual/
    -- TMS) como fuente del filtro "2ª+ vuelta". Lookup de una fila contra
    -- app.v_driver_daily_trip_legs (migración 20260718120000) — la ventana
    -- vive adentro de esa vista, no acá, para que el resultado sea estable
    -- sin importar qué WHERE aplique la consulta de afuera (list_trips
    -- filtra, get_trip restringe a un solo id — una ventana calculada acá
    -- se rompería en ambos casos). NULL si el viaje no tiene
    -- trip_fleet_links.driver_id explícito (la vista no lo incluye).
    (SELECT vdtl.leg_number FROM app.v_driver_daily_trip_legs vdtl WHERE vdtl.trip_id = t.id) AS driver_leg_number
"""
```

Cambiar a:

```python
    -- "Vuelta N" del conductor ese día — reemplaza a is_first_leg (manual/
    -- TMS) como fuente del filtro "2ª+ vuelta". Lookup de una fila contra
    -- app.v_driver_daily_trip_legs (migración 20260718120000) — la ventana
    -- vive adentro de esa vista, no acá, para que el resultado sea estable
    -- sin importar qué WHERE aplique la consulta de afuera (list_trips
    -- filtra, get_trip restringe a un solo id — una ventana calculada acá
    -- se rompería en ambos casos). NULL si el viaje no tiene
    -- trip_fleet_links.driver_id explícito (la vista no lo incluye).
    (SELECT vdtl.leg_number FROM app.v_driver_daily_trip_legs vdtl WHERE vdtl.trip_id = t.id) AS driver_leg_number,
    sh.id   AS shipper_id,
    sh.name AS shipper_name
"""
```

(Si `_TRIP_SELECT` en el repo real no tiene todavía el bloque de `driver_leg_number` con ese comentario exacto porque los Planes de la Ronda 26 se ejecutaron en otro orden, ubicar la última columna real de `_TRIP_SELECT` — la penúltima línea antes del `"""` de cierre — y agregar la coma + las 2 columnas nuevas ahí, sin asumir el contenido exacto de líneas vecinas más allá de lo verificado en este mismo plan.)

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_config_monitor.py::test_trip_select_resolves_shipper_id_live_via_client_name_match -v`
Expected: PASS

- [ ] **Step 5: Escribir los tests de `POST /shippers`**

Crear `monitor-app/backend/api/tests/test_shippers.py`:

```python
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.shippers import router
from app.db import get_pool
from app.auth import get_current_user, require_editor

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "editor"}


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_list_shippers_returns_catalog():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "s1", "name": "Walmart", "status": "ACTIVE"}]
    client = make_client(pool)
    res = client.get("/api/v1/shippers")
    assert res.status_code == 200
    assert res.json()[0]["name"] == "Walmart"


def test_create_shipper_success():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "s2", "name": "Nuevo Cliente Spot", "status": "ACTIVE"}
    client = make_client(pool)
    res = client.post("/api/v1/shippers", json={"name": "Nuevo Cliente Spot"})
    assert res.status_code == 201
    assert res.json()["name"] == "Nuevo Cliente Spot"


def test_create_shipper_duplicate_name_is_409():
    pool = AsyncMock()
    pool.fetchrow.side_effect = Exception('duplicate key value violates unique constraint "shippers_name_key"')
    client = make_client(pool)
    res = client.post("/api/v1/shippers", json={"name": "Walmart"})
    assert res.status_code == 409
```

- [ ] **Step 6: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_shippers.py -v`
Expected: `test_create_shipper_success`/`test_create_shipper_duplicate_name_is_409` FAIL (405, no existe `POST /shippers` todavía); `test_list_shippers_returns_catalog` PASS (ya existe).

- [ ] **Step 7: Agregar `POST /shippers`**

Reemplazar `monitor-app/backend/api/app/routers/shippers.py` completo:

```python
"""public.shippers — catálogo de clientes/shippers reales. GET es de solo
lectura desde H2.6 (selector del generador de carga en Configuración); POST
se suma en la Ronda 26 (Fase 2) para que TripAssignDialog pueda crear un
shipper nuevo al vuelo cuando el operador tipea un cliente que no existe
todavía — antes client_name era texto libre sin ningún vínculo real."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user, require_editor
from ..db import get_pool

router = APIRouter(prefix="/shippers", tags=["shippers"])


class ShipperCreateBody(BaseModel):
    name: str


@router.get("")
async def list_shippers(pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT id, name, status FROM public.shippers ORDER BY name"
    )
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_shipper(
    body: ShipperCreateBody,
    pool=Depends(get_pool),
    _=Depends(require_editor),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "El nombre no puede estar vacío")
    try:
        row = await pool.fetchrow(
            "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id, name, status",
            name,
        )
    except Exception as e:
        if "shippers_name_key" in str(e):
            raise HTTPException(409, f"Ya existe un cliente llamado '{name}'")
        raise
    return dict(row)
```

- [ ] **Step 8: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_shippers.py -v`
Expected: 3 passed

- [ ] **Step 9: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan

- [ ] **Step 10: Verificar en vivo contra Supabase**

Vía `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT t.id, t.client_name, sh.id AS shipper_id, sh.name AS shipper_name
FROM app.trips t
LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
WHERE t.client_name IS NOT NULL
LIMIT 10;
```

Expected: para clientes con nombre exacto a un shipper real (ej. "Walmart"), `shipper_id` resuelto; para clientes que no matchean (ej. texto libre viejo, o "otro"), `shipper_id` NULL — esperado, no es un bug, refleja datos históricos de antes de este fix.

- [ ] **Step 11: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/app/routers/shippers.py monitor-app/backend/api/tests/test_shippers.py monitor-app/backend/api/tests/test_config_monitor.py
git commit -m "feat(diario): shipper_id/shipper_name resueltos en vivo + POST /shippers"
```

---

### Task 4: Incidentes con ciclo de vida — `resolved_at` + `PATCH /trips/{id}/notes/{note_id}/resolve`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260719010000_trip_notes_resolved_at.sql`
- Modify: `monitor-app/backend/api/app/routers/trips.py`
- Test: `monitor-app/backend/api/tests/test_trip_notes.py`

**Interfaces:**
- Produces: `app.trip_notes.resolved_at timestamptz NULL`; `PATCH /trips/{trip_id}/notes/{note_id}/resolve` con body `{resolved: bool}` → `{ok: true, resolved: bool}`, 404 si la nota no existe (mismo contrato que `/pin`, ya existente).

- [ ] **Step 1: Crear y aplicar la migración**

Crear `monitor-app/backend/supabase/migrations/20260719010000_trip_notes_resolved_at.sql`:

```sql
-- Ciclo de vida real para notas tipo 'incidente' — nulo = abierto, con
-- timestamp = resuelto. Solo tiene sentido para note_type='incidente', pero
-- no se restringe con un CHECK (otros tipos de nota simplemente no lo usan
-- nunca, igual que pinned ya convive con todos los tipos sin problema).
ALTER TABLE app.trip_notes ADD COLUMN resolved_at timestamptz NULL;
```

Aplicar con `mcp__claude_ai_Supabase__apply_migration` (proyecto `viclzoftiudkepqnhekv`, `name: "trip_notes_resolved_at"`).

- [ ] **Step 2: Escribir los tests que fallan**

Agregar a `monitor-app/backend/api/tests/test_trip_notes.py`, junto a `test_pin_note_toggles`:

```python
def test_resolve_incident_note_toggles():
    pool = AsyncMock()
    pool.fetchval.return_value = NOTE_ROW["id"]
    client = make_client(pool)
    res = client.patch(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes/{NOTE_ROW['id']}/resolve",
        json={"resolved": True},
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True, "resolved": True}
    update_sql = pool.fetchval.call_args.args[0]
    assert "resolved_at" in update_sql


def test_resolve_missing_note_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.patch(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes/{NOTE_ROW['id']}/resolve",
        json={"resolved": True},
    )
    assert res.status_code == 404
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_notes.py::test_resolve_incident_note_toggles tests/test_trip_notes.py::test_resolve_missing_note_is_404 -v`
Expected: FAIL — 404 (la ruta `/resolve` no existe todavía).

- [ ] **Step 4: Agregar el endpoint, mismo patrón que `pin_trip_note`**

En `monitor-app/backend/api/app/routers/trips.py`, junto a `class TripNotePin(BaseModel): pinned: bool` (línea 1566), agregar:

```python
class TripNoteResolve(BaseModel):
    resolved: bool
```

Y junto a `pin_trip_note` (línea 1700-1718), agregar:

```python
@router.patch("/{trip_id}/notes/{note_id}/resolve")
async def resolve_trip_note(
    trip_id: str,
    note_id: str,
    payload: TripNoteResolve,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Marca/desmarca una nota tipo 'incidente' como resuelta — mismo patrón
    que pin_trip_note. resolved_at nulo = abierto (Ronda 26, Fase 2)."""
    updated = await pool.fetchval(
        """
        UPDATE app.trip_notes SET resolved_at = CASE WHEN $3 THEN NOW() ELSE NULL END
        WHERE id = $1 AND trip_id = $2
        RETURNING id
        """,
        note_id, trip_id, payload.resolved,
    )
    if not updated:
        raise HTTPException(404, "Nota no encontrada")
    return {"ok": True, "resolved": payload.resolved}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_trip_notes.py -v`
Expected: todos pasan.

- [ ] **Step 6: Correr la suite completa**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q`
Expected: todos pasan.

- [ ] **Step 7: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add monitor-app/backend/supabase/migrations/20260719010000_trip_notes_resolved_at.sql monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_trip_notes.py
git commit -m "feat(diario): ciclo de vida de incidentes — resolved_at + PATCH .../notes/{id}/resolve"
```

---

## Self-Review

**1. Cobertura del spec**: cubre las 4 piezas de backend del spec (`docs/superpowers/specs/2026-07-19-diario-fase2-bitacora-design.md`) — contrato de creación unificado, fix de reconciliación (con preservación de origen), cliente/shipper en vivo, incidentes con ciclo de vida. El resto del spec (componentes compartidos, `TripSlideOver`, `TripTable`, `FilterPopover`, Indicadores, bitácora) es frontend — queda para los Planes 2-7, no de este.
**2. Placeholders**: ninguno — cada paso tiene código completo. La nota del Step 3 de la Task 3 ("si `_TRIP_SELECT` no tiene ese bloque exacto...") no es un placeholder — es una instrucción honesta de que el contenido exacto depende del orden real de ejecución de planes anteriores de esta sesión, con el criterio de fallback explícito (última columna real antes del cierre).
**3. Consistencia de tipos**: `is_manual_stop` se usa igual en la migración (Task 2), `_insert_trip_stops` (Task 1 — **nota de orden**: Task 1 inserta filas con `is_manual_stop=true`, columna que crea la Task 2; deben ejecutarse en el orden Task 2 → Task 1 si se sigue estrictamente la dependencia, o Task 1 → Task 2 si se acepta que el `INSERT` de la Task 1 fallará hasta que la Task 2 corra — **ejecutar Task 2 antes que Task 1** para evitar ese error, pese al orden de numeración de este documento) y el `post_hook` del modelo dbt (Task 2).
**4. Alcance**: 100% backend, sin dependencias de los Planes 2-7 (frontend). La Task 1 sí es un prerrequisito real para el Plan 2/3 (los componentes compartidos y `TripAssignDialog` necesitan el contrato ya unificado del lado del backend antes de poder mandar `stops[]` con origen incluido).
**5. Riesgo real identificado y ya resuelto en el diseño**: la advertencia de secuenciación en Global Constraints (no pushear este plan aislado a producción) es la corrección más importante de este self-review — sin ella, un push de la Task 1 sin el Plan 3 (frontend) rompería la captura de origen en producción por el tiempo que pase entre ambos.

**Corrección de orden aplicada tras el self-review**: renombrar mentalmente al ejecutar — correr primero los Steps de la Task 2 (columna + dbt), después los de la Task 1 (que depende de que la columna ya exista). Las Tasks 3 y 4 son independientes de las otras 2 y entre sí, se pueden correr en cualquier momento de este plan.
