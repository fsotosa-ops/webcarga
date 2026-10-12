import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DirectoryNotice } from './DirectoryNotice'

describe('DirectoryNotice', () => {
  it('sin mensaje no dibuja nada', () => {
    const { container } = render(<DirectoryNotice message={null} onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('anuncia el mensaje y se cierra', () => {
    const onClose = vi.fn()
    render(<DirectoryNotice message="El Cierre se actualizará en alrededor de un minuto." onClose={onClose} />)
    expect(screen.getByRole('status')).toHaveTextContent('El Cierre se actualizará en alrededor de un minuto.')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }))
    expect(onClose).toHaveBeenCalled()
  })
})
