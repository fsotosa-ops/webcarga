'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usersApi } from '@/lib/api/users'
import { accessApi } from '@/lib/api/access'
import UsersTable from '@/components/admin/UsersTable'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { LoadState } from './shared'

/** Configuración › Personas y accesos › Personas: quién entra, con qué roles
 *  y cómo. Los roles se cambian desde el menú de cada fila (maqueta aprobada
 *  09/10); qué hace cada rol se ve en la pestaña Roles.
 *
 *  Los datos vienen de la consulta, no de una copia en estado: tras un cambio se
 *  vuelven a pedir y la tabla muestra lo de la base (deuda del 11/10, clase
 *  "borrador sin resincronizar"). */
export function UsuariosTab() {
  const currentUserId = useAcceso().id
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const roles = useQuery({ queryKey: ['access-roles'], queryFn: accessApi.roles })
  const catalogo = useQuery({ queryKey: ['access-permissions'], queryFn: accessApi.permissions })

  const cargando = users.isPending || roles.isPending || catalogo.isPending
  const error = [users, roles, catalogo].find(q => q.isError)?.error
  if (cargando || error) {
    return (
      <LoadState loading={cargando} error={error ? (error instanceof Error ? error.message : 'Error al cargar') : null}
                 onRetry={() => { void users.refetch(); void roles.refetch(); void catalogo.refetch() }} />
    )
  }

  return (
    <UsersTable
      users={users.data!}
      currentUserId={currentUserId}
      roles={roles.data!}
      catalogo={catalogo.data!}
      onChanged={() => {
        void qc.invalidateQueries({ queryKey: ['users'] })
        void qc.invalidateQueries({ queryKey: ['access-roles'] })
        void qc.invalidateQueries({ queryKey: ['config-changes', 'people', 'users'] })
      }}
    />
  )
}
