import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasoViajesSection } from './PasoViajesSection'

const viaje = (id: string, nroTms: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-08-18', client_name: 'Walmart',
  source_system_trip_id: nroTms, trip_status: 'Asignado',
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

// Un Nº de viaje distinto por fila, como en la realidad: repetirlo escondía
// que la etiqueta de cada desplegable no distinguía una fila de otra.
const grupos = {
  hoy: [viaje('t1', '2032999')], rezago: [viaje('t2', '2033000')],
  en_curso: [viaje('t3', '2033001')],
  abandonado: [viaje('t4', '2033002', { dias_sin_novedad: 31.6 })],
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
    fireEvent.change(screen.getByLabelText('Motivo', { selector: 'select' }), { target: { value: 'm1' } })
    expect(screen.getByRole('button', { name: /1 viaje/i })).toBeEnabled()
  })

  it('el motivo se elige en la propia fila, sin bajar hasta el pie', async () => {
    // El pedido del usuario (14/09): *"la selección de motivo se visualiza al
    // final de la página. Hay que hacer scrolling y no de forma directa"*. Con
    // las cuatro tablas apiladas, declarar una fila que se ve arriba obligaba
    // a recorrer toda la página y volver.
    const onCerrar = vi.fn().mockResolvedValue(undefined)
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={onCerrar} />)

    const selectDeFila = screen.getByLabelText('Motivo del viaje 2032999', { selector: 'select' })
    fireEvent.change(selectDeFila, { target: { value: 'm1' } })

    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t1'], 'm1'))
  })

  it('en curso y abandonado muestran el motivo como texto, no como selector', () => {
    // No llevan casilla y tampoco se declaran acá: en curso todavía puede
    // reportar, y abandonado ya está fuera del alcance de "hoy".
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={vi.fn()} />)

    // Cuatro filas, y sólo las dos seleccionables traen desplegable.
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    expect(screen.getAllByRole('columnheader', { name: 'Motivo de no asignación' })).toHaveLength(4)
  })

  it('la barra de lote queda fijada al pie del área visible', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])

    const barra = screen.getByText('1 seleccionado').closest('div')!
    expect(barra.className).toContain('sticky')
    expect(barra.className).toContain('bottom-0')
  })
})
