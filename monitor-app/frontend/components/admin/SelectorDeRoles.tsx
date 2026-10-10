'use client'

import { Lock } from 'lucide-react'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import {
  AREAS, ROLES_GENERALES, codigoDe, conNivel, esRolDeArea, motivoNoOtorgable, nivelEnArea, type Nivel,
} from '@/lib/authz/roles'

interface Props {
  roles:    RoleInfo[]
  catalogo: PermisoInfo[]
  value:    string[]
  onChange: (codes: string[]) => void
  /** Los roles que la persona ya tenía. Quitarlos o conservarlos no es
   *  escalar: solo se valida lo que se agrega (misma regla que la API). */
  originales?: string[]
}

const NIVELES: { nivel: Nivel; titulo: string }[] = [
  { nivel: 'none', titulo: 'Sin edición' },
  { nivel: 'operator', titulo: 'Operador' },
  { nivel: 'supervisor', titulo: 'Supervisor' },
]

function Motivo({ texto }: { texto: string }) {
  return (
    <span className="flex items-center gap-1 text-etiqueta text-informativo">
      <Lock size={11} className="shrink-0" aria-hidden />
      {texto}
    </span>
  )
}

function Casilla({ r, porQue, marcado, onToggle }: {
  r: RoleInfo; porQue: string | null; marcado: boolean; onToggle: () => void
}) {
  const id = `rol-${r.code}`
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <input
        id={id}
        type="checkbox"
        checked={marcado}
        disabled={porQue !== null}
        onChange={onToggle}
        className="mt-0.5 accent-accent"
      />
      <label htmlFor={id} className="min-w-0">
        <span className={`block text-dato font-medium ${porQue ? 'text-informativo' : 'text-text-primary'}`}>{r.name}</span>
        {porQue ? <Motivo texto={porQue} /> : r.description && (
          <span className="block text-etiqueta text-informativo">{r.description}</span>
        )}
      </label>
    </div>
  )
}

/** Elegir los roles de una persona (maqueta aprobada 09/10, HU 20261009/01).
 *  Por área se elige un nivel —el Supervisor ya incluye al Operador—; los
 *  roles de toda la app y los personalizados son casillas. Lo que quien edita
 *  no puede dar se ve deshabilitado, con el motivo: la regla es la de la API. */
export default function SelectorDeRoles({ roles, catalogo, value, onChange, originales = [] }: Props) {
  const acceso = useAcceso()
  const porCodigo = new Map(roles.map(r => [r.code, r]))
  const motivo = (r: RoleInfo) => originales.includes(r.code) ? null : motivoNoOtorgable(acceso, r, catalogo)

  const generales = ROLES_GENERALES.map(c => porCodigo.get(c)).filter((r): r is RoleInfo => !!r)
  const personalizados = roles.filter(r => !r.is_system)
  const otrosDeSistema = roles.filter(r =>
    r.is_system && !esRolDeArea(r.code) && !(ROLES_GENERALES as readonly string[]).includes(r.code))

  function alternar(code: string) {
    onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code])
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2.5">
        <legend className="text-etiqueta font-bold uppercase tracking-wide text-informativo mb-2">Por área</legend>
        {AREAS.map(a => {
          const actual = nivelEnArea(value, a.clave)
          const opciones = NIVELES.filter(n => n.nivel === 'none' || porCodigo.has(codigoDe(a.clave, n.nivel)))
          const bloqueos = opciones
            .filter(n => n.nivel !== 'none')
            .map(n => ({ n, porQue: motivo(porCodigo.get(codigoDe(a.clave, n.nivel as 'operator' | 'supervisor'))!) }))
            .filter(x => x.porQue)
          return (
            <div key={a.clave} className="grid grid-cols-1 sm:grid-cols-[110px_minmax(0,1fr)] gap-1.5 sm:gap-3 sm:items-center">
              <span id={`area-${a.clave}`} className="text-dato text-text-primary">{a.titulo}</span>
              <div className="min-w-0 space-y-1">
                <div role="radiogroup" aria-labelledby={`area-${a.clave}`} className="inline-flex flex-wrap rounded-lg border border-border overflow-hidden">
                  {opciones.map(n => {
                    const code = n.nivel === 'none' ? null : codigoDe(a.clave, n.nivel)
                    const bloqueado = code !== null && motivo(porCodigo.get(code)!) !== null
                    const elegido = actual === n.nivel
                    return (
                      <label
                        key={n.nivel}
                        className={`px-3 py-1.5 text-dato border-r border-border last:border-r-0 focus-within:ring-2 focus-within:ring-accent ${
                          elegido ? 'bg-accent text-white font-medium' : bloqueado ? 'text-informativo cursor-not-allowed' : 'text-text-primary cursor-pointer hover:bg-bg-main'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`nivel-${a.clave}`}
                          value={n.nivel}
                          checked={elegido}
                          disabled={bloqueado && !elegido}
                          onChange={() => onChange(conNivel(value, a.clave, n.nivel))}
                          className="sr-only"
                        />
                        {n.titulo}
                      </label>
                    )
                  })}
                </div>
                {bloqueos.map(({ n, porQue }) => <Motivo key={n.nivel} texto={`${n.titulo}: ${porQue}`} />)}
              </div>
            </div>
          )
        })}
        <p className="text-etiqueta text-informativo">El Supervisor incluye todo lo del Operador. Con Lectura, el área se ve aunque no se edite.</p>
      </fieldset>

      <fieldset>
        <legend className="text-etiqueta font-bold uppercase tracking-wide text-informativo mb-1">Toda la app</legend>
        {[...generales, ...otrosDeSistema].map(r => <Casilla key={r.code} r={r} porQue={motivo(r)} marcado={value.includes(r.code)} onToggle={() => alternar(r.code)} />)}
      </fieldset>

      {personalizados.length > 0 && (
        <fieldset>
          <legend className="text-etiqueta font-bold uppercase tracking-wide text-informativo mb-1">Personalizados</legend>
          {personalizados.map(r => <Casilla key={r.code} r={r} porQue={motivo(r)} marcado={value.includes(r.code)} onToggle={() => alternar(r.code)} />)}
        </fieldset>
      )}
    </div>
  )
}
