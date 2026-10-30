import type { LucideIcon } from 'lucide-react'
import {
  Ban, Building2, CalendarClock, CircleCheck, CircleDashed, Clock, Hourglass, MapPin, RefreshCw,
  OctagonAlert, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert, Truck, Undo2, User,
} from 'lucide-react'
import type { StatusTone } from '@/components/ui/StatusChip'
import type { CarrierOperationalStatus, ClosureScope, DirectoryEntity, FunnelBucket, NoticeType, OperationTypeSource } from './types'
import { hoyEnChile } from './utils/datetime'
import type { ScopeGap } from './cierre/scope'
import type { FleetStatus, ReasonType } from './cierre/dayFleet'
import type { SignalTone } from './utils/alertSignals'
import type { CarrierInsuranceRow, InsuranceVerdict } from './api/insurance'

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
  /** Ningún obligatorio que bloquee, sin mirar el ciclo de vida (21/10): para una
   *  empresa en onboarding es lo que pide "Activar". Opcional: backend y frontend se
   *  despliegan por separado. */
  requirements_met?: boolean
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
// La baja es un estado; de dónde vino (la app, el padrón viejo) es su motivo
// (`status_reason`, Configuración › Directorio). Pablo, 04/09.
const CARRIER_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:          { label: 'Activa',        tone: 'resolved', icon: CircleCheck },
  ONBOARDING:      { label: 'En onboarding', tone: 'warning',  icon: Hourglass },
  INACTIVE:        { label: 'Dada de baja',  tone: 'neutral',  icon: Ban },
}
const FLEET_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:   { label: 'Activo',       tone: 'resolved', icon: CircleCheck },
  INACTIVE: { label: 'Dado de baja', tone: 'neutral',  icon: Ban },
}

/** Clientes y lugares: se activan o desactivan, sin baja ni onboarding. */
const CATALOG_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:   { label: 'Activo',   tone: 'resolved', icon: CircleCheck },
  INACTIVE: { label: 'Inactivo', tone: 'neutral',  icon: Ban },
}
/** Un documento exigido está vigente (se le exige a quien alcanza) o no. */
const REQUIREMENT_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:   { label: 'Vigente',      tone: 'resolved', icon: CircleCheck },
  INACTIVE: { label: 'Sin vigencia', tone: 'neutral',  icon: Ban },
}
const LIFECYCLE_BY_KIND: Record<EntityKind | CatalogKind, Record<string, StateStyle>> = {
  carrier: CARRIER_LIFECYCLE, driver: FLEET_LIFECYCLE, asset: FLEET_LIFECYCLE,
  shipper: CATALOG_LIFECYCLE, location: CATALOG_LIFECYCLE, requirement: REQUIREMENT_LIFECYCLE, user: CATALOG_LIFECYCLE,
}
/** Lo que se activa o desactiva sin baja ni onboarding; `user` es una persona con acceso. */
export type CatalogKind = 'shipper' | 'location' | 'requirement' | 'user'

export function lifecycleStyle(kind: EntityKind | CatalogKind, status: string): StateStyle {
  return LIFECYCLE_BY_KIND[kind][status] ?? { label: status, tone: 'neutral', icon: CircleDashed }
}

/** La empresa está dada de baja (no "en onboarding"). Su flota queda vinculada
 *  como historial (P1) y se marca (bloque 0, 0.9). */
export function isCarrierDeactivated(status: string | null | undefined): boolean {
  return status === 'INACTIVE'
}

/** Las empresas cuya carpeta trabaja Certificación (21/10): las que operan y las que
 *  están entrando (onboarding). Se les cargan y revisan documentos; una dada de baja
 *  es historial. Espejo de `CARRIER_STATUSES_IN_CERTIFICATION` (schemas/states.py). */
export const CARRIER_STATUSES_IN_CERTIFICATION: readonly CarrierOperationalStatus[] = ['ACTIVE', 'ONBOARDING']
export function isCarrierInCertification(status: string | null | undefined): boolean {
  return CARRIER_STATUSES_IN_CERTIFICATION.some(s => s === status)
}
/** Un conductor o equipo dado de baja tampoco recibe documentos. Espejo de
 *  `FLEET_STATUSES_IN_CERTIFICATION` (schemas/states.py). */
export const FLEET_STATUSES_IN_CERTIFICATION: readonly string[] = ['ACTIVE']

/** Si se le pueden cargar, revisar o pedir documentos. Espejo de
 *  `services/certification_lock.py` (30/10): lo dado de baja no recibe nada, la
 *  empresa o el propio conductor o equipo. Sin empresa vigente (`null`) sí: sus
 *  documentos son de la persona o del vehículo. La pantalla lo usa para no
 *  ofrecer lo que el servidor va a rechazar. */
export function acceptsDocuments(carrierStatus: string | null | undefined, subjectStatus?: string | null): boolean {
  if (carrierStatus && !isCarrierInCertification(carrierStatus)) return false
  if (subjectStatus && !FLEET_STATUSES_IN_CERTIFICATION.includes(subjectStatus)) return false
  return true
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
 *  sus chips (Entrega 1 de fichas, 15/10). Recibe lo que lo bloquea (sus
 *  obligatorios vencidos o faltantes, `isBlockingPending` sobre /pending) y
 *  nombra el documento cuando es uno solo; si son varios, los cuenta. `null` si
 *  está habilitado o no está activo (el chip ya lo dice en gris). Sin la lista,
 *  o si no aparece ninguno y aun así no puede operar, usa la cuenta del resumen. */
export function blockingReason(
  blocking: { name: string; document_state: DocumentState }[] | undefined,
  summary: ComplianceSummary,
  active: boolean,
): string | null {
  if (!active || summary.can_operate) return null
  if (!blocking || blocking.length === 0) {
    const n = summary.blocking.own + (summary.blocking.fleet ?? 0)
    return `${n} ${n === 1 ? 'obligatorio vencido o faltante' : 'obligatorios vencidos o faltantes'}`
  }
  const overdue = blocking.filter(r => r.document_state === 'OVERDUE')
  const missing = blocking.filter(r => r.document_state === 'MISSING')
  const parts = [
    overdue.length === 1 ? `${overdue[0].name}: vencido` : overdue.length > 1 ? `${overdue.length} obligatorios vencidos` : null,
    missing.length === 1 ? `${missing[0].name}: falta` : missing.length > 1 ? `faltan ${missing.length} obligatorios` : null,
  ].filter(Boolean).join(' · ')
  return parts.charAt(0).toUpperCase() + parts.slice(1)
}

/** "3 obligatorios de la empresa y 2 de su flota": lo que la bloquea (`blocking`). */
export function blockingCountsLine(summary: ComplianceSummary): string {
  const own = summary.blocking.own
  const fleet = summary.blocking.fleet ?? 0
  const word = (n: number) => (n === 1 ? 'obligatorio' : 'obligatorios')
  if (own > 0 && fleet > 0) return `${own} ${word(own)} de la empresa y ${fleet} de su flota`
  if (own > 0) return `${own} ${word(own)} de la empresa`
  return `${fleet} ${word(fleet)} de su flota`
}

/** La razón del "No habilitada" de una empresa (Entrega 1 de fichas, 15/10):
 *  cuántos obligatorios la bloquean, suyos y de su flota activa (`blocking`, la
 *  misma regla que `can_operate`). En onboarding dice lo que le falta para activarla
 *  (21/10); dada de baja, eso es lo que la frena. */
export function carrierBlockingReason(summary: ComplianceSummary, operationalStatus: string): string | null {
  if (operationalStatus === 'ONBOARDING' && summary.requirements_met !== undefined) {
    return summary.requirements_met
      ? 'Cumple los obligatorios: lista para activarla'
      : `Faltan ${blockingCountsLine(summary)} para activarla`
  }
  if (operationalStatus !== 'ACTIVE') return 'La empresa no está activa'
  if (summary.can_operate) return null
  return blockingCountsLine(summary)
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


// ── Seguros: póliza y cuota (app.insurance_status; Seguros E2, 15/10) ─────────
// La API calcula el estado y los días que faltan con la fecha de Chile; aquí solo
// se vuelven palabra. Fechas cortas (02/10), con el año cuando no es el de hoy.

export type PolicyState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NO_DATES' | 'CANCELLED' | 'RENEWED'
export type InstallmentState = 'PAID' | 'OVERDUE' | 'PENDING'

/** "22/05" o, si no es de este año, "22/05/25". */
export function fechaCorta(d: string, hoy: string = hoyEnChile()): string {
  const [y, m, day] = d.slice(0, 10).split('-')
  return y === hoy.slice(0, 4) ? `${day}/${m}` : `${day}/${m}/${y.slice(2)}`
}

const POLICY: Record<PolicyState, StateStyle> = {
  VALID:     { label: 'Al día',       tone: 'resolved', icon: ShieldCheck },
  EXPIRING:  { label: 'Por vencer',   tone: 'warning',  icon: Clock },
  EXPIRED:   { label: 'Vencida',      tone: 'urgent',   icon: ShieldAlert },
  NO_DATES:  { label: 'Sin vigencia', tone: 'warning',  icon: CircleDashed },
  CANCELLED: { label: 'Cancelada',    tone: 'neutral',  icon: Ban },
  RENEWED:   { label: 'Renovada',     tone: 'neutral',  icon: RefreshCw },
}

/** El estado de una póliza, dicho con su fecha cuando la tiene: "Venció el 22/05",
 *  "Vence en 26 días · 10/11" (la misma forma que Pendientes). */
export function policyStateStyle(
  p: { policy_state: PolicyState; valid_to: string | null; expires_in_days: number | null },
  hoy: string = hoyEnChile(),
): StateStyle {
  const base = POLICY[p.policy_state]
  if (p.policy_state === 'EXPIRED' && p.valid_to) return { ...base, label: `Venció el ${fechaCorta(p.valid_to, hoy)}` }
  if (p.policy_state === 'EXPIRING' && p.valid_to && p.expires_in_days != null) {
    const dias = p.expires_in_days === 0 ? 'Vence hoy' : `Vence en ${p.expires_in_days} día${p.expires_in_days === 1 ? '' : 's'}`
    return { ...base, label: `${dias} · ${fechaCorta(p.valid_to, hoy)}` }
  }
  return base
}

/** Las palabras de los estados de póliza, para filtros y conteos. */
export const POLICY_STATE_LABELS: Record<PolicyState, string> = {
  VALID: 'Al día', EXPIRING: 'Por vencer', EXPIRED: 'Vencidas', NO_DATES: 'Sin vigencia',
  CANCELLED: 'Canceladas', RENEWED: 'Renovadas',
}

const INSTALLMENT: Record<InstallmentState, StateStyle> = {
  PAID:    { label: 'Pagada',  tone: 'resolved', icon: CircleCheck },
  OVERDUE: { label: 'Vencida', tone: 'urgent',   icon: TriangleAlert },
  PENDING: { label: 'Por pagar', tone: 'neutral', icon: Hourglass },
}

/** Una cuota: "Pagada el 20/01", "Pagada · fecha no registrada" (54 de la carga
 *  inicial), "Venció el 25/01/25" o "Vence el 01/11". */
export function installmentStateStyle(
  c: { installment_state: InstallmentState; due_date: string | null; paid_on: string | null },
  hoy: string = hoyEnChile(),
): StateStyle {
  const base = INSTALLMENT[c.installment_state]
  if (c.installment_state === 'PAID') {
    return { ...base, label: c.paid_on ? `Pagada el ${fechaCorta(c.paid_on, hoy)}` : 'Pagada · fecha no registrada' }
  }
  if (!c.due_date) return base
  return { ...base, label: `${c.installment_state === 'OVERDUE' ? 'Venció' : 'Vence'} el ${fechaCorta(c.due_date, hoy)}` }
}

/** La señal aparte de una cuota que vence fuera de la vigencia de su póliza. */
export const OUTSIDE_VALIDITY_STYLE: StateStyle = { label: 'Fuera de vigencia', tone: 'warning', icon: CalendarClock }

// ── El veredicto de una empresa (Seguros por empresa, 17/10) ──────────────────
// Lo calcula la base (app.carrier_insurance_summary); aquí se vuelve palabra, tono,
// ícono y una razón de una línea con los datos que trae la fila.

/** Por gravedad: el orden de la lista y de los recuadros. */
export const INSURANCE_VERDICT_ORDER: readonly InsuranceVerdict[] =
  ['EXPIRED', 'NO_POLICY', 'OVERDUE', 'NO_DATES', 'EXPIRING', 'UP_TO_DATE']

/** El nombre de cada veredicto, para filtrar y contar ("Cuotas vencidas" las junta a
 *  todas; el chip dice cuántas). */
export const INSURANCE_VERDICT_LABEL: Record<InsuranceVerdict, string> = {
  EXPIRED: 'Póliza vencida', NO_POLICY: 'Sin póliza', OVERDUE: 'Cuotas vencidas',
  NO_DATES: 'Póliza sin fechas', EXPIRING: 'Por vencer', UP_TO_DATE: 'Al día',
}

const VERDICT: Record<Exclude<InsuranceVerdict, 'OVERDUE'>, StateStyle> = {
  EXPIRED:    { label: INSURANCE_VERDICT_LABEL.EXPIRED,    tone: 'urgent',   icon: ShieldAlert },
  NO_POLICY:  { label: INSURANCE_VERDICT_LABEL.NO_POLICY,  tone: 'urgent',   icon: ShieldOff },
  NO_DATES:   { label: INSURANCE_VERDICT_LABEL.NO_DATES,   tone: 'warning',  icon: CircleDashed },
  EXPIRING:   { label: INSURANCE_VERDICT_LABEL.EXPIRING,   tone: 'warning',  icon: Clock },
  UP_TO_DATE: { label: INSURANCE_VERDICT_LABEL.UP_TO_DATE, tone: 'resolved', icon: ShieldCheck },
}

/** El chip del veredicto. Cuotas vencidas dice cuántas, y es urgente si alguna póliza
 *  tiene 2 o más (la regla D2), aviso si no. */
export function insuranceVerdictStyle(r: Pick<CarrierInsuranceRow, 'insurance_verdict' | 'overdue_installments' | 'severe_overdue'>): StateStyle {
  if (r.insurance_verdict !== 'OVERDUE') return VERDICT[r.insurance_verdict]
  const n = r.overdue_installments
  return { label: `${n} cuota${n === 1 ? '' : 's'} vencida${n === 1 ? '' : 's'}`, tone: r.severe_overdue ? 'urgent' : 'warning', icon: TriangleAlert }
}

/** "No al día" son los que piden acción; "Por vencer" y "Al día" están al día. */
export type InsuranceStanding = 'not_up_to_date' | 'expiring' | 'up_to_date'
export const INSURANCE_STANDING_LABEL: Record<InsuranceStanding, string> = {
  not_up_to_date: 'No al día', expiring: 'Por vencer', up_to_date: 'Al día',
}
export function insuranceStanding(v: InsuranceVerdict): InsuranceStanding {
  return v === 'EXPIRING' ? 'expiring' : v === 'UP_TO_DATE' ? 'up_to_date' : 'not_up_to_date'
}

/** Un monto en UF, igual en toda la app de Seguros: sin ceros de relleno y sin perder centésimas. */
export const formatUf = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} UF`

/** La razón del veredicto, en una línea, con los datos de la fila (sin recalcular nada). */
export function insuranceVerdictReason(r: CarrierInsuranceRow, hoy: string = hoyEnChile()): string {
  const aseguradora = r.reason_insurer ?? 'La póliza'
  switch (r.insurance_verdict) {
    case 'EXPIRED': {
      const base = r.reason_valid_to ? `${aseguradora} venció el ${fechaCorta(r.reason_valid_to, hoy)}` : 'Póliza vencida'
      const n = r.overdue_installments
      return n > 0 ? `${base} · ${n} cuota${n === 1 ? '' : 's'} vencida${n === 1 ? '' : 's'}` : base
    }
    case 'NO_POLICY':
      return r.operational_status === 'ACTIVE' ? 'Activa sin pólizas registradas' : 'Dada de baja, sin pólizas'
    case 'OVERDUE': {
      const base = r.oldest_overdue_date ? `La más antigua venció el ${fechaCorta(r.oldest_overdue_date, hoy)}` : 'Cuotas vencidas'
      return r.unpaid_uf ? `${base} · ${formatUf(r.unpaid_uf)} impagas` : base
    }
    case 'NO_DATES':
      return `${aseguradora} sin fecha de término`
    case 'EXPIRING':
      return r.reason_valid_to ? `${aseguradora} vence el ${fechaCorta(r.reason_valid_to, hoy)}` : 'Por vencer'
    case 'UP_TO_DATE':
      return r.next_due_date ? `Próxima cuota el ${fechaCorta(r.next_due_date, hoy)}` : 'Sin cuotas por pagar'
  }
}

/** Las cuotas de una póliza o una empresa en una sola señal: "11 vencidas",
 *  "3 por pagar", "Sin cuotas" o "Al día". */
export function installmentsSummaryStyle(c: { overdue: number; unpaid: number; total?: number }): StateStyle {
  if (c.overdue > 0) return { label: `${c.overdue} vencida${c.overdue === 1 ? '' : 's'}`, tone: 'urgent', icon: TriangleAlert }
  if (c.unpaid > 0) return { label: `${c.unpaid} por pagar`, tone: 'neutral', icon: Hourglass }
  if (c.total === 0) return { label: 'Sin cuotas', tone: 'neutral', icon: CircleDashed }
  return { label: 'Al día', tone: 'resolved', icon: CircleCheck }
}

/** El archivo de la póliza: cargado o falta (la carga inicial trajo 1 de 33). */
export function policyFileStyle(hasFile: boolean): StateStyle {
  return hasFile ? { label: 'Cargado', tone: 'resolved', icon: CircleCheck } : { label: 'Falta', tone: 'neutral', icon: CircleDashed }
}


// ── Etapas del viaje (Configuración, Parte 1) ────────────────────────────
// El color de un estado del TMS o de un estado operacional sale de su columna,
// no de una paleta por fila: un rojo siempre es un problema. Las 7 columnas son
// un conjunto cerrado (backend: schemas/status_taxonomy.TRIP_STAGES).

export type TripStage = 'en_ruta' | 'en_local' | 'retornando' | 'pendiente_cierre_tms' | 'cerrado' | 'problema' | 'otro'

const TRIP_STAGE_STYLE: Record<TripStage, StateStyle> = {
  en_ruta:              { label: 'En Ruta',                 tone: 'action',   icon: Truck },
  en_local:             { label: 'En Local',                tone: 'action',   icon: MapPin },
  retornando:           { label: 'Retornando',              tone: 'neutral',  icon: Undo2 },
  // Asignado y terminado para Operaciones; falta que el TMS del cliente lo cierre
  // (Sodimac en "Control de salida"). Lo sigue Facturación (minuta 09/10, ítem 6).
  pendiente_cierre_tms: { label: 'Pendiente de cierre TMS', tone: 'warning',  icon: Hourglass },
  cerrado:              { label: 'Cerrado',                 tone: 'resolved', icon: CircleCheck },
  problema:             { label: 'Problema',                tone: 'urgent',   icon: TriangleAlert },
  otro:                 { label: 'Otro',                    tone: 'neutral',  icon: CircleDashed },
}

/** Las columnas en su orden, con su etiqueta. */
export const TRIP_STAGES: { id: TripStage; label: string }[] =
  (Object.keys(TRIP_STAGE_STYLE) as TripStage[]).map(id => ({ id, label: TRIP_STAGE_STYLE[id].label }))

const SIN_COLUMNA: StateStyle = { label: 'Sin columna', tone: 'neutral', icon: CircleDashed }

/** Etiqueta, tono e ícono de una columna; un estado sin columna (o con una que no
 *  existe) se ve neutro en vez de romper. */
export function tripStageStyle(group: string | null | undefined): StateStyle {
  return (group && TRIP_STAGE_STYLE[group as TripStage]) || SIN_COLUMNA
}

// ── Tipos de entidad (cómo se nombra a quién se le exige o se refiere algo) ────
export type EntityType = 'CARRIER' | 'DRIVER' | 'ASSET'
export const ENTITY_TYPE: Record<EntityType, { label: string; icon: LucideIcon }> = {
  CARRIER: { label: 'Empresa', icon: Building2 },
  DRIVER: { label: 'Conductor', icon: User },
  ASSET: { label: 'Equipo', icon: Truck },
}

// ── Cierre del día (Cierre con un solo patrón, spec §4.4) ─────────────────────
/** El estado de una fila de la Flota del día, en una palabra: la misma en la columna
 *  Estado, en el recuadro y en el chip. El estándar de utilización: asignado o no
 *  (asignados + no asignados = todos); "por regularizar" es un dato a corregir. */
export const FLEET_STATUS_LABEL: Record<FleetStatus, string> = {
  ASSIGNED: 'Asignado',
  UNASSIGNED: 'No asignado',
  TO_REGULARIZE: 'Por regularizar',
}

/** El porqué de un no asignado, agrupado como en el catálogo de motivos (Configuración):
 *  la columna "Tipo de motivo". "Sin motivo" es lo que falta declarar y bloquea la firma. */
export const REASON_TYPE_LABEL: Record<ReasonType, string> = {
  PENDING: 'Sin motivo',
  WORKED: 'Trabajó sin asignación',
  NOT_WORKED: 'No trabajó',
}

/** Qué se cierra: los mismos valores de la API (`services/closure_scope.py`). */
export const SCOPE_LABEL: Record<ClosureScope, string> = { tractoreo: 'Tractoreo', equipo_completo: 'Equipo Completo' }

/** La zona del destino de un viaje, por su clave del Reporte (`zone` en el backend:
 *  `services/destination_zone.py`, que manda estas mismas palabras). En este orden se
 *  muestran: columnas del Reporte y valores del filtro Zona del Cierre. */
export const DESTINATION_ZONE_LABEL = {
  rm: 'RM',
  z0: 'Z0',
  region: 'Región',
  unclassified: 'Sin clasificar',
} as const

/** El color de la cifra de una señal del Monitor, por su significado (`SignalTone`):
 *  lo que pide atención en el tono de alerta, lo que solo cuenta en el del texto. */
export const SIGNAL_TONE_TEXT: Record<SignalTone, string> = {
  alert: 'text-warning',
  info: 'text-text-primary',
}

/** Por qué un viaje del Cierre se ve en los dos alcances (`scopeGap`). */
export const SCOPE_GAP_LABEL: Record<ScopeGap, string> = {
  NO_TRACTOR: 'Sin tracto',
  NO_OPERATION_TYPE: 'Sin tipo de operación',
}

/** De dónde sale el tipo de operación de un viaje (plan 2026-10-21), como lo dice la
 *  pantalla. Y la marca cuando el tracto contradice al cliente. */
export const OPERATION_TYPE_SOURCE_LABEL: Record<OperationTypeSource, string> = {
  declared: 'Declarado por Operaciones',
  client: 'Según el cliente',
  tractor: 'Según el tracto',
}
export const OPERATION_TYPE_CONFLICT_LABEL = 'Tipo distinto al del cliente'

/** El tipo de un aviso de Pendientes: la columna "Tipo de aviso" y su filtro. Las
 *  claves son las del pre-cierre (`services/pre_cierre.py`) más el desbalance de
 *  dotación, que es un aviso más (spec §4.6). */
export const NOTICE_TYPE_LABEL: Record<NoticeType, string> = {
  CONDUCTOR_SIN_EMPRESA: 'Conductor sin empresa',
  PATENTE_NO_REGISTRADA: 'Patente sin empresa',
  EMPRESA_ONBOARDING: 'Empresa no activa con viaje',
  LEFT_DAY_POPULATION: 'Salió del día',
  SIN_TIPO_OPERACION: SCOPE_GAP_LABEL.NO_OPERATION_TYPE,
  EMPRESA_NO_RECONOCIDA: 'Empresa no reconocida',
  CONDUCTOR_NO_REGISTRADO: 'Conductor no registrado',
  FLEET_DRIVER_GAP: 'Desbalance de dotación',
  OPERATION_TYPE_CONFLICT: OPERATION_TYPE_CONFLICT_LABEL,
}
