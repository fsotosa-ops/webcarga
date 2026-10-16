'use client'

import { useEffect, useState } from 'react'
import { usersApi } from '@/lib/api/users'
import { accessApi, type PermisoInfo, type RoleInfo } from '@/lib/api/access'
import type { Profile } from '@/lib/types'
import UsersTable from '@/components/admin/UsersTable'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { LoadState } from './shared'

/** Configuración › Personas y accesos › Personas: quién entra, con qué roles
 *  y cómo. Los roles se cambian desde el menú de cada fila (maqueta aprobada
 *  09/10); qué hace cada rol se ve en la pestaña Roles. */
export function UsuariosTab() {
  const currentUserId = useAcceso().id
  const [profiles, setProfiles]           = useState<Profile[] | null>(null)
  const [roles, setRoles]                 = useState<RoleInfo[]>([])
  const [catalogo, setCatalogo]           = useState<PermisoInfo[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([usersApi.list(), accessApi.roles(), accessApi.permissions()])
      .then(([users, rolesList, permisos]) => {
        setProfiles(users)
        setRoles(rolesList)
        setCatalogo(permisos)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error al cargar'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  if (loading || error || !profiles) {
    return <LoadState loading={loading} error={error} onRetry={load} />
  }

  return (
    <div className="space-y-4">
      {/* ── Users table ───────────────────────────────────────────── */}
      <UsersTable
        users={profiles}
        currentUserId={currentUserId}
        roles={roles}
        catalogo={catalogo}
      />
    </div>
  )
}
