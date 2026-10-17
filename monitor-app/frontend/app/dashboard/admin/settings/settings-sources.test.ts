import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/config', () => ({
  configApi: { getStatuses: vi.fn(), patchStatus: vi.fn(), moveStatus: vi.fn() },
  taxonomiesApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), move: vi.fn(), deactivate: vi.fn() },
}))

import { configApi, taxonomiesApi } from '@/lib/api/config'
import { tripStatusSource, vocabularySource } from './settings-sources'

const ESTADO = { id: 'VIAJE EN PREDIO', label: 'Viaje en Predio', group: 'en_local', sort_order: 5 }
const MOTIVO = { id: 'm1', label: 'Panne', group: 'no_trabajando', sort_order: 1, active: true, code: null }

beforeEach(() => vi.clearAllMocks())

describe('tripStatusSource (estados del viaje)', () => {
  it('se edita el nombre visible y la columna; el orden se mueve; no se crea ni se desactiva', async () => {
    const src = tripStatusSource
    expect(src.fields(undefined).map(f => f.key)).toEqual(['label', 'group'])
    const columna = src.fields(undefined).find(f => f.key === 'group')!
    expect(columna.kind === 'select' && columna.options.map(o => o.id)).toContain('pendiente_cierre_tms')
    await src.save(ESTADO as never, { group: 'problema' })
    expect(configApi.patchStatus).toHaveBeenCalledWith('VIAJE EN PREDIO', { group: 'problema' })
    await src.move!(ESTADO as never, 'up')
    expect(configApi.moveStatus).toHaveBeenCalledWith('VIAJE EN PREDIO', 'up')
    expect(src.create).toBeUndefined()
    expect(src.deactivate).toBeUndefined()
  })
})

describe('vocabularySource', () => {
  it('Motivos de conductor ofrece "Qué significa" con sus dos opciones y crea con el grupo', async () => {
    const src = vocabularySource('DRIVER_REASON')
    const grupo = src.fields(undefined).find(f => f.key === 'group')!
    expect(grupo.label).toBe('Qué significa')
    expect(grupo.kind === 'select' && grupo.options.map(o => o.label)).toEqual(['No trabajó', 'Trabajó sin asignación'])
    await src.create!.run({ label: 'Licencia', group: 'no_trabajando' })
    expect(taxonomiesApi.create).toHaveBeenCalledWith({ domain: 'DRIVER_REASON', label: 'Licencia', group: 'no_trabajando' })
    await src.deactivate!.run(MOTIVO as never)
    expect(taxonomiesApi.deactivate).toHaveBeenCalledWith('m1')
  })

  it('Estados operacionales eligen la etapa del viaje', () => {
    const grupo = vocabularySource('OPERATIONAL_STATE').fields(undefined).find(f => f.key === 'group')!
    expect(grupo.label).toBe('Etapa')
  })

  it('Motivos de anulación no tienen grupo', () => {
    expect(vocabularySource('TRIP_VOID_REASON').fields(undefined).map(f => f.key)).toEqual(['label'])
  })

  it('ninguna fuente envía colores', async () => {
    const src = vocabularySource('EQUIPMENT_STATE')
    await src.save(MOTIVO as never, { label: 'Disponible' })
    await src.create!.run({ label: 'En pana' })
    for (const llamada of [...vi.mocked(taxonomiesApi.patch).mock.calls, ...vi.mocked(taxonomiesApi.create).mock.calls]) {
      expect(JSON.stringify(llamada)).not.toMatch(/color/)
    }
  })
})
