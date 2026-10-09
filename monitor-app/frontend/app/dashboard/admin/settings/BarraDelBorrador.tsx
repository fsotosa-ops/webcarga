'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, Loader2, X } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import type { EfectoDelLote, ExigibleOn, RequirementOption } from '@/lib/types'
import {
  aplicarEnLote, cambiosDelBorrador, incompletos, RENOVACIONES,
  type Borrador, type EdicionEnLote, type Renovacion,
} from './borrador'
import { OPCIONES_DE_EXIGIBILIDAD } from './SelectorExigibilidad'

const BOTON = `inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5
  text-xs font-semibold text-text-primary hover:bg-bg-main disabled:cursor-not-allowed disabled:opacity-45
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`
const PRIMARIO = `inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold
  text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`
const CAMPO = `rounded-md border border-border bg-white px-2 py-1 text-xs text-text-primary
  focus:border-accent focus:outline-none`

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** El pie de la tabla: lo seleccionado se edita junto, y el borrador se ensaya
 *  y se publica junto (HU-C1, entrega 2c).
 *
 *  "Publicar" guarda Y aplica —siembra los pendientes de lo que se activó—,
 *  así que solo se habilita después de ver el efecto del borrador TAL COMO
 *  ESTÁ: cualquier cambio posterior invalida el efecto visto. Es la razón por
 *  la que guardar y aplicar eran dos actos: que nadie siembre cientos de
 *  registros sin haber visto el número. */
export function BarraDelBorrador({ borrador, onBorrador, seleccion, onLimpiarSeleccion, onPublicado }: {
  borrador: Borrador
  onBorrador: (b: Borrador) => void
  seleccion: RequirementOption[]
  onLimpiarSeleccion: () => void
  onPublicado: () => void
}) {
  const qc = useQueryClient()
  const cambios = cambiosDelBorrador(borrador)
  const clave = JSON.stringify(cambios)
  const aMedias = incompletos(borrador)
  const [efecto, setEfecto] = useState<{ clave: string; datos: EfectoDelLote } | null>(null)
  const [aviso, setAviso] = useState('')
  const [publicado, setPublicado] = useState<string | null>(null)
  const efectoVigente = efecto?.clave === clave ? efecto.datos : null

  const ver = useMutation({
    mutationFn: () => requirementsApi.verEfectoDelLote(cambios),
    onSuccess: datos => { setEfecto({ clave, datos }); setPublicado(null) },
  })
  const publicar = useMutation({
    mutationFn: () => requirementsApi.publicarLote(cambios),
    onSuccess: r => {
      setPublicado(`Publicado: ${plural(r.actualizados, 'documento', 'documentos')}`
        + (r.creados ? `, ${plural(r.creados, 'pendiente creado', 'pendientes creados')}` : '')
        + (r.quitados ? `, ${plural(r.quitados, 'pendiente quitado', 'pendientes quitados')}` : '')
        + '.')
      setEfecto(null)
      onBorrador({})
      onLimpiarSeleccion()
      qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
      onPublicado()
    },
  })

  function enLote(e: EdicionEnLote) {
    onBorrador(aplicarEnLote(borrador, seleccion, e))
    setPublicado(null)
  }

  if (!cambios.length && !seleccion.length && !publicado) return null
  const n = cambios.length
  const error = (ver.error ?? publicar.error) as Error | null

  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-t-lg
                    border border-border bg-white px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,27,42,0.06)]">
      {seleccion.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-r border-border pr-4">
          <span className="text-xs font-semibold text-text-primary">
            {plural(seleccion.length, 'seleccionado', 'seleccionados')}
          </span>
          <select
            value=""
            onChange={e => e.target.value && enLote({ renovacion: e.target.value as Exclude<Renovacion, 'otra'> })}
            aria-label="Cómo se renuevan los seleccionados"
            className={CAMPO}
          >
            <option value="">Se renueva…</option>
            {RENOVACIONES.map(r => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
          </select>
          <span className="inline-flex items-center gap-1">
            <input
              type="number" min={0} inputMode="numeric"
              value={aviso}
              onChange={e => setAviso(e.target.value)}
              placeholder="Aviso"
              aria-label="Días de aviso de los seleccionados"
              className={`${CAMPO} w-16 text-right`}
            />
            <button
              type="button"
              disabled={aviso === ''}
              onClick={() => { enLote({ aviso: parseInt(aviso, 10) }); setAviso('') }}
              className={BOTON}
            >
              Aplicar aviso
            </button>
          </span>
          <select
            value=""
            onChange={e => e.target.value && enLote({ exigible_on: e.target.value as ExigibleOn })}
            aria-label="Cuándo se exigen los seleccionados"
            className={CAMPO}
          >
            <option value="">Se exige…</option>
            {OPCIONES_DE_EXIGIBILIDAD.map(o => <option key={o.valor} value={o.valor}>{o.corto}</option>)}
          </select>
          <button type="button" onClick={() => enLote({ is_active: true })} className={BOTON}>Activar</button>
          <button type="button" onClick={() => enLote({ is_active: false })} className={BOTON}>Desactivar</button>
          <button
            type="button"
            onClick={onLimpiarSeleccion}
            aria-label="Quitar la selección"
            className="rounded p-1 text-informativo hover:text-text-primary focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="min-w-0 flex-1 text-xs text-informativo" aria-live="polite">
        {n > 0 && (
          <span>
            <b className="text-text-primary">{`${plural(n, 'documento', 'documentos')} con cambios sin publicar`}</b>
            {aMedias.length > 0 && (
              <span className="text-status-incidente">
                {' · '}{plural(aMedias.length, 'regla incompleta', 'reglas incompletas')}
              </span>
            )}
          </span>
        )}
        {efectoVigente && (
          <span className="mt-1 block text-text-primary">
            Con estos cambios: <b>{efectoVigente.total.despues.vencidos} vencidos</b>
            {' '}(hoy {efectoVigente.total.antes.vencidos}) · {efectoVigente.total.despues.por_vencer} por vencer
            {' · '}crea {efectoVigente.total.crear} pendientes
            {efectoVigente.total.quitar > 0 && ` · quita ${efectoVigente.total.quitar}`}
            {efectoVigente.total.bloqueados > 0
              && ` · ${efectoVigente.total.bloqueados} no se quitan porque ya tienen documento`}
          </span>
        )}
        {publicado && !n && <span className="text-resuelto">{publicado}</span>}
        {error && <span className="mt-1 block text-status-incidente">{error.message}</span>}
      </div>

      {n > 0 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { onBorrador({}); setEfecto(null) }} className={BOTON}>
            Descartar
          </button>
          <button
            type="button"
            onClick={() => ver.mutate()}
            disabled={ver.isPending || aMedias.length > 0}
            className={BOTON}
          >
            {ver.isPending ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} aria-hidden="true" />}
            Ver efecto
          </button>
          <button
            type="button"
            onClick={() => publicar.mutate()}
            disabled={!efectoVigente || publicar.isPending}
            title={efectoVigente ? undefined : 'Mira el efecto antes de publicar'}
            className={PRIMARIO}
          >
            {publicar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} aria-hidden="true" />}
            Publicar
          </button>
        </div>
      )}
    </div>
  )
}
