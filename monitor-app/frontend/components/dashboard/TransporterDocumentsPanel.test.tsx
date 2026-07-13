import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TransporterDocumentsPanel } from './TransporterDocumentsPanel'
import { transportersApi } from '@/lib/api/transporters'
import type { TransporterDocument } from '@/lib/types'

vi.mock('@/lib/api/transporters', () => ({
  transportersApi: {
    patchDocument:      vi.fn(),
    uploadDocumentFile: vi.fn(),
    listDocumentFiles:  vi.fn(),
  },
}))

const DOCS: TransporterDocument[] = [
  {
    doc_code: 'rol_sii', label: 'Rol SII', status: 'ok', expiry_date: null,
    file_url: null, storage_path: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z',
  },
  {
    doc_code: 'f30', label: 'F30', status: 'pendiente', expiry_date: '2026-01-01',
    file_url: null, storage_path: null, manual_override: true, updated_at: '2026-07-01T00:00:00Z',
  },
]

beforeEach(() => {
  vi.mocked(transportersApi.patchDocument).mockReset()
  vi.mocked(transportersApi.uploadDocumentFile).mockReset()
  vi.mocked(transportersApi.listDocumentFiles).mockReset().mockResolvedValue([])
})

describe('TransporterDocumentsPanel', () => {
  it('shows every document as a row, always visible (no collapse toggle)', () => {
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={false} onDocumentsChange={vi.fn()} />)
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('shows a manual-override badge for documents edited by hand', () => {
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={false} onDocumentsChange={vi.fn()} />)
    expect(screen.getByTitle('Editado manualmente — el pipeline no lo sobreescribe')).toBeInTheDocument()
  })

  it('changes status via the select and reports the update', async () => {
    vi.mocked(transportersApi.patchDocument).mockResolvedValue({
      doc_code: 'rol_sii',
      status: 'pendiente', expiry_date: null, file_url: null, storage_path: null, notes: null,
      manual_override: true, updated_at: '2026-07-10T00:00:00Z',
    })
    const onDocumentsChange = vi.fn()
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={onDocumentsChange} />)
    fireEvent.change(screen.getByLabelText('Estado de Rol SII'), { target: { value: 'pendiente' } })
    await waitFor(() => expect(transportersApi.patchDocument).toHaveBeenCalledWith('t1', 'rol_sii', { status: 'pendiente' }))
    await waitFor(() => expect(onDocumentsChange).toHaveBeenCalled())
  })

  it('uploads a file via the upload control', async () => {
    vi.mocked(transportersApi.uploadDocumentFile).mockResolvedValue({
      id: 's1', storage_path: 'x/y', file_name: 'f30.pdf', mime_type: 'application/pdf',
      size_bytes: 100, version: 1, uploaded_by: null, uploaded_at: '2026-07-10T00:00:00Z',
    })
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={vi.fn()} />)
    const file = new File(['x'], 'f30.pdf', { type: 'application/pdf' })
    // Ambos docs tienen su propio input[type=file] oculto; el primero corresponde a "Rol SII".
    const fileInputs = document.querySelectorAll('input[type="file"]')
    fireEvent.change(fileInputs[0], { target: { files: [file] } })
    await waitFor(() => expect(transportersApi.uploadDocumentFile).toHaveBeenCalledWith('t1', 'rol_sii', file))
  })

  it('renders document version history with status + replaced date, not undefined (Checkpoint B shape)', async () => {
    vi.mocked(transportersApi.listDocumentFiles).mockResolvedValue([
      {
        storage_path: 'transporters/t1/rol_sii/old.pdf',
        status: 'actualizar',
        expiry_date: null,
        replaced_at: '2026-06-01T14:23:11.123456+00:00',
        replaced_by: 'admin@webcarga.cl',
        url: 'https://signed.example.com/old.pdf',
      },
    ])
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Ver archivo / versiones')[0])
    await waitFor(() => expect(transportersApi.listDocumentFiles).toHaveBeenCalledWith('t1', 'rol_sii'))
    const entry = await screen.findByText(/actualizar · reemplazado/)
    expect(entry.textContent).not.toMatch(/undefined/)
    expect(entry.textContent).toContain('01-06-26')
  })

  it('shows a "Ver link" anchor for a non-editor when file_url is set', () => {
    const withLink = [{ ...DOCS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel tid="t1" documents={withLink} canEdit={false} onDocumentsChange={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Ver link/ })).toHaveAttribute('href', 'https://example.com/doc.pdf')
  })

  it('shows a revert control only for documents with manual_override', () => {
    render(<TransporterDocumentsPanel tid="t1" documents={DOCS} canEdit={true} onDocumentsChange={vi.fn()} />)
    expect(screen.getAllByTitle('Revertir a valor del pipeline')).toHaveLength(1)
  })

  it('does not poison linkDraft after Cancelar: reopening "Pegar link" shows the real file_url, not a leftover cleared draft', () => {
    const withLink = [{ ...DOCS[0], file_url: 'https://real.example.com/rol-sii.pdf' }]
    render(<TransporterDocumentsPanel tid="t1" documents={withLink} canEdit={true} onDocumentsChange={vi.fn()} />)

    // Abrir "Pegar link", vaciar el campo, cancelar sin guardar.
    fireEvent.click(screen.getByTitle('Pegar link'))
    const input = screen.getByPlaceholderText('https://…')
    expect(input).toHaveValue('https://real.example.com/rol-sii.pdf')
    fireEvent.change(input, { target: { value: '' } })
    const buttons = within(input.parentElement as HTMLElement).getAllByRole('button')
    fireEvent.click(buttons[buttons.length - 1]) // Cancelar (X)

    // Reabrir "Pegar link": el draft debe resincronizarse desde doc.file_url real,
    // no arrastrar el valor vaciado en memoria de la edición cancelada anterior.
    fireEvent.click(screen.getByTitle('Pegar link'))
    expect(screen.getByPlaceholderText('https://…')).toHaveValue('https://real.example.com/rol-sii.pdf')

    // No se llamó a patchDocument en ningún momento de este flujo (solo Cancelar, nunca Guardar).
    expect(transportersApi.patchDocument).not.toHaveBeenCalled()
  })
})
