import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/config', () => ({
  configApi: {
    getAlertThresholds: vi.fn(), patchAlertThreshold: vi.fn(),
    getTemperatureRanges: vi.fn(), createTemperatureRange: vi.fn(), patchTemperatureRange: vi.fn(), deleteTemperatureRange: vi.fn(),
    getMonitorAlertRules: vi.fn(), patchMonitorAlertRules: vi.fn(),
  },
  taxonomiesApi: {},
}))

import { configApi } from '@/lib/api/config'
import { monitorRulesSource, temperatureRangeSource, thresholdSource } from './settings-sources'

beforeEach(() => vi.clearAllMocks())

describe('thresholdSource (P1.4)', () => {
  it('Seguros: póliza por vencer, en su área, con aviso y crítico', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([
      { doc_type: 'documento_por_vencer', label: 'Aviso general', warning_days: 30, error_days: 0 },
      { doc_type: 'poliza_por_vencer', label: 'Póliza por vencer', warning_days: 30, error_days: 0 },
    ])
    const src = thresholdSource('poliza_por_vencer')
    expect([src.area, src.section]).toEqual(['insurance', 'expiry-alerts'])
    const filas = await src.list()
    expect(filas.map(f => f.id)).toEqual(['poliza_por_vencer'])
    expect(src.fields(filas[0]).map(f => f.key)).toEqual(['warning_days', 'error_days'])
    await src.save(filas[0], { warning_days: 45 })
    expect(configApi.patchAlertThreshold).toHaveBeenCalledWith('poliza_por_vencer', { warning_days: 45 })
  })

  it('el crítico tiene que ser menor que el aviso, antes de enviar', () => {
    const src = thresholdSource('documento_por_vencer')
    expect([src.area, src.section]).toEqual(['certification', 'expiry-alerts'])
    expect(src.validate!({ warning_days: 30, error_days: 30 })).toMatch(/menor que el aviso/)
    expect(src.validate!({ warning_days: 30, error_days: 7 })).toBeNull()
  })
})

describe('temperatureRangeSource', () => {
  it('crear pide el tipo de carga; editar no; se borra (no se desactiva)', async () => {
    const src = temperatureRangeSource
    expect(src.fields(undefined).map(f => f.key)).toEqual(['cargo_type', 'label', 'min_c', 'max_c'])
    const fila = { id: 'congelado', cargo_type: 'congelado', label: 'Congelado', min_c: -25, max_c: -18 }
    expect(src.fields(fila).map(f => f.key)).toEqual(['label', 'min_c', 'max_c'])
    await src.create!.run({ cargo_type: 'seco', label: 'Seco', min_c: 5, max_c: 25 })
    expect(configApi.createTemperatureRange).toHaveBeenCalledWith({ cargo_type: 'seco', label: 'Seco', min_c: 5, max_c: 25 })
    expect(src.deactivate!.label).toBe('Borrar')
    await src.deactivate!.run(fila)
    expect(configApi.deleteTemperatureRange).toHaveBeenCalledWith('congelado')
    expect(src.validate!({ min_c: 5, max_c: 2 })).toMatch(/mínimo/)
    expect(src.validate!({ min_c: null, max_c: 2 })).toMatch(/Completa/)
  })
})

describe('monitorRulesSource', () => {
  it('cada regla es una fila y se guardan de a una', async () => {
    vi.mocked(configApi.getMonitorAlertRules).mockResolvedValue({
      stale_report_hours: 4, tms_dropped_hours: 3, dwell_yellow_min: 30, dwell_orange_min: 60, dwell_red_min: 90,
      in_progress_idle_days: 3, stale_trip_days: null, dwell_hours: 2, late_arrival_grace_min: 15, unassigned_enabled: true,
    } as never)
    const filas = await monitorRulesSource.list()
    expect(filas.map(f => f.id)).toContain('stale_report_hours')
    expect(filas.map(f => f.id)).not.toContain('dwell_hours')
    const regla = filas.find(f => f.id === 'dwell_red_min')!
    await monitorRulesSource.save(regla, { value: 120 })
    expect(configApi.patchMonitorAlertRules).toHaveBeenCalledWith({ dwell_red_min: 120 })
  })
})

describe('thresholdSource: cada umbral con su caché (revisión final #1)', () => {
  it('Certificación y Seguros no comparten la clave: uno no puede mostrar ni guardar el del otro', () => {
    const doc = thresholdSource('documento_por_vencer').queryKey
    const pol = thresholdSource('poliza_por_vencer').queryKey
    expect(doc).not.toEqual(pol)
    // Mismo prefijo: guardar uno invalida los dos.
    expect(doc.slice(0, 2)).toEqual(pol.slice(0, 2))
  })
})

describe('#10: un número obligatorio vacío se dice antes de enviar', () => {
  it('umbral: los dos plazos son obligatorios', () => {
    expect(thresholdSource('poliza_por_vencer').validate!({ warning_days: null, error_days: 0 })).toMatch(/Completa/)
  })
  it('regla del Monitor: obligatoria salvo la opcional', async () => {
    vi.mocked(configApi.getMonitorAlertRules).mockResolvedValue({ stale_report_hours: 4, stale_trip_days: null } as never)
    const filas = await monitorRulesSource.list()
    const obligatoria = filas.find(f => f.id === 'stale_report_hours')!
    const opcional = filas.find(f => f.id === 'stale_trip_days')!
    expect(monitorRulesSource.validate!({ value: null }, obligatoria)).toMatch(/Completa/)
    expect(monitorRulesSource.validate!({ value: null }, opcional)).toBeNull()
  })
})

