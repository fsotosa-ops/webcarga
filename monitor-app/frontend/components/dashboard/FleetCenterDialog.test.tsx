import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FleetCenterDialog } from './FleetCenterDialog'
import { tripsApi } from '@/lib/api/trips'
import type { AvailableAssetsResponse } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { availableAssets: vi.fn() },
}))

const DATA: AvailableAssetsResponse = {
  total_active: 5,
  items: [
    {
      asset_id: 'a1', tractor_plate: 'ABCD12', asset_type: 'TRACTOCAMION',
      carrier_id: 'c1', carrier_name: 'Transportes Sur', trips_total: 0, last_report_at: null,
      driver_id: null, driver_name: null, driver_rut: null, driver_phone: null,
    },
    {
      asset_id: 'a2', tractor_plate: 'WXYZ99', asset_type: 'TRACTOCAMION',
      carrier_id: 'c2', carrier_name: 'RPS Logística', trips_total: 1, last_report_at: '2026-07-28T12:00:00Z',
      driver_id: 'd2', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: '+56911112222',
    },
  ],
  busy: [
    {
      asset_id: 'a3', tractor_plate: 'ZZZZ99', carrier_name: 'Zeus Chile Spa',
      trip_id: 't9', client_name: 'walmart', current_status: 'ORIGEN',
    },
  ],
}

function renderDialog(props: Partial<Parameters<typeof FleetCenterDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FleetCenterDialog
        open fecha="2026-07-28"
        onClose={vi.fn()} onOpenCloseDay={vi.fn()} onAssign={vi.fn()} onNewTrip={vi.fn()} onImportCsv={vi.fn()}
        onSelectTrip={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(tripsApi.availableAssets).mockReset().mockResolvedValue(DATA)
})

describe('FleetCenterDialog', () => {
  it('no renderiza nada cuando open=false', () => {
    renderDialog({ open: false })
    expect(screen.queryByText(/Centro de Flota/)).not.toBeInTheDocument()
  })

  it('muestra los equipos disponibles y los 3 tiles con los conteos correctos', async () => {
    renderDialog()
    expect(await screen.findByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nunca asignados hoy/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /Liberados tras viaje/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /En viaje hoy/ })).toHaveTextContent('1')
  })

  it('clickear "Nunca asignados hoy" filtra la tabla a solo esos equipos', async () => {
    renderDialog()
    await screen.findByText('WXYZ99')
    fireEvent.click(screen.getByRole('button', { name: /Nunca asignados hoy/ }))
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.queryByText('WXYZ99')).not.toBeInTheDocument()
  })

  it('clickear "En viaje hoy" muestra el equipo ocupado con datos reales del viaje', async () => {
    renderDialog()
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: /En viaje hoy/ }))
    expect(screen.getByText('ZZZZ99')).toBeInTheDocument()
    expect(screen.getByText('walmart')).toBeInTheDocument()
    expect(screen.getByText('ORIGEN')).toBeInTheDocument()
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
  })

  it('"Ver viaje" en un equipo ocupado llama a onSelectTrip con el trip_id real', async () => {
    const onSelectTrip = vi.fn()
    renderDialog({ onSelectTrip })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: /En viaje hoy/ }))
    fireEvent.click(await screen.findByText('Ver viaje'))
    expect(onSelectTrip).toHaveBeenCalledWith('t9')
  })

  it('la búsqueda filtra por patente, empresa o conductor', async () => {
    renderDialog()
    await screen.findByText('ABCD12')
    fireEvent.change(screen.getByLabelText('Buscar equipo'), { target: { value: 'Juan' } })
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
  })

  it('un equipo sin conductor habitual muestra el aviso correspondiente', async () => {
    renderDialog()
    expect(await screen.findByText('Sin conductor asignado hoy')).toBeInTheDocument()
  })

  it('"Asignar viaje" llama a onAssign con el FleetAssignValue completo del equipo', async () => {
    const onAssign = vi.fn()
    renderDialog({ onAssign })
    await screen.findByText('WXYZ99')
    const row = screen.getByText('WXYZ99').closest('tr')!
    fireEvent.click(within(row).getByText('Asignar viaje'))
    expect(onAssign).toHaveBeenCalledWith({
      driver_id: 'd2', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: '+56911112222',
      carrier_id: 'c2', carrier_name: 'RPS Logística',
      tractor_asset_id: 'a2', tractor_plate: 'WXYZ99', trailer_plate: null,
    })
  })

  it('el botón principal "Nuevo viaje" llama a onNewTrip directamente', async () => {
    const onNewTrip = vi.fn()
    renderDialog({ onNewTrip })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByText('Nuevo viaje'))
    expect(onNewTrip).toHaveBeenCalled()
  })

  it('el split-button abre un menú con Viaje individual e Importar CSV', async () => {
    const onImportCsv = vi.fn()
    renderDialog({ onImportCsv })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByLabelText('Más opciones de creación'))
    fireEvent.click(screen.getByText('Importar CSV (varios)'))
    expect(onImportCsv).toHaveBeenCalled()
  })

  it('el link "Ver cuadratura de conductores" llama a onOpenCloseDay', async () => {
    const onOpenCloseDay = vi.fn()
    renderDialog({ onOpenCloseDay })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByText('Ver cuadratura de conductores'))
    expect(onOpenCloseDay).toHaveBeenCalled()
  })

  it('llama a onClose al hacer click en la X', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await screen.findByText(/Centro de Flota/)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
