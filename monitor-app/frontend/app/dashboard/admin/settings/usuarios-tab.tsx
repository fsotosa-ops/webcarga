'use client'

import { useEffect, useState } from 'react'
import { Users, ShieldAlert, CircleCheck, CircleOff } from 'lucide-react'
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

  const total     = profiles.length
  const activos   = profiles.filter(u => u.active !== false).length
  // Quienes administran: Propietario o Administración (RBAC).
  const priv      = profiles.filter(u => (u.roles ?? []).some(r => r === 'owner' || r === 'admin')).length
  const inactivos = total - activos


  return (
    <div className="space-y-4">
      {/* ── Stats row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Users,       label: 'Usuarios',  value: total,     iconBg: 'bg-slate-100', iconColor: 'text-slate-500'  },
          { icon: ShieldAlert, label: 'Administran', value: priv,      iconBg: 'bg-purple-50', iconColor: 'text-purple-500' },
          { icon: CircleCheck, label: 'Activos',   value: activos,   iconBg: 'bg-green-50',  iconColor: 'text-green-500'  },
          { icon: CircleOff,   label: 'Inactivos', value: inactivos, iconBg: 'bg-red-50',    iconColor: 'text-red-400'    },
        ].map(({ icon: Icon, label, value, iconBg, iconColor }) => (
          <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 shadow-sm">
            <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
              <Icon size={17} className={iconColor} />
            </div>
            <div>
              <p className="font-mulish font-bold text-2xl text-text-primary leading-none">{value}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

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
