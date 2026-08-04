'use client'

import Link from 'next/link'
import { ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { CarrierListItem, CarrierOperationalStatus } from '@/lib/types'

/** El concepto expuesto al usuario es Activo/Inactivo, no Activo/Legacy
 *  (decisión explícita 2026-07-18) — INACTIVE (baja manual real, sin filas
 *  hoy) y LEGACY_INACTIVE (nunca onboardeada) comparten el mismo label
 *  visible aunque sigan siendo 2 valores distintos en la DB. ONBOARDING
 *  (empresa creada sin tax_id, tarea backend previa) es un tercer estado
 *  propio de Carrier, con su propio label/color ámbar. */
export const STATUS_LABELS: Record<CarrierOperationalStatus, string> = {
  ACTIVE: 'Activa', INACTIVE: 'Inactiva', LEGACY_INACTIVE: 'Inactiva', ONBOARDING: 'Onboarding',
}
export const STATUS_CLS: Record<CarrierOperationalStatus, string> = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-100',
  INACTIVE: 'bg-gray-100 text-gray-500 border-transparent',
  LEGACY_INACTIVE: 'bg-gray-100 text-gray-500 border-transparent',
  ONBOARDING: 'bg-amber-50 text-amber-700 border-amber-100',
}

interface Props {
  item:     CarrierListItem
  onOpen:   (item: CarrierListItem) => void
  selected?: boolean
}

/** Tarjeta de empresa — vista Tarjetas del listado de Empresas y fallback
 *  mobile de la vista Tabla. Click abre el slide-over de resumen; el botón
 *  "Ver ficha" navega directo a la ficha completa. El pill de la derecha
 *  muestra compliance_health (pendientes de LEGAL_MANDATORY, mismo criterio
 *  que `mandatoryProblems` en la ficha) — antes mostraba un conteo plano de
 *  "N requisitos" que era igual para casi todas las empresas y no permitía
 *  distinguir cuáles necesitaban atención. */
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
          href={`/dashboard/carriers/${item.id}`}
          prefetch={false}
          onClick={e => e.stopPropagation()}
          title="Ver ficha completa"
          className="text-gray-300 hover:text-accent transition-colors shrink-0 p-1 -m-1 rounded"
        >
          <ChevronRight size={16} />
        </Link>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[item.operational_status]}`}>
          {STATUS_LABELS[item.operational_status]}
        </span>
        {item.compliance_health === 'PENDING' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
            <ShieldAlert size={9} /> {item.pending_mandatory} pendiente{item.pending_mandatory === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
            <ShieldCheck size={9} /> Al día
          </span>
        )}
      </div>
    </div>
  )
}
