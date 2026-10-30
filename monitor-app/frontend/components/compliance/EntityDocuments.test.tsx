import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({ complianceApi: { listPending: vi.fn(), get: vi.fn() } }))
const negados = vi.hoisted(() => ({ set: new Set<string>() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: (p: string) => !negados.set.has(p) }))
// La subida en lote tiene su propio test; acá solo importa que esté.
vi.mock('@/lib/api/certificationRequests', () => ({ certificationRequestsApi: { create: vi.fn().mockResolvedValue({}) } }))
vi.mock('./pending/BulkUploadReview', () => ({ BulkUploadReview: () => <div>Subida en lote</div> }))

import { complianceApi } from '@/lib/api/compliance'
import { EntityDocuments } from './EntityDocuments'
import { certificationRequestsApi } from '@/lib/api/certificationRequests'

function fila(over: Partial<PendingComplianceRow>): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Andes', carrier_tax_id: '76555555-8',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'CONDUCTOR', entity_type: 'DRIVER',
    entity_id: 'd1', subject_name: 'Vidal Soto, Pedro', requirement_id: 'r1', requirement_code: 'LIC',
    document_name: 'Licencia de conducir', status: 'MISSING', expiration_date: null, tiene_archivo: false,
    document_state: 'MISSING', expiration_policy: 'REQUIRED', vence_el: null, ...over,
  } as PendingComplianceRow
}

function montar(carrierId: string | null = 'c1', recibeDocumentos = true) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntityDocuments entityType="DRIVER" entityId="d1" carrierId={carrierId} recibeDocumentos={recibeDocumentos} />
    </QueryClientProvider>,
  )
}

beforeEach(() => { vi.mocked(complianceApi.listPending).mockReset(); negados.set = new Set() })

describe('EntityDocuments (la sección Documentos de una ficha)', () => {
  it('dado de baja (él o su empresa): se lee, pero no ofrece subir, subir en lote ni pedir', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [
      fila({ document_state: 'OVERDUE', status: 'APPROVED_MANUAL', tiene_archivo: true, vence_el: '2026-10-02', expiration_date: '2026-10-02' }),
    ] } as never)
    montar('c1', false)
    expect(await screen.findByText('Venció el 02/10')).toBeInTheDocument()
    expect(screen.queryByText('Subir')).not.toBeInTheDocument()
    expect(screen.queryByText('Subida en lote')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pedir/ })).not.toBeInTheDocument()
  })

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
    // Por entidad, sin la empresa: así una empresa distinta en el registro no la vacía.
    expect(vi.mocked(complianceApi.listPending).mock.calls[0][0]).toEqual({ entityId: 'd1', estado: 'todos', limit: 200 })
  })

  // La API exige documents.review para reasignar (POST …/reassign): con solo
  // documents.upload el botón sería un 403.
  it('reasignar un documento exige documents.review, no basta con poder subir', async () => {
    negados.set = new Set(['documents.review'])
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [
      fila({ document_state: 'UP_TO_DATE', status: 'APPROVED', tiene_archivo: true }),
    ] } as never)
    montar()
    expect(await screen.findByText('Licencia de conducir')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reasignar/ })).not.toBeInTheDocument()
  })

  it('sin documents.upload no ofrece subir', async () => {
    negados.set = new Set(['documents.upload'])
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 1, rows: [fila({})] } as never)
    montar()
    expect(await screen.findByText('Licencia de conducir')).toBeInTheDocument()
    expect(screen.queryByText('Subir')).not.toBeInTheDocument()
    expect(screen.queryByText('Subida en lote')).not.toBeInTheDocument()
  })

  // Entrega B: Operaciones no sube, pide. Lo encontró el humo al pasar a las
  // filas compartidas: la acción vivía en DocumentChecklist y se había perdido.
  it('Operaciones (sin documents.upload, con certification.request) pide el documento a Certificación', async () => {
    negados.set = new Set(['documents.upload'])
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 2, rows: [
      fila({ id: 'p1', requirement_id: 'r1' }),
      fila({ id: 'p2', requirement_id: 'r2', document_name: 'Hoja de vida', open_request_id: 'q-abierto' }),
    ] } as never)
    montar('c1')
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir Licencia de conducir a Certificación' }))
    await waitFor(() => expect(certificationRequestsApi.create).toHaveBeenCalledWith({ entity_type: 'DRIVER', entity_id: 'd1', requirement_id: 'r1' }))
    // La que ya estaba pedida y la recién pedida.
    expect(screen.getAllByText('Pedido a Certificación')).toHaveLength(2)
  })
})

