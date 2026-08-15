'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, UploadCloud, X } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useCanEdit } from '@/hooks/useCanEdit'
import { TriageBulkBar } from './TriageBulkBar'
import { TriageClassifyForm } from './TriageClassifyForm'
import { TriageFileTable } from './TriageFileTable'
import { TriagePreview } from './TriagePreview'

interface Props {
  /** Sin empresa = la cola global (la bandeja). Con empresa = acotada a esa
   *  empresa (la ficha). Es una sola prop opcional, no dos modos. */
  carrierId?:   string
  carrierName?: string
}

const QUEUE_PAGE = 200

/** La bandeja de trabajo: tabla, barra contextual y panel de detalle. Cero
 *  modales.
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
  const [notice, setNotice] = useState<string | null>(null)

  const queueKey = ['ingest-queue', carrierId ?? 'all']
  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => documentIngestApi.listQueue({ carrierId, limit: QUEUE_PAGE }),
  })

  const rows = queueQuery.data?.rows ?? []
  const total = queueQuery.data?.total ?? 0

  // La empresa de la selección. El formulario aplica un requisito de UNA
  // entidad, así que una selección que cruza empresas no tiene sentido: al
  // marcar un archivo de otra empresa la selección se reemplaza.
  const selectedCarrierId = useMemo(() => {
    const sel = rows.filter(r => selectedIds.has(r.id))
    if (!sel.length) return null
    const first = sel[0].carrier_id
    return sel.every(r => r.carrier_id === first) ? first : null
  }, [rows, selectedIds])

  const subjectCarrierId = selectedCarrierId
    ?? (focusedId ? rows.find(r => r.id === focusedId)?.carrier_id ?? null : null)

  const pendingQuery = useQuery({
    queryKey: ['compliance-pending-carrier-panel', subjectCarrierId],
    queryFn: () => complianceApi.listPending({ carrierId: subjectCarrierId!, limit: 200 }),
    enabled: !!subjectCarrierId,
  })

  const subjects = useMemo(() => {
    const seen = new Map<string, { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }>()
    for (const r of pendingQuery.data?.rows ?? []) {
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
  }, [pendingQuery.data])

  // Con nada marcado, el formulario opera sobre el archivo enfocado.
  const targetIds = selectedIds.size > 0
    ? rows.filter(r => selectedIds.has(r.id)).map(r => r.id)
    : (focusedId ? [focusedId] : [])

  // La vista previa se firma de a una, al enfocar — firmar el listado entero
  // es una llamada HTTP por archivo.
  const previewQuery = useQuery({
    queryKey: ['ingest-preview', focusedId],
    queryFn: () => documentIngestApi.previewUrl(focusedId!),
    enabled: !!focusedId && targetIds.length === 1,
  })

  const grupos = new Set(rows.map(r => r.carrier_id)).size

  const carrierLabel = rows.find(r => r.carrier_id === (selectedCarrierId ?? subjectCarrierId))?.carrier_name ?? null

  const previewItems = rows
    .filter(r => targetIds.includes(r.id))
    .map(r => ({
      id: r.id, file_name: r.file_name, mime_type: r.mime_type,
      size_bytes: r.size_bytes, storage_path: r.storage_path,
      match_status: r.match_status,
      preview_url: r.id === focusedId ? previewQuery.data?.preview_url ?? null : null,
    }))

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => documentIngestApi.upload(carrierId!, files),
    onSuccess: res => { setErrors(res.errors); qc.invalidateQueries({ queryKey: queueKey }) },
  })
  const discardMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => documentIngestApi.remove(id))),
    onSuccess: (_r, ids) => {
      setNotice(ids.length === 1 ? '1 descartado' : `${ids.length} descartados`)
      clearSelection()
      qc.invalidateQueries({ queryKey: queueKey })
      qc.invalidateQueries({ queryKey: ['ingest-queue-count'] })
    },
  })

  function clearSelection() {
    setSelectedIds(new Set())
    setFocusedId(null)
  }

  function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length) uploadMutation.mutate(files)
  }

  function handleToggle(id: string, opts?: { range?: boolean }) {
    setSelectedIds(prev => {
      const rowCarrier = rows.find(r => r.id === id)?.carrier_id ?? null
      const current = rows.filter(r => prev.has(r.id))
      const crossesCarrier = current.length > 0 && current.some(r => r.carrier_id !== rowCarrier)

      // Cruzar empresas reemplaza la selección en vez de sumarse.
      if (crossesCarrier) return new Set([id])

      if (opts?.range && focusedId) {
        const a = rows.findIndex(r => r.id === focusedId)
        const b = rows.findIndex(r => r.id === id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          const next = new Set(prev)
          for (const r of rows.slice(lo, hi + 1)) {
            if (r.carrier_id === rowCarrier) next.add(r.id)
          }
          return next
        }
      }

      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setFocusedId(id)
  }

  function handleApplied(appliedIds: string[]) {
    setNotice(`${appliedIds.length} clasificados · ${Math.max(total - appliedIds.length, 0)} restantes`)
    clearSelection()
    qc.invalidateQueries({ queryKey: queueKey })
    qc.invalidateQueries({ queryKey: ['compliance-pending-carrier-panel', subjectCarrierId] })
    qc.invalidateQueries({ queryKey: ['compliance-pending'] })
    qc.invalidateQueries({ queryKey: ['ingest-queue-count'] })
  }

  return (
    <div className="space-y-3">
      {/* Subir exige una empresa: la cola global no sabe a quién atribuir el
          archivo. Desde la ficha (con carrierId) siempre está disponible. */}
      {canEdit && carrierId && (
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
          }`}
        >
          {uploadMutation.isPending
            ? <Loader2 size={16} className="motion-safe:animate-spin text-accent" />
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

      {/* Un solo lienzo con dos regiones rotuladas, no dos tarjetas sueltas: la
          pantalla tiene que decir sola que el orden es elegir y despues
          clasificar. */}
      <div className="border border-border rounded-xl bg-white overflow-hidden">
        <div className="flex items-baseline gap-2 px-4 py-3 border-b border-border">
          <span className="text-2xl font-bold text-slate-800 tabular-nums leading-none">{total}</span>
          <span className="text-xs text-gray-500">sin clasificar</span>
          {grupos > 0 && (
            <span className="text-xs text-gray-500">
              · {grupos === 1 ? '1 empresa' : `${grupos} empresas`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
          <section aria-label="Elegí documentos" className="min-w-0 lg:border-r border-border">
            <h2 className="px-3 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <span className="text-accent">1</span> · Elegí documentos
            </h2>

            {canEdit && (
              <TriageBulkBar
                selectedCount={selectedIds.size}
                targetIds={targetIds}
                currentCarrierId={selectedCarrierId}
                onDiscard={() => discardMutation.mutate(targetIds)}
                onClear={clearSelection}
                onMoved={() => { setNotice('Documentos movidos'); clearSelection() }}
              />
            )}

            <div className="overflow-y-auto max-h-[54vh]">
              {queueQuery.isPending ? (
                <p className="text-[11px] text-gray-500 p-3 flex items-center gap-1.5">
                  <Loader2 size={11} className="motion-safe:animate-spin" /> Cargando…
                </p>
              ) : (
                <TriageFileTable
                  rows={rows}
                  focusedId={focusedId}
                  selectedIds={selectedIds}
                  onFocus={setFocusedId}
                  onToggle={handleToggle}
                  onToggleAll={() => setSelectedIds(prev =>
                    prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id)),
                  )}
                />
              )}
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-t border-border bg-gray-50/60">
              <p className="text-[10px] text-gray-500">
                <kbd className="font-sans">↑↓</kbd> mover ·{' '}
                <kbd className="font-sans">space</kbd> marcar ·{' '}
                <kbd className="font-sans">⇧+click</kbd> rango
              </p>
              {rows.length < total && (
                <p className="text-[10px] text-gray-500 tabular-nums">
                  Mostrando {rows.length} de {total}
                </p>
              )}
            </div>
          </section>

          <section aria-label="Clasificá" className="min-w-0 border-t lg:border-t-0 border-border">
            <h2 className="px-3 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <span className="text-accent">2</span> · Clasificá
            </h2>
            <div className="p-3 pt-1 space-y-3">
              <TriageClassifyForm
                targetIds={canEdit ? targetIds : []}
                subjects={subjects}
                carrierLabel={carrierLabel}
                onApplied={handleApplied}
              />
              {targetIds.length > 0 && <TriagePreview items={previewItems} />}
            </div>
          </section>
        </div>
      </div>

      {notice && (
        <div className="inline-flex items-center gap-3 bg-slate-800 text-white text-[11px] rounded-lg pl-3 pr-2 py-1.5 shadow-sm">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="p-0.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
