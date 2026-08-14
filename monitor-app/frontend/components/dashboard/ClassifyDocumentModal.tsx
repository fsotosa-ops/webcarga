'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import type { TrayItem } from '@/lib/types'

type Subject = { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }

interface Props {
  item:         TrayItem | null
  subjects:     Subject[]
  onClose:      () => void
  onClassified: () => void
}

/** Clasificar un documento de la bandeja: vista previa + a quién pertenece +
 *  qué tipo es (HU-01).
 *
 *  La vista previa no es un adorno: de 24 documentos reales cargados, uno solo
 *  traía un identificador en el nombre. Con `IMG_4905.PNG` no hay forma de
 *  saber qué es sin abrirlo. */
export function ClassifyDocumentModal({ item, subjects, onClose, onClassified }: Props) {
  const [subjectKey, setSubjectKey] = useState('')
  const [requirementId, setRequirementId] = useState('')
  const [expiration, setExpiration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignedCount, setAssignedCount] = useState(0)

  const subject = useMemo(
    () => subjects.find(s => `${s.entity_type}:${s.entity_id}` === subjectKey) ?? null,
    [subjects, subjectKey],
  )

  const requirementsQuery = useQuery({
    queryKey: ['compliance-requirements', subject?.entity_type],
    queryFn: () => complianceApi.listRequirements(subject!.entity_type),
    enabled: !!subject,
  })

  const requirements = requirementsQuery.data ?? []
  const selected = requirements.find(r => r.id === requirementId) ?? null
  const needsDate = selected?.has_expiration ?? false
  const canSubmit = !!subject && !!requirementId && (!needsDate || !!expiration) && !saving

  async function submit(keepOpen: boolean) {
    if (!subject || !item) return
    setSaving(true)
    setError(null)
    try {
      await documentIngestApi.classify(item.id, {
        entity_type: subject.entity_type,
        entity_id: subject.entity_id,
        requirement_id: requirementId,
        ...(expiration ? { expiration_date: expiration } : {}),
      })
      if (keepOpen) {
        // Caso del PDF unificado: el mismo archivo cubre varios requisitos.
        // Se limpia solo el tipo, no el archivo ni el sujeto.
        setRequirementId('')
        setExpiration('')
        setAssignedCount(c => c + 1)
      } else {
        onClassified()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo clasificar')
    } finally {
      setSaving(false)
    }
  }

  if (!item) return null

  const isImage = (item.mime_type ?? '').startsWith('image/')

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60] animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Clasificar ${item.file_name}`}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-3xl max-h-[85vh] overflow-hidden flex flex-col animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <p className="text-sm font-bold text-text-primary truncate">{item.file_name}</p>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 p-5 overflow-y-auto">
            <div className="bg-gray-50 rounded-lg flex items-center justify-center min-h-[220px] overflow-hidden">
              {item.preview_url && isImage && (
                <img src={item.preview_url} alt={item.file_name} className="max-h-[45vh] object-contain" />
              )}
              {item.preview_url && !isImage && (
                <iframe src={item.preview_url} title={item.file_name} className="w-full h-[45vh]" />
              )}
              {!item.preview_url && <p className="text-xs text-gray-400">Sin vista previa</p>}
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-600">Sujeto</span>
                <select
                  aria-label="Sujeto"
                  value={subjectKey}
                  onChange={e => { setSubjectKey(e.target.value); setRequirementId(''); setExpiration('') }}
                  className="w-full mt-1 text-xs border border-border rounded-lg px-2 py-1.5"
                >
                  <option value="">— Seleccionar —</option>
                  {subjects.map(s => (
                    <option key={`${s.entity_type}:${s.entity_id}`} value={`${s.entity_type}:${s.entity_id}`}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              {subject && (
                <label className="block">
                  <span className="text-[11px] font-semibold text-gray-600">Tipo de documento</span>
                  <select
                    aria-label="Tipo de documento"
                    value={requirementId}
                    onChange={e => { setRequirementId(e.target.value); setExpiration('') }}
                    disabled={requirementsQuery.isPending}
                    className="w-full mt-1 text-xs border border-border rounded-lg px-2 py-1.5"
                  >
                    <option value="">— Seleccionar —</option>
                    {requirements.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
              )}

              {needsDate && (
                <label className="block">
                  <span className="text-[11px] font-semibold text-gray-600">Fecha de vencimiento</span>
                  <input
                    type="date"
                    aria-label="Fecha de vencimiento"
                    value={expiration}
                    onChange={e => setExpiration(e.target.value)}
                    className="w-full mt-1 text-xs border border-border rounded-lg px-2 py-1.5"
                  />
                </label>
              )}

              {error && <p className="text-[11px] text-red-500">{error}</p>}
            </div>
          </div>

          <div className="shrink-0 border-t border-border px-5 py-4 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500">
              {assignedCount > 0 && `Asignado a ${assignedCount} requisito${assignedCount > 1 ? 's' : ''}`}
            </span>
            <span className="flex gap-2">
              <button onClick={onClose} className="text-sm font-semibold text-gray-600 px-3 py-2">
                {assignedCount > 0 ? 'Listo' : 'Cancelar'}
              </button>
              <button
                onClick={() => submit(true)}
                disabled={!canSubmit}
                title="Para un archivo que contiene varios documentos"
                className="text-sm font-semibold text-accent px-3 py-2 rounded-lg hover:bg-accent/5 disabled:opacity-40 transition-colors"
              >
                Clasificar y seguir
              </button>
              <button
                onClick={() => submit(false)}
                disabled={!canSubmit}
                className="flex items-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {saving && <Loader2 size={14} className="animate-spin" />} Clasificar
              </button>
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
