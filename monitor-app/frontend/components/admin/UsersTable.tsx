'use client'

import { useState, useTransition } from 'react'
import CreateUserForm from './CreateUserForm'
import type { Profile } from '@/lib/types'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import type { RoleInfo } from '@/lib/api/roles'
import { usersApi } from '@/lib/api/users'
import {
  UserPlus, Trash2, Search,
  ShieldCheck, UserCheck, UserX, MoreHorizontal
} from 'lucide-react'

const METODO: Record<string, string> = { google: 'Google', azure: 'Microsoft', email: 'Email' }

type FilterTab = 'all' | 'privileged' | 'active' | 'inactive'

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = name ?? email ?? '?'
  return source.split(/[\s@]+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join('')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  users:         Profile[]
  currentUserId: string
  roles:         RoleInfo[]
}

/** Administran: Propietario o Administración (RBAC). */
function administra(u: Profile): boolean {
  return (u.roles ?? []).some(r => r === 'owner' || r === 'admin')
}

export default function UsersTable({ users: initial, currentUserId, roles }: Props) {
  const puedeGestionar = usePermiso('users.manage')
  const [users,         setUsers]         = useState(initial)
  const [showCreate,    setShowCreate]    = useState(false)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)
  const [actionMenuId,  setActionMenuId]  = useState<string | null>(null)
  const [search,        setSearch]        = useState('')
  const [tab,           setTab]           = useState<FilterTab>('all')
  const [, startTransition]              = useTransition()

  function updateLocal(id: string, patch: Partial<Profile>) {
    setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)))
  }

  function toggleActive(user: Profile) {
    const next = !user.active
    setActionMenuId(null)
    updateLocal(user.id, { active: next })
    startTransition(async () => {
      try { await usersApi.patch(user.id, { active: next }) }
      catch { updateLocal(user.id, { active: user.active }) }
    })
  }

  async function handleDelete(user: Profile) {
    if (!confirm(`¿Eliminar permanentemente a ${user.full_name ?? user.email}?\nEsta acción no se puede deshacer.`)) return
    setActionMenuId(null)
    setDeletingId(user.id)
    try {
      await usersApi.remove(user.id)
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'No se pudo eliminar'}`)
      setDeletingId(null)
    }
  }

  // Filtering
  const byTab = users.filter(u => {
    if (tab === 'privileged') return administra(u)
    if (tab === 'active')     return u.active !== false
    if (tab === 'inactive')   return u.active === false
    return true
  })
  const filtered = byTab.filter(u =>
    `${u.full_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const tabCounts = {
    all:        users.length,
    privileged: users.filter(administra).length,
    active:     users.filter(u => u.active !== false).length,
    inactive:   users.filter(u => u.active === false).length,
  }

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all',        label: 'Todos'      },
    { key: 'privileged', label: 'Administran' },
    { key: 'active',     label: 'Activos'    },
    { key: 'inactive',   label: 'Inactivos'  },
  ]

  return (
    <>
      {showCreate && (
        <CreateUserForm
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); window.location.reload() }}
        />
      )}

      {/* Close dropdowns on outside click */}
      {actionMenuId && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setActionMenuId(null)}
        />
      )}

      <div className="bg-white rounded-2xl border border-border overflow-hidden">

        {/* ── Table header ─────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-[280px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre o email…"
                className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30"
              />
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/90 transition-colors shrink-0"
            >
              <UserPlus size={14} />
              Crear usuario
            </button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-0 mt-3 border-b border-border -mb-4 pt-0.5">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-2.5 px-1 mr-5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  tab === t.key ? 'bg-accent/10 text-accent' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 680 }}>
            <thead>
              <tr className="border-b border-border bg-gray-50/60">
                {['Usuario', 'Rol', 'Estado', 'Último ingreso', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(user => {
                // Las reglas finas (Propietarios, último Propietario) las aplica la API.
                const manageable = user.id !== currentUserId && puedeGestionar
                const nombresDeRol = (user.roles ?? []).map(c => roles.find(r => r.code === c)?.name ?? c)
                const isMe       = user.id === currentUserId
                const initStr    = initials(user.full_name, user.email)

                return (
                  <tr
                    key={user.id}
                    className={`group transition-colors hover:bg-gray-50/60 ${deletingId === user.id ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    {/* Avatar + name + email */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-accent/10 text-accent">
                          {initStr}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-text-primary text-sm truncate">
                            {user.full_name ?? '—'}
                            {isMe && <span className="ml-2 text-[10px] font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">tú</span>}
                          </p>
                          <p className="text-xs text-gray-400 truncate">{user.email ?? '—'}</p>
                        </div>
                      </div>
                    </td>

                    {/* Roles (solo lectura hasta la pantalla de roles de la Task 12) */}
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {nombresDeRol.length ? nombresDeRol.map(n => (
                          <span key={n} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border border-border bg-bg-main text-text-primary">
                            {n}
                          </span>
                        )) : <span className="text-[11px] text-informativo">Sin roles</span>}
                      </div>
                    </td>

                    {/* Estado */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        user.active !== false
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-red-50 text-red-600 border border-red-200'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${user.active !== false ? 'bg-green-500' : 'bg-red-400'}`} />
                        {user.active !== false ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>

                    {/* Último ingreso, cómo entra y si tiene MFA (seguridad, 09/10) */}
                    <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                      {user.last_sign_in_at ? fmtDate(user.last_sign_in_at) : 'Nunca'}
                      <span className="block text-informativo">
                        {(user.providers ?? []).map(p => METODO[p] ?? p).join(' · ') || '—'}
                        {user.mfa ? ' · MFA' : ''}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3.5 text-right">
                      {manageable ? (
                        <div className="relative inline-block">
                          <button
                            onClick={() => setActionMenuId(actionMenuId === user.id ? null : user.id)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <MoreHorizontal size={16} />
                          </button>

                          {actionMenuId === user.id && (
                            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-border rounded-xl shadow-xl p-1.5 w-48">
                              <button
                                onClick={() => toggleActive(user)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left hover:bg-gray-50 transition-colors"
                              >
                                {user.active !== false
                                  ? <><UserX size={13} className="text-orange-400" /><span>Desactivar acceso</span></>
                                  : <><UserCheck size={13} className="text-green-500" /><span>Activar acceso</span></>
                                }
                              </button>
                              <div className="h-px bg-border mx-2 my-1" />
                              <button
                                onClick={() => handleDelete(user)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 size={13} />
                                Eliminar permanentemente
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isMe ? (
                        <span className="text-[10px] text-gray-300 px-2">—</span>
                      ) : (
                        <ShieldCheck size={13} className="text-gray-200 mx-auto" />
                      )}
                    </td>
                  </tr>
                )
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <p className="text-sm text-gray-400">
                      {search ? `Sin resultados para "${search}"` : 'No hay usuarios en esta vista'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
