import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { PasoViajesSection } from './PasoViajesSection'

const viaje = (id: string, nroTms: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-10-10', client_name: 'Walmart',
  source_system: 'qanalytics', source_system_trip_id: nroTms, trip_status: 'Asignado',
  tractor_plate: null, driver_name: null, carrier_name: null, origin: null, destinations: [],
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

// Un Nº de viaje distinto por fila: repetirlo escondía que la etiqueta de cada
// desplegable no distinguía una fila de otra.
const GRUPOS = {
  hoy: [viaje('t1', '2032999', { tractor_plate: 'LRTD11' })],
  rezago: [viaje('t2', '2033000', { planning_date: '2026-10-07', driver_name: 'Juan Uno' })],
  oferta_sin_declarar: [viaje('t7', '808702', { client_name: 'Sodimac' })],
  abandonado: [viaje('t4', '2033002', { planning_date: '2026-09-01', dias_sin_novedad: 31.6 })],
  en_curso: [viaje('t3', '2033001', { planning_date: '2026-10-09', trip_status: 'RETORNANDO' })],
  pendiente_cierre_tms: [
    viaje('t5', '885613', { planning_date: '2026-10-07', tractor_plate: 'PYST91' }),
    viaje('t6', '881496', { planning_date: '2026-10-02', tractor_plate: 'PYST91' }),
  ],
  con_motivo: [viaje('t8', '2033003', { unassigned_reason_label: 'No da por tarifa' })],
}
// Asignación incompleta (minuta 09/10 §2.4): una del día y una activa de antes.
const INCOMPLETAS = {
  incomplete_assignment: [
    viaje('t10', '2034000', { tractor_plate: 'FRTC42', missing_fleet: ['driver'] }),
    viaje('t11', '2034001', { planning_date: '2026-10-08', driver_name: 'Juan Dos', missing_fleet: ['tractor'] }),
  ],
}
const MOTIVOS = [{ id: 'm1', label: 'No da por tarifa' }]

function renderViajes(props: Partial<ComponentProps<typeof PasoViajesSection>> = {}) {
  const onCerrar = vi.fn().mockResolvedValue(undefined)
  const onDeshacer = vi.fn().mockResolvedValue(undefined)
  const onCambiarPestana = vi.fn()
  const utils = render(
    <PasoViajesSection fecha="2026-10-10" grupos={GRUPOS} bloquean={2} motivos={MOTIVOS}
                       onCerrar={onCerrar} onDeshacer={onDeshacer} onCambiarPestana={onCambiarPestana}
                       tripHref={id => `/viaje/${id}`} {...props} />,
  )
  return { ...utils, onCerrar, onDeshacer, onCambiarPestana }
}

const pestana = (nombre: RegExp) => screen.getByRole('tab', { name: nombre })
const numerosDeViaje = () => screen.queryAllByTestId('nro-viaje').map(e => e.textContent)

describe('PasoViajesSection', () => {
  it('no muestra ninguna cifra mientras carga', () => {
    render(<PasoViajesSection fecha="2026-10-10" grupos={undefined} bloquean={undefined} cargando
                              motivos={[]} onCerrar={vi.fn()} tripHref={id => `/viaje/${id}`} />)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('tres pestañas con su cantidad, y abre en Por resolver', () => {
    renderViajes()
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Por resolver4', 'En seguimiento3', 'Resueltos1'])
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
  })

  it('Por resolver junta hoy, rezago, ofertas y abandonados, del más antiguo al más nuevo', () => {
    renderViajes()
    // A igual fecha (10/10), el Nº de viaje se compara como número: 808702 < 2032999.
    expect(numerosDeViaje()).toEqual(['2033002', '2033000', '808702', '2032999'])
  })

  it('cada fila dice por qué está aquí, y las que bloquean la firma lo marcan', () => {
    renderViajes()
    const rezago = screen.getByText('2033000').closest('tr')!
    expect(within(rezago).getByText('Rezago · 3 días')).toBeInTheDocument()
    expect(within(rezago).getByText('Bloquea la firma')).toBeInTheDocument()
    const oferta = screen.getByText('808702').closest('tr')!
    expect(within(oferta).getByText('Oferta retirada por el TMS')).toBeInTheDocument()
    expect(within(oferta).queryByText('Bloquea la firma')).toBeNull()
  })

  it('lo de días anteriores dice hace cuántos días', () => {
    renderViajes()
    expect(within(screen.getByText('2033002').closest('tr')!).getByText('hace 39 días')).toBeInTheDocument()
    expect(within(screen.getByText('2032999').closest('tr')!).queryByText(/hace/)).toBeNull()
  })

  it('todo lo de Por resolver se declara, incluidos los abandonados', () => {
    renderViajes()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getByLabelText('Motivo del viaje 2033002', { selector: 'select' })).toBeInTheDocument()
  })

  it('el motivo se elige en la fila y se guarda con Guardar', async () => {
    const { onCerrar } = renderViajes()
    const fila = screen.getByText('2032999').closest('tr')!
    const guardar = within(fila).getByRole('button', { name: 'Guardar' })
    expect(guardar).toBeDisabled()
    fireEvent.change(within(fila).getByLabelText('Motivo del viaje 2032999', { selector: 'select' }), { target: { value: 'm1' } })
    expect(onCerrar).not.toHaveBeenCalled()
    fireEvent.click(guardar)
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t1'], 'm1'))
  })

  it('en lote: no deja cerrar sin motivo, y con motivo dice a cuántos viajes se aplica', async () => {
    const { onCerrar } = renderViajes()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByRole('button', { name: /No asignado por WebCarga/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo', { selector: 'select' }), { target: { value: 'm1' } })
    fireEvent.click(screen.getByRole('button', { name: /2 viajes/ }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t4', 't2'], 'm1'))
  })

  it('la barra de lote va arriba de la tabla y pegada al techo', () => {
    renderViajes()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const barra = screen.getByText('1 seleccionado').closest('div')!
    expect(barra.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(barra.className).toContain('sticky top-0')
  })

  it('cambiar de pestaña conserva la selección', () => {
    renderViajes()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(pestana(/En seguimiento/))
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    fireEvent.click(pestana(/Por resolver/))
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
  })

  it('En seguimiento no tiene acciones y dice la situación de cada viaje', () => {
    const { onCambiarPestana } = renderViajes()
    fireEvent.click(pestana(/En seguimiento/))
    expect(onCambiarPestana).toHaveBeenCalledWith('tracking')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getByText('En ruta · RETORNANDO')).toBeInTheDocument()
    expect(screen.getAllByText('Espera cierre del TMS').length).toBeGreaterThan(0)
  })

  it('una patente con dos viajes lleva la marca, con los números en el título', () => {
    renderViajes({ pestana: 'tracking' })
    const marcas = screen.getAllByText('2 viajes')
    expect(marcas).toHaveLength(2)
    expect(marcas[0]).toHaveAttribute('title', 'PYST91: 881496, 885613')
  })

  it('Resueltos muestra el motivo y deja deshacer', async () => {
    const { onDeshacer } = renderViajes({ pestana: 'resolved' })
    expect(screen.getByText('No da por tarifa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer el motivo del viaje 2033003' }))
    await waitFor(() => expect(onDeshacer).toHaveBeenCalledWith(['t8']))
  })

  it('con el día firmado no se declara ni se deshace', () => {
    renderViajes({ soloLectura: true })
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    fireEvent.click(pestana(/Resueltos/))
    expect(screen.queryByRole('button', { name: /Deshacer/ })).toBeNull()
  })

  it('los chips filtran la pestaña por el camino por el que llegó el viaje', () => {
    renderViajes()
    fireEvent.click(screen.getByRole('button', { name: /^Rezago/ }))
    expect(numerosDeViaje()).toEqual(['2033000'])
    fireEvent.click(screen.getByRole('button', { name: /^Rezago/ }))
    expect(numerosDeViaje()).toHaveLength(4)
  })

  it('una pestaña vacía lo dice en una línea, sin tabla', () => {
    renderViajes({ grupos: { ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] }, pestana: 'to_resolve' })
    expect(screen.getByText('Nada por resolver: puedes firmar el día')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('sin pestaña en la URL y sin nada por resolver, abre En seguimiento', () => {
    renderViajes({ grupos: { ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] } })
    expect(pestana(/En seguimiento/)).toHaveAttribute('aria-selected', 'true')
  })

  it('una pestaña que no existe en la URL cae en la inicial', () => {
    renderViajes({ pestana: 'xyz' as never })
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
  })

  it('al declarar el último por resolver, la pestaña no salta sola', () => {
    const { rerender } = renderViajes({ pestana: 'to_resolve' })
    rerender(<PasoViajesSection tripHref={id => `/viaje/${id}`} fecha="2026-10-10" bloquean={0} motivos={MOTIVOS} onCerrar={vi.fn()} pestana="to_resolve"
                                grupos={{ ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] }} />)
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nada por resolver: puedes firmar el día')).toBeInTheDocument()
  })

  it('sin pestaña en la URL, declarar el último por resolver tampoco hace saltar la pestaña', () => {
    const { rerender } = renderViajes()
    rerender(<PasoViajesSection tripHref={id => `/viaje/${id}`} fecha="2026-10-10" bloquean={0} motivos={MOTIVOS} onCerrar={vi.fn()}
                                grupos={{ ...GRUPOS, hoy: [], rezago: [], oferta_sin_declarar: [], abandonado: [] }} />)
    expect(pestana(/Por resolver/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Nada por resolver: puedes firmar el día')).toBeInTheDocument()
  })

  it('un chip elegido que se queda sin viajes deja de filtrar, en vez de dejar la tabla vacía', () => {
    const { rerender } = renderViajes()
    fireEvent.click(screen.getByRole('button', { name: /^Rezago/ }))
    rerender(<PasoViajesSection tripHref={id => `/viaje/${id}`} fecha="2026-10-10" bloquean={1} motivos={MOTIVOS} onCerrar={vi.fn()}
                                grupos={{ ...GRUPOS, rezago: [] }} />)
    expect(numerosDeViaje()).toEqual(['2033002', '808702', '2032999'])
  })

  it('un viaje declarado en su fila sale de la selección del lote', async () => {
    renderViajes()
    const fila = screen.getByText('2032999').closest('tr')!
    fireEvent.click(within(fila).getByRole('checkbox'))
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    fireEvent.change(within(fila).getByLabelText('Motivo del viaje 2032999', { selector: 'select' }), { target: { value: 'm1' } })
    fireEvent.click(within(fila).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.queryByText('1 seleccionado')).toBeNull())
  })

  it('un viaje seleccionado que deja de estar por resolver no cuenta en el lote', () => {
    const { rerender } = renderViajes()
    fireEvent.click(within(screen.getByText('2032999').closest('tr')!).getByRole('checkbox'))
    rerender(<PasoViajesSection tripHref={id => `/viaje/${id}`} fecha="2026-10-10" bloquean={1} motivos={MOTIVOS} onCerrar={vi.fn()}
                                grupos={{ ...GRUPOS, hoy: [], con_motivo: [...GRUPOS.con_motivo, GRUPOS.hoy[0]] }} />)
    expect(screen.queryByText('1 seleccionado')).toBeNull()
  })

  it('el buscador cubre las tres pestañas y cada una dice cuántos coinciden', () => {
    renderViajes()
    fireEvent.change(screen.getByRole('searchbox', { name: /buscar/i }), { target: { value: 'pyst91' } })
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Por resolver0 de 4', 'En seguimiento2 de 3', 'Resueltos0 de 1'])
    expect(screen.getByText('2 resultados en En seguimiento')).toBeInTheDocument()
  })

  it('cada fila trae patente, conductor, empresa, origen y destinos', () => {
    renderViajes({ grupos: { ...GRUPOS, hoy: [viaje('t1', '2032999', {
      tractor_plate: 'LRTD11', driver_name: 'Ana Soto', carrier_name: 'Transportes Sur',
      origin: 'CD Lo Aguirre', destinations: ['Local 1', 'Local 2'],
    })] } })
    for (const texto of ['LRTD11', 'Ana Soto', 'Transportes Sur', 'CD Lo Aguirre', 'Local 1 · Local 2']) {
      expect(screen.getByText(texto)).toBeInTheDocument()
    }
  })

  it('si el backend todavía no manda un grupo, la pestaña igual se dibuja', () => {
    const { pendiente_cierre_tms: _, ...sinElNuevo } = GRUPOS
    renderViajes({ grupos: sinElNuevo as typeof GRUPOS, pestana: 'tracking' })
    expect(screen.getByText('2033001')).toBeInTheDocument()
  })

  it('la asignación incompleta dice qué falta, lleva a completar la flota y no pide motivo', () => {
    renderViajes({ grupos: { ...GRUPOS, ...INCOMPLETAS } })
    const delDia = screen.getByText('2034000').closest('tr')!
    expect(within(delDia).getByText('Falta conductor')).toBeInTheDocument()
    expect(within(delDia).getByText('Bloquea la firma')).toBeInTheDocument()
    expect(within(delDia).getByRole('link', { name: 'Completar asignación del viaje 2034000' }))
      .toHaveAttribute('href', '/viaje/t10')
    expect(within(delDia).queryByRole('combobox')).toBeNull()
    expect(within(delDia).queryByRole('checkbox')).toBeNull()

    const deAntes = screen.getByText('2034001').closest('tr')!
    expect(within(deAntes).getByText('Falta tracto')).toBeInTheDocument()
    expect(within(deAntes).queryByText('Bloquea la firma')).toBeNull()
  })

  it('empresa, conductor y patente del directorio abren la vista rápida; lo del TMS sin cruzar queda en texto', () => {
    const onOpenQuickView = vi.fn()
    renderViajes({
      onOpenQuickView,
      grupos: { ...GRUPOS, hoy: [viaje('t1', '2032999', {
        tractor_plate: 'LRTD11', tractor_asset_id: 'a1', driver_name: 'QUINTANA SOSA', driver_id: null,
        carrier_name: 'Bugarín', carrier_id: 'c1',
      })] },
    })
    const fila = screen.getByText('2032999').closest('tr')!
    fireEvent.click(within(fila).getByRole('button', { name: 'Ver equipo LRTD11' }))
    expect(onOpenQuickView).toHaveBeenCalledWith({ kind: 'asset', id: 'a1', label: 'LRTD11' }, 't1')
    fireEvent.click(within(fila).getByRole('button', { name: 'Ver empresa Bugarín' }))
    expect(onOpenQuickView).toHaveBeenCalledWith({ kind: 'carrier', id: 'c1', label: 'Bugarín' }, 't1')
    expect(within(fila).getByText('QUINTANA SOSA')).toBeInTheDocument()
    expect(within(fila).getByText('no está en el directorio')).toBeInTheDocument()
  })

  it('la fila desde la que se abrió la vista rápida queda marcada', () => {
    renderViajes({ onOpenQuickView: vi.fn(), activeTripId: 't1' })
    expect(screen.getByText('2032999').closest('tr')).toHaveAttribute('aria-current', 'true')
  })
})
