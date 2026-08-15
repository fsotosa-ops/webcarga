'use client'

import { FileStack } from 'lucide-react'
import type { TrayItem } from '@/lib/types'

/** Panel central: qué es el archivo que se está por clasificar.
 *
 *  No es decorativo — de 24 documentos reales cargados, uno solo traía un
 *  identificador en el nombre. Con `IMG_9001.png` la vista previa es lo único
 *  que permite decidir. Con varios seleccionados pasa a resumir la selección,
 *  porque ahí la decisión ya no es sobre un archivo puntual. */
export function TriagePreview({ items }: { items: TrayItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center">
        <p className="text-[11px] text-gray-500">Selecciona un documento para verlo</p>
      </div>
    )
  }

  if (items.length > 1) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/60 py-5 flex flex-col items-center justify-center gap-1.5">
        <FileStack size={20} className="text-accent" />
        <p className="text-xs font-semibold text-text-primary">
          {items.length} documentos seleccionados
        </p>
        <p className="text-[10px] text-gray-500 text-center max-w-[220px]">
          Lo que elijas arriba se aplica a todos.
        </p>
      </div>
    )
  }

  const item = items[0]
  const isImage = (item.mime_type ?? '').startsWith('image/')

  return (
    <figure className="space-y-1.5">
      <div className="rounded-lg border border-gray-200 bg-gray-50 h-40 flex items-center justify-center overflow-hidden">
        {item.preview_url && isImage && (
          <img src={item.preview_url} alt={item.file_name} className="max-h-full max-w-full object-contain" />
        )}
        {item.preview_url && !isImage && (
          <iframe src={item.preview_url} title={item.file_name} className="w-full h-full" />
        )}
        {!item.preview_url && <p className="text-[11px] text-gray-500">Sin vista previa</p>}
      </div>
      <figcaption className="text-[10px] text-gray-500 font-mono truncate" title={item.file_name}>
        {item.file_name}
      </figcaption>
    </figure>
  )
}
