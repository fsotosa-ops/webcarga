'use client'

import { X } from 'lucide-react'

/** El aviso breve después de guardar en el Directorio: a dónde quedó lo que se
 *  transfirió, o que el Cierre se recalcula en alrededor de un minuto (bloque 0
 *  del Directorio, 0.6 y 0.7). Fijo abajo, para que se vea también con un panel
 *  lateral abierto. Mismo tono que el aviso de Sin clasificar (`bg-text-primary`):
 *  dos negros distintos para dos carteles que se ven juntos ya fue un hallazgo. */
export function DirectoryNotice({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null
  return (
    <div role="status"
         className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 inline-flex items-center gap-3 rounded-lg bg-text-primary py-1.5 pl-3 pr-2 text-etiqueta text-white shadow-sm">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Cerrar aviso"
              className="rounded p-0.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}
