import { PERMISOS, type PermissionCode } from './permisos.generated'

export type Acceso = {
  id: string
  email: string
  full_name: string | null
  roles: string[]
  /** Nombres de los roles, para mostrar (GET /me). */
  role_names: string[]
  permissions: PermissionCode[]
  aal: 'aal1' | 'aal2' | null
}

/** Cómo se nombra a quien está conectado: su nombre o, sin él, la parte local
 *  del correo. Una sola definición para la barra lateral y la del teléfono. */
export function getDisplayName(acceso: Pick<Acceso, 'full_name' | 'email'>): string {
  return acceso.full_name?.trim() || acceso.email.split('@')[0] || 'Usuario'
}

const CONFIGURAN: PermissionCode[] = [
  'users.manage', 'roles.manage', 'settings.manage',
  'operations.configure', 'certification.configure', 'insurance.configure',
]

/** Si ve Configuración: administra o configura alguna área. Cada sección
 *  muestra solo lo que su permiso le deja tocar. */
export function puedeVerConfiguracion(acceso: Acceso): boolean {
  return acceso.permissions.some(p => CONFIGURAN.includes(p))
}

/** Si alguno de sus permisos exige verificación en dos pasos (aal2). */
export function tienePrivilegios(acceso: Acceso): boolean {
  return acceso.permissions.some(p => PERMISOS[p]?.privileged)
}

/** La misma regla que valida la API al invitar o cambiar roles
 *  (assert_can_grant): un Propietario da cualquier rol; los demás, solo roles
 *  cuyos permisos ya tienen, y nunca Propietario. Acá solo decide qué se ofrece. */
export function puedeOtorgar(acceso: Acceso, rol: { code: string; grants_all: boolean; permissions: string[] }): boolean {
  if (acceso.roles.includes('owner')) return true
  if (rol.grants_all || rol.code === 'owner') return false
  return rol.permissions.every(p => (acceso.permissions as string[]).includes(p))
}
