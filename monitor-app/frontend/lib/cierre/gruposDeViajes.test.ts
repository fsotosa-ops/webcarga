import { describe, it, expect } from 'vitest'
import type { ViajeDelCierre } from '@/lib/types'
import {
  GRUPOS_DE_VIAJES, diasAtras, esPestanaDeViajes, filasDePestana, pestanaInicial, viajesPorPatente,
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
    })
  })

  it('solo hoy y rezago bloquean la firma, igual que `bloquean` de la API', () => {
    const bloquean = Object.entries(GRUPOS_DE_VIAJES).filter(([, p]) => p.bloqueaLaFirma).map(([g]) => g)
    expect(bloquean.sort()).toEqual(['hoy', 'rezago'])
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

  it('reconoce solo las pestañas que existen', () => {
    expect(esPestanaDeViajes('resolved')).toBe(true)
    expect(esPestanaDeViajes('xyz')).toBe(false)
    expect(esPestanaDeViajes(null)).toBe(false)
  })
})
