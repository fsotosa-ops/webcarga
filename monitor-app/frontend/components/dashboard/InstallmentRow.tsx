'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Circle, AlertTriangle, Loader2, Undo2 } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { dueRelative, cuotaLabel } from '@/lib/utils/installments'

const TODAY = () => new Date().toISOString().slice(0, 10)

function isEffectivelyOverdue(inst: InsuranceInstallment): boolean {
  return inst.status === 'vencida' || (inst.status === 'pendiente' && !!inst.due_date && inst.due_date < TODAY())
}

interface Props {
  installment: InsuranceInstallment
  canAdmin:    boolean
  onChanged:   (updated: InsuranceInstallment) => void
}

/** Una fila de cuota: ícono de estado + "Cuota N de M" + fecha + monto +
 *  acción (Pagar, o revertir si ya está pagada). El botón de revertir
 *  siempre está en el DOM (funciona en touch), solo se atenúa visualmente
 *  hasta el hover/foco — no depende de un gesto de long-press. */
export function InstallmentRow({ installment, canAdmin, onChanged }: Props) {
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const overdue  = isEffectivelyOverdue(installment)
  const paid     = installment.status === 'pagada'
  const relative = dueRelative(installment.due_date, overdue)

  useEffect(() => {
    if (!confirming) return
    function onOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setConfirming(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [confirming])

  async function markPaid() {
    setSaving(true); setErr(null)
    try {
      const updated = await insuranceApi.patchInstallment(installment.id, {
        status: 'pagada',
        paid_at: TODAY(),
        expected_updated_at: installment.updated_at ?? undefined,
      })
      onChanged(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al marcar como pagada')
    } finally {
      setSaving(false)
    }
  }

  async function revert() {
    setSaving(true); setErr(null); setConfirming(false)
    try {
      const updated = await insuranceApi.revertInstallment(installment.id, {
        expected_updated_at: installment.updated_at ?? undefined,
      })
      onChanged(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir el pago')
    } finally {
      setSaving(false)
    }
  }

  const nodeCls = paid
    ? 'bg-green-500 border-green-500 text-white'
    : overdue
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  return (
    <div className="group flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-50">
      <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${nodeCls}`}>
        {paid ? <Check size={14} /> : overdue ? <AlertTriangle size={13} /> : <Circle size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-text-primary truncate">
          {cuotaLabel(installment.installment_number, installment.total_installments)}
          {paid && installment.paid_at ? ` · pagada el ${formatExpiry(installment.paid_at)}` : ''}
        </p>
        {!paid && (
          <p className={`text-[11px] ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
            {formatExpiry(installment.due_date)}{relative ? ` · ${relative}` : ''}
          </p>
        )}
      </div>
      <span className="text-xs font-bold text-text-primary tabular-nums shrink-0">
        {installment.amount_uf != null ? `${installment.amount_uf} UF` : '—'}
      </span>

      {!paid && (
        <button
          type="button"
          onClick={markPaid}
          disabled={!canAdmin || saving}
          title={!canAdmin ? 'Solo un administrador puede marcar cuotas como pagadas' : undefined}
          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-border text-gray-500 hover:text-accent hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Pagar
        </button>
      )}

      {paid && canAdmin && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={saving}
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-red-500 transition-opacity"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            revertir
          </button>

          {confirming && (
            <div
              ref={popoverRef}
              className="absolute right-0 top-full mt-2 z-10 flex items-center gap-2.5 bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap"
            >
              <span>¿Revertir a pendiente?</span>
              <button onClick={() => setConfirming(false)} className="font-semibold text-slate-400 hover:text-white">No</button>
              <button onClick={revert} className="font-semibold bg-red-600 hover:bg-red-500 rounded px-2 py-0.5">Sí</button>
            </div>
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-500 shrink-0 basis-full">{err}</p>}
    </div>
  )
}
