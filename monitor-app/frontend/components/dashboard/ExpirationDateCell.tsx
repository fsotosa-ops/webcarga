'use client'

import { useState } from 'react'
import { CalendarPlus, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { formatExpiry } from '@/lib/compliance'

interface Props {
  recordId: string
  value:    string | null
  required: boolean
  canEdit:  boolean
  onSaved:  (recordId: string, value: string | null) => void
}

/** Celda de vencimiento editable en línea (HU-02).
 *
 *  Permite declarar la fecha aunque todavía no exista el archivo: saber qué
 *  está por vencer no requiere tener el documento cargado. El requisito sigue
 *  contando como pendiente de archivo, pero ya alimenta las alertas. */
export function ExpirationDateCell({ recordId, value, required, canEdit, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEditor() {
    // Resincroniza desde el prop: NO confiar en el useState inicial, que quedó
    // congelado con el valor de la primera renderización.
    setDraft(value ?? '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (draft === (value ?? '')) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      const next = draft || null
      await complianceApi.patch(recordId, { expiration_date: next ?? undefined })
      onSaved(recordId, next)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return <span className="text-[11px] text-gray-500">{value ? formatExpiry(value) : '—'}</span>
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEditor}
        aria-label={value ? 'Editar vencimiento' : 'Agregar vencimiento'}
        className="text-[11px] font-medium text-gray-600 hover:text-accent transition-colors flex items-center gap-1"
      >
        {value ? formatExpiry(value) : (
          <><CalendarPlus size={11} /> {required ? 'Agregar vencimiento' : 'Sin vencimiento'}</>
        )}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="date"
        autoFocus
        aria-label="Fecha de vencimiento"
        value={draft}
        disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
        }}
        className="text-[11px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {saving && <Loader2 size={11} className="animate-spin text-gray-400" />}
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </span>
  )
}
