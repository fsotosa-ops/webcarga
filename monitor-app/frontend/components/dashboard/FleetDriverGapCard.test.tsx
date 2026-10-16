import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FleetDriverGapCard } from './FleetDriverGapCard'

describe('FleetDriverGapCard', () => {
  it('no renderiza nada cuando no hay inconsistencias', () => {
    const { container } = render(<FleetDriverGapCard rows={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('muestra el conteo del encabezado y cada fila con las palabras de Pendientes', () => {
    render(<FleetDriverGapCard rows={[
      { carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 2, gap: 1 },
      { carrier_id: 'c2', business_name: 'Rios Ltda', n_tractos: 2, n_conductores: 4, gap: -2 },
    ]} />)
    expect(screen.getByText('2 empresas con desbalance de dotación')).toBeInTheDocument()
    expect(screen.getByText('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByText('Faltan 1 conductor · 3 tractos / 2 conductores')).toBeInTheDocument()
    expect(screen.getByText('2 conductores de más · 2 tractos / 4 conductores')).toBeInTheDocument()
  })
})
