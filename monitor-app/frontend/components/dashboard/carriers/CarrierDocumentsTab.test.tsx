import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { CarrierDocumentsTab } from './CarrierDocumentsTab'

const { SUBJECT_COUNTS, NOT_ASSET } = vi.hoisted(() => ({
  SUBJECT_COUNTS: { todos: 1, al_dia: 1, por_vencer: 0, falta: 0 },
  NOT_ASSET: { asset_type: null, fleet_service_type_label: null, fleet_service_type_bg_color: null, fleet_service_type_text_color: null },
}))

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    summary: vi.fn().mockResolvedValue({
      totales: { todos: 2, al_dia: 2, por_vencer: 0, falta: 0 },
      completo: true,
      carrier_operation_types: [],
      sujetos: [
        { entity_type: 'CARRIER', entity_id: 'c1', subject_name: null, ...SUBJECT_COUNTS, ...NOT_ASSET },
        { entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Vidal Soto, Pedro', ...SUBJECT_COUNTS, ...NOT_ASSET },
      ],
    }),
    listPending: vi.fn().mockResolvedValue({
      total: 1,
      rows: [{
        id: 'r1', carrier_id: 'c1', entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
        document_name: 'Escritura de constitución', status: 'APPROVED', expiration_date: '2027-01-01',
        tiene_archivo: true, document_state: 'UP_TO_DATE', expiration_policy: 'OPTIONAL',
      }],
    }),
    listFiles: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CarrierDocumentsTab
        carrierId="c1" carrier={{ business_name: 'ACME', operational_status: 'ACTIVE', management_types: null }}
        onExport={vi.fn()} exporting={false}
      />
    </QueryClientProvider>,
  )
}

describe('CarrierDocumentsTab (C7, ficha única)', () => {
  it('muestra los documentos por sujeto, con filtro de estado, versiones y edición del vencimiento', async () => {
    setup()
    // Por sujeto: la empresa y su flota, agrupada.
    expect(await screen.findByText('De la empresa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Conductores/ })).toBeInTheDocument()
    // Filtro de estado.
    expect(screen.getByRole('button', { name: /^Por vencer/ })).toBeInTheDocument()
    // Al desplegar la empresa: su documento, con versiones y el vencimiento editable.
    fireEvent.click(screen.getByText('De la empresa'))
    expect(await screen.findByText('Escritura de constitución')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Versiones/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar vencimiento' })).toBeInTheDocument()
  })
})
