// lib/utils/transporterDocs.ts
import type { ChecklistItem } from '@/components/dashboard/DocumentChecklist'
import type {
  ComplianceStatus, DriverGovernance, TransporterDriver, TransporterVehicle, VehicleGovernance,
} from '@/lib/types'

/** Documentación de conductor sin fecha de vencimiento propia (las fechas
 *  —C.I., licencia— se editan aparte, no encajan en un ChecklistItem de
 *  estado discreto). Única fuente — antes vivía duplicado en el page. */
export const DRIVER_DOC_LABELS: { key: keyof DriverGovernance; label: string }[] = [
  { key: 'anexo_3_gc',         label: 'Anexo 3 GC' },
  { key: 'epp',                label: 'EPP' },
  { key: 'das_odi',            label: 'DAS / ODI' },
  { key: 'hoja_de_vida',       label: 'Hoja de Vida' },
  { key: 'cert_antecedentes',  label: 'Cert. Antecedentes' },
  { key: 'validado_gc_driver', label: 'Validado GC' },
  { key: 'contrato_trabajo',   label: 'Contrato Trabajo' },
  { key: 'creacion_gc_driver', label: 'Creación GC' },
]

export const VEHICLE_DOC_LABELS: { key: keyof VehicleGovernance; label: string }[] = [
  { key: 'padron',                 label: 'Padrón' },
  { key: 'poliza_rc',              label: 'Póliza RC' },
  { key: 'gps',                    label: 'GPS' },
  { key: 'seguro_carga',           label: 'Seguro Carga' },
  { key: 'mantencion_camara_frio', label: 'Cámara Frío' },
  { key: 'creacion_gc_vehicle',    label: 'Creación GC' },
]

export function driverGovernanceToChecklistItems(driver: TransporterDriver): ChecklistItem[] {
  return DRIVER_DOC_LABELS.map(({ key, label }) => ({
    doc_code:    key,
    label,
    status:      (driver.governance?.[key] ?? null) as ComplianceStatus | null,
    expiry_date: null,
    has_expiry:  false,
  }))
}

export function vehicleGovernanceToChecklistItems(vehicle: TransporterVehicle): ChecklistItem[] {
  return VEHICLE_DOC_LABELS.map(({ key, label }) => ({
    doc_code:    key,
    label,
    status:      (vehicle.governance?.[key] ?? null) as ComplianceStatus | null,
    expiry_date: null,
    has_expiry:  false,
  }))
}

export function withDriverGovernanceField(
  current: DriverGovernance | null, docCode: string, status: ComplianceStatus,
): DriverGovernance {
  return { ...(current ?? {}), [docCode]: status } as DriverGovernance
}

export function withVehicleGovernanceField(
  current: VehicleGovernance | null, docCode: string, status: ComplianceStatus,
): VehicleGovernance {
  return { ...(current ?? {}), [docCode]: status } as VehicleGovernance
}
