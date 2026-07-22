# Seguros Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/dashboard/seguros` en dos tabs (Pólizas / Cobranza) con un checklist de documentos por póliza (varios tipos de documento versionados, no un archivo único), un libro de cobranza agrupable, y un componente de checklist genérico (nodos circulares) reusable después en Empresas.

**Architecture:** Backend FastAPI (`monitor-app/backend/api`) agrega un catálogo de documentos de seguro (`app.insurance_doc_catalog` + `app.insurance_documents`, mismo patrón que `app.compliance_documents`) y una vista plana de cuotas para cobranza. Frontend Next.js reemplaza la página única de Seguros por un shell de tabs; el checklist de documentos se extrae como componente genérico parametrizado por catálogo.

**Tech Stack:** FastAPI + asyncpg + Supabase Postgres/Storage (backend), Next.js 16 + TanStack Query + Tailwind + lucide-react (frontend), pytest (backend tests), vitest (frontend tests).

## Global Constraints

- Sin emojis en ninguna copy de UI — solo iconos de `lucide-react`.
- pytest corre con el venv `monitor-app/backend/api/venv` (no `.venv`, no anaconda).
- No tocar `extraction_service` ni el pipeline de trips/TMS.
- Ningún push a `dev`/`main` sin aprobación explícita del usuario (dispara deploys) — los commits de este plan quedan locales hasta que el usuario lo pida.
- Migraciones se aplican vía Supabase MCP `apply_migration` contra el proyecto `viclzoftiudkepqnhekv`, Y se guardan como archivo en `monitor-app/backend/supabase/migrations/` (las dos cosas, no solo una).
- Reusar patrones existentes exactamente: `_upsert_document`/`_serialize_document`/`_document_patch_impl`/`_document_upload_impl`/`_document_files_impl` en `monitor-app/backend/api/app/routers/transporters.py:92-196` son la referencia de implementación para el patrón catálogo+versionado — no reinventar la forma.

---

## File Structure

**Backend (crear):**
- `monitor-app/backend/supabase/migrations/20260711000001_insurance_documents.sql` — catálogo, tabla, RLS, backfill, vista plana de cobranza.

**Backend (modificar):**
- `monitor-app/backend/api/app/schemas/insurance.py` — agrega `InsuranceDocumentPatchBody`.
- `monitor-app/backend/api/app/routers/insurance.py` — agrega endpoints de documentos de póliza + endpoint de cuotas planas (cobranza) + KPIs de Pólizas.
- `monitor-app/backend/api/tests/test_insurance.py` — tests de lo anterior.

**Frontend (crear):**
- `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx` — componente genérico de nodos circulares (reusable en Empresas después).
- `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx`
- `monitor-app/frontend/lib/utils/insuranceGrouping.ts` — agrupamiento de cuotas para Cobranza.
- `monitor-app/frontend/lib/utils/insuranceGrouping.test.ts`
- `monitor-app/frontend/components/dashboard/CobranzaTab.tsx`
- `monitor-app/frontend/components/dashboard/CobranzaTab.test.tsx`
- `monitor-app/frontend/components/dashboard/PolizasTab.tsx` — contenido actual de la página, extraído + KPIs nuevos.

**Frontend (modificar):**
- `monitor-app/frontend/lib/types.ts` — tipos nuevos.
- `monitor-app/frontend/lib/api/insurance.ts` — métodos nuevos.
- `monitor-app/frontend/components/dashboard/InsuranceCompanyCard.tsx` — `PolicySection` usa `DocumentChecklist` en vez del botón único Archivo/Subir.
- `monitor-app/frontend/components/dashboard/InsuranceCompanyCard.test.tsx` — ajusta a lo anterior.
- `monitor-app/frontend/app/dashboard/seguros/page.tsx` — shell de tabs, delega a `PolizasTab`/`CobranzaTab`.

---

### Task 1: Migración — catálogo de documentos de seguro + vista de cobranza

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260711000001_insurance_documents.sql`

**Interfaces:**
- Produces: tabla `app.insurance_doc_catalog(doc_code, label, has_expiry, sort_order)`; tabla `app.insurance_documents(id, policy_id, doc_code, status, expiry_date, file_url, storage_path, notes, source, manual_override, updated_by, updated_at)` con `unique(policy_id, doc_code)`; `app.stored_files.owner_type` acepta `'insurance_document'`; vista `app.v_insurance_installments_flat(installment_id, policy_id, transporter_id, rut, business_name, company, policy_number, client_group, installment_number, amount_uf, due_date, status, is_overdue)`.

- [ ] **Step 1: Escribir el archivo de migración completo**

```sql
-- ==============================================================================
-- MÓDULO SEGUROS — REDISEÑO 2026-07-11: catálogo de documentos por póliza +
-- vista plana de cobranza. Spec: docs/superpowers/specs/2026-07-11-seguros-redesign-design.md
--
-- Antes: una póliza tenía un solo archivo versionado (app.stored_files con
-- owner_type='insurance_policy'). Distintos tipos de documento (póliza
-- firmada, certificado de vigencia, endoso, comprobante de pago) tienen su
-- propio ciclo de vida — mismo patrón que app.compliance_documents en
-- Empresas, pero sin entity_type (acá el dueño siempre es una póliza).
-- ==============================================================================

CREATE TABLE app.insurance_doc_catalog (
  doc_code    text PRIMARY KEY,
  label       text NOT NULL,
  has_expiry  boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0
);

INSERT INTO app.insurance_doc_catalog (doc_code, label, has_expiry, sort_order) VALUES
  ('poliza_firmada',        'Póliza firmada',            false, 10),
  ('certificado_vigencia',  'Certificado de vigencia',   true,  20),
  ('endoso',                'Endoso',                     false, 30),
  ('comprobante_pago',      'Comprobante de pago',        false, 40);

CREATE TABLE app.insurance_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        uuid NOT NULL REFERENCES app.insurance_policies(id) ON DELETE CASCADE,
  doc_code         text NOT NULL REFERENCES app.insurance_doc_catalog(doc_code) ON UPDATE CASCADE,
  status           app.compliance_status,
  expiry_date      date,
  file_url         text,
  storage_path     text,
  notes            text,
  source           text NOT NULL DEFAULT 'manual',
  manual_override  boolean NOT NULL DEFAULT true,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, doc_code)
);

CREATE INDEX idx_insurance_documents_policy ON app.insurance_documents (policy_id);

COMMENT ON TABLE app.insurance_documents IS
  'Un estado/archivo por (póliza, tipo de documento) — mismo patrón que app.compliance_documents. source siempre manual: estos documentos no vienen del pipeline centralizer.';

ALTER TABLE app.stored_files DROP CONSTRAINT stored_files_owner_type_check;
ALTER TABLE app.stored_files ADD CONSTRAINT stored_files_owner_type_check
  CHECK (owner_type IN ('compliance_document', 'insurance_policy', 'insurance_document'));

-- Backfill: cada archivo hoy colgado directo de la póliza (owner_type=
-- 'insurance_policy') se migra a una fila insurance_documents con doc_code
-- 'poliza_firmada' (no hay forma de distinguir qué representaba ese archivo
-- único, se asume el caso más común) — mismo storage_path, sin duplicar el
-- archivo físico en Storage.
DO $$
DECLARE
  r record;
  v_doc_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT owner_id AS policy_id FROM app.stored_files WHERE owner_type = 'insurance_policy'
  LOOP
    INSERT INTO app.insurance_documents (policy_id, doc_code, status, source, manual_override)
    VALUES (r.policy_id, 'poliza_firmada', 'ok', 'manual', true)
    ON CONFLICT (policy_id, doc_code) DO NOTHING
    RETURNING id INTO v_doc_id;

    IF v_doc_id IS NULL THEN
      SELECT id INTO v_doc_id FROM app.insurance_documents WHERE policy_id = r.policy_id AND doc_code = 'poliza_firmada';
    END IF;

    UPDATE app.stored_files SET owner_type = 'insurance_document', owner_id = v_doc_id
    WHERE owner_type = 'insurance_policy' AND owner_id = r.policy_id;

    v_doc_id := NULL;
  END LOOP;
END $$;

ALTER TABLE app.insurance_doc_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.insurance_documents   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_doc_catalog_read" ON app.insurance_doc_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "insurance_documents_read"   ON app.insurance_documents   FOR SELECT TO authenticated USING (true);

CREATE POLICY "insurance_doc_catalog_write" ON app.insurance_doc_catalog
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "insurance_documents_write" ON app.insurance_documents
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- Vista plana de cobranza: 1 fila por cuota, con datos de empresa/póliza ya
-- resueltos, para que el frontend agrupe en memoria sin N llamados por
-- empresa (mismo patrón que las vistas de elegibilidad existentes).
CREATE OR REPLACE VIEW app.v_insurance_installments_flat AS
SELECT
  ii.id                                                            AS installment_id,
  ip.id                                                            AS policy_id,
  ip.transporter_id,
  ip.rut,
  COALESCE(t.business_name, ip.contractor_name)                   AS business_name,
  ip.company,
  ip.policy_number,
  ip.client_group,
  ii.installment_number,
  ii.amount_uf,
  ii.due_date,
  ii.status,
  (ii.status = 'vencida' OR (ii.status = 'pendiente' AND ii.due_date < CURRENT_DATE)) AS is_overdue
FROM app.insurance_installments ii
JOIN app.insurance_policies ip ON ip.id = ii.policy_id
LEFT JOIN app.transporters t ON t.id = ip.transporter_id;

COMMENT ON VIEW app.v_insurance_installments_flat IS
  'Cuotas en formato plano (cuota->póliza->empresa ya resuelto) para la vista Cobranza — evita N llamados por empresa; el agrupamiento por semana/mes/trimestre/empresa/aseguradora/cliente GC se hace en memoria en el cliente.';
```

- [ ] **Step 2: Aplicar la migración vía Supabase MCP**

Usar `apply_migration` (project_id `viclzoftiudkepqnhekv`, name `insurance_documents`) con el contenido exacto de arriba.

- [ ] **Step 3: Verificar en vivo**

```sql
select doc_code, label from app.insurance_doc_catalog order by sort_order;
select count(*) from app.v_insurance_installments_flat;
select owner_type, count(*) from app.stored_files group by 1;
```
Esperado: 4 filas en el catálogo; el conteo de `v_insurance_installments_flat` debe ser igual al de `app.insurance_installments` (284 al momento de escribir este plan); `owner_type='insurance_policy'` debe haber desaparecido de `stored_files` (todo migrado a `insurance_document`) salvo que no hubiera ningún archivo subido aún (en cuyo caso no hay filas de ningún tipo).

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260711000001_insurance_documents.sql
git commit -m "feat(seguros): catálogo de documentos por póliza + vista plana de cobranza"
```

---

### Task 2: Backend — schema + helpers de documentos de póliza

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/insurance.py`
- Modify: `monitor-app/backend/api/app/routers/insurance.py`
- Test: `monitor-app/backend/api/tests/test_insurance.py`

**Interfaces:**
- Consumes: `upload_owner_file`/`list_owner_files` de `app/utils/stored_files.py` (ya existen, firma sin cambios).
- Produces: `InsuranceDocumentPatchBody` (schema); `_upsert_insurance_document`, `_serialize_insurance_document` (helpers en `insurance.py`); endpoints `GET /insurance/policies/{pid}/documents`, `PATCH /insurance/policies/{pid}/documents/{doc_code}`, `POST /insurance/policies/{pid}/documents/{doc_code}/file`, `GET /insurance/policies/{pid}/documents/{doc_code}/files`.

- [ ] **Step 1: Escribir el schema nuevo**

Agregar al final de `monitor-app/backend/api/app/schemas/insurance.py`:

```python
class InsuranceDocumentPatchBody(BaseModel):
    status:          Optional[Literal['ok', 'pendiente', 'actualizar', 'n_a', 'factible']] = None
    expiry_date:     Optional[date] = None
    file_url:        Optional[str] = None
    notes:           Optional[str] = None
    manual_override: Optional[bool] = None
```

- [ ] **Step 2: Escribir el test que falla primero (GET documentos de una póliza)**

Agregar a `monitor-app/backend/api/tests/test_insurance.py`:

```python
# ── Documentos de póliza ─────────────────────────────────────────

def test_list_policy_documents_merges_catalog_with_existing():
    pool = AsyncMock()
    pool.fetchval.return_value = "p1"  # policy exists
    pool.fetch.return_value = [
        {"doc_code": "poliza_firmada", "label": "Póliza firmada", "has_expiry": False, "sort_order": 10,
         "id": "d1", "status": "ok", "expiry_date": None, "file_url": None, "storage_path": "x",
         "notes": None, "manual_override": True, "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc)},
        {"doc_code": "endoso", "label": "Endoso", "has_expiry": False, "sort_order": 30,
         "id": None, "status": None, "expiry_date": None, "file_url": None, "storage_path": None,
         "notes": None, "manual_override": None, "updated_at": None},
    ]
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/documents")
    assert res.status_code == 200
    docs = res.json()
    assert docs[0]["doc_code"] == "poliza_firmada"
    assert docs[0]["status"] == "ok"
    assert docs[1]["doc_code"] == "endoso"
    assert docs[1]["status"] is None


def test_list_policy_documents_missing_policy_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/documents")
    assert res.status_code == 404


def test_patch_policy_document_upserts_and_requires_editor():
    pool = AsyncMock()
    pool.fetchval.return_value = "poliza_firmada"  # catálogo válido
    pool.fetchrow.return_value = {
        "id": "d1", "policy_id": "p1", "doc_code": "poliza_firmada", "status": "ok",
        "expiry_date": None, "file_url": None, "storage_path": None, "notes": None,
        "manual_override": True, "updated_by": USER_ID, "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
    }
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_patch_policy_document_requires_editor():
    pool = AsyncMock()
    client = make_client(pool, role="viewer", enforce_roles=True)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 403


def test_patch_policy_document_invalid_doc_code_is_422():
    pool = AsyncMock()
    pool.fetchval.return_value = None  # no existe en el catálogo
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/no_existe", json={"status": "ok"})
    assert res.status_code == 422
```

- [ ] **Step 3: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_insurance.py -k "document" -v
```
Esperado: FAIL (404 en rutas que no existen todavía).

- [ ] **Step 4: Implementar los helpers y endpoints**

Agregar a `monitor-app/backend/api/app/routers/insurance.py` (después de `_serialize_policy`, antes de la sección `SUMMARY`):

```python
from ..schemas.insurance import InsuranceDocumentPatchBody, InstallmentPatchBody, PolicyPatchBody
from ..utils.stored_files import list_owner_files, upload_owner_file


def _serialize_insurance_document(row: dict) -> dict:
    return {
        "doc_code":        row["doc_code"],
        "label":           row["label"],
        "has_expiry":      row["has_expiry"],
        "id":              str(row["id"]) if row.get("id") else None,
        "status":          row.get("status"),
        "expiry_date":     _iso(row.get("expiry_date")),
        "file_url":        row.get("file_url"),
        "storage_path":    row.get("storage_path"),
        "notes":           row.get("notes"),
        "manual_override": row.get("manual_override"),
        "updated_at":      _iso(row.get("updated_at")),
    }


async def _upsert_insurance_document(pool, policy_id: str, doc_code: str, data: dict, updated_by: str) -> dict:
    catalog = await pool.fetchval(
        "SELECT doc_code FROM app.insurance_doc_catalog WHERE doc_code = $1", doc_code,
    )
    if not catalog:
        raise HTTPException(422, f"doc_code inválido: {doc_code}")

    manual_override = data.get("manual_override", True)
    row = await pool.fetchrow(
        """
        INSERT INTO app.insurance_documents
          (policy_id, doc_code, status, expiry_date, file_url, notes, source, manual_override, updated_by, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, 'manual', $7, $8::uuid, NOW())
        ON CONFLICT (policy_id, doc_code) DO UPDATE SET
            status          = COALESCE($3, app.insurance_documents.status),
            expiry_date     = COALESCE($4, app.insurance_documents.expiry_date),
            file_url        = COALESCE($5, app.insurance_documents.file_url),
            notes           = COALESCE($6, app.insurance_documents.notes),
            manual_override = $7,
            updated_by      = $8::uuid,
            updated_at      = NOW()
        RETURNING *
        """,
        policy_id, doc_code, data.get("status"), data.get("expiry_date"),
        data.get("file_url"), data.get("notes"), manual_override, updated_by,
    )
    return dict(row)
```

Agregar los endpoints nuevos al final del archivo (después de `list_policy_files`):

```python
# ── DOCUMENTOS DE PÓLIZA (app.insurance_documents) ──────────────────

@router.get("/policies/{pid}/documents")
async def list_policy_documents(
    pid: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    exists = await pool.fetchval("SELECT id FROM app.insurance_policies WHERE id = $1", pid)
    if not exists:
        raise HTTPException(404, "Póliza no encontrada")

    rows = await pool.fetch(
        """
        SELECT c.doc_code, c.label, c.has_expiry,
               d.id, d.status, d.expiry_date, d.file_url, d.storage_path,
               d.notes, d.manual_override, d.updated_at
        FROM app.insurance_doc_catalog c
        LEFT JOIN app.insurance_documents d ON d.doc_code = c.doc_code AND d.policy_id = $1
        ORDER BY c.sort_order
        """,
        pid,
    )
    return [_serialize_insurance_document(dict(r)) for r in rows]


@router.patch("/policies/{pid}/documents/{doc_code}")
async def patch_policy_document(
    pid: str, doc_code: str, body: InsuranceDocumentPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.insurance_policies WHERE id = $1", pid)
    if not exists:
        raise HTTPException(404, "Póliza no encontrada")
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")
    row = await _upsert_insurance_document(pool, pid, doc_code, data, user["sub"])
    row["label"] = None
    row["has_expiry"] = None
    return _serialize_insurance_document(row)


@router.post("/policies/{pid}/documents/{doc_code}/file")
async def upload_policy_document_file(
    pid: str, doc_code: str, file: UploadFile = File(...),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.insurance_policies WHERE id = $1", pid)
    if not exists:
        raise HTTPException(404, "Póliza no encontrada")
    doc = await _upsert_insurance_document(pool, pid, doc_code, {}, user["sub"])
    stored = await upload_owner_file(
        pool, supabase, owner_type="insurance_document", owner_id=doc["id"],
        key_prefix=f"insurance/{pid}/{doc_code}", file=file, uploaded_by=user["sub"],
    )
    await pool.execute(
        "UPDATE app.insurance_documents SET storage_path = $1, updated_by = $2::uuid, updated_at = NOW() WHERE id = $3",
        stored["storage_path"], user["sub"], doc["id"],
    )
    return stored


@router.get("/policies/{pid}/documents/{doc_code}/files")
async def list_policy_document_files(
    pid: str, doc_code: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    doc_id = await pool.fetchval(
        "SELECT id FROM app.insurance_documents WHERE policy_id = $1 AND doc_code = $2", pid, doc_code,
    )
    if not doc_id:
        return []
    return await list_owner_files(pool, supabase, owner_type="insurance_document", owner_id=doc_id)
```

Nota: en `patch_policy_document`, el `row` que devuelve `_upsert_insurance_document` no trae `label`/`has_expiry` (esas columnas viven en el catálogo, no en `insurance_documents`) — se setean a `None` antes de serializar porque `_serialize_insurance_document` los espera; el frontend no los necesita en la respuesta de un PATCH (ya los tiene del GET inicial).

- [ ] **Step 5: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_insurance.py -k "document" -v
```
Esperado: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/schemas/insurance.py monitor-app/backend/api/app/routers/insurance.py monitor-app/backend/api/tests/test_insurance.py
git commit -m "feat(seguros): endpoints de documentos por póliza (catálogo + versionado)"
```

---

### Task 3: Backend — cuotas planas para Cobranza + KPIs de Pólizas

**Files:**
- Modify: `monitor-app/backend/api/app/routers/insurance.py`
- Test: `monitor-app/backend/api/tests/test_insurance.py`

**Interfaces:**
- Produces: `GET /insurance/installments` (lista plana, todas las cuotas); `GET /insurance/kpis` (`{ expiring_30d, without_policies, incomplete_docs }`).

- [ ] **Step 1: Escribir los tests que fallan primero**

```python
# ── Cuotas planas (Cobranza) ─────────────────────────────────────

def test_list_installments_flat_shape():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "installment_id": "i1", "policy_id": "p1", "transporter_id": "t1", "rut": "12345678-9",
        "business_name": "Transportes Test", "company": "HDI", "policy_number": "4821-A",
        "client_group": "Walmart", "installment_number": 2, "amount_uf": 4.2,
        "due_date": date(2026, 7, 3), "status": "vencida", "is_overdue": True,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/insurance/installments")
    assert res.status_code == 200
    row = res.json()[0]
    assert row["business_name"] == "Transportes Test"
    assert row["is_overdue"] is True
    assert row["amount_uf"] == 4.2


# ── KPIs de Pólizas ───────────────────────────────────────────────

def test_insurance_kpis_shape():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "expiring_30d": 3, "without_policies": 7, "incomplete_docs": 5,
    }
    client = make_client(pool)
    res = client.get("/api/v1/insurance/kpis")
    assert res.status_code == 200
    body = res.json()
    assert body == {"expiring_30d": 3, "without_policies": 7, "incomplete_docs": 5}
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_insurance.py -k "installments_flat or kpis" -v
```
Esperado: FAIL (404).

- [ ] **Step 3: Implementar los endpoints**

Agregar al final de `monitor-app/backend/api/app/routers/insurance.py`:

```python
# ── COBRANZA (cuotas planas) ─────────────────────────────────────

@router.get("/installments")
async def list_installments_flat(pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT * FROM app.v_insurance_installments_flat ORDER BY due_date ASC NULLS LAST"
    )
    return [
        {
            "installment_id":     str(r["installment_id"]),
            "policy_id":          str(r["policy_id"]),
            "transporter_id":     str(r["transporter_id"]) if r["transporter_id"] else None,
            "rut":                r["rut"],
            "business_name":      r["business_name"],
            "company":            r["company"],
            "policy_number":      r["policy_number"],
            "client_group":       r["client_group"],
            "installment_number": r["installment_number"],
            "amount_uf":          _num(r["amount_uf"]),
            "due_date":           _iso(r["due_date"]),
            "status":             r["status"],
            "is_overdue":         r["is_overdue"],
        }
        for r in rows
    ]


# ── KPIs (tab Pólizas) ────────────────────────────────────────────

@router.get("/kpis")
async def insurance_kpis(pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        """
        WITH expiring AS (
            SELECT count(*) AS n FROM app.insurance_policies
            WHERE valid_to IS NOT NULL
              AND valid_to BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        ),
        without_policies AS (
            SELECT count(*) AS n FROM app.transporters t
            WHERE t.is_active AND NOT EXISTS (
                SELECT 1 FROM app.insurance_policies ip WHERE ip.rut = t.rut
            )
        ),
        incomplete AS (
            SELECT count(DISTINCT ip.id) AS n
            FROM app.insurance_policies ip
            CROSS JOIN app.insurance_doc_catalog c
            LEFT JOIN app.insurance_documents d ON d.policy_id = ip.id AND d.doc_code = c.doc_code
            WHERE COALESCE(d.status, 'pendiente') != 'ok'
        )
        SELECT
            (SELECT n FROM expiring)         AS expiring_30d,
            (SELECT n FROM without_policies)  AS without_policies,
            (SELECT n FROM incomplete)        AS incomplete_docs
        """
    )
    return dict(row)
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_insurance.py -v
```
Esperado: todos los tests del archivo pasan (los previos + los 8 nuevos de Tasks 2-3).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/insurance.py monitor-app/backend/api/tests/test_insurance.py
git commit -m "feat(seguros): endpoint de cuotas planas para Cobranza + KPIs de Pólizas"
```

---

### Task 4: Frontend — tipos y cliente API

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`
- Modify: `monitor-app/frontend/lib/api/insurance.ts`

**Interfaces:**
- Produces: tipos `InsuranceDocument`, `InsuranceDocumentPatchResult`, `InsuranceInstallmentFlat`, `InsuranceKpis`; métodos `insuranceApi.listPolicyDocuments`, `.patchDocument`, `.uploadDocumentFile`, `.listDocumentFiles`, `.installmentsFlat`, `.kpis`.

- [ ] **Step 1: Agregar los tipos**

Agregar a `monitor-app/frontend/lib/types.ts`, después de `InsuranceTransporterResponse` (línea ~602):

```typescript
export type InsuranceDocument = {
  doc_code:        string
  label:           string
  has_expiry:      boolean
  id:              string | null
  status:          ComplianceStatus | null
  expiry_date:     string | null
  file_url:        string | null
  storage_path:    string | null
  notes:           string | null
  manual_override: boolean | null
  updated_at:      string | null
}

export type InsuranceDocumentPatchResult = {
  doc_code:        string
  status:          ComplianceStatus | null
  expiry_date:     string | null
  file_url:        string | null
  storage_path:    string | null
  notes:           string | null
  manual_override: boolean | null
  updated_at:      string | null
}

export type InsuranceInstallmentFlat = {
  installment_id:      string
  policy_id:           string
  transporter_id:      string | null
  rut:                 string
  business_name:       string | null
  company:             string
  policy_number:       string
  client_group:        string | null
  installment_number:  number
  amount_uf:           number | null
  due_date:            string | null
  status:              InstallmentStatus
  is_overdue:          boolean
}

export type InsuranceKpis = {
  expiring_30d:      number
  without_policies:  number
  incomplete_docs:   number
}
```

- [ ] **Step 2: Agregar los métodos al cliente API**

Agregar a `monitor-app/frontend/lib/api/insurance.ts`, dentro del objeto `insuranceApi`:

```typescript
  listPolicyDocuments: (pid: string) =>
    apiFetch<InsuranceDocument[]>(`/api/v1/insurance/policies/${pid}/documents`),

  patchDocument: (pid: string, docCode: string, body: {
    status?: string; expiry_date?: string; file_url?: string; notes?: string; manual_override?: boolean
  }) =>
    apiFetch<InsuranceDocumentPatchResult>(`/api/v1/insurance/policies/${pid}/documents/${docCode}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  uploadDocumentFile: (pid: string, docCode: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<StoredFile>(`/api/v1/insurance/policies/${pid}/documents/${docCode}/file`, {
      method: 'POST',
      body: form,
    })
  },

  listDocumentFiles: (pid: string, docCode: string) =>
    apiFetch<StoredFile[]>(`/api/v1/insurance/policies/${pid}/documents/${docCode}/files`),

  installmentsFlat: () =>
    apiFetch<InsuranceInstallmentFlat[]>('/api/v1/insurance/installments'),

  kpis: () =>
    apiFetch<InsuranceKpis>('/api/v1/insurance/kpis'),
```

Y agregar `InsuranceDocument`, `InsuranceDocumentPatchResult`, `InsuranceInstallmentFlat`, `InsuranceKpis` al bloque de `import type` al inicio del archivo.

- [ ] **Step 3: Verificar tipos**

```bash
cd monitor-app/frontend && npx tsc --noEmit
```
Esperado: sin errores nuevos (los tipos/métodos aún no se consumen en ningún componente, así que no debería haber ni siquiera warnings de "unused").

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/lib/api/insurance.ts
git commit -m "feat(seguros): tipos y cliente API para documentos de póliza y cobranza"
```

---

### Task 5: Frontend — componente genérico `DocumentChecklist` (nodos circulares)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx`
- Create: `monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx`

**Interfaces:**
- Consumes: `InsuranceDocument[]`-shaped data, pero tipado genéricamente (no importa `InsuranceDocument` directamente — recibe `{ doc_code, label, status, expiry_date, has_expiry }[]`) para poder reusarse con `TransporterDocument` en el rediseño de Empresas sin cambios.
- Produces: `<DocumentChecklist items={...} onUpload={(docCode, file) => Promise<void>} canEdit={boolean} />`. Nodo por doc: verde+check si `status==='ok'`, rojo+alerta si `status==='actualizar'` (vencido) o si `has_expiry && expiry_date < hoy`, ámbar+círculo vacío si `status` es `null`/`pendiente`.

- [ ] **Step 1: Escribir el test que falla primero**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentChecklist } from './DocumentChecklist'

const ITEMS = [
  { doc_code: 'poliza_firmada', label: 'Póliza firmada', status: 'ok' as const, expiry_date: null, has_expiry: false },
  { doc_code: 'certificado_vigencia', label: 'Certificado de vigencia', status: 'actualizar' as const, expiry_date: '2026-01-01', has_expiry: true },
  { doc_code: 'endoso', label: 'Endoso', status: null, expiry_date: null, has_expiry: false },
]

describe('DocumentChecklist', () => {
  it('renders one node per document with its label', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByText('Póliza firmada')).toBeInTheDocument()
    expect(screen.getByText('Certificado de vigencia')).toBeInTheDocument()
    expect(screen.getByText('Endoso')).toBeInTheDocument()
  })

  it('marks ok documents with a check and pending ones without', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Póliza firmada — al día')).toBeInTheDocument()
    expect(screen.getByTitle('Endoso — pendiente')).toBeInTheDocument()
  })

  it('marks a document with status actualizar as vencido', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Certificado de vigencia — vencido')).toBeInTheDocument()
  })

  it('calls onUpload with the doc_code and the chosen file when canEdit is true', () => {
    const onUpload = vi.fn()
    render(<DocumentChecklist items={ITEMS} canEdit={true} onUpload={onUpload} />)
    const input = screen.getByLabelText('Subir Endoso') as HTMLInputElement
    const file = new File(['x'], 'endoso.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith('endoso', file)
  })

  it('does not render an upload control when canEdit is false', () => {
    render(<DocumentChecklist items={ITEMS} canEdit={false} onUpload={vi.fn()} />)
    expect(screen.queryByLabelText('Subir Endoso')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DocumentChecklist.test.tsx
```
Esperado: FAIL (`Cannot find module './DocumentChecklist'`).

- [ ] **Step 3: Implementar el componente**

```typescript
'use client'

import { Check, Circle, AlertTriangle, Upload } from 'lucide-react'

export type ChecklistItem = {
  doc_code:     string
  label:        string
  status:       'ok' | 'pendiente' | 'actualizar' | 'n_a' | 'factible' | null
  expiry_date:  string | null
  has_expiry:   boolean
}

interface Props {
  items:     ChecklistItem[]
  canEdit:   boolean
  onUpload:  (docCode: string, file: File) => void
}

const TODAY = () => new Date().toISOString().slice(0, 10)

function nodeState(item: ChecklistItem): 'ok' | 'overdue' | 'pending' {
  if (item.status === 'ok') {
    if (item.has_expiry && item.expiry_date && item.expiry_date < TODAY()) return 'overdue'
    return 'ok'
  }
  if (item.status === 'actualizar') return 'overdue'
  if (item.status === 'n_a' || item.status === 'factible') return 'ok'
  return 'pending'
}

function stateLabel(state: 'ok' | 'overdue' | 'pending'): string {
  return state === 'ok' ? 'al día' : state === 'overdue' ? 'vencido' : 'pendiente'
}

export function DocumentChecklist({ items, canEdit, onUpload }: Props) {
  return (
    <div className="flex items-start gap-4 flex-wrap">
      {items.map(item => {
        const state = nodeState(item)
        const nodeCls = state === 'ok'
          ? 'bg-green-500 border-green-500 text-white'
          : state === 'overdue'
            ? 'bg-red-500 border-red-500 text-white'
            : 'bg-white border-amber-400 text-amber-500'
        return (
          <div key={item.doc_code} className="flex flex-col items-center gap-1 w-20 shrink-0">
            <div
              title={`${item.label} — ${stateLabel(state)}`}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${nodeCls}`}
            >
              {state === 'ok' ? <Check size={13} /> : state === 'overdue' ? <AlertTriangle size={12} /> : <Circle size={12} />}
            </div>
            <span className="text-[10px] text-gray-600 text-center leading-tight">{item.label}</span>
            {canEdit && (
              <label className="flex items-center gap-0.5 text-[9px] font-semibold text-gray-500 hover:text-accent cursor-pointer">
                <Upload size={9} /> Subir
                <input
                  type="file"
                  className="hidden"
                  aria-label={`Subir ${item.label}`}
                  onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(item.doc_code, f) }}
                />
              </label>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/DocumentChecklist.test.tsx
```
Esperado: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/DocumentChecklist.tsx monitor-app/frontend/components/dashboard/DocumentChecklist.test.tsx
git commit -m "feat(seguros): componente genérico DocumentChecklist (nodos circulares)"
```

---

### Task 6: Frontend — integrar `DocumentChecklist` en `InsuranceCompanyCard`

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/InsuranceCompanyCard.tsx`
- Modify: `monitor-app/frontend/components/dashboard/InsuranceCompanyCard.test.tsx`

**Interfaces:**
- Consumes: `DocumentChecklist` (Task 5), `insuranceApi.listPolicyDocuments`/`.uploadDocumentFile` (Task 4).

- [ ] **Step 1: Ver el test actual para saber qué se rompe**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InsuranceCompanyCard.test.tsx
```
Anotar qué tests referencian el botón único "Archivo"/"Subir" de `PolicySection` — esos se van a reemplazar.

- [ ] **Step 2: Reemplazar el bloque de archivo único en `PolicySection`**

En `monitor-app/frontend/components/dashboard/InsuranceCompanyCard.tsx`, dentro de `PolicySection` (líneas 90-207 del archivo actual):

1. Eliminar el estado `uploadErr`/`uploading`/`files`/`filesOpen`/`filesLoading` y las funciones `toggleFiles`/`handleUpload` (ya no aplican al archivo único de la póliza).
2. Eliminar el bloque JSX de "Acciones de póliza" que renderiza el botón "Archivo"/"Subir" (líneas ~167-204).
3. Agregar, después del timeline de cuotas, un `useQuery` para el checklist y renderizar `DocumentChecklist`:

```typescript
import { DocumentChecklist } from './DocumentChecklist'
// ... (mantener el resto de imports existentes, quitar Upload/FileText que ya no se usan acá)

function PolicySection({
  policy, canAdmin, onChanged,
}: {
  policy:    InsurancePolicy
  canAdmin:  boolean
  onChanged: (updated: InsurancePolicy) => void
}) {
  const queryClient = useQueryClient()
  const docsQuery = useQuery({
    queryKey: ['insurance', 'policy-documents', policy.id],
    queryFn: () => insuranceApi.listPolicyDocuments(policy.id),
  })

  async function handleDocUpload(docCode: string, file: File) {
    await insuranceApi.uploadDocumentFile(policy.id, docCode, file)
    queryClient.invalidateQueries({ queryKey: ['insurance', 'policy-documents', policy.id] })
  }

  const installments = policy.installments ?? []

  return (
    <div className="border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-text-primary">{policy.company}</p>
          <p className="text-[11px] text-gray-400 font-mono">
            Póliza {policy.policy_number}{policy.endorsement ? ` · Endoso ${policy.endorsement}` : ''}
            {policy.plate ? ` · ${policy.plate}` : ''}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Vigencia: <span className="font-mono text-gray-700">{formatExpiry(policy.valid_from)} – {formatExpiry(policy.valid_to)}</span>
          </p>
        </div>
        {policy.policy_type && (
          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
            {policy.policy_type}
          </span>
        )}
      </div>

      {installments.length === 0 ? (
        <p className="text-[11px] text-gray-300 italic">Sin cuotas registradas</p>
      ) : (
        <div className="flex items-start gap-2 overflow-x-auto pb-1">
          {installments.map(inst => (
            <TimelineNode
              key={inst.id}
              installment={inst}
              canAdmin={canAdmin}
              onPaid={updated => onChanged({
                ...policy,
                installments: installments.map(i => i.id === updated.id ? updated : i),
              })}
            />
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-border/60">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Documentos</p>
        {docsQuery.isPending ? (
          <p className="text-[11px] text-gray-400">Cargando documentos…</p>
        ) : (
          <DocumentChecklist
            items={docsQuery.data ?? []}
            canEdit={canAdmin}
            onUpload={handleDocUpload}
          />
        )}
      </div>

      {policy.payment_url && (
        <a href={policy.payment_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
          <ExternalLink size={10} /> Link de pago
        </a>
      )}
    </div>
  )
}
```

Quitar del import de lucide-react los íconos que ya no se usan en este archivo (`FileText`, `Upload` si no quedan otros usos) y agregar `useQueryClient` si no está importado (ya lo está, se usa en `InsuranceCompanyCard`).

- [ ] **Step 3: Actualizar el test del componente**

En `monitor-app/frontend/components/dashboard/InsuranceCompanyCard.test.tsx`, reemplazar cualquier assertion sobre el botón "Archivo"/"Subir" único por una que mockee `insuranceApi.listPolicyDocuments` y verifique que se renderiza el checklist (buscar el texto de un `doc_code` de ejemplo, p. ej. `"Póliza firmada"`).

- [ ] **Step 4: Correr los tests, confirmar que pasan**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/InsuranceCompanyCard.test.tsx
```
Esperado: todos passed.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/InsuranceCompanyCard.tsx monitor-app/frontend/components/dashboard/InsuranceCompanyCard.test.tsx
git commit -m "refactor(seguros): PolicySection usa DocumentChecklist en vez de archivo único"
```

---

### Task 7: Frontend — agrupamiento de cuotas para Cobranza

**Files:**
- Create: `monitor-app/frontend/lib/utils/insuranceGrouping.ts`
- Create: `monitor-app/frontend/lib/utils/insuranceGrouping.test.ts`

**Interfaces:**
- Produces: `type GroupBy = 'week' | 'month' | 'quarter' | 'transporter' | 'company' | 'client_group' | 'none'`; `groupInstallments(rows: InsuranceInstallmentFlat[], groupBy: GroupBy): { key: string; label: string; rows: InsuranceInstallmentFlat[]; totalUf: number }[]` — el grupo `"Vencidas"` (key `'overdue'`) siempre va primero y solo existe cuando `groupBy` es temporal (`week`/`month`/`quarter`) o `'none'`; para `transporter`/`company`/`client_group` las filas vencidas quedan dentro de su grupo normal (el estado se lee en la fila).

- [ ] **Step 1: Escribir el test que falla primero**

```typescript
import { describe, it, expect } from 'vitest'
import { groupInstallments } from './insuranceGrouping'
import type { InsuranceInstallmentFlat } from '@/lib/types'

const TODAY = new Date().toISOString().slice(0, 10)
const IN_3_DAYS = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

function row(overrides: Partial<InsuranceInstallmentFlat>): InsuranceInstallmentFlat {
  return {
    installment_id: 'i1', policy_id: 'p1', transporter_id: 't1', rut: '11111111-1',
    business_name: 'Empresa A', company: 'HDI', policy_number: '100', client_group: 'Walmart',
    installment_number: 1, amount_uf: 2, due_date: TODAY, status: 'pendiente', is_overdue: false,
    ...overrides,
  }
}

describe('groupInstallments', () => {
  it('puts overdue rows in a fixed "overdue" group first when grouping by week', () => {
    const rows = [
      row({ installment_id: 'a', status: 'vencida', is_overdue: true, due_date: YESTERDAY }),
      row({ installment_id: 'b', status: 'pendiente', is_overdue: false, due_date: IN_3_DAYS }),
    ]
    const groups = groupInstallments(rows, 'week')
    expect(groups[0].key).toBe('overdue')
    expect(groups[0].rows).toHaveLength(1)
    expect(groups[0].rows[0].installment_id).toBe('a')
  })

  it('computes the correct UF subtotal per group', () => {
    const rows = [
      row({ installment_id: 'a', amount_uf: 4.2 }),
      row({ installment_id: 'b', amount_uf: 2.8 }),
    ]
    const groups = groupInstallments(rows, 'none')
    const total = groups.reduce((sum, g) => sum + g.totalUf, 0)
    expect(total).toBeCloseTo(7.0)
  })

  it('does not create a separate overdue group when grouping by client_group', () => {
    const rows = [
      row({ installment_id: 'a', status: 'vencida', is_overdue: true, client_group: 'Walmart' }),
      row({ installment_id: 'b', status: 'pendiente', is_overdue: false, client_group: 'Colun' }),
    ]
    const groups = groupInstallments(rows, 'client_group')
    expect(groups.find(g => g.key === 'overdue')).toBeUndefined()
    expect(groups.map(g => g.key).sort()).toEqual(['Colun', 'Walmart'])
  })

  it('groups by company', () => {
    const rows = [
      row({ installment_id: 'a', company: 'HDI' }),
      row({ installment_id: 'b', company: 'Mapfre' }),
    ]
    const groups = groupInstallments(rows, 'company')
    expect(groups.map(g => g.key).sort()).toEqual(['HDI', 'Mapfre'])
  })

  it('treats rows with amount_uf null as contributing 0 to the subtotal', () => {
    const rows = [row({ installment_id: 'a', amount_uf: null })]
    const groups = groupInstallments(rows, 'none')
    expect(groups[0].totalUf).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/insuranceGrouping.test.ts
```
Esperado: FAIL (`Cannot find module './insuranceGrouping'`).

- [ ] **Step 3: Implementar el agrupamiento**

```typescript
import type { InsuranceInstallmentFlat } from '@/lib/types'

export type GroupBy = 'week' | 'month' | 'quarter' | 'transporter' | 'company' | 'client_group' | 'none'

export type InstallmentGroup = {
  key:      string
  label:    string
  rows:     InsuranceInstallmentFlat[]
  totalUf:  number
}

const TEMPORAL: GroupBy[] = ['week', 'month', 'quarter', 'none']

function isOverdue(row: InsuranceInstallmentFlat): boolean {
  return row.is_overdue
}

function bucketLabel(dueDate: string | null, groupBy: GroupBy): string {
  if (!dueDate) return 'Sin fecha'
  const d = new Date(dueDate + 'T00:00:00')
  if (groupBy === 'week') {
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return `Semana del ${monday.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}`
  }
  if (groupBy === 'month') {
    return d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
  }
  if (groupBy === 'quarter') {
    const q = Math.floor(d.getMonth() / 3) + 1
    return `T${q} ${d.getFullYear()}`
  }
  return 'Todas'
}

function bucketKey(dueDate: string | null, groupBy: GroupBy): string {
  if (!dueDate) return 'sin-fecha'
  const d = new Date(dueDate + 'T00:00:00')
  if (groupBy === 'week') {
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return `week-${monday.toISOString().slice(0, 10)}`
  }
  if (groupBy === 'month') return `month-${d.getFullYear()}-${d.getMonth()}`
  if (groupBy === 'quarter') return `quarter-${d.getFullYear()}-${Math.floor(d.getMonth() / 3)}`
  return 'none'
}

function entityKeyAndLabel(row: InsuranceInstallmentFlat, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === 'transporter') return { key: row.rut, label: row.business_name ?? row.rut }
  if (groupBy === 'company') return { key: row.company, label: row.company }
  return { key: row.client_group ?? 'Sin cliente', label: row.client_group ?? 'Sin cliente' }
}

export function groupInstallments(rows: InsuranceInstallmentFlat[], groupBy: GroupBy): InstallmentGroup[] {
  const groups = new Map<string, InstallmentGroup>()
  const isTemporal = TEMPORAL.includes(groupBy)

  for (const row of rows) {
    if (isTemporal && isOverdue(row)) {
      const g = groups.get('overdue') ?? { key: 'overdue', label: 'Vencidas', rows: [], totalUf: 0 }
      g.rows.push(row)
      g.totalUf += row.amount_uf ?? 0
      groups.set('overdue', g)
      continue
    }

    const { key, label } = isTemporal
      ? { key: bucketKey(row.due_date, groupBy), label: bucketLabel(row.due_date, groupBy) }
      : entityKeyAndLabel(row, groupBy)

    const g = groups.get(key) ?? { key, label, rows: [], totalUf: 0 }
    g.rows.push(row)
    g.totalUf += row.amount_uf ?? 0
    groups.set(key, g)
  }

  const result = Array.from(groups.values())
  result.sort((a, b) => {
    if (a.key === 'overdue') return -1
    if (b.key === 'overdue') return 1
    return a.label.localeCompare(b.label)
  })
  return result
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

```bash
cd monitor-app/frontend && npx vitest run lib/utils/insuranceGrouping.test.ts
```
Esperado: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/utils/insuranceGrouping.ts monitor-app/frontend/lib/utils/insuranceGrouping.test.ts
git commit -m "feat(seguros): agrupamiento de cuotas para Cobranza (semana/mes/trimestre/entidad)"
```

---

### Task 8: Frontend — `CobranzaTab`

**Files:**
- Create: `monitor-app/frontend/components/dashboard/CobranzaTab.tsx`
- Create: `monitor-app/frontend/components/dashboard/CobranzaTab.test.tsx`

**Interfaces:**
- Consumes: `insuranceApi.installmentsFlat()` (Task 4), `groupInstallments` (Task 7), `insuranceApi.patchInstallment` (ya existe).

- [ ] **Step 1: Escribir el test que falla primero**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CobranzaTab } from './CobranzaTab'
import { insuranceApi } from '@/lib/api/insurance'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    installmentsFlat: vi.fn(),
    patchInstallment: vi.fn(),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ROWS = [
  { installment_id: 'a', policy_id: 'p1', transporter_id: 't1', rut: '1-9', business_name: 'Empresa A',
    company: 'HDI', policy_number: '100', client_group: 'Walmart', installment_number: 1,
    amount_uf: 4.2, due_date: '2020-01-01', status: 'vencida' as const, is_overdue: true },
  { installment_id: 'b', policy_id: 'p2', transporter_id: 't2', rut: '2-8', business_name: 'Empresa B',
    company: 'Mapfre', policy_number: '200', client_group: 'Colun', installment_number: 1,
    amount_uf: 2.8, due_date: '2099-01-01', status: 'pendiente' as const, is_overdue: false },
]

describe('CobranzaTab', () => {
  beforeEach(() => {
    vi.mocked(insuranceApi.installmentsFlat).mockResolvedValue(ROWS)
  })

  it('shows the overdue group first with its subtotal', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText(/Vencidas/)).toBeInTheDocument())
    expect(screen.getByText('Empresa A')).toBeInTheDocument()
  })

  it('switches grouping when a different chip is clicked', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cliente GC' }))
    await waitFor(() => expect(screen.getByText('Walmart')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Correr el test, confirmar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/CobranzaTab.test.tsx
```
Esperado: FAIL (`Cannot find module './CobranzaTab'`).

- [ ] **Step 3: Implementar `CobranzaTab`**

```typescript
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Check } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { groupInstallments, type GroupBy } from '@/lib/utils/insuranceGrouping'
import { formatExpiry } from '@/lib/compliance'

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'week',         label: 'Semana' },
  { id: 'month',        label: 'Mes' },
  { id: 'quarter',       label: 'Trimestre' },
  { id: 'transporter',  label: 'Empresa' },
  { id: 'company',      label: 'Aseguradora' },
  { id: 'client_group', label: 'Cliente GC' },
]

interface Props {
  canAdmin: boolean
}

export function CobranzaTab({ canAdmin }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('week')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const query = useQuery({
    queryKey: ['insurance', 'installments-flat'],
    queryFn: () => insuranceApi.installmentsFlat(),
  })

  const groups = useMemo(() => groupInstallments(query.data ?? [], groupBy), [query.data, groupBy])

  function toggleCollapsed(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (query.isPending) {
    return <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
      <Loader2 size={16} className="animate-spin" /> Cargando cuotas…
    </div>
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-[11px] text-gray-400 mr-1">Agrupar por</span>
        {GROUP_OPTIONS.map(opt => (
          <button
            key={opt.id}
            role="button"
            aria-pressed={groupBy === opt.id}
            onClick={() => setGroupBy(opt.id)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
              groupBy === opt.id ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {groups.map(group => {
        const isOverdue = group.key === 'overdue'
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="space-y-2">
            <button
              onClick={() => toggleCollapsed(group.key)}
              className="w-full flex items-center justify-between px-1"
            >
              <span className={`text-[11px] font-bold uppercase tracking-wide ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                {isCollapsed ? '▸' : ''} {group.label} · {group.rows.length}
              </span>
              <span className={`text-xs font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                {group.totalUf.toFixed(1)} UF
              </span>
            </button>
            {!isCollapsed && (
              <div className={`bg-white border rounded-xl overflow-hidden ${isOverdue ? 'border-red-200' : 'border-border'}`}>
                {group.rows.map(row => (
                  <div
                    key={row.installment_id}
                    className="grid items-center px-3.5 py-2.5 border-b border-border/60 last:border-b-0 text-xs"
                    style={{ gridTemplateColumns: '64px 1fr 100px 90px 56px 56px 72px' }}
                  >
                    <span className={`font-semibold ${row.is_overdue ? 'text-red-600' : 'text-gray-600'}`}>
                      {formatExpiry(row.due_date)}
                    </span>
                    <span className="font-semibold text-text-primary truncate">{row.business_name ?? row.rut}</span>
                    <span className="text-gray-400">{row.company}</span>
                    <span className="text-gray-400 font-mono">{row.policy_number}</span>
                    <span className="text-gray-400">{row.installment_number}</span>
                    <span className="font-semibold text-right">{row.amount_uf ?? '—'}</span>
                    {row.status !== 'pagada' && canAdmin && (
                      <button className="justify-self-end flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-border/60 text-gray-500 hover:text-accent hover:border-accent">
                        <Check size={9} /> Pagar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {groups.length === 0 && (
        <p className="bg-white rounded-xl border border-border px-4 py-14 text-center text-sm text-gray-400">
          Sin cuotas registradas
        </p>
      )}
    </div>
  )
}
```

Nota de alcance: el botón "Pagar" en esta tabla queda visual/deshabilitado de lógica en esta tarea (marcar pagada desde Cobranza reusa `insuranceApi.patchInstallment` ya existente) — si se quiere el flujo completo de marcar-pagada-y-refrescar-la-lista, agregar el mismo patrón `useState`+`mutateAsync` que ya usa `TimelineNode` en `InsuranceCompanyCard.tsx:24-56` como referencia exacta.

- [ ] **Step 4: Correr el test, confirmar que pasa**

```bash
cd monitor-app/frontend && npx vitest run components/dashboard/CobranzaTab.test.tsx
```
Esperado: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/CobranzaTab.tsx monitor-app/frontend/components/dashboard/CobranzaTab.test.tsx
git commit -m "feat(seguros): tab Cobranza con agrupamiento y vencidas fijas arriba"
```

---

### Task 9: Frontend — extraer `PolizasTab` y agregar sus KPIs

**Files:**
- Create: `monitor-app/frontend/components/dashboard/PolizasTab.tsx`
- Modify: `monitor-app/frontend/app/dashboard/seguros/page.tsx`

**Interfaces:**
- Consumes: `insuranceApi.kpis()` (Task 3-4), todo el contenido actual de `SegurosPageInner` (KPIs de empresas, búsqueda, `InsuranceCompanyCard`).

- [ ] **Step 1: Mover el contenido actual a `PolizasTab.tsx`**

Copiar el cuerpo completo de `SegurosPageInner` (líneas 37-197 del `page.tsx` actual) a un nuevo archivo `monitor-app/frontend/components/dashboard/PolizasTab.tsx`, renombrando el componente a `PolizasTab` y quitando el wrapper `<Suspense>` (ese se queda en `page.tsx`). Los imports (`insuranceApi`, `createClient`, `useDebouncedValue`, `InsuranceCompanyCard`, utilidades de `insuranceFilters`) se mueven igual.

Agregar, arriba de la franja de KPIs existente (KPI_CARDS), una segunda franja con los 3 KPIs nuevos:

```typescript
const kpisQuery = useQuery({
  queryKey: ['insurance', 'kpis'],
  queryFn: () => insuranceApi.kpis(),
})
```

```jsx
{kpisQuery.data && (
  <div className="flex gap-2 flex-wrap">
    <div className="bg-white border border-border rounded-xl px-3.5 py-2">
      <span className="text-lg font-bold text-amber-600">{kpisQuery.data.expiring_30d}</span>
      <span className="text-[11px] font-medium text-gray-500 ml-2">Pólizas vencen en 30 días</span>
    </div>
    <div className="bg-white border border-border rounded-xl px-3.5 py-2">
      <span className="text-lg font-bold text-gray-500">{kpisQuery.data.without_policies}</span>
      <span className="text-[11px] font-medium text-gray-500 ml-2">Empresas sin pólizas</span>
    </div>
    <div className="bg-white border border-border rounded-xl px-3.5 py-2">
      <span className="text-lg font-bold text-red-600">{kpisQuery.data.incomplete_docs}</span>
      <span className="text-[11px] font-medium text-gray-500 ml-2">Pólizas con documentos incompletos</span>
    </div>
  </div>
)}
```

- [ ] **Step 2: Reescribir `page.tsx` como shell de tabs**

```typescript
'use client'

import { Suspense, useState } from 'react'
import { PolizasTab } from '@/components/dashboard/PolizasTab'
import { CobranzaTab } from '@/components/dashboard/CobranzaTab'
import { useCanAdmin } from '@/hooks/useCanAdmin'

type Tab = 'polizas' | 'cobranza'

export default function SegurosPage() {
  return (
    <Suspense fallback={null}>
      <SegurosPageInner />
    </Suspense>
  )
}

function SegurosPageInner() {
  const [tab, setTab] = useState<Tab>('polizas')
  const canAdmin = useCanAdmin()

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 md:px-6 pt-4">
        <h1 className="font-mulish font-bold text-xl text-text-primary">Seguros</h1>
      </div>
      <div role="tablist" aria-label="Secciones de Seguros" className="flex border-b border-border px-4 md:px-6 mt-2">
        <button
          role="tab"
          aria-selected={tab === 'polizas'}
          onClick={() => setTab('polizas')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'polizas' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Pólizas
        </button>
        <button
          role="tab"
          aria-selected={tab === 'cobranza'}
          onClick={() => setTab('cobranza')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'cobranza' ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Cobranza
        </button>
      </div>
      <div role="tabpanel" className="flex-1 overflow-y-auto">
        {tab === 'polizas'  && <PolizasTab canAdmin={canAdmin} />}
        {tab === 'cobranza' && <CobranzaTab canAdmin={canAdmin} />}
      </div>
    </div>
  )
}
```

Nota: `useCanAdmin` no existe todavía — extraer el `useEffect` de `supabase.auth.getSession()`+lookup de rol que hoy vive inline en `SegurosPageInner` (líneas 44-57 del archivo original) a un hook `monitor-app/frontend/hooks/useCanAdmin.ts` reusable por `PolizasTab` y `CobranzaTab` sin duplicar la lógica:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const ADMIN_ROLES = new Set(['admin', 'owner'])

export function useCanAdmin(): boolean {
  const [canAdmin, setCanAdmin] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])
  return canAdmin
}
```

`PolizasTab` deja de calcular `canAdmin` internamente y lo recibe como prop (igual que `CobranzaTab`).

- [ ] **Step 2b: Crear el hook**

```bash
mkdir -p monitor-app/frontend/hooks
```
Crear `monitor-app/frontend/hooks/useCanAdmin.ts` con el contenido de arriba (si ya existe un directorio `hooks/` con `useDebouncedValue`, agregar el archivo ahí sin crear el directorio).

- [ ] **Step 3: Verificar build y tests**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build
```
Esperado: sin errores de tipos, todos los tests pasan, build compila y genera todas las rutas.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/frontend/components/dashboard/PolizasTab.tsx monitor-app/frontend/app/dashboard/seguros/page.tsx monitor-app/frontend/hooks/useCanAdmin.ts
git commit -m "feat(seguros): shell de tabs Pólizas/Cobranza + KPIs de Pólizas"
```

---

### Task 10: Verificación final end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa backend**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -v
```
Esperado: todos passed (incluye los 70 previos a este plan + los nuevos de Tasks 2-3).

- [ ] **Step 2: Suite completa frontend + build**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build
```
Esperado: 0 errores de tipos, todos los tests pasan, build exitoso con todas las rutas generadas.

- [ ] **Step 3: Verificación SQL post-migración**

```sql
-- Ningún archivo huérfano bajo el owner_type viejo
select count(*) from app.stored_files where owner_type = 'insurance_policy';
-- esperado: 0

-- El catálogo tiene las 4 filas seed
select count(*) from app.insurance_doc_catalog;
-- esperado: 4

-- La vista de cobranza tiene el mismo conteo que la tabla base
select
  (select count(*) from app.insurance_installments) as base,
  (select count(*) from app.v_insurance_installments_flat) as flat;
-- esperado: base == flat
```

- [ ] **Step 4: Smoke visual manual (requiere sesión de navegador autenticada)**

Checklist manual (no automatizable en esta sesión sin navegador):
- `/dashboard/seguros` abre en tab Pólizas por defecto.
- Expandir una empresa → una póliza muestra el checklist de nodos + el timeline de cuotas.
- Subir un documento en un nodo pendiente → el nodo cambia a verde sin recargar la página.
- Cambiar a tab Cobranza → "Vencidas" aparece primero con su subtotal en UF.
- Cambiar el agrupamiento a "Cliente GC" → las filas se reagrupan y el grupo "Vencidas" desaparece (las vencidas quedan dentro de su grupo de cliente).

- [ ] **Step 5: Actualizar AGENTLOG.md**

Agregar una sección fechada resumiendo: qué se implementó (checklist de documentos por póliza, tabs Pólizas/Cobranza, agrupamiento), qué queda pendiente (smoke visual del Step 4, rediseño de Empresas reusando `DocumentChecklist`), y que nada se pusheó todavía (requiere OK explícito del usuario).

---

## Fuera de alcance de este plan (documentado en el spec)

- Rediseño de Empresas — sesión de brainstorm separada, reusa `DocumentChecklist` tal cual (Task 5) sin cambios de props.
- Notificaciones proactivas de cuotas por vencer — la tabla `app.notifications` existe, el cron sigue sin implementarse.
- Mapeo real de qué documento exige cada cliente GC — pendiente de negocio (Fabián).
- El botón "Pagar" de `CobranzaTab` no está conectado a `insuranceApi.patchInstallment` en este plan (queda visual) — conectar es un cambio de ~15 líneas siguiendo el patrón de `TimelineNode.markPaid` en `InsuranceCompanyCard.tsx:42-56`, se dejó fuera para no inflar Task 8 más de lo necesario para el objetivo de este plan (layout + agrupamiento).
- Los cruces "Ver en Cobranza"/"Ver en Pólizas" descritos en el spec (§1, "nunca es un callejón sin salida") no se implementaron en este plan — el mecanismo natural es extender el patrón `?rut=` que ya existe en `page.tsx` (líneas 38-39, 68-76 del archivo original) para que también acepte `?tab=cobranza&policy=<id>`, pero eso implica levantar el estado de tab/expansión desde `PolizasTab`/`CobranzaTab` hacia `page.tsx` — se deja como tarea de seguimiento acotada (una vez validado el layout base) en vez de inflar este plan con el rediseño del manejo de estado entre tabs.
