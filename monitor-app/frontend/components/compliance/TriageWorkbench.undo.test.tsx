import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'
import { RAICES_DE_CERTIFICACION } from '@/lib/queries/certificacion'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(),
    remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
    undoClassify: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

// TriageClassifyForm hace la llamada a classifyBatch y reporta hacia arriba
// con onApplied. Acá interesa qué hace el Workbench con ese aviso, no volver
// a probar el formulario, que tiene sus propios tests.
vi.mock('./TriageClassifyForm', () => ({
  TriageClassifyForm: ({ onApplied }: { onApplied: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onApplied(['i1', 'i2'])}>simular lote aplicado</button>
  ),
}))

import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'

const row = (id: string, carrier: string) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier.toLowerCase(), carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
  mismo_casillero: 1, mismo_contenido: 1, casillero_ocupado: false,
})

function setup(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageWorkbench {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({
    total: 2, rows: [row('i1', 'ACME'), row('i2', 'NORTE')],
  })
  vi.mocked(documentIngestApi.previewUrl).mockReset()
    .mockResolvedValue({ preview_url: 'https://x/1' })
  vi.mocked(documentIngestApi.undoClassify).mockReset()
  vi.mocked(documentIngestApi.upload).mockReset()
  vi.mocked(documentIngestApi.remove).mockReset()
  vi.mocked(documentIngestApi.moveItems).mockReset()
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({
    total: 1,
    rows: [{
      id: 'r1', carrier_id: 'acme', carrier_name: 'ACME', carrier_tax_id: '1-9',
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
      requirement_code: 'PADRON', document_name: 'Padrón',
      status: 'MISSING', expiration_date: null,
    }],
  } as never)
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

describe('TriageWorkbench — deshacer un lote', () => {
  it('aplicar un lote deja el aviso de deshacer', async () => {
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/2 archivos/)
    expect(screen.getByRole('button', { name: /deshacer/i })).toBeInTheDocument()
  })

  it('deshacer revierte exactamente el lote que se acaba de aplicar', async () => {
    vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({ reverted: ['i1', 'i2'], errors: [] })
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))
    await waitFor(() =>
      expect(documentIngestApi.undoClassify).toHaveBeenCalledWith(['i1', 'i2']),
    )
  })

  // C3 · setUltimoLote(null) era incondicional, antes de mirar res.errors: el
  // aviso desaparecía aunque no se hubiera revertido nada, los ids se perdían
  // y no había segundo intento.
  it('si no revirtió nada, el aviso se queda con los ids pendientes', async () => {
    vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({
      reverted: [],
      errors: [
        { item_id: 'i1', error: 'No estaba clasificado' },
        { item_id: 'i2', error: 'No estaba clasificado' },
      ],
    })
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))

    expect(await screen.findByText(/no se pudieron revertir 2 de 2/i)).toBeInTheDocument()
    // Y el botón sigue ahí: hay segundo intento.
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))
    await waitFor(() =>
      expect(documentIngestApi.undoClassify).toHaveBeenLastCalledWith(['i1', 'i2']),
    )
  })

  // El mensaje afirmaba siempre "el requisito ya tenía un documento anterior",
  // pero el backend también devuelve "No estaba clasificado".
  it('muestra el motivo real que devolvió el backend', async () => {
    vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({
      reverted: ['i1'],
      errors: [{ item_id: 'i2', error: 'No estaba clasificado' }],
    })
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))

    expect(await screen.findByText(/no estaba clasificado/i)).toBeInTheDocument()
    expect(screen.queryByText(/documento anterior/i)).not.toBeInTheDocument()
  })

  it('revertido entero, el aviso sí se cierra', async () => {
    vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({
      reverted: ['i1', 'i2'], errors: [],
    })
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^deshacer$/i })).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/2 archivos volvieron a la bandeja/i)).toBeInTheDocument()
  })

  it('si el deshacer falla por red, lo dice', async () => {
    vi.mocked(documentIngestApi.undoClassify).mockRejectedValue(new Error('Failed to fetch'))
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))

    expect(await screen.findByText(/no se pudo deshacer/i)).toBeInTheDocument()
  })

  // I7 · convivían el aviso de deshacer arriba ("2 archivos clasificados") y
  // un toast abajo ("2 clasificados · quedan 5"), con dos fondos oscuros
  // distintos y dos botones de cerrar, para el mismo evento.
  it('aplicar un lote deja UN aviso, con el conteo restante adentro', async () => {
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/2 archivos clasificados/)
    expect(aviso).toHaveTextContent(/quedan 0 sin clasificar/)
    expect(screen.queryByTestId('triage-notice')).not.toBeInTheDocument()
  })
})

// I2 · Convivían cinco conjuntos de invalidación distintos para las cinco
// mutaciones de la bandeja. Subir sólo invalidaba la cola, así que el badge
// del sidebar (staleTime 60s) quedaba contradiciendo la lista. Este test
// compara cada mutación contra la MISMA lista, en vez de repartir aserciones
// sueltas por los archivos.
describe('TriageWorkbench — todas las operaciones refrescan lo mismo', () => {
  const ESPERADO = [...RAICES_DE_CERTIFICACION]
    .map(k => JSON.stringify(k)).sort()

  it('las cinco mutaciones invalidan el mismo conjunto de claves', async () => {
    vi.mocked(documentIngestApi.upload).mockResolvedValue({
      batch_id: 'b1', items: [], errors: [],
    })
    vi.mocked(documentIngestApi.remove).mockResolvedValue(undefined as never)
    vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({
      reverted: ['i1', 'i2'], errors: [],
    })
    vi.mocked(documentIngestApi.moveItems).mockResolvedValue({ moved: 1 })
    vi.mocked(carriersApi.list).mockResolvedValue({
      data: [{ id: 'c2', business_name: 'Otra Empresa', tax_id: '76000000-0' }],
    } as never)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    render(
      <QueryClientProvider client={qc}>
        <TriageWorkbench />
      </QueryClientProvider>,
    )
    await screen.findByText('i1.png')

    async function clavesDe(que: string, operar: () => void | Promise<void>) {
      spy.mockClear()
      await operar()
      await waitFor(() => expect(spy).toHaveBeenCalled())
      const claves = Array.from(
        new Set(spy.mock.calls.map(c => JSON.stringify(c[0]?.queryKey))),
      ).sort()
      expect(claves, `la operación "${que}" no refresca el mismo conjunto`).toEqual(ESPERADO)
    }

    await clavesDe('subir', () => {
      fireEvent.change(screen.getByLabelText(/agrega los documentos a la bandeja/i), {
        target: { files: [new File(['x'], 'd.pdf', { type: 'application/pdf' })] },
      })
    })

    await clavesDe('aplicar un lote', () => {
      fireEvent.click(screen.getByRole('button', { name: /simular lote aplicado/i }))
    })

    await clavesDe('deshacer', () => {
      fireEvent.click(screen.getByRole('button', { name: /^deshacer$/i }))
    })

    await clavesDe('descartar', async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
      fireEvent.click(await screen.findByRole('button', { name: /descartar 1 archivo/i }))
      fireEvent.click(await screen.findByRole('button', { name: /sí, descartar 1/i }))
    })

    await clavesDe('mover a otra empresa', async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))
      fireEvent.click(await screen.findByRole('button', { name: /mover 1 archivo a otra empresa/i }))
      // Texto exacto, no regex: la bandeja global también trae su propio
      // buscador de empresa (el del lote, siempre visible) y /buscar
      // empresa/i matchea a los dos a la vez.
      fireEvent.change(await screen.findByPlaceholderText('Buscar empresa…'), {
        target: { value: 'Otra' },
      })
      fireEvent.click(await screen.findByText('Otra Empresa'))
    })
  })
})
