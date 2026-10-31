import { describe, it, expect } from 'vitest'
import { buildFleetRows, fleetStatusOf, reasonTypeOf, scopeSummary } from './dayFleet'
import { DRIVERS_STATUS, EQUIPMENT_STATUS, LINE, driverRow, equipmentRow } from './dayFleet.fixtures'
import type { DailyClosureStatus, EquipmentClosureStatus } from '@/lib/types'

const conTracto = (tracto: Parameters<typeof equipmentRow>[0], conductores: ReturnType<typeof driverRow>[]) => ({
  drivers: { ...DRIVERS_STATUS, drivers: conductores } as DailyClosureStatus,
  equipment: { ...EQUIPMENT_STATUS, tractoreo: { ...EQUIPMENT_STATUS.tractoreo, equipment: [equipmentRow(tracto)] } } as EquipmentClosureStatus,
})

describe('las filas de la Flota del día', () => {
  it('Tractoreo: los dos sin carga son UNA fila del conductor con la patente; escribe en el conductor', () => {
    const { drivers, equipment } = conTracto(
      { asset_id: 'tr9', tractor_plate: 'BDLC92', status: 'UNASSIGNED', driver_id: 'd9' },
      [driverRow({ ...LINE.withoutReason, driver_id: 'd9', full_name: 'Villegas Ruiz' })])
    const filas = buildFleetRows(drivers, equipment, 'tractoreo')
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ key: 'asset:tr9', group: 'tractor', primary: 'Villegas Ruiz', secondary: 'BDLC92',
      destino: { tipo: 'DRIVER', id: 'd9' } })
  })

  it('el que no quedó dentro de una patente va aparte, con su patente habitual; el que salió del roster, arriba', () => {
    const { drivers, equipment } = conTracto(
      { asset_id: 'tr9', tractor_plate: 'BDLC92', status: 'ASSIGNED', driver_id: 'd9', trip_id: 't' },
      [driverRow({ ...LINE.withoutReason, driver_id: 'd9', full_name: 'Habitual' }),
       driverRow({ ...LINE.withoutReason, driver_id: 'dx', full_name: 'Salió', in_roster: false })])
    const filas = buildFleetRows(drivers, equipment, 'tractoreo')
    expect(filas.map(f => [f.group, f.primary, f.secondary])).toEqual([
      ['out_of_roster', 'Salió', null],
      ['tractor', 'El TMS no reportó conductor', 'BDLC92'],
      ['other_driver', 'Habitual', 'BDLC92'],
    ])
  })

  it('cada fila trae el estado del TMS de su viaje de hoy, venga del conductor o del tracto', () => {
    const { drivers, equipment } = conTracto(
      { asset_id: 'tr9', tractor_plate: 'BDLC92', status: 'ASSIGNED', driver_id: 'd9', trip_id: 't',
        today_trip_status: 'RUTA' },
      [driverRow({ ...LINE.assigned, driver_id: 'dx', full_name: 'Otro', today_trip_status: 'CERRADO FINALIZADO' })])
    const filas = buildFleetRows(drivers, equipment, 'tractoreo')
    expect(filas.find(f => f.secondary === 'BDLC92')?.tripStatus).toBe('RUTA')
    expect(filas.find(f => f.primary === 'Otro')?.tripStatus).toBe('CERRADO FINALIZADO')
  })

  it('Equipo Completo: una fila por equipo', () => {
    expect(buildFleetRows(DRIVERS_STATUS, EQUIPMENT_STATUS, 'equipo_completo').map(f => f.secondary)).toEqual(['XYZ111', 'XYZ222'])
  })
})

describe('estado y tipo de motivo (el estándar: un estado, y el porqué solo de los no asignados)', () => {
  it('la categoría del backend se lee como estado + tipo de motivo', () => {
    expect([fleetStatusOf('ASIGNADO'), reasonTypeOf('ASIGNADO')]).toEqual(['ASSIGNED', null])
    expect([fleetStatusOf('SIN_RESOLVER'), reasonTypeOf('SIN_RESOLVER')]).toEqual(['UNASSIGNED', 'PENDING'])
    expect([fleetStatusOf('TRABAJANDO_SIN_ASIGNACION'), reasonTypeOf('TRABAJANDO_SIN_ASIGNACION')]).toEqual(['UNASSIGNED', 'WORKED'])
    expect([fleetStatusOf('NO_TRABAJANDO'), reasonTypeOf('NO_TRABAJANDO')]).toEqual(['UNASSIGNED', 'NOT_WORKED'])
    expect([fleetStatusOf('POR_REGULARIZAR'), reasonTypeOf('POR_REGULARIZAR')]).toEqual(['TO_REGULARIZE', null])
  })

  it('cada fila trae la zona del destino de su viaje de hoy; sin viaje, ninguna', () => {
    const { drivers, equipment } = conTracto(
      { asset_id: 'tr9', tractor_plate: 'BDLC92', status: 'ASSIGNED', trip_id: 't', destination_zone: 'RM' }, [])
    expect(buildFleetRows(drivers, equipment, 'tractoreo').map(f => f.zone)).toEqual(['RM'])
    const conductor = buildFleetRows({ ...DRIVERS_STATUS, drivers: [driverRow({ ...LINE.withoutReason, driver_id: 'd1' })] },
      { ...EQUIPMENT_STATUS, tractoreo: { ...EQUIPMENT_STATUS.tractoreo, equipment: [] } }, 'tractoreo')
    expect(conductor.map(f => f.zone)).toEqual([null])
  })
})

describe('el resumen de cada alcance', () => {
  it('Tractoreo: asignados + no asignados + por regularizar = todos; la utilización y lo que bloquea', () => {
    const r = scopeSummary(DRIVERS_STATUS, EQUIPMENT_STATUS, 'tractoreo')
    const filas = buildFleetRows(DRIVERS_STATUS, EQUIPMENT_STATUS, 'tractoreo')
    const de = (s: string) => filas.filter(f => fleetStatusOf(f.categoria) === s).length
    expect(r).toEqual({
      assigned: de('ASSIGNED'), unassigned: de('UNASSIGNED'), toRegularize: de('TO_REGULARIZE'),
      utilizationPct: Math.round(de('ASSIGNED') / filas.length * 1000) / 10,
      blocking: filas.filter(f => f.categoria === 'SIN_RESOLVER').length,
    })
    expect(r.assigned + r.unassigned + r.toRegularize).toBe(filas.length)
  })

  it('Equipo Completo: el del backend, sin "bloquean" (no exige motivo) ni por regularizar', () => {
    expect(scopeSummary(DRIVERS_STATUS, EQUIPMENT_STATUS, 'equipo_completo'))
      .toEqual({ assigned: 1, unassigned: 1, toRegularize: 0, utilizationPct: 50, blocking: null })
  })
})
