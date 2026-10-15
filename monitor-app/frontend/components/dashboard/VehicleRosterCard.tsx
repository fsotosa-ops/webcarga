// components/dashboard/VehicleRosterCard.tsx
'use client'

import { Truck } from 'lucide-react'
import { StatusChip } from '@/components/ui/StatusChip'
import { fleetMemberStyle, isCarrierDeactivated, summaryStyle } from '@/lib/states'
import type { CarrierAssetRosterItem, CarrierOperationalStatus } from '@/lib/types'

interface Props {
  vehicle: CarrierAssetRosterItem
  /** La etiqueta de su tipo, del catálogo (`useAssetTypes` en la página). */
  typeLabel: string
  /** Estado de la empresa: si está dada de baja, la tarjeta lo dice (bloque 0, 0.9). */
  carrierStatus?: CarrierOperationalStatus
  onOpen:  () => void
}

/** Tarjeta compacta del roster de equipos: patente, tipo y el par de chips de
 *  la spec §6.2 (D-R8): ciclo de vida y peor estado de sus documentos, el
 *  segundo en gris si el equipo está de baja. El detalle por documento vive en
 *  ficha (FleetProfile en modal).
 *
 *  Muestra TRES clasificaciones distintas, que en pantalla se confundían:
 *  el rol físico (`asset_type`: Tracto/Rampla), el subtipo de carrocería
 *  (`fleet_service_type_label`: Sider, Furgón Seco…) y el tipo de operación
 *  WebCarga (`webcarga_operation_type_label`: Tractoreo / Equipo Completo).
 *  El tercero se agregó el 2026-09-07: es el que decide si el equipo bloquea
 *  el cierre del día, y la ficha no lo mostraba. Pablo, 04/09: *"en el
 *  directorio debería mostrarte esto, este tractoreo… aquí no dice nada"*.
 *  Cuando falta se dice, porque faltar tiene consecuencia. */
export function VehicleRosterCard({ vehicle, typeLabel, carrierStatus, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 shrink-0">
        <Truck size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-bold text-text-primary font-mono truncate">{vehicle.license_plate}</p>
          <span className="text-etiqueta font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
            {typeLabel}
          </span>
          {vehicle.fleet_service_type_label && (
            <span
              className="text-etiqueta font-semibold px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: vehicle.fleet_service_type_bg_color ?? undefined,
                color: vehicle.fleet_service_type_text_color ?? undefined,
              }}
            >
              {vehicle.fleet_service_type_label}
            </span>
          )}
          {vehicle.webcarga_operation_type_label ? (
            <span className="text-etiqueta font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-accent/10 text-accent">
              {vehicle.webcarga_operation_type_label}
            </span>
          ) : (
            <span
              title="Sin tipo de operación el equipo bloquea el cierre del día. Se define al abrir el equipo."
              className="text-etiqueta font-semibold px-1.5 py-0.5 rounded-full shrink-0 text-status-incidente"
            >
              Sin tipo de operación
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {(() => {
            const life = fleetMemberStyle('asset', vehicle.operational_status, carrierStatus)
            const docs = summaryStyle(vehicle.compliance_summary,
              vehicle.operational_status === 'ACTIVE' && !isCarrierDeactivated(carrierStatus))
            return (<>
              <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
              <StatusChip tone={docs.tone} icon={docs.icon}>{docs.label}</StatusChip>
            </>)
          })()}
        </div>
      </div>
    </button>
  )
}
