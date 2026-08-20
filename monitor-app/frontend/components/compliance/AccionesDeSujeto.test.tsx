import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AccionesDeSujeto } from './AccionesDeSujeto'

describe('AccionesDeSujeto', () => {
  const props = { nombreEmpresa: 'Transportes Demo', onTransferir: vi.fn(), onDarDeBaja: vi.fn() }

  it('la baja dice de QUÉ empresa, para que el alcance se lea sin pensar', () => {
    render(<AccionesDeSujeto {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    expect(screen.getByRole('menuitem', { name: 'Dar de baja de Transportes Demo' })).toBeInTheDocument()
  })

  it('arranca cerrado: el menú no ocupa la cabecera hasta que se pide', () => {
    render(<AccionesDeSujeto {...props} />)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('Escape cierra sin elegir nada', () => {
    const onDarDeBaja = vi.fn()
    render(<AccionesDeSujeto {...props} onDarDeBaja={onDarDeBaja} />)
    fireEvent.click(screen.getByRole('button', { name: /acciones/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(onDarDeBaja).not.toHaveBeenCalled()
  })

  it('mientras una acción está en vuelo no se puede disparar otra', () => {
    const onTransferir = vi.fn()
    render(<AccionesDeSujeto {...props} onTransferir={onTransferir} deshabilitado />)
    expect(screen.getByRole('button', { name: /acciones/i })).toBeDisabled()
  })
})
