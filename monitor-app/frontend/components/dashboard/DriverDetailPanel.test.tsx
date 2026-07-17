import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverDetailPanel } from './DriverDetailPanel'
import { driversApi } from '@/lib/api/drivers'
import { complianceApi } from '@/lib/api/compliance'
import type { Driver, ComplianceRecord } from '@/lib/types'

vi.mock('@/lib/api/drivers', () => ({
  driversApi: { listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { patch: vi.fn(), uploadFile: vi.fn() },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const DRIVER: Driver = {
  id: 'd1', tax_id: '11111111-1', country_code: 'CL', full_name: 'Juan Pérez',
  operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
  total_requirements: 1, last_document_update: null,
}

const RECORDS: ComplianceRecord[] = [{
  id: 'cr1', requirement_id: 'req1', requirement_code: 'EPP', name: 'EPP',
  requirement_level: 'LEGAL_MANDATORY', requires_file: false, status: 'MISSING',
  expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
  is_expired: false, is_expiring_soon: false,
}]

function renderPanel(driver: Driver | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (...args: unknown[]) => Promise<void>
  onRemove?: () => Promise<void>
} = {}) {
  return renderWithClient(
    <DriverDetailPanel
      driver={driver}
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
    />,
  )
}

describe('DriverDetailPanel', () => {
  beforeEach(() => {
    vi.mocked(driversApi.listComplianceRecords).mockResolvedValue(RECORDS)
  })

  it('renders nothing meaningful when driver is null', () => {
    renderPanel(null)
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('shows the driver name, tax_id and document checklist', async () => {
    renderPanel(DRIVER)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('EPP')).toBeInTheDocument())
  })

  it('calls complianceApi.patch when a status select changes', async () => {
    renderPanel(DRIVER)
    await waitFor(() => expect(screen.getByLabelText('Estado de EPP')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Estado de EPP'), { target: { value: 'APPROVED' } })
    await waitFor(() => expect(complianceApi.patch).toHaveBeenCalledWith('cr1', { status: 'APPROVED' }))
  })

  it('does not show the status select when canEdit is false', async () => {
    renderPanel(DRIVER, { canEdit: false })
    await waitFor(() => expect(screen.getByText('EPP')).toBeInTheDocument())
    expect(screen.queryByLabelText('Estado de EPP')).not.toBeInTheDocument()
  })

  it('saves the edited name when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Juan Pablo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('d1', { full_name: 'Juan Pablo' }))
  })

  it('shows a "Transferir a otra empresa" button only for canAdmin', () => {
    renderPanel(DRIVER, { canAdmin: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('calls onTransferClick when the transfer button is clicked', () => {
    const onTransferClick = vi.fn()
    renderWithClient(
      <DriverDetailPanel
        driver={DRIVER} canEdit={true} canAdmin={true}
        onClose={vi.fn()} onPatch={vi.fn().mockResolvedValue(undefined)}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onTransferClick={onTransferClick}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Transferir/ }))
    expect(onTransferClick).toHaveBeenCalled()
  })

  it('shows "Quitar del roster" only when canEdit, and calls onRemove when clicked', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onRemove, canEdit: false })
    expect(screen.queryByRole('button', { name: /Quitar del roster/ })).not.toBeInTheDocument()

    renderPanel(DRIVER, { onRemove, canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: /Quitar del roster/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })

  it('shows "Dar de baja" for an active driver, opens the confirm modal, and PATCHes operational_status on confirm', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    expect(screen.getByText(/Dar de baja: conductor/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('d1', { operational_status: 'INACTIVE' }))
  })

  it('shows "Reactivar" for an inactive driver, and PATCHes operational_status when clicked', () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel({ ...DRIVER, operational_status: 'INACTIVE' }, { onPatch })
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(onPatch).toHaveBeenCalledWith('d1', { operational_status: 'ACTIVE' })
  })

  it('does not show baja/reactivar buttons when canAdmin is false', () => {
    renderPanel(DRIVER, { canAdmin: false })
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
  })
})
