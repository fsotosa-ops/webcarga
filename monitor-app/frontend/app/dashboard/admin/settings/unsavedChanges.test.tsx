import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useUnsavedChanges, LEAVE_QUESTION } from './unsavedChanges'

function Formulario({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty)
  return null
}

function Pagina({ sucios }: { sucios: boolean[] }) {
  return (
    <>
      {sucios.map((d, i) => <Formulario key={i} dirty={d} />)}
      <nav>
        <a href="/dashboard/operations/monitor">Monitor</a>
        <a href="https://www.webcarga.cl">Sitio</a>
        <a href="/dashboard/operations/monitor" target="_blank">En otra pestaña</a>
        <a href="#arriba">Arriba</a>
      </nav>
    </>
  )
}

afterEach(() => vi.restoreAllMocks())

// Menor diferido 2 (revisión final 22/10): salir por el menú lateral, las migas o
// cualquier enlace de la app perdía lo escrito sin avisar.
describe('useUnsavedChanges', () => {
  it('con cambios, un enlace de la app pregunta y, si se cancela, no sale', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Pagina sucios={[true]} />)
    const siguio = fireEvent.click(screen.getByText('Monitor'))
    expect(confirm).toHaveBeenCalledWith(LEAVE_QUESTION)
    expect(siguio).toBe(false)
  })

  it('si la persona confirma, sale', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Pagina sucios={[true]} />)
    expect(fireEvent.click(screen.getByText('Monitor'))).toBe(true)
  })

  it('sin cambios no pregunta', () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<Pagina sucios={[false]} />)
    fireEvent.click(screen.getByText('Monitor'))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('no pregunta por un enlace externo, en otra pestaña o a la misma página', () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<Pagina sucios={[true]} />)
    fireEvent.click(screen.getByText('Sitio'))
    fireEvent.click(screen.getByText('En otra pestaña'))
    fireEvent.click(screen.getByText('Arriba'))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('con dos formularios, basta que uno tenga cambios (cada uno lleva su aviso)', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Pagina sucios={[true, false]} />)
    fireEvent.click(screen.getByText('Monitor'))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
