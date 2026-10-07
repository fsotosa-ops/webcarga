# HU-C1, entrega 1: una sola política de vencimiento — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `compliance_requirements.expiration_policy` sea la única fuente de "este documento vence o no",
en el backend y en el frontend, y que "Nuevo documento" deje elegir la política con el mismo control que
la edición. Al final se retira `has_expiration` de la base.

**Architecture:** La migración `20260820100000_expiration_policy.sql` ya declaró a `expiration_policy` la
fuente de verdad y dejó `has_expiration` "porque tiene lectores vivos". Esta entrega migra esos lectores, no
sincroniza las dos columnas.
- La regla vive en un solo lugar por capa:
  - backend: `app/services/vencimientos.py`, que ya es "una sola definición" de por vencer;
  - frontend: `lib/compliance.ts`.
- El control de la política se extrae de `CondicionPanel` a un componente que usan los dos paneles.
- El `DROP COLUMN` va al final, después del despliegue y con su propia compuerta.

**Tech Stack:** FastAPI + asyncpg (pytest, `monitor-app/backend/api/venv`), Next.js + React Query (vitest),
Postgres en Supabase (proyecto `webcarga-core-db`).

**Spec:** `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md`, HU-C1, reglas 1 y 7
del "Diseño".

## Por qué (lo medido el 07/10)

- **El F30-1 se creó el 01/10 con `expiration_policy = NONE` y `has_expiration = false`.**
  - `NuevoDocumentoPanel` no envía la política.
  - El `INSERT` de `POST /compliance-requirements` (`app/routers/requirements.py:217-228`) escribe la
    política, pero no `has_expiration`, que queda con su default.
- **Cualquier documento creado o editado desde Configuración queda desincronizado.** Si se le pone una
  política con fecha, `has_expiration` sigue en `false`. Las consecuencias:
  - Sin clasificar (`TriageClassifyForm.tsx:65,228`) **ni siquiera muestra el campo de fecha**;
  - `classify-batch` no la exige;
  - la planilla rechaza la fecha (*"no lleva fecha de vencimiento"*).
- Hoy las 38 filas coinciden: 21 REQUIRED/true y 17 NONE/false. Ninguna está en OPTIONAL. Por eso esta
  entrega **no cambia el comportamiento de ningún documento existente**; solo corrige lo que venga desde
  Configuración.

## Global Constraints

- **Español neutral en la UI y en los mensajes**, nunca voseo: "Elige", "Selecciona".
- **Cero emojis en la UI**; íconos solo de `lucide-react`.
- **Trinquete visual**: UI nueva sin `text-gray-500`, `text-[10px]` ni otros grises o tamaños literales.
  Se usan los tokens que ya usa el control que se extrae (`text-etiqueta`, `text-informativo`, `text-dato`).
- **Nada de parches.** No se escribe `has_expiration` a la par de `expiration_policy`. No se agrega un
  trigger que las sincronice.
- **Significados de la política** (los define `CondicionPanel.tsx:435-437` y no se cambian):
  - `REQUIRED`: sin fecha, el documento no se acepta;
  - `OPTIONAL`: se acepta y la fecha queda pendiente;
  - `NONE`: el documento no vence.
- **Tests del backend**: `cd monitor-app/backend/api && venv/bin/python -m pytest …`. Los tests marcados
  `integracion` usan `conexion_revertida` contra la base real, siempre revertida. **Los datos los crea el
  test.**
- **Tests del frontend**: `cd monitor-app/frontend && npx vitest run <ruta>`; antes de comitear, también
  `npx tsc --noEmit`.

## Review Focus

1. **Un documento OPTIONAL en Sin clasificar** muestra la fecha, pero no la exige. Lo cubren Task 1
   (backend) y Task 5 (frontend).
2. **Un documento REQUIRED creado desde Configuración**, con `has_expiration` en su default `false`, exige
   la fecha en la planilla. Lo cubre Task 2: es el estado desincronizado real.
3. **El ida y vuelta de la planilla**: un documento OPTIONAL baja con la columna de fecha habilitada. Lo
   cubre Task 2.
4. **El catálogo sin `has_expiration`**: ningún consumidor del frontend lo lee (lo verifica `tsc`) y ningún
   SQL del backend lo nombra (test guardián). Lo cubre Task 3.
5. **El `DROP COLUMN` y el rollback.** La API de `main` no lee la columna (corregido en la revisión
   final). El riesgo es volver a una revisión de dev anterior a `5ae76d43`. Lo cubre la compuerta de
   Task 7.

---

### Task 1: La regla en un solo lugar del backend; la usan la clasificación y la carga directa

**Files:**
- Modify: `monitor-app/backend/api/app/services/vencimientos.py` (agregar al final)
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py:414-454`
- Modify: `monitor-app/backend/api/app/routers/compliance.py:1371`
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Produces: `lleva_fecha(politica: str) -> bool`, `exige_fecha(politica: str) -> bool` y
  `lleva_fecha_sql(alias: str = "req") -> str` en `app.services.vencimientos`.

- [ ] **Step 1: Write the failing tests.** En `tests/test_document_ingest.py`:

  1. Cambiar el helper en la línea 746 para que la fila traiga la política:

     ```python
     def _record_row(record_id="rec-1", expiration_policy="NONE"):
         return {
             "id": record_id, "entity_id": "a1", "entity_type": "ASSET",
             "status": "MISSING", "expiration_date": None,
             "expiration_policy": expiration_policy,
         }
     ```

  2. Reemplazar el arreglo de `test_classify_batch_requires_the_expiration_date_when_the_requirement_has_one`
     (líneas 844-853):

     ```python
         conn.fetch.return_value = [_tray_item()]
         conn.fetchrow.return_value = _record_row(expiration_policy="REQUIRED")
         client = make_client(pool)
     ```

     Queda sin la línea `conn.fetchval.return_value = True  # has_expiration`.

  3. Agregar este test a continuación:

     ```python
     def test_classify_batch_accepts_an_optional_expiration_without_a_date():
         """OPTIONAL dice "se acepta y la fecha queda pendiente". Antes se leía
         `has_expiration`, que Configuración no edita: un documento OPTIONAL creado
         ahí era imposible de fechar o, al revés, se exigía sin pedirse."""
         pool = AsyncMock()
         conn = AsyncMock()
         wire_transactional_conn(pool, conn)
         conn.fetch.return_value = [_tray_item()]
         conn.fetchrow.return_value = _record_row(expiration_policy="OPTIONAL")
         conn.fetchval.return_value = True  # si alguien vuelve a leer has_expiration, esto lo delata
         client = make_client(pool)

         res = client.post(
             "/api/v1/document-ingest/items/classify-batch",
             json={"item_ids": ["i1"], "entity_type": "ASSET",
                   "entity_id": "a1", "requirement_id": "req-1"},
         )

         assert res.status_code == 200
         assert res.json()["applied"] == ["i1"]
     ```

  4. Agregar un test puro de la regla:

     ```python
     from app.services.vencimientos import exige_fecha, lleva_fecha

     def test_la_politica_dice_si_lleva_y_si_exige_fecha():
         assert (lleva_fecha("REQUIRED"), exige_fecha("REQUIRED")) == (True, True)
         assert (lleva_fecha("OPTIONAL"), exige_fecha("OPTIONAL")) == (True, False)
         assert (lleva_fecha("NONE"), exige_fecha("NONE")) == (False, False)
     ```

- [ ] **Step 2: Run them to verify they fail.**

  ```bash
  venv/bin/python -m pytest tests/test_document_ingest.py -k "expiration or politica" -v
  ```

  Esperado:
  - `ImportError` en `exige_fecha`;
  - el test OPTIONAL da 422, porque el código actual lee `fetchval` → `True`.

- [ ] **Step 3: Implement.**

  1. Al final de `app/services/vencimientos.py`:

     ```python
     # ── Si un documento vence ────────────────────────────────────────────────────
     #
     # `compliance_requirements.expiration_policy` es la ÚNICA fuente. Reemplazó a
     # has_expiration, un booleano que cargaba tres significados y que Configuración
     # no edita: todo lector que lo siguiera usando se desincronizaba con la primera
     # política cambiada desde la pantalla (HU-C1, entrega 1).


     def lleva_fecha(politica: str) -> bool:
         """El documento admite una fecha de vencimiento: obligatoria u opcional."""
         return politica != "NONE"


     def exige_fecha(politica: str) -> bool:
         """Sin fecha, el documento no se acepta."""
         return politica == "REQUIRED"


     def lleva_fecha_sql(alias: str = "req") -> str:
         """`lleva_fecha` para un SELECT, sobre el alias del requisito."""
         return f"({alias}.expiration_policy <> 'NONE')"
     ```

  2. En `document_ingest.py`, la consulta `record = await conn.fetchrow(...)` (desde la línea 414):
     - agregar `req.expiration_policy` a la lista de columnas;
     - cambiar `FROM public.compliance_records cr` por:

       ```sql
       FROM public.compliance_records cr
       JOIN public.compliance_requirements req ON req.id = cr.requirement_id
       ```

     Es un JOIN 1:1: `requirement_id` es una FK no nula.

  3. Reemplazar el bloque de las líneas 447-454 completo (el `fetchval` desaparece):

     ```python
             if body.expiration_date is None and exige_fecha(record["expiration_policy"]):
                 raise HTTPException(422, "Este documento requiere fecha de vencimiento")
     ```

     Agregar `from app.services.vencimientos import exige_fecha` a los imports del archivo.

  4. En `compliance.py:1371`:

     ```python
         if exige_fecha(current["expiration_policy"]) and expiration_date is None:
     ```

     Agregar `exige_fecha` al import de `app.services.vencimientos`: si ya existe, sumarlo; si no, crearlo.

- [ ] **Step 4: Run to verify they pass, and run the whole file.**

  ```bash
  venv/bin/python -m pytest tests/test_document_ingest.py -v
  ```

  Esperado: todo en verde.
  - Si un test viejo dependía de `conn.fetchval.return_value = False` para que no se exigiera la fecha,
    hoy pasa por la política `NONE` del helper. No debe hacer falta tocarlo.
  - Si falla, se lee por qué: no se "arregla" el mock a ciegas.

- [ ] **Step 5: Mutation check.** Cambiar a mano `exige_fecha` para que devuelva `politica != "NONE"`,
  correr el test OPTIONAL y verlo en rojo. Revertir.

- [ ] **Step 6: Commit.**

  ```bash
  git add monitor-app/backend/api/app/services/vencimientos.py monitor-app/backend/api/app/routers/document_ingest.py monitor-app/backend/api/app/routers/compliance.py monitor-app/backend/api/tests/test_document_ingest.py
  git commit -m "fix(certificacion): clasificar y cargar leen expiration_policy, no has_expiration"
  ```

---

### Task 2: La planilla lee la política (exportar e importar)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/compliance.py:1003-1041` (importar)
- Modify: `monitor-app/backend/api/app/services/plantilla_certificacion.py:95-99, 160-173` (exportar)
- Test: `monitor-app/backend/api/tests/test_planilla_certificacion.py`

**Interfaces:**
- Consumes: `lleva_fecha`, `exige_fecha` y `lleva_fecha_sql` de Task 1.

- [ ] **Step 1: Write the failing tests.** En `tests/test_planilla_certificacion.py`:

  1. Cambiar el filtro de `_registros_de` (línea 72) para que no nombre la columna que se retira:

     ```python
               AND (req.expiration_policy <> 'NONE') = $2
     ```

  2. Agregar, debajo de `_empresa_activa`, un helper que crea el requisito dentro de la transacción. Se
     crea **antes** que la empresa, para que la siembra real le genere el registro:

     ```python
     async def _requisito_de_empresa(conn, politica: str) -> str:
         """Un requisito creado como lo crea Configuración: sólo con la política.
         `has_expiration` queda en su default, que es justo el estado desincronizado
         que hacía fallar la planilla."""
         suf = uuid4().hex[:8].upper()
         return await conn.fetchval(
             """
             INSERT INTO public.compliance_requirements
                 (requirement_code, name, target_entity, requirement_level,
                  expiration_policy, is_active)
             VALUES ($1, $2, 'CARRIER', 'LEGAL_MANDATORY', $3, true)
             RETURNING id
             """,
             f"ZZ_TEST_PLANILLA_{suf}", f"{PREFIJO} doc {suf}", politica,
         )


     async def _registro_de(conn, empresa, requisito) -> str:
         return await conn.fetchval(
             "SELECT id::text FROM public.compliance_records "
             "WHERE entity_id = $1 AND requirement_id = $2 AND is_current = true",
             empresa, requisito,
         )
     ```

  3. Agregar estos tests en la sección "Los dos ejes":

     ```python
     async def test_un_documento_de_fecha_opcional_admite_fecha(conexion_revertida):
         """Creado desde Configuración con fecha OPCIONAL: la planilla tiene que
         dejar escribirla. Leyendo has_expiration la rechazaba."""
         pool = PoolDeUnaConexion(conexion_revertida)
         usuario = await _usuario_real(conexion_revertida)
         requisito = await _requisito_de_empresa(conexion_revertida, "OPTIONAL")
         empresa = await _empresa_activa(conexion_revertida)
         registro = await _registro_de(conexion_revertida, empresa, requisito)
         assert registro, "la siembra no creó el registro: revisar el trigger, no el test"

         fila = await _fila(pool, registro)
         fila[COLUMNA_VENCIMIENTO] = (date.today() + timedelta(days=40)).strftime("%d-%m-%Y")
         await cargar_planilla(file=_subir([fila]), dry_run=False, pool=pool, user=usuario)

         assert await conexion_revertida.fetchval(
             "SELECT expiration_date FROM public.compliance_records WHERE id = $1::uuid", registro,
         ) == date.today() + timedelta(days=40)


     async def test_un_documento_de_fecha_opcional_se_recibe_sin_fecha(conexion_revertida):
         pool = PoolDeUnaConexion(conexion_revertida)
         usuario = await _usuario_real(conexion_revertida)
         requisito = await _requisito_de_empresa(conexion_revertida, "OPTIONAL")
         empresa = await _empresa_activa(conexion_revertida)
         registro = await _registro_de(conexion_revertida, empresa, requisito)

         fila = await _fila(pool, registro)
         fila[COLUMNA_TENENCIA] = "Sí"
         fila[COLUMNA_VENCIMIENTO] = ""
         await cargar_planilla(file=_subir([fila]), dry_run=False, pool=pool, user=usuario)

         assert await conexion_revertida.fetchval(
             "SELECT status FROM public.compliance_records WHERE id = $1::uuid", registro,
         ) == "APPROVED_MANUAL"


     async def test_un_documento_de_fecha_obligatoria_creado_en_configuracion_la_exige(conexion_revertida):
         """REQUIRED con has_expiration en su default: es el F30-1 si se le hubiera
         puesto fecha obligatoria desde la pantalla."""
         pool = PoolDeUnaConexion(conexion_revertida)
         usuario = await _usuario_real(conexion_revertida)
         requisito = await _requisito_de_empresa(conexion_revertida, "REQUIRED")
         empresa = await _empresa_activa(conexion_revertida)
         registro = await _registro_de(conexion_revertida, empresa, requisito)

         fila = await _fila(pool, registro)
         fila[COLUMNA_TENENCIA] = "Sí"
         fila[COLUMNA_VENCIMIENTO] = ""
         with pytest.raises(HTTPException) as caso:
             await cargar_planilla(file=_subir([fila]), dry_run=False, pool=pool, user=usuario)
         assert "necesita su fecha de vencimiento" in str(caso.value.detail)
     ```

- [ ] **Step 2: Run to verify they fail.**

  ```bash
  venv/bin/python -m pytest tests/test_planilla_certificacion.py -v
  ```

  Esperado:
  - los dos tests de OPTIONAL fallan: el primero con *"no lleva fecha de vencimiento"*; el segundo da
    verde (sin fecha ya pasaba) y **queda como red de regresión**, no como prueba del cambio;
  - el de REQUIRED falla, porque no lanza.

  Si el `INSERT` del helper falla por una columna NOT NULL sin default, se agrega esa columna con el
  valor que usa el catálogo real; se consulta con
  `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='compliance_requirements'`.

- [ ] **Step 3: Implement.**

  1. **Importar** (`compliance.py`):
     - en el `SELECT` de la línea 1006, cambiar `req.has_expiration` por `req.expiration_policy`;
     - línea 1023: `if pedido["fecha"] is not None and not lleva_fecha(actual["expiration_policy"]):`;
     - línea 1039: `if estado_nuevo == "APPROVED_MANUAL" and exige_fecha(actual["expiration_policy"]) and vence_final is None:`;
     - sumar `lleva_fecha` al import de `app.services.vencimientos`.

  2. **Exportar** (`plantilla_certificacion.py`):
     - en el CTE `pendientes` (línea 98), cambiar `req.has_expiration` por `req.expiration_policy`;
     - líneas 167 y 173, con `from app.services.vencimientos import lleva_fecha_sql` arriba:

       ```python
              CASE WHEN {lleva_fecha_sql("r")}
                   THEN COALESCE(to_char(r.expiration_date, 'DD-MM-YYYY'), '')
                   ELSE '' END                             AS {COLUMNA_VENCIMIENTO},
              ...
              {lleva_fecha_sql("r")}                       AS lleva_vencimiento
       ```

     La f-string ya existe (`return f"""`). Hay que verificar que el bloque no tenga llaves literales que
     ahora haya que escapar.

- [ ] **Step 4: Run the whole file.**

  ```bash
  venv/bin/python -m pytest tests/test_planilla_certificacion.py -v
  ```

  Esperado: todo en verde, incluidos `test_los_placeholders_coinciden_con_los_argumentos` y el ida y
  vuelta.

- [ ] **Step 5: Mutation check.** Volver la línea 1039 a `actual.get("has_expiration")`, ver en rojo el
  test de REQUIRED y revertir.

- [ ] **Step 6: Commit.**

  ```bash
  git add monitor-app/backend/api/app/routers/compliance.py monitor-app/backend/api/app/services/plantilla_certificacion.py monitor-app/backend/api/tests/test_planilla_certificacion.py
  git commit -m "fix(certificacion): la planilla decide la fecha por expiration_policy"
  ```

---

### Task 3: `has_expiration` sale del contrato de la API

**Files:**
- Modify: `monitor-app/backend/api/app/routers/requirements.py:83-87` (`SQL_CATALOGO`)
- Modify: `monitor-app/backend/api/app/schemas/compliance.py:159-163`
- Modify: `monitor-app/backend/api/tests/test_requirements.py:43,54,68,94`
- Create: `monitor-app/backend/api/tests/test_sin_has_expiration.py`

- [ ] **Step 1: Write the failing guard test.** Crear `tests/test_sin_has_expiration.py`:

  ```python
  """`has_expiration` se retiró: `expiration_policy` es la única fuente (HU-C1).

  Las rutas mockeadas no lo detectarían: un SELECT que lo nombre pasa los tests y
  da 500 en producción apenas la columna no exista. Se permite sólo en
  comentarios `#`, que cuentan la historia."""
  from pathlib import Path

  APP = Path(__file__).resolve().parents[1] / "app"


  def test_ningun_codigo_de_la_api_lee_has_expiration():
      culpables = [
          f"{ruta.relative_to(APP)}:{n}"
          for ruta in APP.rglob("*.py")
          for n, linea in enumerate(ruta.read_text().splitlines(), 1)
          if "has_expiration" in linea and not linea.lstrip().startswith("#")
      ]
      assert culpables == []
  ```

- [ ] **Step 2: Run it.**

  ```bash
  venv/bin/python -m pytest tests/test_sin_has_expiration.py -v
  ```

  Esperado: FAIL, con `routers/requirements.py:83` y `schemas/compliance.py:159`.

- [ ] **Step 3: Implement.**
  - En `SQL_CATALOGO`, borrar `COALESCE(req.has_expiration, false) AS has_expiration,` y las tres líneas
    de comentario que lo justificaban. Dejar:

    ```python
               req.requirement_level,
               -- La fuente de verdad de la fecha (has_expiration se retiró, HU-C1).
               req.expiration_policy,
    ```

  - En `schemas/compliance.py`, borrar el campo `has_expiration: bool` y convertir su comentario en uno
    `#` que diga: `expiration_policy reemplazó a has_expiration (retirado en HU-C1)`.
  - En `tests/test_requirements.py`:
    - quitar `"has_expiration": True,` de los tres fixtures;
    - en la línea 54, reemplazar la aserción por:

      ```python
          assert "has_expiration" not in body[0]
          assert body[0]["expiration_policy"] == "REQUIRED"
      ```

- [ ] **Step 4: Run the full backend suite.**

  ```bash
  venv/bin/python -m pytest tests/ -q
  ```

  Esperado: verde, salvo rojos preexistentes. Se compara contra la corrida de `dev` antes del cambio; el
  AGENTLOG del 07/10 dice "suite sin rojos".

- [ ] **Step 5: Commit.**

  ```bash
  git add monitor-app/backend/api/app/routers/requirements.py monitor-app/backend/api/app/schemas/compliance.py monitor-app/backend/api/tests/test_requirements.py monitor-app/backend/api/tests/test_sin_has_expiration.py
  git commit -m "refactor(certificacion): el catálogo deja de exponer has_expiration"
  ```

---

### Task 4: Un solo control de vencimiento para crear y para editar

**Files:**
- Create: `monitor-app/frontend/app/dashboard/admin/settings/SelectorPoliticaVencimiento.tsx`
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/CondicionPanel.tsx:418-439`
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/NuevoDocumentoPanel.tsx`
- Test: `monitor-app/frontend/app/dashboard/admin/settings/NuevoDocumentoPanel.test.tsx`

**Interfaces:**
- Produces: `SelectorPoliticaVencimiento({ value, onChange, disabled? })`, con el label "Fecha de
  vencimiento" envolviendo un `<select>`.

- [ ] **Step 1: Write the failing test.** En `NuevoDocumentoPanel.test.tsx`:
  - en el test `'crea con nombre, quién lo presenta y si es obligatorio'`, agregar
    `expiration_policy: 'NONE'` al objeto esperado de `toHaveBeenCalledWith`;
  - agregar:

    ```tsx
      it('crea con la política de vencimiento elegida, con el mismo control que la edición', async () => {
        montar()
        escribirNombre('F30-1')
        fireEvent.change(screen.getByLabelText(/fecha de vencimiento/i), { target: { value: 'REQUIRED' } })
        fireEvent.click(screen.getByRole('button', { name: /^crear$/i }))

        await waitFor(() => expect(requirementsApi.create).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'F30-1', expiration_policy: 'REQUIRED' }),
        ))
      })
    ```

- [ ] **Step 2: Run to verify it fails.**

  ```bash
  npx vitest run app/dashboard/admin/settings/NuevoDocumentoPanel.test.tsx
  ```

  Esperado: FAIL. Falta el control, y el objeto esperado del test viejo no tiene `expiration_policy`.

- [ ] **Step 3: Implement.**

  1. Crear `SelectorPoliticaVencimiento.tsx` moviendo **tal cual** el bloque de `CondicionPanel.tsx`
     (líneas 418-439, con su comentario histórico):

     ```tsx
     import type { PoliticaVencimiento } from '@/lib/types'

     /** Qué hace el sistema con la fecha de vencimiento de un documento.
      *
      *  Es el MISMO control al crear y al editar (HU-C1, regla 7). Que "Nuevo
      *  documento" no lo tuviera hizo que el F30-1 naciera sin vencimiento: la
      *  política existía y se podía editar después, pero nadie la ve al crear.
      *
      *  Antes esto era `has_expiration`, un booleano con tres significados: "no
      *  vence" y "vence" compartían casilla con "la fecha es obligatoria", y por
      *  eso la carga rechazaba con 422 documentos cuya fecha la pantalla nunca
      *  pedía. Los tres estados se nombran, y quien decide cuál es cada documento
      *  es negocio, no un despliegue. */
     export function SelectorPoliticaVencimiento({ value, onChange, disabled = false }: {
       value: PoliticaVencimiento
       onChange: (politica: PoliticaVencimiento) => void
       disabled?: boolean
     }) {
       return (
         <label className="mt-4 block">
           <span className="text-etiqueta font-semibold uppercase tracking-wider text-informativo">
             Fecha de vencimiento
           </span>
           <select
             value={value}
             disabled={disabled}
             onChange={e => onChange(e.target.value as PoliticaVencimiento)}
             className="mt-1 w-full text-dato border border-border rounded-lg px-2 py-1.5 bg-white
                        disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/30"
           >
             <option value="REQUIRED">Obligatoria — sin ella el documento no se acepta</option>
             <option value="OPTIONAL">Opcional — se acepta y la fecha queda pendiente</option>
             <option value="NONE">No aplica — este documento no vence</option>
           </select>
         </label>
       )
     }
     ```

  2. En `CondicionPanel.tsx`, reemplazar el comentario y el `<label>…</label>` de las líneas 418-439 por:

     ```tsx
           <SelectorPoliticaVencimiento value={politica} onChange={setPolitica} disabled={!canEdit} />
     ```

     y sumar el import.

  3. En `NuevoDocumentoPanel.tsx`:
     - estado: `const [politica, setPolitica] = useState<PoliticaVencimiento>('NONE')`. El default es el
       mismo de la API; ahora se ve y se elige;
     - en la mutación: `name: nombre.trim(), target_entity: entidad, requirement_level: nivel, expiration_policy: politica,`;
     - el control va después del fieldset "¿Es obligatorio?" y antes del aviso "sin vigencia":
       `<SelectorPoliticaVencimiento value={politica} onChange={setPolitica} />`;
     - imports: `PoliticaVencimiento` de `@/lib/types` y el componente.

- [ ] **Step 4: Run both panels' tests.**

  ```bash
  npx vitest run app/dashboard/admin/settings/
  ```

  Esperado: verde. `CondicionPanel.test.tsx` no debería necesitar cambios, porque el label y las opciones
  son idénticos.

- [ ] **Step 5: Commit.**

  ```bash
  git add monitor-app/frontend/app/dashboard/admin/settings/SelectorPoliticaVencimiento.tsx monitor-app/frontend/app/dashboard/admin/settings/CondicionPanel.tsx monitor-app/frontend/app/dashboard/admin/settings/NuevoDocumentoPanel.tsx monitor-app/frontend/app/dashboard/admin/settings/NuevoDocumentoPanel.test.tsx
  git commit -m "feat(certificacion): Nuevo documento elige la fecha de vencimiento con el control de la edición"
  ```

---

### Task 5: Sin clasificar lee la política; `has_expiration` sale del frontend

**Files:**
- Modify: `monitor-app/frontend/lib/compliance.ts` (agregar)
- Modify: `monitor-app/frontend/components/compliance/TriageClassifyForm.tsx:64-68, 228`
- Modify: `monitor-app/frontend/lib/types.ts:1789-1792`
- Modify fixtures: `TriageClassifyForm.test.tsx:20,28`, `condiciones-tabla.test.tsx:35`,
  `celda-alias.test.tsx:19`, `CondicionPanel.test.tsx:34`, `frase-de-la-regla.test.ts:23`,
  `celdas-editables.test.tsx:15`
- Test: `monitor-app/frontend/components/compliance/TriageClassifyForm.test.tsx`

**Interfaces:**
- Produces: `llevaFecha(p: PoliticaVencimiento): boolean` y `exigeFecha(p: PoliticaVencimiento): boolean`
  en `@/lib/compliance`. Son el mismo significado que en el backend (Task 1).

- [ ] **Step 1: Write the failing test.** En `TriageClassifyForm.test.tsx`:
  - quitar `has_expiration` de `REQ` y de `REQ_FECHA`;
  - definir:

    ```tsx
    const REQ_OPCIONAL = { ...REQ, id: 'req-3', name: 'Certificado GPS',
                           expiration_policy: 'OPTIONAL' as const }
    ```

  - sumarlo al `mockResolvedValue([REQ, REQ_FECHA, REQ_OPCIONAL])` de la línea 59;
  - agregar junto a `'exige la fecha cuando el requisito la requiere'`:

    ```tsx
      it('con fecha opcional la ofrece pero no la exige', async () => {
        setup()
        await elegir('Certificado GPS')
        expect(screen.getByLabelText(/fecha de vencimiento/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /clasificar/i })).toBeEnabled()
      })

      it('un documento que no vence no pide fecha', async () => {
        setup()
        await elegir('Padrón')
        expect(screen.queryByLabelText(/fecha de vencimiento/i)).not.toBeInTheDocument()
      })
    ```

- [ ] **Step 2: Run to verify it fails.**

  ```bash
  npx vitest run components/compliance/TriageClassifyForm.test.tsx
  ```

  Esperado: FAIL en "con fecha opcional". Sin `has_expiration`, el campo no aparece.

- [ ] **Step 3: Implement.**

  1. Al final de `lib/compliance.ts`:

     ```ts
     /** Si un documento admite y si exige fecha de vencimiento. Lo decide la
      *  política del catálogo, que es la única fuente (HU-C1): el mismo
      *  significado que `lleva_fecha`/`exige_fecha` en el backend. */
     export const llevaFecha = (p: PoliticaVencimiento): boolean => p !== 'NONE'
     export const exigeFecha = (p: PoliticaVencimiento): boolean => p === 'REQUIRED'
     ```

     Y en la línea 1: `import type { ComplianceStatus, PoliticaVencimiento } from './types'`.

  2. En `TriageClassifyForm.tsx`, reemplazar la línea 65:

     ```tsx
       const muestraFecha = selected ? llevaFecha(selected.expiration_policy) : false
       const needsDate = selected ? exigeFecha(selected.expiration_policy) : false
     ```

     En la línea 228, cambiar `{needsDate && (` por `{muestraFecha && (`. `canApply` sigue usando
     `needsDate`.

  3. En `lib/types.ts`, en `RequirementOption`:
     - borrar `has_expiration: boolean`;
     - dejar el comentario de `expiration_policy` como "La fuente de verdad de la fecha
       (`has_expiration` se retiró en HU-C1)".

  4. Quitar `has_expiration: true,` de los cinco fixtures listados en Files.

- [ ] **Step 4: Run the whole frontend suite, the types and the visual ratchet.**

  ```bash
  npx vitest run && npx tsc --noEmit && npm run build
  ```

  Esperado: todo verde. `tsc` es la red que demuestra que ningún otro lector quedó.

- [ ] **Step 5: Mutation check.** Cambiar `exigeFecha` a `p !== 'NONE'`, ver en rojo "con fecha opcional"
  y revertir.

- [ ] **Step 6: Commit.**

  ```bash
  git add monitor-app/frontend/lib/compliance.ts monitor-app/frontend/lib/types.ts monitor-app/frontend/components/compliance/TriageClassifyForm.tsx monitor-app/frontend/components/compliance/TriageClassifyForm.test.tsx monitor-app/frontend/app/dashboard/admin/settings/*.test.ts*
  git commit -m "fix(certificacion): Sin clasificar pide la fecha según expiration_policy"
  ```

---

### Task 6: Desplegar a dev y verificar en vivo

- [ ] **Step 1: Push.** `git push origin dev`, sin preguntar si está verde (memoria
  *pushear directo cuando está verde*).
- [ ] **Step 2: Verify the workflows.** Confirmar que corrieron **Deploy Monitor API y Deploy Frontend**
  (`gh run list --branch dev --limit 4`) y que terminaron en verde.
- [ ] **Step 3: Click-through con Playwright en `webcarga-frontend-dev`.**
  - Abrir Configuración › Certificación › Condiciones › Nuevo documento y confirmar que el selector
    "Fecha de vencimiento" está.
  - **No crear un documento real** en producción. Si hace falta probar la creación, se crea uno con
    prefijo `ZZ-TEST`, se deja inactivo y se borra con `DELETE` vía MCP. Esto se confirma con el usuario
    antes de hacerlo (memoria *click-through: elegir entidades sin datos*).
- [ ] **Step 4: Avisarle a WebCarga, no tocar su dato.** El F30-1 real sigue en `NONE`. Cambiarlo a
  "Obligatoria" lo decide WebCarga desde Configuración, y ahora tiene efecto en todas las pantallas. Se
  anota en la agenda de la bilateral.

### Task 7a: `has_expiration` pasa a columna generada — HECHA (07/10)

*Agregada a pedido del usuario: patrón expand/contract antes del DROP.*
- Migración: `20261007120000_has_expiration_generada.sql`, aplicada el 07/10.
  `has_expiration GENERATED ALWAYS AS (expiration_policy <> 'NONE') STORED`.
- Así, un rollback de la API anterior a `5ae76d43` sigue funcionando, y la columna no se puede
  desincronizar.
- Test: `tests/test_has_expiration_generada.py`. Estuvo en rojo antes de la migración y en verde
  después.

### Task 7b: Retirar la columna (con compuerta)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261008100000_retira_has_expiration.sql`

- [ ] **Step 1: Compuerta — el riesgo es el rollback, no la API de `main`.**
  - *Corregido tras la revisión final (07/10)*: `webcarga-monitor-api` (rama `main`, 01/08) **no** lee
    `has_expiration`. `git grep has_expiration origin/main -- '*.py' '*.ts' '*.tsx'` da 0, así que el
    DROP no la rompe.
  - **El riesgo real**: después del DROP, cualquier revisión de `webcarga-monitor-api-dev` anterior a
    `5ae76d43` da 500 en el catálogo, en classify-batch y en la planilla.
  - Por eso, el DROP va **después de un día estable** con la versión nueva en dev, sin rollback.
  - Si después hiciera falta volver atrás de `5ae76d43`, primero:
    `ALTER TABLE public.compliance_requirements ADD COLUMN has_expiration boolean DEFAULT false`.
  - Se le confirma al usuario antes de aplicar, porque es irreversible.

- [ ] **Step 2: Confirmar que nada de la base la usa** (con psql, solo lectura). Las cuatro tienen que
  dar 0 filas:

  ```sql
  SELECT viewname FROM pg_views WHERE definition ILIKE '%has_expiration%';
  SELECT proname FROM pg_proc WHERE prosrc ILIKE '%has_expiration%';
  SELECT policyname FROM pg_policies WHERE qual ILIKE '%has_expiration%' OR with_check ILIKE '%has_expiration%';
  SELECT matviewname FROM pg_matviews WHERE definition ILIKE '%has_expiration%';
  ```

  El 07/10, vistas, funciones y triggers dieron 0. Además, `grep -r has_expiration .mage-agent/local_sync`
  no debe encontrar nada en Mage ni en dbt.

- [ ] **Step 3: Write the migration.**

  ```sql
  -- HU-C1, entrega 1: expiration_policy es la única fuente de "este documento vence".
  --
  -- has_expiration se conservó en 20260820100000 "porque tiene lectores vivos".
  -- Ya no los tiene (tests/test_sin_has_expiration.py lo cuida en la API, y el
  -- frontend dejó de recibirlo). Mantenerlo era la trampa: Configuración no lo
  -- edita, así que todo documento creado o editado desde la pantalla quedaba con
  -- las dos columnas en desacuerdo (el F30-1, 01/10/2026).
  ALTER TABLE public.compliance_requirements DROP COLUMN has_expiration;
  ```

- [ ] **Step 4: Aplicar** con `mcp__claude_ai_Supabase__apply_migration` al proyecto `webcarga-core-db`.
  - Nombre: `retira_has_expiration`.
  - Va **después** de que el Deploy Monitor API de Task 6 esté verde.
- [ ] **Step 5: Verify against the real DB.**
  - Correr la suite de integración: `venv/bin/python -m pytest tests/ -m integracion -q`.
  - Hacer un GET al catálogo en dev: `/api/v1/compliance-requirements` responde 200.
- [ ] **Step 6: Commit and push.**

  ```bash
  git add monitor-app/backend/supabase/migrations/20261008100000_retira_has_expiration.sql
  git commit -m "chore(db): retira compliance_requirements.has_expiration"
  git push origin dev
  ```

- [ ] **Step 7: AGENTLOG.md.**
  - Marcar la entrega 1 de C1 como hecha.
  - Siguiente paso: el resto de la política de vigencia, cuando Pablo valide el patrón.
