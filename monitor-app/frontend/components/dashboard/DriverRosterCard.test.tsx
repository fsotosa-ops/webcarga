// components/dashboard/DriverRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriverRosterCard } from './DriverRosterCard'
import type { CarrierDriverRosterItem } from '@/lib/types'
import { complianceSummary } from '@/lib/states.fixtures'

const DRIVER: CarrierDriverRosterItem = {
  id: 'd1', tax_id: '11111111-1', full_name: 'Juan Pérez',
  operational_status: 'ACTIVE', total_requirements: 12, last_document_update: '2026-06-01',
  compliance_summary: complianceSummary(),
}

describe('DriverRosterCard', () => {
  it('renders the name', () => {
    render(<DriverRosterCard driver={DRIVER} onOpen={vi.fn()} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<DriverRosterCard driver={DRIVER} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('el par: ciclo de vida y el peor estado de sus documentos (D-R8)', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, compliance_summary: complianceSummary({ worst_state: 'OVERDUE', can_operate: false }) }} onOpen={vi.fn()} />)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toHaveClass('text-status-incidente')
  })

  it('dado de baja: el par completo, el documental en gris', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, operational_status: 'INACTIVE' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toHaveClass('text-informativo')
  })

  it('de una empresa dada de baja lo dice en lugar de "Activo" (0.9)', () => {
    render(<DriverRosterCard driver={DRIVER} carrierStatus="INACTIVE" onOpen={vi.fn()} />)
    expect(screen.getByText('Empresa dada de baja')).toBeInTheDocument()
    expect(screen.queryByText('Activo')).not.toBeInTheDocument()
  })

  it('con la empresa activa no marca nada', () => {
    render(<DriverRosterCard driver={DRIVER} carrierStatus="ACTIVE" onOpen={vi.fn()} />)
    expect(screen.queryByText('Empresa dada de baja')).not.toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })
})
