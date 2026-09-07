// components/dashboard/VehicleRosterCard.tsx
'use client'

import { Truck, ShieldAlert, ShieldCheck } from 'lucide-react'
import { ASSET_TYPE_LABELS, type AssetType, type CarrierAssetRosterItem } from '@/lib/types'
import { ChipDeBaja } from './ChipDeBaja'

interface Props {
  vehicle: CarrierAssetRosterItem
  onOpen:  () => void
}

/** Tarjeta compacta del roster de equipos — patente + tipo + pill de
 *  compliance_health (mismo criterio y componente visual que TransporterCard
 *  en el listado de Empresas) — reemplaza el conteo plano "N requisitos".
 *  El detalle por documento vive en VehicleDetailPanel.
 *
 *  Muestra TRES clasificaciones distintas, que en pantalla se confundían:
 *  el rol físico (`asset_type`: Tracto/Rampla), el subtipo de carrocería
 *  (`fleet_service_type_label`: Sider, Furgón Seco…) y el tipo de operación
 *  WebCarga (`webcarga_operation_type_label`: Tractoreo / Equipo Completo).
 *  El tercero se agregó el 2026-09-07: es el que decide si el equipo bloquea
 *  el cierre del día, y la ficha no lo mostraba. Pablo, 04/09: *"en el
 *  directorio debería mostrarte esto, este tractoreo… aquí no dice nada"*.
 *  Cuando falta se dice, porque faltar tiene consecuencia. */
export function VehicleRosterCard({ vehicle, onOpen }: Props) {
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
            {ASSET_TYPE_LABELS[vehicle.asset_type as AssetType] ?? vehicle.asset_type}
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
        {vehicle.operational_status !== 'ACTIVE' ? (
          <ChipDeBaja estado={vehicle.operational_status} />
        ) : vehicle.compliance_health === 'PENDING' ? (
          <span className="inline-flex items-center gap-1 text-etiqueta font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 mt-0.5">
            <ShieldAlert size={9} /> {vehicle.pending_mandatory} pendiente{vehicle.pending_mandatory === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-etiqueta font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 mt-0.5">
            <ShieldCheck size={9} /> Al día
          </span>
        )}
      </div>
    </button>
  )
}
