# Tokens y componentes compartidos — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que dejar de inventar tamaños, colores y encabezados sea lo fácil, no lo disciplinado.

**Architecture:** Tres tokens de tipografía nuevos en `@theme inline` (Tailwind v4 los convierte en utilidades), y cuatro componentes que absorben lo que hoy se reescribe en cada pantalla. Se migra lo que ya existe; no se rediseña ninguna pantalla.

**Tech Stack:** Next.js 15, Tailwind CSS v4 (`@theme inline`), React, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-sistema-visual-design.md` (§3 y §4)

## Global Constraints

- **Español neutral, nunca voseo** — lo verifica `lib/copy/espanol-neutral.test.ts`.
- **Cero emojis**; iconos sólo `lucide-react`.
- **No se rediseña ninguna pantalla en este plan.** Se extrae lo repetido y se migra. Cualquier
  cambio visual que no sea consecuencia directa de unificar es alcance de otro plan.
- **Tailwind v4**: los tokens se declaran en `@theme inline` de `app/globals.css`. Un
  `--text-<nombre>` genera la utilidad `text-<nombre>`.
- Comandos, desde `monitor-app/frontend/`:
  ```
  npx vitest run <ruta>
  npx vitest run
  npx tsc --noEmit
  npm run build
  ```
- **Ningún test cuenta como pasado sin haberlo ejecutado, y ninguno cuenta si no se lo vio fallar
  antes.**

## Lo repetido, medido

| Patrón | Copias a mano | Variantes distintas |
|---|---|---|
| `<h1>` de encabezado de página | 14 | 7 |
| Cifra grande (`text-2xl font-bold`) | 5 | 3 |
| Estados vacíos escritos a mano | 48 | — |
| `Loader2` suelto | 138 | — |

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `app/globals.css` | Tokens de tipografía | 1 |
| `lib/ui/escala.test.ts` | Guardia: nada por debajo de 11 px, sin tamaños fuera de escala | 1 |
| `components/ui/EncabezadoDePagina.tsx` | Título, bajada y acciones | 2 |
| `components/ui/Cifra.tsx` | El número con su etiqueta | 3 |
| `components/ui/Estado.tsx` | Vacío, cargando y error de bloque | 4 |

---

## Task 1: Los tokens, y el guardia de la escala

**Files:**
- Modify: `monitor-app/frontend/app/globals.css`
- Create: `monitor-app/frontend/lib/ui/escala.test.ts`

**Interfaces:**
- Produces: las utilidades `text-etiqueta`, `text-dato`, `text-lectura`, `text-titulo`,
  `text-cifra`. Las tareas 2, 3 y 4 las usan.

- [ ] **Step 1: Escribir el guardia que falla**

Crear `monitor-app/frontend/lib/ui/escala.test.ts`:

```ts
// @vitest-environment node
/**
 * La auditoria del 2026-08-16 midio 8-9 tamanos de letra por pantalla, con
 * 428 elementos a 10px o menos en el Monitor (152 a 9px, 28 a 8px). Eso no
 * es jerarquia, es ruido — y es la causa principal de que la app se lea
 * como tosca.
 *
 * Este test no impide usar Tailwind: impide seguir bajando. Cualquier
 * `text-[9px]` o `text-[10px]` nuevo rompe la suite.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}

const archivos = () => ['app', 'components'].flatMap((d) => recorrer(join(RAIZ, d)))

describe('la escala tipografica', () => {
  it('encuentra archivos que revisar', () => {
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('no usa tamanos por debajo de 11px', () => {
    const hallazgos: string[] = []
    for (const ruta of archivos()) {
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        // text-[8px] .. text-[10px] — el tamano arbitrario, que es por donde
        // se cuela lo ilegible.
        const m = linea.match(/text-\[(\d+)px\]/g)
        if (!m) return
        for (const hit of m) {
          const px = Number(hit.match(/\d+/)![0])
          if (px < 11) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} → ${hit}`)
        }
      })
    }
    expect(hallazgos, `Tamanos por debajo de 11px:\n${hallazgos.join('\n')}`).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y ver cuántos hay**

```
cd monitor-app/frontend
npx vitest run lib/ui/escala.test.ts
```

Anotar el número. **Si son más de 30, no corregirlos todos en esta tarea**: subir el umbral del
test a lo que hay hoy con un comentario que lo diga (`// deuda: N casos, se bajan al migrar cada
pantalla`) y bajarlo en las tareas siguientes. Un test que nadie puede poner en verde se termina
borrando.

- [ ] **Step 3: Agregar los tokens**

En `app/globals.css`, dentro de `@theme inline`, después de las fuentes:

```css
  /* ── Escala tipografica ───────────────────────────────────────
     Cinco pasos elegidos, contra los 8-9 improvisados que midio la
     auditoria del 2026-08-16. El nombre dice el ROL, no el tamano:
     renombrar un rol no obliga a buscar "text-xs" por todo el codigo.

     Nada por debajo de 11px. En el Monitor habia 428 elementos a 10px
     o menos — 152 a 9px y 28 a 8px. */
  --text-etiqueta: 0.6875rem;  /* 11px — encabezado de columna, eyebrow */
  --text-dato:     0.8125rem;  /* 13px — el texto de las tablas, el default */
  --text-lectura:  0.9375rem;  /* 15px — parrafos, descripciones, ayuda */
  --text-titulo:   1.25rem;    /* 20px — titulo de seccion o tarjeta */
  --text-cifra:    1.75rem;    /* 28px — la cifra grande y el titulo de pagina */
```

- [ ] **Step 4: Verificar que Tailwind las genera**

```
npm run build
```

Y comprobar en el CSS emitido que existe la clase:
```
grep -rl "text-dato\|\.text-cifra" .next/static/css/ | head -1
```
Si no aparece, es porque ninguna clase la usa todavía — Tailwind purga. Se confirma en la Tarea 2,
cuando el primer componente la use. **No dar el paso por bueno sin esa confirmación posterior.**

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/app/globals.css monitor-app/frontend/lib/ui/escala.test.ts
git commit -m "feat(ui): la escala tipografica como tokens, y un guardia contra lo ilegible"
```

---

## Task 2: `EncabezadoDePagina`

Catorce `<h1>` escritos a mano con **siete combinaciones distintas** de clases. Cinco módulos usan
`font-mulish font-bold text-xl text-text-primary`; el Cierre ya divergió.

**Files:**
- Create: `components/ui/EncabezadoDePagina.tsx` + `.test.tsx`
- Modify: `app/dashboard/{compliance,insurance,pricing,carriers,admin/settings}/page.tsx`,
  `app/dashboard/operations/closures/page.tsx`

**Interfaces:**
- Consumes: `text-cifra` (Tarea 1).
- Produces:
  ```tsx
  <EncabezadoDePagina
    titulo="Certificación"
    bajada="Qué le falta a cada empresa para estar en condiciones de operar."
    icono={<BadgeCheck size={20} />}   // opcional
  >{/* acciones a la derecha */}</EncabezadoDePagina>
  ```

- [ ] **Step 1: Escribir el test que falla**

`components/ui/EncabezadoDePagina.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EncabezadoDePagina } from './EncabezadoDePagina'

describe('EncabezadoDePagina', () => {
  it('el titulo es el h1 de la pagina', () => {
    render(<EncabezadoDePagina titulo="Certificación" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Certificación')
  })

  it('la bajada es opcional y no deja un parrafo vacio', () => {
    const { container } = render(<EncabezadoDePagina titulo="Seguros" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('las acciones van a la derecha, no dentro del titulo', () => {
    render(
      <EncabezadoDePagina titulo="Tarifario"><button>Nueva tarifa</button></EncabezadoDePagina>,
    )
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).not.toContainElement(screen.getByRole('button', { name: 'Nueva tarifa' }))
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```
npx vitest run components/ui/EncabezadoDePagina.test.tsx
```
Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir el componente**

```tsx
import type { ReactNode } from 'react'

/**
 * Catorce <h1> escritos a mano con siete combinaciones distintas de clases
 * (auditoria 2026-08-16). El encabezado es la primera cosa que ve el usuario
 * en cada modulo: que cada uno se vea distinto es la version mas visible de
 * "no hay sistema".
 */
export function EncabezadoDePagina({
  titulo, bajada, icono, children,
}: {
  titulo: string
  bajada?: string
  icono?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="font-mulish font-bold text-cifra text-text-primary flex items-center gap-2 text-balance">
          {icono}{titulo}
        </h1>
        {bajada && <p className="text-dato text-gray-500 mt-1 max-w-[70ch]">{bajada}</p>}
      </div>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```
npx vitest run components/ui/EncabezadoDePagina.test.tsx
```

- [ ] **Step 5: Migrar los seis encabezados de página**

Uno por uno, reemplazando el `<h1>` y su bajada por el componente, **sin cambiar el texto**. Correr
el test de cada página después de cada migración: varios afirman el título.

```
grep -rn "<h1" app --include="*.tsx" | grep -v test
```
debe bajar de 14 a 8 o menos (quedan los `<h1>` de detalle, que no son encabezado de módulo).

- [ ] **Step 6: Confirmar que Tailwind emite `text-cifra`**

```
npm run build && grep -rc "text-cifra" .next/static/css/*.css | head
```
Debe ser > 0. Es la confirmación que quedó pendiente en la Tarea 1.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/ui/EncabezadoDePagina.tsx \
        monitor-app/frontend/components/ui/EncabezadoDePagina.test.tsx \
        monitor-app/frontend/app
git commit -m "refactor(ui): un solo encabezado de pagina, en vez de siete variantes"
```

---

## Task 3: `Cifra`

**Files:**
- Create: `components/ui/Cifra.tsx` + `.test.tsx`
- Modify: los 5 lugares con `text-2xl font-bold`

**Interfaces:**
- Consumes: `text-cifra` (Tarea 1).
- Produces: `<Cifra valor={2360} etiqueta="documentos por cubrir" cargando={boolean} />`.
  **`cargando` no es decoración**: es la regla del spec §6.2 hecha componente — una cifra derivada
  no se muestra hasta tener el dato.

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Cifra } from './Cifra'

describe('Cifra', () => {
  it('muestra el valor con su etiqueta', () => {
    render(<Cifra valor={2360} etiqueta="documentos por cubrir" />)
    expect(screen.getByText('2360')).toBeInTheDocument()
    expect(screen.getByText('documentos por cubrir')).toBeInTheDocument()
  })

  // El bug real: Certificacion pintaba un "0" grande mientras cargaba y
  // despues saltaba a 2.360.
  it('no muestra nada mientras carga — ni el valor ni la etiqueta', () => {
    render(<Cifra valor={undefined} etiqueta="documentos por cubrir" cargando />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('documentos por cubrir')).not.toBeInTheDocument()
  })

  it('alinea los digitos entre filas', () => {
    render(<Cifra valor={7} etiqueta="equipos" />)
    expect(screen.getByText('7')).toHaveClass('tabular-nums')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**
- [ ] **Step 3: Escribir el componente**

```tsx
/**
 * En un producto donde lo unico que importa son los numeros, los numeros no
 * tenian peso: "37 documentos" se veia igual que la descripcion de al lado.
 *
 * `cargando` no es un detalle de UI. Certificacion mostraba un "0" grande
 * mientras la consulta estaba en vuelo y despues saltaba a 2.360: durante
 * ese segundo afirmaba con seguridad algo falso.
 */
export function Cifra({
  valor, etiqueta, cargando = false, tono = 'normal',
}: {
  valor: number | string | undefined
  etiqueta: string
  cargando?: boolean
  tono?: 'normal' | 'atencion' | 'urgente' | 'resuelto'
}) {
  const color = {
    normal:   'text-text-primary',
    atencion: 'text-espera',
    urgente:  'text-status-incidente',
    resuelto: 'text-resuelto',
  }[tono]

  if (cargando || valor === undefined) {
    return (
      <span
        className="h-7 w-32 rounded bg-gray-100 motion-safe:animate-pulse inline-block"
        aria-hidden
      />
    )
  }

  return (
    <span className="flex items-baseline gap-2">
      <span className={`text-cifra font-bold tabular-nums leading-none ${color}`}>{valor}</span>
      <span className="text-etiqueta text-gray-500">{etiqueta}</span>
    </span>
  )
}
```

- [ ] **Step 4: Correr, migrar los 5 usos, correr la suite de cada pantalla tocada**

En `app/dashboard/compliance/page.tsx`, la migración **reemplaza el bloque manual que se agregó en
el Plan 1** — el componente ya trae esa regla.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/ui/Cifra.tsx \
        monitor-app/frontend/components/ui/Cifra.test.tsx \
        monitor-app/frontend/app monitor-app/frontend/components
git commit -m "feat(ui): la cifra como componente, con la regla de no mostrar lo que no se sabe"
```

---

## Task 4: `Estado` — vacío, cargando y error

48 estados vacíos escritos a mano y 138 `Loader2` sueltos. **No se migran los 138**: muchos son el
spinner dentro de un botón, que es legítimo. Este componente cubre el estado **de bloque** — el que
ocupa el área donde iría el contenido.

**Files:**
- Create: `components/ui/Estado.tsx` + `.test.tsx`
- Modify: los estados de bloque de `compliance`, `closures` y `monitor` (los tres módulos del
  trabajo en curso). El resto se migra al tocar cada pantalla.

**Interfaces:**
- Produces:
  ```tsx
  <Estado tipo="cargando" />
  <Estado tipo="vacio" titulo="Tomamos todas las cargas del día"
          detalle="Ningún viaje quedó sin asignar." accion={<button…/>} />
  <Estado tipo="error" titulo="No se pudo cargar el estado de la certificación" />
  ```

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Estado } from './Estado'

describe('Estado', () => {
  it('cargando no afirma nada — sin texto que se pueda leer como dato', () => {
    render(<Estado tipo="cargando" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('el vacio dice que hacer, no solo que no hay nada', () => {
    render(
      <Estado tipo="vacio" titulo="Tomamos todas las cargas del día"
              detalle="Ningún viaje quedó sin asignar." />,
    )
    expect(screen.getByText('Tomamos todas las cargas del día')).toBeInTheDocument()
    expect(screen.getByText('Ningún viaje quedó sin asignar.')).toBeInTheDocument()
  })

  it('el error explica que paso, y se anuncia', () => {
    render(<Estado tipo="error" titulo="No se pudo cargar el estado" />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el estado')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**
- [ ] **Step 3: Escribir el componente**

Tres variantes en un componente porque **ocupan el mismo lugar y se excluyen**; tenerlos separados
es lo que hizo que en 48 lugares se escribiera sólo uno de los tres. `cargando` usa
`role="status"`, `error` usa `role="alert"`, y ninguno de los dos muestra cifras.

- [ ] **Step 4: Migrar los estados de bloque de los tres módulos, correr sus tests**
- [ ] **Step 5: Commit**

---

## Task 5: Verificar contra los números de la auditoría

No hay código nuevo. Es comprobar que el sistema hizo lo que dice, con el mismo método.

- [ ] **Step 1: Suite, tipos y build**

```
npx vitest run && npx tsc --noEmit && npm run build
```

- [ ] **Step 2: Desplegar a `dev` y medir con Playwright**

A 1440×900, sobre `webcarga-frontend-dev`, en Monitor · Cierre · Certificación · Configuración:

| Métrica | Antes | Meta |
|---|---|---|
| Tamaños de letra por pantalla | 8–9 | ≤ 5 |
| Texto ≤ 11 px | 53–77 % | ≤ 25 % |
| Colores de texto por pantalla | 13–21 | ≤ 8 |

**Si alguna no baja, decirlo con el número**, no darla por buena. La meta de colores probablemente
no se alcance con este plan —requiere migrar los 1.815 usos de color crudo— y eso hay que
reportarlo como lo que es: parcial.

- [ ] **Step 2b: La checklist de pre-entrega**

De `ui-ux-pro-max --design-system`. Verifica lo que las métricas de arriba no miran, y se comprueba
en las cuatro pantallas:

- [ ] Sin emojis como iconos — sólo `lucide-react`
- [ ] `cursor-pointer` en todo lo clickeable
- [ ] Transiciones de hover entre 150 y 300 ms
- [ ] Contraste de texto ≥ 4.5:1
- [ ] Foco visible para navegación por teclado
- [ ] `prefers-reduced-motion` respetado
- [ ] Responsive verificado a 375, 768, 1024 y 1440 px

> **Lo que la skill NO resolvió, y conviene dejar escrito.** `ui-ux-pro-max --design-system`
> propuso un patrón de *landing de marketing* ("Hero, métricas, CTA Start trial") y un estilo
> —*Exaggerated Minimalism*, `font-size: clamp(3rem, 10vw, 12rem)`, "massive whitespace"— cuyo
> propio texto dice que es para moda, arquitectura y portafolios. Es el artefacto equivocado para
> una herramienta interna de 44 filas. Su paleta además **reemplazaría** los tokens que ya existen,
> que tienen sus razones escritas en `globals.css`. Se tomó sólo lo aplicable: **la checklist** y
> **el emparejamiento tipográfico** (Fira Sans + Fira Code — la monoespaciada para patentes, IDs y
> RUT, que es lo que le da carácter de este rubro).

- [ ] **Step 3: Mirar las cuatro pantallas**, en escritorio y en teléfono. Un test no ve un renglón
  que se parte mal.

- [ ] **Step 4: `AGENTLOG.md` + commit**

---

## Lo que sigue

**Plan 3 — El recorrido del Cierre**, que se construye sobre estos componentes.
