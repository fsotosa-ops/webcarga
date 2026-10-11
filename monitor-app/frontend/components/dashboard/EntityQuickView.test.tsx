import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/entitySummary', async original => ({
  ...(await original<typeof import('@/lib/api/entitySummary')>()),
  fetchEntitySummary: vi.fn(),
}))

import { fetchEntitySummary } from '@/lib/api/entitySummary'
import { EntityQuickView } from './EntityQuickView'
import type { QuickViewTarget } from '@/lib/quickView'

const DOCS = { ok: 12, expiring: 3, expired: 2, missing: 0,
  attention: [{ name: 'Licencia A5', state: 'expired' as const, due_on: '2026-10-02' }] }

const DRIVER = {
  id: 'd1', full_name: 'Vidal Gallardo Jaime Guillermo', tax_id: '15987654-3', operational_status: 'ACTIVE',
  carrier: { id: 'c1', name: 'Soc. de Transportes Hueraman' }, home_location: { name: 'CD Lo Aguirre', shipper: 'Walmart' },
  usual_tractor: { id: 'a1', plate: 'HFVP14' }, phone: '+56987654321', documents: DOCS,
}

function renderView(target: QuickViewTarget, props: Partial<Parameters<typeof EntityQuickView>[0]> = {}) {
  const handlers = { onNavigate: vi.fn(), onBack: vi.fn(), onClose: vi.fn() }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntityQuickView target={target} canGoBack={false} returnTo="/dashboard/operations/closures?date=2026-10-08"
                       {...handlers} {...props} />
    </QueryClientProvider>,
  )
  return handlers
}

beforeEach(() => { vi.mocked(fetchEntitySummary).mockReset() })

describe('EntityQuickView', () => {
  it('mientras carga ya muestra a quién se abrió, sin cifras', () => {
    vi.mocked(fetchEntitySummary).mockReturnValue(new Promise(() => {}))
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal Gallardo Jaime Guillermo' })
    expect(screen.getByRole('heading', { name: 'Vidal Gallardo Jaime Guillermo' })).toBeInTheDocument()
    expect(screen.queryByText(/al día/)).toBeNull()
  })

  it('conductor: dónde trabaja, teléfono para llamar y documentación', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(DRIVER as never)
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal Gallardo Jaime Guillermo' })
    expect(await screen.findByText('CD Lo Aguirre · Walmart')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+56987654321' })).toHaveAttribute('href', 'tel:+56987654321')
    expect(screen.getByText('12 al día')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
  })

  it('un nombre dentro del panel cambia el panel a esa entidad', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(DRIVER as never)
    const { onNavigate } = renderView({ kind: 'driver', id: 'd1', label: 'Vidal' })
    fireEvent.click(await screen.findByRole('button', { name: 'Ver empresa Soc. de Transportes Hueraman' }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'carrier', id: 'c1', label: 'Soc. de Transportes Hueraman' })
    fireEvent.click(screen.getByRole('button', { name: 'Ver equipo HFVP14' }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'asset', id: 'a1', label: 'HFVP14' })
  })

  it('sin teléfono, sin origen y sin tracto lo dice', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(
      { ...DRIVER, phone: null, home_location: null, usual_tractor: null, carrier: null } as never)
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal' })
    expect(await screen.findByText('Sin teléfono')).toBeInTheDocument()
    expect(screen.getByText('Sin origen habitual')).toBeInTheDocument()
    expect(screen.getByText('Sin tracto habitual')).toBeInTheDocument()
    expect(screen.getByText('Sin empresa asignada')).toBeInTheDocument()
  })

  it('de baja lo marca y dice cómo volver a operar', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue({ ...DRIVER, operational_status: 'INACTIVE' } as never)
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal' })
    expect(await screen.findByText('De baja')).toBeInTheDocument()
    expect(screen.getByText(/reactívalo desde su ficha/)).toBeInTheDocument()
  })

  it('si falla, lo dice sin tocar el Cierre y deja reintentar', async () => {
    vi.mocked(fetchEntitySummary).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(DRIVER as never)
    renderView({ kind: 'asset', id: 'a1', label: 'HFVP14' })
    expect(await screen.findByText('No se pudo cargar la información del equipo.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('12 al día')).toBeInTheDocument()
  })

  it('equipo y empresa traen lo suyo', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValueOnce({
      id: 'a1', license_plate: 'HFVP14', asset_type: 'TRACTOCAMION', manufacture_year: 2019, operation_type: 'Tractoreo',
      operational_status: 'ACTIVE', carrier: { id: 'c1', name: 'Hueraman' }, usual_driver: { id: 'd1', name: 'Vidal' },
      documents: DOCS,
    } as never)
    renderView({ kind: 'asset', id: 'a1', label: 'HFVP14' })
    expect(await screen.findByText('Tractocamión · 2019')).toBeInTheDocument()
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver conductor Vidal' })).toBeInTheDocument()
  })

  it('empresa: clientes, dotación y contacto principal', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValueOnce({
      id: 'c1', business_name: 'Hueraman', tax_id: '76543210-1', operational_status: 'ACTIVE',
      shippers: [{ id: 's1', name: 'Walmart' }], active_drivers: 8, active_assets: 9,
      primary_contact: { name: 'María Soto', phone: '+56912345678' }, documents: DOCS,
    } as never)
    renderView({ kind: 'carrier', id: 'c1', label: 'Hueraman' })
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
    expect(screen.getByText('8 activos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+56912345678' })).toHaveAttribute('href', 'tel:+56912345678')
  })

  it('"Abrir ficha completa" lleva a la dirección canónica con la vuelta al Cierre', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(DRIVER as never)
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal' })
    expect(screen.getByRole('link', { name: 'Abrir ficha completa' })).toHaveAttribute(
      'href', `/dashboard/drivers/d1?next=${encodeURIComponent('/dashboard/operations/closures?date=2026-10-08')}`)
  })

  it('con algo atrás ofrece volver', () => {
    vi.mocked(fetchEntitySummary).mockReturnValue(new Promise(() => {}))
    const { onBack } = renderView({ kind: 'carrier', id: 'c1', label: 'Hueraman' }, { canGoBack: true })
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('EntityQuickView accesible', () => {
  it('el panel se anuncia con el tipo y el nombre de la entidad', () => {
    vi.mocked(fetchEntitySummary).mockReturnValue(new Promise(() => {}))
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal Gallardo' })
    expect(screen.getByRole('dialog', { name: 'Conductor Vidal Gallardo' })).toBeInTheDocument()
  })
})
