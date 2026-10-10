import type { Acceso } from '@/lib/authz/acceso'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'

/** Catálogo chico para los tests de las pantallas de acceso. */
export function rol(code: string, name: string, permissions: string[], extra: Partial<RoleInfo> = {}): RoleInfo {
  return { id: `id-${code}`, code, name, description: '', is_system: true, grants_all: false, permissions, assigned: 0, ...extra }
}

export const CATALOGO: PermisoInfo[] = [
  { code: 'operations.read', area: 'operations', description: 'Ver viajes, el Monitor y el cierre del día', privileged: false },
  { code: 'closures.sign', area: 'operations', description: 'Firmar y reabrir el cierre del día', privileged: false },
  { code: 'closures.override', area: 'operations', description: 'Firmar el cierre del día con pendientes', privileged: false },
  { code: 'policies.edit', area: 'insurance', description: 'Crear y editar pólizas', privileged: false },
  { code: 'users.manage', area: 'admin', description: 'Invitar personas y asignar roles', privileged: true },
]

export const ROLES: RoleInfo[] = [
  rol('owner', 'Propietario (Super admin)', [], { grants_all: true, assigned: 2 }),
  rol('admin', 'Administración', ['operations.read', 'users.manage'], { assigned: 2 }),
  rol('reader', 'Lectura', ['operations.read'], { assigned: 3 }),
  rol('support', 'Soporte técnico (proveedor)', ['operations.read']),
  rol('operations_operator', 'Operador de Operaciones', ['operations.read', 'closures.sign'], { assigned: 4 }),
  rol('operations_supervisor', 'Supervisor de Operaciones', ['operations.read', 'closures.sign'], { assigned: 6 }),
  rol('insurance_operator', 'Operador de Seguros', ['operations.read', 'policies.edit']),
  rol('auditor', 'Auditor de cierres', ['operations.read', 'closures.override'], { is_system: false, assigned: 1 }),
]

/** Administración: puede dar todo menos Propietario y lo que incluya closures.override. */
export const ADMIN: Acceso = {
  id: 'actor', email: 'admin@webcarga.com', full_name: 'Admin', roles: ['admin', 'operations_supervisor'],
  role_names: ['Administración'], permissions: ['operations.read', 'closures.sign', 'policies.edit', 'users.manage'],
  aal: 'aal2',
}
