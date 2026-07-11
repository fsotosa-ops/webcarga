import type { InsuranceInstallmentFlat } from '@/lib/types'

export type GroupBy = 'week' | 'month' | 'quarter' | 'transporter' | 'company' | 'client_group' | 'none'

export type AgingBand = '0-30' | '31-60' | '61-90' | '90+'

/** Banda de antigüedad de una cuota vencida, en días desde su vencimiento.
 *  Devuelve null si la cuota no está vencida — la antigüedad no aplica. */
export function agingBucket(
  row: Pick<InsuranceInstallmentFlat, 'due_date' | 'is_overdue'>,
  today: string = new Date().toISOString().slice(0, 10),
): AgingBand | null {
  if (!row.is_overdue || !row.due_date) return null
  const diffDays = Math.round(
    (new Date(today + 'T00:00:00').getTime() - new Date(row.due_date + 'T00:00:00').getTime()) / 86400000,
  )
  if (diffDays <= 30) return '0-30'
  if (diffDays <= 60) return '31-60'
  if (diffDays <= 90) return '61-90'
  return '90+'
}

export type InstallmentGroup = {
  key:      string
  label:    string
  rows:     InsuranceInstallmentFlat[]
  totalUf:  number
}

const TEMPORAL: GroupBy[] = ['week', 'month', 'quarter', 'none']

function isOverdue(row: InsuranceInstallmentFlat): boolean {
  return row.is_overdue
}

function bucketLabel(dueDate: string | null, groupBy: GroupBy): string {
  if (!dueDate) return 'Sin fecha'
  const d = new Date(dueDate + 'T00:00:00')
  if (groupBy === 'week') {
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return `Semana del ${monday.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}`
  }
  if (groupBy === 'month') {
    return d.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })
  }
  if (groupBy === 'quarter') {
    const q = Math.floor(d.getMonth() / 3) + 1
    return `T${q} ${d.getFullYear()}`
  }
  return 'Todas'
}

function bucketKey(dueDate: string | null, groupBy: GroupBy): string {
  if (!dueDate) return 'sin-fecha'
  const d = new Date(dueDate + 'T00:00:00')
  if (groupBy === 'week') {
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return `week-${monday.toISOString().slice(0, 10)}`
  }
  if (groupBy === 'month') return `month-${d.getFullYear()}-${d.getMonth()}`
  if (groupBy === 'quarter') return `quarter-${d.getFullYear()}-${Math.floor(d.getMonth() / 3)}`
  return 'none'
}

function entityKeyAndLabel(row: InsuranceInstallmentFlat, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === 'transporter') return { key: row.rut, label: row.business_name ?? row.rut }
  if (groupBy === 'company') return { key: row.company, label: row.company }
  return { key: row.client_group ?? 'Sin cliente', label: row.client_group ?? 'Sin cliente' }
}

export function groupInstallments(rows: InsuranceInstallmentFlat[], groupBy: GroupBy): InstallmentGroup[] {
  const groups = new Map<string, InstallmentGroup>()
  const isTemporal = TEMPORAL.includes(groupBy)

  for (const row of rows) {
    if (isTemporal && isOverdue(row)) {
      const g = groups.get('overdue') ?? { key: 'overdue', label: 'Vencidas', rows: [], totalUf: 0 }
      g.rows.push(row)
      g.totalUf += row.amount_uf ?? 0
      groups.set('overdue', g)
      continue
    }

    const { key, label } = isTemporal
      ? { key: bucketKey(row.due_date, groupBy), label: bucketLabel(row.due_date, groupBy) }
      : entityKeyAndLabel(row, groupBy)

    const g = groups.get(key) ?? { key, label, rows: [], totalUf: 0 }
    g.rows.push(row)
    g.totalUf += row.amount_uf ?? 0
    groups.set(key, g)
  }

  const result = Array.from(groups.values())
  result.sort((a, b) => {
    if (a.key === 'overdue') return -1
    if (b.key === 'overdue') return 1
    return a.label.localeCompare(b.label)
  })
  return result
}
