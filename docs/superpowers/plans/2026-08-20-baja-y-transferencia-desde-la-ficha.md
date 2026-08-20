# Dar de baja y transferir desde la ficha · Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`).

**Goal:** Que se pueda dar de baja de la empresa y transferir a otra un conductor o un vehículo
**desde la ficha de Certificación**, que es donde hoy se mira una empresa — sin salir al módulo
Empresas viejo, y sin que una asignación protegida reviente con un error crudo de Postgres.

**Architecture:** No se construye backend nuevo: `POST /carriers/{id}/drivers` ya desactiva sola la
asignación previa (eso ES la transferencia) y `DELETE /carriers/{id}/drivers/{driverId}` ya es la
baja. Lo que se agrega es la puerta: un menú de acciones en la cabecera del sujeto, la confirmación
de la baja, y el `TransferModal` que ya existe. Del backend sólo se corrige un defecto vivo: la
colisión con `is_manual_override`, que hoy sale como `23505`.

**Tech Stack:** FastAPI + asyncpg sobre Postgres (Supabase); Next.js 15 App Router + React Query +
Tailwind v4.

**HU:** `monitor-app/docs/user-stories/20260820/01-hu-baja-y-transferencia-de-flota.md`
(la HU está fuera de git a propósito: `monitor-app/docs/` está en `.gitignore`, como todas sus
hermanas — léela del disco).

**Alcance decidido con el usuario:** sólo los casos **A** (baja de la empresa) y **B**
(transferencia). El caso **C** (baja del sistema, `operational_status`) **NO entra**: exige extraer
la resolución polimórfica —hoy copiada en tres lugares— y poner el invariante en la base, y eso es
su propia ronda. Está en el issue [#7](https://github.com/fsotosa-ops/webcarga/issues/7), punto 4.

**Permisos decididos con el usuario:** manda **`editor`**. Los endpoints ya exigen `require_editor`;
lo desalineado es la ficha legacy, que gatea con `canAdmin`. Se baja el gate, no se sube el endpoint:
Karen es quien mantiene esto al día y exigirle admin la bloquea en su trabajo diario.

## Global Constraints

- **Español neutral, nunca voseo.** "Elige", "Verifica", "puedes" — nunca "Elegí"/"Verificá". Lo
  vigilan `lib/copy/espanol-neutral.test.ts` y `tests/test_espanol_neutral.py`.
- **Cero emojis.** Sólo iconos de `lucide-react`.
- **Los trinquetes visuales están en MARGEN CERO**: color crudo **1.755**, tamaños <11px **268**,
  `<h1>` **9**. Todo color de los tokens de `app/globals.css` (`accent`, `espera`, `accion`,
  `resuelto`, `informativo`, `text-primary`, `border`, `bg-main`); todo tamaño de la escala
  (`text-etiqueta` 11px, `text-dato` 13px, `text-lectura` 15px, `text-titulo` 20px, `text-cifra` 28px).
- **Nada se borra: la baja es un estado.** Ningún camino de este plan toca `compliance_records`.
- **La fila no desaparece antes de que el servidor confirme.** Si se va antes y el servidor falla,
  reaparece y parece un fantasma.
- **Los cuatro estados de pantalla**: el vacío, el a medias, el sin permiso (`useCanEdit()`) y el
  que falló — y el que falló se dice **en esa tarjeta**, con reintento, nunca en un toast que se va.
- **El SQL nuevo se verifica contra Postgres real**, no contra `AsyncMock`.
- **Cada test se muta antes de darlo por bueno, y la mutación se decide DESPUÉS de escribir la
  aserción, nombrando cuál test muere.** En la rama anterior, cinco mutaciones escritas de antemano
  no mataron nada y las cinco veces el defecto era del plan. Si una no mata, **dilo y propón la que
  sí** — nunca inventes un test alrededor de un invariante falso.
- **Para restaurar una mutación NUNCA uses `git checkout --`**: en la rama anterior eso borró
  ediciones sin comitear. Respalda el archivo a mano.
- **Corre las suites SEPARADAS, en primer plano, y no las mates a mitad.** `max_connections` de esta
  base es **60**: `venv/bin/python -m pytest tests/ -q -m "not integracion"` (~30 s) y después
  `-m integracion` (~8 min). No las lances en segundo plano para esperar notificaciones: tres
  ejecutores se colgaron así.
- **Backend venv**: `monitor-app/backend/api/venv` (no `.venv`, no anaconda).
- **PII**: hay RUTs y nombres de personas reales en esta base. Nunca en tests, comentarios ni commits.
- **Nada de código muerto.**
- **No hay migración.** Ninguna tarea de este plan agrega columnas.

---

## Lo que YA existe y NO se reescribe

Verificado en el árbol antes de escribir esto. Si te descubres escribiendo cualquiera de estas
cosas, para y usa la que está:

| Ya existe | Dónde | Qué hace |
|---|---|---|
| `TransferModal` | `components/dashboard/TransferModal.tsx` | El modal de transferencia completo, con `excludeId` que resuelve el caso B2 |
| `carriersApi.unassignDriver / unassignAsset` | `lib/api/carriers.ts:141,153` | La baja de la empresa |
| `carriersApi.assignDriver / assignAsset` | `lib/api/carriers.ts:136,147` | La transferencia: asignar al destino desactiva sola la previa |
| `CarrierSearchPicker` | `components/dashboard/CarrierSearchPicker.tsx` | El buscador de empresas, con `excludeId` |
| `invalidarCertificacion(qc)` | `lib/queries/certificacion.ts:78` | Invalida TODAS las raíces de Certificación. No inventes claves |
| `useCanEdit()` | `hooks/useCanEdit.ts` | El gate de escritura |
| `AvisoDeFila` | `components/compliance/AvisoDeFila.tsx` | El aviso con reintento dentro de un renglón |

**La variante es una prop, no un componente hermano.** Este repo ya pagó caro tener dos versiones
del mismo renglón y dos del mismo cajón.

---

## Estructura de archivos

**Frontend** (`monitor-app/frontend`)
- Crear: `components/compliance/AccionesDeSujeto.tsx` — el menú `⋮` de la cabecera y su teclado.
- Crear: `components/compliance/ConfirmarBaja.tsx` — la confirmación, que dice qué NO se pierde.
- Modificar: `app/dashboard/compliance/[carrierId]/page.tsx` — cablea las dos y `TransferModal`.
- Modificar: `app/dashboard/carriers/[id]/page.tsx` — el gate `canAdmin` → `canEdit`.

**Backend** (`monitor-app/backend/api`)
- Modificar: `app/routers/carriers.py` — `assign_driver` y `assign_asset` devuelven 409 cuando la
  asignación previa está protegida.

---

## Task 1: La asignación protegida deja de reventar

**El único cambio de backend, y es un defecto vivo.** Al transferir, el
`UPDATE ... SET status='INACTIVE' ... AND NOT is_manual_override` **salta** la asignación protegida,
pero el `INSERT` de la nueva sigue adelante. Quedan dos filas `ACTIVE` y el índice único parcial
`idx_driver_assignments_one_active` las rechaza con un **23505 crudo**. Documentado como riesgo 4 de
la épica de Certificación y todavía vivo.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/carriers.py` (`assign_driver` ~543-578,
  `assign_asset` ~623-655)
- Test: `monitor-app/backend/api/tests/test_carriers.py`

**Interfaces:**
- Produces: `POST /carriers/{id}/drivers` y `.../assets` responden **409** con
  `detail = "Ese conductor tiene una asignación protegida en otra empresa. Quítale la protección antes de transferirlo."`
  (y su equivalente con "vehículo") cuando existe una asignación `ACTIVE` en otra empresa con
  `is_manual_override = true`.

- [ ] **Step 1: Escribir los tests que fallan**

```python
# tests/test_carriers.py — usa el patrón que este archivo YA tiene:
# `AsyncMock()` local, `wire_transactional_conn(pool, conn)` y `make_client(pool)`.
# El endpoint pregunta por `conn`, no por `pool`: está dentro de
# `async with pool.acquire() as conn`.
def test_transferir_una_asignacion_protegida_da_409_y_no_un_error_de_base():
    """Sin esto sale un 23505 crudo de Postgres: el UPDATE salta la fila
    protegida y el INSERT sigue, asi que quedan dos ACTIVE y el indice unico
    parcial las rechaza. Quien transfiere ve un error de base de datos en vez
    de enterarse de que la asignacion estaba protegida a proposito.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # `fetchval` responde en el orden en que el endpoint pregunta:
    # existe la empresa -> existe el conductor -> hay asignacion protegida
    conn.fetchval.side_effect = [1, 1, "otra-empresa-id"]
    client = make_client(pool)

    res = client.post("/api/v1/carriers/c1/drivers", json={"driver_id": "d1", "carrier_id": "c1"})

    assert res.status_code == 409
    assert "protegida" in res.json()["detail"]
    # Y NO escribio nada: el INSERT no llego a correr.
    assert not any("INSERT" in str(c) for c in conn.execute.call_args_list)


def test_transferir_sin_proteccion_sigue_funcionando():
    """La guarda nueva no puede romper el camino normal, que es el 99%."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, 1, None]
    client = make_client(pool)

    res = client.post("/api/v1/carriers/c1/drivers", json={"driver_id": "d1", "carrier_id": "c1"})

    assert res.status_code == 200
```

Los imports ya están al tope de ese archivo:
`from tests.conftest import USER, wire_transactional_conn` y `make_client` definido en la línea 12.
**No inventes fixtures**: este archivo no usa `client` ni `pool_mock` como fixtures de pytest, y no
usa `@pytest.mark.asyncio` para estos casos — mira `test_create_carrier_rejects_duplicate_tax_id`
(línea 228), que es exactamente la forma que necesitas.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/test_carriers.py -q -k protegida
```

Esperado: FALLAN — hoy responde 200 o revienta.

- [ ] **Step 3: La guarda, antes del UPDATE**

En `assign_driver`, dentro de la transacción y **antes** del `UPDATE ... SET status='INACTIVE'`:

```python
            # La asignacion previa protegida no se desactiva —y esta bien, es
            # una decision humana que la ingesta tampoco pisa— pero el INSERT
            # de abajo sigue igual, y entonces quedan dos filas ACTIVE que el
            # indice unico parcial `idx_driver_assignments_one_active` rechaza
            # con un 23505 crudo. Preguntarlo antes convierte un error de base
            # en una frase que dice que hacer.
            protegida = await conn.fetchval(
                """
                SELECT carrier_id::text FROM public.driver_assignments
                WHERE driver_id = $1 AND carrier_id <> $2
                  AND status = 'ACTIVE' AND is_manual_override
                LIMIT 1
                """,
                body.driver_id, carrier_id,
            )
            if protegida:
                raise HTTPException(
                    409,
                    "Ese conductor tiene una asignación protegida en otra empresa. "
                    "Quítale la protección antes de transferirlo.",
                )
```

Y lo mismo en `assign_asset`, con `asset_assignments`, `asset_id` y la palabra "vehículo".

- [ ] **Step 4: Correr las dos suites, separadas**

```bash
venv/bin/python -m pytest tests/ -q -m "not integracion"
venv/bin/python -m pytest tests/ -q -m integracion
```

Punto de partida: **742** rápidos y **138** de integración.

- [ ] **Step 5: Verificar contra Postgres real**

Con el patrón de los tests marcados `integracion` de este repo: crear una asignación protegida en
una transacción revertida, llamar al endpoint real y comprobar el 409. **No con `AsyncMock`** — un
mock no ejecuta el índice único, que es justo lo que hace fallar hoy.

- [ ] **Step 6: Mutar**

Escribe la mutación **después** de las aserciones y nombra cuál test muere. La evidente es quitar la
guarda entera. Confirma que muere `test_transferir_una_asignacion_protegida_da_409...` y **ningún
otro** — si mueren más, el test está midiendo de más. Restaura desde un respaldo hecho a mano.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/routers/carriers.py monitor-app/backend/api/tests/test_carriers.py
git commit -m "fix(flota): transferir una asignacion protegida da 409, no un 23505 crudo"
```

---

## Task 2: Los permisos dejan de estar desalineados

Hoy la ficha legacy gatea transferir y dar de baja con `canAdmin` mientras los endpoints exigen
`require_editor`: **un editor ya puede hacerlo por API**, así que el gate de pantalla no protege
nada — sólo estorba a quien tiene permiso. Decisión del usuario: manda `editor`.

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx:507` (y cualquier otro
  `canAdmin` que gatee transferir o dar de baja — **búscalos con
  `grep -n "canAdmin" app/dashboard/carriers/\[id\]/page.tsx`**)
- Test: `monitor-app/frontend/app/dashboard/carriers/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `useCanEdit()` de `hooks/useCanEdit.ts`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('un editor puede transferir: el gate de pantalla decia admin y el endpoint aceptaba editor', async () => {
  // El desalineado no protegia nada —un editor podia hacerlo por API igual— y
  // le escondia el boton a quien mantiene esto al dia todos los dias.
  vi.mocked(useCanEdit).mockReturnValue(true)
  vi.mocked(useCanAdmin).mockReturnValue(false)
  montar()

  expect(await screen.findByRole('button', { name: /transferir/i })).toBeInTheDocument()
})
```

Usa el `montar()` y los mocks de permisos que ese archivo ya tiene.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend
npx vitest run "app/dashboard/carriers/[id]/page.test.tsx" -t "editor puede transferir"
```

- [ ] **Step 3: Bajar el gate**

Reemplaza `canAdmin` por `canEdit` **sólo** en los gates de transferir y dar de baja. Si tras el
cambio `useCanAdmin` queda sin consumidores en ese archivo, quita el import — nada de código muerto.
**Si `canAdmin` gatea alguna otra cosa en ese archivo, no la toques**: esta tarea es sobre estas dos
acciones.

- [ ] **Step 4: Correr**

```bash
npx vitest run "app/dashboard/carriers/[id]/page.test.tsx"
```

- [ ] **Step 5: Mutar**

Devuelve `canAdmin` al gate. Debe morir el test del Step 1 y ningún otro. Restaura a mano.

- [ ] **Step 6: Commit**

```bash
git add "monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx" \
        "monitor-app/frontend/app/dashboard/carriers/[id]/page.test.tsx"
git commit -m "fix(flota): transferir y dar de baja se gatean con editor, igual que su endpoint"
```

---

## Task 3: El menú de acciones en la cabecera del sujeto

**Files:**
- Create: `monitor-app/frontend/components/compliance/AccionesDeSujeto.tsx`
- Test: `monitor-app/frontend/components/compliance/AccionesDeSujeto.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export function AccionesDeSujeto(props: {
    nombreEmpresa: string
    onTransferir:  () => void
    onDarDeBaja:   () => void
    deshabilitado?: boolean
  }): JSX.Element
  ```

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AccionesDeSujeto } from './AccionesDeSujeto'

describe('AccionesDeSujeto', () => {
  const props = { nombreEmpresa: 'Transportes Demo', onTransferir: vi.fn(), onDarDeBaja: vi.fn() }

  it('la baja dice de QUÉ empresa, para que el alcance se lea sin pensar', () => {
    render(<AccionesDeSujeto {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    expect(screen.getByRole('menuitem', { name: 'Dar de baja de Transportes Demo' })).toBeInTheDocument()
  })

  it('arranca cerrado: el menú no ocupa la cabecera hasta que se pide', () => {
    render(<AccionesDeSujeto {...props} />)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('Escape cierra sin elegir nada', () => {
    const onDarDeBaja = vi.fn()
    render(<AccionesDeSujeto {...props} onDarDeBaja={onDarDeBaja} />)
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(onDarDeBaja).not.toHaveBeenCalled()
  })

  it('mientras una acción está en vuelo no se puede disparar otra', () => {
    const onTransferir = vi.fn()
    render(<AccionesDeSujeto {...props} onTransferir={onTransferir} deshabilitado />)
    expect(screen.getByRole('button', { name: /acciones/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run components/compliance/AccionesDeSujeto.test.tsx
```

- [ ] **Step 3: Escribir el componente**

Requisitos no negociables:

- El disparador es un `<button>` con `aria-label="Acciones"`, `aria-haspopup="menu"` y
  `aria-expanded`. Icono `MoreVertical` de `lucide-react`, `aria-hidden`.
- El menú es `role="menu"` y cada opción `role="menuitem"`, alcanzables por teclado.
- **`Escape` cierra**, y un clic afuera también. El listener de `window` se limpia al desmontar.
- **Sólo tokens y escala**: `text-dato`/`text-etiqueta`, `border-border`, `bg-white`,
  `text-text-primary`, `text-informativo`. Nada de `text-gray-*` ni tamaños fuera de escala.
- Dos opciones y nada más: "Transferir a otra empresa" y "Dar de baja de {nombreEmpresa}".
  **La baja del sistema NO va**: está fuera del alcance de este plan.

- [ ] **Step 4: Correr y verificar trinquetes**

```bash
npx vitest run components/compliance/AccionesDeSujeto.test.tsx lib/ui/ lib/copy/
npx tsc --noEmit
```

Los trinquetes tienen que seguir exactos en 1.755 / 268 / 9.

- [ ] **Step 5: Mutar**

Después de las aserciones, y nombrando el muerto: quita el nombre de la empresa de la etiqueta
(dejar sólo "Dar de baja"). Debe morir "la baja dice de QUÉ empresa". Restaura a mano.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance/AccionesDeSujeto.tsx \
        monitor-app/frontend/components/compliance/AccionesDeSujeto.test.tsx
git commit -m "feat(certificacion): el menu de acciones de un sujeto"
```

---

## Task 4: La confirmación de la baja

**Files:**
- Create: `monitor-app/frontend/components/compliance/ConfirmarBaja.tsx`
- Test: `monitor-app/frontend/components/compliance/ConfirmarBaja.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export function ConfirmarBaja(props: {
    abierto:        boolean
    nombreSujeto:   string
    nombreEmpresa:  string
    cuantosDocumentos: number
    onCancelar:     () => void
    onConfirmar:    () => Promise<void>
  }): JSX.Element | null
  ```

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ConfirmarBaja } from './ConfirmarBaja'

const base = {
  abierto: true, nombreSujeto: 'Juan Pérez', nombreEmpresa: 'Transportes Demo',
  cuantosDocumentos: 3, onCancelar: vi.fn(), onConfirmar: vi.fn().mockResolvedValue(undefined),
}

describe('ConfirmarBaja', () => {
  it('dice qué NO se pierde, que es la duda de quien confirma', () => {
    render(<ConfirmarBaja {...base} />)
    expect(screen.getByText(/3 documentos/)).toBeInTheDocument()
    expect(screen.getByText(/se conservan/i)).toBeInTheDocument()
  })

  it('sin documentos cargados no habla de documentos', () => {
    // Prometer que "se conservan 0 documentos" es ruido que hace dudar.
    render(<ConfirmarBaja {...base} cuantosDocumentos={0} />)
    expect(screen.queryByText(/documentos/i)).not.toBeInTheDocument()
  })

  it('si el servidor falla, lo dice y deja reintentar', async () => {
    const onConfirmar = vi.fn().mockRejectedValue(new Error('sesión vencida'))
    render(<ConfirmarBaja {...base} onConfirmar={onConfirmar} />)

    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/sesión vencida/i)
    // Y el diálogo sigue abierto: cerrarlo haria creer que la baja ocurrio.
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeEnabled()
  })

  it('mientras viaja no se puede confirmar dos veces', async () => {
    let resolver: () => void = () => {}
    const onConfirmar = vi.fn(() => new Promise<void>(r => { resolver = r }))
    render(<ConfirmarBaja {...base} onConfirmar={onConfirmar} />)

    fireEvent.click(screen.getByRole('button', { name: /dar de baja/i }))
    expect(screen.getByRole('button', { name: /dar de baja/i })).toBeDisabled()

    resolver()
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1))
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run components/compliance/ConfirmarBaja.test.tsx
```

- [ ] **Step 3: Escribir el componente**

El texto, exacto:

> **Dar de baja a {nombreSujeto} de {nombreEmpresa}**
>
> Deja de figurar en esta empresa. Sus documentos se conservan: si vuelve, no hay que pedirlos de
> nuevo.

Con `cuantosDocumentos > 0`, la segunda frase dice **"Sus {n} documentos cargados se conservan"**.
Con `0`, **no menciona documentos**.

Requisitos:

- `role="dialog"` con `aria-modal="true"` y el foco al abrir en el botón de cancelar —
  **no** en el destructivo.
- `Escape` cancela.
- El error va en un `role="alert"` **dentro del diálogo**, y el diálogo **no se cierra**.
- Sólo tokens: el botón de confirmar en `bg-espera` con texto blanco; cancelar con `border-border`.
- **Sin motivo de baja.** La HU lo propone, pero exige una columna nueva y el precedente del
  proyecto para un vocabulario así es una tabla de catálogo sembrada
  (`20260818130000_trip_unassigned_reasons.sql`). Decidir ese vocabulario es del negocio, y este
  plan no agrega migraciones. La baja ya deja rastro en `audit_log` vía `record_manual_edit`.

- [ ] **Step 4: Correr y verificar trinquetes**

```bash
npx vitest run components/compliance/ConfirmarBaja.test.tsx lib/ui/ lib/copy/
npx tsc --noEmit
```

- [ ] **Step 5: Mutar**

Haz que el diálogo se cierre al fallar. Debe morir "si el servidor falla, lo dice y deja reintentar".
Restaura a mano.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance/ConfirmarBaja.tsx \
        monitor-app/frontend/components/compliance/ConfirmarBaja.test.tsx
git commit -m "feat(certificacion): la confirmacion de baja dice que NO se pierde"
```

---

## Task 5: Cablear las tres piezas en la ficha

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx`
- Test: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.test.tsx`

**Interfaces:**
- Consumes: `AccionesDeSujeto` (Task 3), `ConfirmarBaja` (Task 4), `TransferModal`
  (`components/dashboard/TransferModal.tsx`, ya existe), `carriersApi.unassignDriver` /
  `unassignAsset` / `assignDriver` / `assignAsset` (`lib/api/carriers.ts`),
  `invalidarCertificacion` (`lib/queries/certificacion.ts:78`).

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
it('dar de baja a un conductor lo saca de la ficha, sin tocar sus documentos', async () => {
  vi.mocked(carriersApi.unassignDriver).mockResolvedValue({ ok: true })
  montar([
    fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' }),
  ])

  fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
  fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

  await waitFor(() => expect(carriersApi.unassignDriver).toHaveBeenCalledWith('c1', 'd1'))
  // Nada se borra: la baja es un estado de la asignacion.
  expect(complianceApi.uploadFile).not.toHaveBeenCalled()
})

it('un vehículo se da de baja por su propio endpoint, no por el de conductores', async () => {
  // El sujeto sabe lo que es; sin esto, una sola rama trataria a los dos igual
  // y el vehiculo se iria contra /drivers/{id}.
  vi.mocked(carriersApi.unassignAsset).mockResolvedValue({ ok: true })
  montar([fila({ id: 'p1', entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55' })])

  fireEvent.click(await screen.findByRole('button', { name: /Vehículos/ }))
  fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

  await waitFor(() => expect(carriersApi.unassignAsset).toHaveBeenCalledWith('c1', 'a1'))
  expect(carriersApi.unassignDriver).not.toHaveBeenCalled()
})

it('transferir usa el modal que ya existe y excluye a la empresa actual', async () => {
  montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

  fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
  fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Transferir/ }))

  expect(screen.getByPlaceholderText(/empresa destino/i)).toBeInTheDocument()
})

it('un viewer no ve el menú', async () => {
  vi.mocked(useCanEdit).mockReturnValue(false)
  montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

  fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
  expect(screen.queryByRole('button', { name: /acciones/i })).not.toBeInTheDocument()
})

it('dar de baja al último conductor deja la ficha usable, sin el grupo vacío', async () => {
  // A3. El agrupado ya descarta los grupos sin sujetos, pero nada lo afirmaba:
  // el dia que alguien "simplifique" ese filter, la ficha muestra un grupo
  // "Conductores · 0 conductores" y parece rota.
  vi.mocked(carriersApi.unassignDriver).mockResolvedValue({ ok: true })
  montar([fila({ id: 'p1', entity_type: 'CARRIER' })])   // ya sin conductores

  expect(await screen.findByRole('button', { name: /De la empresa/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Conductores/ })).not.toBeInTheDocument()
})

it('dar de baja dos veces lo dice, en vez de romperse', async () => {
  // A6: doble clic, o la misma ficha abierta en dos pestañas. El backend
  // responde 404 "Asignación activa no encontrada" y eso hay que mostrarlo.
  vi.mocked(carriersApi.unassignDriver).mockRejectedValue(
    new Error('Asignación activa no encontrada'),
  )
  montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

  fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
  fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/no encontrada/i)
})

it('si la baja falla, el sujeto sigue ahí', async () => {
  // Sacarlo antes de la confirmacion del servidor y devolverlo al fallar lo
  // convierte en un fantasma: parpadea y vuelve.
  vi.mocked(carriersApi.unassignDriver).mockRejectedValue(new Error('sesión vencida'))
  montar([fila({ id: 'p1', entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Pérez' })])

  fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
  fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Dar de baja/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Dar de baja$/ }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/sesión vencida/i)
  expect(screen.getByRole('button', { name: /Juan Pérez/ })).toBeInTheDocument()
})
```

**Antes de correr nada, amplía el mock del módulo.** Hoy `page.test.tsx:15-17` es
`vi.mock('@/lib/api/carriers', () => ({ carriersApi: { get: vi.fn() } }))`, así que
`carriersApi.unassignDriver` sería `undefined` y el test fallaría por una razón que no es la que
quieres medir. Súmale `unassignDriver`, `unassignAsset`, `assignDriver` y `assignAsset`.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run "app/dashboard/compliance/[carrierId]/page.test.tsx"
```

- [ ] **Step 3: Cablear**

1. `AccionesDeSujeto` va en `CabeceraDeSujeto`, **al final de la fila y fuera del `<button>` que
   pliega** — un botón dentro de otro botón es HTML inválido y el clic se lo lleva el de afuera.
   Por eso la cabecera pasa a ser un contenedor con el botón de plegar y el menú como hermanos.
2. Se muestra sólo con `canEdit`, y **sólo para `DRIVER` y `ASSET`**: la empresa no se da de baja de
   sí misma.
3. `onDarDeBaja` abre `ConfirmarBaja` con `cuantosDocumentos = s.filas.filter(f => f.tiene_archivo).length`.
4. Al confirmar, según `s.entityType`: `unassignDriver(carrierId, s.entityId)` o
   `unassignAsset(carrierId, s.entityId)`. Después, `await invalidarCertificacion(queryClient)`.
   **No quites la fila a mano**: la lista se redibuja desde la consulta, que es la única fuente.
5. `onTransferir` abre `TransferModal` con `currentCarrierId={carrierId}` y
   `title={'Transferir a ' + s.titulo}`; su `onTransfer` llama a `assignDriver(destino, s.entityId)`
   o `assignAsset(destino, s.entityId)` y después invalida igual.
6. El error de la baja se dice **en esa tarjeta**, con `AvisoDeFila` y reintento.

- [ ] **Step 4: Correr todo y construir**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Punto de partida: **1.204** tests en 126 archivos.

- [ ] **Step 5: Mutar**

Dos, decididas después de las aserciones:

1. Haz que la baja llame siempre a `unassignDriver`. Debe morir "un vehículo se da de baja por su
   propio endpoint".
2. Quita el gate de `canEdit` del menú. Debe morir "un viewer no ve el menú".

Restaura a mano las dos veces.

- [ ] **Step 6: Commit**

```bash
git add "monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx" \
        "monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.test.tsx"
git commit -m "feat(certificacion): dar de baja y transferir sin salir de la ficha"
```

---

## Task 6: Verificación de punta a punta

**Files:** ninguno — es verificación.

- [ ] **Step 1: Las suites, separadas y en primer plano**

```bash
cd monitor-app/backend/api
venv/bin/python -m pytest tests/ -q -m "not integracion"   # base: 742
venv/bin/python -m pytest tests/ -q -m integracion         # base: 138, ~8 min
cd ../../frontend
npx vitest run && npx tsc --noEmit && npm run build        # base: 1.204 en 126 archivos
```

- [ ] **Step 2: Que nada se haya borrado**

Contra Postgres real, antes y después de una baja de prueba:

```sql
SELECT count(*) FROM public.compliance_records WHERE entity_id = '<el sujeto>' AND is_current = true;
```

El número **no cambia**. Es el criterio de aceptación 3 y el que más importa.

- [ ] **Step 3: Que no quede nadie en dos empresas**

```sql
SELECT driver_id, count(*) FROM public.driver_assignments
WHERE status = 'ACTIVE' GROUP BY 1 HAVING count(*) > 1;
```

Cero filas. Lo mismo con `asset_assignments`.

- [ ] **Step 4: Click-through**

El spec de Playwright vive en `monitor-app/frontend/scripts/ficha-empresa.spec.ts` y necesita
`DEMO_EMAIL`, `DEMO_PASSWORD` y `DEMO_CARRIER` en el entorno. **Corre contra la rama, no contra dev**
—esta rama no está desplegada— levantando el par en local; el spec documenta los dos comandos en su
cabecera.

Elige el sujeto **por SQL y no del desplegable**: los desplegables listan todo el catálogo y ya se
pisó un documento real por elegir a ojo.

- [ ] **Step 5: Actualizar el AGENTLOG**

Qué se hizo, el siguiente paso exacto y las decisiones — incluida la de dejar el motivo de baja
fuera y por qué.

---

## Fuera de alcance

- **El caso C, la baja del sistema** (`operational_status`). Exige extraer la resolución polimórfica
  —hoy copiada en tres lugares— y un invariante en la base. Issue [#7](https://github.com/fsotosa-ops/webcarga/issues/7), punto 4.
- **El motivo de la baja.** Necesita columna nueva; el precedente del proyecto es una tabla de
  catálogo sembrada, y ese vocabulario lo define el negocio.
- **Distinguir requisitos "de la persona" de los "de la relación"** (el contrato de trabajo viaja con
  la transferencia). Documentado en la HU; es catálogo, no código, y va en su propia HU.
- **Historial de asignaciones en pantalla.** El dato existe en `driver_assignments`; mostrarlo es
  otra HU.
- **Borrar** un conductor o un vehículo. Nada se borra: la baja es un estado.
- **Avisar que la asignación estaba protegida al DAR DE BAJA** (caso A5 de la HU). `unassign_driver`
  no mira `is_manual_override` —da de baja igual— y el listado que alimenta la ficha no expone ese
  campo, así que avisarlo exige cambiar la respuesta de `/pending`. En la **transferencia** sí se
  cierra, porque ahí no avisar significa un error crudo de base (Task 1). En la baja, no avisar sólo
  significa no dar un detalle.
- **Avisar si la empresa destino está inactiva** (caso B4). `CarrierSearchPicker` es compartido con
  otras cuatro pantallas y cambiar a quién lista las afecta a todas. Es una decisión sobre ese
  componente, no sobre esta ficha.
- **Avisar que el conductor habitual de un vehículo no viaja con él** (caso B5).
  `vehicle_driver_assignments` es otra relación y mostrarla aquí exige pedirla; hoy la ficha no la
  consulta.
