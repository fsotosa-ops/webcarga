'use client'

import { carrierHref } from '@/lib/navegacion/directory'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { StatusChip } from '@/components/ui/StatusChip'
import { enablementStyle, lifecycleStyle } from '@/lib/states'
import type { CarrierListItem } from '@/lib/types'

interface Props {
  item:     CarrierListItem
  onOpen:   (item: CarrierListItem) => void
  selected?: boolean
  /** La lista con sus filtros: la ficha vuelve ahí (N3, Entrega 1 de fichas). */
  returnTo?: string
}

/** Tarjeta de empresa — vista Tarjetas del listado de Empresas y fallback
 *  mobile de la vista Tabla. Click abre el slide-over de resumen; el botón
 *  "Ver ficha" navega directo a la ficha completa. Los dos chips son el
 *  ciclo de vida (lo decide una persona) y la habilitación (la calcula la API
 *  en `compliance_summary.can_operate`, D1 §6.2). Una empresa dada de baja
 *  muestra la habilitación en gris: no está en falta. */
export function TransporterCard({ item, onOpen, selected = false, returnTo }: Props) {
  const lifecycle = lifecycleStyle('carrier', item.operational_status)
  const enablement = enablementStyle(item.compliance_summary, item.operational_status === 'ACTIVE')
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
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-text-primary truncate leading-tight">
            {item.business_name || <span className="italic text-gray-400">Sin nombre</span>}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{item.tax_id}</p>
        </div>
        {/* prefetch=false: con 30+ tarjetas visibles, Next.js prefetchea todos los links
           "Ver ficha" en viewport a la vez y agota el rate limit del proxy (429 real). */}
        <Link
          href={carrierHref(item.id, returnTo)}
          prefetch={false}
          onClick={e => e.stopPropagation()}
          title="Ver ficha completa"
          className="text-gray-300 hover:text-accent transition-colors shrink-0 p-1 -m-1 rounded"
        >
          <ChevronRight size={16} />
        </Link>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
        <StatusChip tone={lifecycle.tone} icon={lifecycle.icon}>{lifecycle.label}</StatusChip>
        <StatusChip tone={enablement.tone} icon={enablement.icon}>{enablement.label}</StatusChip>
      </div>
    </div>
  )
}
