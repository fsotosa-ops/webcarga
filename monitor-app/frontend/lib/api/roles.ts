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

export async function fetchRoles(): Promise<RoleInfo[]> {
  const res = await fetch('/api/v1/roles')
  if (!res.ok) throw new Error(`Error ${res.status} al cargar roles`)
  return res.json()
}
