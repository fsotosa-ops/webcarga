# Normalización de Rutas (Operaciones + Carriers/Insurance/Pricing) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover las rutas del frontend a nomenclatura en inglés (`/dashboard/operations/{monitor,closures}`, `/dashboard/carriers`, `/dashboard/insurance`, `/dashboard/pricing`), actualizar el Sidebar y todos los deep-links internos, y eliminar las rutas viejas en español sin dejar redirects — según `docs/superpowers/specs/2026-07-28-operations-routes-normalization-design.md`.

**Architecture:** Este es un refactor mecánico de rutas/labels, no una feature nueva — no hay lógica de negocio que cambie. Por eso el ciclo de cada tarea no es RED→GREEN clásico (no hay comportamiento nuevo que testear primero); es: **mover/crear archivos → actualizar referencias → correr los tests afectados y `tsc` para confirmar que nada se rompió → commit**. Todos los imports dentro de las páginas movidas usan alias `@/...` (no relativos), así que mover directorios no rompe imports.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Vitest, React Testing Library. Todos los comandos de este plan asumen que el directorio de trabajo es `monitor-app/frontend/` dentro del repo — usar `cd monitor-app/frontend &&` si el shell no está posicionado ahí.

## Global Constraints

- Slugs de URL en inglés; labels visibles en el Sidebar/UI se mantienen en español (ver spec, sección "Nomenclatura confirmada").
- Corte limpio: las rutas viejas se eliminan por completo, sin redirect legacy — visitarlas debe dar 404.
- No renombrar identificadores internos de código (hooks, nombres de componentes, `type Tab`, valores de `?tab=`/`?q=`) — solo rutas y labels visibles.
- Cada task debe dejar el repo en estado buildable: `npx tsc --noEmit` sin errores y `npm test` en verde antes de pasar a la siguiente task.

---

### Task 1: Rutas del hub Operaciones — mover archivos, redirect, eliminar rutas viejas

**Files:**
- Create (via `git mv`): `app/dashboard/operations/monitor/page.tsx` (desde `app/dashboard/diario/page.tsx`)
- Create (via `git mv`): `app/dashboard/operations/closures/page.tsx` (desde `app/dashboard/diario/reporteria/page.tsx`)
- Create (via `git mv`): `app/dashboard/operations/closures/page.test.tsx` (desde `app/dashboard/diario/reporteria/page.test.tsx`)
- Create: `app/dashboard/operations/page.tsx` (nuevo redirect)
- Delete: `app/dashboard/operaciones/page.tsx` (stub viejo)
- Delete (implícito tras los `git mv`, el directorio queda vacío): `app/dashboard/diario/`

**Interfaces:**
- Produces: rutas `/dashboard/operations/monitor` y `/dashboard/operations/closures` funcionando con el contenido actual sin cambios. `/dashboard/operations` redirige a `/dashboard/operations/monitor`.

- [ ] **Step 1: Mover los archivos con `git mv`**

```bash
cd monitor-app/frontend
mkdir -p app/dashboard/operations/monitor
mkdir -p app/dashboard/operations/closures
git mv app/dashboard/diario/page.tsx app/dashboard/operations/monitor/page.tsx
git mv app/dashboard/diario/reporteria/page.tsx app/dashboard/operations/closures/page.tsx
git mv app/dashboard/diario/reporteria/page.test.tsx app/dashboard/operations/closures/page.test.tsx
git rm app/dashboard/operaciones/page.tsx
```

- [ ] **Step 2: Crear el nuevo redirect del hub**

Crear `app/dashboard/operations/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default function OperationsPage() {
  redirect('/dashboard/operations/monitor')
}
```

- [ ] **Step 3: Confirmar que no quedó nada bajo `app/dashboard/diario/` ni `app/dashboard/operaciones/`**

Run: `find app/dashboard/diario app/dashboard/operaciones 2>&1`
Expected: `find: app/dashboard/diario: No such file or directory` y `find: app/dashboard/operaciones: No such file or directory` (ambos directorios ya no existen)

- [ ] **Step 4: Correr el test movido y `tsc`**

Run: `npx vitest run app/dashboard/operations/closures/page.test.tsx`
Expected: PASS (mismos tests que antes, sin cambios de contenido)

Run: `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a estas rutas (en este punto el Sidebar y los entry points todavía apuntan a `/dashboard/diario` — eso se corrige en las próximas 2 tasks, no genera error de tipos porque son strings, solo un link roto en runtime hasta la Task 3)

- [ ] **Step 5: Commit**

```bash
git add -A app/dashboard/operations app/dashboard/diario app/dashboard/operaciones
git commit -m "refactor: mover rutas de Diario/Reportería a /dashboard/operations/{monitor,closures}"
```

---

### Task 2: Sidebar — grupo "Operaciones"

**Files:**
- Modify: `components/dashboard/Sidebar.tsx:13-39`

**Interfaces:**
- Consumes: rutas `/dashboard/operations/monitor` y `/dashboard/operations/closures` (Task 1).
- Produces: Sidebar navegable al hub con los labels nuevos.

- [ ] **Step 1: Actualizar el comentario y el grupo de navegación**

Reemplazar (líneas 13-39 de `components/dashboard/Sidebar.tsx`):

```tsx
// "Monitor de Viajes" agrupa Diario + Reportería bajo un solo item
// expandible — Empresas/Seguros no tienen esa profundidad todavía, se
// quedan planos. "Cerrar el día" (ex-Cuadratura) dejó de ser un item de
// nav — ahora es un botón dentro del propio Diario (spec
// 2026-07-21-cuadratura-reporteria-redesign-design.md).
const MONITOR_GROUP = {
  label: 'Monitor de Viajes',
  icon:  Truck,
  items: [
    { href: '/dashboard/diario',            label: 'Diario' },
    { href: '/dashboard/diario/reporteria', label: 'Reportería' },
  ],
}

const NAV_ITEMS = [
  { href: '/dashboard/transportistas', label: 'Empresas',  icon: Building2 },
  { href: '/dashboard/seguros',        label: 'Seguros',   icon: Shield },
  { href: '/dashboard/tarifario',      label: 'Tarifario', icon: Receipt },
]

// Solo para el bottom nav mobile — sin concepto de dropdown ahí, se listan
// los items de Monitor de Viajes ya aplanados junto a los demás.
const MOBILE_NAV_ITEMS = [
  { href: MONITOR_GROUP.items[0].href, label: MONITOR_GROUP.items[0].label, icon: Truck },
  { href: MONITOR_GROUP.items[1].href, label: MONITOR_GROUP.items[1].label, icon: BarChart3 },
  ...NAV_ITEMS,
]
```

con:

```tsx
// "Operaciones" agrupa Monitor + Cierres bajo un solo item expandible —
// Empresas/Seguros no tienen esa profundidad todavía, se quedan planos.
// "Cerrar el día" (ex-Cuadratura) dejó de ser un item de nav — ahora es
// un botón dentro del propio Monitor (spec
// 2026-07-21-cuadratura-reporteria-redesign-design.md).
const MONITOR_GROUP = {
  label: 'Operaciones',
  icon:  Truck,
  items: [
    { href: '/dashboard/operations/monitor',  label: 'Monitor' },
    { href: '/dashboard/operations/closures', label: 'Cierres' },
  ],
}

const NAV_ITEMS = [
  { href: '/dashboard/transportistas', label: 'Empresas',  icon: Building2 },
  { href: '/dashboard/seguros',        label: 'Seguros',   icon: Shield },
  { href: '/dashboard/tarifario',      label: 'Tarifario', icon: Receipt },
]

// Solo para el bottom nav mobile — sin concepto de dropdown ahí, se listan
// los items de Operaciones ya aplanados junto a los demás.
const MOBILE_NAV_ITEMS = [
  { href: MONITOR_GROUP.items[0].href, label: MONITOR_GROUP.items[0].label, icon: Truck },
  { href: MONITOR_GROUP.items[1].href, label: MONITOR_GROUP.items[1].label, icon: BarChart3 },
  ...NAV_ITEMS,
]
```

(El identificador `MONITOR_GROUP` se deja igual a propósito — es una variable local interna, cambiarla no aporta valor visible y no está en el alcance de este spec.)

- [ ] **Step 2: Actualizar el comentario del matching de ruta activa**

Reemplazar (alrededor de la línea 72-73 actual):

```tsx
  // Match más específico primero (ej. /dashboard/diario/cuadratura no debe
  // también resaltar /dashboard/diario) — evita 2 items activos a la vez.
```

con:

```tsx
  // Match más específico primero (ej. /dashboard/operations/closures no debe
  // también resaltar /dashboard/operations/monitor) — evita 2 items activos a la vez.
```

- [ ] **Step 3: Actualizar la condición del bottom nav mobile**

Reemplazar:

```tsx
          const active = pathname.startsWith(href) && (href !== '/dashboard/diario' || pathname === href)
```

con:

```tsx
          const active = pathname.startsWith(href) && (href !== '/dashboard/operations/monitor' || pathname === href)
```

- [ ] **Step 4: Verificar manualmente en dev**

Run: `npm run dev` (en otra terminal), abrir `/dashboard/operations/monitor` — el Sidebar debe mostrar el grupo "Operaciones" expandido con "Monitor" activo.

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/Sidebar.tsx
git commit -m "refactor: Sidebar — grupo Operaciones (Monitor/Cierres) reemplaza Monitor de Viajes (Diario/Reportería)"
```

---

### Task 3: Entry points de autenticación/proxy — hub Operaciones

**Files:**
- Modify: `proxy.ts:77`
- Modify: `app/auth/callback/route.ts:8`
- Modify: `app/dashboard/admin/layout.tsx:16`
- Modify: `components/auth/LoginForm.tsx:27`
- Modify: `components/auth/RegisterForm.tsx:45`
- Modify: `components/auth/ResetPasswordForm.tsx:58`
- Modify: `app/page.tsx:4`

**Interfaces:**
- Consumes: rutas `/dashboard/operations` y `/dashboard/operations/monitor` (Task 1).

- [ ] **Step 1: `proxy.ts`**

Reemplazar:
```ts
    url.pathname = '/dashboard/diario'
```
con:
```ts
    url.pathname = '/dashboard/operations/monitor'
```

- [ ] **Step 2: `app/auth/callback/route.ts`**

Reemplazar:
```ts
  const next = searchParams.get('next') ?? '/dashboard/diario'
```
con:
```ts
  const next = searchParams.get('next') ?? '/dashboard/operations/monitor'
```

- [ ] **Step 3: `app/dashboard/admin/layout.tsx`**

Reemplazar:
```tsx
  if (profile?.role !== 'admin' && profile?.role !== 'owner') redirect('/dashboard/diario')
```
con:
```tsx
  if (profile?.role !== 'admin' && profile?.role !== 'owner') redirect('/dashboard/operations/monitor')
```

- [ ] **Step 4: `components/auth/LoginForm.tsx`**

Reemplazar:
```tsx
    router.push('/dashboard/diario')
```
con:
```tsx
    router.push('/dashboard/operations/monitor')
```

- [ ] **Step 5: `components/auth/RegisterForm.tsx`**

Reemplazar:
```tsx
      router.push('/dashboard/diario')
```
con:
```tsx
      router.push('/dashboard/operations/monitor')
```

- [ ] **Step 6: `components/auth/ResetPasswordForm.tsx`**

Reemplazar:
```tsx
    setTimeout(() => router.push('/dashboard/operaciones'), 2000)
```
con:
```tsx
    setTimeout(() => router.push('/dashboard/operations/monitor'), 2000)
```

- [ ] **Step 7: `app/page.tsx`**

Reemplazar:
```tsx
  redirect('/dashboard/operaciones')
```
con:
```tsx
  redirect('/dashboard/operations')
```

- [ ] **Step 8: Correr toda la suite y `tsc`**

Run: `npm test`
Expected: PASS (ningún test cubre estos archivos directamente hoy, pero no debe romper nada existente)

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 9: Verificación manual**

Run: `npm run dev`, hacer login con un usuario de prueba → debe aterrizar en `/dashboard/operations/monitor`. Visitar `/` a mano → debe redirigir a `/dashboard/operations` → `/dashboard/operations/monitor`. Visitar `/dashboard/diario` a mano → 404.

- [ ] **Step 10: Commit**

```bash
git add proxy.ts app/auth/callback/route.ts app/dashboard/admin/layout.tsx components/auth/LoginForm.tsx components/auth/RegisterForm.tsx components/auth/ResetPasswordForm.tsx app/page.tsx
git commit -m "refactor: entry points de auth/proxy apuntan a /dashboard/operations/monitor"
```

---

### Task 4: Rutas de Carriers — mover archivos

**Files:**
- Create (via `git mv`): `app/dashboard/carriers/page.tsx` (desde `app/dashboard/transportistas/page.tsx`)
- Create (via `git mv`): `app/dashboard/carriers/[id]/page.tsx` (desde `app/dashboard/transportistas/empresa/[id]/page.tsx`)
- Create (via `git mv`): `app/dashboard/carriers/[id]/page.test.tsx` (desde `app/dashboard/transportistas/empresa/[id]/page.test.tsx`)
- Delete (implícito): `app/dashboard/transportistas/`

**Interfaces:**
- Produces: rutas `/dashboard/carriers` y `/dashboard/carriers/[id]` funcionando con el contenido actual sin cambios (los deep-links que apuntan a las rutas viejas se arreglan en la Task 5, así que hasta terminar esa task habrá links rotos — esperado en un refactor de varias tasks, no se despliega a mitad de plan).

- [ ] **Step 1: Mover los archivos con `git mv`**

```bash
cd monitor-app/frontend
mkdir -p app/dashboard/carriers
git mv app/dashboard/transportistas/page.tsx app/dashboard/carriers/page.tsx
git mv "app/dashboard/transportistas/empresa/[id]" "app/dashboard/carriers/[id]"
```

- [ ] **Step 2: Confirmar que `app/dashboard/transportistas/` ya no existe**

Run: `find app/dashboard/transportistas 2>&1`
Expected: `find: app/dashboard/transportistas: No such file or directory`

- [ ] **Step 3: Correr los tests movidos**

Run: `npx vitest run "app/dashboard/carriers/[id]/page.test.tsx"`
Expected: 1 FAIL (el test de la línea ~305 sigue asertando `'/dashboard/transportistas'`, se corrige en la Task 5) — el resto de los tests del archivo pasan.

- [ ] **Step 4: Commit**

```bash
git add -A app/dashboard/carriers app/dashboard/transportistas
git commit -m "refactor: mover rutas de Transportistas a /dashboard/carriers"
```

---

### Task 5: Carriers — Sidebar, deep-links internos y tests

**Files:**
- Modify: `components/dashboard/Sidebar.tsx` (línea del item "Empresas" en `NAV_ITEMS`)
- Modify: `app/dashboard/carriers/page.tsx` (comentario + `router.push` + `href`)
- Modify: `app/dashboard/carriers/[id]/page.tsx` (`router.push`, 2× `<a href>`)
- Modify: `app/dashboard/carriers/[id]/page.test.tsx` (aserción de la línea ~305)
- Modify: `components/dashboard/CloseDayDialog.tsx:249`
- Modify: `components/dashboard/CloseDayDialog.test.tsx:107`
- Modify: `components/dashboard/TransporterSlideOver.tsx:128`
- Modify: `components/dashboard/TransporterSlideOver.test.tsx:82`
- Modify: `components/dashboard/TripAssignDialog.tsx:333`
- Modify: `components/dashboard/TripSlideOver.tsx:270,604,621,636`
- Modify: `components/dashboard/TripSlideOver.test.tsx:330,340,351`
- Modify: `components/dashboard/TransporterCard.tsx:54`
- Modify: `app/dashboard/seguros/page.tsx` (comentario que menciona `/dashboard/transportistas`)

**Interfaces:**
- Consumes: ruta `/dashboard/carriers` y `/dashboard/carriers/[id]` (Task 4).
- Produces: todos los deep-links de la app apuntando a `/dashboard/carriers` en vez de `/dashboard/transportistas`; tab query params (`?tab=seguros`, `?tab=conductores`) sin cambios.

- [ ] **Step 1: Sidebar — `NAV_ITEMS`**

Reemplazar:
```tsx
  { href: '/dashboard/transportistas', label: 'Empresas',  icon: Building2 },
```
con:
```tsx
  { href: '/dashboard/carriers',       label: 'Empresas',  icon: Building2 },
```

- [ ] **Step 2: `app/dashboard/carriers/page.tsx`**

Reemplazar el comentario:
```tsx
/** Segundo eje de filtrado, independiente de Activas/Inactivo — agrupa por
 *  documentación obligatoria pendiente (mismo criterio que la ficha de
 *  empresa). Los conteos vienen de `facets`, ya acotados a la tab
 *  operational_status + búsqueda actuales (no cambian al clickear un
 *  health tab, igual que en /dashboard/seguros). */
```
con:
```tsx
/** Segundo eje de filtrado, independiente de Activas/Inactivo — agrupa por
 *  documentación obligatoria pendiente (mismo criterio que la ficha de
 *  empresa). Los conteos vienen de `facets`, ya acotados a la tab
 *  operational_status + búsqueda actuales (no cambian al clickear un
 *  health tab, igual que en /dashboard/insurance). */
```

Reemplazar:
```tsx
      router.push(`/dashboard/transportistas/empresa/${created.id}${qs ? `?${qs}` : ''}`)
```
con:
```tsx
      router.push(`/dashboard/carriers/${created.id}${qs ? `?${qs}` : ''}`)
```

Reemplazar:
```tsx
                      <Link
                        href={`/dashboard/transportistas/empresa/${item.id}`}
                        prefetch={false}
```
con:
```tsx
                      <Link
                        href={`/dashboard/carriers/${item.id}`}
                        prefetch={false}
```

- [ ] **Step 3: `app/dashboard/carriers/[id]/page.tsx`**

Reemplazar:
```tsx
    router.push('/dashboard/transportistas')
```
con:
```tsx
    router.push('/dashboard/carriers')
```

Reemplazar:
```tsx
      <a href="/dashboard/transportistas" className="block mt-2 text-accent hover:underline text-xs">← Volver</a>
```
con:
```tsx
      <a href="/dashboard/carriers" className="block mt-2 text-accent hover:underline text-xs">← Volver</a>
```

Reemplazar:
```tsx
        <a href="/dashboard/transportistas" className="hover:text-accent transition-colors shrink-0">Empresas</a>
```
con:
```tsx
        <a href="/dashboard/carriers" className="hover:text-accent transition-colors shrink-0">Empresas</a>
```

- [ ] **Step 4: `app/dashboard/carriers/[id]/page.test.tsx`**

Reemplazar:
```tsx
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/transportistas'))
```
con:
```tsx
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/carriers'))
```

- [ ] **Step 5: `components/dashboard/CloseDayDialog.tsx`**

Reemplazar:
```tsx
                                      href={d.carrier_id ? `/dashboard/transportistas/empresa/${d.carrier_id}` : '/dashboard/transportistas'}
```
con:
```tsx
                                      href={d.carrier_id ? `/dashboard/carriers/${d.carrier_id}` : '/dashboard/carriers'}
```

- [ ] **Step 6: `components/dashboard/CloseDayDialog.test.tsx`**

Reemplazar:
```tsx
    expect(link).toHaveAttribute('href', '/dashboard/transportistas/empresa/c3')
```
con:
```tsx
    expect(link).toHaveAttribute('href', '/dashboard/carriers/c3')
```

- [ ] **Step 7: `components/dashboard/TransporterSlideOver.tsx`**

Reemplazar:
```tsx
              <Link
                href={`/dashboard/transportistas/empresa/${item.id}`}
```
con:
```tsx
              <Link
                href={`/dashboard/carriers/${item.id}`}
```

- [ ] **Step 8: `components/dashboard/TransporterSlideOver.test.tsx`**

Reemplazar:
```tsx
    expect(link).toHaveAttribute('href', '/dashboard/transportistas/empresa/t1')
```
con:
```tsx
    expect(link).toHaveAttribute('href', '/dashboard/carriers/t1')
```

- [ ] **Step 9: `components/dashboard/TripAssignDialog.tsx`**

Reemplazar:
```tsx
                    <a href="/dashboard/transportistas" className="underline font-semibold">Empresas</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
```
con:
```tsx
                    <a href="/dashboard/carriers" className="underline font-semibold">Empresas</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
```

- [ ] **Step 10: `components/dashboard/TripSlideOver.tsx`**

Reemplazar:
```tsx
    return `/dashboard/transportistas?${params.toString()}`
```
con:
```tsx
    return `/dashboard/carriers?${params.toString()}`
```

Reemplazar:
```tsx
                        <a href={`/dashboard/transportistas/empresa/${trip.carrier_id}?tab=seguros`} className="underline hover:text-red-900">
```
con:
```tsx
                        <a href={`/dashboard/carriers/${trip.carrier_id}?tab=seguros`} className="underline hover:text-red-900">
```

Reemplazar (aparece 2 veces idénticas, en el banner de documentación crítica y en el de fleet mismatch — usar `replace_all`):
```tsx
                        <a href={`/dashboard/transportistas/empresa/${trip.carrier_id}?tab=conductores`} className="underline hover:text-red-900">
```
con:
```tsx
                        <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="underline hover:text-red-900">
```

y (el segundo, con clase `hover:text-amber-900`):
```tsx
                        <a href={`/dashboard/transportistas/empresa/${trip.carrier_id}?tab=conductores`} className="underline hover:text-amber-900">
```
con:
```tsx
                        <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="underline hover:text-amber-900">
```

- [ ] **Step 11: `components/dashboard/TripSlideOver.test.tsx`**

Reemplazar (3 ocurrencias, líneas ~330, ~340, ~351):
```tsx
      'href', '/dashboard/transportistas/empresa/c1?tab=conductores',
```
con (`replace_all`, aplica a las 2 ocurrencias con `tab=conductores`):
```tsx
      'href', '/dashboard/carriers/c1?tab=conductores',
```

Reemplazar (la ocurrencia con `tab=seguros`):
```tsx
      'href', '/dashboard/transportistas/empresa/c1?tab=seguros',
```
con:
```tsx
      'href', '/dashboard/carriers/c1?tab=seguros',
```

- [ ] **Step 12: `components/dashboard/TransporterCard.tsx`**

Reemplazar:
```tsx
        <Link
          href={`/dashboard/transportistas/empresa/${item.id}`}
          prefetch={false}
```
con:
```tsx
        <Link
          href={`/dashboard/carriers/${item.id}`}
          prefetch={false}
```

- [ ] **Step 13: `app/dashboard/seguros/page.tsx`**

Reemplazar:
```tsx
  // Conteo del otro status tab, independiente de la paginación y del health
  // tab actual (limit=1: solo interesa `facets.total`) — mismo patrón que
  // Activas/Inactivo en /dashboard/transportistas.
```
con:
```tsx
  // Conteo del otro status tab, independiente de la paginación y del health
  // tab actual (limit=1: solo interesa `facets.total`) — mismo patrón que
  // Activas/Inactivo en /dashboard/carriers.
```

- [ ] **Step 14: Correr toda la suite y `tsc`**

Run: `npm test`
Expected: PASS (0 fallos, incluido el test que falló al final de la Task 4)

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 15: Commit**

```bash
git add components/dashboard/Sidebar.tsx app/dashboard/carriers app/dashboard/seguros/page.tsx components/dashboard/CloseDayDialog.tsx components/dashboard/CloseDayDialog.test.tsx components/dashboard/TransporterSlideOver.tsx components/dashboard/TransporterSlideOver.test.tsx components/dashboard/TripAssignDialog.tsx components/dashboard/TripSlideOver.tsx components/dashboard/TripSlideOver.test.tsx components/dashboard/TransporterCard.tsx
git commit -m "refactor: actualizar deep-links internos y Sidebar a /dashboard/carriers"
```

---

### Task 6: Rutas de Insurance — mover archivo + deep-links

**Files:**
- Create (via `git mv`): `app/dashboard/insurance/page.tsx` (desde `app/dashboard/seguros/page.tsx`)
- Delete (implícito): `app/dashboard/seguros/`
- Modify: `components/dashboard/Sidebar.tsx` (línea del item "Seguros" en `NAV_ITEMS`)
- Modify: `components/dashboard/InsuranceSummaryCard.tsx:17-18,39`
- Modify: `app/dashboard/carriers/[id]/page.tsx:837`

**Interfaces:**
- Produces: ruta `/dashboard/insurance` funcionando con el contenido actual sin cambios; deep-links desde la ficha de carrier y desde `InsuranceSummaryCard` apuntando ahí.

- [ ] **Step 1: Mover el archivo**

```bash
cd monitor-app/frontend
mkdir -p app/dashboard/insurance
git mv app/dashboard/seguros/page.tsx app/dashboard/insurance/page.tsx
```

Confirmar: `find app/dashboard/seguros 2>&1` → `find: app/dashboard/seguros: No such file or directory`

- [ ] **Step 2: Sidebar — `NAV_ITEMS`**

Reemplazar:
```tsx
  { href: '/dashboard/seguros',        label: 'Seguros',   icon: Shield },
```
con:
```tsx
  { href: '/dashboard/insurance',      label: 'Seguros',   icon: Shield },
```

- [ ] **Step 3: `components/dashboard/InsuranceSummaryCard.tsx`**

Reemplazar el comentario:
```tsx
/** Card compacta de Seguros en la ficha de empresa — plan §4.2. Próxima
 *  cuota + cuotas vencidas + % pagado, agregando app.carrier_insurance_status
 *  (ya viene pre-agregado por póliza, sin date-math client-side). Clickeable:
 *  navega a la landing /dashboard/seguros pre-filtrada por tax_id (deep link
 *  vía ?q=), la "landing sincronizada con Empresas" del rediseño H3 —
 *  reemplaza la nota vieja de "sin link a un módulo Seguros separado" de
 *  cuando ese módulo todavía no existía. */
```
con:
```tsx
/** Card compacta de Seguros en la ficha de empresa — plan §4.2. Próxima
 *  cuota + cuotas vencidas + % pagado, agregando app.carrier_insurance_status
 *  (ya viene pre-agregado por póliza, sin date-math client-side). Clickeable:
 *  navega a la landing /dashboard/insurance pre-filtrada por tax_id (deep link
 *  vía ?q=), la "landing sincronizada con Empresas" del rediseño H3 —
 *  reemplaza la nota vieja de "sin link a un módulo Seguros separado" de
 *  cuando ese módulo todavía no existía. */
```

Reemplazar:
```tsx
      href={`/dashboard/seguros?q=${encodeURIComponent(taxId)}`}
```
con:
```tsx
      href={`/dashboard/insurance?q=${encodeURIComponent(taxId)}`}
```

- [ ] **Step 4: `app/dashboard/carriers/[id]/page.tsx`**

Reemplazar:
```tsx
            <Link
              href={`/dashboard/seguros?q=${encodeURIComponent(carrier.tax_id)}`}
```
con:
```tsx
            <Link
              href={`/dashboard/insurance?q=${encodeURIComponent(carrier.tax_id)}`}
```

- [ ] **Step 5: Correr toda la suite y `tsc`**

Run: `npm test`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 6: Commit**

```bash
git add -A app/dashboard/insurance app/dashboard/seguros components/dashboard/Sidebar.tsx components/dashboard/InsuranceSummaryCard.tsx app/dashboard/carriers
git commit -m "refactor: mover rutas de Seguros a /dashboard/insurance"
```

---

### Task 7: Rutas de Pricing — mover archivos

**Files:**
- Create (via `git mv`): `app/dashboard/pricing/page.tsx` (desde `app/dashboard/tarifario/page.tsx`)
- Create (via `git mv`): `app/dashboard/pricing/page.test.tsx` (desde `app/dashboard/tarifario/page.test.tsx`)
- Delete (implícito): `app/dashboard/tarifario/`
- Modify: `components/dashboard/Sidebar.tsx` (línea del item "Tarifario" en `NAV_ITEMS`)

**Interfaces:**
- Produces: ruta `/dashboard/pricing` funcionando con el contenido actual sin cambios. Ningún otro archivo del repo linkea a `/dashboard/tarifario` (verificado con grep durante el brainstorming), así que esta es la única actualización de referencias necesaria además del move.

- [ ] **Step 1: Mover los archivos**

```bash
cd monitor-app/frontend
mkdir -p app/dashboard/pricing
git mv app/dashboard/tarifario/page.tsx app/dashboard/pricing/page.tsx
git mv app/dashboard/tarifario/page.test.tsx app/dashboard/pricing/page.test.tsx
```

Confirmar: `find app/dashboard/tarifario 2>&1` → `find: app/dashboard/tarifario: No such file or directory`

- [ ] **Step 2: Sidebar — `NAV_ITEMS`**

Reemplazar:
```tsx
  { href: '/dashboard/tarifario',      label: 'Tarifario', icon: Receipt },
```
con:
```tsx
  { href: '/dashboard/pricing',        label: 'Tarifario', icon: Receipt },
```

- [ ] **Step 3: Correr el test movido y `tsc`**

Run: `npx vitest run app/dashboard/pricing/page.test.tsx`
Expected: PASS (sin cambios de contenido)

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add -A app/dashboard/pricing app/dashboard/tarifario components/dashboard/Sidebar.tsx
git commit -m "refactor: mover rutas de Tarifario a /dashboard/pricing"
```

---

### Task 8: `demo.spec.ts` + verificación final completa

**Files:**
- Modify: `scripts/demo.spec.ts:27,79`

**Interfaces:**
- Consumes: todas las rutas nuevas (Tasks 1-7).

- [ ] **Step 1: Actualizar el e2e demo tour**

Reemplazar:
```ts
  // ── 3. Diario — tabla de viajes ───────────────────────────────
  await page.goto('/dashboard/diario')
```
con:
```ts
  // ── 3. Monitor — tabla de viajes ──────────────────────────────
  await page.goto('/dashboard/operations/monitor')
```

Reemplazar:
```ts
  // ── 7. Transportistas ─────────────────────────────────────────
  await page.goto('/dashboard/transportistas')
```
con:
```ts
  // ── 7. Transportistas ─────────────────────────────────────────
  await page.goto('/dashboard/carriers')
```

- [ ] **Step 2: Suite completa de tests**

Run: `npm test`
Expected: PASS, mismo número total de tests que antes de empezar el plan (ningún test se perdió, solo se movieron de archivo)

- [ ] **Step 3: Type-check completo**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Build de producción**

Run: `npm run build`
Expected: build exitoso, sin rutas huérfanas ni warnings de imports rotos

- [ ] **Step 5: Verificación manual de 404s en rutas viejas**

Run: `npm run dev` (en otra terminal)

Visitar a mano cada una de estas URLs y confirmar que dan 404 (página "This page could not be found"):
- `/dashboard/diario`
- `/dashboard/diario/reporteria`
- `/dashboard/operaciones`
- `/dashboard/transportistas`
- `/dashboard/transportistas/empresa/cualquier-id`
- `/dashboard/seguros`
- `/dashboard/tarifario`

Y confirmar que las rutas nuevas funcionan de punta a punta:
- `/dashboard/operations` → redirige a `/dashboard/operations/monitor`
- `/dashboard/operations/monitor` → tabla de viajes (contenido de Monitor)
- `/dashboard/operations/closures` → pivot de Cierres
- `/dashboard/carriers` → listado de empresas
- `/dashboard/carriers/<id>` de una empresa real → ficha completa, con las tabs Documentos/Conductores/Equipos/Seguros/Contactos funcionando igual que antes
- `/dashboard/insurance` → landing de Seguros
- `/dashboard/pricing` → Tarifario
- Desde el Monitor: abrir un viaje con póliza vencida o documentación crítica faltante → el link "revisar en Seguros"/"revisar en Empresas" abre `/dashboard/carriers/<id>?tab=seguros` o `?tab=conductores` correctamente

- [ ] **Step 6: Commit**

```bash
git add scripts/demo.spec.ts
git commit -m "refactor: actualizar demo.spec.ts a las rutas normalizadas"
```

---

## Self-Review (completado durante la escritura de este plan)

- **Cobertura del spec**: las 8 secciones numeradas del spec (hub, Sidebar, entry points, carriers, insurance, pricing, deep-links, testing) están cubiertas por las Tasks 1-8. El ítem "fuera de alcance" (tabs internas, identificadores de código) no tiene tareas — correcto, es intencional.
- **Sin placeholders**: cada Step tiene el contenido exacto (código real leído del repo, no descripciones).
- **Consistencia de nombres**: `MONITOR_GROUP` se mantiene como identificador en todas las tasks que tocan `Sidebar.tsx` (Task 2, 5, 6, 7) — no hay drift de nombres entre tasks.
- **Orden verificado**: cada task deja el repo en un estado consistente para la siguiente (rutas movidas antes que sus deep-links/Sidebar), salvo el gap intencional y documentado entre Task 4 y Task 5 (deep-links de carriers temporalmente rotos, corregido en la misma sesión de ejecución, nunca desplegado a mitad de plan).

## Después de este plan

- Actualizar `AGENTLOG.md`: cerrar el ítem 5 del checklist (ya en progreso), marcar la Ronda 55 como implementada.
- Ítem pendiente para otra iteración (ya anotado en AGENTLOG ítem 18): normalizar `?tab=` y el `type Tab` interno de `carriers/[id]/page.tsx`.
- Spec 2 (sesión aparte): `app.equipment_day_status` + rediseño real de "Cierres" con los 3 formatos fijos por cliente.
