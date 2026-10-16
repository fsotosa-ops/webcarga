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
