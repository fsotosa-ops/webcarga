'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  Truck, Users, LogOut, BookUser,
  ChevronLeft, ChevronDown, Shield, Receipt, BadgeCheck, ClipboardCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { getDisplayName, puedeVerConfiguracion, type Acceso } from '@/lib/authz/acceso'
import { certificationRequestsApi } from '@/lib/api/certificationRequests'
import { insuranceApi } from '@/lib/api/insurance'
import LogoWebCarga from '@/components/brand/LogoWebCarga'
import SidebarAccount, { SETTINGS_HREF } from './SidebarAccount'

// "Operaciones" son los dos trabajos del día: seguir los viajes (Monitor) y
// cerrar el día (Cierre del día). El Cierre salió del menú en julio, cuando era
// la vieja Cuadratura, y quedó como un botón del Monitor hasta que existiera el
// Centro de Cierre; desde que existe es un destino propio (17/10). Su histórico
// (/operations/closures/history) es una vista del Cierre, no otra entrada.
type NavLeaf  = {
  href: string
  label: string
  badge?: 'inbox' | 'requests' | 'installments'
  /** Su ícono en la barra del teléfono, que no agrupa; sin él, el del grupo. */
  icon?: LucideIcon
}
type NavGroupDef = { label: string; icon: LucideIcon; items: NavLeaf[] }

// Un modulo por objeto de trabajo, con sus vistas adentro (HU-04). La
// certificacion de una empresa se resuelve sin saltar entre modulos: la cola
// transversal, la sabana de pendientes y la ficha viven bajo el mismo techo.
const NAV_GROUPS: NavGroupDef[] = [
  {
    label: 'Operaciones',
    icon:  Truck,
    items: [
      { href: '/dashboard/operations/monitor', label: 'Monitor' },
      { href: '/dashboard/operations/closures', label: 'Cierre del día', icon: ClipboardCheck },
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
      { href: '/dashboard/carriers', label: 'Empresas' },
      { href: '/dashboard/drivers',  label: 'Conductores' },
      { href: '/dashboard/assets',   label: 'Equipos' },
      { href: '/dashboard/clients',  label: 'Clientes' },
    ],
  },
  {
    label: 'Certificación',
    icon:  BadgeCheck,
    items: [
      { href: '/dashboard/compliance',       label: 'Empresas' },
      { href: '/dashboard/compliance/inbox', label: 'Por asignar', badge: 'inbox' },
      { href: '/dashboard/compliance/pending', label: 'Pendientes', badge: 'requests' },
      { href: '/dashboard/compliance/requirements', label: 'Documentos exigidos' },
    ],
  },
  // Seguros (Seguros E2, 15/10): un submódulo por objeto de trabajo, como
  // Directorio y Certificación. Cuotas cuenta las vencidas.
  {
    label: 'Seguros',
    icon:  Shield,
    items: [
      { href: '/dashboard/insurance',              label: 'Pólizas' },
      { href: '/dashboard/insurance/installments', label: 'Cuotas', badge: 'installments' },
    ],
  },
]

// Un modulo por objeto de trabajo. Tarifario todavia no tiene mas de una vista
// (Seguros paso a grupo en la Entrega 2 de Seguros, 15/10).
// Sin `badge`: al pasar Certificacion a NAV_GROUPS, el unico item con contador
// se fue con ella. Un campo del tipo y una rama de render inalcanzables se leen
// como una capacidad que existe, y no existe.
const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard/pricing',   label: 'Tarifario',  icon: Receipt },
]

// El orden del menu, con grupos y hojas mezclados. Antes se renderizaban en
// dos bloques —primero todos los grupos, despues todas las hojas—, asi que una
// hoja no podia ir ENTRE dos grupos: el Directorio habria caido debajo de
// Certificacion, que es de donde acaba de salir.
const NAV_ORDEN: (NavGroupDef | (typeof NAV_ITEMS)[number])[] = [
  NAV_GROUPS[0],                                              // Operaciones
  NAV_GROUPS[1],                                              // Directorio
  NAV_GROUPS[2],                                              // Certificación
  NAV_GROUPS[3],                                              // Seguros
  NAV_ITEMS[0],                                               // Tarifario
]

const esGrupo = (e: (typeof NAV_ORDEN)[number]): e is NavGroupDef => 'items' in e

/** Sin clasificar solo para quien puede clasificar (Cert 2a, 14/10): Operaciones
 *  lo veía con un contador rojo y sin poder actuar (H10). El menú lo decide el
 *  permiso, igual que la API. */
function soloLoQuePuede(items: NavLeaf[], puedeClasificar: boolean): NavLeaf[] {
  return items.filter(i => i.badge !== 'inbox' || puedeClasificar)
}

// Solo para el bottom nav mobile — sin concepto de dropdown ahi, se listan
// los items de los grupos ya aplanados junto a los demas. Aplanados pierden su
// grupo: una etiqueta que se repite entre grupos ("Empresas" en Directorio y en
// Certificación) toma el nombre de su grupo para no quedar ambigua.
const REPEATED_LABELS = new Set(
  NAV_GROUPS.flatMap(g => g.items.map(i => i.label)).filter((l, i, all) => all.indexOf(l) !== i),
)
const MOBILE_NAV_ITEMS = [
  ...NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, label: REPEATED_LABELS.has(i.label) ? g.label : i.label, icon: i.icon ?? g.icon }))),
  ...NAV_ITEMS,
]

/** Grupo expandible del sidebar. Existe una sola vez: antes el bloque estaba
 *  escrito a mano para Operaciones, y sumar un segundo grupo obligaba a
 *  duplicar ~55 lineas — que fue exactamente la razon equivocada por la que la
 *  Bandeja termino colgando del primer nivel en vez de vivir dentro de
 *  Certificacion, como manda la HU-04. */
function NavGroup({
  group, pathname, collapsed, inboxCount, requestsCount = 0, installmentsCount = 0,
}: {
  group:      NavGroupDef
  pathname:   string
  collapsed:  boolean
  inboxCount: number
  /** Pedidos de Operaciones abiertos (Entrega B): el contador de Pendientes. */
  requestsCount?: number
  /** Cuotas de seguro vencidas (Seguros E2): el contador de Cuotas. */
  installmentsCount?: number
}) {
  const countOf = (badge?: NavLeaf['badge']) =>
    badge === 'inbox' ? inboxCount : badge === 'requests' ? requestsCount
      : badge === 'installments' ? installmentsCount : 0
  // Match mas especifico primero: /dashboard/compliance/inbox gana sobre
  // /dashboard/compliance, que es su prefijo.
  const activeHref = group.items
    .map(i => i.href)
    .filter(href => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0]
  const groupActive = !!activeHref

  const [open, setOpen] = useState(groupActive)
  // Si navegan directo a una sub-ruta (deep-link, back/forward), el submenu se
  // abre solo para mostrar donde estan.
  useEffect(() => {
    if (groupActive) setOpen(true)
  }, [groupActive])

  const Icon = group.icon
  const pending = group.items.reduce((n, i) => n + countOf(i.badge), 0)

  if (collapsed) {
    return (
      <Link
        href={group.items[0].href}
        title={group.label}
        className={`group relative flex items-center justify-center h-10 w-10 mx-auto rounded-xl text-[13px] transition-all duration-150 ${
          groupActive ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/6 hover:text-white/80'
        }`}
      >
        {groupActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
        )}
        <Icon size={16} className={groupActive ? 'text-accent' : 'group-hover:text-white/70'} />
        {pending > 0 && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
        )}
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150 ${
          groupActive ? 'bg-white/12 text-white' : 'text-white/45 hover:bg-white/6 hover:text-white/80'
        }`}
      >
        {groupActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
        )}
        <Icon size={16} className={`shrink-0 ${groupActive ? 'text-accent' : 'group-hover:text-white/70'}`} />
        <span className={`font-medium truncate flex-1 text-left ${groupActive ? 'text-white' : ''}`}>{group.label}</span>
        {pending > 0 && !open && (
          <span className="shrink-0 bg-red-500/90 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 tabular-nums">
            {pending}
          </span>
        )}
        <ChevronDown size={13} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-0.5 ml-3 pl-3.5 border-l border-white/8 flex flex-col gap-0.5">
          {group.items.map(({ href, label, badge }) => {
            const active = href === activeHref
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-2 rounded-lg text-[12.5px] px-2.5 py-2 transition-colors ${
                  active ? 'bg-white/12 text-white font-medium' : 'text-white/40 hover:bg-white/6 hover:text-white/75'
                }`}
              >
                <span className="truncate">{label}</span>
                {countOf(badge) > 0 && (
                  <span className="ml-auto shrink-0 bg-red-500/90 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 tabular-nums">
                    {countOf(badge)}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  acceso: Acceso
}

export default function Sidebar({ acceso }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)

  // Match más específico primero — evita 2 items activos a la vez. Hoy
  // Seguros y Tarifario no comparten prefijo, pero la regla se deja escrita
  // acá y no en cada item.
  const activeHref = [...NAV_ITEMS]
    .map(i => i.href)
    .filter(href => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0]

  // El bottom nav mobile no tiene el concepto de grupo (§ MOBILE_NAV_ITEMS):
  // el match más específico se calcula sobre TODOS los hrefs juntos, para que
  // /dashboard/compliance/inbox no resalte también "Empresas".
  const puedeClasificar = acceso.permissions.includes('documents.review')
  const mobileItems = MOBILE_NAV_ITEMS.filter(i => !('badge' in i) || i.badge !== 'inbox' || puedeClasificar)
  const mobileActiveHref = mobileItems
    .map(i => i.href)
    .filter(href => pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0]

  // Cuánto trabajo hay esperando en la bandeja. Se pide con limit=1: de la
  // respuesta solo interesa `total`.
  const inboxCount = useQuery({
    queryKey: clavesCertificacion.colaTotal(),
    queryFn: () => documentIngestApi.listQueue({ limit: 1 }),
    staleTime: 60_000,
    enabled: puedeClasificar,
  }).data?.total ?? 0
  // Pedidos de Operaciones (Entrega B): los ve y los resuelve quien revisa documentos.
  const requestsCount = useQuery({
    queryKey: ['certification-requests', 'open'],
    queryFn: () => certificationRequestsApi.listOpen(),
    staleTime: 60_000,
    enabled: puedeClasificar,
  }).data?.total ?? 0

  // Cuotas de seguro vencidas: la API las cuenta con la fecha de Chile (limit=1:
  // solo interesa la cifra).
  const installmentsCount = useQuery({
    queryKey: ['insurance', 'installments', 'overdue-count'],
    queryFn: () => insuranceApi.listInstallments({ state: 'OVERDUE', limit: 1 }),
    staleTime: 60_000,
  }).data?.facets.OVERDUE ?? 0

  useEffect(() => {
    if (localStorage.getItem('sidebar-collapsed') === 'true') setCollapsed(true)
  }, [])

  const toggle = () => setCollapsed(v => {
    const next = !v
    localStorage.setItem('sidebar-collapsed', String(next))
    return next
  })

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isAdmin       = pathname.startsWith('/dashboard/admin')
  // Configuración: quien administra o configura alguna área (misma regla que
  // el layout de admin, lib/authz/acceso.ts).
  const canAdmin      = puedeVerConfiguracion(acceso)

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────── */}
      <aside className={`hidden md:flex ${collapsed ? 'w-[60px]' : 'w-[220px]'} bg-sidebar min-h-screen flex-col shrink-0 transition-[width] duration-200 ease-out`}>

        {/* ── Header ── */}
        <div className={`h-14 border-b border-white/8 flex items-center shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4 gap-3'}`}>
          {collapsed ? (
            /* Contraída: el cubo de WebCarga, que también expande la barra. */
            <button
              onClick={toggle}
              aria-label="Expandir barra lateral"
              title="Expandir barra lateral"
              className="w-full h-full flex items-center justify-center hover:bg-white/5 transition-colors"
            >
              <LogoWebCarga forma="isotipo" alto={28} prioridad />
            </button>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                {/* block: una imagen en línea deja el espacio de los descendentes
                    abajo y empujaba el logo contra el borde superior. */}
                <LogoWebCarga forma="completo" alto={20} prioridad className="block" />
                <p className="text-white/35 text-[10px] leading-none tracking-wide mt-1.5">Plataforma logística</p>
              </div>
              <button
                onClick={toggle}
                aria-label="Contraer barra lateral"
                title="Contraer barra lateral"
                className="shrink-0 p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/5 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
            </>
          )}
        </div>

        {/* ── Main nav ── */}
        <nav aria-label="Navegación principal" className="flex-1 flex flex-col px-2.5 py-3 gap-0.5 overflow-hidden">
          {NAV_ORDEN.map(entrada => {
            if (esGrupo(entrada)) {
              return (
                <NavGroup
                  key={entrada.label}
                  group={{ ...entrada, items: soloLoQuePuede(entrada.items, puedeClasificar) }}
                  pathname={pathname}
                  collapsed={collapsed}
                  inboxCount={inboxCount}
                  requestsCount={requestsCount}
                  installmentsCount={installmentsCount}
                />
              )
            }
            const { href, label, icon: Icon } = entrada
            const active = href === activeHref
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? label : undefined}
                className={`group relative flex items-center rounded-xl text-[13px] transition-all duration-150 ${
                  collapsed ? 'justify-center h-10 w-10 mx-auto' : 'gap-3 px-3 py-2.5'
                } ${active
                  ? 'bg-white/12 text-white'
                  : 'text-white/45 hover:bg-white/6 hover:text-white/80'
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent rounded-full" />
                )}
                <Icon size={16} className={`shrink-0 ${active ? 'text-accent' : 'group-hover:text-white/70'}`} />
                {!collapsed && (
                  <span className={`font-medium truncate ${active ? 'text-white' : ''}`}>{label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        <SidebarAccount
          displayName={getDisplayName(acceso)}
          email={acceso.email}
          roleName={acceso.role_names[0] ?? null}
          collapsed={collapsed}
          canConfigure={canAdmin}
          onSignOut={signOut}
        />
      </aside>

      {/* ── Mobile bottom nav ─────────────────────────────────── */}
      <nav aria-label="Navegación móvil" className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-sidebar border-t border-white/8 flex items-stretch overflow-x-auto safe-area-inset-bottom">
        {mobileItems.map(({ href, label, icon: Icon }) => {
          const active = href === mobileActiveHref
            && (href !== '/dashboard/operations/monitor' || pathname === href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 shrink-0 min-w-16 flex flex-col items-center justify-center gap-1 px-1 py-2.5 transition-colors ${
                active ? 'text-white' : 'text-white/40 hover:text-white/70'
              }`}
            >
              <Icon size={20} className={active ? 'text-accent' : ''} />
              <span className="whitespace-nowrap text-[9px] font-semibold tracking-wide uppercase">{label}</span>
              {active && <span className="w-1 h-1 rounded-full bg-accent" />}
            </Link>
          )
        })}

        {canAdmin && (
          <Link
            href={SETTINGS_HREF}
            prefetch={false}
            className={`flex-1 shrink-0 min-w-16 flex flex-col items-center justify-center gap-1 px-1 py-2.5 transition-colors ${
              isAdmin ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <Users size={20} className={isAdmin ? 'text-accent' : ''} />
            <span className="whitespace-nowrap text-[9px] font-semibold tracking-wide uppercase">Admin</span>
            {isAdmin && <span className="w-1 h-1 rounded-full bg-accent" />}
          </Link>
        )}

        <button
          onClick={signOut}
          className="flex-1 shrink-0 min-w-16 flex flex-col items-center justify-center gap-1 px-1 py-2.5 text-white/35 hover:text-white/65 transition-colors"
        >
          <LogOut size={20} />
          <span className="whitespace-nowrap text-[9px] font-semibold tracking-wide uppercase">Salir</span>
        </button>
      </nav>
    </>
  )
}
