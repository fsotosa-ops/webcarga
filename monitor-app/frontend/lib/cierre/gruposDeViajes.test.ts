import { describe, it, expect } from 'vitest'
import type { ViajeDelCierre } from '@/lib/types'
import {
  GRUPOS_DE_VIAJES, PESTANAS_DE_VIAJES, closureTrips, conductorPorEmparejar, diasAtras, filasDePestana, pestanaInicial,
  queFalta, tripsToRegularize, viajesPorPatente,
} from './gruposDeViajes'

const viaje = (id: string, nro: string, extra: Partial<ViajeDelCierre> = {}): ViajeDelCierre => ({
  trip_id: id, planning_date: '2026-10-10', client_name: 'Sodimac', source_system: 'sodimac',
  source_system_trip_id: nro, trip_status: 'Publicada', tractor_plate: null, driver_name: null,
  carrier_name: null, origin: null, destinations: [], dias_sin_novedad: 1, unassigned_reason_id: null,
  unassigned_reason_label: null, ...extra,
})

// Los grupos del 10/10, tal como los mandó la API.
const GRUPOS = {
  por_regularizar: [],
  oferta_sin_declarar: [viaje('t1', '889281')],
  abandonado: [],
  en_curso: [
    viaje('t2', '2070673', { planning_date: '2026-10-09', trip_status: 'RETORNANDO', tractor_plate: 'FJHV95' }),
    viaje('t3', '2069959', { planning_date: '2026-10-08', trip_status: 'RETORNANDO', tractor_plate: 'GHYX72' }),
  ],
  pendiente_cierre_tms: [
    viaje('t4', '885613', { planning_date: '2026-10-07', tractor_plate: 'PYST91' }),
    viaje('t5', '881496', { planning_date: '2026-10-02', tractor_plate: 'PYST91' }),
    viaje('t6', '878052', { planning_date: '2026-09-29', tractor_plate: 'JF8307' }),
  ],
  con_motivo: [],
}

describe('gruposDeViajes', () => {
  it('cada grupo del backend cae en una pestaña; por regularizar no está en Viajes', () => {
    expect(Object.fromEntries(Object.entries(GRUPOS_DE_VIAJES).map(([g, p]) => [g, p.pestana]))).toEqual({
      por_regularizar: 'to_regularize', oferta_sin_declarar: 'to_resolve', abandonado: 'to_resolve',
      en_curso: 'tracking', pendiente_cierre_tms: 'tracking', con_motivo: 'resolved',
    })
    expect(PESTANAS_DE_VIAJES.map(p => p.id)).not.toContain('to_regularize')
  })

  it('solo por regularizar bloquea la firma, igual que `bloquean` de la API', () => {
    const v = viaje('t9', '1')
    const bloquean = Object.entries(GRUPOS_DE_VIAJES).filter(([, p]) => p.bloqueaLaFirma(v, '2026-10-10')).map(([g]) => g)
    expect(bloquean).toEqual(['por_regularizar'])
  })

  it('"Qué falta": sin asignar, las piezas que faltan, o la empresa distinta', () => {
    expect(queFalta(viaje('t9', '1', { is_assigned: false, missing_fleet: ['tractor', 'driver', 'carrier'] })))
      .toEqual(['Sin asignar'])
    expect(queFalta(viaje('t9', '1', { is_assigned: true, missing_fleet: ['tractor', 'driver', 'carrier'] })))
      .toEqual(['Tracto', 'Conductor', 'Empresa'])
    expect(queFalta(viaje('t9', '1', { is_assigned: true, missing_fleet: ['driver'] }))).toEqual(['Conductor'])
    expect(queFalta(viaje('t9', '1', { is_assigned: true, missing_fleet: [], carrier_mismatch: true })))
      .toEqual(['Empresa distinta a la del conductor'])
  })

  it('el conductor se empareja solo si falta y el TMS informó un nombre', () => {
    const base = viaje('t9', '1', { is_assigned: true, missing_fleet: ['driver'] })
    expect(conductorPorEmparejar({ ...base, driver_name_tms: 'PEREZ SOTO JUAN' })).toBe(true)
    expect(conductorPorEmparejar({ ...base, driver_name_tms: null })).toBe(false)
    expect(conductorPorEmparejar({ ...base, driver_name_tms: 'X', driver_id: 'd1' })).toBe(false)
    expect(conductorPorEmparejar({ ...base, driver_name_tms: 'X', is_assigned: false })).toBe(false)
  })

  it('por regularizar se lee aparte y no entra en los viajes de la pestaña Viajes', () => {
    const grupos = { ...GRUPOS, por_regularizar: [viaje('r1', '7')] }
    expect(tripsToRegularize(grupos).map(f => f.trip_id)).toEqual(['r1'])
    expect(closureTrips(grupos).map(f => f.trip_id)).not.toContain('r1')
  })

  it('el "por qué" de los grupos de seguimiento', () => {
    const v = viaje('t9', '1', { planning_date: '2026-10-07' })
    expect(GRUPOS_DE_VIAJES.en_curso.porQue({ ...v, trip_status: 'RETORNANDO' }, '2026-10-10')).toBe('En ruta · RETORNANDO')
    expect(GRUPOS_DE_VIAJES.pendiente_cierre_tms.porQue(v, '2026-10-10')).toBe('Espera cierre del TMS')
  })

  it('días atrás cuenta días de calendario, sin correrse por el huso horario', () => {
    expect(diasAtras('2026-09-29', '2026-10-10')).toBe(11)
    expect(diasAtras('2026-10-10', '2026-10-10')).toBe(0)
  })

  it('las filas de una pestaña juntan sus grupos, de la más antigua a la más nueva', () => {
    const filas = filasDePestana(GRUPOS, 'tracking')
    expect(filas.map(f => f.source_system_trip_id)).toEqual(['878052', '881496', '885613', '2069959', '2070673'])
    expect(filas[0].grupo).toBe('pendiente_cierre_tms')
  })

  it('a igual fecha, ordena por Nº de viaje', () => {
    const filas = filasDePestana({ abandonado: [viaje('a', '20'), viaje('b', '10')] }, 'to_resolve')
    expect(filas.map(f => f.source_system_trip_id)).toEqual(['10', '20'])
  })

  it('un grupo que todavía no llega del backend no rompe nada', () => {
    expect(filasDePestana({ abandonado: [viaje('t1', '1')] }, 'tracking')).toEqual([])
  })

  it('se abre en Por resolver si tiene viajes, y si no en En seguimiento', () => {
    expect(pestanaInicial(GRUPOS)).toBe('to_resolve')
    expect(pestanaInicial({ ...GRUPOS, oferta_sin_declarar: [] })).toBe('tracking')
  })

  it('una patente con más de un viaje en la pestaña se marca con sus números', () => {
    const repetidas = viajesPorPatente(filasDePestana(GRUPOS, 'tracking'))
    expect([...repetidas.entries()]).toEqual([['PYST91', ['881496', '885613']]])
  })
})

describe('la bajada de Por resolver', () => {
  it('dice qué queda en Viajes y dónde está lo que bloquea la firma', () => {
    const porResolver = PESTANAS_DE_VIAJES.find(p => p.id === 'to_resolve')!
    expect(porResolver.bajada).toBe('Declara por qué no se tomó una oferta retirada o un viaje abandonado por el TMS.')
    expect(porResolver.vacio).toMatch(/Flota del día › Por regularizar/)
  })
})
