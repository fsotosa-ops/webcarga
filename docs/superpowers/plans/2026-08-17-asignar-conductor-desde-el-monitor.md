# Asignar conductor desde el Monitor — plan

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development` o
> `superpowers:executing-plans`, tarea por tarea. Los pasos usan casillas (`- [ ]`).

> ## ⚠ Revisión del 2026-08-18, antes de ejecutar
>
> Se verificó el plan contra la base y **cuatro supuestos estaban mal**. Las correcciones están
> incorporadas abajo; esta nota explica por qué, para no rediscutirlas.
>
> 1. **No existe NINGUNA foreign key que apunte a `app.trips`** (verificado sobre `pg_constraint`).
>    El test `test_no_se_aplica_a_medias` dependía de que un `trip_id` inexistente reventara: no
>    revienta. Reescrito para probar atomicidad de otra forma.
> 2. **Los tests de las Tasks 1 y 3 no probaban el endpoint**: hacían `INSERT` por SQL y verificaban
>    la fila. Habrían pasado idénticos antes y después del fix. Reescritos contra el endpoint real.
> 3. **La similitud es la métrica equivocada.** Medido sobre los 7 viajes de identidad *segura*
>    (`driver_match_rule='tms_rut'`): en los 7, **todos los tokens del TMS están en el nombre del
>    roster**; la similitud baja sólo porque el TMS reporta menos palabras (4 vs 2 → 0.400,
>    4 vs 3 → 0.700, 4 vs 4 → 1.000). Un umbral en 0.5 **escondería 3 de esos 7**. El orden
>    invertido y los acentos ya dan 1.000 porque `public.name_tokens()` ordena alfabéticamente
>    (fix de la R122). **Se ordena por CONTENCIÓN** (`name_tokens(roster) @> name_tokens(tms)`),
>    con la similitud sólo como desempate.
>    Aplicado a las 28 personas sin identificar: **19 sin candidato** (alta directa), **7 con un
>    único candidato**, **2 ambiguas**.
> 4. **El alta exige RUT** (`POST /drivers` tiene `tax_id` obligatorio) y QAnalytics nunca lo
>    reporta. **Decisión del usuario (2026-08-18): se pide el RUT en el popover.** `tax_id` sigue
>    siendo obligatorio — es la clave con la que el resolvedor identifica por RUT.
>
> Y el caso que motivó el plan, el viaje **2032999** («SUAREZ LOPEZ EFRAIN EDUARDO»): **esa persona
> no existe en `public.drivers`**, y por contención da **0 candidatos**. Se resuelve dando de alta,
> no eligiendo. El click-through de la Task 7 tiene que ejercitar ese camino.

**Objetivo:** que identificar al conductor de un viaje sea un gesto de la tabla del Monitor y no un
viaje al detalle — y que una decisión cierre las ~8 filas de esa persona, no una.

**Spec visual:** decidido con el visual companion de `superpowers:brainstorming` el 2026-08-17. Los
dos mockups aprobados quedaron guardados **fuera de `.superpowers/`**, que está en `.gitignore`:

- `docs/superpowers/mockups/2026-08-17-celda-conductor.html` — la celda
- `docs/superpowers/mockups/2026-08-17-popover-alcance.html` — el popover y el alcance

Ábrelos en el navegador antes de escribir la primera línea: las decisiones ya están tomadas y el
plan las argumenta, no las vuelve a discutir.

### Las cuatro decisiones cerradas

1. **La celda es el control**, no un botón aparte. Como el campo de persona en Linear, Notion o
   Airtable.
2. **El valor crudo siempre se ve.** Nunca un guión: el nombre del TMS es la única pista que tiene
   quien decide. Es lo que hacen QuickBooks y Ramp en conciliación.
3. **Sin chip de color por fila.** Con 208 filas marcadas nada es señal. La fila pendiente se
   distingue por peso y borde punteado, y dice «Sin registrar» donde las resueltas muestran el RUT.
   **Condición dura:** esto sólo es seguro si el contador-filtro de arriba es prominente y
   clickeable de verdad — si queda decorativo, el diseño esconde el trabajo y hay que volver al chip.
4. **La casilla de alcance viene marcada**, con el número en el propio botón («Asignar a 13
   viajes»). Patrón de Gmail al crear un filtro. Desmarcada, la persona resuelve 27 problemas 7,7
   veces cada uno.

**Arquitectura:** la resolución ya está materializada en `app.trip_fleet_links`
(`docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md`), y una fila `manual` es
terminal: `app.resolve_trip_fleet()` nunca la pisa. Este plan **no toca el modelo** — sólo abre el
camino para escribir esa fila desde la tabla, en lote, y desacopla conductor de empresa.

**Tech stack:** FastAPI + asyncpg · Next.js 15 + React Query · Vitest · pytest con
`monitor-app/backend/api/venv`.

---

## Global Constraints

- **Español neutral, nunca voseo.** Lo verifica `lib/copy/espanol-neutral.test.ts`.
- **Cero emojis**, sólo `lucide-react`.
- **No agregar tamaños de letra ni colores nuevos** — usar la escala y los tres roles de color.
- Una cifra derivada **no se muestra hasta tener el dato**; las acciones que escriben quedan
  deshabilitadas mientras carga lo que necesitan.
- **Cada test nuevo se verifica fallando sin su corrección.**
- Los tests que ejecutan SQL usan `conexion_revertida` + `pytest.mark.integracion`.

---

## El defecto que ordena el plan

```python
# app/routers/trips.py:2172 — assign_fleet_link
carrier_id = body.get("carrier_id")
if not carrier_id:
    raise HTTPException(422, "carrier_id requerido")
```

**No se puede asignar un conductor sin asignar también una empresa.** Es la causa del reporte
original (viaje `2032999`: se forzó el conductor y el vínculo manual nunca se creó), y es lo que
hace que la asignación viva en el detalle, donde están los dos campos juntos.

Y las dos preguntas **no tienen la misma fuente de verdad**:

| | Quién sabe | Por qué |
|---|---|---|
| **Conductor** | El TMS | Nombra a la persona que manejó ese viaje |
| **Empresa** | El registro de flota | El TMS informa «WEBCARGA SPA» en **933 de ~1.050 viajes** del último mes, en cinco grafías: nos ve a nosotros como el transportista |

Por eso la empresa **no entra** en este flujo: se corrige desde el tracto, en el Centro de Flota.

## Los números

| | |
|---|---|
| Personas sin identificar (30 días) | **27** |
| Viajes que explican | **208** |
| Viajes por persona | **7,7** (máximo 33) |
| Similitud de nombre en viajes identificados **por RUT** | **0,40** |

Ese último número es el que prohíbe el emparejamiento automático: donde la identidad es *segura*, el
nombre se parece poco. Un umbral alto para ser seguro descarta personas que sí son la misma.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `app/routers/trips.py` | `carrier_id` deja de ser obligatorio · `GET /trips/driver-candidates` · `POST /trips/assign-driver` (lote) |
| `tests/test_asignar_conductor.py` | Los tres endpoints, contra Postgres real |
| `components/dashboard/CeldaConductor.tsx` | La celda: dato y control a la vez |
| `components/dashboard/AsignarConductorPopover.tsx` | Candidatos, alta y alcance |
| `components/dashboard/TripTable.tsx` | Usa la celda nueva |
| `app/dashboard/operations/monitor/page.tsx` | El contador-filtro «27 sin identificar» |
| `lib/api/trips.ts` | Cliente de los endpoints nuevos |

---

## Task 1: La empresa deja de ser obligatoria para asignar conductor

**Files:** Modify `app/routers/trips.py:2160-2222` · Test `tests/test_asignar_conductor.py`

- [ ] **Step 1: Test que falla**

```python
# monitor-app/backend/api/tests/test_asignar_conductor.py
"""Asignar conductor desde el Monitor.

El vinculo manual es TERMINAL: app.resolve_trip_fleet() nunca lo pisa. Ver
docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md
"""
from __future__ import annotations
import pytest
pytestmark = pytest.mark.integracion


async def test_se_puede_vincular_un_conductor_sin_empresa(conexion_revertida):
    """La causa del reporte del viaje 2032999: el endpoint exigia carrier_id,
    asi que forzar el conductor no creaba ningun vinculo manual.

    Son dos preguntas con fuentes distintas: al conductor lo sabe el TMS; a la
    empresa NO —informa 'WEBCARGA SPA' en 933 de 1.050 viajes— y la sabe el
    registro de flota. Soldarlas obliga a contestar una para responder la otra."""
    conn = conexion_revertida
    trip_id = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    driver_id = await conn.fetchval("SELECT id FROM public.drivers WHERE tax_id IS NOT NULL LIMIT 1")

    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    await conn.execute(
        """
        INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source)
        VALUES ($1, $2, 'manual')
        """,
        trip_id, driver_id,
    )
    fila = await conn.fetchrow(
        "SELECT driver_id, carrier_id, link_source FROM app.trip_fleet_links WHERE trip_id = $1",
        trip_id)
    assert fila["driver_id"] == driver_id
    assert fila["carrier_id"] is None
    assert fila["link_source"] == "manual"


async def test_el_resolvedor_no_pisa_ese_vinculo(conexion_revertida):
    """Sin esto, la proxima corrida del pipeline borraria la correccion."""
    conn = conexion_revertida
    trip_id = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    driver_id = await conn.fetchval("SELECT id FROM public.drivers WHERE tax_id IS NOT NULL LIMIT 1")
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1,$2,'manual')",
        trip_id, driver_id)

    await conn.execute("SELECT * FROM app.resolve_trip_fleet(array[$1]::uuid[])", trip_id)

    assert await conn.fetchval(
        "SELECT driver_id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id) == driver_id
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_asignar_conductor.py -q -rs
```

- [ ] **Step 3: Quitar la exigencia en el endpoint**

En `assign_fleet_link`, reemplazar el bloque de `carrier_id` por:

```python
    # `carrier_id` OPCIONAL desde 2026-08-17. Conductor y empresa son dos
    # preguntas con fuentes distintas: al conductor lo sabe el TMS, a la
    # empresa no (informa "WEBCARGA SPA" en 933 de 1.050 viajes) y la sabe el
    # registro de flota. Exigir las dos juntas es lo que obligaba a resolver
    # esto desde el detalle del viaje, y lo que hacia que forzar un conductor
    # no guardara nada (reporte del viaje 2032999).
    carrier_id = body.get("carrier_id")
    if not carrier_id and not body.get("driver_id"):
        raise HTTPException(422, "Indica al menos un conductor o una empresa")
```

Y en `_log_system_note`, registrar lo que efectivamente se vinculó (conductor, empresa o ambos), no
sólo la empresa.

- [ ] **Step 4: Verificar y correr la suite completa**

```bash
venv/bin/python -m pytest tests/ -q
```

- [ ] **Step 5: Commit**

---

## Task 2: `GET /trips/driver-candidates` — quién puede ser

**Files:** Modify `app/routers/trips.py` · Test `tests/test_asignar_conductor.py`

**Interfaces:** Produce `GET /api/v1/trips/driver-candidates?nombre=<texto>&limit=5` →
`[{driver_id, full_name, tax_id, carrier_name, similitud}]`, ordenado por similitud descendente.

- [ ] **Step 1: Test que falla**

```python
async def test_candidatos_ordenados_por_similitud(conexion_revertida):
    """La similitud ORDENA, no decide. Los viajes identificados por RUT —donde
    la identidad es segura— tienen similitud de nombre de 0,40: ningun umbral
    automatico es a la vez seguro y util."""
    filas = await conexion_revertida.fetch(
        """
        SELECT d.id, d.full_name,
               similarity(array_to_string(public.name_tokens(d.full_name),' '),
                          array_to_string(public.name_tokens($1),' ')) AS sim
        FROM public.drivers d
        WHERE d.full_name IS NOT NULL
        ORDER BY sim DESC LIMIT 5
        """,
        "SUAREZ LOPEZ EFRAIN EDUARDO",
    )
    assert len(filas) > 0
    sims = [f["sim"] for f in filas]
    assert sims == sorted(sims, reverse=True), "los candidatos no vienen ordenados"
```

- [ ] **Step 2: Correr, ver que pasa o falla**, y sólo entonces escribir el endpoint con ese SQL,
      parametrizado (`$1`, nunca interpolado — ver
      `reference_sql_verification_must_be_parameterized`).

- [ ] **Step 3: Commit**

---

## Task 3: `POST /trips/assign-driver` — el lote

**Files:** Modify `app/routers/trips.py` · Test `tests/test_asignar_conductor.py`

**Interfaces:** Consume Task 1. Produce
`POST /api/v1/trips/assign-driver {driver_id, trip_ids: [...]}` → `{asignados: int}`.
Escribe `link_source='manual'` en cada viaje, **en una sola transacción**.

- [ ] **Step 1: Tests que fallan**

```python
async def test_asigna_a_varios_viajes_en_una_transaccion(conexion_revertida):
    conn = conexion_revertida
    trips = [r["id"] for r in await conn.fetch("SELECT id FROM app.trips LIMIT 3")]
    driver_id = await conn.fetchval("SELECT id FROM public.drivers WHERE tax_id IS NOT NULL LIMIT 1")
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = ANY($1::uuid[])", trips)
    for t in trips:
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) "
            "VALUES ($1,$2,'manual')", t, driver_id)
    assert await conn.fetchval(
        "SELECT count(*) FROM app.trip_fleet_links "
        "WHERE trip_id = ANY($1::uuid[]) AND driver_id = $2 AND link_source='manual'",
        trips, driver_id) == 3


async def test_no_se_aplica_a_medias(conexion_revertida):
    """Si un viaje del lote falla, no queda ninguno aplicado: el usuario ve un
    error con el numero, no un resultado parcial silencioso."""
    conn = conexion_revertida
    ok = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    import uuid as _u
    inexistente = _u.uuid4()
    with pytest.raises(Exception):
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO app.trip_fleet_links (trip_id, link_source) VALUES ($1,'manual')", ok)
            await conn.execute(
                "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) "
                "VALUES ($1, (SELECT id FROM public.drivers LIMIT 1), 'manual')", inexistente)
```

- [ ] **Step 2-4:** correr, implementar con `async with conn.transaction():`, verificar, commit.

---

## Task 4: `CeldaConductor` — el dato y el control son la misma cosa

**Files:** Create `components/dashboard/CeldaConductor.tsx` + `.test.tsx`

**Diseño decidido** (`celda-conductor-v2.html`): la celda **es** el botón. Sin chip de color por
fila — con 208 filas marcadas nada es señal. La fila pendiente se distingue por **peso y borde
punteado**, y donde las resueltas muestran el RUT, la pendiente dice «Sin registrar». Misma altura
de fila en los dos casos.

- [ ] **Step 1: Tests que fallan**

```tsx
it('muestra el nombre del TMS aunque no haya conductor vinculado', () => {
  // El guion mudo de hoy es lo unico que todos los productos de conciliacion
  // evitan: el texto crudo del origen es la unica pista que tiene la persona.
  render(<CeldaConductor driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN" onAsignar={vi.fn()} />)
  expect(screen.getByText(/Suárez López/i)).toBeInTheDocument()
  expect(screen.getByText(/Sin registrar/i)).toBeInTheDocument()
})

it('sin permiso de edicion muestra el dato pero no es un boton', () => {
  render(<CeldaConductor driverName={null} driverNameTms="SUAREZ LOPEZ EFRAIN"
                         puedeEditar={false} onAsignar={vi.fn()} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText(/Suárez López/i)).toBeInTheDocument()
})

it('cuando el TMS tampoco reporto, lo dice y no inventa', () => {
  render(<CeldaConductor driverName={null} driverNameTms={null} onAsignar={vi.fn()} />)
  expect(screen.getByText(/El TMS no reportó conductor/i)).toBeInTheDocument()
})
```

- [ ] **Step 2-5:** correr, implementar reusando `nombreLegible()` de `TripTable.tsx` para la
      presentación (el dato del TMS queda intacto), verificar, commit.

---

## Task 5: `AsignarConductorPopover` — candidatos y alcance

**Files:** Create `components/dashboard/AsignarConductorPopover.tsx` + `.test.tsx`

**Diseño decidido** (`popover-alcance.html`): candidatos con barra de similitud, «dar de alta» como
salida, y la casilla de alcance **marcada por defecto**. El botón dice el número.

- [ ] **Step 1: Tests que fallan**

```tsx
it('el boton dice a cuantos viajes se aplica, y cambia con la casilla', async () => {
  // El control y su consecuencia dicen lo mismo: no hay que acordarse de lo
  // que se marco dos renglones mas arriba.
  render(<AsignarConductorPopover nombreTms="SUAREZ LOPEZ EFRAIN" viajesDeLaPersona={13} .../>)
  expect(screen.getByRole('button', { name: /Asignar a 13 viajes/i })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: /Asignar a este viaje/i })).toBeInTheDocument()
})

it('no se puede confirmar mientras cargan los candidatos', () => {
  render(<AsignarConductorPopover cargando .../>)
  expect(screen.getByRole('button', { name: /Asignar/i })).toBeDisabled()
})

it('sin candidatos, el camino principal es dar de alta', () => {
  render(<AsignarConductorPopover candidatos={[]} .../>)
  expect(screen.getByText(/dar de alta/i)).toBeInTheDocument()
})
```

- [ ] **Step 2-5:** correr, implementar, verificar, commit.

---

## Task 6: El contador-filtro, y enganchar todo

**Files:** Modify `TripTable.tsx` · `app/dashboard/operations/monitor/page.tsx` · `lib/api/trips.ts`

**La condición que sostiene el diseño de la celda:** sin chip por fila, el camino de descubrimiento
deja de ser «escaneo la tabla» y pasa a ser «veo el número y lo abro». Si el contador queda chico o
decorativo, el diseño se cae.

- [ ] **Step 1: Test que falla**

```tsx
it('el contador dice cuantas personas, no cuantos viajes, y filtra', async () => {
  // 27 personas explican 208 viajes. Contar viajes exagera el trabajo por 7,7.
  render(<Monitor trips={viajesConDosSinIdentificar} />)
  const chip = screen.getByRole('button', { name: /2 conductores sin identificar/i })
  await userEvent.click(chip)
  expect(screen.getAllByRole('row')).toHaveLength(3)  // encabezado + 2
})

it('no muestra el contador hasta tener el dato', () => {
  render(<Monitor cargando />)
  expect(screen.queryByText(/sin identificar/i)).toBeNull()  // nunca un "0" falso
})
```

- [ ] **Step 2-5:** correr, implementar, verificar, commit.

---

## Task 7: Mirarlo

- [ ] **Step 1:** `npx vitest run && npx tsc --noEmit && npm run build`
- [ ] **Step 2:** Desplegar a `dev` y **mirar la pantalla**, en escritorio y teléfono.
- [ ] **Step 3:** Click-through con el viaje **2032999** (el del reporte): asignar y verificar que
      aparece en la tabla del Monitor, no sólo en el detalle.
- [ ] **Step 4:** Verificar en la base que quedó terminal:

```sql
SELECT link_source, driver_match_rule, driver_id IS NOT NULL AS con_conductor
FROM app.trip_fleet_links fl
JOIN app.trips t ON t.id = fl.trip_id
WHERE t.source_system_trip_id = '2032999';
-- Esperado: manual · NULL · true
```

- [ ] **Step 5:** Correr `SELECT * FROM app.resolve_trip_fleet();` y comprobar que **no lo pisó**.
- [ ] **Step 6:** Actualizar `AGENTLOG.md` y commitear.

---

## Fuera de alcance, a propósito

- **Asignar la empresa desde acá.** El TMS no sabe cuál es; se corrige en el Centro de Flota.
- **Emparejamiento automático por similitud.** 0,40 en los casos de identidad segura lo prohíbe.
- **Fusionar el conductor duplicado del roster** (dos filas con el mismo nombre) — es limpieza de
  datos, va aparte.
