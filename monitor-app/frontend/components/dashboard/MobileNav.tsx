'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { getDisplayName, puedeVerConfiguracion, type Acceso } from '@/lib/authz/acceso'
import { activeHref, isGroup, mobileBar, visibleNav, type NavBadge, type NavLeaf } from '@/lib/navegacion/menu'
import { useNavCounts } from '@/hooks/useNavCounts'
import { useSignOut } from '@/hooks/useSignOut'
import { AccountActions } from './AccountActions'

// ── Abrir el cajón desde fuera (el avatar de la cabecera) ──────────────────────

const MobileMenuContext = createContext<{ isOpen: boolean; open(): void; close(): void } | null>(null)

/** El cajón "Menú" se abre desde la barra y desde el avatar de la cabecera: el estado vive
 *  aquí para que la cabecera no conozca el cajón. */
export function MobileMenuProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false)
  // Funciones estables: el cajón se cierra en un efecto que depende de `close`.
  const open = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close])
  return <MobileMenuContext.Provider value={value}>{children}</MobileMenuContext.Provider>
}

export function useMobileMenu() {
  const ctx = useContext(MobileMenuContext)
  if (!ctx) throw new Error('useMobileMenu fuera de MobileMenuProvider')
  return ctx
}

// ── La barra y el cajón ────────────────────────────────────────────────────────

/** El número de una entrada; nada mientras no llega (un 0 en vuelo miente) o si es 0. */
function Count({ n, className }: { n: number | undefined; className: string }) {
  return n ? <span className={`rounded-full bg-status-incidente px-1.5 text-etiqueta font-bold tabular-nums text-white ${className}`}>{n}</span> : null
}

/** La navegación del teléfono (navegación en el teléfono, 17/10): hasta 4 destinos según
 *  el perfil + "Menú", que abre el menú completo. Todo sale de `lib/navegacion/menu.ts`,
 *  la misma definición que la barra lateral. */
export function MobileNav({ acceso }: { acceso: Acceso }) {
  const pathname = usePathname()
  const menu = useMobileMenu()
  const counts = useNavCounts(acceso.permissions)
  const signOut = useSignOut()

  const bar = mobileBar(acceso)
  const barHrefs = bar.map(b => b.leaf.href)
  const current = activeHref(pathname, barHrefs)
  const nav = visibleNav(acceso.permissions)
  const countOf = (leaf: NavLeaf) => (leaf.badge ? counts[leaf.badge as NavBadge] : undefined)
  // Algo pendiente en una entrada que no está en la barra: se avisa en "Menú".
  const pendingInMenu = nav.some(e => (isGroup(e) ? e.items : [e])
    .some(l => !barHrefs.includes(l.href) && (countOf(l) ?? 0) > 0))

  // Navegar cierra el cajón (un Link no lo desmonta).
  const { close } = menu
  useEffect(() => { close() }, [pathname, close])

  return (
    <>
      {/* z-30: bajo el fondo de una ventana (40) y la ventana (50, `Dialog`). */}
      <nav aria-label="Navegación del teléfono"
        className="fixed inset-x-0 bottom-0 z-30 grid h-(--mobile-nav-height) border-t border-white/8 bg-sidebar md:hidden"
        style={{ gridTemplateColumns: `repeat(${bar.length + 1}, minmax(0, 1fr))` }}>
        {bar.map(({ leaf, group }) => {
          const Icon = leaf.icon ?? group?.icon
          const active = leaf.href === current
          return (
            <Link key={leaf.href} href={leaf.href} aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 transition-colors ${active ? 'text-white' : 'text-white/45 hover:text-white/75'}`}>
              {Icon && <Icon size={20} aria-hidden="true" className={active ? 'text-accent' : ''} />}
              <span className="text-etiqueta font-medium">{leaf.short ?? leaf.label}</span>
              <Count n={countOf(leaf)} className="absolute left-1/2 top-1.5 ml-1" />
            </Link>
          )
        })}
        <button type="button" onClick={menu.open} aria-current={current ? undefined : 'true'}
          aria-label={pendingInMenu ? 'Menú, hay pendientes' : 'Menú'}
          className={`relative flex flex-col items-center justify-center gap-1 transition-colors ${current ? 'text-white/45 hover:text-white/75' : 'text-white'}`}>
          <Menu size={20} aria-hidden="true" className={current ? '' : 'text-accent'} />
          <span className="text-etiqueta font-medium" aria-hidden="true">Menú</span>
          {pendingInMenu && <span aria-hidden="true" className="absolute left-1/2 top-2 ml-2 h-2 w-2 rounded-full bg-status-incidente" />}
        </button>
      </nav>

      {menu.isOpen && (
        <Dialog label="Menú" onClose={menu.close}
          className="inset-x-0 bottom-0 top-16 flex flex-col rounded-t-2xl bg-white shadow-xl animate-modal-in md:hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-mulish text-sm font-bold text-text-primary">Menú</span>
            <button type="button" onClick={menu.close} aria-label="Cerrar"
              className="rounded text-informativo hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {nav.map(e => {
              const leaves = isGroup(e) ? e.items : [e]
              return (
                <section key={e.label} className="py-1.5">
                  {isGroup(e) && <h2 className="py-1 text-etiqueta font-semibold text-informativo">{e.label}</h2>}
                  {leaves.map(l => (
                    <Link key={l.href} href={l.href} onClick={menu.close}
                      aria-current={activeHref(pathname, [l.href]) ? 'page' : undefined}
                      className="flex items-center justify-between border-b border-border/60 py-2 text-dato text-text-primary aria-[current=page]:font-semibold aria-[current=page]:text-accion">
                      {l.label}
                      <Count n={countOf(l)} className="" />
                    </Link>
                  ))}
                </section>
              )
            })}
          </div>
          <div className="border-t border-border bg-bg-main px-4 py-3">
            <p className="text-dato font-medium text-text-primary">{getDisplayName(acceso)}</p>
            {acceso.role_names[0] && <p className="text-etiqueta text-informativo">{acceso.role_names[0]}</p>}
            <div role="menu" aria-label="Cuenta" className="mt-2 -mx-3">
              <AccountActions canConfigure={puedeVerConfiguracion(acceso)} onSignOut={() => { menu.close(); void signOut() }} />
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
