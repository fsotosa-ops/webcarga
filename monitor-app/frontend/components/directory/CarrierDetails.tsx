'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { StatusChip } from '@/components/ui/StatusChip'
import { insuranceVerdictStyle } from '@/lib/states'
import type { CarrierInsuranceRow } from '@/lib/api/insurance'
import { INSURANCE } from '@/lib/navegacion/insurance'
import { FIELD_LABEL, inputClass } from '@/components/ui/Field'

const INPUT = `w-full ${inputClass({ size: 'sm' })}`

/** Editar los datos de una empresa, en el bloque Detalles de su ficha (Entrega 1
 *  de fichas, 15/10). La razón social se editaba sobre el título; el ID de la
 *  administración anterior, que el encabezado mostraba como "ID legacy admin",
 *  queda acá como referencia. El borrador sale de los datos al montarse, y el
 *  bloque lo monta cada vez que se abre. */
export function CarrierEditForm({ businessName, legacyAdminId, onSave, onClose }: {
  businessName: string
  legacyAdminId: string | number | null
  onSave: (businessName: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(businessName)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true); setErr(null)
    try {
      await onSave(name.trim())
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className={FIELD_LABEL}>Razón social</span>
        <input aria-label="Razón social" value={name} onChange={e => setName(e.target.value)} className={INPUT} />
      </label>
      {legacyAdminId != null && (
        <p className="text-etiqueta text-informativo">
          ID en la administración anterior: <span className="font-identificador tabular-nums">{legacyAdminId}</span>
        </p>
      )}
      {err && <p role="alert" className="text-etiqueta text-status-incidente">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
          Guardar
        </button>
        <button type="button" onClick={onClose} disabled={saving}
                className="rounded-lg border border-border px-3 py-1.5 text-dato text-text-primary hover:bg-bg-main disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Los seguros de una empresa en una línea de Detalles: el estado de la empresa
 *  que calcula la base (el mismo de Seguros › Pólizas por empresa; las canceladas y
 *  renovadas no cuentan) y, si hay, sus cuotas vencidas. El detalle vive en Seguros. */
export function InsuranceLine({ summary, taxId }: {
  /** `undefined` mientras carga; `null` si la empresa no tiene pólizas. */
  summary: CarrierInsuranceRow | null | undefined
  taxId: string
}) {
  if (summary === undefined) return <span className="text-informativo">Cargando…</span>
  if (summary === null) return <span className="text-informativo">Sin pólizas registradas</span>
  // El veredicto de Seguros (calculado en la base): ya junta vigencia y cuotas vencidas.
  const s = insuranceVerdictStyle(summary)
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
      <Link href={`${INSURANCE}?q=${encodeURIComponent(taxId)}`} prefetch={false} className="font-medium text-accion hover:underline">
        Ver en Seguros
      </Link>
    </span>
  )
}
