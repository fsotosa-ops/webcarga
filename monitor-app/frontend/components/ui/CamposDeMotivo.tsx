'use client'

import type { EleccionDeMotivo, MotivoDeAnulacion } from '@/hooks/useMotivosDeAnulacion'

/** Largo máximo del comentario: el mismo que acepta la API (TripVoidBody.note). */
export const LARGO_MAXIMO_DEL_COMENTARIO = 500

interface Props {
  motivos:       MotivoDeAnulacion[]
  /** Mientras llegan los motivos no se dice que no hay. */
  cargando?:     boolean
  eleccion:      EleccionDeMotivo
  onChange:      (eleccion: EleccionDeMotivo) => void
  deshabilitado?: boolean
  /** La barra de selección del Monitor y el detalle del viaje usan tamaños distintos. */
  variante:      'barra' | 'detalle'
}

const ESTILOS = {
  barra:   { label: 'text-[11px] text-white/80', campo: 'text-[11px]' },
  detalle: { label: 'text-etiqueta text-white/70', campo: 'text-etiqueta' },
} as const

/** Motivo de anulación (catálogo, Configuración › Motivos de anulación) y comentario.
 *
 *  Una sola pieza para la barra del Monitor y el detalle del viaje: el comentario
 *  dice "(obligatorio)" cuando el motivo lo pide, tiene el mismo largo máximo que la
 *  API, y sin motivos activos se dice — un selector vacío deja un botón muerto sin
 *  explicación. Una variante es una prop, no un componente hermano. */
export function CamposDeMotivo({ motivos, cargando, eleccion, onChange, deshabilitado, variante }: Props) {
  const e = ESTILOS[variante]
  if (!cargando && motivos.length === 0) {
    return <span className={e.label}>No hay motivos de anulación activos: agrégalos en Configuración.</span>
  }
  const pideNota = motivos.find(m => m.id === eleccion.motivoId)?.pideNota
  const campo = `rounded bg-white/10 px-2 py-1 ${e.campo} text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/40`
  return (
    <>
      <label className={`flex items-center gap-1.5 ${e.label}`}>
        Motivo
        <select
          value={eleccion.motivoId}
          onChange={ev => onChange({ ...eleccion, motivoId: ev.target.value })}
          disabled={deshabilitado}
          autoFocus
          className={campo}
        >
          <option value="" className="text-text-primary">Elige…</option>
          {motivos.map(m => <option key={m.id} value={m.id} className="text-text-primary">{m.label}</option>)}
        </select>
      </label>
      <label className={`flex items-center gap-1.5 ${e.label}`}>
        {pideNota ? 'Comentario (obligatorio)' : 'Comentario'}
        <input
          value={eleccion.nota}
          onChange={ev => onChange({ ...eleccion, nota: ev.target.value })}
          maxLength={LARGO_MAXIMO_DEL_COMENTARIO}
          disabled={deshabilitado}
          className={campo}
        />
      </label>
    </>
  )
}
