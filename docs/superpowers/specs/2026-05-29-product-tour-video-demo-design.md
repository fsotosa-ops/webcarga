# Product Tour + Script de Video Demo

**Fecha:** 2026-05-29  
**Estado:** Aprobado

---

## Contexto

El frontend (`monitor-app/frontend`) es una app Next.js 16 con Tailwind y los módulos: Diario de Viajes, Transportistas, Conductores, Operaciones y Admin. Se quiere incorporar un product tour interactivo que enseñe a navegar la app, más un script Playwright que genere un video demo para uso externo.

---

## Alcance

### Product tour
- Librería: **React Joyride** (tooltip flotante, sin overlay invasivo)
- 7 pasos distribuidos en 3 módulos
- Trigger automático al primer login + botón manual en Topbar para relanzar
- Mini-tours por módulo con prompts de transición entre ellos
- Estado persistido en **localStorage** únicamente (sin backend, sin migrations)

### Video demo
- Script **Playwright** (`scripts/demo.spec.ts`) con `recordVideo` habilitado
- Recorre el mismo flujo que el tour
- Output: `test-results/demo/video.webm`

---

## Arquitectura

### Archivos nuevos

```
monitor-app/frontend/
  components/
    tour/
      TourProvider.tsx          # Context provider — wraps dashboard layout
      TourProgressButton.tsx    # Botón en Topbar: progreso + dropdown relanzar
      ModuleCompletionPrompt.tsx # Modal "¿Continuar al siguiente módulo?"
      steps/
        diario.ts               # 5 step definitions para /dashboard/diario
        transportistas.ts       # 1 step definition para /dashboard/transportistas
        admin.ts                # 1 step definition para /dashboard/admin
    hooks/
      useTour.ts                # Hook: start, next, complete, reset, estado
  scripts/
    demo.spec.ts                # Playwright recordVideo demo
```

### Archivos modificados

```
monitor-app/frontend/
  app/dashboard/layout.tsx      # Envolver con TourProvider, auto-start primer login
  components/dashboard/Topbar.tsx # Añadir TourProgressButton
  package.json                  # +react-joyride
```

---

## Pasos del tour

| # | Módulo | Target CSS / ref | Texto |
|---|--------|-----------------|-------|
| 1 | Diario | `[data-tour="sidebar"]` | "Navega entre módulos desde aquí" |
| 2 | Diario | `[data-tour="trip-table"]` | "Aquí están todos tus viajes activos con estado en tiempo real" |
| 3 | Diario | `[data-tour="trip-filters"]` | "Filtra por estado, TMS o fecha — los cambios aplican al instante" |
| 4 | Diario | `[data-tour="trip-slideover-btn"]` | "Haz clic en un viaje para ver detalle: Viaje, Empresa y Bitácora" |
| 5 | Diario | `[data-tour="trip-create-btn"]` | "Crea viajes manualmente o carga masiva con CSV" |
| 6 | Transportistas | `[data-tour="transportistas-list"]` | "Gestiona tus empresas transportistas y su asignación a viajes" |
| 7 | Admin | `[data-tour="admin-users"]` | "Administra usuarios y roles — solo visible para administradores" |

Los targets se añaden como atributos `data-tour="..."` en los componentes correspondientes. Sin riesgo de conflicto con estilos o selectores existentes.

---

## Estado en localStorage

```ts
// Claves
const TOUR_SHOWN_KEY = 'wc_tour_shown_first_time'      // boolean
const TOUR_COMPLETED_KEY = 'wc_tour_completed_modules'  // string[] e.g. ["diario","transportistas"]
```

- Al primer mount del dashboard: si `wc_tour_shown_first_time` no existe → auto-start DiarioTour tras 800ms delay → guardar `true`
- Al completar cada módulo: push al array `wc_tour_completed_modules`
- TourProgressButton muestra `✓` en módulos completados y permite relanzar cualquiera

---

## TourProvider

```ts
interface TourState {
  activeModule: 'diario' | 'transportistas' | 'admin' | null
  completedModules: string[]
  startTour: (module: TourModule) => void
  stopTour: () => void
  resetAll: () => void
}
```

`TourProvider` envuelve `app/dashboard/layout.tsx`. Cada página de módulo consume `useTour()` e inicia el tour correspondiente si `activeModule` coincide con la ruta actual.

---

## ModuleCompletionPrompt

Aparece al terminar cada módulo (excepto Admin que es el último). Opciones:
- **"Ahora no"** — cierra, el usuario puede relanzar desde el botón de Topbar
- **"Continuar →"** — navega con `router.push()` al siguiente módulo y lo inicia automáticamente

---

## TourProgressButton (Topbar)

- Icono de mapa/ruta con badge de progreso: `2/3`
- Click → dropdown con los 3 módulos:
  - `✓ Diario` (completado)
  - `✓ Transportistas` (completado)  
  - `Admin` (pendiente, clic para iniciar)
- Siempre visible en la Topbar. Si el tour está completo, muestra "Repetir tour" en lugar del progreso.

---

## Script Playwright: demo.spec.ts

```ts
// Configuración en playwright.config.ts (o inline en el spec):
use: {
  video: 'on',
  viewport: { width: 1280, height: 800 },
  baseURL: 'http://localhost:3000',
}
```

### Flujo del script

1. Navegar a `/login` → llenar email/password → submit
2. Esperar dashboard → pausar 1s (orientación)
3. Hover sobre sidebar items, clic en Diario
4. Scroll por la tabla de viajes → pausar
5. Interactuar con filtros (seleccionar un estado, limpiar)
6. Hacer clic en la primera fila → esperar SlideOver → navegar los 3 tabs
7. Cerrar SlideOver → clic en "Nuevo viaje" → cerrar
8. Clic en "Transportistas" en sidebar → esperar lista → buscar empresa
9. Clic en "Admin" → mostrar usuarios y configuración
10. Pausa final 2s

**Output:** `test-results/demo/video.webm`  
**Comando:** `npx playwright test scripts/demo.spec.ts --headed`

### Credenciales demo
El script lee `DEMO_EMAIL` y `DEMO_PASSWORD` desde `.env.local` — no hardcodeadas en el archivo.

---

## Testing del tour

No se requieren tests unitarios para el tour. Criterios de aceptación:
- [ ] Tour se auto-inicia en primer login y no vuelve a aparecer solo
- [ ] Botón en Topbar permite relanzar cada módulo individualmente
- [ ] Progreso persiste entre recargas de página
- [ ] Al completar Admin aparece mensaje de tour completo
- [ ] El script Playwright corre sin errores y produce `video.webm`
- [ ] El atributo `data-tour` no rompe ningún test existente

---

## Dependencias

| Paquete | Versión | Motivo |
|---------|---------|--------|
| `react-joyride` | `^2.9` | Tour engine |
| `@playwright/test` | ya instalado | Script de video |

Sin dependencias de backend. Sin migrations de Supabase.
