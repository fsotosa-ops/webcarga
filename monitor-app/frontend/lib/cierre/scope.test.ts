import { describe, it, expect } from 'vitest'
import { inScope, scopeGap } from './scope'

describe('inScope', () => {
  it('lo de un alcance se ve solo en ese; lo que no tiene alcance (sin tracto, de empresa), en los dos (D6)', () => {
    expect(inScope('tractoreo', 'tractoreo')).toBe(true)
    expect(inScope('equipo_completo', 'tractoreo')).toBe(false)
    expect(inScope(null, 'equipo_completo')).toBe(true)
    expect(inScope(undefined, 'tractoreo')).toBe(true)
  })

  it('sin alcance se explica: sin tracto, o un tracto del directorio sin tipo de operación', () => {
    expect(scopeGap({ scope: null, tractor_plate: null, tractor_asset_id: null })).toBe('NO_TRACTOR')
    expect(scopeGap({ scope: null, tractor_plate: 'ABCD12', tractor_asset_id: 'a1' })).toBe('NO_OPERATION_TYPE')
    // Una patente que el directorio no conoce: ya lo dice su celda.
    expect(scopeGap({ scope: null, tractor_plate: 'ZZZZ99', tractor_asset_id: null })).toBeNull()
    expect(scopeGap({ scope: 'tractoreo', tractor_plate: 'ABCD12', tractor_asset_id: 'a1' })).toBeNull()
    expect(scopeGap({ tractor_plate: null })).toBeNull()
  })
})
