import { describe, it, expect } from 'vitest'
import { buildFleetRows, scopeSummary } from './dayFleet'
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

  it('Equipo Completo: una fila por equipo', () => {
    expect(buildFleetRows(DRIVERS_STATUS, EQUIPMENT_STATUS, 'equipo_completo').map(f => f.secondary)).toEqual(['XYZ111', 'XYZ222'])
  })
})

describe('el resumen de cada alcance (las fórmulas de siempre)', () => {
  it('Tractoreo: asignados, sin asignar, utilización y lo que bloquea', () => {
    const r = scopeSummary(DRIVERS_STATUS, EQUIPMENT_STATUS, 'tractoreo')
    const filas = buildFleetRows(DRIVERS_STATUS, EQUIPMENT_STATUS, 'tractoreo')
    const asignados = filas.filter(f => f.categoria === 'ASIGNADO').length
    expect(r).toEqual({
      assigned: asignados, unassigned: filas.length - asignados,
      utilizationPct: Math.round(asignados / filas.length * 1000) / 10,
      blocking: filas.filter(f => f.categoria === 'SIN_RESOLVER').length,
    })
  })

  it('Equipo Completo: el del backend, sin "bloquean" (no exige motivo)', () => {
    expect(scopeSummary(DRIVERS_STATUS, EQUIPMENT_STATUS, 'equipo_completo'))
      .toEqual({ assigned: 1, unassigned: 1, utilizationPct: 50, blocking: null })
  })
})
