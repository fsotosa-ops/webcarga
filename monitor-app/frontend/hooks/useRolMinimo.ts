'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { hasRole, type UserRole } from '@/lib/types'

/** Si la persona conectada alcanza este nivel de permiso.
 *
 *  **Es UNA implementación parametrizada, no dos hooks parecidos.** Antes
 *  `useCanEdit` y `useCanAdmin` eran el mismo cuerpo copiado cambiando el
 *  conjunto de roles, y además **cuatro páginas lo reescribían entero adentro
 *  de un `useEffect`** — sesión, consulta del perfil y comparación, a mano. En
 *  total, nueve enumeraciones de la jerarquía en siete archivos.
 *
 *  Eso no es sólo repetición: agregar un rol obligaba a acordarse de siete
 *  lugares, y olvidarse de uno **no rompe nada**. Simplemente esa pantalla le
 *  niega permiso a alguien que sí lo tiene, sin error y sin aviso.
 *
 *  La jerarquía vive en `hasRole` (`lib/types.ts`) — que hasta ahora estaba
 *  escrita y sin llamadores, mientras sus ocho copias vivían sueltas.
 *
 *  Se parametriza por el **mínimo** y no por un conjunto a propósito: los
 *  permisos son acumulativos —un owner puede lo que puede un editor— y un
 *  conjunto obliga a repetir esa verdad en cada declaración. */
export function useRolMinimo(minimo: UserRole): boolean {
  const [alcanza, setAlcanza] = useState(false)

  useEffect(() => {
    let vigente = true
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      // `vigente` evita escribir estado sobre un componente ya desmontado: la
      // consulta es asíncrona y el usuario puede cambiar de pantalla antes.
      // Las cuatro copias a mano no lo tenían.
      if (vigente && hasRole(profile?.role, minimo)) setAlcanza(true)
    })
    return () => { vigente = false }
  }, [minimo])

  return alcanza
}
