import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FlotaDelDiaSection } from './FlotaDelDiaSection'
import type { DailyClosureStatus, EquipmentClosureStatus, EquipmentDayStatusRow } from '@/lib/types'
import {
  DRIVERS_STATUS, EQUIPMENT_STATUS, LINE, REASONS, driverRow, equipmentRow,
} from '@/lib/cierre/dayFleet.fixtures'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

vi.mock('@/lib/api/equipmentClosures', () => ({
  equipmentClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn() },
}))

// La vista vive en la URL (spec §4.2): una URL en memoria que se vuelve a dibujar.
vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), reset: vi.fn() },
}))
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'

// La forma real de locationsApi.list (LocationListResponse en lib/api/locations.ts),
// copiada y no inferida del nombre.
const CATALOGO_DE_CDS = ['CD EL PEÑON', 'CD LO AGUIRRE', 'CD QUILICURA']
function respuestaDeCds(nombres = CATALOGO_DE_CDS) {
  return {
    data: nombres.map((name, i) => ({ id: `cd-${i}`, name })) as never,
    count: nombres.length, page: 1, limit: 200,
  }
}

type SectionProps = Parameters<typeof FlotaDelDiaSection>[0]
function renderSection(props: Partial<SectionProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (p: Partial<SectionProps>) => (
    <QueryClientProvider client={client}>
      <FlotaDelDiaSection
        fecha="2026-08-04" alcance="tractoreo" unassignedReasons={REASONS}
        onSelectTrip={vi.fn()} onCreateManualTrip={vi.fn()}
        {...p}
      />
    </QueryClientProvider>
  )
  const utils = render(ui(props))
  // El alcance lo elige la página (D1): cambiarlo es volver a dibujar con otra prop.
  return { ...utils, setAlcance: (alcance: SectionProps['alcance']) => utils.rerender(ui({ ...props, alcance })) }
}

beforeEach(async () => {
  memoryUrl.reset('/dashboard/operations/closures?date=2026-08-04')
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  const { locationsApi } = await import('@/lib/api/locations')
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue(respuestaDeCds())
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(DRIVERS_STATUS)
  vi.mocked(dailyClosuresApi.setReason).mockReset()
  vi.mocked(dailyClosuresApi.setReasonBatch).mockReset().mockResolvedValue([])
  vi.mocked(equipmentClosuresApi.get).mockReset().mockResolvedValue(EQUIPMENT_STATUS)
  vi.mocked(equipmentClosuresApi.setReason).mockReset()
  vi.mocked(equipmentClosuresApi.setReasonBatch).mockReset().mockResolvedValue([])
})

/** Sin tractos de Tractoreo: los tests que miden la mecánica de la tabla
 *  (paginar, ordenar, filtrar, contar) sobre el roster de conductores. Desde la
 *  fusión (HU-D1) la vista también trae los tractos, y sus filas cambiarían
 *  las cuentas sin que el test mida nada nuevo. */
async function soloConductores() {
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
    ...EQUIPMENT_STATUS,
    tractoreo: { ...EQUIPMENT_STATUS.tractoreo, equipment: [], pending_count: 0 },
  })
}

describe('FlotaDelDiaSection', () => {
  // Reunión con WebCarga, 16/10: la vista de cada persona se baja o se copia para mandarla al CD.
  it('la barra copia lo que se ve, con el día, el alcance y el filtro del recuadro', async () => {
    await soloConductores()
    const write = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { write } })
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
    renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^No asignados/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    await waitFor(() => expect(write).toHaveBeenCalled())
    const texto = await (write.mock.calls[0][0][0] as { items: Record<string, Blob> }).items['text/plain'].text()
    expect(texto.split('\n')[0]).toMatch(/^Flota del día 04\/08 · Tractoreo · Estado: /)
    expect(texto).toContain('Ana Soto')
    expect(texto).not.toContain('Juan Pérez')
  })

  it('la columna 2 siempre se llama "Conductor" y la 4 "Patente", en los dos ejes', async () => {
    // Desde la fusión (HU-D1, 06/10) la unidad de la fila es la patente en las
    // dos vistas; un conductor sin tracto dice que no lo tiene.
    const { setAlcance } = renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.getByRole('columnheader', { name: /^Conductor/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^Patente/ })).toBeInTheDocument()

    setAlcance('equipo_completo')

    expect(await screen.findByRole('columnheader', { name: /^Conductor/ })).toBeInTheDocument()
    // En el eje tractos la unidad de la fila ES la patente, no un "equipo
    // habitual" del conductor: el encabezado dice lo que la columna contiene.
    expect(screen.getByRole('columnheader', { name: /^Patente/ })).toBeInTheDocument()
  })

  it('por defecto muestra Conductores con el roster completo', async () => {
    // Cambio del 14/09: antes abria recortado por "no asignados sin motivo +
    // mismatch", una categoria que ningun tile marcaba.
    renderSection()
    expect(await screen.findByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
  })

  it('"No asignados" es todo lo que no está asignado; "Sin motivo" recorta a los que nadie miró (estándar: estado + motivo)', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /^No asignados/ }))
    expect(screen.getByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Sin motivo/ }))
    expect(screen.getByText('Ana Soto')).toBeInTheDocument()
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()
    // Los atajos se reemplazan: el chip es el del tipo de motivo, no los dos.
    expect(screen.queryByRole('button', { name: 'Quitar filtro Estado' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Quitar filtro Tipo de motivo' })).toBeInTheDocument()
  })

  it('Estado, Tipo de motivo y Zona son columnas propias que filtran', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ ...LINE.assigned, driver_id: 'd1', full_name: 'Ana Soto', destination_zone: 'RM' }),
        driverRow({ ...LINE.notWorking, driver_id: 'd4', full_name: 'Carla Díaz' }),
      ],
    })
    await soloConductores()
    renderSection()
    const ana = (await screen.findByText('Ana Soto')).closest('tr')!
    expect(within(ana).getByText('Asignado')).toBeInTheDocument()
    expect(within(ana).getByText('RM')).toBeInTheDocument()
    const carla = screen.getByText('Carla Díaz').closest('tr')!
    expect(within(carla).getByText('No asignado')).toBeInTheDocument()
    expect(within(carla).getByText('No trabajó')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Zona' }))
    expect(screen.getByRole('checkbox', { name: 'RM, 1' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Región, 0' })).toBeInTheDocument()
  })

  it('la columna Estado del viaje dice lo que informa el TMS para el viaje de hoy', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ ...LINE.assigned, driver_id: 'd1', full_name: 'Ana Soto', today_trip_status: 'RUTA' })],
    })
    await soloConductores()
    renderSection()
    expect(within((await screen.findByText('Ana Soto')).closest('tr')!).getByText('RUTA')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Estado del viaje/ })).toBeInTheDocument()
  })

  it('un conductor sin tracto habitual lo dice, con el chip de su tipo de operación', async () => {
    // Antes la columna mostraba el tracto de su ÚLTIMO viaje de cualquier fecha
    // (`last_known_tractor_plate`) bajo el título "Tracto habitual": no era el
    // habitual, y podía contradecir la fila del tracto en la misma tabla.
    renderSection()
    const row = (await screen.findByText('Ana Soto')).closest('tr')!
    expect(within(row).getByText('Sin tracto habitual')).toBeInTheDocument()
    expect(within(row).getByText('Tractoreo')).toBeInTheDocument()
    expect(within(row).queryByText('ABCD12')).not.toBeInTheDocument()
  })

  it('el toggle Equipo Completo muestra el nombre del conductor habitual (o "Sin conductor habitual")', async () => {
    const { setAlcance } = renderSection()
    await screen.findByText('Ana Soto')

    setAlcance('equipo_completo')
    await screen.findByText('Sin conductor habitual')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))

    expect(await screen.findByText('Pedro Pérez')).toBeInTheDocument()
    expect(screen.getByText('Sin conductor habitual')).toBeInTheDocument()
    expect(screen.getByText('XYZ111')).toBeInTheDocument()
    expect(screen.getByText('XYZ222')).toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('en Equipo Completo, "Asignado" con trip_id muestra "Ver viaje" y llama onSelectTrip', async () => {
    const onSelectTrip = vi.fn()
    const { setAlcance } = renderSection({ onSelectTrip })
    setAlcance('equipo_completo')
    await screen.findByText('Sin conductor habitual')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    await screen.findByText('Pedro Pérez')

    fireEvent.click(screen.getByRole('button', { name: 'Ver viaje' }))

    expect(onSelectTrip).toHaveBeenCalledWith('t2')
  })

  it('en Equipo Completo, una fila "No asignado" tiene la misma funcionalidad editable que Conductores: motivo select', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  const { locationsApi } = await import('@/lib/api/locations')
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue(respuestaDeCds())
    const { setAlcance } = renderSection()
    setAlcance('equipo_completo')
    await screen.findByText('Sin conductor habitual')

    const row = screen.getByText('Sin conductor habitual').closest('tr')!
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'pana' } })

    await waitFor(() => {
      expect(equipmentClosuresApi.setReason).toHaveBeenCalledWith('a2', '2026-08-04', { unassigned_reason_id: 'pana' })
    })
  })

  it('en Equipo Completo, "Crear viaje manual" solo aparece si se conoce el conductor habitual', async () => {
    const { setAlcance } = renderSection()
    setAlcance('equipo_completo')
    await screen.findByText('Sin conductor habitual')

    // a2 no tiene driver_id — no debe ofrecer "Crear viaje manual"
    const row = screen.getByText('Sin conductor habitual').closest('tr')!
    expect(within(row).queryByRole('button', { name: /Crear viaje manual/ })).not.toBeInTheDocument()
  })

  it('tile "Total" en Conductores muestra el roster completo, incluidos los que no requieren acción', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
  })

  it('el buscador filtra por conductor, empresa o tracto en Conductores', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Norte' } })

    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('el checkbox de selección masiva aparece en filas UNASSIGNED, en todos los ejes', async () => {
    const { setAlcance } = renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.getByRole('checkbox', { name: /Ana Soto/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Luis Rojas/ })).not.toBeInTheDocument()

    setAlcance('equipo_completo')
    await screen.findByText('Sin conductor habitual')

    expect(screen.getByRole('checkbox', { name: /Sin conductor habitual/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Pedro Pérez/ })).not.toBeInTheDocument()
  })

  it('selección masiva en Conductores: aplica el mismo motivo a varios conductores seleccionados', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('checkbox', { name: /Ana Soto/ }))
    expect(screen.getByText('1 seleccionados')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Motivo para la selección'), { target: { value: 'pana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a todos' }))

    await waitFor(() => {
      expect(dailyClosuresApi.setReasonBatch).toHaveBeenCalledWith('2026-08-04', ['d1'], { unassigned_reason_id: 'pana' })
    })
  })

  it('selección masiva en Equipo Completo: usa equipmentClosuresApi, no dailyClosuresApi', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  const { locationsApi } = await import('@/lib/api/locations')
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue(respuestaDeCds())
    const { setAlcance } = renderSection()
    setAlcance('equipo_completo')
    await screen.findByText('Sin conductor habitual')

    fireEvent.click(screen.getByRole('checkbox', { name: /Sin conductor habitual/ }))
    fireEvent.change(screen.getByLabelText('Motivo para la selección'), { target: { value: 'pana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a todos' }))

    await waitFor(() => {
      expect(equipmentClosuresApi.setReasonBatch).toHaveBeenCalledWith('2026-08-04', ['a2'], { unassigned_reason_id: 'pana' })
    })
  })

  it('botón "Crear viaje manual" en fila UNASSIGNED de Conductores llama onCreateManualTrip con driver_id/full_name', async () => {
    const onCreateManualTrip = vi.fn()
    renderSection({ onCreateManualTrip })
    await screen.findByText('Ana Soto')

    // Con el roster completo hay un boton por fila sin asignar, asi que se
    // acota a la de Ana Soto en vez de tomar "el unico".
    const fila = screen.getByText('Ana Soto').closest('tr')!
    fireEvent.click(within(fila).getByRole('button', { name: /Crear viaje manual/ }))

    expect(onCreateManualTrip).toHaveBeenCalledWith('d1', 'Ana Soto')
  })

  it('MISMATCH con trip_id muestra "Ver viaje" y llama onSelectTrip', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    await screen.findByText('Luis Rojas')

    const row = screen.getByText('Luis Rojas').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /Ver viaje/ }))

    expect(onSelectTrip).toHaveBeenCalledWith('t1')
  })

  it('MISMATCH sin trip_id muestra "Revisar en Directorio" con link a la ficha del carrier', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ ...LINE.toRegularize, driver_id: 'd2', full_name: 'Luis Rojas', carrier_id: 'c9', trip_id: null }),
      ],
    })
    renderSection()
    await screen.findByText('Luis Rojas')

    const link = screen.getByRole('link', { name: /Revisar en Directorio/ })
    expect(link).toHaveAttribute('href', '/dashboard/carriers/c9')
  })

  it('pagina Conductores de a 20, no de a 10', async () => {
    await soloConductores()
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const many = Array.from({ length: 25 }, (_, i) =>
      driverRow({ ...LINE.withoutReason, driver_id: `p${i}`, full_name: `Conductor ${String(i).padStart(2, '0')}` }),
    )
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS, drivers: many, pending_count: 25,
    })
    renderSection()
    await screen.findByText('Conductor 00')

    expect(screen.getByText('1 de 2')).toBeInTheDocument()
    expect(screen.getByText('Conductor 19')).toBeInTheDocument()
    expect(screen.queryByText('Conductor 20')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    expect(await screen.findByText('Conductor 24')).toBeInTheDocument()
    expect(screen.queryByText('Conductor 00')).not.toBeInTheDocument()
  })

  it('el selector de filas por página cambia cuántas se ven', async () => {
    // Con 10 fijas y 81 tractos, revisar el día eran nueve saltos de página.
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const many = Array.from({ length: 25 }, (_, i) =>
      driverRow({ ...LINE.withoutReason, driver_id: `p${i}`, full_name: `Conductor ${String(i).padStart(2, '0')}` }),
    )
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS, drivers: many, pending_count: 25,
    })
    renderSection()
    await screen.findByText('Conductor 00')
    expect(screen.queryByText('Conductor 24')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filas por página'), { target: { value: '50' } })

    expect(await screen.findByText('Conductor 24')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página siguiente' })).not.toBeInTheDocument()
  })

  it('pagina Equipo Completo de a 20', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  const { locationsApi } = await import('@/lib/api/locations')
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue(respuestaDeCds())
    const many = Array.from({ length: 25 }, (_, i) =>
      equipmentRow({ ...LINE.withoutReason, asset_id: `e${i}`, tractor_plate: `PLT${String(i).padStart(2, '0')}` }),
    )
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...EQUIPMENT_STATUS,
      equipos_completos: { ...EQUIPMENT_STATUS.equipos_completos, equipment: many },
    })
    const { setAlcance } = renderSection()
    setAlcance('equipo_completo')
    await screen.findByText('PLT00')

    expect(screen.getByText('1 de 2')).toBeInTheDocument()
    expect(screen.queryByText('PLT24')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    expect(await screen.findByText('PLT24')).toBeInTheDocument()
  })
  // ── Regresión del 2026-09-07 ──────────────────────────────────────────────
  // Pablo cerró el 03-09 y reportó cinco viajes que "no aparecen en el cierre,
  // ni como asignados ni como no asignados", más un error de "15 equipo(s) sin
  // resolver" sin listado. Los seis casos eran la misma causa: la pestaña que
  // decía "Tractoreo" mostraba conductores y `tractoreo.equipment` no lo leía
  // nadie. Estos tests fallan si esa lista vuelve a quedarse sin superficie.

  it('la vista Tractoreo lista los TRACTOS y, aparte, los conductores sin tracto', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    expect(await screen.findByText('FCCP42')).toBeInTheDocument()
    expect(screen.getByText('HKXW55')).toBeInTheDocument()
    expect(screen.getByText('DTBY52')).toBeInTheDocument()
    // Ningún conductor desaparece: los que no son habituales de un tracto van
    // después de los tractos, y su grupo es un valor del filtro Grupo.
    expect(screen.getByText('DTBY52').compareDocumentPosition(screen.getByText('Ana Soto')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar filtro' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grupo' }))
    expect(screen.getByRole('checkbox', { name: /^Otro conductor del día, / })).toBeInTheDocument()
  })

  it('un tracto con motivo heredado del conductor dice de quién lo heredó (punto 5, 01/10)', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...EQUIPMENT_STATUS,
      tractoreo: {
        ...EQUIPMENT_STATUS.tractoreo,
        equipment: [equipmentRow({ ...LINE.notWorking,
          asset_id: 'tr9', tractor_plate: 'BDLC92', requires_motivo: true,
          driver_id: 'h9', driver_name: 'Villegas Ruiz Rafael David',
          reason_from_driver_name: 'Villegas Ruiz Rafael David' })],
      },
    })
    renderSection()
    await screen.findByText('Ana Soto')

    const fila = (await screen.findByText('BDLC92')).closest('tr')!
    expect(within(fila).getByText('Heredado de Villegas Ruiz Rafael David')).toBeInTheDocument()
  })

  it('un motivo escrito a mano en el tracto no se presenta como heredado', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...EQUIPMENT_STATUS,
      tractoreo: {
        ...EQUIPMENT_STATUS.tractoreo,
        equipment: [equipmentRow({ ...LINE.notWorking,
          asset_id: 'tr9', tractor_plate: 'BDLC92', requires_motivo: true, reason_from_driver_name: null })],
      },
    })
    renderSection()
    await screen.findByText('Ana Soto')

    const fila = (await screen.findByText('BDLC92')).closest('tr')!
    expect(within(fila).queryByText(/Heredado de/)).not.toBeInTheDocument()
  })

  it('un tracto asignado muestra el conductor DEL VIAJE, no el habitual del maestro', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    const fila = (await screen.findByText('FCCP42')).closest('tr')!
    expect(within(fila).getByText('Celis Huerta Brian')).toBeInTheDocument()
    expect(within(fila).queryByText('Brian Celis (habitual)')).not.toBeInTheDocument()
  })

  it('un tracto asignado sin conductor por ninguna vía lo dice, en vez de fingir que el viaje va vacío', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    const fila = (await screen.findByText('HKXW55')).closest('tr')!
    expect(within(fila).getByText('El TMS no reportó conductor')).toBeInTheDocument()
    // Y sigue siendo un tracto ASIGNADO: el estado no depende del conductor.
    expect(within(fila).getByText('Asignado')).toBeInTheDocument()
  })

  // ── Fusión por tracto (HU-D1, minuta 02/10) ──────────────────────────────
  // Operaciones cerraba el conductor y después repetía lo mismo en su tracto.

  async function conTractoYConductorSinCarga(extraTracto: Partial<EquipmentDayStatusRow> = {}) {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ ...LINE.withoutReason, driver_id: 'h7', full_name: 'Rafael Villegas' })],
    })
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...EQUIPMENT_STATUS,
      tractoreo: {
        ...EQUIPMENT_STATUS.tractoreo,
        equipment: [equipmentRow({ ...LINE.withoutReason,
          asset_id: 'tr7', tractor_plate: 'BDLC92', requires_motivo: true,
          driver_id: 'h7', driver_name: 'Rafael Villegas', ...extraTracto })],
      },
    })
  }

  it('el conductor y su tracto sin carga son UNA fila, y el motivo va al conductor', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    await conTractoYConductorSinCarga()
    renderSection()

    const fila = (await screen.findByText('BDLC92')).closest('tr')!
    expect(within(fila).getByText('Rafael Villegas')).toBeInTheDocument()
    expect(screen.getAllByText('Rafael Villegas')).toHaveLength(1)

    fireEvent.change(within(fila).getByRole('combobox', { name: 'Motivo de Rafael Villegas' }),
                     { target: { value: 'pana' } })

    await waitFor(() => {
      expect(dailyClosuresApi.setReason).toHaveBeenCalledWith('h7', '2026-08-04', { unassigned_reason_id: 'pana' })
    })
    expect(equipmentClosuresApi.setReason).not.toHaveBeenCalled()
  })

  it('un tracto con motivo propio distinto del conductor se ve y se edita aparte', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    await conTractoYConductorSinCarga({ unassigned_reason_id: 'esperando', reason_from_driver_name: null })
    renderSection()

    const fila = (await screen.findByText('BDLC92')).closest('tr')!
    const delTracto = within(fila).getByRole('combobox', { name: 'Motivo del tracto BDLC92' })
    expect(delTracto).toHaveValue('esperando')

    fireEvent.change(delTracto, { target: { value: '' } })

    await waitFor(() => {
      expect(equipmentClosuresApi.setReason).toHaveBeenCalledWith('tr7', '2026-08-04', { unassigned_reason_id: null })
    })
  })

  it('si el tracto lo manejó otro, el conductor habitual sin carga va aparte con su patente', async () => {
    await conTractoYConductorSinCarga({ status: 'ASSIGNED', trip_id: 'tt7', trip_driver_name: 'Otro Conductor' })
    renderSection()

    const filaConductor = (await screen.findByText('Rafael Villegas')).closest('tr')!
    expect(within(filaConductor).getByText('BDLC92')).toBeInTheDocument()
    expect(within(filaConductor).getByText('Sin motivo')).toBeInTheDocument()
  })

  it('quien salió del roster aparece arriba, en su grupo, y cuenta para la firma (0.4)', async () => {
    await soloConductores()
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ ...LINE.assigned, driver_id: 'd1', full_name: 'Ana Soto', today_trip_id: 't1', in_roster: true }),
        driverRow({ ...LINE.withoutReason, driver_id: 'd9', full_name: 'Pedro Fuera', in_roster: false }),
      ],
    })
    renderSection()

    await screen.findByText('Pedro Fuera')
    // Va primero (antes de cualquier otra fila de datos) porque bloquea.
    expect(within(screen.getAllByRole('row')[1]).getByText('Pedro Fuera')).toBeInTheDocument()
    // Se resuelve igual que siempre: con su motivo; y su grupo es un valor del filtro Grupo.
    expect(screen.getByRole('combobox', { name: 'Motivo de Pedro Fuera' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar filtro' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grupo' }))
    expect(screen.getByRole('checkbox', { name: 'Ya no está en el roster, 1' })).toBeInTheDocument()
  })

  it('sin la marca (backend anterior) no aparece el grupo', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: 'Agregar filtro' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Grupo' }))
    expect(screen.queryByRole('checkbox', { name: /^Ya no está en el roster/ })).toBeNull()
  })

  it('el motivo de un tracto Tractoreo se escribe por equipmentClosuresApi, no por el de conductores', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  const { locationsApi } = await import('@/lib/api/locations')
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue(respuestaDeCds())
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderSection()
    await screen.findByText('Ana Soto')
    const fila = (await screen.findByText('DTBY52')).closest('tr')!
    fireEvent.change(within(fila).getByRole('combobox'), { target: { value: 'pana' } })

    await waitFor(() => {
      // Sólo el motivo: la clave del comentario no viaja, y el backend distingue
      // "no mandé el campo" de "déjalo vacío" para no borrar lo escrito.
      expect(equipmentClosuresApi.setReason).toHaveBeenCalledWith('tr3', '2026-08-04', { unassigned_reason_id: 'pana' })
    })
    expect(dailyClosuresApi.setReason).not.toHaveBeenCalled()
  })
  it('un conductor ASIGNADO sano tiene "Ver viaje": el link sale del viaje de hoy, no del de mismatch', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))

    const fila = (await screen.findByText('Juan Pérez')).closest('tr')!
    // trip_id es null en esta fila (no hay mismatch) y aun asi hay link.
    fireEvent.click(within(fila).getByRole('button', { name: 'Ver viaje' }))

    expect(onSelectTrip).toHaveBeenCalledWith('t3')
  })

  it('no dibuja "Crear viaje manual" cuando nadie puede atenderlo', async () => {
    renderSection({ onCreateManualTrip: undefined })
    await screen.findByText('Ana Soto')

    expect(screen.queryByRole('button', { name: /Crear viaje manual/ })).not.toBeInTheDocument()
  })
  // ── Pedidos del 2026-09-07 ────────────────────────────────────────────────

  it('con motivo, un no asignado sale de "Sin motivo" y entra en su tipo; "No asignados" los cuenta a los dos', async () => {
    await soloConductores()
    // Antes los dos estados caían en el mismo número, así que resolver una
    // fila no movía el contador de lo pendiente.
    renderSection()
    await screen.findByText('Ana Soto')
    // Ana Soto y Carla Díaz están No asignadas; sólo Carla tiene motivo (no trabajó).
    expect(screen.getByRole('button', { name: 'No asignados, 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sin motivo, 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No trabajó, 1' })).toBeInTheDocument()
  })

  it('el recuadro "No trabajó" muestra sólo a los que ya tienen ese motivo', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /^No trabajó/ }))

    expect(await screen.findByText('Carla Díaz')).toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('la tabla muestra el Nº de viaje y el local de origen', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    expect(screen.getByRole('columnheader', { name: /Nº viaje/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Local de origen/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    expect(await screen.findByText('2045490')).toBeInTheDocument()
    expect(screen.getByText('CD LO AGUIRRE')).toBeInTheDocument()
  })

  it('ordenar por una columna cicla asc, desc y sin orden', async () => {
    await soloConductores()
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    await screen.findByText('Juan Pérez')

    const nombres = () => screen.getAllByRole('row').slice(1)
      .map(f => f.querySelectorAll('td')[1]?.textContent ?? '')

    const ordenar = () => within(screen.getByRole('columnheader', { name: /^Conductor/ })).getByRole('button', { name: 'Conductor' })
    fireEvent.click(ordenar())
    expect(nombres()[0]).toBe('Ana Soto')

    fireEvent.click(ordenar())
    expect(nombres()[0]).toBe('Luis Rojas')
  })

  it('el filtro de una columna acepta varios valores a la vez', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    await screen.findByText('Juan Pérez')

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^Transportes Norte, / }))

    // Con un solo valor elegido, sólo queda quien pertenece a esa empresa.
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()

    // Y el filtro es MÚLTIPLE: al sumar la segunda empresa vuelven los suyos.
    fireEvent.click(screen.getByRole('checkbox', { name: /^Transportes Sur, / }))
    expect(await screen.findByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
  })

  it('los valores del filtro salen de las filas, no de un catálogo', async () => {
    await soloConductores()
    // Un desplegable que lista todo el padrón obliga a elegir a ojo — la misma
    // lección del click-through de agosto.
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    await screen.findByText('Juan Pérez')

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Empresa' }))

    const filtro = await screen.findByRole('dialog', { name: 'Filtrar por Empresa' })
    expect(within(filtro).getAllByRole('checkbox').map(c => c.getAttribute('aria-label')?.split(',')[0]))
      .toEqual(['Transportes Norte', 'Transportes Sur'])
  })

  it('el comentario se guarda al salir del campo, y sólo si cambió', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^No trabajó/ }))
    await screen.findByText('Carla Díaz')

    const campo = screen.getByLabelText('Comentario de Carla Díaz')
    fireEvent.blur(campo)
    expect(dailyClosuresApi.setReason).not.toHaveBeenCalled()

    fireEvent.change(campo, { target: { value: 'llegó tarde el repuesto' } })
    fireEvent.blur(campo)

    await waitFor(() => {
      // Sin motivo: el comentario viaja solo y el backend conserva el que
      // haya. Mandarlo seria reescribirlo con el mismo valor sin motivo para
      // hacerlo.
      expect(dailyClosuresApi.setReason).toHaveBeenCalledWith(
        'd4', '2026-08-04', { comentario: 'llegó tarde el repuesto' },
      )
    })
  })

  it('el comentario es una columna propia, no un renglón bajo el motivo', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^No trabajó/ }))

    const fila = (await screen.findByText('Carla Díaz')).closest('tr')!
    const celdas = fila.querySelectorAll('td')
    // La última celda es la del comentario; la del motivo es la anterior.
    expect(screen.getByRole('columnheader', { name: /^Comentario/ })).toBeInTheDocument()
    expect(within(celdas[celdas.length - 1] as HTMLElement)
      .getByLabelText('Comentario de Carla Díaz')).toBeInTheDocument()
    expect(within(celdas[celdas.length - 2] as HTMLElement)
      .getByRole('combobox')).toBeInTheDocument()
  })

  it('se puede comentar una fila sin motivo elegido', async () => {
    // El bug que reportó el usuario: *"la columna de comentarios no permite
    // escribir"*. El campo sólo existía si la fila YA tenía motivo guardado
    // —287 de 4.540 filas en la base—, así que en el resto había un guion y
    // ningún lugar donde escribir. Cero comentarios guardados en la vida.
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderSection()
    await screen.findByText('Ana Soto')

    const campo = screen.getByLabelText('Comentario de Ana Soto')
    fireEvent.change(campo, { target: { value: 'sin novedad' } })
    fireEvent.blur(campo)

    await waitFor(() => {
      expect(dailyClosuresApi.setReason).toHaveBeenCalledWith(
        'd1', '2026-08-04', { comentario: 'sin novedad' },
      )
    })
  })

  it('se puede comentar una fila asignada, que tuvo carga', async () => {
    // Decisión del usuario (14/09): el comentario dejó de ser un pie de página
    // del motivo y pasó a ser una nota del día de esa fila. Una fila con carga
    // también se explica con palabras.
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))

    const fila = screen.getByText('Juan Pérez').closest('tr')!
    expect(within(fila).getByText('Asignado')).toBeInTheDocument()
    expect(within(fila).getByLabelText('Comentario de Juan Pérez')).toBeInTheDocument()
  })

  it('la tabla muestra el generador de carga, y se puede ordenar y filtrar por él', async () => {
    // Pedido del usuario (14/09): se veía la patente y la empresa que mueve la
    // carga, y no para quién era. El dato es app.trips.client_name.
    renderSection()
    await screen.findByText('Ana Soto')

    expect(screen.getByRole('columnheader', { name: /Generador de carga/ })).toBeInTheDocument()
    const columna = screen.getByRole('columnheader', { name: /Generador de carga/ })
    expect(within(columna).getByRole('button', { name: 'Generador de carga' })).toBeInTheDocument()
    expect(within(columna).getByRole('button', { name: 'Filtrar por Generador de carga' })).toBeInTheDocument()
  })

  it('la pantalla abre en "Total": el número de arriba es el de las filas de abajo', async () => {
    // Reportado por el usuario (14/09): *"al seleccionar los cards no se ve la
    // categoría"*. Abría filtrada por la unión de "No asignados" y "Por
    // regularizar" —una categoría sin tile—, así que se veía "38 Total" y una
    // sola fila, con los cinco tiles apagados y nada que lo explicara.
    renderSection()
    await screen.findByText('Ana Soto')

    expect(screen.getByRole('button', { name: /^Todos, / })).toHaveAttribute('aria-pressed', 'true')
    // Los cuatro conductores del fixture, no un recorte silencioso.
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
  })

  it('al cambiar de alcance conserva el recuadro elegido, porque el estado sigue aplicando (C7)', async () => {
    // Hasta el 16/10 volvía a "Total". Con un solo filtro para todo el Cierre,
    // un filtro que aplica en el otro alcance se conserva; solo se quitan (y se
    // avisan) los valores que el otro alcance no tiene.
    await soloConductores()
    const { setAlcance } = renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^No trabajó/ }))
    expect(screen.getByRole('button', { name: /^No trabajó/ })).toHaveAttribute('aria-pressed', 'true')

    setAlcance('equipo_completo')

    await waitFor(() => expect(screen.getByRole('button', { name: /^No trabajó/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByText(/^Se quitó/)).toBeNull()
  })

  // ── Solicitud de Cambios Diario 2.0 (16/09) ─────────────────────────────

  it('un motivo de "trabajó sin asignación" queda en su tipo y no pasa a "No trabajó" (Operaciones, 16/09)', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ ...LINE.workingUnassigned, driver_id: 'd1', full_name: 'Ana Soto' }),
        driverRow({ ...LINE.notWorking, driver_id: 'd4', full_name: 'Carla Díaz' }),
      ],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /^Trabajó sin asignación/ }))
    expect(screen.getByText('Ana Soto')).toBeInTheDocument()
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^No trabajó/ }))
    expect(await screen.findByText('Carla Díaz')).toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('"Hasta" aparece sólo con un motivo de no trabajó, y guarda la vigencia', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ ...LINE.workingUnassigned, driver_id: 'd1', full_name: 'Ana Soto' }),
        driverRow({ ...LINE.notWorking, driver_id: 'd4', full_name: 'Carla Díaz' }),
      ],
    })
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }))

    expect(screen.queryByLabelText('Vigencia del motivo de Ana Soto')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Vigencia del motivo de Carla Díaz'), { target: { value: '2026-08-10' } })

    await waitFor(() => {
      expect(dailyClosuresApi.setReason).toHaveBeenCalledWith('d4', '2026-08-04', { valid_until: '2026-08-10' })
    })
  })

  it('con el día cerrado la tabla es de sólo lectura', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({ ...DRIVERS_STATUS, closed: true })
    renderSection()
    await screen.findByText('Ana Soto')

    expect(screen.getByLabelText('Motivo de Ana Soto')).toBeDisabled()
    expect(screen.getByLabelText('Comentario de Ana Soto')).toBeDisabled()
    expect(screen.queryByRole('checkbox', { name: /Ana Soto/ })).not.toBeInTheDocument()
  })

  it('si guardar falla, la pantalla lo dice', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.setReason).mockRejectedValue(new Error('El día está cerrado. Para cambiarlo hay que reabrirlo.'))
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.change(screen.getByLabelText('Motivo de Ana Soto'), { target: { value: 'pana' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('reabrirlo')
  })

  // ── CD y operación (HU-28, ola 3) ────────────────────────────────────────

  it('muestra el origen habitual y el local de origen en columnas distintas', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ ...LINE.assigned,
        driver_id: 'dx', full_name: 'Ana Soto',
        home_cd_name: 'CD EL PEÑON', today_trip_origin: 'CD QUILICURA' })],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    // Son dos preguntas distintas: de quién es la asistencia, y de dónde salió
    // la carga de hoy. Fundirlas sería un campo con dos significados.
    expect(screen.getByRole('columnheader', { name: /^Origen habitual/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^Local de origen/ })).toBeInTheDocument()
    const fila = screen.getByText('Ana Soto').closest('tr')!
    expect(within(fila).getByText('CD EL PEÑON')).toBeInTheDocument()
    expect(within(fila).getByText('CD QUILICURA')).toBeInTheDocument()
  })

  it('el filtro de origen ofrece uno del catálogo aunque no tenga a nadie ese día', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ driver_id: 'dx', full_name: 'Ana Soto', home_cd_name: 'CD EL PEÑON' })],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(within(screen.getByRole('columnheader', { name: /^Origen habitual/ })).getByRole('button', { name: /filtr/i }))

    // Nadie está hoy en Lo Aguirre, y aun así se puede pedir su asistencia.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'CD LO AGUIRRE, 0' })).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'CD EL PEÑON, 1' })).toBeInTheDocument()
  })

  it('una fila sin viaje no tiene cliente, aunque su empresa opere para varios', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ ...LINE.withoutReason,
        driver_id: 'dx', full_name: 'Ana Soto', client_names: [],
        carrier_shipper_names: ['IANSA', 'Sodimac'] } as never)],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    // El cliente es un dato del viaje (decisión del usuario 11/10): antes la
    // fila decía "IANSA · Sodimac", los clientes de su empresa.
    const fila = screen.getByText('Ana Soto').closest('tr')!
    expect(within(fila).queryByText(/IANSA|Sodimac/)).toBeNull()
  })

  it('al filtrar por un origen, los tiles muestran la asistencia de ESE origen', async () => {
    await soloConductores()
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ ...LINE.assigned, driver_id: 'p1', full_name: 'Ana Soto', home_cd_name: 'CD EL PEÑON' }),
        driverRow({ ...LINE.assigned, driver_id: 'p2', full_name: 'Luis Rojas', home_cd_name: 'CD EL PEÑON' }),
        driverRow({ ...LINE.assigned, driver_id: 'q1', full_name: 'Carla Díaz', home_cd_name: 'CD QUILICURA' }),
      ],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    expect(screen.getByRole('button', { name: 'Todos, 3' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('columnheader', { name: /^Origen habitual/ })).getByRole('button', { name: /filtr/i }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^CD EL PEÑON, / }))

    // Sin esto, elegir un CD mostraba sus filas pero dejaba arriba el número
    // del día completo, y la asistencia por CD había que contarla a mano.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Todos, 2' })).toBeInTheDocument())
  })

  it('sin origen habitual en nadie, lo dice y ofrece dónde arreglarlo', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ driver_id: 'dx', full_name: 'Ana Soto', home_cd_name: null })],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    // Nunca una columna llena de "Sin origen" sin explicar qué hacer.
    expect(screen.getByText(/nadie tiene origen habitual/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Asignar desde el Directorio' }))
      .toHaveAttribute('href', '/dashboard/carriers')
  })

  it('con el origen habitual cargado en todos, el aviso desaparece', async () => {
    await soloConductores()
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ driver_id: 'dx', full_name: 'Ana Soto', home_cd_name: 'CD EL PEÑON' })],
    })
    renderSection()
    await screen.findByText('Ana Soto')

    // Se apunta al AVISO, no a "Origen habitual" a secas: eso ahora calza también
    // con el encabezado de la columna, que está siempre.
    expect(screen.queryByText(/nadie tiene origen habitual/)).not.toBeInTheDocument()
    expect(screen.queryByText(/sin origen habitual/)).not.toBeInTheDocument()
  })

  it('conductor, empresa y patente del directorio abren la vista rápida de su propia entidad', async () => {
    const onOpenQuickView = vi.fn()
    renderSection({ onOpenQuickView })
    fireEvent.click(await screen.findByRole('link', { name: 'Ver equipo FCCP42' }))
    expect(onOpenQuickView).toHaveBeenCalledWith({ kind: 'asset', id: 'tr1', label: 'FCCP42' }, 'asset:tr1')
    // El conductor del VIAJE de hoy, no el habitual: es el que se muestra.
    fireEvent.click(screen.getByRole('link', { name: 'Ver conductor Celis Huerta Brian' }))
    expect(onOpenQuickView).toHaveBeenCalledWith({ kind: 'driver', id: 'v1', label: 'Celis Huerta Brian' }, 'asset:tr1')
    fireEvent.click(screen.getByRole('link', { name: 'Ver empresa Transportes La Fortaleza Spa' }))
    expect(onOpenQuickView).toHaveBeenCalledWith(
      { kind: 'carrier', id: 'cf', label: 'Transportes La Fortaleza Spa' }, 'asset:tr3')
  })

  it('sin quién abra la vista rápida, los nombres son texto', async () => {
    renderSection()
    await screen.findByText('FCCP42')
    expect(screen.queryByRole('button', { name: /^Ver (equipo|conductor|empresa) / })).toBeNull()
  })

  it('en una fila fusionada, la empresa que se ve es la que se abre', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [driverRow({ driver_id: 'dx', full_name: 'Rita Mora', carrier_id: 'cDriver', carrier_name: 'Empresa del conductor' })],
    })
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...EQUIPMENT_STATUS,
      tractoreo: { ...EQUIPMENT_STATUS.tractoreo, equipment: [equipmentRow({ ...LINE.withoutReason,
        asset_id: 'tx', tractor_plate: 'RRMM11', carrier_id: 'cTractor', carrier_name: 'Empresa del tracto', requires_motivo: true, driver_id: 'dx', driver_name: 'Rita Mora' })] },
    })
    const onOpenQuickView = vi.fn()
    renderSection({ onOpenQuickView })
    fireEvent.click(await screen.findByRole('link', { name: 'Ver empresa Empresa del tracto' }))
    expect(onOpenQuickView).toHaveBeenCalledWith(
      { kind: 'carrier', id: 'cTractor', label: 'Empresa del tracto' }, 'asset:tx')
  })
  it('los tractos se releen cada 15 s mientras el día tiene un recálculo pendiente (0.6)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
      vi.mocked(equipmentClosuresApi.get).mockResolvedValue({ ...EQUIPMENT_STATUS, pendiente_desde: '2026-08-04T15:00:00Z' })
      renderSection()
      await screen.findByText('FCCP42')
      const antes = vi.mocked(equipmentClosuresApi.get).mock.calls.length
      await vi.advanceTimersByTimeAsync(15_000)
      await waitFor(() => expect(vi.mocked(equipmentClosuresApi.get).mock.calls.length).toBeGreaterThan(antes))
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin recálculo pendiente no relee', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
      renderSection()
      await screen.findByText('FCCP42')
      const antes = vi.mocked(equipmentClosuresApi.get).mock.calls.length
      await vi.advanceTimersByTimeAsync(31_000)
      expect(vi.mocked(equipmentClosuresApi.get).mock.calls.length).toBe(antes)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('FlotaDelDiaSection, la tarjeta Por regularizar (30/10)', () => {
  it('está en los dos alcances, con la cifra que le pasa la página', async () => {
    const { setAlcance } = renderSection({ porRegularizar: { cantidad: 4, lista: <p>Lista de viajes</p> } })
    expect(await screen.findByRole('button', { name: 'Por regularizar, 4' })).toBeInTheDocument()
    setAlcance('equipo_completo')
    expect(await screen.findByRole('button', { name: 'Por regularizar, 4' })).toBeInTheDocument()
  })

  it('al elegirla muestra la lista de viajes en vez de la flota; otra tarjeta vuelve a la flota', async () => {
    renderSection({ porRegularizar: { cantidad: 1, lista: <p>Lista de viajes</p> } })
    fireEvent.click(await screen.findByRole('button', { name: 'Por regularizar, 1' }))
    expect(screen.getByText('Lista de viajes')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Flota del día' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^No asignados/ }))
    expect(screen.queryByText('Lista de viajes')).toBeNull()
    expect(await screen.findByRole('table', { name: 'Flota del día' })).toBeInTheDocument()
  })
})

