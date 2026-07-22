# Product Tour + Video Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un product tour con React Joyride (auto-start primer login + botón manual en Topbar) distribuido en 3 mini-tours por módulo (Diario, Transportistas, Admin), más un script Playwright que graba un video demo del flujo completo.

**Architecture:** `TourProvider` (client component) envuelve el dashboard layout y contiene el estado global del tour en localStorage. Cada módulo tiene sus propias step definitions. Un `TourProgressButton` en el Topbar muestra progreso y permite relanzar. El script `demo.spec.ts` recorre los mismos puntos grabando video.

**Tech Stack:** React Joyride v2.9, Next.js 16 App Router, TypeScript, Playwright, localStorage

**Working directory:** `monitor-app/frontend/`

---

## Mapa de archivos

### Crear
- `hooks/useTour.ts` — estado del tour (activeModule, completedModules, localStorage)
- `components/tour/tourContext.ts` — TourContext tipo + export del hook `useTourContext`
- `components/tour/steps/diario.ts` — 5 step definitions con targets `data-tour`
- `components/tour/steps/transportistas.ts` — 1 step definition
- `components/tour/steps/admin.ts` — 1 step definition
- `components/tour/TourProvider.tsx` — context provider + Joyride + auto-start
- `components/tour/ModuleCompletionPrompt.tsx` — modal de transición entre módulos
- `components/tour/TourProgressButton.tsx` — botón Topbar (progreso + dropdown relanzar)
- `scripts/demo.spec.ts` — Playwright recordVideo

### Modificar
- `app/dashboard/layout.tsx` — envolver children con `<TourProvider>`
- `components/dashboard/Topbar.tsx` — agregar `<TourProgressButton>`
- `components/dashboard/Sidebar.tsx` — agregar `data-tour="sidebar"` al `<aside>`
- `components/dashboard/TripTable.tsx` — agregar `data-tour="trip-table"` al wrapper + `data-tour="trip-slideover-btn"` al primer row
- `app/dashboard/diario/page.tsx` — agregar `data-tour` a filter bar y botón agregar viaje
- `app/dashboard/transportistas/page.tsx` — agregar `data-tour="transportistas-list"`
- `app/dashboard/admin/usuarios/page.tsx` — agregar `data-tour="admin-users"`

---

## Task 1: Instalar react-joyride

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar la dependencia**

```bash
cd monitor-app/frontend && npm install react-joyride
```

Salida esperada: `added 1 package` (o similar, sin errores).

- [ ] **Step 2: Verificar que TypeScript reconoce los tipos**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

Salida esperada: 0 errores.

- [ ] **Step 3: Commit**

```bash
cd monitor-app/frontend && git add package.json package-lock.json && git commit -m "chore(frontend): install react-joyride"
```

---

## Task 2: Crear `hooks/useTour.ts`

**Files:**
- Create: `hooks/useTour.ts`

- [ ] **Step 1: Crear el hook**

Crear `monitor-app/frontend/hooks/useTour.ts` con el siguiente contenido:

```typescript
import { useState, useCallback } from 'react'

export type TourModule = 'diario' | 'transportistas' | 'admin'

const TOUR_SHOWN_KEY    = 'wc_tour_shown_first_time'
const TOUR_COMPLETED_KEY = 'wc_tour_completed_modules'

const TOUR_SEQUENCE: TourModule[] = ['diario', 'transportistas', 'admin']

function readCompleted(): TourModule[] {
  try {
    return JSON.parse(localStorage.getItem(TOUR_COMPLETED_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function useTour() {
  const [activeModule, setActiveModule] = useState<TourModule | null>(null)
  const [completedModules, setCompletedModules] = useState<TourModule[]>(() => {
    if (typeof window === 'undefined') return []
    return readCompleted()
  })
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false)
  const [nextModule, setNextModule] = useState<TourModule | null>(null)

  const wasShown = typeof window !== 'undefined' && !!localStorage.getItem(TOUR_SHOWN_KEY)

  const markShown = useCallback(() => {
    localStorage.setItem(TOUR_SHOWN_KEY, 'true')
  }, [])

  const startTour = useCallback((module: TourModule) => {
    setActiveModule(module)
    setShowCompletionPrompt(false)
  }, [])

  const stopTour = useCallback(() => {
    setActiveModule(null)
  }, [])

  const completeTour = useCallback((module: TourModule) => {
    setActiveModule(null)
    setCompletedModules(prev => {
      if (prev.includes(module)) return prev
      const next = [...prev, module]
      localStorage.setItem(TOUR_COMPLETED_KEY, JSON.stringify(next))
      return next
    })
    const idx = TOUR_SEQUENCE.indexOf(module)
    const next = TOUR_SEQUENCE[idx + 1] ?? null
    if (next) {
      setNextModule(next)
      setShowCompletionPrompt(true)
    }
  }, [])

  const dismissCompletionPrompt = useCallback(() => {
    setShowCompletionPrompt(false)
    setNextModule(null)
  }, [])

  const resetAll = useCallback(() => {
    localStorage.removeItem(TOUR_SHOWN_KEY)
    localStorage.removeItem(TOUR_COMPLETED_KEY)
    setCompletedModules([])
    setActiveModule(null)
    setShowCompletionPrompt(false)
    setNextModule(null)
  }, [])

  const allCompleted =
    TOUR_SEQUENCE.every(m => completedModules.includes(m))

  return {
    activeModule,
    completedModules,
    showCompletionPrompt,
    nextModule,
    wasShown,
    allCompleted,
    markShown,
    startTour,
    stopTour,
    completeTour,
    dismissCompletionPrompt,
    resetAll,
    TOUR_SEQUENCE,
  }
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

Salida esperada: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add hooks/useTour.ts && git commit -m "feat(tour): add useTour hook with localStorage persistence"
```

---

## Task 3: Crear step definitions

**Files:**
- Create: `components/tour/steps/diario.ts`
- Create: `components/tour/steps/transportistas.ts`
- Create: `components/tour/steps/admin.ts`

- [ ] **Step 1: Crear `components/tour/steps/diario.ts`**

```typescript
import type { Step } from 'react-joyride'

export const diarioSteps: Step[] = [
  {
    target: '[data-tour="sidebar"]',
    title: '🗺️ Navegación principal',
    content: 'Desde aquí navegas entre Diario, Empresas y Administración. El sidebar se puede colapsar para más espacio.',
    disableBeacon: true,
    placement: 'right',
  },
  {
    target: '[data-tour="trip-table"]',
    title: '📋 Tabla de viajes',
    content: 'Aquí están todos los viajes activos del día. Cada fila muestra patente, conductor, EETT, destinos y estado en tiempo real. Haz clic en una fila para ver el detalle completo.',
    placement: 'top',
  },
  {
    target: '[data-tour="trip-filters"]',
    title: '🔍 Filtros y búsqueda',
    content: 'Filtra por estado de grupo, TMS source, flags o busca por patente, conductor o EETT. Los cambios aplican al instante sin recargar la página.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="trip-slideover-btn"]',
    title: '📂 Detalle del viaje',
    content: 'Haz clic en cualquier fila para abrir el detalle: tab Viaje (paradas, tiempos, SAP), tab Empresa (asignación de transportista) y tab Bitácora (notas y estado manual).',
    placement: 'left',
  },
  {
    target: '[data-tour="trip-create-btn"]',
    title: '➕ Agregar viaje',
    content: 'Crea un viaje manualmente o sube un CSV con carga masiva. Útil para registrar viajes que no están sincronizados desde el TMS.',
    placement: 'left',
  },
]
```

- [ ] **Step 2: Crear `components/tour/steps/transportistas.ts`**

```typescript
import type { Step } from 'react-joyride'

export const transportistasSteps: Step[] = [
  {
    target: '[data-tour="transportistas-list"]',
    title: '🏢 Empresas transportistas',
    content: 'Gestiona aquí todas las empresas transportistas. Puedes buscar, ver el perfil de cada empresa y asignarlas a viajes desde el detalle del viaje.',
    disableBeacon: true,
    placement: 'top',
  },
]
```

- [ ] **Step 3: Crear `components/tour/steps/admin.ts`**

```typescript
import type { Step } from 'react-joyride'

export const adminSteps: Step[] = [
  {
    target: '[data-tour="admin-users"]',
    title: '⚙️ Gestión de usuarios',
    content: 'Administra usuarios, roles y permisos. Solo visible para administradores y owners. Los roles definen qué puede ver y editar cada persona.',
    disableBeacon: true,
    placement: 'top',
  },
]
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add components/tour/steps/ && git commit -m "feat(tour): add step definitions for diario, transportistas and admin modules"
```

---

## Task 4: Crear `components/tour/tourContext.ts`

**Files:**
- Create: `components/tour/tourContext.ts`

- [ ] **Step 1: Crear el archivo de contexto**

Crear `monitor-app/frontend/components/tour/tourContext.ts`:

```typescript
import { createContext, useContext } from 'react'
import type { TourModule } from '@/hooks/useTour'

export type { TourModule }

export interface TourContextValue {
  activeModule:          TourModule | null
  completedModules:      TourModule[]
  showCompletionPrompt:  boolean
  nextModule:            TourModule | null
  wasShown:              boolean
  allCompleted:          boolean
  TOUR_SEQUENCE:         TourModule[]
  markShown:             () => void
  startTour:             (module: TourModule) => void
  stopTour:              () => void
  completeTour:          (module: TourModule) => void
  dismissCompletionPrompt: () => void
  resetAll:              () => void
}

export const TourContext = createContext<TourContextValue | null>(null)

export function useTourContext(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTourContext must be used inside TourProvider')
  return ctx
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/tour/tourContext.ts && git commit -m "feat(tour): add TourContext"
```

---

## Task 5: Crear `components/tour/ModuleCompletionPrompt.tsx`

**Files:**
- Create: `components/tour/ModuleCompletionPrompt.tsx`

- [ ] **Step 1: Crear el componente**

Crear `monitor-app/frontend/components/tour/ModuleCompletionPrompt.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTourContext, type TourModule } from './tourContext'

const MODULE_LABELS: Record<TourModule, string> = {
  diario:          'Diario de Viajes',
  transportistas:  'Empresas Transportistas',
  admin:           'Administración',
}

const MODULE_ROUTES: Record<TourModule, string> = {
  diario:          '/dashboard/diario',
  transportistas:  '/dashboard/transportistas',
  admin:           '/dashboard/admin/usuarios',
}

export function ModuleCompletionPrompt() {
  const router = useRouter()
  const { showCompletionPrompt, nextModule, dismissCompletionPrompt, startTour } = useTourContext()

  if (!showCompletionPrompt || !nextModule) return null

  function handleContinue() {
    dismissCompletionPrompt()
    router.push(MODULE_ROUTES[nextModule!])
    // Delay start to let the new page render before Joyride looks for targets
    setTimeout(() => startTour(nextModule!), 600)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <div className="text-3xl mb-3">🎉</div>
        <h2 className="font-mulish font-bold text-lg text-slate-900 mb-2">
          ¡Módulo completado!
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          ¿Quieres continuar al tour de{' '}
          <span className="font-semibold text-slate-700">{MODULE_LABELS[nextModule]}</span>?
        </p>
        <div className="flex gap-3">
          <button
            onClick={dismissCompletionPrompt}
            className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 border border-border rounded-lg hover:bg-gray-50 transition-colors"
          >
            Ahora no
          </button>
          <button
            onClick={handleContinue}
            className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
          >
            Continuar →
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/tour/ModuleCompletionPrompt.tsx && git commit -m "feat(tour): add ModuleCompletionPrompt"
```

---

## Task 6: Crear `components/tour/TourProvider.tsx`

**Files:**
- Create: `components/tour/TourProvider.tsx`

- [ ] **Step 1: Crear el provider**

Crear `monitor-app/frontend/components/tour/TourProvider.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import Joyride, { type CallBackProps, type Step, STATUS } from 'react-joyride'
import { TourContext, type TourModule } from './tourContext'
import { useTour } from '@/hooks/useTour'
import { ModuleCompletionPrompt } from './ModuleCompletionPrompt'
import { diarioSteps } from './steps/diario'
import { transportistasSteps } from './steps/transportistas'
import { adminSteps } from './steps/admin'

const MODULE_STEPS: Record<TourModule, Step[]> = {
  diario:         diarioSteps,
  transportistas: transportistasSteps,
  admin:          adminSteps,
}

const JOYRIDE_STYLES = {
  options: {
    primaryColor: '#1cb9ec',
    zIndex: 9000,
  },
}

const JOYRIDE_LOCALE = {
  back:  'Atrás',
  close: 'Cerrar',
  last:  'Finalizar',
  next:  'Siguiente →',
  skip:  'Saltar tour',
}

interface TourProviderProps {
  children: React.ReactNode
}

export function TourProvider({ children }: TourProviderProps) {
  const tour = useTour()

  // Auto-start on first visit
  useEffect(() => {
    if (!tour.wasShown) {
      tour.markShown()
      const timer = setTimeout(() => tour.startTour('diario'), 800)
      return () => clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleJoyrideCallback(data: CallBackProps) {
    const { status } = data
    const finished = ([STATUS.FINISHED, STATUS.SKIPPED] as string[]).includes(status)
    if (finished && tour.activeModule) {
      if (status === STATUS.FINISHED) {
        tour.completeTour(tour.activeModule)
      } else {
        tour.stopTour()
      }
    }
  }

  const steps = tour.activeModule ? MODULE_STEPS[tour.activeModule] : []

  return (
    <TourContext.Provider value={tour}>
      <Joyride
        steps={steps}
        run={tour.activeModule !== null}
        continuous
        showSkipButton
        showProgress
        styles={JOYRIDE_STYLES}
        locale={JOYRIDE_LOCALE}
        callback={handleJoyrideCallback}
      />
      <ModuleCompletionPrompt />
      {children}
    </TourContext.Provider>
  )
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/tour/TourProvider.tsx && git commit -m "feat(tour): add TourProvider with Joyride + auto-start"
```

---

## Task 7: Crear `components/tour/TourProgressButton.tsx`

**Files:**
- Create: `components/tour/TourProgressButton.tsx`

- [ ] **Step 1: Crear el componente**

Crear `monitor-app/frontend/components/tour/TourProgressButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Map } from 'lucide-react'
import { useTourContext, type TourModule } from './tourContext'

const MODULE_LABELS: Record<TourModule, string> = {
  diario:         'Diario de Viajes',
  transportistas: 'Empresas',
  admin:          'Administración',
}

export function TourProgressButton() {
  const [open, setOpen] = useState(false)
  const { completedModules, startTour, resetAll, allCompleted, TOUR_SEQUENCE } = useTourContext()

  const completedCount = completedModules.length
  const totalCount = TOUR_SEQUENCE.length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        title={allCompleted ? 'Repetir tour' : `Tour: ${completedCount}/${totalCount} módulos`}
      >
        <Map size={17} className="text-gray-500" />
        {!allCompleted && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {completedCount}/{totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 bg-white border border-border rounded-xl shadow-lg z-50 w-52 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border/60">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              {allCompleted ? 'Tour completado 🎉' : `Tour guiado · ${completedCount}/${totalCount}`}
            </p>
          </div>
          {TOUR_SEQUENCE.map(module => {
            const done = completedModules.includes(module)
            return (
              <button
                key={module}
                onClick={() => { setOpen(false); startTour(module) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-gray-50 transition-colors text-left"
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                  done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                }`}>
                  {done ? '✓' : '○'}
                </span>
                {MODULE_LABELS[module]}
              </button>
            )
          })}
          {allCompleted && (
            <button
              onClick={() => { setOpen(false); resetAll(); startTour('diario') }}
              className="w-full px-3 py-2.5 text-xs font-medium text-accent hover:bg-accent/5 transition-colors text-left border-t border-border/60"
            >
              Repetir tour completo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/tour/TourProgressButton.tsx && git commit -m "feat(tour): add TourProgressButton with module progress dropdown"
```

---

## Task 8: Agregar `data-tour` a componentes existentes

**Files:**
- Modify: `components/dashboard/Sidebar.tsx`
- Modify: `components/dashboard/TripTable.tsx`
- Modify: `app/dashboard/diario/page.tsx`
- Modify: `app/dashboard/transportistas/page.tsx`
- Modify: `app/dashboard/admin/usuarios/page.tsx`

### Sidebar

- [ ] **Step 1: Agregar `data-tour="sidebar"` al `<aside>` desktop**

En `components/dashboard/Sidebar.tsx`, localizar la línea:
```tsx
<aside className={`hidden md:flex ${collapsed ? 'w-[60px]' : 'w-[220px]'} bg-sidebar min-h-screen flex-col shrink-0 transition-[width] duration-200 ease-out`}>
```

Reemplazar con:
```tsx
<aside data-tour="sidebar" className={`hidden md:flex ${collapsed ? 'w-[60px]' : 'w-[220px]'} bg-sidebar min-h-screen flex-col shrink-0 transition-[width] duration-200 ease-out`}>
```

### TripTable

- [ ] **Step 2: Agregar `data-tour="trip-table"` al wrapper del table desktop**

En `components/dashboard/TripTable.tsx`, localizar:
```tsx
<div className="hidden md:block overflow-x-auto">
  <table className="w-full text-sm" style={{ minWidth: 1080 }}>
```

Reemplazar con:
```tsx
<div data-tour="trip-table" className="hidden md:block overflow-x-auto">
  <table className="w-full text-sm" style={{ minWidth: 1080 }}>
```

- [ ] **Step 3: Agregar `data-tour="trip-slideover-btn"` al primer `<tr>` del tbody**

En `components/dashboard/TripTable.tsx`, localizar:
```tsx
<tr
  key={trip.id}
  onClick={() => onSelect(trip)}
  className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
```

Reemplazar con (agregar `{...(i === 0 ? { 'data-tour': 'trip-slideover-btn' } : {})}`):
```tsx
<tr
  key={trip.id}
  onClick={() => onSelect(trip)}
  {...(i === 0 ? { 'data-tour': 'trip-slideover-btn' } : {})}
  className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
```

### Diario page

- [ ] **Step 4: Agregar `data-tour="trip-filters"` al filter bar**

En `app/dashboard/diario/page.tsx`, localizar:
```tsx
{/* ── Filter bar ───────────────────────────────────────────── */}
<div className="bg-white border border-border rounded-xl px-3.5 py-3 space-y-3">
```

Reemplazar con:
```tsx
{/* ── Filter bar ───────────────────────────────────────────── */}
<div data-tour="trip-filters" className="bg-white border border-border rounded-xl px-3.5 py-3 space-y-3">
```

- [ ] **Step 5: Agregar `data-tour="trip-create-btn"` al botón "Agregar viaje"**

En `app/dashboard/diario/page.tsx`, localizar:
```tsx
<button
  onClick={() => setShowAddMenu(v => !v)}
  onBlur={() => setTimeout(() => setShowAddMenu(false), 150)}
  className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
>
```

Reemplazar con:
```tsx
<button
  data-tour="trip-create-btn"
  onClick={() => setShowAddMenu(v => !v)}
  onBlur={() => setTimeout(() => setShowAddMenu(false), 150)}
  className="flex items-center gap-2 bg-accent text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
>
```

### Transportistas page

- [ ] **Step 6: Agregar `data-tour="transportistas-list"` al contenedor principal de la lista**

En `app/dashboard/transportistas/page.tsx`, localizar el `<div>` principal que envuelve la lista de empresas (buscar el `return (` y la primera `<div>` significativa que contenga los items). Agregar el atributo al div que rodea los cards/items. Ejemplo:

Localizar:
```tsx
return (
  <div className="min-h-full bg-gray-50/40">
```

Reemplazar con:
```tsx
return (
  <div data-tour="transportistas-list" className="min-h-full bg-gray-50/40">
```

### Admin usuarios page

- [ ] **Step 7: Agregar `data-tour="admin-users"` al contenedor de la tabla de usuarios**

En `app/dashboard/admin/usuarios/page.tsx`, localizar:
```tsx
<div className="max-w-5xl mx-auto px-6 mt-4">
  <div className="bg-white rounded-xl border border-border px-5 py-4">
```

Reemplazar con:
```tsx
<div data-tour="admin-users" className="max-w-5xl mx-auto px-6 mt-4">
  <div className="bg-white rounded-xl border border-border px-5 py-4">
```

- [ ] **Step 8: Verificar TypeScript**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9: Commit**

```bash
git add components/dashboard/Sidebar.tsx components/dashboard/TripTable.tsx \
  app/dashboard/diario/page.tsx app/dashboard/transportistas/page.tsx \
  app/dashboard/admin/usuarios/page.tsx && \
git commit -m "feat(tour): add data-tour attributes to target elements"
```

---

## Task 9: Integrar TourProvider en el dashboard layout

**Files:**
- Modify: `app/dashboard/layout.tsx`

- [ ] **Step 1: Importar y envolver children con TourProvider**

En `app/dashboard/layout.tsx`, el archivo actual es:
```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/dashboard/Sidebar'
import Topbar from '@/components/dashboard/Topbar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (profile?.active === false) redirect('/login?error=cuenta_desactivada')

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={profile?.role} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Topbar />
        {/* pb-16 md:pb-0: space for mobile bottom nav */}
        <main className="flex-1 overflow-y-auto bg-bg-main pb-16 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  )
}
```

Reemplazar con:
```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/dashboard/Sidebar'
import Topbar from '@/components/dashboard/Topbar'
import { TourProvider } from '@/components/tour/TourProvider'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .single()

  if (profile?.active === false) redirect('/login?error=cuenta_desactivada')

  return (
    <TourProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar role={profile?.role} />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Topbar />
          {/* pb-16 md:pb-0: space for mobile bottom nav */}
          <main className="flex-1 overflow-y-auto bg-bg-main pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </div>
    </TourProvider>
  )
}
```

- [ ] **Step 2: Verificar TypeScript y build**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20
```

Salida esperada: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/layout.tsx && git commit -m "feat(tour): wrap dashboard layout with TourProvider"
```

---

## Task 10: Agregar TourProgressButton al Topbar

**Files:**
- Modify: `components/dashboard/Topbar.tsx`

- [ ] **Step 1: Importar y agregar TourProgressButton**

En `components/dashboard/Topbar.tsx`, el archivo actual tiene esta sección:
```tsx
<div className="flex items-center gap-2.5 ml-auto">
  <button className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Notificaciones">
    <Bell size={17} className="text-gray-500" />
  </button>
```

Reemplazar con (agregar import al inicio del archivo y el componente junto a Bell):
```tsx
import { createClient } from '@/lib/supabase/server'
import { Bell } from 'lucide-react'
import { TourProgressButton } from '@/components/tour/TourProgressButton'

export default async function Topbar() {
  // ... resto sin cambios hasta:

      <div className="flex items-center gap-2.5 ml-auto">
        <TourProgressButton />
        <button className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Notificaciones">
          <Bell size={17} className="text-gray-500" />
        </button>
```

El archivo completo modificado debe ser:

```tsx
import { createClient } from '@/lib/supabase/server'
import { Bell } from 'lucide-react'
import { TourProgressButton } from '@/components/tour/TourProgressButton'

export default async function Topbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user?.id ?? '')
    .single()

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'Usuario'
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <header className="h-14 bg-white border-b border-border flex items-center px-4 md:px-6 shrink-0 gap-3">
      {/* Mobile brand — visible only when sidebar is hidden */}
      <div className="md:hidden flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shadow">
          <span className="text-white font-mulish font-bold text-xs">W</span>
        </div>
        <span className="font-mulish font-bold text-sm text-text-primary">WebCarga</span>
      </div>

      {/* Spacer on desktop (breadcrumb placeholder) */}
      <div className="hidden md:block flex-1" />

      <div className="flex items-center gap-2.5 ml-auto">
        <TourProgressButton />
        <button className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title="Notificaciones">
          <Bell size={17} className="text-gray-500" />
        </button>

        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold"
            style={{ background: 'linear-gradient(135deg, #1cb9ec 0%, #0e8db5 100%)' }}
          >
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-text-primary leading-tight">{displayName}</p>
            <p className="text-xs text-gray-400 capitalize">{profile?.role ?? 'operador'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Verificar TypeScript y build**

```bash
cd monitor-app/frontend && npx tsc --noEmit 2>&1 | head -20 && npm run build 2>&1 | tail -20
```

Salida esperada: 0 errores TypeScript, build verde.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/Topbar.tsx && git commit -m "feat(tour): add TourProgressButton to Topbar"
```

---

## Task 11: Crear script Playwright `scripts/demo.spec.ts`

**Files:**
- Create: `scripts/demo.spec.ts`

- [ ] **Step 1: Verificar que Playwright esté instalado**

```bash
cd monitor-app/frontend && npx playwright --version 2>&1
```

Si no está instalado: `npm install -D @playwright/test && npx playwright install chromium`

- [ ] **Step 2: Crear `scripts/demo.spec.ts`**

Crear `monitor-app/frontend/scripts/demo.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

const EMAIL    = process.env.DEMO_EMAIL    ?? ''
const PASSWORD = process.env.DEMO_PASSWORD ?? ''

test('demo tour completo', async ({ page }) => {
  // ── 1. Login ──────────────────────────────────────────────────
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/**', { timeout: 15000 })
  await page.waitForTimeout(1500)

  // Dismiss tour auto-start si aparece (clic en Skip)
  const skipBtn = page.locator('button:has-text("Saltar tour")')
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click()
  }

  // ── 2. Sidebar ────────────────────────────────────────────────
  await page.waitForSelector('[data-tour="sidebar"]')
  await page.hover('[data-tour="sidebar"]')
  await page.waitForTimeout(600)

  // ── 3. Diario — tabla de viajes ───────────────────────────────
  await page.goto('/dashboard/diario')
  await page.waitForSelector('[data-tour="trip-table"]', { timeout: 10000 })
  await page.waitForTimeout(1000)

  // Scroll suave por la tabla
  await page.evaluate(() => {
    document.querySelector('[data-tour="trip-table"]')?.scrollIntoView({ behavior: 'smooth' })
  })
  await page.waitForTimeout(800)

  // ── 4. Filtros ────────────────────────────────────────────────
  await page.waitForSelector('[data-tour="trip-filters"]')
  await page.hover('[data-tour="trip-filters"]')
  await page.waitForTimeout(600)

  // Interactuar con la búsqueda
  const searchInput = page.locator('[data-tour="trip-filters"] input[type="text"]').first()
  if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchInput.click()
    await searchInput.type('test', { delay: 80 })
    await page.waitForTimeout(500)
    await searchInput.clear()
    await page.waitForTimeout(400)
  }

  // ── 5. SlideOver — detalle del viaje ──────────────────────────
  const firstRow = page.locator('[data-tour="trip-slideover-btn"]')
  if (await firstRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstRow.click()
    await page.waitForTimeout(800)

    // Navegar los 3 tabs del SlideOver
    const tabs = page.locator('[role="tab"], button:has-text("Empresa"), button:has-text("Bitácora")')
    const tabCount = await tabs.count()
    for (let i = 0; i < Math.min(tabCount, 3); i++) {
      await tabs.nth(i).click({ force: true })
      await page.waitForTimeout(600)
    }

    // Cerrar SlideOver (buscar botón X o Escape)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }

  // ── 6. Botón Agregar viaje ────────────────────────────────────
  const addBtn = page.locator('[data-tour="trip-create-btn"]')
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.hover()
    await page.waitForTimeout(600)
  }

  // ── 7. Transportistas ─────────────────────────────────────────
  await page.goto('/dashboard/transportistas')
  await page.waitForSelector('[data-tour="transportistas-list"]', { timeout: 10000 })
  await page.waitForTimeout(800)

  // Scroll por la lista
  await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }))
  await page.waitForTimeout(600)
  await page.evaluate(() => window.scrollBy({ top: -300, behavior: 'smooth' }))
  await page.waitForTimeout(400)

  // ── 8. Admin ──────────────────────────────────────────────────
  await page.goto('/dashboard/admin/usuarios')
  const adminSection = page.locator('[data-tour="admin-users"]')
  if (await adminSection.isVisible({ timeout: 5000 }).catch(() => false)) {
    await adminSection.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1200)
  }

  // ── 9. Pausa final ────────────────────────────────────────────
  await page.waitForTimeout(2000)
})
```

- [ ] **Step 3: Crear/actualizar configuración Playwright**

Verificar si existe `playwright.config.ts`:

```bash
ls monitor-app/frontend/playwright.config.ts 2>/dev/null && echo "existe" || echo "no existe"
```

Si **no existe**, crear `monitor-app/frontend/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './scripts',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    video: 'on',
    viewport: { width: 1280, height: 800 },
  },
  reporter: [['html', { open: 'never' }]],
})
```

Si **ya existe**, agregar `video: 'on'` al bloque `use:` existente.

- [ ] **Step 4: Agregar variables a `.env.local`**

Abrir `monitor-app/frontend/.env.local` y agregar al final:

```
DEMO_EMAIL=tu_email_de_demo@webcarga.com
DEMO_PASSWORD=tu_password_de_demo
```

Reemplazar con credenciales reales de una cuenta de demo.

- [ ] **Step 5: Correr el script (con servidor corriendo)**

En una terminal separada: `cd monitor-app/frontend && npm run dev`

Luego:

```bash
cd monitor-app/frontend && npx playwright test scripts/demo.spec.ts --headed
```

Salida esperada: `1 passed`. El video queda en `test-results/demo-tour-completo-*/video.webm`.

- [ ] **Step 6: Commit**

```bash
git add scripts/demo.spec.ts playwright.config.ts && git commit -m "feat(tour): add Playwright video demo script"
```

---

## Task 12: Verificación manual completa

- [ ] **Step 1: Iniciar el servidor de desarrollo**

```bash
cd monitor-app/frontend && npm run dev
```

- [ ] **Step 2: Abrir la app en modo incógnito (simula primer login)**

Abrir `http://localhost:3000` en una ventana incógnita. Hacer login.

- [ ] **Step 3: Verificar auto-start del tour**

Después de ~800ms debe aparecer el tooltip de Joyride anclado al sidebar. Verificar:
- El tooltip tiene texto "🗺️ Navegación principal"
- Los botones "Saltar tour" y "Siguiente →" funcionan
- Se puede navegar por los 5 pasos del módulo Diario

- [ ] **Step 4: Verificar ModuleCompletionPrompt**

Al completar el módulo Diario (clic en "Finalizar"), debe aparecer el modal de completado con el botón "Continuar →" hacia Transportistas.

- [ ] **Step 5: Verificar TourProgressButton**

En la Topbar debe aparecer el ícono del mapa con badge `0/3`. Al hacer clic, dropdown con los 3 módulos. Verificar que relanzar un módulo ya completado funciona.

- [ ] **Step 6: Verificar persistencia**

Recargar la página. Verificar que el tour NO se auto-inicia de nuevo (ya fue marcado como visto). Verificar que el progreso en el TourProgressButton se mantiene.

- [ ] **Step 7: Verificar `npm run build`**

```bash
cd monitor-app/frontend && npm run build 2>&1 | tail -20
```

Salida esperada: build verde, 0 errores.

---

## Checklist de criterios de aceptación

- [ ] Tour se auto-inicia en primer login y no vuelve a aparecer solo
- [ ] Botón en Topbar permite relanzar cada módulo individualmente
- [ ] Progreso persiste entre recargas (localStorage)
- [ ] Al completar Admin aparece finalización (no hay módulo siguiente)
- [ ] "Saltar tour" detiene el tour sin completarlo
- [ ] El script Playwright corre sin errores y produce `video.webm`
- [ ] `npm run build` — 0 errores TypeScript
