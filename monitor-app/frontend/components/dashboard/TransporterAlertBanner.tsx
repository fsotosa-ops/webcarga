'use client'

import { AlertTriangle } from 'lucide-react'
import type { ComplianceRecord } from '@/lib/types'

interface Props {
  records: ComplianceRecord[]
}

/** Banner de alerta cuando el backend informa documentos obligatorios en
 *  estado crítico (context_carriers.md §5 Fase B.3) — reemplaza el semáforo
 *  de elegibilidad de Checkpoint A-E (app.v_transporter_eligibility, sin
 *  equivalente en el modelo nuevo) por algo más concreto: la lista de
 *  requisitos LEGAL_MANDATORY que faltan, vencieron o fueron rechazados. */
export function TransporterAlertBanner({ records }: Props) {
  const problems = records.filter(r =>
    r.requirement_level === 'LEGAL_MANDATORY'
    && (r.is_expired || r.status === 'MISSING' || r.status === 'EXPIRED' || r.status === 'REJECTED'),
  )
  if (problems.length === 0) return null

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
      <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-bold text-red-700 mb-1">Documentos obligatorios pendientes o vencidos</p>
        <ul className="space-y-0.5">
          {problems.map(r => (
            <li key={r.id} className="text-xs text-red-600">
              {r.name}
              {r.is_expired ? ' — vencido' : r.status === 'MISSING' ? ' — falta' : r.status === 'REJECTED' ? ' — rechazado' : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
