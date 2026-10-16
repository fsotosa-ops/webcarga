import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let ruta = '/dashboard/admin/settings/operations/driver-reasons'
vi.mock('next/navigation', () => ({ usePathname: () => ruta }))
let permisos: string[] = []
vi.mock('@/lib/authz/PermisosProvider', () => ({ useAcceso: () => ({ permissions: permisos }) }))
vi.mock('@/lib/api/config', () => ({ inventarioApi: { get: vi.fn() } }))

import { inventarioApi } from '@/lib/api/config'
import { SettingsIndex } from './SettingsIndex'

function montar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsIndex />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  ruta = '/dashboard/admin/settings/operations/driver-reasons'
  permisos = ['operations.configure']
  vi.mocked(inventarioApi.get).mockResolvedValue({
    operations: { pares: [], revision: { total: 60, sin_revisar: 21 }, secciones: { 'driver-reasons': 21, 'tms-statuses': 0 } },
  } as never)
})

describe('SettingsIndex (P1.1)', () => {
  it('con permisos de Operaciones se ven Operaciones y Flota; ni Certificación, ni Seguros, ni Personas', () => {
    montar()
    const indice = screen.getByRole('navigation', { name: 'Configuración' })
    expect(within(indice).getByText('Operaciones')).toBeInTheDocument()
    expect(within(indice).getByText('Flota')).toBeInTheDocument()
    expect(within(indice).queryByText('Certificación')).toBeNull()
    expect(within(indice).queryByText('Seguros')).toBeNull()
    expect(within(indice).queryByText('Personas y accesos')).toBeNull()
  })

  it('users.manage muestra Personas y accesos; insurance.configure, Seguros', () => {
    permisos = ['users.manage', 'insurance.configure']
    montar()
    const indice = screen.getByRole('navigation', { name: 'Configuración' })
    expect(within(indice).getByText('Personas y accesos')).toBeInTheDocument()
    expect(within(indice).getByText('Seguros')).toBeInTheDocument()
    expect(within(indice).getByRole('link', { name: /Alertas de vencimiento/ }))
      .toHaveAttribute('href', '/dashboard/admin/settings/insurance/expiry-alerts')
  })

  it('la sección activa lo declara; cada entrada enlaza a su ruta', () => {
    montar()
    const activa = screen.getByRole('link', { name: /Motivos de conductor/ })
    expect(activa).toHaveAttribute('aria-current', 'page')
    expect(activa).toHaveAttribute('href', '/dashboard/admin/settings/operations/driver-reasons')
    expect(screen.getByRole('link', { name: /Estados del tablero/ })).not.toHaveAttribute('aria-current')
  })

  it('muestra cuánto falta revisar por sección, sin cifra mientras carga ni cuando es cero', async () => {
    vi.mocked(inventarioApi.get).mockReturnValueOnce(new Promise(() => {}))
    const { unmount } = montar()
    expect(screen.getByRole('link', { name: /Motivos de conductor/ })).not.toHaveTextContent(/\d/)
    unmount()
    montar()
    await waitFor(() => expect(screen.getByRole('link', { name: /Motivos de conductor/ })).toHaveTextContent('21'))
    expect(screen.getByRole('link', { name: /Estados del tablero/ })).not.toHaveTextContent(/\d/)
  })

  it('roles.manage sin users.manage no ve Personas y accesos: la API no le deja listar ni personas ni roles', () => {
    permisos = ['roles.manage', 'operations.configure']
    montar()
    expect(screen.queryByText('Personas y accesos')).toBeNull()
  })
})

