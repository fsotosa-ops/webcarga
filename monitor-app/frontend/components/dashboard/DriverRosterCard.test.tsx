// components/dashboard/DriverRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriverRosterCard } from './DriverRosterCard'
import type { CarrierDriverRosterItem } from '@/lib/types'

const DRIVER: CarrierDriverRosterItem = {
  id: 'd1', tax_id: '11111111-1', full_name: 'Juan Pérez',
  operational_status: 'ACTIVE', total_requirements: 12, last_document_update: '2026-06-01',
  pending_mandatory: 0, compliance_health: 'OK',
}

describe('DriverRosterCard', () => {
  it('renders the name and an "Al día" pill when there are no pending mandatory docs', () => {
    render(<DriverRosterCard driver={DRIVER} onOpen={vi.fn()} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<DriverRosterCard driver={DRIVER} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('shows a red pending pill with the count when compliance_health is PENDING', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, compliance_health: 'PENDING', pending_mandatory: 2 }} onOpen={vi.fn()} />)
    expect(screen.getByText('2 pendientes')).toBeInTheDocument()
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
  })

  it('uses singular wording for a single pending document', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, compliance_health: 'PENDING', pending_mandatory: 1 }} onOpen={vi.fn()} />)
    expect(screen.getByText(/1 pendiente(?!s)/)).toBeInTheDocument()
  })
  it('un conductor dado de baja lo dice en la tarjeta, sin abrir la ficha', () => {
    // Pablo, 04/09: *"di de baja a los 3 conductores de Casillas... pero aquí
    // no me dice nada"*. El dato ya venía en el payload y nadie lo dibujaba.
    render(<DriverRosterCard driver={{ ...DRIVER, operational_status: 'INACTIVE' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
  })

  it('la baja reemplaza al pill de documentación, no convive con él', () => {
    // Los 3 de Casillas tenían los papeles al día: con los dos pills a la vez
    // la tarjeta decía "Al día" en verde sobre alguien que ya no trabaja.
    render(<DriverRosterCard driver={{ ...DRIVER, operational_status: 'INACTIVE', compliance_health: 'OK' }} onOpen={vi.fn()} />)
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
  })
})
