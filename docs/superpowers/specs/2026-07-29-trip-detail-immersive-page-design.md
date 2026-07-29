# Detalle de viaje: de modal saturado a página inmersiva

## Contexto

El detalle de viaje (`TripSlideOver.tsx`, 1029 líneas) es hoy un overlay `fixed inset-0` (con `md:inset-4`, esquinas redondeadas y sombra — ya es casi pantalla completa en desktop, no una franja lateral angosta). El usuario reportó que se siente saturado: la tabla técnica de paradas (10 columnas), la Bitácora y el panel de Gestión (360px fijo, siempre expandido) están todos apilados y visibles a la vez.

Se evaluaron 3 objetivos posibles con el usuario y se confirmaron los 3 como parte del alcance:
1. URL propia / compartible / botón atrás del navegador — hoy no existe, es el gap real que un modal (por grande que sea) no puede resolver.
2. Reducir densidad visual — cuánto contenido se renderiza a la vez, no el tamaño del contenedor.
3. Liberar el espacio fijo de 360px de Gestión cuando no hace falta.

Se navegó el brainstorming con mockups visuales (visual companion) para dos decisiones de layout, y con preguntas de texto para el resto. Todas las decisiones abajo fueron confirmadas explícitamente por el usuario.

## Decisiones de diseño

### 1. Patrón de navegación: intercepting routes de Next.js App Router

Al hacer click en una fila desde `/dashboard/operations/monitor`, el detalle se abre como **overlay sobre la tabla** (la tabla sigue montada atrás, sin refetch ni parpadeo) pero la URL cambia de verdad a `/dashboard/operations/monitor/trips/[id]`. Back button funciona de verdad (vuelve a la tabla tal como estaba). Un link compartido o un F5 sobre esa URL, sin venir de `/monitor`, carga la página completa standalone — sin la tabla atrás.

Técnicamente esto es el patrón de *intercepting + parallel routes* nativo de Next.js App Router (el framework que ya usa el proyecto), sin librerías nuevas:

```
app/dashboard/operations/monitor/
  layout.tsx                    ← NUEVO: renderiza {children} + {modal}
  page.tsx                      ← existente, la tabla del Diario
  @modal/
    default.tsx                 ← NUEVO: return null
    (.)trips/[id]/page.tsx      ← NUEVO: overlay, se activa navegando DESDE /monitor
  trips/[id]/
    page.tsx                    ← NUEVO: página completa standalone
```

Hoy no existe ningún `layout.tsx` en `app/dashboard/operations/monitor/` — se crea nuevo. El padre `app/dashboard/layout.tsx` no se toca.

### 2. Componentes

- **`TripDetailView`** (nuevo, `components/dashboard/TripDetailView.tsx`) — el grueso del contenido actual de `TripSlideOver` (header, hero, tabla de paradas, Bitácora, Gestión), sin los divs de backdrop/panel flotante. Props: `trip: Trip`, `onSaved: (updated: Trip) => void`, `onDismiss: () => void` (reemplaza `onClose` — lo llaman el botón X y Escape), `focusNotes?: boolean`. Sin semántica de diálogo (`role="dialog"`, trampa de foco) — eso vive en el wrapper del overlay, no acá. Este componente lo renderizan **ambas** rutas nuevas.
- **`(.)trips/[id]/page.tsx`** — pide el viaje (ver Flujo de datos), envuelve `TripDetailView` con el backdrop + panel flotante de hoy (`fixed inset-0 md:inset-4 md:rounded-2xl md:shadow-2xl`), agrega `role="dialog"` `aria-modal="true"`, trampa de foco (mismo mecanismo que hoy), y pasa `onDismiss={() => router.back()}`.
- **`trips/[id]/page.tsx`** — pide el viaje, envuelve `TripDetailView` en una página normal de ancho completo (sin backdrop, sin esquinas redondeadas, sin trampa de foco), pasa `onDismiss={() => router.push('/dashboard/operations/monitor')}`.
- **`AccordionSection`** (nuevo, `components/dashboard/AccordionSection.tsx`) — `{ title: string, defaultOpen?: boolean, children: ReactNode }`, header clickeable con chevron, `useState` local para abierto/cerrado. Envuelve las secciones "Paradas" (la tabla técnica, sin rediseñar — solo gana ancho completo al no compartir la página con Bitácora/Gestión) y "Bitácora", ambas `defaultOpen`.
- **`GestionPanel`** (nuevo, `components/dashboard/GestionPanel.tsx`) — extraído tal cual del `<aside>` actual (conductor/flota, switches Activo/Trabajando/Asignado, motivo de no asignación). Colapsable por **ancho** (no por alto como el acordeón): expandido por defecto (360px), con un botón que lo achica a un riel angosto con un ícono para reabrirlo. Sin persistencia entre viajes (useState local, se resetea cada vez que se abre un viaje distinto — decisión explícita: "expandido con botón para colapsar", no localStorage).

### 3. Flujo de datos

Cada ruta nueva usa `useQuery(['trip', id], () => tripsApi.get(id))` — `tripsApi.get` ya existe (usado hoy por `handleSelectTrip` en `monitor/page.tsx` para abrir viajes por id desde `CloseDayDialog`/`FleetCenterDialog`). Es necesario porque una *intercepting route* es un árbol de React separado de `/monitor` — no puede recibir el `Trip` ya cargado como prop.

**Optimización de percepción de velocidad**: antes de navegar, el click de fila hace `queryClient.setQueryData(['trip', trip.id], trip)` con el dato que la tabla ya tiene — la ruta interceptada renderiza al toque (sin loading) y revalida en segundo plano. Entrar por link directo sí muestra loading (no hay nada que sembrar).

**Sincronizar ediciones con la lista de fondo**: `handleSaved` en `monitor/page.tsx` ya actualiza `['trips']` a mano cuando se guarda algo (patrón existente, no cambia) — ahora también hace `queryClient.setQueryData(['trip', id], updated)`.

**4 call sites que hoy hacen `setSelected(trip)` y pasan a navegar**:
1. Click de fila en `TripTable` → `router.push('/dashboard/operations/monitor/trips/' + trip.id)`
2. `BitacoraFollowupBadge` → mismo push + `?focus=bitacora`, leído con `useSearchParams()` en vez del prop `focusNotes`
3. `CloseDayDialog` (fila MISMATCH) → mismo push
4. `FleetCenterDialog` ("equipo en viaje hoy") → mismo push

`selected`/`setSelected` y el `<TripSlideOver trip={selected} .../>` al final de `monitor/page.tsx` se eliminan.

### 4. Carga, errores y accesibilidad

- **Loading**: estado nuevo (hoy `trip` siempre llega ya cargado por prop). Skeleton liviano (silueta de header + hero) dentro del wrapper correspondiente. Con la siembra de caché del click, casi nunca se ve viniendo desde la tabla.
- **Error / viaje no encontrado**: estado nuevo (hoy es simplemente `if (!trip) return null`). Mensaje simple + botón "Volver a Monitor".
- **Overlay** (`(.)trips/[id]`): mantiene el patrón dialog de hoy completo — `role="dialog"`, `aria-modal="true"`, trampa de foco con Tab dentro del panel, Escape y click en backdrop llaman `router.back()`, foco se restaura a la fila clickeada al desmontar.
- **Standalone** (`trips/[id]`): página normal, sin ninguno de los mecanismos anteriores.

### 5. Testing y orden de migración

Los 66 tests de `TripSlideOver.test.tsx` portan a `TripDetailView.test.tsx` con cambios mínimos (`onClose`→`onDismiss`, sacar aserciones de `role="dialog"`/backdrop). Tests nuevos aislados para `AccordionSection` y `GestionPanel`. Las páginas de ruta en sí no se testean con vitest/jsdom (routing de Next.js no se presta) — se verifican en vivo con Playwright contra staging.

**Orden** (cada paso commiteable y verde antes de seguir):
1. Extraer `AccordionSection` y `GestionPanel` — sin tocar comportamiento actual.
2. Extraer `TripDetailView` de `TripSlideOver` usando esos dos componentes — `TripSlideOver` queda como wrapper fino sobre `TripDetailView`, la app sigue igual, tests existentes en verde.
3. Rutas nuevas (`layout.tsx` + `@modal` + `(.)trips/[id]` + `trips/[id]`), fetch por id + loading/error.
4. Migrar los 4 call sites de `setSelected` a `router.push`.
5. Borrar `TripSlideOver.tsx` y el estado `selected` de `monitor/page.tsx`.
6. Checklist en vivo contra staging: click de fila → overlay con URL real → back button → link directo en pestaña nueva → guardar un campo y verificar que la lista de fondo lo refleja → badge de Bitácora → CloseDayDialog/FleetCenterDialog.

## Fuera de alcance (decisión explícita del usuario)

- **Rediseño interno de la tabla de 10 columnas** (Plan., GPS Llegada/Salida, Llegada/Salida TR, Desc Inicio/Fin, S2S, °C, On Time) — se mantiene tal cual, incluido el fix de formato 24h recién implementado (overlay `fmtDT()` sobre los inputs `datetime-local`). Darle ancho completo (ya no comparte página con Bitácora/Gestión) alcanza por ahora; un rediseño de la tabla en sí queda para una iteración aparte.
- **Persistencia de la preferencia de colapso de Gestión** entre viajes (localStorage) — se descartó a favor de "expandido por defecto con botón para colapsar", más simple.
