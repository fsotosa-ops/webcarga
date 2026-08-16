# Listas de configuración — Plan

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usar
> superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans
> para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que las secciones de Configuración se lean como el Monitor de viajes —tabla
con encabezados ordenables, fila de lectura, panel que edita— en vez de ser formularios
abiertos de 5.849 px y 300 controles.

**Arquitectura:** primero las tres piezas compartidas (orden, chips de filtro, cáscara del
panel), extraídas de lo que ya existe en `TripTable` y `TransporterSlideOver`. Después cada
sección declara **sus** columnas y usa esas piezas. Las columnas nunca suben a compartido:
un viaje y un requisito no tienen nada en común.

**Stack:** Next.js 14 App Router · React Query · Tailwind · lucide-react · FastAPI + asyncpg.

**Spec:** `docs/superpowers/specs/2026-08-16-listas-de-configuracion-design.md`

## Restricciones globales

- **Español neutral, NUNCA voseo**: "Elige", "Guarda", "Selecciona" — nunca "Elegí",
  "Guardá". En interfaz, comentarios y mensajes de commit.
- **Cero emojis.** Íconos sólo de `lucide-react`. Sin paleta nueva: tokens de
  `app/globals.css` (`--accent`, `--accion`, `--espera`, `--resuelto`, `--text-primary`,
  `--border-color`).
- **Slugs de URL en inglés, etiquetas visibles en español** (normalización de rutas, Ronda 55).
- Todo `<Link>` con `prefetch={false}` — hay tests que lo verifican leyendo el archivo fuente.
- **Accesibilidad, de `ui-ux-pro-max` (severidad alta):** orden de tabulación igual al
  visual · anillo de foco visible en todo lo interactivo, nunca `outline:none` sin
  reemplazo · escala de z-index declarada, nada de valores arbitrarios · el panel guarda el
  foco al abrir y lo devuelve al cerrar · `Escape` cierra.
- **De `frontend-patterns`:** componentes compuestos antes que un componente con muchas
  props · `useCallback` para lo que se pasa a filas · react-query para datos asíncronos
  (el módulo ya lo usa en `RequirementConditionsPanel`), **no** un `useQuery` propio.
- Validar **al salir del campo**, no sólo al guardar. Truncar con puntos suspensivos.
- **Frontend:** `npx vitest run` desde `monitor-app/frontend`, **no** desde la raíz del repo
  (desde la raíz fallan 11 tests por configuración de jsdom). Base: **917 tests**.
- **Backend:** `venv/bin/python -m pytest` desde `monitor-app/backend/api`, con `venv/` —
  **no** `.venv`. Base: **654 tests**. Los tests marcados `integracion` ejecutan SQL real
  contra producción dentro de transacciones revertidas.
- `npx vitest run` sale con código 1 por un `Unhandled Rejection` preexistente y ajeno en
  `CarrierDrawer.test.tsx`. No arreglarlo, no confundirlo con un fallo propio.
- **NO aplicar migraciones** sin autorización explícita del usuario.
- TDD con RED verificado: escribir el test, **correrlo y confirmar que falla por el motivo
  correcto**, después implementar. Un RED que falla por un import roto no es válido.
- **El código de test de este plan es un punto de partida verificable, no una
  transcripción.** Si al correrlo falla por un motivo distinto al declarado, corregir el
  test y reportarlo — no forzarlo a verde. En este proyecto ya entraron dos tests que
  pasaban sin probar nada.

---

## Estructura de archivos

**Piezas compartidas (nuevas):**

| Archivo | Responsabilidad |
|---|---|
| `components/ui/tabla/OrdenIcono.tsx` | El ícono de orden. Hoy vive privado dentro de `TripTable.tsx:123`. |
| `components/ui/tabla/EncabezadoOrdenable.tsx` | El `<th>` que ordena, con su estado accesible. |
| `components/ui/tabla/useOrden.ts` | El estado de orden (columna + dirección), genérico. |
| `components/ui/ChipsDeFiltro.tsx` | La barra de chips, hoy repetida en Monitor y Certificación. |
| `components/ui/PanelLateral.tsx` | La cáscara del panel: fondo, foco, `Escape`, escala de z-index. |

**Secciones (reemplazan a las actuales):**

| Archivo | Responsabilidad |
|---|---|
| `app/dashboard/admin/settings/condiciones-tabla.tsx` | La lista de los 37 requisitos. Reemplaza a `condiciones-tab.tsx`. |
| `app/dashboard/admin/settings/CondicionPanel.tsx` | El editor de una regla. |
| `app/dashboard/admin/settings/estados-tabla.tsx` | La lista de los 25 estados. Reemplaza a `EstadosTmsTab`. |
| `app/dashboard/admin/settings/EstadoPanel.tsx` | El editor de un estado. |

**Backend:**

| Archivo | Cambio |
|---|---|
| `app/routers/requirements.py` | `GET /compliance-requirements` suma el alcance de cada regla. |

**No se toca** `TaxonomyTab` (`estados-tabs.tsx:139`): lo usan cinco secciones de tres
dominios, y este plan sólo cambia `EstadosTmsTab`. Migrar las demás es otro trabajo, y el
spec lo deja fuera de alcance a propósito.

---

## Task 1: El orden, extraído de TripTable

**Archivos:**
- Crear: `components/ui/tabla/OrdenIcono.tsx`, `components/ui/tabla/EncabezadoOrdenable.tsx`, `components/ui/tabla/useOrden.ts`
- Test: `components/ui/tabla/EncabezadoOrdenable.test.tsx`

**Interfaces:**
- Produce: `<OrdenIcono activo={boolean} direccion={'asc'|'desc'} />` · `<EncabezadoOrdenable columna={string} orden={Orden} onOrdenar={(c:string)=>void}>texto</EncabezadoOrdenable>` · `useOrden(inicial?: Orden)` que devuelve `{ orden, ordenarPor, comparar }` · `type Orden = { columna: string; direccion: 'asc' | 'desc' } | null`

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { EncabezadoOrdenable } from './EncabezadoOrdenable'

function montar(orden: Parameters<typeof EncabezadoOrdenable>[0]['orden'], onOrdenar = vi.fn()) {
  render(
    <table><thead><tr>
      <EncabezadoOrdenable columna="nombre" orden={orden} onOrdenar={onOrdenar}>Documento</EncabezadoOrdenable>
    </tr></thead></table>,
  )
  return onOrdenar
}

describe('EncabezadoOrdenable', () => {
  it('avisa por que columna ordenar al hacer clic', () => {
    const onOrdenar = montar(null)
    fireEvent.click(screen.getByRole('columnheader'))
    expect(onOrdenar).toHaveBeenCalledWith('nombre')
  })

  // aria-sort es como un lector de pantalla sabe que la tabla esta ordenada.
  // Sin esto el orden es informacion que solo existe si ves el icono.
  it('declara el orden de forma accesible', () => {
    montar({ columna: 'nombre', direccion: 'asc' })
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('una columna que no ordena no dice nada', () => {
    montar({ columna: 'otra', direccion: 'asc' })
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
  })

  // Orden de tabulacion y foco visible: regla de severidad alta de ui-ux-pro-max.
  it('se puede ordenar con el teclado', () => {
    const onOrdenar = montar(null)
    const boton = screen.getByRole('button', { name: /documento/i })
    fireEvent.keyDown(boton, { key: 'Enter' })
    expect(onOrdenar).toHaveBeenCalledWith('nombre')
  })
})
```

- [ ] **Paso 2: Correr el test y confirmar que falla**

Desde `monitor-app/frontend`:
`npx vitest run components/ui/tabla/EncabezadoOrdenable.test.tsx`
Esperado: FALLA con "Failed to resolve import './EncabezadoOrdenable'".

- [ ] **Paso 3: Escribir las tres piezas**

`useOrden.ts`:

```ts
'use client'

import { useCallback, useState } from 'react'

export type Orden = { columna: string; direccion: 'asc' | 'desc' } | null

/** El estado de orden de una tabla. Generico a proposito: la columna es un
 *  string y la comparacion la aporta quien lo usa, porque ordenar viajes y
 *  ordenar requisitos no se parece en nada. Lo que se comparte es el
 *  COMPORTAMIENTO —primer clic ascendente, segundo descendente— no los datos. */
export function useOrden(inicial: Orden = null) {
  const [orden, setOrden] = useState<Orden>(inicial)

  const ordenarPor = useCallback((columna: string) => {
    setOrden(prev =>
      prev?.columna === columna
        ? { columna, direccion: prev.direccion === 'asc' ? 'desc' : 'asc' }
        : { columna, direccion: 'asc' },
    )
  }, [])

  /** Ordena una copia: Array.prototype.sort muta en el lugar. */
  function comparar<T>(filas: T[], valor: (fila: T) => string | number): T[] {
    if (!orden) return filas
    const signo = orden.direccion === 'asc' ? 1 : -1
    return [...filas].sort((a, b) => {
      const va = valor(a), vb = valor(b)
      if (va === vb) return 0
      return va > vb ? signo : -signo
    })
  }

  return { orden, ordenarPor, comparar }
}
```

`OrdenIcono.tsx`:

```tsx
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

/** Extraido de TripTable.tsx, donde vivia privado. Mismos iconos, mismos
 *  tamanos y mismos colores: si el orden se ve distinto en dos tablas de la
 *  misma app, deja de leerse como orden. */
export function OrdenIcono({ activo, direccion }: { activo: boolean; direccion: 'asc' | 'desc' }) {
  if (!activo) return <ArrowUpDown size={10} className="inline ml-0.5 text-gray-300" aria-hidden="true" />
  if (direccion === 'asc') return <ArrowUp size={10} className="inline ml-0.5 text-accent" aria-hidden="true" />
  return <ArrowDown size={10} className="inline ml-0.5 text-accent" aria-hidden="true" />
}
```

`EncabezadoOrdenable.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'
import { OrdenIcono } from './OrdenIcono'
import type { Orden } from './useOrden'

/** El `<th>` que ordena.
 *
 *  El boton adentro del th, y no el th clicable, para que el orden de
 *  tabulacion y el anillo de foco salgan del navegador en vez de reimplementarse
 *  (regla de severidad alta de ui-ux-pro-max). `aria-sort` es como un lector de
 *  pantalla sabe que la tabla esta ordenada. */
export function EncabezadoOrdenable({
  columna, orden, onOrdenar, children, className = '',
}: {
  columna:    string
  orden:      Orden
  onOrdenar:  (columna: string) => void
  children:   ReactNode
  className?: string
}) {
  const activo = orden?.columna === columna
  return (
    <th
      scope="col"
      aria-sort={activo ? (orden!.direccion === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-gray-400 ${className}`}
    >
      <button
        type="button"
        onClick={() => onOrdenar(columna)}
        className="inline-flex items-center hover:text-gray-600 transition-colors
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
      >
        {children}
        <OrdenIcono activo={activo} direccion={orden?.direccion ?? 'asc'} />
      </button>
    </th>
  )
}
```

- [ ] **Paso 4: Correr el test y confirmar que pasa**

`npx vitest run components/ui/tabla/` — esperado: PASAN, 4 tests.

- [ ] **Paso 5: Comitear**

```bash
git add components/ui/tabla/
git commit -m "feat(ui): el orden de tabla sale de TripTable y pasa a ser compartido"
```

---

## Task 2: Los chips de filtro

**Archivos:**
- Crear: `components/ui/ChipsDeFiltro.tsx` y su test

**Interfaces:**
- Produce: `<ChipsDeFiltro opciones={Chip[]} activo={string|null} onElegir={(id:string|null)=>void} />` con `type Chip = { id: string; etiqueta: string; n?: number }`

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChipsDeFiltro } from './ChipsDeFiltro'

const OPCIONES = [
  { id: 'sin-revisar', etiqueta: 'Sin revisar', n: 12 },
  { id: 'con-condicion', etiqueta: 'Con condición', n: 2 },
]

describe('ChipsDeFiltro', () => {
  it('muestra cada opcion con su cantidad', () => {
    render(<ChipsDeFiltro opciones={OPCIONES} activo={null} onElegir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /sin revisar/i })).toHaveTextContent('12')
  })

  it('elegir un chip lo avisa', () => {
    const onElegir = vi.fn()
    render(<ChipsDeFiltro opciones={OPCIONES} activo={null} onElegir={onElegir} />)
    fireEvent.click(screen.getByRole('button', { name: /sin revisar/i }))
    expect(onElegir).toHaveBeenCalledWith('sin-revisar')
  })

  // Volver a apretar el chip activo lo apaga: sin esto el unico modo de quitar
  // un filtro es recargar, que es como se pierde la confianza en un filtro.
  it('volver a apretar el chip activo lo apaga', () => {
    const onElegir = vi.fn()
    render(<ChipsDeFiltro opciones={OPCIONES} activo="sin-revisar" onElegir={onElegir} />)
    fireEvent.click(screen.getByRole('button', { name: /sin revisar/i }))
    expect(onElegir).toHaveBeenCalledWith(null)
  })

  it('declara cual esta activo de forma accesible', () => {
    render(<ChipsDeFiltro opciones={OPCIONES} activo="sin-revisar" onElegir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /sin revisar/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /con condición/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('un chip sin cantidad no dibuja un cero', () => {
    render(<ChipsDeFiltro opciones={[{ id: 'x', etiqueta: 'Todos' }]} activo={null} onElegir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /todos/i })).not.toHaveTextContent('0')
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run components/ui/ChipsDeFiltro.test.tsx`
Esperado: FALLA con "Failed to resolve import './ChipsDeFiltro'".

- [ ] **Paso 3: Escribir el componente**

```tsx
'use client'

export interface Chip { id: string; etiqueta: string; n?: number }

/** La barra de chips de filtro, como la del Monitor (Colun / Iansa / Sodimac).
 *
 *  `aria-pressed` y no `aria-selected`: son interruptores, no pestanas — y un
 *  lector de pantalla los anuncia distinto. Volver a apretar el activo lo apaga,
 *  porque si no la unica forma de quitar el filtro es recargar. */
export function ChipsDeFiltro({
  opciones, activo, onElegir,
}: {
  opciones: Chip[]
  activo:   string | null
  onElegir: (id: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opciones.map(({ id, etiqueta, n }) => {
        const encendido = id === activo
        return (
          <button
            key={id}
            type="button"
            aria-pressed={encendido}
            onClick={() => onElegir(encendido ? null : id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              encendido
                ? 'border-accion text-accion bg-accion/5 font-semibold'
                : 'border-border text-gray-600 hover:text-gray-800'
            }`}
          >
            {etiqueta}
            {n !== undefined && <span className="ml-1.5 tabular-nums">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Paso 4: Correr y confirmar que pasa**

`npx vitest run components/ui/ChipsDeFiltro.test.tsx` — esperado: PASAN, 5 tests.

- [ ] **Paso 5: Comitear**

```bash
git add components/ui/ChipsDeFiltro.tsx components/ui/ChipsDeFiltro.test.tsx
git commit -m "feat(ui): los chips de filtro dejan de estar escritos dos veces"
```

---

## Task 3: La cáscara del panel

**Archivos:**
- Crear: `components/ui/PanelLateral.tsx` y su test

**Interfaces:**
- Produce: `<PanelLateral titulo={ReactNode} onCerrar={() => void} pie={ReactNode}>cuerpo</PanelLateral>`

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PanelLateral } from './PanelLateral'

function montar(onCerrar = vi.fn()) {
  render(
    <>
      <button>afuera</button>
      <PanelLateral titulo="Mantención Cámara de Frío" onCerrar={onCerrar} pie={<button>Guardar</button>}>
        <p>cuerpo del panel</p>
      </PanelLateral>
    </>,
  )
  return onCerrar
}

describe('PanelLateral', () => {
  it('es un dialogo con nombre accesible', () => {
    montar()
    expect(screen.getByRole('dialog', { name: /cámara de frío/i })).toBeInTheDocument()
  })

  it('Escape cierra', () => {
    const onCerrar = montar()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('el boton de cerrar cierra', () => {
    const onCerrar = montar()
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onCerrar).toHaveBeenCalled()
  })

  // Regla de severidad alta: al abrir, el foco entra al panel; al cerrar,
  // vuelve a donde estaba. Sin esto quien navega con teclado queda perdido
  // detras del panel.
  it('al abrir toma el foco', () => {
    montar()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('al cerrar devuelve el foco a donde estaba', () => {
    const disparador = document.createElement('button')
    document.body.appendChild(disparador)
    disparador.focus()

    const { unmount } = render(
      <PanelLateral titulo="X" onCerrar={vi.fn()} pie={null}><p>c</p></PanelLateral>,
    )
    unmount()

    expect(disparador).toHaveFocus()
    disparador.remove()
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run components/ui/PanelLateral.test.tsx`
Esperado: FALLA con "Failed to resolve import './PanelLateral'".

- [ ] **Paso 3: Escribir el componente**

```tsx
'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** La cascara de un panel de detalle. La familia ya existe
 *  (TransporterSlideOver, CarrierDrawer, VehicleDetailPanel) y repite estas
 *  mismas cuatro cosas: fondo, Escape, foco y capas.
 *
 *  ESCALA DE Z-INDEX declarada, no valores inventados: fondo 40, panel 50 —
 *  los mismos que ya usa TransporterSlideOver. Un `z-[9999]` suelto convierte
 *  el apilado en algo que se descubre a los golpes. */
export function PanelLateral({
  titulo, onCerrar, pie, children,
}: {
  titulo:   ReactNode
  onCerrar: () => void
  pie:      ReactNode
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const anterior = useRef<HTMLElement | null>(null)

  useEffect(() => {
    anterior.current = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('keydown', alTeclear)
      // Devolver el foco a donde estaba: sin esto, cerrar deja a quien navega
      // con teclado al principio del documento.
      anterior.current?.focus()
    }
  }, [onCerrar])

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onCerrar} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof titulo === 'string' ? titulo : undefined}
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-xl
                   flex flex-col focus-visible:outline-none"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <div className="font-mulish font-bold text-sm text-text-primary min-w-0 truncate">{titulo}</div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="ml-auto shrink-0 text-gray-400 hover:text-gray-600
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {pie && <div className="px-4 py-3 border-t border-border bg-gray-50/60">{pie}</div>}
      </div>
    </>
  )
}
```

- [ ] **Paso 4: Correr y confirmar que pasa**

`npx vitest run components/ui/PanelLateral.test.tsx` — esperado: PASAN, 5 tests.

- [ ] **Paso 5: Comitear**

```bash
git add components/ui/PanelLateral.tsx components/ui/PanelLateral.test.tsx
git commit -m "feat(ui): la cascara del panel, con foco y capas declaradas"
```

---

## Task 4: El alcance de cada regla

La columna "Se exige a" necesita decir a cuántas entidades alcanza: *"Sólo Furgón Congelado
· 20 de 118 vehículos"*. Sin ese número, la frase no dice si son veinte vehículos o dos.

**Archivos:**
- Modificar: `monitor-app/backend/api/app/routers/requirements.py` (el `GET` del catálogo)
- Modificar: `monitor-app/backend/api/app/schemas/compliance.py` (`RequirementOption`)
- Test: `monitor-app/backend/api/tests/test_requirements.py`

**Interfaces:**
- Produce: cada fila de `GET /api/v1/compliance-requirements` suma `alcance: {alcanzadas: int, universo: int}`.

- [ ] **Paso 1: Escribir el test que falla**

```python
def test_el_catalogo_dice_a_cuantas_entidades_alcanza_cada_regla():
    """"Sólo Furgón Congelado" no dice si son veinte vehiculos o dos. El
    alcance es lo que convierte la regla en algo que se puede juzgar."""
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "r1", "requirement_code": "MANTENCION_FRIO", "name": "Mantención Cámara de Frío",
        "target_entity": "ASSET", "is_active": True,
        "applies_to_fleet_service_type_ids": ["t1"], "applies_to_management_types": None,
        "alcanzadas": 20, "universo": 118,
    }]
    res = make_client(pool).get("/api/v1/compliance-requirements")

    assert res.status_code == 200
    assert res.json()[0]["alcance"] == {"alcanzadas": 20, "universo": 118}
```

- [ ] **Paso 2: Correr y confirmar que falla**

`cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_requirements.py -k alcance -v`
Esperado: FALLA — hoy la respuesta no tiene `alcance`.

- [ ] **Paso 3: Ampliar el schema**

En `app/schemas/compliance.py`, `RequirementOption` suma:

```python
class Alcance(BaseModel):
    alcanzadas: int
    universo:   int


# …dentro de RequirementOption:
    alcance: Alcance
```

- [ ] **Paso 4: Ampliar la consulta**

El `SELECT` del catálogo suma dos columnas calculadas. **La regla de aplicabilidad ya vive
en un solo lugar** (`app/services/requirement_conditions.py`,
`SQL_ENTIDADES_QUE_APLICAN`): reusarla, no reescribirla. Si acá se escribiera una tercera
copia del predicado, sería exactamente el defecto que costó el crítico del Tramo 3.

```python
# El universo depende de target_entity; el alcance, de la condicion. Los dos
# salen de la MISMA definicion que usa la vista previa del recalculo.
_ALCANCE_SQL = """
LEFT JOIN LATERAL (
    SELECT count(*) AS alcanzadas FROM public.assets a
     WHERE r.target_entity = 'ASSET'
       AND (r.applies_to_fleet_service_type_ids IS NULL
            OR a.fleet_service_type_id = ANY(r.applies_to_fleet_service_type_ids))
) al ON r.target_entity = 'ASSET'
"""
```

- [ ] **Paso 5: Ampliar el tipo del frontend**

En `monitor-app/frontend/lib/types.ts`, `RequirementOption` suma el campo. Sin esto la
Task 5 lee `r.alcance` y `tsc` falla:

```ts
export interface Alcance { alcanzadas: number; universo: number }

// …dentro de RequirementOption:
  alcance: Alcance
```

Los mocks de `RequirementOption` que ya existen en los tests del frontend van a fallar por
campo faltante: agregarles `alcance` es mecánico y va en este mismo commit.

- [ ] **Paso 6: Verificar el SQL contra la base real**

Los tests con `AsyncMock` **no** detectan SQL inválido — ya pasaron dos bugs reales por ahí
en este proyecto. Verificar con el MCP de Supabase (proyecto `viclzoftiudkepqnhekv`, **sólo
lectura**) que la consulta compila y que `MANTENCION_FRIO` da `20 de 118`.

- [ ] **Paso 7: Correr las dos suites y comitear**

```bash
venv/bin/python -m pytest tests/ -q          # 654 + 1
cd ../../frontend && npx tsc --noEmit        # el tipo nuevo tiene que cerrar
git add app/routers/requirements.py app/schemas/compliance.py tests/test_requirements.py
git commit -m "feat(certificacion): el catalogo dice a cuantas entidades alcanza cada regla"
```

---

## Task 5: Condiciones como tabla

**Archivos:**
- Crear: `app/dashboard/admin/settings/condiciones-tabla.tsx` y su test
- Modificar: `app/dashboard/admin/settings/dominios.ts` (la sección `conditions` apunta al nuevo)
- Borrar: `app/dashboard/admin/settings/condiciones-tab.tsx` **en el mismo commit que lo deja sin llamador**

**Interfaces:**
- Consume: `EncabezadoOrdenable`, `useOrden`, `ChipsDeFiltro` de las Tasks 1-2; `alcance` de la Task 4.
- Produce: `CondicionesTabla`, que la Task 6 envuelve con el panel.

- [ ] **Paso 1: Escribir el test que falla**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listRequirements: vi.fn() },
}))
import { complianceApi } from '@/lib/api/compliance'
import { CondicionesTabla } from './condiciones-tabla'

const REQS = [
  { id: 'r1', requirement_code: 'MANTENCION_FRIO', name: 'Mantención Cámara de Frío',
    target_entity: 'ASSET', is_active: true,
    applies_to_fleet_service_type_ids: ['t1'], applies_to_management_types: null,
    alcance: { alcanzadas: 20, universo: 118 } },
  { id: 'r2', requirement_code: 'REVISION_TECNICA', name: 'Revisión Técnica',
    target_entity: 'ASSET', is_active: true,
    applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
    alcance: { alcanzadas: 118, universo: 118 } },
]

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CondicionesTabla />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.listRequirements).mockReset()
  vi.mocked(complianceApi.listRequirements).mockResolvedValue(REQS)
})

describe('CondicionesTabla', () => {
  // El cambio central: la regla se ENUNCIA. Antes eran 10 casillas por
  // requisito, dibujadas aunque 35 de 37 no tuvieran ninguna marcada.
  it('enuncia la regla en una frase, sin casillas', async () => {
    montar()
    await waitFor(() => expect(screen.getByText(/sólo/i)).toBeInTheDocument())
    expect(screen.getByText(/todos los vehículos/i)).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('dice a cuantas entidades alcanza', async () => {
    montar()
    await waitFor(() => expect(screen.getByText(/20 de 118/)).toBeInTheDocument())
  })

  it('la entidad es una columna, no un encabezado de grupo', async () => {
    montar()
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /entidad/i })).toBeInTheDocument())
  })

  it('ordena por documento al hacer clic en su encabezado', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /documento/i }))
    const filas = screen.getAllByRole('row').slice(1)
    expect(filas[0]).toHaveTextContent('Mantención Cámara de Frío')
  })

  it('el chip de con condicion filtra', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Revisión Técnica')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /con condición/i }))
    expect(screen.queryByText('Revisión Técnica')).not.toBeInTheDocument()
    expect(screen.getByText('Mantención Cámara de Frío')).toBeInTheDocument()
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run app/dashboard/admin/settings/condiciones-tabla.test.tsx`
Esperado: FALLA con "Failed to resolve import './condiciones-tabla'".

- [ ] **Paso 3: Escribir la frase de la regla**

Es la pieza que decide si la tabla informa. Va en su propio módulo porque la Task 6 la
reusa en el panel:

```ts
// app/dashboard/admin/settings/frase-de-la-regla.ts
import type { RequirementOption } from '@/lib/types'

const UNIVERSO: Record<string, string> = {
  ASSET:   'Todos los vehículos',
  CARRIER: 'Todas las empresas',
  DRIVER:  'Todos los conductores',
}

/** La regla, en una frase que se lee de un vistazo.
 *
 *  Se DERIVA de la regla, nunca se escribe al lado: si el texto se redactara a
 *  mano quedarian dos fuentes de verdad de la misma condicion, que es el
 *  defecto que costo el critico del Tramo 3. Cuando se agregue una tercera
 *  dimension de condicion, se agrega una rama aca y la tabla no se toca. */
export function fraseDeLaRegla(r: RequirementOption, etiquetaSubtipo: (id: string) => string): string {
  const subtipos = r.applies_to_fleet_service_type_ids
  const gestiones = r.applies_to_management_types

  if (subtipos?.length) {
    return subtipos.length === 1
      ? `Sólo ${etiquetaSubtipo(subtipos[0])}`
      : `Sólo ${subtipos.length} subtipos`
  }
  if (gestiones?.length) {
    return gestiones.length === 1
      ? `Sólo ${gestiones[0] === 'TRACTOREO' ? 'Tractoreo' : 'Equipo Completo'}`
      : 'Tractoreo y Equipo Completo'
  }
  return UNIVERSO[r.target_entity] ?? 'Todas'
}
```

- [ ] **Paso 4: Escribir la tabla**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { taxonomiesApi } from '@/lib/api/config'
import { EncabezadoOrdenable } from '@/components/ui/tabla/EncabezadoOrdenable'
import { useOrden } from '@/components/ui/tabla/useOrden'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { fraseDeLaRegla } from './frase-de-la-regla'
import { LoadState } from './shared'

const ENTIDAD: Record<string, { texto: string; clase: string }> = {
  ASSET:   { texto: 'VEHÍCULO',  clase: 'bg-blue-50 text-blue-700' },
  CARRIER: { texto: 'EMPRESA',   clase: 'bg-purple-50 text-purple-700' },
  DRIVER:  { texto: 'CONDUCTOR', clase: 'bg-emerald-50 text-emerald-700' },
}

const FILTROS = [
  { id: 'con-condicion', etiqueta: 'Con condición' },
  { id: 'sin-vigencia',  etiqueta: 'Sin vigencia' },
]

export function CondicionesTabla() {
  const req = useQuery({ queryKey: ['compliance-requirements'], queryFn: complianceApi.listRequirements })
  const tax = useQuery({ queryKey: ['taxonomias', 'FLEET_SERVICE_TYPE'],
                         queryFn: () => taxonomiesApi.list('FLEET_SERVICE_TYPE') })
  const { orden, ordenarPor, comparar } = useOrden({ columna: 'entidad', direccion: 'asc' })
  const [filtro, setFiltro] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const etiquetaSubtipo = useMemo(() => {
    const mapa = new Map((tax.data ?? []).map(s => [s.id, s.label]))
    // Un subtipo desactivado desaparece del catalogo pero su id sigue en la
    // regla: sin este respaldo la frase diria "Solo undefined".
    return (id: string) => mapa.get(id) ?? 'un subtipo dado de baja'
  }, [tax.data])

  const filas = useMemo(() => {
    let f = req.data ?? []
    if (filtro === 'con-condicion') {
      f = f.filter(r => r.applies_to_fleet_service_type_ids?.length || r.applies_to_management_types?.length)
    }
    if (filtro === 'sin-vigencia') f = f.filter(r => !r.is_active)
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase()
      f = f.filter(r => `${r.name} ${r.requirement_code}`.toLowerCase().includes(q))
    }
    return comparar(f, r => (orden?.columna === 'documento' ? r.name : r.target_entity))
  }, [req.data, filtro, busqueda, orden, comparar])

  if (req.isPending || req.isError) {
    return <LoadState loading={req.isPending} error={req.isError ? 'No se pudo cargar el catálogo' : null}
                      onRetry={() => req.refetch()} />
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Documento o código…"
          aria-label="Buscar documento"
          className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white w-56
                     focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <ChipsDeFiltro opciones={FILTROS} activo={filtro} onElegir={setFiltro} />
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50/60 border-y border-border">
            <EncabezadoOrdenable columna="entidad" orden={orden} onOrdenar={ordenarPor}>Entidad</EncabezadoOrdenable>
            <EncabezadoOrdenable columna="documento" orden={orden} onOrdenar={ordenarPor}>Documento</EncabezadoOrdenable>
            <th scope="col" className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-gray-400">Se exige a</th>
            <th scope="col" className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-gray-400">Vigencia</th>
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {filas.map(r => {
            const e = ENTIDAD[r.target_entity]
            return (
              <tr key={r.id} className="border-b border-border/70 hover:bg-gray-50/60">
                <td className="px-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${e.clase}`}>{e.texto}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-xs font-semibold text-text-primary truncate">{r.name}</div>
                  <div className="text-[11px] text-gray-400 truncate">{r.requirement_code}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-xs text-gray-700">{fraseDeLaRegla(r, etiquetaSubtipo)}</div>
                  <div className="text-[11px] text-gray-400 tabular-nums">
                    {r.alcance.alcanzadas} de {r.alcance.universo}
                  </div>
                </td>
                <td className={`px-3 py-2.5 text-xs ${r.is_active ? 'text-resuelto' : 'text-gray-400'}`}>
                  {r.is_active ? 'Vigente' : 'Sin vigencia'}
                </td>
                <td className="pr-2">
                  <button type="button" aria-label={`Editar ${r.name}`}
                          className="text-gray-300 hover:text-gray-500 focus-visible:outline-none
                                     focus-visible:ring-2 focus-visible:ring-accent/40 rounded">
                    <ChevronRight size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

La columna "Revisado" del spec llega con el registro de revisión (spec 1, Plan 2): hasta
entonces la tabla tiene cuatro columnas y no una quinta vacía, que sería una promesa sin
respaldo.

- [ ] **Paso 5: Conectar en el registro y borrar la pantalla vieja**

En `dominios.ts`, la sección `conditions` pasa a `Panel: CondicionesTabla`. Antes de borrar
`condiciones-tab.tsx`, confirmar que quedó sin llamador:

```bash
grep -rn "CondicionesDocumentosTab" app/ components/ --include="*.tsx" --include="*.ts"
```

- [ ] **Paso 6: Correr las suites y comitear**

```bash
npx vitest run && npx tsc --noEmit && npm run build
git add app/dashboard/admin/settings/
git commit -m "feat(config): las condiciones se leen como tabla, no como 37 formularios"
```

---

## Task 6: El panel de una condición

**Archivos:**
- Crear: `app/dashboard/admin/settings/CondicionPanel.tsx` y su test
- Modificar: `app/dashboard/admin/settings/condiciones-tabla.tsx` (abre el panel por URL)

**Interfaces:**
- Consume: `PanelLateral` (Task 3), `fraseDeLaRegla` (Task 5), `requirementsApi.patchConditions` / `recalcPreview` / `recalc` (ya existen del Tramo 3).
- El panel se abre con `?doc=<requirement_code>` sobre la URL de la sección.

- [ ] **Paso 1: Escribir el test que falla**

```tsx
describe('CondicionPanel', () => {
  // El cambio que elimina las 167 casillas: primero la pregunta, y el selector
  // de subtipos aparece SOLO si la respuesta lo necesita. 35 de 37 reglas se
  // resuelven sin ver un subtipo.
  it('pregunta a todos o algunos, sin mostrar subtipos', () => {
    montarPanel({ ...REQ, applies_to_fleet_service_type_ids: null })
    expect(screen.getByRole('radio', { name: /a todos los vehículos/i })).toBeChecked()
    expect(screen.queryByText(/furgón congelado/i)).not.toBeInTheDocument()
  })

  it('elegir "sólo algunos" revela el selector', () => {
    montarPanel({ ...REQ, applies_to_fleet_service_type_ids: null })
    fireEvent.click(screen.getByRole('radio', { name: /sólo a algunos/i }))
    expect(screen.getByText(/agregar/i)).toBeInTheDocument()
  })

  it('una regla que ya tiene subtipos abre en "sólo algunos"', () => {
    montarPanel({ ...REQ, applies_to_fleet_service_type_ids: ['t1'] })
    expect(screen.getByRole('radio', { name: /sólo a algunos/i })).toBeChecked()
  })

  it('el panel se cierra con Escape', () => {
    const onCerrar = vi.fn()
    montarPanel(REQ, onCerrar)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run app/dashboard/admin/settings/CondicionPanel.test.tsx`
Esperado: FALLA con "Failed to resolve import './CondicionPanel'".

- [ ] **Paso 3: Escribir el panel**

El corazón es el par de opciones y la revelación condicional. Ése es el cambio que elimina
las 167 casillas:

```tsx
'use client'

import { useState } from 'react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import type { RequirementOption, TaxonomyRow } from '@/lib/types'

const UNIVERSO: Record<string, string> = {
  ASSET:   'A todos los vehiculos',
  CARRIER: 'A todas las empresas',
  DRIVER:  'A todos los conductores',
}

export function CondicionPanel({
  requisito, subtipos, onCerrar, onGuardar,
}: {
  requisito: RequirementOption
  subtipos:  TaxonomyRow[]
  onCerrar:  () => void
  onGuardar: (ids: string[]) => void
}) {
  const inicial = requisito.applies_to_fleet_service_type_ids ?? []
  // El estado es la RESPUESTA a la pregunta, no las diez casillas. Con "todos"
  // no hay subtipos que mostrar, y ese es el caso de 35 de 37 reglas.
  const [alcance, setAlcance] = useState<'todos' | 'algunos'>(inicial.length ? 'algunos' : 'todos')
  const [elegidos, setElegidos] = useState<string[]>(inicial)

  return (
    <PanelLateral
      titulo={requisito.name}
      onCerrar={onCerrar}
      pie={
        <button
          type="button"
          onClick={() => onGuardar(alcance === 'todos' ? [] : elegidos)}
          className="rounded-lg bg-accion px-3 py-1.5 text-xs font-semibold text-white
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Guardar
        </button>
      }
    >
      <fieldset>
        <legend className="text-xs text-gray-700">
          A quien se le exige?
        </legend>

        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="radio" name="alcance" checked={alcance === 'todos'}
                 onChange={() => setAlcance('todos')} />
          {UNIVERSO[requisito.target_entity]}
          <span className="text-gray-400 tabular-nums">- {requisito.alcance.universo}</span>
        </label>

        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="radio" name="alcance" checked={alcance === 'algunos'}
                 onChange={() => setAlcance('algunos')} />
          Solo a algunos subtipos
        </label>

        {/* El selector aparece SOLO si hace falta. Dibujarlo siempre es lo que
            hacia que 35 reglas sin condicion mostraran diez casillas vacias. */}
        {alcance === 'algunos' && (
          <div className="mt-2 ml-5 rounded-lg border border-border p-2.5">
            {subtipos.map(s => (
              <label key={s.id} className="flex items-center gap-2 text-xs py-0.5">
                <input
                  type="checkbox"
                  checked={elegidos.includes(s.id)}
                  onChange={() => setElegidos(prev =>
                    prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                />
                {s.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </PanelLateral>
  )
}
```

El texto visible va con tildes; se omiten arriba solo para que el bloque no dependa de la
codificacion del editor. La vista previa del recalculo y **Confirmar sin cambios** se agregan
al pie reusando `requirementsApi.recalcPreview` y `recalc`, que ya existen del Tramo 3 con su
aclaracion de que no se borra nada.

- [ ] **Paso 4: Abrir el panel desde la URL**

En `condiciones-tabla.tsx`, el chevron navega con `router.replace` agregando
`&doc=<requirement_code>`; el panel se dibuja cuando ese parámetro existe. Cerrar lo quita.
Es el mismo patrón que usan los viajes, y hace que editar una regla sea enlazable.

- [ ] **Paso 5: Correr las suites y comitear**

```bash
npx vitest run && npx tsc --noEmit && npm run build
git add app/dashboard/admin/settings/
git commit -m "feat(config): el panel pregunta a todos o algunos, y abre por URL"
```

---

## Task 7: Estados como tabla y panel

**Archivos:**
- Crear: `app/dashboard/admin/settings/estados-tabla.tsx`, `app/dashboard/admin/settings/EstadoPanel.tsx` y sus tests
- Modificar: `dominios.ts` (la sección `tms-statuses` apunta al nuevo)
- Modificar: `estados-tabs.tsx` — se borra **sólo** `EstadosTmsTab`; `TaxonomyTab` y las
  demás secciones **no se tocan**.

**Interfaces:**
- Consume: `EncabezadoOrdenable`, `useOrden`, `ChipsDeFiltro`, `PanelLateral`.

- [ ] **Paso 1: Escribir el test que falla**

```tsx
describe('EstadosTabla', () => {
  // 250 botones de color eran las 8 pastillas repetidas en 25 filas. La
  // pastilla renderizada YA es la vista previa; el color se elige en el panel.
  it('no dibuja la paleta en la lista', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    expect(screen.queryAllByRole('button', { name: /color/i })).toHaveLength(0)
  })

  // Si alguien renombra el nombre visible, el crudo es lo unico que permite
  // reconocer de que estado se trata.
  it('conserva visible el nombre crudo del TMS', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('ASIGNADO')).toBeInTheDocument())
  })

  it('los chips filtran por columna del tablero', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /en local/i }))
    expect(screen.queryByText('Asignado')).not.toBeInTheDocument()
  })
})
```

- [ ] **Paso 2: Correr y confirmar que falla**

`npx vitest run app/dashboard/admin/settings/estados-tabla.test.tsx`
Esperado: FALLA con "Failed to resolve import './estados-tabla'".

- [ ] **Paso 3: Escribir la tabla y el panel**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { configApi } from '@/lib/api/config'
import { EncabezadoOrdenable } from '@/components/ui/tabla/EncabezadoOrdenable'
import { useOrden } from '@/components/ui/tabla/useOrden'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { LoadState } from './shared'

// Las columnas del tablero salen del propio dato, no de una lista escrita a
// mano: si manana se agrega una columna, el chip aparece solo.
function columnasDe(filas: { group: string | null }[]) {
  const cuenta = new Map<string, number>()
  for (const f of filas) {
    if (!f.group) continue
    cuenta.set(f.group, (cuenta.get(f.group) ?? 0) + 1)
  }
  return [...cuenta].map(([id, n]) => ({ id, etiqueta: id, n }))
}

export function EstadosTabla() {
  const q = useQuery({ queryKey: ['trip-statuses'], queryFn: configApi.statuses })
  const { orden, ordenarPor, comparar } = useOrden({ columna: 'orden', direccion: 'asc' })
  const [columna, setColumna] = useState<string | null>(null)

  const filas = useMemo(() => {
    const todas = q.data ?? []
    const f = columna ? todas.filter(s => s.group === columna) : todas
    return comparar(f, s => (orden?.columna === 'visible' ? s.label : s.sort_order))
  }, [q.data, columna, orden, comparar])

  if (q.isPending || q.isError) {
    return <LoadState loading={q.isPending} error={q.isError ? 'No se pudieron cargar los estados' : null}
                      onRetry={() => q.refetch()} />
  }

  return (
    <div>
      <div className="pb-3">
        <ChipsDeFiltro opciones={columnasDe(q.data ?? [])} activo={columna} onElegir={setColumna} />
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50/60 border-y border-border">
            <EncabezadoOrdenable columna="visible" orden={orden} onOrdenar={ordenarPor}>Como se ve</EncabezadoOrdenable>
            <th scope="col" className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-gray-400">Nombre en el TMS</th>
            <th scope="col" className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.08em] text-gray-400">Columna</th>
            <EncabezadoOrdenable columna="orden" orden={orden} onOrdenar={ordenarPor}>Orden</EncabezadoOrdenable>
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {filas.map(s => (
            <tr key={s.id} className="border-b border-border/70 hover:bg-gray-50/60">
              <td className="px-3 py-2.5">
                {/* La pastilla renderizada YA es la vista previa: por eso la
                    lista no necesita ni una sola pastilla de color. */}
                <span className="rounded px-2 py-0.5 text-[11px]"
                      style={{ backgroundColor: s.bg_color, color: s.text_color }}>
                  {s.label}
                </span>
              </td>
              {/* El nombre crudo se conserva: si alguien cambia el visible, es
                  lo unico que permite reconocer de que estado se trata. */}
              <td className="px-3 py-2.5 text-[11px] text-gray-400 font-mono">{s.id}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700">{s.group ?? '-'}</td>
              <td className="px-3 py-2.5 text-xs text-gray-400 tabular-nums">{s.sort_order}</td>
              <td className="pr-2">
                <button type="button" aria-label={`Editar ${s.label}`}
                        className="text-gray-300 hover:text-gray-500 focus-visible:outline-none
                                   focus-visible:ring-2 focus-visible:ring-accent/40 rounded">
                  <ChevronRight size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

El panel (`EstadoPanel.tsx`) usa `PanelLateral` con tres campos: nombre visible, **una**
muestra de color que abre la paleta en un popover, y la columna del tablero. El nombre del
TMS se muestra pero no se edita: lo define el TMS.

- [ ] **Paso 4: Conectar y confirmar que no quedó código muerto**

```bash
grep -rn "EstadosTmsTab" app/ components/ --include="*.tsx" --include="*.ts"
```
Esperado: sólo el import nuevo, o ninguno.

- [ ] **Paso 5: Correr las suites y comitear**

```bash
npx vitest run && npx tsc --noEmit && npm run build
git add app/dashboard/admin/settings/
git commit -m "feat(config): los estados del tablero se leen; el color se elige en el panel"
```

---

## Task 8: Verificación de conjunto

- [ ] **Paso 1: Las dos suites**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q
cd ../../frontend && npx vitest run && npx tsc --noEmit && npm run build
```
Ninguna regresión sobre 654 backend / 917 frontend.

- [ ] **Paso 2: Medir que el problema se resolvió**

El spec parte de números medidos; la verificación tiene que medir lo mismo. Con la rama
desplegada, en la consola del navegador sobre cada sección:

```js
const p = document.querySelector('[role="tabpanel"]')
console.log({
  alto: Math.round(p.getBoundingClientRect().height),
  controles: p.querySelectorAll('input,select,button').length,
  casillas: p.querySelectorAll('input[type=checkbox]').length,
})
```

Esperado — Condiciones: de **5.849 px / 167 casillas** a menos de 2.000 px y **0 casillas**.
Estados: de **300 controles** a menos de 40 y **0 botones de color**.

- [ ] **Paso 3: Click-through en staging con Playwright**

**No saltarlo.** En este módulo, entrar a la pantalla encontró lo que 917 tests no podían:
el interior entero dando 404 por `params`, y dos secciones muertas por un dominio faltante.

Probar: ordenar por cada columna · filtrar con un chip y apagarlo · abrir una regla desde el
chevron y comprobar que la URL la nombra · recargar esa URL y ver que el panel abre solo ·
`Escape` cierra y el foco vuelve a la fila · elegir "sólo algunos" y ver aparecer el
selector · el color en el panel de Estados.

- [ ] **Paso 4: Revisión de rama completa**

Correr `/code-review` sobre la rama, no sólo por tarea. En el Tramo 1 las nueve revisiones
por tarea pasaron limpias y la de conjunto encontró tres bugs críticos; en el Tramo 3, un
crítico que ninguna revisión acotada podía ver.

- [ ] **Paso 5: Actualizar el AGENTLOG**

Regla 3 de `CLAUDE.md`: qué se hizo, próximo paso exacto, decisiones de arquitectura.

---

## Fuera de alcance

- **Migrar las otras tres secciones** (Alertas de vencimiento, Umbrales, Rangos de
  temperatura). Rangos mide 243 px y funciona: migrarla sería trabajo sin problema que
  resolver. Se migran cuando duelan o cuando se las toque por otro motivo.
- **`TaxonomyTab`**, que usan cinco secciones de tres dominios. Este plan sólo reemplaza
  `EstadosTmsTab`.
- **La excepción por caso** y **editar la regla desde un caso** en Certificación: el estándar
  es que el caso explique y derive, y la regla se edite en un solo lugar. Este plan
  construye ese lugar.
- **`shared.tsx` vive dentro del módulo de Configuración** y lo importan Tarifario,
  Requisitos y Ubicaciones. Ese acoplamiento quedó a la vista al renombrar la ruta y merece
  su propia decisión; no se resuelve acá.
