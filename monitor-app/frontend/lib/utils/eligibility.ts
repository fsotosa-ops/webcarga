import type { BlockingReason } from '@/lib/types'

/** Umbral de referencia mostrado en el mensaje de docs_below_threshold.
 *  app.alert_thresholds guarda el valor real server-side (compliance_min_pct);
 *  la API no lo expone en el payload de listado/ficha, así que se usa el
 *  default documentado en el plan (§1.7) para el mensaje legible. */
export const DEFAULT_COMPLIANCE_THRESHOLD = 90

/** Mapea blocking_reasons (app.v_transporter_eligibility) a texto legible —
 *  plan §4.2: "Documentación bajo el umbral (X% < Y%)" / "Cuota de seguro
 *  vencida" / "Empresa inactiva". Motivos desconocidos se muestran tal cual
 *  (nunca ocultos — el backend puede agregar motivos sin deploy de frontend). */
export function describeBlockingReason(
  reason: BlockingReason,
  compliancePct?: number | null,
): string {
  switch (reason) {
    case 'docs_below_threshold': {
      const pct = compliancePct != null ? `${compliancePct.toFixed(0)}%` : '—'
      return `Documentación bajo el umbral (${pct} < ${DEFAULT_COMPLIANCE_THRESHOLD}%)`
    }
    case 'insurance_overdue':
      return 'Cuota de seguro vencida'
    case 'inactive':
      return 'Empresa inactiva'
    default:
      return reason
  }
}

export type EligibilityColor = 'green' | 'amber' | 'red'

/** Semáforo de habilitación: verde = habilitada; rojo = bloqueo duro
 *  (inactiva o seguro vencido); ámbar = solo documentación bajo el umbral. */
export function eligibilityColor(
  eligible: boolean | null | undefined,
  blockingReasons: BlockingReason[] = [],
): EligibilityColor {
  if (eligible) return 'green'
  if (blockingReasons.includes('inactive') || blockingReasons.includes('insurance_overdue')) return 'red'
  return 'amber'
}

export function describeEligibility(
  eligible: boolean | null | undefined,
  blockingReasons: BlockingReason[] = [],
  compliancePct?: number | null,
): string {
  if (eligible) return 'Habilitada para asignar'
  if (blockingReasons.length === 0) return 'No habilitada'
  return blockingReasons.map(r => describeBlockingReason(r, compliancePct)).join(' · ')
}
