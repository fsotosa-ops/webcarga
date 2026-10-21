'use client'

import type { EleccionDeMotivo, ReasonOption } from '@/hooks/useReasons'
import { FIELD_LABEL, inputClass } from './Field'

/** Largo máximo del comentario: el mismo que acepta la API (TripVoidBody.note,
 *  LifecycleReasonBody.note). */
export const LARGO_MAXIMO_DEL_COMENTARIO = 500

interface Props {
  motivos:       ReasonOption[]
  /** Mientras llegan los motivos no se dice que no hay. */
  cargando?:     boolean
  eleccion:      EleccionDeMotivo
  onChange:      (eleccion: EleccionDeMotivo) => void
  deshabilitado?: boolean
  /** La barra de selección del Monitor y el detalle del viaje van sobre fondo oscuro;
   *  `dialogo`, sobre la ventana clara de una confirmación (dar de baja, reactivar). */
  variante:      'barra' | 'detalle' | 'dialogo'
  /** Qué catálogo es, para el aviso cuando no tiene motivos activos. */
  sinMotivos?:   string
}

const OSCURO = (texto: string) => ({
  fila:  `flex items-center gap-1.5 ${texto}`,
  label: '',
  campo: `rounded bg-white/10 px-2 py-1 ${texto.split(' ')[0]} text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-white/40`,
  opcion: 'text-text-primary',
})

const ESTILOS = {
  barra:   { ...OSCURO('text-[11px] text-white/80') },
  detalle: { ...OSCURO('text-etiqueta text-white/70') },
  dialogo: { fila: 'block', label: `${FIELD_LABEL} mb-1.5`, campo: `${inputClass()} w-full`, opcion: '' },
} as const

/** Motivo de un catálogo de Configuración y comentario.
 *
 *  Una sola pieza para anular un viaje y para dar de baja o reactivar: el comentario
 *  dice "(obligatorio)" cuando el motivo lo pide, tiene el mismo largo máximo que la
 *  API, y sin motivos activos se dice — un selector vacío deja un botón muerto sin
 *  explicación. Una variante es una prop, no un componente hermano. */
export function CamposDeMotivo({
  motivos, cargando, eleccion, onChange, deshabilitado, variante,
  sinMotivos = 'No hay motivos de anulación activos: agrégalos en Configuración.',
}: Props) {
  const e = ESTILOS[variante]
  if (!cargando && motivos.length === 0) {
    return <span className={variante === 'dialogo' ? 'text-dato text-informativo' : e.fila}>{sinMotivos}</span>
  }
  const pideNota = motivos.find(m => m.id === eleccion.motivoId)?.pideNota
  return (
    <>
      <label className={e.fila}>
        <span className={e.label}>Motivo</span>
        <select
          value={eleccion.motivoId}
          onChange={ev => onChange({ ...eleccion, motivoId: ev.target.value })}
          disabled={deshabilitado}
          autoFocus
          className={e.campo}
        >
          <option value="" className={e.opcion}>Elige…</option>
          {motivos.map(m => <option key={m.id} value={m.id} className={e.opcion}>{m.label}</option>)}
        </select>
      </label>
      <label className={e.fila}>
        <span className={e.label}>{pideNota ? 'Comentario (obligatorio)' : 'Comentario'}</span>
        <input
          value={eleccion.nota}
          onChange={ev => onChange({ ...eleccion, nota: ev.target.value })}
          maxLength={LARGO_MAXIMO_DEL_COMENTARIO}
          disabled={deshabilitado}
          className={e.campo}
        />
      </label>
    </>
  )
}
