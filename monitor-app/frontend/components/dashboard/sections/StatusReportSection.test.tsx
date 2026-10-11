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
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { fleetDriverGap: vi.fn().mockResolvedValue({ rows: [{ carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 2, gap: 1 }] }) },
}))

const VACIO: OperationTypeReport = {
  summary: { total: 0, assigned: 0, not_working: 0, utilization_pct: 0, by_client: [], by_home_origin: [],
             multi_day: { total: 0, by_days_back: {} } },
  assigned: { rows: [], other_origin: [] },
  worked_without_assignment: { reasons: [], rows: [] },
  second_legs: [],
  not_working: { reasons: [], by_reason: [], detail: [] },
  carriers: [],
}

const TRACTOREO: OperationTypeReport = {
  summary: {
    total: 81, assigned: 29, not_working: 40, utilization_pct: 35.8,
    by_client: [{ client_name: 'Walmart', assigned: 29 }],
    by_home_origin: [{ origin: 'CD Lo Aguirre', enrolled: 50, assigned: 20 }],
    multi_day: { total: 5, by_days_back: { '1': 3, '2': 2 } },
  },
  assigned: {
    rows: [
      { client_name: 'Walmart', origin: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', rm: 3, z0: 1, region: 0, unclassified: 0, total: 4,
        vehicles: [
          { tractor_plate: 'AAAA11', driver_name: 'Ana Soto', zone: 'rm' }, { tractor_plate: 'BBBB22', driver_name: 'Luis Rojas', zone: 'rm' },
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
  second_legs: [{ tractor_plate: 'ABCD12', carrier_name: 'Transportes Sur', driver_name: 'Ana Soto', origin: 'CD Lo Aguirre', destination_zone: 'RM', legs: 2 }],
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
  client_filter: null,
  clients: [
    { shipper_id: 's1', client_name: 'Walmart', assigned: 33, by_operation_type: { tractoreo: 29, equipo_completo: 4 } },
    { shipper_id: 's2', client_name: 'Iansa', assigned: 3, by_operation_type: { tractoreo: 0, equipo_completo: 3 } },
  ],
  fleet_driver_gap: [{ carrier_id: 'c9', business_name: 'Solo Iansa Spa', n_tractos: 2, n_conductores: 1, gap: 1 }],
  by_operation_type: { tractoreo: TRACTOREO, equipo_completo: EQUIPO_COMPLETO },
}

function renderSection(props: Partial<Parameters<typeof StatusReportSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StatusReportSection fecha="2026-08-02" {...props} />
    </QueryClientProvider>,
  )
  // El resumen imprimible duplica textos fuera de pantalla: las aserciones van acá.
  return within(screen.getByTestId('report-body'))
}

/** La tarjeta de una cifra del resumen: los mismos números se repiten en otras tablas. */
const cifra = (body: ReturnType<typeof renderSection>, titulo: string) =>
  body.getByText(titulo, { selector: 'p' }).parentElement!

async function abrir(body: ReturnType<typeof renderSection>, seccion: string) {
  await body.findByText('Equipos activos')
  fireEvent.click(body.getByRole('button', { name: seccion }))
}

beforeEach(() => {
  vi.mocked(statusReportApi.get).mockReset().mockResolvedValue(REPORT)
})

describe('StatusReportSection', () => {
  it('abre en Tractoreo › Resumen con las cuatro cifras', async () => {
    const body = renderSection()
    expect(await body.findByText('Equipos activos')).toBeInTheDocument()
    expect(cifra(body, 'Equipos activos')).toHaveTextContent('81')
    expect(cifra(body, 'Asignados')).toHaveTextContent('29')
    expect(cifra(body, 'No trabajaron')).toHaveTextContent('40')
    expect(cifra(body, 'Utilización')).toHaveTextContent('35.8%')
  })

  it('el resumen muestra los viajes de varios días por días atrás', async () => {
    const body = renderSection()
    expect(await body.findByText('Viajes de varios días (5)')).toBeInTheDocument()
    expect(body.getByText('3 equipos — 1 día')).toBeInTheDocument()
    expect(body.getByText('2 equipos — 2 días')).toBeInTheDocument()
  })

  it('el selector cambia todas las secciones al otro tipo', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
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
    expect(within(cliente).getAllByRole('cell').map(c => c.textContent)).toEqual(['Walmart', '3', '1', '2', '0', '6'])
    const pie = within(body.getAllByRole('table')[0]).getAllByRole('row').at(-1)!
    expect(within(pie).getAllByRole('cell').map(c => c.textContent)).toEqual(['Total', '3', '1', '2', '0', '6'])
  })

  it('lo plegado sigue plegado al cambiar de tipo y volver', async () => {
    const body = renderSection()
    await abrir(body, 'Asignados')
    fireEvent.click(body.getByRole('button', { name: 'Walmart' }))
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    fireEvent.click(body.getByRole('button', { name: 'Tractoreo' }))
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
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
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
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    fireEvent.click(body.getByRole('button', { name: /Equipos Sur/ }))
    expect(body.getByText('EQUI01')).toBeInTheDocument()
  })

  it('las columnas de motivo son las que manda la API, ni una más', async () => {
    const body = renderSection()
    await abrir(body, 'No trabajaron')
    const tabla = body.getAllByRole('table')[0]
    expect(within(tabla).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Origen › Empresa', 'Panne', 'Sin conductor', 'Total'])
  })

  it('Dotación muestra las inconsistencias de dotación', async () => {
    const body = renderSection()
    await abrir(body, 'Dotación')
    expect(await body.findByText('1 empresa con desbalance de dotación')).toBeInTheDocument()
  })

  it('con un backend anterior al rediseño avisa que se está actualizando', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ business_date: '2026-08-02', client_filter: null })
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

  it('la lista de clientes es la del día, con su cantidad, y elegir uno vuelve a pedir el reporte', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    const filtro = body.getByRole('combobox', { name: 'Filtrar por cliente' })
    expect(within(filtro).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Todos los clientes', 'Walmart (29)', 'Iansa (0)'])
    fireEvent.change(filtro, { target: { value: 's2' } })
    // Por id del cliente del directorio (spec 2026-10-11); se ve el nombre.
    expect(statusReportApi.get).toHaveBeenCalledWith('2026-08-02', 's2')
    expect(within(filtro).getAllByRole('option').map(o => o.getAttribute('value'))).toEqual(['', 's1', 's2'])
  })

  it('la cantidad de cada cliente es la del tipo a la vista, la misma de las tarjetas', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: 'Equipo Completo' }))
    expect(within(body.getByRole('combobox', { name: 'Filtrar por cliente' })).getAllByRole('option')
      .map(o => o.textContent)).toEqual(['Todos los clientes', 'Walmart (4)', 'Iansa (3)'])
  })

  it('el cliente elegido se conserva aunque el reporte nuevo no lo traiga, con (0)', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, clients: [{ shipper_id: 's1', client_name: 'Walmart', assigned: 32, by_operation_type: { tractoreo: 28, equipo_completo: 4 } }] })
    fireEvent.change(body.getByRole('combobox', { name: 'Filtrar por cliente' }), { target: { value: 's2' } })
    // La lista nueva (Walmart 28) ya llegó, y el elegido sigue, por nombre, con (0).
    await waitFor(() => expect(within(body.getByRole('combobox', { name: 'Filtrar por cliente' }))
      .getAllByRole('option').map(o => o.textContent)).toEqual(['Todos los clientes', 'Walmart (28)', 'Iansa (0)']))
  })

  it('mientras llega el reporte de otro cliente no muestra las cifras del anterior, pero la lista sigue', async () => {
    const body = renderSection()
    await body.findByText('Equipos activos')
    vi.mocked(statusReportApi.get).mockReturnValue(new Promise(() => {}))
    fireEvent.change(body.getByRole('combobox', { name: 'Filtrar por cliente' }), { target: { value: 's2' } })
    await waitFor(() => expect(body.queryByText('Equipos activos')).toBeNull())
    expect(within(body.getByRole('combobox', { name: 'Filtrar por cliente' })).getAllByRole('option')
      .map(o => o.textContent)).toEqual(['Todos los clientes', 'Walmart (29)', 'Iansa (0)'])
    expect(body.getByRole('button', { name: /Descargar Excel/ })).toBeDisabled()
  })

  it('Dotación muestra el faltante del reporte, con el mismo filtro de cliente', async () => {
    const body = renderSection()
    await abrir(body, 'Dotación')
    expect(await body.findByText('Solo Iansa Spa')).toBeInTheDocument()
    expect(body.queryByText('Transportes Sur')).toBeNull()
  })

  it('Dotación sin desbalance lo dice, en vez de quedar en blanco', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, fleet_driver_gap: [] })
    const body = renderSection()
    await abrir(body, 'Dotación')
    expect(body.getByText('No hay empresas con desbalance de dotación')).toBeInTheDocument()
  })

  it('con un backend que todavía no manda clients, la lista solo ofrece Todos los clientes', async () => {
    vi.mocked(statusReportApi.get).mockResolvedValue({ ...REPORT, clients: undefined })
    const body = renderSection()
    await body.findByText('Equipos activos')
    expect(within(body.getByRole('combobox', { name: 'Filtrar por cliente' })).getAllByRole('option')
      .map(o => o.textContent)).toEqual(['Todos los clientes'])
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

  it('"Descargar Excel" baja los dos tipos aunque se vea uno', async () => {
    const toFile = vi.fn().mockResolvedValue(undefined)
    escribirExcel.mockReset().mockReturnValue({ toFile })
    const body = renderSection()
    await body.findByText('Equipos activos')
    fireEvent.click(body.getByRole('button', { name: /Descargar Excel/ }))
    await waitFor(() => expect(toFile).toHaveBeenCalledWith('reporte_estatus_2026-08-02.xlsx'))
    const hojas = (escribirExcel.mock.calls[0][0] as { sheet: string }[]).map(h => h.sheet)
    expect(hojas).toEqual(expect.arrayContaining(['Asignados · Tractoreo', 'Asignados · Eq. Completo', 'Dotación']))
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
