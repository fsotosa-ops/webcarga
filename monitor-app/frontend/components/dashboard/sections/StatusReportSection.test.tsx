import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusReportSection } from './StatusReportSection'
import { statusReportApi } from '@/lib/api/statusReport'
import type { OperationTypeReport, StatusReport } from '@/lib/types'

const escribirExcel = vi.hoisted(() => vi.fn())
vi.mock('write-excel-file/browser', () => ({ default: escribirExcel }))

vi.mock('@/lib/api/statusReport', () => ({
  statusReportApi: { get: vi.fn() },
}))
// La vista (Cliente, filtros) vive en la URL (spec §4.2): una URL en memoria.
vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), reset: vi.fn() },
}))
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'
import { readView } from '@/lib/table/viewInUrl'
import type { ReportSection } from '@/lib/reporte/secciones'

const VACIO: OperationTypeReport = {
  summary: { total: 0, assigned: 0, assigned_today: 0, not_working: 0, utilization_pct: 0, by_client: [], by_home_origin: [],
             multi_day: { total: 0, by_days_back: {} } },
  assigned: { rows: [], other_origin: [] },
  worked_without_assignment: { reasons: [], rows: [] },
  second_legs: [],
  not_working: { reasons: [], by_reason: [], detail: [] },
  carriers: [],
}

const TRACTOREO: OperationTypeReport = {
  summary: {
    total: 81, assigned: 29, assigned_today: 24, not_working: 40, utilization_pct: 35.8,
    by_client: [{ client_name: 'Walmart', assigned: 29 }],
    by_home_origin: [{ origin: 'CD Lo Aguirre', enrolled: 50, assigned: 20 }],
    multi_day: { total: 5, by_days_back: { '1': 3, '2': 2 } },
  },
  assigned: {
    rows: [
      { client_name: 'Walmart', origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', rm: 3, z0: 1, region: 0, unclassified: 0, total: 4,
        vehicles: [
          { tractor_plate: 'AAAA11', driver_name: 'Ana Soto', zone: 'rm', trips: [{ id: 't1', code: '2033000' }] }, { tractor_plate: 'BBBB22', driver_name: 'Luis Rojas', zone: 'rm' },
          { tractor_plate: 'CCCC33', driver_name: 'Pía Díaz', zone: 'rm' }, { tractor_plate: 'DDDD44', driver_name: null, zone: 'z0' },
        ] },
      { client_name: 'Walmart', origin: 'CD Quilicura', carrier_name: 'Norte Spa', rm: 0, z0: 0, region: 2, unclassified: 0, total: 2,
        vehicles: [{ tractor_plate: 'EEEE55', driver_name: 'Eva Ríos', zone: 'region' }, { tractor_plate: 'FFFF66', driver_name: 'Juan Pérez', zone: 'region' }] },
    ],
    other_origin: [{ tractor_plate: 'ZZZZ99', carrier_name: 'Transportes Sur', home_origin: 'CD El Peñón', origin: 'CD Quilicura', client_name: 'Walmart' }],
  },
  worked_without_assignment: {
    reasons: ['Se retira sin carga'],
    rows: [{ origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', counts: { 'Se retira sin carga': 2 }, total: 2 }],
  },
  second_legs: [
    { tractor_plate: 'ABCD12', carrier_name: 'Transportes Sur', driver_name: 'Ana Soto', origin: 'CD Lo Aguirre', destination_zone: 'RM', legs: 2,
      trips: [{ id: 't7', code: '2033100' }, { id: 't8', code: '2033101' }] },
    { tractor_plate: 'WXYZ98', carrier_name: 'Norte Spa', driver_name: 'Eva Ríos', origin: 'CD Quilicura', destination_zone: 'Región', legs: 3 },
  ],
  not_working: {
    reasons: ['Panne', 'Sin conductor'],
    by_reason: [
      { origin: 'CD El Peñón', carrier_name: 'Otra Spa', counts: { Panne: 2 }, total: 2 },
      { origin: 'Sin origen', carrier_name: 'Faltante Spa', counts: { Panne: 1, 'Sin conductor': 2 }, total: 3 },
    ],
    detail: [
      { name: 'Juan Pérez', carrier_name: 'Otra Spa', home_origin: 'CD El Peñón', reason: 'Panne', tractor_plate: 'ABCD12' },
      { name: 'Rosa Vera', carrier_name: 'Otra Spa', home_origin: 'CD El Peñón', reason: 'Panne', tractor_plate: null },
      { name: 'Hugo Lara', carrier_name: 'Faltante Spa', home_origin: null, reason: 'Panne', tractor_plate: 'XYZW12' },
    ],
  },
  carriers: [{ carrier_name: 'Transportes Sur', enrolled: 5, assigned: 2, unassigned: 3, utilization_pct: 40.0 }],
}

const EQUIPO_COMPLETO: OperationTypeReport = {
  ...VACIO,
  summary: { ...VACIO.summary, total: 10, assigned: 3, not_working: 7, utilization_pct: 30.0 },
  not_working: {
    reasons: ['Panne'],
    by_reason: [{ origin: 'CD Lo Aguirre', carrier_name: 'Equipos Sur', counts: { Panne: 1 }, total: 1 }],
    detail: [{ name: 'EQUI01', carrier_name: 'Equipos Sur', home_origin: 'CD Lo Aguirre', reason: 'Panne', tractor_plate: 'EQUI01' }],
  },
  carriers: [{ carrier_name: 'Equipos Sur', enrolled: 10, assigned: 3, unassigned: 7, utilization_pct: 30.0 }],
}

const REPORT: StatusReport = {
  business_date: '2026-08-02',
  client_filter: [],
  clients: [
    { shipper_id: 's1', client_name: 'Walmart', assigned: 33, by_operation_type: { tractoreo: 29, equipo_completo: 4 } },
    { shipper_id: 's2', client_name: 'Iansa', assigned: 3, by_operation_type: { tractoreo: 0, equipo_completo: 3 } },
  ],
  fleet_driver_gap: [{ carrier_id: 'c9', business_name: 'Solo Iansa Spa', n_tractos: 2, n_conductores: 1, gap: 1 }],
  by_operation_type: { tractoreo: TRACTOREO, equipo_completo: EQUIPO_COMPLETO },
}

type Props = Parameters<typeof StatusReportSection>[0]
let rerenderSection: (p: Partial<Props>) => void = () => {}

/** La sección del Reporte la elige la página (va en la URL); aquí, un estado. */
function renderSection(props: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let actual: Partial<Props> = props
  let seccion: ReportSection = props.section ?? 'summary'
  const ui = () => (
    <QueryClientProvider client={client}>
      <StatusReportSection fecha="2026-08-02" alcance="tractoreo" tripHref={id => `/viaje/${id}`}
        onSectionChange={s => { seccion = s; utils.rerender(ui()) }} {...actual} section={seccion} />
    </QueryClientProvider>
  )
  const utils = render(ui())
  rerenderSection = p => { actual = { ...actual, ...p }; utils.rerender(ui()) }
  // El resumen imprimible duplica textos fuera de pantalla: las aserciones van acá.
  return within(screen.getByTestId('report-body'))
}
const cambiarAlcance = (alcance: Props['alcance']) => rerenderSection({ alcance })

/** Elige un cliente como en cualquier tabla del Cierre: "+ Filtro" › Cliente. */
function elegirCliente(body: ReturnType<typeof renderSection>, nombre: RegExp) {
  fireEvent.click(body.getByRole('button', { name: 'Agregar filtro' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cliente' }))
  fireEvent.click(screen.getByRole('checkbox', { name: nombre }))
}
const opcionesDeCliente = (body: ReturnType<typeof renderSection>) => {
  fireEvent.click(body.getByRole('button', { name: 'Agregar filtro' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Cliente' }))
  const nombres = within(screen.getByRole('dialog', { name: 'Filtrar por Cliente' })).queryAllByRole('checkbox').map(c => c.getAttribute('aria-label'))
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Filtrar por Cliente' }), { key: 'Escape' })
  return nombres
}

/** La tarjeta de una cifra del resumen: los mismos números se repiten en otras tablas. */
const cifra = (body: ReturnType<typeof renderSection>, titulo: string) =>
  body.getByText(titulo, { selector: 'p' }).parentElement!

async function abrir(body: ReturnType<typeof renderSection>, seccion: string) {
  await body.findByText('Equipos activos')
  fireEvent.click(body.getByRole('button', { name: seccion }))
}

beforeEach(() => {
  memoryUrl.reset('/dashboard/operations/closures?date=2026-08-02&tab=report')
  vi.mocked(statusReportApi.get).mockReset().mockResolvedValue(REPORT)
})

describe('StatusReportSection', () => {
  it('abre en Tractoreo › Resumen con sus cifras: los asignados del día aparte de los en ruta', async () => {
    const body = renderSection()
    expect(await body.findByText('Equipos activos')).toBeInTheDocument()
    expect(cifra(body, 'Equipos activos')).toHaveTextContent('81')
    expect(cifra(body, 'Asignados del día')).toHaveTextContent('24')
    expect(cifra(body, 'En ruta desde días anteriores')).toHaveTextContent('5')
    expect(cifra(body, 'No trabajaron')).toHaveTextContent('40')
    expect(cifra(body, 'Utilización')).toHaveTextContent('35.8%')
  })

  it('el resumen muestra los en ruta desde días anteriores por días atrás', async () => {
    const body = renderSection()
    expect(await body.findByText('En ruta desde días anteriores (5)')).toBeInTheDocument()
    expect(body.getByText('3 equipos — 1 día')).toBeInTheDocument()
    expect(body.getByText('2 equipos — 2 días')).toBeInTheDocument()
  })

  it('el alcance del Cierre manda en todas las secciones: el Reporte ya no tiene selector propio (D1)', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(body.queryByRole('button', { name: 'Equipo Completo' })).toBeNull()
    cambiarAlcance('equipo_completo')
    expect(cifra(body, 'Equipos activos')).toHaveTextContent('10')
    fireEvent.click(body.getByRole('button', { name: 'Empresas' }))
    expect(body.getByText('Equipos Sur')).toBeInTheDocument()
    expect(body.queryByText('Transportes Sur')).not.toBeInTheDocument()
  })

  it('Asignados abre los clientes y deja cerrados los orígenes', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    expect(body.getByRole('button', { name: 'Walmart' })).toHaveAttribute('aria-expanded', 'true')
    expect(body.getByRole('button', { name: 'CD Lo Aguirre' })).toHaveAttribute('aria-expanded', 'false')
    expect(body.queryByText('Norte Spa')).not.toBeInTheDocument()
  })

  it('abrir un origen muestra sus empresas, y cerrar el cliente esconde todo lo de adentro', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    fireEvent.click(body.getByRole('button', { name: 'CD Quilicura' }))
    expect(body.getByText('Norte Spa')).toBeInTheDocument()
    fireEvent.click(body.getByRole('button', { name: 'Walmart' }))
    expect(body.queryByRole('button', { name: 'CD Quilicura' })).not.toBeInTheDocument()
    expect(body.queryByText('Norte Spa')).not.toBeInTheDocument()
  })

  it('cada cliente muestra su subtotal y el pie el total, en el orden del CSV', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    const cliente = body.getByRole('button', { name: 'Walmart' }).closest('tr')!
    expect(within(cliente).getAllByRole('cell').map(c => c.textContent)).toEqual(['Walmart', '', '3', '1', '2', '0', '6'])
    const pie = within(body.getAllByRole('table')[0]).getAllByRole('row').at(-1)!
    expect(within(pie).getAllByRole('cell').map(c => c.textContent)).toEqual(['Total', '', '3', '1', '2', '0', '6'])
  })

  it('lo plegado sigue plegado al cambiar de tipo y volver', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    fireEvent.click(body.getByRole('button', { name: 'Walmart' }))
    cambiarAlcance('equipo_completo')
    cambiarAlcance('tractoreo')
    expect(body.getByRole('button', { name: 'Walmart' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('debajo del árbol van los que trabajaron sin asignación, con solo sus motivos, y los que cargaron en otro origen', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    expect(body.getByText('Trabajaron sin asignación')).toBeInTheDocument()
    expect(body.getByRole('columnheader', { name: 'Se retira sin carga' })).toBeInTheDocument()
    expect(body.getByText(/Cargaron en otro origen \(1\)/)).toBeInTheDocument()
    expect(body.getByText('ZZZZ99')).toBeInTheDocument()
  })

  it('un tipo sin asignados lo dice, en vez de dibujar una tabla vacía', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    cambiarAlcance('equipo_completo')
    fireEvent.click(body.getByRole('button', { name: 'Asignados' }))
    // Sin "Hoy": el cierre casi siempre se mira para el día anterior.
    expect(body.getByText('No hubo equipos de Equipo Completo asignados')).toBeInTheDocument()
    expect(body.queryByRole('table')).not.toBeInTheDocument()
  })

  it('Segundas vueltas muestra la patente y su conductor', async () => {
    const body = renderSection()
    await abrir(body, 'Segundas vueltas')
    const fila = body.getByText('ABCD12').closest('tr')!
    expect(within(fila).getByText('Ana Soto')).toBeInTheDocument()
    expect(within(fila).getByText('2')).toBeInTheDocument()
  })

  it('Segundas vueltas es una tabla del kit con sus Nº de viaje, cada uno con su enlace, y filtra (C9, C14)', async () => {
    const body = renderSection()
    await abrir(body, 'Segundas vueltas')
    const fila = body.getByText('ABCD12').closest('tr')!
    expect(within(fila).getByRole('link', { name: 'Ver viaje 2033100' })).toHaveAttribute('href', '/viaje/t7')
    expect(within(fila).getByRole('link', { name: 'Ver viaje 2033101' })).toBeInTheDocument()
    fireEvent.click(body.getByRole('button', { name: 'Filtrar por Nº viaje' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '2033101, 1' }))
    expect(body.queryByText('WXYZ98')).toBeNull()
    expect(body.getByRole('button', { name: 'Quitar filtro Nº viaje' })).toBeInTheDocument()
  })

  it('Asignados abre una empresa en sus conductores, con la patente', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    fireEvent.click(body.getByRole('button', { name: 'CD Lo Aguirre' }))
    const empresa = body.getByRole('button', { name: 'Transportes Sur' })
    expect(empresa).toHaveAttribute('aria-expanded', 'false')
    expect(body.queryByText('Ana Soto · AAAA11')).not.toBeInTheDocument()
    fireEvent.click(empresa)
    expect(body.getByText('Ana Soto · AAAA11')).toBeInTheDocument()
    expect(body.getByText('Sin conductor · DDDD44')).toBeInTheDocument()
    // Cada conductor con su Nº de viaje (C14).
    const ana = body.getByText('Ana Soto · AAAA11').closest('tr')!
    expect(within(ana).getByRole('link', { name: 'Ver viaje 2033000' })).toHaveAttribute('href', '/viaje/t1')
  })

  it('No trabajaron es una sola tabla por motivo: cada fila se abre en sus conductores', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    expect(body.getAllByRole('table')).toHaveLength(1)
    expect(body.queryByText('Juan Pérez')).not.toBeInTheDocument()
    fireEvent.click(body.getByRole('button', { name: /Otra Spa/ }))
    const juan = body.getByText('Juan Pérez · ABCD12').closest('tr')!
    // Su 1 va bajo su motivo; el total de la fila de la empresa no cambia.
    expect(within(juan).getAllByRole('cell').map(c => c.textContent)).toEqual(['Juan Pérez · ABCD12', '1', '', '1'])
    expect(body.getByText('Rosa Vera · sin tracto reciente')).toBeInTheDocument()
  })

  it('el faltante de dotación aparece como su propia línea bajo "Sin conductor"', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    fireEvent.click(body.getByRole('button', { name: /Faltante Spa/ }))
    const faltante = body.getByText('Faltante de dotación').closest('tr')!
    expect(within(faltante).getAllByRole('cell').map(c => c.textContent)).toEqual(['Faltante de dotación', '', '2', '2'])
  })

  it('en Equipo Completo la fila se abre en los equipos', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    cambiarAlcance('equipo_completo')
    fireEvent.click(body.getByRole('button', { name: /Equipos Sur/ }))
    expect(body.getByText('EQUI01')).toBeInTheDocument()
  })

  it('las columnas de motivo son las que manda la API, ni una más', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    const tabla = body.getAllByRole('table')[0]
    expect(within(tabla).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Origen › Empresa', 'Panne', 'Sin conductor', 'Total'])
  })

  it('Dotación es una tabla del kit, con la diferencia dicha como en Pendientes', async () => {
    const body = renderSection()
    await abrir(body, 'Dotación')
    const fila = (await body.findByText('Solo Iansa Spa')).closest('tr')!
    expect(within(fila).getByText('Falta 1 conductor')).toBeInTheDocument()
  })

  it('con un backend anterior al rediseño avisa que se está actualizando', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ business_date: '2026-08-02', client_filter: [] })
    const body = renderSection()
    expect(await body.findByText('Actualizando el reporte…')).toBeInTheDocument()
  })

  it('si falla la carga ofrece reintentar, y reintentar vuelve a pedir', async () => {
    vi.mocked(statusReportApi.get).mockRejectedValueOnce(new Error('500'))
    const body = renderSection()
    fireEvent.click(await body.findByRole('button', { name: 'Reintentar' }))
    expect(await body.findByText('Equipos activos')).toBeInTheDocument()
    expect(statusReportApi.get).toHaveBeenCalledTimes(2)
  })

  it('Cliente es un filtro como los demás: sus valores son los del día con su cifra, y elegir uno vuelve a pedir (C9)', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(opcionesDeCliente(body)).toEqual(['Walmart, 29', 'Iansa, 0'])
    elegirCliente(body, /^Iansa/)
    // Por id del cliente del directorio (spec 2026-10-11); se ve el nombre, como chip.
    await waitFor(() => expect(statusReportApi.get).toHaveBeenLastCalledWith('2026-08-02', ['s2']))
    expect(body.getByText('Cliente: Iansa')).toBeInTheDocument()
    expect(readView(memoryUrl.params()).filters.client).toEqual(['s2'])
  })

  it('la cifra de cada cliente es la del alcance a la vista, la misma de las tarjetas', async () => {
    const body = renderSection({ alcance: 'equipo_completo' })
    await body.findByText('Equipos activos')
    expect(opcionesDeCliente(body)).toEqual(['Walmart, 4', 'Iansa, 3'])
  })

  it('el cliente elegido se conserva aunque el reporte nuevo no lo traiga, con 0', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, clients: [{ shipper_id: 's1', client_name: 'Walmart', assigned: 32, by_operation_type: { tractoreo: 28, equipo_completo: 4 } }] })
    elegirCliente(body, /^Iansa/)
    // Primero que llegue el reporte nuevo; abrir el filtro dentro de un waitFor lo
    // reabriría con cada cambio del DOM.
    await waitFor(() => expect(statusReportApi.get).toHaveBeenLastCalledWith('2026-08-02', ['s2']))
    await body.findByText('Equipos activos')
    expect(opcionesDeCliente(body)).toEqual(['Walmart, 28', 'Iansa, 0'])
    expect(body.getByText('Cliente: Iansa')).toBeInTheDocument()
  })

  it('mientras llega el reporte de otro cliente no muestra las cifras del anterior, pero el filtro sigue', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    vi.mocked(statusReportApi.get).mockReturnValue(new Promise(() => {}))
    elegirCliente(body, /^Iansa/)
    await waitFor(() => expect(body.queryByText('Equipos activos')).toBeNull())
    expect(opcionesDeCliente(body)).toEqual(['Walmart, 29', 'Iansa, 0'])
    expect(body.getByRole('button', { name: /Descargar Excel/ })).toBeDisabled()
  })

  it('Dotación muestra el faltante del reporte', async () => {
    const body = renderSection()
    await abrir(body, 'Dotación')
    expect(await body.findByText('Solo Iansa Spa')).toBeInTheDocument()
    expect(body.queryByText('Transportes Sur')).toBeNull()
  })

  it('con un cliente elegido, No trabajaron y Dotación dicen que eso no es de ningún cliente', async () => {
    // El cliente es un dato del viaje (decisión del usuario 11/10): lo que no
    // tuvo viaje se ve solo con "Todos los clientes".
    const body = renderSection()
    await body.findByText('Equipos activos')
    elegirCliente(body, /^Walmart/)
    await body.findByText('Equipos activos')
    const aviso = 'Lo que no tuvo viaje no es de ningún cliente. Quita el filtro de Cliente para verlo.'
    fireEvent.click(body.getByRole('button', { name: 'No trabajaron' }))
    expect(await body.findByText(aviso)).toBeInTheDocument()
    fireEvent.click(body.getByRole('button', { name: 'Dotación' }))
    expect(body.getByText(aviso)).toBeInTheDocument()
    expect(body.queryByText('Solo Iansa Spa')).toBeNull()
  })

  it('Dotación sin desbalance lo dice, en vez de quedar en blanco', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, fleet_driver_gap: [] })
    const body = renderSection()
    await abrir(body, 'Dotación')
    expect(body.getByText('No hay empresas con desbalance de dotación')).toBeInTheDocument()
  })

  it('con un backend que todavía no manda clients, el filtro de Cliente no ofrece nada', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, clients: undefined })
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(opcionesDeCliente(body)).toEqual([])
  })

  it('el link "Ver histórico" apunta a /dashboard/operations/closures/history', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(body.getByRole('link', { name: /Ver histórico/ })).toHaveAttribute('href', '/dashboard/operations/closures/history')
  })

  it('"Descargar PDF" llama a window.print', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: /Descargar PDF/ }))
    expect(printSpy).toHaveBeenCalled()
    printSpy.mockRestore()
  })

  it('el resumen imprimible muestra los dos tipos lado a lado', async () => {
    renderSection()
    const impreso = await screen.findByTestId('resumen-imprimible')
    expect(within(impreso).getByText('Tractoreo')).toBeInTheDocument()
    expect(within(impreso).getByText('Equipo Completo')).toBeInTheDocument()
  })

  it('"Descargar Excel" ofrece lo que estás viendo (marcado, con su recorte) y todo el día (C13)', async () => {
    const toFile = vi.fn().mockResolvedValue(undefined)
    escribirExcel.mockReset().mockReturnValue({ toFile })
    const body = renderSection()
    await abrir(body, 'Segundas vueltas')
    fireEvent.click(body.getByRole('button', { name: 'Filtrar por Empresa' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Norte Spa, 1' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Filtrar por Empresa' }), { key: 'Escape' })

    fireEvent.click(body.getByRole('button', { name: /Descargar Excel/ }))
    const viendo = screen.getByRole('radio', { name: /Lo que estás viendo/ })
    expect(viendo).toBeChecked()
    expect(viendo.closest('label')).toHaveTextContent('Tractoreo · Segundas vueltas · Empresa: Norte Spa · 1 fila')
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(toFile).toHaveBeenCalled())
    const [hoja] = escribirExcel.mock.calls[0][0] as { sheet: string; data: unknown[][] }[]
    const valor = (v: unknown) => (typeof v === 'object' && v !== null ? (v as { value: unknown }).value : v)
    expect(hoja.data[0]).toEqual(['Recorte: Tractoreo · Segundas vueltas · Empresa: Norte Spa · 1 fila'])
    // Las columnas de la tabla en pantalla, en su orden, y solo sus filas.
    expect(hoja.data[2].map(valor)).toEqual(['Patente', 'Empresa', 'Conductor', 'Nº viaje', 'Origen del viaje', 'Tipo de destino', 'Vueltas'])
    expect(hoja.data.slice(3).map(f => valor(f[0]))).toEqual(['WXYZ98'])

    fireEvent.click(body.getByRole('button', { name: /Descargar Excel/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Todo el día/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(toFile).toHaveBeenLastCalledWith('reporte_estatus_2026-08-02.xlsx'))
    const hojas = (escribirExcel.mock.calls[1][0] as { sheet: string }[]).map(h => h.sheet)
    expect(hojas).toEqual(expect.arrayContaining(['Asignados · Tractoreo', 'Asignados · Eq. Completo', 'Dotación']))
  })

  it('"Todo el día" baja el día completo aunque haya un cliente elegido', async () => {
    const toFile = vi.fn().mockResolvedValue(undefined)
    escribirExcel.mockReset().mockReturnValue({ toFile })
    const body = renderSection()
    await body.findByText('Equipos activos')
    elegirCliente(body, /^Walmart/)
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: /Descargar Excel/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Todo el día/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(toFile).toHaveBeenCalled())
    expect(statusReportApi.get).toHaveBeenCalledWith('2026-08-02', [])
  })

  it('"Copiar estatus" copia la sección y el tipo a la vista, sin lo plegado', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { write } })
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    const body = renderSection()
    await abrir(body, 'Asignados')

    fireEvent.click(body.getByRole('button', { name: /Copiar estatus/ }))

    await waitFor(() => expect(write).toHaveBeenCalled())
    const item = write.mock.calls[0][0][0] as { items: Record<string, Blob> }
    const texto = await item.items['text/plain'].text()
    expect(texto).toContain('Estatus del día 02/08 · Tractoreo · Asignados')
    expect(texto).toContain('CD Quilicura')
    expect(texto).not.toContain('Norte Spa')
    // En el correo no van controles: ni botones del árbol ni el ícono.
    const html = await item.items['text/html'].text()
    expect(html).toContain('Walmart')
    expect(html).not.toMatch(/<button|<svg/)
    expect(await body.findByText(/copiado/i)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
