import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionsMenu } from './ActionsMenu'

describe('ActionsMenu (el "⋯" de una ficha)', () => {
  it('F7-base: sin opciones no se dibuja nada', () => {
    const { container } = render(<ActionsMenu label="Más acciones" items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('abre sus opciones, ejecuta la elegida y se cierra; Escape también cierra', () => {
    const onSelect = vi.fn()
    render(<ActionsMenu label="Más acciones" items={[{ id: 'baja', label: 'Dar de baja', destructive: true, onSelect }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
