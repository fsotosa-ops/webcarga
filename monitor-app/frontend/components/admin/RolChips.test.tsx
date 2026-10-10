import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RolChips from './RolChips'
import { ROLES } from './rolesDePrueba'

describe('RolChips', () => {
  it('muestra los nombres de los roles', () => {
    render(<RolChips codes={['reader', 'operations_operator']} roles={ROLES} />)
    expect(screen.getByText('Lectura')).toBeInTheDocument()
    expect(screen.getByText('Operador de Operaciones')).toBeInTheDocument()
  })
  it('Propietario va primero y se distingue', () => {
    render(<RolChips codes={['reader', 'owner']} roles={ROLES} />)
    const chips = screen.getAllByRole('listitem')
    expect(chips[0]).toHaveTextContent('Propietario')
    expect(chips[0]).toHaveAttribute('data-propietario', 'true')
  })
  it('con más de dos, resume el resto y lo nombra al pasar el cursor', () => {
    render(<RolChips codes={['admin', 'reader', 'operations_operator', 'insurance_operator']} roles={ROLES} />)
    const mas = screen.getByText('+2')
    expect(mas).toHaveAttribute('title', expect.stringContaining('Operador de Seguros'))
  })
  it('sin roles lo dice', () => {
    render(<RolChips codes={[]} roles={ROLES} />)
    expect(screen.getByText('Sin roles')).toBeInTheDocument()
  })
})
