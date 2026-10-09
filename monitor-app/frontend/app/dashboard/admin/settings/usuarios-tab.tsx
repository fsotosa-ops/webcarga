'use client'

import { useEffect, useState } from 'react'
import { Users, ShieldAlert, CircleCheck, CircleOff } from 'lucide-react'
import { usersApi } from '@/lib/api/users'
import { fetchRoles, type RoleInfo } from '@/lib/api/roles'
import type { Profile } from '@/lib/types'
import UsersTable from '@/components/admin/UsersTable'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { LoadState } from './shared'

/** Mudanza de app/dashboard/admin/usuarios/page.tsx (Configuración por
 *  dominios, Task 6). El original era un Server Component (Supabase server
 *  + fetchRolesServer, con cookies via next/headers). La página del dominio
 *  que aloja este panel es 'use client' (Task 3) y elige el panel activo con
 *  useState, así que no puede instanciar un Server Component ahí adentro —
 *  Next.js rompe el build al intentar empaquetar next/headers para el
 *  navegador. Por eso los datos se piden desde el cliente, con las mismas
 *  fuentes que ya usa UsersTable para mutar (usersApi) y que ya expone
 *  lib/api/roles para el caso cliente (fetchRoles, hermana de
 *  fetchRolesServer). Los cálculos y la interfaz de abajo son los mismos
 *  que en el original — sólo cambia de dónde se piden los datos. */
export function UsuariosTab() {
  const currentUserId = useAcceso().id
  const [profiles, setProfiles]           = useState<Profile[] | null>(null)
  const [roles, setRoles]                 = useState<RoleInfo[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([usersApi.list(), fetchRoles()])
      .then(([users, rolesList]) => {
        setProfiles(users)
        setRoles(rolesList)
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

  // Cuántas personas tiene cada rol (los que tienen alguna).
  const conPersonas = roles.filter(r => r.assigned > 0)

  return (
    <div className="space-y-4">
      {/* ── Role distribution pills ──────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {conPersonas.map(r => (
          <span key={r.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border border-border bg-bg-main text-text-primary">
            {r.assigned} {r.name}
          </span>
        ))}
      </div>

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

      {/* ── Roles: qué hace cada uno (la jerarquía dejó de existir: RBAC) ── */}
      <div className="bg-white rounded-xl border border-border px-5 py-4">
        <p className="text-[11px] font-bold text-informativo uppercase tracking-widest mb-3">Roles</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {roles.map(r => (
            <li key={r.id} className="text-sm">
              <span className="font-semibold text-text-primary">{r.name}</span>
              <span className="text-informativo"> · {r.description}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Users table ───────────────────────────────────────────── */}
      <UsersTable
        users={profiles}
        currentUserId={currentUserId}
        roles={roles}
      />
    </div>
  )
}
