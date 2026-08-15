import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CarrierDrawer } from './CarrierDrawer'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn() },
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { uploadAndClassify: vi.fn().mockResolvedValue({ applied: 1 }) },
}))
// La bandeja de la empresa es el MISMO componente que la global; acá se
// simula para que el cajón se pruebe solo, no para reimplementarla.
vi.mock('./TriageWorkbench', () => ({
  TriageWorkbench: ({ carrierId }: { carrierId?: string }) =>
    <div data-testid="workbench">bandeja de {carrierId}</div>,
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'

function pendiente(over: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'p1', carrier_id: 'c1', carrier_name: 'Charlotte', carrier_tax_id: '1-9',
    carrier_operation_types: [], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_id: 'r1', requirement_code: 'F30', document_name: 'F30',
    status: 'MISSING', expiration_date: null,
    ...over,
  } as PendingComplianceRow
}

function setup(rows: PendingComplianceRow[] = [pendiente()]) {
  vi.mocked(complianceApi.listPending).mockResolvedValue({ total: rows.length, rows })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CarrierDrawer carrierId="c1" carrierName="Transportes Charlotte Spa" />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('CarrierDrawer', () => {
  it('monta la bandeja de esa empresa, no una paralela', async () => {
    setup()
    expect(await screen.findByTestId('workbench')).toHaveTextContent('bandeja de c1')
  })

  it('pide solo los pendientes de esa empresa', async () => {
    setup()
    await waitFor(() =>
      expect(complianceApi.listPending).toHaveBeenCalledWith(
        expect.objectContaining({ carrierId: 'c1' }),
      ))
  })

  it('nombra cuantos documentos faltan', async () => {
    setup([pendiente({ id: 'p1' }), pendiente({ id: 'p2', requirement_id: 'r2' })])
    // Se espera el CONTEO, no el encabezado: el encabezado existe desde el
    // primer render —cuando la consulta todavia no resolvio— y esperarlo a el
    // deja pasar el test antes de que lleguen los datos.
    expect(await screen.findByText(/2 documentos/)).toBeInTheDocument()
  })

  // Spec §7: en la interfaz nunca aparecen las palabras "hueco" ni "slot".
  it('nunca dice hueco ni slot', async () => {
    setup()
    await screen.findByText(/lo que falta/i)
    expect(document.body.textContent).not.toMatch(/hueco|slot/i)
  })

  it('agrupa lo que falta por sujeto', async () => {
    setup([
      pendiente({ id: 'p1', category: 'EMPRESA', entity_type: 'CARRIER', subject_name: null }),
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
      pendiente({ id: 'p3', category: 'EQUIPO', entity_type: 'ASSET',
                  entity_id: 'a1', subject_name: 'ABCD12', document_name: 'Revisión Técnica' }),
    ])

    expect(await screen.findByText('De la empresa')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })

  it('subir un documento usa la misma puerta que la bandeja', async () => {
    setup([pendiente({ entity_type: 'CARRIER', entity_id: 'c1', requirement_id: 'r1' })])
    await screen.findByText('F30')

    const input = screen.getByTestId('subir-p1') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'f30.pdf', { type: 'application/pdf' })] },
    })

    await waitFor(() =>
      expect(documentIngestApi.uploadAndClassify).toHaveBeenCalledWith(
        expect.objectContaining({
          carrierId: 'c1', entityType: 'CARRIER', entityId: 'c1', requirementId: 'r1',
        }),
      ))
  })

  it('un sujeto se puede plegar', async () => {
    setup([
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
    ])
    await screen.findByText('Juan Pérez')
    expect(screen.getByText('Licencia')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(screen.queryByText('Licencia')).not.toBeInTheDocument()
  })

  it('sin pendientes lo celebra en vez de mostrar una lista vacia', async () => {
    setup([])
    expect(await screen.findByText(/no le falta ningún documento/i)).toBeInTheDocument()
  })

  it('un vencido se distingue de un faltante', async () => {
    setup([pendiente({ status: 'EXPIRED', expiration_date: '2026-01-01' })])
    expect(await screen.findByText(/vencido/i)).toBeInTheDocument()
  })
})

describe('CarrierDrawer sin permiso de edición', () => {
  it('un lector no ve el boton de subir', async () => {
    vi.resetModules()
    vi.doMock('@/hooks/useCanEdit', () => ({ useCanEdit: () => false }))
    const { CarrierDrawer: SoloLectura } = await import('./CarrierDrawer')
    vi.mocked(complianceApi.listPending).mockResolvedValue({
      total: 1, rows: [pendiente()],
    })

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SoloLectura carrierId="c1" carrierName="Charlotte" />
      </QueryClientProvider>,
    )

    await screen.findByText('F30')
    expect(screen.queryByTestId('subir-p1')).not.toBeInTheDocument()
  })
})
