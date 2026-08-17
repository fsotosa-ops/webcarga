# Bloque 0 — El denominador: el padrón de conductor por tracto

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el denominador del Cierre deje de mentir — la resolución del conductor pasa de
**34%** a **~95%** de los viajes, llenando el nivel 2 de la cadena de resolución que **ya existe**, y
blindando RUT y patente en la base para que el padrón no se ensucie ni se degrade con el tiempo.

**Arquitectura:** **No se crean tablas nuevas y no se escribe lógica de resolución nueva.**
`app.v_trip_fleet_resolution` (migración `20260722030000`) ya resuelve el conductor con un COALESCE
de tres niveles:

```
COALESCE( fl.driver_id,          -- 1. lo guardado en app.trip_fleet_links
          vda_auto.driver_id,    -- 2. patente → assets → vehicle_driver_assignments  ← VACÍO
          d_by_name.id )         -- 3. igualdad exacta de nombre contra el roster (34%)
```

El nivel 2 **tiene 1 fila en toda la base**. Por eso todo cae al nivel 3. Este plan lo llena desde el
padrón derivado de `bronze.raw_bd_ot`, y le pone candado a los dos identificadores de los que
depende (`drivers.tax_id` y `assets.license_plate`) para que ni Mage ni la app puedan escribir una
variante sucia.

La vista se consume en **5 routers y 18 lugares** (`daily_closures`, `equipment_closures`,
`status_report`, `trips`, `drivers`). Llenar el nivel 2 mejora todo eso **sin tocar una línea de
Python ni de TypeScript**.

**Tech stack:** PostgreSQL 17.6 (Supabase, proyecto `viclzoftiudkepqnhekv`) · migraciones SQL en
`monitor-app/backend/supabase/migrations/` · FastAPI + asyncpg · pytest con
`monitor-app/backend/api/venv`.

**Spec:** `docs/superpowers/specs/2026-08-16-cierre-de-viajes-design.md` (Bloque 0) + el hallazgo de
la Ronda 121 en `AGENTLOG.md`.

---

## Global Constraints

- **`bronze.raw_bd_ot` es de sólo lectura para este plan.** La escribe Mage
  (`legacy_drivers_transporters` → `bd_ot_master.sql`). No se le agregan columnas ni índices.
- **`public.drivers` la escribe Mage**, no la app (`custom/load_drivers_03.sql`, compone
  `tax_id = rut || '-' || dv`). Todo CHECK que se le ponga **hace fallar el pipeline** si Mage
  escribe sucio — eso es deseado, pero exige el aviso de orden de aplicación que ya usó la migración
  `20260814120000_dedupe_drivers_sin_rut.sql`.
- **`app.trips` la materializa dbt.** Este plan **no le agrega columnas**. Si alguna tarea parece
  necesitarlo, está mal planteada: la resolución vive en la vista, no en la tabla.
- **Forma canónica del RUT: `^[0-9]{7,8}-[0-9K]$`** — no es una invención, es la que ya tienen las
  **79 de 79** filas de `public.drivers`, y las 79 pasan el módulo 11. Se formaliza lo que ya es
  cierto, no se migra a un formato nuevo.
- **Forma canónica de la patente: `^[A-Z0-9]{6}$`.**
- **Español neutral, nunca voseo.** Cero emojis en la UI (`lucide-react` únicamente).
- **Cada test nuevo se verifica FALLANDO sin su corrección** (`git stash`). En este proyecto ya
  entraron tests en verde sin probar nada.
- Los tests que ejecutan SQL real usan la fixture `conexion_revertida` y el marcador
  `pytest.mark.integracion` (ver `tests/conftest.py`). **Cada test crea sus propios datos dentro de
  la transacción** — nunca depende de filas reales por su id.

---

## Los números que justifican el plan

Todos medidos contra producción el **2026-08-17**. Están acá para que el ejecutor sepa qué debe dar
la verificación, no para que confíe en ellos de memoria.

| Medición | Valor |
|---|---|
| `vehicle_driver_assignments` (nivel 2 de la cadena) | **1 fila** |
| Resolución actual del conductor (igualdad de nombre) | **34%** |
| Acierto del padrón, backtest honesto (padrón pre-julio vs verdad de julio) | **91,0%** |
| Viajes de agosto con patente resueltos por el padrón | **528 de 528** |
| Patentes distintas de agosto | 47 — **44 ya están en `assets`**, faltan 3 |
| Conductores distintos de agosto | 46 — **38 ya están en `drivers`**, faltan 8 |
| RUT del legacy que pasan el módulo 11 | 97,6% (103.097 de 105.620) |
| `drivers.tax_id` fuera de forma canónica hoy | **0 de 79** |
| `assets.license_plate` fuera de forma canónica hoy | **1 de 118** (`GBVC90` con un tabulador al final) |
| Tractos con más de un conductor activo hoy | **0** |

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `migrations/20260817120000_rut_canonico.sql` | `app.normalize_rut()` + `app.rut_es_valido()`, y el candado de `drivers.tax_id` |
| `migrations/20260817120100_patente_canonica.sql` | `app.normalize_patente()`, limpieza de `GBVC90\t` y el candado de `assets.license_plate` |
| `migrations/20260817120200_un_conductor_habitual_por_tracto.sql` | Índice único parcial sobre `vehicle_driver_assignments` |
| `migrations/20260817120300_padron_legacy_view.sql` | `app.v_legacy_padron_conductor` — el padrón, como vista auditable |
| `migrations/20260817120400_sembrar_padron.sql` | El alta de los faltantes y el sembrado idempotente |
| `tests/test_rut_canonico.py` | Los dos guardias de identificador, contra Postgres real |
| `tests/test_padron_conductor.py` | El padrón y el sembrado |

Cinco migraciones chicas en vez de una grande: cada una es reversible por separado, y las tres
primeras tienen valor aunque el sembrado se posponga.

---

## Task 1: `app.normalize_rut()` y `app.rut_es_valido()`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260817120000_rut_canonico.sql`
- Test: `monitor-app/backend/api/tests/test_rut_canonico.py`

**Interfaces:**
- Produce: `app.normalize_rut(text) → text` (canónico `12345678-9`, o `NULL` si no es un RUT válido)
  y `app.rut_es_valido(text) → boolean`. Las usan las tareas 2 y 4.

**El problema que resuelve, en las propias palabras del pedido:** operaciones escribe
`12.345.678-9`, `123456789`, `12345678-9` y variantes. Hoy nada lo impide. La solución no es pedirle
al humano que aprenda un formato: es **aceptar cualquier variante en la entrada y garantizar una sola
forma en el almacenamiento**.

**La decisión no obvia:** al normalizar, un RUT de 8 caracteres es ambiguo — puede ser un RUT de 7
dígitos con su DV (`1234567-8`) o uno de 8 dígitos al que le falta el DV. **Se desambigua validando,
no adivinando**: si tratar el último carácter como DV pasa el módulo 11, es un DV. Si no, el valor se
rechaza. Determinista, y ya medido: 97,6% pasa.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# monitor-app/backend/api/tests/test_rut_canonico.py
"""El RUT tiene UNA forma en la base, y la entrada acepta todas.

Ver Bloque 0 del plan 2026-08-17: el padron de conductor se cruza por RUT, y
un RUT con puntos y otro sin puntos son dos personas distintas para un JOIN.
El candado vive en Postgres —no en el backend ni en el formulario— porque
`public.drivers` la escribe Mage, no la app: un guardia en Python no vería
nunca esa escritura.
"""
from __future__ import annotations

import pytest

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]


@pytest.mark.parametrize(
    "entrada,esperado",
    [
        ("12.345.678-5", "12345678-5"),   # con puntos y guion
        ("12345678-5", "12345678-5"),     # canonico, no cambia
        ("123456785", "12345678-5"),      # todo junto
        ("  12.345.678-5  ", "12345678-5"),  # con espacios alrededor
        ("12.345.670-k", "12345670-K"),   # k minuscula -> mayuscula (12345670 cierra en K)
        ("1.234.567-4", "1234567-4"),     # 7 digitos: DV correcto, se acepta
    ],
)
async def test_normaliza_todas_las_variantes(conexion_revertida, entrada, esperado):
    # Los RUT de este test son sinteticos: se eligieron calculando el DV, no
    # copiando personas reales.
    obtenido = await conexion_revertida.fetchval("SELECT app.normalize_rut($1)", entrada)
    assert obtenido == esperado


@pytest.mark.parametrize(
    "basura",
    [
        "12345678-9",   # DV incorrecto para ese cuerpo
        "SIN RUT",
        "",
        "   ",
        "-",
        "123",          # muy corto
        "1234567890123",  # muy largo
        None,
    ],
)
async def test_lo_que_no_es_un_rut_devuelve_null(conexion_revertida, basura):
    assert await conexion_revertida.fetchval("SELECT app.normalize_rut($1)", basura) is None


async def test_normalizar_es_idempotente(conexion_revertida):
    """Normalizar lo ya normalizado no lo cambia. Es lo que permite ponerlo en
    un trigger sin que la segunda escritura difiera de la primera."""
    una = await conexion_revertida.fetchval("SELECT app.normalize_rut('12.345.678-5')")
    dos = await conexion_revertida.fetchval("SELECT app.normalize_rut($1)", una)
    assert una == dos == "12345678-5"


async def test_el_dv_es_el_que_desambigua_los_de_ocho_caracteres(conexion_revertida):
    """8 caracteres normalizados pueden ser 7 digitos + DV, o 8 digitos sin DV.
    Se resuelve validando: si el ultimo caracter cierra el modulo 11, es DV."""
    # 1234567-4 valida -> se acepta como RUT de 7 digitos
    assert await conexion_revertida.fetchval("SELECT app.normalize_rut('12345674')") == "1234567-4"
    # 12345670 no valida de ninguna forma -> se rechaza, no se inventa un DV
    assert await conexion_revertida.fetchval("SELECT app.normalize_rut('12345670')") is None


async def test_los_ruts_reales_de_drivers_ya_son_canonicos(conexion_revertida):
    """La forma canonica no se inventa: es la que ya tienen las 79 filas.
    Si este test falla, alguien metio un formato nuevo en produccion."""
    fila = await conexion_revertida.fetchrow(
        """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE app.normalize_rut(tax_id) = tax_id) AS canonicos
        FROM public.drivers WHERE tax_id IS NOT NULL
        """
    )
    assert fila["total"] > 0, "sin filas el test no prueba nada"
    assert fila["canonicos"] == fila["total"]
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_rut_canonico.py -q -rs
```

Esperado: FAIL con `function app.normalize_rut(text) does not exist`.
Si sale `SKIPPED`, falta `SUPABASE_DB_PASSWORD` — resolver eso antes de seguir: un test salteado
no prueba nada, y la cabecera de pytest lo dice.

- [ ] **Step 3: Escribir la migración**

```sql
-- monitor-app/backend/supabase/migrations/20260817120000_rut_canonico.sql
-- ============================================================================
-- El RUT tiene UNA forma en la base, y la entrada acepta todas
-- ============================================================================
--
-- POR QUE ACA Y NO EN EL BACKEND: `public.drivers` la escribe Mage
-- (custom/load_drivers_03.sql), no la API. Una validacion en Python no ve esa
-- escritura. El unico lugar por el que pasan las dos es Postgres.
--
-- FORMA CANONICA: `^[0-9]{7,8}-[0-9K]$`. No se elige, se constata: las 79
-- filas con tax_id de public.drivers ya la cumplen, y las 79 pasan el modulo
-- 11 (verificado 2026-08-17). Esta migracion formaliza lo que ya es cierto.
--
-- EL CASO AMBIGUO: normalizado a 8 caracteres, un valor puede ser un RUT de 7
-- digitos con DV, o uno de 8 al que le falta el DV. Se desambigua VALIDANDO,
-- no adivinando: si el ultimo caracter cierra el modulo 11, es DV; si no, el
-- valor se rechaza. En bronze.raw_bd_ot eso acepta el 97,6% de las filas.

BEGIN;

-- ── El digito verificador, modulo 11 ────────────────────────────────────────
-- IMMUTABLE porque la salida depende solo de la entrada: eso la habilita para
-- CHECK constraints e indices, que es todo el punto.
CREATE OR REPLACE FUNCTION app.rut_dv(cuerpo text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE 11 - (suma % 11)
               WHEN 11 THEN '0'
               WHEN 10 THEN 'K'
               ELSE (11 - (suma % 11))::text
           END
    FROM (
        SELECT sum(substr(reverse(cuerpo), i, 1)::int * (((i - 1) % 6) + 2)) AS suma
        FROM generate_series(1, length(cuerpo)) AS i
    ) s;
$$;

COMMENT ON FUNCTION app.rut_dv(text) IS
    'Digito verificador (modulo 11) del cuerpo de un RUT, sin puntos ni guion.';

-- ── La normalizacion: acepta cualquier variante, devuelve una sola ──────────
CREATE OR REPLACE FUNCTION app.normalize_rut(entrada text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
    limpio text;
    cuerpo text;
    dv     text;
BEGIN
    IF entrada IS NULL THEN
        RETURN NULL;
    END IF;

    -- Fuera puntos, espacios, guiones y cualquier otro adorno. K a mayuscula.
    limpio := upper(regexp_replace(entrada, '[^0-9kK]', '', 'g'));

    -- Un RUT chileno util va de 7 a 8 digitos de cuerpo, o sea 8 o 9 con DV.
    IF length(limpio) NOT BETWEEN 8 AND 9 THEN
        RETURN NULL;
    END IF;

    cuerpo := left(limpio, length(limpio) - 1);
    dv     := right(limpio, 1);

    -- La K solo puede ser DV, nunca parte del cuerpo.
    IF cuerpo !~ '^[0-9]+$' THEN
        RETURN NULL;
    END IF;

    -- Aca se desambigua: si el DV no cierra, no se corrige ni se completa.
    -- Un RUT mal escrito se rechaza; inventarle el DV correcto crearia una
    -- persona que no existe.
    IF app.rut_dv(cuerpo) IS DISTINCT FROM dv THEN
        RETURN NULL;
    END IF;

    RETURN cuerpo || '-' || dv;
END;
$$;

COMMENT ON FUNCTION app.normalize_rut(text) IS
    'RUT en forma canonica NNNNNNNN-D, o NULL si no es un RUT valido. '
    'Acepta puntos, guion, espacios y k minuscula en la entrada.';

CREATE OR REPLACE FUNCTION app.rut_es_valido(entrada text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT app.normalize_rut(entrada) IS NOT NULL;
$$;

COMMIT;
```

- [ ] **Step 4: Aplicar y verificar que los tests pasan**

Aplicar con `mcp__claude_ai_Supabase__apply_migration` (nombre `rut_canonico`), y después:

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_rut_canonico.py -q -rs
```

Esperado: PASS, sin `SKIPPED`.

- [ ] **Step 5: Verificar contra los datos reales del legacy**

```sql
SELECT count(*) AS filas,
       count(app.normalize_rut(rut_chofer)) AS normalizan,
       round(100.0 * count(app.normalize_rut(rut_chofer)) / count(*), 1) AS pct
FROM bronze.raw_bd_ot;
```

Esperado: **~97,6%**. Si da mucho menos, la función tiene un bug — no ajustar el número esperado.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260817120000_rut_canonico.sql \
        monitor-app/backend/api/tests/test_rut_canonico.py
git commit -m "feat(db): el RUT tiene una sola forma, y la entrada acepta todas"
```

---

## Task 2: El candado de `public.drivers.tax_id`

**Files:**
- Modify: `monitor-app/backend/supabase/migrations/20260817120000_rut_canonico.sql` (segunda parte)
- Test: `monitor-app/backend/api/tests/test_rut_canonico.py` (se agregan tests)

**Interfaces:**
- Consume: `app.normalize_rut()` de la Task 1.
- Produce: nada que otra tarea importe. Es el candado.

> ⚠ **ORDEN DE APLICACIÓN.** El CHECK hace fallar cualquier escritura sucia, **incluida la de Mage**.
> Hoy no hay ninguna fila fuera de forma (0 de 79), así que el riesgo es futuro, no presente. Aun
> así: si el pipeline `load_drivers_03` empieza a fallar después de esta migración, **la migración no
> es el bug** — está haciendo exactamente su trabajo, y lo que hay que arreglar es lo que Mage
> escribe. Es el mismo criterio que dejó escrito `20260814120000_dedupe_drivers_sin_rut.sql`.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# se agrega a tests/test_rut_canonico.py

async def test_el_trigger_normaliza_lo_que_entra_sucio(conexion_revertida):
    """Un RUT con puntos entra; lo que queda guardado es canonico."""
    conn = conexion_revertida
    driver_id = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
        "Prueba Padron", "12.345.678-5",
    )
    assert await conn.fetchval(
        "SELECT tax_id FROM public.drivers WHERE id = $1", driver_id
    ) == "12345678-5"


async def test_un_rut_invalido_no_entra(conexion_revertida):
    """El DV que no cierra se rechaza con error, no se guarda ni se corrige."""
    import asyncpg
    with pytest.raises(asyncpg.IntegrityConstraintViolationError):
        await conexion_revertida.execute(
            "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2)",
            "Prueba DV Malo", "12345678-9",   # DV incorrecto
        )


async def test_sin_rut_sigue_permitido(conexion_revertida):
    """Hay 1 conductor real sin RUT esperando que lo completen a mano
    (ver 20260814120000_dedupe_drivers_sin_rut.sql). NULL sigue siendo valido."""
    driver_id = await conexion_revertida.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, NULL) RETURNING id",
        "Prueba Sin Rut",
    )
    assert driver_id is not None


async def test_actualizar_tambien_normaliza(conexion_revertida):
    """El trigger es BEFORE INSERT OR UPDATE: editar desde la app tampoco
    puede ensuciar la columna."""
    conn = conexion_revertida
    driver_id = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
        "Prueba Update", "12345678-5",
    )
    await conn.execute("UPDATE public.drivers SET tax_id = $1 WHERE id = $2",
                       "1.234.567-4", driver_id)
    assert await conn.fetchval(
        "SELECT tax_id FROM public.drivers WHERE id = $1", driver_id
    ) == "1234567-4"
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_rut_canonico.py -q -rs -k "trigger or invalido or sin_rut or actualizar"
```

Esperado: FAIL — hoy `12.345.678-5` se guarda tal cual y `12345678-9` entra sin protestar.

- [ ] **Step 3: Agregar el candado a la migración**

```sql
-- se agrega al final de 20260817120000_rut_canonico.sql, antes del COMMIT

-- ── El candado: entrada tolerante, almacenamiento estricto ──────────────────
-- Son DOS piezas y hacen falta las dos:
--   el trigger acepta lo que un humano escribe y lo canoniza;
--   el CHECK garantiza que lo guardado es canonico, venga de donde venga.
-- Con solo el CHECK, la app tendria que normalizar antes de cada INSERT (y
-- Mage tambien). Con solo el trigger, un ALTER o un COPY podrian saltearlo.

CREATE OR REPLACE FUNCTION app.trg_normalizar_tax_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tax_id IS NOT NULL THEN
        -- Si no normaliza, se deja el valor original para que el CHECK lo
        -- rechace con el texto que el usuario realmente escribio. Poner NULL
        -- aca convertiria un dato invalido en un dato ausente en silencio,
        -- que es peor: el error dejaria de existir en vez de resolverse.
        NEW.tax_id := COALESCE(app.normalize_rut(NEW.tax_id), NEW.tax_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_drivers_normalizar_tax_id ON public.drivers;
CREATE TRIGGER trg_drivers_normalizar_tax_id
    BEFORE INSERT OR UPDATE OF tax_id ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION app.trg_normalizar_tax_id();

-- NOT VALID a proposito: valida lo nuevo sin escanear la tabla. Se valida en
-- el paso siguiente, ya sabiendo que las 79 filas cumplen.
ALTER TABLE public.drivers
    ADD CONSTRAINT drivers_tax_id_canonico
    CHECK (tax_id IS NULL OR app.normalize_rut(tax_id) = tax_id) NOT VALID;

ALTER TABLE public.drivers VALIDATE CONSTRAINT drivers_tax_id_canonico;
```

- [ ] **Step 4: Aplicar y verificar**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_rut_canonico.py -q -rs
```

Esperado: PASS, los 5 grupos.

- [ ] **Step 5: Verificar que no rompió la app**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q
```

Esperado: la suite completa en verde. Prestar atención a `test_drivers.py`.

- [ ] **Step 6: Commit**

```bash
git add -A monitor-app/backend
git commit -m "feat(db): candado de forma canonica en drivers.tax_id"
```

---

## Task 3: La patente, el mismo tratamiento

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260817120100_patente_canonica.sql`
- Test: `monitor-app/backend/api/tests/test_rut_canonico.py` (se agregan tests de patente)

**Interfaces:**
- Produce: `app.normalize_patente(text) → text`. La usa la Task 4.

**Por qué entra en este plan:** el padrón cruza por patente. Una patente sucia rompe el JOIN
exactamente igual que un RUT sucio, y **ya hay una**: `GBVC90` está guardada con un **tabulador al
final**. Como `assets_license_plate_key` es UNIQUE sobre el valor crudo, `GBVC90` y `GBVC90\t`
pueden convivir como dos vehículos distintos. Es el mismo problema, y arreglarlo a medias deja el
padrón cruzando contra una tabla que sigue admitiendo duplicados invisibles.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# se agrega a tests/test_rut_canonico.py

@pytest.mark.parametrize(
    "entrada,esperado",
    [
        ("gbvc90", "GBVC90"),
        ("GBVC90\t", "GBVC90"),      # el caso real que habia en produccion
        (" GB-VC-90 ", "GBVC90"),
        ("GBVC90", "GBVC90"),
    ],
)
async def test_normaliza_patentes(conexion_revertida, entrada, esperado):
    assert await conexion_revertida.fetchval(
        "SELECT app.normalize_patente($1)", entrada) == esperado


@pytest.mark.parametrize("basura", ["", "   ", "GB", "GBVC901234", None])
async def test_lo_que_no_es_patente_devuelve_null(conexion_revertida, basura):
    assert await conexion_revertida.fetchval(
        "SELECT app.normalize_patente($1)", basura) is None


async def test_no_quedan_patentes_fuera_de_forma(conexion_revertida):
    """Despues de la limpieza, ninguna. Este test es el que detecta que
    alguien volvio a meter una con espacios."""
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.assets WHERE license_plate !~ '^[A-Z0-9]{6}$'") == 0


async def test_una_patente_sucia_no_entra(conexion_revertida):
    conn = conexion_revertida
    asset_id = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, $2) RETURNING id",
        " zzzz99 ", "TRACTOCAMION",
    )
    assert await conn.fetchval(
        "SELECT license_plate FROM public.assets WHERE id = $1", asset_id) == "ZZZZ99"
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_rut_canonico.py -q -rs -k patente
```

Esperado: FAIL (`function app.normalize_patente(text) does not exist`), y
`test_no_quedan_patentes_fuera_de_forma` en FAIL con `1`.

- [ ] **Step 3: Escribir la migración**

```sql
-- monitor-app/backend/supabase/migrations/20260817120100_patente_canonica.sql
-- ============================================================================
-- La patente, el mismo tratamiento que el RUT
-- ============================================================================
--
-- El padron de conductor cruza por patente. Una patente sucia rompe el JOIN
-- igual que un RUT sucio, y habia una: 'GBVC90' guardada con un TABULADOR al
-- final (verificado 2026-08-17, 1 de 118). Como assets_license_plate_key es
-- UNIQUE sobre el valor crudo, 'GBVC90' y 'GBVC90\t' conviven como dos
-- vehiculos distintos sin que nadie lo note.

BEGIN;

CREATE OR REPLACE FUNCTION app.normalize_patente(entrada text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN entrada IS NULL THEN NULL
        WHEN upper(regexp_replace(entrada, '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z0-9]{6}$'
            THEN upper(regexp_replace(entrada, '[^A-Za-z0-9]', '', 'g'))
        ELSE NULL
    END;
$$;

COMMENT ON FUNCTION app.normalize_patente(text) IS
    'Patente chilena en forma canonica AAAA99 (6 alfanumericos, mayuscula), '
    'o NULL. Acepta guiones, puntos y espacios en la entrada.';

-- ── Limpiar lo que ya esta sucio, ANTES de poner el candado ─────────────────
-- Si la limpieza generara un choque con una patente ya existente, este UPDATE
-- falla por el UNIQUE y la migracion se revierte entera. Eso es lo correcto:
-- fusionar dos vehiculos es una decision de negocio, no de una migracion.
UPDATE public.assets
SET license_plate = app.normalize_patente(license_plate)
WHERE app.normalize_patente(license_plate) IS DISTINCT FROM license_plate
  AND app.normalize_patente(license_plate) IS NOT NULL;

CREATE OR REPLACE FUNCTION app.trg_normalizar_patente()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.license_plate := COALESCE(
        app.normalize_patente(NEW.license_plate), NEW.license_plate);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assets_normalizar_patente ON public.assets;
CREATE TRIGGER trg_assets_normalizar_patente
    BEFORE INSERT OR UPDATE OF license_plate ON public.assets
    FOR EACH ROW EXECUTE FUNCTION app.trg_normalizar_patente();

ALTER TABLE public.assets
    ADD CONSTRAINT assets_license_plate_canonica
    CHECK (app.normalize_patente(license_plate) = license_plate) NOT VALID;

ALTER TABLE public.assets VALIDATE CONSTRAINT assets_license_plate_canonica;

COMMIT;
```

- [ ] **Step 4: Aplicar, verificar los tests y la suite completa**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q
```

Esperado: verde. `test_assets.py` es el que más riesgo tiene.

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/backend
git commit -m "feat(db): la patente tambien tiene una sola forma"
```

---

## Task 4: Un conductor habitual por tracto

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260817120200_un_conductor_habitual_por_tracto.sql`
- Test: `monitor-app/backend/api/tests/test_padron_conductor.py`

**El hueco:** `vehicle_driver_assignments` sólo tiene `UNIQUE (asset_id, driver_id)`. Nada impide
**dos conductores ACTIVE para el mismo tracto**. Si eso pasa, el `LEFT JOIN` de
`app.v_trip_fleet_resolution` **duplica filas de viaje** — un viaje aparecería dos veces en el
Cierre, con dos conductores. Hoy hay 0 violaciones, así que el índice sale gratis; después del
sembrado sería una migración con datos que arreglar.

- [ ] **Step 1: Escribir el test que falla**

```python
# monitor-app/backend/api/tests/test_padron_conductor.py
"""El padron de conductor por tracto: nivel 2 de app.v_trip_fleet_resolution."""
from __future__ import annotations

import asyncpg
import pytest

pytestmark = [pytest.mark.integracion, pytest.mark.asyncio]


async def _tracto(conn, patente: str) -> str:
    return await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1,'TRACTOCAMION') RETURNING id",
        patente)


async def _conductor(conn, nombre: str, rut: str) -> str:
    return await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1,$2) RETURNING id",
        nombre, rut)


async def test_un_tracto_no_puede_tener_dos_conductores_activos(conexion_revertida):
    """Si los tuviera, el LEFT JOIN de la vista de resolucion duplicaria el
    viaje: la misma fila apareceria dos veces en el Cierre, con dos
    conductores distintos."""
    conn = conexion_revertida
    tracto = await _tracto(conn, "ZZAA11")
    uno = await _conductor(conn, "Conductor Uno", "12345678-5")
    dos = await _conductor(conn, "Conductor Dos", "1234567-4")

    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
        tracto, uno)

    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
            tracto, dos)


async def test_el_conductor_anterior_puede_quedar_inactivo(conexion_revertida):
    """El indice es parcial: la historia se conserva, solo se limita a UNO
    activo. Cambiar de conductor habitual no exige borrar el anterior."""
    conn = conexion_revertida
    tracto = await _tracto(conn, "ZZAA22")
    uno = await _conductor(conn, "Conductor Tres", "12345678-5")
    dos = await _conductor(conn, "Conductor Cuatro", "1234567-4")

    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
        tracto, uno)
    await conn.execute(
        "UPDATE public.vehicle_driver_assignments SET status='INACTIVE', end_date=CURRENT_DATE "
        "WHERE asset_id=$1 AND driver_id=$2", tracto, uno)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
        tracto, dos)

    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE asset_id=$1", tracto) == 2
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_padron_conductor.py -q -rs
```

Esperado: FAIL — hoy el segundo INSERT pasa sin error.

- [ ] **Step 3: Escribir la migración**

```sql
-- monitor-app/backend/supabase/migrations/20260817120200_un_conductor_habitual_por_tracto.sql
-- ============================================================================
-- Un tracto tiene UN conductor habitual, no una lista
-- ============================================================================
--
-- vehicle_driver_assignments solo tenia UNIQUE (asset_id, driver_id), que
-- impide repetir el par pero NO impide dos conductores ACTIVE para el mismo
-- tracto. Con dos, el LEFT JOIN de app.v_trip_fleet_resolution duplica la
-- fila del viaje: el mismo viaje aparece dos veces en el Cierre.
--
-- Parcial a proposito: la historia (INACTIVE, con end_date) se conserva
-- entera. Lo unico que se limita es cuantos pueden estar vigentes a la vez.
--
-- Verificado antes de aplicar: 0 tractos con mas de un conductor activo, o
-- sea el indice se crea sin tener que arreglar datos.

CREATE UNIQUE INDEX IF NOT EXISTS idx_vda_un_conductor_activo_por_tracto
    ON public.vehicle_driver_assignments (asset_id)
    WHERE status = 'ACTIVE';
```

- [ ] **Step 4: Aplicar y verificar que los tests pasan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_padron_conductor.py -q -rs
```

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/backend
git commit -m "feat(db): un tracto tiene un conductor habitual, no una lista"
```

---

## Task 5: El padrón, como vista auditable

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260817120300_padron_legacy_view.sql`
- Test: `monitor-app/backend/api/tests/test_padron_conductor.py` (se agregan tests)

**Interfaces:**
- Consume: `app.normalize_rut()`, `app.normalize_patente()`.
- Produce: `app.v_legacy_padron_conductor (patente, tax_id, nombre_legacy, ultimo_despacho, despachos)`.
  La usa la Task 6.

**Por qué una vista y no un script:** el padrón es una **inferencia**, no un hecho — dice "este
tracto lo maneja habitualmente esta persona" con 91% de acierto. Una inferencia tiene que ser
auditable: cualquiera debe poder preguntarle a la base de dónde salió cada fila y cuándo se vio por
última vez. Un script de una sola pasada se lleva esa explicación a la tumba.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# se agrega a tests/test_padron_conductor.py

async def test_el_padron_da_una_sola_fila_por_patente(conexion_revertida):
    """Es la clave de la tabla destino: si repitiera patente, el sembrado
    chocaria contra el indice de la Task 4."""
    fila = await conexion_revertida.fetchrow(
        "SELECT count(*) AS filas, count(DISTINCT patente) AS patentes "
        "FROM app.v_legacy_padron_conductor")
    assert fila["filas"] > 0, "el padron vacio no prueba nada"
    assert fila["filas"] == fila["patentes"]


async def test_el_padron_solo_trae_identificadores_canonicos(conexion_revertida):
    """Nada que no pase por normalize_* sale de la vista."""
    assert await conexion_revertida.fetchval(
        """
        SELECT count(*) FROM app.v_legacy_padron_conductor
        WHERE app.normalize_rut(tax_id) IS DISTINCT FROM tax_id
           OR app.normalize_patente(patente) IS DISTINCT FROM patente
        """
    ) == 0


async def test_el_padron_cubre_las_patentes_que_estan_rodando(conexion_revertida):
    """La prueba que importa: los viajes de agosto (que el legacy NO conoce,
    porque sus despachos cortan el 31/07) tienen que resolver igual."""
    fila = await conexion_revertida.fetchrow(
        """
        WITH v AS (
            SELECT DISTINCT app.normalize_patente(t.fleet->>'tractor_plate') AS patente
            FROM app.trips t
            WHERE t.planning_date >= '2026-08-01'
              AND app.normalize_patente(t.fleet->>'tractor_plate') IS NOT NULL
        )
        SELECT count(*) AS patentes,
               count(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM app.v_legacy_padron_conductor p
                                 WHERE p.patente = v.patente)) AS cubiertas
        FROM v
        """
    )
    assert fila["patentes"] > 0
    # Medido 2026-08-17: 47 de 47. Se exige 90% para que el test no se rompa
    # por una patente nueva legitima, pero si baja de ahi hay que mirar.
    assert fila["cubiertas"] / fila["patentes"] >= 0.90
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_padron_conductor.py -q -rs -k padron
```

Esperado: FAIL con `relation "app.v_legacy_padron_conductor" does not exist`.

- [ ] **Step 3: Escribir la migración**

```sql
-- monitor-app/backend/supabase/migrations/20260817120300_padron_legacy_view.sql
-- ============================================================================
-- El padron: que conductor maneja habitualmente cada tracto
-- ============================================================================
--
-- DE DONDE SALE: bronze.raw_bd_ot, que Mage carga del Excel
-- `Finanzas/BD OT 2026.xlsx` (SharePoint). Ese archivo SIGUE VIVO —ultima
-- edicion 2026-08-12— pero cambio de oficio: es un libro de liquidacion, y
-- sus despachos cortan el 2026-07-31. Cero despachos en agosto.
--
-- POR ESO NO SE CRUZA POR DIA. Cruzando patente+fecha, agosto resuelve 0 de
-- 528. Cruzando por padron, resuelve 528 de 528, porque las patentes que
-- ruedan hoy son las mismas que el archivo conocia en julio.
--
-- QUE TAN BUENO ES: backtest honesto —padron construido SOLO con datos
-- anteriores al 2026-07-01, evaluado contra la verdad de julio— da 91,0% de
-- acierto donde hay entrada previa. Es una INFERENCIA, no un hecho: por eso
-- es una vista auditable y por eso la correccion humana le gana (Task 6).
--
-- ENVEJECE. Hoy es exacto porque se alimento hasta el 31/07. A medida que
-- cambien los conductores va a derivar, y el unico remedio es que operaciones
-- corrija. La vista expone `ultimo_despacho` justamente para que se pueda ver
-- cuan viejo es cada dato.

CREATE OR REPLACE VIEW app.v_legacy_padron_conductor AS
WITH despachos AS (
    SELECT
        app.normalize_patente(o.patente_camion) AS patente,
        app.normalize_rut(o.rut_chofer)         AS tax_id,
        btrim(o.chofer)                         AS nombre_legacy,
        CASE WHEN btrim(o.f_despacho) ~ '^\d{4}-\d{2}-\d{2}'
             THEN to_timestamp(btrim(o.f_despacho), 'YYYY-MM-DD HH24:MI:SS')::date
        END                                     AS despacho
    FROM bronze.raw_bd_ot o
),
validos AS (
    -- Las tres condiciones son la misma idea: si no se puede identificar al
    -- tracto, a la persona, o cuando fue, la fila no sirve como evidencia.
    SELECT * FROM despachos
    WHERE patente IS NOT NULL AND tax_id IS NOT NULL AND despacho IS NOT NULL
),
-- bronze.raw_bd_ot es append-only por hash de fila y ademas tiene 3.477 filas
-- duplicadas (el WHERE NOT EXISTS de bd_ot_master.sql compara contra el
-- destino pero no dentro del propio lote). Sin este DISTINCT, un conductor
-- pesaria mas por haberse recargado, no por haber manejado mas.
distintos AS (
    SELECT DISTINCT patente, tax_id, nombre_legacy, despacho FROM validos
),
ranking AS (
    SELECT
        patente, tax_id,
        max(nombre_legacy)  AS nombre_legacy,
        max(despacho)       AS ultimo_despacho,
        count(*)            AS despachos
    FROM distintos
    GROUP BY patente, tax_id
)
SELECT DISTINCT ON (patente)
    patente, tax_id, nombre_legacy, ultimo_despacho, despachos
FROM ranking
-- El desempate es deliberado: manda QUIEN LO MANEJO MAS RECIENTEMENTE, y
-- recien despues quien lo manejo mas veces. Un conductor que hizo 200 viajes
-- hasta marzo no es el habitual de un tracto que otro maneja desde junio.
ORDER BY patente, ultimo_despacho DESC, despachos DESC, tax_id;

COMMENT ON VIEW app.v_legacy_padron_conductor IS
    'Inferencia: conductor habitual por tracto, derivada de bronze.raw_bd_ot. '
    '91% de acierto backtesteado. Envejece — ver ultimo_despacho. La siembra '
    'de public.vehicle_driver_assignments sale de aca, y la correccion humana '
    'le gana siempre (is_manual_override).';
```

- [ ] **Step 4: Aplicar y verificar los tests**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_padron_conductor.py -q -rs
```

- [ ] **Step 5: Mirar el padrón, no sólo testearlo**

```sql
SELECT count(*) AS patentes,
       count(*) FILTER (WHERE ultimo_despacho >= '2026-06-01') AS frescas,
       min(ultimo_despacho) AS mas_viejo, max(ultimo_despacho) AS mas_nuevo
FROM app.v_legacy_padron_conductor;
```

Anotar los números en el commit: son la línea base contra la que se va a medir el envejecimiento.

- [ ] **Step 6: Commit**

```bash
git add -A monitor-app/backend
git commit -m "feat(db): el padron de conductor por tracto, como vista auditable"
```

---

## Task 6: Sembrar, sin pisar lo que un humano corrigió

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260817120400_sembrar_padron.sql`
- Test: `monitor-app/backend/api/tests/test_padron_conductor.py` (se agregan tests)

**Interfaces:**
- Consume: `app.v_legacy_padron_conductor` de la Task 5.
- Produce: filas en `public.vehicle_driver_assignments` — el nivel 2 de la cadena.

**Las tres reglas del sembrado**, en orden de precedencia:

1. **Una asignación con `is_manual_override = true` no se toca nunca.** El padrón es una inferencia
   del 91%; una persona que corrigió a mano sabe algo que el padrón no.
2. Si la asignación automática vigente ya apunta al mismo conductor, no se hace nada (idempotencia).
3. Si apunta a otro, se cierra (`INACTIVE` + `end_date`) y se abre la nueva. La historia queda.

Es re-ejecutable: cada carga nueva del Excel puede volver a correrlo, y el día que el archivo muera,
lo último sembrado se queda.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# se agrega a tests/test_padron_conductor.py

async def test_sembrar_es_idempotente(conexion_revertida):
    """Correrlo dos veces deja lo mismo que correrlo una."""
    conn = conexion_revertida
    await conn.execute("SELECT app.sembrar_padron_conductor()")
    primera = await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE status='ACTIVE'")
    await conn.execute("SELECT app.sembrar_padron_conductor()")
    segunda = await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE status='ACTIVE'")
    assert primera == segunda


async def test_no_pisa_una_correccion_manual(conexion_revertida):
    """La regla que sostiene todo el diseno: el padron acierta 91%, o sea se
    equivoca 1 de cada 11 veces. Quien corrigio a mano sabe algo que la
    inferencia no, y el proximo sembrado no puede borrarlo."""
    conn = conexion_revertida

    # Un tracto que el padron conoce, con SU conductor segun el padron
    fila = await conn.fetchrow(
        "SELECT patente, tax_id FROM app.v_legacy_padron_conductor "
        "WHERE ultimo_despacho >= '2026-06-01' LIMIT 1")
    assert fila is not None, "sin padron fresco el test no prueba nada"

    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", fila["patente"])
    if asset_id is None:
        asset_id = await _tracto(conn, fila["patente"])

    # Alguien asigna a mano OTRO conductor
    otro = await _conductor(conn, "Correccion A Mano", "12345678-5")
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, is_manual_override) VALUES ($1,$2,true)", asset_id, otro)

    await conn.execute("SELECT app.sembrar_padron_conductor()")

    vigente = await conn.fetchval(
        "SELECT driver_id FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND status='ACTIVE'", asset_id)
    assert vigente == otro, "el sembrado piso una correccion manual"


async def test_reemplaza_una_asignacion_automatica_desactualizada(conexion_revertida):
    """Lo automatico si se actualiza, y el anterior queda como historia."""
    conn = conexion_revertida
    fila = await conn.fetchrow(
        "SELECT patente, tax_id FROM app.v_legacy_padron_conductor "
        "WHERE ultimo_despacho >= '2026-06-01' LIMIT 1")
    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", fila["patente"])
    if asset_id is None:
        asset_id = await _tracto(conn, fila["patente"])

    viejo = await _conductor(conn, "Conductor Viejo", "1234567-4")
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, is_manual_override) VALUES ($1,$2,false)", asset_id, viejo)

    await conn.execute("SELECT app.sembrar_padron_conductor()")

    assert await conn.fetchval(
        "SELECT status FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND driver_id=$2", asset_id, viejo) == "INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND status='ACTIVE'", asset_id) == 1


async def test_la_resolucion_del_conductor_mejora_de_verdad(conexion_revertida):
    """El test que justifica el plan entero: la vista que consumen los 5
    routers tiene que resolver mas viajes despues de sembrar que antes."""
    conn = conexion_revertida
    sql = """
        SELECT count(*) FILTER (WHERE vfr.resolved_driver_id IS NOT NULL)::float
             / NULLIF(count(*), 0)
        FROM app.trips t
        JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
        WHERE t.planning_date >= '2026-08-01'
    """
    antes = await conn.fetchval(sql)
    await conn.execute("SELECT app.sembrar_padron_conductor()")
    despues = await conn.fetchval(sql)

    assert antes is not None and despues is not None
    assert despues > antes, f"sembrar no mejoro nada: antes={antes} despues={despues}"
    # Medido 2026-08-17: 34% -> 95%. Se exige 85% para dejar margen.
    assert despues >= 0.85, f"resolucion insuficiente: {despues:.2%}"
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_padron_conductor.py -q -rs -k "sembrar or pisa or reemplaza or resolucion"
```

Esperado: FAIL con `function app.sembrar_padron_conductor() does not exist`.

- [ ] **Step 3: Escribir la migración**

```sql
-- monitor-app/backend/supabase/migrations/20260817120400_sembrar_padron.sql
-- ============================================================================
-- Sembrar el nivel 2 de la cadena de resolucion
-- ============================================================================
--
-- app.v_trip_fleet_resolution resuelve el conductor con
--     COALESCE(fl.driver_id, vda_auto.driver_id, d_by_name.id)
-- y el del medio —public.vehicle_driver_assignments— tenia UNA fila en toda
-- la base. Por eso todo caia al tercero, la igualdad exacta de nombre, que
-- acierta el 34%: el 14/08 el Cierre mostro 12 conductores asignados cuando
-- habian salido 29 tractos, y cerrar exigia justificar ~32 ausencias falsas.
--
-- Esta funcion llena ese nivel. No cambia la vista, no toca app.trips y no
-- necesita ni una linea de Python: los 5 routers y 18 lugares que ya
-- consumen la vista mejoran solos.

BEGIN;

CREATE OR REPLACE FUNCTION app.sembrar_padron_conductor()
RETURNS TABLE (asignaciones_nuevas int, asignaciones_cerradas int, sin_asset int, sin_driver int)
LANGUAGE plpgsql AS $$
DECLARE
    nuevas   int := 0;
    cerradas int := 0;
BEGIN
    -- ── Lo que el padron propone, ya resuelto a ids ─────────────────────────
    -- El DROP no sobra: `ON COMMIT DROP` limpia al confirmar la transaccion,
    -- no al terminar la funcion. Sin esto, llamarla dos veces en la MISMA
    -- transaccion —que es exactamente lo que hace el test de idempotencia—
    -- revienta con "relation already exists".
    DROP TABLE IF EXISTS padron_resuelto;
    CREATE TEMP TABLE padron_resuelto ON COMMIT DROP AS
    SELECT p.patente, p.tax_id, a.id AS asset_id, d.id AS driver_id
    FROM app.v_legacy_padron_conductor p
    LEFT JOIN public.assets  a ON a.license_plate = p.patente
    LEFT JOIN public.drivers d ON d.tax_id        = p.tax_id;

    -- ── 1. Cerrar lo automatico que quedo desactualizado ────────────────────
    -- El filtro `NOT is_manual_override` es la regla que sostiene el diseno:
    -- el padron acierta 91%, o sea se equivoca 1 de cada 11 veces. Quien
    -- corrigio a mano sabe algo que la inferencia no.
    WITH cerrar AS (
        UPDATE public.vehicle_driver_assignments v
        SET status = 'INACTIVE', end_date = CURRENT_DATE
        FROM padron_resuelto p
        WHERE v.asset_id = p.asset_id
          AND v.status = 'ACTIVE'
          AND NOT v.is_manual_override
          AND p.driver_id IS NOT NULL
          AND v.driver_id IS DISTINCT FROM p.driver_id
        RETURNING 1
    ) SELECT count(*) INTO cerradas FROM cerrar;

    -- ── 2. Abrir la vigente ─────────────────────────────────────────────────
    -- ON CONFLICT sobre (asset_id, driver_id) reactiva un par que ya existia
    -- inactivo: un conductor que volvio al mismo tracto no necesita fila nueva.
    WITH abrir AS (
        INSERT INTO public.vehicle_driver_assignments
            (asset_id, driver_id, status, start_date, is_manual_override)
        SELECT p.asset_id, p.driver_id, 'ACTIVE', CURRENT_DATE, false
        FROM padron_resuelto p
        WHERE p.asset_id IS NOT NULL
          AND p.driver_id IS NOT NULL
          -- No pisar un tracto que alguien ya resolvio a mano
          AND NOT EXISTS (
              SELECT 1 FROM public.vehicle_driver_assignments v
              WHERE v.asset_id = p.asset_id AND v.status = 'ACTIVE'
                AND v.is_manual_override)
        ON CONFLICT (asset_id, driver_id) DO UPDATE
            SET status = 'ACTIVE', end_date = NULL
            WHERE NOT public.vehicle_driver_assignments.is_manual_override
        RETURNING 1
    ) SELECT count(*) INTO nuevas FROM abrir;

    RETURN QUERY
    SELECT nuevas, cerradas,
           (SELECT count(*)::int FROM padron_resuelto WHERE asset_id IS NULL),
           (SELECT count(*)::int FROM padron_resuelto WHERE driver_id IS NULL);
END;
$$;

COMMENT ON FUNCTION app.sembrar_padron_conductor() IS
    'Siembra public.vehicle_driver_assignments desde app.v_legacy_padron_conductor. '
    'Idempotente y re-ejecutable. NUNCA pisa is_manual_override = true.';

COMMIT;
```

- [ ] **Step 4: Aplicar y correr en seco (sin confirmar) para ver los faltantes**

```sql
BEGIN;
SELECT * FROM app.sembrar_padron_conductor();
ROLLBACK;
```

Las columnas `sin_asset` y `sin_driver` son la lista de altas del paso siguiente. Medido el
2026-08-17: **3 patentes de agosto sin `asset`** y **8 conductores sin `driver`**.

- [ ] **Step 5: Dar de alta los faltantes que están rodando**

Sólo los que aparecen en viajes de los últimos 30 días — no las 700 y pico de conductores históricos
del legacy. Dar de alta un conductor **dispara sus 12 requisitos de Certificación**, así que un alta
masiva ensuciaría el embudo con pendientes de gente que no trabaja acá hace años.

```sql
-- Conductores que faltan y estan rodando
INSERT INTO public.drivers (full_name, tax_id)
SELECT DISTINCT initcap(p.nombre_legacy), p.tax_id
FROM app.v_legacy_padron_conductor p
JOIN app.trips t
  ON app.normalize_patente(t.fleet->>'tractor_plate') = p.patente
 AND t.planning_date >= CURRENT_DATE - 30
WHERE NOT EXISTS (SELECT 1 FROM public.drivers d WHERE d.tax_id = p.tax_id)
ON CONFLICT (tax_id) DO NOTHING;

-- Tractos que faltan y estan rodando
INSERT INTO public.assets (license_plate, asset_type)
SELECT DISTINCT app.normalize_patente(t.fleet->>'tractor_plate'), 'TRACTOCAMION'
FROM app.trips t
WHERE t.planning_date >= CURRENT_DATE - 30
  AND app.normalize_patente(t.fleet->>'tractor_plate') IS NOT NULL
ON CONFLICT (license_plate) DO NOTHING;
```

> Estas altas **no van en la migración**: son datos, no esquema, y el conjunto cambia según el día en
> que se corran. Se ejecutan una vez, se anota el resultado en el AGENTLOG, y de ahí en adelante las
> altas las hace operaciones desde la app.

- [ ] **Step 6: Sembrar en firme y verificar**

```sql
SELECT * FROM app.sembrar_padron_conductor();
```

- [ ] **Step 7: Correr la suite completa**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q
```

Esperado: verde. `test_daily_closures.py`, `test_pre_cierre.py` y `test_fleet_driver_gap.py` son los
que más pueden moverse: hasta hoy asumían un mundo donde casi nada resolvía.

- [ ] **Step 8: Commit**

```bash
git add -A monitor-app/backend
git commit -m "feat(db): sembrar el padron de conductor, sin pisar correcciones manuales"
```

---

## Task 7: La verificación que importa

**Files:** ninguno nuevo — es medición contra producción.

Un test que pasa no prueba que operaciones pueda cerrar el día. Esto sí.

- [ ] **Step 1: El número que abrió el caso**

```sql
SELECT t.planning_date,
       count(*)                                                   AS viajes,
       count(DISTINCT vfr.resolved_tractor_asset_id)               AS tractos,
       count(DISTINCT vfr.resolved_driver_id)                      AS conductores,
       round(100.0 * count(*) FILTER (WHERE vfr.resolved_driver_id IS NOT NULL)
             / count(*), 1)                                        AS pct_resuelto
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
WHERE t.planning_date >= CURRENT_DATE - 14
GROUP BY 1 ORDER BY 1 DESC;
```

**El criterio:** `conductores` tiene que acercarse a `tractos`. El 14/08 eran **12 contra 29**, y esa
brecha es la razón por la que nadie cerró nunca un día.

- [ ] **Step 2: Que ningún viaje se haya duplicado**

```sql
SELECT count(*) AS filas, count(DISTINCT trip_id) AS viajes
FROM app.v_trip_fleet_resolution;
```

Los dos números tienen que ser iguales. Si no, el índice de la Task 4 no está haciendo su trabajo.

- [ ] **Step 3: Mirar la pantalla**

Entrar al Cierre en `webcarga-frontend-dev` y ver un día reciente. Un test no ve un nombre cortado ni
una fila duplicada. **Elegir el día por SQL, no a ojo del desplegable.**

- [ ] **Step 4: Actualizar `AGENTLOG.md`** con los números de antes y después, y commitear.

---

## Fuera de alcance, a propósito

- **Corregir el conductor desde la pantalla.** `is_manual_override` ya existe y el sembrado lo
  respeta, pero la UI para editarlo es del recorrido del Cierre — **Plan 3**.
- **El bug del dedup de `bd_ot_master.sql`** (3.477 filas duplicadas). La vista del padrón lo neutraliza
  con `DISTINCT`; arreglarlo en Mage es una tarea aparte, ya anotada en los pendientes.
- **Dar de alta los ~700 conductores históricos del legacy.** Dispararía requisitos de Certificación
  falsos. Sólo entra quien está rodando.
- **Que el padrón se refresque solo.** Hoy se corre a mano. Automatizarlo exige decidir qué pasa
  cuando el Excel muera, y esa decisión todavía no está tomada.

## Autorrevisión

- **Cobertura**: las 5 reglas del Bloque 0 del spec tienen tarea. La resolución del conductor
  (Tasks 5-6), la calidad del identificador (Tasks 1-3), la unicidad (Task 4), la medición (Task 7).
- **Sin placeholders**: cada paso tiene su SQL o su Python completo.
- **Consistencia de tipos**: `app.normalize_rut(text) → text` y `app.normalize_patente(text) → text`
  se usan con la misma firma en las Tasks 2, 3, 5 y 6. `app.sembrar_padron_conductor()` devuelve
  `TABLE(...)` y se invoca con `SELECT * FROM` en el uso y con `SELECT` a secas en los tests, que es
  válido para ambos.
- **Riesgo mayor**: el CHECK de la Task 2 puede hacer fallar el pipeline de Mage si alguna vez
  escribe un RUT sucio. Es deseado y está señalizado, pero quien ejecute debe avisarlo antes de
  aplicar.
