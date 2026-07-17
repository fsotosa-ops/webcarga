'use client'

import { AlertTriangle } from 'lucide-react'
import type { ComplianceRecord } from '@/lib/types'
import { COMPLIANCE_STATUS_CONFIG, expiryRelative, updatedRelative } from '@/lib/compliance'

interface Props {
  records: ComplianceRecord[]
}

/** Para MISSING/sin fecha de vencimiento, "hace cuánto" se responde con
 *  updated_at (cuándo se generó/tocó el registro) en vez de expiration_date
 *  — pedido explícito del usuario: una alerta binaria no dice desde cuándo. */
function relativeLabel(r: ComplianceRecord): string | null {
  return expiryRelative(r.expiration_date, r.is_expired) ?? updatedRelative(r.updated_at)
}

/** Lista de documentos obligatorios en estado crítico (context_carriers.md
 *  §5 Fase B.3) — reemplaza el semáforo de elegibilidad de Checkpoint A-E
 *  (sin equivalente en el modelo nuevo). Filas compactas sobre fondo
 *  blanco, no un bloque de color sólido: la severidad vive en el ícono y
 *  el pill de estado (mismo `COMPLIANCE_STATUS_CONFIG` que el resto de la
 *  app), no en pintar toda la tarjeta de rojo. */
export function TransporterAlertBanner({ records }: Props) {
  const problems = records.filter(r =>
    r.requirement_level === 'LEGAL_MANDATORY'
    && (r.is_expired || r.status === 'MISSING' || r.status === 'EXPIRED' || r.status === 'REJECTED'),
  )
  if (problems.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <AlertTriangle size={14} className="text-red-500 shrink-0" />
        <p className="text-xs font-bold text-text-primary">
          {problems.length} documento{problems.length > 1 ? 's' : ''} obligatorio{problems.length > 1 ? 's' : ''} con atención
        </p>
      </div>
      <div className="divide-y divide-border/60">
        {problems.map(r => {
          const relative = relativeLabel(r)
          const cfg = COMPLIANCE_STATUS_CONFIG[r.status]
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-xs font-medium text-text-primary truncate">{r.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                {relative && <span className="text-[11px] text-gray-400">{relative}</span>}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
