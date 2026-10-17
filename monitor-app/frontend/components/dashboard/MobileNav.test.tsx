import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { Acceso } from '@/lib/authz/acceso'
import type { NavBadge } from '@/lib/navegacion/menu'

const nav = vi.hoisted(() => ({ ruta: '/dashboard/operations/monitor', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.ruta,
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
}))
const contadores = vi.hoisted(() => ({ valor: {} as Partial<Record<NavBadge, number>> }))
vi.mock('@/hooks/useNavCounts', () => ({ useNavCounts: () => contadores.valor }))
vi.mock('@/hooks/useSignOut', () => ({ useSignOut: () => vi.fn() }))

import { MobileMenuProvider, MobileNav, useMobileMenu } from './MobileNav'

const OPERACIONES: Acceso = {
  id: 'u', email: 'oscar@sim.local', full_name: 'Óscar Operaciones', roles: ['operations_supervisor'],
  role_names: ['Supervisor de Operaciones'], permissions: ['documents.review'], aal: 'aal1',
}

function Abrir() {
  const { open } = useMobileMenu()
  return <button onClick={open}>Abrir menú</button>
}

function montar(acceso: Acceso = OPERACIONES) {
  return render(<MobileMenuProvider><Abrir /><MobileNav acceso={acceso} /></MobileMenuProvider>)
}

const barra = () => screen.getByRole('navigation', { name: 'Navegación del teléfono' })

beforeEach(() => { nav.ruta = '/dashboard/operations/monitor'; contadores.valor = {} })

describe('MobileNav: la barra', () => {
  it('el perfil Operaciones ve sus 4 destinos con la etiqueta corta, en caja normal, y "Menú" (N3)', () => {
    montar()
    const enlaces = within(barra()).getAllByRole('link')
    expect(enlaces.map(a => a.textContent)).toEqual(['Monitor', 'Cierre', 'Empresas', 'Conductores'])
    for (const a of enlaces) expect(a.innerHTML).not.toMatch(/uppercase/)
    expect(within(barra()).getByRole('button', { name: /^Menú/ })).toBeInTheDocument()
  })

  it('marca la entrada de la pantalla; el histórico del Cierre marca "Cierre" (N4)', () => {
    nav.ruta = '/dashboard/operations/closures/history'
    montar()
    expect(within(barra()).getByRole('link', { name: 'Cierre' })).toHaveAttribute('aria-current', 'page')
  })

  it('en una pantalla que no está en la barra, "Menú" queda marcado (N4)', () => {
    nav.ruta = '/dashboard/insurance/installments'
    montar()
    expect(within(barra()).getByRole('button', { name: /^Menú/ })).toHaveAttribute('aria-current', 'true')
    for (const a of within(barra()).getAllByRole('link')) expect(a).not.toHaveAttribute('aria-current')
  })

  it('un contador fuera de la barra es un punto en "Menú" y un número en el cajón (N5)', () => {
    contadores.valor = { installments: 3 }
    montar()
    fireEvent.click(within(barra()).getByRole('button', { name: 'Menú, hay pendientes' }))
    const cajon = screen.getByRole('dialog', { name: 'Menú' })
    expect(within(cajon).getByRole('link', { name: /Cuotas/ })).toHaveTextContent('3')
  })

  it('sin el dato todavía, ni punto ni número (N5)', () => {
    montar()
    expect(within(barra()).getByRole('button', { name: 'Menú' })).toBeInTheDocument()
  })
})

describe('MobileNav: el cajón "Menú"', () => {
  it('muestra los grupos del menú y la cuenta, y se abre también desde fuera (N6)', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }))
    const cajon = screen.getByRole('dialog', { name: 'Menú' })
    for (const grupo of ['Operaciones', 'Directorio', 'Certificación', 'Seguros']) {
      expect(within(cajon).getByRole('heading', { name: grupo })).toBeInTheDocument()
    }
    expect(within(cajon).getByText('Óscar Operaciones')).toBeInTheDocument()
    expect(within(cajon).getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument()
  })

  it('tocar una entrada lo cierra; cambiar de ruta con el cajón abierto también (N6)', () => {
    const { rerender } = montar()
    fireEvent.click(within(barra()).getByRole('button', { name: /^Menú/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Menú' })).getByRole('link', { name: 'Equipos' }))
    expect(screen.queryByRole('dialog', { name: 'Menú' })).toBeNull()

    fireEvent.click(within(barra()).getByRole('button', { name: /^Menú/ }))
    act(() => { nav.ruta = '/dashboard/clients' })
    rerender(<MobileMenuProvider><Abrir /><MobileNav acceso={OPERACIONES} /></MobileMenuProvider>)
    expect(screen.queryByRole('dialog', { name: 'Menú' })).toBeNull()
  })

  it('sin documents.review, Por asignar no está en la barra ni en el cajón', () => {
    montar({ ...OPERACIONES, roles: ['certification_operator'], permissions: [] })
    expect(within(barra()).queryByRole('link', { name: 'Por asignar' })).toBeNull()
    fireEvent.click(within(barra()).getByRole('button', { name: /^Menú/ }))
    expect(within(screen.getByRole('dialog', { name: 'Menú' })).queryByRole('link', { name: /Por asignar/ })).toBeNull()
  })
})
