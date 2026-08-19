# BD OT: de dependencia de consulta a fuente de deltas · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para seguimiento.

**Goal:** Que `bronze.raw_bd_ot` deje de ser algo que se consulta y pase a ser lo que el propio
código ya declaró que es —un padrón que aporta deltas—, de modo que apagar el Excel el día que
Certificación centralice el dato no rompa nada.

**Architecture:** `silver.int_habitual_driver_by_tractor` deja de ser una vista creada por migración
y pasa a ser un modelo dbt materializado en `silver`, con el mismo patrón que los tres snapshots que
ya leen la misma fuente. `sync_habitual_drivers()` deja de derivar y pasa a comparar contra
`public`, produciendo el delta. Y la canonicalización deja de tener dos implementaciones.

**Tech Stack:** Postgres (Supabase) · dbt-postgres 1.8 sobre Mage Cloud · FastAPI + asyncpg.

**Spec:** este documento. No hubo spec previa; nace de una pregunta del usuario —*"¿por qué se usa
`bronze.raw_bd_ot` constantemente si es una conexión momentánea?"*— y de las mediciones de abajo.

---

## El estado medido, que es de donde sale todo

Todo lo que sigue está medido contra producción el 2026-08-19, no estimado.

### 1 · La vista se recalcula entera, y nadie más que la siembra la usa

```
silver.int_habitual_driver_by_tractor   VISTA, 0 bytes — se recalcula en cada consulta
  └─ bronze.raw_bd_ot                   78 MB, 98.172 filas
       ├─ canonical_plate() + canonical_rut()   una llamada por fila (196.344)
       ├─ regex + to_timestamp                  una por fila
       ├─ DISTINCT · GROUP BY · DISTINCT ON     tres ordenamientos de 98k
```

`sync_habitual_drivers()` **la evalúa dos veces**: una para llenar `resolved_registry`, otra en el
`RETURN QUERY` para contar `skipped_as_stale`. Resultado: **24,5 s de media, 103 s de máximo**, sobre
142 llamadas en 124 días. Es la función más lenta por llamada de toda la base.

Las tres tablas que une son **diminutas**: `assets` 124 filas, `drivers` 87, `vehicle_driver_assignments`
56. No falta un índice — la derivación agrega la tabla entera, el escaneo es inevitable. **Lo que
sobra es rehacerlo.**

**Verificado con grep sobre todo el repo**: la vista sólo aparece en la migración que la crea, en
`sync_habitual_drivers()` y en `tests/test_padron_conductor.py`. **Ni la API ni el frontend la
consultan.** Es una fuente de siembra de una sola dirección.

### 2 · La arquitectura ya declaró que BD OT es bootstrap

`app/routers/assets.py:147`, en el docstring de `POST /assets/{id}/driver-assignment`:

> *"Reemplaza la dependencia de `bronze.raw_bd_ot` (**bootstrap histórico de una sola vez**,
> migración 20260718060000)"*

Y el AGENTLOG: *"El legacy BD OT: padrón, no feed"*. Lo que quedó es una vista que se comporta como
feed contra una fuente que todos declararon padrón.

### 3 · El patrón correcto YA EXISTE, tres veces

`bronze.raw_bd_ot` ya alimenta tres snapshots de dbt en `silver`:

| Modelo | Qué produce |
|---|---|
| `snapshot_silver_vehicles.sql` | maestro de vehículos, SCD-2 |
| `snapshot_silver_drivers.sql` | maestro de conductores, SCD-2 |
| `snapshot_silver_trailers.sql` | maestro de ramplas, SCD-2 |

Los tres son **snapshots materializados con índices declarados**. La vista del padrón es **la única
excepción**, y la migración dice por qué: *"Se crea por migracion porque el push a Mage lo bloquea el
clasificador de permisos. Migrar cuando se destrabe."*

**Ese comentario está desactualizado.** El AGENTLOG del 2026-08-18 registra la sincronización con
Mage funcionando (441 archivos, 0 conflictos); lo único bloqueado es `block_update`. El camino está
abierto.

### 4 · Hay DOS canonicalizaciones sobre la misma columna, y una acepta basura

| | `clean_rut` (macro dbt) | `canonical_rut` (función Postgres) |
|---|---|---|
| Quita no-dígitos | sí | sí |
| Quita ceros a la izquierda | **sí** | no |
| Valida dígito verificador (módulo 11) | **NO** | sí |
| Quién la usa | `snapshot_silver_drivers` → `silver` | la vista del padrón y `public.drivers.tax_id` |

Medido sobre los **1.149 RUTs distintos** de `raw_bd_ot`:

| | |
|---|---|
| `canonical_rut` rechaza | **252** (22 %) |
| `clean_rut` rechaza | **0** |
| Discrepan cuando ambos dan valor | **0** |

**La buena noticia**: cuando las dos producen un valor, **coinciden exactamente**. No hay conflicto
de formato; los ceros a la izquierda no aparecen en estos datos.

**La mala**: `clean_rut` acepta 252 RUTs que no son RUTs, y `snapshot_silver_drivers` les construye
una identidad con `md5(dni_driver_clean)::uuid`. Por qué se rechazan:

| Motivo | Cuántos |
|---|---|
| Dígito verificador no cuadra (módulo 11) | **204** |
| Demasiado largo (10 a 18 dígitos) | 26 |
| Demasiado corto (1 a 7 dígitos) | 18 |
| Sin dígitos | 4 |

Esos 252 **no pueden existir en `public.drivers`** — el CHECK los rechaza. O sea que `silver` tiene
hasta 252 identidades de conductor que la base operacional considera inválidas. El snapshot ya
calcula `is_valid_rut`, pero **construye el `driver_id` con el valor sin validar igual**.

---

## Global Constraints

- **La ingesta la centraliza Mage hacia `public.*`.** El backend es sólo lectura sobre esas tablas.
  Nada de este plan escribe a `public` desde la API.
- **Convención de entregables**: los modelos de `staging`/`silver` son modelos dbt; los upserts a
  `app`/`public` son SQL blocks. **Nunca materializar con dbt una tabla OLTP de `public`** — un
  full-refresh le borra RLS y PK.
- **dbt-postgres no puede agregar columnas `ARRAY` a modelos incrementales** (`sync_all_columns`
  genera `ADD COLUMN x ARRAY`, que es error de sintaxis). Si hace falta una columna array, se crea a
  mano o se usa `jsonb`.
- **`mage-agent` trunca los logs a ~8.013 caracteres sin avisar.** Si un error de dbt no se explica
  con la evidencia, pedir al usuario que corra el bloque en la UI de Mage y pegue el log completo.
- **`run_block` está roto para pipelines de TMS** (`500 NoResultFound`, reproducido 5 veces). Correr
  el pipeline entero, o pedirlo por la UI.
- **El corte de frescura es una decisión de negocio, no un número suelto**: evidencia de menos de 3
  meses acierta **94,2 %** (673 casos), de 3 a 6 meses acierta **4,0 %** (25 casos). No se cambia sin
  volver a medir.
- **Nunca pisar `is_manual_override = true`.** Es el invariante que sostiene todo el diseño de la
  capa: quien corrigió a mano sabe algo que la inferencia no.
- **Nada de código muerto ni huérfano.** Si al terminar una tarea queda algo sin consumidores —una
  vista reemplazada, una función que ya nadie llama, una columna sustituida— **se borra en el mismo
  commit que la deja sin uso**, no "más adelante". Dejar una función viva con un comentario que dice
  "no la uses" no es documentar: es dejar una trampa cargada para el que la encuentre por búsqueda.
  Lo único que se conserva es lo que tiene un lector verificado con `grep`, y el grep va en el
  commit.
- **Cero duplicación: lo que sirve a dos consumidores es UNO, parametrizado.** Si dos superficies
  necesitan lo mismo, no se escribe dos veces ni se escribe una "basada en el patrón de" la otra —
  eso es exactamente cómo se dice frankenstein. Se extrae la pieza compartida y cada consumidor la
  adapta por parámetro. Este repo ya tiene el precedente escrito tres veces y hay que seguirlo:
  `CarrierDrawer` recibe `subject?` en vez de tener un componente hermano; `useFilaAbierta` y
  `useGestoDeCarga` **devuelven props sueltas y no un componente**, porque sus dos consumidores
  tienen formas incompatibles y un envoltorio obligaría a uno a deformarse; y
  `lib/queries/certificacion.ts` hace que la clave que consulta y la que invalida salgan de la misma
  función. **Cuál de las tres formas corresponde depende de si lo compartido es la forma o la
  regla**: si es la forma, una prop; si es la regla, un hook o una función.
- **Apalancarse en lo que ya existe, y leerlo antes de escribir.** Ninguna tarea inventa un patrón
  que el repo ya resolvió al lado. Por eso la Task 2 empieza leyendo los tres snapshots que ya leen
  la misma fuente: el modelo nuevo copia su `config` con índices declarados y su uso de `source()`.
- **Redactar PII.** Los RUTs y nombres de `raw_bd_ot` son datos personales reales. Ninguna evidencia
  que se escriba a disco —reportes, logs, comentarios de commit— puede llevar un RUT o un nombre.
  Se caracteriza por patrón y se cuenta, como hace la tabla de arriba.

---

## Estructura de archivos

**Mage / dbt** (`.mage-agent/local_sync/`, la fuente de verdad es el cluster)
- Crear: `dbt/transporters/models/silver/int_habitual_driver_by_tractor.sql` — el modelo que
  reemplaza a la vista, materializado como tabla con índices.
- Modificar: `dbt/transporters/snapshots/snapshot_silver_drivers.sql` — la identidad deja de
  construirse sobre un RUT sin validar.
- Crear: `dbt/transporters/models/silver/schema.yml` (o extender el existente) — los tests que fijan
  los dos invariantes.
- Modificar: `pipelines/legacy_drivers_transporters/metadata.yaml` — el modelo nuevo entra al DAG.

**Backend** (`monitor-app/backend/api`)
- Crear: `../supabase/migrations/20260820120000_padron_deltas.sql` — `sync_habitual_drivers()`
  reescrita: una sola lectura, y el conteo sale del mismo escaneo.
- Modificar: `tests/test_padron_conductor.py` — los tests dejan de leer la vista y leen la tabla.

---

## Task 1: Una sola definición de RUT canónico, y la prueba de que ya coinciden

Es la primera porque es la que puede tener sorpresas, y porque las demás se apoyan en que la
identidad de un conductor sea la misma en los dos lados.

**Files:**
- Test: `monitor-app/backend/api/tests/test_identidad_canonica.py` (crear)

**Interfaces:**
- Produces: la evidencia, en un test que se vuelve a correr, de que `clean_rut` y `canonical_rut`
  no discrepan cuando ambas dan valor — y de cuántos acepta la primera que la segunda rechaza.

- [ ] **Step 1: Escribir el test que mide, contra Postgres real**

En `tests/test_identidad_canonica.py`:

```python
"""Las dos canonicalizaciones de RUT que conviven en este proyecto.

`public.canonical_rut` (Postgres) guarda `public.drivers.tax_id` y el padron.
`clean_rut` (macro dbt) construye la identidad de `snapshot_silver_drivers`.
Son dos implementaciones sobre la MISMA columna de origen, asi que la
pregunta que importa no es cual es mejor: es si alguna vez producen
identidades distintas para la misma persona.
"""
import pytest

pytestmark = pytest.mark.integracion

# La macro `clean_rut` de dbt, transcrita a SQL. Se transcribe y no se importa
# porque vive en Jinja del lado de Mage; el test de la Task 2 fija que esta
# copia sigue siendo fiel al original.
CLEAN_RUT_DBT = (
    "NULLIF(REGEXP_REPLACE(LTRIM(REGEXP_REPLACE(UPPER(CAST({col} AS TEXT)),"
    "'[^0-9K]','','g'),'0'),'(.*)(.)$','\\1-\\2'),'-')"
)


async def test_las_dos_canonicalizaciones_no_se_contradicen(conexion_revertida):
    """Medido el 2026-08-19: 1.149 RUTs distintos, `canonical_rut` rechaza 252
    y `clean_rut` ninguno, PERO cuando las dos dan valor coinciden en el
    100%. Este test fija esa coincidencia.

    Si alguna vez discrepan, `silver` y `public` tienen dos personas donde hay
    una, y ninguna pantalla lo mostraria."""
    fila = await conexion_revertida.fetchrow(f"""
        WITH ruts AS (
            SELECT DISTINCT rut_chofer AS crudo
            FROM bronze.raw_bd_ot WHERE rut_chofer IS NOT NULL
        )
        SELECT count(*) FILTER (
            WHERE public.canonical_rut(crudo) IS NOT NULL
              AND {CLEAN_RUT_DBT.format(col='crudo')} IS NOT NULL
              AND public.canonical_rut(crudo) <> {CLEAN_RUT_DBT.format(col='crudo')}
        ) AS discrepan
        FROM ruts
    """)
    assert fila["discrepan"] == 0, (
        "las dos canonicalizaciones producen identidades distintas para la "
        "misma persona: silver y public dejaron de hablar del mismo conductor"
    )


async def test_clean_rut_acepta_ruts_que_public_rechaza(conexion_revertida):
    """El lado incomodo del mismo hecho, y por eso existe la Task 3.

    `clean_rut` no valida el digito verificador, asi que `snapshot_silver_drivers`
    le construye `md5(dni_driver)::uuid` a RUTs que `public.drivers` no puede
    guardar. Medido: 252 de 1.149, de los cuales 204 fallan modulo 11.

    El numero puede BAJAR cuando se limpie el origen; que suba significa que
    entro basura nueva."""
    n = await conexion_revertida.fetchval("""
        SELECT count(*) FROM (
            SELECT DISTINCT rut_chofer AS crudo
            FROM bronze.raw_bd_ot WHERE rut_chofer IS NOT NULL
        ) r
        WHERE public.canonical_rut(crudo) IS NULL
    """)
    assert n <= 252, (
        f"RUTs invalidos en bronze.raw_bd_ot: {n} (tope conocido 252). "
        "Si subio, entro basura nueva al Excel de origen."
    )
```

- [ ] **Step 2: Correr y verificar que pasan**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_identidad_canonica.py -q -p no:randomly
```

Esperado: **2 passed**. Si `test_las_dos_canonicalizaciones_no_se_contradicen` falla, **detente y
avisa**: el resto del plan asume que la identidad es la misma en los dos lados.

**Ojo con la base**: la suite de integración toma una conexión por test contra una instancia con
`max_connections = 60`. **No la mates a mitad** — matar una corrida deja los cupos ocupados hasta que
expiran (pasó el 19/08 y dejó la base sin atender ~40 minutos).

- [ ] **Step 3: Mutar**

Cambia `<>` por `=` en el primer test. Esperado: FALLA. Restaura.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/tests/test_identidad_canonica.py
git commit -m "test(identidad): fija que las dos canonicalizaciones de RUT no se contradicen"
```

---

## Task 2: El padrón deja de ser una vista y pasa a ser un modelo dbt

**Files:**
- Create: `.mage-agent/local_sync/dbt/transporters/models/silver/int_habitual_driver_by_tractor.sql`
- Create/Modify: `.mage-agent/local_sync/dbt/transporters/models/silver/schema.yml`
- Modify: `.mage-agent/local_sync/pipelines/legacy_drivers_transporters/metadata.yaml`

**Interfaces:**
- Produces: `silver.int_habitual_driver_by_tractor` como **tabla** con las mismas columnas que la
  vista (`plate`, `tax_id`, `driver_name_raw`, `last_dispatched_on`, `dispatches`), más índices en
  `plate` y `tax_id`.
- Consumes: `bronze.raw_bd_ot` vía `source()`, y `public.canonical_plate` / `public.canonical_rut`.

- [ ] **Step 1: Leer los tres snapshots que ya leen la misma fuente**

Antes de escribir nada:

```bash
cd /Users/usuario/Desktop/projects/webcarga
cat .mage-agent/local_sync/dbt/transporters/snapshots/snapshot_silver_drivers.sql
cat .mage-agent/local_sync/dbt/transporters/snapshots/snapshot_silver_vehicles.sql
```

**Lo que hay que copiar de ellos**: el bloque `config` con `indexes` declarados, el uso de
`{{ source('bronze', 'raw_bd_ot') }}` en vez del nombre literal, y el filtro por fecha. **Lo que NO
hay que copiar**: `clean_rut` — este modelo usa `public.canonical_rut`, que es la que guarda
`public.drivers.tax_id`, y por eso el padrón puede cruzar contra la tabla operacional.

- [ ] **Step 2: Escribir el modelo**

`dbt/transporters/models/silver/int_habitual_driver_by_tractor.sql`:

```sql
{{
    config(
        materialized='table',
        schema='silver',
        indexes=[
            {'columns': ['plate'], 'unique': True},
            {'columns': ['tax_id']},
            {'columns': ['last_dispatched_on']}
        ]
    )
}}

-- Conductor habitual por tracto, conformado desde bronze.raw_bd_ot.
--
-- POR QUE ES UNA TABLA Y NO UNA VISTA. Era una vista, y derivaba 98.172 filas
-- de 78 MB en CADA consulta: dos escaneos completos, cuatro llamadas a funcion
-- por fila y tres ordenamientos. `sync_habitual_drivers()` la evaluaba dos
-- veces y tardaba 24,5 s de media (maximo 103 s), siendo la funcion mas lenta
-- por llamada de toda la base. La fuente es un Excel que se recarga cada
-- tantas semanas: recalcular en cada consulta un dato que cambia una vez al
-- mes es trabajo tirado.
--
-- ES UNA INFERENCIA, y quien la consuma DEBE cortar por `last_dispatched_on`:
-- evidencia de menos de 3 meses acierta 94,2% (673 casos); de 3 a 6 meses
-- acierta 4,0% (25 casos). Una entrada vieja no agrega una conjetura peor,
-- agrega un nombre casi seguro equivocado — y un nombre plausible se confirma
-- solo. La celda vacia HACE LA PREGUNTA; la celda mal llenada la esconde.
--
-- USA public.canonical_rut Y NO LA MACRO clean_rut A PROPOSITO. Son las dos
-- canonicalizaciones que conviven en el proyecto y difieren en una cosa:
-- `canonical_rut` valida el digito verificador y `clean_rut` no. Medido sobre
-- los 1.149 RUTs distintos del origen, `canonical_rut` rechaza 252 (204 fallan
-- modulo 11) y las dos coinciden en el 100% de los que ambas aceptan. Este
-- modelo cruza contra `public.drivers.tax_id`, que esta guardada por un CHECK
-- con `canonical_rut`: usar la otra produciria filas que no pueden matchear
-- nunca, sin decirlo.

WITH dispatches AS (
    SELECT public.canonical_plate(o.patente_camion) AS plate,
           public.canonical_rut(o.rut_chofer)       AS tax_id,
           btrim(o.chofer)                          AS driver_name_raw,
           CASE WHEN btrim(o.f_despacho) ~ '^\d{4}-\d{2}-\d{2}'
                THEN to_timestamp(btrim(o.f_despacho), 'YYYY-MM-DD HH24:MI:SS')::date
           END                                      AS dispatched_on
    FROM {{ source('bronze', 'raw_bd_ot') }} o
),

-- Las tres condiciones son la misma idea: si no se puede identificar al
-- tracto, a la persona, o cuando fue, la fila no sirve como evidencia.
valid AS (
    SELECT * FROM dispatches
    WHERE plate IS NOT NULL AND tax_id IS NOT NULL AND dispatched_on IS NOT NULL
),

-- bronze.raw_bd_ot es append-only por hash de fila y ADEMAS tiene 3.477 filas
-- duplicadas: el `WHERE NOT EXISTS` de bd_ot_master.sql compara contra el
-- destino pero no dentro del propio lote, asi que dos filas identicas en una
-- misma carga entran las dos. Sin este DISTINCT un conductor pesaria mas por
-- haberse recargado, no por haber manejado mas.
deduped AS (
    SELECT DISTINCT plate, tax_id, driver_name_raw, dispatched_on FROM valid
),

ranked AS (
    SELECT plate, tax_id, max(driver_name_raw) AS driver_name_raw,
           max(dispatched_on) AS last_dispatched_on, count(*) AS dispatches
    FROM deduped GROUP BY plate, tax_id
)

SELECT DISTINCT ON (plate)
    plate, tax_id, driver_name_raw, last_dispatched_on, dispatches
FROM ranked
-- El desempate es deliberado: manda QUIEN LO MANEJO MAS RECIENTEMENTE, y
-- recien despues quien lo manejo mas veces. Un conductor que hizo 200 viajes
-- hasta marzo no es el habitual de un tracto que otro maneja desde junio.
ORDER BY plate, last_dispatched_on DESC, dispatches DESC, tax_id
```

- [ ] **Step 3: Escribir los tests de dbt**

En `dbt/transporters/models/silver/schema.yml`:

```yaml
version: 2

models:
  - name: int_habitual_driver_by_tractor
    description: >
      Conductor habitual por tracto, desde bronze.raw_bd_ot. Es una INFERENCIA:
      quien la consuma DEBE cortar por last_dispatched_on.
    columns:
      - name: plate
        description: Patente canonica del tracto. Una fila por tracto.
        data_tests:
          - unique
          - not_null
      - name: tax_id
        description: >
          RUT canonico del conductor habitual. Sale de public.canonical_rut, la
          MISMA funcion que guarda public.drivers.tax_id — si se usara la macro
          clean_rut, habria filas que no pueden matchear nunca.
        data_tests:
          - not_null
      - name: last_dispatched_on
        data_tests:
          - not_null
```

**OJO — esto es deuda conocida del proyecto, no la reintroduzcas**: `dbt test` está escrito y
**ningún pipeline lo corre** (7 bloques `run`, 2 `snapshot`, 0 `test`). El Step 5 agrega el modelo al
DAG; si el pipeline no tiene un bloque `test`, estos tests nacen muertos. Verifícalo.

- [ ] **Step 4: Correr el modelo en Mage y comparar contra la vista**

Sincroniza y corre el pipeline. Después, la comparación que prueba que el reemplazo es fiel:

```sql
-- La tabla nueva y la vista vieja tienen que decir EXACTAMENTE lo mismo.
SELECT
    (SELECT count(*) FROM silver.int_habitual_driver_by_tractor) AS filas_tabla,
    (SELECT count(*) FROM (
        SELECT plate FROM silver.int_habitual_driver_by_tractor
        EXCEPT
        SELECT plate FROM silver.int_habitual_driver_by_tractor_vieja
    ) x) AS solo_en_la_nueva;
```

**Antes de correr esto** hay que conservar la vista con otro nombre (Step 6 la retira). Si los
conteos difieren, **detente**: la derivación cambió y este plan dice que no debe cambiar.

- [ ] **Step 5: Agregar el modelo al DAG**

En `pipelines/legacy_drivers_transporters/metadata.yaml`, colgando del bloque que carga
`raw_bd_ot`. **Lee el YAML entero antes de editarlo** y valida el DAG después: el pipeline tiene
bloques que dependen entre sí y un `upstream_blocks` mal puesto no falla, simplemente no corre.

- [ ] **Step 6: Commit**

```bash
git add .mage-agent/local_sync/dbt/transporters/models/silver/
git commit -m "feat(padron): el padron deja de recalcularse en cada consulta"
```

**Nota**: `.mage-agent/` está en `.gitignore` a propósito y **el cluster de Mage es la fuente de
verdad**. Si el `git add` no toma los archivos, no fuerces con `-f`: el respaldo es este plan y el
AGENTLOG.

---

## Task 3: La identidad de un conductor deja de construirse sobre un RUT sin validar

**Files:**
- Modify: `.mage-agent/local_sync/dbt/transporters/snapshots/snapshot_silver_drivers.sql`

**Interfaces:**
- Consumes: la evidencia de la Task 1 (las dos canonicalizaciones coinciden cuando ambas dan valor).
- Produces: `snapshot_silver_drivers` sin filas cuyo `driver_id` salga de un RUT que
  `public.drivers` no puede guardar.

**ESTA TAREA CAMBIA DATOS Y NECESITA UNA DECISIÓN DE NEGOCIO ANTES DE EJECUTARSE.**

- [ ] **Step 1: Medir a quién afecta, sin exponer datos personales**

```sql
WITH ruts AS (
  SELECT DISTINCT rut_chofer AS crudo FROM bronze.raw_bd_ot WHERE rut_chofer IS NOT NULL
)
SELECT count(*) FILTER (WHERE public.canonical_rut(crudo) IS NULL) AS invalidos,
       count(*) AS total
FROM ruts;
```

Esperado, medido el 2026-08-19: **252 de 1.149**. Y cuántos de esos tienen despachos recientes:

```sql
SELECT count(DISTINCT o.rut_chofer) AS invalidos_con_despacho_reciente
FROM bronze.raw_bd_ot o
WHERE o.rut_chofer IS NOT NULL
  AND public.canonical_rut(o.rut_chofer) IS NULL
  AND btrim(o.f_despacho) ~ '^\d{4}-\d{2}-\d{2}'
  AND to_timestamp(btrim(o.f_despacho),'YYYY-MM-DD HH24:MI:SS')::date
      >= current_date - 90;
```

**NO ESCRIBAS NINGÚN RUT NI NOMBRE en el reporte.** Son datos personales reales. Se cuenta y se
caracteriza por patrón, nunca se transcribe.

- [ ] **Step 2: LLEVAR LA DECISIÓN A NEGOCIO — no la tomes tú**

Hay 204 RUTs que fallan módulo 11. Un RUT que falla el dígito verificador es casi siempre **un
tipeo**, no una persona inexistente. Las opciones no son equivalentes:

| Opción | Qué pasa con los 252 |
|---|---|
| **A · Excluirlos del snapshot** | `silver` deja de inventar identidades. Esos conductores desaparecen del maestro hasta que alguien corrija el origen |
| **B · Conservarlos, marcados** | Siguen en `silver` con `is_valid_rut = false` y una identidad que nunca va a cruzar con `public`. Es lo que pasa hoy |
| **C · Corregirlos en el origen** | Lo único que resuelve el problema, y no lo puede hacer un pipeline |

**Este plan NO elige.** Lo que sí afirma, y hay que decírselo a negocio con estos números: hoy
`silver` tiene hasta 252 identidades de conductor que la base operacional considera inválidas, y
ninguna pantalla lo dice.

- [ ] **Step 3: Implementar la opción que negocio elija, con su test**

Si es la **A**, el cambio es una línea en `clean_source`:

```sql
    FROM {{ source('bronze', 'raw_bd_ot') }}
    WHERE rut_chofer IS NOT NULL
      AND f_despacho >= '2024-01-01'
      -- La identidad de una persona no se construye sobre un RUT que la base
      -- operacional no puede guardar: `public.drivers.tax_id` tiene un CHECK
      -- con `canonical_rut`, asi que `md5` de un RUT invalido crea un
      -- conductor en silver que nunca va a cruzar con public — y nada lo dice.
      AND public.canonical_rut(rut_chofer) IS NOT NULL
```

Y el test en `schema.yml`, que es lo que impide que vuelva:

```yaml
  - name: snapshot_silver_drivers
    columns:
      - name: dni_driver
        data_tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: "public.canonical_rut(dni_driver) IS NOT NULL"
```

Si es la **B**, no se toca el snapshot y esta tarea se cierra con el número documentado en el
AGENTLOG. Si es la **C**, este plan no la implementa.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(silver): la identidad de un conductor sale de un RUT que public puede guardar"
```

---

## Task 4: `sync_habitual_drivers()` lee una vez y produce el delta

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260820120000_padron_deltas.sql`
- Modify: `monitor-app/backend/api/tests/test_padron_conductor.py`

**Interfaces:**
- Consumes: `silver.int_habitual_driver_by_tractor` como **tabla** (Task 2).
- Produces: `public.sync_habitual_drivers(freshness_days int DEFAULT 90)` con la **misma firma y las
  mismas 5 columnas de retorno** (`opened`, `closed`, `missing_asset`, `missing_driver`,
  `skipped_as_stale`). La firma no cambia: hay tests y llamadas manuales que dependen de ella.

- [ ] **Step 1: Escribir el test que falla**

En `tests/test_padron_conductor.py`:

```python
async def test_la_siembra_lee_el_padron_una_sola_vez(conexion_revertida):
    """El `RETURN QUERY` volvia a escanear el padron para contar
    `skipped_as_stale`, o sea que la derivacion corria DOS veces por llamada.

    El test lee el cuerpo de la funcion desde el catalogo: es lo unico que
    distingue "lee una vez" de "lee dos" sin medir tiempos, y medir tiempos
    contra una base compartida da falsos rojos."""
    cuerpo = await conexion_revertida.fetchval("""
        SELECT prosrc FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'sync_habitual_drivers'
    """)
    veces = cuerpo.count("int_habitual_driver_by_tractor")
    assert veces == 1, (
        f"la funcion lee el padron {veces} veces; cada lectura es una derivacion "
        "completa de 98.172 filas"
    )


async def test_la_siembra_conserva_su_firma(conexion_revertida):
    """Hay tests y corridas manuales que dependen de las 5 columnas."""
    cols = await conexion_revertida.fetch("""
        SELECT unnest(proargnames) AS nombre FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname='public' AND p.proname='sync_habitual_drivers'
    """)
    nombres = {r["nombre"] for r in cols}
    assert {"opened", "closed", "missing_asset",
            "missing_driver", "skipped_as_stale"} <= nombres
```

- [ ] **Step 2: Correr y verificar que el primero falla**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_padron_conductor.py -q -p no:randomly -k "una_sola_vez or firma"
```

Esperado: `test_la_siembra_lee_el_padron_una_sola_vez` **FALLA** con `veces == 2`.

- [ ] **Step 3: Escribir la migración**

`../supabase/migrations/20260820120000_padron_deltas.sql`:

```sql
BEGIN;

-- El padron se lee UNA vez.
--
-- Antes: `resolved_registry` lo escaneaba, y despues el `RETURN QUERY` lo
-- volvia a escanear entero para contar `skipped_as_stale`. Con la vista, cada
-- escaneo era derivar 98.172 filas de 78 MB — dos veces por llamada, 24,5 s de
-- media y 103 s de maximo. Ahora el padron es una tabla (modelo dbt) y ademas
-- se lee una sola vez: el corte de frescura pasa a ser una COLUMNA en vez de un
-- WHERE, y las dos mitades salen del mismo escaneo.
--
-- La firma NO cambia. Hay tests y corridas manuales que dependen de las cinco
-- columnas de retorno.
CREATE OR REPLACE FUNCTION public.sync_habitual_drivers(freshness_days int DEFAULT 90)
RETURNS TABLE (opened int, closed int, missing_asset int, missing_driver int, skipped_as_stale int)
LANGUAGE plpgsql
SET search_path TO 'public', 'silver', 'pg_catalog'
AS $fn$
DECLARE v_opened int := 0; v_closed int := 0;
BEGIN
    -- ON COMMIT DROP limpia al CONFIRMAR la transaccion, no al terminar la
    -- funcion: sin este DROP, llamarla dos veces en la misma transaccion
    -- —que es lo que hace el test de idempotencia— revienta.
    DROP TABLE IF EXISTS padron_completo;
    CREATE TEMP TABLE padron_completo ON COMMIT DROP AS
    SELECT p.plate, p.tax_id, p.last_dispatched_on,
           a.id AS asset_id, d.id AS driver_id,
           -- EL CORTE DE FRESCURA, que es la decision de diseno mas importante
           -- de esta capa, ahora como columna y no como filtro: asi el conteo
           -- de descartados sale del MISMO escaneo. Medido contra julio:
           -- evidencia de menos de 3 meses acierta 94,2% (673 casos); de 3 a 6
           -- meses acierta 4,0% (25 casos). Una entrada vieja no agrega una
           -- conjetura peor, agrega un nombre casi seguro equivocado.
           (p.last_dispatched_on >= current_date - freshness_days) AS es_fresca
    FROM silver.int_habitual_driver_by_tractor p
    LEFT JOIN public.assets  a ON a.license_plate = p.plate
    LEFT JOIN public.drivers d ON d.tax_id        = p.tax_id;

    -- 1. Cerrar lo automatico desactualizado. `NOT is_manual_override` es la
    --    regla que sostiene el diseno: quien corrigio a mano sabe algo que la
    --    inferencia no.
    WITH closing AS (
        UPDATE public.vehicle_driver_assignments v
        SET status = 'INACTIVE', end_date = CURRENT_DATE
        FROM padron_completo p
        WHERE p.es_fresca
          AND v.asset_id = p.asset_id AND v.status = 'ACTIVE'
          AND NOT v.is_manual_override
          AND p.driver_id IS NOT NULL AND v.driver_id IS DISTINCT FROM p.driver_id
        RETURNING 1
    ) SELECT count(*) INTO v_closed FROM closing;

    -- 2. Abrir la vigente. ON CONFLICT reactiva un par que ya existia
    --    inactivo: un conductor que volvio al mismo tracto no necesita fila
    --    nueva.
    WITH opening AS (
        INSERT INTO public.vehicle_driver_assignments
            (asset_id, driver_id, status, start_date,
             is_manual_override, source, source_confirmed_at)
        SELECT p.asset_id, p.driver_id, 'ACTIVE', CURRENT_DATE,
               false, 'padron_legacy', p.last_dispatched_on
        FROM padron_completo p
        WHERE p.es_fresca
          AND p.asset_id IS NOT NULL AND p.driver_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.vehicle_driver_assignments v
                          WHERE v.asset_id = p.asset_id AND v.status = 'ACTIVE'
                            AND v.is_manual_override)
        ON CONFLICT (asset_id, driver_id) DO UPDATE
            SET status = 'ACTIVE', end_date = NULL, source = 'padron_legacy',
                source_confirmed_at = EXCLUDED.source_confirmed_at
            WHERE NOT public.vehicle_driver_assignments.is_manual_override
        RETURNING 1
    ) SELECT count(*) INTO v_opened FROM opening;

    -- Los tres conteos salen de la temp table, no de volver al padron.
    -- `missing_asset` y `missing_driver` cuentan SOLO lo fresco, que es lo que
    -- de verdad se intento sembrar: contarlos sobre el padron entero mezclaba
    -- "no lo encontramos" con "ni lo intentamos".
    RETURN QUERY SELECT v_opened, v_closed,
        (SELECT count(*)::int FROM padron_completo WHERE es_fresca AND asset_id IS NULL),
        (SELECT count(*)::int FROM padron_completo WHERE es_fresca AND driver_id IS NULL),
        (SELECT count(*)::int FROM padron_completo WHERE NOT es_fresca);
END;
$fn$;

COMMENT ON FUNCTION public.sync_habitual_drivers(int) IS
    'Siembra public.vehicle_driver_assignments desde '
    'silver.int_habitual_driver_by_tractor (tabla, modelo dbt). DELIBERADA, no '
    'automatica. Idempotente. NUNCA pisa is_manual_override = true. Lee el '
    'padron UNA vez.';

COMMIT;
```

**OJO, y es un cambio de comportamiento que hay que verificar en el Step 5**: antes
`missing_asset`/`missing_driver` se contaban sobre el padrón **ya filtrado por frescura**, así que el
resultado debería ser el mismo. Pero `skipped_as_stale` antes salía de un `SELECT` aparte sobre la
vista, y ahora sale de la temp table. **Los cinco números tienen que dar igual.**

- [ ] **Step 4: Aplicar la migración y correr los tests**

```bash
venv/bin/python -m pytest tests/test_padron_conductor.py -q -p no:randomly
```

Esperado: todos verdes, incluido `test_la_siembra_lee_el_padron_una_sola_vez`.

- [ ] **Step 5: Verificar que los cinco números no cambiaron**

Contra la base real, dentro de una transacción que se revierte:

```sql
BEGIN;
SELECT * FROM public.sync_habitual_drivers(90);
ROLLBACK;
```

Esperado, comparado con la primera corrida documentada (2026-08-17): `opened=46, closed=0,
missing_asset=3, missing_driver=10, skipped_as_stale=419`. **Los números pueden haber cambiado
porque el padrón cambió**, así que lo que hay que comparar es contra una corrida de la función VIEJA
del mismo día, no contra esos valores históricos. Si difieren, entender por qué antes de seguir.

- [ ] **Step 6: Medir la mejora**

```sql
EXPLAIN (ANALYZE, TIMING) SELECT * FROM silver.int_habitual_driver_by_tractor;
```

Esperado: milisegundos, contra los ~12 s de la vista. La función completa debería bajar de 24,5 s a
menos de 1 s.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260820120000_padron_deltas.sql \
        monitor-app/backend/api/tests/test_padron_conductor.py
git commit -m "perf(padron): la siembra lee el padron una vez, no dos"
```

---

## Task 5: Retirar la vista, y dejar escrito que BD OT no se consulta

**Files:**
- Modify: `monitor-app/backend/supabase/migrations/20260820120000_padron_deltas.sql` (o una nueva)
- Modify: `monitor-app/backend/api/tests/test_padron_conductor.py`
- Create: `monitor-app/backend/api/tests/test_bronze_no_se_consulta.py`

**Interfaces:**
- Produces: un test que falla si alguien vuelve a consultar `bronze.*` desde el código de la API.

- [ ] **Step 1: Escribir el trinquete**

Es lo que hace que este trabajo no se deshaga solo. En `tests/test_bronze_no_se_consulta.py`:

```python
"""bronze es un padron, no un feed — y esto lo hace cumplir.

`bronze.raw_bd_ot` es el Excel legacy de Finanzas. La arquitectura ya lo
declaro bootstrap de una sola vez (ver el docstring de
POST /assets/{id}/driver-assignment), y el AGENTLOG lo llama "padron, no
feed". Lo que faltaba era algo que lo hiciera cierto: sin este test, la
proxima consulta directa a bronze desde la API entra sin que nada lo note, y
el dia que se apague el Excel se rompe una pantalla.

El destino correcto de esos datos es `public` — vehiculos, conductores y
empresas ya viven ahi, alimentados por los snapshots de dbt.
"""
import pathlib
import re

APP = pathlib.Path(__file__).parent.parent / "app"

# El tope baja a 0 cuando se limpie la ultima referencia. Solo puede bajar.
REFERENCIAS_CONOCIDAS = 1


def test_la_api_no_consulta_bronze():
    culpables = []
    for archivo in sorted(APP.rglob("*.py")):
        for n, linea in enumerate(archivo.read_text().splitlines(), 1):
            # Solo SQL, no comentarios: el docstring de assets.py MENCIONA
            # bronze para explicar por que ya no depende de el, y esa mencion
            # es documentacion valiosa, no deuda.
            sin_comentario = linea.split("#")[0]
            if re.search(r"\bbronze\.\w+", sin_comentario):
                culpables.append(f"{archivo.relative_to(APP)}:{n}")
    assert len(culpables) <= REFERENCIAS_CONOCIDAS, (
        "la API consulta bronze directamente en: " + ", ".join(culpables)
        + ". bronze es un padron: lo que la API necesita vive en public."
    )
```

- [ ] **Step 2: Correr y ver el número real**

```bash
venv/bin/python -m pytest tests/test_bronze_no_se_consulta.py -q
```

Si falla, **ajusta `REFERENCIAS_CONOCIDAS` al número que salga y anótalo** — el tope congela lo que
hay, no lo aprueba. Si es 0, cambia la aserción a `== 0`.

- [ ] **Step 3: Retirar la vista**

Sólo **después** de que la Task 4 esté verificada:

```sql
-- La reemplaza el modelo dbt del mismo nombre, materializado como tabla.
-- Se dropea DESPUES de verificar que la tabla dice lo mismo (Task 2, Step 4),
-- no antes: mientras la vista y la tabla comparten nombre, dbt no puede crear
-- la tabla.
DROP VIEW IF EXISTS silver.int_habitual_driver_by_tractor;
```

**Orden obligatorio**: dbt no puede materializar una tabla con el nombre de una vista existente.
Renombra la vista (`..._vieja`) en la Task 2, compara, y recién acá la borras.

- [ ] **Step 4: Correr las dos suites completas**

```bash
venv/bin/python -m pytest tests/ -q -m "not integracion"     # ~25 s
venv/bin/python -m pytest tests/ -q -m integracion           # lento, no la mates
```

**No corras las dos a la vez y no mates ninguna a mitad.** Cada test de integración toma una
conexión contra una base con `max_connections = 60`; matar una corrida deja los cupos ocupados hasta
que expiran.

- [ ] **Step 5: Commit y AGENTLOG**

```bash
git add monitor-app/backend/api/tests/test_bronze_no_se_consulta.py \
        monitor-app/backend/supabase/migrations/
git commit -m "refactor(bronze): BD OT deja de consultarse, y un test lo sostiene"
```

Y actualizar `AGENTLOG.md` según la regla del proyecto: qué se hizo, siguiente paso exacto,
decisiones de arquitectura.

---

## Task 6: Lo que este trabajo deja huérfano, se borra

No es una tarea de limpieza genérica: es cerrar lo que las Tasks 2 a 5 dejan sin consumidores. Una
pieza sin llamadores **no es inofensiva** — la encuentra el próximo por búsqueda, la usa, y
reintroduce el defecto que se acaba de arreglar. Dejarla viva con un comentario que diga "no la uses"
es una trampa cargada, no documentación.

**Files:**
- Test: `monitor-app/backend/api/tests/test_padron_sin_huerfanos.py` (crear)

- [ ] **Step 1: Enumerar lo que quedó sin lectores, con `grep` y no de memoria**

```bash
cd /Users/usuario/Desktop/projects/webcarga
for s in int_habitual_driver_by_tractor resolved_registry padron_completo; do
  echo "--- $s"
  grep -rn "$s" monitor-app .mage-agent --include="*.py" --include="*.sql" --include="*.ts"     2>/dev/null | grep -v node_modules | grep -v pycache
done
```

**El grep va en el mensaje del commit.** "Verifiqué que no lo usa nadie" sin la evidencia es una
afirmación; con el grep es un hecho que el siguiente puede repetir.

- [ ] **Step 2: Escribir el trinquete de la temp table renombrada**

`resolved_registry` pasa a llamarse `padron_completo` en la Task 4. Si quedara una referencia al
nombre viejo en algún lado, no falla: la temp table simplemente no existe y el `SELECT` revienta en
tiempo de ejecución, dentro de una función que corre una vez al día.

```python
"""Nada apunta a los nombres que este refactor dejó atrás."""
import pathlib
import re

RAIZ = pathlib.Path(__file__).parent.parent.parent.parent   # monitor-app/

# `resolved_registry` era la temp table de la version vieja de
# sync_habitual_drivers. Se renombro a `padron_completo` al dejar de filtrar
# por frescura en el WHERE. Una referencia al nombre viejo no falla al
# desplegar: falla en tiempo de ejecucion, una vez al dia, dentro de una
# funcion que casi nadie mira.
MUERTOS = ["resolved_registry"]


def test_ningun_nombre_muerto_sigue_referenciado():
    culpables = []
    for archivo in RAIZ.rglob("*.sql"):
        if "node_modules" in str(archivo):
            continue
        texto = archivo.read_text()
        for muerto in MUERTOS:
            # La migracion que lo CREO sigue en el historial y no se toca: las
            # migraciones son inmutables. Solo importan las vigentes.
            if muerto in texto and "20260817120100" not in archivo.name:
                culpables.append(f"{archivo.name} → {muerto}")
    assert not culpables, "referencias a nombres retirados: " + ", ".join(culpables)
```

- [ ] **Step 3: Borrar la vista** (ya cubierto por la Task 5, Step 3 — no lo repitas acá)

- [ ] **Step 4: Correr y commitear**

```bash
venv/bin/python -m pytest tests/test_padron_sin_huerfanos.py -q
git add monitor-app/backend/api/tests/test_padron_sin_huerfanos.py
git commit -m "chore(padron): lo que el refactor dejo huerfano queda borrado y trincado"
```

---

## Fuera de alcance, y hay que decirlo

- **Apagar la carga del Excel.** Eso lo decide negocio cuando Certificación centralice el dato. Este
  plan deja el sistema listo para que apagarlo no rompa nada, no lo apaga.
- **Corregir los 252 RUTs inválidos en el origen.** Es trabajo de quien mantiene el Excel.
- **Las 25 horas de introspección de PostgREST**, que son el consumidor real de la base (25× más que
  todo esto junto). Hipótesis a verificar: el DDL de dbt en cada corrida dispara la recarga del caché
  de esquema. Es otro workstream y tiene su propio tamaño.
- **Los tres snapshots de vehículos, conductores y ramplas.** Ya siguen el patrón correcto; sólo la
  Task 3 toca uno, y sólo en la línea de la identidad.
- **Que `dbt test` no lo corra ningún pipeline.** Se nombra en la Task 2 porque afecta a los tests
  que esa tarea escribe, pero arreglarlo para los 14 tests existentes es trabajo aparte.

---

## Verificación de punta a punta

1. **Los cinco números de `sync_habitual_drivers()` no cambian** entre la versión vieja y la nueva,
   comparados el mismo día contra el mismo padrón.
2. **La tabla dice exactamente lo mismo que la vista**: mismo conteo de filas, mismas patentes.
3. **La función baja de 24,5 s a menos de 1 s**, medido con `EXPLAIN (ANALYZE)`.
4. **`is_manual_override = true` sigue intacto**: ninguna fila manual cambió. Es el invariante duro.
5. **Ningún RUT ni nombre real** quedó escrito en un reporte, un log o un mensaje de commit.
6. **Backend**: `pytest -q -m "not integracion"` y `pytest -q -m integracion`, por separado.
