import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { complianceApi } from '@/lib/api/compliance'
import { CarrierDocumentsTab } from './CarrierDocumentsTab'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'

const { SUBJECT_COUNTS, NOT_ASSET } = vi.hoisted(() => ({
  SUBJECT_COUNTS: { todos: 1, al_dia: 1, por_vencer: 0, falta: 0 },
  NOT_ASSET: { asset_type: null, fleet_service_type_label: null, },
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
      <QuickViewContext.Provider value={vi.fn()}>
        <CarrierDocumentsTab
          carrierId="c1" carrier={{ business_name: 'ACME', operational_status: 'ACTIVE', management_types: null }}
          onExport={vi.fn()} exporting={false}
        />
      </QuickViewContext.Provider>
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

  // Revisión final de la Entrega 1 (spec: "De quién", cada uno con su vista rápida).
  it('el nombre de un conductor en Documentos de la empresa lleva a su ficha', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /Conductores/ }))
    expect(await screen.findByRole('link', { name: 'Ver conductor Vidal Soto, Pedro' })).toHaveAttribute('href', '/dashboard/drivers/d1')
  })

  // 15/10: el grupo decía "Vehículos" y el resto de la app dice "Equipos".
  it('el grupo de la flota se llama Equipos, como en el resto de la app', async () => {
    vi.mocked(complianceApi.summary).mockResolvedValueOnce({
      totales: { todos: 1, al_dia: 1, por_vencer: 0, falta: 0 }, completo: true, carrier_operation_types: [],
      sujetos: [{ entity_type: 'ASSET', entity_id: 'a1', subject_name: 'BBPV80', ...SUBJECT_COUNTS, ...NOT_ASSET }],
    } as never)
    setup()
    expect(await screen.findByText('Equipos')).toBeInTheDocument()
    expect(screen.queryByText('Vehículos')).not.toBeInTheDocument()
  })
})
