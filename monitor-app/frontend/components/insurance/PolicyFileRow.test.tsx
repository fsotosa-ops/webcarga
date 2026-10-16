import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PolicyFileRow } from './PolicyFileRow'

const archivo = () => new File(['x'], 'poliza.pdf', { type: 'application/pdf' })

describe('PolicyFileRow', () => {
  it('mientras sube, el botón lo dice y no deja subir otra vez; después se puede volver a elegir el mismo archivo', async () => {
    let terminar!: () => void
    const onUpload = vi.fn(() => new Promise<void>(r => { terminar = r }))
    const { container } = render(<PolicyFileRow label="Póliza" url={null} canEdit onUpload={onUpload} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [archivo()] } })
    expect(screen.getByRole('button', { name: 'Subir Póliza' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Subir Póliza' })).toHaveTextContent('Subiendo…')
    terminar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Subir Póliza' })).toBeEnabled())
    expect(input.value).toBe('')
  })
})
