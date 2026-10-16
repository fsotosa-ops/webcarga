import { describe, it, expect } from 'vitest'
import { buildNotices } from './closureNotices'
import type { PreCierreEscalations } from '@/lib/types'

const VACIAS: PreCierreEscalations = {
  PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
  EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
}

describe('buildNotices', () => {
  it('una fila por aviso, en el orden de siempre: la propuesta primero, la dotación al final', () => {
    const avisos = buildNotices({
      ...VACIAS,
      CONDUCTOR_NO_REGISTRADO: [{ driver_rut: '8245112-9', driver_name_tms: 'JAIME VIDAL', scope: null }],
      PATENTE_NO_REGISTRADA: [{ tractor_plate: 'GPRZ30', reason: 'Sin empresa', tms_carrier_name: 'BUGARIN', scope: 'tractoreo' }],
      CONDUCTOR_SIN_EMPRESA: [{ driver_id: 'd1', driver_name: 'Gerson Ferrada', carrier_id: 'c1', carrier_name: 'Juan Ramirez',
        viajes: 2, trips: [{ id: 't1', code: '30' }, { id: 't2', code: '31' }], scope: 'equipo_completo' }],
    }, [{ carrier_id: 'c7', business_name: 'Hasa Spa', n_tractos: 4, n_conductores: 2, gap: 2 }])

    expect(avisos.map(a => [a.type, a.subject, a.carrier, a.scope])).toEqual([
      ['CONDUCTOR_SIN_EMPRESA', 'Gerson Ferrada', 'Juan Ramirez', 'equipo_completo'],
      ['PATENTE_NO_REGISTRADA', 'GPRZ30', 'BUGARIN', 'tractoreo'],
      ['CONDUCTOR_NO_REGISTRADO', 'RUT 8245112-9', null, null],
      ['FLEET_DRIVER_GAP', 'Hasa Spa', 'Hasa Spa', null],
    ])
    expect(avisos[0].trips.map(t => t.code)).toEqual(['30', '31'])
    expect(new Set(avisos.map(a => a.key)).size).toBe(4)
  })

  it('cada detalle dice la consecuencia con las palabras de hoy', () => {
    const [sinTipo, dotacion] = buildNotices({
      ...VACIAS, SIN_TIPO_OPERACION: [{ carrier_id: 'c5', carrier_name: 'Rios Ltda', tractor_plate: 'HKXW55' }],
    }, [{ carrier_id: 'c7', business_name: 'Hasa Spa', n_tractos: 4, n_conductores: 6, gap: -2 }])
    expect(sinTipo.subject).toBe('HKXW55')
    expect(sinTipo.detail).toMatch(/bloquea el cierre del día/)
    expect(dotacion.detail).toBe('2 conductores de más · 4 tractos / 6 conductores')
  })

  it('una clave que el backend todavía no manda no rompe la lista', () => {
    const { CONDUCTOR_NO_REGISTRADO: _, ...sinLaClave } = VACIAS
    expect(buildNotices(sinLaClave as PreCierreEscalations, undefined)).toEqual([])
  })
})
