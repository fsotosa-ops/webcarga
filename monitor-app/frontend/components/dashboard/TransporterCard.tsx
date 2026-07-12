'use client'

import Link from 'next/link'
import { Building2, ChevronRight } from 'lucide-react'
import type { TransporterListItem } from '@/lib/types'
import { EligibilityDot } from './EligibilityDot'
import { InsuranceStatusBadge } from './InsuranceStatusBadge'
import { ClientChips } from './ClientChips'
import { ComplianceProgressBar } from './ComplianceProgressBar'

interface Props {
  item:     TransporterListItem
  onOpen:   (item: TransporterListItem) => void
  selected?: boolean
}

/** Tarjeta de empresa — vista Tarjetas del listado de Empresas y fallback
 *  mobile de la vista Tabla (una sola implementación para ambos casos).
 *  Click en la tarjeta abre el slide-over de resumen; el botón "Ver ficha"
 *  navega directo a la ficha completa. */
export function TransporterCard({ item, onOpen, selected = false }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
      className={`text-left bg-white border rounded-2xl p-4 space-y-3 cursor-pointer transition-all hover:shadow-md hover:border-gray-300 ${
        selected ? 'border-accent ring-2 ring-accent/10' : 'border-border'
      }`}
    >
      {/* Header: semáforo grande + nombre/RUT + acceso a ficha */}
      <div className="flex items-start gap-2.5">
        <EligibilityDot
          eligible={item.eligible}
          blockingReasons={item.blocking_reasons}
          compliancePct={item.compliance_pct}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-text-primary truncate leading-tight">
            {item.business_name ?? <span className="italic text-gray-400">Sin nombre</span>}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{item.rut ?? '—'}</p>
        </div>
        <Link
          href={`/dashboard/transportistas/empresa/${item.id}`}
          onClick={e => e.stopPropagation()}
          title="Ver ficha completa"
          className="text-gray-300 hover:text-accent transition-colors shrink-0 p-1 -m-1 rounded"
        >
          <ChevronRight size={16} />
        </Link>
      </div>

      {/* Avance 80/20 */}
      <div>
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Avance 80/20</p>
        <ComplianceProgressBar pct={item.avance_80_20} size="md" />
      </div>

      {/* Conteos compactos */}
      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <span><Building2 size={10} className="inline mr-1 -mt-0.5 text-gray-300" />{item.driver_count} cond.</span>
        <span>{item.tracto_count} tractos</span>
        <span>{item.trailer_count} ramplas</span>
      </div>

      {/* Footer: clientes GC + seguro */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
        <ClientChips clients={item.clients} />
        <InsuranceStatusBadge insuranceOk={item.insurance_ok} policiesCount={item.policies_count} />
      </div>
    </div>
  )
}
