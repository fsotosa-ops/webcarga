'use client'

import { Check, Loader2, X } from 'lucide-react'

interface Props {
  mensaje:      string
  onDeshacer:   () => void
  onCerrar:     () => void
  deshaciendo?: boolean
}

/** El aviso de que una operación en lote se aplicó, con su deshacer.
 *
 *  No se desvanece a los tres segundos a propósito: una asignación de 200
 *  archivos se revisa con calma, y un aviso que huye convierte el deshacer
 *  en una carrera. Se cierra cuando la persona lo cierra.
 */
export function TriageUndoNotice({ mensaje, onDeshacer, onCerrar, deshaciendo }: Props) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl bg-text-primary text-white px-4 py-3"
    >
      <Check size={14} className="text-accent shrink-0" />
      <span className="text-xs flex-1 min-w-0">{mensaje}</span>
      <button
        type="button"
        onClick={onDeshacer}
        disabled={deshaciendo}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-accent border border-white/25 rounded-lg px-3 py-1.5 hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shrink-0"
      >
        {deshaciendo
          ? <><Loader2 size={11} className="motion-safe:animate-spin" /> Deshaciendo…</>
          : 'Deshacer'}
      </button>
      <button
        type="button" onClick={onCerrar} aria-label="Cerrar aviso"
        className="text-white/60 hover:text-white transition-colors cursor-pointer shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}
