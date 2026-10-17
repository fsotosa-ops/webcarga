import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('el marco lo pone quien lo usa: la ficha de un conductor llena la ventana entera', () => {
    render(<Dialog label="Conductor Vidal" onClose={vi.fn()} className="inset-4 rounded-2xl"><p>ficha</p></Dialog>)
    const dialogo = screen.getByRole('dialog', { name: 'Conductor Vidal' })
    expect(dialogo).toHaveClass('inset-4')
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
  })

  it('mientras algo viaja (dismissible=false) ni Escape ni el fondo la cierran', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Dialog label="Dar de baja" onClose={onClose} dismissible={false} className=""><p>x</p></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('panel-overlay'))
    expect(onClose).not.toHaveBeenCalled()

    rerender(<Dialog label="Dar de baja" onClose={onClose} className=""><p>x</p></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('si un campo de adentro pide el foco al abrir (autoFocus), lo conserva', () => {
    render(<Dialog label="Nuevo grupo" onClose={vi.fn()} className=""><input aria-label="Nombre" autoFocus /></Dialog>)
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveFocus()
  })

  it('con un campo con autoFocus, al cerrar el foco vuelve al botón que la abrió', () => {
    function Prueba() {
      const [abierto, setAbierto] = useState(false)
      return (<>
        <button onClick={() => setAbierto(true)}>Abrir</button>
        {abierto && <Dialog label="Nuevo grupo" onClose={() => setAbierto(false)} className=""><input aria-label="Nombre" autoFocus /></Dialog>}
      </>)
    }
    render(<Prueba />)
    const abrir = screen.getByRole('button', { name: 'Abrir' })
    abrir.focus()
    fireEvent.click(abrir)
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(abrir).toHaveFocus()
  })

  it('el espaciado del padre (space-y) no la alcanza: fondo y ventana van en un contenedor sin caja', () => {
    // Abierta dentro de un `space-y-4`, el fondo recibía margin-bottom: 16px y un `fixed
    // inset-0` con margen mide 16 px menos (Crear usuario en dev, 17/10).
    const { container } = render(<div className="space-y-4"><Dialog label="Crear usuario" onClose={vi.fn()} className=""><p>x</p></Dialog><p>después</p></div>)
    const padre = container.firstElementChild!
    expect(padre.contains(screen.getByTestId('panel-overlay'))).toBe(true)
    expect(screen.getByTestId('panel-overlay').parentElement).not.toBe(padre)
    expect(screen.getByRole('dialog').parentElement).not.toBe(padre)
    expect(screen.getByRole('dialog').parentElement).toHaveClass('contents')
  })
})
