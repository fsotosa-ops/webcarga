import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GestionDeclarada } from './GestionDeclarada'

vi.mock('@/lib/api/carriers', () => ({ carriersApi: { patch: vi.fn() } }))

describe('GestionDeclarada — un solo chip de tipo (D6, Entrega B)', () => {
  it('si lo declarado coincide con la flota, no repite el chip', () => {
    render(<GestionDeclarada carrierId="c1" declarado={['TRACTOREO']} canEdit onGuardado={vi.fn()} derivado="Tractoreo" />)
    expect(screen.queryByText('Tractoreo')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar el tipo de gestión' })).toBeInTheDocument()
  })

  it('si difiere, lo marca como declarado', () => {
    render(<GestionDeclarada carrierId="c1" declarado={['EQUIPO_COMPLETO']} canEdit={false} onGuardado={vi.fn()} derivado="Tractoreo" />)
    expect(screen.getByText('Declarado: Equipo Completo')).toBeInTheDocument()
  })

  it('sin flota, muestra lo declarado tal cual', () => {
    render(<GestionDeclarada carrierId="c1" declarado={['TRACTOREO']} canEdit={false} onGuardado={vi.fn()} derivado={null} />)
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })
})
