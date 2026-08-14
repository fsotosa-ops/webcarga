'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'

type Subject = { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }

interface Props {
  targetIds: string[]
  subjects:  Subject[]
  onApplied: (appliedIds: string[]) => void
}

/** Panel derecho: a quién pertenece y qué es.
 *
 *  El mismo formulario sirve para uno o para quince — la selección múltiple no
 *  necesita una pantalla propia. */
export function TriageClassifyForm({ targetIds, subjects, onApplied }: Props) {
  const [subjectKey, setSubjectKey] = useState('')
  const [requirementId, setRequirementId] = useState('')
  const [expiration, setExpiration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const canApply = targetIds.length > 0 && !!subject && !!requirementId
    && (!needsDate || !!expiration) && !saving

  async function apply() {
    if (!subject) return
    setSaving(true)
    setError(null)
    try {
      const res = await documentIngestApi.classifyBatch({
        item_ids: targetIds,
        entity_type: subject.entity_type,
        entity_id: subject.entity_id,
        requirement_id: requirementId,
        ...(expiration ? { expiration_date: expiration } : {}),
      })
      setRequirementId('')
      setExpiration('')
      onApplied(res.applied)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo clasificar')
    } finally {
      setSaving(false)
    }
  }

  if (!targetIds.length) {
    return (
      <p className="text-xs text-gray-400 p-2">
        Elegí uno o más documentos de la lista para clasificarlos.
      </p>
    )
  }

  return (
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

      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {targetIds.length === 1 ? 'Aplicar' : `Aplicar a los ${targetIds.length}`}
      </button>
    </div>
  )
}
