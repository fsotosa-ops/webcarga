import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VehicleRosterCard } from './VehicleRosterCard'
import type { CarrierAssetRosterItem } from '@/lib/types'
import { complianceSummary } from '@/lib/states.fixtures'

const VEHICLE: CarrierAssetRosterItem = {
  id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION',
  operational_status: 'ACTIVE',
  fleet_service_type_id: null, fleet_service_type_label: null,
  fleet_service_type_bg_color: null, fleet_service_type_text_color: null, webcarga_operation_type_id: null, webcarga_operation_type_label: null, webcarga_operation_type_code: null,
  total_requirements: 6, last_document_update: '2026-06-01',
  compliance_summary: complianceSummary(),
}

describe('VehicleRosterCard', () => {
  it('renders the plate and type label', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Tracto')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  // Este test DECIA probar el fallback pero probaba el mapa: 'OTRO' estaba
  // mapeado a 'Otro', asi que nunca ejercitaba el camino sin etiqueta. Con los
  // placeholders retirados, ahora si. El fallback sigue importando porque la
  // ingesta podria traer un valor viejo antes de que el CHECK lo impida.
  it('falls back to the raw asset_type when there is no label mapped', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, asset_type: 'LEGADO' }} onOpen={vi.fn()} />)
    expect(screen.getByText('LEGADO')).toBeInTheDocument()
  })

  it('el par: ciclo de vida y el peor estado de sus documentos (D-R8)', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, compliance_summary: complianceSummary({ worst_state: 'OVERDUE', can_operate: false }) }} onOpen={vi.fn()} />)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toHaveClass('text-status-incidente')
  })

  it('shows the fleet service type (Tipo Vehículo) chip when present', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, fleet_service_type_label: 'Tractoreo', fleet_service_type_bg_color: '#eff6ff', fleet_service_type_text_color: '#1d4ed8' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  it('does not render a fleet service type chip when there is none', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} onOpen={vi.fn()} />)
    expect(screen.queryByText('Tractoreo')).not.toBeInTheDocument()
  })
  // ── Regresión del 2026-09-07 ──────────────────────────────────────────────

  it('muestra el tipo de operación, que es lo que decide si bloquea el cierre', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, webcarga_operation_type_label: 'Tractoreo', webcarga_operation_type_code: 'TRACTOREO' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  it('sin tipo de operación lo dice en la tarjeta, no en silencio', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, webcarga_operation_type_label: null }} onOpen={vi.fn()} />)
    expect(screen.getByText('Sin tipo de operación')).toBeInTheDocument()
  })
  it('dado de baja: el par completo, el documental en gris', () => {
    render(<VehicleRosterCard vehicle={{ ...VEHICLE, operational_status: 'INACTIVE' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toHaveClass('text-informativo')
  })

  it('de una empresa dada de baja lo dice en lugar de "Activo" (0.9)', () => {
    render(<VehicleRosterCard vehicle={VEHICLE} carrierStatus="INACTIVE" onOpen={vi.fn()} />)
    expect(screen.getByText('Empresa dada de baja')).toBeInTheDocument()
    expect(screen.queryByText('Activo')).not.toBeInTheDocument()
  })
})
