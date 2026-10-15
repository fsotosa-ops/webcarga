import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/carriers', () => ({ carriersApi: { listInsuranceOverview: vi.fn() } }))

import { carriersApi } from '@/lib/api/carriers'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'
import SegurosPage from './page'

describe('Seguros', () => {
  // N2 (Entrega 1 de fichas): la empresa de cada fila lleva a su vista rápida
  // (y con Ctrl/Cmd + clic, a su ficha). En la tabla; la tarjeta del teléfono
  // es entera un botón y un enlace adentro sería un control anidado.
  it('N2: en la tabla, la empresa es un enlace a su ficha', async () => {
    vi.mocked(carriersApi.listInsuranceOverview).mockResolvedValue({
      data: [{ carrier_id: 'c1', business_name: 'Transportes Andes', tax_id: '76555555-8', operational_status: 'ACTIVE',
        total_policies: 1, total_overdue_installments: 0, next_payment_date: null, worst_policy_health: 'VALID' }],
      count: 1, facets: { expired: 0, expiring_soon: 0, valid: 1, cancelled: 0, no_policy: 0, total: 1 },
    } as never)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <QuickViewContext.Provider value={vi.fn()}><SegurosPage /></QuickViewContext.Provider>
      </QueryClientProvider>,
    )
    const tabla = await screen.findByRole('table')
    expect(await within(tabla).findByRole('link', { name: 'Ver empresa Transportes Andes' })).toHaveAttribute('href', '/dashboard/carriers/c1')
  })

  // Seguros con el kit (15/10): filtros con el control segmentado, cabecera sin
  // mayúsculas y el buscador en el vocabulario del usuario.
  it('SG1: filtros con el control segmentado, cabecera del kit y buscador por RUT', async () => {
    vi.mocked(carriersApi.listInsuranceOverview).mockResolvedValue({
      data: [{ carrier_id: 'c1', business_name: 'Transportes Andes', tax_id: '76555555-8', operational_status: 'ACTIVE',
        total_policies: 1, total_overdue_installments: 0, next_payment_date: null, worst_policy_health: 'VALID' }],
      count: 1, facets: { expired: 0, expiring_soon: 0, valid: 1, cancelled: 0, no_policy: 0, total: 1 },
    } as never)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <QuickViewContext.Provider value={vi.fn()}><SegurosPage /></QuickViewContext.Provider>
      </QueryClientProvider>,
    )
    await screen.findByRole('table')
    const activas = within(screen.getByRole('group', { name: 'Ciclo de vida' })).getByRole('button', { name: /^Activas/ })
    expect(activas.className).toMatch(/text-accion/)
    expect(within(screen.getByRole('group', { name: 'Estado de las pólizas' })).getByRole('button', { name: /^Todas/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: 'Empresa' }).className).not.toMatch(/uppercase/)
    expect(screen.getByPlaceholderText('Nombre o RUT…')).toBeInTheDocument()
  })
})
