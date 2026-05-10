'use client'

import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deleteUser } from '@/lib/actions/users'
import CreateUserForm from './CreateUserForm'
import type { Profile, UserRole } from '@/lib/types'
import { ROLE_LABELS, ROLE_DESCRIPTIONS, canManage } from '@/lib/types'
import { UserCheck, UserX, UserPlus, Trash2, ChevronDown } from 'lucide-react'

const ROLE_BADGE: Record<UserRole, string> = {
  viewer: 'bg-gray-100 text-gray-600',
  writer: 'bg-blue-100 text-blue-700',
  editor: 'bg-cyan-100 text-cyan-700',
  admin:  'bg-purple-100 text-purple-700',
  owner:  'bg-amber-100 text-amber-700',
}

const ALL_ROLES: UserRole[] = ['viewer', 'writer', 'editor', 'admin', 'owner']

interface UsersTableProps {
  users: Profile[]
  currentUserId: string
  actorRole: UserRole
}

export default function UsersTable({ users: initial, currentUserId, actorRole }: UsersTableProps) {
  const [users, setUsers] = useState(initial)
  const [showCreate, setShowCreate] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [, startTransition] = useTransition()
  const supabase = createClient()

  function updateLocal(id: string, patch: Partial<Profile>) {
    setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...patch } : u)))
  }

  function changeRole(user: Profile, newRole: UserRole) {
    setEditingRoleId(null)
    updateLocal(user.id, { role: newRole })
    startTransition(async () => {
      await supabase.from('profiles').update({ role: newRole }).eq('id', user.id)
    })
  }

  function toggleActive(user: Profile) {
    const next = !user.active
    updateLocal(user.id, { active: next })
    startTransition(async () => {
      await supabase.from('profiles').update({ active: next }).eq('id', user.id)
    })
  }

  async function handleDelete(user: Profile) {
    if (!confirm(`¿Eliminar permanentemente a ${user.full_name ?? user.email}?\nEsta acción no se puede deshacer.`)) return
    setDeletingId(user.id)
    const result = await deleteUser(user.id)
    if (result.error) {
      alert(`Error: ${result.error}`)
      setDeletingId(null)
    } else {
      setUsers(prev => prev.filter(u => u.id !== user.id))
      setDeletingId(null)
    }
  }

  const filtered = users.filter(u =>
    `${u.full_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  // Roles that actorRole can assign to others
  const assignableRoles = actorRole === 'owner'
    ? ALL_ROLES
    : ALL_ROLES.filter(r => r !== 'admin' && r !== 'owner')

  return (
    <>
      {showCreate && (
        <CreateUserForm
          actorRole={actorRole}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); window.location.reload() }}
        />
      )}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-text-primary">Usuarios ({users.length})</h2>
          <input
            type="text"
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent w-52"
          />
          <button
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 transition-colors"
          >
            <UserPlus size={15} />
            Crear usuario
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {['Nombre', 'Email', 'Rol', 'Estado', 'Registro', 'Acciones'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => {
                const userRole = (user.role as UserRole) ?? 'viewer'
                const manageable = user.id !== currentUserId && canManage(actorRole, userRole)

                return (
                  <tr
                    key={user.id}
                    className={`border-b border-border last:border-0 hover:bg-gray-50/50 transition-colors ${deletingId === user.id ? 'opacity-40' : ''} ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}
                  >
                    <td className="px-5 py-3 font-medium text-text-primary">
                      {user.full_name ?? '—'}
                      {user.id === currentUserId && <span className="ml-2 text-xs text-gray-400">(tú)</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{user.email ?? '—'}</td>
                    <td className="px-5 py-3">
                      {manageable ? (
                        <div className="relative inline-block">
                          <button
                            onClick={() => setEditingRoleId(editingRoleId === user.id ? null : user.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${ROLE_BADGE[userRole]} hover:opacity-80 transition-opacity`}
                            title={ROLE_DESCRIPTIONS[userRole]}
                          >
                            {ROLE_LABELS[userRole]}
                            <ChevronDown size={11} />
                          </button>

                          {editingRoleId === user.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setEditingRoleId(null)} />
                              <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-border rounded-xl shadow-lg p-1.5 min-w-[220px]">
                                {assignableRoles.map(role => (
                                  <button
                                    key={role}
                                    onClick={() => changeRole(user, role)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-gray-50 transition-colors ${userRole === role ? 'bg-accent/10' : ''}`}
                                  >
                                    <span className="font-semibold text-text-primary">{ROLE_LABELS[role]}</span>
                                    <span className="block text-gray-400 mt-0.5">{ROLE_DESCRIPTIONS[role]}</span>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${ROLE_BADGE[userRole]}`}
                          title={ROLE_DESCRIPTIONS[userRole]}
                        >
                          {ROLE_LABELS[userRole]}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {user.active !== false ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(user.created_at).toLocaleDateString('es-CL')}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        {manageable && (
                          <>
                            <button
                              onClick={() => toggleActive(user)}
                              title={user.active !== false ? 'Desactivar' : 'Activar'}
                              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              {user.active !== false
                                ? <UserX size={15} className="text-red-500" />
                                : <UserCheck size={15} className="text-green-500" />}
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              disabled={deletingId === user.id}
                              title="Eliminar usuario"
                              className="p-1.5 rounded-lg hover:bg-red-50 disabled:opacity-30 transition-colors"
                            >
                              <Trash2 size={15} className="text-red-400" />
                            </button>
                          </>
                        )}
                        {!manageable && user.id !== currentUserId && (
                          <span className="text-xs text-gray-300 px-1.5">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                    No se encontraron usuarios
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
