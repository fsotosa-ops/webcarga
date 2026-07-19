import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AvailabilityPanel } from './AvailabilityPanel'
import { tripsApi } from '@/lib/api/trips'
import type { AvailableDriver, AvailableAsset } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: {
    availableDrivers: vi.fn(),
    availableAssets:  vi.fn(),
  },
}))

const DRIVER: AvailableDriver = {
  driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '12345678-9',
  driver_phone: '+56911112222', tractor_plate: 'ABCD12', carrier_name: 'TransCargo',
  trips_total: 0, last_report_at: null,
}

const ASSET: AvailableAsset = {
  asset_id: 'a1', tractor_plate: 'WXYZ99', asset_type: 'TRACTOCAMION',
  carrier_name: 'TransCargo', trips_total: 0, last_report_at: null, driver_name: null,
}

function renderPanel(props: Partial<React.ComponentProps<typeof AvailabilityPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AvailabilityPanel
        open fecha="2026-07-18"
        onClose={vi.fn()}
        onAssignDriver={vi.fn()}
        onAssignAsset={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(tripsApi.availableDrivers).mockResolvedValue([DRIVER])
  vi.mocked(tripsApi.availableAssets).mockResolvedValue([ASSET])
})

describe('AvailabilityPanel', () => {
  it('shows the Conductores tab by default with driver rows', async () => {
    renderPanel()
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
  })

  it('switches to the Equipos tab and loads assets', async () => {
    renderPanel()
    await screen.findByText('Juan Pérez')
    fireEvent.click(screen.getByText('Equipos'))
    expect(await screen.findByText('WXYZ99')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('calls onAssignDriver with the driver row when clicking Asignar a viaje nuevo', async () => {
    const onAssignDriver = vi.fn()
    renderPanel({ onAssignDriver })
    await screen.findByText('Juan Pérez')
    fireEvent.click(screen.getByText('Asignar a viaje nuevo'))
    expect(onAssignDriver).toHaveBeenCalledWith(DRIVER)
  })

  it('calls onAssignAsset with the asset row when clicking Asignar a viaje nuevo on the Equipos tab', async () => {
    const onAssignAsset = vi.fn()
    renderPanel({ onAssignAsset })
    await screen.findByText('Juan Pérez')
    fireEvent.click(screen.getByText('Equipos'))
    await screen.findByText('WXYZ99')
    fireEvent.click(screen.getByText('Asignar a viaje nuevo'))
    expect(onAssignAsset).toHaveBeenCalledWith(ASSET)
  })

  it('shows an empty state when there are no available drivers', async () => {
    vi.mocked(tripsApi.availableDrivers).mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Ningún conductor disponible en este momento')).toBeInTheDocument()
  })

  it('shows an empty state when there are no available assets', async () => {
    vi.mocked(tripsApi.availableAssets).mockResolvedValue([])
    renderPanel()
    await screen.findByText('Juan Pérez')
    fireEvent.click(screen.getByText('Equipos'))
    expect(await screen.findByText('Ningún equipo disponible en este momento')).toBeInTheDocument()
  })

  it('does not render anything when closed', () => {
    renderPanel({ open: false })
    expect(screen.queryByLabelText('Disponibilidad')).not.toBeInTheDocument()
  })
})
