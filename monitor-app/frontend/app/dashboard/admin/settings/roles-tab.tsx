'use client'

import { useEffect, useState } from 'react'
import { Lock, Check, Minus, ShieldCheck } from 'lucide-react'
import { accessApi, type PermisoInfo, type RoleInfo } from '@/lib/api/access'
import { useAcceso, usePermiso } from '@/lib/authz/PermisosProvider'
import { AREAS, TITULO_DE_AREA, codigoDe } from '@/lib/authz/roles'
import { LoadState } from './shared'

/** El código de un rol personalizado sale de su nombre, con el formato que
 *  exige la API (^[a-z][a-z0-9_]{2,40}$). Nadie lo escribe a mano. */
export function codigoDeRol(nombre: string): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (/^[a-z]/.test(base) ? base : `rol_${base}`).slice(0, 41)
}

function porArea(catalogo: PermisoInfo[]): [string, PermisoInfo[]][] {
  const grupos = new Map<string, PermisoInfo[]>()
  for (const p of catalogo) grupos.set(p.area, [...(grupos.get(p.area) ?? []), p])
  return [...grupos]
}

function ItemDeRol({ r, activo, onClick }: { r: RoleInfo; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activo || undefined}
      className={`w-full flex justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-dato ${
        activo ? 'bg-accent/10 text-accion font-medium' : 'text-text-primary hover:bg-bg-main'
      }`}
    >
      <span className="min-w-0 truncate">{r.name}</span>
      <span className="text-informativo tabular-nums" aria-label={`${r.assigned} personas`}>{r.assigned}</span>
    </button>
  )
}

/** Propietario y Administración primero, después cada área (Supervisor antes
 *  que Operador) y al final los de lectura: el orden de la maqueta. */
const ORDEN_DE_SISTEMA = [
  'owner', 'admin',
  ...AREAS.flatMap(a => [codigoDe(a.clave, 'supervisor'), codigoDe(a.clave, 'operator')]),
  'reader', 'support',
]
function ordenDeSistema(code: string): number {
  const i = ORDEN_DE_SISTEMA.indexOf(code)
  return i === -1 ? ORDEN_DE_SISTEMA.length : i
}

type Modo = { tipo: 'ver' } | { tipo: 'crear' } | { tipo: 'editar'; rol: RoleInfo }

/** Configuración › Personas y accesos › Roles (maqueta aprobada 09/10).
 *  Los roles de sistema se leen; los personalizados se crean y editan
 *  marcando permisos del catálogo, solo los que tiene quien edita. */
export function RolesTab() {
  const puedeGestionar = usePermiso('roles.manage')
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [catalogo, setCatalogo] = useState<PermisoInfo[]>([])
  const [elegido, setElegido] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>({ tipo: 'ver' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = (seleccionar?: string) => {
    setLoading(true)
    setError(null)
    Promise.all([accessApi.roles(), accessApi.permissions()])
      .then(([r, p]) => {
        setRoles(r)
        setCatalogo(p)
        setElegido(actual => seleccionar ?? actual ?? r[0]?.id ?? null)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar los roles'))
      .finally(() => setLoading(false))
  }
  useEffect(() => load(), [])

  if (loading && roles.length === 0) return <LoadState loading error={null} onRetry={() => load()} />
  if (error && roles.length === 0) return <LoadState loading={false} error={error} onRetry={() => load()} />

  const deSistema = roles.filter(r => r.is_system).sort((a, b) => ordenDeSistema(a.code) - ordenDeSistema(b.code))
  const personalizados = roles.filter(r => !r.is_system)
  const rol = roles.find(r => r.id === elegido) ?? null
  const item = (r: RoleInfo) => (
    <ItemDeRol key={r.id} r={r} activo={modo.tipo === 'ver' && r.id === elegido}
      onClick={() => { setElegido(r.id); setModo({ tipo: 'ver' }) }} />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-dato text-informativo">
          Los de sistema vienen con la app; los personalizados los crea Administración.
        </p>
        {puedeGestionar && (
          <button
            type="button"
            onClick={() => setModo({ tipo: 'crear' })}
            className="px-4 py-2 rounded-lg bg-accent text-white text-dato font-medium hover:bg-accent/90"
          >
            + Crear rol
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] border border-border rounded-xl overflow-hidden bg-white">
        <nav aria-label="Roles" className="p-3 space-y-1 border-b md:border-b-0 md:border-r border-border">
          <p className="px-2.5 pt-1 pb-1 text-etiqueta font-bold uppercase tracking-wide text-informativo">De sistema</p>
          {deSistema.map(item)}
          <p className="px-2.5 pt-3 pb-1 text-etiqueta font-bold uppercase tracking-wide text-informativo">Personalizados</p>
          {personalizados.length > 0 ? personalizados.map(item) : (
            <p className="px-2.5 text-dato text-informativo">
              Aún no hay roles personalizados. Crea uno cuando un puesto no calce con los de sistema.
            </p>
          )}
        </nav>

        <div className="p-5 min-w-0">
          {modo.tipo === 'crear' && (
            <FormularioDeRol catalogo={catalogo} onCancel={() => setModo({ tipo: 'ver' })}
              onSaved={r => { setModo({ tipo: 'ver' }); load(r.id) }} />
          )}
          {modo.tipo === 'editar' && (
            <FormularioDeRol catalogo={catalogo} rol={modo.rol} onCancel={() => setModo({ tipo: 'ver' })}
              onSaved={r => { setModo({ tipo: 'ver' }); load(r.id) }} />
          )}
          {modo.tipo === 'ver' && rol && (
            <DetalleDeRol
              rol={rol}
              catalogo={catalogo}
              puedeGestionar={puedeGestionar}
              onEditar={() => setModo({ tipo: 'editar', rol })}
              onEliminado={() => { setElegido(null); load() }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function DetalleDeRol({ rol, catalogo, puedeGestionar, onEditar, onEliminado }: {
  rol: RoleInfo; catalogo: PermisoInfo[]; puedeGestionar: boolean; onEditar: () => void; onEliminado: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setConfirmando(false); setError(null) }, [rol.id])

  const tiene = (code: string) => rol.grants_all || rol.permissions.includes(code)

  async function eliminar() {
    setError(null)
    try {
      await accessApi.deleteRole(rol.id)
      onEliminado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el rol')
    }
  }

  return (
    <section aria-label={rol.name} className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-titulo font-semibold text-text-primary">{rol.name}</h2>
          <p className="text-dato text-informativo">
            {rol.description}{rol.description ? ' · ' : ''}{rol.assigned} {rol.assigned === 1 ? 'persona' : 'personas'}
          </p>
        </div>
        {!rol.is_system && puedeGestionar && (
          <div className="flex gap-2">
            <button type="button" onClick={onEditar} className="px-3 py-1.5 rounded-lg border border-border text-dato text-text-primary hover:bg-bg-main">Editar</button>
            <button type="button" onClick={() => setConfirmando(true)} className="px-3 py-1.5 rounded-lg border border-border text-dato text-status-incidente hover:bg-bg-main">Eliminar</button>
          </div>
        )}
      </div>

      {rol.is_system && (
        <p className="flex items-start gap-2 text-dato text-informativo bg-bg-main rounded-lg px-3 py-2">
          <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
          Rol de sistema: se define en el código y no se edita. Para una variante, crea un rol personalizado.
        </p>
      )}

      {confirmando && (
        <div className="flex flex-wrap items-center gap-3 border border-border rounded-lg px-3 py-2">
          <p className="text-dato text-text-primary flex-1">¿Eliminar el rol «{rol.name}»? No se puede deshacer.</p>
          <button type="button" onClick={() => setConfirmando(false)} className="px-3 py-1.5 rounded-lg border border-border text-dato">Cancelar</button>
          <button type="button" onClick={eliminar} className="px-3 py-1.5 rounded-lg bg-status-incidente text-white text-dato font-medium">Confirmar eliminación</button>
        </div>
      )}
      {error && <p role="alert" className="text-dato text-status-incidente border border-border rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-x-8 gap-y-4">
        {porArea(catalogo).map(([area, permisos]) => (
          <div key={area} className="space-y-1">
            <p className="text-etiqueta font-bold uppercase tracking-wide text-informativo">{TITULO_DE_AREA[area] ?? area}</p>
            {permisos.map(p => (
              <div key={p.code} className="flex items-start gap-2">
                {tiene(p.code)
                  ? <Check size={14} className="mt-0.5 shrink-0 text-resuelto" aria-hidden />
                  : <Minus size={14} className="mt-0.5 shrink-0 text-informativo" aria-hidden />}
                <span data-incluido={tiene(p.code)} className={`text-dato ${tiene(p.code) ? 'text-text-primary' : 'text-informativo'}`}>
                  {p.description}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function FormularioDeRol({ catalogo, rol, onCancel, onSaved }: {
  catalogo: PermisoInfo[]; rol?: RoleInfo; onCancel: () => void; onSaved: (r: RoleInfo) => void
}) {
  const acceso = useAcceso()
  const [nombre, setNombre] = useState(rol?.name ?? '')
  const [descripcion, setDescripcion] = useState(rol?.description ?? '')
  const [permisos, setPermisos] = useState<string[]>(rol?.permissions ?? [])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const propietario = acceso.roles.includes('owner')
  const puedeDar = (code: string) => propietario || (acceso.permissions as string[]).includes(code)
  const listo = nombre.trim().length >= 2 && permisos.length > 0

  function alternar(code: string) {
    // Respeta el orden del catálogo: el pedido sale igual cada vez.
    const nuevos = permisos.includes(code) ? permisos.filter(p => p !== code) : [...permisos, code]
    setPermisos(catalogo.map(p => p.code as string).filter(c => nuevos.includes(c)))
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const body = { name: nombre.trim(), description: descripcion.trim(), permissions: permisos }
      onSaved(rol
        ? await accessApi.updateRole(rol.id, body)
        : await accessApi.createRole({ code: codigoDeRol(body.name), ...body }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el rol')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      <h2 className="text-titulo font-semibold text-text-primary">{rol ? `Editar «${rol.name}»` : 'Crear rol personalizado'}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="rol-nombre" className="block text-dato font-medium text-text-primary">Nombre</label>
          <input id="rol-nombre" value={nombre} onChange={e => setNombre(e.target.value)} required minLength={2}
            className="w-full px-3 py-2 rounded-lg border border-border text-dato focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rol-descripcion" className="block text-dato font-medium text-text-primary">Para qué sirve</label>
          <input id="rol-descripcion" value={descripcion} onChange={e => setDescripcion(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border text-dato focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-5">
        {porArea(catalogo).map(([area, lista]) => (
          <fieldset key={area} className="space-y-1">
            <legend className="text-etiqueta font-bold uppercase tracking-wide text-informativo mb-1">{TITULO_DE_AREA[area] ?? area}</legend>
            {lista.map(p => {
              const bloqueado = !puedeDar(p.code)
              const id = `permiso-${p.code}`
              return (
                <div key={p.code} className="flex items-start gap-2.5 py-1">
                  <input id={id} type="checkbox" checked={permisos.includes(p.code)} disabled={bloqueado}
                    onChange={() => alternar(p.code)} className="mt-0.5 accent-accent" />
                  <label htmlFor={id} className="min-w-0">
                    <span className={`block text-dato ${bloqueado ? 'text-informativo' : 'text-text-primary'}`}>{p.description}</span>
                    {bloqueado ? (
                      <span className="flex items-center gap-1 text-etiqueta text-informativo">
                        <Lock size={11} aria-hidden /> No lo tienes, así que no puedes darlo
                      </span>
                    ) : p.privileged && (
                      <span className="flex items-center gap-1 text-etiqueta text-informativo">
                        <ShieldCheck size={11} aria-hidden /> Exige verificación en dos pasos
                      </span>
                    )}
                  </label>
                </div>
              )
            })}
          </fieldset>
        ))}
      </div>

      {error && <p role="alert" className="text-dato text-status-incidente border border-border rounded-lg px-3 py-2">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-border text-dato text-text-primary hover:bg-bg-main">Cancelar</button>
        <button type="submit" disabled={!listo || guardando}
          className="px-4 py-2 rounded-lg bg-accent text-white text-dato font-medium hover:bg-accent/90 disabled:opacity-50">
          {guardando ? 'Guardando…' : rol ? 'Guardar cambios' : 'Crear rol'}
        </button>
      </div>
    </form>
  )
}
