import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VehicleRosterCard } from './VehicleRosterCard'
import type { TransporterVehicle } from '@/lib/types'

const VEHICLE: TransporterVehicle = {
  id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
  governance: {
    year: 2020, circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
    gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
    padron: 'ok', poliza_rc: 'ok', gps: 'ok', seguro_carga: 'ok',
    mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
  },
  baja_override: false, baja_reason: null,
}

describe('VehicleRosterCard', () => {
  it('renders the plate, category and a status label', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Tracto')).toBeInTheDocument()
    expect(screen.getByText('Docs OK')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })
})
