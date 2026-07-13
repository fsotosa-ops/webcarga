// components/dashboard/DriverRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriverRosterCard } from './DriverRosterCard'
import type { TransporterDriver } from '@/lib/types'

const DRIVER: TransporterDriver = {
  id: 'd1', rut: '11111111-1', name: 'Juan Pérez',
  governance: {
    id_expiry: '2099-01-01', license_expiry: '2099-01-01',
    anexo_3_gc: 'ok', epp: 'ok', das_odi: 'ok', hoja_de_vida: 'ok',
    cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
    creacion_gc_driver: 'ok', avance_total: 100,
  },
  baja_override: false, baja_reason: null,
}

describe('DriverRosterCard', () => {
  it('renders the name, rut and a status label', () => {
    render(<DriverRosterCard driver={DRIVER} onOpen={vi.fn()} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Docs OK')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<DriverRosterCard driver={DRIVER} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('shows a danger status when license is expired', () => {
    const expired = { ...DRIVER, governance: { ...DRIVER.governance!, license_expiry: '2020-01-01' } }
    render(<DriverRosterCard driver={expired} onOpen={vi.fn()} />)
    expect(screen.getByText('Vencimiento vencido')).toBeInTheDocument()
  })
})
