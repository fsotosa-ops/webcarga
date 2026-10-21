'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import { taxonomiesApi } from '@/lib/api/config'
import { tripsApi } from '@/lib/api/trips'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { OPERATION_TYPE_CONFLICT_LABEL, OPERATION_TYPE_SOURCE_LABEL } from '@/lib/states'
import { StatusChip } from '@/components/ui/StatusChip'
import { Button } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Field'
import type { Trip } from '@/lib/types'

/**
 * El tipo de operación del viaje y de dónde sale (plan 2026-10-21).
 *
 * Lo normal es no tocarlo: sale del cliente si trabaja con un solo tipo, o del tracto.
 * Operaciones lo cambia solo cuando el viaje fue la excepción (gestión por excepción,
 * el estándar de los TMS): la marca "Tipo distinto al del cliente" es la que lo pide.
 * Cambiarlo exige el mismo permiso que vincular la flota del viaje.
 */
export function TripOperationType({ trip, onSaved }: { trip: Trip; onSaved: (updated: Trip) => void }) {
  const canEdit = usePermiso('trips.edit_sensitive')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ typeId: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const types = useQuery({
    queryKey: taxonomyKey('WEBCARGA_OPERATION_TYPE'),
    queryFn: () => taxonomiesApi.list('WEBCARGA_OPERATION_TYPE'),
    staleTime: 5 * 60_000,
    enabled: editing,
  })

  // Otro viaje: lo que se estaba editando no es de él.
  useEffect(() => { setEditing(false); setError(null) }, [trip.id])

  function open() {
    setDraft({ typeId: trip.operation_type_id ?? '', note: '' })
    setError(null)
    setEditing(true)
  }

  async function run(action: () => Promise<Trip>) {
    setSaving(true)
    setError(null)
    try {
      onSaved(await action())
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el tipo de operación')
    } finally {
      setSaving(false)
    }
  }

  const source = trip.operation_type_source ? OPERATION_TYPE_SOURCE_LABEL[trip.operation_type_source] : null

  if (!editing) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-dato">
        <span className="text-informativo">Tipo de operación:</span>
        <span className="font-semibold text-text-primary">{trip.operation_type_label ?? 'Sin tipo'}</span>
        {source && <span className="text-etiqueta text-informativo">· {source}</span>}
        {trip.operation_type_conflict && <StatusChip tone="warning">{OPERATION_TYPE_CONFLICT_LABEL}</StatusChip>}
        {canEdit && (
          <button type="button" onClick={open} className="text-etiqueta font-semibold text-accion hover:underline">
            Cambiar
          </button>
        )}
        {canEdit && trip.operation_type_source === 'declared' && (
          <button type="button" disabled={saving} onClick={() => run(() => tripsApi.clearOperationType(trip.id))}
            title="Volver al tipo del cliente o del tracto" aria-label="Volver al tipo calculado"
            className="text-informativo hover:text-accion disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          </button>
        )}
        {error && <p role="alert" className="w-full text-dato text-status-incidente">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      <label className="block text-dato">
        <span className="text-informativo">Tipo de operación</span>
        <select value={draft.typeId} autoFocus disabled={saving}
          onChange={e => setDraft(d => ({ ...d, typeId: e.target.value }))}
          className={`${inputClass({ size: 'sm' })} mt-1 w-full`}>
          <option value="">Elige…</option>
          {(types.data ?? []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label className="block text-dato">
        <span className="text-informativo">Comentario</span>
        <input value={draft.note} maxLength={500} disabled={saving}
          onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
          className={`${inputClass({ size: 'sm' })} mt-1 w-full`} />
      </label>
      <div className="flex gap-2">
        <Button disabled={saving} onClick={() => setEditing(false)}>Cancelar</Button>
        <Button variant="primary" disabled={saving || !draft.typeId}
          onClick={() => run(() => tripsApi.declareOperationType(trip.id, {
            operation_type_id: draft.typeId, note: draft.note.trim() || undefined }))}>
          {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          Guardar
        </Button>
      </div>
      {error && <p role="alert" className="text-dato text-status-incidente">{error}</p>}
    </div>
  )
}
