import {
  Truck, BookUser, Shield, Receipt, BadgeCheck, ClipboardCheck,
  Building2, UserRound, Inbox, ListChecks, FileText, CalendarClock, Handshake,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Acceso } from '@/lib/authz/acceso'
import type { PermissionCode } from '@/lib/authz/permisos.generated'
import { AREAS, nivelEnArea, type Area } from '@/lib/authz/roles'

/** La navegación de la app, una vez (navegación en el teléfono, 17/10). Antes la barra
 *  del teléfono era una segunda lista derivada a mano (`MOBILE_NAV_ITEMS`) que aplanaba
 *  todo el menú: creció a 15 entradas en una fila que se desplazaba de lado. */

export type NavBadge = 'inbox' | 'requests' | 'installments'

export type NavLeaf = {
  href: string
  label: string
  /** La etiqueta en la barra del teléfono (12 caracteres como máximo); sin ella, `label`. */
  short?: string
  /** Su ícono en la barra del teléfono, que no agrupa; sin él, el del grupo. */
  icon?: LucideIcon
  badge?: NavBadge
  /** La entrada existe solo con este permiso (el menú lo decide el permiso, igual que la API). */
  permission?: PermissionCode
}
export type NavGroup = { label: string; icon: LucideIcon; items: NavLeaf[] }
/** Una entrada suelta del primer nivel (Tarifario): lleva su propio ícono. */
export type NavTopLeaf = NavLeaf & { icon: LucideIcon }
export type NavEntry = NavGroup | NavTopLeaf

// "Operaciones" son los dos trabajos del día: seguir los viajes (Monitor) y
// cerrar el día (Cierre del día). El Cierre salió del menú en julio, cuando era
// la vieja Cuadratura, y quedó como un botón del Monitor hasta que existiera el
// Centro de Cierre; desde que existe es un destino propio (17/10). Su histórico
// (/operations/closures/history) es una vista del Cierre, no otra entrada.
// Un modulo por objeto de trabajo, con sus vistas adentro (HU-04). La
// certificacion de una empresa se resuelve sin saltar entre modulos: la cola
// transversal, la sabana de pendientes y la ficha viven bajo el mismo techo.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operaciones',
    icon:  Truck,
    items: [
      { href: '/dashboard/operations/monitor', label: 'Monitor' },
      { href: '/dashboard/operations/closures', label: 'Cierre del día', short: 'Cierre', icon: ClipboardCheck },
    ],
  },
  // Certificación se abre en TRES porque son tres trabajos, no tres vistas: la
  // Bandeja responde "¿de quién es este archivo?" sobre archivos sin destino,
  // Empresas responde "¿qué le falta a esta empresa?" sobre requisitos sin
  // documento, y el Directorio responde "¿quién está operando, y quiénes son su
  // gente?". Las CUATRO agrupaciones (Empresa/Conductor/Vehículo/Requisito)
  // NO se parten: siguen adentro de Empresas, porque ésas sí son cuatro
  // maneras de mirar la misma lista.
  //
  // El Directorio SALIÓ de acá el 2026-09-07 y quedó como módulo propio, más
  // arriba. Pablo, 04/09: *"lo que yo haría para no confundir es directorio
  // sacarlo de certificación. Y dejarlo arriba"* / *"lo que es empresas,
  // manténlo solo para subir documentos"*.
  //
  // No es una preferencia de menú: son dos trabajos. El Directorio responde
  // "quién está operando, y quiénes son su gente" —y es donde se da de baja, se
  // transfiere y se activa—; Certificación responde "qué documento le falta a
  // esta empresa". Y el resto de la app ya lo trataba así: de los diez enlaces
  // con que el Monitor y el Cierre mandan a arreglar algo, NUEVE apuntan a
  // /dashboard/carriers y uno solo a /dashboard/compliance.
  // Directorio (Entrega C, 14/10): el registro, con una lista por objeto. Cada uno
  // tiene su lista y su ficha; Certificación enlaza a ellas en vez de tener las suyas.
  {
    label: 'Directorio',
    icon:  BookUser,
    items: [
      { href: '/dashboard/carriers', label: 'Empresas', icon: Building2 },
      { href: '/dashboard/drivers',  label: 'Conductores', icon: UserRound },
      { href: '/dashboard/assets',   label: 'Equipos' },
      { href: '/dashboard/clients',  label: 'Clientes', icon: Handshake },
    ],
  },
  {
    label: 'Certificación',
    icon:  BadgeCheck,
    items: [
      { href: '/dashboard/compliance',       label: 'Empresas' },
      { href: '/dashboard/compliance/inbox', label: 'Por asignar', badge: 'inbox', icon: Inbox, permission: 'documents.review' },
      { href: '/dashboard/compliance/pending', label: 'Pendientes', badge: 'requests', icon: ListChecks },
      { href: '/dashboard/compliance/requirements', label: 'Documentos exigidos', short: 'Exigidos', icon: FileText },
    ],
  },
  // Seguros (Seguros E2, 15/10): un submódulo por objeto de trabajo, como
  // Directorio y Certificación. Cuotas cuenta las vencidas.
  {
    label: 'Seguros',
    icon:  Shield,
    items: [
      { href: '/dashboard/insurance',              label: 'Pólizas' },
      { href: '/dashboard/insurance/installments', label: 'Cuotas', badge: 'installments', icon: CalendarClock },
    ],
  },
]

// Un modulo por objeto de trabajo. Tarifario todavia no tiene mas de una vista
// (Seguros paso a grupo en la Entrega 2 de Seguros, 15/10).
// Sin `badge`: al pasar Certificacion a NAV_GROUPS, el unico item con contador
// se fue con ella. Un campo del tipo y una rama de render inalcanzables se leen
// como una capacidad que existe, y no existe.
const NAV_ITEMS: NavTopLeaf[] = [
  { href: '/dashboard/pricing',   label: 'Tarifario',  icon: Receipt },
]

// El orden del menu, con grupos y hojas mezclados. Antes se renderizaban en
// dos bloques —primero todos los grupos, despues todas las hojas—, asi que una
// hoja no podia ir ENTRE dos grupos: el Directorio habria caido debajo de
// Certificacion, que es de donde acaba de salir.
/** El menú, en su orden. La barra lateral, el cajón del teléfono y su barra de abajo leen de aquí. */
export const NAV: readonly NavEntry[] = [
  NAV_GROUPS[0],                                              // Operaciones
  NAV_GROUPS[1],                                              // Directorio
  NAV_GROUPS[2],                                              // Certificación
  NAV_GROUPS[3],                                              // Seguros
  NAV_ITEMS[0],                                               // Tarifario
]

export const isGroup = (e: NavEntry): e is NavGroup => 'items' in e

const leaves = (e: NavEntry): NavLeaf[] => (isGroup(e) ? e.items : [e])

/** El menú que puede ver alguien: sin las entradas que pide un permiso que no tiene y
 *  sin los grupos que quedan vacíos. */
export function visibleNav(permissions: readonly PermissionCode[]): NavEntry[] {
  const puede = (l: NavLeaf) => !l.permission || permissions.includes(l.permission)
  return NAV.flatMap((e): NavEntry[] => {
    if (!isGroup(e)) return puede(e) ? [e] : []
    const items = e.items.filter(puede)
    return items.length ? [{ ...e, items }] : []
  })
}

// ── La barra del teléfono, según el perfil ─────────────────────────────────────

/** El perfil: el área de trabajo de la persona, o General si no tiene ninguna. */
export type MobileProfile = Area | 'general'

/** El área donde la persona tiene el nivel más alto (Supervisor sobre Operador); a
 *  igual nivel, el orden de `AREAS`. Sin rol de área (Lectura, Administración,
 *  Soporte, Propietario), General. */
export function mobileProfile(roles: readonly string[]): MobileProfile {
  const codes = [...roles]
  for (const nivel of ['supervisor', 'operator'] as const) {
    const area = AREAS.find(a => nivelEnArea(codes, a.clave) === nivel)
    if (area) return area.clave
  }
  return 'general'
}

/** Hasta 4 destinos por perfil, por `href` de entradas del menú; "Menú" va siempre al
 *  final. Propuesta del 17/10, a validar con quien usa cada área. */
export const MOBILE_DESTINATIONS: Record<MobileProfile, readonly string[]> = {
  operations:    ['/dashboard/operations/monitor', '/dashboard/operations/closures', '/dashboard/carriers', '/dashboard/drivers'],
  certification: ['/dashboard/compliance/inbox', '/dashboard/compliance/pending', '/dashboard/compliance', '/dashboard/compliance/requirements'],
  insurance:     ['/dashboard/insurance', '/dashboard/insurance/installments'],
  commercial:    ['/dashboard/pricing', '/dashboard/clients'],
  general:       ['/dashboard/operations/monitor', '/dashboard/carriers', '/dashboard/compliance', '/dashboard/insurance'],
}

/** Una entrada de la barra, con su grupo (de él sale el ícono si la entrada no tiene) y la
 *  etiqueta que muestra la barra. */
export type MobileBarItem = { leaf: NavLeaf; group: NavGroup | null; label: string }

/** Los destinos de la barra de alguien, en el orden de su perfil y sin lo que no puede ver. */
export function mobileBar(acceso: Pick<Acceso, 'roles' | 'permissions'>): MobileBarItem[] {
  const disponibles = new Map<string, Omit<MobileBarItem, 'label'>>()
  for (const e of visibleNav(acceso.permissions)) {
    for (const leaf of leaves(e)) disponibles.set(leaf.href, { leaf, group: isGroup(e) ? e : null })
  }
  const elegidas = MOBILE_DESTINATIONS[mobileProfile(acceso.roles)]
    .flatMap(href => disponibles.get(href) ?? [])
    .slice(0, 4)
  // Sin el grupo al lado, dos "Empresas" (Directorio y Certificación) serían iguales para
  // quien no ve el ícono: una etiqueta repetida en la barra toma el nombre de su grupo.
  const corta = (i: Omit<MobileBarItem, 'label'>) => i.leaf.short ?? i.leaf.label
  const repetidas = new Set(elegidas.map(corta).filter((l, i, all) => all.indexOf(l) !== i))
  return elegidas.map((i, n) => ({
    ...i,
    // La primera conserva su nombre; las siguientes toman el de su grupo.
    label: repetidas.has(corta(i)) && elegidas.findIndex(j => corta(j) === corta(i)) !== n && i.group
      ? i.group.label : corta(i),
  }))
}

/** La entrada que corresponde a la pantalla: la de ruta más larga que la contiene (el
 *  histórico del Cierre marca el Cierre; /compliance/inbox gana sobre /compliance). */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  return hrefs
    .filter(h => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0] ?? null
}
