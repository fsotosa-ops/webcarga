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
    // Los sujetos arrancan plegados para que el cajon quepa en la pantalla.
    fireEvent.click(await screen.findByText('De la empresa'))

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

  // MEDIDO EN STAGING (2026-08-15): con los sujetos abiertos, el cajon de
  // Transportes Charlotte media 3.159px — 9 sujetos, 91 lineas de requisito —
  // contra 633px de lista visible. Cinco pantallas. Eso contradice la razon de
  // ser del cajon: "no achica nada y nunca saca al usuario de donde estaba".
  // Para volver a la lista habia que subir cinco pantallas, peor que el panel
  // lateral que se revirtio. El mockup ya lo preveia: muestra unos pocos
  // requisitos y pliega el resto.
  it('los sujetos arrancan plegados: el cajon tiene que caber en la pantalla', async () => {
    setup([
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
    ])
    await screen.findByText('Juan Pérez')

    expect(screen.queryByText('Licencia')).not.toBeInTheDocument()
    // Pero el encabezado ya dice cuanto le falta, asi que se puede decidir
    // sin desplegar.
    expect(screen.getByText(/faltan 1$/)).toBeInTheDocument()
  })

  it('un sujeto se despliega al tocarlo', async () => {
    setup([
      pendiente({ id: 'p2', category: 'CHOFER', entity_type: 'DRIVER',
                  entity_id: 'd1', subject_name: 'Juan Pérez', document_name: 'Licencia' }),
    ])
    await screen.findByText('Juan Pérez')

    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(screen.getByText('Licencia')).toBeInTheDocument()
  })

  it('sin pendientes lo celebra en vez de mostrar una lista vacia', async () => {
    setup([])
    expect(await screen.findByText(/no le falta ningún documento/i)).toBeInTheDocument()
  })

  it('un vencido se distingue de un faltante', async () => {
    setup([pendiente({ status: 'EXPIRED', expiration_date: '2026-01-01' })])
    fireEvent.click(await screen.findByText('De la empresa'))
    expect(screen.getByText(/vencido/i)).toBeInTheDocument()
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

    fireEvent.click(await screen.findByText('De la empresa'))
    expect(screen.getByText('F30')).toBeInTheDocument()
    expect(screen.queryByTestId('subir-p1')).not.toBeInTheDocument()
  })
})
