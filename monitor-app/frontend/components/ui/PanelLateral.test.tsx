import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PanelLateral } from './PanelLateral'

function montar(onCerrar = vi.fn()) {
  render(
    <>
      <button>afuera</button>
      <PanelLateral titulo="Mantención Cámara de Frío" onCerrar={onCerrar} pie={<button>Guardar</button>}>
        <p>cuerpo del panel</p>
      </PanelLateral>
    </>,
  )
  return onCerrar
}

describe('PanelLateral', () => {
  it('es un dialogo con nombre accesible', () => {
    montar()
    expect(screen.getByRole('dialog', { name: /cámara de frío/i })).toBeInTheDocument()
  })

  it('Escape cierra', () => {
    const onCerrar = montar()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('el boton de cerrar cierra', () => {
    const onCerrar = montar()
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onCerrar).toHaveBeenCalled()
  })

  // Regla de severidad alta: al abrir, el foco entra al panel; al cerrar,
  // vuelve a donde estaba. Sin esto quien navega con teclado queda perdido
  // detras del panel.
  it('al abrir toma el foco', () => {
    montar()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('al cerrar devuelve el foco a donde estaba', () => {
    const disparador = document.createElement('button')
    document.body.appendChild(disparador)
    disparador.focus()

    const { unmount } = render(
      <PanelLateral titulo="X" onCerrar={vi.fn()} pie={null}><p>c</p></PanelLateral>,
    )
    unmount()

    expect(disparador).toHaveFocus()
    disparador.remove()
  })
})
