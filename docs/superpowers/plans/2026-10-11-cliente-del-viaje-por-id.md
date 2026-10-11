# El cliente del viaje por ID — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada viaje guarda el ID de su cliente del directorio (`shipper_id`), resuelto una vez al entrar, y todas las
pantallas cruzan y muestran el cliente por ese ID. Ningún cruce por texto queda en el backend.

**Architecture:**
- **Correspondencia y migración.** Una tabla `app.tms_client_shippers` traduce el cliente de cada TMS
  (`source_client_id`) a un cliente del directorio. La migración la siembra con los 4 clientes de hoy.
- **dbt calcula `app.trips.shipper_id`** en sus dos ramas:
  - rama TMS: desde la correspondencia;
  - rama manual: desde `app.trips_manual.shipper_id`, que escribe la API.

  Una escotilla del incremental reprocesa los viajes viejos cuando cambia su correspondencia.
- **Backend:** un solo módulo, `services/cliente_del_viaje.py`, define el cruce y el nombre que se muestra, y todas las
  consultas lo usan.
- **API:** los filtros por cliente pasan a recibir IDs.

**Tech Stack:** Supabase Postgres (migraciones vía MCP `apply_migration`), dbt en Mage (`.mage-agent/local_sync/dbt/tms`,
`sync_local_to_remote`), FastAPI + asyncpg (pytest), Next.js + React Query (vitest).

**Spec:** `docs/superpowers/specs/2026-10-11-cliente-del-viaje-por-id-design.md`

## Global Constraints

- **Nombres en inglés** para todo objeto de base y clave de API: `shipper_id`, `tms_client_shippers`, `source_client`,
  `idx_trips_shipper` y el parámetro `shipper_id`. El código interno Python/TS va en español, y la UI en español
  neutral, sin voseo. Cero emojis.
- **`client_name` no se renombra ni se reescribe.** Es parte del ID del viaje (`md5(tms|lower(cliente)|nº)`,
  `_manual_trip_id` y `stg_*_trips`). Continuidad del `trip_id`: invariante dura.
- **Mage:**
  - Antes de tocar el mirror se corre `sync_status`.
  - Nunca se sube con una corrida en vuelo: la última corrida debe haber terminado, lo que se ve en el
    `status_reported_at` más reciente y en la hora del cron de 15 minutos.
  - Subir a Mage es un efecto fuera del repo: **se pide confirmación al usuario antes de `sync_local_to_remote`**.
  - `app.trips` usa `on_schema_change='sync_all_columns'`, así que la columna nueva entra **por el modelo**, nunca
    por una migración.
- **Migraciones:**
  - Se ensayan primero con `BEGIN; … ROLLBACK;` vía `execute_sql`, y recién después se aplican con `apply_migration`.
  - Las tablas nuevas de `app.*` siguen el patrón de `20261010233000`: `ENABLE ROW LEVEL SECURITY` y
    `REVOKE ALL … FROM anon, authenticated`.
  - Los objetos se nombran en inglés; el archivo de migración, en español.
- **Pruebas por tarea:** solo las del área tocada, más vitest y tsc del frontend. La suite completa del backend corre
  **una vez**, en segundo plano, antes del despliegue final (Task 10), porque este cambio sí toca código compartido
  (`trips.py`, `cierre_*`, `pre_cierre`).
- **Ningún dato real se modifica para probar.** Las pruebas de renombre van en integración con `conexion_revertida`
  (transacción que se revierte).

## Review Focus

1. **Un viaje del TMS de un cliente sin vincular.** Llega con `shipper_id` NULL. Se ve con el texto del TMS y la marca
   "sin vincular" en el Monitor, el Cierre y el Reporte, y aparece en Configuración › Clientes del TMS. No desaparece de
   ninguna lista. Tests en Tasks 5, 6 y 7.
2. **Vincular un cliente en Configuración.** Los viajes viejos de ese cliente toman su `shipper_id` en la próxima
   corrida aunque el TMS no los haya vuelto a reportar (la escotilla OR 7). Se verifica por SQL en Task 3 y en dev en
   Task 10.
3. **Renombrar un cliente en el directorio.** Sus viajes siguen bajo él en todas las pantallas, con el nombre nuevo.
   Test de integración en Task 6.
4. **Un CSV con el cliente en otra capitalización** ("WALMART"). Se resuelve contra el directorio y se guarda
   `shipper_id` con el nombre del directorio; un cliente inexistente rechaza esa fila con su mensaje. Test en Task 4.
5. **Primera corrida de dbt con la columna nueva.** Todos los viajes del TMS con correspondencia reciben `shipper_id`
   en esa misma corrida, gracias al `{% else %}` de la escotilla, y no en la siguiente. Se verifica por SQL en Task 3.

## Rulings tomados al escribir el plan

- **CSV.** El cuerpo de alta acepta `shipper_id` o `client_name`. Si llega solo el nombre (carga masiva), el backend lo
  resuelve contra el directorio sin distinguir mayúsculas, y si no existe rechaza la fila. No es texto libre: nada se
  guarda sin calzar con el directorio, y la validación vive en un solo lugar (`resolver_cliente`). El spec decía
  "`shipper_id` obligatorio"; la garantía es la misma.
- **Lo que se muestra.** Todo endpoint devuelve `client_name` como **el nombre que se muestra**:
  `COALESCE(sh.name, t.client_name || ' · sin vincular')`, con una sola definición en
  `services/cliente_del_viaje.py`. Hoy cada endpoint hacía su propio `COALESCE`, y el Monitor mostraba el texto crudo,
  disimulado con `capitalize` en CSS. El texto del TMS queda en la base (`app.trips.client_name`) y en el detalle como
  `source_client_name`.
- **Filtros.** El Monitor y el Centro de Flota pasan de `?client=<nombres>` a `?shipper_id=<ids>`, y el valor
  `unlinked` filtra los sin vincular. El Reporte pasa de `?client=` a `?shipper_id=`. Sus opciones son solo clientes
  vinculados; los sin vincular cuentan en "Todos los clientes".
- **Ruta de Configuración.** La correspondencia es una **sección** del dominio Operaciones
  (`/dashboard/admin/settings/operations?section=tms-clients`, como Orígenes), no una ruta propia como decía el spec.
  Es el patrón del registro `dominios.ts`.
- **Permisos.** Leer la correspondencia pide `commercial.read`, y editarla `commercial.edit`, los mismos que el
  directorio de clientes.
- **Sin endpoint de renombre.** El directorio no tiene uno hoy (solo `POST /shippers`). El índice único cubre cualquier
  camino futuro.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `monitor-app/backend/supabase/migrations/20261011120000_cliente_del_viaje_por_id.sql` (nuevo) | Índice único del directorio, `app.tms_client_shippers` sembrada, `app.trips_manual.shipper_id` rellenado |
| `.mage-agent/local_sync/dbt/tms/models/app/trips.sql` (mirror de Mage, fuera de git) | `shipper_id` en las dos ramas, escotilla OR 7, índice |
| `monitor-app/backend/api/app/services/cliente_del_viaje.py` (nuevo) | `JOIN_CLIENTE`, `nombre_del_cliente()`, `resolver_cliente()`: una sola definición |
| `monitor-app/backend/api/app/routers/trips.py` | Alta con `shipper_id`; lista, búsqueda, filtro, meta, detalle, flota y tipos de operación por ID |
| `monitor-app/backend/api/app/routers/shippers.py` | 409 sin distinguir mayúsculas |
| `monitor-app/backend/api/app/routers/{daily_closures,equipment_closures,drivers,status_report}.py`, `services/{cierre_viajes,pre_cierre}.py` | Cruce por ID |
| `monitor-app/backend/api/app/routers/tms_clients.py` (nuevo) + `main.py` | `GET`/`PUT /tms-clients` |
| `monitor-app/frontend/components/dashboard/ClientPicker.tsx`, `TripAssignDialog.tsx`, `TripCard.tsx` | Elegir por ID; sin `capitalize` |
| `monitor-app/frontend/app/dashboard/operations/monitor/page.tsx`, `hooks/useDiarioFilters.ts`, `lib/api/trips.ts` | Chips de cliente por ID |
| `monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx`, `lib/api/statusReport.ts`, `lib/types.ts` | Filtro del reporte por ID |
| `monitor-app/frontend/app/dashboard/admin/settings/clientes-del-tms.tsx` (nuevo) + `dominios.ts` + `secciones.ts` | Sección Clientes del TMS |
| `monitor-app/frontend/lib/api/tmsClients.ts` (nuevo) | Cliente HTTP de la correspondencia |

---

### Task 1: Conciliar el mirror de Mage antes de tocarlo

`sync_status` (11/10, 01:30 CL) marca `dbt/tms/models/app/trips.sql` como "local_to_remote": el archivo local se editó
el 10/10 a las 21:57 CL, tres minutos después del último sync, y nunca se subió. Antes de editarlo hay que saber qué
contiene esa diferencia.

**Files:** ninguno del repo. Respaldo en `$CLAUDE_JOB_DIR/tmp/mirror-trips.sql`.

- [ ] **Step 1: Respaldar el archivo local**

```bash
cp .mage-agent/local_sync/dbt/tms/models/app/trips.sql "$CLAUDE_JOB_DIR/tmp/mirror-trips.local.sql"
```

- [ ] **Step 2: Traer la versión remota sin pisar la local**

Lee la guía `skill://sync` del MCP de Mage. Si `sync_project_to_local` pisa los archivos marcados local_to_remote,
**no lo uses**: pide la versión remota de `dbt/tms/models/app/trips.sql` por la vía de lectura que la guía indique, y
guárdala en `$CLAUDE_JOB_DIR/tmp/mirror-trips.remote.sql`. Si no hay ninguna vía de lectura sin pisar, detente y
pregunta al usuario.

- [ ] **Step 3: Comparar y decidir**

Run: `diff "$CLAUDE_JOB_DIR/tmp/mirror-trips.remote.sql" "$CLAUDE_JOB_DIR/tmp/mirror-trips.local.sql"`

Expected, uno de estos tres casos:
- **Sin diferencias:** el estado de sync estaba desfasado. Sigue.
- **La diferencia es solo un cambio de esta sesión ya desplegado por otra vía:** anótalo en el ledger y sigue.
- **Cualquier otra diferencia:** **detente**, muéstrasela al usuario en lenguaje simple y espera su decisión.

No edites el modelo sobre una base que no se entiende.

- [ ] **Step 4: Ledger**

Anota en el ledger el resultado (`Task 1: mirror conciliado — <caso>`). Esta tarea no tiene commit: el mirror está
fuera de git.

---

### Task 2: Migración — el directorio único, la correspondencia y el viaje manual

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261011120000_cliente_del_viaje_por_id.sql`
- Test: `monitor-app/backend/api/tests/test_cliente_del_viaje_integracion.py`

**Interfaces:**
- Produces:
  - `public.shippers`: índice único `shippers_name_ci_key ON (lower(btrim(name)))`.
  - `app.tms_client_shippers(source_client_id uuid PK, source_system text, source_client text, shipper_id uuid FK,
    created_at, created_by)`.
  - `app.trips_manual.shipper_id uuid` con FK a `public.shippers(id)`.

- [ ] **Step 1: Escribir el test de integración que falla**

`tests/test_cliente_del_viaje_integracion.py`:

```python
"""El cliente del viaje por ID (spec 2026-10-11), contra Postgres de verdad. Lo
que se fija es el modelo: el directorio no admite dos nombres que solo difieran
en mayúsculas, la correspondencia existe para cada cliente del TMS con viajes, y
el viaje manual apunta al directorio."""
import asyncpg
import pytest

pytestmark = pytest.mark.integracion


async def test_el_directorio_no_admite_el_mismo_nombre_con_otra_capitalizacion(conexion_revertida):
    nombre = await conexion_revertida.fetchval("SELECT name FROM public.shippers WHERE status = 'ACTIVE' LIMIT 1")
    with pytest.raises(asyncpg.UniqueViolationError):
        await conexion_revertida.execute(
            "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE')", f"  {nombre.upper()} ")


async def test_cada_cliente_del_tms_con_viajes_tiene_correspondencia(conexion_revertida):
    sin_correspondencia = await conexion_revertida.fetchval("""
        SELECT count(DISTINCT t.source_client_id) FROM app.trips t
        WHERE t.source_client_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM app.tms_client_shippers m WHERE m.source_client_id = t.source_client_id)
    """)
    assert sin_correspondencia == 0


async def test_la_correspondencia_apunta_al_directorio(conexion_revertida):
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conexion_revertida.execute("""
            INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id)
            VALUES (gen_random_uuid(), 'qanalytics', 'zz-prueba', gen_random_uuid())
        """)


async def test_los_viajes_manuales_vigentes_con_cliente_del_directorio_tienen_su_id(conexion_revertida):
    sin_id = await conexion_revertida.fetchval("""
        SELECT count(*) FROM app.trips_manual m
        JOIN public.shippers sh ON lower(btrim(sh.name)) = lower(btrim(m.client_name))
        WHERE m.shipper_id IS NULL
    """)
    assert sin_id == 0
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje_integracion.py -q 2>&1 | tail -5`
Expected: FAIL. El primero no levanta `UniqueViolationError`, y los demás fallan con `UndefinedTableError` /
`UndefinedColumnError`.

- [ ] **Step 3: Escribir la migración**

`monitor-app/backend/supabase/migrations/20261011120000_cliente_del_viaje_por_id.sql`:

```sql
-- El cliente del viaje por ID, no por nombre (spec 2026-10-11).
--
-- Hasta hoy el viaje solo tenía el texto del cliente (client_name): "walmart"
-- desde el TMS, "Iansa" desde el alta manual. Cada pantalla lo cruzaba con el
-- directorio comparando texto en minúsculas, en 22 lugares. Renombrar un cliente
-- o un cambio de escritura en el TMS los dejaba sin cliente, sin aviso.
--
-- Esta migración agrega lo que necesita el modelo nuevo. app.trips.shipper_id
-- NO se agrega acá: app.trips es de dbt (sync_all_columns), y la columna entra
-- por el modelo, que la calcula.

BEGIN;

-- 1. El directorio no admite dos nombres que solo difieran en mayúsculas o espacios.
CREATE UNIQUE INDEX shippers_name_ci_key ON public.shippers (lower(btrim(name)));

-- 2. La correspondencia: cliente del TMS -> cliente del directorio.
--    source_client_id es la clave que ya calcula el pipeline
--    (md5(tms|source_client), stg_*_trips) y que app.trips ya guarda.
CREATE TABLE app.tms_client_shippers (
    source_client_id uuid PRIMARY KEY,
    source_system    text NOT NULL,
    source_client    text NOT NULL,
    shipper_id       uuid NOT NULL REFERENCES public.shippers(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid
);
COMMENT ON TABLE app.tms_client_shippers IS
  'Cliente de cada TMS -> cliente del directorio. Lo lee dbt para app.trips.shipper_id; se edita en Configuración › Clientes del TMS.';

INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id)
SELECT DISTINCT ON (t.source_client_id)
       t.source_client_id, t.source_system, lower(btrim(t.client_name)), sh.id
FROM app.trips t
JOIN public.shippers sh ON lower(btrim(sh.name)) = lower(btrim(t.client_name)) AND sh.status = 'ACTIVE'
WHERE t.source_client_id IS NOT NULL
ORDER BY t.source_client_id, t.status_reported_at DESC NULLS LAST;

-- Una correspondencia no se adivina: si un cliente del TMS con viajes no
-- encontró su cliente en el directorio, la migración no aplica nada.
DO $$
DECLARE faltan text;
BEGIN
  SELECT string_agg(DISTINCT t.source_system || '/' || t.client_name, ', ') INTO faltan
  FROM app.trips t
  WHERE t.source_client_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM app.tms_client_shippers m WHERE m.source_client_id = t.source_client_id);
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Clientes del TMS sin cliente en el directorio: %', faltan;
  END IF;
END $$;

ALTER TABLE app.tms_client_shippers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.tms_client_shippers FROM anon, authenticated;

-- 3. El viaje manual apunta al directorio. Lo escribe la API al dar de alta.
ALTER TABLE app.trips_manual ADD COLUMN shipper_id uuid REFERENCES public.shippers(id);

UPDATE app.trips_manual m SET shipper_id = sh.id
FROM public.shippers sh
WHERE lower(btrim(sh.name)) = lower(btrim(m.client_name)) AND sh.status = 'ACTIVE' AND m.shipper_id IS NULL;

COMMIT;
```

- [ ] **Step 4: Ensayar con ROLLBACK**

Con `mcp__claude_ai_Supabase__execute_sql` (proyecto `viclzoftiudkepqnhekv`), corre el contenido de la migración
cambiando el `COMMIT;` final por estas consultas y un `ROLLBACK;`:

```sql
SELECT (SELECT count(*) FROM app.tms_client_shippers) AS correspondencias,
       (SELECT count(*) FROM app.trips_manual WHERE shipper_id IS NOT NULL) AS manuales_con_id,
       (SELECT count(*) FROM app.trips_manual WHERE shipper_id IS NULL) AS manuales_sin_id;
ROLLBACK;
```

Expected: `correspondencias` = 4, `manuales_con_id` = 12, `manuales_sin_id` = 1 (el anulado "PRUEBA ANULACIÓN"). Si
algo difiere, detente y explica por qué antes de aplicar.

- [ ] **Step 5: Aplicar**

Con `mcp__claude_ai_Supabase__apply_migration`, `name: "cliente_del_viaje_por_id"` y el contenido del archivo **sin**
`BEGIN;`/`COMMIT;` (`apply_migration` ya abre su transacción). Si responde "Invalid or expired requestState",
comprueba con `list_migrations` si quedó aplicada antes de reintentar.

- [ ] **Step 6: Correr el test y verlo pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje_integracion.py -q -rs 2>&1 | tail -3`
Expected: 4 passed, ninguno SKIPPED.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261011120000_cliente_del_viaje_por_id.sql monitor-app/backend/api/tests/test_cliente_del_viaje_integracion.py
git commit -m "feat(db): cliente del viaje por ID — directorio único, correspondencia de clientes del TMS y viaje manual"
```

---

### Task 3: dbt — `app.trips.shipper_id`

**Files:**
- Modify (mirror, fuera de git): `.mage-agent/local_sync/dbt/tms/models/app/trips.sql`

**Interfaces:**
- Consumes: `app.tms_client_shippers` y `app.trips_manual.shipper_id` (Task 2).
- Produces: `app.trips.shipper_id uuid` (NULL = sin vincular) e índice `idx_trips_shipper`.

- [ ] **Step 1: Editar el modelo**

En `trips.sql`:

1. **El índice, en `post_hook`.** Después de la línea
   `"CREATE INDEX IF NOT EXISTS idx_trips_fleet_link ON {{ this }} (fleet_link_id)",`, agrega:
   ```
               "CREATE INDEX IF NOT EXISTS idx_trips_shipper ON {{ this }} (shipper_id)",
   ```

2. **Rama TMS.** En el `SELECT` que sigue a `filtered AS (...)`, inmediatamente después de `    client_name,`, agrega:
   ```sql
       -- El cliente del directorio (spec 2026-10-11): la correspondencia que se
       -- edita en Configuración › Clientes del TMS. NULL = sin vincular; nunca se
       -- adivina por nombre. Subconsulta y no JOIN: `filtered` comparte nombres de
       -- columna con la tabla (source_system, created_at) y el WHERE de abajo las
       -- usa sin calificar.
       (SELECT tcs.shipper_id FROM app.tms_client_shippers tcs
        WHERE tcs.source_client_id = filtered.source_client_id)  AS shipper_id,
   ```

3. **La escotilla OR 7.** Justo antes del `{% endif %}` que cierra el bloque incremental, el que está después del
   `OR EXISTS (...)` de la OR 6, agrega:
   ```sql
   -- OR 7 (11/10): el cliente del directorio que le corresponde al viaje cambió:
   -- se vinculó o se re-vinculó en Configuración. Misma escotilla que OR 3/4/6:
   -- un viaje bajo el watermark no vuelve a entrar si nadie lo trae. Se apaga sola.
   {% if 'shipper_id' in columnas_de_this %}
   OR EXISTS (
       SELECT 1 FROM {{ this }} t
       WHERE t.id = filtered.id
         AND t.shipper_id IS DISTINCT FROM (
             SELECT tcs.shipper_id FROM app.tms_client_shippers tcs
             WHERE tcs.source_client_id = filtered.source_client_id)
   )
   {% else %}
   -- Primera corrida con la columna: entra todo viaje con correspondencia, una vez.
   OR filtered.source_client_id IN (SELECT source_client_id FROM app.tms_client_shippers)
   {% endif %}
   ```
   Si `columnas_de_this` se define más abajo de donde va la OR 7, mueve el `{% set columnas_de_this = ... %}` antes de
   la primera escotilla que lo usa. No lo dupliques.

4. **Rama manual.** Inmediatamente después de `    m.client_name::varchar                              AS client_name,`,
   agrega:
   ```sql
       m.shipper_id                                        AS shipper_id,
   ```
   Las dos ramas del `UNION ALL` deben tener las columnas en el mismo orden: `shipper_id` va justo después de
   `client_name` en ambas.

- [ ] **Step 2: Revisar que compila**

Run: `grep -n "shipper_id" .mage-agent/local_sync/dbt/tms/models/app/trips.sql`
Expected: el índice, la columna en la rama TMS, las dos ramas de la OR 7 y la columna en la rama manual.

Revisa a mano que el `UNION ALL` quede con la misma cantidad de columnas en las dos ramas: cuenta las líneas `AS ...`
de ambas.

- [ ] **Step 3: Pedir confirmación y subir a Mage**

Muestra al usuario, en simple, qué se sube y qué hace la primera corrida: unos 3.400 viajes del TMS se reprocesan una
vez para recibir su cliente. **Espera su confirmación.** Con ella:
1. `mcp__mage-agent__sync_status`. Expected: solo `dbt/tms/models/app/trips.sql` en local_to_remote y 0 conflictos.
2. Revisa que no haya una corrida en vuelo: el `max(status_reported_at)` de `app.trips` no debe ser de los últimos 2
   minutos.
3. `mcp__mage-agent__sync_local_to_remote`.

- [ ] **Step 4: Esperar la corrida y verificar por SQL**

Espera la próxima corrida natural (cron de 15 minutos; usa `Monitor` con un until-loop sobre `max(pipeline_updated_at)`,
no `sleep`). Después:

```sql
SELECT
  (SELECT count(*) FROM app.trips WHERE source_system <> 'manual' AND source_client_id IS NOT NULL AND shipper_id IS NULL) AS tms_sin_id,
  (SELECT count(*) FROM app.trips WHERE source_system <> 'manual' AND shipper_id IS NOT NULL) AS tms_con_id,
  (SELECT count(*) FROM app.trips WHERE source_system = 'manual' AND shipper_id IS NOT NULL) AS manuales_con_id,
  (SELECT count(*) FROM app.trips t JOIN public.shippers sh ON sh.id = t.shipper_id
     WHERE lower(btrim(sh.name)) <> lower(btrim(t.client_name))) AS id_que_no_calza_con_el_nombre;
```

Expected:
- `tms_sin_id` = 0;
- `tms_con_id` ≈ 3.362, todos los del TMS;
- `manuales_con_id` = 12;
- `id_que_no_calza_con_el_nombre` = 0.

Si la corrida falla, lee `run_logs`, que se truncan a unos 8.000 caracteres. Si el error no se explica con lo visible,
**detente y pregunta**: no reintentes a ciegas.

- [ ] **Step 5: Ledger**

Anota `Task 3: dbt con shipper_id desplegado, corrida <hora>, verificación <cifras>`. El mirror está fuera de git: sin
commit.

---

### Task 4: Backend — una sola definición del cliente, y el alta por ID

**Files:**
- Create: `monitor-app/backend/api/app/services/cliente_del_viaje.py`
- Modify: `monitor-app/backend/api/app/routers/trips.py` (`TripCreateBody`, `_insert_trip`, `_manual_trip_id`)
- Modify: `monitor-app/backend/api/app/routers/shippers.py`
- Test: `monitor-app/backend/api/tests/test_cliente_del_viaje.py` (nuevo)
- Test: `monitor-app/backend/api/tests/test_cliente_del_viaje_integracion.py` (agregar)

**Interfaces:**
- Produces:
  - `JOIN_CLIENTE: str` = `"LEFT JOIN public.shippers sh ON sh.id = t.shipper_id"`. Para otros alias se usa
    `join_cliente(t, sh)`.
  - `nombre_del_cliente(t: str = "t", sh: str = "sh") -> str`, que devuelve el fragmento SQL
    `COALESCE(sh.name, t.client_name || ' · sin vincular')`.
  - `async resolver_cliente(conn, *, shipper_id: str | None, client_name: str | None) -> tuple[str, str]` → `(shipper_id, nombre_del_directorio)`. Responde 422 si no resuelve.
  - `TripCreateBody.shipper_id: Optional[str]`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_cliente_del_viaje.py`:

```python
"""Una sola definición del cliente del viaje (spec 2026-10-11)."""
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services.cliente_del_viaje import join_cliente, nombre_del_cliente, resolver_cliente


def test_el_cruce_es_por_id_y_nunca_por_texto():
    assert join_cliente("t", "sh") == "LEFT JOIN public.shippers sh ON sh.id = t.shipper_id"
    assert "lower(" not in join_cliente("t2", "s2")


def test_un_viaje_sin_vincular_se_muestra_con_el_texto_del_tms_y_la_marca():
    assert nombre_del_cliente("t", "sh") == "COALESCE(sh.name, t.client_name || ' · sin vincular')"


async def test_resolver_por_id_devuelve_el_nombre_del_directorio():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "s1", "name": "Walmart"}
    assert await resolver_cliente(conn, shipper_id="s1", client_name=None) == ("s1", "Walmart")


async def test_resolver_por_nombre_no_distingue_mayusculas_ni_espacios():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "s1", "name": "Walmart"}
    assert await resolver_cliente(conn, shipper_id=None, client_name="  WALMART ") == ("s1", "Walmart")
    assert "lower(btrim(name)) = lower(btrim($1))" in conn.fetchrow.call_args.args[0]


async def test_un_cliente_que_no_esta_en_el_directorio_se_rechaza():
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    with pytest.raises(HTTPException) as e:
        await resolver_cliente(conn, shipper_id=None, client_name="Prueba")
    assert e.value.status_code == 422
    assert e.value.detail == "El cliente «Prueba» no está en el directorio"


async def test_sin_cliente_se_rechaza():
    with pytest.raises(HTTPException) as e:
        await resolver_cliente(AsyncMock(), shipper_id=None, client_name="  ")
    assert e.value.detail == "Elige el cliente del viaje"
```

En `tests/test_cliente_del_viaje_integracion.py`, agrega:

```python
async def test_el_alta_manual_guarda_el_id_y_el_nombre_del_directorio(conexion_revertida):
    """El CSV trae "  IANSA "; queda el id de Iansa y el nombre del directorio,
    que es el que entra al id canónico del viaje."""
    from datetime import date

    from app.routers.trips import TripCreateBody, _insert_trip
    from tests.conftest import _usuario_real

    usuario = await _usuario_real(conexion_revertida)
    iansa = await conexion_revertida.fetchrow("SELECT id::text, name FROM public.shippers WHERE lower(name) = 'iansa'")
    body = TripCreateBody(planning_date=date(2099, 1, 2), client_name="  IANSA ", source_system_trip_id="ZZ-CLI-1")
    trip_id = await _insert_trip(conexion_revertida, body, usuario, valid_statuses=set())
    fila = await conexion_revertida.fetchrow(
        "SELECT shipper_id::text, client_name FROM app.trips_manual WHERE id = $1", trip_id)
    assert (fila["shipper_id"], fila["client_name"]) == (iansa["id"], iansa["name"])
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje.py tests/test_cliente_del_viaje_integracion.py -q 2>&1 | tail -4`
Expected: falla la colección con `ModuleNotFoundError: app.services.cliente_del_viaje`.

- [ ] **Step 3: Implementar el módulo**

`app/services/cliente_del_viaje.py`:

```python
"""El cliente del viaje, en un solo lugar (spec 2026-10-11).

El viaje guarda el ID de su cliente del directorio (app.trips.shipper_id,
calculado por dbt). Toda consulta cruza por ese ID con `join_cliente`, y lo que
se muestra sale de `nombre_del_cliente`. Antes, 22 lugares cruzaban comparando
el texto en minúsculas, y renombrar un cliente los dejaba sin cliente.

`client_name` (el texto del TMS o del alta) se conserva: es parte del ID del
viaje. Solo se muestra cuando el viaje no tiene cliente vinculado."""
from fastapi import HTTPException

JOIN_CLIENTE = "LEFT JOIN public.shippers sh ON sh.id = t.shipper_id"


def join_cliente(t: str = "t", sh: str = "sh") -> str:
    return f"LEFT JOIN public.shippers {sh} ON {sh}.id = {t}.shipper_id"


def nombre_del_cliente(t: str = "t", sh: str = "sh") -> str:
    """El nombre que se muestra: el del directorio. Un viaje sin cliente vinculado
    (un cliente nuevo del TMS) se ve con su texto y la marca, nunca desaparece."""
    return f"COALESCE({sh}.name, {t}.client_name || ' · sin vincular')"


async def resolver_cliente(conn, *, shipper_id: str | None, client_name: str | None) -> tuple[str, str]:
    """El cliente de un alta manual, contra el directorio: por ID (el formulario) o
    por nombre sin distinguir mayúsculas (la carga masiva CSV). Nada se guarda sin
    calzar con el directorio."""
    if shipper_id:
        fila = await conn.fetchrow(
            "SELECT id::text AS id, name FROM public.shippers WHERE id = $1::uuid AND status = 'ACTIVE'",
            shipper_id)
        if not fila:
            raise HTTPException(422, "El cliente elegido no está en el directorio")
        return fila["id"], fila["name"]
    nombre = (client_name or "").strip()
    if not nombre:
        raise HTTPException(422, "Elige el cliente del viaje")
    fila = await conn.fetchrow(
        "SELECT id::text AS id, name FROM public.shippers "
        "WHERE lower(btrim(name)) = lower(btrim($1)) AND status = 'ACTIVE'",
        nombre)
    if not fila:
        raise HTTPException(422, f"El cliente «{nombre}» no está en el directorio")
    return fila["id"], fila["name"]
```

- [ ] **Step 4: El alta manual**

En `app/routers/trips.py`:

1. **El cuerpo del alta.** En `TripCreateBody`, después de `client_name: Optional[str] = None`, agrega:
   ```python
       # El cliente del directorio (spec 2026-10-11). El formulario manda el id;
       # la carga CSV, el nombre, que se resuelve contra el directorio.
       shipper_id:             Optional[str] = None
   ```

2. **Resolver el cliente.** En `_insert_trip`, después de `_validate_create_body(body, valid_statuses)`, agrega:
   ```python
       # El cliente se resuelve contra el directorio antes de calcular el id: el
       # nombre del directorio es el que entra al id canónico del viaje.
       shipper_id, nombre_cliente = await resolver_cliente(
           conn, shipper_id=body.shipper_id, client_name=body.client_name)
       body = body.model_copy(update={"client_name": nombre_cliente, "shipper_id": shipper_id})
   ```

3. **Las dos inserciones.** En los dos `INSERT` (`app.trips_manual` y el espejo `app.trips`), agrega la columna
   `shipper_id` después de `client_name`, con su placeholder y el valor `body.shipper_id`. Renumera los `$n`.

4. **El import.** `from ..services.cliente_del_viaje import resolver_cliente`.

- [ ] **Step 5: El directorio**

En `app/routers/shippers.py`, cambia `if "shippers_name_key" in str(e):` por
`if "shippers_name_key" in str(e) or "shippers_name_ci_key" in str(e):`, y el mensaje por
`f"Ya existe un cliente llamado '{name}' (sin importar mayúsculas)"`.

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje.py tests/test_cliente_del_viaje_integracion.py tests/ -q -k "cliente or create or bulk or shipper" 2>&1 | tail -4`
Expected: todo PASS.

Los tests de alta existentes que mandan `client_name` libre fallan con 422 si su cliente no existe. Créalo en el test
dentro de su transacción, o mockea `resolver_cliente`. **No relajes la regla.**

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/services/cliente_del_viaje.py monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/app/routers/shippers.py monitor-app/backend/api/tests/
git commit -m "feat(viajes): el alta manual resuelve el cliente contra el directorio y guarda su id"
```

---

### Task 5: Backend — el Monitor y el Centro de Flota por ID

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py`
- Test: `monitor-app/backend/api/tests/test_cliente_del_viaje.py` (agregar)

**Interfaces:**
- Consumes: `join_cliente` y `nombre_del_cliente` (Task 4); `app.trips.shipper_id` (Task 3).
- Produces:
  - `GET /trips?shipper_id=<id,id|unlinked>` (reemplaza `client`);
  - `GET /trips/fleet-daily-overview?shipper_id=...` (reemplaza `client`);
  - `GET /trips/meta` → `clients: [{id, name}]`, que incluye `{id: 'unlinked', name: 'Sin cliente vinculado'}` si hay
    viajes sin vincular;
  - `_load_operation_type_buckets(pool, shipper_ids: set[str])`, indexado por `shipper_id`;
  - `_apply_operation_types(d, buckets)`, que lee `d["shipper_id"]`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_cliente_del_viaje.py`, agrega:

```python
import inspect

import app.routers.trips as trips


def test_la_lista_cruza_y_muestra_el_cliente_por_id():
    assert "sh.id = t.shipper_id" in trips._TRIP_FROM
    assert "COALESCE(sh.name, t.client_name || ' · sin vincular') AS client_name" in trips._TRIP_SELECT
    assert "t.client_name AS source_client_name" in trips._TRIP_SELECT


def test_el_filtro_de_cliente_es_por_id_y_acepta_los_sin_vincular():
    fuente = inspect.getsource(trips.list_trips)
    assert "shipper_id" in inspect.signature(trips.list_trips).parameters
    assert "client" not in inspect.signature(trips.list_trips).parameters
    assert "t.shipper_id IS NULL" in fuente and "t.shipper_id = ANY(" in fuente


def test_los_tipos_de_operacion_se_indexan_por_id():
    fuente = inspect.getsource(trips._load_operation_type_buckets)
    assert "s.id = ANY($1::uuid[])" in fuente and "lower(" not in fuente
```

Y en `tests/test_cliente_del_viaje_integracion.py`:

```python
async def test_renombrar_un_cliente_no_saca_sus_viajes_del_monitor(conexion_revertida):
    """El caso que motivó todo: con el cruce por texto, renombrar "Colun" dejaba
    sus viajes sin cliente."""
    from app.routers.trips import list_trips
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    colun = await conexion_revertida.fetchval("SELECT id::text FROM public.shippers WHERE lower(name) = 'colun'")
    await conexion_revertida.execute("UPDATE public.shippers SET name = 'Colun Renombrada' WHERE id = $1::uuid", colun)
    usuario = await _usuario_real(conexion_revertida)
    res = await list_trips(pool=PoolDeUnaConexion(conexion_revertida), user=usuario, shipper_id=colun, page_size=5)
    assert res["count"] > 0
    assert {d["client_name"] for d in res["data"]} == {"Colun Renombrada"}
```

Si la firma real de `list_trips` usa otros nombres para la paginación o el usuario, ajusta solo esos argumentos.

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje.py tests/test_cliente_del_viaje_integracion.py -q 2>&1 | tail -6`
Expected: los 4 nuevos fallan (no aparece `sh.id = t.shipper_id`, existe el parámetro `client`, etc.).

- [ ] **Step 3: Implementar en `trips.py`**

1. **`_TRIP_SELECT`.** La línea `    t.client_name,` pasa a:
   ```python
       COALESCE(sh.name, t.client_name || ' · sin vincular') AS client_name,
       t.client_name AS source_client_name,
   ```
   El texto es el de `nombre_del_cliente()`. `_TRIP_SELECT` es un string con `.format`, así que se escribe literal y lo
   fija el test de Step 1.

2. **`_TRIP_FROM`.** Reemplaza el comentario y el `LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = ...` por:
   ```python
       -- El cliente del directorio, por id (spec 2026-10-11; services/cliente_del_viaje.py).
       LEFT JOIN public.shippers sh ON sh.id = t.shipper_id
   ```

3. **Búsqueda.** Cambia `"OR t.client_name ILIKE '%'||$1||'%' "` por `"OR sh.name ILIKE '%'||$1||'%' "`, y agrega
   debajo `"OR t.client_name ILIKE '%'||$1||'%' "`: se busca por el nombre del directorio y también por el texto del
   TMS.

4. **Filtro de la lista.** En `list_trips`, cambia el parámetro `client: Annotated[str, Query()] = ""` por
   `shipper_id: Annotated[str, Query()] = ""`. Reemplaza el bloque `if client: ...` por:
   ```python
       if shipper_id:
           # Por id del directorio (spec 2026-10-11). "unlinked" = viajes de un
           # cliente del TMS todavía sin vincular en Configuración.
           ids = [s.strip() for s in shipper_id.split(',') if s.strip()]
           reales = [s for s in ids if s != 'unlinked']
           sin_vincular = 'unlinked' in ids
           if reales and sin_vincular:
               add("(t.shipper_id = ANY(?::uuid[]) OR t.shipper_id IS NULL)", reales)
           elif reales:
               add("t.shipper_id = ANY(?::uuid[])", reales)
           else:
               add("t.shipper_id IS NULL")
   ```
   Usa el helper `add` tal como está definido arriba en esa función. Si `add` no acepta una condición sin parámetro,
   agrega en el mismo helper el caso `params is None`, sin duplicar lógica fuera de él.

5. **Tipos de operación.** `_load_operation_type_buckets` pasa a recibir `shipper_ids: set[str]`:
   ```python
       rows = await pool.fetch(
           """
           SELECT s.id::text AS shipper_id, l.name, l.site_number, l.operation_type
           FROM public.locations l
           JOIN public.shippers s ON s.id = l.entity_id AND l.entity_type = 'SHIPPER'
           WHERE s.id = ANY($1::uuid[])
             AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
           """,
           list(shipper_ids),
       )
   ```
   La clave de `buckets` pasa a ser `r["shipper_id"]`, y el docstring dice "shipper_id → …".
   - En `_apply_operation_types`: `bucket = buckets.get(d.get("shipper_id"))`.
   - En la lista (`client_names.add(...)`), cámbialo por `shipper_ids.add(str(d["shipper_id"]))` cuando
     `d.get("shipper_id")`, y pasa `shipper_ids` al loader.
   - En el detalle (`client_names = {...}` cerca del final): `shipper_ids = {str(d["shipper_id"])} if
     d.get("shipper_id") else set()`.

6. **`/trips/meta`, `client_rows`.** Reemplaza la consulta por:
   ```python
       client_rows = await pool.fetch(
           "SELECT DISTINCT sh.id::text AS id, sh.name "
           "FROM app.trips t JOIN public.shippers sh ON sh.id = t.shipper_id "
           "ORDER BY sh.name"
       )
       hay_sin_vincular = await pool.fetchval(
           "SELECT EXISTS (SELECT 1 FROM app.trips WHERE shipper_id IS NULL AND voided_at IS NULL)")
   ```
   Arma `clients=[ClientMeta(**dict(r)) for r in client_rows] + ([ClientMeta(id="unlinked", name="Sin cliente
   vinculado")] if hay_sin_vincular else [])`.

7. **`fleet-daily-overview`.**
   - El parámetro `client` pasa a ser `shipper_id`.
   - Los CTE que seleccionan `t.client_name` pasan a `t.shipper_id, COALESCE(sh.name, t.client_name || ' · sin
     vincular') AS client_name`, con `LEFT JOIN public.shippers sh ON sh.id = t.shipper_id`.
   - La lista de `carrier_shippers` pasa a compararse por id:
     `SELECT cs.carrier_id, cs.shipper_id::text AS shipper_id ...`, y
     `carriers_for_client = {r["carrier_id"] for r in rows if r["shipper_id"] in ids}`.
   - `today_client_ok = str(r["shipper_id"]) in ids`.
   - En `busy_trip` (la consulta de equipos ocupados), lo mismo: id y nombre que se muestra.

8. **El import.** `from ..services.cliente_del_viaje import nombre_del_cliente`. Úsalo donde se arma SQL con f-string;
   en los strings con `.format`, el literal fijado por el test.

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje.py tests/test_cliente_del_viaje_integracion.py tests/test_trips*.py -q 2>&1 | tail -4`
Expected: todo PASS. Los tests existentes que llaman `list_trips(client=...)` pasan a `shipper_id=` con un id del
directorio.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/
git commit -m "feat(viajes): el Monitor y el Centro de Flota cruzan y filtran el cliente por id"
```

---

### Task 6: Backend — Cierre, Reporte y Pre-cierre por ID

**Files:**
- Modify: `app/routers/daily_closures.py`, `app/routers/equipment_closures.py`, `app/services/cierre_viajes.py`,
  `app/routers/drivers.py`, `app/services/pre_cierre.py`, `app/routers/status_report.py`
- Test: `tests/test_status_report.py`, `tests/test_pre_cierre.py`, `tests/test_cliente_del_viaje.py`

**Interfaces:**
- Consumes: `join_cliente` y `nombre_del_cliente` (Task 4); `_load_operation_type_buckets(pool, shipper_ids)` (Task 5).
- Produces:
  - `GET /status-report?shipper_id=<id>` (reemplaza `client`);
  - `clients: [{shipper_id, client_name, assigned, by_operation_type}]`;
  - `client_filter` = el id elegido;
  - `ParCliente(plate, shipper_id, shipper_name)`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_cliente_del_viaje.py`:

```python
import pathlib
import re

APP = pathlib.Path(__file__).resolve().parents[1] / "app"
CRUCE_POR_TEXTO = re.compile(r"lower\((b?trim\()?(sh2?|s|hs)\.name|lower\((b?trim\()?t\.client_name|upper\(trim\(name\)\)")


def test_ningun_cruce_de_cliente_por_texto_queda_en_el_backend():
    """El criterio de aceptación del spec §5."""
    hallazgos = [f"{p.relative_to(APP)}:{i}" for p in APP.rglob("*.py")
                 for i, linea in enumerate(p.read_text().splitlines(), 1) if CRUCE_POR_TEXTO.search(linea)]
    assert hallazgos == []
```

En `tests/test_status_report.py`:
- Las filas de `_row` agregan `"shipper_id": "s1"`.
- `CLIENTES_POR_EMPRESA` pasa a ids: `{"c1": ["s1"], "c2": ["s2", "s3"]}`.
- Los tests de `_clientes_de_la_fila` y `_filter_by_client` esperan ids.
- El test de `_clientes_del_dia` espera:
  `{"shipper_id": "s1", "client_name": "Walmart", "assigned": 2, "by_operation_type": {...}}`.
- El test del endpoint usa `?shipper_id=s1`.

Agrega:

```python
def test_el_filtro_compara_ids_y_no_nombres():
    rows = [_row(asset_id="a1", shipper_id="s1", client_name="Walmart"),
            _row(asset_id="a2", shipper_id="s9", client_name="Walmart")]  # mismo nombre, otro id
    assert [r["asset_id"] for r in _filter_by_client(rows, "s1", {})] == ["a1"]
```

En `tests/test_pre_cierre.py`, los `ParCliente(plate=..., client_name="walmart")` pasan a
`ParCliente(plate="ABCD12", shipper_id=S1, shipper_name="Walmart")`, y se elimina `clientes_por_clave` de los
`Senales(...)`.

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje.py tests/test_status_report.py tests/test_pre_cierre.py -q 2>&1 | tail -6`
Expected: falla `test_ningun_cruce_de_cliente_por_texto…` con la lista de lugares, y fallan los tests ajustados.

- [ ] **Step 3: Migrar cada lectura**

Cada reemplazo usa `join_cliente(...)` y `nombre_del_cliente(...)` del módulo (f-strings), o su literal exacto si el SQL
no es f-string.

1. **`daily_closures.py`**, las dos LATERAL de clientes (cerca de las líneas 100 y 197):
   ```sql
   SELECT array_agg(DISTINCT COALESCE(sh.name, t.client_name || ' · sin vincular')) AS client_names
   FROM app.trip_fleet_links fl
   JOIN app.trips t ON t.id = fl.trip_id
   LEFT JOIN public.shippers sh ON sh.id = t.shipper_id
   WHERE fl.driver_id = dds.driver_id AND t.planning_date = dds.business_date AND t.client_name IS NOT NULL
   ```
2. **`equipment_closures.py`**, en `today_trip`: `COALESCE(sh.name, t.client_name || ' · sin vincular') AS
   client_name` y `LEFT JOIN public.shippers sh ON sh.id = t.shipper_id`. Borra el comentario del cruce por texto.
3. **`services/cierre_viajes.py`**: `LEFT JOIN public.shippers sh ON sh.id = t.shipper_id`. Donde `SQL_BASE`
   selecciona el cliente, usa el nombre que se muestra.
4. **`drivers.py`** `_SQL_SUGERENCIA_CD`: `JOIN public.shippers sh ON sh.id = t.shipper_id AND sh.status = 'ACTIVE'`.
5. **`services/pre_cierre.py`:**
   - `ParCliente` pasa a `plate: str; shipper_id: str; shipper_name: str`.
   - `_SQL_PARES_CLIENTE`:
     ```sql
     SELECT DISTINCT upper(trim(t.fleet->>'tractor_plate')) AS plate, t.shipper_id::text AS shipper_id, sh.name AS shipper_name
     FROM app.trips t
     JOIN public.shippers sh ON sh.id = t.shipper_id AND sh.status = 'ACTIVE'
     WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'tractor_plate' IS NOT NULL
     ```
   - Borra `claves_cliente`, la consulta `upper(trim(name))` y `clientes_por_clave`, del dataclass `Senales` y de su
     construcción.
   - En la clasificación, `shipper_id, shipper_name = par.shipper_id, par.shipper_name`.
6. **`status_report.py`:**
   - **`_TODAY_TRIPS_SQL`:** `t.shipper_id::text AS shipper_id`, `COALESCE(sh.name, t.client_name || ' · sin
     vincular') AS client_name` y `LEFT JOIN public.shippers sh ON sh.id = t.shipper_id`.
   - **`_build_asset_rows`:** `shipper_ids = {r["shipper_id"] for r in trip_rows if r["shipper_id"]}` para el loader,
     `buckets.get(latest["shipper_id"])`, y la fila agrega `"shipper_id": latest["shipper_id"] if latest else None`.
   - **`_SQL_CLIENTES_POR_EMPRESA`:** devuelve `array_agg(DISTINCT sh.id::text) AS clients`, con ids.
   - **`_clientes_de_la_fila`:** con carga devuelve `[fila["shipper_id"]] if fila["shipper_id"] else []`; sin carga,
     los ids de su empresa.
   - **`_filter_by_client(rows, shipper_id, clientes_por_empresa)`:** `shipper_id in _clientes_de_la_fila(...)`, sin
     `lower`.
   - **`_clientes_del_dia`:** agrupa por `shipper_id` (salta los `None`) y devuelve `shipper_id` y `client_name`.
   - **`get_status_report`:** recibe `shipper_id: str | None = None` en vez de `client`, y `client_filter` devuelve
     ese id.

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cliente_del_viaje.py tests/test_status_report.py tests/test_reporte_de_estatus_integracion.py tests/test_pre_cierre.py tests/test_pre_cierre_integracion.py tests/test_daily_closures*.py tests/test_equipment_closures*.py tests/test_cierre_viajes*.py tests/test_drivers*.py -q 2>&1 | tail -5`
Expected: todo PASS, incluido el `grep` vacío.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app monitor-app/backend/api/tests
git commit -m "feat(cierre): Cierre, Reporte y Pre-cierre cruzan el cliente por id; ningún cruce por texto queda en el backend"
```

---

### Task 7: Backend — la correspondencia de clientes del TMS

**Files:**
- Create: `monitor-app/backend/api/app/routers/tms_clients.py`
- Modify: `monitor-app/backend/api/app/main.py`
- Test: `monitor-app/backend/api/tests/test_tms_clients.py` (nuevo) y `tests/test_cliente_del_viaje_integracion.py`

**Interfaces:**
- Produces:
  - `GET /api/v1/tms-clients` → `[{source_client_id, source_system, source_client, trips, shipper_id, shipper_name}]`.
    Primero los sin vincular; después, por TMS y cliente.
  - `PUT /api/v1/tms-clients/{source_client_id}` con body `{shipper_id}` → 200 con la fila.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/test_tms_clients.py`:

```python
"""Configuración › Clientes del TMS (spec 2026-10-11 §4)."""
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.tms_clients import _SQL_LISTA, router
from tests.conftest import USER, con_roles


def _cliente(pool, usuario=USER):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: usuario
    return TestClient(app)


def test_la_lista_sale_de_los_viajes_y_pone_primero_los_sin_vincular():
    assert "FROM app.trips t" in _SQL_LISTA
    assert "LEFT JOIN app.tms_client_shippers" in _SQL_LISTA
    assert "ORDER BY (m.shipper_id IS NULL) DESC" in _SQL_LISTA


def test_vincular_exige_un_cliente_del_directorio():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [None]  # el shipper no existe
    res = _cliente(pool).put("/api/v1/tms-clients/00000000-0000-0000-0000-000000000001",
                             json={"shipper_id": "00000000-0000-0000-0000-000000000002"})
    assert res.status_code == 422
```

En `tests/test_cliente_del_viaje_integracion.py`:

```python
async def test_vincular_un_cliente_del_tms_escribe_la_correspondencia(conexion_revertida):
    from app.routers.tms_clients import VinculoBody, vincular
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    fila = await conexion_revertida.fetchrow(
        "SELECT source_client_id::text AS id FROM app.tms_client_shippers LIMIT 1")
    otro = await conexion_revertida.fetchval("SELECT id::text FROM public.shippers WHERE lower(name) = 'hbc'")
    usuario = await _usuario_real(conexion_revertida)
    res = await vincular(fila["id"], VinculoBody(shipper_id=otro), pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert res["shipper_id"] == otro
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_tms_clients.py -q 2>&1 | tail -3`
Expected: `ModuleNotFoundError: app.routers.tms_clients`.

- [ ] **Step 3: Implementar**

`app/routers/tms_clients.py`:

```python
"""Configuración › Clientes del TMS (spec 2026-10-11 §4): a qué cliente del
directorio corresponde cada cliente de cada TMS. dbt la lee para
app.trips.shipper_id; un cambio se aplica a los viajes, incluidos los viejos, en
la próxima corrida (escotilla OR 7 del modelo trips)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..authz import Permission, require
from ..db import get_pool

router = APIRouter(prefix="/tms-clients", tags=["tms-clients"])

# La lista sale de los viajes: un cliente nuevo del TMS aparece solo, sin vincular.
_SQL_LISTA = """
SELECT t.source_client_id::text AS source_client_id,
       min(t.source_system) AS source_system,
       -- El texto tal como lo manda el TMS: es lo que se muestra, no se compara.
       COALESCE(min(m.source_client), min(t.client_name)) AS source_client,
       count(*) AS trips,
       m.shipper_id::text AS shipper_id,
       sh.name AS shipper_name
FROM app.trips t
LEFT JOIN app.tms_client_shippers m ON m.source_client_id = t.source_client_id
LEFT JOIN public.shippers sh ON sh.id = m.shipper_id
WHERE t.source_client_id IS NOT NULL
GROUP BY t.source_client_id, m.shipper_id, sh.name
ORDER BY (m.shipper_id IS NULL) DESC, min(t.source_system), min(t.client_name)
"""


class VinculoBody(BaseModel):
    shipper_id: str


@router.get("")
async def listar(pool=Depends(get_pool), _=Depends(require(Permission.COMMERCIAL_READ))):
    return [dict(r) for r in await pool.fetch(_SQL_LISTA)]


@router.put("/{source_client_id}")
async def vincular(source_client_id: str, body: VinculoBody, pool=Depends(get_pool),
                   user=Depends(require(Permission.COMMERCIAL_EDIT))):
    shipper_id = body.shipper_id
    async with pool.acquire() as conn:
        cliente = await conn.fetchrow(
            "SELECT id FROM public.shippers WHERE id = $1::uuid AND status = 'ACTIVE'", shipper_id)
        if not cliente:
            raise HTTPException(422, "El cliente elegido no está en el directorio")
        origen = await conn.fetchrow(
            "SELECT min(source_system) AS source_system, min(client_name) AS source_client "
            "FROM app.trips WHERE source_client_id = $1::uuid", source_client_id)
        if not origen or origen["source_system"] is None:
            raise HTTPException(404, "Ese cliente del TMS no tiene viajes")
        fila = await conn.fetchrow(
            """
            INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id, created_by)
            VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid)
            ON CONFLICT (source_client_id) DO UPDATE SET shipper_id = EXCLUDED.shipper_id
            RETURNING source_client_id::text AS source_client_id, shipper_id::text AS shipper_id
            """,
            source_client_id, origen["source_system"], origen["source_client"], shipper_id, user["sub"])
    return dict(fila)
```

Si `require(...)` no devuelve el usuario, sigue el patrón de otro router que escribe auditoría con
`Depends(get_current_user)` además del permiso. En `app/main.py`, importa y monta
`tms_clients_router` con `prefix="/api/v1"` junto a los demás.

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_tms_clients.py tests/test_cliente_del_viaje_integracion.py -q 2>&1 | tail -3`
Expected: todo PASS.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/tms_clients.py monitor-app/backend/api/app/main.py monitor-app/backend/api/tests/
git commit -m "feat(config): API de la correspondencia de clientes del TMS"
```

---

### Task 8: Frontend — elegir y filtrar el cliente por ID

**Files:**
- Modify: `components/dashboard/ClientPicker.tsx`, `components/dashboard/TripAssignDialog.tsx`,
  `components/dashboard/TripCard.tsx`
- Modify: `app/dashboard/operations/monitor/page.tsx`, `hooks/useDiarioFilters.ts`, `lib/api/trips.ts`
- Modify: `components/dashboard/sections/StatusReportSection.tsx`, `lib/api/statusReport.ts`, `lib/types.ts`
- Test: los `.test.tsx` de cada uno

**Interfaces:**
- Consumes: `shipper_id` en el alta (Task 4), `?shipper_id=` en el Monitor (Task 5) y en el Reporte (Task 6).
- Produces: `ClientPicker({ value: {id, name} | null, onChange: (c: {id, name} | null) => void })`.

- [ ] **Step 1: Escribir los tests que fallan**

1. **`ClientPicker.test.tsx`**, nuevo o agregado. Elegir "Walmart" de la lista llama
   `onChange({ id: 's1', name: 'Walmart' })`, y crear "Nuevo" llama `onChange({ id, name: 'Nuevo' })` con el id que
   devolvió la API.
2. **`TripAssignDialog.test.tsx`.** El alta manda `shipper_id: 's1'` y no `client_name`. Sin cliente elegido, el botón
   de guardar está deshabilitado y dice "Elige el cliente del viaje".
3. **`app/dashboard/operations/monitor/page.test.tsx`.** Con `tripsMeta.clients = [{id:'s1', name:'Walmart'}]`, tocar
   el chip "Walmart" pide la lista con `shipper_id: 's1'`.
4. **`StatusReportSection.test.tsx`.**
   - `clients` trae `shipper_id`; el `<option value>` es el id y el texto es "Walmart (29)".
   - Elegirlo llama `statusReportApi.get('2026-08-02', 's1')`.
   - El resumen imprimible muestra el nombre, no el id.
5. **`TripCard.test.tsx`.** El cliente se muestra tal cual viene ("Walmart"), sin la clase `capitalize`.

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/ClientPicker.test.tsx components/dashboard/TripAssignDialog.test.tsx components/dashboard/TripCard.test.tsx components/dashboard/sections/StatusReportSection.test.tsx app/dashboard/operations/monitor/ 2>&1 | grep -E "Tests |×"`
Expected: fallan los nuevos.

- [ ] **Step 3: Implementar**

1. **`ClientPicker`.**
   - Props `value: { id: string; name: string } | null` y `onChange(c: { id; name } | null)`.
   - El texto que se escribe vive en estado interno (`texto`). Elegir de la lista llama `onChange({ id: s.id, name:
     s.name })`, y crear usa el `created` que devuelve la API: `onChange({ id: created.id, name: created.name })`.
   - En la carrera del 409, refresca la lista y elige la entrada que coincide sin distinguir mayúsculas.
   - Escribir sin elegir llama `onChange(null)`.
   - Actualiza el docstring de `Props`: deja de ser texto libre.
2. **`TripAssignDialog`.**
   - El estado `cliente: {id, name} | null` reemplaza `clientName`.
   - El payload manda `shipper_id: cliente?.id`; el formulario no se envía sin cliente.
   - El id canónico del viaje lo sigue calculando el backend con el nombre del directorio.
3. **`lib/types.ts`.**
   - `TripCreatePayload.shipper_id?: string | null`.
   - `StatusReport.clients[].shipper_id: string`.
   - `Trip.source_client_name?: string | null`.
4. **El Monitor.**
   - En `useDiarioFilters`, `fClient` guarda ids, y el chip usa `c.id` (`toggleClient`, `id: c.id`;
     `f.fClient.includes(c.id)`).
   - En `lib/api/trips.ts`, `qs.set('shipper_id', params.shipper_id)`; el campo `client` de los parámetros pasa a
     llamarse `shipper_id`.
   - `page.tsx` manda `shipper_id: f.fClient.join(',')`.
   - En `fleetDailyOverview`, el parámetro pasa a ser `shipperIds?: string[]` y se envía como `shipper_id`.
5. **El Reporte.**
   - `client` guarda el `shipper_id`.
   - Opciones: `<option value={c.shipper_id}>{c.client_name} ({…})</option>`.
   - El "(0)" del cliente elegido que no operó ese día se arma con su nombre, guardado en estado junto al id al
     elegirlo.
   - El resumen imprimible usa ese nombre.
   - `statusReportApi.get(fecha, shipperId)` envía `shipper_id`.
6. **`TripCard`.** Quita `capitalize` del span del cliente.

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/ app/dashboard/operations/ hooks/ lib/ 2>&1 | grep -E "Tests |×" && npx tsc --noEmit`
Expected: todo PASS y tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend
git commit -m "feat(viajes): el cliente se elige y se filtra por id del directorio"
```

---

### Task 9: Frontend — Configuración › Clientes del TMS

**Files:**
- Create: `monitor-app/frontend/lib/api/tmsClients.ts`
- Create: `monitor-app/frontend/app/dashboard/admin/settings/clientes-del-tms.tsx` (+ `.test.tsx`)
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/dominios.ts`, `secciones.ts`

**Interfaces:**
- Consumes: `GET`/`PUT /api/v1/tms-clients` (Task 7) y `shippersApi.list()`.
- Produces: la sección `tms-clients` en el dominio Operaciones.

- [ ] **Step 1: Escribir el test que falla**

`clientes-del-tms.test.tsx`, siguiendo el patrón de los tests de `origenes`:
- **Arriba, el aviso de los sin vincular:** con 1 sin vincular, "1 cliente del TMS sin vincular: sus viajes no aparecen
  en los filtros por cliente".
- **La tabla:** muestra TMS, Cliente en el TMS, Viajes y Cliente del directorio.
- **Vincular:** elegir "Colun" en el selector de la fila llama `tmsClientsApi.vincular(id, 's4')`. Después se ve "Se
  aplicará a sus viajes en la próxima actualización".
- **Sin `commercial.edit`:** no hay selector, solo el nombre.
- **Vacío:** sin sin-vincular, no hay aviso, y la lista muestra los vinculados. Sin ningún cliente del TMS: "Todos los
  clientes del TMS están vinculados".
- **Error:** muestra "Reintentar".

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run app/dashboard/admin/settings/clientes-del-tms.test.tsx`
Expected: FAIL. El módulo no existe.

- [ ] **Step 3: Implementar**

- **`lib/api/tmsClients.ts`:** `list()` → `GET /api/v1/tms-clients`; `vincular(sourceClientId, shipperId)` →
  `PUT /api/v1/tms-clients/{id}` con `{ shipper_id }`. Tipo `TmsClient` en `lib/types.ts`.
- **`clientes-del-tms.tsx`:**
  - Exporta `ClientesDelTmsTab`, con la estructura de `origenes.tsx`: `useConfigList`, `LoadState`, `INPUT`,
    `useRowFeedback`, y `usePuedeEditarSeccion('tms-clients')`.
  - Selector de cliente del directorio por fila.
  - Las filas sin vincular van arriba, con el token `espera` que ya existe.
  - Sin tamaños ni colores nuevos.
- **`dominios.ts`:** en el dominio Operaciones, después de `origins`, agrega
  `{ clave: 'tms-clients', titulo: 'Clientes del TMS', proposito: 'A qué cliente del directorio corresponde cada cliente
  de cada TMS', Panel: ClientesDelTmsTab }`.
- **`secciones.ts`:** `'tms-clients': 'commercial.edit'`.

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/frontend && npx vitest run app/dashboard/admin/settings/ lib/ 2>&1 | grep -E "Tests |×" && npx tsc --noEmit`
Expected: todo PASS. `lib/rutas.test.ts` no cambia: no hay carpeta nueva en `app/`.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend
git commit -m "feat(config): Clientes del TMS — vincular cada cliente del TMS con el directorio"
```

---

### Task 10: Suite completa, despliegue, verificación y AGENTLOG

- [ ] **Step 1: Suite completa del backend, una vez, en segundo plano, y vitest completo**

Este cambio toca código compartido (`trips.py`, `cierre_*`, `pre_cierre`).

Run (en segundo plano): `cd monitor-app/backend/api && venv/bin/python -m pytest -q > "$CLAUDE_JOB_DIR/tmp/suite.txt" 2>&1; tail -5 "$CLAUDE_JOB_DIR/tmp/suite.txt"`
Expected: verde, salvo la roja preexistente `test_cargar_catalogo_webcarga::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar`.

Run: `cd monitor-app/frontend && npx vitest run 2>&1 | grep -E "Test Files|Tests "`. Corre desde `monitor-app/frontend`.
Expected: verde.

- [ ] **Step 2: Push y los dos despliegues**

```bash
git push origin dev
gh run list --branch dev --limit 2
gh run watch <id-backend> --exit-status
gh run watch <id-frontend> --exit-status
```

- [ ] **Step 3: Verificar en dev (Playwright, sin escribir datos reales)**

1. **Monitor:** los chips de cliente (Walmart, Iansa, Sodimac, Colun…) filtran; el nombre se ve como en el directorio.
2. **Cierre, 07/10:** el reporte da las mismas cifras de antes: Tractoreo 32; Equipo Completo 3.
3. **Configuración › Operaciones › Clientes del TMS:** los 4 vinculados; ninguno sin vincular.
4. **Viaje manual:** abre el formulario, comprueba que exige elegir el cliente y **cancela**. No crees viajes reales.

- [ ] **Step 4: AGENTLOG**

Agrega en `AGENTLOG.md` una entrada "2026-10-11 — El cliente del viaje por ID — en dev":
- **Qué se hizo:** la migración, la corrida de dbt y las cifras de la Task 3; ningún cruce por texto en el backend
  (`grep` del test vacío).
- **Decisiones:**
  - `client_name` intacto porque es identidad del viaje;
  - la resolución del CSV por nombre;
  - el nombre que se muestra, con una sola definición;
  - los filtros por id con `unlinked`.
- **Siguiente paso:**
  - el reporte por período;
  - los ítems de la minuta.

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): el cliente del viaje por ID en dev"
git push origin dev
```
