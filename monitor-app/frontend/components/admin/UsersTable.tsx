'use client'

import { useMemo, useState } from 'react'
import CreateUserForm from './CreateUserForm'
import EditarRolesPanel from './EditarRolesPanel'
import RolChips from './RolChips'
import type { Profile } from '@/lib/types'
import { useAcceso, usePermiso } from '@/lib/authz/PermisosProvider'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'
import { usersApi } from '@/lib/api/users'
import { UserPlus, Trash2, ShieldCheck, UserCheck, UserX, KeyRound, X } from 'lucide-react'
import { ActionsMenu, type ActionsMenuItem } from '@/components/ui/ActionsMenu'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import { LastChange, useLastChanges } from '@/app/dashboard/admin/settings/LastChange'
import { StatusChip } from '@/components/ui/StatusChip'
import { lifecycleStyle } from '@/lib/states'

const METODO: Record<string, string> = { google: 'Google', azure: 'Microsoft', email: 'Email' }

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
  /** Después de un cambio: la lista se vuelve a pedir (no hay copia local que
   *  resincronizar; deuda del 11/10). */
  onChanged:     () => void
}

export default function UsersTable({ users, currentUserId, roles, catalogo, onChanged }: Props) {
  const puedeGestionar = usePermiso('users.manage')
  const soyPropietario = useAcceso().roles.includes('owner')
  const cambios = useLastChanges('people', 'users')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [ocupadoId, setOcupadoId]   = useState<string | null>(null)
  // Por qué la API rechazó el último cambio (403 de MFA, 409 del último Propietario).
  const [aviso, setAviso] = useState<string | null>(null)
  const [view, setView] = useState<TableView>(EMPTY_VIEW)

  const editando = users.find(u => u.id === editandoId) ?? null
  const nombreDeRol = (code: string) => roles.find(r => r.code === code)?.name ?? code

  async function cambiar(user: Profile, accion: () => Promise<unknown>, falla: string) {
    setAviso(null)
    setOcupadoId(user.id)
    try {
      await accion()
      onChanged()
    } catch (e) {
      setAviso(e instanceof Error && e.message ? e.message : falla)
    } finally {
      setOcupadoId(null)
    }
  }

  function acciones(user: Profile): ActionsMenuItem[] {
    // A un Propietario solo lo toca otro Propietario; el resto de las reglas
    // (último Propietario, escalada) las aplica la API.
    const esPropietario = (user.roles ?? []).includes('owner')
    if (user.id === currentUserId || !puedeGestionar || (esPropietario && !soyPropietario)) return []
    const activo = user.active !== false
    return [
      { id: 'roles', label: 'Editar roles', icon: KeyRound, onSelect: () => setEditandoId(user.id) },
      { id: 'acceso', label: activo ? 'Desactivar acceso' : 'Activar acceso', icon: activo ? UserX : UserCheck,
        onSelect: () => void cambiar(user, () => usersApi.patch(user.id, { active: !activo }), 'No se pudo cambiar el acceso') },
      { id: 'eliminar', label: 'Eliminar permanentemente', icon: Trash2, destructive: true,
        onSelect: () => {
          if (!confirm(`¿Eliminar permanentemente a ${user.full_name ?? user.email}?\nEsta acción no se puede deshacer.`)) return
          void cambiar(user, () => usersApi.remove(user.id), 'No se pudo eliminar')
        } },
    ]
  }

  const columnas = useMemo<DataColumn<Profile>[]>(() => [
    { id: 'persona', header: 'Persona', hideable: false, value: u => u.full_name ?? u.email ?? null,
      render: u => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-etiqueta font-bold text-accent">
            {initials(u.full_name, u.email)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-dato font-medium text-text-primary">
              {u.full_name ?? '—'}
              {u.id === currentUserId && <span className="ml-2 rounded-full bg-bg-main px-1.5 py-0.5 text-etiqueta font-normal text-informativo">tú</span>}
            </p>
            <p className="truncate text-etiqueta text-informativo">{u.email ?? '—'}</p>
          </div>
        </div>
      ) },
    { id: 'roles', header: 'Roles', sortable: false,
      value: u => (u.roles ?? []).map(nombreDeRol).join(', ') || null,
      values: u => (u.roles ?? []).map(nombreDeRol),
      render: u => <div className="max-w-64"><RolChips codes={u.roles ?? []} roles={roles} /></div> },
    { id: 'estado', header: 'Estado', value: u => lifecycleStyle('user', u.active !== false ? 'ACTIVE' : 'INACTIVE').label,
      render: u => {
        const estado = lifecycleStyle('user', u.active !== false ? 'ACTIVE' : 'INACTIVE')
        return <StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip>
      } },
    // Último ingreso, cómo entra y si tiene MFA (seguridad, 09/10).
    { id: 'acceso', header: 'Acceso', filter: false, value: u => u.last_sign_in_at ?? null,
      render: u => (
        <span className="whitespace-nowrap text-etiqueta text-informativo">
          {u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : 'Nunca'}
          <span className="block">
            {(u.providers ?? []).map(x => METODO[x] ?? x).join(' · ') || '—'}{u.mfa ? ' · 2 pasos' : ''}
          </span>
        </span>
      ) },
    { id: 'acciones', header: 'Acciones', filter: false, sortable: false, hideable: false, value: () => null,
      render: u => {
        const items = acciones(u)
        if (items.length) return <ActionsMenu label="Acciones" items={items} disabled={ocupadoId === u.id} />
        return u.id === currentUserId
          ? <span className="px-2 text-etiqueta text-informativo">—</span>
          : <ShieldCheck size={13} aria-hidden="true" className="text-informativo/40" />
      } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [roles, currentUserId, puedeGestionar, soyPropietario, ocupadoId])

  const model = useDataTable({
    rows: users, columns: columnas, getRowId: u => u.id, view, onViewChange: setView, pageSize: 50,
    search: (u, q) => `${u.full_name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q),
  })

  return (
    <>
      {showCreate && (
        <CreateUserForm roles={roles} catalogo={catalogo} onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); onChanged() }} />
      )}
      {editando && (
        <EditarRolesPanel persona={editando} roles={roles} catalogo={catalogo}
          lastChange={<LastChange change={cambios.of(editando.id)} pending={cambios.isPending} error={cambios.isError} />}
          onClose={() => setEditandoId(null)}
          onSaved={() => { setEditandoId(null); onChanged(); cambios.invalidate() }} />
      )}
      <Card className="space-y-3">
        <TableToolbar model={model} searchPlaceholder="Buscar por nombre o email…"
          actions={puedeGestionar ? (
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              <UserPlus size={14} aria-hidden="true" /> Invitar persona
            </Button>
          ) : null} />
        {aviso && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-border bg-white px-4 py-2.5 text-dato text-status-incidente">
            <span>{aviso}</span>
            <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-informativo hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
        )}
        <DataTable model={model} label="Personas" empty="Nadie coincide con la búsqueda o los filtros."
                   isRowActive={u => u.id === ocupadoId} />
      </Card>
    </>
  )
}
