'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { accessApi, type PermisoInfo, type RoleInfo } from '@/lib/api/access'
import { diferencia, permisosDe } from '@/lib/authz/roles'
import SelectorDeRoles from './SelectorDeRoles'

interface Props {
  persona:  { id: string; full_name: string | null; email: string | null; roles?: string[] }
  roles:    RoleInfo[]
  catalogo: PermisoInfo[]
  onSaved:  (roles: string[]) => void
  onClose:  () => void
}

/** Panel lateral para cambiar los roles de una persona sin borrarla (maqueta
 *  aprobada 09/10). Antes de guardar dice qué permisos gana y pierde; si la
 *  API rechaza (escalada, último Propietario), el mensaje queda en el panel y
 *  lo elegido no se pierde. */
export default function EditarRolesPanel({ persona, roles, catalogo, onSaved, onClose }: Props) {
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="editar-roles-titulo"
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-[460px] h-full bg-white flex flex-col shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 id="editar-roles-titulo" className="text-titulo font-semibold text-text-primary">Editar roles</h2>
            <p className="text-dato text-informativo truncate">{persona.full_name ?? '—'} · {persona.email ?? '—'}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-informativo hover:bg-bg-main">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <SelectorDeRoles roles={roles} catalogo={catalogo} value={elegidos} onChange={setElegidos} />
        </div>

        <footer className="px-5 py-4 border-t border-border bg-bg-main space-y-3">
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
            <p role="alert" className="text-dato text-status-incidente bg-white border border-border rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-dato text-text-primary hover:bg-white">
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={!cambio || sinRoles || guardando}
              className="px-4 py-2 rounded-lg bg-accent text-white text-dato font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar roles'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}
