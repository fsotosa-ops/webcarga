'use client'

import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FIELD_LABEL } from '@/components/ui/Field'

type FleetItem = { id: string; label: string }

interface Props {
  label:     string
  drivers:   FleetItem[]
  assets:    FleetItem[]
  onClose:   () => void
  onConfirm: (body: { driver_ids: string[]; asset_ids: string[] }) => Promise<void>
}

/** Reactivar una empresa eligiendo qué flota vuelve (D2, P3). Todo viene marcado:
 *  lo que se desmarca sale del roster hoy y queda en el historial. La empresa
 *  vuelve "No habilitada" hasta regularizar sus documentos: eso se calcula. */
export function ReactivateCarrierModal({ label, drivers, assets, onClose, onConfirm }: Props) {
  const [kept, setKept] = useState<Set<string>>(() => new Set([...drivers, ...assets].map(i => i.id)))

  function toggle(id: string) {
    setKept(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const group = (title: string, items: FleetItem[]) => (
    <fieldset className="space-y-1">
      <legend className={`${FIELD_LABEL} mb-1`}>{title}</legend>
      {items.length === 0 && <p className="text-dato text-informativo">Sin {title.toLowerCase()} en su roster.</p>}
      {items.map(i => (
        <label key={i.id} className="flex items-center gap-2 text-dato text-text-primary">
          <input type="checkbox" checked={kept.has(i.id)} onChange={() => toggle(i.id)} className="accent-accent" />
          {i.label}
        </label>
      ))}
    </fieldset>
  )

  return (
    <ConfirmDialog
      title={`Reactivar: ${label}`}
      confirmLabel="Reactivar"
      errorFallback="Error al reactivar"
      onConfirm={() => onConfirm({
        driver_ids: drivers.filter(d => kept.has(d.id)).map(d => d.id),
        asset_ids:  assets.filter(a => kept.has(a.id)).map(a => a.id),
      })}
      onClose={onClose}
    >
      <p className="text-informativo">
        Elige qué conductores y equipos vuelven con la empresa. Los que desmarques salen de su roster hoy.
        La empresa queda No habilitada hasta que regularice sus documentos.
      </p>
      {group('Conductores', drivers)}
      {group('Equipos', assets)}
    </ConfirmDialog>
  )
}
