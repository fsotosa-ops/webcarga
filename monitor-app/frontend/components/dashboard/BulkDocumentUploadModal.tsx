'use client'

import { useRef, useState } from 'react'
import { X, Upload, Loader2, CheckCircle2, XCircle, FileText } from 'lucide-react'
import type { BulkUploadResult, PendingComplianceRow } from '@/lib/types'
import { complianceApi } from '@/lib/api/compliance'

interface Props {
  open:         boolean
  carrierId:    string
  carrierName:  string
  carrierTaxId: string
  /** Filas pendientes de ESTA empresa — el "Seleccionar el documento a
   *  subir" del diseño validado en Figma (checklist por sujeto+documento). */
  pendingSlots: PendingComplianceRow[]
  onClose:      () => void
  onSaved:      (result: BulkUploadResult) => void
}

/** Modal de carga masiva — mismo dropzone hecho a mano que TripBulkUpload.tsx
 *  (onDragOver/onDragLeave/onDrop + input file oculto), extendido a
 *  `multiple` (primer input de archivo de la app que acepta varios a la
 *  vez). A diferencia de TripBulkUpload (CSV tabular → N registros), acá
 *  cada archivo binario dropeado se empareja MANUALMENTE con una fila
 *  pendiente (no hay forma confiable de auto-matchear un PDF escaneado
 *  contra un tipo de documento por su nombre de archivo). */
export function BulkDocumentUploadModal({ open, carrierId, carrierName, carrierTaxId, pendingSlots, onClose, onSaved }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [staged, setStaged]         = useState<{ file: File; recordId: string }[]>([])
  const [saving, setSaving]         = useState(false)
  const [result, setResult]         = useState<BulkUploadResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStaged([]); setResult(null); setSaving(false); setIsDragging(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function addFiles(files: FileList | File[]) {
    const assignedIds = new Set(staged.map(s => s.recordId))
    const freeSlots = pendingSlots.filter(s => !assignedIds.has(s.id))
    const additions = Array.from(files).map((file, i) => ({
      file,
      recordId: freeSlots[i]?.id ?? '',
    }))
    setStaged(prev => [...prev, ...additions])
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files)
    e.target.value = ''
  }

  function assignSlot(index: number, recordId: string) {
    setStaged(prev => prev.map((s, i) => (i === index ? { ...s, recordId } : s)))
  }

  function removeStaged(index: number) {
    setStaged(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    const pairs = staged
      .filter(s => s.recordId)
      .map(s => ({ recordId: s.recordId, file: s.file }))
    if (!pairs.length) return
    setSaving(true)
    try {
      const res = await complianceApi.bulkUploadFile(carrierId, pairs)
      setResult(res)
      onSaved(res)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const assignedCount = staged.filter(s => s.recordId).length
  const unassignedCount = staged.length - assignedCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-backdrop-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Subir masivo — Empresa ${carrierName}`}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-modal-in"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-slate-800">Subir masivo</h2>
            <p className="text-xs text-gray-400 mt-0.5">Empresa {carrierName} — {carrierTaxId}</p>
          </div>
          <button onClick={handleClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-5">
          {!result && (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-label="Subir documentos"
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  isDragging ? 'border-accent bg-accent/5 scale-[1.01]' : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50/60'
                }`}
              >
                <Upload size={28} className={`mx-auto mb-2 ${isDragging ? 'text-accent' : 'text-gray-300'}`} />
                <p className="text-sm font-semibold text-gray-600">Arrastrar y soltar archivos</p>
                <p className="text-xs text-gray-400 mt-1">o hacé clic para cargar archivos</p>
              </div>
              <input
                ref={fileRef} type="file" multiple className="hidden"
                aria-label="Archivos a subir" onChange={onFileChange}
              />

              {staged.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                    Documentos cargados ({staged.length}
                    {unassignedCount > 0 && `, ${unassignedCount} sin asignar`})
                  </p>
                  <div className="space-y-1.5">
                    {staged.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2">
                        <FileText size={13} className="text-gray-400 shrink-0" />
                        <span className="text-xs text-slate-700 truncate flex-1">{s.file.name}</span>
                        <select
                          aria-label={`Documento correspondiente a ${s.file.name}`}
                          value={s.recordId}
                          onChange={e => assignSlot(i, e.target.value)}
                          className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white max-w-[260px]"
                        >
                          <option value="">— Seleccionar el documento a subir —</option>
                          {pendingSlots.map(slot => (
                            <option key={slot.id} value={slot.id}>
                              {(slot.subject_name ?? slot.carrier_name)} — {slot.document_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={`Quitar ${s.file.name}`}
                          onClick={() => removeStaged(i)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {unassignedCount > 0 && (
                    <p className="text-[11px] text-amber-600 mt-2">
                      {unassignedCount} archivo{unassignedCount !== 1 ? 's' : ''} sin documento asignado — no se subirá{unassignedCount !== 1 ? 'n' : ''} hasta que elijas a cuál corresponde.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-4">
              <div className="text-center space-y-2">
                {result.uploaded.length > 0
                  ? <CheckCircle2 size={40} className="mx-auto text-green-500" />
                  : <XCircle size={40} className="mx-auto text-red-400" />}
                <p className="text-base font-bold text-slate-800">
                  {result.uploaded.length} documento{result.uploaded.length !== 1 ? 's' : ''} subido{result.uploaded.length !== 1 ? 's' : ''}
                </p>
                {result.errors.length > 0 && (
                  <p className="text-sm text-gray-500">{result.errors.length} con error</p>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1.5">
                  {result.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <XCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-semibold text-red-700">{e.file_name ?? e.record_id}</p>
                        <p className="text-[10px] text-red-600">{e.error}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3">
          {!result ? (
            <>
              <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || assignedCount === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                GUARDAR{assignedCount > 0 ? ` (${assignedCount})` : ''}
              </button>
            </>
          ) : (
            <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors text-center">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
