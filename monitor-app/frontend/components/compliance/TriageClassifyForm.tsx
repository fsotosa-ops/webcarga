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
  /** Empresa de la selección — se muestra en el encabezado para que quede
   *  claro sobre quién se está actuando cuando hay varios marcados. */
  carrierLabel?: string | null
}

/** Panel derecho: a quién pertenece y qué es.
 *
 *  El mismo formulario sirve para uno o para quince — la selección múltiple no
 *  necesita una pantalla propia. */
export function TriageClassifyForm({ targetIds, subjects, onApplied, carrierLabel }: Props) {
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

  // El vacio es una instruccion, no un cartel de "no hay nada".
  if (!targetIds.length) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-xs font-medium text-gray-500">
          Elegí uno o más documentos de la lista
        </p>
        <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
          Con uno marcado clasificás ese. Con quince, el mismo formulario los
          clasifica a los quince.
        </p>
      </div>
    )
  }

  const SELECT = 'w-full mt-1 text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all disabled:bg-gray-50 disabled:text-gray-400'

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] text-gray-500">
        <span className="font-semibold text-slate-700 tabular-nums">
          {targetIds.length === 1 ? '1 documento' : `${targetIds.length} documentos`}
        </span>
        {carrierLabel && <span> · {carrierLabel}</span>}
      </p>

      <label className="block">
        <span className="text-[11px] font-semibold text-gray-600">Sujeto</span>
        <select
          aria-label="Sujeto"
          value={subjectKey}
          onChange={e => { setSubjectKey(e.target.value); setRequirementId(''); setExpiration('') }}
          className={SELECT}
        >
          <option value="">— Seleccionar —</option>
          {subjects.map(s => (
            <option key={`${s.entity_type}:${s.entity_id}`} value={`${s.entity_type}:${s.entity_id}`}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {!subjects.length && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
          Esta empresa no tiene requisitos pendientes que se puedan asignar. Suele
          pasar cuando no está activa.
        </p>
      )}

      {subject && (
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-600">Tipo de documento</span>
          <select
            aria-label="Tipo de documento"
            value={requirementId}
            onChange={e => { setRequirementId(e.target.value); setExpiration('') }}
            disabled={requirementsQuery.isPending}
            className={SELECT}
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
            className={SELECT}
          />
        </label>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-colors bg-accent text-white hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        {targetIds.length === 1 ? 'Clasificar' : `Clasificar los ${targetIds.length}`}
      </button>
    </div>
  )
}
