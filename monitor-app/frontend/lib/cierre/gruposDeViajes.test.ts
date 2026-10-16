import { describe, it, expect } from 'vitest'
import type { ViajeDelCierre } from '@/lib/types'
import {
  GRUPOS_DE_VIAJES, PESTANAS_DE_VIAJES, diasAtras, filasDePestana, pestanaInicial, viajesPorPatente,
} from './gruposDeViajes'

const viaje = (id: string, nro: string, extra: Partial<ViajeDelCierre> = {}): ViajeDelCierre => ({
  trip_id: id, planning_date: '2026-10-10', client_name: 'Sodimac', source_system: 'sodimac',
  source_system_trip_id: nro, trip_status: 'Publicada', tractor_plate: null, driver_name: null,
  carrier_name: null, origin: null, destinations: [], dias_sin_novedad: 1, unassigned_reason_id: null,
  unassigned_reason_label: null, ...extra,
})

// Los grupos del 10/10, tal como los mandó la API.
const GRUPOS = {
  hoy: [viaje('t1', '889281')],
  rezago: [],
  oferta_sin_declarar: [],
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
  it('cada grupo del backend cae en una de las tres pestañas', () => {
    expect(Object.fromEntries(Object.entries(GRUPOS_DE_VIAJES).map(([g, p]) => [g, p.pestana]))).toEqual({
      hoy: 'to_resolve', rezago: 'to_resolve', oferta_sin_declarar: 'to_resolve', abandonado: 'to_resolve',
      en_curso: 'tracking', pendiente_cierre_tms: 'tracking', con_motivo: 'resolved',
      incomplete_assignment: 'to_resolve',
    })
  })

  it('bloquean la firma hoy, rezago y la asignación incompleta del día, igual que `bloquean` de la API', () => {
    const delDia = viaje('t9', '1', { planning_date: '2026-10-10' })
    const deAntes = viaje('t9', '1', { planning_date: '2026-10-08' })
    const bloquean = (v: ViajeDelCierre) => Object.entries(GRUPOS_DE_VIAJES)
      .filter(([, p]) => p.bloqueaLaFirma(v, '2026-10-10')).map(([g]) => g).sort()
    expect(bloquean(delDia)).toEqual(['hoy', 'incomplete_assignment', 'rezago'])
    expect(bloquean(deAntes)).toEqual(['hoy', 'rezago'])
  })

  it('la asignación incompleta dice qué falta y se completa, no se declara', () => {
    const g = GRUPOS_DE_VIAJES.incomplete_assignment
    const v = viaje('t9', '1')
    expect(g.porQue({ ...v, missing_fleet: ['driver'] }, '2026-10-10')).toBe('Falta conductor')
    expect(g.porQue({ ...v, missing_fleet: ['tractor'] }, '2026-10-10')).toBe('Falta tracto')
    expect(g.porQue({ ...v, missing_fleet: ['tractor', 'driver'] }, '2026-10-10')).toBe('Falta tracto y conductor')
    expect(g.action).toBe('complete')
    const declarables = Object.entries(GRUPOS_DE_VIAJES)
      .filter(([, p]) => p.pestana === 'to_resolve' && p.action === 'declare').map(([k]) => k).sort()
    expect(declarables).toEqual(['abandonado', 'hoy', 'oferta_sin_declarar', 'rezago'])
  })

  it('el "por qué" dice cuántos días tiene el rezago', () => {
    const v = viaje('t9', '1', { planning_date: '2026-10-07' })
    expect(GRUPOS_DE_VIAJES.rezago.porQue(v, '2026-10-10')).toBe('Rezago · 3 días')
    expect(GRUPOS_DE_VIAJES.rezago.porQue({ ...v, planning_date: '2026-10-09' }, '2026-10-10')).toBe('Rezago · 1 día')
    expect(GRUPOS_DE_VIAJES.hoy.porQue(v, '2026-10-10')).toBe('Del día')
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
    const filas = filasDePestana({ hoy: [viaje('a', '20'), viaje('b', '10')] }, 'to_resolve')
    expect(filas.map(f => f.source_system_trip_id)).toEqual(['10', '20'])
  })

  it('un grupo que todavía no llega del backend no rompe nada', () => {
    expect(filasDePestana({ hoy: [viaje('t1', '1')] }, 'tracking')).toEqual([])
  })

  it('se abre en Por resolver si tiene viajes, y si no en En seguimiento', () => {
    expect(pestanaInicial(GRUPOS)).toBe('to_resolve')
    expect(pestanaInicial({ ...GRUPOS, hoy: [] })).toBe('tracking')
  })

  it('una patente con más de un viaje en la pestaña se marca con sus números', () => {
    const repetidas = viajesPorPatente(filasDePestana(GRUPOS, 'tracking'))
    expect([...repetidas.entries()]).toEqual([['PYST91', ['881496', '885613']]])
  })
})

describe('la bajada de Por resolver', () => {
  it('nombra los dos trabajos: declarar lo que no se tomó y completar la flota', () => {
    const porResolver = PESTANAS_DE_VIAJES.find(p => p.id === 'to_resolve')!
    expect(porResolver.bajada).toBe('Declara por qué no se tomó un viaje, o completa la flota de una asignación incompleta.')
  })
})
