// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { puedeVerConfiguracion, tienePrivilegios, type Acceso } from './acceso'

const base: Acceso = { id: 'u', email: 'a@b.c', full_name: null, roles: [], role_names: [], permissions: [], aal: 'aal1' }

describe('puedeVerConfiguracion', () => {
  it('quien configura un área o administra ve Configuración', () => {
    for (const p of ['users.manage', 'roles.manage', 'settings.manage', 'operations.configure',
                     'certification.configure', 'insurance.configure'] as const) {
      expect(puedeVerConfiguracion({ ...base, permissions: [p] })).toBe(true)
    }
  })
  it('quien solo lee u opera no la ve', () => {
    expect(puedeVerConfiguracion({ ...base, permissions: ['operations.read', 'trips.edit_basic'] })).toBe(false)
  })
})

describe('tienePrivilegios', () => {
  it('administrar exige verificación en dos pasos; operar no', () => {
    expect(tienePrivilegios({ ...base, permissions: ['users.manage'] })).toBe(true)
    expect(tienePrivilegios({ ...base, permissions: ['closures.sign', 'operations.configure'] })).toBe(false)
  })
})
