import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EntityCell } from './EntityCell'
import { QuickViewContext } from './QuickViewProvider'

describe('EntityCell', () => {
  it('con id abre la vista rápida de esa entidad', () => {
    const onOpen = vi.fn()
    render(<EntityCell kind="driver" id="d1" label="Vidal Gallardo" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('link', { name: 'Ver conductor Vidal Gallardo' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'driver', id: 'd1', label: 'Vidal Gallardo' })
  })

  // Entrega 1 de fichas (15/10): el nombre es un enlace de verdad a la ficha.
  // El clic abre la vista rápida; con Ctrl/Cmd/Shift o el botón del medio
  // manda el navegador (otra pestaña), sin abrir el panel.
  it('N1: es un enlace a su ficha, y el clic con una tecla modificadora no abre la vista rápida', () => {
    const onOpen = vi.fn()
    render(<EntityCell kind="asset" id="a1" label="BBPV80" onOpen={onOpen} />)
    const enlace = screen.getByRole('link', { name: 'Ver equipo BBPV80' })
    expect(enlace).toHaveAttribute('href', '/dashboard/assets/a1')
    fireEvent.click(enlace, { ctrlKey: true })
    fireEvent.click(enlace, { metaKey: true })
    fireEvent.click(enlace, { shiftKey: true })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('sin onOpen usa la vista rápida del proveedor', () => {
    const open = vi.fn()
    render(<QuickViewContext.Provider value={open}><EntityCell kind="carrier" id="c1" label="Hueraman" /></QuickViewContext.Provider>)
    fireEvent.click(screen.getByRole('link', { name: 'Ver empresa Hueraman' }))
    expect(open).toHaveBeenCalledWith({ kind: 'carrier', id: 'c1', label: 'Hueraman' })
  })

  it('sin id lo que vino del TMS queda en texto y dice que no está en el directorio', () => {
    render(<EntityCell kind="driver" id={null} label="QUINTANA SOSA" unresolved onOpen={vi.fn()} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('QUINTANA SOSA')).toBeInTheDocument()
    expect(screen.getByText('no está en el directorio')).toBeInTheDocument()
  })

  it('sin quién lo abra (sin permiso) es texto, sin enlace', () => {
    render(<EntityCell kind="carrier" id="c1" label="Hueraman" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Hueraman')).toBeInTheDocument()
  })

  it('sin dato muestra el texto de reemplazo', () => {
    render(<EntityCell kind="asset" id={null} label={null} empty="Sin tracto habitual" />)
    expect(screen.getByText('Sin tracto habitual')).toBeInTheDocument()
  })

  // En una fila clicable (Seguros, Monitor) el clic en el nombre no puede además
  // seleccionar la fila: con o sin teclas modificadoras.
  it('el clic en el nombre no llega a la fila que lo contiene', () => {
    const fila = vi.fn()
    render(<div onClick={fila}><EntityCell kind="carrier" id="c1" label="Hueraman" onOpen={vi.fn()} /></div>)
    fireEvent.click(screen.getByRole('link', { name: 'Ver empresa Hueraman' }))
    fireEvent.click(screen.getByRole('link', { name: 'Ver empresa Hueraman' }), { metaKey: true })
    expect(fila).not.toHaveBeenCalled()
  })
})

