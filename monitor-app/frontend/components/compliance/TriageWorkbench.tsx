'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UploadCloud } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useCanEdit } from '@/hooks/useCanEdit'
import { MoveToCarrierBar } from './MoveToCarrierBar'
import { TriageClassifyForm } from './TriageClassifyForm'
import { TriageFileList } from './TriageFileList'
import { TriagePreview } from './TriagePreview'

interface Props {
  carrierId:   string
  carrierName: string
}

/** La bandeja de trabajo: tres paneles, cero modales.
 *
 *  Reemplaza al par panel + modal de clasificación, que costaba ~5 clics por
 *  documento. Acá el formulario aplica a todo lo marcado: con un archivo
 *  clasifica ese, con quince aplica a los quince. */
export function TriageWorkbench({ carrierId, carrierName }: Props) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<{ file_name: string; error: string }[]>([])

  const trayKey = ['ingest-tray', carrierId]
  const trayQuery = useQuery({ queryKey: trayKey, queryFn: () => documentIngestApi.listTray(carrierId) })
  const pendingQuery = useQuery({
    queryKey: ['compliance-pending-carrier-panel', carrierId],
    queryFn: () => complianceApi.listPending({ carrierId, limit: 200 }),
  })

  const items = trayQuery.data ?? []
  const rows = pendingQuery.data?.rows ?? []

  const subjects = useMemo(() => {
    const seen = new Map<string, { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }>()
    for (const r of rows) {
      const key = `${r.entity_type}:${r.entity_id}`
      if (!seen.has(key)) {
        seen.set(key, {
          entity_type: r.entity_type as 'CARRIER' | 'DRIVER' | 'ASSET',
          entity_id: r.entity_id,
          label: r.subject_name ?? r.carrier_name,
        })
      }
    }
    return Array.from(seen.values())
  }, [rows])

  // Con nada marcado, el formulario opera sobre el archivo enfocado: así se
  // clasifica de a uno sin obligar a marcar primero.
  const targetIds = selectedIds.size > 0
    ? items.filter(i => selectedIds.has(i.id)).map(i => i.id)
    : (focusedId ? [focusedId] : [])
  const previewItems = items.filter(i => targetIds.includes(i.id))

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => documentIngestApi.upload(carrierId, files),
    onSuccess: res => { setErrors(res.errors); qc.invalidateQueries({ queryKey: trayKey }) },
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => documentIngestApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: trayKey }),
  })

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) uploadMutation.mutate(files)
  }

  function handleApplied() {
    setSelectedIds(new Set())
    setFocusedId(null)
    qc.invalidateQueries({ queryKey: trayKey })
    qc.invalidateQueries({ queryKey: ['compliance-pending-carrier-panel', carrierId] })
    qc.invalidateQueries({ queryKey: ['compliance-pending'] })
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
          }`}
        >
          {uploadMutation.isPending
            ? <Loader2 size={16} className="animate-spin text-accent" />
            : <UploadCloud size={16} className="text-gray-400" />}
          <span className="text-[11px] text-gray-500">
            Arrastrá acá los documentos de {carrierName}
          </span>
          <input
            type="file" multiple className="hidden"
            aria-label={`Arrastrá acá los documentos de ${carrierName}`}
            onChange={e => handleFiles(e.target.files)}
          />
        </label>
      )}

      {errors.map(e => (
        <p key={e.file_name} className="text-[10px] text-red-500">{e.file_name}: {e.error}</p>
      ))}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_240px] gap-3">
        <div className="border border-border rounded-lg overflow-y-auto max-h-[52vh]">
          {trayQuery.isPending ? (
            <p className="text-[11px] text-gray-400 p-3 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Cargando…
            </p>
          ) : (
            <TriageFileList
              items={items}
              focusedId={focusedId}
              selectedIds={selectedIds}
              onFocus={setFocusedId}
              onToggle={id => setSelectedIds(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })}
              onToggleAll={() => setSelectedIds(prev =>
                prev.size === items.length ? new Set() : new Set(items.map(i => i.id)),
              )}
              onDiscard={id => removeMutation.mutate(id)}
            />
          )}
        </div>

        <div className="border border-border rounded-lg p-3">
          <TriagePreview items={previewItems} />
        </div>

        <div className="border border-border rounded-lg p-3 space-y-3">
          <TriageClassifyForm
            targetIds={canEdit ? targetIds : []}
            subjects={subjects}
            onApplied={handleApplied}
          />
          <MoveToCarrierBar
            targetIds={canEdit ? targetIds : []}
            currentCarrierId={carrierId}
            onMoved={() => { setSelectedIds(new Set()); setFocusedId(null) }}
          />
        </div>
      </div>

      <p className="text-[10px] text-gray-400 font-mono">
        ↑↓ mover · space marcar · ↵ aplicar · ⌫ descartar
      </p>
    </div>
  )
}
