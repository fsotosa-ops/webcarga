import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClassifyDocumentModal } from './ClassifyDocumentModal'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: { classify: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listRequirements: vi.fn() },
}))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const ITEM = {
  id: 'i1', file_name: 'IMG_4905.PNG', mime_type: 'image/png', size_bytes: 10,
  storage_path: 's/x', match_status: 'UNMATCHED' as const, preview_url: 'https://x/y',
}
const SUBJECTS = [{ entity_type: 'ASSET' as const, entity_id: 'a1', label: 'Patente demo' }]

const REQ_SIN_FECHA = {
  id: 'req-1', target_entity: 'ASSET' as const, requirement_code: 'PADRON', name: 'Padrón',
  requirement_level: 'LEGAL_MANDATORY' as const, has_expiration: false,
}
const REQ_CON_FECHA = { ...REQ_SIN_FECHA, id: 'req-2', requirement_code: 'SOAP', name: 'SOAP', has_expiration: true }

function renderModal(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ClassifyDocumentModal
        item={ITEM} subjects={SUBJECTS} onClose={vi.fn()} onClassified={vi.fn()} {...props}
      />
    </QueryClientProvider>,
  )
}

async function pickSubjectAndType(reqId = 'req-1') {
  fireEvent.change(screen.getByLabelText(/sujeto/i), { target: { value: 'ASSET:a1' } })
  const select = await screen.findByLabelText(/tipo de documento/i)
  // El select aparece apenas hay sujeto, pero sus opciones llegan por query
  // async: sin esperarlas, el change se aplica sobre un select vacio y React
  // lo descarta silenciosamente.
  await screen.findByRole('option', { name: reqId === 'req-1' ? 'Padrón' : 'SOAP' })
  fireEvent.change(select, { target: { value: reqId } })
}

beforeEach(() => {
  vi.mocked(complianceApi.listRequirements).mockReset()
    .mockResolvedValue([REQ_SIN_FECHA, REQ_CON_FECHA])
  vi.mocked(documentIngestApi.classify).mockReset()
    .mockResolvedValue({ compliance_record_id: 'rec-1' })
})

describe('ClassifyDocumentModal', () => {
  it('muestra la vista previa del archivo', () => {
    renderModal()
    expect(screen.getByRole('img', { name: /IMG_4905/i })).toHaveAttribute('src', 'https://x/y')
  })

  it('clasifica con la seleccion hecha', async () => {
    const onClassified = vi.fn()
    renderModal({ onClassified })

    await pickSubjectAndType()
    fireEvent.click(screen.getByRole('button', { name: /^clasificar$/i }))

    await waitFor(() => {
      expect(documentIngestApi.classify).toHaveBeenCalledWith('i1', {
        entity_type: 'ASSET', entity_id: 'a1', requirement_id: 'req-1',
      })
      expect(onClassified).toHaveBeenCalled()
    })
  })

  it('exige la fecha cuando el requisito la requiere', async () => {
    renderModal()
    await pickSubjectAndType('req-2')

    expect(screen.getByLabelText(/fecha de vencimiento/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^clasificar$/i })).toBeDisabled()
  })

  it('permite asignar el mismo archivo a varios requisitos', async () => {
    // Caso del PDF unificado: padron + permiso + revision en un solo archivo.
    const onClassified = vi.fn()
    renderModal({ onClassified })

    await pickSubjectAndType()
    fireEvent.click(screen.getByRole('button', { name: /clasificar y seguir/i }))

    expect(await screen.findByText(/asignado a 1 requisito/i)).toBeInTheDocument()
    // El modal sigue abierto con el mismo archivo
    expect(onClassified).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: /IMG_4905/i })).toBeInTheDocument()
  })

  it('no renderiza nada sin item', () => {
    const { container } = renderModal({ item: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra el error del backend sin cerrarse', async () => {
    vi.mocked(documentIngestApi.classify).mockRejectedValue(new Error('Esa entidad no tiene ese requisito'))
    renderModal()

    await pickSubjectAndType()
    fireEvent.click(screen.getByRole('button', { name: /^clasificar$/i }))

    expect(await screen.findByText(/no tiene ese requisito/i)).toBeInTheDocument()
  })
})
