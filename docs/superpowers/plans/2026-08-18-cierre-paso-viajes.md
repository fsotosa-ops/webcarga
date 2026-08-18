# El paso "Viajes" del Cierre — plan

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Goal:** que el Cierre del Día tenga por primera vez el paso donde operaciones declara **por qué no
tomamos una carga**, y que esa declaración quede al lado del estado del TMS sin pisarlo.

**Architecture:** tres endpoints nuevos sobre tablas que ya existen (`app.trips`,
`app.status_taxonomies`, `app.daily_closures`), más una pestaña en el Centro de Cierre. No se toca
`app.trips` con migraciones: esa tabla la escribe dbt con `on_schema_change='sync_all_columns'` y una
columna agregada por fuera **se elimina en la corrida siguiente**. La única columna nueva va en
`app.daily_closures`, que es tabla de la app y dbt no toca.

**Tech Stack:** FastAPI + asyncpg · Next.js 15 + React Query · Vitest · pytest con
`monitor-app/backend/api/venv`.

**Spec:** `docs/superpowers/specs/2026-08-16-cierre-de-viajes-design.md` (§6 completo, §11 items 4 y 5)

## Global Constraints

- **Español neutral, nunca voseo.** Lo verifica `lib/copy/espanol-neutral.test.ts`.
- **Cero emojis**, sólo `lucide-react`.
- **No agregar tamaños de letra ni colores nuevos.** El trinquete de `lib/ui/sistema.test.ts` falla
  si crecen: tope 1780 usos de color crudo, 9 `<h1>` fuera de `EncabezadoDePagina`. Los grises sin
  token viven en `lib/ui/texto.ts` (`TEXTO_APOYO`, `TEXTO_CUERPO`).
- Una cifra derivada **no se muestra hasta tener el dato**; las acciones que escriben quedan
  deshabilitadas mientras carga lo que necesitan.
- Los tests que ejecutan SQL usan `conexion_revertida` + `pytest.mark.integracion`, y reciben el pool
  vía `PoolDeUnaConexion` (en `tests/conftest.py`).
- **Cada test nuevo se verifica fallando antes de escribir la corrección.**
- **El `trip_status` del TMS no se toca NUNCA.** Es la regla 1 de Pablo: *"si nos ponemos a corregir
  el TMS nos vamos a volver mono"*.

---

## Las cuatro reglas que ordenan este plan

De la reunión del 2026-08-14 (spec §2):

1. **El TMS manda.** No se corrige ni se fuerza un estado.
2. **La única escritura de WebCarga es "no asignado por WebCarga"**, sobre las cargas que nos
   ofrecieron y no tomamos, con motivo. *"Este es el acusete de operaciones."*
3. **El reporte se arregla en el reporte, no en los estados.**
4. **Un viaje que el TMS no cerró tiene que seguir a la vista.** *"Si no me cerraron el viaje no me
   lo van a pagar."*

## Los cuatro grupos, medidos hoy (2026-08-18)

| Grupo | Predicado | Hoy | Bloquea el cierre |
|---|---|---|---|
| **Hoy** | `is_active AND NOT is_assigned AND planning_date = $1` | 2 | Sí |
| **Rezago** | `is_active AND NOT is_assigned AND planning_date < $1` | 17 | Sí |
| **En curso** | `is_active AND is_assigned AND planning_date < $1` | 6 | No |
| **Abandonados por el TMS** | grupo no terminal `AND now() - status_reported_at > 7 días` | 46 | No |

Los tres primeros salen de columnas que **ya existen y están pobladas** (`app_trips.sql` deriva
`is_assigned` con la definición literal de Pablo). El cuarto es nuevo y **no se deriva de
`is_active`** — `is_active` ya los descartó, ese es justamente el problema que resuelve.

**Sobre "no terminal":** `app.trip_statuses` no tiene columna `is_terminal`; tiene `group_id` con
seis valores. Se usan los cuatro que significan "en curso": `en_ruta`, `retornando`, `en_local`,
`otro`. Se excluye `problema` a propósito: mezcla `Cancelado` y `Sin Registros` (terminales) con
`En Pana` (que no lo es). Medido, excluirlo **no cuesta nada hoy** — ninguna fila `En Pana` supera
los 7 días. Arreglar esa mezcla es un ítem de catálogo aparte, no de este plan.

**El umbral de 7 días no está confirmado con operaciones** (spec §11 item 5). Va como constante
nombrada en un solo lugar para que cambiarlo sea editar una línea.

---

## "Posterior al cierre" — el vocabulario, decidido el 2026-08-18

**El día NO se reabre.** La firma es una afirmación sobre un instante; si se recalcula, no afirma
nada — es el mismo principio que la Ronda 122 aplicó al modelo de flota.

Cuando el TMS crea un viaje **con fecha retroactiva** (Fabián: *"los crean el dieciséis, pero con
fechas del catorce"*), ese viaje no invalida la firma: forma un **delta**. Los dos estándares de la
industria coinciden en esto —contabilidad lo llama *post-close entries* y reserva "reabrir" para un
acto deliberado de administrador; ingeniería de datos lo llama *late-arriving facts* contra un
*watermark*— y ninguno de los dos deshace el cierre.

- El día muestra **"Cerrado"** y al lado **"N posteriores al cierre"**.
- **La firma original queda intacta.** Resolver el delta produce un **complemento**, un registro
  aparte, no una firma que pisa a la anterior.
- No se usa la palabra **"rezago"**: ya está tomada por el grupo 2 de arriba.

**Honestidad sobre la urgencia:** esto es un riesgo real pero **no se ha observado ni una vez** en
la ventana limpia (08-08 al 08-16: 0 viajes con fecha retroactiva sobre 303). Los números altos que
aparecen si uno mide desde julio están contaminados por una carga masiva del 07/08 que trajo 126
filas planificadas desde el 1 de julio. Se construye igual porque **sin guardar el conteo al firmar
no hay con qué comparar después**, y ese dato no se puede reconstruir retroactivamente.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20260818130000_trip_unassigned_reasons.sql` | Semilla del dominio `TRIP_UNASSIGNED_REASON` |
| `supabase/migrations/20260818130100_daily_closures_total_trips.sql` | `total_trips` en `app.daily_closures` |
| `app/services/cierre_viajes.py` | Los 4 grupos: un solo lugar donde vive su definición |
| `app/routers/trips.py` | `GET /trips/cierre-viajes` · `PATCH /bulk-close` acepta motivo |
| `app/routers/daily_closures.py` | `POST /close` guarda `total_trips` · `GET` expone el delta |
| `tests/test_cierre_viajes.py` | Los grupos y el motivo, contra Postgres real |
| `components/dashboard/sections/PasoViajesSection.tsx` | La pestaña: 4 grupos, selección y motivo en lote |
| `components/dashboard/AvisoPosteriorAlCierre.tsx` | El aviso del delta sobre un día ya firmado |
| `app/dashboard/operations/closures/page.tsx` | Cuarta pestaña "Viajes" |
| `lib/types.ts` | `ViajeDelCierre`, `GrupoDelCierre`, `CierreViajesResponse` |
| `lib/api/trips.ts` · `lib/api/dailyClosures.ts` | Clientes |
| `hooks/useDiarioFilters.ts` · `components/dashboard/FilterPopover.tsx` | Filtro "No asignado por WebCarga" en el historial |

---

## Task 1: Sembrar el dominio `TRIP_UNASSIGNED_REASON`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260818130000_trip_unassigned_reasons.sql`
- Test: `monitor-app/backend/api/tests/test_cierre_viajes.py`

**Interfaces:**
- Produce: el dominio `TRIP_UNASSIGNED_REASON` en `app.status_taxonomies`, con `code` estable.

**Por qué es la Task 1 y no un detalle:** `status_taxonomies.py:30` tiene
`_exigir_dominio_conocido()`, que **devuelve 422 si el dominio no tiene ni una fila**. Sin semilla,
la pestaña de Configuración y el selector de motivos fallan con "domain desconocido". Es
prerrequisito duro de todo lo demás.

Los 16 motivos de `DRIVER_REASON` responden otra pregunta (Médico, Vacaciones, No se presentó) y
ninguno de los que nombraron Pablo y Fabián existe. Dominio nuevo, decidido el 2026-08-18.

- [ ] **Step 1: Escribir el test que falla**

```python
# monitor-app/backend/api/tests/test_cierre_viajes.py
"""El paso "Viajes" del Cierre.

La unica escritura de WebCarga sobre un viaje es "no asignado por WebCarga",
con motivo (regla 2 de Pablo). El trip_status del TMS no se toca nunca.
"""
from __future__ import annotations

import pytest

from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def test_el_dominio_de_motivos_existe_y_tiene_codigo_estable(conexion_revertida):
    """Sin al menos una fila, status_taxonomies.py:30 responde 422
    'domain desconocido' y el selector de motivos no carga."""
    filas = await conexion_revertida.fetch(
        "SELECT code, label FROM app.status_taxonomies "
        "WHERE domain = 'TRIP_UNASSIGNED_REASON' AND active ORDER BY sort_order")

    assert len(filas) >= 4, "el dominio quedo vacio: el selector va a dar 422"
    codigos = {f["code"] for f in filas}
    assert None not in codigos, "un motivo sin code se rompe al renombrar la etiqueta"
    assert {"SIN_CAMION", "SIN_PROVEEDOR", "NO_DA_TARIFA", "MANDANTE_DECLINO"} <= codigos
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: FAIL — `assert 0 >= 4`

- [ ] **Step 3: Escribir la migración**

```sql
-- monitor-app/backend/supabase/migrations/20260818130000_trip_unassigned_reasons.sql
--
-- Los motivos por los que WebCarga NO tomo una carga que le ofrecieron.
-- Es "el acusete de operaciones" (Pablo, 2026-08-14): la unica escritura que
-- WebCarga hace sobre un viaje, y va AL LADO del estado del TMS, nunca encima.
--
-- Dominio nuevo y no reuso de DRIVER_REASON: esos 16 motivos responden otra
-- pregunta (por que un CONDUCTOR no salio: Medico, Vacaciones, No se presento).
-- Ninguno de los cuatro que nombraron Pablo y Fabian existia.
--
-- `code` es el identificador estable. La leccion ya la pago este proyecto: los
-- rosters buscaban 'Tractoreo' por etiqueta y renombrarla desde Configuracion
-- vaciaba el roster en silencio (corregido en la Ronda 123).

INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order)
VALUES
  ('TRIP_UNASSIGNED_REASON', 'SIN_CAMION',       'No tenemos camión',        '#fef3c7', '#92400e', 1),
  ('TRIP_UNASSIGNED_REASON', 'SIN_PROVEEDOR',    'No tenemos proveedor',     '#fef3c7', '#92400e', 2),
  ('TRIP_UNASSIGNED_REASON', 'NO_DA_TARIFA',     'No da por tarifa',         '#fee2e2', '#991b1b', 3),
  ('TRIP_UNASSIGNED_REASON', 'MANDANTE_DECLINO', 'El mandante lo declinó',   '#e0e7ff', '#3730a3', 4)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 4: Aplicar y verificar que pasa**

Aplicar con el MCP de Supabase (`apply_migration`, nombre `trip_unassigned_reasons`).
Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: PASS

- [ ] **Step 5: Exponerlo en Configuración › Operaciones**

El spec §6.5 pide que los motivos sean gestionables desde la app, no sólo sembrados. **No hay código
nuevo**: el router de `status_taxonomies` es genérico y `TaxonomyTab` acepta cualquier dominio — es
agregar una entrada a la lista de pestañas, igual que "Motivos de conductor".

Buscar dónde se declaran esas pestañas (`grep -rn "DRIVER_REASON" monitor-app/frontend`) y sumar
`TRIP_UNASSIGNED_REASON` con la etiqueta **"Motivos de no asignación"**. Verificar en pantalla que
lista los cuatro y que se puede agregar uno quinto.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260818130000_trip_unassigned_reasons.sql \
        monitor-app/backend/api/tests/test_cierre_viajes.py monitor-app/frontend
git commit -m "feat(cierre): dominio TRIP_UNASSIGNED_REASON con los 4 motivos de negocio"
```

---

## Task 2: Los cuatro grupos, en un solo lugar

**Files:**
- Create: `monitor-app/backend/api/app/services/cierre_viajes.py`
- Test: `monitor-app/backend/api/tests/test_cierre_viajes.py`

**Interfaces:**
- Produce: `SQL_GRUPOS_CIERRE: str` (un parámetro: `$1 = fecha de negocio`) y
  `DIAS_SIN_NOVEDAD: int`. Devuelve columnas
  `trip_id, grupo, planning_date, client_name, source_system_trip_id, trip_status,
  dias_sin_novedad, unassigned_reason_id`.

**Por qué un servicio y no SQL inline en el router:** la Ronda 123 cerró cuatro defectos que
existían exactamente porque "el universo de viajes del día" está escrito a mano 14 veces. Esta
definición nace en un solo lugar.

- [ ] **Step 1: Escribir los tests que fallan**

```python
async def test_los_cuatro_grupos_son_disjuntos(conexion_revertida):
    """Un viaje en dos grupos significa que la persona lo resuelve dos veces,
    o peor: lo resuelve en uno y sigue apareciendo en el otro."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, "2026-08-18")
    ids = [f["trip_id"] for f in filas]
    assert len(ids) == len(set(ids)), "hay viajes en mas de un grupo"
    assert {f["grupo"] for f in filas} <= {"hoy", "rezago", "en_curso", "abandonado"}


async def test_abandonado_no_se_deriva_de_is_active(conexion_revertida):
    """El grupo 4 existe porque is_active YA los descarto: exige recencia de 7
    dias y los apaga justo cuando empiezan a importar (sin cierre en el TMS no
    llega la orden de compra). Si se derivara de is_active estaria vacio."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, "2026-08-18")
    abandonados = [f for f in filas if f["grupo"] == "abandonado"]
    assert abandonados, "el grupo de abandonados quedo vacio"
    assert all(f["dias_sin_novedad"] > 7 for f in abandonados)


async def test_los_viajes_futuros_no_entran(conexion_revertida):
    """Un viaje planificado para manana no es rezago ni espera nada (3 de
    IANSA el 16/08). No hay nada que declarar sobre el."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, "2026-08-18")
    assert all(str(f["planning_date"]) <= "2026-08-18" for f in filas)
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.cierre_viajes`

- [ ] **Step 3: Escribir el servicio**

```python
# monitor-app/backend/api/app/services/cierre_viajes.py
"""Los cuatro grupos del paso "Viajes" del Cierre (spec §6.1).

UNA sola definicion. La Ronda 123 cerro cuatro defectos de conteo que existian
porque "el universo de viajes del dia" esta escrito a mano en 14 lugares; esta
no nace repetida.

Los tres primeros grupos salen de columnas que ya existen y estan pobladas:
`app_trips.sql` deriva is_assigned como
  trip_status NOT IN ('Creada','Aceptada','Control de salida') AND (patente O conductor)
que es literalmente la definicion que dio Pablo.

El cuarto NO se deriva de is_active, y ese es el punto: is_active exige que el
TMS haya reportado en los ultimos 7 dias, asi que un viaje que QAnalytics
abandona sin cerrar sale solo del Monitor justo cuando empieza a importar —
sin cierre en el TMS no llega la orden de compra. Es la regla 5 de Pablo.
"""

# Sin confirmar con operaciones (spec §11 item 5). Empata con el umbral de
# recencia de is_active a proposito: por debajo de eso el viaje sigue vivo en
# el Monitor y no hay nada que declarar.
DIAS_SIN_NOVEDAD = 7

# `problema` queda afuera a proposito: mezcla Cancelado y Sin Registros
# (terminales) con En Pana (que no lo es). Medido el 2026-08-18, excluirlo no
# cuesta nada — ninguna fila En Pana supera los 7 dias. Separar esa mezcla es
# un arreglo de catalogo, no de este servicio.
GRUPOS_NO_TERMINALES = ("en_ruta", "retornando", "en_local", "otro")

SQL_GRUPOS_CIERRE = f"""
WITH base AS (
    SELECT t.id AS trip_id, t.planning_date, t.client_name,
           t.source_system_trip_id, t.trip_status, t.unassigned_reason_id,
           t.is_active, t.is_assigned,
           EXTRACT(EPOCH FROM (now() - t.status_reported_at)) / 86400 AS dias_sin_novedad,
           s.group_id
    FROM app.trips t
    LEFT JOIN app.trip_statuses s ON s.id = t.trip_status
    WHERE t.planning_date <= $1::date
)
SELECT trip_id, planning_date, client_name, source_system_trip_id, trip_status,
       unassigned_reason_id, round(dias_sin_novedad::numeric, 1) AS dias_sin_novedad,
       CASE
           WHEN is_active AND NOT is_assigned AND planning_date = $1::date THEN 'hoy'
           WHEN is_active AND NOT is_assigned AND planning_date < $1::date THEN 'rezago'
           WHEN is_active AND is_assigned     AND planning_date < $1::date THEN 'en_curso'
           ELSE 'abandonado'
       END AS grupo
FROM base
WHERE (is_active AND NOT is_assigned)
   OR (is_active AND is_assigned AND planning_date < $1::date)
   OR (NOT is_active
       AND group_id IN {GRUPOS_NO_TERMINALES}
       AND dias_sin_novedad > {DIAS_SIN_NOVEDAD})
ORDER BY grupo, planning_date DESC
"""
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: PASS

Verificar además contra producción con el MCP de Supabase que los conteos por grupo dan
**hoy 2 · rezago 17 · en_curso 6 · abandonado 46** para `$1 = '2026-08-18'`. Si difieren, el
predicado no es el que se midió — investigar antes de seguir, no ajustar el test.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/services/cierre_viajes.py \
        monitor-app/backend/api/tests/test_cierre_viajes.py
git commit -m "feat(cierre): los 4 grupos del paso Viajes, con una sola definicion"
```

---

## Task 3: `GET /trips/cierre-viajes`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py`
- Test: `monitor-app/backend/api/tests/test_cierre_viajes.py`

**Interfaces:**
- Consume: `SQL_GRUPOS_CIERRE` de la Task 2.
- Produce: `GET /api/v1/trips/cierre-viajes?fecha=YYYY-MM-DD` →
  `{"grupos": {"hoy": [...], "rezago": [...], "en_curso": [...], "abandonado": [...]},
    "bloquean": int}` donde cada viaje trae
  `{trip_id, planning_date, client_name, source_system_trip_id, trip_status,
    dias_sin_novedad, unassigned_reason_id, unassigned_reason_label}`.

**Gotcha de FastAPI:** el literal `/cierre-viajes` **debe declararse antes** de
`@router.get("/{trip_id}")` (hoy en `trips.py`, después de `/fleet-daily-overview`), o queda
absorbido como `trip_id="cierre-viajes"`. Ya está documentado en el docstring de `/bulk-close`.

- [ ] **Step 1: Escribir el test que falla**

```python
async def test_el_endpoint_agrupa_y_dice_cuantos_bloquean(conexion_revertida):
    """Solo 'hoy' y 'rezago' bloquean: son cargas que nos ofrecieron y no
    contestamos. 'en_curso' y 'abandonado' se muestran para que no
    desaparezcan (regla 5), pero no impiden cerrar el dia."""
    from app.routers.trips import cierre_viajes

    resp = await cierre_viajes(fecha="2026-08-18",
                               pool=PoolDeUnaConexion(conexion_revertida), _=None)

    assert set(resp["grupos"]) == {"hoy", "rezago", "en_curso", "abandonado"}
    assert resp["bloquean"] == len(resp["grupos"]["hoy"]) + len(resp["grupos"]["rezago"])


async def test_una_fecha_invalida_es_422(conexion_revertida):
    from fastapi import HTTPException
    from app.routers.trips import cierre_viajes

    with pytest.raises(HTTPException) as e:
        await cierre_viajes(fecha="ayer", pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert e.value.status_code == 422
```

- [ ] **Step 2: Correr y ver que falla**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: FAIL — `ImportError: cannot import name 'cierre_viajes'`

- [ ] **Step 3: Escribir el endpoint**

Insertar en `trips.py` **inmediatamente antes** de `@router.get("/{trip_id}")`:

```python
@router.get("/cierre-viajes")
async def cierre_viajes(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Los cuatro grupos del paso "Viajes" del Cierre.

    Sólo `hoy` y `rezago` bloquean el cierre: son cargas que nos ofrecieron y
    todavía no contestamos. `en_curso` y `abandonado` se muestran para que no
    desaparezcan de la vista —regla 5 de Pablo, "si no me cerraron el viaje no
    me lo van a pagar"— pero no impiden firmar el día.
    """
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    filas = await pool.fetch(
        f"""
        WITH g AS ({SQL_GRUPOS_CIERRE})
        SELECT g.*, ur.label AS unassigned_reason_label
        FROM g
        LEFT JOIN app.status_taxonomies ur ON ur.id = g.unassigned_reason_id
        """,
        day,
    )

    grupos: dict[str, list] = {"hoy": [], "rezago": [], "en_curso": [], "abandonado": []}
    for r in filas:
        grupos[r["grupo"]].append({
            "trip_id": str(r["trip_id"]),
            "planning_date": r["planning_date"].isoformat(),
            "client_name": r["client_name"],
            "source_system_trip_id": r["source_system_trip_id"],
            "trip_status": r["trip_status"],
            "dias_sin_novedad": float(r["dias_sin_novedad"] or 0),
            "unassigned_reason_id": str(r["unassigned_reason_id"]) if r["unassigned_reason_id"] else None,
            "unassigned_reason_label": r["unassigned_reason_label"],
        })

    return {"grupos": grupos, "bloquean": len(grupos["hoy"]) + len(grupos["rezago"])}
```

Y agregar el import arriba del archivo:

```python
from ..services.cierre_viajes import SQL_GRUPOS_CIERRE
```

- [ ] **Step 4: Correr y verificar**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q` → PASS
Run: `venv/bin/python -m pytest tests/ -q` → todo verde (el orden de rutas puede romper otros tests
de `trips.py` si se insertó en el lugar equivocado).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_cierre_viajes.py
git commit -m "feat(cierre): GET /trips/cierre-viajes con los 4 grupos"
```

---

## Task 4: El motivo, sobre el viaje, sin tocar el estado del TMS

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/trip.py` (`TripBulkCloseBody`)
- Modify: `monitor-app/backend/api/app/routers/trips.py:2118-2160` (`bulk_close_trips`)
- Test: `monitor-app/backend/api/tests/test_cierre_viajes.py`

**Interfaces:**
- Produce: `PATCH /api/v1/trips/bulk-close {trip_ids, unassigned_reason_id}` →
  `{ok, closed}`. `unassigned_reason_id` pasa a ser **obligatorio**.

**Lo que ya está bien y no hay que tocar:** el endpoint ya escribe `is_active=false,
is_working=false` y agrega esos campos a `manually_edited_fields`, que el trigger
`app.protect_manual_overrides` respeta — o sea la próxima corrida de dbt no lo pisa.

**Lo que falta:** el motivo. La columna `app.trips.unassigned_reason_id` **ya existe**, tiene 0
filas y **ya está en `merge_exclude_columns`** del modelo dbt, así que escribirla es seguro y no
requiere ninguna migración.

- [ ] **Step 1: Escribir los tests que fallan**

```python
async def test_cerrar_un_viaje_exige_motivo(conexion_revertida):
    """Sin motivo el cierre no declara nada. "Este es el acusete de
    operaciones" (Pablo): el valor esta en el porque, no en el apagado."""
    from fastapi import HTTPException
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    trip_id = str(await conn.fetchval("SELECT id FROM app.trips LIMIT 1"))

    with pytest.raises(HTTPException) as e:
        await bulk_close_trips(
            TripBulkCloseBody(trip_ids=[trip_id], unassigned_reason_id=None),
            PoolDeUnaConexion(conn), await _usuario_real(conn))
    assert e.value.status_code == 422


async def test_el_estado_del_tms_no_se_toca(conexion_revertida):
    """Regla 1 de Pablo. El viaje conserva su ASIGNADO y en el historial se lee
    "No asignado por WebCarga - <motivo>" AL LADO, no encima."""
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    fila = await conn.fetchrow("SELECT id, trip_status FROM app.trips LIMIT 1")
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")

    await bulk_close_trips(
        TripBulkCloseBody(trip_ids=[str(fila["id"])], unassigned_reason_id=str(motivo)),
        PoolDeUnaConexion(conn), await _usuario_real(conn))

    despues = await conn.fetchrow(
        "SELECT trip_status, is_active, unassigned_reason_id, manually_edited_fields "
        "FROM app.trips WHERE id = $1", fila["id"])
    assert despues["trip_status"] == fila["trip_status"], "se piso el estado del TMS"
    assert despues["is_active"] is False
    assert str(despues["unassigned_reason_id"]) == str(motivo)
    assert "unassigned_reason_id" in despues["manually_edited_fields"], \
        "sin esto, la proxima corrida de dbt borra el motivo"
```

`_usuario_real` es el helper de `tests/test_asignar_conductor.py` (un perfil que existe en
`public.profiles`, porque `app.trip_notes.author_id` tiene FK y `_log_system_note` se traga la
violación con un `except: pass` que sobre una sola transacción aborta todo). Copiarlo a
`test_cierre_viajes.py` o moverlo a `conftest.py` — **moverlo, ya lo usan dos archivos**.

- [ ] **Step 2: Correr y ver que fallan**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: FAIL — `TypeError: unexpected keyword argument 'unassigned_reason_id'`

- [ ] **Step 3: Extender el schema y el endpoint**

En `app/schemas/trip.py`:

```python
class TripBulkCloseBody(BaseModel):
    """Selección masiva en el Diario para cerrar/finalizar varios viajes de
    una — mismo mecanismo que ya usa IndicatorSwitches por viaje individual
    (is_active/is_working=false, protegido de que Mage lo pise en la
    próxima corrida vía manually_edited_fields), solo que en lote.

    `unassigned_reason_id` es OBLIGATORIO desde 2026-08-18: apagar un viaje sin
    decir por qué no declara nada, y la declaración es todo el valor de este
    paso ("el acusete de operaciones"). Se valida en el endpoint y no acá para
    poder devolver un 422 con el mensaje de negocio."""
    trip_ids: list[str]
    unassigned_reason_id: str | None = None
```

En `bulk_close_trips`, después de la validación de `trip_ids`:

```python
    if not body.unassigned_reason_id:
        raise HTTPException(422, "Indica el motivo por el que no se tomó la carga")
```

Y en el `UPDATE`, agregar la columna al `SET` y al array de `manually_edited_fields`:

```sql
            unassigned_reason_id = $3::uuid,
            manually_edited_fields = ARRAY(SELECT DISTINCT unnest(
                COALESCE(manually_edited_fields,'{}')
                || ARRAY['is_active','is_working','unassigned_reason_id']::text[]
            )),
```

**La traza va a `public.audit_log`, no sólo a la bitácora.** El spec §6.3 lo pide explícitamente y
hoy `bulk_close_trips` sólo llama a `_log_system_note`, que escribe `app.trip_notes` y está envuelto
en un `try/except: pass` — best-effort, puede fallar en silencio. Para una declaración de negocio que
va a cruzarse con facturación eso no alcanza. Usar `log_change` de `app/services/audit.py`, el mismo
que ya usa `daily_closures.py:396`:

```python
    from ..services.audit import log_change  # ya existe, trips.py todavia no lo importa

    await log_change(
        pool, actor=user["sub"], entity_type="TRIP", entity_id=tid,
        action="no_asignado_por_webcarga", field="unassigned_reason_id",
        old_value=None, new_value=motivo, source="cierre_viajes",
    )
```

Y la nota de bitácora pasa a decir el motivo:

```python
    motivo = await pool.fetchval(
        "SELECT label FROM app.status_taxonomies WHERE id = $1", body.unassigned_reason_id)
    # "AL LADO, no encima": el viaje conserva su estado del TMS y esto se lee
    # en el historial junto a el. Pablo: "yo despues filtrare en el historial
    # todos los no asignados por WebCarga".
    await _log_system_note(pool, tid, user, f"No asignado por WebCarga · {motivo}")
```

- [ ] **Step 4: Correr y verificar**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py tests/test_trip_bulk_close.py -q`
Expected: PASS. **Los tests existentes de `test_trip_bulk_close.py` van a fallar primero** porque
llaman sin motivo — actualizarlos pasando uno, y agregar uno que verifique el 422 sin motivo.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/schemas/trip.py monitor-app/backend/api/app/routers/trips.py \
        monitor-app/backend/api/tests/test_cierre_viajes.py monitor-app/backend/api/tests/test_trip_bulk_close.py \
        monitor-app/backend/api/tests/conftest.py
git commit -m "feat(cierre): el cierre de un viaje exige motivo y no toca el estado del TMS"
```

---

## Task 5: El conteo al firmar, y el delta posterior al cierre

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260818130100_daily_closures_total_trips.sql`
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py:358-411` (`POST /close`) y el
  `GET ""` (~línea 237)
- Test: `monitor-app/backend/api/tests/test_cierre_viajes.py`

**Interfaces:**
- Produce: `GET /api/v1/daily-closures?fecha=` gana
  `{"cierre": {"total_trips_al_firmar": int|None, "posteriores_al_cierre": int}}`.

**El modelo, decidido el 2026-08-18:** el día **no se reabre**. La firma original queda intacta y el
delta se resuelve como un **complemento**. `app.daily_closures` mantiene su PK por `business_date`
—no se convierte en historial, nadie lo pidió— y gana una columna con el conteo al firmar. Sin ese
dato el caso **no se puede detectar retroactivamente**.

- [ ] **Step 1: Escribir los tests que fallan**

```python
async def test_el_cierre_guarda_cuantos_viajes_tenia_el_dia(conexion_revertida):
    """Sin este numero no hay con que comparar despues, y no se puede
    reconstruir: es el unico dato que fija que afirmo la firma."""
    filas = await conexion_revertida.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='app' AND table_name='daily_closures'")
    assert "total_trips" in {f["column_name"] for f in filas}


async def test_un_dia_sin_firmar_no_reporta_delta(conexion_revertida):
    """Nada que comparar todavia: `posteriores_al_cierre` tiene que ser 0, no
    el total de viajes del dia."""
    from app.routers.daily_closures import get_daily_closure_status

    resp = await get_daily_closure_status(
        fecha="2026-08-18", pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert resp["cierre"]["total_trips_al_firmar"] is None
    assert resp["cierre"]["posteriores_al_cierre"] == 0
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q` → FAIL

- [ ] **Step 3: Migración y endpoint**

```sql
-- monitor-app/backend/supabase/migrations/20260818130100_daily_closures_total_trips.sql
--
-- Cuantos viajes tenia el dia CUANDO SE FIRMO.
--
-- El dia no se reabre nunca: una firma es una afirmacion sobre un instante, y
-- si se recalcula no afirma nada (mismo principio que la Ronda 122 aplico al
-- modelo de flota). Lo que aparece despues es un DELTA — "posterior al
-- cierre", el termino contable estandar (post-close entries); en ingenieria de
-- datos es un late-arriving fact. No es una reapertura.
--
-- Nullable a proposito: los cierres viejos no lo tienen y no se puede inventar.
-- Un 0 ahi diria "el dia no tenia viajes", que es falso.
ALTER TABLE app.daily_closures ADD COLUMN IF NOT EXISTS total_trips integer;

COMMENT ON COLUMN app.daily_closures.total_trips IS
  'Viajes del dia al momento de firmar. NULL = cierre anterior a 2026-08-18. '
  'Si el conteo real difiere despues, son viajes posteriores al cierre: la '
  'firma NO se invalida, se resuelve un complemento.';
```

En `POST /close`, agregar el conteo al INSERT:

```python
    total_trips = await pool.fetchval(
        "SELECT count(*) FROM app.trips WHERE planning_date = $1", day)
```

y sumar `total_trips` a las columnas del `INSERT ... ON CONFLICT DO UPDATE`.

En `GET ""`, después de `_recompute()`:

```python
    # "Posterior al cierre", no "reabierto": el dia sigue cerrado y la firma
    # sigue siendo verdadera sobre lo que existia cuando se firmo. Esto es el
    # delta, y se resuelve aparte.
    cierre = await pool.fetchrow(
        "SELECT closed_at, closed_by, total_trips FROM app.daily_closures WHERE business_date = $1",
        day)
    posteriores = 0
    if cierre and cierre["total_trips"] is not None:
        ahora = await pool.fetchval(
            "SELECT count(*) FROM app.trips WHERE planning_date = $1", day)
        posteriores = max(0, ahora - cierre["total_trips"])
```

y exponerlo en la respuesta como
`"cierre": {..., "total_trips_al_firmar": ..., "posteriores_al_cierre": posteriores}`.

- [ ] **Step 4: Aplicar, correr y verificar**

Aplicar la migración con `apply_migration` (nombre `daily_closures_total_trips`).
Run: `venv/bin/python -m pytest tests/ -q` → todo verde.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260818130100_daily_closures_total_trips.sql \
        monitor-app/backend/api/app/routers/daily_closures.py monitor-app/backend/api/tests/test_cierre_viajes.py
git commit -m "feat(cierre): el cierre guarda su conteo y expone los viajes posteriores"
```

---

## Task 6: La pestaña "Viajes"

**Files:**
- Create: `monitor-app/frontend/components/dashboard/sections/PasoViajesSection.tsx` + `.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx:26-30` (TABS)
- Modify: `monitor-app/frontend/lib/api/trips.ts` · `monitor-app/frontend/lib/types.ts`

**Interfaces:**
- Consume: `GET /trips/cierre-viajes` (Task 3), `PATCH /trips/bulk-close` (Task 4).
- Produce: `tripsApi.cierreViajes(fecha)` y `tripsApi.bulkClose(tripIds, motivoId)`.

**Dónde vive:** una **cuarta pestaña** en el tab bar que ya existe (`Flota del día` · `Pendientes` ·
`Reporte`). El recorrido de 4 pasos con riel de progreso es el plan siguiente; meterlo acá mezclaría
dos cambios y haría imposible revisar ninguno.

**Componentes que ya existen y hay que reusar, no reescribir:** `Estado` (vacío/cargando/error, en
`components/ui/Estado.tsx`), `EncabezadoDePagina`, `Cifra`. El Cierre es el único módulo que todavía
no los usa — esta pestaña nace usándolos.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
// components/dashboard/sections/PasoViajesSection.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasoViajesSection } from './PasoViajesSection'

const viaje = (id: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-08-18', client_name: 'Walmart',
  source_system_trip_id: '2032999', trip_status: 'Asignado',
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

const grupos = {
  hoy: [viaje('t1')], rezago: [viaje('t2')], en_curso: [viaje('t3')],
  abandonado: [viaje('t4', { dias_sin_novedad: 31.6 })],
}

describe('PasoViajesSection', () => {
  it('no muestra ninguna cifra mientras carga', () => {
    render(<PasoViajesSection grupos={undefined} bloquean={undefined} cargando
                              motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.queryByText('0')).toBeNull()
  })

  // Regla 5 de Pablo: "esta bien que aparezca aca y que se quede pegado...
  // si no me cerraron el viaje no me lo van a pagar".
  it('los abandonados por el TMS se ven, y dicen hace cuanto no reportan', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2} motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.getByText(/31,6 días sin novedad|31.6 días sin novedad/)).toBeInTheDocument()
  })

  // La columna correcta es "sin novedad del TMS", no dias desde la
  // planificacion: un viaje planificado hace 9 dias puede haber reportado
  // hace 2 horas.
  it('solo hoy y rezago se pueden cerrar; en curso y abandonado no', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2} motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('no deja cerrar sin elegir motivo', () => {
    const onCerrar = vi.fn()
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={onCerrar} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /No asignado por WebCarga/i })).toBeDisabled()
  })

  it('con motivo elegido, el boton dice a cuantos viajes se aplica', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.change(screen.getByLabelText(/Motivo/i), { target: { value: 'm1' } })
    expect(screen.getByRole('button', { name: /1 viaje/i })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/PasoViajesSection.test.tsx`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir el componente y los clientes**

El componente renderiza los cuatro grupos como secciones, cada una con su título y contador. Sólo
`hoy` y `rezago` traen casilla de selección; `en_curso` y `abandonado` son de lectura. La barra
contextual aparece al seleccionar, con un `<select>` de motivos etiquetado "Motivo" y un botón
`No asignado por WebCarga · N viajes`, deshabilitado hasta que haya motivo.

Reusar `Estado` para los tres estados no-felices. Los grises salen de `TEXTO_APOYO`/`TEXTO_CUERPO`
(`lib/ui/texto.ts`) — **no escribir clases de color nuevas**, el trinquete de
`lib/ui/sistema.test.ts` falla.

En `lib/types.ts` (el tipo va acá, con los demás de la API — **no en el componente**: importar un
tipo desde un componente hacia `lib/` fue un error real de la Ronda 124):

```ts
/** Un viaje en el paso "Viajes" del Cierre. `dias_sin_novedad` cuenta desde el
 *  último reporte del TMS, NO desde la planificación: un viaje planificado hace
 *  9 días puede haber reportado hace 2 horas, y a los 7 sin novedad desaparece
 *  del Monitor — que es exactamente cuando empieza a importar. */
export type ViajeDelCierre = {
  trip_id:                 string
  planning_date:           string
  client_name:             string | null
  source_system_trip_id:   string | null
  trip_status:             string | null
  dias_sin_novedad:        number
  unassigned_reason_id:    string | null
  unassigned_reason_label: string | null
}

export type GrupoDelCierre = 'hoy' | 'rezago' | 'en_curso' | 'abandonado'

export type CierreViajesResponse = {
  grupos:   Record<GrupoDelCierre, ViajeDelCierre[]>
  /** Cuántos impiden firmar el día: sólo `hoy` + `rezago`. */
  bloquean: number
}
```

En `lib/api/trips.ts`:

```ts
  cierreViajes: (fecha: string) =>
    apiFetch<CierreViajesResponse>(`/api/v1/trips/cierre-viajes?fecha=${fecha}`),
```

y `bulkClose` gana el segundo parámetro:

```ts
  bulkClose: (tripIds: string[], unassignedReasonId: string) =>
    apiFetch<{ ok: boolean; closed: number }>(`/api/v1/trips/bulk-close`, {
      method: 'PATCH',
      body: JSON.stringify({ trip_ids: tripIds, unassigned_reason_id: unassignedReasonId }),
    }),
```

**`bulkClose` no tiene ningún llamador hoy** — está definido en `lib/api/trips.ts:132` y no lo usa
nadie (verificado en el pre-flight sobre todo el árbol). Cambiar su firma no rompe ninguna pantalla
viva; esta pestaña es su primer consumidor real. Si `tsc --noEmit` señala algún llamador que el grep
no vio, pasarle el motivo desde un selector — **nunca** inventar un motivo por defecto: un motivo
que nadie eligió es peor que ninguno.

- [ ] **Step 4: Correr y verificar**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS y sin errores de tipo.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/sections/PasoViajesSection.tsx \
        monitor-app/frontend/components/dashboard/sections/PasoViajesSection.test.tsx \
        monitor-app/frontend/app/dashboard/operations/closures/page.tsx \
        monitor-app/frontend/lib/api/trips.ts monitor-app/frontend/lib/types.ts
git commit -m "feat(cierre): pestana Viajes con los 4 grupos y el motivo en lote"
```

---

## Task 7: El aviso "Posterior al cierre"

**Files:**
- Create: `monitor-app/frontend/components/dashboard/AvisoPosteriorAlCierre.tsx` + `.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx`
- Modify: `monitor-app/frontend/lib/api/dailyClosures.ts`

**Interfaces:**
- Consume: `cierre.posteriores_al_cierre` de `GET /daily-closures` (Task 5).

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvisoPosteriorAlCierre } from './AvisoPosteriorAlCierre'

describe('AvisoPosteriorAlCierre', () => {
  it('no dice nada cuando no llego nada despues', () => {
    const { container } = render(<AvisoPosteriorAlCierre cantidad={0} onVerlos={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  // El dia NO se reabre: la firma sigue siendo verdadera sobre lo que existia
  // cuando se firmo. Esto es un delta, y "reabierto" seria mentir sobre lo
  // que paso.
  it('no dice que el dia se reabrio', () => {
    render(<AvisoPosteriorAlCierre cantidad={2} onVerlos={() => {}} />)
    expect(screen.queryByText(/reabiert/i)).toBeNull()
    expect(screen.getByText(/posteriores al cierre/i)).toBeInTheDocument()
  })

  it('en singular no dice "1 viajes"', () => {
    render(<AvisoPosteriorAlCierre cantidad={1} onVerlos={() => {}} />)
    expect(screen.getByText(/1 viaje posterior al cierre/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y ver que fallan** → FAIL, no existe el módulo.

- [ ] **Step 3: Escribir el componente**

Devuelve `null` si `cantidad === 0`. Si no, una franja con el texto
`{n} viaje(s) posterior(es) al cierre` y un botón "Verlos" que lleva a la pestaña Viajes. El día
sigue mostrando **"Cerrado"** en su encabezado: este aviso va **al lado**, no lo reemplaza.

- [ ] **Step 4: Correr y verificar** → `npx vitest run && npx tsc --noEmit && npm run build`

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/AvisoPosteriorAlCierre.tsx \
        monitor-app/frontend/components/dashboard/AvisoPosteriorAlCierre.test.tsx \
        monitor-app/frontend/app/dashboard/operations/closures/page.tsx \
        monitor-app/frontend/lib/api/dailyClosures.ts
git commit -m "feat(cierre): aviso de viajes posteriores al cierre, sin reabrir el dia"
```

---

## Task 8: El filtro "No asignado por WebCarga" en el historial

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/FilterPopover.tsx`
- Modify: `monitor-app/frontend/hooks/useDiarioFilters.ts`
- Modify: `monitor-app/backend/api/app/routers/trips.py` (el `GET ""` que lista viajes)
- Test: el test del hook y `tests/test_cierre_viajes.py`

**Interfaces:**
- Produce: parámetro `no_asignado_webcarga=true` en `GET /api/v1/trips`.

**Por qué es una tarea y no un extra:** el spec §6.3 lo declara **parte del entregable**, con las
palabras de Pablo: *"yo después filtraré en el historial todos los no asignados por WebCarga y voy a
poder ver todos los viajes que alguna vez nos ofrecieron y no asignamos"*. Sin esto, la declaración
se escribe y no se puede volver a leer — que es la mitad del punto.

- [ ] **Step 1: Escribir el test que falla**

```python
async def test_se_puede_filtrar_lo_no_asignado_por_webcarga(conexion_revertida):
    # Pablo: "voy a poder ver todos los viajes que alguna vez nos ofrecieron y
    # no asignamos". Sin este filtro la declaracion se escribe y no se lee.
    from app.routers.trips import list_trips

    conn = conexion_revertida
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")
    trip_id = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    await conn.execute(
        "UPDATE app.trips SET unassigned_reason_id = $1 WHERE id = $2", motivo, trip_id)

    resp = await list_trips(no_asignado_webcarga=True,
                            pool=PoolDeUnaConexion(conn), _=None)

    ids = [t["id"] for t in resp["data"]]
    assert str(trip_id) in ids
    assert all(t["unassigned_reason_id"] for t in resp["data"]), \
        "el filtro dejo pasar viajes sin motivo"
```

**Nota para quien lo ejecute:** `list_trips` tiene muchos parámetros con default; pasar sólo el
nuevo. Si su firma no lo permite, ese es el primer arreglo — no envolver la llamada en un helper.

- [ ] **Step 2: Correr y ver que falla**

Run: `venv/bin/python -m pytest tests/test_cierre_viajes.py -q`
Expected: FAIL — `unexpected keyword argument 'no_asignado_webcarga'`

- [ ] **Step 3: Agregar el filtro en el backend**

En la firma de `list_trips`:

```python
    no_asignado_webcarga: bool = Query(False),
```

y en la construcción del WHERE, junto a los demás filtros booleanos:

```python
    if no_asignado_webcarga:
        # No mira is_active: el punto es el HISTORIAL de lo que nos ofrecieron
        # y no tomamos, incluidos los que ya se apagaron hace meses.
        where.append("t.unassigned_reason_id IS NOT NULL")
```

- [ ] **Step 4: Agregar el filtro en la interfaz**

En `useDiarioFilters.ts`, sumar `fNoAsignadoWebcarga: boolean` al estado y al `countActiveFilters`.
En `FilterPopover.tsx`, una casilla con la etiqueta **"No asignado por WebCarga"**, agrupada con los
demás filtros booleanos. Actualizar el test del hook para que cuente el filtro nuevo.

- [ ] **Step 5: Correr y verificar**

Run: `venv/bin/python -m pytest tests/ -q` y `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py monitor-app/backend/api/tests/test_cierre_viajes.py \
        monitor-app/frontend/hooks/useDiarioFilters.ts monitor-app/frontend/components/dashboard/FilterPopover.tsx
git commit -m "feat(cierre): filtro 'No asignado por WebCarga' en el historial"
```

---

## Task 9: Mirarlo

- [ ] **Step 1:** `cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q` y
      `cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build`
- [ ] **Step 2:** Desplegar a `dev` y **mirar la pantalla**, en escritorio y teléfono.
- [ ] **Step 3:** Click-through: abrir el Centro de Cierre, ir a la pestaña Viajes, verificar que
      los cuatro grupos traen los conteos esperados, seleccionar un viaje del grupo "Hoy", elegir
      un motivo y confirmar. **Usar Playwright** (la extensión de Chrome está apagada).
- [ ] **Step 4:** Verificar en la base que el estado del TMS quedó intacto:

```sql
SELECT trip_status, is_active, unassigned_reason_id IS NOT NULL AS con_motivo,
       'unassigned_reason_id' = ANY(manually_edited_fields) AS protegido
FROM app.trips WHERE id = '<el que se cerro>';
-- Esperado: el mismo trip_status de antes · false · true · true
```

- [ ] **Step 5:** Verificar el historial: la nota de bitácora debe decir
      `No asignado por WebCarga · <motivo>` y el viaje conservar su estado del TMS al lado.
- [ ] **Step 6:** Actualizar `AGENTLOG.md` y commitear.

---

## Fuera de alcance, a propósito

- **El recorrido de 4 pasos con riel de progreso** (Bloque 1 y §8bis del spec) — plan siguiente.
  Esta pestaña se suma a las tres que ya existen.
- **Perseguir los 46 viajes abandonados históricos.** Decisión del usuario: el objetivo es que
  cuando la app esté operativa los muestre el mismo día, no reconstruir el pasado.
- **Zona, gestión y tipo de vehículo** (Bloque 4) — plan aparte.
- **El atributo de facturación en `app.trip_statuses`** (§7.2) — la tabla no tiene la columna y eso
  es Reportería, no este paso.
- **Historial de firmas.** `app.daily_closures` mantiene su PK por `business_date`. Nadie pidió
  auditoría de quién firmó qué y cuándo.
- **Separar `Cancelado`/`En Pana` del grupo `problema`** en `app.trip_statuses` — arreglo de
  catálogo, hoy no cuesta nada.
