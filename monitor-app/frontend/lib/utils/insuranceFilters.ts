import type { InsuranceSummaryRow } from '@/lib/types'

export type InsuranceFilterId = 'overdue' | 'due_this_month' | 'ok'

/** true si next_due cae dentro del mes calendario de `now` (America/Santiago
 *  no aplica aquí — se compara solo año/mes, no hay drift de zona horaria
 *  relevante a nivel de mes). */
export function dueThisMonth(row: Pick<InsuranceSummaryRow, 'next_due'>, now: Date = new Date()): boolean {
  if (!row.next_due) return false
  const due = new Date(row.next_due.date + 'T12:00:00')
  return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth()
}

export function matchesInsuranceFilter(
  row: InsuranceSummaryRow,
  filter: InsuranceFilterId,
  now: Date = new Date(),
): boolean {
  switch (filter) {
    case 'overdue':         return row.overdue_count > 0
    case 'due_this_month':  return dueThisMonth(row, now)
    case 'ok':               return row.insurance_ok === true
  }
}

export type InsuranceKpis = {
  ok:             number
  overdue:        number
  due_this_month: number
}

export function deriveInsuranceKpis(rows: InsuranceSummaryRow[], now: Date = new Date()): InsuranceKpis {
  const kpis: InsuranceKpis = { ok: 0, overdue: 0, due_this_month: 0 }
  for (const row of rows) {
    if (row.insurance_ok) kpis.ok++
    if (row.overdue_count > 0) kpis.overdue++
    if (dueThisMonth(row, now)) kpis.due_this_month++
  }
  return kpis
}
