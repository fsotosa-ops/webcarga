import { describe, it, expect } from 'vitest'
import { inScope } from './scope'

describe('inScope', () => {
  it('lo de un alcance se ve solo en ese; lo que no tiene alcance (sin tracto, de empresa), en los dos (D6)', () => {
    expect(inScope('tractoreo', 'tractoreo')).toBe(true)
    expect(inScope('equipo_completo', 'tractoreo')).toBe(false)
    expect(inScope(null, 'equipo_completo')).toBe(true)
    expect(inScope(undefined, 'tractoreo')).toBe(true)
  })
})
