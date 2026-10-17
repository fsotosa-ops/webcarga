# Navegación en el teléfono — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10: sin subagentes,
> un test por criterio visto en rojo antes, humo E2E, un despliegue, revisión final opus). Pasos con checkbox.

**Goal:** una barra de abajo con hasta 4 destinos según el perfil + "Menú", un cajón con el menú completo y la
cabecera oscura con el logo oficial, todo leído de una sola definición de la navegación.

**Architecture:** la definición del menú (grupos, entradas, etiqueta corta, ícono, contador) sale de `Sidebar.tsx` a
`lib/navegacion/menu.ts`, junto con el filtro por permisos y el perfil del teléfono (área principal desde los roles,
con `AREAS` y `nivelEnArea` de `lib/authz/roles.ts`). Los contadores se piden en un hook (`useNavCounts`) que usan la
barra lateral y el teléfono. La barra de abajo y el cajón son un componente nuevo (`MobileNav`) sobre `Dialog` del kit;
la cabecera usa `LogoWebCarga forma="completo"` sobre `bg-sidebar`.

**Tech Stack:** Next.js 16 (App Router), React 19, TanStack Query, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-navegacion-movil-design.md` (criterios N1-N8).
**Maqueta:** `.superpowers/brainstorm/78194-1792268599/content/navegacion-movil.html`.

## Global Constraints

- Sin parches ni código duplicado: el menú existe una vez (`lib/navegacion/menu.ts`); `MOBILE_NAV_ITEMS` y
  `REPEATED_LABELS` se borran en la tarea que los reemplaza.
- Nombres nuevos en inglés; textos en español neutral, sin voseo; cero emojis (solo `lucide-react`).
- Solo tokens del sistema visual y piezas del kit (`Dialog`, `Button`); los guardias de `lib/ui/*.test.ts` siguen en 0.
- Rutas sin cambios: los destinos son `href` que ya existen en el menú.
- Escritorio sin cambio visible (la barra lateral solo pasa a leer la definición nueva).

## Review Focus

- Una persona con roles en dos áreas al mismo nivel (Operador de Operaciones y Operador de Seguros): gana el orden de
  `AREAS` y su barra es la de Operaciones (Task 1).
- Una persona sin permiso de clasificar con perfil Certificación: "Por asignar" no aparece en la barra ni en el cajón y
  la barra queda con 3 destinos + Menú, sin hueco (Task 1).
- Una pantalla interna (la ficha de una póliza, el histórico del Cierre) está bajo una entrada de la barra: se marca esa
  entrada por el prefijo más largo, no "Menú" (Task 3).
- El cajón abierto y la persona navega con el botón Atrás del teléfono o cambia de ruta: el cajón se cierra (Task 3).
- Contadores en vuelo: ni el número ni el punto de "Menú" se dibujan hasta tener el dato (Task 2).

---

## Contratos

### `lib/navegacion/menu.ts`
- `type NavBadge = 'inbox' | 'requests' | 'installments'`
- `type NavLeaf = { href: string; label: string; short?: string; icon?: LucideIcon; badge?: NavBadge; permission?: PermissionCode }`
  (`short`: etiqueta de la barra, ≤ 12 caracteres; `permission`: la entrada solo existe con ese permiso — hoy
  "Por asignar" con `documents.review`, que reemplaza a `soloLoQuePuede`).
- `type NavGroup = { label: string; icon: LucideIcon; items: NavLeaf[] }`
- `const NAV: (NavGroup | NavLeaf & { icon: LucideIcon })[]` — el orden del menú (hoy `NAV_ORDEN`).
- `function visibleNav(permissions: PermissionCode[]): typeof NAV` — sin las entradas sin permiso ni grupos vacíos.
- `type MobileProfile = Area | 'general'`
- `function mobileProfile(roles: string[]): MobileProfile` — área de nivel más alto; empate por el orden de `AREAS`.
- `const MOBILE_DESTINATIONS: Record<MobileProfile, string[]>` — `href` por perfil (tabla del spec; Seguros con las
  entradas que existen hoy: Pólizas, Cuotas; el plan de Seguros por empresa suma Empresas).
- `function mobileBar(acceso: Pick<Acceso, 'roles' | 'permissions'>): { leaf: NavLeaf; group: NavGroup | null }[]` —
  hasta 4, en el orden de `MOBILE_DESTINATIONS`, saltando lo que `visibleNav` no ofrece.
- `function activeHref(pathname: string, hrefs: string[]): string | null` — el prefijo más largo (la regla de hoy,
  incluido que el Monitor solo es activo en su ruta exacta).

### `hooks/useNavCounts.ts`
- `function useNavCounts(permissions: PermissionCode[]): Partial<Record<NavBadge, number>>` — las tres consultas de hoy
  (`Sidebar.tsx:281-300`), con su `enabled` por permiso; una clave ausente = todavía no llega (no se dibuja).

### `components/dashboard/MobileNav.tsx`
- `function MobileNav({ acceso }: { acceso: Acceso })` — la barra (`md:hidden`, `z-30`) y el cajón.
- `MobileMenuProvider` + `useMobileMenu(): { open(): void }` — el avatar de la cabecera abre el cajón por este contexto,
  así la cabecera no conoce el cajón.

---

## Tareas

Orden: 1 → 2 → 3 → 4 → 5. Commit con los tests de la tarea en verde; línea del ledger en el mismo paso.

### Task 1: Una definición del menú y el perfil del teléfono
**Files:** Create `lib/navegacion/menu.ts`, `lib/navegacion/menu.test.ts`.
**Interfaces:** Produces todo `lib/navegacion/menu.ts` (Contratos).
- [ ] Test rojo (N2, N3 y Review Focus):
  - `mobileProfile(['certification_supervisor', 'operations_operator'])` → `'certification'`;
    `mobileProfile(['reader'])` → `'general'`; `mobileProfile(['operations_operator', 'insurance_operator'])` →
    `'operations'`.
  - `mobileBar` de Operaciones → hrefs `['/dashboard/operations/monitor', '/dashboard/operations/closures',
    '/dashboard/carriers', '/dashboard/drivers']`; de Certificación sin `documents.review` → 3 entradas, sin
    `/dashboard/compliance/inbox`; ninguna lista tiene más de 4.
  - Toda entrada de `MOBILE_DESTINATIONS` existe en `NAV` (un href que no esté es un error del dato).
  - `short` ≤ 12 caracteres en todas las entradas.
  - `activeHref('/dashboard/operations/closures/history', hrefs)` → el del Cierre; `'/dashboard/operations/monitor/trips/x'`
    → `null` (el Monitor solo en su ruta exacta, como hoy).
- [ ] Implementar moviendo `NAV_GROUPS`, `NAV_ITEMS` y `NAV_ORDEN` de `Sidebar.tsx` (sus comentarios viajan con ellos) y
  agregando `short`, `permission` y los perfiles. `short`: Cierre del día → "Cierre", Documentos exigidos → "Exigidos";
  `icon` propio para Empresas de Certificación (`BadgeCheck`) y de Directorio (`Building2`), para que la barra no
  repita íconos.
- [ ] vitest del archivo. Commit.

### Task 2: Contadores en un hook y la barra lateral sobre la definición nueva
**Files:** Create `hooks/useNavCounts.ts`, `hooks/useNavCounts.test.tsx`; Modify `components/dashboard/Sidebar.tsx`,
`components/dashboard/Sidebar.test.tsx`.
**Interfaces:** Consumes `NAV`, `visibleNav`, `NavBadge`; Produces `useNavCounts`.
- [ ] Test rojo: `useNavCounts` sin `documents.review` no pide `inbox` ni `requests` (clave ausente); mientras la
  consulta viaja, la clave está ausente; con dato, el número (incluido 0).
- [ ] Implementar `useNavCounts` con las tres consultas de hoy (mismas `queryKey`, `staleTime`, `enabled`).
- [ ] `Sidebar.tsx` lee `visibleNav(acceso.permissions)` y `useNavCounts`; se borran de ahí la definición, las
  consultas, `soloLoQuePuede`, `MOBILE_NAV_ITEMS`, `REPEATED_LABELS` y la barra de abajo (pasa a `MobileNav`, Task 3).
  Los tests de escritorio de `Sidebar.test.tsx` siguen pasando sin cambiar lo que afirman; los dos de la barra móvil
  (líneas 122 y 130) se mueven a `MobileNav.test.tsx` en la Task 3.
- [ ] Guardia (N1) en `lib/navegacion/menu.test.ts`: los nombres de la definición (`NAV`, `NAV_GROUPS`, `NAV_ORDEN`,
  `MOBILE_NAV_ITEMS`, `MOBILE_DESTINATIONS`) solo se declaran en `lib/navegacion/menu.ts`, y `Sidebar.tsx` y
  `MobileNav.tsx` la importan de ahí (recorre `app/`, `components/`, `lib/`).
- [ ] vitest de los tres archivos. Commit.

### Task 3: La barra de abajo y el cajón "Menú"
**Files:** Create `components/dashboard/MobileNav.tsx`, `components/dashboard/MobileNav.test.tsx`; Modify
`app/dashboard/layout.tsx` (monta `MobileMenuProvider` y `MobileNav`).
**Interfaces:** Consumes `mobileBar`, `visibleNav`, `activeHref`, `useNavCounts`, `Dialog`, `SidebarAccount` (su
contenido de cuenta: nombre, rol, Configuración si `puedeVerConfiguracion`, Cambiar contraseña, Cerrar sesión);
Produces `MobileNav`, `MobileMenuProvider`, `useMobileMenu`.
- [ ] Test rojo (N3-N6 y Review Focus):
  - Perfil Operaciones: 4 enlaces con sus `short` + botón "Menú"; ninguno con `uppercase`.
  - En `/dashboard/insurance/installments` con perfil Operaciones, "Menú" tiene `aria-current`; en
    `/dashboard/operations/closures/history`, "Cierre".
  - Con 3 cuotas vencidas y Cuotas fuera de la barra: punto en "Menú" (`aria-label` "Menú, hay pendientes"), "3" en el
    cajón junto a Cuotas; mientras la consulta viaja, ni punto ni número.
  - Tocar "Menú" abre un `dialog` "Menú" con los grupos de `visibleNav`; tocar una entrada navega y lo cierra; cambiar
    de ruta con el cajón abierto lo cierra.
- [ ] Implementar: la barra (`grid grid-cols-5`, botones iguales, ícono 20 px, `text-etiqueta` en caja normal, una
  línea, `truncate` nunca necesario por el límite de `short`); el cajón sobre `Dialog` anclado abajo
  (`inset-x-0 bottom-0 top-16 rounded-t-2xl`), con la cuenta al pie reutilizando el contenido de `SidebarAccount`
  (extraer su lista de acciones a `AccountActions` y usarla en los dos lugares, sin copiar).
- [ ] vitest de `MobileNav`, `Sidebar`, `SidebarAccount`. Commit.

### Task 4: La cabecera oscura con el logo oficial
**Files:** Modify `components/dashboard/Topbar.tsx` y su test (o crear `Topbar.test.tsx`).
**Interfaces:** Consumes `useMobileMenu`.
- [ ] Test rojo (N7): la cabecera tiene `img` "WebCarga" de `forma="completo"` (`src` `/brand/webcarga-logo.png`), no
  contiene el texto "WebCarga" fuera del `alt`, tiene fondo `bg-sidebar`, y el avatar es un botón "Abrir menú" que
  llama `useMobileMenu().open`.
- [ ] Implementar. Se borra el texto escrito a mano y el isotipo.
- [ ] vitest. Commit.

### Task 5: Verificación, humo y despliegue
- [ ] Suite completa (toca la barra lateral y el layout, compartidos), `tsc`, `npm run build`.
- [ ] Humo Playwright en la copia local (N8), con `ops@sim.local` y `cert@sim.local`: a 360 y 390 px la barra no se
  desplaza (`scrollWidth === clientWidth`), ninguna etiqueta se corta (`scrollWidth <= clientWidth` en cada una),
  "Menú" abre y navega; capturas a 360, 390 y 1440 (escritorio sin cambio).
- [ ] Revisión final del rango con un revisor (opus); Important → arreglo con test rojo→verde.
- [ ] AGENTLOG; push a dev; Deploy Frontend en verde; mirar en dev a 390.
