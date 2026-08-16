'use client'

import { useEffect, useState } from 'react'
import { Users, ShieldAlert, CircleCheck, CircleOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usersApi } from '@/lib/api/users'
import { fetchRoles, type RoleInfo } from '@/lib/api/roles'
import type { Profile, UserRole } from '@/lib/types'
import UsersTable from '@/components/admin/UsersTable'
import { LoadState } from './shared'

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  viewer: { bg: 'bg-gray-100',   text: 'text-gray-600'   },
  writer: { bg: 'bg-blue-50',    text: 'text-blue-700'   },
  editor: { bg: 'bg-teal-50',    text: 'text-teal-700'   },
  admin:  { bg: 'bg-purple-50',  text: 'text-purple-700' },
  owner:  { bg: 'bg-amber-50',   text: 'text-amber-700'  },
}

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
  const [profiles, setProfiles]           = useState<Profile[] | null>(null)
  const [roles, setRoles]                 = useState<RoleInfo[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([usersApi.list(), fetchRoles(), createClient().auth.getUser()])
      .then(([users, rolesList, { data }]) => {
        setProfiles(users)
        setRoles(rolesList)
        setCurrentUserId(data.user?.id ?? '')
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Error al cargar'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  if (loading || error || !profiles) {
    return <LoadState loading={loading} error={error} onRetry={load} />
  }

  const actorProfile = profiles.find(p => p.id === currentUserId)
  const actorRole     = (actorProfile?.role ?? 'admin') as UserRole

  const total     = profiles.length
  const activos   = profiles.filter(u => u.active !== false).length
  const priv      = profiles.filter(u => u.role === 'admin' || u.role === 'owner').length
  const inactivos = total - activos

  // Role distribution (desc: highest privilege first)
  const byRole = [...roles].reverse()

  return (
    <div className="space-y-4">
      {/* ── Role distribution pills ──────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {byRole.map(r => {
          const count = profiles.filter(u => u.role === r.id).length
          if (!count) return null
          const badge = ROLE_BADGE[r.id] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
          return (
            <span key={r.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.bg} ${badge.text}`}>
              {count} {r.label}
            </span>
          )
        })}
      </div>

      {/* ── Stats row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Users,       label: 'Usuarios',  value: total,     iconBg: 'bg-slate-100', iconColor: 'text-slate-500'  },
          { icon: ShieldAlert, label: 'Admin+',    value: priv,      iconBg: 'bg-purple-50', iconColor: 'text-purple-500' },
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

      {/* ── Role legend ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-border px-5 py-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
          Jerarquía de permisos
        </p>
        <div className="flex items-start gap-2 flex-wrap">
          {roles.map((r, i) => {
            const badge = ROLE_BADGE[r.id] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
            return (
              <div key={r.id} className="flex items-center gap-1.5">
                <div className="text-center">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>{r.label}</span>
                  <p className="text-[10px] text-gray-400 mt-0.5 max-w-[80px] text-center leading-tight">{r.description}</p>
                </div>
                {i < roles.length - 1 && (
                  <span className="text-gray-200 text-sm mb-4">→</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Users table ───────────────────────────────────────────── */}
      <UsersTable
        users={profiles}
        currentUserId={currentUserId}
        actorRole={actorRole}
        roles={roles}
      />
    </div>
  )
}
