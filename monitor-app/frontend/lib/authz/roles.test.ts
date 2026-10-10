import { describe, it, expect } from 'vitest'
import { conNivel, diferencia, motivoNoOtorgable, nivelEnArea, permisosDe } from './roles'
import type { Acceso } from './acceso'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'

function rol(code: string, permissions: string[], grants_all = false): RoleInfo {
  return { id: code, code, name: code, description: '', is_system: true, grants_all, permissions, assigned: 0 }
}
const CATALOGO: PermisoInfo[] = [
  { code: 'operations.read', area: 'operations', description: 'Ver viajes', privileged: false },
  { code: 'closures.sign', area: 'operations', description: 'Firmar y reabrir el cierre del día', privileged: false },
  { code: 'closures.override', area: 'operations', description: 'Firmar el cierre del día con pendientes', privileged: false },
]
const ROLES = [
  rol('owner', [], true),
  rol('reader', ['operations.read']),
  rol('operations_operator', ['operations.read', 'closures.sign']),
  rol('operations_supervisor', ['operations.read', 'closures.sign']),
  rol('auditor', ['operations.read', 'closures.override']),
]
const ADMIN: Acceso = {
  id: 'a', email: 'a@x.cl', full_name: null, roles: ['admin'], role_names: [],
  permissions: ['operations.read', 'closures.sign'], aal: 'aal2',
}

describe('nivel por área', () => {
  it('el Supervisor manda sobre el Operador', () => {
    expect(nivelEnArea(['operations_operator', 'operations_supervisor'], 'operations')).toBe('supervisor')
    expect(nivelEnArea(['reader'], 'operations')).toBe('none')
  })
  it('cambiar de nivel reemplaza los dos roles del área y no toca el resto', () => {
    expect(conNivel(['reader', 'operations_operator', 'operations_supervisor'], 'operations', 'operator'))
      .toEqual(['reader', 'operations_operator'])
    expect(conNivel(['reader', 'operations_operator'], 'operations', 'none')).toEqual(['reader'])
  })
})

describe('motivoNoOtorgable', () => {
  it('Propietario solo lo da otro Propietario', () => {
    expect(motivoNoOtorgable(ADMIN, ROLES[0], CATALOGO)).toBe('Solo un Propietario puede dar este rol')
  })
  it('nombra el permiso que falta', () => {
    expect(motivoNoOtorgable(ADMIN, ROLES[4], CATALOGO))
      .toBe('Incluye permisos que tú no tienes: Firmar el cierre del día con pendientes')
  })
  it('un rol que puede dar no tiene motivo', () => {
    expect(motivoNoOtorgable(ADMIN, ROLES[2], CATALOGO)).toBeNull()
  })
  it('un Propietario lo da todo', () => {
    expect(motivoNoOtorgable({ ...ADMIN, roles: ['owner'] }, ROLES[0], CATALOGO)).toBeNull()
  })
})

describe('diferencia de permisos', () => {
  it('dice qué gana y qué pierde, sin repetir lo que ya tenía por otro rol', () => {
    const antes = permisosDe(ROLES, ['reader'], CATALOGO)
    const despues = permisosDe(ROLES, ['operations_operator'], CATALOGO)
    expect(diferencia(antes, despues)).toEqual({ gana: ['closures.sign'], pierde: [] })
  })
  it('Propietario da todo el catálogo', () => {
    expect(permisosDe(ROLES, ['owner'], CATALOGO).size).toBe(3)
  })
})
