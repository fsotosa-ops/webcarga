'use client'

import { carrierHref } from '@/lib/navegacion/directory'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { StatusChip } from '@/components/ui/StatusChip'
import { enablementStyle, lifecycleStyle } from '@/lib/states'
import type { CarrierListItem } from '@/lib/types'

interface Props {
  item:      CarrierListItem
  /** La lista con sus filtros: la ficha vuelve ahí (N3, Entrega 1 de fichas). */
  returnTo?: string
}

/** Tarjeta de empresa — vista Tarjetas del listado de Empresas y la fila de la
 *  vista Tabla en el teléfono. Es un enlace a la ficha: la empresa se mira en su
 *  ficha o en la vista rápida, no en un resumen aparte (15/10). Los dos chips son
 *  el ciclo de vida (lo decide una persona) y la habilitación (la calcula la API
 *  en `compliance_summary.can_operate`, D1 §6.2). Una empresa dada de baja
 *  muestra la habilitación en gris: no está en falta. */
export function TransporterCard({ item, returnTo }: Props) {
  const lifecycle = lifecycleStyle('carrier', item.operational_status)
  const enablement = enablementStyle(item.compliance_summary, item.operational_status === 'ACTIVE')
  return (
    // prefetch=false: con 30+ tarjetas visibles, Next.js precarga todas a la vez y
    // agota el límite de tasa del proxy (429 real).
    <Link
      href={carrierHref(item.id, returnTo)}
      prefetch={false}
      className="block bg-white border border-border rounded-2xl p-4 space-y-3 transition-all hover:shadow-md hover:border-accion/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-dato text-text-primary truncate leading-tight">
            {item.business_name || <span className="italic text-informativo">Sin nombre</span>}
          </p>
          <p className="text-etiqueta text-informativo mt-0.5 font-identificador">{item.tax_id}</p>
        </div>
        <ChevronRight size={16} className="text-informativo shrink-0" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
        <StatusChip tone={lifecycle.tone} icon={lifecycle.icon}>{lifecycle.label}</StatusChip>
        <StatusChip tone={enablement.tone} icon={enablement.icon}>{enablement.label}</StatusChip>
      </div>
    </Link>
  )
}
