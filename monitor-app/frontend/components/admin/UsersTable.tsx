'use client'

import { useState, useTransition } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import CreateUserForm from './CreateUserForm'
import EditarRolesPanel from './EditarRolesPanel'
import RolChips from './RolChips'
import type { Profile } from '@/lib/types'
import { useAcceso, usePermiso } from '@/lib/authz/PermisosProvider'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'
import { usersApi } from '@/lib/api/users'
import {
  UserPlus, Trash2, Search,
  ShieldCheck, UserCheck, UserX, MoreHorizontal, KeyRound, X,
} from 'lucide-react'
import { inputClass } from '@/components/ui/Field'
import { StatusChip } from '@/components/ui/StatusChip'
import { lifecycleStyle } from '@/lib/states'

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
  catalogo:      PermisoInfo[]
}

/** Administran: Propietario o Administración (RBAC). */
function administra(u: Profile): boolean {
  return (u.roles ?? []).some(r => r === 'owner' || r === 'admin')
}

export default function UsersTable({ users: initial, currentUserId, roles, catalogo }: Props) {
  const puedeGestionar = usePermiso('users.manage')
  const soyPropietario = useAcceso().roles.includes('owner')
  const [editandoId,    setEditandoId]    = useState<string | null>(null)
  const [users,         setUsers]         = useState(initial)
  const [showCreate,    setShowCreate]    = useState(false)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)
  const [actionMenuId,  setActionMenuId]  = useState<string | null>(null)
  const [search,        setSearch]        = useState('')
  const [tab,           setTab]           = useState<FilterTab>('all')
  const [, startTransition]              = useTransition()

  const editando = users.find(u => u.id === editandoId) ?? null
  // Por qué la API rechazó el último cambio (403 de MFA, 409 del último
  // Propietario). Antes el interruptor volvía atrás sin decir nada.
  const [aviso, setAviso] = useState<string | null>(null)

  function updateLocal(id: string, patch: Partial<Profile>) {
    setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)))
  }

  function toggleActive(user: Profile) {
    const next = !user.active
    setActionMenuId(null)
    setAviso(null)
    updateLocal(user.id, { active: next })
    startTransition(async () => {
      try { await usersApi.patch(user.id, { active: next }) }
      catch (e) {
        updateLocal(user.id, { active: user.active })
        setAviso(e instanceof Error ? e.message : 'No se pudo cambiar el acceso')
      }
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
          catalogo={catalogo}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); window.location.reload() }}
        />
      )}

      {editando && (
        <EditarRolesPanel
          persona={editando}
          roles={roles}
          catalogo={catalogo}
          onClose={() => setEditandoId(null)}
          onSaved={nuevos => { updateLocal(editando.id, { roles: nuevos }); setEditandoId(null) }}
        />
      )}

      {/* Close dropdowns on outside click */}
      {actionMenuId && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setActionMenuId(null)}
        />
      )}

      {aviso && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-border bg-white px-4 py-2.5 text-dato text-status-incidente">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-informativo hover:text-text-primary">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border overflow-hidden">

        {/* ── Table header ─────────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-[280px]">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre o email…"
                aria-label="Buscar personas"
                className={`${inputClass({ size: 'sm' })} w-full pl-8`}
              />
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="ml-auto flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90"
            >
              <UserPlus size={14} />
              Invitar persona
            </button>
          </div>

          <div className="mt-3">
            <SegmentedControl label="Filtrar" value={tab} onChange={setTab}
              options={TABS.map(t => ({ id: t.key, label: t.label, badge: String(tabCounts[t.key]) }))} />
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 680 }}>
            <thead>
              <tr className="border-b border-border bg-bg-main">
                {['Persona', 'Roles', 'Estado', 'Acceso'].map(h => (
                  <th key={h} scope="col" className={CABECERA}>{h}</th>
                ))}
                <th scope="col" className="w-12"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(user => {
                // A un Propietario solo lo toca otro Propietario; el resto de las
                // reglas (último Propietario, escalada) las aplica la API.
                const esPropietario = (user.roles ?? []).includes('owner')
                const manageable = user.id !== currentUserId && puedeGestionar && (!esPropietario || soyPropietario)
                const isMe       = user.id === currentUserId
                const initStr    = initials(user.full_name, user.email)

                return (
                  <tr
                    key={user.id}
                    className={`group transition-colors hover:bg-bg-main/60 ${deletingId === user.id ? 'opacity-40 pointer-events-none' : ''}`}
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
                            {isMe && <span className="ml-2 text-etiqueta font-normal text-informativo bg-bg-main px-1.5 py-0.5 rounded-full">tú</span>}
                          </p>
                          <p className="text-xs text-informativo truncate">{user.email ?? '—'}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      <RolChips codes={user.roles ?? []} roles={roles} />
                    </td>

                    {/* Estado */}
                    <td className="px-5 py-3.5">
                      {(() => {
                        const estado = lifecycleStyle('user', user.active !== false ? 'ACTIVE' : 'INACTIVE')
                        return <StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip>
                      })()}
                    </td>

                    {/* Último ingreso, cómo entra y si tiene MFA (seguridad, 09/10) */}
                    <td className="px-5 py-3.5 text-xs text-informativo whitespace-nowrap">
                      {user.last_sign_in_at ? fmtDate(user.last_sign_in_at) : 'Nunca'}
                      <span className="block text-informativo">
                        {(user.providers ?? []).map(p => METODO[p] ?? p).join(' · ') || '—'}
                        {user.mfa ? ' · 2 pasos' : ''}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3.5 text-right">
                      {manageable ? (
                        <div className="relative inline-block">
                          <button
                            aria-label="Acciones"
                            onClick={() => setActionMenuId(actionMenuId === user.id ? null : user.id)}
                            className="p-1.5 rounded-lg text-informativo hover:text-text-primary hover:bg-bg-main transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                          >
                            <MoreHorizontal size={16} />
                          </button>

                          {actionMenuId === user.id && (
                            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-border rounded-xl shadow-xl p-1.5 w-48">
                              <button
                                onClick={() => { setActionMenuId(null); setEditandoId(user.id) }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left hover:bg-bg-main transition-colors"
                              >
                                <KeyRound size={13} className="text-accion" />
                                <span>Editar roles</span>
                              </button>
                              <button
                                onClick={() => toggleActive(user)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left hover:bg-bg-main transition-colors"
                              >
                                {user.active !== false
                                  ? <><UserX size={13} className="text-warning" aria-hidden="true" /><span>Desactivar acceso</span></>
                                  : <><UserCheck size={13} className="text-accion" aria-hidden="true" /><span>Activar acceso</span></>
                                }
                              </button>
                              <div className="h-px bg-border mx-2 my-1" />
                              <button
                                onClick={() => handleDelete(user)}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left text-status-incidente hover:bg-status-incidente/5 transition-colors"
                              >
                                <Trash2 size={13} />
                                Eliminar permanentemente
                              </button>
                            </div>
                          )}
                        </div>
                      ) : isMe ? (
                        <span className="text-etiqueta text-informativo px-2">—</span>
                      ) : (
                        <ShieldCheck size={13} aria-hidden="true" className="mx-auto text-informativo/40" />
                      )}
                    </td>
                  </tr>
                )
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <p className="text-sm text-informativo">
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
