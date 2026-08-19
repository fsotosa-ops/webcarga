# La ficha de empresa, los dos mundos y las colisiones · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`).

**Goal:** Que Certificación deje de enseñar sólo la mitad de lo que sabe — que se vea lo que una
empresa **tiene** y no sólo lo que le falta, y que dos archivos que reclaman el mismo casillero se
señalen antes de que uno destruya al otro.

**Architecture:** `_PENDING_ROWS_SQL` deja de tener el predicado incrustado y gana un parámetro de
estado; sobre eso, una ruta `/dashboard/compliance/[carrierId]` muestra empresa, conductores y
vehículos con el filtro `Todo · Falta · Por vencer · Al día`. El sidebar parte Certificación en dos
entradas reusando el `NavGroup` que ya existe. Y la cola de la Bandeja deriva dos señales de
colisión en la misma pasada, con el patrón que ya usa `jsonb_array_length(candidates)`.

**Tech Stack:** FastAPI + asyncpg sobre Postgres (Supabase); Next.js 15 App Router + React Query +
Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-19-ficha-empresa-y-colisiones-design.md`
**Mockup acordado:** https://claude.ai/code/artifact/8e7bd1f6-b812-4e01-b1e5-2cdcf2bf319e

## Global Constraints

- **Español neutral, nunca voseo.** "Elige", "Arrastra", "Guarda", "puedes". Lo verifica
  `lib/copy/espanol-neutral.test.ts`, que recorre el código fuente.
- **Cero emojis.** Sólo `lucide-react`.
- **Etiqueta en español, ruta en inglés.**
- **Los trinquetes visuales están en MARGEN CERO**: color crudo **1.755/1.755**
  (`lib/ui/sistema.test.ts`), tamaños <11px **268/268** (`lib/ui/escala.test.ts`), `<h1>` 9/9.
  Todo color nuevo usa tokens de `app/globals.css` (`accent`, `espera`, `accion`, `resuelto`,
  `informativo`, `text-primary`, `border`); todo tamaño usa la escala (`text-etiqueta` 11px,
  `text-dato` 13px, `text-lectura` 15px, `text-titulo` 20px, `text-cifra` 28px).
  **Si un archivo migra colores viejos a tokens, baja el tope en el mismo commit.**
- **Una cifra derivada no se muestra hasta tener el dato.** Un `?? 0` en una cifra grande afirma algo
  falso mientras la consulta está en vuelo — ya pasó en Certificación, que mostraba "0 documentos por
  cubrir" y después saltaba a 2.360.
- **No hay migración.** Todas las columnas que este plan usa ya existen.
- **El SQL nuevo se verifica contra Postgres real**, no contra `AsyncMock`, y todo endpoint
  modificado lleva un test que cuenta placeholders (`$n`) contra argumentos — ver
  `test_compliance.py::test_pending_rows_binds_exactly_the_parameters_it_references`.
- **Cada test nuevo se muta antes de darlo por bueno.** Si no muere, está mal escrito: arreglalo y
  contá qué cambiaste. **Pasó dos veces en la rama anterior y las dos veces el defecto era del plan.**
- **Backend venv**: `monitor-app/backend/api/venv` (no `.venv`, no anaconda).
- **Corré las suites SEPARADAS y no las mates a mitad.** `max_connections` de esta base es **60**:
  `pytest -q -m "not integracion"` (~25 s), después `pytest -q -m integracion` (~7 min).
- **`npm run build` es lo único que confirma que una ruta nueva entró al manifest de Next.**
- **PII**: RUTs y nombres de personas reales. Nunca en tests, comentarios, reportes ni commits.
- **Nada de código muerto.** Lo que quede sin consumidores se borra en el mismo commit, con el
  `grep` que lo prueba en el mensaje.

---

## Estructura de archivos

**Backend** (`monitor-app/backend/api`)
- Modificar: `app/routers/compliance.py` — `_PENDING_ROWS_SQL` gana el parámetro de estado.
- Modificar: `app/routers/document_ingest.py` — el hash al subir, y las dos señales en la cola.
- Modificar: `app/utils/document_storage.py` — `upload_document_version` devuelve el sha256.
- Modificar: `app/schemas/document_ingest.py` — `QueueRow` gana las dos señales.

**Frontend** (`monitor-app/frontend`)
- Crear: `app/dashboard/compliance/[carrierId]/page.tsx` — la ficha.
- Crear: `components/compliance/FiltroDeEstado.tsx` — el filtro, un componente porque lo comparten
  la ficha y (después) la lista.
- Modificar: `components/dashboard/Sidebar.tsx` — Certificación pasa a `NAV_GROUPS`.
- Modificar: `app/dashboard/compliance/page.tsx` — la fila navega a la ficha; la Bandeja sale a su
  ruta.
- Crear: `app/dashboard/compliance/inbox/page.tsx` — la Bandeja con su ruta propia.
- Modificar: `components/compliance/TriageWorkbench.tsx` — la Bandeja global pide empresa antes de
  subir.
- Modificar: `components/compliance/TriageFileTable.tsx` — las dos señales de colisión.
- Modificar: `lib/api/compliance.ts`, `lib/types.ts` — el filtro de estado viaja en los tipos.

---

## Task 1: `/pending` deja de tener el predicado incrustado

Es la primera porque **todo lo demás se apoya en ella**, y porque es la única que puede mover
conteos que operaciones ya mira.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/compliance.py:397-420` (`_PENDING_ROWS_SQL`) y
  `:500-530` (`list_pending_compliance_records`)
- Test: `monitor-app/backend/api/tests/test_compliance.py`

**Interfaces:**
- Produces: `GET /compliance-records/pending` acepta
  `estado: 'falta' | 'por_vencer' | 'al_dia' | 'todos'`, **con `'falta'` de default**.

- [ ] **Step 1: Medir el punto de partida contra producción**

Antes de tocar el SQL, dejá registrado qué devuelve hoy:

```sql
SELECT count(*) FROM public.compliance_records cr
JOIN public.compliance_requirements req ON req.id = cr.requirement_id
WHERE cr.is_current
  AND (cr.status IN ('MISSING','EXPIRED')
       OR (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE)
       OR (cr.expiration_date IS NOT NULL AND cr.expiration_date >= CURRENT_DATE
           AND cr.expiration_date <= CURRENT_DATE + INTERVAL '30 days'));
```

Esperado, medido el 2026-08-19: **5.038**. Si cambió, anotá el número nuevo y seguí — el dato se
mueve solo. Lo que **no** puede cambiar es que con `estado='falta'` el endpoint devuelva ese mismo
total después del cambio.

- [ ] **Step 2: Escribir los tests que fallan**

En `tests/test_compliance.py`:

```python
def test_pending_sin_estado_se_comporta_igual_que_antes():
    """El default es `falta` para que ningun llamador actual cambie de
    comportamiento. El cajon, el embudo y la exportacion piden /pending sin
    parametro y tienen que seguir viendo lo mismo."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending")

    sql = pool.fetch.call_args.args[0]
    assert "$10" in sql, "el estado tiene que viajar como parametro, no interpolado"
    assert pool.fetch.call_args.args[10] == "falta"


def test_pending_con_estado_todos_no_filtra():
    """Es lo que hace posible la ficha: ver lo que la empresa TIENE, no solo lo
    que le falta. Hoy los 23 documentos cargados de la unica empresa con
    documentacion no aparecen en ninguna pantalla del modulo."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending?estado=todos")

    assert pool.fetch.call_args.args[10] == "todos"


def test_pending_rechaza_un_estado_inventado():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending?estado=cualquiera")

    assert res.status_code == 422


def test_el_sql_de_pending_bindea_exactamente_lo_que_referencia():
    """El SQL pasa de 9 a 10 placeholders. Un $n de mas o de menos no falla al
    desplegar: asyncpg tira un error de binding en la primera consulta real."""
    import re
    from app.routers.compliance import _PENDING_ROWS_SQL

    referenciados = {int(n) for n in re.findall(r"\$(\d+)", _PENDING_ROWS_SQL)}
    assert referenciados == set(range(1, 11)), (
        f"el SQL referencia {sorted(referenciados)}; se esperaban 1..10"
    )
```

- [ ] **Step 3: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_compliance.py -q -k "estado or bindea_exactamente"
```

Esperado: FAIL — hoy no existe el parámetro.

- [ ] **Step 4: Generalizar el SQL**

En `_PENDING_ROWS_SQL`, el `WHERE` del CTE `pending` (línea ~405) pasa de tener el predicado fijo a
elegirlo por parámetro:

```sql
WITH pending AS (
    SELECT cr.id, cr.entity_type, cr.entity_id, cr.status, cr.expiration_date,
           req.id AS requirement_id,
           req.requirement_code, req.name AS document_name, req.requirement_level,
           req.expiration_policy
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    WHERE cr.is_current = true
      -- El estado deja de estar incrustado. `falta` es el default y reproduce
      -- exactamente el predicado anterior, para que ningun llamador actual
      -- cambie de comportamiento. `todos` es lo que hace posible la ficha:
      -- ver lo que la empresa TIENE y no solo lo que le falta.
      AND CASE $10::text
            WHEN 'todos'      THEN true
            WHEN 'por_vencer' THEN {por_vencer_predicate('cr')}
            WHEN 'al_dia'     THEN NOT {pendiente_predicate('cr')}
            ELSE {pendiente_predicate('cr')}
          END
),
```

**Ojo con `al_dia`**: es `NOT pendiente`, no "status aprobado". Un registro cubierto es exactamente
el complemento de uno pendiente — definirlo aparte crea dos definiciones de lo mismo, que es el
defecto que este módulo ya tuvo cuando el embudo y el cajón discrepaban.

- [ ] **Step 5: Agregar el parámetro al endpoint**

En `list_pending_compliance_records`, la firma gana:

```python
    estado: Literal["falta", "por_vencer", "al_dia", "todos"] = Query(
        "falta",
        description="Qué mostrar. `falta` (default) reproduce el comportamiento "
                    "anterior; `todos` es lo que usa la ficha de empresa.",
    ),
```

y la llamada suma `estado` como **décimo** argumento, después de `entity_id`:

```python
    rows = await pool.fetch(
        _PENDING_ROWS_SQL,
        carrier_id, category, requirement_code, q or None, operation_type, limit, offset,
        ACTIVE_OPERATIONAL_STATUS, entity_id, estado,
    )
```

- [ ] **Step 6: Correr todo el backend rápido**

```bash
venv/bin/python -m pytest tests/ -q -m "not integracion"
```

Esperado: todos verdes. **Si algún test del embudo cambia de número, entendé por qué antes de
ajustarlo** — puede ser el bug de las tres lecturas desalineadas volviendo.

- [ ] **Step 7: Verificar contra Postgres real, con los cuatro estados**

```python
# scratch, no commitear
import asyncio, asyncpg, sys
sys.path.insert(0, ".")
from tests.conftest import credenciales_integracion
from app.routers.compliance import _PENDING_ROWS_SQL, ACTIVE_OPERATIONAL_STATUS

async def main():
    conn = await asyncpg.connect(**credenciales_integracion())
    for estado in ("falta", "por_vencer", "al_dia", "todos"):
        filas = await conn.fetch(_PENDING_ROWS_SQL, None, None, None, None, None,
                                 5, 0, ACTIVE_OPERATIONAL_STATUS, None, estado)
        print(estado, "→ total:", filas[0]["total_count"] if filas else 0)
    await conn.close()

asyncio.run(main())
```

Esperado: `falta` da **5.038** (el número del Step 1), `todos` da más, `al_dia` = `todos` − `falta`.
**Si `al_dia` + `falta` ≠ `todos`, detente**: los predicados dejaron de ser complementarios.

- [ ] **Step 8: Mutar**

Cambiá el `ELSE` del CASE por `true`. Esperado: falla
`test_pending_sin_estado_se_comporta_igual_que_antes`… **y si no falla, ese test está mal escrito**
— reforzalo para que compruebe el comportamiento y no sólo el argumento. Restaurá.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/backend/api/app/routers/compliance.py \
        monitor-app/backend/api/tests/test_compliance.py
git commit -m "feat(certificacion): /pending deja de mostrar solo lo que falta"
```

---

## Task 2: Las dos señales de colisión en la cola

Independiente de la ficha. Se puede hacer en paralelo conceptualmente, pero **va antes que el
frontend de la Bandeja** porque la pantalla las consume.

**Files:**
- Modify: `monitor-app/backend/api/app/utils/document_storage.py:42-64`
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py` (el `INSERT` de `_ingest_files`,
  y la consulta de `list_queue` ~250-272)
- Modify: `monitor-app/backend/api/app/schemas/document_ingest.py` (`QueueRow`)
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Produces: `upload_document_version` devuelve además `"content_sha256": str`.
  `QueueRow` gana `mismo_contenido: int` y `mismo_casillero: int` — **cuántos ítems pendientes de la
  cola comparten ese contenido / ese destino, incluyéndose a sí mismo.** `1` significa "ninguna
  colisión".

- [ ] **Step 1: Escribir los tests que fallan**

```python
def test_el_hash_del_contenido_se_calcula_al_subir():
    """La columna `content_sha256` existe desde la migracion 20260814130000 y
    NADIE la escribia: 0 valores distintos sobre 65 filas. Sin ella, dos
    cargas del mismo archivo son dos archivos."""
    import hashlib
    from app.utils.document_storage import upload_document_version

    contenido = b"%PDF-1.4 contenido de prueba"
    esperado = hashlib.sha256(contenido).hexdigest()
    # (armá el UploadFile y el supabase falso con la forma que ya usan los
    # tests de este archivo — `grep -n "upload_document_version" tests/`)
    resultado = ...  # await upload_document_version(supabase, key_prefix="x", file=archivo)

    assert resultado["content_sha256"] == esperado


def test_la_cola_avisa_cuando_dos_archivos_reclaman_el_mismo_casillero():
    """`classify-batch` ya se protege de N archivos a un casillero en UNA
    operacion —su docstring cuenta que "marcar 31 licencias y asignarlas al
    mismo conductor destruia 30"— pero el clasificador propone el mismo
    (entity_id, requirement_id) a archivos DISTINTOS, y el operador los
    confirma de a uno: exactamente lo que ese guardia permite."""
    pool = AsyncMock()
    pool.fetchval.return_value = 2
    pool.fetch.return_value = [
        _queue_row(id="a", mismo_casillero=2, mismo_contenido=1),
        _queue_row(id="b", mismo_casillero=2, mismo_contenido=1),
    ]
    client = make_client(pool)

    filas = client.get("/api/v1/document-ingest/items").json()["rows"]

    assert [f["mismo_casillero"] for f in filas] == [2, 2]


def test_el_sql_de_la_cola_no_agrupa_los_sin_destino():
    """LA GUARDA DE NULL. Sin ella, los ~60 items UNMATCHED con entity_id nulo
    caen en la MISMA particion y la pantalla diria que todos reclaman el mismo
    casillero. Es el peor falso positivo posible: aparece justo cuando la cola
    esta llena de trabajo real."""
    from app.routers.document_ingest import _SQL_COLA

    assert "i.entity_id IS NOT NULL" in _SQL_COLA
    assert "i.requirement_id IS NOT NULL" in _SQL_COLA
    assert "i.content_sha256 IS NOT NULL" in _SQL_COLA
```

**`_queue_row(...)`**: si el archivo no tiene un helper de fila de cola, escribilo con los campos que
`QueueRow` declara. Copiá la forma de `_pending_row` en `tests/test_compliance.py`.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
venv/bin/python -m pytest tests/test_document_ingest.py -q -k "hash_del_contenido or mismo_casillero or no_agrupa"
```

- [ ] **Step 3: Calcular el hash donde el contenido ya está leído**

En `app/utils/document_storage.py`, dentro de `upload_document_version`, después de
`data = await file.read()`:

```python
    # El hash va acá y no en el router porque acá el contenido YA esta leido:
    # calcularlo en otro lado obligaria a leer el archivo dos veces.
    content_sha256 = hashlib.sha256(data).hexdigest()
```

y sumarlo al dict de retorno:

```python
    return {
        "storage_path": storage_path,
        "file_name": file.filename or "archivo",
        "mime_type": mime,
        "size_bytes": len(data),
        "content_sha256": content_sha256,
    }
```

Agregá `import hashlib` a la cabecera del módulo.

- [ ] **Step 4: Persistirlo**

En `document_ingest.py`, el `INSERT` de `_ingest_files` suma la columna. **Es un `INSERT` de 12
columnas que pasa a 13: contá los placeholders contra los argumentos.** Un `$n` desalineado no falla
al desplegar — escribe un valor en la columna equivocada, en silencio.

- [ ] **Step 5: Derivar las dos señales en la consulta de la cola**

Extraé la consulta de `list_queue` a una constante de módulo `_SQL_COLA` (hoy es un f-string
inline), y sumale las dos columnas junto a `candidate_count`, que es el patrón que este módulo ya
usa para derivar en una sola pasada:

```sql
               jsonb_array_length(i.candidates)           AS candidate_count,
               -- Las dos senales de colision, derivadas en la MISMA pasada.
               -- Se cuentan sobre toda la cola filtrada, no sobre la pagina:
               -- las window functions corren despues del WHERE y antes del
               -- LIMIT, que es exactamente lo que hace falta.
               --
               -- LA GUARDA DE NULL NO ES OPCIONAL: sin ella, los items sin
               -- destino (entity_id NULL) caen todos en la misma particion y
               -- la pantalla diria que reclaman el mismo casillero.
               CASE WHEN i.entity_id IS NOT NULL AND i.requirement_id IS NOT NULL
                    THEN count(*) OVER (PARTITION BY i.entity_id, i.requirement_id)
                    ELSE 1 END                            AS mismo_casillero,
               CASE WHEN i.content_sha256 IS NOT NULL
                    THEN count(*) OVER (PARTITION BY i.content_sha256)
                    ELSE 1 END                            AS mismo_contenido
```

Y en `app/schemas/document_ingest.py`, `QueueRow` gana:

```python
    # Cuantos items pendientes comparten este destino / este contenido,
    # incluyendose a si mismo. 1 = sin colision.
    #
    # Son DOS senales y no una aunque compartan forma, porque piden acciones
    # distintas: mismo contenido -> "este archivo ya esta en la cola, borra
    # uno"; mismo destino -> "dos archivos distintos reclaman el casillero,
    # elige cual".
    mismo_casillero: int = 1
    mismo_contenido: int = 1
```

- [ ] **Step 6: Correr y verificar contra Postgres real**

```bash
venv/bin/python -m pytest tests/test_document_ingest.py -q
venv/bin/python -m pytest tests/ -q -m "not integracion"
```

Y la consulta contra la base, que es donde se ve la guarda de NULL funcionando:

```sql
SELECT mismo_casillero, count(*) FROM (
  SELECT CASE WHEN i.entity_id IS NOT NULL AND i.requirement_id IS NOT NULL
              THEN count(*) OVER (PARTITION BY i.entity_id, i.requirement_id)
              ELSE 1 END AS mismo_casillero
  FROM public.document_ingest_items i
) x GROUP BY 1;
```

Esperado hoy: **65 filas con `mismo_casillero = 1`** — ninguna tiene destino todavía. Si diera 65
con el valor 65, la guarda de NULL no está puesta.

- [ ] **Step 7: Mutar**

Quitá la guarda `CASE WHEN i.entity_id IS NOT NULL …` y dejá el `count(*) OVER` desnudo. Esperado:
falla `test_el_sql_de_la_cola_no_agrupa_los_sin_destino`. Restaurá.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/backend/api/app/utils/document_storage.py \
        monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/app/schemas/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "feat(bandeja): dos archivos que reclaman el mismo casillero dejan de ser invisibles"
```

---

## Task 3: El filtro de estado, como componente

**Files:**
- Create: `monitor-app/frontend/components/compliance/FiltroDeEstado.tsx`
- Test: `monitor-app/frontend/components/compliance/FiltroDeEstado.test.tsx`
- Modify: `monitor-app/frontend/lib/types.ts`, `monitor-app/frontend/lib/api/compliance.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EstadoDocumental = 'todos' | 'falta' | 'por_vencer' | 'al_dia'
  export function FiltroDeEstado(props: {
    valor:     EstadoDocumental
    onCambiar: (e: EstadoDocumental) => void
    conteos?:  Partial<Record<EstadoDocumental, number>>
  }): JSX.Element
  ```
  Y `complianceApi.listPending` acepta `estado?: EstadoDocumental`.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FiltroDeEstado } from './FiltroDeEstado'

describe('FiltroDeEstado', () => {
  it('marca cuál está activo, de forma accesible', () => {
    render(<FiltroDeEstado valor="falta" onCambiar={vi.fn()} />)
    expect(screen.getByRole('button', { name: /falta/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /al día/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('avisa cuál se eligió', () => {
    const onCambiar = vi.fn()
    render(<FiltroDeEstado valor="falta" onCambiar={onCambiar} />)
    fireEvent.click(screen.getByRole('button', { name: /al día/i }))
    expect(onCambiar).toHaveBeenCalledWith('al_dia')
  })

  it('muestra el conteo cuando lo tiene', () => {
    render(<FiltroDeEstado valor="todos" onCambiar={vi.fn()} conteos={{ todos: 33, falta: 10 }} />)
    expect(screen.getByRole('button', { name: /todo.*33/i })).toBeInTheDocument()
  })

  it('NO inventa un cero cuando el conteo todavía no llegó', () => {
    // Regla del proyecto: una cifra derivada no se muestra hasta tener el dato.
    // Un `?? 0` afirma algo falso mientras la consulta esta en vuelo — ya paso
    // en Certificacion, que mostraba "0 documentos por cubrir" y despues
    // saltaba a 2.360.
    render(<FiltroDeEstado valor="todos" onCambiar={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Todo$/ })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/frontend
npx vitest run components/compliance/FiltroDeEstado.test.tsx
```

- [ ] **Step 3: Escribir el componente**

Requisitos no negociables:

- **Sólo tokens y escala**: `text-etiqueta`/`text-dato`, `bg-accent`, `border-border`,
  `text-informativo`. Nada de `text-gray-*` ni `text-[10px]`.
- El activo lleva `aria-pressed="true"` y fondo `bg-accent`.
- Las etiquetas en español neutral: **Todo · Falta · Por vencer · Al día**.
- `font-variant-numeric: tabular-nums` en los conteos (`tabular-nums` de Tailwind), porque cambian y
  no tienen que bailar.
- **Sin conteo, sólo la etiqueta.** Nunca un cero inventado.

- [ ] **Step 4: Sumar el estado al cliente y a los tipos**

En `lib/types.ts`, junto a `Urgencia`:

```ts
/** Qué mostrar de la documentación de una empresa. `falta` es el default del
 *  backend y reproduce el comportamiento anterior a la ficha. */
export type EstadoDocumental = 'todos' | 'falta' | 'por_vencer' | 'al_dia'
```

Y en `lib/api/compliance.ts`, `ListPendingParams` gana `estado?: EstadoDocumental`, que viaja como
`qs.set('estado', params.estado)` **sólo si viene** — mismo criterio que `scope` en `listStatus`:
mandarlo igual ensucia la clave de caché de React Query sin necesidad.

- [ ] **Step 5: Correr, verificar trinquetes y mutar**

```bash
npx vitest run components/compliance/FiltroDeEstado.test.tsx lib/ui/
npx tsc --noEmit
```

Mutación: hacé que el conteo caiga a `?? 0`. Esperado: falla "NO inventa un cero". Restaurá.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance/FiltroDeEstado.tsx \
        monitor-app/frontend/components/compliance/FiltroDeEstado.test.tsx \
        monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/compliance.ts
git commit -m "feat(certificacion): el filtro de estado documental, un componente"
```

---

## Task 4: La ficha de empresa

**Files:**
- Create: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx`
- Test: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.test.tsx`

**Interfaces:**
- Consumes: `FiltroDeEstado` y `EstadoDocumental` (Task 3); `complianceApi.listPending({ carrierId,
  estado })` (Tasks 1 y 3); `RenglonPendiente` y `useSubirDocumento`, que ya existen.

- [ ] **Step 1: Leer lo que ya resuelve el cajón, para no reescribirlo**

```bash
cd monitor-app/frontend
sed -n '95,130p' components/compliance/CarrierDrawer.tsx
```

Lo que hay que **reusar tal cual**: el agrupado por sujeto (`sujetos`, con el orden
CARRIER→DRIVER→ASSET y el título "De la empresa"), `RenglonPendiente` para lo que falta, y
`useSubirDocumento` para subir. **No escribas una segunda versión de nada de eso.**

- [ ] **Step 2: Escribir los tests que fallan**

```tsx
it('muestra la empresa, sus conductores y sus vehículos juntos', async () => {
  montar([
    fila({ id: 'p1', entity_type: 'CARRIER', subject_name: null }),
    fila({ id: 'p2', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
    fila({ id: 'p3', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' }),
  ])
  expect(await screen.findByText('De la empresa')).toBeInTheDocument()
  expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
  expect(screen.getByText('HKXW55')).toBeInTheDocument()
})

it('empieza mostrando TODO, no sólo lo que falta', async () => {
  // Es la razon de ser de la pantalla: los 23 documentos cargados de la unica
  // empresa con documentacion no aparecian en ningun lado del modulo.
  montar([fila()])
  await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
    expect.objectContaining({ estado: 'todos' }),
  ))
})

it('cambiar el filtro vuelve a pedir con ese estado', async () => {
  montar([fila()])
  await screen.findByText('De la empresa')
  fireEvent.click(screen.getByRole('button', { name: /al día/i }))
  await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
    expect.objectContaining({ estado: 'al_dia' }),
  ))
})

it('un documento cargado se puede ver; uno que falta se puede cargar', async () => {
  montar([
    fila({ id: 'p1', status: 'APPROVED_MANUAL', document_name: 'Certificado de Vigencia' }),
    fila({ id: 'p2', status: 'MISSING', document_name: 'Rol SII' }),
  ])
  expect(await screen.findByRole('button', { name: /ver/i })).toBeInTheDocument()
  expect(screen.getByTestId('archivo-p2')).toBeInTheDocument()
})

it('sin documentos dice por dónde empezar, no una tabla vacía', async () => {
  // Es el caso de 32 de las 34 empresas activas.
  montar([])
  expect(await screen.findByText(/nadie cargó documentos/i)).toBeInTheDocument()
})

it('un lector ve todo y no puede cargar nada', async () => {
  vi.mocked(useCanEdit).mockReturnValue(false)
  montar([fila({ id: 'p1', status: 'MISSING' })])
  expect(await screen.findByText('De la empresa')).toBeInTheDocument()
  expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
})
```

**El helper `montar(filas)`** arma el `QueryClientProvider` y mockea `complianceApi.listPending`;
copiá su forma de `CarrierDrawer.test.tsx`, que ya lo hace.

- [ ] **Step 3: Correr y verificar que fallan**

```bash
npx vitest run "app/dashboard/compliance/[carrierId]"
```

Esperado: FAIL — la ruta no existe.

- [ ] **Step 4: Escribir la página**

La estructura sale del mockup acordado:

1. **Migas** — `Empresas › <nombre>`, con el primero enlazando a `/dashboard/compliance`.
2. **Encabezado** — nombre, RUT en `font-identificador`, y los chips de etapa y tipo de operación.
3. **Cuatro cifras** — Al día · Faltan · Por vencer · Requisitos. Usar el componente `Cifra` que ya
   existe (`components/ui/Cifra.tsx`), que **ya sabe no inventar un cero mientras carga**.
4. **`<FiltroDeEstado>`**.
5. **Los sujetos**, con el mismo agrupado del cajón. Cada renglón:
   - si `status` es `MISSING`/`EXPIRED` → `<RenglonPendiente>` (carga)
   - si tiene documento → nombre, fecha, estado y **"Ver"**
6. **El puente**: `¿Tienes muchos documentos de {nombre}?` + enlace a `/dashboard/compliance/inbox`.

**Para "Ver"**: reusá `DocumentPreviewModal` de `components/dashboard/`, que ya existe y ya firma la
URL al abrirse. **No firmes URLs en el listado** — es una llamada HTTP por archivo y la página
muestra 33.

- [ ] **Step 5: Correr, build, trinquetes**

```bash
npx vitest run app/dashboard/compliance components/compliance lib/ui
npx tsc --noEmit
npm run build      # lo unico que confirma que la ruta entro al manifest
```

- [ ] **Step 6: Mutar**

Cambiá el `estado: 'todos'` inicial por `'falta'`. Esperado: falla "empieza mostrando TODO".
Restaurá.

- [ ] **Step 7: Commit**

```bash
git add "monitor-app/frontend/app/dashboard/compliance/[carrierId]"
git commit -m "feat(certificacion): la ficha de una empresa, con lo que tiene y lo que le falta"
```

---

## Task 5: Los dos mundos en el sidebar, y la Bandeja con ruta propia

**Files:**
- **Modify** (NO crear — ya existe): `monitor-app/frontend/app/dashboard/compliance/inbox/page.tsx`
- Modify: `monitor-app/frontend/components/dashboard/Sidebar.tsx:32-50`
- Modify: `monitor-app/frontend/app/dashboard/compliance/page.tsx`
- Modify: `monitor-app/frontend/components/compliance/CarrierDrawer.tsx:204`
- Test: `monitor-app/frontend/components/dashboard/Sidebar.test.tsx`,
  `app/dashboard/compliance/page.test.tsx`, `components/compliance/CarrierDrawer.test.tsx`

> **ESTA TAREA REVIERTE UNA DECISIÓN QUE EL MÓDULO YA TOMÓ, y hay que saberlo.**
> `app/dashboard/compliance/inbox/page.tsx` **ya existe** y hoy hace lo contrario de lo que este
> plan pide: redirige `/inbox` → `?vista=documentos`. Su comentario dice por qué:
>
> > *"La bandeja dejó de ser un destino propio: es la vista 'Por documento' del módulo
> > Certificación. Tenerla como submódulo hermano de Pendientes obligaba a cruzar de memoria dos
> > listas del mismo objeto. **La ruta se conserva porque quedó en enlaces guardados y en el
> > historial.**"*
>
> La spec argumenta por qué se revierte: aquella decisión trataba a la Bandeja como *una vista más
> de la misma lista*, y no lo es — es otro objeto (archivos sin destino contra requisitos sin
> documento). Pero **la razón por la que aquel redirect se conservó sigue siendo válida y ahora
> aplica al revés**: los enlaces guardados a `?vista=documentos` no pueden quedar rotos.

**Interfaces:**
- Consumes: la ruta `/dashboard/compliance/[carrierId]` (Task 4).

- [ ] **Step 1: Leer por qué el sidebar está como está**

```bash
sed -n '18,50p' components/dashboard/Sidebar.tsx
```

Vas a encontrar dos comentarios que **este cambio tiene que respetar**:

- *"Certificación es UNA lista de empresas con dos maneras de mirarla, no tres submódulos"* — eso
  defiende que **las cuatro agrupaciones** (Empresa/Conductor/Vehículo/Requisito) no se partan.
  **Siguen dentro de Empresas: no las toques.**
- *"sumar un segundo grupo obligaba a duplicar ~55 líneas — que fue exactamente la razón
  equivocada"* por la que la Bandeja quedó fuera. Por eso existe `NavGroup`: **úsalo, no dupliques.**

Lo que sí se mueve es la Bandeja, y el propio código ya dice por qué puede: *"La bandeja vive detrás
de su propio botón, con contador: **no es una agrupación más**"*.

- [ ] **Step 2: Escribir los tests que fallan**

```tsx
it('Certificación se abre en Empresas y Sin clasificar', () => {
  render(<Sidebar />)
  expect(screen.getByRole('link', { name: /empresas/i }))
    .toHaveAttribute('href', '/dashboard/compliance')
  expect(screen.getByRole('link', { name: /sin clasificar/i }))
    .toHaveAttribute('href', '/dashboard/compliance/inbox')
})

it('el contador de la Bandeja vive en su entrada, no en el grupo', () => {
  render(<Sidebar />)   // con el mock de inboxCount que el archivo ya usa
  const bandeja = screen.getByRole('link', { name: /sin clasificar/i })
  expect(bandeja).toHaveTextContent('12')
})

it('sin archivos esperando no dibuja un cero', () => {
  // Un cero en rojo pediria atencion sobre nada. Es la regla que el boton
  // actual ya cumple y que este cambio no puede perder.
  render(<Sidebar />)   // con inboxCount = 0
  const bandeja = screen.getByRole('link', { name: /sin clasificar/i })
  expect(bandeja).not.toHaveTextContent('0')
})
```

- [ ] **Step 3: Correr y verificar que fallan**

```bash
npx vitest run components/dashboard/Sidebar.test.tsx
```

- [ ] **Step 4: Mover Certificación a `NAV_GROUPS`**

```tsx
const NAV_GROUPS: NavGroupDef[] = [
  {
    label: 'Operaciones',
    icon:  Truck,
    items: [
      { href: '/dashboard/operations/monitor', label: 'Monitor' },
    ],
  },
  // Certificación se abre en DOS porque son dos trabajos, no dos vistas: la
  // Bandeja responde "¿de quién es este archivo?" sobre archivos sin destino,
  // y Empresas responde "¿qué le falta a esta empresa?" sobre requisitos sin
  // documento. Las CUATRO agrupaciones (Empresa/Conductor/Vehículo/Requisito)
  // NO se parten: siguen adentro de Empresas, porque ésas sí son cuatro
  // maneras de mirar la misma lista.
  {
    label: 'Certificación',
    icon:  BadgeCheck,
    items: [
      { href: '/dashboard/compliance',       label: 'Empresas' },
      { href: '/dashboard/compliance/inbox', label: 'Sin clasificar', badge: 'inbox' },
    ],
  },
]
```

y sacá Certificación de `NAV_ITEMS`. **Ojo con el `activeHref` de `NavGroup`**: ya elige el match más
específico primero (`/dashboard/compliance/inbox` gana sobre `/dashboard/compliance`, que es su
prefijo), así que no hay que tocarlo — pero **verificá que la ficha
`/dashboard/compliance/<uuid>` marque "Empresas" y no "Sin clasificar"**.

- [ ] **Step 5: La Bandeja gana su ruta, y el redirect se da vuelta**

**Primero el test, porque un enlace roto no falla en CI — falla en la cara de quien lo guardó:**

```tsx
// app/dashboard/compliance/page.test.tsx
it('un enlace guardado a ?vista=documentos lleva a la Bandeja, no a una pantalla vacía', async () => {
  // La ruta /inbox existía y redirigía HACIA acá; ahora es al revés. La razón
  // por la que aquel redirect se conservó —"quedó en enlaces guardados y en el
  // historial"— sigue siendo válida, sólo que en la otra dirección.
  montarConParametros('?vista=documentos')
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/compliance/inbox'))
})
```

Después:

1. **`app/dashboard/compliance/inbox/page.tsx` deja de redirigir y monta la Bandeja.** Reemplazá el
   `redirect()` por `<TriageWorkbench />` con el encabezado de la página, y **reemplazá también su
   comentario**: el que está describe la decisión contraria y quedaría mintiendo. Escribí por qué
   ahora es un destino propio (dos trabajos distintos, no dos vistas de la misma lista).

2. **`app/dashboard/compliance/page.tsx` redirige `?vista=documentos` → `/dashboard/compliance/inbox`.**
   Con `router.replace` y no `push`: llegar por un enlace viejo no es un paso de navegación que el
   botón atrás deba reponer.

3. **`components/compliance/CarrierDrawer.tsx:204`** — el enlace "Llévalos a la Bandeja" apunta a
   `?vista=documentos`. Cambialo a `/dashboard/compliance/inbox`. **Con el redirect funcionaría
   igual, pero un enlace interno que pasa por un redirect es deuda desde el día uno.**

4. Se elimina el botón "Sin clasificar" y la vista `documentos` del conmutador. **Verificá con
   `grep -rn "vista=documentos" components app` que sólo queda el redirect**, y poné ese grep en el
   mensaje del commit.

5. La fila de la tabla y del embudo **navegan a la ficha** en vez de abrir el cajón.

6. **`CarrierDrawer` NO se borra.** Verificado antes de escribir esto: sigue usándose en las vistas
   Conductores y Vehículos con la prop `subject`. Sólo pierde su consumidor de la vista Empresas.

7. **Cuatro tests existentes afirman hoy lo contrario de lo que esta tarea construye.** No son daño
   colateral que se descubre al correr la suite: son la decisión anterior escrita, y cada uno se
   actualiza a mano. Verificados en el árbol antes de escribir esto:

   | Archivo:línea | Qué afirma hoy | Qué pasa a afirmar |
   |---|---|---|
   | `app/dashboard/compliance/page.test.tsx:101` | tocar "Sin clasificar" hace `replace('/dashboard/compliance?vista=documentos')` | el botón ya no existe en el conmutador; el test se elimina — el Step 5 lo reemplaza |
   | `app/dashboard/compliance/page.test.tsx:108` | con `?vista=documentos` monta la cola y el botón queda `aria-pressed` | con `?vista=documentos` redirige a `/dashboard/compliance/inbox` |
   | `app/dashboard/compliance/page.test.tsx:205` | monta la cola con `?vista=documentos` | se mueve al test de la Bandeja, montando `/inbox` |
   | `components/compliance/CarrierDrawer.test.tsx:60` | el enlace contiene `vista=documentos` | el enlace es exactamente `/dashboard/compliance/inbox` |

   **Ninguno se borra sin reemplazo salvo el primero**, y ese porque su sujeto —el botón del
   conmutador— deja de existir. Un test que se borra para que la suite pase verde es una red que se
   corta; si alguno resulta imposible de trasladar, dilo en el reporte en vez de eliminarlo.

- [ ] **Step 6: Correr todo y construir**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 7: Mutar**

Devolvé Certificación a `NAV_ITEMS` como entrada plana. Esperado: falla "se abre en Empresas y Sin
clasificar". Restaurá.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/components/dashboard/Sidebar.tsx \
        monitor-app/frontend/app/dashboard/compliance/ \
        monitor-app/frontend/components/compliance/CarrierDrawer.tsx \
        monitor-app/frontend/components/compliance/CarrierDrawer.test.tsx
git commit -m "feat(certificacion): los dos mundos, cada uno con su entrada"
```

---

## Task 2b: El casillero que ya tiene dueño

Sale de la revisión de la Task 2. Las dos señales que esa tarea construyó cuentan sólo sobre los
ítems **sin clasificar**: `count(*) OVER (...)` se evalúa sobre lo que dejó pasar
`unclassified_predicate('i')`. Consecuencia, verificada leyendo `classify_batch`: si un documento ya
fue confirmado y después llega otro al mismo `(entity_id, requirement_id)`, el segundo se lista con
`mismo_casillero = 1` —"sin colisión"— y confirmarlo pisa al primero.

**Por qué un campo nuevo y no ensanchar el que hay.** Un `1` que significa a la vez "no hay
colisión" y "no hay colisión que yo pueda ver" es un valor con dos significados, la clase de bug que
este módulo ya tuvo cinco veces y que ningún test encontró. Y para quien mira la pantalla son dos
situaciones distintas, con dos decisiones distintas: *"otro archivo de esta cola apunta al mismo
casillero"* (elegí cuál) contra *"confirmar esto reemplaza el documento que ya está"* (mirá el que
está antes de decidir). Dos preguntas, dos campos.

**Lo que NO hay que arreglar:** el daño ya es reversible. `_apply_stored_document` llama a
`log_document_replacement` y guarda `replaced_storage_path` en el metadata, y el blob anterior nunca
se sobrescribe en storage. Lo que falta es el aviso **antes**, no la recuperación después.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py` (`_SQL_COLA`)
- Modify: `monitor-app/backend/api/app/schemas/document_ingest.py` (`QueueRow`)
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Produces: `QueueRow` gana `casillero_ocupado: bool = False` — **el requisito destino ya tiene un
  archivo cargado hoy.** `False` cuando el ítem no tiene destino todavía.

- [ ] **Step 1: Escribir los tests que fallan**

```python
async def test_la_cola_avisa_cuando_el_casillero_ya_tiene_documento(pool_real):
    """El caso destructivo que `mismo_casillero` NO ve: el ocupante ya fue
    confirmado, asi que salio de la cola y ninguna window function lo cuenta.
    """
    # Arma un compliance_record con file_url y un item de la cola apuntando
    # al mismo (entity_id, requirement_id) — con el patron de fixtures que ya
    # usa este archivo para datos reales.
    fila = await _una_fila_de_la_cola(pool_real, entity_id=E, requirement_id=R)
    assert fila["casillero_ocupado"] is True
    assert fila["mismo_casillero"] == 1   # la senal vieja sigue diciendo "sin colision"


async def test_un_item_sin_destino_no_tiene_el_casillero_ocupado(pool_real):
    """Sin entity_id no hay casillero que ocupar. Sin esta guarda, el EXISTS
    correlacionado con NULL da NULL y la fila viaja con un booleano vacio.
    """
    fila = await _una_fila_de_la_cola(pool_real, entity_id=None, requirement_id=None)
    assert fila["casillero_ocupado"] is False
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_document_ingest.py -q -k casillero
```

Esperado: FALLAN con `KeyError: 'casillero_ocupado'`.

- [ ] **Step 3: La señal, en la misma pasada**

En `_SQL_COLA`, junto a las otras dos:

```sql
           -- La colision que las window functions NO pueden ver: el ocupante
           -- ya fue confirmado, salio de la cola y no esta en ninguna
           -- particion. Es justo el caso destructivo — confirmar este item
           -- reemplaza un documento que hoy es valido.
           --
           -- EXISTS y no JOIN a proposito: un JOIN a compliance_records
           -- multiplicaria la fila si algun dia hay mas de un registro
           -- vigente por (entity_id, requirement_id), y una cola que muestra
           -- el mismo archivo dos veces es peor que una que no avisa.
           CASE WHEN i.entity_id IS NOT NULL AND i.requirement_id IS NOT NULL
                THEN EXISTS (
                    SELECT 1 FROM public.compliance_records cr
                     WHERE cr.entity_id = i.entity_id
                       AND cr.requirement_id = i.requirement_id
                       AND cr.is_current = true
                       AND cr.file_url IS NOT NULL)
                ELSE false END                        AS casillero_ocupado
```

Y en `QueueRow`:

```python
    casillero_ocupado: bool = False
    """El requisito destino YA tiene un archivo. Confirmar este item lo
    reemplaza — el anterior queda recuperable (`replaced_storage_path`), pero
    quien confirma tiene que saberlo ANTES."""
```

- [ ] **Step 4: Correr, contra Postgres real**

```bash
venv/bin/python -m pytest tests/test_document_ingest.py -q -k casillero
venv/bin/python -m pytest tests/ -q -m "not integracion"
venv/bin/python -m pytest tests/ -q -m integracion
```

Las suites van **separadas y no se matan a mitad** (`max_connections` = 60).

El test de placeholders contra argumentos de este endpoint tiene que seguir verde: el `EXISTS` no
agrega ningún `$n`, así que el conteo no cambia — si cambió, algo se escribió mal.

- [ ] **Step 5: Mutar**

La mutación va escrita **después** de la aserción y nombrando cuál muere — en este plan ya hubo tres
mutaciones que no mataron nada:

1. Sacar la guarda de NULL (dejar el `EXISTS` pelado). Muere
   `test_un_item_sin_destino_no_tiene_el_casillero_ocupado`, porque el `EXISTS` correlacionado con
   `NULL` no encuentra fila y devuelve `false`… **verificá qué devuelve de verdad antes de darlo por
   bueno**: si resulta que también da `false`, esa mutación no prueba nada y la guarda hay que
   probarla de otra forma — por ejemplo, que dos ítems sin destino cuyos casilleros no existen no se
   contagien entre sí.
2. Quitar `AND cr.file_url IS NOT NULL`. Muere
   `test_la_cola_avisa_cuando_el_casillero_ya_tiene_documento` si el fixture incluye un requisito
   **sin** archivo: sin esa condición, un casillero vacío se reportaría ocupado.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/app/schemas/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "feat(bandeja): el casillero que ya tiene dueno deja de parecer vacio"
```

---

## Task 6: La Bandeja global pide empresa antes de subir

Es la que convierte una advertencia en comportamiento: **acotar el universo a una empresa es lo que
hace que el clasificador acierte.**

**Files:**
- Modify: `monitor-app/frontend/components/compliance/TriageWorkbench.tsx:150-160`
- Modify: `monitor-app/frontend/components/compliance/TriageFileTable.tsx`
- Test: `monitor-app/frontend/components/compliance/TriageWorkbench.test.tsx`,
  `TriageFileTable.test.tsx`

**Interfaces:**
- Consumes: `mismo_casillero` y `mismo_contenido` de `QueueRow` (Task 2);
  `CarrierSearchPicker` de `components/dashboard/`, cuya firma es
  `{ query, onQueryChange, onPick, placeholder?, size?, ... }`.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
it('la Bandeja global deja acotar el lote a una empresa antes de subir', async () => {
  render(<TriageWorkbench />)   // sin carrierId: es la global
  fireEvent.change(await screen.findByPlaceholderText(/buscar empresa/i), { target: { value: 'char' } })
  fireEvent.click(await screen.findByText('Transportes Charlotte Spa'))

  // El dropzone NO expone un testid para su input: se selecciona por su
  // aria-label, y soltar se prueba con `fireEvent.drop` sobre
  // `getByTestId('triage-dropzone')`. Es el patron que TriageDropzone.test.tsx
  // ya usa — copialo, no inventes un testid nuevo.
  fireEvent.drop(screen.getByTestId('triage-dropzone'), {
    dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
  })

  // El cliente ya sabe rutear: con carrierId va a /{id}/files, que es lo que
  // acota el universo del clasificador a ~2 conductores y ~3 vehiculos en vez
  // de 87 y 124.
  await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledWith(
    'c1', expect.any(Array),
  ))
})

it('sin elegir empresa sigue pudiendo subir a la bandeja global', async () => {
  // No es obligatorio: la tanda mezclada es un caso legitimo y bloquearla
  // convertiria la bandeja en un buscador.
  render(<TriageWorkbench />)
  fireEvent.drop(screen.getByTestId('triage-dropzone'), {
    dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
  })
  await waitFor(() => expect(documentIngestApi.upload).toHaveBeenCalledWith(
    undefined, expect.any(Array),
  ))
})

// En TriageFileTable.test.tsx
it('avisa cuando dos archivos reclaman el mismo casillero', () => {
  render(<TriageFileTable rows={[fila({ mismo_casillero: 2 })]} {...props} />)
  expect(screen.getByText(/2 archivos.*mismo/i)).toBeInTheDocument()
})

it('avisa cuando el archivo ya está en la cola', () => {
  render(<TriageFileTable rows={[fila({ mismo_contenido: 2 })]} {...props} />)
  expect(screen.getByText(/ya está en la cola/i)).toBeInTheDocument()
})

it('sin colisión no dice nada', () => {
  render(<TriageFileTable rows={[fila({ mismo_casillero: 1, mismo_contenido: 1 })]} {...props} />)
  expect(screen.queryByText(/mismo casillero|ya está en la cola/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run components/compliance/TriageWorkbench.test.tsx components/compliance/TriageFileTable.test.tsx
```

- [ ] **Step 3: El selector de empresa en la Bandeja global**

En `TriageWorkbench`, **sólo cuando no viene `carrierId` por prop**, arriba del dropzone:

```tsx
{!carrierId && (
  <div>
    <p className="text-etiqueta text-informativo pb-1">
      ¿De quién son estos documentos? Elegir la empresa hace que el sistema
      reconozca mejor a quién pertenece cada archivo.
    </p>
    <CarrierSearchPicker
      query={busqueda} onQueryChange={setBusqueda}
      onPick={c => setEmpresaDelLote(c)}
      selectedId={empresaDelLote?.id ?? null}
      size="sm"
      placeholder="Buscar empresa (opcional)…"
    />
  </div>
)}
```

y la subida usa `documentIngestApi.upload(carrierId ?? empresaDelLote?.id, lote)`.

**Es opcional a propósito**: la tanda mezclada es un caso legítimo, y exigir empresa convertiría la
bandeja en un buscador — que es exactamente lo que su propio docstring dice que no debe ser.

- [ ] **Step 4: Las dos señales en la tabla**

En `TriageFileTable`, junto al estado de cada fila. **Dos mensajes distintos porque piden acciones
distintas:**

- `mismo_contenido > 1` → *"Este archivo ya está en la cola"* — el operador borra uno.
- `mismo_casillero > 1` → *"{n} archivos reclaman este casillero"* — el operador elige cuál.

**Sólo tokens**: el aviso va en `text-espera` con `text-etiqueta`. **Cero emojis** — usá
`AlertTriangle` de `lucide-react`, que la tabla ya importa.

- [ ] **Step 5: Correr todo, construir y verificar trinquetes**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Mutar**

Hacé que la subida ignore `empresaDelLote` y mande siempre `carrierId`. Esperado: falla "deja acotar
el lote a una empresa". Restaurá.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/compliance/
git commit -m "feat(bandeja): el lote puede decir de quien es, y las colisiones se ven"
```

---

## Task 7: Verificación de punta a punta

**Files:** ninguno — es verificación.

- [ ] **Step 1: Las cuatro suites, separadas**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/ -q -m "not integracion"    # ~25 s
venv/bin/python -m pytest tests/ -q -m integracion          # ~7 min, dejala terminar
cd ../../frontend
npx vitest run && npx tsc --noEmit && npm run build
```

Punto de partida: backend **724** rápidos y **133** de integración; frontend **1.158**.

- [ ] **Step 2: Los conteos no cambiaron para quien no pidió nada**

Contra Postgres real: `/pending` sin `estado` tiene que devolver el mismo total que antes del Task 1
(**5.038** el 2026-08-19). Si cambió, el default dejó de reproducir el comportamiento anterior.

- [ ] **Step 3: Click-through en vivo con Playwright**

Contra `webcarga-frontend-dev` (**no** claude-in-chrome, la extensión está apagada):

1. El sidebar muestra **Certificación › Empresas / Sin clasificar**, con el contador en la segunda.
2. Clic en una empresa desde la lista → **la ficha**, con su URL propia. Recargar la mantiene.
3. La ficha muestra empresa, conductores y vehículos **juntos**. Probar con
   **"Comercializadora De Los Rios Ltda"**, que es la única con documentación real: tiene que
   mostrar **23 al día, 10 faltan, 3 por vencer**.
4. El filtro `Todo · Falta · Por vencer · Al día` cambia la lista.
5. Un documento cargado ofrece **"Ver"** y abre la previsualización.
6. En "Sin clasificar", elegir una empresa y subir → el request va a `/{carrier_id}/files`
   (verificable en la pestaña de red).
7. **Consola: cero errores y cero warnings.**

**Elegí una empresa sin documentos para cualquier prueba de carga** — los desplegables listan todo
el catálogo y ya se pisó un documento real por elegir a ojo.

- [ ] **Step 4: Actualizar el AGENTLOG y cerrar**

Qué se hizo, el siguiente paso exacto, y las decisiones de arquitectura.

---

## Fuera de alcance

- **Historial de versiones y línea de tiempo de auditoría** — hay **1** registro histórico y **119**
  filas de auditoría en todo el sistema. Sería una pestaña vacía.
- **Seguros y Contactos en la ficha** — Seguros tiene su propio modelo de datos sin resolver.
- **El nombre canónico derivado de la clasificación.**
- **Retirar la pestaña Documentos de la ficha legacy de Empresas** — hay que preguntarle al equipo
  qué mira ahí antes de sacarla.
- **Bloquear duplicados o colisiones.** Se muestran, no se bloquean: *"nada se descarta nunca"*.
