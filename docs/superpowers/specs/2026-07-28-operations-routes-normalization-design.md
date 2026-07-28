# Normalización de rutas: hub "Operaciones" + Empresas/Seguros/Tarifario

## Contexto

Ronda 47 (2026-07-27) capturó como dirección de producto que `/dashboard/operaciones` debía convertirse en el hub real de Diario+Reportería, pero quedó sin spec. Ronda 55 (2026-07-28) verificó el estado actual: `/dashboard/operaciones/page.tsx` existe hoy solo como un stub (`redirect('/dashboard/diario')`), y el Sidebar ya agrupa Diario+Reportería bajo un item expandible llamado "Monitor de Viajes" (spec `2026-07-21-cuadratura-reporteria-redesign-design.md`) — la unificación de navegación está parcialmente hecha, con nombres distintos a los que se confirman en este spec.

Durante el brainstorming se decidió además usar nomenclatura de URL estándar de la industria (slugs en inglés) para este hub, y se extendió el mismo criterio a los tres módulos principales del Sidebar (Empresas/Seguros/Tarifario), que hoy tienen slugs en español.

**Nomenclatura confirmada con el usuario:**
- El hub se llama **"Operaciones"**. Agrupa dos sub-módulos:
  - Ex-"Diario" → **"Monitor"**.
  - Ex-"Reportería" → **"Cierres"** (no "Cuadratura": ese nombre ya fue usado y descartado para una función distinta — el cierre puntual de un solo día, rechazado por mala UX y reemplazado por el overlay "Cerrar el día" dentro de Monitor; reusarlo generaría ambigüedad con esa historia). "Cierres" además evita colisionar con el botón "Cerrar el día" (acción puntual) al referirse al *registro* de cómo se fueron cerrando los días.
- Los tres módulos de nivel superior se renombran en su slug de URL (no en su label visible):
  - "Empresas" (`transportistas`) → `carriers` — coincide 1:1 con el vocabulario ya usado en el dominio interno (`carrier_id`, `carrier_name`).
  - "Seguros" (`seguros`) → `insurance` — coincide con `insurance_policy`, ya usado en el dominio.
  - "Tarifario" (`tarifario`) → `pricing` — más amplio que "rates"/"tariffs" porque el módulo va a crecer más allá de solo tarifas de flete.

## Alcance

**Dentro de alcance:**
1. Nuevas rutas para el hub: `/dashboard/operations`, `/dashboard/operations/monitor`, `/dashboard/operations/closures`.
2. Nuevas rutas para los tres módulos: `/dashboard/carriers` (+ `/dashboard/carriers/[id]`, eliminando el segmento redundante `empresa`), `/dashboard/insurance`, `/dashboard/pricing`.
3. Sidebar: grupo "Operaciones" (ex-"Monitor de Viajes") con items "Monitor"/"Cierres"; `NAV_ITEMS` planos actualizados a los nuevos slugs, labels visibles sin cambios ("Empresas"/"Seguros"/"Tarifario").
4. Actualizar todos los entry points y deep-links internos que hardcodean las rutas viejas (listados abajo).
5. Eliminar por completo las rutas y archivos viejos — **corte limpio, sin redirect legacy** (decisión explícita del usuario): visitar una URL vieja da 404.

**Explícitamente fuera de alcance:**
- Contenido/funcionalidad de "Cierres" — sigue siendo el pivot genérico de Reportería tal como existe hoy (Ronda 41), sin cambios de UI ni de datos. El rediseño real (3 formatos fijos por cliente + `app.equipment_day_status`) es un spec aparte, en una sesión posterior, condicionado a que ese modelo de datos se diseñe primero.
- Renombrar identificadores internos de código (hooks, componentes, comentarios) que mencionan "Diario" — 32 archivos afectados si se hiciera, cero beneficio visible para el usuario. `useDiarioFilters` y similares quedan como están.
- Normalizar los valores del query param `?tab=` en la ficha de detalle de carrier (`?tab=seguros`, `?tab=conductores`, etc.) y el `type Tab` interno — mismo criterio de no tocar código interno solo por consistencia cosmética. **Queda anotado como pendiente para una próxima iteración** (ver checklist en AGENTLOG.md).
- Rutas de `/dashboard/admin/*` — no mencionadas por el usuario, quedan como están.

## 1. Rutas y estructura de archivos — hub Operaciones

```
app/dashboard/operations/page.tsx                → redirect('/dashboard/operations/monitor')
app/dashboard/operations/monitor/page.tsx        (movido desde diario/page.tsx, sin cambios de contenido)
app/dashboard/operations/monitor/page.test.tsx   (movido)
app/dashboard/operations/closures/page.tsx       (movido desde diario/reporteria/page.tsx, sin cambios de contenido)
app/dashboard/operations/closures/page.test.tsx  (movido)
```

Se eliminan `app/dashboard/operaciones/` (stub viejo) y `app/dashboard/diario/` (incluida `reporteria/`) por completo.

Todos los imports dentro de estos archivos usan el alias `@/...` (no relativos) — mover los directorios no rompe ningún import.

## 2. Rutas y estructura de archivos — Empresas/Seguros/Tarifario

```
app/dashboard/carriers/page.tsx           (movido desde transportistas/page.tsx)
app/dashboard/carriers/[id]/page.tsx      (movido desde transportistas/empresa/[id]/page.tsx)
app/dashboard/carriers/[id]/page.test.tsx (movido)
app/dashboard/insurance/page.tsx          (movido desde seguros/page.tsx)
app/dashboard/pricing/page.tsx            (movido desde tarifario/page.tsx)
app/dashboard/pricing/page.test.tsx       (movido)
```

Se eliminan `app/dashboard/transportistas/`, `app/dashboard/seguros/`, `app/dashboard/tarifario/` por completo.

## 3. Sidebar (`components/dashboard/Sidebar.tsx`)

El grupo hoy llamado `MONITOR_GROUP` (label "Monitor de Viajes") pasa a tener label **"Operaciones"**, con items:
- `{ href: '/dashboard/operations/monitor', label: 'Monitor' }`
- `{ href: '/dashboard/operations/closures', label: 'Cierres' }`

`MOBILE_NAV_ITEMS` se deriva de los mismos dos items, igual que hoy.

`NAV_ITEMS` (plano) pasa a:
```
{ href: '/dashboard/carriers',  label: 'Empresas',  icon: Building2 }
{ href: '/dashboard/insurance', label: 'Seguros',   icon: Shield }
{ href: '/dashboard/pricing',   label: 'Tarifario', icon: Receipt }
```

El comentario desactualizado sobre `/dashboard/diario/cuadratura` (líneas 72-73 actuales, página ya eliminada en la ronda del 21/07) se limpia al tocar esas mismas líneas para el matching de ruta activa.

## 4. Entry points a actualizar

| Archivo | Cambio |
|---|---|
| `proxy.ts` | `'/dashboard/diario'` → `'/dashboard/operations/monitor'` |
| `app/auth/callback/route.ts` | default `next` → `'/dashboard/operations/monitor'` |
| `app/dashboard/admin/layout.tsx` | redirect de guard de rol → `'/dashboard/operations/monitor'` |
| `components/auth/LoginForm.tsx` | `router.push('/dashboard/operations/monitor')` |
| `components/auth/RegisterForm.tsx` | `router.push('/dashboard/operations/monitor')` |
| `components/auth/ResetPasswordForm.tsx` | `router.push('/dashboard/operations/monitor')` (hoy apunta a `/dashboard/operaciones`) |
| `app/page.tsx` | `redirect('/dashboard/operaciones')` → `redirect('/dashboard/operations')` (raíz sigue pasando por el hub, no directo a monitor) |
| `scripts/demo.spec.ts` | `page.goto('/dashboard/operations/monitor')` y `page.goto('/dashboard/carriers')` (línea 79) |

## 5. Deep-links internos a actualizar (carriers/insurance)

Todos mantienen el patrón `?tab=...`/`?q=...` sin cambios (ver "fuera de alcance"), solo cambia el prefijo de la ruta:

- `app/dashboard/seguros/page.tsx` (comentario que menciona `/dashboard/transportistas`)
- `app/dashboard/transportistas/page.tsx` → mover a `carriers/page.tsx`; actualizar `router.push`/`href` a `/dashboard/carriers/[id]`
- `app/dashboard/transportistas/empresa/[id]/page.tsx` (+ `page.test.tsx`) → mover a `carriers/[id]/`; actualizar `router.push('/dashboard/transportistas')` → `'/dashboard/carriers'`, breadcrumb/back-link, y el link a `/dashboard/seguros?q=...` → `/dashboard/insurance?q=...`
- `components/dashboard/CloseDayDialog.tsx` (+ test)
- `components/dashboard/TransporterSlideOver.tsx` (+ test)
- `components/dashboard/TripAssignDialog.tsx`
- `components/dashboard/TripSlideOver.tsx` (+ test) — incluye el link a `/dashboard/carriers?...` (filtro) y los 3 links con `?tab=seguros`/`?tab=conductores`
- `components/dashboard/InsuranceSummaryCard.tsx` (comentario + href)
- `components/dashboard/TransporterCard.tsx`

## 6. Testing / verificación

- Mover cada `page.test.tsx` junto con su `page.tsx`; actualizar cualquier aserción que referencie una ruta vieja literal (ej. `CloseDayDialog.test.tsx:107`, `TripSlideOver.test.tsx:330,340,351`, `TransporterSlideOver.test.tsx:82`, `transportistas/empresa/[id]/page.test.tsx:305`).
- Actualizar `scripts/demo.spec.ts` (e2e) a los nuevos paths.
- `vitest run`, `tsc --noEmit`, `npm run build` en verde antes de cerrar.
- Verificación manual: login → aterriza en Monitor bajo Operaciones; Sidebar muestra "Operaciones" (Monitor/Cierres) y Empresas/Seguros/Tarifario con las URLs nuevas; visitar cualquier URL vieja (`/dashboard/diario`, `/dashboard/transportistas`, `/dashboard/seguros`, `/dashboard/tarifario`, `/dashboard/operaciones`) da 404; los deep-links con `?tab=`/`?q=` desde Monitor (banners de póliza vencida, licencia faltante, empresa distinta) siguen abriendo la tab correcta en `/dashboard/carriers/[id]`.

## Pendiente para otra iteración (no bloquea este spec)

- Normalizar `?tab=seguros|conductores|equipos|...` y el `type Tab` de `carriers/[id]/page.tsx` a valores en inglés — mismo criterio de alcance que ya se evitó acá, decisión explícita de dejarlo para después.
- Spec 2: `app.equipment_day_status` + rediseño de "Cierres" con los 3 formatos fijos por cliente (Sider Botelleros/Sodimac/Walmart-Spot), usando los mockups de Figma y capturas reales ya guardados en `monitor-app/docs/user-stories/20260720/`.
