import { useState } from 'react'
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

  // Los dos llamadores pasan una flecha en linea (`onCerrar={() => abrir(null)}`),
  // asi que su identidad cambia en CADA render del padre. Si el efecto que
  // enfoca depende de `onCerrar`, cualquier refetch de la lista vuelve a
  // ejecutarlo y le saca el cursor a quien esta escribiendo. El padre de este
  // test hace exactamente eso: re-renderiza con una flecha nueva.
  describe('cuando el padre re-renderiza', () => {
    function Padre() {
      const [n, setN] = useState(0)
      return (
        <>
          <button onClick={() => setN(x => x + 1)}>refrescar</button>
          <PanelLateral titulo="Asignado" onCerrar={() => cerrado.push(n)} pie={null}>
            <input aria-label="Nombre visible" />
            <span>{`refrescos: ${n}`}</span>
          </PanelLateral>
        </>
      )
    }
    let cerrado: number[] = []

    it('el foco del campo sobrevive a un re-render del padre', () => {
      cerrado = []
      render(<Padre />)
      const campo = screen.getByLabelText(/nombre visible/i)
      campo.focus()
      expect(campo).toHaveFocus()

      fireEvent.click(screen.getByRole('button', { name: /refrescar/i }))

      expect(screen.getByText('refrescos: 1')).toBeInTheDocument()
      expect(campo).toHaveFocus()
    })

    // Y el arreglo no puede lograrlo congelando el `onCerrar` del primer
    // render: Escape tiene que llamar al de AHORA, no al de hace tres renders.
    it('Escape sigue llamando al onCerrar mas reciente', () => {
      cerrado = []
      render(<Padre />)
      fireEvent.click(screen.getByRole('button', { name: /refrescar/i }))
      fireEvent.click(screen.getByRole('button', { name: /refrescar/i }))
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(cerrado).toEqual([2])
    })
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
