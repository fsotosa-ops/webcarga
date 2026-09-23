'use client'

import { useState, type ReactNode } from 'react'
import { Trash2, X } from 'lucide-react'

interface AccionDestructiva {
  /** Texto del botón en reposo: "Descartar los 3", "Eliminar 1 viaje". */
  etiqueta:     string
  /** Qué pasa si se confirma, en una línea: "Se borran definitivamente". */
  advertencia:  string
  /** Texto del botón que confirma: "Sí, descartar 3". */
  confirmacion: string
  onConfirmar:  () => void
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
          <button
            type="button"
            onClick={() => { setConfirmando(false); destructiva.onConfirmar() }}
            className="text-[11px] font-bold bg-red-500 hover:bg-red-400 text-white rounded px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            {destructiva.confirmacion}
          </button>
          <button
            type="button"
            onClick={() => setConfirmando(false)}
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
          <Trash2 size={12} /> {destructiva.etiqueta}
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
