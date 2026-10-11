# Cierre › Viajes en tres pestañas y filtro de cliente coherente — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La pestaña Viajes del Cierre pasa de 7 secciones apiladas a 3 pestañas (Por resolver · En seguimiento ·
Resueltos). El filtro de cliente del reporte ofrece solo a los clientes que operaron ese día y se aplica a todas las
cifras por igual.

**Architecture:**
- **Viajes, solo frontend.** Una tabla de presentación por grupo del backend (tipada `Record<GrupoDelCierre, …>`), en `lib/cierre/gruposDeViajes.ts`, decide
  pestaña, "por qué está aquí" y si bloquea la firma. `PasoViajesSection` se arma desde esa tabla. La API de Viajes no
  cambia.
- **Filtro de cliente, en el backend.** Una sola función, `_clientes_de_la_fila`, decide a qué clientes pertenece cada
  fila (equipo, conductor o faltante de dotación). El reporte devuelve `clients` del día, y la pantalla arma la lista
  con eso.

**Tech Stack:** FastAPI + asyncpg (pytest), Next.js + React Query v5 + Tailwind (vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-10-11-cierre-viajes-por-estado-y-filtro-de-cliente-design.md`

## Global Constraints

- **Nombres:** las claves nuevas de la API van en inglés (`clients`, `client_name`, `assigned`). Código interno y UI en
  español neutral, sin voseo.
- **Estilo:** cero emojis, solo `lucide-react`. No hay tamaños de letra ni colores nuevos: se reutilizan `text-etiqueta`,
  `text-xs`, `TEXTO_APOYO`, `TEXTO_CUERPO`, `bg-accent`, `border-accion` y lo que ya usan `PasoViajesSection` y la
  página del Cierre.
- **Componentes de la app:**
  - pestañas con `role="tablist"`/`role="tab"`/`aria-selected`, como la página del Cierre;
  - chips con `ChipsDeFiltro`;
  - estados con `Estado`;
  - cifras con `Cifra`.
- **Sin cambios de base:** no hay migraciones ni se toca dbt/Mage. `SQL_GRUPOS_CIERRE` y `bloquean` no cambian.
- **Pruebas por tarea:** solo el área tocada. `venv/bin/python -m pytest tests/test_status_report.py
  tests/test_reporte_de_estatus_integracion.py -q` en `monitor-app/backend/api`, y `npx vitest run <archivos>` más
  `npx tsc --noEmit` en `monitor-app/frontend`. Sin suite completa del backend: `status_report.py` solo lo importa
  `main.py`. Sin `npm run build`, que lo hace el deploy. Vitest completo, una vez, al final (Task 5).

## Review Focus

1. **Cambiar de pestaña con viajes seleccionados.** La selección se conserva y la barra de lote sigue a la vista con su
   cantidad. Volver a "Por resolver" muestra las mismas casillas marcadas. Test en Task 2.
2. **URL con una pestaña que no existe** (`?viajes=xyz`, o una vieja). Cae en la pestaña inicial, sin pantalla en blanco.
   Test en Task 2.
3. **Declarar el último viaje por resolver.** La pestaña no salta sola: queda en "Por resolver" con "Nada por resolver:
   puedes firmar el día". Test en Task 2.
4. **Nombres de cliente con otra capitalización** en el directorio y en el viaje ("WALMART" y "Walmart"). Pertenecen al
   mismo cliente. Test en Task 3.
5. **Frontend nuevo con backend viejo** (sin `clients`). La lista muestra solo "Todos los clientes", sin romperse. Test
   en Task 4.

## Rulings tomados al escribir el plan

- **La URL del Cierre** va en inglés: `?date=`, `?tab=fleet|trips|pending|report` y `?trips=to_resolve|tracking|resolved`.
  Un solo módulo (`lib/navegacion/cierre.ts`) la lee y la escribe, y lee también la forma vieja en español. Los
  `?fecha=` de la API del backend quedan fuera (deuda aparte).

- **Pestaña inicial.** Si la URL no trae `?viajes=`, se abre "Por resolver" cuando tiene viajes, y si no, "En
  seguimiento". La elección queda en la URL solo cuando la persona cambia de pestaña, igual que `?tab=`.
- **La selección en lote** existe solo en "Por resolver" y no se limpia al cambiar de pestaña.
- **La cifra grande** pasa a decir "bloquean la firma del día", con el mismo `bloquean` de la API.
- **Los clientes del día** son los que tienen al menos un equipo de Tractoreo o Equipo Completo con carga. Un equipo sin
  tipo no los hace aparecer.
- **El faltante de dotación** se filtra con la misma regla que un equipo sin carga: por los clientes de su empresa.
- **El directorio de clientes** (`shippersApi.list()`) deja de pedirse en la página del Cierre: solo lo usaba el filtro.
- **La tabla de grupos** va anotada como `Record<GrupoDelCierre, Presentacion>` y no con `satisfies`, como decía el
  spec. Da la misma garantía (un grupo nuevo sin clasificar no compila) y deja que todo `porQue` tenga una sola firma.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `monitor-app/frontend/lib/cierre/gruposDeViajes.ts` (+ `.test.ts`) (nuevo) | Qué pestaña, qué "por qué" y si bloquea, por grupo; filas de una pestaña ordenadas; días atrás; patentes repetidas |
| `monitor-app/frontend/components/dashboard/sections/PasoViajesSection.tsx` (reescribir) | Pestañas, chips, buscador, barra de lote y una tabla con columnas según la pestaña |
| `monitor-app/frontend/components/dashboard/sections/PasoViajesSection.test.tsx` (reescribir) | Comportamiento de Viajes |
| `monitor-app/frontend/app/dashboard/operations/closures/page.tsx` (modificar) | `?trips=` en la URL, `fecha` a Viajes, "Reintentar" en el error, sin `shippersQuery` |
| `monitor-app/backend/api/app/routers/status_report.py` (modificar) | `_SQL_CLIENTES_POR_EMPRESA`, `_clientes_de_la_fila`, `_filter_by_client` nuevo, `_clientes_del_dia`, `clients` |
| `monitor-app/backend/api/tests/test_status_report.py` (modificar) | La regla de pertenencia y `clients` |
| `monitor-app/backend/api/tests/test_reporte_de_estatus_integracion.py` (modificar) | La consulta de clientes por empresa contra Postgres |
| `monitor-app/frontend/lib/types.ts` (modificar) | `StatusReport.clients?` |
| `monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx` (+ test) (modificar) | La lista de clientes desde `clients`, con la opción "Todos los clientes" |

---

### Task 1: La definición de los grupos de Viajes

**Files:**
- Create: `monitor-app/frontend/lib/cierre/gruposDeViajes.ts`
- Test: `monitor-app/frontend/lib/cierre/gruposDeViajes.test.ts`

**Interfaces:**
- Consumes: `GrupoDelCierre`, `ViajeDelCierre` (`lib/types.ts`, existentes).
- Produces:
  - **Tipos:** `PestanaDeViajes = 'to_resolve' | 'tracking' | 'resolved'` (valores en inglés: viajan en la URL) y
    `FilaDeViaje = ViajeDelCierre & { grupo: GrupoDelCierre }`.
  - **`PESTANAS_DE_VIAJES`:** `{ id, etiqueta, bajada, vacio }[]`.
  - **`GRUPOS_DE_VIAJES`:**
    `Record<GrupoDelCierre, { pestana: PestanaDeViajes; chip: string; bloqueaLaFirma: boolean; porQue: (v: ViajeDelCierre, fecha: string) => string }>`.
  - **Funciones:**
    - `diasAtras(planning: string, fecha: string): number`;
    - `filasDePestana(grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>, pestana: PestanaDeViajes): FilaDeViaje[]`;
    - `pestanaInicial(grupos): PestanaDeViajes`;
    - `viajesPorPatente(filas: FilaDeViaje[]): Map<string, string[]>`;
    - `esPestanaDeViajes(v: string | null): v is PestanaDeViajes`.

- [ ] **Step 1: Escribir el test que falla**

`lib/cierre/gruposDeViajes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ViajeDelCierre } from '@/lib/types'
import {
  GRUPOS_DE_VIAJES, diasAtras, esPestanaDeViajes, filasDePestana, pestanaInicial, viajesPorPatente,
} from './gruposDeViajes'

const viaje = (id: string, nro: string, extra: Partial<ViajeDelCierre> = {}): ViajeDelCierre => ({
  trip_id: id, planning_date: '2026-10-10', client_name: 'Sodimac', source_system: 'sodimac',
  source_system_trip_id: nro, trip_status: 'Publicada', tractor_plate: null, driver_name: null,
  carrier_name: null, origin: null, destinations: [], dias_sin_novedad: 1, unassigned_reason_id: null,
  unassigned_reason_label: null, ...extra,
})

// Los grupos del 10/10, tal como los mandó la API.
const GRUPOS = {
  hoy: [viaje('t1', '889281')],
  rezago: [],
  oferta_sin_declarar: [],
  abandonado: [],
  en_curso: [
    viaje('t2', '2070673', { planning_date: '2026-10-09', trip_status: 'RETORNANDO', tractor_plate: 'FJHV95' }),
    viaje('t3', '2069959', { planning_date: '2026-10-08', trip_status: 'RETORNANDO', tractor_plate: 'GHYX72' }),
  ],
  pendiente_cierre_tms: [
    viaje('t4', '885613', { planning_date: '2026-10-07', tractor_plate: 'PYST91' }),
    viaje('t5', '881496', { planning_date: '2026-10-02', tractor_plate: 'PYST91' }),
    viaje('t6', '878052', { planning_date: '2026-09-29', tractor_plate: 'JF8307' }),
  ],
  con_motivo: [],
}

describe('gruposDeViajes', () => {
  it('cada grupo del backend cae en una de las tres pestañas', () => {
    expect(Object.fromEntries(Object.entries(GRUPOS_DE_VIAJES).map(([g, p]) => [g, p.pestana]))).toEqual({
      hoy: 'to_resolve', rezago: 'to_resolve', oferta_sin_declarar: 'to_resolve', abandonado: 'to_resolve',
      en_curso: 'tracking', pendiente_cierre_tms: 'tracking', con_motivo: 'resolved',
    })
  })

  it('solo hoy y rezago bloquean la firma, igual que `bloquean` de la API', () => {
    const bloquean = Object.entries(GRUPOS_DE_VIAJES).filter(([, p]) => p.bloqueaLaFirma).map(([g]) => g)
    expect(bloquean.sort()).toEqual(['hoy', 'rezago'])
  })

  it('el "por qué" dice cuántos días tiene el rezago', () => {
    const v = viaje('t9', '1', { planning_date: '2026-10-07' })
    expect(GRUPOS_DE_VIAJES.rezago.porQue(v, '2026-10-10')).toBe('Rezago · 3 días')
    expect(GRUPOS_DE_VIAJES.rezago.porQue({ ...v, planning_date: '2026-10-09' }, '2026-10-10')).toBe('Rezago · 1 día')
    expect(GRUPOS_DE_VIAJES.hoy.porQue(v, '2026-10-10')).toBe('Del día')
    expect(GRUPOS_DE_VIAJES.en_curso.porQue({ ...v, trip_status: 'RETORNANDO' }, '2026-10-10')).toBe('En ruta · RETORNANDO')
    expect(GRUPOS_DE_VIAJES.pendiente_cierre_tms.porQue(v, '2026-10-10')).toBe('Espera cierre del TMS')
  })

  it('días atrás cuenta días de calendario, sin correrse por el huso horario', () => {
    expect(diasAtras('2026-09-29', '2026-10-10')).toBe(11)
    expect(diasAtras('2026-10-10', '2026-10-10')).toBe(0)
  })

  it('las filas de una pestaña juntan sus grupos, de la más antigua a la más nueva', () => {
    const filas = filasDePestana(GRUPOS, 'tracking')
    expect(filas.map(f => f.source_system_trip_id)).toEqual(['878052', '881496', '885613', '2069959', '2070673'])
    expect(filas[0].grupo).toBe('pendiente_cierre_tms')
  })

  it('a igual fecha, ordena por Nº de viaje', () => {
    const filas = filasDePestana({ hoy: [viaje('a', '20'), viaje('b', '10')] }, 'to_resolve')
    expect(filas.map(f => f.source_system_trip_id)).toEqual(['10', '20'])
  })

  it('un grupo que todavía no llega del backend no rompe nada', () => {
    expect(filasDePestana({ hoy: [viaje('t1', '1')] }, 'tracking')).toEqual([])
  })

  it('se abre en Por resolver si tiene viajes, y si no en En seguimiento', () => {
    expect(pestanaInicial(GRUPOS)).toBe('to_resolve')
    expect(pestanaInicial({ ...GRUPOS, hoy: [] })).toBe('tracking')
  })

  it('una patente con más de un viaje en la pestaña se marca con sus números', () => {
    const repetidas = viajesPorPatente(filasDePestana(GRUPOS, 'tracking'))
    expect([...repetidas.entries()]).toEqual([['PYST91', ['881496', '885613']]])
  })

  it('reconoce solo las pestañas que existen', () => {
    expect(esPestanaDeViajes('resolved')).toBe(true)
    expect(esPestanaDeViajes('xyz')).toBe(false)
    expect(esPestanaDeViajes(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run lib/cierre/gruposDeViajes.test.ts`
Expected: FAIL con "Failed to resolve import './gruposDeViajes'".

- [ ] **Step 3: Implementar**

`lib/cierre/gruposDeViajes.ts`:

```ts
import type { GrupoDelCierre, ViajeDelCierre } from '@/lib/types'

/** Las tres preguntas de la pestaña Viajes del Cierre (spec 2026-10-11): qué falta
 *  declarar, qué sigue vivo sin depender del cierre, y qué ya se declaró. */
export type PestanaDeViajes = 'to_resolve' | 'tracking' | 'resolved'

export type FilaDeViaje = ViajeDelCierre & { grupo: GrupoDelCierre }

export const PESTANAS_DE_VIAJES: { id: PestanaDeViajes; etiqueta: string; bajada: string; vacio: string }[] = [
  {
    id: 'to_resolve', etiqueta: 'Por resolver',
    bajada: 'Viajes que no se tomaron: declara por qué.',
    vacio: 'Nada por resolver: puedes firmar el día',
  },
  {
    id: 'tracking', etiqueta: 'En seguimiento',
    bajada: 'No dependen del cierre: se miran. Los que esperan el cierre del TMS los sigue Facturación.',
    vacio: 'Ningún viaje en seguimiento',
  },
  {
    id: 'resolved', etiqueta: 'Resueltos',
    bajada: 'Declarados como no asignados por WebCarga. Se pueden deshacer.',
    vacio: 'Todavía no se declaró ningún viaje',
  },
]

type Presentacion = {
  pestana: PestanaDeViajes
  /** La etiqueta corta del filtro de chips dentro de la pestaña. */
  chip: string
  /** Lo mismo que cuenta `bloquean` en la API: hoy y rezago. */
  bloqueaLaFirma: boolean
  /** "Por qué está aquí" (Por resolver), "Situación" (En seguimiento) o el motivo (Resueltos). */
  porQue: (v: ViajeDelCierre, fecha: string) => string
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Días de calendario entre la planificación y la fecha del cierre. Se cuenta en
 *  UTC sobre fechas sin hora, así el huso horario del navegador no mueve el día. */
export function diasAtras(planning: string, fecha: string): number {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${planning}T00:00:00Z`)) / 86_400_000)
}

/** Una sola definición de cómo se presenta cada grupo del backend. El tipo
 *  `Record<GrupoDelCierre, …>` obliga a clasificar aquí un grupo nuevo: si falta,
 *  no compila. Va anotado y no con `satisfies` para que todo `porQue` tenga la
 *  misma firma y se pueda llamar con (viaje, fecha) desde cualquier grupo. */
export const GRUPOS_DE_VIAJES: Record<GrupoDelCierre, Presentacion> = {
  hoy: { pestana: 'to_resolve', chip: 'Del día', bloqueaLaFirma: true, porQue: () => 'Del día' },
  rezago: {
    pestana: 'to_resolve', chip: 'Rezago', bloqueaLaFirma: true,
    porQue: (v, fecha) => `Rezago · ${plural(diasAtras(v.planning_date, fecha), 'día', 'días')}`,
  },
  // Ofertas que el TMS retiró porque WebCarga no las tomó (Sodimac, 07/10).
  oferta_sin_declarar: {
    pestana: 'to_resolve', chip: 'Oferta retirada', bloqueaLaFirma: false,
    porQue: () => 'Oferta retirada por el TMS',
  },
  // "Igual hay que cerrarlos" (Regla 5 de Pablo): se declaran como los demás.
  abandonado: {
    pestana: 'to_resolve', chip: 'Abandonado', bloqueaLaFirma: false,
    porQue: () => 'Abandonado por el TMS',
  },
  en_curso: {
    pestana: 'tracking', chip: 'En ruta', bloqueaLaFirma: false,
    porQue: v => `En ruta · ${v.trip_status ?? 'sin estado'}`,
  },
  // Ítem 6 (minuta 09/10): asignado, falta que el TMS del cliente lo cierre.
  pendiente_cierre_tms: {
    pestana: 'tracking', chip: 'Espera cierre del TMS', bloqueaLaFirma: false,
    porQue: () => 'Espera cierre del TMS',
  },
  con_motivo: {
    pestana: 'resolved', chip: 'Con motivo', bloqueaLaFirma: false,
    porQue: v => v.unassigned_reason_label ?? 'Sin motivo',
  },
}

const GRUPOS = Object.keys(GRUPOS_DE_VIAJES) as GrupoDelCierre[]

export function esPestanaDeViajes(v: string | null): v is PestanaDeViajes {
  return PESTANAS_DE_VIAJES.some(p => p.id === v)
}

/** Los viajes de una pestaña, de la planificación más antigua a la más nueva y, a
 *  igual fecha, por Nº de viaje. `Partial`: backend y frontend se despliegan por
 *  separado, y un grupo puede no llegar todavía. */
export function filasDePestana(
  grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>, pestana: PestanaDeViajes,
): FilaDeViaje[] {
  return GRUPOS
    .filter(g => GRUPOS_DE_VIAJES[g].pestana === pestana)
    .flatMap(g => (grupos[g] ?? []).map(v => ({ ...v, grupo: g })))
    .sort((a, b) => a.planning_date.localeCompare(b.planning_date)
      || (a.source_system_trip_id ?? a.trip_id).localeCompare(b.source_system_trip_id ?? b.trip_id, 'es', { numeric: true }))
}

export function pestanaInicial(grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>): PestanaDeViajes {
  return filasDePestana(grupos, 'to_resolve').length > 0 ? 'to_resolve' : 'tracking'
}

/** Patente → Nº de sus viajes, solo las que aparecen más de una vez: dos viajes
 *  del mismo camión no son un duplicado, y la marca lo dice. */
export function viajesPorPatente(filas: FilaDeViaje[]): Map<string, string[]> {
  const porPatente = new Map<string, string[]>()
  for (const f of filas) {
    if (!f.tractor_plate) continue
    porPatente.set(f.tractor_plate, [...(porPatente.get(f.tractor_plate) ?? []), f.source_system_trip_id ?? f.trip_id])
  }
  return new Map([...porPatente].filter(([, viajes]) => viajes.length > 1))
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd monitor-app/frontend && npx vitest run lib/cierre/gruposDeViajes.test.ts && npx tsc --noEmit`
Expected: 10/10 PASS y tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/cierre/
git commit -m "feat(cierre): una sola definición de cómo se presenta cada grupo de Viajes"
```

---

### Task 1b: La URL del Cierre, en inglés y en un solo lugar

**Files:**
- Create: `monitor-app/frontend/lib/navegacion/cierre.ts`
- Test: `monitor-app/frontend/lib/navegacion/cierre.test.ts`
- Modify: `monitor-app/frontend/lib/navegacion/viaje.ts` (`CIERRE` se mueve al módulo nuevo y se re-exporta)
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx` (`TABS`, el estado `tab`, `setTab`, `setFecha`, `urlDeEsteCierre`, la lectura de la fecha)
- Test: `monitor-app/frontend/app/dashboard/operations/closures/page.test.tsx`

**Interfaces:**
- Consumes: `PestanaDeViajes` y `esPestanaDeViajes` (Task 1).
- Produces:
  - **Tipos:** `PestanaDelCierre = 'fleet' | 'trips' | 'pending' | 'report'` y
    `EstadoDeLaUrlDelCierre = { date: string | null; tab: PestanaDelCierre | null; trips: PestanaDeViajes | null }`.
  - **Constantes:** `CIERRE` (ruta), `PESTANAS_DEL_CIERRE: PestanaDelCierre[]`.
  - **Funciones:**
    - `leerUrlDelCierre(params: URLSearchParams | ReadonlyURLSearchParams): EstadoDeLaUrlDelCierre`;
    - `urlDelCierre(params, cambios: Partial<EstadoDeLaUrlDelCierre>): string`;
    - `esUrlVieja(params): boolean`.

- [ ] **Step 1: Escribir el test que falla**

`lib/navegacion/cierre.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { esUrlVieja, leerUrlDelCierre, urlDelCierre } from './cierre'

const p = (q: string) => new URLSearchParams(q)

describe('URL del Cierre', () => {
  it('lee la forma en inglés', () => {
    expect(leerUrlDelCierre(p('date=2026-10-10&tab=trips&trips=tracking')))
      .toEqual({ date: '2026-10-10', tab: 'trips', trips: 'tracking' })
  })

  it('lee los enlaces viejos en español, para no romper marcadores ni el ?next= del detalle', () => {
    expect(leerUrlDelCierre(p('fecha=2026-10-07&tab=viajes'))).toEqual({ date: '2026-10-07', tab: 'trips', trips: null })
    expect(leerUrlDelCierre(p('tab=flota')).tab).toBe('fleet')
    expect(leerUrlDelCierre(p('tab=pendientes')).tab).toBe('pending')
    expect(leerUrlDelCierre(p('tab=reporte')).tab).toBe('report')
  })

  it('lo que no reconoce lo deja en null, sin inventar', () => {
    expect(leerUrlDelCierre(p('tab=xyz&trips=foo'))).toEqual({ date: null, tab: null, trips: null })
  })

  it('escribe siempre en inglés, y borra las claves viejas', () => {
    expect(urlDelCierre(p('fecha=2026-10-07&tab=viajes&otro=1'), { trips: 'resolved' }))
      .toBe('/dashboard/operations/closures?otro=1&date=2026-10-07&tab=trips&trips=resolved')
  })

  it('reconoce una URL vieja para reescribirla', () => {
    expect(esUrlVieja(p('fecha=2026-10-07'))).toBe(true)
    expect(esUrlVieja(p('tab=viajes'))).toBe(true)
    expect(esUrlVieja(p('date=2026-10-07&tab=trips'))).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run lib/navegacion/cierre.test.ts`
Expected: FAIL con "Failed to resolve import './cierre'".

- [ ] **Step 3: Implementar el módulo**

`lib/navegacion/cierre.ts`:

```ts
import { esPestanaDeViajes, type PestanaDeViajes } from '@/lib/cierre/gruposDeViajes'

/** La URL del Cierre del Día, en un solo lugar (spec 2026-10-11). Claves y
 *  valores en inglés, como las rutas de la app; lo que se ve, en español. Lee
 *  también la forma vieja en español (?fecha=, ?tab=viajes) para no romper
 *  marcadores, el historial ni el ?next= del detalle de un viaje. */
export const CIERRE = '/dashboard/operations/closures'

export type PestanaDelCierre = 'fleet' | 'trips' | 'pending' | 'report'
export const PESTANAS_DEL_CIERRE: PestanaDelCierre[] = ['fleet', 'trips', 'pending', 'report']

export type EstadoDeLaUrlDelCierre = {
  date:  string | null
  tab:   PestanaDelCierre | null
  trips: PestanaDeViajes | null
}

type Parametros = Pick<URLSearchParams, 'get' | 'toString'>

/** Los valores de la URL vieja, en español. */
const PESTANA_VIEJA: Record<string, PestanaDelCierre> = {
  flota: 'fleet', viajes: 'trips', pendientes: 'pending', reporte: 'report',
}
const CLAVES_VIEJAS = ['fecha', 'viajes'] as const

function pestanaDe(v: string | null): PestanaDelCierre | null {
  if (v && (PESTANAS_DEL_CIERRE as string[]).includes(v)) return v as PestanaDelCierre
  return (v && PESTANA_VIEJA[v]) || null
}

export function leerUrlDelCierre(params: Parametros): EstadoDeLaUrlDelCierre {
  const trips = params.get('trips')
  return {
    date: params.get('date') ?? params.get('fecha'),
    tab: pestanaDe(params.get('tab')),
    trips: esPestanaDeViajes(trips) ? trips : null,
  }
}

export function esUrlVieja(params: Parametros): boolean {
  const tab = params.get('tab')
  return CLAVES_VIEJAS.some(c => params.get(c) !== null) || (tab !== null && tab in PESTANA_VIEJA)
}

/** La URL del Cierre con `cambios` aplicados. Conserva los parámetros ajenos y
 *  siempre escribe la forma en inglés. */
export function urlDelCierre(params: Parametros, cambios: Partial<EstadoDeLaUrlDelCierre>): string {
  const estado = { ...leerUrlDelCierre(params), ...cambios }
  const salida = new URLSearchParams(params.toString())
  for (const c of [...CLAVES_VIEJAS, 'date', 'tab', 'trips']) salida.delete(c)
  if (estado.date) salida.set('date', estado.date)
  if (estado.tab) salida.set('tab', estado.tab)
  if (estado.trips) salida.set('trips', estado.trips)
  return `${CIERRE}?${salida.toString()}`
}
```

En `lib/navegacion/viaje.ts`, borra `export const CIERRE = '/dashboard/operations/closures'` y agrega arriba
`import { CIERRE } from './cierre'` y `export { CIERRE }`. Así quien lo importa desde `viaje.ts` sigue funcionando.

- [ ] **Step 4: Usar el módulo en la página**

En `app/dashboard/operations/closures/page.tsx`:

1. **Las pestañas.** En `TABS`, cambia los `id` a `'fleet'`, `'trips'`, `'pending'` y `'report'`. Después, con `grep -n
   "'flota'\|'viajes'\|'pendientes'\|'reporte'" app/dashboard/operations/closures/page.tsx`, reemplaza cada
   comparación de `tab` (`tab === 'viajes'`, `t.id === 'viajes'`, etc.) por su valor en inglés. Las etiquetas visibles
   no cambian.

2. **La fecha.** Reemplaza `const fecha = searchParams.get('fecha') || todayISO()` por:
   ```tsx
   const url = leerUrlDelCierre(searchParams)
   const fecha = url.date || todayISO()
   ```

3. **El estado de la pestaña.** En el inicializador de `tab`, usa `url.tab ?? 'fleet'`. En `setTab`, `setFecha` y
   `urlDeEsteCierre`, reemplaza el armado a mano de `URLSearchParams` por el módulo:
   - `router.replace(urlDelCierre(searchParams, { tab: next }))`;
   - `router.replace(urlDelCierre(searchParams, { date: next }))`;
   - `return urlDelCierre(searchParams, { date: fecha, tab })`.

4. **Reescribir una URL vieja al cargar**, sin entrada nueva en el historial:
   ```tsx
   // Un enlace viejo (?fecha=, ?tab=viajes) se lee igual y se reescribe en inglés.
   useEffect(() => {
     if (esUrlVieja(searchParams)) router.replace(urlDelCierre(searchParams, {}))
   }, [searchParams, router])
   ```

5. **Imports:** `import { esUrlVieja, leerUrlDelCierre, urlDelCierre } from '@/lib/navegacion/cierre'`, más
   `useEffect` en el import de `react` si falta.

En `page.test.tsx`, cambia las URL esperadas: `...closures?fecha=2026-08-04&tab=viajes` pasa a
`...closures?date=2026-08-04&tab=trips`, y lo mismo en cualquier otra aserción de URL. Agrega:

```tsx
  it('un enlace viejo en español se reescribe en inglés sin perder la fecha ni la pestaña', async () => {
    // Prepara useSearchParams con 'fecha=2026-08-04&tab=viajes', como los demás tests del archivo.
    // ...render de la página...
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/operations/closures?date=2026-08-04&tab=trips'))
  })
```

Escríbelo con el mismo mock de `useSearchParams` y `useRouter` que usa el test
`'cambiar de pestaña actualiza la URL'` del archivo: copia su preparación y cambia solo la query inicial.

- [ ] **Step 5: Correr los tests y verlos pasar**

Run: `cd monitor-app/frontend && npx vitest run lib/navegacion/ app/dashboard/operations/closures/ app/dashboard/operations/monitor/trips/ components/dashboard/AjustesPosterioresAlCierre 2>&1 | grep -E "Tests |×" && npx tsc --noEmit`
Expected: todo PASS y tsc sin errores.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/navegacion/ monitor-app/frontend/app/dashboard/operations/closures/
git commit -m "refactor(cierre): la URL del Cierre en inglés y en un solo módulo, leyendo los enlaces viejos"
```

---

### Task 2: Viajes en tres pestañas

**Files:**
- Modify (reescribir): `monitor-app/frontend/components/dashboard/sections/PasoViajesSection.tsx`
- Test (reescribir): `monitor-app/frontend/components/dashboard/sections/PasoViajesSection.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx` (bloque de Viajes, ~386-403, y el estado `tab` ~98-111)

**Interfaces:**
- Consumes:
  - de Task 1: `PESTANAS_DE_VIAJES`, `GRUPOS_DE_VIAJES`, `filasDePestana`, `pestanaInicial`, `viajesPorPatente`,
    `diasAtras`, `esPestanaDeViajes`, `PestanaDeViajes`, `FilaDeViaje`;
  - existentes: `Estado`, `Cifra`, `ChipsDeFiltro`, `TmsChip`, `TEXTO_APOYO`, `TEXTO_CUERPO`.
- Produces: `PasoViajesSection` con las props de hoy, más:
  - `fecha: string` (obligatoria);
  - `pestana?: PestanaDeViajes | null`: lo que trae la URL;
  - `onCambiarPestana?: (p: PestanaDeViajes) => void`.

- [ ] **Step 1: Reescribir el test**

Reemplaza todo `PasoViajesSection.test.tsx` por:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { PasoViajesSection } from './PasoViajesSection'

const viaje = (id: string, nroTms: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-10-10', client_name: 'Walmart',
  source_system: 'qanalytics', source_system_trip_id: nroTms, trip_status: 'Asignado',
  tractor_plate: null, driver_name: null, carrier_name: null, origin: null, destinations: [],
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

// Un Nº de viaje distinto por fila: repetirlo escondía que la etiqueta de cada
// desplegable no distinguía una fila de otra.
const GRUPOS = {
  hoy: [viaje('t1', '2032999', { tractor_plate: 'LRTD11' })],
  rezago: [viaje('t2', '2033000', { planning_date: '2026-10-07', driver_name: 'Juan Uno' })],
  oferta_sin_declarar: [viaje('t7', '808702', { client_name: 'Sodimac' })],
  abandonado: [viaje('t4', '2033002', { planning_date: '2026-09-01', dias_sin_novedad: 31.6 })],
  en_curso: [viaje('t3', '2033001', { planning_date: '2026-10-09', trip_status: 'RETORNANDO' })],
  pendiente_cierre_tms: [
    viaje('t5', '885613', { planning_date: '2026-10-07', tractor_plate: 'PYST91' }),
    viaje('t6', '881496', { planning_date: '2026-10-02', tractor_plate: 'PYST91' }),
  ],
  con_motivo: [viaje('t8', '2033003', { unassigned_reason_label: 'No da por tarifa' })],
}
const MOTIVOS = [{ id: 'm1', label: 'No da por tarifa' }]

function renderViajes(props: Partial<ComponentProps<typeof PasoViajesSection>> = {}) {
  const onCerrar = vi.fn().mockResolvedValue(undefined)
  const onDeshacer = vi.fn().mockResolvedValue(undefined)
  const onCambiarPestana = vi.fn()
  const utils = render(
    <PasoViajesSection fecha="2026-10-10" grupos={GRUPOS} bloquean={2} motivos={MOTIVOS}
                       onCerrar={onCerrar} onDeshacer={onDeshacer} onCambiarPestana={onCambiarPestana} {...props} />,
  )
  return { ...utils, onCerrar, onDeshacer, onCambiarPestana }
}

const pestana = (nombre: RegExp) => screen.getByRole('tab', { name: nombre })
const numerosDeViaje = () => screen.queryAllByTestId('nro-viaje').map(e => e.textContent)

describe('PasoViajesSection', () => {
  it('no muestra ninguna cifra mientras carga', () => {
    render(<PasoViajesSection fecha="2026-10-10" grupos={undefined} bloquean={undefined} cargando
                              motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('tres pestañas con su cantidad, y abre en Por resolver', () => {
    renderViajes()
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Por resolver4', 'En seguimiento3', 'Resueltos1'])
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
  })

  it('Por resolver junta hoy, rezago, ofertas y abandonados, del más antiguo al más nuevo', () => {
    renderViajes()
    // A igual fecha (10/10), el Nº de viaje se compara como número: 808702 < 2032999.
    expect(numerosDeViaje()).toEqual(['2033002', '2033000', '808702', '2032999'])
  })

  it('cada fila dice por qué está aquí, y las que bloquean la firma lo marcan', () => {
    renderViajes()
    const rezago = screen.getByText('2033000').closest('tr')!
    expect(within(rezago).getByText('Rezago · 3 días')).toBeInTheDocument()
    expect(within(rezago).getByText('Bloquea la firma')).toBeInTheDocument()
    const oferta = screen.getByText('808702').closest('tr')!
    expect(within(oferta).getByText('Oferta retirada por el TMS')).toBeInTheDocument()
    expect(within(oferta).queryByText('Bloquea la firma')).toBeNull()
  })

  it('lo de días anteriores dice hace cuántos días', () => {
    renderViajes()
    expect(within(screen.getByText('2033002').closest('tr')!).getByText('hace 39 días')).toBeInTheDocument()
    expect(within(screen.getByText('2032999').closest('tr')!).queryByText(/hace/)).toBeNull()
  })

  it('todo lo de Por resolver se declara, incluidos los abandonados', () => {
    renderViajes()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getByLabelText('Motivo del viaje 2033002', { selector: 'select' })).toBeInTheDocument()
  })

  it('el motivo se elige en la fila y se guarda con Guardar', async () => {
    const { onCerrar } = renderViajes()
    const fila = screen.getByText('2032999').closest('tr')!
    const guardar = within(fila).getByRole('button', { name: 'Guardar' })
    expect(guardar).toBeDisabled()
    fireEvent.change(within(fila).getByLabelText('Motivo del viaje 2032999', { selector: 'select' }), { target: { value: 'm1' } })
    expect(onCerrar).not.toHaveBeenCalled()
    fireEvent.click(guardar)
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t1'], 'm1'))
  })

  it('en lote: no deja cerrar sin motivo, y con motivo dice a cuántos viajes se aplica', async () => {
    const { onCerrar } = renderViajes()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByRole('button', { name: /No asignado por WebCarga/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo', { selector: 'select' }), { target: { value: 'm1' } })
    fireEvent.click(screen.getByRole('button', { name: /2 viajes/ }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t4', 't2'], 'm1'))
  })

  it('la barra de lote va arriba de la tabla y pegada al techo', () => {
    renderViajes()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const barra = screen.getByText('1 seleccionado').closest('div')!
    expect(barra.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(barra.className).toContain('sticky top-0')
  })

  it('cambiar de pestaña conserva la selección', () => {
    renderViajes()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(pestana(/En seguimiento/))
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    fireEvent.click(pestana(/Por resolver/))
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
  })

  it('En seguimiento no tiene acciones y dice la situación de cada viaje', () => {
    const { onCambiarPestana } = renderViajes()
    fireEvent.click(pestana(/En seguimiento/))
    expect(onCambiarPestana).toHaveBeenCalledWith('tracking')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getByText('En ruta · RETORNANDO')).toBeInTheDocument()
    expect(screen.getAllByText('Espera cierre del TMS').length).toBeGreaterThan(0)
  })

  it('una patente con dos viajes lleva la marca, con los números en el título', () => {
    renderViajes({ pestana: 'tracking' })
    const marcas = screen.getAllByText('2 viajes')
    expect(marcas).toHaveLength(2)
    expect(marcas[0]).toHaveAttribute('title', 'PYST91: 881496, 885613')
  })

  it('Resueltos muestra el motivo y deja deshacer', async () => {
    const { onDeshacer } = renderViajes({ pestana: 'resolved' })
    expect(screen.getByText('No da por tarifa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer el motivo del viaje 2033003' }))
    await waitFor(() => expect(onDeshacer).toHaveBeenCalledWith(['t8']))
  })

  it('con el día firmado no se declara ni se deshace', () => {
    renderViajes({ soloLectura: true })
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    fireEvent.click(pestana(/Resueltos/))
    expect(screen.queryByRole('button', { name: /Deshacer/ })).toBeNull()
  })

  it('los chips filtran la pestaña por el camino por el que llegó el viaje', () => {
    renderViajes()
    fireEvent.click(screen.getByRole('button', { name: /^Rezago/ }))
    expect(numerosDeViaje()).toEqual(['2033000'])
    fireEvent.click(screen.getByRole('button', { name: /^Rezago/ }))
    expect(numerosDeViaje()).toHaveLength(4)
  })

  it('una pestaña vacía lo dice en una línea, sin tabla', () => {
    renderViajes({ grupos: { ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] }, pestana: 'to_resolve' })
    expect(screen.getByText('Nada por resolver: puedes firmar el día')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('sin pestaña en la URL y sin nada por resolver, abre En seguimiento', () => {
    renderViajes({ grupos: { ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] } })
    expect(pestana(/En seguimiento/)).toHaveAttribute('aria-selected', 'true')
  })

  it('una pestaña que no existe en la URL cae en la inicial', () => {
    renderViajes({ pestana: 'xyz' as never })
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
  })

  it('al declarar el último por resolver, la pestaña no salta sola', () => {
    const { rerender } = renderViajes({ pestana: 'to_resolve' })
    rerender(<PasoViajesSection fecha="2026-10-10" bloquean={0} motivos={MOTIVOS} onCerrar={vi.fn()} pestana="to_resolve"
                                grupos={{ ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] }} />)
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nada por resolver: puedes firmar el día')).toBeInTheDocument()
  })

  it('el buscador cubre las tres pestañas y cada una dice cuántos coinciden', () => {
    renderViajes()
    fireEvent.change(screen.getByRole('searchbox', { name: /buscar/i }), { target: { value: 'pyst91' } })
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Por resolver0 de 4', 'En seguimiento2 de 3', 'Resueltos0 de 1'])
    expect(screen.getByText('2 resultados en En seguimiento')).toBeInTheDocument()
  })

  it('cada fila trae patente, conductor, empresa, origen y destinos', () => {
    renderViajes({ grupos: { ...GRUPOS, hoy: [viaje('t1', '2032999', {
      tractor_plate: 'LRTD11', driver_name: 'Ana Soto', carrier_name: 'Transportes Sur',
      origin: 'CD Lo Aguirre', destinations: ['Local 1', 'Local 2'],
    })] } })
    for (const texto of ['LRTD11', 'Ana Soto', 'Transportes Sur', 'CD Lo Aguirre', 'Local 1 · Local 2']) {
      expect(screen.getByText(texto)).toBeInTheDocument()
    }
  })

  it('si el backend todavía no manda un grupo, la pestaña igual se dibuja', () => {
    const { pendiente_cierre_tms: _, ...sinElNuevo } = GRUPOS
    renderViajes({ grupos: sinElNuevo as typeof GRUPOS, pestana: 'tracking' })
    expect(screen.getByText('2033001')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/PasoViajesSection.test.tsx`
Expected: FAIL. No hay `role="tab"` ni `data-testid="nro-viaje"`, y la mayoría de los tests fallan.

- [ ] **Step 3: Reescribir el componente**

Reemplaza todo `PasoViajesSection.tsx` por:

```tsx
'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { Estado } from '@/components/ui/Estado'
import { Cifra } from '@/components/ui/Cifra'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { TmsChip } from '@/components/dashboard/TripTable'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import {
  GRUPOS_DE_VIAJES, PESTANAS_DE_VIAJES, diasAtras, esPestanaDeViajes, filasDePestana, pestanaInicial, viajesPorPatente,
  type FilaDeViaje, type PestanaDeViajes,
} from '@/lib/cierre/gruposDeViajes'
import type { CierreViajesResponse, GrupoDelCierre, TripsMeta, UnassignedReasonMeta, ViajeDelCierre } from '@/lib/types'

interface Props {
  /** La fecha del cierre: de ella salen los días de rezago y el "hace N días". */
  fecha:     string
  grupos:    Partial<CierreViajesResponse['grupos']> | undefined
  bloquean:  number | undefined
  cargando?: boolean
  /** Motivos de NO ASIGNACIÓN de viaje: sólo id y etiqueta. */
  motivos:   Pick<UnassignedReasonMeta, 'id' | 'label'>[]
  onCerrar:  (tripIds: string[], motivoId: string) => void | Promise<void>
  /** Quita el motivo y devuelve el viaje a su grupo (HU-D3). */
  onDeshacer?: (tripIds: string[]) => void | Promise<void>
  /** Para los colores del TMS, los mismos del Monitor. */
  meta?:      TripsMeta | null
  /** Día firmado: nada se declara ni se deshace (el backend también lo rechaza). */
  soloLectura?: boolean
  /** La pestaña que trae la URL (`?viajes=`); la página es dueña de la URL. */
  pestana?:         PestanaDeViajes | null
  onCambiarPestana?: (p: PestanaDeViajes) => void
}

/** Fecha de planificación corta, como la lee el coordinador: 02/10. */
function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** Cuenta desde el último reporte del TMS, no desde la planificación. */
function formatDiasSinNovedad(dias: number): string {
  return `${dias.toFixed(1).replace('.', ',')} días sin novedad`
}

/** Paso "Viajes" del Cierre del Día: tres pestañas que responden qué falta
 *  declarar, qué sigue vivo sin depender del cierre y qué ya se declaró (spec
 *  2026-10-11). Cómo se presenta cada grupo del backend lo dice
 *  `lib/cierre/gruposDeViajes.ts`, no este componente.
 *
 *  Puramente presentacional: el fetch, `bulkClose` y la URL viven en la página.
 *  Sin encabezado propio: vive dentro de una pestaña del Centro de Cierre. */
export function PasoViajesSection({
  fecha, grupos, bloquean, cargando = false, motivos, onCerrar, onDeshacer, meta, soloLectura = false,
  pestana: pestanaDeLaUrl, onCambiarPestana,
}: Props) {
  // La pestaña elegida a mano manda; si no hay, la de la URL; si no, la inicial.
  // La inicial se calcula sobre los datos, pero NO se guarda: así declarar el
  // último viaje por resolver no hace saltar la pestaña.
  const [elegida, setElegida] = useState<PestanaDeViajes | null>(null)
  const [chip, setChip] = useState<GrupoDelCierre | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Buscador (minuta 09/10, ítem 22): cubre las tres pestañas.
  const [q, setQ] = useState('')
  const [motivoId, setMotivoId] = useState('')
  // El motivo elegido en una fila, todavía sin guardar (HU-D3).
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardandoFila, setGuardandoFila] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const qLower = q.trim().toLowerCase()
  const coincide = (v: ViajeDelCierre) => !qLower || [
    v.source_system_trip_id, v.client_name, v.tractor_plate, v.driver_name, v.carrier_name, v.origin, ...v.destinations,
  ].some(x => (x ?? '').toLowerCase().includes(qLower))

  function toggleSelected(tripId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId)
      return next
    })
  }

  // Camino de escritura: si `onCerrar` revienta, la selección y el motivo NO se
  // limpian, para reintentar sin volver a elegir todo.
  async function handleCerrar() {
    if (selected.size === 0 || !motivoId) return
    setGuardando(true)
    setError(null)
    try {
      await onCerrar(Array.from(selected), motivoId)
      setSelected(new Set())
      setMotivoId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cerrar los viajes seleccionados.')
    } finally {
      setGuardando(false)
    }
  }

  // Una fila sola se cierra con el MISMO escritor que el lote: declarar un viaje
  // es un único acto.
  async function handleCerrarFila(tripId: string) {
    const motivo = borrador[tripId]
    if (!motivo) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onCerrar([tripId], motivo)
      setBorrador(prev => {
        const { [tripId]: _, ...resto } = prev
        return resto
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el viaje.')
    } finally {
      setGuardandoFila(null)
    }
  }

  async function handleDeshacer(tripId: string) {
    if (!onDeshacer) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onDeshacer([tripId])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo deshacer.')
    } finally {
      setGuardandoFila(null)
    }
  }

  if (cargando || !grupos) {
    return <Estado tipo="cargando" />
  }

  const pestana: PestanaDeViajes = elegida
    ?? (esPestanaDeViajes(pestanaDeLaUrl ?? null) ? pestanaDeLaUrl! : pestanaInicial(grupos))
  function cambiarPestana(p: PestanaDeViajes) {
    setElegida(p)
    setChip(null)
    onCambiarPestana?.(p)
  }

  const porPestana = Object.fromEntries(PESTANAS_DE_VIAJES.map(p => {
    const todas = filasDePestana(grupos, p.id)
    return [p.id, { todas, coinciden: todas.filter(coincide) }]
  })) as Record<PestanaDeViajes, { todas: FilaDeViaje[]; coinciden: FilaDeViaje[] }>

  const info = PESTANAS_DE_VIAJES.find(p => p.id === pestana)!
  const { todas, coinciden } = porPestana[pestana]
  const filas = chip ? coinciden.filter(f => f.grupo === chip) : coinciden
  const repetidas = viajesPorPatente(todas)
  const declarar = pestana === 'to_resolve' && !soloLectura
  const deshacer = pestana === 'resolved' && !soloLectura && !!onDeshacer
  // Los chips aparecen solo si la pestaña junta más de un camino.
  const chips = Object.entries(GRUPOS_DE_VIAJES)
    .filter(([g, p]) => p.pestana === pestana && todas.some(f => f.grupo === g))
    .map(([g, p]) => ({ id: g, etiqueta: p.chip, n: coinciden.filter(f => f.grupo === g).length }))
  const otraConResultados = qLower && coinciden.length === 0
    ? PESTANAS_DE_VIAJES.find(p => porPestana[p.id].coinciden.length > 0)
    : undefined
  const n = selected.size

  return (
    <div className="space-y-4">
      <Cifra
        valor={bloquean}
        etiqueta="bloquean la firma del día"
        tono={bloquean && bloquean > 0 ? 'atencion' : 'resuelto'}
      />

      {n > 0 && (
        // Pegada al TECHO del área de scroll: `position: sticky` no sale de la caja
        // de su padre, y al pie solo se pegaba ya abajo del todo.
        <div className="sticky top-0 z-20 flex items-center gap-2 bg-white border border-accent/20 shadow-sm rounded-lg px-3 py-2">
          <span className="text-etiqueta font-semibold text-text-primary">{n} seleccionado{n === 1 ? '' : 's'}</span>
          <select
            aria-label="Motivo"
            value={motivoId}
            onChange={e => setMotivoId(e.target.value)}
            className="text-etiqueta border border-border rounded-lg px-2 py-1 bg-white"
          >
            <option value="">— Elige un motivo —</option>
            {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!motivoId || guardando}
            onClick={handleCerrar}
            className="text-etiqueta font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
          >
            {guardando ? 'Cerrando…' : `No asignado por WebCarga · ${n} viaje${n === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div role="tablist" aria-label="Viajes del cierre" className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 overflow-x-auto max-w-full">
          {PESTANAS_DE_VIAJES.map(p => {
            const { todas: t, coinciden: c } = porPestana[p.id]
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === pestana}
                onClick={() => cambiarPestana(p.id)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                  p.id === pestana ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary'
                }`}
              >
                {p.etiqueta}
                <span className="rounded-full bg-gray-200 px-1.5 text-[10px] font-bold tabular-nums text-text-secondary">
                  {qLower ? `${c.length} de ${t.length}` : t.length}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar Nº de viaje, patente, conductor, empresa o cliente…"
            aria-label="Buscar viaje"
            className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
          />
        </div>
      </div>

      <p className={`text-etiqueta ${TEXTO_APOYO}`}>{info.bajada}</p>
      {chips.length > 1 && (
        <ChipsDeFiltro opciones={chips} activo={chip} onElegir={id => setChip(id as GrupoDelCierre | null)} />
      )}

      {todas.length === 0 ? (
        <Estado tipo="vacio" titulo={info.vacio} />
      ) : filas.length === 0 ? (
        <Estado
          tipo="vacio"
          titulo="Ningún viaje coincide con la búsqueda"
          detalle={otraConResultados
            ? `${porPestana[otraConResultados.id].coinciden.length} resultados en ${otraConResultados.etiqueta}`
            : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                {declarar && <th className="text-left px-3 py-2 w-8" />}
                <th className="text-left px-3 py-2">TMS · Cliente</th>
                <th className="text-left px-3 py-2">Nº viaje</th>
                <th className="text-left px-3 py-2">Fecha</th>
                {pestana !== 'resolved' && (
                  <th className="text-left px-3 py-2">{pestana === 'to_resolve' ? 'Por qué está aquí' : 'Situación'}</th>
                )}
                <th className="text-left px-3 py-2">Patente</th>
                <th className="text-left px-3 py-2">Conductor</th>
                <th className="text-left px-3 py-2">Empresa</th>
                <th className="text-left px-3 py-2">Origen · Destinos</th>
                <th className="text-left px-3 py-2">Tiempo</th>
                {pestana !== 'tracking' && <th className="text-left px-3 py-2">Motivo de no asignación</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filas.map(v => {
                const presentacion = GRUPOS_DE_VIAJES[v.grupo]
                const atras = diasAtras(v.planning_date, fecha)
                const nro = v.source_system_trip_id ?? v.trip_id
                const otros = v.tractor_plate ? repetidas.get(v.tractor_plate) : undefined
                return (
                  <tr key={v.trip_id}>
                    {declarar && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar viaje ${nro}`}
                          checked={selected.has(v.trip_id)}
                          onChange={() => toggleSelected(v.trip_id)}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <TmsChip tms={v.source_system ?? ''} meta={meta} sourceTripId={v.source_system_trip_id} />
                      <span className={`block mt-1 text-etiqueta ${TEXTO_APOYO}`}>{v.client_name ?? '—'}</span>
                    </td>
                    <td data-testid="nro-viaje" className={`px-3 py-2 font-identificador ${TEXTO_CUERPO}`}>{nro}</td>
                    <td className={`px-3 py-2 tabular-nums ${TEXTO_CUERPO}`}>
                      {formatFecha(v.planning_date)}
                      {atras > 0 && <span className={`block text-etiqueta ${TEXTO_APOYO}`}>hace {atras} {atras === 1 ? 'día' : 'días'}</span>}
                    </td>
                    {pestana !== 'resolved' && (
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                        {presentacion.porQue(v, fecha)}
                        {presentacion.bloqueaLaFirma && (
                          <span className="block text-etiqueta font-semibold text-accent">Bloquea la firma</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 font-identificador font-semibold text-text-primary">
                      {v.tractor_plate ?? '—'}
                      {otros && (
                        <span title={`${v.tractor_plate}: ${otros.join(', ')}`} className={`block text-etiqueta font-normal ${TEXTO_APOYO}`}>
                          {otros.length} viajes
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.driver_name ?? '—'}</td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.carrier_name ?? '—'}</td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                      <span className="font-medium text-text-primary">{v.origin ?? '—'}</span>
                      {v.destinations.length > 0 && (
                        <span className={`block text-etiqueta ${TEXTO_APOYO}`}>{v.destinations.join(' · ')}</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{formatDiasSinNovedad(v.dias_sin_novedad)}</td>
                    {pestana === 'to_resolve' && (
                      <td className="px-3 py-2">
                        {declarar ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Motivo del viaje ${nro}`}
                              value={borrador[v.trip_id] ?? ''}
                              disabled={guardandoFila === v.trip_id}
                              onChange={e => setBorrador(prev => ({ ...prev, [v.trip_id]: e.target.value }))}
                              className="text-etiqueta border border-border rounded-lg px-2 py-1 bg-white"
                            >
                              <option value="">— Elige un motivo —</option>
                              {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                            <button
                              type="button"
                              disabled={!borrador[v.trip_id] || guardandoFila === v.trip_id}
                              onClick={() => handleCerrarFila(v.trip_id)}
                              className="text-etiqueta font-semibold bg-accent text-white rounded-lg px-2.5 py-1 disabled:opacity-50"
                            >
                              {guardandoFila === v.trip_id ? 'Guardando…' : 'Guardar'}
                            </button>
                          </div>
                        ) : (
                          <span className={TEXTO_APOYO}>—</span>
                        )}
                      </td>
                    )}
                    {pestana === 'resolved' && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={TEXTO_CUERPO}>{presentacion.porQue(v, fecha)}</span>
                          {deshacer && (
                            <button
                              type="button"
                              aria-label={`Deshacer el motivo del viaje ${nro}`}
                              disabled={guardandoFila === v.trip_id}
                              onClick={() => handleDeshacer(v.trip_id)}
                              className="text-etiqueta font-semibold border border-border rounded-lg px-2.5 py-1 bg-white text-text-primary hover:bg-bg-main disabled:opacity-50"
                            >
                              {guardandoFila === v.trip_id ? 'Deshaciendo…' : 'Deshacer'}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <Estado tipo="error" titulo={error} />}
    </div>
  )
}
```

- [ ] **Step 4: La página: URL (con el módulo de Task 1b), fecha y Reintentar**

En `app/dashboard/operations/closures/page.tsx`:

1. **La pestaña de Viajes.** Debajo de `function setTab(...)`, agrega:
   ```tsx
   // La pestaña de Viajes también vive en la URL (?trips=), por el mismo motivo
   // que ?tab=: volver del detalle de un viaje deja todo donde estaba.
   function setPestanaDeViajes(next: PestanaDeViajes) {
     router.replace(urlDelCierre(searchParams, { trips: next }))
   }
   ```
   La pestaña de la URL se lee con `leerUrlDelCierre(searchParams).trips` (Task 1b). Importa
   `import type { PestanaDeViajes } from '@/lib/cierre/gruposDeViajes'`.

2. **El bloque de error y `PasoViajesSection`.** Reemplaza `{cierreViajesQuery.isError ? (...) : (<PasoViajesSection .../>)}`
   por:
   ```tsx
   {cierreViajesQuery.isError ? (
     <Estado tipo="error" titulo="No se pudieron cargar los viajes" detalle="Intenta de nuevo en unos segundos.">
       <button
         type="button"
         onClick={() => { void cierreViajesQuery.refetch() }}
         className="text-etiqueta font-semibold border border-border rounded-lg px-2.5 py-1 bg-white text-text-primary hover:bg-bg-main"
       >
         Reintentar
       </button>
     </Estado>
   ) : (
     <PasoViajesSection
       fecha={fecha}
       grupos={cierreViajesQuery.data?.grupos}
       bloquean={cierreViajesQuery.data?.bloquean}
       cargando={cierreViajesQuery.isLoading}
       motivos={motivosViajesQuery.data ?? []}
       onCerrar={handleCerrarViajes}
       onDeshacer={handleDeshacerViajes}
       meta={tripsMeta}
       soloLectura={diaCerrado}
       pestana={leerUrlDelCierre(searchParams).trips}
       onCambiarPestana={setPestanaDeViajes}
     />
   )}
   ```

- [ ] **Step 5: Correr los tests y verlos pasar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/PasoViajesSection.test.tsx lib/cierre/ app/dashboard/operations/closures/page.test.tsx lib/copy/ 2>&1 | tail -20 && npx tsc --noEmit`
Expected: todo PASS y tsc sin errores.

Si un test de `page.test.tsx` cuenta `getAllByRole('tab')` con la pestaña Viajes abierta, ahora encuentra 7 en vez de 4.
Limítalo a la barra de la página con `within(screen.getAllByRole('tablist')[0])` y anota el ruling. No le saques el rol
a las pestañas de Viajes.

- [ ] **Step 6: Verificar que una mutación hace fallar los tests**

En `lib/cierre/gruposDeViajes.ts`, cambia temporalmente `abandonado: { pestana: 'to_resolve'` por
`abandonado: { pestana: 'tracking'`. Corre
`npx vitest run components/dashboard/sections/PasoViajesSection.test.tsx -t "abandonados"` (Expected: FAIL) y revierte
el cambio.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/dashboard/sections/PasoViajesSection.tsx monitor-app/frontend/components/dashboard/sections/PasoViajesSection.test.tsx monitor-app/frontend/app/dashboard/operations/closures/page.tsx
git commit -m "feat(cierre): Viajes en tres pestañas — por resolver, en seguimiento y resueltos"
```

---

### Task 3: Backend — a qué clientes pertenece cada fila, y los clientes del día

**Files:**
- Modify: `monitor-app/backend/api/app/routers/status_report.py`
- Test: `monitor-app/backend/api/tests/test_status_report.py`
- Test: `monitor-app/backend/api/tests/test_reporte_de_estatus_integracion.py`

**Interfaces:**
- Consumes:
  - `_build_asset_rows`: las filas ya traen `carrier_id`, `con_carga`, `client_name` y `categories`;
  - `_build_driver_rows`, al que esta tarea le agrega `carrier_id` en la fila;
  - `compute_fleet_driver_gap`: sus filas traen `carrier_id`.
- Produces:
  - **SQL:** `_SQL_CLIENTES_POR_EMPRESA`, que devuelve `carrier_id` y `clients text[]`.
  - **Funciones:**
    - `_clientes_de_la_fila(fila: dict, clientes_por_empresa: dict) -> list[str]`;
    - `_filter_by_client(rows: list[dict], client: str | None, clientes_por_empresa: dict) -> list[dict]`;
    - `_clientes_del_dia(rows: list[dict]) -> list[dict]`.
  - **API:** la respuesta suma `clients: [{client_name, assigned}]`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/test_status_report.py`:

1. **El import.** En el bloque `from app.routers.status_report import (...)`, agrega `_clientes_de_la_fila` y
   `_clientes_del_dia`.

2. **El test viejo del filtro.** Reemplaza el test `test_filter_by_client_mantiene_equipos_sin_carga_y_filtra_los_con_carga_de_otro_cliente`
   completo por:

```python
CLIENTES_POR_EMPRESA = {"c1": ["Walmart"], "c2": ["Iansa", "Sodimac"]}


def test_un_equipo_con_carga_pertenece_al_cliente_de_su_viaje():
    assert _clientes_de_la_fila(_row(client_name="Walmart"), CLIENTES_POR_EMPRESA) == ["Walmart"]


def test_un_equipo_sin_carga_pertenece_a_los_clientes_de_su_empresa():
    """Con "Sodimac" elegido, "Equipos activos" no puede seguir sumando los
    tractos de Walmart que no cargaron (spec 2026-10-11, filtro coherente)."""
    fila = _row(carrier_id="c2", con_carga=False, client_name=None, category="NO_TRABAJANDO")
    assert _clientes_de_la_fila(fila, CLIENTES_POR_EMPRESA) == ["Iansa", "Sodimac"]


def test_el_faltante_de_dotacion_pertenece_a_los_clientes_de_su_empresa():
    """La fila de faltante no tiene con_carga: es por definición sin carga."""
    assert _clientes_de_la_fila(_faltante("c1", 3, 1) | {"carrier_id": "c1"}, CLIENTES_POR_EMPRESA) == ["Walmart"]


def test_el_filtro_aplica_la_misma_regla_a_cargados_y_sin_carga():
    rows = [
        _row(asset_id="a1", carrier_id="c1", client_name="Walmart"),
        _row(asset_id="a2", carrier_id="c2", client_name="Sodimac"),
        _row(asset_id="a3", carrier_id="c1", con_carga=False, client_name=None, category="NO_TRABAJANDO"),
        _row(asset_id="a4", carrier_id="c2", con_carga=False, client_name=None, category="NO_TRABAJANDO"),
    ]
    assert [r["asset_id"] for r in _filter_by_client(rows, "Walmart", CLIENTES_POR_EMPRESA)] == ["a1", "a3"]
    assert [r["asset_id"] for r in _filter_by_client(rows, "Iansa", CLIENTES_POR_EMPRESA)] == ["a4"]
    assert _filter_by_client(rows, None, CLIENTES_POR_EMPRESA) == rows


def test_el_filtro_no_distingue_mayusculas():
    rows = [_row(asset_id="a1", carrier_id="c9", con_carga=False, client_name=None, category="NO_TRABAJANDO")]
    assert _filter_by_client(rows, "walmart", {"c9": ["WALMART"]}) == rows


def test_los_clientes_del_dia_son_los_que_cargaron_con_su_cantidad():
    rows = [
        _row(asset_id="a1", client_name="Walmart"), _row(asset_id="a2", client_name="Walmart"),
        _row(asset_id="a3", client_name="Iansa", categories=["EQUIPO_COMPLETO"]),
        _row(asset_id="a4", con_carga=False, client_name=None, category="NO_TRABAJANDO"),
        # Un equipo sin tipo no está en el reporte: no hace aparecer a su cliente.
        _row(asset_id="a5", client_name="Colun", categories=["SIN_CLASIFICAR"]),
    ]
    assert _clientes_del_dia(rows) == [
        {"client_name": "Walmart", "assigned": 2}, {"client_name": "Iansa", "assigned": 1},
    ]
```

3. **El fixture `_row`.** Revisa que incluya `"carrier_id": "c1"`, como en la base actual del fixture.

4. **El test del endpoint con filtro.** Reemplaza el test `test_el_filtro_de_cliente_deja_a_los_sin_carga_y_saca_a_los_de_otro_cliente`
   completo por:

```python
def test_el_filtro_de_cliente_cuadra_todas_las_cifras_y_devuelve_los_clientes_del_dia():
    from app.routers.status_report import _SQL_CLIENTES_POR_EMPRESA

    asset_rows = [
        _row(asset_id="t1", carrier_id="c1", client_name="Walmart"),
        _row(asset_id="t2", carrier_id="c2", client_name="Sodimac"),
        _row(asset_id="t3", carrier_id="c1", con_carga=False, client_name=None, category="NO_TRABAJANDO"),
        _row(asset_id="t4", carrier_id="c2", con_carga=False, client_name=None, category="NO_TRABAJANDO"),
    ]
    driver_rows = [_driver_row(driver_id="d1", carrier_id="c1"), _driver_row(driver_id="d2", carrier_id="c2")]

    async def fetch(sql, *args):
        if sql == _SQL_CLIENTES_POR_EMPRESA:
            return [{"carrier_id": "c1", "clients": ["Walmart"]}, {"carrier_id": "c2", "clients": ["Sodimac"]}]
        return []

    pool = AsyncMock()
    pool.fetch.side_effect = fetch
    pool.fetchval.return_value = None
    gap = [{"carrier_id": "c1", "business_name": "Transportes Sur", "n_tractos": 3, "n_conductores": 1, "gap": 2},
           {"carrier_id": "c2", "business_name": "Otra", "n_tractos": 2, "n_conductores": 1, "gap": 1}]
    import app.routers.status_report as modulo
    with patch.object(modulo, "_build_asset_rows", AsyncMock(return_value=asset_rows)), \
         patch.object(modulo, "_build_driver_rows", AsyncMock(return_value=driver_rows)), \
         patch.object(modulo, "compute_fleet_driver_gap", AsyncMock(return_value=gap)), \
         patch.object(modulo, "_no_trabajaron_por_conductor", wraps=modulo._no_trabajaron_por_conductor) as espia:
        body = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02&client=Walmart").json()

    resumen = body["by_operation_type"]["tractoreo"]["summary"]
    assert (resumen["total"], resumen["assigned"]) == (2, 1)
    assert [d["driver_id"] for d in espia.call_args.args[0]] == ["d1"]
    assert [f["carrier_id"] for f in espia.call_args.kwargs["faltantes"]] == ["c1"]
    # La lista sale del día completo, antes del filtro.
    assert body["clients"] == [{"client_name": "Sodimac", "assigned": 1}, {"client_name": "Walmart", "assigned": 1}]
```

5. **El fixture `_driver_row`.** Agrega `"carrier_id": "c1"` a su base.

6. **El test de las seis claves.** En `test_get_status_report_devuelve_los_dos_tipos_con_sus_seis_claves`, agrega
   `"clients"` al conjunto de claves de primer nivel.

7. **El test de `_build_driver_rows`.** En `test_build_driver_rows_deja_solo_a_quien_no_trabajo_o_no_se_sabe`, agrega
   `assert row["carrier_id"] == "c1"`.

En `tests/test_reporte_de_estatus_integracion.py`, agrega:

```python
async def test_los_clientes_de_cada_empresa_salen_del_directorio(conexion_revertida):
    from app.routers.status_report import _SQL_CLIENTES_POR_EMPRESA

    sentencia = await conexion_revertida.prepare(_SQL_CLIENTES_POR_EMPRESA)
    assert [a.name for a in sentencia.get_attributes()] == ["carrier_id", "clients"]
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_status_report.py tests/test_reporte_de_estatus_integracion.py -q 2>&1 | tail -5`
Expected: falla la colección con `ImportError: cannot import name '_clientes_de_la_fila'`.

- [ ] **Step 3: Implementar**

En `app/routers/status_report.py`:

1. **`_build_driver_rows`.** En el dict de cada fila, después de `"carrier_name": r["carrier_name"],`, agrega
   `"carrier_id": r["carrier_id"],`.

2. **El filtro.** Reemplaza la función `_filter_by_client` completa por:

```python
# Los clientes de cada empresa, del directorio: el mismo cruce que daily_closures.py.
_SQL_CLIENTES_POR_EMPRESA = """
SELECT cs.carrier_id, array_agg(DISTINCT sh.name ORDER BY sh.name) AS clients
FROM public.carrier_shippers cs
JOIN public.shippers sh ON sh.id = cs.shipper_id AND sh.status = 'ACTIVE'
WHERE cs.status = 'ACTIVE'
GROUP BY cs.carrier_id
"""


def _clientes_de_la_fila(fila: dict, clientes_por_empresa: dict) -> list[str]:
    """A qué clientes pertenece una fila del reporte (spec 2026-10-11). Es la
    única regla de pertenencia, y la usan por igual equipos, conductores y
    faltante de dotación:
      - con carga: al cliente de su viaje del día;
      - sin carga, o sin noción de carga (conductor que no trabajó, faltante de
        dotación): a cada cliente de su empresa en el directorio.
    Así, con "Walmart" elegido, el reporte habla de la flota que trabaja para
    Walmart, haya cargado o no."""
    if fila.get("con_carga"):
        return [fila["client_name"]] if fila["client_name"] else []
    return list(clientes_por_empresa.get(fila["carrier_id"], []))


def _filter_by_client(rows: list[dict], client: str | None, clientes_por_empresa: dict) -> list[dict]:
    if not client:
        return rows
    buscado = client.strip().lower()
    return [
        r for r in rows
        if any(c.strip().lower() == buscado for c in _clientes_de_la_fila(r, clientes_por_empresa))
    ]


def _clientes_del_dia(rows: list[dict]) -> list[dict]:
    """Las opciones del filtro: los clientes con al menos un equipo de los tipos
    del reporte cargado ese día, con cuántos. Sale del día completo, antes del
    filtro, para que la lista no cambie al elegir."""
    acc: dict = {}
    for r in rows:
        if r["con_carga"] and r["client_name"] and any(c in _TIPOS.values() for c in r["categories"]):
            acc[r["client_name"]] = acc.get(r["client_name"], 0) + 1
    return [{"client_name": k, "assigned": v} for k, v in sorted(acc.items(), key=lambda kv: (-kv[1], kv[0]))]
```

3. **`_TIPOS`.** Muévelo arriba del todo, debajo de `router = APIRouter(...)`, para que `_clientes_del_dia` lo use sin
   depender del orden del archivo. Borra la definición vieja.

4. **`get_status_report`.** Reemplaza el cuerpo, desde `business_date = ...` hasta el `return` incluido, por:

```python
    business_date = _parse_business_date(fecha)
    clientes_por_empresa = {r["carrier_id"]: list(r["clients"]) for r in await pool.fetch(_SQL_CLIENTES_POR_EMPRESA)}
    all_rows = await _build_asset_rows(pool, business_date)
    rows = _filter_by_client(all_rows, client, clientes_por_empresa)
    por_tipo = {clave: [r for r in rows if codigo in r["categories"]] for clave, codigo in _TIPOS.items()}
    # Conductores y faltante de dotación, con la misma regla de pertenencia.
    driver_rows = _filter_by_client(await _build_driver_rows(pool, business_date), client, clientes_por_empresa)
    faltantes = _filter_by_client(await compute_fleet_driver_gap(pool), client, clientes_por_empresa)
    catalogo_no_trabajo = [r["label"] for r in await pool.fetch(_SQL_MOTIVOS_DEL_GRUPO, GRUPO_NO_TRABAJANDO)]
    catalogo_sin_asignacion = [
        r["label"] for r in await pool.fetch(_SQL_MOTIVOS_DEL_GRUPO, GRUPO_TRABAJANDO_SIN_ASIGNACION)
    ]
    no_trabajaron = {
        "tractoreo": _no_trabajaron_por_conductor(
            driver_rows, catalogo_no_trabajo, faltantes=faltantes,
            sin_conductor=await pool.fetchval(_SQL_ETIQUETA_SIN_CONDUCTOR),
        ),
        "equipo_completo": _no_trabajaron_por_equipo(por_tipo["equipo_completo"], catalogo_no_trabajo),
    }
    return {
        "business_date": business_date.isoformat(),
        "client_filter": client,
        "clients": _clientes_del_dia(all_rows),
        "by_operation_type": {
            clave: _reporte_del_tipo(
                por_tipo[clave], no_trabajaron=no_trabajaron[clave], catalogo_sin_asignacion=catalogo_sin_asignacion,
            )
            for clave in _TIPOS
        },
        **await frescura_del_dia(pool, business_date),
    }
```

5. **El docstring del módulo.** En la lista de "Decisiones", agrega:
   `- El filtro de cliente aplica una sola regla a todas las cifras (_clientes_de_la_fila): con carga, el cliente del viaje; sin carga, los clientes de su empresa en el directorio.`

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_status_report.py tests/test_reporte_de_estatus_integracion.py -q 2>&1 | tail -3`
Expected: todos PASS, el de integración incluido. Si sale SKIPPED, exporta `SUPABASE_DB_PASSWORD`.

- [ ] **Step 5: Verificar que una mutación hace fallar los tests**

En `_clientes_de_la_fila`, cambia temporalmente `return list(clientes_por_empresa.get(fila["carrier_id"], []))` por
`return []`. Corre `venv/bin/python -m pytest tests/test_status_report.py -q -k "filtro or sin_carga"` (Expected: FAIL)
y revierte el cambio.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/status_report.py monitor-app/backend/api/tests/test_status_report.py monitor-app/backend/api/tests/test_reporte_de_estatus_integracion.py
git commit -m "feat(reporte): el filtro de cliente aplica una sola regla a todas las cifras, y la API devuelve los clientes del día"
```

---

### Task 4: Frontend — la lista de clientes del reporte

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts` (tipo `StatusReport`)
- Modify: `monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx`
- Test: `monitor-app/frontend/components/dashboard/sections/StatusReportSection.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/page.tsx` (`shippersQuery` y la prop `shippers`)

**Interfaces:**
- Consumes: `clients` de Task 3.
- Produces: `StatusReportSection({ fecha })`, que ya no recibe la prop `shippers`.

- [ ] **Step 1: Escribir los tests que fallan**

En `StatusReportSection.test.tsx`:

1. **El reporte de prueba.** En `REPORT`, agrega
   `clients: [{ client_name: 'Walmart', assigned: 29 }, { client_name: 'Iansa', assigned: 3 }],`.

2. **El test de filtrar por cliente.** Reemplaza `'filtrar por cliente vuelve a pedir el reporte con ese cliente'` por:

```tsx
  it('la lista de clientes es la del día, con su cantidad, y elegir uno vuelve a pedir el reporte', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    const filtro = body.getByRole('combobox', { name: 'Filtrar por cliente' })
    expect(within(filtro).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Todos los clientes', 'Walmart (29)', 'Iansa (3)'])
    fireEvent.change(filtro, { target: { value: 'Iansa' } })
    expect(statusReportApi.get).toHaveBeenCalledWith('2026-08-02', 'Iansa')
  })

  it('el cliente elegido se conserva aunque el reporte nuevo no lo traiga, con (0)', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, clients: [{ client_name: 'Walmart', assigned: 29 }] })
    fireEvent.change(body.getByRole('combobox', { name: 'Filtrar por cliente' }), { target: { value: 'Iansa' } })
    await waitFor(() => expect(within(body.getByRole('combobox', { name: 'Filtrar por cliente' }))
      .getAllByRole('option').map(o => o.textContent)).toEqual(['Todos los clientes', 'Walmart (29)', 'Iansa (0)']))
  })

  it('con un backend que todavía no manda clients, la lista solo ofrece Todos los clientes', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, clients: undefined })
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(within(body.getByRole('combobox', { name: 'Filtrar por cliente' })).getAllByRole('option')
      .map(o => o.textContent)).toEqual(['Todos los clientes'])
  })
```

3. **El resumen imprimible.** Busca en el archivo `WebCarga consolidado` y cámbialo por `Todos los clientes` donde
   aparezca en una aserción.

- [ ] **Step 2: Correr los tests y verlos fallar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/StatusReportSection.test.tsx 2>&1 | grep -E "Tests |×"`
Expected: fallan los 3 tests nuevos (la lista trae "WebCarga consolidado" y no tiene cantidades).

- [ ] **Step 3: Implementar**

1. **`lib/types.ts`.** En `StatusReport`, después de `client_filter`, agrega:
   ```ts
   /** Las opciones del filtro: los clientes que cargaron ese día, con cuántos
    *  equipos. Opcional: backend y frontend se despliegan por separado. */
   clients?: { client_name: string; assigned: number }[]
   ```

2. **`StatusReportSection.tsx`.** Haz estos cambios:
   - **Imports y props.** Borra `import type { Shipper } from '@/lib/api/locations'` y la prop `shippers?` de `Props`
     y de la firma. Importa `keepPreviousData`:
     `import { keepPreviousData, useQuery } from '@tanstack/react-query'`.
   - **La consulta.** En el `useQuery` del reporte, agrega `placeholderData: keepPreviousData,`. Así la lista no
     desaparece mientras llega el reporte del cliente nuevo.
   - **Las opciones.** Debajo de `const reporte = porTipo?.[tipo]`, agrega:
     ```tsx
     // Las opciones salen del día (spec 2026-10-11): solo quien operó, con su
     // cantidad. Si el cliente elegido no operó ese día, se conserva con (0) en
     // vez de resetearse en silencio.
     const opcionesDeCliente = [
       ...(data?.clients ?? []),
       ...(client && !(data?.clients ?? []).some(c => c.client_name === client)
         ? [{ client_name: client, assigned: 0 }] : []),
     ]
     ```
   - **El select.** Reemplaza las opciones por:
     ```tsx
     <option value="">Todos los clientes</option>
     {opcionesDeCliente.map(c => <option key={c.client_name} value={c.client_name}>{c.client_name} ({c.assigned})</option>)}
     ```
   - **El resumen imprimible.** Cambia `' · WebCarga consolidado'` por `' · Todos los clientes'`.

3. **`page.tsx`.** Cambia `<StatusReportSection fecha={fecha} shippers={shippersQuery.data} />` por
   `<StatusReportSection fecha={fecha} />`. Después borra el `shippersQuery` completo, y también el import de
   `shippersApi` si `grep -n shippersApi app/dashboard/operations/closures/page.tsx` ya no lo muestra en uso.

- [ ] **Step 4: Correr los tests y verlos pasar**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/sections/StatusReportSection.test.tsx app/dashboard/operations/closures/page.test.tsx lib/copy/ 2>&1 | grep -E "Tests |×" && npx tsc --noEmit`
Expected: todo PASS y tsc sin errores.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/types.ts monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx monitor-app/frontend/components/dashboard/sections/StatusReportSection.test.tsx monitor-app/frontend/app/dashboard/operations/closures/page.tsx
git commit -m "feat(reporte): la lista de clientes es la del día, con su cantidad"
```

---

### Task 5: Vitest completo, despliegue, verificación y AGENTLOG

**Files:**
- Modify: `AGENTLOG.md`

- [ ] **Step 1: Vitest completo, una vez**

Run (en segundo plano): `cd monitor-app/frontend && npx vitest run > "$CLAUDE_JOB_DIR/tmp/vitest.txt" 2>&1; grep -E "Test Files|Tests " "$CLAUDE_JOB_DIR/tmp/vitest.txt"`
Expected: todo verde.

- [ ] **Step 2: Push y ver los dos despliegues**

```bash
git push origin dev
gh run list --branch dev --limit 2
gh run watch <id-backend> --exit-status
gh run watch <id-frontend> --exit-status
```
Expected: los dos en verde.

- [ ] **Step 3: Verificar en dev con Playwright**

1. **10/10 › Viajes.**
   - Debe haber 1 viaje en Por resolver (889281, "Del día", "Bloquea la firma") y 8 en En seguimiento.
   - PYST91 lleva "2 viajes" y 878052 lleva "hace 11 días".
   - Prueba el buscador con "pyst91".
   - Revisa `?trips=` en la URL al cambiar de pestaña.
2. **07/10 › Reporte.**
   - La lista ofrece solo Walmart, Iansa y Sodimac, con su cantidad.
   - Con "Iansa", Equipo Completo › Equipos activos baja a la flota de las empresas de Iansa.
   - Con "Walmart", "No trabajaron" deja solo empresas de Walmart.
3. **Teléfono (390 px).** Las pestañas y los chips se desplazan sin desbordar la página.

- [ ] **Step 4: AGENTLOG**

Agrega en `AGENTLOG.md` una entrada "2026-10-11 — Cierre › Viajes en tres pestañas y filtro de cliente coherente — en
dev" con:
- **Qué se hizo:** los commits y las cifras verificadas en dev.
- **Decisiones:**
  - `gruposDeViajes.ts` como única definición;
  - los abandonados se declaran;
  - `_clientes_de_la_fila` como única regla;
  - `clients` del día.
- **Siguiente paso:**
  - el spec del reporte por período, cuando el usuario defina si el mes solo se ve o también se firma;
  - minuta 5, A, 21, 23 y lo que falta del 20.

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): Viajes en tres pestañas y filtro de cliente coherente en dev"
git push origin dev
```
