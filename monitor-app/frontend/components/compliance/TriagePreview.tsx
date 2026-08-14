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
      <div className="h-full min-h-[240px] flex items-center justify-center">
        <p className="text-xs text-gray-400">Elegí un documento para verlo</p>
      </div>
    )
  }

  if (items.length > 1) {
    return (
      <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-2">
        <FileStack size={28} className="text-accent" />
        <p className="text-sm font-semibold text-text-primary">
          {items.length} documentos seleccionados
        </p>
        <p className="text-[11px] text-gray-400 text-center max-w-[240px]">
          Lo que elijas a la derecha se aplica a todos.
        </p>
      </div>
    )
  }

  const item = items[0]
  const isImage = (item.mime_type ?? '').startsWith('image/')

  return (
    <div className="h-full min-h-[240px] flex flex-col gap-2">
      <div className="flex-1 bg-gray-50 rounded-lg flex items-center justify-center overflow-hidden">
        {item.preview_url && isImage && (
          <img src={item.preview_url} alt={item.file_name} className="max-h-[46vh] object-contain" />
        )}
        {item.preview_url && !isImage && (
          <iframe src={item.preview_url} title={item.file_name} className="w-full h-[46vh]" />
        )}
        {!item.preview_url && <p className="text-xs text-gray-400">Sin vista previa</p>}
      </div>
      <p className="text-[11px] text-gray-500 font-mono text-center truncate">{item.file_name}</p>
    </div>
  )
}
