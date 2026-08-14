'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileQuestion, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { documentIngestApi } from '@/lib/api/documentIngest'
import type { TrayItem } from '@/lib/types'

interface Props {
  carrierId:  string
  canEdit:    boolean
  onClassify: (item: TrayItem) => void
}

/** Bandeja de documentos sin clasificar de una empresa (HU-01).
 *
 *  El archivo entra sin declarar nada y espera acá hasta que una persona lo
 *  clasifica. Es la respuesta a que los documentos llegan en bloque y con
 *  nombres que no dicen nada: "por una empresa de transporte voy a tener
 *  varios documentos sin clasificar, porque yo no sé lo que hay". */
export function UnclassifiedTray({ carrierId, canEdit, onClassify }: Props) {
  const qc = useQueryClient()
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<{ file_name: string; error: string }[]>([])

  const trayKey = ['ingest-tray', carrierId]
  const query = useQuery({ queryKey: trayKey, queryFn: () => documentIngestApi.listTray(carrierId) })

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => documentIngestApi.upload(carrierId, files),
    onSuccess: res => {
      setErrors(res.errors)
      qc.invalidateQueries({ queryKey: trayKey })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => documentIngestApi.remove(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: trayKey }),
  })

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) uploadMutation.mutate(files)
  }

  const items = query.data ?? []

  // Sin permiso y sin nada pendiente, el bloque no aporta nada.
  if (!canEdit && items.length === 0) return null

  return (
    <div className="space-y-2">
      {canEdit && (
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
          }`}
        >
          {uploadMutation.isPending
            ? <Loader2 size={18} className="animate-spin text-accent" />
            : <UploadCloud size={18} className="text-gray-400" />}
          <span className="text-[11px] text-gray-500 text-center">
            Arrastrá acá los documentos de esta empresa
          </span>
          <input
            type="file"
            multiple
            className="hidden"
            aria-label="Arrastrá acá los documentos de esta empresa"
            onChange={e => handleFiles(e.target.files)}
          />
        </label>
      )}

      {errors.map(e => (
        <p key={e.file_name} className="text-[10px] text-red-500">
          {e.file_name}: {e.error}
        </p>
      ))}

      {items.length > 0 && (
        <>
          <p className="text-[11px] font-semibold text-gray-500">
            {items.length} sin clasificar
          </p>
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
              <FileQuestion size={14} className="text-amber-500 shrink-0" />
              <p className="text-[11px] text-text-primary truncate flex-1">{item.file_name}</p>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => onClassify(item)}
                    className="text-[11px] font-semibold text-accent hover:underline shrink-0"
                  >
                    Clasificar
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${item.file_name}`}
                    onClick={() => removeMutation.mutate(item.id)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
