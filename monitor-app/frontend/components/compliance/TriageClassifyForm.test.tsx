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
}
const REQ_FECHA = { ...REQ, id: 'req-2', name: 'SOAP', has_expiration: true }
const SUBJECTS = [{ entity_type: 'ASSET' as const, entity_id: 'a1', label: 'HKXW55' }]

function setup(targetIds = ['i1', 'i2'], onApplied = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageClassifyForm targetIds={targetIds} subjects={SUBJECTS} onApplied={onApplied} />
    </QueryClientProvider>,
  )
  return onApplied
}

async function elegir(reqName = 'Padrón') {
  fireEvent.change(screen.getByLabelText(/sujeto/i), { target: { value: 'ASSET:a1' } })
  await screen.findByRole('option', { name: reqName })
  fireEvent.change(screen.getByLabelText(/tipo de documento/i), {
    target: { value: reqName === 'Padrón' ? 'req-1' : 'req-2' },
  })
}

beforeEach(() => {
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([REQ, REQ_FECHA])
  vi.mocked(documentIngestApi.classifyBatch).mockReset()
    .mockResolvedValue({ applied: ['i1', 'i2'], errors: [] })
})

describe('TriageClassifyForm', () => {
  it('anuncia a cuántos documentos va a aplicar', () => {
    setup()
    expect(screen.getByRole('button', { name: /aplicar a los 2/i })).toBeInTheDocument()
  })

  it('aplica a toda la selección de una vez', async () => {
    const onApplied = setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /aplicar a los 2/i }))

    await waitFor(() => {
      expect(documentIngestApi.classifyBatch).toHaveBeenCalledWith({
        item_ids: ['i1', 'i2'], entity_type: 'ASSET',
        entity_id: 'a1', requirement_id: 'req-1',
      })
      expect(onApplied).toHaveBeenCalledWith(['i1', 'i2'])
    })
  })

  it('exige la fecha cuando el requisito la requiere', async () => {
    setup()
    await elegir('SOAP')
    expect(screen.getByLabelText(/fecha de vencimiento/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /aplicar/i })).toBeDisabled()
  })

  it('no deja aplicar sin selección', () => {
    setup([])
    expect(screen.getByText(/elegí uno o más documentos/i)).toBeInTheDocument()
  })

  it('muestra el error del backend sin perder la selección', async () => {
    vi.mocked(documentIngestApi.classifyBatch).mockRejectedValue(new Error('Esa entidad no tiene ese requisito'))
    setup()
    await elegir()
    fireEvent.click(screen.getByRole('button', { name: /aplicar a los 2/i }))

    expect(await screen.findByText(/no tiene ese requisito/i)).toBeInTheDocument()
  })
})
