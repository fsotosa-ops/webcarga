import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasoViajesSection } from './PasoViajesSection'

const viaje = (id: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-08-18', client_name: 'Walmart',
  source_system_trip_id: '2032999', trip_status: 'Asignado',
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

const grupos = {
  hoy: [viaje('t1')], rezago: [viaje('t2')], en_curso: [viaje('t3')],
  abandonado: [viaje('t4', { dias_sin_novedad: 31.6 })],
}

describe('PasoViajesSection', () => {
  it('no muestra ninguna cifra mientras carga', () => {
    render(<PasoViajesSection grupos={undefined} bloquean={undefined} cargando
                              motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.queryByText('0')).toBeNull()
  })

  // Regla 5 de Pablo: "esta bien que aparezca aca y que se quede pegado...
  // si no me cerraron el viaje no me lo van a pagar".
  it('los abandonados por el TMS se ven, y dicen hace cuanto no reportan', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2} motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.getByText(/31,6 días sin novedad|31.6 días sin novedad/)).toBeInTheDocument()
  })

  // La columna correcta es "sin novedad del TMS", no dias desde la
  // planificacion: un viaje planificado hace 9 dias puede haber reportado
  // hace 2 horas.
  it('solo hoy y rezago se pueden cerrar; en curso y abandonado no', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2} motivos={[]} onCerrar={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('no deja cerrar sin elegir motivo', () => {
    const onCerrar = vi.fn()
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={onCerrar} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /No asignado por WebCarga/i })).toBeDisabled()
  })

  it('con motivo elegido, el boton dice a cuantos viajes se aplica', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.change(screen.getByLabelText(/Motivo/i), { target: { value: 'm1' } })
    expect(screen.getByRole('button', { name: /1 viaje/i })).toBeEnabled()
  })
})
