# Certificación — la carga documental: el renglón pide lo suyo · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para seguimiento.

**Goal:** Que cargar un documento en Certificación sea un solo gesto sobre el renglón del requisito
que falta, y que ese gesto pida en el momento lo que ese requisito exige.

**Architecture:** La lista de "lo que falta" pasa de ser un listado con botones de 42×17 px a ser la
superficie de carga. Cada renglón recibe el archivo (drop o clic), pide la fecha cuando el catálogo
dice que es obligatoria, y recién entonces llama a `POST /compliance-records/{id}/file` —el endpoint
directo, que ya existe— en una sola operación. El dropzone de 211 px sale del cajón. El catálogo
gana una política de vencimiento de tres estados, editable desde Configuración.

**Tech Stack:** Next.js 15 (App Router) + React Query + Tailwind v4 en `monitor-app/frontend`;
FastAPI + asyncpg en `monitor-app/backend/api`; Postgres (Supabase).

**Spec:** `docs/superpowers/specs/2026-08-19-certificacion-carga-documental-design.md`

## Global Constraints

- **Español neutral, nunca voseo.** "Elige", "Arrastra", "Guarda", "puedes". Lo verifica
  `lib/copy/espanol-neutral.test.ts`, que recorre el código fuente.
- **Cero emojis.** Sólo `lucide-react`.
- **Etiqueta en español, ruta en inglés.**
- **Los trinquetes visuales están en MARGEN CERO**: color crudo **1.765/1.765**
  (`lib/ui/sistema.test.ts`), tamaños <11px **268/268** (`lib/ui/escala.test.ts`), `<h1>` 9/9.
  Todo color nuevo usa tokens de `app/globals.css` (`accent`, `espera`, `accion`, `resuelto`,
  `informativo`, `text-primary`, `border`, `status-*`); todo tamaño usa la escala
  (`text-etiqueta` 11px, `text-dato` 13px, `text-lectura` 15px, `text-titulo` 20px,
  `text-cifra` 28px). **Si un archivo migra colores viejos a tokens, baja el tope en el mismo commit.**
- **`deploy-monitor-api.yml` NO corre migraciones.** La migración de la Tarea 1 se aplica a mano
  ANTES de desplegar la API. Si sale al revés, la validación consulta una columna que no existe.
- **El SQL nuevo se verifica contra Postgres real**, no contra `AsyncMock`. La sandbox llega a
  `aws-1-us-east-1.pooler.supabase.com:5432`. Además, todo endpoint nuevo o modificado lleva un test
  que cuenta placeholders (`$n`) contra argumentos — ver `test_compliance.py::
  test_pending_rows_binds_exactly_the_parameters_it_references`.
- **Cada test nuevo se muta antes de darlo por bueno.** Cambia el código para romperlo, confirma que
  el test falla, restaura. Un test que no muere no es una red.
- **Backend venv**: `monitor-app/backend/api/venv` (no `.venv`, no anaconda).
- **Antes de dar algo por listo**: `npx vitest run` · `npx tsc --noEmit` · `npm run build` ·
  `venv/bin/python -m pytest tests/` · **y mirar la pantalla**.

---

## Estructura de archivos

**Backend** (`monitor-app/backend/api`)
- Crear: `../supabase/migrations/20260820100000_expiration_policy.sql` — la política de tres estados.
- Modificar: `app/routers/compliance.py` — `_apply_compliance_upload` valida la política;
  `pendiente_predicate()` suma "por vencer"; `_PENDING_ROWS_SQL` devuelve la política y el estado.
- Crear: `app/services/vencimientos.py` — **una sola definición** de la ventana "por vencer",
  hoy escrita a mano tres veces.
- Modificar: `app/routers/carriers.py:282`, `app/routers/drivers.py:224`, `app/routers/assets.py:233`
  — consumen esa definición en vez de repetir `INTERVAL '30 days'`.
- Modificar: `app/routers/requirements.py` + `app/schemas/requirement.py` — `PATCH /conditions`
  acepta la política.

**Frontend** (`monitor-app/frontend`)
- Crear: `components/compliance/RenglonPendiente.tsx` — el renglón con sus seis estados. Es el
  único lugar donde se sube un documento a un requisito.
- Modificar: `components/compliance/CarrierDrawer.tsx` — usa el renglón, suelta el dropzone.
- Modificar: `components/dashboard/DocumentChecklist.tsx` — la ficha legacy usa el mismo renglón.
- Modificar: `app/dashboard/admin/settings/CondicionPanel.tsx` — edita la política.
- Modificar: `app/dashboard/compliance/page.tsx:130` — crear empresa no sale del módulo.
- Modificar: `lib/api/compliance.ts`, `lib/types.ts` — la política viaja en los tipos.

---

## Task 1: La política de vencimiento en el catálogo

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260820100000_expiration_policy.sql`
- Test: verificación contra Postgres real (no hay test unitario de una migración en este repo)

**Interfaces:**
- Produces: columna `public.compliance_requirements.expiration_policy TEXT NOT NULL` con
  `CHECK (expiration_policy IN ('REQUIRED','OPTIONAL','NONE'))`.

- [ ] **Step 1: Medir el estado de partida contra producción**

Antes de escribir la migración, dejar registrado qué hay. Ejecuta:

```sql
SELECT has_expiration, count(*)
FROM public.compliance_requirements
GROUP BY 1;
```

Esperado, medido el 2026-08-19: `true` → 19, `false` → 18 (37 en total, 35 activos).
Si el número cambió, **detente y avisa**: la migración de abajo asume ese reparto.

- [ ] **Step 2: Escribir la migración**

```sql
-- La política de vencimiento de un requisito, con TRES estados nombrados.
--
-- `has_expiration` era un booleano cargando tres significados, y por eso
-- classify-batch trataba "tiene vencimiento" como "el vencimiento es
-- obligatorio": 19 de 35 requisitos activos rechazaban la carga con 422 sin
-- que la pantalla pidiera nunca la fecha. Septima aparicion en este modulo de
-- un valor con doble sentido.
--
-- El backfill es DELIBERADAMENTE conservador: true -> REQUIRED preserva
-- exactamente el comportamiento actual. Nadie queda mas exigente ni menos
-- exigente que ayer. Mover un requisito a OPTIONAL es una decision de negocio
-- y se toma desde Configuracion, no desde una migracion.
ALTER TABLE public.compliance_requirements
  ADD COLUMN expiration_policy TEXT;

UPDATE public.compliance_requirements
SET expiration_policy = CASE WHEN COALESCE(has_expiration, false)
                             THEN 'REQUIRED' ELSE 'NONE' END;

ALTER TABLE public.compliance_requirements
  ALTER COLUMN expiration_policy SET NOT NULL,
  ADD CONSTRAINT compliance_requirements_expiration_policy_check
    CHECK (expiration_policy IN ('REQUIRED','OPTIONAL','NONE'));

COMMENT ON COLUMN public.compliance_requirements.expiration_policy IS
  'REQUIRED: sin fecha el documento no se acepta. OPTIONAL: se acepta y la '
  'fecha queda pendiente. NONE: el documento no vence. `has_expiration` se '
  'conserva por compatibilidad de lectura; la fuente de verdad es esta columna.';
```

**Nota:** `has_expiration` **no se borra**. Hay lectores vivos
(`carriers.py`, `drivers.py`, `assets.py`, `document_ingest.py`) y borrarla en la misma migración
convierte un cambio aditivo en uno destructivo. Su retiro es una tarea futura.

- [ ] **Step 3: Aplicar la migración y verificar el reparto**

Aplícala contra la base y ejecuta:

```sql
SELECT expiration_policy, count(*) FROM public.compliance_requirements GROUP BY 1;
```

Esperado: `REQUIRED` → 19, `NONE` → 18, `OPTIONAL` → 0.

Y que nada quedó inconsistente:

```sql
SELECT count(*) AS deben_ser_cero
FROM public.compliance_requirements
WHERE (expiration_policy = 'REQUIRED') <> COALESCE(has_expiration, false);
```

Esperado: `0`.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260820100000_expiration_policy.sql
git commit -m "feat(certificacion): el vencimiento deja de ser un booleano con tres significados"
```

---

## Task 2: `/file` valida contra la política

**Files:**
- Modify: `monitor-app/backend/api/app/routers/compliance.py` (`_apply_compliance_upload`)
- Test: `monitor-app/backend/api/tests/test_compliance.py`

**Interfaces:**
- Consumes: `compliance_requirements.expiration_policy` (Task 1).
- Produces: `POST /compliance-records/{id}/file` responde **422** con
  `"Este documento requiere su fecha de vencimiento"` cuando la política es `REQUIRED` y no llega
  fecha. Con `OPTIONAL` y `NONE` acepta sin fecha.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_compliance.py`:

```python
def test_file_upload_rejects_missing_date_when_required():
    """Hoy /file acepta sin fecha SIEMPRE, incluso para una licencia. El
    guardia vive en el servidor: el renglon pregunta antes, pero quien decide
    es la API."""
    pool = AsyncMock()
    conn = pool.acquire.return_value.__aenter__.return_value
    conn.fetchrow.return_value = {
        "id": "r1", "entity_type": "DRIVER", "entity_id": "d1",
        "status": "MISSING", "expiration_policy": "REQUIRED",
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert res.status_code == 422
    assert "fecha de vencimiento" in res.json()["detail"]


def test_file_upload_accepts_missing_date_when_optional():
    pool = AsyncMock()
    conn = pool.acquire.return_value.__aenter__.return_value
    conn.fetchrow.return_value = {
        "id": "r1", "entity_type": "DRIVER", "entity_id": "d1",
        "status": "MISSING", "expiration_policy": "OPTIONAL",
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("anexo.pdf", b"%PDF-1.4", "application/pdf")},
    )

    assert res.status_code != 422
```

**Ajusta el armado del mock** al que ya usan los tests de `/file` en este archivo — búscalos con
`grep -n "record_id}/file\|/file\"" tests/test_compliance.py` y copia su forma. No inventes una
nueva; el repo ya tiene el patrón.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_compliance.py -k "expiration_policy or missing_date" -v
```

Esperado: FAIL — hoy `/file` acepta sin fecha siempre.

- [ ] **Step 3: Implementar la validación**

En `_apply_compliance_upload`, la consulta que ya lee el registro pasa a traer la política, y la
validación va **antes** de tocar storage:

```python
    record = await conn.fetchrow(
        """
        SELECT cr.id::text, cr.entity_type, cr.entity_id::text, cr.status,
               req.expiration_policy
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.id = $1
        """,
        record_id,
    )
    if record is None:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")
    # Antes de subir nada. Si validaramos despues, un rechazo dejaria el blob
    # huerfano en storage — que es exactamente el defecto que este trabajo
    # viene a eliminar del otro camino.
    if record["expiration_policy"] == "REQUIRED" and expiration_date is None:
        raise HTTPException(422, "Este documento requiere su fecha de vencimiento")
```

**Ojo:** adapta los nombres a los que `_apply_compliance_upload` ya usa. Lee la función completa
antes de editar (`sed -n '740,810p' app/routers/compliance.py`) — ya lee el registro y el
`old_status`; **no agregues una segunda consulta**, extiende la que hay.

- [ ] **Step 4: Correr y verificar que pasan**

```bash
venv/bin/python -m pytest tests/test_compliance.py -v
```

Esperado: PASS, y los 61 tests previos del archivo siguen verdes.

- [ ] **Step 5: Verificar contra Postgres real**

El SQL nuevo se prueba con parámetros de verdad, no con literales sustituidos:

```sql
PREPARE chk(uuid) AS
SELECT cr.id::text, cr.entity_type, cr.status, req.expiration_policy
FROM public.compliance_records cr
JOIN public.compliance_requirements req ON req.id = cr.requirement_id
WHERE cr.id = $1;

EXECUTE chk('<un record_id real de un requisito REQUIRED>');
```

Esperado: una fila con `expiration_policy = 'REQUIRED'`.

- [ ] **Step 6: Mutar los tests**

Comenta la condición `if record["expiration_policy"] == "REQUIRED" ...` y corre los tests.
Esperado: `test_file_upload_rejects_missing_date_when_required` FALLA. Restaura.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/routers/compliance.py monitor-app/backend/api/tests/test_compliance.py
git commit -m "fix(certificacion): subir un documento pide la fecha que el requisito exige"
```

---

## Task 3: Una sola definición de "por vencer"

**Files:**
- Create: `monitor-app/backend/api/app/services/vencimientos.py`
- Modify: `app/routers/carriers.py:282`, `app/routers/drivers.py:224`, `app/routers/assets.py:233`
- Modify: `app/routers/compliance.py` (`pendiente_predicate`, `_PENDING_ROWS_SQL`)
- Test: `monitor-app/backend/api/tests/test_vencimientos.py` (crear)

**Interfaces:**
- Produces: `DIAS_POR_VENCER: int` y `por_vencer_predicate(alias: str = "cr") -> str`, más
  `pendiente_predicate()` extendido. `/pending` devuelve un campo nuevo `urgencia` con valores
  `'VENCIDO' | 'POR_VENCER' | 'FALTA'`.

- [ ] **Step 1: Medir las copias que existen**

```bash
cd monitor-app/backend/api && grep -rn "INTERVAL '30 days'" app/routers/
```

Esperado: tres coincidencias — `carriers.py:282`, `drivers.py:224`, `assets.py:233`. Es la misma
regla escrita a mano tres veces, la misma clase de defecto que el "universo de viajes del día"
(14 copias) que ya causó cuatro errores de conteo en este repo.

- [ ] **Step 2: Escribir el test que falla**

Crear `tests/test_vencimientos.py`:

```python
"""La ventana de "por vencer" tiene UNA definicion.

Estaba escrita a mano en tres routers con el literal INTERVAL '30 days'. Este
test no comprueba el numero: comprueba que no vuelva a haber tres numeros.
"""
import pathlib
import re

ROUTERS = pathlib.Path(__file__).parent.parent / "app" / "routers"


def test_ningun_router_escribe_la_ventana_a_mano():
    culpables = []
    for archivo in ROUTERS.glob("*.py"):
        for n, linea in enumerate(archivo.read_text().splitlines(), 1):
            if re.search(r"INTERVAL\s+'\d+\s+days'", linea):
                culpables.append(f"{archivo.name}:{n}")
    assert not culpables, (
        "La ventana de vencimiento se escribio a mano en: "
        + ", ".join(culpables)
        + ". Usa app/services/vencimientos.py."
    )


def test_el_predicado_de_por_vencer_usa_la_constante():
    from app.services.vencimientos import DIAS_POR_VENCER, por_vencer_predicate

    sql = por_vencer_predicate("cr")
    assert str(DIAS_POR_VENCER) in sql
    assert "cr.expiration_date" in sql
```

- [ ] **Step 3: Correr y verificar que falla**

```bash
venv/bin/python -m pytest tests/test_vencimientos.py -v
```

Esperado: FAIL — el módulo no existe y hay tres literales.

- [ ] **Step 4: Crear el módulo**

`app/services/vencimientos.py`:

```python
"""Cuando un documento pasa a estar "por vencer".

La ventana estaba escrita a mano con el literal INTERVAL '30 days' en tres
routers (carriers, drivers, assets), y /pending no la contemplaba en absoluto:
un documento que vence en diez dias no aparecia en el cajon ni en la etapa
"Hay que renovar" del embudo, porque el predicado de pendiente exigia
expiration_date < CURRENT_DATE, o sea YA vencido. Sobre 31 registros con
fecha, 9 estaban vencidos y 3 vencian dentro de 30 dias sin figurar en
ninguna parte.

Una sola definicion, porque tres definiciones de lo mismo es como este repo
llego a tener cuatro errores de conteo distintos.
"""

DIAS_POR_VENCER = 30


def por_vencer_predicate(alias: str = "cr") -> str:
    """Vence pronto pero TODAVIA NO vencio. Las dos mitades importan: sin la
    segunda, "por vencer" se comeria a "vencido" y la pantalla mostraria un
    documento caducado como si solo estuviera proximo."""
    return (
        f"({alias}.expiration_date IS NOT NULL "
        f"AND {alias}.expiration_date >= CURRENT_DATE "
        f"AND {alias}.expiration_date <= CURRENT_DATE + INTERVAL '{DIAS_POR_VENCER} days')"
    )
```

- [ ] **Step 5: Reemplazar las tres copias**

En `carriers.py`, `drivers.py` y `assets.py`, la expresión que hoy calcula `is_expiring_soon` pasa a
interpolar `por_vencer_predicate(<alias que use ese archivo>)`. **Lee cada una antes de tocarla** —
usan alias distintos y algunas ya excluyen los vencidos. El comportamiento observable no debe
cambiar: son las mismas 30 días.

- [ ] **Step 6: Extender `/pending`**

En `compliance.py`, `pendiente_predicate()` suma la ventana, y el SELECT expone la urgencia:

```python
def pendiente_predicate(alias: str = "cr") -> str:
    """Lo que le falta a alguien: no tiene el documento, o el que tiene ya no
    sirve, o esta por dejar de servir.

    OJO: este predicado lo comparten /pending, el embudo (GET /status) y el
    cajon. Ya hubo un bug por moverlos por separado — el embudo mandaba 8
    empresas a "Hay que renovar" mientras el cajon de cada una decia "No le
    falta ningun documento" (ver el comentario en la linea 78). Si cambias
    este predicado, las tres lecturas se mueven JUNTAS."""
    return (
        f"({alias}.status IN ('MISSING','EXPIRED') "
        f"OR ({alias}.expiration_date IS NOT NULL AND {alias}.expiration_date < CURRENT_DATE) "
        f"OR {por_vencer_predicate(alias)})"
    )
```

Y en `_PENDING_ROWS_SQL`, junto a los campos que ya devuelve:

```sql
    CASE
        WHEN r.expiration_date IS NOT NULL AND r.expiration_date < CURRENT_DATE THEN 'VENCIDO'
        WHEN {por_vencer} THEN 'POR_VENCER'
        ELSE 'FALTA'
    END AS urgencia,
    req.expiration_policy,
```

(`{por_vencer}` se interpola con `por_vencer_predicate("r")`; `req` ya está en el JOIN.)
Agrega `urgencia` y `expiration_policy` al dict de respuesta de `list_pending_compliance_records`.

- [ ] **Step 7: Correr todo el backend**

```bash
venv/bin/python -m pytest tests/ -q
```

Esperado: todos verdes. **Si algún test del embudo cambia de número, no lo ajustes sin entender por
qué**: puede ser el bug de las tres lecturas desalineadas volviendo.

- [ ] **Step 8: Verificar el conteo contra producción**

```sql
SELECT count(*) FROM public.compliance_records
WHERE is_current AND expiration_date >= CURRENT_DATE
  AND expiration_date <= CURRENT_DATE + INTERVAL '30 days';
```

Esperado, medido el 2026-08-19: **3**. Esos son los que antes no aparecían en ninguna pantalla.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/backend/api/app/services/vencimientos.py monitor-app/backend/api/app/routers/ monitor-app/backend/api/tests/test_vencimientos.py
git commit -m "feat(certificacion): lo que esta por vencer deja de ser invisible, y la ventana tiene una sola definicion"
```

---

## Task 4: La política se edita desde Configuración

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/requirement.py`
- Modify: `monitor-app/backend/api/app/routers/requirements.py` (`PATCH /{id}/conditions`)
- Modify: `monitor-app/frontend/app/dashboard/admin/settings/CondicionPanel.tsx`
- Modify: `monitor-app/frontend/lib/types.ts`, `lib/api/compliance.ts`
- Test: `tests/test_requirements.py`, `app/dashboard/admin/settings/CondicionPanel.test.tsx`

**Interfaces:**
- Consumes: `expiration_policy` (Task 1).
- Produces: `PATCH /compliance-requirements/{id}/conditions` acepta
  `expiration_policy: 'REQUIRED'|'OPTIONAL'|'NONE'`. Sigue exigiendo `require_admin`.

- [ ] **Step 1: Escribir el test de backend que falla**

En `tests/test_requirements.py`, copiando la forma de los tests de `PATCH /conditions` que ya
existen ahí:

```python
def test_patch_conditions_sets_expiration_policy():
    pool = AsyncMock()
    client = make_admin_client(pool)

    res = client.patch(
        "/api/v1/compliance-requirements/req-1/conditions",
        json={"expiration_policy": "OPTIONAL"},
    )

    assert res.status_code == 200
    sql = pool.acquire.return_value.__aenter__.return_value.execute.call_args.args[0]
    assert "expiration_policy" in sql


def test_patch_conditions_rejects_unknown_expiration_policy():
    pool = AsyncMock()
    client = make_admin_client(pool)

    res = client.patch(
        "/api/v1/compliance-requirements/req-1/conditions",
        json={"expiration_policy": "SIEMPRE"},
    )

    assert res.status_code == 422
```

Usa el helper de cliente admin que el archivo ya tenga (`grep -n "def make_" tests/test_requirements.py`).

- [ ] **Step 2: Correr y verificar que falla**

```bash
venv/bin/python -m pytest tests/test_requirements.py -k expiration_policy -v
```

Esperado: FAIL — el campo no existe en el schema.

- [ ] **Step 3: Agregarlo al schema y al router**

En `app/schemas/requirement.py`, dentro de `RequirementConditionsPatchBody`:

```python
    expiration_policy: Optional[Literal["REQUIRED", "OPTIONAL", "NONE"]] = None
```

En `requirements.py`, el `PATCH /conditions` ya arma el UPDATE por campos presentes — **sumá
`expiration_policy` a esa construcción, no escribas un UPDATE nuevo.** Lee la función completa antes
de editar.

- [ ] **Step 4: Correr y verificar que pasan**

```bash
venv/bin/python -m pytest tests/test_requirements.py -v
```

- [ ] **Step 5: Definir el tipo, una sola vez**

En `monitor-app/frontend/lib/types.ts`, junto a los otros tipos de Certificación:

```ts
/** Qué hace el sistema con la fecha de vencimiento de un requisito.
 *  Reemplaza al booleano `has_expiration`, que cargaba estos tres
 *  significados en dos valores. */
export type PoliticaVencimiento = 'REQUIRED' | 'OPTIONAL' | 'NONE'
```

Y súmalo a `CertificationRequirement` y a `PendingComplianceRow` como
`expiration_policy: PoliticaVencimiento`, junto con
`urgencia: 'VENCIDO' | 'POR_VENCER' | 'FALTA'` en `PendingComplianceRow` (lo produce la Task 3).

- [ ] **Step 6: El panel de Configuración lo edita**

En `CondicionPanel.tsx`, junto a los controles de `is_active` y de alcance, un selector de tres
opciones. **Sólo tokens y escala** (trinquete en cero):

```tsx
<label className="block">
  <span className="text-etiqueta uppercase tracking-wider text-informativo">
    Fecha de vencimiento
  </span>
  <select
    value={politica}
    onChange={e => setPolitica(e.target.value as PoliticaVencimiento)}
    className="mt-1 w-full text-dato border border-border rounded-lg px-2 py-1.5"
  >
    <option value="REQUIRED">Obligatoria — sin ella el documento no se acepta</option>
    <option value="OPTIONAL">Opcional — se acepta y la fecha queda pendiente</option>
    <option value="NONE">No aplica — este documento no vence</option>
  </select>
</label>
```

Sigue el patrón de guardado que el panel ya usa: el campo viaja **sólo si cambió** (ver el
comentario de `activoSucio` en `CondicionPanel.tsx:139-141`), y "Aplicar" queda gateado por dirty.

- [ ] **Step 7: Test de componente + mutación**

Un test que elija "Opcional", guarde, y exija que el body incluya `expiration_policy: 'OPTIONAL'`;
y otro que exija que **no** viaje cuando no se tocó. Después mutá: hacé que siempre viaje, y
confirmá que el segundo test falla.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/backend/api/app/schemas/requirement.py monitor-app/backend/api/app/routers/requirements.py monitor-app/backend/api/tests/test_requirements.py monitor-app/frontend/app/dashboard/admin/settings/ monitor-app/frontend/lib/
git commit -m "feat(config): negocio decide si un documento exige su fecha de vencimiento"
```

---

## Task 5: `RenglonPendiente` — el renglón con sus seis estados

**Files:**
- Create: `monitor-app/frontend/components/compliance/RenglonPendiente.tsx`
- Test: `monitor-app/frontend/components/compliance/RenglonPendiente.test.tsx`

**Interfaces:**
- Produces:

```ts
export type EstadoRenglon =
  | { tipo: 'reposo' }
  | { tipo: 'recibiendo' }
  | { tipo: 'pidiendo-fecha'; archivo: File }
  | { tipo: 'subiendo' }
  | { tipo: 'listo' }
  | { tipo: 'error'; motivo: string; archivo: File | null }

export function RenglonPendiente(props: {
  fila:        PendingComplianceRow
  puedeEditar: boolean
  onSubir:     (fila: PendingComplianceRow, archivo: File, vencimiento?: string) => Promise<void>
  onDeshacer?: () => void
}): JSX.Element
```

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RenglonPendiente } from './RenglonPendiente'
import type { PendingComplianceRow } from '@/lib/types'

const fila = (over: Partial<PendingComplianceRow> = {}): PendingComplianceRow => ({
  id: 'p1', carrier_id: 'c1', carrier_name: 'Charlotte', carrier_tax_id: '1-9',
  carrier_operation_types: [], certification_type: 'BASICA', category: 'CONDUCTOR',
  entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan',
  requirement_id: 'r1', requirement_code: 'LICENCIA_CONDUCIR',
  document_name: 'Licencia de Conducir', status: 'MISSING', expiration_date: null,
  expiration_policy: 'REQUIRED', urgencia: 'FALTA',
  ...over,
} as PendingComplianceRow)

const archivo = () => new File(['x'], 'licencia.pdf', { type: 'application/pdf' })

describe('RenglonPendiente', () => {
  it('con politica REQUIRED pide la fecha antes de subir', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila()} puedeEditar onSubir={onSubir} />)

    fireEvent.change(screen.getByTestId('archivo-p1'), { target: { files: [archivo()] } })

    expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
    // Lo critico: NO se subio nada todavia. Subir antes de tener la fecha es
    // lo que dejaba archivos varados en la bandeja.
    expect(onSubir).not.toHaveBeenCalled()
  })

  it('sube recien cuando la fecha esta puesta', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila()} puedeEditar onSubir={onSubir} />)

    fireEvent.change(screen.getByTestId('archivo-p1'), { target: { files: [archivo()] } })
    fireEvent.change(await screen.findByLabelText(/vence el/i), { target: { value: '2027-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSubir).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }), expect.any(File), '2027-01-31',
    ))
  })

  it('con politica NONE sube de una, sin preguntar', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    fireEvent.change(screen.getByTestId('archivo-p1'), { target: { files: [archivo()] } })

    await waitFor(() => expect(onSubir).toHaveBeenCalled())
    expect(screen.queryByLabelText(/vence el/i)).not.toBeInTheDocument()
  })

  it('el error se muestra en ESTE renglon y conserva el archivo', async () => {
    const onSubir = vi.fn().mockRejectedValue(new Error('El archivo supera 7 MB'))
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    fireEvent.change(screen.getByTestId('archivo-p1'), { target: { files: [archivo()] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/7 MB/)
    expect(screen.getByText(/licencia\.pdf/)).toBeInTheDocument()
  })

  it('sin permiso de edicion no ofrece cargar', () => {
    render(<RenglonPendiente fila={fila()} puedeEditar={false} onSubir={vi.fn()} />)
    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
  })

  it('soltar un archivo encima equivale a elegirlo', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    const renglon = screen.getByTestId('renglon-p1')
    fireEvent.drop(renglon, { dataTransfer: { files: [archivo()] } })

    await waitFor(() => expect(onSubir).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/RenglonPendiente.test.tsx
```

Esperado: FAIL — el componente no existe.

- [ ] **Step 3: Implementar el componente**

Requisitos no negociables al escribirlo:

- **El renglón entero es el blanco**: `<div data-testid={`renglon-${fila.id}`}>` de ancho completo,
  `min-h-10` (40 px), con `onDrop` / `onDragOver` / `onDragLeave`.
- El input de archivo lleva `data-testid={`archivo-${fila.id}`}` y vive en un `<label>` que cubre el
  renglón, no un botón de 42×17.
- **Nada llama a `onSubir` hasta tener todo**: con `expiration_policy === 'REQUIRED'` el estado pasa
  a `pidiendo-fecha` y espera el submit.
- El campo de fecha se asocia con `<label htmlFor>` y el texto **"Vence el"** (los tests lo buscan
  por etiqueta accesible, no por clase).
- Errores: `role="alert"` dentro del renglón, con el nombre del archivo conservado.
- **Sólo tokens y escala.** Gris → `text-informativo`. Nada de `text-[10px]` ni `text-gray-*`.
- Español neutral: "Arrastra aquí o elige un archivo", "Guarda", "Vence el".

- [ ] **Step 4: Correr y verificar que pasan**

```bash
npx vitest run components/compliance/RenglonPendiente.test.tsx
```

- [ ] **Step 5: Verificar los trinquetes**

```bash
npx vitest run lib/ui/sistema.test.ts lib/ui/escala.test.ts
```

Esperado: PASS. Si fallan, el componente metió color crudo o un tamaño fuera de escala — **arréglalo
en el componente, no subas el tope.**

- [ ] **Step 6: Mutar**

Cambia el componente para que llame `onSubir` apenas se elige el archivo, ignorando la política.
Esperado: falla el test "con politica REQUIRED pide la fecha antes de subir". Restaura.

- [ ] **Step 7: Deshacer lo recién cargado**

El spec (§3, estado 5) pide poder deshacer mientras sea el último documento cargado. Hoy **nada se
puede deshacer** y por eso todo da miedo.

Test primero:

```tsx
it('ofrece deshacer lo recien cargado, y solo eso', async () => {
  const onDeshacer = vi.fn()
  const onSubir = vi.fn().mockResolvedValue(undefined)
  render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar
                           onSubir={onSubir} onDeshacer={onDeshacer} />)

  fireEvent.change(screen.getByTestId('archivo-p1'), {
    target: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
  })

  fireEvent.click(await screen.findByRole('button', { name: /deshacer/i }))
  expect(onDeshacer).toHaveBeenCalled()
})

it('sin onDeshacer no promete algo que no puede cumplir', async () => {
  const onSubir = vi.fn().mockResolvedValue(undefined)
  render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)
  fireEvent.change(screen.getByTestId('archivo-p1'), {
    target: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
  })
  await screen.findByText(/listo/i)
  expect(screen.queryByRole('button', { name: /deshacer/i })).not.toBeInTheDocument()
})
```

En el estado `listo`, si llegó `onDeshacer`, el renglón lo ofrece. **Quién lo implementa es el
cajón** (Task 6), llamando a `POST /document-ingest/items/undo-classify`… **y acá hay una decisión
que el ejecutor debe tomar y reportar**: `undo-classify` revierte una clasificación *de la bandeja*,
y el camino directo no pasa por ahí. Si no existe un endpoint que revierta una subida directa,
**deshacer queda fuera de alcance y el `onDeshacer` no se pasa** — el renglón ya está preparado para
que no se ofrezca. No inventes un DELETE: `DELETE /compliance-records/{id}/file` existe y vuelve el
registro a `MISSING`, pero **borra evidencia**, así que usarlo como "deshacer" es una decisión de
producto, no de implementación. Reporta y pregunta.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/frontend/components/compliance/RenglonPendiente.tsx monitor-app/frontend/components/compliance/RenglonPendiente.test.tsx
git commit -m "feat(certificacion): el renglon pide lo que su requisito exige"
```

---

## Task 6: El cajón usa el renglón y suelta el dropzone

**Files:**
- Modify: `monitor-app/frontend/components/compliance/CarrierDrawer.tsx`
- Modify: `monitor-app/frontend/lib/api/compliance.ts` (si falta el método de subida directa)
- Test: `monitor-app/frontend/components/compliance/CarrierDrawer.test.tsx`

**Interfaces:**
- Consumes: `RenglonPendiente` (Task 5), `urgencia` y `expiration_policy` de `/pending` (Task 3).

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
it('el cajon ya no monta la bandeja adentro', async () => {
  setup()
  expect(await screen.findByText(/Lo que falta/)).toBeInTheDocument()
  expect(screen.queryByTestId('workbench')).not.toBeInTheDocument()
})

it('ofrece llevar una pila a la Bandeja, sin ser una zona de arrastre', async () => {
  setup()
  const enlace = await screen.findByRole('link', { name: /Bandeja/i })
  expect(enlace).toHaveAttribute('href', expect.stringContaining('vista=documentos'))
})

it('sube por el camino directo, no por el de la pila', async () => {
  setup([pendiente({ expiration_policy: 'NONE' })])
  fireEvent.change(await screen.findByTestId('archivo-p1'), {
    target: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
  })
  await waitFor(() => expect(complianceApi.uploadFile).toHaveBeenCalled())
  expect(documentIngestApi.uploadAndClassify).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run components/compliance/CarrierDrawer.test.tsx
```

- [ ] **Step 3: Implementar**

- Quitar `<TriageWorkbench …>` del cajón y su import.
- Reemplazar el mapeo de pendientes por `<RenglonPendiente>`.
- `subir()` pasa a llamar el método directo de `complianceApi` sobre
  `POST /compliance-records/{id}/file` con `FormData` (`file`, y `expiration_date` si vino).
  Si `lib/api/compliance.ts` no expone ese método con firma de multipart, agrégalo ahí —
  **no armes el `fetch` dentro del componente**.
- Debajo de la lista, una línea: `¿Tienes muchos documentos de {carrierName}?` +
  `<Link href="/dashboard/compliance?vista=documentos">Llévalos a la Bandeja</Link>`.
- `invalidarCertificacion(queryClient)` se sigue usando igual (`lib/queries/certificacion.ts`).

- [ ] **Step 4: Correr y verificar que pasan**

```bash
npx vitest run components/compliance/ lib/ui/
```

- [ ] **Step 5: Mutar**

Devuelve `uploadAndClassify` al `subir()`. Esperado: falla "sube por el camino directo". Restaura.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance/ monitor-app/frontend/lib/api/compliance.ts
git commit -m "feat(certificacion): el cajon carga por el camino directo y suelta la zona de arrastre"
```

---

## Task 7: La ficha legacy usa el mismo renglón

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx`
- Test: `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx`

**Interfaces:**
- Consumes: `RenglonPendiente` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('la ficha usa el MISMO renglon que Certificacion', async () => {
  render(<DocumentChecklist items={[item({ expiration_policy: 'REQUIRED' })]} canEdit onUpload={vi.fn()} />)
  fireEvent.change(screen.getByTestId('archivo-r1'), {
    target: { files: [new File(['x'], 'f.pdf', { type: 'application/pdf' })] },
  })
  // Si la ficha tuviera su propia version, no pediria la fecha.
  expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run components/dashboard/DocumentChecklist.test.tsx
```

- [ ] **Step 3: Implementar**

`ChecklistItem` gana `expiration_policy`. La fila que hoy dibuja el botón `Upload` de
`DocumentChecklist` se reemplaza por `<RenglonPendiente>`, adaptando `ChecklistItem` a la forma que
el renglón espera. **No se escribe una segunda versión del renglón** — ése fue el criterio explícito
de la HU-04 y es donde reaparecería el frankenstein.

`lib/utils/complianceChecklist.ts` pasa a mapear también `expiration_policy` desde la respuesta.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run components/dashboard/ components/compliance/
```

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/DocumentChecklist.tsx monitor-app/frontend/lib/utils/complianceChecklist.ts monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx
git commit -m "feat(certificacion): la ficha carga con el mismo renglon, no con una segunda version"
```

---

## Task 8: Crear una empresa no saca del módulo

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/compliance/page.tsx:130`
- Test: `monitor-app/frontend/app/dashboard/compliance/page.test.tsx`

**Interfaces:**
- Consumes: `enlaceAFilaAbierta` de `hooks/useFilaAbierta.ts`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('crear una empresa la abre DENTRO de Certificacion', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: /Nueva empresa/i }))
  // dispara el onCreated del panel con una empresa nueva
  fireEvent.click(await screen.findByTestId('crear-empresa-ok'))
  await waitFor(() => expect(push).toHaveBeenCalledWith(
    expect.stringContaining('/dashboard/compliance?abierta='),
  ))
  expect(push).not.toHaveBeenCalledWith(expect.stringContaining('/dashboard/carriers'))
})
```

Adapta el disparo del `onCreated` a cómo el test ya simula `NewCarrierPanel` en ese archivo.

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run app/dashboard/compliance/page.test.tsx
```

Esperado: FAIL — hoy hace `router.push('/dashboard/carriers/${created.id}?tab=documentos')`.

- [ ] **Step 3: Implementar**

```tsx
  function handleCarrierCreated(created: CarrierCreateResult) {
    setNewCarrierOpen(false)
    // Cuarto y ultimo punto de fuga al Empresas legacy. Crear una empresa
    // desde Certificacion y aterrizar en otro modulo obligaba a rehacer el
    // filtro para volver a la cola de trabajo.
    router.push(enlaceAFilaAbierta('/dashboard/compliance', created.id))
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run app/dashboard/compliance/
```

- [ ] **Step 5: Confirmar que no queda ninguna fuga**

```bash
grep -rn "dashboard/carriers" components/compliance/ app/dashboard/compliance/
```

Esperado: **sin coincidencias**.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/app/dashboard/compliance/
git commit -m "fix(certificacion): crear una empresa ya no sale del modulo"
```

---

## Task 9: Verificación de punta a punta

**Files:** ninguno — es verificación.

- [ ] **Step 1: Suites completas**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
cd ../backend/api && venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 2: Aplicar la migración ANTES de desplegar**

`deploy-monitor-api.yml` no corre migraciones. Aplica `20260820100000_expiration_policy.sql` contra
la base de dev y **verifica que existe** antes de pushear:

```sql
SELECT expiration_policy, count(*) FROM public.compliance_requirements GROUP BY 1;
```

Si se despliega la API primero, `/file` y `/pending` consultan una columna inexistente y la pantalla
de Certificación entera responde 500.

- [ ] **Step 3: Click-through en vivo**

Contra `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app`, con Playwright (**no**
claude-in-chrome, la extensión está apagada):

1. Certificación → Conductores → abrir el cajón de **una persona sin documentos cargados**. Los
   desplegables listan todo el catálogo, no sólo lo pendiente: ya se pisó un documento real por
   elegir a ojo.
2. Subir un documento de un requisito con política `NONE` → el pendiente baja sin cambiar de pantalla.
3. Subir uno con política `REQUIRED` → **pide la fecha**, y no sube hasta ponerla.
4. Provocar un error (archivo > 7 MB) → el motivo aparece **en ese renglón**.
5. Revisar la consola del navegador: **cero errores y cero warnings**.
6. Confirmar que no quedaron archivos varados:

```sql
SELECT match_status, count(*) FROM public.document_ingest_items
WHERE created_at > now() - interval '1 hour' GROUP BY 1;
```

Esperado: vacío. El camino directo no pasa por la bandeja.

- [ ] **Step 4: Actualizar el AGENTLOG y cerrar**

Según la regla del proyecto: qué se hizo, siguiente paso exacto, decisiones de arquitectura.

---

## Fuera de alcance (del spec §7, repetido acá para el ejecutor)

- Conectar `document_matcher.py` — es el trabajo siguiente y tiene su propio tamaño.
- Avisos de vencimiento por correo o notificación.
- Que el transportista suba su propia documentación.
- El modelo de datos de Seguros.
- Extracción automática de la fecha desde el PDF.
- **Borrar `has_expiration`** — tiene lectores vivos; su retiro es una tarea futura.
- La dimensión "por cliente" de las condiciones (el anexo Walmart) y el modelo de permisos
  (issue #1). Ninguna de las dos es configuración hoy, y fingir que lo son sería mentir.
