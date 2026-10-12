import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultadosDelDirectorio } from './ResultadosDelDirectorio'
import type { DirectorioBusqueda } from '@/lib/types'

const DATOS: DirectorioBusqueda = {
  q: 'x',
  empresas: [],
  conductores: [{
    id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1', operational_status: 'ACTIVE',
    carrier_id: 'c1', carrier_name: 'TransCargo', carrier_operational_status: 'INACTIVE',
  }],
  vehiculos: [{
    id: 'a1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE',
    webcarga_operation_type_label: null, carrier_id: 'c1', carrier_name: 'TransCargo',
    carrier_operational_status: 'INACTIVE',
  }],
}

describe('ResultadosDelDirectorio', () => {
  it('marca al conductor y al equipo de una empresa dada de baja (0.9)', () => {
    render(<ResultadosDelDirectorio datos={DATOS} />)
    expect(screen.getAllByText('Empresa dada de baja')).toHaveLength(2)
  })

  it('con la empresa activa no marca nada', () => {
    const datos = {
      ...DATOS,
      conductores: [{ ...DATOS.conductores[0], carrier_operational_status: 'ACTIVE' as const }],
      vehiculos: [{ ...DATOS.vehiculos[0], carrier_operational_status: null }],
    }
    render(<ResultadosDelDirectorio datos={datos} />)
    expect(screen.queryByText('Empresa dada de baja')).not.toBeInTheDocument()
  })

  it('un conductor de baja dice su propia baja, no la de la empresa', () => {
    const datos = { ...DATOS, vehiculos: [], conductores: [{ ...DATOS.conductores[0], operational_status: 'INACTIVE' as const }] }
    render(<ResultadosDelDirectorio datos={datos} />)
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.queryByText('Empresa dada de baja')).not.toBeInTheDocument()
  })
})
