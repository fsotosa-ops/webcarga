# Bajar el tráfico entre el frontend y la API · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`).

**Goal:** Que abrir una pantalla de Certificación deje de costar decenas de kilobytes sin comprimir
y decenas de filas que no se muestran, para que la API deje de recibir carga que nadie mira.

**Architecture:** Dos frentes independientes. Primero, comprimir en **la capa que llega al
navegador** —hoy nada comprime ahí— y quitar la compresión que quedó en la capa equivocada.
Segundo, que la ficha de empresa pida un **resumen** al llegar y el detalle de cada sujeto **al
desplegarlo**, que es lo que la pantalla ya muestra desde que las tarjetas van plegadas.

**Tech Stack:** FastAPI + asyncpg sobre Postgres (Supabase); Next.js 15 App Router (Route Handlers
como proxy) + React Query.

**Origen:** no hay spec previa. Sale de una pregunta directa del usuario —*"lo que quiero optimizar
es el consumo de datos entre el frontend y el backend para no saturar este último"*— y de las
mediciones que están abajo. **Toda decisión de este plan se apoya en un número medido, no en una
impresión.**

---

## Lo que ya se hizo, y qué enseñó la medición

En `9e9ca546` (ya desplegado en dev) entraron dos cambios:

| Cambio | Resultado medido en dev |
|---|---|
| `refetchOnWindowFocus: false` + `staleTime` 60 s | **Funciona.** Volver a la pestaña genera **0 peticiones** nuevas |
| `GZipMiddleware` en FastAPI | **Está en la capa equivocada** — ver abajo |

**El hallazgo que ordena este plan.** Se midió el peso real que descarga el navegador al abrir la
ficha de una empresa:

```
encodedBodySize: 57.183     decodedBodySize: 57.183     ahorro: 0%
```

Idénticos: **la respuesta llega sin comprimir al navegador.** La causa está en el proxy,
`app/api/v1/[...path]/route.ts`:

```ts
const body = await res.text()          // el fetch de Node DESCOMPRIME solo
return new NextResponse(body, { headers: { 'Content-Type': ... } })
```

El `fetch` de Node descomprime de forma transparente, y el handler devuelve texto plano con sólo
`Content-Type`. O sea que la compresión de FastAPI **sólo ahorra bytes en el salto FastAPI → Next**,
que va entre dos servicios de Cloud Run en la misma región — el salto más barato y rápido de los
dos. El que paga el usuario sigue crudo.

Verificado además que **Next sí comprime su propio HTML** (`content-encoding: gzip` en `/login`) pero
**no comprime las respuestas de los Route Handlers**, que es donde vive toda la API.

## Global Constraints

- **Español neutral, nunca voseo.** Lo vigilan `lib/copy/espanol-neutral.test.ts` y
  `tests/test_espanol_neutral.py`.
- **Cero emojis.** Sólo iconos de `lucide-react`.
- **Trinquetes visuales en MARGEN CERO**: color crudo **1.755**, sub-11px **268**, `<h1>` **9**.
- **Una cifra derivada no se muestra hasta tener el dato.** Y si la respuesta vino truncada, no se
  muestra: ya hay una guarda `completa` en la ficha que hace exactamente eso.
- **El SQL nuevo se verifica contra Postgres real**, no contra `AsyncMock`, y todo endpoint
  modificado lleva un test que cuenta placeholders (`$n`) contra argumentos.
- **Cada test se muta antes de darlo por bueno, y la mutación se decide DESPUÉS de escribir la
  aserción**, nombrando cuál test muere. Si no mata, se dice y se propone la que sí.
- **Nunca `git checkout --` para restaurar una mutación**: respaldar el archivo a mano.
- **Las suites se corren SEPARADAS, en primer plano, y no se matan a mitad.** `max_connections` de
  esta base es **60** y matar una corrida deja los cupos tomados: pasó, y produjo dos fallas
  fantasma que costaron una investigación entera.
- **Backend venv**: `monitor-app/backend/api/venv`.
- **Punto de partida**: backend **749** unitarios + **140** de integración; frontend **1.229** en 130
  archivos.

---

## Estructura de archivos

**Frontend** (`monitor-app/frontend`)
- Modificar: `app/api/v1/[...path]/route.ts` — comprime lo que devuelve al navegador.
- Modificar: `app/dashboard/compliance/[carrierId]/page.tsx` — pide resumen, no todo.
- Modificar: `lib/api/compliance.ts` — el método del resumen.
- Modificar: `lib/types.ts` — la forma del resumen.

**Backend** (`monitor-app/backend/api`)
- Modificar: `app/main.py` — se quita `GZipMiddleware`.
- Eliminar: `tests/test_compresion.py` — su sujeto deja de existir (ver Task 1).
- Modificar: `app/routers/compliance.py` — el endpoint del resumen.

---

## Task 1: Comprimir donde el usuario lo paga

**Files:**
- Modify: `monitor-app/frontend/app/api/v1/[...path]/route.ts`
- Modify: `monitor-app/backend/api/app/main.py`
- Delete: `monitor-app/backend/api/tests/test_compresion.py`
- Test: **Modificar** (NO crear — ya existe): `monitor-app/frontend/app/api/v1/[...path]/route.test.ts`

> **Ese archivo ya tiene 89 líneas y dos `describe`**: uno sobre respuestas sin cuerpo —incluido el
> 204 que rompía TODO `DELETE`— y otro sobre no golpear Auth en cada petición. **Los tests nuevos se
> agregan; ninguno de los existentes se toca.** Si alguno se pusiera rojo, no lo ajustes: significa
> que la compresión rompió algo que ya funcionaba, y eso es un hallazgo, no un test a corregir.

**Interfaces:**
- Produces: el proxy responde con `Content-Encoding: gzip` cuando el cliente lo acepta y el cuerpo
  supera **1024 bytes**; por debajo, sin comprimir.

- [ ] **Step 1: Escribir los tests que fallan**

Se agrega un tercer `describe` al archivo existente. Los `vi.mock` de `next/headers` y
`@supabase/ssr` **ya están arriba en ese archivo**: reusalos, no los declares de nuevo.

```ts
// app/api/v1/[...path]/route.test.ts — describe NUEVO, al final
import { gunzipSync } from 'node:zlib'

function pedido(acepta: string) {
  return new Request('http://localhost/api/v1/lo-que-sea', {
    headers: { 'Accept-Encoding': acepta },
  }) as never
}

const params = Promise.resolve({ path: ['lo-que-sea'] })

describe('el proxy comprime lo que devuelve', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('una respuesta grande viaja comprimida, y se puede descomprimir', async () => {
    // La forma real: JSON con las mismas claves repetidas en cada fila.
    const grande = JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, business_name: 'Transportes De Prueba' })),
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(grande, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    const res = await GET(pedido('gzip'), { params })

    expect(res.headers.get('content-encoding')).toBe('gzip')
    const bytes = Buffer.from(await res.arrayBuffer())
    // Se descomprime y da EXACTAMENTE lo que mandó el backend: comprimir mal
    // rompe la aplicación entera de una forma que sólo se ve en vivo.
    expect(gunzipSync(bytes).toString()).toBe(grande)
    expect(bytes.length).toBeLessThan(grande.length / 5)
  })

  it('una respuesta chica viaja sin comprimir', async () => {
    const chica = JSON.stringify({ ok: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(chica, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    const res = await GET(pedido('gzip'), { params })

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toBe(chica)
  })

  it('si el cliente no acepta gzip, no se comprime', async () => {
    const grande = 'x'.repeat(5000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(grande, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    const res = await GET(pedido('identity'), { params })

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toBe(grande)
  })

  it('comprime sin bloquear el event loop', async () => {
    // `gzipSync` bloquearia el bucle en el camino de cada peticion y con varias
    // en paralelo se serializan: la optimizacion se vuelve el cuello de botella.
    // Se afirma que durante la compresion el bucle sigue atendiendo.
    const grande = 'a'.repeat(2_000_000)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(grande, { status: 200, headers: { 'content-type': 'application/json' } }),
    ))

    let tickCorrio = false
    const enVuelo = GET(pedido('gzip'), { params })
    setImmediate(() => { tickCorrio = true })
    await enVuelo

    expect(tickCorrio, 'el bucle no atendio nada mientras comprimia').toBe(true)
  })

  it('un 204 sigue sin cuerpo', async () => {
    // Ya rompió una vez: construir una Response con cuerpo para 204 lanza
    // TypeError y el navegador veía un 502 en TODO DELETE de la app.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const res = await GET(pedido('gzip'), { params })

    expect(res.status).toBe(204)
    expect(res.headers.get('content-encoding')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/frontend
npx vitest run "app/api/v1/[...path]/route.test.ts"
```

### Por qué acá y no en el lugar del libro

**Lo estándar es que el proxy no toque la codificación**: comprime el origen y cada salto reenvía
`Content-Encoding` intacto — nginx, Envoy, Cloudflare y el propio proxy de Cloud Run funcionan así.
Hoy este proxy hace media anomalía: descomprime y no vuelve a comprimir.

Aplicar lo estándar exige dejar `fetch` —descomprime solo y no se puede desactivar— por
`undici.request` o el módulo `http`: **una dependencia nueva** y reescribir el cliente HTTP de un
archivo que ya maneja con cuidado la autenticación, los cuerpos multipart binarios y los 204 sin
cuerpo. Este repo ya tuvo dos incidentes de deriva de dependencias entre `pyproject.toml` y el
Dockerfile.

Se elige comprimir en el proxy **a sabiendas**, por dos razones: no agrega dependencias, y pone la
CPU de comprimir en el frontend en vez de en la API — que es el servicio que este trabajo quiere
descargar, y el que escala con usuarios.

**Cuándo revisar esta decisión:** el día que haya un balanceador con CDN delante de Cloud Run, el
borde comprime solo y esto se borra entero. Y si alguna vez otro cliente consume la API sin pasar
por el proxy, la compresión vuelve al backend.

- [ ] **Step 3: Comprimir en el proxy**

En `route.ts`, reemplazar el retorno del cuerpo:

**La compresión va ASÍNCRONA.** `gzipSync` bloquea el event loop de Node durante toda la
compresión, en el camino de cada petición: con varias en paralelo se serializan y la optimización se
convierte en un cuello de botella. `zlib.gzip` promisificado hace el trabajo en el threadpool de
libuv y no detiene el bucle.

```ts
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

const comprimir = promisify(gzip)

/** Por debajo de esto, el encabezado y el gasto de comprimir se comen la ganancia. */
const MINIMO_PARA_COMPRIMIR = 1024

    const body = await res.text()
    const tipo = res.headers.get('content-type') ?? 'application/json'

    // Se comprime ACA y no en FastAPI, y la diferencia no es de gusto: el
    // `fetch` de Node descomprime de forma transparente, asi que lo que
    // comprimiera el backend se perdia en este mismo archivo y el navegador
    // recibia el JSON crudo. Medido en dev sobre la ficha de una empresa:
    // encodedBodySize 57.183 == decodedBodySize 57.183, 0% de ahorro.
    //
    // Next comprime su propio HTML pero NO las respuestas de los Route
    // Handlers, asi que toda la API viajaba sin comprimir hasta el navegador.
    const aceptaGzip = (req.headers.get('accept-encoding') ?? '').includes('gzip')
    if (aceptaGzip && body.length >= MINIMO_PARA_COMPRIMIR) {
      const comprimido = await comprimir(Buffer.from(body), { level: 6 })
      return new NextResponse(comprimido, {
        status: res.status,
        headers: {
          'Content-Type': tipo,
          'Content-Encoding': 'gzip',
          'Vary': 'Accept-Encoding',
        },
      })
    }

    return new NextResponse(body, { status: res.status, headers: { 'Content-Type': tipo } })
```

`level: 6` y no el 9: sobre JSON con claves repetidas la diferencia es marginal y el 9 cuesta
bastante más CPU.

- [ ] **Step 4: Quitar la compresión del backend, que ahora sería trabajo doble**

Con el proxy comprimiendo, dejar `GZipMiddleware` en FastAPI haría **comprimir, descomprimir y
volver a comprimir** el mismo cuerpo en cada petición. Se quita de `app/main.py` —el import y el
`add_middleware`, con su bloque de comentario— y se borra `tests/test_compresion.py`, porque su
sujeto deja de existir.

> **Esto revierte parte de `9e9ca546`, a propósito.** Ese commit puso la compresión en FastAPI
> creyendo que llegaba al navegador; la medición mostró que no. El único cliente de esta API es el
> proxy de Next: si algún día aparece otro, la compresión del backend vuelve y entonces sí conviene,
> pero mientras haya un solo consumidor que descomprime, es trabajo tirado.
>
> Deja escrito en el mensaje del commit **por qué se quita**, no sólo que se quitó. Sin eso, dentro
> de seis meses alguien lo vuelve a agregar con el mismo razonamiento que yo.

- [ ] **Step 5: Correr las suites**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
cd ../backend/api && venv/bin/python -m pytest tests/ -q -m "not integracion"
```

Backend baja de 749 a **745** al borrar los 4 tests de compresión: es lo esperado, no una regresión.

- [ ] **Step 6: Mutar**

Dos, después de las aserciones y nombrando el muerto:

1. Bajar `MINIMO_PARA_COMPRIMIR` a `0`. Debe morir "una respuesta chica viaja sin comprimir".
2. Cambiar `await comprimir(...)` por `gzipSync(...)`. Debe morir "comprime sin bloquear el event
   loop". **Si no muere, el test no está midiendo lo que dice** — el cuerpo de prueba puede ser
   demasiado chico para que el bloqueo se note. Dilo y propon uno que sí lo mida.

Restaurar a mano las dos veces.

- [ ] **Step 7: Commit**

```bash
git add "monitor-app/frontend/app/api/v1/[...path]/route.ts" \
        "monitor-app/frontend/app/api/v1/[...path]/route.test.ts" \
        monitor-app/backend/api/app/main.py monitor-app/backend/api/tests/test_compresion.py
git commit -m "perf: comprimir en el proxy, que es donde el usuario lo paga"
```

- [ ] **Step 8: Medir en dev, que es lo único que prueba que sirvió**

Después de desplegar, con Playwright sobre la ficha de una empresa:

```js
const r = await fetch('/api/v1/compliance-records/pending?carrier_id=<id>&estado=todos&limit=500&_m=' + Date.now())
await r.text()
const e = performance.getEntriesByType('resource').find(x => x.name.includes('_m='))
// encodedBodySize tiene que ser MUCHO menor que decodedBodySize
```

Hoy los dos dan 57.183. **Si después del cambio siguen iguales, el cambio no sirvió** — y hay que
decirlo, no explicarlo.

---

## Task 2: La ficha pide un resumen, no 457 filas

**Files:**
- Modify: `monitor-app/backend/api/app/routers/compliance.py`
- Modify: `monitor-app/backend/api/tests/test_compliance.py`
- Modify: `monitor-app/frontend/lib/api/compliance.ts`, `lib/types.ts`
- Modify: `monitor-app/frontend/lib/queries/certificacion.ts` — la clave del resumen
- Modify: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx` y su test

**Interfaces:**
- Produces: `GET /api/v1/compliance-records/summary?carrier_id=<uuid>` →
  ```json
  {
    "totales": { "todos": 93, "al_dia": 2, "por_vencer": 0, "falta": 91 },
    "sujetos": [
      { "entity_type": "CARRIER", "entity_id": "…", "subject_name": null,
        "todos": 13, "al_dia": 2, "por_vencer": 0, "falta": 11 }
    ]
  }
  ```
  Y `complianceApi.listPending` acepta `entityId?: string` para pedir **un solo sujeto**.
- Produces: `clavesCertificacion.resumen(carrierId)` — **hay que agregarla**, hoy no existe. Va en
  `lib/queries/certificacion.ts` junto a las demás, y su raíz tiene que quedar cubierta por
  `RAICES_DE_CERTIFICACION` para que las escrituras la invaliden: una clave que nadie invalida deja
  una pantalla desactualizada sin romper nada, y en este repo eso ya pasó **dos veces**.

**Por qué esto y no subir el `limit`.** Desde que las tarjetas van plegadas, al llegar a la ficha se
ven **nueve cabeceras** — y para dibujarlas se descargan **457 filas de detalle**. La pantalla ya no
muestra el detalle hasta que alguien despliega un sujeto; la consulta todavía no se enteró.

- [ ] **Step 1: Escribir el test del endpoint, contra Postgres real**

```python
# tests/test_compliance.py
@pytest.mark.integracion
async def test_el_resumen_cuadra_con_las_filas_que_devuelve_pending(conexion_revertida):
    """El resumen tiene que contar EXACTAMENTE lo mismo que la lista, o la
    pantalla dice un numero y muestra otro — que es el defecto que esta ficha
    ya tuvo cuando el filtro y la fila se contradecian.
    """
    carrier_id = await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.driver_assignments WHERE status='ACTIVE' LIMIT 1"
    )
    resumen = await _pedir_resumen(conexion_revertida, carrier_id)
    filas = await _pedir_pending(conexion_revertida, carrier_id, estado="todos", limit=1000)

    assert resumen["totales"]["todos"] == len(filas)
    assert sum(s["todos"] for s in resumen["sujetos"]) == len(filas)
    # Y la particion cierra: al dia + por vencer + falta == todos
    t = resumen["totales"]
    assert t["al_dia"] + t["por_vencer"] + t["falta"] == t["todos"]
```

Arma `_pedir_resumen` y `_pedir_pending` con el patrón de `PoolDeUnaConexion` que ese archivo ya usa
para los tests marcados `integracion` — **no inventes uno nuevo**.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_compliance.py -q -k resumen
```

Esperado: 404, el endpoint no existe.

- [ ] **Step 3: El endpoint**

Reusa `_PENDING_ROWS_SQL` como CTE y agrupa encima. **No escribas una segunda definición de
"pendiente" ni de "al día"**: `pendiente_predicate` y `urgencia` ya existen, y tener dos definiciones
de lo mismo es el defecto que este módulo ya tuvo cuando el embudo y el cajón se contradecían.

El agrupado sale de `urgencia`, que ya tiene sus cuatro ramas.

- [ ] **Step 4: `listPending` acepta un sujeto**

En `lib/api/compliance.ts`, `ListPendingParams` gana `entityId?: string`, que viaja como
`entity_id` **sólo si viene** — mismo criterio que `estado` y que `scope`.

**Verificado antes de escribir esto**: el endpoint ya acepta `entity_id`
(`compliance.py:536`, con su descripción: *"Acota a un sujeto concreto"*) y `clavesCertificacion.pendientes`
ya recibe `(carrierId, entityId, estado)`. O sea que del lado del backend y de la caché **no hay nada
que construir**: sólo falta que el cliente HTTP lo mande.

- [ ] **Step 5: La ficha pide resumen al llegar, detalle al desplegar**

```tsx
// Al llegar: sólo el resumen. Son ~9 sujetos con sus conteos, contra las 457
// filas de detalle que se descargaban para dibujar nueve cabeceras.
const resumenQuery = useQuery({
  queryKey: clavesCertificacion.resumen(carrierId),
  queryFn: () => complianceApi.summary(carrierId),
})

// Al desplegar un sujeto: sólo sus filas, y sólo del estado elegido.
function useFilasDelSujeto(s: Sujeto, estado: EstadoDocumental, abierto: boolean) {
  return useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId, s.entityId, estado),
    queryFn: () => complianceApi.listPending({ carrierId, entityId: s.entityId, estado, limit: 200 }),
    enabled: abierto,
  })
}
```

Las cifras de arriba y las cabeceras salen del **resumen**, no de contar filas. Con eso desaparece
también la guarda `completa`, que existía porque contar sobre una lista truncada mentía: ya no se
cuenta en el cliente. **Quítala junto con su test, y dilo en el commit** — no la dejes muerta.

- [ ] **Step 6: Correr todo**

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
cd ../backend/api && venv/bin/python -m pytest tests/ -q -m "not integracion"
venv/bin/python -m pytest tests/ -q -m integracion
```

- [ ] **Step 7: Mutar**

Dos, decididas después de las aserciones:

1. Que el resumen cuente sobre `estado='falta'` en vez de todos. Debe morir el test de que cuadra
   con `pending`.
2. Que la ficha vuelva a pedir `limit: 500` al llegar. Debe morir el test de que pide el resumen.

- [ ] **Step 8: Commit y medir en dev**

Mismo método del Step 8 de la Task 1: `decodedBodySize` de la primera carga de la ficha. Hoy son
**57.183 bytes**. El objetivo es que la carga inicial baje a unos pocos KB. **Si no baja, dilo.**

---

## Fuera de alcance

- **El disparador de PostgREST** (`pgrst_ddl_watch` notificando por DDL en `bronze`, ~25,5 h de CPU
  en 125 días). Es CPU de la base, no tráfico contra la API. Está en el issue
  [#7](https://github.com/fsotosa-ops/webcarga/issues/7), punto 1, con el análisis completo.
- **Apuntar la API al pooler de transacciones.** Se evaluó con los números en la mano y **no
  conviene hoy**: la API sostiene 3-5 conexiones ociosas, no 25, y el modo transacción obliga a
  apagar el caché de sentencias preparadas, que cuesta 25-30 ms por consulta —medido, y documentado
  en `db.py`—. Cambiaría un techo que no estamos tocando por una latencia que sí se paga.
- **Cachear lecturas autenticadas.** `CacheMiddleware` sólo cubre dos rutas públicas y **no puede**
  cubrir las autenticadas: corre antes de `Depends(get_current_user)`, así que cachear ahí saltearía
  la autenticación. Hacerlo bien es por usuario, con invalidación y `ETag`, y conviene medirlo
  después de estas dos tareas — puede que ya no haga falta.
- **Los otros límites grandes** (`listStatus` 200, catálogo 300, el cajón 200). Se miran después de
  medir estas dos: la ficha es la más pesada y la que enseña si el enfoque sirve.
