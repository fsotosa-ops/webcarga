import { apiFetch } from './client'
import type { PermissionCode } from '@/lib/authz/permisos.generated'

/** Un permiso del catálogo (GET /permissions): se define en el código. */
export type PermisoInfo = {
  code:        PermissionCode
  area:        string
  description: string
  /** Exige verificación en dos pasos. */
  privileged:  boolean
}

/** Un rol (GET /roles, RBAC): de sistema o personalizado, con sus permisos. */
export type RoleInfo = {
  id:          string
  code:        string
  name:        string
  description: string
  is_system:   boolean
  /** Propietario: todo el catálogo. */
  grants_all:  boolean
  permissions: string[]
  /** Personas con este rol. */
  assigned:    number
}

export type RoleIn = { code: string; name: string; description: string; permissions: string[] }
export type RolePatch = Partial<Omit<RoleIn, 'code'>>

/** Administración de acceso (spec RBAC §6). Las reglas (escalada, último
 *  Propietario, roles de sistema inmutables) las aplica la API; acá solo se
 *  muestra su mensaje. */
export const accessApi = {
  permissions: () => apiFetch<PermisoInfo[]>('/api/v1/permissions'),
  roles:       () => apiFetch<RoleInfo[]>('/api/v1/roles'),
  createRole:  (body: RoleIn) =>
    apiFetch<RoleInfo>('/api/v1/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateRole:  (id: string, body: RolePatch) =>
    apiFetch<RoleInfo>(`/api/v1/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRole:  (id: string) =>
    apiFetch<void>(`/api/v1/roles/${id}`, { method: 'DELETE' }),
  setUserRoles: (userId: string, roles: string[]) =>
    apiFetch<{ roles: string[] }>(`/api/v1/users/${userId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) }),
}
