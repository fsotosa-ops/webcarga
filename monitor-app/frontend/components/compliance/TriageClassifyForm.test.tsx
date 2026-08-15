import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageClassifyForm } from './TriageClassifyForm'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { classifyBatch: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listRequirements: vi.fn() },
}))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const REQ = {
  id: 'req-1', target_entity: 'ASSET' as const, requirement_code: 'PADRON',
  name: 'Padrón', requirement_level: 'LEGAL_MANDATORY' as const, has_expiration: false,
  is_active: true, applies_to_fleet_service_type_ids: null, applies_to_management_types: null,
}
const REQ_FECHA = { ...REQ, id: 'req-2', name: 'SOAP', has_expiration: true }
const SUBJECTS = [{ entity_type: 'ASSET' as const, entity_id: 'a1', label: 'HKXW55' }]

const PENDIENTE = {
  id: 'r1', carrier_id: 'c1', carrier_name: 'ACME', carrier_tax_id: '1-9',
  carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
  entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
  requirement_id: 'req-1', requirement_code: 'PADRON', document_name: 'Padrón',
  status: 'MISSING', expiration_date: null,
}

function setup(targetIds = ['i1'], onApplied = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageClassifyForm targetIds={targetIds} subjects={SUBJECTS} onApplied={onApplied} />
    </QueryClientProvider>,
  )
  return onApplied
}

async function elegir(reqName = 'Padrón') {
  fireEvent.change(screen.getByLabelText(/a quién pertenece/i), { target: { value: 'ASSET:a1' } })
  await screen.findByRole('option', { name: reqName })
  fireEvent.change(screen.getByLabelText(/qué documento es/i), {
    target: { value: reqName === 'Padrón' ? 'req-1' : 'req-2' },
  })
}

beforeEach(() => {
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([REQ, REQ_FECHA])
  vi.mocked(documentIngestApi.classifyBatch).mockReset()
    .mockResolvedValue({ applied: ['i1'], errors: [] })
})

describe('TriageClassifyForm', () => {
  // Un archivo que entra por la puerta global no tiene empresa todavia, asi
  // que `subjects` viene vacio. El aviso hablaba de "esta empresa" y de que
  // "no esta activa" — describia una situacion que no es la que ocurre, y no
  // decia lo unico que hay que hacer: moverlo a una empresa primero.
  it('sin empresa dice que hay que moverlo, no que la empresa este inactiva', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TriageClassifyForm
          targetIds={['i1']} subjects={[]} onApplied={vi.fn()} carrierLabel={null}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/todavía no tiene empresa/i)).toBeInTheDocument()
    expect(screen.queryByText(/no está activa/i)).not.toBeInTheDocument()
  })

  it('anuncia a cuántos documentos va a aplicar', () => {
    setup(['i1', 'i2'])
    expect(screen.getByRole('button', { name: /clasificar los 2/i })).toBeInTheDocument()
  })

  it('aplica el documento elegido', async () => {
    const onApplied = setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /clasificar/i }))

    await waitFor(() => {
      expect(documentIngestApi.classifyBatch).toHaveBeenCalledWith({
        item_ids: ['i1'], entity_type: 'ASSET',
        entity_id: 'a1', requirement_id: 'req-1',
      })
      expect(onApplied).toHaveBeenCalledWith(['i1'], [])
    })
  })

  // Diseño §7, no negociable: en un lote una coordenada se comparte y la otra
  // tiene que ser distinta en cada archivo. Este formulario fija las dos, así
  // que aplicar N archivos mandaba N veces al MISMO compliance_record y cada
  // uno pisaba al anterior: sobrevivía el último y los N-1 quedaban invisibles
  // e irrecuperables desde la interfaz.
  it('no deja aplicar dos archivos al mismo requisito', async () => {
    setup(['i1', 'i2'])
    await elegir()

    expect(screen.getByRole('button', { name: /clasificar los 2/i })).toBeDisabled()
    expect(screen.getByText(/cada archivo necesita un requisito distinto/i)).toBeInTheDocument()
    expect(documentIngestApi.classifyBatch).not.toHaveBeenCalled()
  })

  it('con dos marcados avisa antes del clic, no después del error', () => {
    setup(['i1', 'i2'])
    expect(screen.getByText(/no puede compartir el sujeto y el tipo de documento/i))
      .toBeInTheDocument()
  })

  // "10 clasificados" cuando se marcaron 12 es peor que un error: nadie va a
  // buscar los 2 que faltan.
  it('muestra los errores por ítem que devuelve el backend', async () => {
    vi.mocked(documentIngestApi.classifyBatch).mockResolvedValue({
      applied: [], errors: [{ item_id: 'i1', error: 'Fue eliminado de la bandeja' }],
    })
    const onApplied = setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /clasificar/i }))

    expect(await screen.findByText(/fue eliminado de la bandeja/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledWith(
        [], [{ item_id: 'i1', error: 'Fue eliminado de la bandeja' }],
      )
    })
  })

  it('exige la fecha cuando el requisito la requiere', async () => {
    setup()
    await elegir('SOAP')
    expect(screen.getByLabelText(/fecha de vencimiento/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clasificar/i })).toBeDisabled()
  })

  it('no deja aplicar sin selección', () => {
    setup([])
    expect(screen.getByText(/selecciona uno o más documentos/i)).toBeInTheDocument()
  })

  it('muestra el error del backend sin perder la selección', async () => {
    vi.mocked(documentIngestApi.classifyBatch).mockRejectedValue(new Error('Esa entidad no tiene ese requisito'))
    setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /clasificar/i }))

    expect(await screen.findByText(/no tiene ese requisito/i)).toBeInTheDocument()
  })
})

// El usuario no sabe de memoria qué le falta a cada empresa. Antes el panel
// pedía "Sujeto" y "Tipo" en dos desplegables genéricos y había que adivinar.
describe('TriageClassifyForm — muestra qué le falta a la empresa', () => {
  function setupConPendientes(onApplied = vi.fn()) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <TriageClassifyForm
          targetIds={['i1']}
          subjects={SUBJECTS}
          pendingRows={[PENDIENTE] as never}
          onApplied={onApplied}
        />
      </QueryClientProvider>,
    )
    return onApplied
  }

  it('lista los documentos que faltan, no un desplegable en abstracto', () => {
    setupConPendientes()
    expect(screen.getByText(/le falta 1 documento/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Padrón/ })).toBeInTheDocument()
  })

  it('clasificar es elegir el hueco: un clic resuelve entidad y requisito', async () => {
    const onApplied = setupConPendientes()
    fireEvent.click(screen.getByRole('button', { name: /Padrón/ }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clasificar/i })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: /clasificar/i }))

    await waitFor(() => {
      expect(documentIngestApi.classifyBatch).toHaveBeenCalledWith(
        expect.objectContaining({ entity_type: 'ASSET', entity_id: 'a1', requirement_id: 'req-1' }),
      )
      expect(onApplied).toHaveBeenCalled()
    })
  })

  it('deja salir a la vía manual si el documento no está en la lista', () => {
    setupConPendientes()
    fireEvent.click(screen.getByRole('button', { name: /no está en la lista/i }))
    expect(screen.getByLabelText(/a quién pertenece/i)).toBeInTheDocument()
  })
})
