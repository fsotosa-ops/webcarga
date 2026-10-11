import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingSummaryRow } from '@/lib/types'

// La URL se mueve por test (mismo patrón que Sidebar.test.tsx).
const nav = vi.hoisted(() => ({ qs: '', replace: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.qs),
  usePathname: () => '/dashboard/compliance/pending',
}))
const permiso = vi.hoisted(() => ({ upload: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => p === 'documents.upload' ? permiso.upload : true,
}))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: {
  pendingSummary: vi.fn(),
  listPending: vi.fn(),
  uploadFile: vi.fn(),
} }))
import { complianceApi } from '@/lib/api/compliance'
import PendingDocumentsPage from './page'

const F30: PendingSummaryRow = { key: 'req-f30', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'NONE', vigencia: null, overdue: 9, expiring: 4, missing: 21 }
const LIC: PendingSummaryRow = { ...F30, key: 'req-lic', label: 'Licencia de Conducir', requirement_code: 'LIC',
  target_entity: 'DRIVER', overdue: 4, expiring: 3, missing: 68 }
const CORDILLERA: PendingSummaryRow = { ...F30, key: 'c1', label: 'Transportes Cordillera SpA',
  requirement_code: null, target_entity: null, expiration_policy: null, overdue: 3, expiring: 1, missing: 4 }

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PendingDocumentsPage />
    </QueryClientProvider>,
  )
}

/** La URL que se escribió en el último `router.replace`, como parámetros. */
const ultimaUrl = () => new URLSearchParams(String(nav.replace.mock.lastCall?.[0]).split('?')[1] ?? '')

beforeEach(() => {
  vi.clearAllMocks()
  nav.qs = ''
  permiso.upload = true
  vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
})

describe('Pendientes — los estados de la pantalla', () => {
  it('mientras carga no muestra ninguna cifra', () => {
    vi.mocked(complianceApi.pendingSummary).mockReturnValue(new Promise(() => {}))
    montar()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument()
  })

  it('sin nada pendiente dice que está todo al día', async () => {
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [] })
    montar()
    expect(await screen.findByText('Todo al día')).toBeInTheDocument()
    expect(screen.getByText('Ninguna empresa, conductor ni equipo activo debe documentos.')).toBeInTheDocument()
  })

  it('si el resumen no carga, error con reintentar y nunca "Todo al día"', async () => {
    vi.mocked(complianceApi.pendingSummary).mockRejectedValue(new Error('500'))
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar lo pendiente.')
    expect(screen.getByRole('alert')).toHaveTextContent('Lo que ya estaba cargado no se perdió.')
    expect(screen.queryByText('Todo al día')).not.toBeInTheDocument()
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Todo al día')).toBeInTheDocument()
  })

  it('pide el resumen por documento por defecto', async () => {
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [] })
    montar()
    await screen.findByText('Todo al día')
    expect(complianceApi.pendingSummary).toHaveBeenCalledWith('requirement')
  })

  it('sin documents.upload se ve todo, sin Subir ni zona de arrastre', async () => {
    permiso.upload = false
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30] })
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [{
      id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Andes Ltda', carrier_tax_id: null,
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA', entity_type: 'CARRIER',
      entity_id: 'c1', subject_name: null, requirement_id: 'req-f30', requirement_code: 'F30_1',
      document_name: 'F30-1', status: 'APPROVED_MANUAL', expiration_date: null, tiene_archivo: true,
      urgencia: 'VENCIDO', document_state: 'OVERDUE', expiration_policy: 'NONE', due_on: '2026-09-18',
    }] })
    montar()
    expect(await screen.findByText('Transportes Andes Ltda')).toBeInTheDocument()
    expect(screen.getByText('Venció el 18/09')).toBeInTheDocument()
    expect(screen.queryByText('Subir')).not.toBeInTheDocument()
    expect(screen.queryByText(/Arrastra varios/)).not.toBeInTheDocument()
  })
})

describe('Pendientes — la URL', () => {
  it('sin parámetros: por documento, vencidos y el primero de la lista', async () => {
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30, LIC] })
    montar()
    expect(await screen.findByRole('option', { name: /F30-1/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('group', { name: 'Ver por' })).getByRole('button', { name: 'Documento' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'overdue', requirementCode: 'F30_1' }))
  })

  it('lee doc y state de la dirección', async () => {
    nav.qs = 'doc=LIC&state=missing'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30, LIC] })
    montar()
    expect(await screen.findByRole('option', { name: /Licencia de Conducir/ })).toHaveAttribute('aria-selected', 'true')
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'missing', requirementCode: 'LIC' }))
    expect(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /Faltan/ }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('"Todos" en la dirección pide los tres pendientes', async () => {
    nav.qs = 'state=all'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30] })
    montar()
    await screen.findByRole('option', { name: /F30-1/ })
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'pending' }))
  })

  it('un state desconocido cae en vencidos', async () => {
    nav.qs = 'state=cualquiera'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30] })
    montar()
    await screen.findByRole('option', { name: /F30-1/ })
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ state: 'overdue' }))
  })

  it('elegir un documento escribe doc con su código, sin tocar el filtro', async () => {
    nav.qs = 'state=expiring'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30, LIC] })
    montar()
    fireEvent.click(await screen.findByRole('option', { name: /Licencia de Conducir/ }))
    expect(nav.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/dashboard\/compliance\/pending\?/), { scroll: false })
    expect(ultimaUrl().get('doc')).toBe('LIC')
    expect(ultimaUrl().get('state')).toBe('expiring')
  })

  it('cambiar el filtro escribe state', async () => {
    nav.qs = 'doc=F30_1'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30] })
    montar()
    await screen.findByRole('option', { name: /F30-1/ })
    fireEvent.click(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /Por vencer/ }))
    expect(ultimaUrl().get('state')).toBe('expiring')
    expect(ultimaUrl().get('doc')).toBe('F30_1')
  })

  it('pasar a "Empresa" escribe by=carrier y suelta el documento elegido', async () => {
    nav.qs = 'doc=F30_1&state=missing'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30] })
    montar()
    await screen.findByRole('option', { name: /F30-1/ })
    fireEvent.click(within(screen.getByRole('group', { name: 'Ver por' })).getByRole('button', { name: 'Empresa' }))
    expect(ultimaUrl().get('by')).toBe('carrier')
    expect(ultimaUrl().get('doc')).toBeNull()
    expect(ultimaUrl().get('state')).toBe('missing')
  })

  it('by=carrier&carrier=<id>: resumen por empresa y lo que debe esa empresa', async () => {
    nav.qs = 'by=carrier&carrier=c1'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [CORDILLERA] })
    montar()
    expect(await screen.findByRole('option', { name: /Transportes Cordillera SpA/ })).toHaveAttribute('aria-selected', 'true')
    expect(complianceApi.pendingSummary).toHaveBeenCalledWith('carrier')
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ carrierId: 'c1' }))
  })

  it('por empresa, elegir escribe carrier con su id', async () => {
    nav.qs = 'by=carrier'
    const ANDES = { ...CORDILLERA, key: 'c2', label: 'Transportes Andes Ltda' }
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [CORDILLERA, ANDES] })
    montar()
    fireEvent.click(await screen.findByRole('option', { name: /Transportes Andes Ltda/ }))
    expect(ultimaUrl().get('carrier')).toBe('c2')
    expect(ultimaUrl().get('by')).toBe('carrier')
  })

  it('en el teléfono, la flecha de volver suelta lo elegido', async () => {
    nav.qs = 'doc=LIC'
    vi.mocked(complianceApi.pendingSummary).mockResolvedValue({ rows: [F30, LIC] })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Volver a la lista' }))
    expect(ultimaUrl().get('doc')).toBeNull()
  })
})
