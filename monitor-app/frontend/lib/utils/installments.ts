/** Utilidades compartidas para mostrar cuotas de seguros — usadas tanto en
 *  Cobranza (lista plana) como en el detalle de póliza (modal). */

const TODAY = () => new Date().toISOString().slice(0, 10)

/** "vence en 3 días" / "vencida hace 4 días" / "vence hoy" — opera sobre
 *  fechas YYYY-MM-DD sin hora, y es bidireccional (pasado y futuro). */
export function dueRelative(dueDate: string | null, isOverdue: boolean, today: string = TODAY()): string | null {
  if (!dueDate) return null
  const diffDays = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
  if (diffDays === 0) return 'vence hoy'
  if (diffDays > 0) return `vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`
  return isOverdue ? `vencida hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}` : null
}

/** "Cuota 1 de 5" — si no se conoce el total (`totalInstallments` null), cae
 *  a "Cuota 1". Nunca usar "#N" (se ve tosco). */
export function cuotaLabel(installmentNumber: number, totalInstallments: number | null): string {
  return totalInstallments != null ? `Cuota ${installmentNumber} de ${totalInstallments}` : `Cuota ${installmentNumber}`
}
