import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasoViajesSection } from './PasoViajesSection'

const viaje = (id: string, nroTms: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-08-18', client_name: 'Walmart',
  source_system: 'qanalytics', source_system_trip_id: nroTms, trip_status: 'Asignado',
  tractor_plate: null, driver_name: null, carrier_name: null, origin: null, destinations: [],
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

// Un Nº de viaje distinto por fila, como en la realidad: repetirlo escondía
// que la etiqueta de cada desplegable no distinguía una fila de otra.
const grupos = {
  hoy: [viaje('t1', '2032999')], rezago: [viaje('t2', '2033000')],
  en_curso: [viaje('t3', '2033001')],
  abandonado: [viaje('t4', '2033002', { dias_sin_novedad: 31.6 })],
  con_motivo: [],
  oferta_sin_declarar: [],
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0])

    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t1'], 'm1'))
  })

  // HU-D3 (minuta 02/10): elegir en el desplegable cerraba el viaje al
  // instante y desaparecía. Ahora elegir no escribe nada; "Guardar" sí.
  it('elegir un motivo en la fila no cierra el viaje hasta apretar Guardar', () => {
    const onCerrar = vi.fn()
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={onCerrar} />)
    const guardar = screen.getAllByRole('button', { name: 'Guardar' })[0]
    expect(guardar).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo del viaje 2032999', { selector: 'select' }),
                     { target: { value: 'm1' } })

    expect(onCerrar).not.toHaveBeenCalled()
    expect(guardar).toBeEnabled()
  })

  it('lo declarado se ve en "Con motivo" y se puede deshacer', async () => {
    const onDeshacer = vi.fn().mockResolvedValue(undefined)
    const conMotivo = { ...grupos, con_motivo: [viaje('t5', '2033003', {
      unassigned_reason_id: 'm1', unassigned_reason_label: 'No da por tarifa' })] }
    render(<PasoViajesSection grupos={conMotivo} bloquean={2} motivos={[]}
                              onCerrar={vi.fn()} onDeshacer={onDeshacer} />)

    expect(screen.getByText('No da por tarifa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer el motivo del viaje 2033003' }))

    await waitFor(() => expect(onDeshacer).toHaveBeenCalledWith(['t5']))
  })

  it('con el día firmado no se ofrece deshacer', () => {
    const conMotivo = { ...grupos, con_motivo: [viaje('t5', '2033003', {
      unassigned_reason_id: 'm1', unassigned_reason_label: 'No da por tarifa' })] }
    render(<PasoViajesSection grupos={conMotivo} bloquean={0} motivos={[]}
                              onCerrar={vi.fn()} onDeshacer={vi.fn()} soloLectura />)

    expect(screen.queryByRole('button', { name: /Deshacer/ })).toBeNull()
  })

  // HU-D2: identificar el viaje sin salir del cierre.
  it('cada fila trae patente, conductor, empresa, origen y destinos', () => {
    const conContexto = { ...grupos, hoy: [viaje('t1', '2032999', {
      tractor_plate: 'LRTD13', driver_name: 'Juan Pérez', carrier_name: 'Transportes Uno',
      origin: 'Bod La Farfana 1', destinations: ['Melipilla', 'Talagante'] })] }
    render(<PasoViajesSection grupos={conContexto} bloquean={1} motivos={[]} onCerrar={vi.fn()} />)

    for (const texto of ['LRTD13', 'Juan Pérez', 'Transportes Uno', 'Bod La Farfana 1', 'Melipilla · Talagante']) {
      expect(screen.getByText(texto)).toBeInTheDocument()
    }
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

  // ESTE TEST NO PRUEBA QUE LA BARRA SE VEA, y no puede: jsdom no tiene layout.
  // La primera version afirmaba `className` contiene "sticky", y eso era cierto
  // mientras la barra estaba ROTA — quedaba 2.751 px fuera de lo visible porque
  // una card ancestro tenia `overflow-hidden` y se volvia su scrollport. Lo
  // unico verificable aca es la PRECONDICION estructural: la barra va ANTES de
  // las tablas, porque un sticky no puede salirse de la caja de su padre y como
  // ultimo hijo solo se pegaba al llegar al final. Lo demas se mira en el
  // navegador, y se miro.
  it('la barra de lote se renderiza antes de las tablas, no al final', () => {
    render(<PasoViajesSection grupos={grupos} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])

    const barra = screen.getByText('1 seleccionado').closest('div')!
    const primeraTabla = document.querySelector('table')!
    expect(barra.compareDocumentPosition(primeraTabla) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    expect(barra.className).toContain('sticky top-0')
  })

  // Ofertas que Sodimac retiró porque no se tomaron (07/10): se declaran con
  // motivo como las de hoy y rezago, pero no suman a "por resolver".
  it('las ofertas sin declarar se pueden declarar con motivo', () => {
    const conOfertas = { ...grupos, oferta_sin_declarar: [viaje('t9', '808702', { source_system: 'sodimac' })] }
    render(<PasoViajesSection grupos={conOfertas} bloquean={2}
                              motivos={[{ id: 'm1', label: 'No da por tarifa' }]}
                              onCerrar={vi.fn()} />)
    expect(screen.getByText('Ofertas sin declarar')).toBeInTheDocument()
    expect(screen.getByLabelText('Motivo del viaje 808702', { selector: 'select' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })
})
