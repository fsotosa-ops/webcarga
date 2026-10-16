'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { StatusChip } from '@/components/ui/StatusChip'
import { DocumentPreviewModal } from '@/components/dashboard/DocumentPreviewModal'
import { policyFileStyle } from '@/lib/states'

/** Un archivo de la póliza (la póliza o el endoso): ver, subir, reemplazar o
 *  borrar. Salió del modal viejo (Seguros E2) con las piezas del kit: el chip de
 *  estado y el "Subir" punteado de Pendientes. */
export function PolicyFileRow({ label, detail, url, canEdit, onUpload, onDelete }: {
  label: string
  detail?: string
  url: string | null
  canEdit: boolean
  onUpload: (file: File) => void | Promise<void>
  onDelete?: () => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const s = policyFileStyle(!!url)
  return (
    <div className="flex min-h-10 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-dato text-text-primary">
        {label}{detail && <span className="text-informativo"> · {detail}</span>}
      </span>
      <span className="w-28 shrink-0"><StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip></span>
      <span className="flex w-48 shrink-0 items-center justify-end gap-3">
        {url && (
          <button type="button" onClick={() => setPreviewOpen(true)} className="text-etiqueta font-semibold text-accion hover:underline">
            Ver
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => inputRef.current?.click()} aria-label={`${url ? 'Reemplazar' : 'Subir'} ${label}`}
                  className="inline-flex min-w-24 items-center justify-center gap-1.5 rounded-md border border-dashed border-accion/45 px-2 py-0.5 text-etiqueta font-semibold text-accion hover:opacity-70">
            <Upload size={12} aria-hidden="true" /> {url ? 'Reemplazar' : 'Subir'}
          </button>
        )}
      </span>
      {canEdit && (
        <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f) }} />
      )}
      {previewOpen && url && (
        <DocumentPreviewModal label={label} url={url} canEdit={canEdit} onClose={() => setPreviewOpen(false)}
                              onDelete={canEdit && onDelete ? onDelete : undefined} />
      )}
    </div>
  )
}
