import type { TransporterListItem } from '@/lib/types'

/**
 * Filtro accionable del listado de Empresas (KPI cards + chips comparten el
 * mismo vocabulario — ver app/dashboard/transportistas/page.tsx). Calculado
 * client-side sobre la data ya cargada (patrón KpiId de lib/utils/kpis.ts).
 */
export type TransporterFilterId =
  | 'active'
  | 'inactive'
  | 'eligible'
  | 'alert_docs'
  | 'alert_insurance'
  | 'alert_any'

/**
 * app.v_transporter_eligibility solo agrega 'inactive' a blocking_reasons
 * cuando is_active=false (eligible exige is_active AND ...) — la lista no
 * expone is_active directamente, así que se infiere desde blocking_reasons.
 */
export function isTransporterActive(item: Pick<TransporterListItem, 'blocking_reasons'>): boolean {
  return !(item.blocking_reasons ?? []).includes('inactive')
}

export function hasDocsAlert(item: Pick<TransporterListItem, 'blocking_reasons'>): boolean {
  return (item.blocking_reasons ?? []).includes('docs_below_threshold')
}

/** insurance_ok === false es "vencida"; null (sin pólizas) NO es alerta */
export function hasInsuranceAlert(item: Pick<TransporterListItem, 'blocking_reasons' | 'insurance_ok'>): boolean {
  return (item.blocking_reasons ?? []).includes('insurance_overdue') || item.insurance_ok === false
}

export function matchesTransporterFilter(
  item: TransporterListItem,
  filter: TransporterFilterId,
): boolean {
  switch (filter) {
    case 'active':          return isTransporterActive(item)
    case 'inactive':        return !isTransporterActive(item)
    case 'eligible':        return item.eligible === true
    case 'alert_docs':      return hasDocsAlert(item)
    case 'alert_insurance': return hasInsuranceAlert(item)
    case 'alert_any':       return hasDocsAlert(item) || hasInsuranceAlert(item)
  }
}

export type TransporterKpis = {
  active:    number
  eligible:  number
  alert_any: number
  inactive:  number
}

/** KPI cards accionables del header — un clic = filtro (patrón deriveKpis de Diario) */
export function deriveTransporterKpis(items: TransporterListItem[]): TransporterKpis {
  const kpis: TransporterKpis = { active: 0, eligible: 0, alert_any: 0, inactive: 0 }
  for (const item of items) {
    if (isTransporterActive(item)) kpis.active++
    else kpis.inactive++
    if (item.eligible === true) kpis.eligible++
    if (hasDocsAlert(item) || hasInsuranceAlert(item)) kpis.alert_any++
  }
  return kpis
}
