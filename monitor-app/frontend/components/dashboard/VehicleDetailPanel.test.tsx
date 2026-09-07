import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VehicleDetailPanel } from './VehicleDetailPanel'
import { assetsApi } from '@/lib/api/assets'
import type { Asset, ComplianceRecord } from '@/lib/types'

vi.mock('@/lib/api/assets', () => ({
  assetsApi: {
    listComplianceRecords: vi.fn(),
    getDriverAssignment: vi.fn(),
    assignDriver: vi.fn(),
    unassignDriver: vi.fn(),
  },
}))

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'tr', label: 'Tractoreo', bg_color: '#eff6ff', text_color: '#1d4ed8' },
      { id: 'ec', label: 'Equipo Completo', bg_color: '#f3f4f6', text_color: '#374151' },
    ]),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ASSET: Asset = {
  id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION',
  operational_status: 'ACTIVE', manufacture_year: null, is_manual_override: false, created_at: null,
  fleet_service_type_id: null, fleet_service_type_label: null,
  fleet_service_type_bg_color: null, fleet_service_type_text_color: null, webcarga_operation_type_id: null, webcarga_operation_type_label: null, webcarga_operation_type_code: null,
  total_requirements: 1, last_document_update: null,
}

const RECORDS: ComplianceRecord[] = [{
  id: 'cr1', requirement_id: 'req1', requirement_code: 'PADRON', name: 'Padrón',
  requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
  expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
  is_expired: false, is_expiring_soon: false, updated_at: null,
}]

const DRIVERS = [
  { id: 'd1', full_name: 'Juan Pérez' },
  { id: 'd2', full_name: 'María López' },
]

function renderPanel(asset: Asset | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (...args: unknown[]) => Promise<void>
  onRemove?: () => Promise<void>
  drivers?: { id: string; full_name: string }[]
} = {}) {
  return renderWithClient(
    <VehicleDetailPanel
      asset={asset}
      carrierId="c1"
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
      drivers={opts.drivers ?? DRIVERS}
    />,
  )
}

describe('VehicleDetailPanel', () => {
  beforeEach(() => {
    vi.mocked(assetsApi.listComplianceRecords).mockResolvedValue(RECORDS)
    vi.mocked(assetsApi.getDriverAssignment).mockResolvedValue(null)
    vi.mocked(assetsApi.assignDriver).mockResolvedValue({ ok: true })
    vi.mocked(assetsApi.unassignDriver).mockResolvedValue({ ok: true })
  })

  it('renders nothing meaningful when asset is null', () => {
    renderPanel(null)
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
  })

  it('shows the plate and document checklist', async () => {
    renderPanel(ASSET)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Padrón')).toBeInTheDocument())
  })

  it('shows the fleet service type (Tipo Vehículo) chip when present', () => {
    renderPanel({ ...ASSET, fleet_service_type_label: 'Tractoreo', fleet_service_type_bg_color: '#eff6ff', fleet_service_type_text_color: '#1d4ed8' })
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  it('does not render a fleet service type chip when there is none', () => {
    renderPanel(ASSET)
    expect(screen.queryByText('Tractoreo')).not.toBeInTheDocument()
  })

  // HU-04: la ficha vuelve a poder cargar; el link de salida ya no existe.
  it('permite cargar la documentación del vehículo sin salir de la ficha', async () => {
    renderPanel(ASSET)
    await waitFor(() => expect(screen.getByText('Padrón')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /Subir en Certificación/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Subir Padrón')).toBeInTheDocument()
  })

  it('saves the edited asset_type when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(ASSET, { onPatch })
    fireEvent.change(screen.getByLabelText('Tipo de equipo'), { target: { value: 'RAMPLA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', { asset_type: 'RAMPLA', manufacture_year: undefined }))
  })

  it('saves the manufacture year when edited', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(ASSET, { onPatch })
    fireEvent.change(screen.getByLabelText('Año del vehículo'), { target: { value: '2019' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', { asset_type: 'TRACTOCAMION', manufacture_year: 2019 }))
  })

  it('pre-fills the manufacture year from the asset when reopening', () => {
    renderPanel({ ...ASSET, manufacture_year: 2015 })
    expect(screen.getByLabelText('Año del vehículo')).toHaveValue(2015)
  })

  it('shows a "Transferir a otra empresa" button only for canEdit', () => {
    // Transferir se gatea con canEdit (Ronda de arreglo 1): la baja del
    // sistema es la que sigue exigiendo canAdmin, ver el test de abajo.
    renderPanel(ASSET, { canEdit: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()

    renderPanel(ASSET, { canEdit: true, canAdmin: false })
    expect(screen.getByRole('button', { name: /Transferir/ })).toBeInTheDocument()
  })

  it('shows "Quitar del roster" only when canEdit, and calls onRemove when clicked', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(ASSET, { onRemove, canEdit: false })
    expect(screen.queryByRole('button', { name: /Quitar del roster/ })).not.toBeInTheDocument()

    renderPanel(ASSET, { onRemove, canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: /Quitar del roster/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })

  it('shows "Dar de baja" for an active asset, opens the confirm modal, and PATCHes operational_status on confirm', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(ASSET, { onPatch })
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    expect(screen.getByText(/Dar de baja: equipo/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', { operational_status: 'INACTIVE' }))
  })

  it('shows "Reactivar" for an inactive asset, and PATCHes operational_status when clicked', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel({ ...ASSET, operational_status: 'INACTIVE' }, { onPatch })
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(onPatch).toHaveBeenCalledWith('v1', { operational_status: 'ACTIVE' })
  })

  it('does not show baja/reactivar buttons when canAdmin is false', () => {
    renderPanel(ASSET, { canAdmin: false })
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
  })

  it('assigns the picked driver via assetsApi.assignDriver', async () => {
    renderPanel(ASSET)
    await waitFor(() => expect(screen.getByLabelText('Asignar conductor habitual')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Asignar conductor habitual'), { target: { value: 'd2' } })
    fireEvent.click(screen.getByLabelText('Confirmar conductor habitual'))
    await waitFor(() => expect(assetsApi.assignDriver).toHaveBeenCalledWith('v1', 'd2'))
  })

  it('shows the assigned driver name and unassigns on click', async () => {
    vi.mocked(assetsApi.getDriverAssignment).mockResolvedValue({
      id: 'va1', driver_id: 'd1', driver_name: 'Juan Pérez', start_date: '2026-07-18',
    })
    renderPanel(ASSET)
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('Quitar conductor habitual'))
    await waitFor(() => expect(assetsApi.unassignDriver).toHaveBeenCalledWith('v1'))
  })

  it('does not show the unassign button when canEdit is false', async () => {
    vi.mocked(assetsApi.getDriverAssignment).mockResolvedValue({
      id: 'va1', driver_id: 'd1', driver_name: 'Juan Pérez', start_date: '2026-07-18',
    })
    renderPanel(ASSET, { canEdit: false })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
    expect(screen.queryByLabelText('Quitar conductor habitual')).not.toBeInTheDocument()
  })
  // ── Regresión del 2026-09-07 ──────────────────────────────────────────────
  // El tipo de operación decide si el equipo bloquea el cierre del día, y no
  // había ninguna pantalla donde cambiarlo después del alta.

  it('el tipo de operación se puede elegir y se guarda', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel({ ...ASSET, webcarga_operation_type_id: null }, { onPatch })

    // Esperar la OPCION, no el select: cambiar a un value que todavia no
    // existe entre las options es un no-op silencioso.
    await screen.findByRole('option', { name: 'Tractoreo' })
    const select = screen.getByLabelText('Tipo de operación')
    expect(select).toHaveValue('')
    fireEvent.change(select, { target: { value: 'tr' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith('v1', expect.objectContaining({
        webcarga_operation_type_id: 'tr',
      }))
    })
  })

  it('sin tipo de operación avisa la consecuencia, no sólo que falta el dato', async () => {
    renderPanel({ ...ASSET, webcarga_operation_type_id: null })

    expect(await screen.findByText(/bloquea el cierre del día/)).toBeInTheDocument()
  })

  it('el draft del tipo de operación se resincroniza desde el prop al abrir otro equipo', async () => {
    const { rerender } = renderPanel({ ...ASSET, webcarga_operation_type_id: 'tr' })
    expect(await screen.findByLabelText('Tipo de operación')).toHaveValue('tr')

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <VehicleDetailPanel
          asset={{ ...ASSET, id: 'v2', webcarga_operation_type_id: 'ec' }}
          carrierId="c1" canEdit canAdmin={false}
          onClose={vi.fn()} onPatch={vi.fn()} onRemove={vi.fn()} onTransferClick={vi.fn()}
          drivers={DRIVERS}
        />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('Tipo de operación')).toHaveValue('ec'))
  })

  it('un tipo de operación vacío no viaja como null: vacío es "no lo toques"', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel({ ...ASSET, webcarga_operation_type_id: null }, { onPatch })

    await screen.findByLabelText('Tipo de operación')
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() => expect(onPatch).toHaveBeenCalled())
    expect(onPatch.mock.calls[0][1].webcarga_operation_type_id).toBeUndefined()
  })
})
