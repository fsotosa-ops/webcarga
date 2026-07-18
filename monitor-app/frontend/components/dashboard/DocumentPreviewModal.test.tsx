import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DocumentPreviewModal } from './DocumentPreviewModal'

describe('DocumentPreviewModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('embeds an iframe for a PDF url', () => {
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/a/b/lic.pdf?token=1" canEdit={false} onClose={vi.fn()} />)
    const iframe = document.querySelector('iframe')
    expect(iframe).toHaveAttribute('src', 'https://x.example.com/a/b/lic.pdf?token=1')
  })

  it('embeds an img for an image url', () => {
    render(<DocumentPreviewModal label="Foto" url="https://x.example.com/a/b/foto.jpg" canEdit={false} onClose={vi.fn()} />)
    expect(screen.getByAltText('Foto')).toBeInTheDocument()
  })

  it('shows a download fallback for non-previewable file types', () => {
    render(<DocumentPreviewModal label="Planilla" url="https://x.example.com/a/b/datos.xlsx" canEdit={false} onClose={vi.fn()} />)
    expect(screen.getByText('Vista previa no disponible para este tipo de archivo.')).toBeInTheDocument()
    expect(screen.getByText('Descargar para verlo')).toBeInTheDocument()
  })

  it('does not show the delete button when canEdit is false', () => {
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/lic.pdf" canEdit={false} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Eliminar Licencia')).not.toBeInTheDocument()
  })

  it('does not show the delete button when no onDelete is passed, even if canEdit', () => {
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/lic.pdf" canEdit={true} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Eliminar Licencia')).not.toBeInTheDocument()
  })

  it('requires confirmation before calling onDelete, then closes on success', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/lic.pdf" canEdit={true} onDelete={onDelete} onClose={onClose} />)

    fireEvent.click(screen.getByLabelText('Eliminar Licencia'))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Sí'))
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('cancels the delete confirmation without calling onDelete', () => {
    const onDelete = vi.fn()
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/lic.pdf" canEdit={true} onDelete={onDelete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Eliminar Licencia'))
    fireEvent.click(screen.getByText('No'))
    expect(screen.queryByText('¿Eliminar?')).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('fetches the file as a blob and triggers a download on click', async () => {
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/carrier/c1/r1/20260718T101505123456_licencia.pdf" canEdit={false} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Descargar Licencia'))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('https://x.example.com/carrier/c1/r1/20260718T101505123456_licencia.pdf'))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('closes when clicking the backdrop or the close button', () => {
    const onClose = vi.fn()
    render(<DocumentPreviewModal label="Licencia" url="https://x.example.com/lic.pdf" canEdit={false} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
