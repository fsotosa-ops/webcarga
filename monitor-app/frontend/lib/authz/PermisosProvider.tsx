'use client'

import { createContext, useContext } from 'react'
import type { Acceso } from './acceso'
import type { PermissionCode } from './permisos.generated'

const Contexto = createContext<Acceso | null>(null)

/** Los permisos de la persona, tal como los calcula la API (GET /me). El
 *  layout del dashboard los obtiene una vez en el servidor; ninguna pantalla
 *  repite reglas de rol. */
export function PermisosProvider({ acceso, children }: { acceso: Acceso; children: React.ReactNode }) {
  return <Contexto.Provider value={acceso}>{children}</Contexto.Provider>
}

export function useAcceso(): Acceso {
  const acceso = useContext(Contexto)
  if (!acceso) throw new Error('useAcceso fuera de PermisosProvider')
  return acceso
}

export function usePermiso(permiso: PermissionCode): boolean {
  return useAcceso().permissions.includes(permiso)
}
