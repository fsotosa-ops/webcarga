import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PasoViajesSection } from './PasoViajesSection'

// La vista vive en la URL (spec §4.2): una URL en memoria que se vuelve a dibujar.
vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), reset: vi.fn() },
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/trips', async orig => {
  const real = await orig<typeof import('@/lib/api/trips')>()
  return { ...real, tripsApi: { ...real.tripsApi,
    driverCandidates: vi.fn().mockResolvedValue({ candidatos: [], trip_ids_de_la_persona: ['r1'] }) } }
})
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'
import { EMPTY_VIEW, readView, writeView } from '@/lib/table/viewInUrl'

const viaje = (id: string, nroTms: string, extra = {}) => ({
  trip_id: id, planning_date: '2026-10-10', client_name: 'Walmart',
  source_system: 'qanalytics', source_system_trip_id: nroTms, trip_status: 'Asignado',
  tractor_plate: null, driver_name: null, carrier_name: null, origin: null, destinations: [],
  dias_sin_novedad: 0.2, unassigned_reason_id: null, unassigned_reason_label: null, ...extra,
})

// Un Nº de viaje distinto por fila: repetirlo escondía que la etiqueta de cada
// desplegable no distinguía una fila de otra.
// Lo que queda en Viajes para declarar (30/10): ofertas retiradas y abandonados.
// "Del día", "Rezago" y la asignación incompleta pasaron a "Por regularizar".
const GRUPOS = {
  por_regularizar: [],
  oferta_sin_declarar: [
    viaje('t7', '808702', { client_name: 'Sodimac' }),
    viaje('t1', '2032999', { tractor_plate: 'LRTD11' }),
  ],
  abandonado: [
    viaje('t4', '2033002', { planning_date: '2026-09-01', dias_sin_novedad: 31.6 }),
    viaje('t2', '2033000', { planning_date: '2026-10-07', driver_name: 'Juan Uno' }),
  ],
  en_curso: [viaje('t3', '2033001', { planning_date: '2026-10-09', trip_status: 'RETORNANDO' })],
  pendiente_cierre_tms: [
    viaje('t5', '885613', { planning_date: '2026-10-07', tractor_plate: 'PYST91' }),
    viaje('t6', '881496', { planning_date: '2026-10-02', tractor_plate: 'PYST91' }),
  ],
  con_motivo: [viaje('t8', '2033003', { unassigned_reason_label: 'No da por tarifa' })],
}
const SIN_POR_RESOLVER = { ...GRUPOS, oferta_sin_declarar: [], abandonado: [] }
const MOTIVOS = [{ id: 'm1', label: 'No da por tarifa' }]

type Props = ComponentProps<typeof PasoViajesSection>
function renderViajes(props: Partial<Props> = {}) {
  const onCerrar = vi.fn().mockResolvedValue(undefined)
  const onDeshacer = vi.fn().mockResolvedValue(undefined)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (p: Partial<Props>) => (
    <QueryClientProvider client={client}>
      <PasoViajesSection fecha="2026-10-10" alcance="tractoreo" grupos={GRUPOS} bloquean={2} motivos={MOTIVOS}
                         onCerrar={onCerrar} onDeshacer={onDeshacer}
                         tripHref={id => `/viaje/${id}`} {...p} />
    </QueryClientProvider>
  )
  const utils = render(ui(props))
  return { ...utils, onCerrar, onDeshacer, rerender: (p: Partial<Props>) => utils.rerender(ui({ ...props, ...p })) }
}

/** Abre la pantalla con una situación ya elegida en la URL (un enlace, o volver del detalle). */
const conSituacion = (situacion: string) => memoryUrl.reset(`/dashboard/operations/closures?${
  writeView(new URLSearchParams('tab=trips'), { ...EMPTY_VIEW, filters: { situation: [situacion] } })}`)

const recuadro = (nombre: RegExp) => screen.getByRole('button', { name: nombre })
const numerosDeViaje = () => screen.queryAllByTestId('nro-viaje').map(e => e.textContent)
const tabla = () => screen.getByRole('table', { name: 'Viajes del cierre' })

beforeEach(() => memoryUrl.reset('/dashboard/operations/closures?tab=trips'))

describe('PasoViajesSection', () => {
  it('no muestra ninguna cifra mientras carga', () => {
    renderViajes({ grupos: undefined, bloquean: undefined, cargando: true })
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Por resolver/ })).toBeNull()
  })

  it('recuadros Todos, Por resolver, En seguimiento y Resueltos con su cifra, y abre en Por resolver (C9)', async () => {
    renderViajes()
    expect(await screen.findByRole('button', { name: 'Por resolver, 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos, 8' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'En seguimiento, 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resueltos, 1' })).toBeInTheDocument()
    // Y el recuadro es un filtro: se ve como chip, con la palabra de la columna.
    expect(screen.getByRole('button', { name: 'Quitar filtro Situación' })).toBeInTheDocument()
  })

  it('Por resolver junta ofertas retiradas y abandonados, del más antiguo al más nuevo', async () => {
    renderViajes()
    await screen.findByRole('button', { name: 'Por resolver, 4' })
    // A igual fecha (10/10), el Nº de viaje se compara como número: 808702 < 2032999.
    expect(numerosDeViaje()).toEqual(['2033002', '2033000', '808702', '2032999'])
  })

  it('cada fila dice por qué está aquí, y nada de Viajes bloquea la firma (eso es Por regularizar)', async () => {
    renderViajes()
    const abandonado = (await screen.findByText('2033000')).closest('tr')!
    expect(within(abandonado).getByText('Abandonado por el TMS')).toBeInTheDocument()
    const oferta = screen.getByText('808702').closest('tr')!
    expect(within(oferta).getByText('Oferta retirada por el TMS')).toBeInTheDocument()
    expect(screen.queryByText('Bloquea la firma')).toBeNull()
  })

  it('lo de días anteriores dice hace cuántos días', async () => {
    renderViajes()
    expect(within((await screen.findByText('2033002')).closest('tr')!).getByText('hace 39 días')).toBeInTheDocument()
    expect(within(screen.getByText('2032999').closest('tr')!).queryByText(/hace/)).toBeNull()
  })

  it('todo lo de Por resolver se declara, incluidos los abandonados', async () => {
    renderViajes()
    await screen.findByText('2033002')
    expect(within(tabla()).getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getByLabelText('Motivo del viaje 2033002', { selector: 'select' })).toBeInTheDocument()
  })

  it('el motivo se elige en la fila y se guarda con Guardar', async () => {
    const { onCerrar } = renderViajes()
    const fila = (await screen.findByText('2032999')).closest('tr')!
    const guardar = within(fila).getByRole('button', { name: 'Guardar' })
    expect(guardar).toBeDisabled()
    fireEvent.change(within(fila).getByLabelText('Motivo del viaje 2032999', { selector: 'select' }), { target: { value: 'm1' } })
    expect(onCerrar).not.toHaveBeenCalled()
    fireEvent.click(guardar)
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t1'], 'm1'))
  })

  it('en lote: no deja cerrar sin motivo, y con motivo dice a cuántos viajes se aplica', async () => {
    const { onCerrar } = renderViajes()
    await screen.findByText('2033002')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar viaje 2033002' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar viaje 2033000' }))
    expect(screen.getByRole('button', { name: /No asignado por WebCarga/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo', { selector: 'select' }), { target: { value: 'm1' } })
    fireEvent.click(screen.getByRole('button', { name: /2 viajes/ }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['t4', 't2'], 'm1'))
  })

  it('la barra de lote va arriba de la tabla y pegada al techo', async () => {
    renderViajes()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar viaje 2033002' }))
    const barra = screen.getByText('1 seleccionado').closest('div')!
    expect(barra.compareDocumentPosition(tabla()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(barra.className).toContain('sticky top-0')
  })

  it('cambiar de recuadro conserva la selección', async () => {
    renderViajes()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar viaje 2033002' }))
    fireEvent.click(recuadro(/^En seguimiento/))
    expect(await screen.findByText('1 seleccionado')).toBeInTheDocument()
    fireEvent.click(recuadro(/^Por resolver/))
    expect(await screen.findByRole('checkbox', { name: 'Seleccionar viaje 2033002' })).toBeChecked()
  })

  it('En seguimiento no tiene acciones y dice la situación de cada viaje', async () => {
    renderViajes()
    fireEvent.click(await screen.findByRole('button', { name: /^En seguimiento/ }))
    expect(await screen.findByText('En ruta · RETORNANDO')).toBeInTheDocument()
    expect(readView(memoryUrl.params()).filters.situation).toEqual(['En seguimiento'])
    expect(within(tabla()).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(tabla()).queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.getAllByText('Espera cierre del TMS').length).toBeGreaterThan(0)
  })

  it('una patente con dos viajes lleva la marca, con los números en el título', async () => {
    conSituacion('En seguimiento')
    renderViajes()
    const marcas = await screen.findAllByText('2 viajes')
    expect(marcas).toHaveLength(2)
    expect(marcas[0]).toHaveAttribute('title', 'PYST91: 881496, 885613')
  })

  it('Resueltos muestra el motivo y deja deshacer', async () => {
    conSituacion('Resueltos')
    const { onDeshacer } = renderViajes()
    expect(await screen.findByText('No da por tarifa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer el motivo del viaje 2033003' }))
    await waitFor(() => expect(onDeshacer).toHaveBeenCalledWith(['t8']))
  })

  it('con el día firmado no se declara ni se deshace, y los filtros siguen funcionando', async () => {
    renderViajes({ soloLectura: true })
    await screen.findByText('2033002')
    expect(within(tabla()).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(tabla()).queryAllByRole('combobox')).toHaveLength(0)
    fireEvent.click(recuadro(/^Resueltos/))
    expect(await screen.findByText('2033003')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deshacer/ })).toBeNull()
  })

  it('el camino por el que llegó el viaje es la columna filtrable "Por qué está aquí"', async () => {
    renderViajes()
    await screen.findByText('2033002')
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Por qué está aquí' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Oferta retirada, 2' }))
    expect(numerosDeViaje()).toEqual(['808702', '2032999'])
    expect(screen.getByRole('button', { name: 'Quitar filtro Por qué está aquí' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Oferta retirada, 2' }))
    expect(numerosDeViaje()).toHaveLength(4)
  })

  it('una situación vacía lo dice en una línea, sin filas (los encabezados quedan: ahí están los filtros)', async () => {
    conSituacion('Por resolver')
    renderViajes({ grupos: SIN_POR_RESOLVER })
    expect(await screen.findByText(/^Nada por resolver aquí/)).toBeInTheDocument()
    expect(within(tabla()).getAllByRole('row')).toHaveLength(1)
  })

  it('sin situación en la URL y sin nada por resolver, abre En seguimiento', async () => {
    renderViajes({ grupos: SIN_POR_RESOLVER })
    expect(await screen.findByRole('button', { name: /^En seguimiento/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('una situación de la URL que no existe se ve como chip, sin filas, y se puede quitar', async () => {
    conSituacion('xyz')
    renderViajes()
    expect(await screen.findByRole('button', { name: 'Quitar filtro Situación' })).toBeInTheDocument()
    expect(screen.getByText(/4 en Por resolver/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Situación' }))
    expect(await screen.findByRole('button', { name: /^Todos/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('al declarar el último por resolver, la vista no salta sola', async () => {
    const { rerender } = renderViajes()
    await screen.findByRole('button', { name: 'Por resolver, 4' })
    rerender({ bloquean: 0, grupos: SIN_POR_RESOLVER })
    expect(recuadro(/^Por resolver/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^Nada por resolver aquí/)).toBeInTheDocument()
  })

  it('un viaje declarado en su fila sale de la selección del lote', async () => {
    renderViajes()
    const fila = (await screen.findByText('2032999')).closest('tr')!
    fireEvent.click(within(fila).getByRole('checkbox'))
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    fireEvent.change(within(fila).getByLabelText('Motivo del viaje 2032999', { selector: 'select' }), { target: { value: 'm1' } })
    fireEvent.click(within(fila).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.queryByText('1 seleccionado')).toBeNull())
  })

  it('un viaje seleccionado que deja de estar por resolver no cuenta en el lote', async () => {
    const { rerender } = renderViajes()
    fireEvent.click(within((await screen.findByText('2032999')).closest('tr')!).getByRole('checkbox'))
    const declarado = GRUPOS.oferta_sin_declarar[1]
    rerender({ bloquean: 1, grupos: { ...GRUPOS, oferta_sin_declarar: [GRUPOS.oferta_sin_declarar[0]],
      con_motivo: [...GRUPOS.con_motivo, declarado] } })
    expect(screen.queryByText('1 seleccionado')).toBeNull()
  })

  it('el buscador cubre todas las situaciones y cada recuadro dice cuántos coinciden', async () => {
    renderViajes()
    await screen.findByText('2033002')
    fireEvent.change(screen.getByRole('searchbox', { name: /buscar/i }), { target: { value: 'pyst91' } })
    expect(await screen.findByRole('button', { name: 'En seguimiento, 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Por resolver, 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resueltos, 0' })).toBeInTheDocument()
    expect(screen.getByText(/2 en En seguimiento/)).toBeInTheDocument()
  })

  it('cada fila trae patente, conductor, empresa, origen y destinos', async () => {
    renderViajes({ grupos: { ...GRUPOS, oferta_sin_declarar: [viaje('t1', '2032999', {
      tractor_plate: 'LRTD11', driver_name: 'Ana Soto', carrier_name: 'Transportes Sur',
      origin: 'CD Lo Aguirre', destinations: ['Local 1', 'Local 2'],
    })] } })
    await screen.findByText('2032999')
    for (const texto of ['LRTD11', 'Ana Soto', 'Transportes Sur', 'CD Lo Aguirre', 'Local 1 · Local 2']) {
      expect(screen.getByText(texto)).toBeInTheDocument()
    }
  })

  it('si el backend todavía no manda un grupo, la tabla igual se dibuja', async () => {
    const { pendiente_cierre_tms: _, ...sinElNuevo } = GRUPOS
    conSituacion('En seguimiento')
    renderViajes({ grupos: sinElNuevo as typeof GRUPOS })
    expect(await screen.findByText('2033001')).toBeInTheDocument()
  })

  it('empresa, conductor y patente del directorio abren la vista rápida; lo del TMS sin cruzar queda en texto', async () => {
    const onOpenQuickView = vi.fn()
    renderViajes({
      onOpenQuickView,
      grupos: { ...GRUPOS, oferta_sin_declarar: [viaje('t1', '2032999', {
        tractor_plate: 'LRTD11', tractor_asset_id: 'a1', driver_name: 'QUINTANA SOSA', driver_id: null,
        carrier_name: 'Bugarín', carrier_id: 'c1',
      })] },
    })
    const fila = (await screen.findByText('2032999')).closest('tr')!
    fireEvent.click(within(fila).getByRole('link', { name: 'Ver equipo LRTD11' }))
    expect(onOpenQuickView).toHaveBeenCalledWith({ kind: 'asset', id: 'a1', label: 'LRTD11' }, 't1')
    fireEvent.click(within(fila).getByRole('link', { name: 'Ver empresa Bugarín' }))
    expect(onOpenQuickView).toHaveBeenCalledWith({ kind: 'carrier', id: 'c1', label: 'Bugarín' }, 't1')
    expect(within(fila).getByText('QUINTANA SOSA')).toBeInTheDocument()
    expect(within(fila).getByText('no está en el directorio')).toBeInTheDocument()
  })

  it('la fila desde la que se abrió la vista rápida queda marcada', async () => {
    renderViajes({ onOpenQuickView: vi.fn(), activeTripId: 't1' })
    expect((await screen.findByText('2032999')).closest('tr')).toHaveAttribute('aria-current', 'true')
  })

  // ── Alcance (D6, C9) ───────────────────────────────────────────────────────

  it('cada alcance ve sus viajes y los que no tienen tracto, marcados "Sin tracto"', async () => {
    const grupos = { ...GRUPOS, oferta_sin_declarar: [
      viaje('t1', '2032999', { tractor_plate: 'LRTD11', scope: 'tractoreo' }),
      viaje('t20', '2035000', { tractor_plate: 'EQCO11', scope: 'equipo_completo' }),
      viaje('t21', '2035001', { scope: null }),
    ] }
    const { rerender } = renderViajes({ grupos })
    await screen.findByText('2032999')
    expect(screen.queryByText('2035000')).toBeNull()
    expect(within(screen.getByText('2035001').closest('tr')!).getByText('Sin tracto')).toBeInTheDocument()

    rerender({ alcance: 'equipo_completo' })
    expect(await screen.findByText('2035000')).toBeInTheDocument()
    expect(screen.queryByText('2032999')).toBeNull()
    expect(screen.getByText('2035001')).toBeInTheDocument()
  })

  it('un viaje con tracto sin tipo de operación no dice "Sin tracto": dice lo que le falta', async () => {
    renderViajes({ grupos: { ...GRUPOS, oferta_sin_declarar: [
      viaje('t1', '2032999', { tractor_plate: 'ABCD12', tractor_asset_id: 'a1', scope: null }),
      viaje('t21', '2035001', { scope: null }),
    ] } })
    const conTracto = (await screen.findByText('2032999')).closest('tr')!
    expect(within(conTracto).queryByText('Sin tracto')).toBeNull()
    expect(within(conTracto).getByText('Sin tipo de operación')).toBeInTheDocument()
    expect(within(screen.getByText('2035001').closest('tr')!).getByText('Sin tracto')).toBeInTheDocument()
  })

  it('cada viaje dice la zona de su destino, y la zona filtra', async () => {
    renderViajes({ grupos: { ...GRUPOS, oferta_sin_declarar: [viaje('t1', '2032999', { destination_zone: 'RM' })],
      abandonado: [viaje('t2', '2033000', { planning_date: '2026-10-07', destination_zone: 'Región' })] } })
    expect(within((await screen.findByText('2032999')).closest('tr')!).getByText('RM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Zona' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Región, 1' }))
    expect(numerosDeViaje()).toEqual(['2033000'])
  })

  it('"Resolver" no se filtra ni se oculta: es donde se trabaja la fila', async () => {
    renderViajes()
    await screen.findByText('2033002')
    expect(screen.queryByRole('button', { name: 'Filtrar por Resolver' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Columnas' }))
    expect(screen.queryByRole('checkbox', { name: 'Mostrar Resolver' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Mostrar Cliente' })).toBeInTheDocument()
  })
})

// ── La variante "Por regularizar" (30/10) ─────────────────────────────────────

const POR_REGULARIZAR = {
  ...GRUPOS,
  por_regularizar: [
    viaje('r1', '2040001', { client_name: 'Sodimac', is_assigned: true, missing_fleet: ['driver'],
      tractor_plate: 'GGBC24', driver_name: 'PEREZ SOTO JUAN', driver_name_tms: 'PEREZ SOTO JUAN',
      carrier_name: 'Transportes Andina', scope: 'equipo_completo' }),
    viaje('r2', '2040002', { client_name: 'Sodimac', is_assigned: true, missing_fleet: ['tractor', 'driver', 'carrier'],
      carrier_name: 'WebCarga SpA', scope: 'equipo_completo' }),
    viaje('r3', '2040003', { is_assigned: false, missing_fleet: ['tractor', 'driver', 'carrier'], scope: 'equipo_completo' }),
    viaje('r4', '2040004', { is_assigned: true, missing_fleet: [], carrier_mismatch: true, scope: 'tractoreo' }),
  ],
}
const renderPorRegularizar = (props: Partial<Props> = {}) =>
  renderViajes({ variante: 'por_regularizar', alcance: 'equipo_completo', grupos: POR_REGULARIZAR, ...props })
const tablaPorRegularizar = () => screen.getByRole('table', { name: 'Viajes por regularizar' })

describe('PasoViajesSection, variante por regularizar', () => {
  it('muestra solo los por regularizar del alcance, sin los recuadros de Viajes', async () => {
    renderPorRegularizar()
    expect(await screen.findByText('3 viajes por regularizar')).toBeInTheDocument()
    expect(numerosDeViaje()).toEqual(['2040001', '2040002', '2040003'])
    expect(screen.queryByRole('button', { name: /^Por resolver/ })).toBeNull()
    expect(screen.queryByText('bloquean la firma del día')).toBeNull()
  })

  it('"Qué falta" dice la empresa distinta a la del conductor (Tractoreo)', async () => {
    renderPorRegularizar({ alcance: 'tractoreo' })
    expect(within((await screen.findByText('2040004')).closest('tr')!)
      .getByText('Empresa distinta a la del conductor')).toBeInTheDocument()
  })

  it('"Qué falta" dice cada pieza, o "Sin asignar"', async () => {
    renderPorRegularizar()
    const sinTercero = (await screen.findByText('2040002')).closest('tr')!
    for (const p of ['Tracto', 'Conductor', 'Empresa']) expect(within(sinTercero).getByText(p)).toBeInTheDocument()
    expect(within(screen.getByText('2040003').closest('tr')!).getByText('Sin asignar')).toBeInTheDocument()
  })

  it('el conductor que informó el TMS abre el emparejamiento del Monitor', async () => {
    renderPorRegularizar()
    const fila = (await screen.findByText('2040001')).closest('tr')!
    fireEvent.click(within(fila).getByRole('button', { name: 'Asignar conductor' }))
    expect(await screen.findByRole('dialog', { name: 'Asignar conductor a PEREZ SOTO JUAN' })).toBeInTheDocument()
  })

  it('sin nombre del TMS, o con tracto o empresa faltante, se completa en el viaje', async () => {
    renderPorRegularizar()
    const fila = (await screen.findByText('2040002')).closest('tr')!
    expect(within(fila).getByRole('link', { name: 'Completar en el viaje 2040002' })).toHaveAttribute('href', '/viaje/r2')
    expect(within(fila).queryByRole('button', { name: 'Asignar conductor' })).toBeNull()
  })

  it('"No se tomará el viaje" pide el motivo y declara con el escritor de siempre', async () => {
    const { onCerrar } = renderPorRegularizar()
    const fila = (await screen.findByText('2040003')).closest('tr')!
    fireEvent.click(within(fila).getByRole('button', { name: 'No se tomará el viaje 2040003' }))
    const dialogo = await screen.findByRole('dialog', { name: 'No se tomará el viaje' })
    const confirmar = within(dialogo).getByRole('button', { name: 'No se tomará' })
    expect(confirmar).toBeDisabled()
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: 'm1' } })
    fireEvent.click(confirmar)
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['r3'], 'm1'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'No se tomará el viaje' })).toBeNull())
  })

  it('en lote: todos se pueden seleccionar y declarar juntos', async () => {
    const { onCerrar } = renderPorRegularizar()
    await screen.findByText('2040001')
    expect(within(tablaPorRegularizar()).getAllByRole('checkbox')).toHaveLength(3)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar viaje 2040002' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar viaje 2040003' }))
    fireEvent.click(screen.getByRole('button', { name: 'No se tomará el viaje' }))
    const dialogo = await screen.findByRole('dialog', { name: 'No se tomará el viaje' })
    expect(within(dialogo).getByText(/Los 2 viajes salen de Por regularizar/)).toBeInTheDocument()
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: 'm1' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'No se tomará' }))
    await waitFor(() => expect(onCerrar).toHaveBeenCalledWith(['r2', 'r3'], 'm1'))
  })

  it('con el día firmado no se asigna ni se declara', async () => {
    renderPorRegularizar({ soloLectura: true })
    await screen.findByText('2040001')
    expect(screen.queryByRole('button', { name: 'Asignar conductor' })).toBeNull()
    expect(screen.queryByRole('button', { name: /No se tomará/ })).toBeNull()
    expect(within(tablaPorRegularizar()).queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('no escribe su vista en la URL: la URL es de la tabla de la flota', async () => {
    renderPorRegularizar()
    await screen.findByText('2040001')
    const antes = memoryUrl.params().toString()
    fireEvent.change(screen.getByRole('searchbox', { name: /buscar/i }), { target: { value: 'gGBC24' } })
    await waitFor(() => expect(numerosDeViaje()).toEqual(['2040001']))
    expect(memoryUrl.params().toString()).toBe(antes)
  })
})
