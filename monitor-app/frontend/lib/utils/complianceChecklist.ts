import type { ChecklistItem } from '@/components/dashboard/DocumentChecklist'
import type { ComplianceRecord } from '@/lib/types'

/** compliance_records → filas de DocumentChecklist. Mapeo directo — el
 *  catálogo de qué se exige (label, requires_file, etc.) ya lo resuelve el
 *  backend uniendo contra compliance_requirements (ver _assemble_carrier_detail
 *  en routers/carriers.py y los endpoints /drivers|/assets/{id}/compliance-records).
 *  Reemplaza el catálogo hardcodeado + governance JSONB de Checkpoint A-E. */
export function complianceRecordsToChecklistItems(records: ComplianceRecord[]): ChecklistItem[] {
  return records.map(r => ({
    id:                r.id,
    // Necesario para cargar contra el requisito correcto desde la ficha.
    requirement_id:    r.requirement_id,
    requirement_code:  r.requirement_code,
    label:             r.name,
    status:            r.status,
    requires_file:     r.requires_file,
    expiration_date:   r.expiration_date,
    is_expired:        r.is_expired,
    is_expiring_soon:  r.is_expiring_soon,
    file_url:          r.file_url,
  }))
}
