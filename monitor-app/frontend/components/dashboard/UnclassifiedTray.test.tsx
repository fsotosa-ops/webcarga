import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnclassifiedTray } from './UnclassifiedTray'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    upload:   vi.fn(),
    listTray: vi.fn(),
    remove:   vi.fn(),
    classify: vi.fn(),
  },
}))
import { documentIngestApi } from '@/lib/api/documentIngest'

const ITEM = {
  id: 'i1', file_name: 'IMG_4905.PNG', mime_type: 'image/png', size_bytes: 10,
  storage_path: 's/x', match_status: 'UNMATCHED' as const, preview_url: 'https://x/y',
}

function renderTray(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <UnclassifiedTray carrierId="c1" canEdit onClassify={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listTray).mockReset().mockResolvedValue([ITEM])
  vi.mocked(documentIngestApi.upload).mockReset()
    .mockResolvedValue({ batch_id: 'b1', items: [], errors: [] })
  vi.mocked(documentIngestApi.remove).mockReset().mockResolvedValue(undefined)
})

describe('UnclassifiedTray', () => {
  it('lista los documentos sin clasificar de la empresa', async () => {
    renderTray()
    expect(await screen.findByText('IMG_4905.PNG')).toBeInTheDocument()
    expect(screen.getByText(/1 sin clasificar/i)).toBeInTheDocument()
  })

  it('sube los archivos seleccionados', async () => {
    renderTray()
    const input = await screen.findByLabelText(/arrastr/i)
    const file = new File(['x'], 'padron.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(documentIngestApi.upload).toHaveBeenCalledWith('c1', [file])
    })
  })

  it('muestra los archivos que el backend rechazo', async () => {
    vi.mocked(documentIngestApi.upload).mockResolvedValue({
      batch_id: 'b1', items: [],
      errors: [{ file_name: 'virus.exe', error: 'Tipo de archivo no permitido' }],
    })
    renderTray()

    const input = await screen.findByLabelText(/arrastr/i)
    fireEvent.change(input, { target: { files: [new File(['x'], 'virus.exe')] } })

    expect(await screen.findByText(/virus\.exe/)).toBeInTheDocument()
  })

  it('no ofrece cargar ni eliminar sin permiso de edicion', async () => {
    renderTray({ canEdit: false })
    await screen.findByText('IMG_4905.PNG')
    expect(screen.queryByLabelText(/arrastr/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /eliminar/i })).toBeNull()
  })

  it('elimina un documento de la bandeja', async () => {
    renderTray()
    fireEvent.click(await screen.findByRole('button', { name: /eliminar/i }))

    await waitFor(() => expect(documentIngestApi.remove).toHaveBeenCalledWith('i1'))
  })

  it('no muestra el bloque cuando no hay nada sin clasificar', async () => {
    vi.mocked(documentIngestApi.listTray).mockResolvedValue([])
    renderTray()
    await waitFor(() => expect(documentIngestApi.listTray).toHaveBeenCalled())
    expect(screen.queryByText(/sin clasificar/i)).toBeNull()
  })
})
