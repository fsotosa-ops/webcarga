import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { Popover } from './Popover'

function Prueba({ onClose = vi.fn() }: { onClose?: () => void }) {
  const ancla = useRef<HTMLButtonElement>(null)
  const [abierto, setAbierto] = useState(true)
  return (
    <div style={{ overflow: 'hidden' }}>
      <button ref={ancla}>Ancla</button>
      <Popover anchor={ancla} open={abierto} label="Opciones" onClose={() => { setAbierto(false); onClose() }}>
        <button>Dentro</button>
      </Popover>
      <p>Afuera</p>
    </div>
  )
}

describe('Popover', () => {
  it('abre en un portal con su nombre', () => {
    render(<Prueba />)
    const dialogo = screen.getByRole('dialog', { name: 'Opciones' })
    expect(dialogo.parentElement).toBe(document.body)
  })

  it('Escape cierra y devuelve el foco al ancla', () => {
    const onClose = vi.fn()
    render(<Prueba onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ancla' }))
  })

  it('un clic afuera cierra; uno adentro o en el ancla, no', () => {
    const onClose = vi.fn()
    render(<Prueba onClose={onClose} />)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Dentro' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Ancla' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByText('Afuera'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('nunca pasa el borde de abajo de la pantalla: lo que no cabe se desplaza dentro del panel', () => {
    render(<Prueba />)
    const panel = screen.getByRole('dialog', { name: 'Opciones' })
    // Lo que queda bajo el ancla, menos la barra de navegación del teléfono.
    expect(panel.style.maxHeight).toMatch(/^calc\(100dvh - \d+px - 8px - var\(--mobile-nav-height\)\)$/)
    expect(panel).toHaveClass('overflow-y-auto')
  })
})
