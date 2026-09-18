import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverDetailPanel } from './DriverDetailPanel'
import { driversApi } from '@/lib/api/drivers'
import { contactsApi } from '@/lib/api/contacts'
import { locationsApi } from '@/lib/api/locations'
import type { Driver, ComplianceRecord, Contact } from '@/lib/types'

vi.mock('@/lib/api/drivers', () => ({
  driversApi: { listComplianceRecords: vi.fn(), listContacts: vi.fn(), createContact: vi.fn() },
}))
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: { patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn() },
}))

// La forma real de locationsApi.list, copiada de lib/api/locations.ts
// (LocationListResponse) y no inferida del nombre: un mock con la forma
// equivocada hace pasar el test por la razón incorrecta.
const CD_PENON = { id: 'cd-penon', name: 'CD EL PEÑON' }
const CD_QUILICURA = { id: 'cd-quilicura', name: 'CD QUILICURA' }
function respuestaDeCds(cds = [CD_PENON, CD_QUILICURA]) {
  return { data: cds as never, count: cds.length, page: 1, limit: 200 }
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const DRIVER: Driver = {
  id: 'd1', tax_id: '11111111-1', country_code: 'CL', full_name: 'Juan Pérez',
  operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
  total_requirements: 1, last_document_update: null,
  home_location_id: null, home_location_name: null,
  home_location_shipper: null, suggested_home_location: null,
}

const RECORDS: ComplianceRecord[] = [{
  id: 'cr1', requirement_id: 'req1', requirement_code: 'EPP', name: 'EPP',
  requirement_level: 'LEGAL_MANDATORY', requires_file: false, status: 'MISSING',
  expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
  is_expired: false, is_expiring_soon: false, updated_at: null,
}]

function renderPanel(driver: Driver | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (...args: unknown[]) => Promise<void>
  onRemove?: () => Promise<void>
} = {}) {
  return renderWithClient(
    <DriverDetailPanel
      driver={driver}
      carrierId="c1"
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
    />,
  )
}

const CONTACTS: Contact[] = [{
  id: 'ct1', contact_role: 'PERSONAL', first_name: 'Juan', last_name: 'Pérez',
  job_title: null, email: 'juan@example.com', phone: '+56911111111', is_primary: false, is_active: true,
}]

describe('DriverDetailPanel', () => {
  beforeEach(() => {
    vi.mocked(locationsApi.list).mockReset().mockResolvedValue(respuestaDeCds())
    vi.mocked(driversApi.listComplianceRecords).mockResolvedValue(RECORDS)
    vi.mocked(driversApi.listContacts).mockReset().mockResolvedValue([])
    vi.mocked(driversApi.createContact).mockReset()
    vi.mocked(contactsApi.patch).mockReset()
    vi.mocked(contactsApi.delete).mockReset()
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

  it('does not show a status select — documents are read-only here, editing lives in Certificación', async () => {
    renderPanel(DRIVER)
    await waitFor(() => expect(screen.getByText('EPP')).toBeInTheDocument())
    expect(screen.queryByLabelText('Estado de EPP')).not.toBeInTheDocument()
  })

  // HU-04: la ficha vuelve a poder cargar. El link "Subir en Certificación"
  // se retiró — apuntaba a una vista que dejó de existir al unificar el módulo.
  it('permite cargar la documentación del conductor sin salir de la ficha', async () => {
    // EPP no exige archivo; para probar la carga hace falta uno que sí.
    vi.mocked(driversApi.listComplianceRecords).mockResolvedValue([
      { ...RECORDS[0], id: 'cr2', requirement_code: 'LICENCIA', name: 'Licencia',
        requires_file: true },
    ])
    renderPanel(DRIVER)
    await waitFor(() => expect(screen.getByText('Licencia')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /Subir en Certificación/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Subir Licencia')).toBeInTheDocument()
  })

  it('saves the edited name when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Juan Pablo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    // `home_location_id: ''` viaja a propósito: significa "sin CD base", y es
    // distinto de omitir la clave, que significaría "no lo toques".
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith(
      'd1', { full_name: 'Juan Pablo', home_location_id: '' },
    ))
  })

  it('shows a "Transferir a otra empresa" button only for canEdit', () => {
    // Transferir se gatea con canEdit (Ronda de arreglo 1): la baja del
    // sistema es la que sigue exigiendo canAdmin, ver el test de abajo.
    renderPanel(DRIVER, { canEdit: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()

    renderPanel(DRIVER, { canEdit: true, canAdmin: false })
    expect(screen.getByRole('button', { name: /Transferir/ })).toBeInTheDocument()
  })

  it('calls onTransferClick when the transfer button is clicked', () => {
    const onTransferClick = vi.fn()
    renderWithClient(
      <DriverDetailPanel
        driver={DRIVER} carrierId="c1" canEdit={true} canAdmin={true}
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

  it('shows existing contacts with their phone and email', async () => {
    vi.mocked(driversApi.listContacts).mockResolvedValue(CONTACTS)
    renderPanel(DRIVER)
    expect(await screen.findByText('Juan Pérez', { selector: 'p.text-xs' })).toBeInTheDocument()
    expect(screen.getByText('+56911111111')).toBeInTheDocument()
    expect(screen.getByText('juan@example.com')).toBeInTheDocument()
  })

  it('adds a new contact via driversApi.createContact, allowing a second phone/email', async () => {
    vi.mocked(driversApi.listContacts).mockResolvedValue(CONTACTS)
    vi.mocked(driversApi.createContact).mockResolvedValue({ ...CONTACTS[0], id: 'ct2' })
    renderPanel(DRIVER)
    await screen.findByText('+ Agregar contacto')

    fireEvent.click(screen.getByText('+ Agregar contacto'))
    fireEvent.change(screen.getByPlaceholderText('Nombre'), { target: { value: 'Maria Soto' } })
    fireEvent.change(screen.getByPlaceholderText('Teléfono'), { target: { value: '+56922222222' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'maria@example.com' } })
    const guardarButtons = screen.getAllByRole('button', { name: /Guardar/ })
    fireEvent.click(guardarButtons[guardarButtons.length - 1])

    await waitFor(() => expect(driversApi.createContact).toHaveBeenCalledWith('d1', {
      contact_role: 'PERSONAL', first_name: 'Maria', last_name: 'Soto',
      phone: '+56922222222', email: 'maria@example.com',
    }))
  })

  it('deletes a contact via contactsApi.delete', async () => {
    vi.mocked(driversApi.listContacts).mockResolvedValue(CONTACTS)
    renderPanel(DRIVER)
    await screen.findByText('juan@example.com')

    fireEvent.click(screen.getByText('Eliminar'))

    await waitFor(() => expect(contactsApi.delete).toHaveBeenCalledWith('ct1'))
  })

  it('does not offer to add a contact when canEdit is false', async () => {
    vi.mocked(driversApi.listContacts).mockResolvedValue([])
    renderPanel(DRIVER, { canEdit: false })
    expect(await screen.findByText('Sin contactos registrados')).toBeInTheDocument()
    expect(screen.queryByText('+ Agregar contacto')).not.toBeInTheDocument()
  })

  // ── CD base (HU-28) ───────────────────────────────────────────────────────

  it('el desplegable de CD se alimenta del catálogo, no de los viajes del conductor', async () => {
    renderPanel(DRIVER)
    // Se pide sólo lo que es CD de origen y está activo.
    await waitFor(() => expect(locationsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ origin_cd: true, operational_status: 'ACTIVE' }),
    ))
    const select = await screen.findByLabelText('CD base') as HTMLSelectElement
    expect([...select.options].map(o => o.textContent))
      .toEqual(['Sin asignar', 'CD EL PEÑON', 'CD QUILICURA'])
  })

  it('propone el CD dominante sin escribirlo: hay que apretar y guardar', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel({
      ...DRIVER,
      suggested_home_location: { id: 'cd-penon', name: 'CD EL PEÑON', viajes: 34, total: 36, pct: 94.4 },
    }, { onPatch })

    // El botón dice el CD concreto, no "Aceptar sugerencia".
    const boton = await screen.findByRole('button', { name: 'Asignar CD EL PEÑON' })
    expect(onPatch).not.toHaveBeenCalled()   // proponer no es escribir

    fireEvent.click(boton)
    expect((screen.getByLabelText('CD base') as HTMLSelectElement).value).toBe('cd-penon')

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith(
      'd1', expect.objectContaining({ home_location_id: 'cd-penon' }),
    ))
  })

  it('con CD base puesto no ofrece ninguna sugerencia', async () => {
    renderPanel({
      ...DRIVER, home_location_id: 'cd-quilicura', home_location_name: 'CD QUILICURA',
      home_location_shipper: 'Walmart',
    })
    // Se espera al catálogo: un <select> cuyo value no tiene <option> que
    // calce todavía se renderiza vacío, y afirmar antes probaría otra cosa.
    await waitFor(() =>
      expect((screen.getByLabelText('CD base') as HTMLSelectElement).value).toBe('cd-quilicura'))
    expect(screen.queryByRole('button', { name: /^Asignar / })).not.toBeInTheDocument()
    expect(screen.getByText('Walmart')).toBeInTheDocument()
  })

  it('el borrador se resincroniza al abrir otro conductor', async () => {
    const { rerender } = renderPanel({
      ...DRIVER, home_location_id: 'cd-penon', home_location_name: 'CD EL PEÑON',
    })
    await waitFor(() =>
      expect((screen.getByLabelText('CD base') as HTMLSelectElement).value).toBe('cd-penon'))

    // Sin resincronizar desde el prop, el segundo conductor hereda el CD del
    // primero — el bug de draft que este repo ya vio cuatro veces.
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DriverDetailPanel
          driver={{ ...DRIVER, id: 'd2', home_location_id: null }}
          carrierId="c1" canEdit canAdmin={false}
          onClose={vi.fn()} onPatch={vi.fn()} onRemove={vi.fn()} onTransferClick={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect((screen.getByLabelText('CD base') as HTMLSelectElement).value).toBe(''))
  })

  it('sin permiso de edición se lee el CD pero no se puede cambiar', async () => {
    renderPanel({
      ...DRIVER, home_location_id: 'cd-penon', home_location_name: 'CD EL PEÑON',
      suggested_home_location: { id: 'cd-penon', name: 'CD EL PEÑON', viajes: 34, total: 36, pct: 94.4 },
    }, { canEdit: false })

    expect(await screen.findByLabelText('CD base')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Asignar / })).not.toBeInTheDocument()
  })

  it('si el catálogo no carga, lo dice en vez de dibujar un desplegable vacío', async () => {
    vi.mocked(locationsApi.list).mockRejectedValue(new Error('boom'))
    renderPanel(DRIVER)
    expect(await screen.findByText(/No se pudieron cargar los centros/)).toBeInTheDocument()
    expect(screen.queryByLabelText('CD base')).not.toBeInTheDocument()
  })
})
