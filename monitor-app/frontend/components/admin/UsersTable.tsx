'use client'

import { useState, useTransition } from 'react'
import { deleteUser } from '@/lib/actions/users'
import CreateUserForm from './CreateUserForm'
import type { Profile, UserRole } from '@/lib/types'
import { ROLE_LABELS, ROLE_DESCRIPTIONS, canManage } from '@/lib/types'
import { usersApi } from '@/lib/api/users'
import {
  UserPlus, Trash2, Search, ChevronDown,
  ShieldCheck, UserCheck, UserX, MoreHorizontal
} from 'lucide-react'

// ── Role styling ──────────────────────────────────────────────────────────────
const ROLE_BADGE_MAP: Record<string, { pill: string; avatar: string; dot: string }> = {
  viewer: { pill: 'bg-gray-100 text-gray-600 border-gray-200',     avatar: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400'   },
  writer: { pill: 'bg-blue-50 text-blue-700 border-blue-200',      avatar: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500'   },
  editor: { pill: 'bg-teal-50 text-teal-700 border-teal-200',      avatar: 'bg-teal-100 text-teal-700',     dot: 'bg-teal-500'   },
  admin:  { pill: 'bg-purple-50 text-purple-700 border-purple-200', avatar: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  owner:  { pill: 'bg-amber-50 text-amber-700 border-amber-200',   avatar: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500'  },
}
const FALLBACK_BADGE = { pill: 'bg-gray-100 text-gray-600 border-gray-200', avatar: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' }
function getRoleBadge(role: string) { return ROLE_BADGE_MAP[role] ?? FALLBACK_BADGE }

const ALL_ROLES: UserRole[] = ['viewer', 'writer', 'editor', 'admin', 'owner']

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
  actorRole:     UserRole
}

export default function UsersTable({ users: initial, currentUserId, actorRole }: Props) {
  const [users,         setUsers]         = useState(initial)
  const [showCreate,    setShowCreate]    = useState(false)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)
  const [roleDropId,    setRoleDropId]    = useState<string | null>(null)
  const [actionMenuId,  setActionMenuId]  = useState<string | null>(null)
  const [search,        setSearch]        = useState('')
  const [tab,           setTab]           = useState<FilterTab>('all')
  const [, startTransition]              = useTransition()

  function updateLocal(id: string, patch: Partial<Profile>) {
    setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)))
  }

  function changeRole(user: Profile, newRole: UserRole) {
    setRoleDropId(null)
    updateLocal(user.id, { role: newRole })
    startTransition(async () => {
      try { await usersApi.patch(user.id, { role: newRole }) }
      catch { updateLocal(user.id, { role: user.role }) }
    })
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
    const result = await deleteUser(user.id)
    if (result.error) { alert(`Error: ${result.error}`); setDeletingId(null) }
    else setUsers(prev => prev.filter(u => u.id !== user.id))
  }

  // Roles actorRole can assign to others
  const assignableRoles: UserRole[] = actorRole === 'owner'
    ? ALL_ROLES
    : ALL_ROLES.filter(r => r !== 'admin' && r !== 'owner')

  // Filtering
  const byTab = users.filter(u => {
    if (tab === 'privileged') return u.role === 'admin' || u.role === 'owner'
    if (tab === 'active')     return u.active !== false
    if (tab === 'inactive')   return u.active === false
    return true
  })
  const filtered = byTab.filter(u =>
    `${u.full_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const tabCounts = {
    all:        users.length,
    privileged: users.filter(u => u.role === 'admin' || u.role === 'owner').length,
    active:     users.filter(u => u.active !== false).length,
    inactive:   users.filter(u => u.active === false).length,
  }

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all',        label: 'Todos'      },
    { key: 'privileged', label: 'Admin+'     },
    { key: 'active',     label: 'Activos'    },
    { key: 'inactive',   label: 'Inactivos'  },
  ]

  return (
    <>
      {showCreate && (
        <CreateUserForm
          actorRole={actorRole}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); window.location.reload() }}
        />
      )}

      {/* Close dropdowns on outside click */}
      {(roleDropId || actionMenuId) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setRoleDropId(null); setActionMenuId(null) }}
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
                {['Usuario', 'Rol', 'Estado', 'Miembro desde', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(user => {
                const userRole  = (user.role as UserRole) ?? 'viewer'
                const badge     = getRoleBadge(userRole)
                const manageable = user.id !== currentUserId && canManage(actorRole, userRole)
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
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${badge.avatar}`}>
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

                    {/* Role badge (clickable if manageable) */}
                    <td className="px-5 py-3.5">
                      {manageable ? (
                        <div className="relative inline-block">
                          <button
                            onClick={() => setRoleDropId(roleDropId === user.id ? null : user.id)}
                            className={`inline-flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-full text-xs font-semibold border transition-opacity hover:opacity-80 ${badge.pill}`}
                            title={ROLE_DESCRIPTIONS[userRole]}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                            {ROLE_LABELS[userRole]}
                            <ChevronDown size={10} />
                          </button>

                          {roleDropId === user.id && (
                            <div className="absolute left-0 top-full mt-1.5 z-20 bg-white border border-border rounded-xl shadow-xl p-1.5 w-56">
                              <p className="px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cambiar rol</p>
                              {assignableRoles.map(role => {
                                const rb = getRoleBadge(role)
                                return (
                                  <button
                                    key={role}
                                    onClick={() => changeRole(user, role)}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs hover:bg-gray-50 transition-colors ${userRole === role ? 'bg-accent/5' : ''}`}
                                  >
                                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${rb.avatar}`}>
                                      {ROLE_LABELS[role][0]}
                                    </span>
                                    <div>
                                      <p className="font-semibold text-text-primary">{ROLE_LABELS[role]}</p>
                                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{ROLE_DESCRIPTIONS[role]}</p>
                                    </div>
                                    {userRole === role && (
                                      <span className="ml-auto w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                                        <span className="text-white text-[8px] font-bold">✓</span>
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs font-semibold border ${badge.pill}`}
                          title={ROLE_DESCRIPTIONS[userRole]}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {ROLE_LABELS[userRole]}
                        </span>
                      )}
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

                    {/* Fecha */}
                    <td className="px-5 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                      {fmtDate(user.created_at)}
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
