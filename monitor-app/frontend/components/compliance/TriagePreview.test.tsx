import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TriagePreview } from './TriagePreview'

const mk = (id: string, mime = 'image/png') => ({
  id, file_name: `${id}.png`, mime_type: mime, size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  preview_url: `https://x/${id}`,
})

describe('TriagePreview', () => {
  it('muestra la imagen cuando hay un solo archivo', () => {
    render(<TriagePreview items={[mk('i1')]} />)
    expect(screen.getByRole('img', { name: /i1/ })).toHaveAttribute('src', 'https://x/i1')
  })

  it('resume la selección cuando hay varios', () => {
    render(<TriagePreview items={[mk('i1'), mk('i2'), mk('i3')]} />)
    expect(screen.getByText(/3 documentos seleccionados/i)).toBeInTheDocument()
  })

  it('usa un visor embebido para lo que no es imagen', () => {
    const { container } = render(<TriagePreview items={[mk('i1', 'application/pdf')]} />)
    const frame = container.querySelector('iframe')
    expect(frame).toHaveAttribute('title', 'i1.png')
    expect(frame).toHaveAttribute('src', 'https://x/i1')
  })

  it('invita a elegir algo cuando no hay nada', () => {
    render(<TriagePreview items={[]} />)
    expect(screen.getByText(/elegí un documento/i)).toBeInTheDocument()
  })
})
