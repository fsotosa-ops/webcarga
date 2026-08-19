'use client'

import { useRolMinimo } from './useRolMinimo'

/** Si puede administrar: admin para arriba. Ver `useCanEdit` para por qué
 *  sigue teniendo nombre propio. */
export function useCanAdmin(): boolean {
  return useRolMinimo('admin')
}
