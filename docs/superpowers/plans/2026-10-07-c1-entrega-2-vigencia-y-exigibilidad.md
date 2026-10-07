# HU-C1, entrega 2 (cimientos): vigencia por tipo de documento — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la base sepa calcular, para cada documento, **cuándo vence, desde cuándo avisa y desde cuándo
se exige**, con los cuatro tipos de vigencia de la HU-C1. Las mismas pantallas de hoy pasan a leer ese cálculo
sin cambiar de forma.

**Architecture:**
- **Esquema** (expand, sin migrar datos):
  - `expiration_policy` gana dos valores: `ISSUE_PLUS_MONTHS` y `CALENDAR_PERIOD`;
  - los parámetros viven en una tabla nueva, `compliance_requirement_rules`. La regla base es la fila sin
    cliente, y una fila con cliente es su variante;
  - `compliance_requirements.exigible_on` dice desde cuándo se exige el documento;
  - el registro guarda `issue_date` y `period_start`.
- **El cálculo** va en funciones SQL `STABLE`, una por concepto, igual que
  `public.carrier_management_types()`, la única definición del tipo de gestión:
  - `public.hoy_chile()`
  - `public.documento_vence_el(...)`
  - `public.documento_aviso_desde(...)`
  - `public.documento_exigible(...)`
- **Los predicados** de `app/services/vencimientos.py` siguen siendo la única puerta desde Python y conservan su
  firma `predicado(alias)`. Por dentro, llaman a esas funciones.
  - Los llamadores no cambian.
  - Sí cambian las CTE que alimentan a un predicado: deben proyectar las columnas que el predicado lee.

**Tech Stack:** FastAPI + asyncpg (pytest, `monitor-app/backend/api/venv`), Postgres 17 en Supabase (proyecto
`webcarga-core-db`, id `viclzoftiudkepqnhekv`).

**Spec:**
- `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md`, HU-C1, "Diseño" y criterios de
  aceptación;
- `~/.claude/plans/swift-floating-pancake.md`, el plan aprobado el 07/10, fases F0-F2;
- fuente de negocio: `monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx`.

## Alcance de este plan y de los siguientes

Este plan cubre **F0-F2**: la base y el cálculo. Al terminarlo, ningún documento cambia de tipo, porque el
catálogo sigue con REQUIRED, OPTIONAL y NONE. Por eso lo único que cambia en pantalla es:
- el corte del día en hora de Chile;
- los 10 documentos NONE con fecha del gate de Task 5.

Los siguientes planes se escriben sobre las interfaces de este:
- **F3**: siembra según `exigible_on` (`ON_REQUEST` no se siembra) y "Solicitar documento".
- **F4**: `campos_que_pide(politica)` en la carga, la clasificación y la planilla.
- **F5**: el selector con los 4 tipos, sus parámetros y "Ventanas por cliente". Incluye el contract de las filas
  por documento de `app.alert_thresholds`.
- **F6**: el mapeo de los 96 tipos para que WebCarga lo apruebe, y el script de carga.
- **Task 7b de la entrega 1** (`DROP has_expiration`): sigue esperando la confirmación del usuario. No va aquí.

## Por qué (lo medido el 07/10)

- `CURRENT_DATE` se evalúa en **UTC**: el `TimeZone` de la base es `UTC` y `db.py` no lo fija. Entre las 21:00 y
  las 24:00 de Chile, "vencido" se adelanta un día. Con cortes por día (F30 día 5, F30-1 día 18) eso deja de ser
  un detalle.
- `plantilla_certificacion.py:151` tiene **una copia escrita a mano** de "vencido": `r.expiration_date <
  CURRENT_DATE`.
- `compliance_records` no tiene fecha de emisión ni período. `compliance_requirements` no tiene frecuencia, corte,
  plazo, aviso ni gracia. "Por vencer" es la constante `DIAS_POR_VENCER = 30`.
- `app.alert_thresholds` tiene 8 filas por documento, con claves viejas (`license_expiry`, `soap`…) que no se
  ligan a ningún requisito, y todas en 30. Las leen `config.py:215`, `trips.py:1137` y `revisiones.py:70`, pero
  no los predicados.
- **Hay 12 registros vigentes de requisitos NONE con fecha**, todos `APPROVED_MANUAL`; 10 de ellos hoy figuran
  vencidos:

  | Requisito | Registros |
  | :--- | ---: |
  | REGLAMENTO_INTERNO | 3 |
  | ENTREGA_EPP | 2 |
  | CONTRATO_TRABAJO | 2 |
  | CONTRATO_WEBCARGA | 1 |
  | ANEXO_GC_CONDUCTOR | 1 |
  | ROLL_SII | 1 |
  | CAPACITACION_EPP | 1 |
  | PLAN_EMERGENCIA | 1 |

  Con la política como única fuente, un NONE no vence. Ver el gate de Task 5.
- `carrier_shippers` tiene 47 vínculos, todos `ACTIVE`. No hay conductores con dos asignaciones activas (0).

## Global Constraints

- **Nada de parches** (decisión del usuario, 07/10):
  - sin `if code == …`;
  - sin columnas espejo;
  - sin constantes duplicadas;
  - sin `try/except` que esconda un error;
  - sin flags temporales.
  Una regla vive en un lugar.
- **"Hoy" es `public.hoy_chile()`** en todo SQL nuevo o tocado. `CURRENT_DATE` no aparece en
  `vencimientos.py` ni en las funciones nuevas.
- **La política (`expiration_policy`) es la única fuente** de cómo vence un documento. Una fecha guardada en un
  documento NONE no lo hace vencer.
- **Las migraciones son la fuente de verdad**: `monitor-app/backend/supabase/migrations/`. Se aplican con
  `mcp__claude_ai_Supabase__execute_sql`.
  - Primero se ensayan dentro de `BEGIN; … ROLLBACK;`, después se aplican con `BEGIN; … COMMIT;`.
  - No se usa `psql -f`, porque el clasificador lo bloquea con razón.
  - `list_migrations` no es fuente de verdad.
- **No se despliega con un job de ingesta en vuelo.** Las migraciones son expand: solo agregan, y la API de
  `main` (`webcarga-monitor-api`) lee la misma base.
- **Tests del backend**: `cd monitor-app/backend/api && venv/bin/python -m pytest …`.
  - Los marcados `integracion` usan `conexion_revertida` contra la base real, siempre revertida.
  - Los datos los crea el test, con prefijo sintético.
  - Las funciones nuevas se cargan **desde el archivo de migración** dentro de la transacción revertida, como en
    `tests/test_matcher_ficha_activa.py:27-30`. Así el test prueba el SQL que se va a desplegar.
- **SQL verificado con parámetros reales**, no solo con `AsyncMock`.
- **Español neutral** en comentarios, mensajes y textos; nunca voseo.

## Review Focus

1. **Un mensual sin período cargado.** Un F30-1 marcado aprobado pero sin `period_start` no cubre ningún período:
   tiene que contar como **vencido**, no como al día. `documento_vence_el` devuelve `-infinity`. Si el registro
   está `MISSING`, devuelve NULL y queda en "falta". Lo cubre Task 3.
2. **Corte el día 31 en un mes corto.** Un corte 31 en febrero vence el último día de febrero; no puede dar error
   ni saltar a marzo. Lo cubre Task 3.
3. **Una empresa sin clientes.** Rige la regla base. Una empresa con dos clientes, uno con variante y otro sin
   ella, se evalúa contra la variante **y** la base, y gana la peor. Lo cubre Task 3.
4. **Medianoche en Chile.** A las 22:00 de Chile del día del corte, el documento todavía no está vencido. Lo cubre
   Task 1, comparando `hoy_chile()` bajo dos `TimeZone` de sesión.
5. **El costo de leer.** `/compliance/status` evalúa varios predicados por registro, y ahora cada uno es una
   llamada a una función. Se mide el tiempo antes y después con `EXPLAIN ANALYZE`. Lo cubre Task 5, con un umbral
   explícito.

---

### Task 1: "Hoy" es el día de Chile, en un solo lugar

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261008100000_hoy_chile.sql`
- Modify: `monitor-app/backend/api/app/services/vencimientos.py:21-42`
- Modify: `monitor-app/backend/api/app/services/plantilla_certificacion.py:151`
- Modify (solo comentarios): `monitor-app/backend/api/app/routers/requirements.py:120-124` y el comentario del
  campo `requirement_level` en `monitor-app/backend/api/app/schemas/requirement.py`
- Test: `monitor-app/backend/api/tests/test_vencimientos.py`
- Test (create): `monitor-app/backend/api/tests/test_hoy_chile.py`

**Interfaces:**
- Produces: la función SQL `public.hoy_chile() RETURNS date` y la función Python
  `hoy_sql() -> str`, que devuelve `"public.hoy_chile()"`, en `app.services.vencimientos`.

- [ ] **Step 1: Write the failing tests.** En `tests/test_vencimientos.py`:

  1. En `test_por_vencer_excluye_lo_ya_vencido`, cambiar las dos aserciones:

     ```python
         assert ">= public.hoy_chile()" in sql
         assert "<= public.hoy_chile()" in sql
     ```

  2. Agregar la guarda de la copia a mano y de UTC:

     ```python
     APP = pathlib.Path(__file__).parent.parent / "app"


     def test_nadie_compara_expiration_date_a_mano():
         """`plantilla_certificacion.py` tenía su propia copia de "vencido". Una
         segunda copia es como el embudo y el cajón ya divergieron una vez."""
         culpables = []
         for archivo in sorted(APP.rglob("*.py")):
             if archivo.name == "vencimientos.py":
                 continue
             for n, linea in enumerate(archivo.read_text().splitlines(), 1):
                 if re.search(r"expiration_date\s*<", linea):
                     culpables.append(f"{archivo.relative_to(APP)}:{n}")
         assert not culpables, "Usa vencido_predicate: " + ", ".join(culpables)


     def test_vencimientos_no_usa_el_dia_utc():
         """CURRENT_DATE es el día UTC: entre las 21 y las 24 de Chile adelanta
         un vencimiento. Todo corte se compara con public.hoy_chile()."""
         from app.services import vencimientos as v
         for sql in (v.por_vencer_predicate("cr"), v.vencido_predicate("cr"),
                     v.pendiente_predicate("cr")):
             assert "CURRENT_DATE" not in sql
             assert "public.hoy_chile()" in sql
     ```

  3. Crear `tests/test_hoy_chile.py`:

     ```python
     """`public.hoy_chile()` es el día calendario de Chile, sin importar el
     TimeZone de la sesión. La base corre en UTC (medido el 07/10): con
     CURRENT_DATE, un documento que vence hoy figuraba vencido desde las 21:00
     de Chile."""
     import re
     from pathlib import Path

     import pytest

     pytestmark = pytest.mark.integracion

     MIGRACION = (
         Path(__file__).resolve().parents[2]
         / "supabase/migrations/20261008100000_hoy_chile.sql"
     )


     async def _cargar(conn) -> None:
         sql = MIGRACION.read_text()
         funcion = re.search(r"CREATE OR REPLACE FUNCTION.*?\$\$;", sql, re.S).group(0)
         await conn.execute(funcion)


     async def test_hoy_chile_no_depende_del_timezone_de_la_sesion(conexion_revertida):
         await _cargar(conexion_revertida)
         dias = set()
         for tz in ("UTC", "Asia/Tokyo", "America/Santiago"):
             await conexion_revertida.execute(f"SET LOCAL TimeZone = '{tz}'")
             dias.add(await conexion_revertida.fetchval("SELECT public.hoy_chile()"))
         assert len(dias) == 1


     async def test_hoy_chile_es_el_dia_de_santiago(conexion_revertida):
         await _cargar(conexion_revertida)
         esperado = await conexion_revertida.fetchval(
             "SELECT (now() AT TIME ZONE 'America/Santiago')::date"
         )
         assert await conexion_revertida.fetchval("SELECT public.hoy_chile()") == esperado
     ```

- [ ] **Step 2: Run the tests and verify they fail.**

  Run: `venv/bin/python -m pytest tests/test_vencimientos.py tests/test_hoy_chile.py -v`

  Expected:
  - las aserciones de `hoy_chile()` fallan (el predicado todavía dice `CURRENT_DATE`);
  - `test_nadie_compara_expiration_date_a_mano` falla con `services/plantilla_certificacion.py:151`;
  - `test_hoy_chile.py` falla porque el archivo de migración no existe.

- [ ] **Step 3: Write the migration** `20261008100000_hoy_chile.sql`:

  ```sql
  -- HU-C1, entrega 2 (F0): "hoy" es el día calendario de Chile, en UN lugar.
  --
  -- La base corre con TimeZone = UTC (medido el 07/10) y la API no lo fija en
  -- la conexión (app/db.py). CURRENT_DATE es entonces el día UTC: desde las
  -- 21:00 de Chile ya es "mañana", y un documento que vence hoy figura vencido
  -- tres horas antes. Con cortes por día (F30 el 5, F30-1 el 18) se vuelve
  -- visible. now() es un instante absoluto, así que la conversión no depende
  -- del TimeZone de la sesión.
  --
  -- STABLE: dentro de una sentencia devuelve siempre lo mismo, como now().

  CREATE OR REPLACE FUNCTION public.hoy_chile()
  RETURNS date
  LANGUAGE sql
  STABLE
  AS $$
    SELECT (now() AT TIME ZONE 'America/Santiago')::date
  $$;

  COMMENT ON FUNCTION public.hoy_chile() IS
    'Día calendario de Chile. Única definición de "hoy" para vencimientos (app/services/vencimientos.py).';
  ```

- [ ] **Step 4: Implement in `vencimientos.py`.** Agregar arriba de `por_vencer_predicate`:

  ```python
  def hoy_sql() -> str:
      """El día de hoy en Chile. La base corre en UTC: CURRENT_DATE adelanta un
      día desde las 21:00. La definición vive en la función de la migración
      20261008100000; acá solo se la nombra."""
      return "public.hoy_chile()"
  ```

  En `por_vencer_predicate` y en `vencido_predicate`, reemplazar cada `CURRENT_DATE` por `{hoy_sql()}`. Por ejemplo:
  `f"AND {alias}.expiration_date >= {hoy_sql()} "`. `DIAS_POR_VENCER` sigue intacta en esta task.

- [ ] **Step 5: Retire the hand-written copy.** En `plantilla_certificacion.py`, agregar el import
  `vencido_predicate` desde `app.services.vencimientos` (el archivo ya importa `lleva_fecha_sql` de ahí) y reemplazar
  la línea 151:

  ```python
             WHEN {vencido_predicate("r")} THEN 'Vencido'
  ```

  El f-string ya existe; las llaves dobles no hacen falta.

- [ ] **Step 6: Fix the false comments.**
  - En `requirements.py:120-124` y en `schemas/requirement.py` (campo `requirement_level`), reemplazar "solo
    siembra LEGAL_MANDATORY" por lo que es cierto desde `20260816010000_reconcile_reads_conditions.sql`: *la
    siembra la deciden `is_active` y las condiciones `applies_to_*`; el nivel no la limita*.
  - Antes de escribirlo, leer esa migración para citar bien.

- [ ] **Step 7: Run the tests and verify they pass.**

  Run: `venv/bin/python -m pytest tests/test_vencimientos.py tests/test_hoy_chile.py tests/test_un_solo_criterio_de_pendiente.py -v`

  Expected: PASS.

- [ ] **Step 8: Apply the migration** con `mcp__claude_ai_Supabase__execute_sql`.
  - Ensayo: `BEGIN;` + el archivo + `SELECT public.hoy_chile();` + `ROLLBACK;`.
  - Aplicación: `BEGIN;` + el archivo + `COMMIT;`.
  - Verificar con `SELECT public.hoy_chile();`.
  - **Tiene que aplicarse antes de desplegar el código**, porque los predicados la llaman.

- [ ] **Step 9: Run the full backend suite**, con integración.

  Run: `venv/bin/python -m pytest -q`

  Expected: todo en verde (la base de comparación es 1.089 en la entrega 1, más los nuevos).

- [ ] **Step 10: Commit.**

  ```bash
  git add monitor-app/backend/supabase/migrations/20261008100000_hoy_chile.sql \
          monitor-app/backend/api/app/services/vencimientos.py \
          monitor-app/backend/api/app/services/plantilla_certificacion.py \
          monitor-app/backend/api/app/routers/requirements.py \
          monitor-app/backend/api/app/schemas/requirement.py \
          monitor-app/backend/api/tests/test_vencimientos.py \
          monitor-app/backend/api/tests/test_hoy_chile.py
  git commit -m "fix(certificacion): hoy es el dia de Chile y la planilla usa vencido_predicate (HU-C1 F0)"
  ```

---

### Task 2: Esquema de la vigencia (expand, sin migrar datos)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261008110000_vigencia_esquema.sql`
- Test (create): `monitor-app/backend/api/tests/test_vigencia_esquema.py`

**Interfaces:**
- Produces:
  - `public.compliance_requirements.expiration_policy` admite `NONE | REQUIRED | OPTIONAL | ISSUE_PLUS_MONTHS |
    CALENDAR_PERIOD`.
  - `public.compliance_requirements.exigible_on text NOT NULL DEFAULT 'ON_ENTITY_START'`, con valores
    `ON_ENTITY_START | MONTH_AFTER_START | ON_ENTITY_END | ON_REQUEST`.
  - `public.compliance_records.issue_date date` y `public.compliance_records.period_start date`. Este último
    exige día 1.
  - La tabla `public.compliance_requirement_rules`: `id`, `requirement_id`, `shipper_id`, `vigente_desde`,
    `validity_months`, `frequency_months`, `cutoff_day`, `period_offset_months`, `warning_days`, `grace_days`,
    `created_at`.
  - La fila `app.alert_thresholds` con `doc_type = 'documento_por_vencer'` (`warning_days = 30`), que es el aviso
    general.

- [ ] **Step 1: Write the failing test** `tests/test_vigencia_esquema.py`. Corre contra el esquema **aplicado**,
  igual que `test_has_expiration_generada.py`.

  ```python
  """El esquema de la vigencia (HU-C1, entrega 2). Lo que se prueba es lo que
  Postgres hace cumplir, no lo que la API promete: una regla incoherente con la
  política no puede quedar guardada, venga de donde venga la escritura."""
  from uuid import uuid4

  import asyncpg
  import pytest

  pytestmark = pytest.mark.integracion


  async def _requisito(conn, politica: str, *, exigible_on: str | None = None,
                       entidad: str = "CARRIER") -> str:
      suf = uuid4().hex[:8].upper()
      return await conn.fetchval(
          """
          INSERT INTO public.compliance_requirements
              (requirement_code, name, target_entity, requirement_level,
               expiration_policy, exigible_on, is_active)
          VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4,
                  COALESCE($5, 'ON_ENTITY_START'), false)
          RETURNING id
          """,
          f"ZZ_TEST_VIG_{suf}", f"ZZ-TEST-VIG {suf}", entidad, politica, exigible_on,
      )


  async def _regla(conn, requisito, **params) -> None:
      columnas = ["requirement_id", *params]
      marcas = ", ".join(f"${i}" for i in range(1, len(columnas) + 1))
      await conn.execute(
          f"INSERT INTO public.compliance_requirement_rules ({', '.join(columnas)}) "
          f"VALUES ({marcas})",
          requisito, *params.values(),
      )


  async def _falla_al_confirmar(conn, coro_factory) -> None:
      """Las reglas de coherencia son CONSTRAINT TRIGGER diferidos: fallan al
      cerrar la transacción, no en el INSERT. Por eso cada caso va en su
      propio savepoint, y se fuerza el chequeo con SET CONSTRAINTS ALL IMMEDIATE."""
      with pytest.raises(asyncpg.PostgresError):
          async with conn.transaction():
              await coro_factory()
              await conn.execute("SET CONSTRAINTS ALL IMMEDIATE")


  async def test_los_tipos_nuevos_entran_y_uno_inventado_no(conexion_revertida):
      for politica in ("ISSUE_PLUS_MONTHS", "CALENDAR_PERIOD"):
          requisito = await _requisito(conexion_revertida, politica)
          if politica == "ISSUE_PLUS_MONTHS":
              await _regla(conexion_revertida, requisito, validity_months=12)
          else:
              await _regla(conexion_revertida, requisito, frequency_months=1,
                           cutoff_day=18, period_offset_months=1)
          await conexion_revertida.execute("SET CONSTRAINTS ALL IMMEDIATE")
      with pytest.raises(asyncpg.PostgresError):
          async with conexion_revertida.transaction():
              await _requisito(conexion_revertida, "SEMANAL")


  async def test_un_plazo_desde_la_emision_exige_sus_meses(conexion_revertida):
      async def caso():
          requisito = await _requisito(conexion_revertida, "ISSUE_PLUS_MONTHS")
          await _regla(conexion_revertida, requisito, warning_days=10)
      await _falla_al_confirmar(conexion_revertida, caso)


  async def test_un_periodo_de_calendario_exige_frecuencia_y_corte(conexion_revertida):
      async def caso():
          requisito = await _requisito(conexion_revertida, "CALENDAR_PERIOD")
          await _regla(conexion_revertida, requisito, frequency_months=1)
      await _falla_al_confirmar(conexion_revertida, caso)


  async def test_un_tipo_con_parametros_no_existe_sin_regla_base(conexion_revertida):
      async def caso():
          await _requisito(conexion_revertida, "CALENDAR_PERIOD")
      await _falla_al_confirmar(conexion_revertida, caso)


  async def test_cambiar_la_politica_sin_sus_parametros_no_se_guarda(conexion_revertida):
      requisito = await _requisito(conexion_revertida, "REQUIRED")
      await conexion_revertida.execute("SET CONSTRAINTS ALL IMMEDIATE")

      async def caso():
          await conexion_revertida.execute(
              "UPDATE public.compliance_requirements SET expiration_policy = 'ISSUE_PLUS_MONTHS' "
              "WHERE id = $1", requisito,
          )
      await _falla_al_confirmar(conexion_revertida, caso)


  async def test_los_tipos_de_fecha_y_no_vence_no_necesitan_regla(conexion_revertida):
      for politica in ("NONE", "REQUIRED", "OPTIONAL"):
          await _requisito(conexion_revertida, politica)
      await conexion_revertida.execute("SET CONSTRAINTS ALL IMMEDIATE")


  async def test_una_regla_base_por_version(conexion_revertida):
      requisito = await _requisito(conexion_revertida, "REQUIRED")
      await _regla(conexion_revertida, requisito, warning_days=10)
      with pytest.raises(asyncpg.UniqueViolationError):
          async with conexion_revertida.transaction():
              await _regla(conexion_revertida, requisito, warning_days=20)


  async def test_el_corte_va_del_1_al_31(conexion_revertida):
      requisito = await _requisito(conexion_revertida, "REQUIRED")
      with pytest.raises(asyncpg.CheckViolationError):
          async with conexion_revertida.transaction():
              await _regla(conexion_revertida, requisito, cutoff_day=32)


  async def test_el_periodo_cubierto_empieza_el_dia_1(conexion_revertida):
      registro = await conexion_revertida.fetchval(
          "SELECT id FROM public.compliance_records WHERE is_current LIMIT 1"
      )
      with pytest.raises(asyncpg.CheckViolationError):
          async with conexion_revertida.transaction():
              await conexion_revertida.execute(
                  "UPDATE public.compliance_records SET period_start = DATE '2026-09-15' "
                  "WHERE id = $1", registro,
              )


  async def test_mes_siguiente_y_termino_son_solo_de_conductor(conexion_revertida):
      for exigible_on in ("MONTH_AFTER_START", "ON_ENTITY_END"):
          with pytest.raises(asyncpg.CheckViolationError):
              async with conexion_revertida.transaction():
                  await _requisito(conexion_revertida, "NONE", exigible_on=exigible_on,
                                   entidad="CARRIER")
          await _requisito(conexion_revertida, "NONE", exigible_on=exigible_on, entidad="DRIVER")


  async def test_existe_el_aviso_general(conexion_revertida):
      dias = await conexion_revertida.fetchval(
          "SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'documento_por_vencer'"
      )
      assert dias == 30
  ```

- [ ] **Step 2: Run the test and verify it fails.**

  Run: `venv/bin/python -m pytest tests/test_vigencia_esquema.py -v`

  Expected: FAIL. `ISSUE_PLUS_MONTHS` viola el CHECK actual, y `exigible_on` y `compliance_requirement_rules` no
  existen.

- [ ] **Step 3: Write the migration** `20261008110000_vigencia_esquema.sql`:

  ```sql
  -- HU-C1, entrega 2 (F1): esquema de la vigencia por tipo de documento.
  --
  -- Fuente: la planilla de WebCarga (Tabla_Resumen_General_IANSA.xlsx), que el
  -- usuario fijó como ESTÁNDAR WebCarga el 07/10. Cuatro tipos cerrados:
  --   NONE               no vence                    (No aplica / Vigencia No)
  --   REQUIRED|OPTIONAL  fecha del documento         (Definida por documento)
  --   ISSUE_PLUS_MONTHS  plazo desde la emisión      (Anual = 12, Bienal = 24)
  --   CALENDAR_PERIOD    período de calendario       (Mensual, "N de cada mes")
  -- REQUIRED y OPTIONAL conservan su significado (CondicionPanel): el mapeo de
  -- lo existente es la identidad, así que no se migra ni un dato.
  --
  -- SOLO EXPAND: la API de main lee esta misma base y no conoce lo nuevo.

  -- 1) Los dos tipos nuevos.
  ALTER TABLE public.compliance_requirements
    DROP CONSTRAINT compliance_requirements_expiration_policy_check;
  ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_expiration_policy_check
    CHECK (expiration_policy IN
      ('NONE', 'REQUIRED', 'OPTIONAL', 'ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD'));

  -- 2) Desde cuándo se exige ("Cuándo se carga" en la planilla). El DEFAULT es
  -- lo que hace la siembra hoy, así que ningún requisito cambia.
  ALTER TABLE public.compliance_requirements
    ADD COLUMN exigible_on text NOT NULL DEFAULT 'ON_ENTITY_START';
  ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_exigible_on_check
    CHECK (exigible_on IN ('ON_ENTITY_START', 'MONTH_AFTER_START', 'ON_ENTITY_END', 'ON_REQUEST'));
  -- El ingreso y el término de un TRABAJADOR solo existen para conductores:
  -- son driver_assignments.start_date y el paso a INACTIVE.
  ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_exigible_on_entity_check
    CHECK (exigible_on NOT IN ('MONTH_AFTER_START', 'ON_ENTITY_END') OR target_entity = 'DRIVER');
  COMMENT ON COLUMN public.compliance_requirements.exigible_on IS
    'Desde cuándo se exige: ON_ENTITY_START (al ingreso), MONTH_AFTER_START (mes siguiente al ingreso del conductor), ON_ENTITY_END (al término del conductor), ON_REQUEST (solo si se solicita). Lo evalúa public.documento_exigible().';

  -- 3) Lo que el documento dice de sí mismo. expiration_date NO se renombra:
  -- la API de main la lee.
  ALTER TABLE public.compliance_records
    ADD COLUMN issue_date date,
    ADD COLUMN period_start date;
  ALTER TABLE public.compliance_records
    ADD CONSTRAINT compliance_records_period_start_first_day_check
    CHECK (period_start IS NULL OR extract(day FROM period_start) = 1);
  COMMENT ON COLUMN public.compliance_records.issue_date IS
    'Fecha de emisión. La usa ISSUE_PLUS_MONTHS.';
  COMMENT ON COLUMN public.compliance_records.period_start IS
    'Primer día del período que cubre el documento (ej. 2026-09-01 = septiembre). La usa CALENDAR_PERIOD.';

  -- 4) Los parámetros: UN lugar para la regla base y para la de cada cliente.
  -- La regla de un cliente es una VARIANTE de parámetros del mismo requisito, no
  -- un requisito con shipper_id: eso sembraría un registro duplicado y obligaría
  -- a cargar el mismo F30 dos veces (HU-C1, regla 5).
  -- vigente_desde versiona la regla: un documento se evalúa con la versión
  -- vigente a su emisión o período, así que mover un corte no reescribe lo ya
  -- aprobado (regla 6). La primera versión rige desde siempre.
  CREATE TABLE public.compliance_requirement_rules (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id       uuid NOT NULL REFERENCES public.compliance_requirements(id) ON DELETE CASCADE,
    shipper_id           uuid REFERENCES public.shippers(id) ON DELETE CASCADE,
    vigente_desde        date NOT NULL DEFAULT '-infinity',
    validity_months      int CHECK (validity_months > 0),
    frequency_months     int CHECK (frequency_months > 0),
    cutoff_day           int CHECK (cutoff_day BETWEEN 1 AND 31),
    period_offset_months int CHECK (period_offset_months >= 0),
    -- NULL = rige el aviso general (app.alert_thresholds 'documento_por_vencer').
    warning_days         int CHECK (warning_days >= 0),
    grace_days           int NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_requirement_rules_version_key
      UNIQUE NULLS NOT DISTINCT (requirement_id, shipper_id, vigente_desde)
  );
  CREATE INDEX compliance_requirement_rules_requirement_idx
    ON public.compliance_requirement_rules (requirement_id);

  -- 5) Coherencia política ↔ parámetros, la hace cumplir Postgres. Es DIFERIDA:
  -- la API cambia la política y sus parámetros en una transacción, y el chequeo
  -- corre al confirmar. Mira las dos tablas porque cualquiera de las dos puede
  -- romper la coherencia.
  CREATE OR REPLACE FUNCTION public.validar_vigencia_de_requisito(p_requirement_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_politica text;
  BEGIN
    SELECT expiration_policy INTO v_politica
    FROM public.compliance_requirements WHERE id = p_requirement_id;
    IF v_politica IS NULL THEN
      RETURN;  -- el requisito se borró; el CASCADE se lleva sus reglas
    END IF;

    IF v_politica IN ('ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD')
       AND NOT EXISTS (SELECT 1 FROM public.compliance_requirement_rules
                       WHERE requirement_id = p_requirement_id AND shipper_id IS NULL) THEN
      RAISE EXCEPTION 'El tipo de vigencia % necesita una regla base', v_politica
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_politica = 'ISSUE_PLUS_MONTHS' AND EXISTS (
         SELECT 1 FROM public.compliance_requirement_rules
         WHERE requirement_id = p_requirement_id AND validity_months IS NULL) THEN
      RAISE EXCEPTION 'Plazo desde la emisión: cada regla necesita sus meses de vigencia'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_politica = 'CALENDAR_PERIOD' AND EXISTS (
         SELECT 1 FROM public.compliance_requirement_rules
         WHERE requirement_id = p_requirement_id
           AND (frequency_months IS NULL OR cutoff_day IS NULL OR period_offset_months IS NULL)) THEN
      RAISE EXCEPTION 'Período de calendario: cada regla necesita frecuencia, día de corte y período'
        USING ERRCODE = 'check_violation';
    END IF;
  END;
  $$;

  CREATE OR REPLACE FUNCTION public.trg_validar_vigencia_requisito()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM public.validar_vigencia_de_requisito(NEW.id);
    RETURN NULL;
  END;
  $$;

  CREATE OR REPLACE FUNCTION public.trg_validar_vigencia_regla()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM public.validar_vigencia_de_requisito(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.requirement_id ELSE NEW.requirement_id END);
    RETURN NULL;
  END;
  $$;

  CREATE CONSTRAINT TRIGGER validar_vigencia_requisito
    AFTER INSERT OR UPDATE OF expiration_policy ON public.compliance_requirements
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.trg_validar_vigencia_requisito();

  CREATE CONSTRAINT TRIGGER validar_vigencia_regla
    AFTER INSERT OR UPDATE OR DELETE ON public.compliance_requirement_rules
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.trg_validar_vigencia_regla();

  -- 6) El aviso general: lo que hoy es DIAS_POR_VENCER = 30, pasa a ser dato
  -- editable desde Configuración › Alertas. Las 8 filas por documento de esta
  -- tabla (claves viejas, todas en 30, medido 07/10) NO las leen los
  -- predicados; se retiran en F5, cuando sus lectores pasen a la regla.
  INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days)
  VALUES ('documento_por_vencer', 'Aviso general de vencimiento de documentos (días)', 30, 0)
  ON CONFLICT (doc_type) DO NOTHING;
  ```

  Antes de aplicarla, verificar con `psql` (solo lectura) que `app.alert_thresholds.doc_type` tiene una restricción
  única o es la PK, para que el `ON CONFLICT (doc_type)` sea válido. Si no la tiene, cambiarlo por
  `INSERT … SELECT … WHERE NOT EXISTS (…)`.

- [ ] **Step 4: Rehearse and apply** con `mcp__claude_ai_Supabase__execute_sql`.
  1. Ensayo: `BEGIN;` + el archivo + `SELECT count(*) FROM public.compliance_requirements;` (deben ser 38) +
     `SET CONSTRAINTS ALL IMMEDIATE;` + `ROLLBACK;`.
  2. Aplicación: `BEGIN;` + el archivo + `COMMIT;`.
  3. Verificar:
     - `\d public.compliance_requirement_rules`;
     - `SELECT exigible_on, count(*) FROM public.compliance_requirements GROUP BY 1;` → 38 `ON_ENTITY_START`.
  4. Que no haya un job de ingesta en vuelo: mirar `pipeline_list` de mage-agent antes de aplicar.

- [ ] **Step 5: Run the test and verify it passes.**

  Run: `venv/bin/python -m pytest tests/test_vigencia_esquema.py -v`

  Expected: PASS.

- [ ] **Step 6: Verify the API of `main` still works.** Con el usuario: `curl` autenticado a un `GET /carriers/{id}`
  de `webcarga-monitor-api`, o mirar los logs de Cloud Run 10 minutos después de aplicar. Esperado: 0 errores 5xx
  nuevos.

- [ ] **Step 7: Commit.**

  ```bash
  git add monitor-app/backend/supabase/migrations/20261008110000_vigencia_esquema.sql \
          monitor-app/backend/api/tests/test_vigencia_esquema.py
  git commit -m "feat(db): esquema de vigencia por tipo de documento, solo expand (HU-C1 F1)"
  ```

---

### Task 3: El cálculo de la vigencia, en funciones SQL

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261008120000_vigencia_de_documentos.sql`
- Test (create): `monitor-app/backend/api/tests/test_vigencia_de_documentos.py`

**Interfaces:**
- Consumes: el esquema de Task 2 y `public.hoy_chile()` de Task 1.
- Produces (todas `STABLE`):
  - `public.clientes_de_entidad(p_entity_type text, p_entity_id uuid) RETURNS SETOF uuid`: los clientes `ACTIVE`
    de la empresa de la entidad.
  - `public.reglas_aplicables(p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_fecha_ref date)
    RETURNS SETOF public.compliance_requirement_rules`: una regla por cliente (su variante si la tiene; si no, la
    base). Sin clientes, solo la base. En cada caso, la versión vigente a `p_fecha_ref`.
  - `public.documento_vence_el(p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
    p_expiration_date date, p_issue_date date, p_period_start date) RETURNS date`: el peor vencimiento (`MIN`)
    entre las reglas aplicables. NULL = no vence o falta.
  - `public.documento_aviso_desde(` mismos 7 argumentos `) RETURNS date`: desde qué día está "por vencer".
  - `public.documento_exigible(p_requirement_id uuid, p_entity_type text, p_entity_id uuid) RETURNS boolean`.

- [ ] **Step 1: Write the failing tests** `tests/test_vigencia_de_documentos.py`. Las funciones se cargan desde la
  migración dentro de la transacción revertida. Los casos son los criterios de aceptación de la HU-C1.

  ```python
  """La vigencia de un documento, calculada al leer (HU-C1, entrega 2).

  Cada test es un criterio de aceptación de la HU o un borde que el spec
  implica. Las funciones se cargan desde el archivo de migración dentro de la
  transacción revertida: se prueba el SQL que se va a desplegar.

  "Hoy" se fija reemplazando public.hoy_chile() dentro de la misma
  transacción, así los casos no dependen del día en que corra la suite."""
  import datetime as dt
  import re
  from pathlib import Path
  from uuid import uuid4

  import pytest

  pytestmark = pytest.mark.integracion

  MIGRACION = (
      Path(__file__).resolve().parents[2]
      / "supabase/migrations/20261008120000_vigencia_de_documentos.sql"
  )
  PREFIJO = "ZZ-TEST-VIGENCIA"
  D = dt.date


  async def _cargar(conn) -> None:
      sql = MIGRACION.read_text()
      for funcion in re.findall(r"CREATE OR REPLACE FUNCTION.*?\$\$;", sql, re.S):
          await conn.execute(funcion)


  async def _hoy(conn, dia: dt.date) -> None:
      await conn.execute(
          f"CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
          f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$"
      )


  def _suf() -> str:
      return uuid4().hex[:8].upper()


  async def _empresa(conn):
      s = _suf()
      return await conn.fetchval(
          "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
          f"{PREFIJO} {s}", f"{PREFIJO}-{s}",
      )


  async def _cliente(conn, empresa=None):
      cliente = await conn.fetchval(
          "INSERT INTO public.shippers (name) VALUES ($1) RETURNING id", f"{PREFIJO} {_suf()}",
      )
      if empresa:
          await conn.execute(
              "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) "
              "VALUES ($1, $2, 'ACTIVE')", empresa, cliente,
          )
      return cliente


  async def _conductor(conn, empresa=None, *, desde=None, estado="ACTIVE"):
      s = _suf()
      conductor = await conn.fetchval(
          "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
          f"{PREFIJO} {s}", f"{PREFIJO}-{s}",
      )
      if empresa:
          await conn.execute(
              "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
              "VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE))",
              conductor, empresa, estado, desde,
          )
      return conductor


  async def _requisito(conn, politica, *, entidad="CARRIER", exigible_on="ON_ENTITY_START",
                       base: dict | None = None):
      requisito = await conn.fetchval(
          """
          INSERT INTO public.compliance_requirements
              (requirement_code, name, target_entity, requirement_level,
               expiration_policy, exigible_on, is_active)
          VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4, $5, false)
          RETURNING id
          """,
          f"ZZ_VIG_{_suf()}", f"{PREFIJO} requisito", entidad, politica, exigible_on,
      )
      if base is not None:
          await _regla(conn, requisito, **base)
      return requisito


  async def _regla(conn, requisito, **params):
      columnas = ["requirement_id", *params]
      marcas = ", ".join(f"${i}" for i in range(1, len(columnas) + 1))
      await conn.execute(
          f"INSERT INTO public.compliance_requirement_rules ({', '.join(columnas)}) "
          f"VALUES ({marcas})", requisito, *params.values(),
      )


  async def _vence(conn, requisito, entidad_tipo, entidad, *, status="APPROVED",
                   expiration_date=None, issue_date=None, period_start=None):
      return await conn.fetchval(
          "SELECT public.documento_vence_el($1, $2, $3, $4, $5, $6, $7)",
          requisito, entidad_tipo, entidad, status, expiration_date, issue_date, period_start,
      )


  async def _aviso(conn, requisito, entidad_tipo, entidad, **kw):
      return await conn.fetchval(
          "SELECT public.documento_aviso_desde($1, $2, $3, $4, $5, $6, $7)",
          requisito, entidad_tipo, entidad, kw.get("status", "APPROVED"),
          kw.get("expiration_date"), kw.get("issue_date"), kw.get("period_start"),
      )


  F30_1 = dict(frequency_months=1, cutoff_day=18, period_offset_months=1)


  # ── Período de calendario (criterio 2) ───────────────────────────────────────

  async def test_f30_1_de_septiembre_cubre_hasta_el_corte_de_noviembre(conexion_revertida):
      """El de septiembre se pide el 18/10 y cubre hasta que se pide el de
      octubre, el 18/11."""
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 9, 1)) == D(2026, 11, 18)


  async def test_con_el_de_agosto_esta_vencido_el_19_de_octubre(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
      vence = await _vence(conexion_revertida, req, "CARRIER", empresa, period_start=D(2026, 8, 1))
      assert vence == D(2026, 10, 18)
      assert vence < D(2026, 10, 19)


  async def test_la_gracia_corre_el_corte(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base={**F30_1, "grace_days": 3})
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 8, 1)) == D(2026, 10, 21)


  async def test_corte_31_en_febrero_es_el_ultimo_dia_de_febrero(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                             base=dict(frequency_months=1, cutoff_day=31, period_offset_months=1))
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 12, 1)) == D(2027, 2, 28)


  async def test_un_mensual_aprobado_sin_periodo_no_cubre_nada(conexion_revertida):
      """Review Focus 1: sin período, no hay de qué período es. Cuenta como
      vencido, no como al día."""
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
      assert await conexion_revertida.fetchval(
          "SELECT public.documento_vence_el($1, 'CARRIER', $2, 'APPROVED', NULL, NULL, NULL)"
          " = '-infinity'::date",
          req, empresa,
      )


  async def test_un_mensual_que_falta_no_esta_vencido_sino_faltante(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa, status="MISSING") is None


  # ── Corte por cliente (criterio 3) ───────────────────────────────────────────

  async def test_un_solo_registro_se_evalua_contra_el_corte_de_cada_cliente(conexion_revertida):
      """Base día 15; el cliente A corta el 5 y el B no tiene variante. Gana el
      peor: el de septiembre vence el 05/11 para A, que es el MIN."""
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      cliente_a = await _cliente(conexion_revertida, empresa)
      await _cliente(conexion_revertida, empresa)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                             base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
      await _regla(conexion_revertida, req, shipper_id=cliente_a,
                   frequency_months=1, cutoff_day=5, period_offset_months=1)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 9, 1)) == D(2026, 11, 5)


  async def test_la_variante_reemplaza_a_la_base_para_su_cliente(conexion_revertida):
      """Si el único cliente tiene variante, la base no le aplica: una variante
      MÁS permisiva (día 25) también se respeta."""
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      cliente = await _cliente(conexion_revertida, empresa)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                             base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
      await _regla(conexion_revertida, req, shipper_id=cliente,
                   frequency_months=1, cutoff_day=25, period_offset_months=1)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 9, 1)) == D(2026, 11, 25)


  async def test_sin_clientes_rige_la_base(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 9, 1)) == D(2026, 11, 18)


  async def test_el_conductor_hereda_los_clientes_de_su_empresa(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      cliente = await _cliente(conexion_revertida, empresa)
      conductor = await _conductor(conexion_revertida, empresa)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", entidad="DRIVER",
                             base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
      await _regla(conexion_revertida, req, shipper_id=cliente,
                   frequency_months=1, cutoff_day=5, period_offset_months=1)
      assert await _vence(conexion_revertida, req, "DRIVER", conductor,
                          period_start=D(2026, 9, 1)) == D(2026, 11, 5)


  # ── Cambiar la política no reescribe el pasado (criterio 6) ──────────────────

  async def test_mover_el_corte_no_cambia_un_periodo_anterior(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                             base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
      # Desde octubre, el corte pasa al 5.
      await _regla(conexion_revertida, req, vigente_desde=D(2026, 10, 1),
                   frequency_months=1, cutoff_day=5, period_offset_months=1)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 9, 1)) == D(2026, 11, 15)
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          period_start=D(2026, 10, 1)) == D(2026, 12, 5)


  # ── Plazo desde la emisión ───────────────────────────────────────────────────

  async def test_anual_vence_doce_meses_despues_de_la_emision(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "ISSUE_PLUS_MONTHS", base=dict(validity_months=12))
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          issue_date=D(2026, 3, 10)) == D(2027, 3, 10)


  # ── Fecha del documento y no vence ───────────────────────────────────────────

  async def test_fecha_del_documento_no_necesita_regla(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "REQUIRED")
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          expiration_date=D(2026, 12, 1)) == D(2026, 12, 1)


  async def test_un_documento_que_no_vence_no_vence_aunque_traiga_fecha(conexion_revertida):
      """La política es la única fuente. Hay 12 registros así en producción
      (07/10): ver el gate de Task 5."""
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "NONE")
      assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                          expiration_date=D(2020, 1, 1)) is None


  # ── Aviso (criterio 5) ───────────────────────────────────────────────────────

  async def test_sin_dias_propios_avisa_con_el_general(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "REQUIRED")
      general = await conexion_revertida.fetchval(
          "SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'documento_por_vencer'")
      assert await _aviso(conexion_revertida, req, "CARRIER", empresa,
                          expiration_date=D(2026, 12, 31)) == D(2026, 12, 31) - dt.timedelta(days=general)


  async def test_los_dias_del_tipo_cambian_el_aviso(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      req = await _requisito(conexion_revertida, "REQUIRED", base=dict(warning_days=7))
      assert await _aviso(conexion_revertida, req, "CARRIER", empresa,
                          expiration_date=D(2026, 12, 31)) == D(2026, 12, 24)


  # ── Exigibilidad ────────────────────────────────────────────────────────────

  async def _exigible(conn, req, tipo, entidad):
      return await conn.fetchval("SELECT public.documento_exigible($1, $2, $3)", req, tipo, entidad)


  async def test_mes_siguiente_al_ingreso(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      conductor = await _conductor(conexion_revertida, empresa, desde=D(2026, 10, 7))
      req = await _requisito(conexion_revertida, "NONE", entidad="DRIVER",
                             exigible_on="MONTH_AFTER_START")
      await _hoy(conexion_revertida, D(2026, 10, 31))
      assert await _exigible(conexion_revertida, req, "DRIVER", conductor) is False
      await _hoy(conexion_revertida, D(2026, 11, 1))
      assert await _exigible(conexion_revertida, req, "DRIVER", conductor) is True


  async def test_al_termino_solo_si_ya_no_tiene_empresa(conexion_revertida):
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      activo = await _conductor(conexion_revertida, empresa)
      desvinculado = await _conductor(conexion_revertida, empresa, estado="INACTIVE")
      req = await _requisito(conexion_revertida, "NONE", entidad="DRIVER",
                             exigible_on="ON_ENTITY_END")
      assert await _exigible(conexion_revertida, req, "DRIVER", activo) is False
      assert await _exigible(conexion_revertida, req, "DRIVER", desvinculado) is True


  async def test_al_ingreso_y_a_pedido_se_exigen_si_hay_registro(conexion_revertida):
      """ON_REQUEST no lo decide la lectura: lo decide la siembra (F3). Si hay
      registro, es porque alguien lo pidió."""
      await _cargar(conexion_revertida)
      empresa = await _empresa(conexion_revertida)
      for exigible_on in ("ON_ENTITY_START", "ON_REQUEST"):
          req = await _requisito(conexion_revertida, "NONE", exigible_on=exigible_on)
          assert await _exigible(conexion_revertida, req, "CARRIER", empresa) is True
  ```

  `-infinity` se compara en SQL y no en Python, porque asyncpg no tiene un equivalente fiel en `datetime.date`.

  Antes de escribir los helpers `_conductor` y `_empresa`, leer las columnas `NOT NULL` reales de
  `public.drivers`, `public.carriers` y `public.shippers` con `psql` (`\d`), y copiar las fixtures que ya usa
  `tests/test_integracion_certificacion.py:104-140`. Ese archivo ya conoce las restricciones; no hay que
  adivinarlas.

- [ ] **Step 2: Run the tests and verify they fail.**

  Run: `venv/bin/python -m pytest tests/test_vigencia_de_documentos.py -v`

  Expected: FAIL. El archivo de migración no existe.

- [ ] **Step 3: Write the migration** `20261008120000_vigencia_de_documentos.sql`:

  ```sql
  -- HU-C1, entrega 2 (F2): cuándo vence, desde cuándo avisa y desde cuándo se
  -- exige un documento. UNA definición por concepto, calculada al leer: ningún
  -- proceso nocturno cambia estados (regla 4). app/services/vencimientos.py es
  -- la única puerta desde Python y solo nombra estas funciones.
  --
  -- Mismo patrón que public.carrier_management_types(): la definición vive en
  -- la base para que la API, la siembra y cualquier vista lean lo mismo.

  -- Los clientes de una entidad: los de su empresa (conductor y vehículo, por su
  -- asignación ACTIVE).
  CREATE OR REPLACE FUNCTION public.clientes_de_entidad(p_entity_type text, p_entity_id uuid)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT cs.shipper_id
    FROM public.carrier_shippers cs
    WHERE cs.status = 'ACTIVE'
      AND cs.carrier_id = CASE p_entity_type
            WHEN 'CARRIER' THEN p_entity_id
            WHEN 'DRIVER'  THEN (SELECT da.carrier_id FROM public.driver_assignments da
                                 WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE')
            WHEN 'ASSET'   THEN (SELECT aa.carrier_id FROM public.asset_assignments aa
                                 WHERE aa.asset_id = p_entity_id AND aa.status = 'ACTIVE')
          END
  $$;

  -- Una regla por cliente: su variante si la tiene, si no la base. Sin clientes,
  -- la base. De cada una, la versión vigente a p_fecha_ref (regla 6).
  CREATE OR REPLACE FUNCTION public.reglas_aplicables(
    p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_fecha_ref date)
  RETURNS SETOF public.compliance_requirement_rules
  LANGUAGE sql STABLE
  AS $$
    WITH clientes AS (
      SELECT c AS shipper_id FROM public.clientes_de_entidad(p_entity_type, p_entity_id) c
    ),
    version AS (
      SELECT DISTINCT ON (r.shipper_id) r.*
      FROM public.compliance_requirement_rules r
      WHERE r.requirement_id = p_requirement_id
        AND r.vigente_desde <= COALESCE(p_fecha_ref, public.hoy_chile())
        AND (r.shipper_id IS NULL OR r.shipper_id IN (SELECT shipper_id FROM clientes))
      ORDER BY r.shipper_id, r.vigente_desde DESC
    )
    SELECT v.* FROM version v WHERE v.shipper_id IS NOT NULL
    UNION ALL
    SELECT v.* FROM version v
    WHERE v.shipper_id IS NULL
      AND (NOT EXISTS (SELECT 1 FROM clientes)
           OR EXISTS (SELECT 1 FROM clientes c
                      WHERE NOT EXISTS (SELECT 1 FROM version x WHERE x.shipper_id = c.shipper_id)))
  $$;

  -- El vencimiento según cada regla aplicable. Privada de las dos de abajo.
  --   REQUIRED/OPTIONAL  la fecha que trae el documento
  --   ISSUE_PLUS_MONTHS  emisión + meses
  --   CALENDAR_PERIOD    el corte del período SIGUIENTE al que se exige después
  --                      de este: el de septiembre (offset 1, corte 18) cubre
  --                      hasta el 18/11, cuando se pide el de octubre. Más gracia.
  --                      Un corte 31 en un mes corto es el último día del mes.
  -- Un registro MISSING no vence: falta, y eso lo dice su estado. Un registro
  -- presente sin el dato que su tipo necesita no cubre nada: -infinity.
  CREATE OR REPLACE FUNCTION public.vencimientos_por_regla(
    p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
    p_expiration_date date, p_issue_date date, p_period_start date)
  RETURNS TABLE (vence_el date, warning_days int)
  LANGUAGE sql STABLE
  AS $$
    WITH req AS (
      SELECT expiration_policy AS politica
      FROM public.compliance_requirements WHERE id = p_requirement_id
    ),
    reglas AS (
      SELECT r.* FROM req, public.reglas_aplicables(
        p_requirement_id, p_entity_type, p_entity_id,
        CASE req.politica WHEN 'ISSUE_PLUS_MONTHS' THEN p_issue_date
                          WHEN 'CALENDAR_PERIOD'   THEN p_period_start END) r
    )
    -- Fecha del documento: no necesita regla; las reglas solo aportan el aviso.
    SELECT p_expiration_date, rg.warning_days
    FROM req LEFT JOIN reglas rg ON true
    WHERE req.politica IN ('REQUIRED', 'OPTIONAL') AND p_expiration_date IS NOT NULL
    UNION ALL
    SELECT CASE
             WHEN p_status = 'MISSING' THEN NULL
             WHEN req.politica = 'ISSUE_PLUS_MONTHS' THEN
               CASE WHEN p_issue_date IS NULL THEN '-infinity'::date
                    ELSE (p_issue_date + make_interval(months => rg.validity_months))::date END
             ELSE
               CASE WHEN p_period_start IS NULL THEN '-infinity'::date
                    ELSE (
                      SELECT make_date(extract(year FROM m)::int, extract(month FROM m)::int,
                               least(rg.cutoff_day,
                                     extract(day FROM (m + interval '1 month - 1 day'))::int))
                             + rg.grace_days
                      FROM (SELECT (p_period_start
                                    + make_interval(months => rg.period_offset_months
                                                              + rg.frequency_months))::date AS m) x
                    ) END
           END,
           rg.warning_days
    FROM req JOIN reglas rg ON true
    WHERE req.politica IN ('ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD')
  $$;

  -- El peor vencimiento entre los clientes. NULL = no vence, o falta.
  CREATE OR REPLACE FUNCTION public.documento_vence_el(
    p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
    p_expiration_date date, p_issue_date date, p_period_start date)
  RETURNS date
  LANGUAGE sql STABLE
  AS $$
    SELECT min(v.vence_el) FROM public.vencimientos_por_regla(
      p_requirement_id, p_entity_type, p_entity_id, p_status,
      p_expiration_date, p_issue_date, p_period_start) v
  $$;

  -- Desde qué día está "por vencer": el vencimiento de cada regla menos sus
  -- días de aviso (los propios o, si la regla no los fija o no hay regla, el
  -- aviso general de Configuración › Alertas). El peor entre los clientes.
  CREATE OR REPLACE FUNCTION public.documento_aviso_desde(
    p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
    p_expiration_date date, p_issue_date date, p_period_start date)
  RETURNS date
  LANGUAGE sql STABLE
  AS $$
    SELECT min(v.vence_el - COALESCE(v.warning_days, g.warning_days))
    FROM public.vencimientos_por_regla(
      p_requirement_id, p_entity_type, p_entity_id, p_status,
      p_expiration_date, p_issue_date, p_period_start) v
    CROSS JOIN (SELECT warning_days FROM app.alert_thresholds
                WHERE doc_type = 'documento_por_vencer') g
  $$;

  -- Desde cuándo se exige. Se evalúa al leer, igual que el vencimiento.
  --   ON_ENTITY_START / ON_REQUEST  siempre (a ON_REQUEST lo filtra la siembra)
  --   MONTH_AFTER_START  desde el día 1 del mes siguiente al ingreso del
  --                      conductor (driver_assignments.start_date de su
  --                      asignación ACTIVE; sin asignación, se exige)
  --   ON_ENTITY_END      cuando el conductor ya no tiene asignación ACTIVE y
  --                      tuvo alguna
  CREATE OR REPLACE FUNCTION public.documento_exigible(
    p_requirement_id uuid, p_entity_type text, p_entity_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT CASE req.exigible_on
      WHEN 'MONTH_AFTER_START' THEN COALESCE(
        (SELECT public.hoy_chile() >= (date_trunc('month', da.start_date) + interval '1 month')::date
         FROM public.driver_assignments da
         WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE'),
        true)
      WHEN 'ON_ENTITY_END' THEN
        NOT EXISTS (SELECT 1 FROM public.driver_assignments da
                    WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE')
        AND EXISTS (SELECT 1 FROM public.driver_assignments da
                    WHERE da.driver_id = p_entity_id)
      ELSE true
    END
    FROM public.compliance_requirements req
    WHERE req.id = p_requirement_id
  $$;
  ```

- [ ] **Step 4: Run the tests and verify they pass.**

  Run: `venv/bin/python -m pytest tests/test_vigencia_de_documentos.py -v`

  Expected: PASS. Si un caso falla, se corrige la función, no el test. Cada test es un criterio de la HU.

- [ ] **Step 5: Mutation check.** Verificar que la mutación se aplicó de verdad, con `git diff`. Luego:
  1. Cambiar `least(rg.cutoff_day, …)` por `rg.cutoff_day`: tiene que fallar el test de febrero.
  2. Cambiar `min(` por `max(` en `documento_vence_el`: tiene que fallar el test de un registro por cliente.
  3. Quitar `AND r.vigente_desde <= …`: tiene que fallar el test de mover el corte.

  Revertir las tres mutaciones con `git checkout -- <archivo>`.

- [ ] **Step 6: Rehearse and apply** con `mcp__claude_ai_Supabase__execute_sql`.
  - Ensayo: `BEGIN;` + el archivo + `SELECT public.documento_vence_el(id, target_entity, gen_random_uuid(),
    'APPROVED', DATE '2026-12-01', NULL, NULL) FROM public.compliance_requirements LIMIT 5;` + `ROLLBACK;`.
  - Aplicación: `BEGIN;` + el archivo + `COMMIT;`.
  - Son funciones nuevas: nadie las llama todavía.

- [ ] **Step 7: Commit.**

  ```bash
  git add monitor-app/backend/supabase/migrations/20261008120000_vigencia_de_documentos.sql \
          monitor-app/backend/api/tests/test_vigencia_de_documentos.py
  git commit -m "feat(db): vigencia, aviso y exigibilidad de documentos calculadas al leer (HU-C1 F2)"
  ```

---

### Task 4: Los predicados leen la vigencia; las CTE proyectan lo que el predicado necesita

**Files:**
- Modify: `monitor-app/backend/api/app/services/vencimientos.py` (los tres predicados y `DIAS_POR_VENCER`)
- Modify: `monitor-app/backend/api/app/routers/compliance.py:346-366` (CTE `records` y `attributed`) y la CTE
  `pending` de la consulta de la cola (~`:400-430`)
- Modify: `monitor-app/backend/api/app/services/plantilla_certificacion.py:98-104` (CTE `pendientes`)
- Test: `monitor-app/backend/api/tests/test_vencimientos.py`
- Test (create): `monitor-app/backend/api/tests/test_predicados_vigencia_integracion.py`

**Interfaces:**
- Consumes: las funciones de Task 3.
- Produces:
  - `vencido_predicate(alias)`, `por_vencer_predicate(alias)`, `pendiente_predicate(alias)`, con la misma firma.
  - **Contrato del alias:** debe exponer `requirement_id`, `entity_type`, `entity_id`, `status`,
    `expiration_date`, `issue_date` y `period_start`. Está documentado en el docstring del módulo.
  - `DIAS_POR_VENCER` desaparece.

- [ ] **Step 1: Write the failing tests.**

  1. En `tests/test_vencimientos.py`, reemplazar `test_el_predicado_de_por_vencer_usa_la_constante` por:

     ```python
     def test_los_predicados_leen_la_vigencia_calculada():
         from app.services import vencimientos as v

         assert not hasattr(v, "DIAS_POR_VENCER"), (
             "El aviso es dato (regla o Configuración › Alertas), no una constante")
         args = ("cr.requirement_id, cr.entity_type, cr.entity_id, cr.status, "
                 "cr.expiration_date, cr.issue_date, cr.period_start")
         assert f"public.documento_vence_el({args})" in v.vencido_predicate("cr")
         assert f"public.documento_aviso_desde({args})" in v.por_vencer_predicate("cr")
         assert ("public.documento_exigible(cr.requirement_id, cr.entity_type, cr.entity_id)"
                 in v.pendiente_predicate("cr"))
     ```

  2. Crear `tests/test_predicados_vigencia_integracion.py`. Ejecuta los predicados reales contra registros reales
     creados por el test, y recorre las lecturas que los usan:

     ```python
     """Los predicados de vencimientos.py, ejecutados contra la base.

     Un predicado que nombra una columna que su CTE no proyecta compila en
     Python y revienta en Postgres. AsyncMock no lo ve (dos veces ya en este
     módulo), así que acá se ejecuta cada lectura real que usa un predicado."""
     import datetime as dt
     from uuid import uuid4

     import pytest

     from app.services.vencimientos import (
         pendiente_predicate, por_vencer_predicate, vencido_predicate,
     )
     from app.services.plantilla_certificacion import sql_filas_plantilla

     pytestmark = pytest.mark.integracion
     D = dt.date


     async def _hoy(conn, dia):
         await conn.execute(
             f"CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
             f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$")


     async def _caso(conn, politica, **registro):
         s = uuid4().hex[:8].upper()
         empresa = await conn.fetchval(
             "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1,$2) RETURNING id",
             f"ZZ-TEST-PRED {s}", f"ZZ-TEST-PRED-{s}")
         req = await conn.fetchval(
             """INSERT INTO public.compliance_requirements
                  (requirement_code, name, target_entity, requirement_level, expiration_policy, is_active)
                VALUES ($1, $2, 'CARRIER', 'LEGAL_MANDATORY', $3, false) RETURNING id""",
             f"ZZ_PRED_{s}", f"ZZ-TEST-PRED {s}", politica)
         if politica == "CALENDAR_PERIOD":
             await conn.execute(
                 "INSERT INTO public.compliance_requirement_rules "
                 "(requirement_id, frequency_months, cutoff_day, period_offset_months) "
                 "VALUES ($1, 1, 18, 1)", req)
         await conn.execute(
             """INSERT INTO public.compliance_records
                  (entity_id, entity_type, requirement_id, status, expiration_date, issue_date, period_start)
                VALUES ($1, 'CARRIER', $2, $3, $4, $5, $6)""",
             empresa, req, registro.get("status", "APPROVED"), registro.get("expiration_date"),
             registro.get("issue_date"), registro.get("period_start"))
         return empresa, req


     async def _estado(conn, empresa):
         return await conn.fetchrow(
             f"""SELECT {vencido_predicate('cr')} AS vencido,
                        {por_vencer_predicate('cr')} AS por_vencer,
                        {pendiente_predicate('cr')} AS pendiente
                 FROM public.compliance_records cr WHERE cr.entity_id = $1""", empresa)


     async def test_f30_1_de_agosto_esta_vencido_el_19_de_octubre(conexion_revertida):
         empresa, _ = await _caso(conexion_revertida, "CALENDAR_PERIOD", period_start=D(2026, 8, 1))
         await _hoy(conexion_revertida, D(2026, 10, 19))
         fila = await _estado(conexion_revertida, empresa)
         assert (fila["vencido"], fila["pendiente"]) == (True, True)


     async def test_f30_1_de_septiembre_esta_al_dia_el_19_de_octubre(conexion_revertida):
         empresa, _ = await _caso(conexion_revertida, "CALENDAR_PERIOD", period_start=D(2026, 9, 1))
         await _hoy(conexion_revertida, D(2026, 10, 19))
         fila = await _estado(conexion_revertida, empresa)
         assert (fila["vencido"], fila["por_vencer"], fila["pendiente"]) == (False, False, False)


     async def test_el_dia_del_corte_todavia_no_esta_vencido(conexion_revertida):
         empresa, _ = await _caso(conexion_revertida, "REQUIRED", expiration_date=D(2026, 10, 18))
         await _hoy(conexion_revertida, D(2026, 10, 18))
         fila = await _estado(conexion_revertida, empresa)
         assert (fila["vencido"], fila["por_vencer"]) == (False, True)


     async def test_las_lecturas_que_usan_predicados_ejecutan(conexion_revertida):
         """La planilla y el embudo usan CTE propias: si no proyectan las
         columnas del contrato, Postgres falla acá y no en producción."""
         await conexion_revertida.fetch(sql_filas_plantilla(pendiente_predicate("cr")), "todas")
     ```

     Además, agregar a ese archivo una prueba que ejecute la consulta de `GET /compliance/status` para los
     cuatro agrupamientos (`carrier`, `requirement`, `driver`, `asset`) y la de `GET /compliance/pending`. Antes,
     leer `compliance.py` para ver cómo se arma cada SQL:
     - si el SQL se arma dentro del endpoint, extraer la construcción a una función de módulo
       (`_sql_estado(group, …)`) en el **mismo** commit;
     - **no** duplicar el SQL en el test.

     Si `tests/test_integracion_certificacion.py` ya llama a esos endpoints con `conexion_revertida`, reusar ese
     camino en lugar de extraer código.

- [ ] **Step 2: Run the tests and verify they fail.**

  Run: `venv/bin/python -m pytest tests/test_vencimientos.py tests/test_predicados_vigencia_integracion.py -v`

  Expected: FAIL. Los predicados todavía leen `expiration_date` directo.

- [ ] **Step 3: Implement the predicates.** En `vencimientos.py`:

  1. Borrar `DIAS_POR_VENCER`.
  2. Agregar al docstring del módulo el **contrato del alias**: debe exponer `requirement_id`, `entity_type`,
     `entity_id`, `status`, `expiration_date`, `issue_date` y `period_start`.
  3. Agregar:

     ```python
     def _vigencia_args(alias: str) -> str:
         return (f"{alias}.requirement_id, {alias}.entity_type, {alias}.entity_id, "
                 f"{alias}.status, {alias}.expiration_date, {alias}.issue_date, "
                 f"{alias}.period_start")


     def vence_el_sql(alias: str = "cr") -> str:
         """Cuándo vence, según la política y la regla de cada cliente
         (migración 20261008120000). NULL = no vence o falta."""
         return f"public.documento_vence_el({_vigencia_args(alias)})"


     def aviso_desde_sql(alias: str = "cr") -> str:
         return f"public.documento_aviso_desde({_vigencia_args(alias)})"


     def exigible_sql(alias: str = "cr") -> str:
         return (f"public.documento_exigible({alias}.requirement_id, "
                 f"{alias}.entity_type, {alias}.entity_id)")
     ```

  4. Reescribir los predicados:

     ```python
     def por_vencer_predicate(alias: str = "cr") -> str:
         """Vence pronto pero TODAVIA NO vencio. (Docstring actual se conserva.)"""
         return (
             f"({vence_el_sql(alias)} >= {hoy_sql()} "
             f"AND {aviso_desde_sql(alias)} <= {hoy_sql()})"
         )


     def vencido_predicate(alias: str = "cr") -> str:
         return f"({vence_el_sql(alias)} < {hoy_sql()})"


     def pendiente_predicate(alias: str = "cr") -> str:
         return (
             f"({exigible_sql(alias)} AND ("
             f"{alias}.status IN ('MISSING','EXPIRED') "
             f"OR {vencido_predicate(alias)} "
             f"OR {por_vencer_predicate(alias)}))"
         )
     ```

  Se conservan los docstrings y comentarios existentes de los tres predicados (issue #11, por qué `REJECTED`
  queda afuera). Solo se agrega una línea al de `pendiente_predicate`: *"y solo si ya es exigible
  (`exigible_on`)"*.

- [ ] **Step 4: Project the contract columns in the CTEs.**
  - **CTE `records`** (`compliance.py:346`): agregar `cr.issue_date, cr.period_start`. Ya tiene `entity_type`,
    `entity_id`, `status`, `expiration_date` y `requirement_id`.
  - **CTE `attributed`**: agregar `r.entity_type, r.entity_id, r.issue_date, r.period_start`.
  - **CTE `pending`** de la cola: agregar `cr.issue_date, cr.period_start`. Confirmar que ya trae
    `cr.entity_type`, `cr.entity_id`, `cr.requirement_id` (vía `req.id AS requirement_id`), `cr.status` y
    `cr.expiration_date`. La CTE `resolved` hereda todo por `p.*`.
  - **CTE `pendientes`** de `plantilla_certificacion.py`: agregar `cr.requirement_id, cr.issue_date,
    cr.period_start`.
  - Los SELECT de `carriers.py:304`, `drivers.py:377`, `assets.py:243` y `trips.py:631` usan `cr` sobre la tabla:
    no cambian.

- [ ] **Step 5: Run the tests and verify they pass.**

  Run: `venv/bin/python -m pytest tests/test_vencimientos.py tests/test_predicados_vigencia_integracion.py tests/test_un_solo_criterio_de_pendiente.py -v`

  Expected: PASS.

- [ ] **Step 6: Run the full backend suite**, con integración.

  Run: `venv/bin/python -m pytest -q`

  Expected: todo en verde. Los tests mockeados que comparan SQL literal (`'30 days'`, `CURRENT_DATE`) se
  actualizan **solo** si su aserción era el texto del predicado viejo. Si un test fijaba una conducta, se lee
  antes de tocarlo (ver `feedback_un_test_que_fija_el_defecto`).

- [ ] **Step 7: Commit.**

  ```bash
  git add monitor-app/backend/api/app/services/vencimientos.py \
          monitor-app/backend/api/app/routers/compliance.py \
          monitor-app/backend/api/app/services/plantilla_certificacion.py \
          monitor-app/backend/api/tests/test_vencimientos.py \
          monitor-app/backend/api/tests/test_predicados_vigencia_integracion.py
  git commit -m "feat(certificacion): los predicados de vencimiento leen la vigencia calculada (HU-C1 F2)"
  ```

---

### Task 5: Medir, decidir los 10 NONE con fecha y desplegar

**Files:** ninguno de código, salvo lo que exija la medición.

- [ ] **Step 1: Measure the cost of reading** (Review Focus 5). Con `psql`, solo lectura:
  1. `EXPLAIN (ANALYZE, BUFFERS)` de la consulta de `/compliance/status?group=carrier`, armada con los predicados
     **viejos**, desde `git show HEAD~1:…/vencimientos.py`.
  2. Lo mismo con los **nuevos**.
  3. Lo mismo con `/compliance/pending`.

  - **Umbral**: el nuevo debe tardar menos de 2× el viejo y menos de 1,5 s.
  - **Si lo supera**, no se parcha con caché. Se marca `documento_vence_el` y `documento_aviso_desde` como
    `PARALLEL SAFE` y se mide de nuevo. Si sigue arriba, se detiene aquí y se lleva la medición al usuario.

- [ ] **Step 2: Before/after counts.** Con los predicados nuevos ejecutados en la base, contar por requisito los
  pendientes y los vencidos de hoy, y compararlos con los viejos.
  - **Diferencias esperadas, y solo estas:**
    - los registros NONE con fecha dejan de estar vencidos (10 al 07/10);
    - los cortes de las 21-24 h de Chile, según la hora de la medición.
  - Cualquier otra diferencia se investiga antes de seguir.

- [ ] **Step 3: GATE — the 10 NONE documents with a date.** Llevar al usuario la lista: código, cuántos, desde
  cuándo vencidos, sin nombres de personas (ver `feedback_pii_in_verification_reports`).
  - Con la política como única fuente, dejan de verse vencidos.
  - En la planilla de WebCarga, varios de esos tipos son Anuales (RIOHS, EPP, Plan de emergencia), así que la
    forma correcta de que vuelvan a vencer es asignarles su tipo en F6, no leer la fecha suelta.
  - **No desplegar Task 4 hasta que el usuario lo confirme.**

- [ ] **Step 4: Deploy.**
  - Verificar que no haya un job de ingesta en vuelo.
  - Push a `dev`.
  - Confirmar que **Deploy Monitor API** corrió y está en verde (ver `feedback_push_grande_apaga_filtro_de_rutas`).

- [ ] **Step 5: Verify in dev with Playwright.**
  - Certificación › Por empresa: los totales de pendientes coinciden con lo medido en el Step 2.
  - Abrir una ficha con un documento por vencer y uno vencido.
  - 0 errores 5xx en los logs de Cloud Run de `webcarga-monitor-api-dev`.

- [ ] **Step 6: AGENTLOG.**
  - Actualizar el checklist: F0-F2 hechos; siguiente paso, escribir el plan de F3 (siembra y "Solicitar").
  - Actualizar la memoria `project_hu_c1_vencimientos`.
