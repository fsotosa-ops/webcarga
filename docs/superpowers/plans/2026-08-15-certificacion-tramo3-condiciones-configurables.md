# Certificación · Tramo 3 — Condiciones configurables

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan `- [ ]` para seguimiento.

**Goal:** Que WebCarga pueda cambiar desde la app a qué vehículos y a qué empresas se les exige cada documento, sin un desarrollador de por medio — y que los 16 remolques sin cámara de frío dejen de arrastrar un requisito imposible de cerrar.

**Architecture:** Tres columnas nuevas en `compliance_requirements` reemplazan la regla que hoy está escrita dentro de los tres triggers `reconcile_new_*`. La regla pasa de ser dos condiciones pegadas —`requirement_level` haciendo de interruptor, más una lista de códigos a mano— a **una sola**, con una columna por significado. Encima, un endpoint que **previsualiza** qué crearía y qué borraría un cambio de regla, y otro que lo aplica. La migración es **behavior-preserving**: no crea ni borra un solo `compliance_record`.

**Tech Stack:** PostgreSQL (Supabase) + PL/pgSQL · FastAPI + asyncpg + pytest (`AsyncMock`) · Next.js 14 App Router + React Query + Tailwind + vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-15-certificacion-tramo3-historial-y-condiciones-design.md`

## Global Constraints

- **Español neutral, nunca voseo.** "Elige", "Marca", "Selecciona". Nunca "Elegí", "Marcá".
- **Cero emojis.** Íconos sólo de `lucide-react`.
- **Tokens visuales existentes** de `app/globals.css`: `--accent`, `--espera`, `--accion`, `--resuelto`, `text-text-primary`, `border-border`. No se introduce paleta nueva.
- Backend: pytest con `monitor-app/backend/api/venv` — **no** `.venv` ni anaconda.
- Al agregar una dependencia a `pyproject.toml`, editar el `Dockerfile` en el mismo commit. Este tramo no agrega ninguna.
- Trabajar sobre `dev`. **No promover a `main`.**
- **El código muerto se borra en el mismo commit que lo deja muerto.** Verificar con `grep -rn "<nombre>"` antes.
- **El SQL nuevo se verifica contra Postgres real** con `PREPARE`/`EXECUTE` y parámetros, no sustituyendo literales. Los `AsyncMock` no detectan SQL inválido.
- **Ninguna migración se aplica sin autorización explícita del usuario.**

---

## File Structure

**Base de datos** (`monitor-app/backend/supabase/migrations/`)

| Archivo | Responsabilidad |
|---|---|
| `20260816000000_requirement_conditions.sql` | Las 3 columnas + el backfill behavior-preserving + los 3 triggers reescritos |

**Backend** (`monitor-app/backend/api/`)

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `app/services/requirement_conditions.py` | **Nuevo.** La regla de aplicabilidad, en un solo lugar: `entidades_que_aplican()` y `diferencias()`. Función pura de SQL, sin I/O de negocio | Crear |
| `app/schemas/requirement.py` | **Nuevo.** `RequirementConditionsPatchBody`, `RecalcPreview`, `RecalcResult` | Crear |
| `app/routers/requirements.py` | El router del catálogo (hoy sólo tiene `GET /compliance-requirements`) | Modificar: `PATCH /{id}/conditions`, `GET /{id}/recalc-preview`, `POST /{id}/recalc` |

**Frontend** (`monitor-app/frontend/`)

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `lib/api/requirements.ts` | **Nuevo.** Cliente de los tres endpoints | Crear |
| `lib/types.ts` | `RequirementConditions`, `RecalcPreview` | Modificar |
| `components/admin/RequirementConditionsPanel.tsx` | **Nuevo.** Un requisito: vigencia + condiciones + vista previa + aplicar | Crear |
| `app/dashboard/admin/configuracion/page.tsx` | Monta la sección nueva | Modificar |

---

## Task 1: Las columnas y el backfill que no cambia nada

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260816000000_requirement_conditions.sql`

**Interfaces:**
- Produces: `compliance_requirements.is_active`, `.applies_to_fleet_service_type_ids`, `.applies_to_management_types`

- [ ] **Step 1: Medir el estado ANTES, para poder comparar**

Correr contra la base (MCP de Supabase) y **guardar el resultado**:

```sql
SELECT r.requirement_code, count(cr.id) AS registros
FROM public.compliance_requirements r
LEFT JOIN public.compliance_records cr ON cr.requirement_id = r.id AND cr.is_current
GROUP BY 1 ORDER BY 1;
```

- [ ] **Step 2: Escribir la migración**

```sql
-- Tramo 3: la regla de a quién se le exige cada documento sale del código de
-- base y pasa a ser dato del catálogo.
--
-- Hoy los tres triggers reconcile_new_* llevan DOS reglas pegadas:
--   requirement_level = 'LEGAL_MANDATORY'
--   OR (requirement_code IN ('MANTENCION_FRIO','RESOLUCION_SANITARIA')
--       AND NEW.asset_type = 'RAMPLA')
-- `requirement_level` es una etiqueta de SEVERIDAD —se usa para mostrar
-- "BÁSICA"/"ADICIONAL"— y hacía de interruptor de siembra a escondidas.

ALTER TABLE public.compliance_requirements
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS applies_to_fleet_service_type_ids UUID[],
    ADD COLUMN IF NOT EXISTS applies_to_management_types TEXT[];

ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_management_types_check CHECK (
        applies_to_management_types IS NULL
        OR (applies_to_management_types <@ ARRAY['TRACTOREO','EQUIPO_COMPLETO']
            AND cardinality(applies_to_management_types) BETWEEN 1 AND 2)
    );

COMMENT ON COLUMN public.compliance_requirements.is_active IS
    'Si el requisito esta vigente. Los CONDITIONAL_OPTIONAL de empresa (SEGURO_EETT, SEGURO_RC_EMPRESA) quedan en false hasta que negocio defina la regla (D8).';
COMMENT ON COLUMN public.compliance_requirements.applies_to_fleet_service_type_ids IS
    'Subtipos de vehiculo a los que aplica. NULL = sin restriccion por subtipo.';
COMMENT ON COLUMN public.compliance_requirements.applies_to_management_types IS
    'Tipos de gestion de empresa a los que aplica. NULL = sin restriccion.';

-- ── Backfill: reproduce EXACTAMENTE la conducta de hoy ────────────────────
-- Los dos condicionales de empresa no se sembraban porque el trigger sólo
-- miraba LEGAL_MANDATORY. Ahora se dice explícito.
UPDATE public.compliance_requirements
   SET is_active = false
 WHERE requirement_code IN ('SEGURO_EETT', 'SEGURO_RC_EMPRESA');

-- Los dos de vehículo se sembraban a toda RAMPLA. Se expresa como "todos los
-- subtipos que NO son el tracto", que es lo mismo en los datos actuales.
UPDATE public.compliance_requirements
   SET applies_to_fleet_service_type_ids = (
        SELECT array_agg(id) FROM app.status_taxonomies
         WHERE domain = 'FLEET_SERVICE_TYPE' AND label <> 'Tractocamión'
   )
 WHERE requirement_code IN ('MANTENCION_FRIO', 'RESOLUCION_SANITARIA');
```

- [ ] **Step 3: Aplicar la migración**

**Pedir autorización explícita al usuario antes de aplicar.** Aplicar con `apply_migration` del MCP de Supabase.

- [ ] **Step 4: Verificar que NO se movió un solo registro**

Correr la consulta del Step 1 otra vez y comparar. **Deben ser idénticas.** Es la condición de aceptación D15 — el backfill toca el catálogo, no los registros.

Verificar además el estado del catálogo:

```sql
SELECT requirement_code, is_active,
       cardinality(applies_to_fleet_service_type_ids) AS subtipos,
       applies_to_management_types
FROM public.compliance_requirements
WHERE requirement_level = 'CONDITIONAL_OPTIONAL' ORDER BY 1;
```

Esperado: `MANTENCION_FRIO` y `RESOLUCION_SANITARIA` con `is_active=true` y **9 subtipos**; `SEGURO_EETT` y `SEGURO_RC_EMPRESA` con `is_active=false`.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260816000000_requirement_conditions.sql
git commit -m "feat(certificacion): las condiciones de cada requisito pasan a ser dato

Tres columnas en compliance_requirements. El backfill reproduce EXACTAMENTE
la conducta de hoy: los 33 obligatorios sin restriccion, los dos de frio
restringidos a los 9 subtipos de remolque, y los dos seguros de D8 en
is_active=false — que es lo que hoy se logra por omision.

Verificado que no se movio un solo compliance_record."
```

---

## Task 2: Los tres triggers dejan de llevar la regla adentro

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260816010000_reconcile_reads_conditions.sql`

**Interfaces:**
- Consumes: las 3 columnas de la Task 1
- Produces: `reconcile_new_asset`, `reconcile_new_carrier`, `reconcile_new_driver` sin regla de negocio adentro

- [ ] **Step 1: Escribir la migración con las tres funciones**

```sql
-- La misma forma para los tres, cambiando sólo la dimensión que cada uno mira.
-- Ya no aparecen `requirement_level` ni códigos escritos a mano.

CREATE OR REPLACE FUNCTION public.reconcile_new_asset()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'ASSET', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'ASSET'
      AND req.is_active
      AND (req.applies_to_fleet_service_type_ids IS NULL
           OR NEW.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_driver()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Un conductor no tiene subtipo ni gestión propios: sólo lo filtra is_active.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'DRIVER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'DRIVER' AND req.is_active
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_carrier()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- shipper_id IS NULL se conserva: los requisitos de un cliente puntual los
    -- siembra trg_reconcile_carrier_shipper cuando se crea la relación, que una
    -- empresa recién creada todavía no tiene.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'CARRIER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'CARRIER'
      AND req.is_active
      AND req.shipper_id IS NULL
      AND (req.applies_to_management_types IS NULL
           OR NEW.management_types && req.applies_to_management_types)
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;
```

> **`&&` es intersección de arreglos**, no igualdad: una empresa mixta (`{TRACTOREO,EQUIPO_COMPLETO}`) matchea un requisito restringido a `{TRACTOREO}`. Es lo correcto — hace tractoreo, aunque también haga otra cosa.
>
> **Si `management_types` es NULL** (246 de 248 empresas hoy), `&&` da NULL y la fila no entra. Es la regla de §5.1 del spec: sin el atributo, no se siembra. Se reconcilia con el recalcular.

- [ ] **Step 2: Aplicar y verificar que el alta sigue funcionando**

**El modo de falla más grave del tramo es un trigger roto**: impide crear empresas, conductores y vehículos. Verificar en transacción con rollback:

```sql
BEGIN;
INSERT INTO public.carriers (tax_id, business_name, operational_status)
VALUES ('99999999-TEST', 'Prueba Trigger T3', 'ONBOARDING')
RETURNING id;
-- Contar lo sembrado: debe dar 15 (los CARRIER activos sin shipper)
SELECT count(*) FROM public.compliance_records
 WHERE entity_id = (SELECT id FROM public.carriers WHERE tax_id='99999999-TEST');
ROLLBACK;
```

Repetir para `drivers` y `assets`. Un asset con `fleet_service_type_id` de rampla debe recibir los 2 condicionales; uno con el de tracto, no.

- [ ] **Step 3: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260816010000_reconcile_reads_conditions.sql
git commit -m "refactor(certificacion): los triggers leen la condicion en vez de llevarla escrita

Desaparecen requirement_level como interruptor de siembra y la lista de
codigos a mano. Una sola regla, la misma forma para los tres.

Verificado en transaccion con rollback que el alta de empresa, conductor y
vehiculo sigue sembrando lo mismo."
```

---

## Task 3: La regla de aplicabilidad, en un solo lugar

**Files:**
- Create: `monitor-app/backend/api/app/services/requirement_conditions.py`
- Test: `monitor-app/backend/api/tests/test_requirement_conditions.py`

**Interfaces:**
- Produces:
  - `SQL_ENTIDADES_QUE_APLICAN: dict[str, str]` — por `target_entity`, el SQL que lista las entidades a las que aplica un requisito dado sus condiciones
  - `async def calcular_diferencias(pool, requirement_id: str) -> dict` → `{"crear": [...], "quitar": [...], "bloqueados": [...]}`

- [ ] **Step 1: Escribir el test que falla**

```python
# tests/test_requirement_conditions.py
import re
from app.services.requirement_conditions import SQL_ENTIDADES_QUE_APLICAN


def test_la_regla_no_menciona_requirement_level_ni_codigos():
    """La regla vive en las columnas de condicion. Si vuelve a aparecer
    requirement_level o un requirement_code escrito a mano, volvimos al
    frankenstein que este tramo vino a sacar."""
    for entidad, sql in SQL_ENTIDADES_QUE_APLICAN.items():
        assert "requirement_level" not in sql, entidad
        assert "MANTENCION_FRIO" not in sql, entidad
        assert "asset_type" not in sql, entidad


def test_hay_una_regla_por_tipo_de_entidad():
    assert set(SQL_ENTIDADES_QUE_APLICAN) == {"CARRIER", "DRIVER", "ASSET"}


def test_las_tres_reglas_filtran_por_is_active():
    for entidad, sql in SQL_ENTIDADES_QUE_APLICAN.items():
        assert "is_active" in sql, entidad
```

- [ ] **Step 2: Correr y ver que falla**

Run: `venv/bin/python -m pytest tests/test_requirement_conditions.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.services.requirement_conditions'`

- [ ] **Step 3: Escribir el servicio**

```python
"""La regla de aplicabilidad de un requisito, en UN solo lugar.

El trigger la aplica al insertar una entidad; este servicio la aplica sobre
las entidades que YA existen, para el recalcular. Son el mismo criterio y por
eso viven juntos: si divergen, la vista previa miente.
"""
from __future__ import annotations

# Por qué el SQL y no ORM: la misma expresión tiene que poder compararse a
# ojo contra la del trigger. Dos lenguajes distintos para la misma regla es
# exactamente cómo divergen.
SQL_ENTIDADES_QUE_APLICAN = {
    "CARRIER": """
        SELECT e.id
        FROM public.carriers e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active AND req.shipper_id IS NULL
          AND (req.applies_to_management_types IS NULL
               OR e.management_types && req.applies_to_management_types)
    """,
    "DRIVER": """
        SELECT e.id
        FROM public.drivers e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active
    """,
    "ASSET": """
        SELECT e.id
        FROM public.assets e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active
          AND (req.applies_to_fleet_service_type_ids IS NULL
               OR e.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
    """,
}


async def calcular_diferencias(pool, requirement_id: str) -> dict:
    """Qué cambiaría si se recalculara este requisito ahora.

    `bloqueados` son los que la regla ya no incluye pero NO se pueden quitar:
    tienen archivo, o edición manual, o un estado distinto de MISSING. Borrar
    un documento cargado porque cambió una regla de catálogo sería destruir
    trabajo real (D13)."""
    req = await pool.fetchrow(
        "SELECT target_entity FROM public.compliance_requirements WHERE id = $1",
        requirement_id,
    )
    if not req:
        return {"crear": [], "quitar": [], "bloqueados": []}

    aplican = SQL_ENTIDADES_QUE_APLICAN[req["target_entity"]]

    crear = await pool.fetch(f"""
        WITH aplican AS ({aplican})
        SELECT a.id::text FROM aplican a
        WHERE NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = a.id AND cr.requirement_id = $1 AND cr.is_current
        )
    """, requirement_id)

    sobran = await pool.fetch(f"""
        WITH aplican AS ({aplican})
        SELECT cr.id::text, cr.entity_id::text,
               (cr.file_url IS NOT NULL OR cr.is_manual_override
                OR cr.status <> 'MISSING') AS bloqueado
        FROM public.compliance_records cr
        WHERE cr.requirement_id = $1 AND cr.is_current
          AND cr.entity_id NOT IN (SELECT id FROM aplican)
    """, requirement_id)

    return {
        "crear":      [r["id"] for r in crear],
        "quitar":     [r["id"] for r in sobran if not r["bloqueado"]],
        "bloqueados": [r["id"] for r in sobran if r["bloqueado"]],
    }
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `venv/bin/python -m pytest tests/test_requirement_conditions.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Verificar el SQL contra Postgres real**

Los `AsyncMock` no detectan SQL inválido. Correr las tres consultas de `SQL_ENTIDADES_QUE_APLICAN` con `PREPARE`/`EXECUTE` y el id real de `MANTENCION_FRIO`:

```sql
PREPARE p(uuid) AS <el SQL de ASSET>;
EXECUTE p('<id de MANTENCION_FRIO>');
```

Esperado: 37 filas (los remolques que hoy lo tienen).

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/services/requirement_conditions.py monitor-app/backend/api/tests/test_requirement_conditions.py
git commit -m "feat(certificacion): la regla de aplicabilidad, en un solo lugar

El trigger la aplica al insertar; este servicio la aplica sobre lo que ya
existe, para el recalcular. Mismo criterio, escrito una vez — si divergen,
la vista previa miente.

Va con test de que la regla NO vuelve a mencionar requirement_level ni
codigos escritos a mano."
```

---

## Task 4: Vista previa y aplicación del recálculo

**Files:**
- Create: `monitor-app/backend/api/app/schemas/requirement.py`
- Modify: `monitor-app/backend/api/app/routers/requirements.py`
- Test: `monitor-app/backend/api/tests/test_requirements.py`

**Interfaces:**
- Consumes: `calcular_diferencias` de la Task 3
- Produces:
  - `PATCH /api/v1/compliance-requirements/{id}/conditions` → el requisito actualizado
  - `GET /api/v1/compliance-requirements/{id}/recalc-preview` → `{crear: int, quitar: int, bloqueados: int}`
  - `POST /api/v1/compliance-requirements/{id}/recalc` → `{creados: int, quitados: int, bloqueados: int}`

- [ ] **Step 1: Escribir los tests que fallan**

```python
# tests/test_requirements.py  (agregar al final)

def test_preview_no_escribe_nada():
    """La vista previa es de sólo lectura. Si escribe, el usuario no puede
    mirar antes de decidir — que es todo el punto."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {"target_entity": "ASSET"}
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements/r1/recalc-preview")

    assert res.status_code == 200
    assert res.json() == {"crear": 0, "quitar": 0, "bloqueados": 0}
    # ni un INSERT, UPDATE o DELETE en todo el camino
    for c in pool.execute.call_args_list:
        assert not re.search(r"\b(INSERT|UPDATE|DELETE)\b", c.args[0], re.I)


def test_recalc_nunca_borra_un_registro_con_documento():
    """D13. Borrar un documento cargado porque cambio una regla de catalogo
    seria destruir trabajo real."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {"target_entity": "ASSET"}
    # uno sin tocar, uno con archivo
    pool.fetch.side_effect = [
        [],  # crear
        [{"id": "rec-libre", "entity_id": "a1", "bloqueado": False},
         {"id": "rec-con-doc", "entity_id": "a2", "bloqueado": True}],
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    assert res.json() == {"creados": 0, "quitados": 1, "bloqueados": 1}
    borrado = [c for c in conn.execute.call_args_list if "DELETE" in c.args[0].upper()]
    assert len(borrado) == 1
    assert borrado[0].args[1] == ["rec-libre"]


def test_patch_conditions_rechaza_una_gestion_inventada():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_management_types": ["SIDER"]})
    assert res.status_code == 422
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `venv/bin/python -m pytest tests/test_requirements.py -v -k "recalc or conditions"`
Expected: FAIL con 404 (las rutas no existen)

- [ ] **Step 3: Escribir los schemas**

```python
# app/schemas/requirement.py
from typing import Literal, Optional
from pydantic import BaseModel

ManagementType = Literal["TRACTOREO", "EQUIPO_COMPLETO"]


class RequirementConditionsPatchBody(BaseModel):
    """Todo opcional: se puede tocar la vigencia sin tocar las condiciones."""
    is_active: Optional[bool] = None
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None

    def sent_fields(self) -> list[str]:
        return [f for f in (
            "is_active", "applies_to_fleet_service_type_ids", "applies_to_management_types",
        ) if getattr(self, f) is not None]


class RecalcPreview(BaseModel):
    crear: int
    quitar: int
    bloqueados: int


class RecalcResult(BaseModel):
    creados: int
    quitados: int
    bloqueados: int
```

- [ ] **Step 4: Escribir los tres endpoints**

```python
# app/routers/requirements.py — agregar

from ..schemas.requirement import RequirementConditionsPatchBody, RecalcPreview, RecalcResult
from ..services.requirement_conditions import SQL_ENTIDADES_QUE_APLICAN, calcular_diferencias
from ..services.audit import log_change


@requirements_router.patch("/{requirement_id}/conditions")
async def patch_requirement_conditions(
    requirement_id: str, body: RequirementConditionsPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    """Cambia la regla, NO los registros. Aplicarla es un acto aparte
    (POST /recalc): guardar y aplicar son dos decisiones distintas."""
    if not body.sent_fields():
        raise HTTPException(422, "Ningún campo enviado")
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE public.compliance_requirements SET
                    is_active = COALESCE($2, is_active),
                    applies_to_fleet_service_type_ids =
                        COALESCE($3::uuid[], applies_to_fleet_service_type_ids),
                    applies_to_management_types =
                        COALESCE($4::text[], applies_to_management_types)
                WHERE id = $1
                RETURNING id, requirement_code, is_active,
                          applies_to_fleet_service_type_ids, applies_to_management_types
                """,
                requirement_id, body.is_active,
                body.applies_to_fleet_service_type_ids, body.applies_to_management_types,
            )
            if not row:
                raise HTTPException(404, "Requisito no encontrado")
            await log_change(
                conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                action="update", source="api",
            )
    return dict(row)


@requirements_router.get("/{requirement_id}/recalc-preview", response_model=RecalcPreview)
async def recalc_preview(
    requirement_id: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Sólo lectura. Sin esto la configuración miente: se cambia la regla y la
    pantalla sigue mostrando lo viejo."""
    d = await calcular_diferencias(pool, requirement_id)
    return {"crear": len(d["crear"]), "quitar": len(d["quitar"]), "bloqueados": len(d["bloqueados"])}


@requirements_router.post("/{requirement_id}/recalc", response_model=RecalcResult)
async def recalc(
    requirement_id: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    d = await calcular_diferencias(pool, requirement_id)
    req = await pool.fetchrow(
        "SELECT target_entity FROM public.compliance_requirements WHERE id = $1", requirement_id)
    if not req:
        raise HTTPException(404, "Requisito no encontrado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            if d["crear"]:
                await conn.execute(
                    """
                    INSERT INTO public.compliance_records
                        (entity_id, entity_type, requirement_id, status, is_current)
                    SELECT unnest($1::uuid[]), $2, $3, 'MISSING', true
                    ON CONFLICT (entity_id, requirement_id) DO NOTHING
                    """,
                    d["crear"], req["target_entity"], requirement_id,
                )
            if d["quitar"]:
                # Sólo los que la vista previa marcó como quitables. Los
                # bloqueados NO se tocan: D13.
                await conn.execute(
                    "DELETE FROM public.compliance_records WHERE id = ANY($1::uuid[])",
                    d["quitar"],
                )
            await log_change(
                conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                action="recalc", source="api",
            )
    return {"creados": len(d["crear"]), "quitados": len(d["quitar"]),
            "bloqueados": len(d["bloqueados"])}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `venv/bin/python -m pytest tests/test_requirements.py -v`
Expected: PASS

- [ ] **Step 6: Verificar la vista previa contra la base real**

Con el id de `MANTENCION_FRIO`, restringir a mano las condiciones a sólo Furgón Congelado/Refrigerado y correr el preview. **Esperado: `quitar` ≈ 16** (11 Furgón Seco + 5 Sider), `bloqueados` 0 — ninguno tiene documento. Revertir el cambio de condiciones después.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/schemas/requirement.py monitor-app/backend/api/app/routers/requirements.py monitor-app/backend/api/tests/test_requirements.py
git commit -m "feat(certificacion): vista previa y aplicacion del recalculo

Guardar la regla y aplicarla son dos actos distintos. La vista previa es de
solo lectura y va con test de que no escribe.

D13: el recalculo nunca borra un registro con archivo, con edicion manual o
fuera de MISSING. Se listan aparte."
```

---

## Task 5: La pantalla de condiciones

**Files:**
- Create: `monitor-app/frontend/lib/api/requirements.ts`
- Create: `monitor-app/frontend/components/admin/RequirementConditionsPanel.tsx`
- Create: `monitor-app/frontend/components/admin/RequirementConditionsPanel.test.tsx`
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/page.tsx`

**Interfaces:**
- Consumes: los tres endpoints de la Task 4
- Produces: `RequirementConditionsPanel`

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
// components/admin/RequirementConditionsPanel.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/requirements', () => ({
  requirementsApi: {
    patchConditions: vi.fn().mockResolvedValue({}),
    recalcPreview:   vi.fn().mockResolvedValue({ crear: 0, quitar: 16, bloqueados: 4 }),
    recalc:          vi.fn().mockResolvedValue({ creados: 0, quitados: 16, bloqueados: 4 }),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { requirementsApi } from '@/lib/api/requirements'
import { RequirementConditionsPanel } from './RequirementConditionsPanel'

const REQ = {
  id: 'r1', requirement_code: 'MANTENCION_FRIO', name: 'Mantención Cámara de Frío',
  target_entity: 'ASSET' as const, is_active: true,
  applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
}
const SUBTIPOS = [
  { id: 't1', label: 'Furgón Congelado / Refrigerado' },
  { id: 't2', label: 'Furgón Seco' },
]

function setup(over = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RequirementConditionsPanel requisito={{ ...REQ, ...over }} subtipos={SUBTIPOS} />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('RequirementConditionsPanel', () => {
  it('un requisito sin restriccion lo dice, en vez de mostrar cero marcas', () => {
    setup()
    expect(screen.getByText(/aplica a todos/i)).toBeInTheDocument()
  })

  it('no aplica el cambio sin mostrar antes que va a pasar', async () => {
    setup()
    fireEvent.click(screen.getByLabelText('Furgón Congelado / Refrigerado'))
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))

    expect(await screen.findByText(/se quitan 16/i)).toBeInTheDocument()
    expect(requirementsApi.recalc).not.toHaveBeenCalled()
  })

  it('nombra los que no puede quitar, en vez de esconderlos', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    expect(await screen.findByText(/4 .*documento/i)).toBeInTheDocument()
  })

  it('aplicar recien despues de la vista previa', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /ver qué cambia/i }))
    await screen.findByText(/se quitan 16/i)
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))
    await waitFor(() => expect(requirementsApi.recalc).toHaveBeenCalledWith('r1'))
  })

  it('un requisito no vigente lo dice', () => {
    setup({ is_active: false })
    expect(screen.getByText(/no está vigente/i)).toBeInTheDocument()
  })

  it('un lector no puede cambiar nada', async () => {
    vi.resetModules()
    vi.doMock('@/hooks/useCanEdit', () => ({ useCanEdit: () => false }))
    const { RequirementConditionsPanel: SoloLectura } = await import('./RequirementConditionsPanel')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SoloLectura requisito={REQ} subtipos={SUBTIPOS} />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: /aplicar/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/admin/RequirementConditionsPanel.test.tsx`
Expected: FAIL — el módulo no existe

- [ ] **Step 3: Escribir el cliente de API**

```ts
// lib/api/requirements.ts
import { apiFetch } from './client'
import type { RequirementConditions, RecalcPreview, RecalcResult } from '@/lib/types'

const BASE = '/api/v1/compliance-requirements'

export const requirementsApi = {
  patchConditions: (id: string, body: Partial<RequirementConditions>) =>
    apiFetch<RequirementConditions>(`${BASE}/${id}/conditions`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  /** Sólo lectura: qué pasaría si se aplicara la regla actual. */
  recalcPreview: (id: string) => apiFetch<RecalcPreview>(`${BASE}/${id}/recalc-preview`),

  recalc: (id: string) => apiFetch<RecalcResult>(`${BASE}/${id}/recalc`, { method: 'POST' }),
}
```

- [ ] **Step 4: Escribir el panel**

```tsx
'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import { useCanEdit } from '@/hooks/useCanEdit'
import type { RequirementConditions } from '@/lib/types'

interface Props {
  requisito: RequirementConditions
  subtipos:  { id: string; label: string }[]
}

/** Configurar a quién se le exige un documento.
 *
 *  Guardar la regla y aplicarla son dos actos distintos, a propósito: cambiar
 *  una condición puede crear o quitar cientos de registros, y nadie debería
 *  descubrirlo después. */
export function RequirementConditionsPanel({ requisito, subtipos }: Props) {
  const canEdit = useCanEdit()
  const qc = useQueryClient()
  const [marcados, setMarcados] = useState<string[]>(
    requisito.applies_to_fleet_service_type_ids ?? [])
  const [verPreview, setVerPreview] = useState(false)

  const preview = useQuery({
    queryKey: ['recalc-preview', requisito.id, marcados],
    queryFn: () => requirementsApi.recalcPreview(requisito.id),
    enabled: verPreview,
  })

  const aplicar = useMutation({
    mutationFn: () => requirementsApi.recalc(requisito.id),
    onSuccess: () => {
      setVerPreview(false)
      qc.invalidateQueries({ queryKey: ['certification-status'] })
      qc.invalidateQueries({ queryKey: ['compliance-pending-drawer'] })
    },
  })

  const sinRestriccion = !marcados.length

  return (
    <div className="border border-border rounded-xl bg-white p-4 space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold text-text-primary">{requisito.name}</span>
        {!requisito.is_active && (
          <span className="text-[10.5px] text-gray-500">no está vigente</span>
        )}
      </div>

      {requisito.target_entity === 'ASSET' && (
        <fieldset>
          <legend className="text-[11px] text-gray-500 pb-1">Se exige a estos vehículos</legend>
          <div className="flex flex-wrap gap-3">
            {subtipos.map(t => (
              <label key={t.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={t.label}
                  disabled={!canEdit}
                  checked={marcados.includes(t.id)}
                  onChange={() => setMarcados(m =>
                    m.includes(t.id) ? m.filter(x => x !== t.id) : [...m, t.id])}
                  className="accent-accent cursor-pointer"
                />
                {t.label}
              </label>
            ))}
          </div>
          {sinRestriccion && (
            <p className="text-[10.5px] text-gray-400 pt-1">
              Sin marcas: aplica a todos los vehículos.
            </p>
          )}
        </fieldset>
      )}

      {canEdit && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setVerPreview(true)}
            className="text-[11.5px] font-semibold text-accion hover:opacity-70 transition-opacity cursor-pointer"
          >
            Ver qué cambia
          </button>
          {verPreview && preview.data && (
            <button
              type="button"
              onClick={() => aplicar.mutate()}
              disabled={aplicar.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {aplicar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Aplicar
            </button>
          )}
        </div>
      )}

      {verPreview && preview.isPending && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Calculando…
        </p>
      )}

      {verPreview && preview.data && (
        <div className="rounded-lg border border-border bg-gray-50 px-3 py-2 text-[11.5px] space-y-1">
          <p>Se agregan {preview.data.crear} · <b>se quitan {preview.data.quitar}</b></p>
          {preview.data.bloqueados > 0 && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {preview.data.bloqueados} ya no corresponden según esta regla pero tienen documento
              cargado. No se tocan: hay que resolverlos de a uno.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run components/admin/RequirementConditionsPanel.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 6: Montar en Configuración y verificar tipos**

Agregar la sección a `app/dashboard/admin/configuracion/page.tsx`, alimentada por `complianceApi.listRequirements()` y `taxonomiesApi.list('FLEET_SERVICE_TYPE')`.

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: todo limpio, sin regresiones sobre 848 tests.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/lib/api/requirements.ts monitor-app/frontend/lib/types.ts monitor-app/frontend/components/admin/ monitor-app/frontend/app/dashboard/admin/configuracion/page.tsx
git commit -m "feat(certificacion): pantalla de condiciones por requisito

Guardar la regla y aplicarla son dos actos distintos. La vista previa dice
cuantos se agregan, cuantos se quitan y cuantos NO se pueden quitar por
tener documento — esos se nombran, no se esconden."
```

---

## Task 6: Verificación de conjunto

- [ ] **Step 1: Suites completas**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest -q
cd ../../frontend && npx vitest run && npx tsc --noEmit && npm run build
```

- [ ] **Step 2: Contra la base real**

Confirmar que el conteo de `compliance_records` por requisito **no cambió** respecto de la medición del Task 1 Step 1, salvo lo que se haya aplicado a propósito desde la pantalla.

- [ ] **Step 3: Click-through en staging con Playwright**

**No saltarlo.** En este módulo mirar la pantalla encontró lo que 841 tests no podían — el cajón que medía cinco pantallas. Probar: marcar sólo Furgón Congelado en Mantención Cámara de Frío, ver la vista previa, aplicar, y confirmar en el embudo que el contador de las empresas afectadas bajó.

- [ ] **Step 4: Revisión de rama completa**

Correr `/code-review` sobre la rama, no sólo por tarea. En el Tramo 1 las nueve revisiones por tarea pasaron limpias y la de conjunto encontró tres bugs críticos; en el Tramo 2 encontró nueve.

- [ ] **Step 5: Actualizar el AGENTLOG**

Regla 3 de `CLAUDE.md`: qué se hizo, próximo paso exacto, decisiones de arquitectura.

---

## Qué queda fuera de este plan

Está en el spec, §7:

- **El historial de versiones como filas.** La capacidad visible ya existe y hay 0 reemplazos en producción. Cuando entre, toca **estos mismos tres triggers**.
- **Las pilas agrupadas** y **conectar `document_matcher.py`**: esperan a que entren documentos reales.
- **La importación desde OneDrive**, con spec propio. Permisos ya verificados (`Sites.Read.All` + `Files.Read.All`); falta el censo.
- **Las reglas de negocio en sí.** Este tramo entrega el mecanismo; qué subtipos llevan cámara de frío y a quién se le exige cada seguro lo define WebCarga desde la pantalla.
- **El recalcular por empresa desde su ficha.** El recalcular **por requisito** de la Task 4 ya
  cubre el caso de §5.1 —un vehículo que la ingesta clasifica después de creado—, así que la
  variante por empresa es comodidad, no capacidad. Y del lado de empresa no tiene uso hasta que D8
  se resuelva: los dos requisitos con condición de gestión están inactivos.
