# Configuración por dominios — Plan 1: el marco

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usar
> superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans
> para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** reemplazar las siete pestañas planas de Configuración por una estructura de
dominios, sin cambiar el interior de ninguna sección existente.

**Arquitectura:** un registro de dominios en un solo archivo es la fuente de verdad de qué
dominios hay, qué secciones tiene cada uno y qué componente los dibuja. La portada y el
interior de cada dominio se derivan de ese registro, así que agregar un dominio es agregar
una entrada, no tocar pantallas. Las siete pestañas actuales se mudan **sin abrir su
interior**: son componentes que ya existen y se montan desde otro lugar.

**Stack:** Next.js 14 App Router · React Query · Tailwind · FastAPI + asyncpg · Supabase.

**Spec:** `docs/superpowers/specs/2026-08-16-configuracion-por-dominios-design.md`

**Planes hermanos (no son parte de éste):** Plan 2 — el registro de revisión. Plan 3 — el
buscador. Los dos dependen de este marco.

## Restricciones globales

- **Español neutral, NUNCA voseo.** "Elige", "Guarda", "Selecciona" — nunca "Elegí",
  "Guardá", "Seleccioná". Aplica a interfaz, comentarios y mensajes de commit.
- **Cero emojis.** Íconos sólo de `lucide-react`.
- Prohibidas las palabras "hueco" y "slot" en la interfaz.
- Sin paleta nueva: tokens de `app/globals.css`.
- Todo `<Link>` con `prefetch={false}` — un prefetch ejecuta el layout del dashboard, que
  habla con Auth, y eso produjo un 429 en producción (Ronda 110).
- Frontend: `npx vitest run` **desde `monitor-app/frontend`**, no desde la raíz del repo
  (desde la raíz no toma la configuración de jsdom y fallan 11 tests por `document is not
  defined`). Base actual: **879 tests**.
- Backend: `venv/bin/python -m pytest` desde `monitor-app/backend/api`, con `venv/` — **no**
  `.venv` ni anaconda. Base actual: **647 tests**.
- `npx vitest run` sale con código 1 por un `Unhandled Rejection` preexistente y ajeno en
  `CarrierDrawer.test.tsx`. No arreglarlo y no confundirlo con un fallo propio.
- Toda la configuración exige rol admin y así se queda. `app/dashboard/admin/layout.tsx` ya
  redirige a quien no sea `admin`/`owner`.
- TDD con RED verificado: escribir el test, **correrlo y confirmar que falla por el motivo
  correcto**, después implementar. Un RED que falla por un import roto no es un RED válido.

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `app/dashboard/admin/configuracion/dominios.ts` | El registro: qué dominios hay, sus secciones y qué componente dibuja cada una. Fuente de verdad única. |
| `app/dashboard/admin/configuracion/dominios.test.ts` | Que el registro sea coherente (claves únicas, sin secciones huérfanas). |
| `app/dashboard/admin/configuracion/PortadaDominios.tsx` | Las tarjetas de la portada, derivadas del registro. |
| `app/dashboard/admin/configuracion/PortadaDominios.test.tsx` | |
| `app/dashboard/admin/configuracion/[dominio]/page.tsx` | El interior de un dominio: barra lateral con los otros + secciones. |
| `app/dashboard/admin/configuracion/NavDominios.tsx` | La barra lateral de dominios, reusada por el interior. |
| `app/dashboard/admin/configuracion/NavDominios.test.tsx` | |
| `app/dashboard/admin/configuracion/flota-tabs.tsx` | Las dos secciones de Flota, reusando `TaxonomyTab`. |
| `app/dashboard/admin/configuracion/flota-tabs.test.tsx` | |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `app/dashboard/admin/configuracion/page.tsx:1-62` | Deja de ser las 7 pestañas; pasa a ser la portada. |
| `app/dashboard/admin/configuracion/estados-tabs.tsx:139` | `TaxonomyTab` acepta `enUso` para avisar antes de desactivar. |
| `components/dashboard/Sidebar.tsx:206-310` | Usuarios deja de ser entrada propia; Configuración es la única puerta. |
| `backend/api/app/routers/status_taxonomies.py:60-68` | El DELETE avisa si el valor está en uso. |

**No se tocan** (es la constraint central de este plan): `estados-tabs.tsx` salvo la firma
de `TaxonomyTab`, `umbrales-tabs.tsx`, `condiciones-tab.tsx`, `shared.tsx`. Sus interiores
se mudan, no se reescriben.

---

## Task 1: El registro de dominios

**Archivos:**
- Crear: `monitor-app/frontend/app/dashboard/admin/configuracion/dominios.ts`
- Test: `monitor-app/frontend/app/dashboard/admin/configuracion/dominios.test.ts`

**Interfaces:**
- Produce: `DOMINIOS: Dominio[]`, `type Dominio`, `type Seccion`, `dominioPorClave(clave: string): Dominio | undefined`. Las tareas 2, 3 y 4 leen de acá.

- [ ] **Paso 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { DOMINIOS, dominioPorClave } from './dominios'

describe('registro de dominios', () => {
  it('las claves de dominio son unicas', () => {
    const claves = DOMINIOS.map(d => d.clave)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('las claves de seccion son unicas dentro de su dominio', () => {
    for (const d of DOMINIOS) {
      const claves = d.secciones.map(s => s.clave)
      expect(new Set(claves).size, `dominio ${d.clave}`).toBe(claves.length)
    }
  })

  // Un dominio sin secciones no tendria que dibujarse como visitable: seria una
  // tarjeta que lleva a una pantalla vacia.
  it('un dominio visitable tiene al menos una seccion', () => {
    for (const d of DOMINIOS.filter(x => !x.proximamente)) {
      expect(d.secciones.length, `dominio ${d.clave}`).toBeGreaterThan(0)
    }
  })

  it('un dominio marcado como proximamente no tiene secciones', () => {
    for (const d of DOMINIOS.filter(x => x.proximamente)) {
      expect(d.secciones.length, `dominio ${d.clave}`).toBe(0)
    }
  })

  it('busca un dominio por su clave', () => {
    expect(dominioPorClave('certificacion')?.titulo).toBe('Certificación')
    expect(dominioPorClave('no-existe')).toBeUndefined()
  })
})
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

Ejecutar desde `monitor-app/frontend`:
`npx vitest run app/dashboard/admin/configuracion/dominios.test.ts`
Esperado: FALLA con "Failed to resolve import './dominios'".

- [ ] **Paso 3: Escribir el registro**

```ts
import type { ComponentType } from 'react'
import {
  EstadosTmsTab, EstadosOperacionalesTab, EstadosEquipoTab, TaxonomyTab,
} from './estados-tabs'
import {
  AlertasVencimientoTab, RangosTemperaturaTab, AlertasMonitorTab,
} from './umbrales-tabs'
import { CondicionesDocumentosTab } from './condiciones-tab'

export interface Seccion {
  clave:     string
  titulo:    string
  /** Una linea que dice a que pregunta responde la seccion. */
  proposito: string
  Panel:     ComponentType
}

export interface Dominio {
  clave:     string
  titulo:    string
  /** La pregunta que contesta el dominio. Si un ajuste no la contesta, esta mal ubicado. */
  proposito: string
  secciones: Seccion[]
  /** Reservado, sin contenido todavia. Se dibuja apagado y no es visitable. */
  proximamente?: boolean
}

/** FUENTE DE VERDAD del modulo de Configuracion.
 *
 *  Agregar un dominio es agregar una entrada aca: ni la portada ni la barra
 *  lateral ni las rutas se tocan. Esa es la prueba de que el marco escala —
 *  cuando llegue Facturacion, solo cambia este archivo.
 *
 *  Regla de ubicacion (spec seccion 3): un dominio no es una pestana con otro
 *  nombre. Si un ajuste no contesta el `proposito` del dominio, esta mal puesto. */
export const DOMINIOS: Dominio[] = [
  {
    clave: 'certificacion',
    titulo: 'Certificación',
    proposito: 'Qué documentos se exigen, a quién, y con cuánta anticipación se avisa',
    secciones: [
      { clave: 'condiciones', titulo: 'Condiciones de documentos',
        proposito: 'A quién se le exige cada documento', Panel: CondicionesDocumentosTab },
      { clave: 'vencimientos', titulo: 'Alertas de vencimiento',
        proposito: 'Con cuántos días de anticipación avisar', Panel: AlertasVencimientoTab },
    ],
  },
  {
    clave: 'operaciones',
    titulo: 'Operaciones',
    proposito: 'Cómo se ve el tablero, cuándo avisa, y qué temperatura corresponde',
    secciones: [
      { clave: 'estados-tms', titulo: 'Estados del tablero',
        proposito: 'Colores y columna de cada estado del TMS', Panel: EstadosTmsTab },
      { clave: 'estados-operacionales', titulo: 'Estados operacionales',
        proposito: 'El vocabulario que usa el equipo', Panel: EstadosOperacionalesTab },
      { clave: 'estados-equipo', titulo: 'Estados de equipo',
        proposito: 'El motivo cuando un equipo no sale', Panel: EstadosEquipoTab },
      { clave: 'umbrales', titulo: 'Umbrales de alerta',
        proposito: 'Cuándo el monitor considera que algo va mal', Panel: AlertasMonitorTab },
      { clave: 'temperaturas', titulo: 'Rangos de temperatura',
        proposito: 'Qué rango corresponde a cada tipo de carga', Panel: RangosTemperaturaTab },
    ],
  },
  // Flota (Task 4) y Personas y accesos (Task 6) se agregan aca cuando sus
  // componentes existan. NO agregarlos antes con un panel vacio: un componente
  // que no hace nada es peor que una seccion ausente, porque parece que anda.
  {
    clave: 'facturacion',
    titulo: 'Facturación',
    proposito: 'Más adelante',
    secciones: [],
    proximamente: true,
  },
]

export function dominioPorClave(clave: string): Dominio | undefined {
  return DOMINIOS.find(d => d.clave === clave)
}
```

**Por qué el registro arranca con tres dominios y no con cinco:** Flota y Personas y accesos
necesitan componentes que todavía no existen (`flota-tabs.tsx` en la Task 4,
`usuarios-tab.tsx` en la Task 6). Importarlos ahora rompe la resolución de módulos y el test
de esta tarea nunca llegaría a verde. Cada tarea deja el árbol compilando.

Los tests de arriba se escriben contra ese estado: `Certificación` (2 secciones),
`Operaciones` (5), `Facturación` (reservado). Las tareas 4 y 6 los amplían.

- [ ] **Paso 4: Correr el test y confirmar que pasa**

`npx vitest run app/dashboard/admin/configuracion/dominios.test.ts`
Esperado: PASA, 5 tests.

- [ ] **Paso 5: Comitear**

```bash
git add app/dashboard/admin/configuracion/dominios.ts app/dashboard/admin/configuracion/dominios.test.ts
git commit -m "feat(config): el registro de dominios es la fuente de verdad del modulo"
```

---

## Task 2: La portada

**Archivos:**
- Crear: `app/dashboard/admin/configuracion/PortadaDominios.tsx` y su test
- Modificar: `app/dashboard/admin/configuracion/page.tsx:1-62` (deja de ser pestañas)

**Interfaces:**
- Consume: `DOMINIOS`, `Dominio` de la Task 1.
- Produce: `<PortadaDominios />`, sin props.

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PortadaDominios } from './PortadaDominios'

describe('PortadaDominios', () => {
  // Se afirma sobre el registro, no sobre una lista escrita a mano: si manana
  // se agrega un dominio, este test lo cubre solo. Escribir los nombres aca
  // seria una segunda fuente de verdad de lo que hay en el modulo.
  it('muestra una tarjeta por dominio, con su proposito', () => {
    render(<PortadaDominios />)
    for (const d of DOMINIOS) {
      expect(screen.getByText(d.titulo), d.clave).toBeInTheDocument()
      expect(screen.getByText(d.proposito), d.clave).toBeInTheDocument()
    }
  })

  it('cada dominio visitable enlaza a su ruta', () => {
    render(<PortadaDominios />)
    expect(screen.getByRole('link', { name: /certificación/i }))
      .toHaveAttribute('href', '/dashboard/admin/configuracion/certificacion')
  })

  // El prefetch ejecuta el layout del dashboard, que habla con Auth: eso
  // produjo un 429 en produccion (Ronda 110). No es decorativo.
  it('los enlaces no hacen prefetch', () => {
    render(<PortadaDominios />)
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('data-prefetch')).not.toBe('true')
    }
  })

  it('un dominio proximamente no es un enlace', () => {
    render(<PortadaDominios />)
    expect(screen.getByText('Facturación')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /facturación/i })).not.toBeInTheDocument()
  })

  it('dice cuantas secciones tiene cada dominio', () => {
    render(<PortadaDominios />)
    const certificacion = screen.getByText('Certificación').closest('a')!
    expect(certificacion).toHaveTextContent('2 secciones')
  })
})
```

El import: `import { DOMINIOS } from './dominios'` junto a los demás.

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run app/dashboard/admin/configuracion/PortadaDominios.test.tsx`
Esperado: FALLA con "Failed to resolve import './PortadaDominios'".

- [ ] **Paso 3: Escribir el componente**

```tsx
'use client'

import Link from 'next/link'
import { DOMINIOS } from './dominios'

/** La portada del modulo. Se deriva del registro: agregar un dominio no toca
 *  este archivo.
 *
 *  Hoy cada tarjeta dice cuantas secciones tiene. La senal de "sin revisar"
 *  —que es lo que convierte la portada en algo mas que un menu— llega en el
 *  Plan 2, junto con el registro de revision. */
export function PortadaDominios() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {DOMINIOS.map(d => {
        const cuerpo = (
          <>
            <p className="text-sm font-semibold text-text-primary">{d.titulo}</p>
            <p className="text-xs text-gray-500 mt-1">{d.proposito}</p>
            {!d.proximamente && (
              <p className="text-[11px] text-gray-400 mt-3 tabular-nums">
                {d.secciones.length === 1 ? '1 sección' : `${d.secciones.length} secciones`}
              </p>
            )}
          </>
        )

        // Un dominio reservado se dibuja apagado y NO es un enlace: parecer
        // visitable y no llevar a ningun lado es peor que no ofrecerlo.
        if (d.proximamente) {
          return (
            <div key={d.clave}
                 className="rounded-xl border border-dashed border-border p-4 opacity-50">
              {cuerpo}
              <p className="text-[11px] text-gray-400 mt-3">Más adelante</p>
            </div>
          )
        }

        return (
          <Link key={d.clave}
                href={`/dashboard/admin/configuracion/${d.clave}`}
                prefetch={false}
                className="rounded-xl border border-border p-4 transition-colors hover:bg-gray-50/60">
            {cuerpo}
          </Link>
        )
      })}
    </div>
  )
}
```

- [ ] **Paso 4: Reemplazar el cuerpo de `page.tsx`**

```tsx
import { PortadaDominios } from './PortadaDominios'

export default function ConfiguracionPage() {
  return (
    <div className="p-4 md:p-6 space-y-6 flex-1 overflow-y-auto">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Configuración</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Elige el área que quieres ajustar. Los cambios no requieren un despliegue.
        </p>
      </div>
      <PortadaDominios />
    </div>
  )
}
```

- [ ] **Paso 5: Correr los tests y confirmar que pasan**

`npx vitest run app/dashboard/admin/configuracion/` — esperado: PASAN.

- [ ] **Paso 6: Comitear**

```bash
git add app/dashboard/admin/configuracion/PortadaDominios.tsx app/dashboard/admin/configuracion/PortadaDominios.test.tsx app/dashboard/admin/configuracion/page.tsx
git commit -m "feat(config): la portada muestra los dominios, no siete pestanas"
```

---

## Task 3: El interior de un dominio

**Archivos:**
- Crear: `app/dashboard/admin/configuracion/NavDominios.tsx` y su test
- Crear: `app/dashboard/admin/configuracion/[dominio]/page.tsx`

**Interfaces:**
- Consume: `DOMINIOS`, `dominioPorClave` de la Task 1.
- Produce: `<NavDominios activo={clave} />`.

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NavDominios } from './NavDominios'

describe('NavDominios', () => {
  // La objecion al diseno de portada era "un clic mas para lo de todos los
  // dias". Se cierra aca: desde adentro de un dominio se salta a otro sin
  // volver a la portada.
  it('ofrece los otros dominios sin volver a la portada', () => {
    render(<NavDominios activo="certificacion" />)
    expect(screen.getByRole('link', { name: /operaciones/i }))
      .toHaveAttribute('href', '/dashboard/admin/configuracion/operaciones')
    expect(screen.getByRole('link', { name: /flota/i })).toBeInTheDocument()
  })

  it('marca cual es el dominio activo', () => {
    render(<NavDominios activo="certificacion" />)
    expect(screen.getByText('Certificación').closest('[aria-current]'))
      .toHaveAttribute('aria-current', 'page')
  })

  it('un dominio proximamente no es alcanzable', () => {
    render(<NavDominios activo="certificacion" />)
    expect(screen.queryByRole('link', { name: /facturación/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run app/dashboard/admin/configuracion/NavDominios.test.tsx`
Esperado: FALLA con "Failed to resolve import './NavDominios'".

- [ ] **Paso 3: Escribir la barra**

```tsx
'use client'

import Link from 'next/link'
import { DOMINIOS } from './dominios'

/** Los dominios, para saltar entre ellos sin pasar por la portada. La portada
 *  orienta; no es un peaje que se paga en cada visita. */
export function NavDominios({ activo }: { activo: string }) {
  return (
    <nav aria-label="Áreas de configuración" className="flex flex-col gap-0.5 min-w-[170px]">
      {DOMINIOS.filter(d => !d.proximamente).map(d => {
        const esActivo = d.clave === activo
        return (
          <Link
            key={d.clave}
            href={`/dashboard/admin/configuracion/${d.clave}`}
            prefetch={false}
            aria-current={esActivo ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              esActivo ? 'bg-accent/10 text-accent font-semibold' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {d.titulo}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Paso 4: Escribir la página del dominio**

`app/dashboard/admin/configuracion/[dominio]/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { NavDominios } from '../NavDominios'
import { dominioPorClave } from '../dominios'

export default function DominioPage({ params }: { params: { dominio: string } }) {
  const dominio = dominioPorClave(params.dominio)
  // Un dominio reservado no es visitable: no tiene nada que mostrar.
  if (!dominio || dominio.proximamente) notFound()

  const [seccion, setSeccion] = useState(dominio.secciones[0].clave)
  const actual = dominio.secciones.find(s => s.clave === seccion) ?? dominio.secciones[0]
  const Panel = actual.Panel

  return (
    <div className="p-4 md:p-6 flex-1 overflow-y-auto">
      <h1 className="font-mulish font-bold text-xl text-text-primary">{dominio.titulo}</h1>
      <p className="text-xs text-gray-400 mt-0.5">{dominio.proposito}</p>

      <div className="mt-5 flex gap-6">
        <NavDominios activo={dominio.clave} />

        <div className="flex-1 min-w-0">
          {/* Las pestanas SI corresponden aca: son pocas y del mismo tema.
              Lo que no funcionaba era usarlas como unica estructura del modulo. */}
          <div role="tablist" aria-label={`Secciones de ${dominio.titulo}`}
               className="flex gap-4 border-b border-border overflow-x-auto">
            {dominio.secciones.map(s => (
              <button key={s.clave} role="tab" aria-selected={s.clave === actual.clave}
                      onClick={() => setSeccion(s.clave)}
                      className={`pb-2 text-xs whitespace-nowrap border-b-2 transition-colors ${
                        s.clave === actual.clave
                          ? 'border-accent text-accent font-semibold'
                          : 'border-transparent text-gray-600 hover:text-gray-800'
                      }`}>
                {s.titulo}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">{actual.proposito}</p>
          <div role="tabpanel" className="mt-3"><Panel /></div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Paso 5: Correr los tests y el build**

```bash
npx vitest run app/dashboard/admin/configuracion/
npx tsc --noEmit
npm run build
```
Esperado: tests PASAN, `tsc` limpio, y el manifiesto de rutas incluye
`/dashboard/admin/configuracion/[dominio]`.

- [ ] **Paso 6: Comitear**

```bash
git add app/dashboard/admin/configuracion/NavDominios.tsx app/dashboard/admin/configuracion/NavDominios.test.tsx "app/dashboard/admin/configuracion/[dominio]/page.tsx"
git commit -m "feat(config): cada dominio tiene su pagina, con los otros a un clic"
```

---

## Task 4: Flota y los vocabularios que faltaban

Hoy **no existe** editor para subtipos de vehículo, tipos de operación ni motivos de
conductor, aunque los tres son taxonomías con CRUD completo en el backend
(`app/routers/status_taxonomies.py`) y `TaxonomyTab` ya está parametrizado por dominio
(`estados-tabs.tsx:139`). O sea que esta tarea es composición, no lógica nueva.

**Archivos:**
- Crear: `app/dashboard/admin/configuracion/flota-tabs.tsx` y su test
- Modificar: `app/dashboard/admin/configuracion/dominios.ts` (descomentar las 3 secciones)

**Interfaces:**
- Consume: `TaxonomyTab` de `./estados-tabs`, con props `{ domain, title, hint, newLabel }`.
- Produce: `SubtiposVehiculoTab`, `TiposOperacionTab`, `MotivosConductorTab`.

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SubtiposVehiculoTab, TiposOperacionTab } from './flota-tabs'

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn().mockResolvedValue([]) },
  configApi: {},
}))

describe('secciones de Flota', () => {
  it('subtipos de vehiculo pide el dominio correcto', async () => {
    const { taxonomiesApi } = await import('@/lib/api/config')
    render(<SubtiposVehiculoTab />)
    expect(taxonomiesApi.list).toHaveBeenCalledWith('FLEET_SERVICE_TYPE')
  })

  it('tipos de operacion pide el dominio correcto', async () => {
    const { taxonomiesApi } = await import('@/lib/api/config')
    render(<TiposOperacionTab />)
    expect(taxonomiesApi.list).toHaveBeenCalledWith('WEBCARGA_OPERATION_TYPE')
  })

  // Es vocabulario COMPARTIDO: quien lo edita tiene que saber que toca a otros
  // modulos. Sin esto, alguien cambia un subtipo pensando solo en su pantalla.
  it('avisa que el vocabulario lo comparten otros modulos', () => {
    render(<SubtiposVehiculoTab />)
    expect(screen.getByText(/certificación/i)).toBeInTheDocument()
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run app/dashboard/admin/configuracion/flota-tabs.test.tsx`
Esperado: FALLA con "Failed to resolve import './flota-tabs'".

- [ ] **Paso 3: Escribir las secciones**

```tsx
'use client'

import { TaxonomyTab } from './estados-tabs'

/** Las dos taxonomias que consumen VARIOS modulos (verificado contra el codigo,
 *  spec seccion 2): los subtipos alimentan las condiciones de Certificacion, la
 *  ficha de empresa y los cierres de equipo; los tipos de operacion alimentan
 *  la ficha de empresa, los viajes y los cierres.
 *
 *  Por eso Flota es un dominio propio y no una seccion llamada "Vocabulario":
 *  es un nombre del negocio, y contiene exactamente lo compartido. Se edita
 *  aca y en ningun otro lado. */

const AVISO_COMPARTIDO =
  'Este vocabulario lo usan Certificación y Operaciones. Un cambio acá se ve en los dos.'

export function SubtiposVehiculoTab() {
  return (
    <TaxonomyTab
      domain="FLEET_SERVICE_TYPE"
      title="Subtipos de vehículo"
      hint={AVISO_COMPARTIDO}
      newLabel="Nuevo subtipo"
    />
  )
}

export function TiposOperacionTab() {
  return (
    <TaxonomyTab
      domain="WEBCARGA_OPERATION_TYPE"
      title="Tipos de operación"
      hint={AVISO_COMPARTIDO}
      newLabel="Nuevo tipo de operación"
    />
  )
}

/** Motivos de conductor NO es compartido: lo usan solo los cierres diarios y
 *  los viajes, o sea Operaciones. Vive alli, no en Flota. */
export function MotivosConductorTab() {
  return (
    <TaxonomyTab
      domain="DRIVER_REASON"
      title="Motivos de conductor"
      hint="Por qué un conductor no está disponible. Sólo lo usa Operaciones."
      newLabel="Nuevo motivo"
    />
  )
}
```

- [ ] **Paso 4: Conectar el dominio Flota y la sección de motivos en el registro**

En `dominios.ts`, agregar la importación:

```ts
import { SubtiposVehiculoTab, TiposOperacionTab, MotivosConductorTab } from './flota-tabs'
```

Agregar la sección de motivos al final de las de Operaciones:

```ts
      { clave: 'motivos-conductor', titulo: 'Motivos de conductor',
        proposito: 'Por qué un conductor no está disponible', Panel: MotivosConductorTab },
```

Y el dominio Flota, **entre Operaciones y Facturación** (el orden del arreglo es el orden en
que se dibujan, en la portada y en la barra lateral):

```ts
  {
    clave: 'flota',
    titulo: 'Flota',
    proposito: 'El vocabulario de vehículos que comparten Certificación y Operaciones',
    secciones: [
      { clave: 'subtipos', titulo: 'Subtipos de vehículo',
        proposito: 'Furgón congelado, sider, rampla plana', Panel: SubtiposVehiculoTab },
      { clave: 'tipos-operacion', titulo: 'Tipos de operación',
        proposito: 'Tractoreo y equipo completo', Panel: TiposOperacionTab },
    ],
  },
```

- [ ] **Paso 5: Correr los tests y confirmar que pasan**

`npx vitest run app/dashboard/admin/configuracion/` — esperado: PASAN, incluidos los 5 de
`dominios.test.ts` (ahora Flota tiene sus 2 secciones y Operaciones 6).

- [ ] **Paso 6: Comitear**

```bash
git add app/dashboard/admin/configuracion/flota-tabs.tsx app/dashboard/admin/configuracion/flota-tabs.test.tsx app/dashboard/admin/configuracion/dominios.ts
git commit -m "feat(config): Flota edita el vocabulario compartido de vehiculos"
```

---

## Task 5: El aviso al desactivar un valor en uso

Exponer el editor de subtipos crea un riesgo nuevo: desactivar un subtipo que una condición
de documento está usando. El borrado es **lógico** (`active = false`,
`status_taxonomies.py:60-68`), así que el UUID sobrevive y las reglas no se rompen — pero el
subtipo desaparece de las casillas y la condición se ve como "0 marcas" sin serlo. Esa
asimetría ya está anotada en la revisión de rama del Tramo 3.

**Archivos:**
- Modificar: `backend/api/app/routers/status_taxonomies.py:60-68`
- Test: `backend/api/tests/test_status_taxonomies.py`

**Interfaces:**
- Produce: `DELETE /api/v1/status-taxonomies/{id}` devuelve `{"desactivado": true, "en_uso_por": N}`.

- [ ] **Paso 1: Escribir el test que falla**

```python
def test_desactivar_un_subtipo_en_uso_avisa_cuantas_reglas_lo_usan():
    """Desactivar no rompe nada -- el borrado es logico y el UUID sobrevive en
    applies_to_fleet_service_type_ids -- pero el subtipo desaparece de las
    casillas y la condicion se ve como '0 marcas' sin serlo. Quien desactiva
    tiene que enterarse en el momento, no despues."""
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 1"
    pool.fetchval.return_value = 2
    client = make_client(pool)

    res = client.delete("/api/v1/status-taxonomies/abc")

    assert res.status_code == 200
    assert res.json() == {"desactivado": True, "en_uso_por": 2}
```

- [ ] **Paso 2: Correr y confirmar que falla**

`cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_status_taxonomies.py -v`
Esperado: FALLA — hoy el endpoint no devuelve cuerpo.

- [ ] **Paso 3: Implementar**

```python
@router.delete("/{taxonomy_id}")
async def deactivate_taxonomy(taxonomy_id: str, pool=Depends(get_pool), _=Depends(require_admin)):
    result = await pool.execute(
        "UPDATE app.status_taxonomies SET active = false, updated_at = NOW() WHERE id = $1", taxonomy_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    await invalidate_trips_meta_cache()
    # Cuantas condiciones de documento siguen apuntando a este subtipo. El
    # borrado es logico, asi que la regla NO se rompe -- pero la casilla
    # desaparece de la pantalla y la condicion se ve como "0 marcas" sin serlo.
    en_uso = await pool.fetchval(
        """
        SELECT count(*) FROM public.compliance_requirements
         WHERE $1::uuid = ANY(applies_to_fleet_service_type_ids)
        """,
        taxonomy_id,
    )
    return {"desactivado": True, "en_uso_por": en_uso or 0}
```

- [ ] **Paso 4: Verificar el SQL contra la base real**

Los tests con `AsyncMock` **no** detectan SQL inválido — ya pasaron dos bugs reales por ahí
en este proyecto. Verificar con el MCP de Supabase (proyecto `viclzoftiudkepqnhekv`, **sólo
lectura**) que la consulta compila y liga el tipo:

```sql
PREPARE t (uuid) AS
SELECT count(*) FROM public.compliance_requirements
 WHERE $1::uuid = ANY(applies_to_fleet_service_type_ids);
SELECT parameter_types FROM pg_prepared_statements WHERE name = 't';
DEALLOCATE ALL;
```
Esperado: `{uuid}`.

- [ ] **Paso 5: Mostrar el aviso en la interfaz**

Primero el test, en `estados-tabs.test.tsx`:

```tsx
it('al desactivar un valor en uso avisa cuantas reglas lo usaban', async () => {
  vi.mocked(taxonomiesApi.remove).mockResolvedValue({ desactivado: true, en_uso_por: 2 })
  render(<TaxonomyTab domain="FLEET_SERVICE_TYPE" title="Subtipos" hint="" newLabel="Nuevo" />)

  fireEvent.click(await screen.findByRole('button', { name: /desactivar/i }))

  expect(await screen.findByText(/2 reglas de documento/i)).toBeInTheDocument()
})

it('sin reglas usandolo no muestra aviso', async () => {
  vi.mocked(taxonomiesApi.remove).mockResolvedValue({ desactivado: true, en_uso_por: 0 })
  render(<TaxonomyTab domain="FLEET_SERVICE_TYPE" title="Subtipos" hint="" newLabel="Nuevo" />)

  fireEvent.click(await screen.findByRole('button', { name: /desactivar/i }))
  await waitFor(() => expect(taxonomiesApi.remove).toHaveBeenCalled())

  expect(screen.queryByText(/reglas de documento/i)).not.toBeInTheDocument()
})
```

Después, en `TaxonomyTab`, guardar la respuesta del borrado y dibujarla:

```tsx
const [avisoUso, setAvisoUso] = useState<number | null>(null)

// …en el handler del borrado:
const r = await taxonomiesApi.remove(id)
setAvisoUso(r.en_uso_por > 0 ? r.en_uso_por : null)

// …en el render, encima de la lista:
{avisoUso !== null && (
  <p className="text-[11px] text-amber-700 mb-2">
    Se desactivó, y {avisoUso === 1 ? 'una regla de documento seguía usándolo'
                                    : `${avisoUso} reglas de documento seguían usándolo`}.
    Revisa Certificación · Condiciones.
  </p>
)}
```

`taxonomiesApi.remove` tiene que devolver el cuerpo (`lib/api/config.ts`); hoy descarta la
respuesta. Ajustar su tipo de retorno a `Promise<{ desactivado: boolean; en_uso_por: number }>`.

- [ ] **Paso 6: Correr las dos suites**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q     # 648
cd ../../frontend && npx vitest run                                    # 879 + nuevos
```

- [ ] **Paso 7: Comitear**

```bash
git add backend/api/app/routers/status_taxonomies.py backend/api/tests/test_status_taxonomies.py frontend/app/dashboard/admin/configuracion/estados-tabs.tsx
git commit -m "feat(config): desactivar un subtipo avisa si alguna regla lo usa"
```

---

## Task 6: Personas y accesos

**Archivos:**
- Crear: `app/dashboard/admin/configuracion/usuarios-tab.tsx`
- Modificar: `components/dashboard/Sidebar.tsx:206-310`
- Modificar: `app/dashboard/admin/configuracion/dominios.ts` (descomentar `usuarios`)

- [ ] **Paso 1: Extraer el contenido de la página de usuarios a un componente**

`usuarios-tab.tsx` exporta `UsuariosTab` con el cuerpo de
`app/dashboard/admin/usuarios/page.tsx`, sin el encabezado de página (el título lo pone
ahora la página del dominio). **No cambiar su lógica**: es una mudanza.

- [ ] **Paso 2: Agregar el dominio al registro**

En `dominios.ts`, importar `UsuariosTab` desde `./usuarios-tab` y agregar el dominio
**entre Flota y Facturación**:

```ts
  {
    clave: 'personas',
    titulo: 'Personas y accesos',
    proposito: 'Quién entra y qué puede hacer',
    secciones: [
      { clave: 'usuarios', titulo: 'Usuarios',
        proposito: 'Quién tiene cuenta y con qué rol', Panel: UsuariosTab },
    ],
  },
```

- [ ] **Paso 3: Dejar la ruta vieja apuntando a la nueva**

`app/dashboard/admin/usuarios/page.tsx` pasa a ser sólo la redirección. Acá **sí**
corresponde redirigir, a diferencia del corte limpio de la Ronda 55: es una URL que estuvo
en el menú lateral durante meses y que la gente tiene guardada.

```tsx
import { redirect } from 'next/navigation'

/** Usuarios se mudo a Configuracion > Personas y accesos. La ruta vieja
 *  redirige en vez de dar 404 porque estuvo meses en el menu lateral. */
export default function UsuariosRedirect() {
  redirect('/dashboard/admin/configuracion/personas')
}
```

- [ ] **Paso 4: Sacar Usuarios del menú lateral**

En `Sidebar.tsx`, quitar la entrada de Usuarios (líneas ~296-310) y su variable
`isAdminUsers` (línea 208). Configuración queda como única puerta a Administración.

Test, en el archivo de tests del Sidebar:

```tsx
it('Usuarios ya no es una entrada propia del menu', () => {
  render(<Sidebar />)   // con el mock de rol admin que ya usa ese archivo
  expect(screen.queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /configuración/i })).toBeInTheDocument()
})
```

- [ ] **Paso 5: Correr los tests, `tsc` y el build**

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

- [ ] **Paso 6: Comitear**

```bash
git add app/dashboard/admin/configuracion/usuarios-tab.tsx app/dashboard/admin/usuarios/page.tsx components/dashboard/Sidebar.tsx app/dashboard/admin/configuracion/dominios.ts
git commit -m "feat(config): Usuarios entra al modulo como Personas y accesos"
```

---

## Task 7: Verificación de conjunto

- [ ] **Paso 1: Las dos suites completas**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q
cd ../../frontend && npx vitest run && npx tsc --noEmit && npm run build
```
Ninguna regresión sobre 647 backend / 879 frontend.

- [ ] **Paso 2: Que el registro sea de verdad la única fuente**

```bash
grep -rn "Estados TMS\|Rangos de Temperatura\|Alertas de Vencimiento" app/ components/ --include="*.tsx" | grep -v dominios.ts
```
Esperado: **sin resultados** fuera de `dominios.ts` y de los propios paneles. Si un título
aparece en otro lado, hay una segunda fuente de verdad y hay que eliminarla.

- [ ] **Paso 3: Click-through en staging con Playwright**

**No saltarlo.** En este módulo mirar la pantalla encontró lo que 879 tests no podían: el
cajón de cinco pantallas de alto (Tramo 2) y el cero que ocultaba 209 empresas (Ronda 114).

Probar: la portada lista los cinco dominios y Facturación no es clicable · entrar a
Certificación y volver a Operaciones **sin pasar por la portada** · las siete secciones
mudadas cargan igual que antes · Flota edita subtipos · desactivar un subtipo en uso muestra
el aviso · la URL vieja de usuarios redirige.

- [ ] **Paso 4: Revisión de rama completa**

Correr `/code-review` sobre la rama, no sólo por tarea. En el Tramo 1 las nueve revisiones
por tarea pasaron limpias y la de conjunto encontró tres bugs críticos; en el Tramo 2, nueve;
en el Tramo 3, un crítico que ninguna revisión acotada podía ver.

- [ ] **Paso 5: Actualizar el AGENTLOG**

Regla 3 de `CLAUDE.md`: qué se hizo, próximo paso exacto, decisiones de arquitectura.

---

## Fuera de alcance de este plan

- **El registro de revisión** y la insignia "sin revisar" — Plan 2. Por eso las tarjetas de
  la portada dicen cuántas secciones tienen y no cuánto falta.
- **El buscador** — Plan 3.
- **El interior de la lista de condiciones** (37 reglas, jerarquía, edición de a una) — es el
  spec 2, todavía sin escribir. Este plan la **mueve**, no la rediseña.
- **Permisos por dominio**: toda la configuración sigue exigiendo rol admin.
