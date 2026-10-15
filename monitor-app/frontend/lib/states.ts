import type { LucideIcon } from 'lucide-react'
import {
  Ban, Building2, CalendarClock, CircleCheck, CircleDashed, Clock, Hourglass,
  OctagonAlert, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert,
} from 'lucide-react'
import type { StatusTone } from '@/components/ui/StatusChip'
import type { DirectoryEntity, FunnelBucket } from './types'

/**
 * El glosario de estados en código (spec D1 §3 y §6.4): el ÚNICO lugar del
 * frontend donde un valor de estado se vuelve palabra, tono e ícono. Espejo de
 * `app/schemas/states.py`. Los componentes no calculan estados: piden el
 * estilo del valor que mandó la API y lo pintan con `StatusChip`.
 *
 * Tres capas que no se mezclan (E-b): ciclo de vida (dato), estado del
 * documento (lo calculan las reglas de Configuración) y resumen de quien debe
 * los documentos. Habilitación y aviso se derivan, no se guardan.
 *
 * `lib/states.guard.test.ts` falla si una de estas palabras aparece escrita a
 * mano en otro archivo.
 */

export type DocumentState = 'UP_TO_DATE' | 'EXPIRING' | 'OVERDUE' | 'MISSING' | 'NOT_REQUIRED'
export type AlertSeverity = 'warning' | 'critical'
/** Alias de `DirectoryEntity` (el mismo que `lib/api/entitySummary.ts`). */
export type EntityKind = DirectoryEntity
export interface StateCounts { overdue: number; expiring: number; missing: number }
export interface ComplianceSummary {
  worst_state: DocumentState
  own: StateCounts
  /** Solo empresas: lo de su flota activa. */
  fleet: StateCounts | null
  can_operate: boolean
  /** Los obligatorios vencidos o faltantes: lo que hace falso a `can_operate`.
   *  Las cifras de arriba cuentan también los opcionales (fichas, 15/10). */
  blocking: BlockingCounts
}
/** Lo que se debe en total: lo propio más, en una empresa, lo de su flota activa. */
export function totalCounts(summary: ComplianceSummary): StateCounts {
  return {
    overdue: summary.own.overdue + (summary.fleet?.overdue ?? 0),
    expiring: summary.own.expiring + (summary.fleet?.expiring ?? 0),
    missing: summary.own.missing + (summary.fleet?.missing ?? 0),
  }
}
/** `fleet` solo en empresas (su flota activa). */
export interface BlockingCounts { own: number; fleet: number | null }
export interface StateStyle { label: string; tone: StatusTone; icon: LucideIcon }

/** Peor primero; `NOT_REQUIRED` no participa. Espejo de `SEVERITY_ORDER`. */
export const SEVERITY_ORDER: readonly DocumentState[] = ['OVERDUE', 'MISSING', 'EXPIRING', 'UP_TO_DATE']
/** Lo que bloquea la habilitación si el requisito es LEGAL_MANDATORY. Espejo de `BLOCKING_STATES`. */
export const BLOCKING_STATES: readonly DocumentState[] = ['OVERDUE', 'MISSING']

// ── Ciclo de vida (lo decide una persona) ─────────────────────────────────────
// INACTIVE y LEGACY_INACTIVE se dicen igual a propósito: de dónde vino la baja
// no cambia nada para quien mira (Pablo, 04/09).
const CARRIER_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:          { label: 'Activa',        tone: 'resolved', icon: CircleCheck },
  ONBOARDING:      { label: 'En onboarding', tone: 'warning',  icon: Hourglass },
  INACTIVE:        { label: 'Dada de baja',  tone: 'neutral',  icon: Ban },
  LEGACY_INACTIVE: { label: 'Dada de baja',  tone: 'neutral',  icon: Ban },
}
const FLEET_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:   { label: 'Activo',       tone: 'resolved', icon: CircleCheck },
  INACTIVE: { label: 'Dado de baja', tone: 'neutral',  icon: Ban },
}

export function lifecycleStyle(kind: EntityKind, status: string): StateStyle {
  const table = kind === 'carrier' ? CARRIER_LIFECYCLE : FLEET_LIFECYCLE
  return table[status] ?? { label: status, tone: 'neutral', icon: CircleDashed }
}

/** La empresa está dada de baja (no "en onboarding"). Su flota queda vinculada
 *  como historial (P1) y se marca (bloque 0, 0.9). */
export function isCarrierDeactivated(status: string | null | undefined): boolean {
  return status === 'INACTIVE' || status === 'LEGACY_INACTIVE'
}
export const CARRIER_DEACTIVATED_LABEL = 'Empresa dada de baja'

/** Conductor o equipo activo de una empresa dada de baja: dice eso en vez de
 *  "Activo". La baja propia manda sobre la de la empresa. */
export function fleetMemberStyle(kind: EntityKind, status: string, carrierStatus?: string | null): StateStyle {
  if (status === 'ACTIVE' && isCarrierDeactivated(carrierStatus)) {
    return { label: CARRIER_DEACTIVATED_LABEL, tone: 'neutral', icon: Building2 }
  }
  return lifecycleStyle(kind, status)
}

/** Las pestañas que agrupan estados de empresa. */
export const CARRIER_LIFECYCLE_GROUP_LABELS = {
  active: 'Activas', inactive: 'Dadas de baja', onboarding: 'En onboarding',
} as const

// ── Estado del documento (document_state_sql) ─────────────────────────────────
const DOCUMENT: Record<DocumentState, StateStyle> = {
  UP_TO_DATE:   { label: 'Al día',          tone: 'resolved', icon: CircleCheck },
  EXPIRING:     { label: 'Por vencer',      tone: 'warning',  icon: Clock },
  OVERDUE:      { label: 'Vencido',         tone: 'urgent',   icon: TriangleAlert },
  MISSING:      { label: 'Falta',           tone: 'neutral',  icon: CircleDashed },
  NOT_REQUIRED: { label: 'Aún no se exige', tone: 'neutral',  icon: CalendarClock },
}

export function documentStateStyle(state: DocumentState): StateStyle {
  return DOCUMENT[state]
}

/** "Falta" significaba dos cosas: no saber nada del documento, y saber cuándo
 *  vence sin tener el papel. Se precisa la palabra; el tono no cambia, porque
 *  una fecha sin evidencia nunca cuenta como cumplido. */
export function documentEvidenceStyle(state: DocumentState, expirationDate: string | null | undefined, hasFile: boolean): StateStyle {
  const base = DOCUMENT[state]
  return state === 'MISSING' && expirationDate && !hasFile ? { ...base, label: 'Falta el archivo' } : base
}

/** Las pestañas de Pendientes: un grupo de documentos, en plural. */
export const DOCUMENT_STATE_GROUP_LABELS: Record<'OVERDUE' | 'EXPIRING' | 'MISSING', string> = {
  OVERDUE: 'Vencidos', EXPIRING: 'Por vencer', MISSING: 'Faltan',
}

const COUNT: Record<DocumentState, [string, string]> = {
  UP_TO_DATE:   ['al día', 'al día'],
  EXPIRING:     ['por vencer', 'por vencer'],
  OVERDUE:      ['vencido', 'vencidos'],
  MISSING:      ['falta', 'faltan'],
  NOT_REQUIRED: ['aún no se exige', 'aún no se exigen'],
}

/** "3 vencidos", "1 falta". */
export function documentStateCount(state: DocumentState, n: number): string {
  return `${n} ${COUNT[state][n === 1 ? 0 : 1]}`
}

/** "2 vencidos · 1 falta": las cifras de un resumen, sin los ceros. `null` si no hay nada. */
export function stateCountsLine(c: StateCounts): string | null {
  const parts = ([['OVERDUE', c.overdue], ['EXPIRING', c.expiring], ['MISSING', c.missing]] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => documentStateCount(s, n))
  return parts.length ? parts.join(' · ') : null
}

/** Cuántos registros hay en cada estado, según la API. Contar no es calcular. */
export function documentStateCounts(records: { document_state: DocumentState }[]): Record<DocumentState, number> {
  const out: Record<DocumentState, number> = { UP_TO_DATE: 0, EXPIRING: 0, OVERDUE: 0, MISSING: 0, NOT_REQUIRED: 0 }
  for (const r of records) out[r.document_state] += 1
  return out
}

/** Un registro que impide la habilitación. La cifra de la empresa sale de
 *  `compliance_summary`; esto solo elige QUÉ filas listar. */
export function isBlocking(r: { requirement_level: string; document_state: DocumentState }): boolean {
  return r.requirement_level === 'LEGAL_MANDATORY' && BLOCKING_STATES.includes(r.document_state)
}

/** La razón del "No habilitado" de un conductor o un equipo, en una línea bajo
 *  sus chips (Entrega 1 de fichas, 15/10). Nombra el obligatorio vencido o el
 *  que falta cuando es uno solo; si son varios, los cuenta. `null` si está
 *  habilitado o no está activo (entonces el chip ya lo dice en gris). Mientras
 *  no llegan los documentos, usa la cuenta del resumen (`blocking`). */
export function blockingReason(
  records: { name: string; requirement_level: string; document_state: DocumentState }[] | undefined,
  summary: ComplianceSummary,
  active: boolean,
): string | null {
  if (!active || summary.can_operate) return null
  if (!records) {
    const n = summary.blocking.own + (summary.blocking.fleet ?? 0)
    return `${n} ${n === 1 ? 'obligatorio vencido o faltante' : 'obligatorios vencidos o faltantes'}`
  }
  const blocking = records.filter(isBlocking)
  const overdue = blocking.filter(r => r.document_state === 'OVERDUE')
  const missing = blocking.filter(r => r.document_state === 'MISSING')
  const parts = [
    overdue.length === 1 ? `${overdue[0].name}: vencido` : overdue.length > 1 ? `${overdue.length} obligatorios vencidos` : null,
    missing.length === 1 ? `${missing[0].name}: falta` : missing.length > 1 ? `faltan ${missing.length} obligatorios` : null,
  ].filter(Boolean).join(' · ')
  return parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : null
}

// ── Resumen y habilitación (fleet_compliance.py) ──────────────────────────────

/** El segundo chip de conductor y equipo (D-R8): el peor estado de lo suyo, en
 *  gris si está de baja. */
export function summaryStyle(summary: ComplianceSummary, lifecycleActive: boolean): StateStyle {
  const s = DOCUMENT[summary.worst_state]
  return lifecycleActive ? s : { ...s, tone: 'neutral' }
}

/** Habilitada / No habilitada. Lo calcula la API (`can_operate`); en gris si la
 *  empresa no está activa, que no es lo mismo que estar en falta (spec §3). */
export function enablementStyle(summary: ComplianceSummary, lifecycleActive: boolean): StateStyle {
  return enablementStyleFromFlag(summary.can_operate, lifecycleActive)
}

/** La misma tabla para quien solo tiene el booleano (`carrier_can_operate`, el balde del embudo). */
export function enablementStyleFromFlag(canOperate: boolean, lifecycleActive: boolean): StateStyle {
  const label = canOperate ? 'Habilitada' : 'No habilitada'
  if (!lifecycleActive) return { label, tone: 'neutral', icon: ShieldOff }
  return canOperate
    ? { label, tone: 'resolved', icon: ShieldCheck }
    : { label, tone: 'urgent', icon: ShieldAlert }
}

/** Los baldes del embudo de Certificación, en el orden en que se trabajan.
 *  No tienen palabras propias: son las del glosario (§3). */
export const FUNNEL_BUCKET_ORDER: FunnelBucket[] = ['not_enabled', 'expiring', 'up_to_date']

export function funnelBucketStyle(bucket: FunnelBucket): StateStyle {
  if (bucket === 'not_enabled') return enablementStyleFromFlag(false, true)
  return documentStateStyle(bucket === 'expiring' ? 'EXPIRING' : 'UP_TO_DATE')
}

export const ENABLEMENT_GROUP_LABELS = { enabled: 'Habilitadas', not_enabled: 'No habilitadas' } as const

// ── Aviso del documento (no es un estado: énfasis y orden) ────────────────────
const ALERT: Record<AlertSeverity, StateStyle> = {
  warning:  { label: 'Aviso',   tone: 'warning', icon: Clock },
  critical: { label: 'Crítico', tone: 'urgent',  icon: OctagonAlert },
}

export function alertSeverityStyle(severity: AlertSeverity): StateStyle {
  return ALERT[severity]
}
