import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VehicleRosterCard } from './VehicleRosterCard'
import type { CarrierAssetRosterItem } from '@/lib/types'

const VEHICLE: CarrierAssetRosterItem = {
  id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION',
  operational_status: 'ACTIVE', total_requirements: 6, last_document_update: '2026-06-01',
}

describe('VehicleRosterCard', () => {
  it('renders the plate, type label and requirement count', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Tracto')).toBeInTheDocument()
    expect(screen.getByText(/6 requisitos/)).toBeInTheDocument()
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
})
