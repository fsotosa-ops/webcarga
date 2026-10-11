import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EntityCell } from './EntityCell'

describe('EntityCell', () => {
  it('con id abre la vista rápida de esa entidad', () => {
    const onOpen = vi.fn()
    render(<EntityCell kind="driver" id="d1" label="Vidal Gallardo" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver conductor Vidal Gallardo' }))
    expect(onOpen).toHaveBeenCalledWith({ kind: 'driver', id: 'd1', label: 'Vidal Gallardo' })
  })

  it('sin id lo que vino del TMS queda en texto y dice que no está en el directorio', () => {
    render(<EntityCell kind="driver" id={null} label="QUINTANA SOSA" unresolved onOpen={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('QUINTANA SOSA')).toBeInTheDocument()
    expect(screen.getByText('no está en el directorio')).toBeInTheDocument()
  })

  it('sin quién lo abra (sin permiso) es texto, sin botón', () => {
    render(<EntityCell kind="carrier" id="c1" label="Hueraman" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Hueraman')).toBeInTheDocument()
  })

  it('sin dato muestra el texto de reemplazo', () => {
    render(<EntityCell kind="asset" id={null} label={null} empty="Sin tracto habitual" />)
    expect(screen.getByText('Sin tracto habitual')).toBeInTheDocument()
  })
})
