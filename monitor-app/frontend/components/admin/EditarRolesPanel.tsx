'use client'

import { useState, type ReactNode } from 'react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Button } from '@/components/ui/Button'
import { accessApi, type PermisoInfo, type RoleInfo } from '@/lib/api/access'
import { diferencia, permisosDe } from '@/lib/authz/roles'
import SelectorDeRoles from './SelectorDeRoles'

interface Props {
  persona:  { id: string; full_name: string | null; email: string | null; roles?: string[] }
  roles:    RoleInfo[]
  catalogo: PermisoInfo[]
  onSaved:  (roles: string[]) => void
  onClose:  () => void
  /** "Última modificación" de la persona (registro de cambios, spec 2026-10-22). */
  lastChange?: ReactNode
}

/** Panel lateral para cambiar los roles de una persona sin borrarla (maqueta
 *  aprobada 09/10). Antes de guardar dice qué permisos gana y pierde; si la
 *  API rechaza (escalada, último Propietario), el mensaje queda en el panel y
 *  lo elegido no se pierde. */
export default function EditarRolesPanel({ persona, roles, catalogo, onSaved, onClose, lastChange }: Props) {
  const originales = persona.roles ?? []
  const [elegidos, setElegidos] = useState<string[]>(originales)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { gana, pierde } = diferencia(permisosDe(roles, originales, catalogo), permisosDe(roles, elegidos, catalogo))
  const describir = (codes: string[]) => codes.map(c => catalogo.find(p => p.code === c)?.description ?? c).join(' · ')
  const cambio = [...elegidos].sort().join() !== [...originales].sort().join()
  const sinRoles = elegidos.length === 0

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      const res = await accessApi.setUserRoles(persona.id, elegidos)
      onSaved(res.roles)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los roles')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <PanelLateral
      titulo="Editar roles"
      description={`${persona.full_name ?? '—'} · ${persona.email ?? '—'}`}
      onCerrar={onClose}
      dismissible={!guardando}
      pie={
        <div className="space-y-3">
          {sinRoles ? (
            <p className="text-dato text-text-primary">
              Elige al menos un rol: sin roles la persona no puede entrar. Para quitarle el acceso, desactívala.
            </p>
          ) : cambio && (
            <div className="text-dato space-y-1">
              <p className="font-medium text-text-primary">Al guardar:</p>
              {gana.length > 0 && <p className="text-resuelto">+ gana: {describir(gana)}</p>}
              {pierde.length > 0 && <p className="text-status-incidente">− pierde: {describir(pierde)}</p>}
              {gana.length === 0 && pierde.length === 0 && <p className="text-informativo">Sus permisos no cambian.</p>}
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-border bg-white px-3 py-2 text-dato text-status-incidente">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
            <Button variant="primary" onClick={guardar} disabled={!cambio || sinRoles || guardando}>
              {guardando ? 'Guardando…' : 'Guardar roles'}
            </Button>
          </div>
        </div>
      }
    >
      {lastChange && <div className="mb-3">{lastChange}</div>}
      <SelectorDeRoles roles={roles} catalogo={catalogo} value={elegidos} onChange={setElegidos} originales={originales} />
    </PanelLateral>
  )
}
