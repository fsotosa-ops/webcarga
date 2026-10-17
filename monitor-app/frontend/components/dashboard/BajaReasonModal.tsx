'use client'

import { Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
  return (
    <ConfirmDialog
      title={`Dar de baja: ${label}`}
      confirmLabel="Confirmar baja"
      tone="danger"
      confirmDisabled={loadingImpact}
      errorFallback="Error al dar de baja"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-informativo">
        Esto pasa el estado operativo a inactivo. Se puede reactivar en cualquier momento.
      </p>

      {impact !== undefined && (
        <div className="rounded-md border border-border bg-bg-main px-3 py-2 text-dato text-informativo" aria-live="polite">
          {loadingImpact ? (
            <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Calculando qué toca la baja…</span>
          ) : (
            <ul className="space-y-0.5">
              <li>Su flota activa: {plural(impact.drivers, 'conductor', 'conductores')} y {plural(impact.assets, 'equipo', 'equipos')}. Quedan vinculados como historial.</li>
              <li>Viajes de hoy: {impact.trips_today}.</li>
              <li>Días abiertos del Cierre con su flota: {impact.open_closure_days}.</li>
            </ul>
          )}
        </div>
      )}
    </ConfirmDialog>
  )
}
