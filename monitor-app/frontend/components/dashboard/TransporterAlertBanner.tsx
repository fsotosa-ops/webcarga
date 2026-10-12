'use client'

import { AlertTriangle } from 'lucide-react'
import type { ComplianceRecord } from '@/lib/types'
import { dueRelative, updatedRelative } from '@/lib/compliance'
import { documentEvidenceStyle, isBlocking } from '@/lib/states'
import { StatusChip } from '@/components/ui/StatusChip'

interface Props {
  records: ComplianceRecord[]
}

/** Lista de documentos obligatorios que impiden la habilitación, según la API
 *  (D1 §6.2): el filtro por `status` que vivía acá contaba REJECTED, ignoraba
 *  lo que todavía no se exige y mostraba "Aprobado (manual)" sobre un vencido.
 *  Para lo que no tiene fecha, "hace cuánto" se responde con updated_at: una
 *  alerta binaria no dice desde cuándo. Filas compactas sobre fondo blanco: la
 *  severidad vive en el ícono y el chip de estado, no en pintar la tarjeta. */
export function TransporterAlertBanner({ records }: Props) {
  const problems = records.filter(isBlocking)
  if (problems.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <AlertTriangle size={14} className="text-status-incidente shrink-0" />
        <p className="text-xs font-bold text-text-primary">
          {problems.length} documento{problems.length > 1 ? 's' : ''} obligatorio{problems.length > 1 ? 's' : ''} con atención
        </p>
      </div>
      <div className="divide-y divide-border/60">
        {problems.map(r => {
          const relative = dueRelative(r.days_to_expiry) ?? updatedRelative(r.updated_at)
          const s = documentEvidenceStyle(r.document_state, r.expiration_date, r.file_url !== null)
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-xs font-medium text-text-primary truncate">{r.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                {relative && <span className="text-etiqueta text-informativo">{relative}</span>}
                <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
