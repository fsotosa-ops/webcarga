import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DocumentList } from './DocumentList'
import type { ComplianceRecord } from '@/lib/types'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { uploadAndClassify: vi.fn().mockResolvedValue({ applied: ['i1'], errors: [] }) },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listFiles: vi.fn().mockResolvedValue([]), listPending: vi.fn(), reassign: vi.fn(), patch: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'

const REGISTROS: ComplianceRecord[] = [
  { id: 'cr1', requirement_id: 'req1', requirement_code: 'ROL_SII', name: 'Rol SII',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, updated_at: null },
  { id: 'cr2', requirement_id: 'req2', requirement_code: 'F30', name: 'F30',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED_MANUAL',
    expiration_date: '2027-01-01', file_url: 'https://x/f30.pdf', metadata: {},
    is_manual_override: false, is_expired: false, is_expiring_soon: false, updated_at: null },
]

function setup(over: Record<string, unknown> = {}) {
  const onChanged = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DocumentList
        records={REGISTROS} carrierId="c1" entityType="CARRIER" entityId="c1"
        onChanged={onChanged} {...over}
      />
    </QueryClientProvider>,
  )
  return onChanged
}

beforeEach(() => vi.clearAllMocks())

describe('DocumentList', () => {
  it('muestra cada requisito, con archivo o sin él', () => {
    setup()
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('resume cuánto está cubierto', () => {
    setup()
    expect(screen.getByText(/1 de 2/)).toBeInTheDocument()
  })

  // Una sola puerta de carga: la misma que la bandeja, con el requisito ya
  // conocido. Nunca POST /compliance-records/{id}/file desde la interfaz.
  it('carga por la única puerta: ingesta y clasificación', async () => {
    setup()
    const archivo = new File(['x'], 'rol.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Subir Rol SII'), { target: { files: [archivo] } })

    await waitFor(() => {
      expect(documentIngestApi.uploadAndClassify).toHaveBeenCalledWith(
        expect.objectContaining({
          carrierId: 'c1', entityType: 'CARRIER', entityId: 'c1', requirementId: 'req1',
        }),
      )
    })
  })

  it('sólo ofrece reasignar sobre lo que ya tiene archivo', () => {
    setup()
    expect(screen.getAllByRole('button', { name: /reasignar/i })).toHaveLength(1)
  })

  it('deja declarar el vencimiento sin adjuntar archivo (HU-02)', () => {
    setup()
    expect(screen.getAllByRole('button', { name: /vencimiento/i }).length).toBeGreaterThan(0)
  })

  it('ofrece ver el archivo vigente y su historial', () => {
    setup()
    expect(screen.getByRole('button', { name: /ver archivo/i })).toBeInTheDocument()
    expect(screen.getAllByTitle('Ver historial de versiones').length).toBeGreaterThan(0)
  })

  // Un documento se sube a un lote de una empresa: sin empresa no hay dónde.
  it('sin empresa no se puede cargar, y lo dice', () => {
    setup({ carrierId: null })
    expect(screen.queryByLabelText('Subir Rol SII')).not.toBeInTheDocument()
    expect(screen.getByText(/sin empresa asignada/i)).toBeInTheDocument()
  })

  it('no deja la lista vacía sin explicación', () => {
    setup({ records: [] })
    expect(screen.getByText(/todavía no hay requisitos/i)).toBeInTheDocument()
  })
})
