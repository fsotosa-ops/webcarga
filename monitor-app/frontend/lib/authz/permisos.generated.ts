// GENERADO por backend/api/scripts/generar_permisos_ts.py desde app/authz/permissions.py.
// No editar a mano: el test test_permisos_ts_en_sincronia.py falla si queda desfasado.
export const PERMISOS = {
  'operations.read': { area: 'operations', privileged: false },
  'trips.edit_basic': { area: 'operations', privileged: false },
  'trips.edit_sensitive': { area: 'operations', privileged: false },
  'trips.create': { area: 'operations', privileged: false },
  'trips.delete': { area: 'operations', privileged: false },
  'trips.delete_any': { area: 'operations', privileged: false },
  'closures.declare': { area: 'operations', privileged: false },
  'closures.sign': { area: 'operations', privileged: false },
  'closures.override': { area: 'operations', privileged: false },
  'operations.configure': { area: 'operations', privileged: false },
  'directory.read': { area: 'directory', privileged: false },
  'directory.edit': { area: 'directory', privileged: false },
  'directory.delete': { area: 'directory', privileged: false },
  'certification.read': { area: 'certification', privileged: false },
  'documents.upload': { area: 'certification', privileged: false },
  'documents.review': { area: 'certification', privileged: false },
  'certification.configure': { area: 'certification', privileged: false },
  'insurance.read': { area: 'insurance', privileged: false },
  'policies.edit': { area: 'insurance', privileged: false },
  'policies.delete': { area: 'insurance', privileged: false },
  'insurance.configure': { area: 'insurance', privileged: false },
  'commercial.read': { area: 'commercial', privileged: false },
  'commercial.edit': { area: 'commercial', privileged: false },
  'reference.read': { area: 'reference', privileged: false },
  'users.manage': { area: 'admin', privileged: true },
  'roles.manage': { area: 'admin', privileged: true },
  'settings.manage': { area: 'admin', privileged: true },
} as const

export type PermissionCode = keyof typeof PERMISOS
