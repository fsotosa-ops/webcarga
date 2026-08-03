import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VehicleRosterCard } from './VehicleRosterCard'
import type { CarrierAssetRosterItem } from '@/lib/types'

const VEHICLE: CarrierAssetRosterItem = {
  id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION',
  operational_status: 'ACTIVE',
  fleet_service_type_id: null, fleet_service_type_label: null,
  fleet_service_type_bg_color: null, fleet_service_type_text_color: null,
  total_requirements: 6, last_document_update: '2026-06-01',
  pending_mandatory: 0, compliance_health: 'OK',
}

describe('VehicleRosterCard', () => {
  it('renders the plate, type label and an "Al día" pill when there are no pending mandatory docs', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Tracto')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('falls back to the raw asset_type when there is no label mapped', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, asset_type: 'OTRO' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Otro')).toBeInTheDocument()
  })

  it('shows a red pending pill with the count when compliance_health is PENDING', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, compliance_health: 'PENDING', pending_mandatory: 3 }} onOpen={vi.fn()} />)
    expect(screen.getByText('3 pendientes')).toBeInTheDocument()
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
  })

  it('shows the fleet service type (Tipo Vehículo) chip when present', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, fleet_service_type_label: 'Tractoreo', fleet_service_type_bg_color: '#eff6ff', fleet_service_type_text_color: '#1d4ed8' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  it('does not render a fleet service type chip when there is none', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.queryByText('Tractoreo')).not.toBeInTheDocument()
  })
})
