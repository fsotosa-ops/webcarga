import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({ complianceApi: { listPending: vi.fn(), get: vi.fn() } }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
// La subida en lote tiene su propio test; acá solo importa que esté.
vi.mock('./pending/BulkUploadReview', () => ({ BulkUploadReview: () => <div>Subida en lote</div> }))

import { complianceApi } from '@/lib/api/compliance'
import { EntityDocuments } from './EntityDocuments'

function fila(over: Partial<PendingComplianceRow>): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Andes', carrier_tax_id: '76555555-8',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'CONDUCTOR', entity_type: 'DRIVER',
    entity_id: 'd1', subject_name: 'Vidal Soto, Pedro', requirement_id: 'r1', requirement_code: 'LIC',
    document_name: 'Licencia de conducir', status: 'MISSING', expiration_date: null, tiene_archivo: false,
    document_state: 'MISSING', expiration_policy: 'REQUIRED', vence_el: null, ...over,
  } as PendingComplianceRow
}

function montar(carrierId: string | null = 'c1') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntityDocuments entityType="DRIVER" entityId="d1" carrierId={carrierId} />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.mocked(complianceApi.listPending).mockReset())

describe('EntityDocuments (la sección Documentos de una ficha)', () => {
  it('F5: abre en el primer filtro que tiene algo, en orden Vencidos → Faltan → Por vencer → Todos', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 3, rows: [
      fila({ id: 'a', document_name: 'Hoja de vida' }),
      fila({ id: 'b', document_name: 'Antecedentes' }),
      fila({ id: 'c', document_name: 'Cédula', document_state: 'UP_TO_DATE', tiene_archivo: true }),
    ] } as never)
    montar()
    await waitFor(() => expect(screen.getByRole('button', { name: /Faltan/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText('Hoja de vida')).toBeInTheDocument()
    expect(screen.queryByText('Cédula')).not.toBeInTheDocument()
  })

  it('F6: la fila de un vencido dice lo mismo que en Pendientes ("Venció el …" y "Subir")', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [
      fila({ document_state: 'OVERDUE', status: 'APPROVED_MANUAL', tiene_archivo: true, vence_el: '2026-10-02', expiration_date: '2026-10-02' }),
    ] } as never)
    montar()
    expect(await screen.findByText('Venció el 02/10')).toBeInTheDocument()
    expect(screen.getByText('Subir')).toBeInTheDocument()
  })

  it('RF1: sin empresa pide sus documentos solo por entidad, y los muestra', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila({ carrier_id: null as never })] } as never)
    montar(null)
    expect(await screen.findByText('Licencia de conducir')).toBeInTheDocument()
    expect(complianceApi.listPending).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'd1', carrierId: undefined, estado: 'todos' }))
  })
})
