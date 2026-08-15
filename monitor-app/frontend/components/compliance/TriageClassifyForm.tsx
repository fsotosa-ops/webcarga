'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { PendingSlotPicker, type Slot } from './PendingSlotPicker'
import type { PendingComplianceRow } from '@/lib/types'

type Subject = { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }

/** La regla del lote (diseño §7): en una tanda una coordenada se comparte y la
 *  otra tiene que ser distinta en cada archivo. Este formulario fija las dos
 *  —el sujeto y el requisito—, así que aplica a un archivo. Marcar 31 licencias
 *  y mandarlas al mismo conductor destruía 30: ese conductor tiene UNA ranura
 *  de Licencia de Conducir. El backend también lo rechaza; acá se avisa antes
 *  de que la persona haga clic. */
export const MENSAJE_LOTE_INVALIDO =
  'Un lote no puede compartir el sujeto y el tipo de documento a la vez: '
  + 'cada archivo necesita un requisito distinto'

interface Props {
  targetIds: string[]
  subjects:  Subject[]
  onApplied: (appliedIds: string[], errores?: { item_id: string; error: string }[]) => void
  /** Empresa de la selección — se muestra en el encabezado para que quede
   *  claro sobre quién se está actuando cuando hay varios marcados. */
  carrierLabel?: string | null
  /** Lo que le falta a esa empresa. Es el dato que responde "¿qué tengo
   *  pendiente acá?" sin salir de la pantalla, y el atajo para clasificar. */
  pendingRows?: PendingComplianceRow[]
}

/** Panel derecho: a quién pertenece y qué es.
 *
 *  El mismo formulario sirve para uno o para quince — la selección múltiple no
 *  necesita una pantalla propia. */
export function TriageClassifyForm({
  targetIds, subjects, onApplied, carrierLabel, pendingRows = [],
}: Props) {
  const [subjectKey, setSubjectKey] = useState('')
  const [requirementId, setRequirementId] = useState('')
  const [expiration, setExpiration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [manual, setManual] = useState(false)

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

  function pickSlot(s: Slot) {
    setSlot(s)
    setError(null)
    setExpiration('')
    setSubjectKey(`${s.entity_type}:${s.entity_id}`)
    setRequirementId('')
  }
  const requisitoElegido = requirementId || slot?.requirement_id || ''
  const selected = requirements.find(r => r.id === requisitoElegido) ?? null
  const needsDate = selected?.has_expiration ?? false
  const loteInvalido = targetIds.length > 1
  const canApply = targetIds.length > 0 && !loteInvalido && !!subject && !!requisitoElegido
    && (!needsDate || !!expiration) && !saving

  async function apply() {
    if (!subject || loteInvalido) return
    setSaving(true)
    setError(null)
    try {
      const res = await documentIngestApi.classifyBatch({
        item_ids: targetIds,
        entity_type: subject.entity_type,
        entity_id: subject.entity_id,
        requirement_id: requisitoElegido,
        ...(expiration ? { expiration_date: expiration } : {}),
      })
      setRequirementId('')
      setExpiration('')
      setSlot(null)
      // Los errores por ítem viajan hacia arriba: descartarlos hacía que la
      // pantalla dijera "10 clasificados" cuando se habían marcado 12.
      if (res.errors.length) {
        setError(`${res.errors.length === 1 ? '1 documento no se pudo clasificar' : `${res.errors.length} documentos no se pudieron clasificar`}: `
          + Array.from(new Set(res.errors.map(x => x.error))).join(' · '))
      }
      onApplied(res.applied, res.errors)
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
          Selecciona uno o más documentos de la lista
        </p>
        <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
          Clasificar es de a un archivo: cada uno va a un requisito distinto.
          Marcar varios sirve para moverlos o descartarlos en lote.
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

      {loteInvalido && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
          {MENSAJE_LOTE_INVALIDO}. Deja marcado un solo archivo para clasificarlo.
        </p>
      )}

      {/* Lo que le falta a la empresa, que es la pregunta real: clasificar es
          cubrir un hueco concreto, no describir el archivo en abstracto. */}
      {!manual && pendingRows.length > 0 && (
        <>
          <PendingSlotPicker rows={pendingRows} selected={slot} onPick={pickSlot} />
          <button
            type="button"
            onClick={() => { setManual(true); setSlot(null) }}
            className="text-[10px] text-gray-500 hover:text-accent underline cursor-pointer"
          >
            No está en la lista
          </button>
        </>
      )}

      {(manual || !pendingRows.length) && (
        <>
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-600">¿A quién pertenece?</span>
            <select
              aria-label="¿A quién pertenece?"
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

          {/* Dos causas distintas para la misma lista vacía, y confundirlas
              dejaba al usuario sin saber qué hacer: un archivo recién soltado
              en la bandeja global no tiene empresa todavía, y el camino es
              moverlo (diseño §7: mover encamina, no termina). */}
          {!subjects.length && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              {carrierLabel
                ? 'Esta empresa no tiene requisitos pendientes que se puedan asignar. Suele pasar cuando la empresa no está activa.'
                : 'Este documento todavía no tiene empresa. Muévelo a una con el botón de la barra de selección y después elige a qué corresponde.'}
            </p>
          )}

          {subject && (
            <label className="block">
              <span className="text-[11px] font-semibold text-gray-600">¿Qué documento es?</span>
              <select
                aria-label="¿Qué documento es?"
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

          {manual && pendingRows.length > 0 && (
            <button
              type="button"
              onClick={() => { setManual(false); setRequirementId('') }}
              className="text-[10px] text-gray-500 hover:text-accent underline cursor-pointer"
            >
              Volver a los pendientes
            </button>
          )}
        </>
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
        {saving && <Loader2 size={14} className="motion-safe:animate-spin" />}
        {targetIds.length === 1 ? 'Clasificar' : `Clasificar los ${targetIds.length}`}
      </button>
    </div>
  )
}
