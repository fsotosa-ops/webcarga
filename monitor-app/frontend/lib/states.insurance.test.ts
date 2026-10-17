import { describe, it, expect } from 'vitest'
import { carrierInsuranceStyle, installmentStateStyle, policyStateStyle } from './states'

// Seguros E2: los estados de póliza y cuota los calcula la API (app.insurance_status);
// aquí solo se vuelven palabra, tono e ícono. Fechas cortas; con año si no es el actual.
describe('policyStateStyle', () => {
  const hoy = '2026-10-15'
  it('dice cuándo venció o vence, con la regla de Pendientes', () => {
    expect(policyStateStyle({ policy_state: 'EXPIRED', valid_to: '2026-05-22', expires_in_days: -146 }, hoy))
      .toMatchObject({ label: 'Venció el 22/05', tone: 'urgent' })
    expect(policyStateStyle({ policy_state: 'EXPIRING', valid_to: '2026-11-10', expires_in_days: 26 }, hoy))
      .toMatchObject({ label: 'Vence en 26 días · 10/11', tone: 'warning' })
    expect(policyStateStyle({ policy_state: 'EXPIRED', valid_to: '2025-05-22', expires_in_days: -511 }, hoy).label)
      .toBe('Venció el 22/05/25')
  })
  it('nombra los demás estados', () => {
    expect(policyStateStyle({ policy_state: 'VALID', valid_to: '2027-01-01', expires_in_days: 78 }, hoy).label).toBe('Al día')
    expect(policyStateStyle({ policy_state: 'NO_DATES', valid_to: null, expires_in_days: null }, hoy))
      .toMatchObject({ label: 'Sin vigencia', tone: 'warning' })
    expect(policyStateStyle({ policy_state: 'CANCELLED', valid_to: null, expires_in_days: null }, hoy))
      .toMatchObject({ label: 'Cancelada', tone: 'neutral' })
    expect(policyStateStyle({ policy_state: 'RENEWED', valid_to: '2026-03-23', expires_in_days: -206 }, hoy))
      .toMatchObject({ label: 'Renovada', tone: 'neutral' })
  })
})

describe('installmentStateStyle', () => {
  const hoy = '2026-10-15'
  it('pagada, con o sin fecha registrada', () => {
    expect(installmentStateStyle({ installment_state: 'PAID', due_date: '2026-01-25', paid_on: '2026-01-20' }, hoy))
      .toMatchObject({ label: 'Pagada el 20/01', tone: 'resolved' })
    expect(installmentStateStyle({ installment_state: 'PAID', due_date: '2026-01-25', paid_on: null }, hoy).label)
      .toBe('Pagada · fecha no registrada')
  })
  it('vencida o por vencer, con su fecha', () => {
    expect(installmentStateStyle({ installment_state: 'OVERDUE', due_date: '2025-01-25', paid_on: null }, hoy))
      .toMatchObject({ label: 'Venció el 25/01/25', tone: 'urgent' })
    expect(installmentStateStyle({ installment_state: 'PENDING', due_date: '2026-11-01', paid_on: null }, hoy))
      .toMatchObject({ label: 'Vence el 01/11', tone: 'neutral' })
  })
})

describe('carrierInsuranceStyle', () => {
  it('una empresa activa sin póliza es lo más urgente; el resto, el estado de su peor póliza', () => {
    expect(carrierInsuranceStyle('NO_POLICY')).toMatchObject({ label: 'Sin póliza', tone: 'urgent' })
    expect(carrierInsuranceStyle('EXPIRED')).toMatchObject({ label: 'Vencida', tone: 'urgent' })
    expect(carrierInsuranceStyle('VALID').label).toBe('Al día')
  })
})

// ── Seguros por empresa (17/10): el veredicto y su razón ──────────────────────
import {
  INSURANCE_VERDICT_ORDER, insuranceStanding, insuranceVerdictReason, insuranceVerdictStyle,
} from './states'
import type { CarrierInsuranceRow } from './api/insurance'

const HOY = '2026-10-17'
const fila = (p: Partial<CarrierInsuranceRow>): CarrierInsuranceRow => ({
  carrier_id: 'c', carrier_name: 'Andes', carrier_tax_id: '1-9', operational_status: 'ACTIVE', policies: 1,
  worst_state: 'VALID', insurance_verdict: 'UP_TO_DATE', insurance_alert: null, severe_overdue: false,
  unpaid_installments: 0, overdue_installments: 0, unpaid_uf: null, oldest_overdue_date: null, next_due_date: null,
  reason_insurer: null, reason_valid_to: null, ...p,
})

describe('el veredicto de una empresa (E5)', () => {
  it('cada veredicto se explica con sus datos, en una línea', () => {
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'EXPIRED', reason_insurer: 'HDI', reason_valid_to: '2026-09-23', overdue_installments: 2 }), HOY))
      .toBe('HDI venció el 23/09 · 2 cuotas vencidas')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'NO_POLICY', policies: 0 }), HOY)).toBe('Activa sin pólizas registradas')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'NO_POLICY', policies: 0, operational_status: 'INACTIVE' }), HOY)).toBe('Dada de baja, sin pólizas')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'OVERDUE', oldest_overdue_date: '2026-08-25', unpaid_uf: 18.4 }), HOY))
      .toBe('La más antigua venció el 25/08 · 18,4 UF impagas')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'NO_DATES', reason_insurer: 'Mapfre' }), HOY)).toBe('Mapfre sin fecha de término')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'EXPIRING', reason_insurer: 'Mapfre', reason_valid_to: '2026-11-02' }), HOY)).toBe('Mapfre vence el 02/11')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'UP_TO_DATE', next_due_date: '2026-11-15' }), HOY)).toBe('Próxima cuota el 15/11')
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'UP_TO_DATE' }), HOY)).toBe('Sin cuotas por pagar')
  })

  it('sin montos cargados, la razón de cuotas vencidas no dice "0 UF"', () => {
    expect(insuranceVerdictReason(fila({ insurance_verdict: 'OVERDUE', oldest_overdue_date: '2026-08-25', unpaid_uf: null }), HOY))
      .toBe('La más antigua venció el 25/08')
  })

  it('una cuota vencida es aviso; dos en la misma póliza, urgente', () => {
    expect(insuranceVerdictStyle(fila({ insurance_verdict: 'OVERDUE', overdue_installments: 1 })).tone).toBe('warning')
    const grave = insuranceVerdictStyle(fila({ insurance_verdict: 'OVERDUE', overdue_installments: 3, severe_overdue: true }))
    expect(grave.tone).toBe('urgent')
    expect(grave.label).toBe('3 cuotas vencidas')
    expect(insuranceVerdictStyle(fila({ insurance_verdict: 'EXPIRED' })).label).toBe('Póliza vencida')
  })

  it('"No al día" junta los cuatro que piden acción; Por vencer y Al día están al día', () => {
    expect(['EXPIRED', 'NO_POLICY', 'OVERDUE', 'NO_DATES'].map(v => insuranceStanding(v as never))).toEqual(Array(4).fill('not_up_to_date'))
    expect(insuranceStanding('EXPIRING')).toBe('expiring')
    expect(insuranceStanding('UP_TO_DATE')).toBe('up_to_date')
  })

  it('el orden de gravedad es el del spec', () => {
    expect(INSURANCE_VERDICT_ORDER).toEqual(['EXPIRED', 'NO_POLICY', 'OVERDUE', 'NO_DATES', 'EXPIRING', 'UP_TO_DATE'])
  })
})
