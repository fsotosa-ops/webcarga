import { ShieldQuestion, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PolicyHealth } from './types'

/** Estilo compartido para policy_health (calculado por app.carrier_insurance_status,
 *  no una columna real) — usado en InsurancePolicyModal y en la landing de Seguros. */
export const POLICY_HEALTH_CONFIG: Record<PolicyHealth, { cls: string; icon: ReactNode; label: string }> = {
  VALID:          { cls: 'bg-green-50 text-green-600', icon: <ShieldCheck size={11} />, label: 'Al día' },
  EXPIRING_SOON:  { cls: 'bg-amber-50 text-amber-600', icon: <ShieldAlert size={11} />, label: 'Vence pronto' },
  EXPIRED:        { cls: 'bg-red-50 text-red-600',     icon: <ShieldAlert size={11} />, label: 'Vencida' },
  CANCELLED:      { cls: 'bg-gray-100 text-gray-500',  icon: <ShieldQuestion size={11} />, label: 'Cancelada' },
}
