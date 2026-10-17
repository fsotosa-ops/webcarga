'use client'

import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, inputClass } from '@/components/ui/Field'

interface Props {
  /** "RUT" o "patente". */
  field:     string
  current:   string | null
  /** Lo que pasa con el valor viejo, dicho antes de confirmar. */
  hint:      string
  onClose:   () => void
  onConfirm: (value: string, reason: string) => Promise<void>
}

/** Corregir el RUT de un conductor o la patente de un equipo (D3, Entrega B): con
 *  motivo obligatorio, que queda en la auditoría. Un duplicado lo rechaza la API con
 *  el nombre de quien ya lo tiene. Una variante por prop, no dos diálogos. */
export function CorrectIdentityModal({ field, current, hint, onClose, onConfirm }: Props) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const ready = value.trim().length > 0 && reason.trim().length > 0
  const fieldName = field[0].toUpperCase() + field.slice(1)

  return (
    <ConfirmDialog
      title={`Corregir ${field}`}
      confirmLabel="Corregir"
      confirmDisabled={!ready}
      errorFallback="No se pudo corregir"
      onConfirm={() => onConfirm(value.trim(), reason.trim())}
      onClose={onClose}
    >
      <p className="text-dato text-informativo">
        {fieldName} actual: <span className="font-identificador text-text-primary">{current ?? 'sin dato'}</span>. {hint}
      </p>
      <Field label={`${fieldName} correcto`}>{id => (
        <input id={id} value={value} onChange={e => setValue(e.target.value)} autoFocus
               className={`${inputClass({ size: 'sm' })} w-full font-identificador`} />
      )}</Field>
      <Field label="Motivo (queda en la auditoría)">{id => (
        <textarea id={id} value={reason} onChange={e => setReason(e.target.value)} rows={2}
                  className={`${inputClass({ size: 'sm' })} w-full`} />
      )}</Field>
    </ConfirmDialog>
  )
}
