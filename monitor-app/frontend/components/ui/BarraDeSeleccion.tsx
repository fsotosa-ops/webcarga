'use client'

import { useState, type ReactNode } from 'react'
import { Trash2, X, type LucideIcon } from 'lucide-react'
import { eleccionCompleta, type EleccionDeMotivo, type MotivoDeAnulacion } from '@/hooks/useMotivosDeAnulacion'

interface AccionDestructiva {
  /** Texto del botón en reposo: "Descartar los 3", "Eliminar 1 viaje". */
  etiqueta:     string
  /** Qué pasa si se confirma, en una línea: "Se borran definitivamente". */
  advertencia:  string
  /** Texto del botón que confirma: "Sí, descartar 3". */
  confirmacion: string
  /** Si la acción exige un motivo de catálogo: la etiqueta y las opciones. El
   *  comentario aparece al lado y es obligatorio si la opción lo pide. */
  motivos?:     { etiqueta: string; opciones: MotivoDeAnulacion[] }
  /** Devuelve `false` si el backend rechazó: la barra conserva lo elegido para
   *  reintentar. Sin motivo, se llama sin argumentos. */
  onConfirmar:  (eleccion?: EleccionDeMotivo) => void | boolean | Promise<boolean | void>
  /** Ícono del botón en reposo. Por defecto, la papelera (descartar, borrar);
   *  anular no borra, y por eso pasa otro. */
  icono?:       LucideIcon
  /** Mientras la acción corre: deshabilita y cambia el texto. */
  ocupado?:     boolean
}

interface Props {
  seleccionados: number
  /** Qué enseña la barra en reposo: cómo marcar y para qué. */
  ayuda:         string
  onLimpiar:     () => void
  destructiva?:  AccionDestructiva
  /** Otras acciones, visibles mientras no se esté confirmando. */
  children?:     ReactNode
}

/** Barra contextual de selección múltiple: dice cuántos son y dónde actuar.
 *
 *  Es el estándar de Gmail, Linear, Airtable y Salesforce Lightning. Siempre
 *  presente: si sólo apareciera al seleccionar, nadie sabría que existe hasta
 *  descubrirla por accidente. En reposo enseña a marcar; con selección, actúa.
 *
 *  La acción destructiva confirma EN LA BARRA, no en un modal: un modal por
 *  cada lote es lo que hace insoportable vaciar una bandeja de dos mil.
 *
 *  Nació en la bandeja de Certificación (TriageBulkBar) y se movió acá cuando
 *  el Monitor necesitó eliminar viajes en lote (23/09): una variante es una
 *  prop, no un componente hermano. */
export function BarraDeSeleccion({ seleccionados, ayuda, onLimpiar, destructiva, children }: Props) {
  const [confirmando, setConfirmando] = useState(false)
  const [eleccion, setEleccion] = useState<EleccionDeMotivo>({ motivoId: '', nota: '' })
  const listo = !destructiva?.motivos || eleccionCompleta(destructiva.motivos.opciones, eleccion)
  const reiniciar = () => { setConfirmando(false); setEleccion({ motivoId: '', nota: '' }) }
  const IconoDestructiva = destructiva?.icono ?? Trash2

  if (!seleccionados) {
    return (
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-gray-500">
        <span className="font-medium text-gray-400">Ninguno seleccionado</span>
        <span className="text-gray-300" aria-hidden="true">·</span>
        <span>{ayuda}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 flex-wrap bg-text-primary text-white px-3 py-2 shadow-sm">
      <span className="text-[11px] font-semibold tabular-nums">
        {seleccionados === 1 ? '1 seleccionado' : `${seleccionados} seleccionados`}
      </span>
      <span className="h-3.5 w-px bg-white/20" aria-hidden="true" />

      {!confirmando && children}

      {destructiva && (confirmando ? (
        <>
          <span className="text-[11px] text-amber-200">{destructiva.advertencia}</span>
          {destructiva.motivos && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] text-white/80">
                {destructiva.motivos.etiqueta}
                <select
                  value={eleccion.motivoId}
                  onChange={e => setEleccion(prev => ({ ...prev, motivoId: e.target.value }))}
                  className="rounded bg-white/10 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                  autoFocus
                >
                  <option value="" className="text-text-primary">Elige…</option>
                  {destructiva.motivos.opciones.map(o => (
                    <option key={o.id} value={o.id} className="text-text-primary">{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-white/80">
                {destructiva.motivos.opciones.find(o => o.id === eleccion.motivoId)?.pideNota
                  ? 'Comentario (obligatorio)' : 'Comentario'}
                <input
                  value={eleccion.nota}
                  onChange={e => setEleccion(prev => ({ ...prev, nota: e.target.value }))}
                  className="rounded bg-white/10 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                />
              </label>
            </>
          )}
          <button
            type="button"
            disabled={destructiva.ocupado || !listo}
            onClick={async () => {
              // Si el backend rechaza, se conserva lo elegido para reintentar.
              const ok = await destructiva.onConfirmar(destructiva.motivos ? eleccion : undefined)
              if (ok !== false) reiniciar()
            }}
            className="text-[11px] font-bold bg-red-500 hover:bg-red-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            {destructiva.confirmacion}
          </button>
          <button
            type="button"
            onClick={reiniciar}
            className="text-[11px] font-semibold text-white/60 hover:text-white transition-colors"
          >
            Cancelar
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={destructiva.ocupado}
          onClick={() => setConfirmando(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80 hover:text-white transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-white/40 rounded px-1"
        >
          <IconoDestructiva size={12} /> {destructiva.etiqueta}
        </button>
      ))}

      <button
        type="button"
        onClick={onLimpiar}
        aria-label="Deseleccionar"
        title="Deseleccionar"
        className="ml-auto shrink-0 p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        <X size={13} />
      </button>
    </div>
  )
}
