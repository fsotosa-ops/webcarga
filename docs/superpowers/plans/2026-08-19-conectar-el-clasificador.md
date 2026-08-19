# Conectar el clasificador de la Bandeja · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para seguimiento.

**Goal:** Que un archivo que entra a la Bandeja llegue con su destino propuesto, para que el trabajo
del operador pase a ser *confirmar* en vez de *decidir*.

**Architecture:** El motor `document_matcher.py` ya existe y es **puro** — recibe catálogo y universo
ya cargados. Este trabajo escribe dos lectores (catálogo y universo), los llama **una vez por lote**,
y persiste el resultado en las seis columnas de `document_ingest_items` que **ya existen y están en
cero**. No hay migración y no se toca el motor.

**Tech Stack:** FastAPI + asyncpg sobre Postgres (Supabase). Backend puro: ninguna pantalla cambia.

**Spec:** `docs/superpowers/specs/2026-08-19-conectar-el-clasificador-design.md`

## Global Constraints

- **No se modifica `app/services/document_matcher.py`.** Ni sus umbrales, ni sus vías, ni sus 12
  tests. Si algo parece necesitar un cambio ahí, **detente y reporta**: significa que el cableado
  entendió mal el contrato.
- **No hay migración.** Las seis columnas de destino ya existen: `entity_type`, `entity_id`,
  `requirement_id`, `confidence`, `match_evidence`, `candidates`. Verificado el 2026-08-19: las seis
  en cero sobre 65 filas. Si el plan te lleva a escribir un `ALTER TABLE`, algo se entendió mal.
- **El SQL nuevo se verifica contra Postgres real**, no contra `AsyncMock`. La sandbox llega al
  pooler. Este repo ya tuvo bugs de Postgres que los tests mockeados no detectaron.
- **Cada test nuevo se muta antes de darlo por bueno.** Cambia el código para romperlo, confirma que
  el test falla, restaura. Un test que no muere no es una red.
- **Backend venv**: `monitor-app/backend/api/venv` (no `.venv`, no anaconda).
- **Correr las suites SEPARADAS y no matarlas a mitad**: `pytest -q -m "not integracion"` (~25 s) y
  después `pytest -q -m integracion`. `max_connections` de esta base es **60**, y matar una corrida
  deja los cupos ocupados hasta que expiran — pasó el 19/08 y dejó la base sin atender ~40 minutos.
- **PII**: `match_evidence` guarda el RUT o el nombre que matcheó. Ya están en la base, pero **no
  pueden salir en logs, en reportes ni en mensajes de commit**. Se cuenta y se caracteriza, nunca se
  transcribe.
- **Nada de código muerto.** Si al terminar queda una función sin consumidores, se borra en el mismo
  commit que la deja sin uso, con el `grep` que lo prueba en el mensaje.

---

## Estructura de archivos

**Crear** — `monitor-app/backend/api/app/services/matcher_io.py`
Los dos lectores. Van en un archivo aparte y no dentro del router **a propósito**: el motor es puro
para poder testearse con datos reales, y meter su I/O en un router de 400 líneas devuelve el
acoplamiento que el diseño evitó. Un archivo, una responsabilidad: traducir Postgres a los
dataclasses que el motor espera.

**Modificar** — `monitor-app/backend/api/app/routers/document_ingest.py:34-80`
`_ingest_files` carga catálogo y universo una vez, y clasifica cada archivo antes del `INSERT`.

**Tests**
- Crear: `tests/test_matcher_io.py` — los lectores, contra Postgres real.
- Modificar: `tests/test_document_ingest.py` — que el cableado ocurre y que degrada bien.

---

## Task 1: Los lectores del catálogo y del universo

**Files:**
- Create: `monitor-app/backend/api/app/services/matcher_io.py`
- Test: `monitor-app/backend/api/tests/test_matcher_io.py`

**Interfaces:**
- Consumes: `Catalog`, `RequirementAlias`, `EntityUniverse` de `app.services.document_matcher`.
- Produces:
  ```python
  async def cargar_catalogo(conn) -> Catalog
  async def cargar_universo(conn, carrier_id: str | None = None) -> EntityUniverse
  ```

- [x] **Step 1: Leer los dataclasses que hay que llenar**

Antes de escribir nada:

```bash
cd monitor-app/backend/api
sed -n '69,95p' app/services/document_matcher.py
```

Lo que verás, y es el contrato exacto:

```python
@dataclass(frozen=True)
class RequirementAlias:
    requirement_id: str
    target_entity: str          # CARRIER | DRIVER | ASSET
    alias: str
    priority: int = 0
    requirement_code: str | None = None

@dataclass(frozen=True)
class Catalog:
    aliases: list[RequirementAlias] = field(default_factory=list)

@dataclass(frozen=True)
class EntityUniverse:
    carriers: list[tuple] = field(default_factory=list)   # (id, tax_id, business_name)
    drivers:  list[tuple] = field(default_factory=list)   # (id, tax_id, full_name)
    assets:   list[tuple] = field(default_factory=list)   # (id, license_plate)
```

**Ojo con la trampa**: `public.requirement_filename_aliases` tiene sólo
`(id, requirement_id, alias, priority, created_at)`. **No tiene `target_entity` ni
`requirement_code`** — esos viven en `public.compliance_requirements`, así que el catálogo se arma
con un JOIN. Sin él, `_match_requirement` no puede acotar por tipo de entidad y una licencia se le
podría proponer a un tracto.

- [x] **Step 2: Escribir los tests que fallan**

Crear `tests/test_matcher_io.py`:

```python
"""Los dos lectores que alimentan el motor de match.

El motor es PURO a proposito: recibe el catalogo y el universo ya cargados. Estos
son los unicos que tocan Postgres, y por eso se prueban contra Postgres — este
repo ya tuvo bugs de base que los tests con AsyncMock no detectaron.
"""
import pytest

from app.services.document_matcher import Catalog, EntityUniverse
from app.services.matcher_io import cargar_catalogo, cargar_universo

pytestmark = pytest.mark.integracion


async def test_el_catalogo_trae_el_tipo_de_entidad_de_cada_alias(conexion_revertida):
    """`requirement_filename_aliases` NO tiene target_entity: vive en
    compliance_requirements. Sin el JOIN, `_match_requirement` no puede acotar
    por tipo y una licencia de conducir se le podria proponer a un tracto."""
    catalogo = await cargar_catalogo(conexion_revertida)

    assert isinstance(catalogo, Catalog)
    assert catalogo.aliases, "el catalogo llego vacio: hay 79 alias sembrados"
    assert all(a.target_entity in {"CARRIER", "DRIVER", "ASSET"} for a in catalogo.aliases)
    assert all(a.requirement_code for a in catalogo.aliases), (
        "el manifiesto declara el tipo por codigo, no por alias: sin requirement_code no funciona"
    )


async def test_el_catalogo_cubre_los_37_requisitos(conexion_revertida):
    """Medido el 2026-08-19: 79 alias sobre 37 de 37 requisitos, 2,5 por
    requisito. Si baja, alguien borro alias y el motor deja de reconocer
    documentos sin que nada lo diga."""
    catalogo = await cargar_catalogo(conexion_revertida)
    requisitos = {a.requirement_id for a in catalogo.aliases}

    total = await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.compliance_requirements")
    assert len(requisitos) == total, (
        f"{len(requisitos)} de {total} requisitos tienen alias; los que no lo tengan "
        "son invisibles para el matcher"
    )


async def test_el_universo_completo_trae_las_tres_familias(conexion_revertida):
    universo = await cargar_universo(conexion_revertida)

    assert isinstance(universo, EntityUniverse)
    assert universo.carriers and universo.drivers and universo.assets
    # Las tuplas son planas y su ORDEN es el contrato del motor.
    assert len(universo.carriers[0]) == 3   # (id, tax_id, business_name)
    assert len(universo.drivers[0]) == 3    # (id, tax_id, full_name)
    assert len(universo.assets[0]) == 2     # (id, license_plate)


async def test_acotar_por_empresa_achica_el_universo(conexion_revertida):
    """Es lo que mas sube la precision, y por eso se prueba: acotado, un nombre
    ambiguo cruza con un conductor en vez de con tres homonimos del sistema."""
    completo = await cargar_universo(conexion_revertida)

    carrier_id = await conexion_revertida.fetchval("""
        SELECT carrier_id FROM public.driver_assignments
        WHERE status = 'ACTIVE' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
    """)
    acotado = await cargar_universo(conexion_revertida, str(carrier_id))

    assert len(acotado.drivers) < len(completo.drivers)
    assert len(acotado.carriers) == 1, "acotado a una empresa, la empresa es una sola"


async def test_el_universo_acotado_solo_trae_asignaciones_activas(conexion_revertida):
    """Un conductor desvinculado no es candidato: proponerle un documento a
    alguien que ya no trabaja ahi es peor que no proponer nada."""
    carrier_id = await conexion_revertida.fetchval("""
        SELECT carrier_id FROM public.driver_assignments
        WHERE status = 'ACTIVE' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1
    """)
    universo = await cargar_universo(conexion_revertida, str(carrier_id))

    esperados = await conexion_revertida.fetchval("""
        SELECT count(*) FROM public.driver_assignments
        WHERE carrier_id = $1 AND status = 'ACTIVE'
    """, carrier_id)
    assert len(universo.drivers) == esperados
```

- [x] **Step 3: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_matcher_io.py -q -p no:randomly
```

Esperado: FAIL con `ModuleNotFoundError: app.services.matcher_io`.

- [x] **Step 4: Escribir el módulo**

`app/services/matcher_io.py`:

```python
"""Traduce Postgres a lo que el motor de match espera.

El motor (`document_matcher.py`) es PURO a proposito: recibe el catalogo y el
universo ya cargados y no toca la base. Estos dos lectores son su unica
frontera con Postgres, y viven aparte del router por la misma razon — meter su
I/O adentro de un router de 400 lineas devuelve el acoplamiento que ese diseno
evito.
"""
from .document_matcher import Catalog, EntityUniverse, RequirementAlias

# `requirement_filename_aliases` NO tiene target_entity ni requirement_code:
# viven en `compliance_requirements`. Sin este JOIN, `_match_requirement` no
# puede acotar por tipo de entidad y una licencia de conducir se le podria
# proponer a un tracto.
_SQL_CATALOGO = """
SELECT a.requirement_id::text, a.alias, a.priority,
       r.target_entity, r.requirement_code
FROM public.requirement_filename_aliases a
JOIN public.compliance_requirements r ON r.id = a.requirement_id
"""


async def cargar_catalogo(conn) -> Catalog:
    """Los alias de nombre de archivo, con el tipo de entidad de su requisito."""
    filas = await conn.fetch(_SQL_CATALOGO)
    return Catalog(aliases=[
        RequirementAlias(
            requirement_id=f["requirement_id"],
            target_entity=f["target_entity"],
            alias=f["alias"],
            priority=f["priority"] or 0,
            requirement_code=f["requirement_code"],
        )
        for f in filas
    ])


# Las tuplas son planas y SU ORDEN ES EL CONTRATO del motor:
#   carriers (id, tax_id, business_name) · drivers (id, tax_id, full_name)
#   assets   (id, license_plate)
# Cambiar el orden no falla al desplegar: falla proponiendo el documento
# equivocado, en silencio.
_SQL_CARRIERS = "SELECT id::text, tax_id, business_name FROM public.carriers WHERE ($1::uuid IS NULL OR id = $1)"

_SQL_DRIVERS = """
SELECT d.id::text, d.tax_id, d.full_name
FROM public.drivers d
WHERE $1::uuid IS NULL OR EXISTS (
    SELECT 1 FROM public.driver_assignments da
    WHERE da.driver_id = d.id AND da.carrier_id = $1 AND da.status = 'ACTIVE'
)
"""

_SQL_ASSETS = """
SELECT a.id::text, a.license_plate
FROM public.assets a
WHERE a.license_plate IS NOT NULL AND ($1::uuid IS NULL OR EXISTS (
    SELECT 1 FROM public.asset_assignments aa
    WHERE aa.asset_id = a.id AND aa.carrier_id = $1 AND aa.status = 'ACTIVE'
))
"""


async def cargar_universo(conn, carrier_id: str | None = None) -> EntityUniverse:
    """Las entidades candidatas, opcionalmente acotadas a una empresa.

    ACOTAR ES LO QUE MAS SUBE LA PRECISION, y el motor lo dice: "el scope de
    empresa se aplica ACOTANDO EL UNIVERSO antes de llamar. Asi el scope no
    puede quedar desincronizado entre el filtro y el match". Con una empresa
    fijada los candidatos son ~2 conductores y ~3 vehiculos, no 87 y 124.

    Solo asignaciones ACTIVAS: proponerle un documento a alguien que ya no
    trabaja ahi es peor que no proponer nada.
    """
    return EntityUniverse(
        carriers=[tuple(f) for f in await conn.fetch(_SQL_CARRIERS, carrier_id)],
        drivers=[tuple(f) for f in await conn.fetch(_SQL_DRIVERS, carrier_id)],
        assets=[tuple(f) for f in await conn.fetch(_SQL_ASSETS, carrier_id)],
    )
```

- [x] **Step 5: Correr y verificar que pasan**

```bash
venv/bin/python -m pytest tests/test_matcher_io.py -q -p no:randomly
```

Esperado: **5 passed**. Si `test_el_catalogo_cubre_los_37_requisitos` falla con menos de 37,
**detente y avisa**: alguien borró alias y hay requisitos invisibles para el matcher.

- [x] **Step 6: Mutar**

Quita `r.target_entity` del SELECT y pásale `"CARRIER"` fijo a cada `RequirementAlias`. Esperado:
falla `test_el_catalogo_trae_el_tipo_de_entidad_de_cada_alias`. Restaura.

Después quita el `AND da.status = 'ACTIVE'` de `_SQL_DRIVERS`. Esperado: falla
`test_el_universo_acotado_solo_trae_asignaciones_activas`. Restaura.

- [x] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/services/matcher_io.py \
        monitor-app/backend/api/tests/test_matcher_io.py
git commit -m "feat(bandeja): los lectores que alimentan el motor de match"
```

---

## Task 2: El cableado — un archivo entra ya clasificado

**Files:**
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py:34-80`
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Consumes: `cargar_catalogo(conn)`, `cargar_universo(conn, carrier_id)` (Task 1);
  `match_document(file_name=…, catalog=…, universe=…)` y `classify_match(candidatos)` del motor.
- Produces: cada fila de `document_ingest_items` nace con `match_status`, `entity_type`,
  `entity_id`, `requirement_id`, `confidence`, `match_evidence` y `candidates` poblados.

- [x] **Step 1: Leer la función que se modifica, entera**

```bash
sed -n '34,82p' app/routers/document_ingest.py
```

Lo que hay que entender antes de tocarla:

- Recibe `(conn, supabase, *, carrier_id, files, actor)` y devuelve `(batch_id, items, errors)`.
- **Procesa archivo por archivo, no todo-o-nada**: un MIME inválido no tumba el lote.
- El `INSERT` de la línea ~67 escribe el literal `'UNMATCHED'`. **Ese es el cable que falta.**
- Al final actualiza `document_ingest_batches.unmatched` con `len(items)` — hoy es correcto porque
  todo es UNMATCHED; **después del cambio deja de serlo** y hay que arreglarlo (Step 5).

- [x] **Step 2: Escribir los tests que fallan**

En `tests/test_document_ingest.py`, copiando el armado de mocks que el archivo ya usa
(`grep -n "def make_client\|wire_transactional_conn" tests/test_document_ingest.py`):

```python
def test_un_archivo_entra_con_su_destino_propuesto(monkeypatch):
    """El cable que faltaba. Antes, `document_ingest.py:70` escribia el literal
    'UNMATCHED' en cada archivo, asi que las seis columnas de destino —que
    EXISTEN desde que se creo la tabla— quedaban en cero para siempre."""
    from app.services.document_matcher import MatchCandidate

    monkeypatch.setattr("app.routers.document_ingest.match_document",
                        lambda **kw: [MatchCandidate(
                            entity_type="DRIVER", entity_id="d1", requirement_id="req-1",
                            confidence=0.95,
                            evidence={"entity": {"via": "RUT", "score": 0.95, "raw": "1-9"}},
                        )])
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files",
                files={"files": ("12345678-9_licencia.pdf", b"%PDF-1.4", "application/pdf")})

    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    sql, args = insert.args[0], insert.args[1:]
    assert "entity_id" in sql and "confidence" in sql and "match_evidence" in sql
    assert "'UNMATCHED'" not in sql, (
        "el literal sigue ahi: la fila nace sin clasificar aunque el motor haya respondido"
    )
    assert "AUTO" in args


def test_si_el_motor_falla_el_archivo_igual_entra(monkeypatch):
    """EL ARCHIVO YA ESTA EN STORAGE cuando se clasifica. Si el motor
    explotara y dejaramos propagar, el blob quedaria huerfano y el operador
    veria un error sobre un archivo que si se subio.

    Degradar a UNMATCHED es exactamente el comportamiento de antes del cambio:
    en el peor caso, esta ronda no cambia nada."""
    def explota(**kw):
        raise ValueError("catalogo corrupto")

    monkeypatch.setattr("app.routers.document_ingest.match_document", explota)
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    res = client.post("/api/v1/document-ingest/files",
                      files={"files": ("x.pdf", b"%PDF-1.4", "application/pdf")})

    assert res.status_code == 201
    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    assert "UNMATCHED" in insert.args[1:]


def test_el_catalogo_se_lee_una_vez_por_lote_no_una_por_archivo(monkeypatch):
    """Una carga de 50 documentos hace 2 consultas de catalogo y universo, no
    100. El motor es puro justamente para poder reusar lo cargado."""
    llamadas = {"catalogo": 0, "universo": 0}

    async def catalogo_espia(conn):
        llamadas["catalogo"] += 1
        from app.services.document_matcher import Catalog
        return Catalog(aliases=[])

    async def universo_espia(conn, carrier_id=None):
        llamadas["universo"] += 1
        from app.services.document_matcher import EntityUniverse
        return EntityUniverse()

    monkeypatch.setattr("app.routers.document_ingest.cargar_catalogo", catalogo_espia)
    monkeypatch.setattr("app.routers.document_ingest.cargar_universo", universo_espia)
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files", files=[
        ("files", ("a.pdf", b"%PDF-1.4", "application/pdf")),
        ("files", ("b.pdf", b"%PDF-1.4", "application/pdf")),
        ("files", ("c.pdf", b"%PDF-1.4", "application/pdf")),
    ])

    assert llamadas == {"catalogo": 1, "universo": 1}
```

**Escribe también el helper `_pool_de_ingesta()`** si el archivo no lo tiene: devuelve
`(pool, conn)` con la transacción cableada y `conn.fetchval` devolviendo un `batch_id`. Copia la
forma de los tests de ingesta que ya existen; no inventes una nueva.

- [x] **Step 3: Correr y verificar que fallan**

```bash
venv/bin/python -m pytest tests/test_document_ingest.py -q -k "destino_propuesto or motor_falla or una_vez_por_lote"
```

Esperado: FAIL — hoy el SQL tiene el literal `'UNMATCHED'` y no importa `match_document`.

- [x] **Step 4: Implementar el cableado**

En los imports de `document_ingest.py`:

```python
from ..services.document_matcher import classify_match, match_document
from ..services.matcher_io import cargar_catalogo, cargar_universo
```

Y dentro de `_ingest_files`, **antes** del `for file in files:`:

```python
    # UNA vez por lote, no una por archivo: el motor es puro justamente para
    # poder reusar lo cargado. Una carga de 50 documentos hace 2 consultas, no 100.
    #
    # El universo va acotado a la empresa cuando la hay, y eso es lo que mas
    # sube la precision: ~2 conductores y ~3 vehiculos contra 87 y 124.
    catalogo = await cargar_catalogo(conn)
    universo = await cargar_universo(conn, carrier_id)
```

Y el `INSERT`, que pasa de escribir un literal a escribir el resultado:

```python
        # El archivo YA esta en storage. Si el motor falla, la fila entra
        # UNMATCHED —el comportamiento exacto de antes de esta ronda— en vez de
        # dejar un blob huerfano y mostrarle un error al operador sobre un
        # archivo que si se subio.
        try:
            candidatos = match_document(
                file_name=uploaded["file_name"], catalog=catalogo, universe=universo,
            )
        except Exception:
            candidatos = []
        estado = classify_match(candidatos)
        mejor = candidatos[0] if candidatos else None

        row = await conn.fetchrow(
            """
            INSERT INTO public.document_ingest_items
                (batch_id, storage_path, file_name, mime_type, size_bytes,
                 match_status, entity_type, entity_id, requirement_id,
                 confidence, match_evidence, candidates)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10, $11::jsonb, $12::jsonb)
            RETURNING id::text, file_name, mime_type, size_bytes, storage_path, match_status
            """,
            batch_id, uploaded["storage_path"], uploaded["file_name"],
            uploaded["mime_type"], uploaded["size_bytes"],
            estado,
            mejor.entity_type if mejor else None,
            mejor.entity_id if mejor else None,
            mejor.requirement_id if mejor else None,
            mejor.confidence if mejor else None,
            json.dumps(mejor.evidence if mejor else {}),
            # La lista COMPLETA, para que AMBIGUOUS pueda ofrecer las dos
            # opciones en vez de obligar a empezar de cero.
            json.dumps([
                {"entity_type": c.entity_type, "entity_id": c.entity_id,
                 "requirement_id": c.requirement_id, "confidence": c.confidence,
                 "evidence": c.evidence}
                for c in candidatos
            ]),
        )
```

- [x] **Step 5: Arreglar el contador del lote, que dejó de ser cierto**

La línea ~78 escribe `unmatched = len(items)`. Eso era correcto cuando todo entraba `UNMATCHED`;
**ahora miente**. Con el cambio:

```python
    # `unmatched` cuenta lo que de verdad quedo sin resolver, no el lote entero.
    # Antes daban lo mismo porque todo entraba UNMATCHED; dejarlo asi haria que
    # el contador de la Bandeja pida atencion sobre archivos ya clasificados.
    sin_resolver = sum(1 for i in items if i["match_status"] == "UNMATCHED")
    await conn.execute(
        "UPDATE public.document_ingest_batches SET unmatched = $2 WHERE id = $1",
        batch_id, sin_resolver,
    )
```

- [x] **Step 6: Correr y verificar que pasan**

```bash
venv/bin/python -m pytest tests/test_document_ingest.py -q
venv/bin/python -m pytest tests/ -q -m "not integracion"
```

Esperado: todos verdes. **Si algún test de la Bandeja cambia de número, entiende por qué antes de
ajustarlo**: puede ser el contador del Step 5 haciendo lo suyo, o puede ser un supuesto viejo.

- [x] **Step 7: Mutar**

Tres mutaciones, y las tres tienen que matar su test:

1. Devuelve el literal `'UNMATCHED'` al `INSERT`. → falla `test_un_archivo_entra_con_su_destino_propuesto`.
2. Quita el `try/except` alrededor de `match_document`. → falla `test_si_el_motor_falla_el_archivo_igual_entra`.
3. Mueve `cargar_catalogo` adentro del `for`. → falla `test_el_catalogo_se_lee_una_vez_por_lote`.

Restaura después de cada una.

- [x] **Step 8: Commit**

```bash
git add monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "feat(bandeja): un archivo entra con su destino propuesto"
```

---

## Task 3: Verificar contra archivos reales, que es el único criterio que vale

**Files:** ninguno — es verificación. **Esta tarea es el entregable de verdad**: las anteriores sólo
la hacen posible.

- [x] **Step 1: Ejercitar el motor contra los nombres que ya existen**

No hay muestra de cómo vendrán los ~2.000 documentos y el usuario confirmó que no la tiene. Pero
hay **65 nombres reales** en la Bandeja. Contra Postgres real:

```python
# Guardar como scratch, NO commitear: imprime nombres de archivo, que pueden
# traer RUTs y nombres de personas.
import asyncio, asyncpg
from collections import Counter
from app.services.matcher_io import cargar_catalogo, cargar_universo
from app.services.document_matcher import match_document, classify_match
# Las credenciales del pooler ya estan resueltas en el conftest: usuario
# `postgres.<ref>`, puerto 5432, statement_cache_size=0. No las rearmes.
from tests.conftest import credenciales_integracion

async def main():
    conn = await asyncpg.connect(**credenciales_integracion())
    catalogo = await cargar_catalogo(conn)
    universo = await cargar_universo(conn)
    nombres = [r["file_name"] for r in
               await conn.fetch("SELECT file_name FROM public.document_ingest_items")]
    reparto = Counter(classify_match(
        match_document(file_name=n, catalog=catalogo, universe=universo)) for n in nombres)
    print(reparto)          # <- SOLO el reparto
    await conn.close()

asyncio.run(main())
```

**Imprime el reparto, nunca los nombres.** Son datos personales.

- [x] **Step 2: Leer el resultado, que es lo que decide el trabajo siguiente**

| Reparto | Qué significa | Qué sigue |
|---|---|---|
| `AUTO` + `SUGGESTED` dominan | los nombres traen señal | la columna de sugerencia en la pantalla |
| `AMBIGUOUS` alto | homónimos, o universo demasiado ancho | empujar la carga por empresa |
| `UNMATCHED` domina | los nombres son opacos | **el manifiesto pasa a ser prioritario** |

**Anota el número en el AGENTLOG.** Es la medición que reemplaza a la muestra que no tenemos, y
decide el orden de las tres piezas que quedaron fuera de alcance.

- [x] **Step 3: Medir que no se volvió lento**

El riesgo real de este cambio no es correctitud, es tiempo: 50 archivos × un motor en memoria.

```bash
venv/bin/python -m pytest tests/test_document_ingest.py -q --durations=5
```

Y contra la base, con un lote de verdad: subir 20 archivos por la interfaz de dev y mirar cuánto
tarda. **Si pasa de unos pocos segundos, reportar** — el motor recorre el universo entero por
archivo, y con 124 vehículos eso son 2.480 comparaciones por lote de 20.

- [x] **Step 4: Las dos suites, separadas**

```bash
venv/bin/python -m pytest tests/ -q -m "not integracion"   # ~25 s
venv/bin/python -m pytest tests/ -q -m integracion         # lento
```

**No las corras a la vez y no las mates a mitad.** `max_connections` de esta base es 60.

- [ ] **Step 5: Desplegar y mirar el reparto real**

`deploy-monitor-api.yml` se dispara con el push a `dev`. Después, con archivos que suba el equipo:

```sql
SELECT match_status, count(*), round(avg(confidence), 3) AS confianza_media
FROM public.document_ingest_items
WHERE created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

- [x] **Step 6: Actualizar el AGENTLOG y cerrar**

Qué se hizo, el reparto medido, y el siguiente paso exacto según lo que ese reparto haya dicho.

---

## Fuera de alcance

- **La columna de sugerencia en la pantalla de la Bandeja.** Sin ella el cableado igual sirve:
  `classify-batch` puede preseleccionar desde `entity_id` y `requirement_id`.
- **El manifiesto y su interfaz.** Depende de lo que revele el Step 2 de la Task 3.
- **El nombre canónico derivado de la clasificación.**
- **La ficha de empresa y las dos entradas del sidebar.** Diseñadas en
  `https://claude.ai/code/artifact/8e7bd1f6-b812-4e01-b1e5-2cdcf2bf319e`, sin plan todavía.
- **Auto-aplicar los `AUTO`.** El motor los marca; crear el `compliance_record` sigue siendo
  `classify-batch`, con una persona.
