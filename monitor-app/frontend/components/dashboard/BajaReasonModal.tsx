'use client'

import { useState } from 'react'
import { X, Loader2, Ban } from 'lucide-react'
import type { CarrierDeactivationImpact } from '@/lib/types'

interface Props {
  label:     string
  onClose:   () => void
  onConfirm: () => Promise<void>
  /** Solo para una empresa (D2, P4): lo que toca la baja, antes de confirmar.
   *  `undefined` = no aplica (conductor o equipo); `null` = todavía cargando. */
  impact?:   CarrierDeactivationImpact | null
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`
}

/** Mini-modal de confirmación de baja (empresa/conductor/vehículo) — rol
 *  admin. El modelo nuevo no tiene una columna de "motivo de baja" (solo
 *  operational_status, ver schemas/{carrier,driver,asset}.py), así que esto
 *  es una confirmación simple, no un formulario — el cambio de estado ya
 *  queda en public.audit_log vía record_manual_edit. */
export function BajaReasonModal({ label, onClose, onConfirm, impact }: Props) {
  const loadingImpact = impact === null
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]               = useState<string | null>(null)

  async function handleConfirm() {
    setSubmitting(true); setErr(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al dar de baja')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Ban size={14} /> Dar de baja: {label}
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-500">
            Esto pasa el estado operativo a inactivo. Se puede reactivar en cualquier momento.
          </p>

          {impact !== undefined && (
            <div className="rounded-lg border border-border bg-bg-main px-3 py-2 text-xs text-informativo" aria-live="polite">
              {loadingImpact ? (
                <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Calculando qué toca la baja…</span>
              ) : (
                <ul className="space-y-0.5">
                  <li>Su flota activa: {plural(impact.drivers, 'conductor', 'conductores')} y {plural(impact.assets, 'equipo', 'equipos')}. Quedan vinculados como historial.</li>
                  <li>Viajes de hoy: {impact.trips_today}.</li>
                  <li>Días abiertos del Cierre con su flota: {impact.open_closure_days}.</li>
                </ul>
              )}
            </div>
          )}

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={submitting || loadingImpact}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Confirmar baja'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
