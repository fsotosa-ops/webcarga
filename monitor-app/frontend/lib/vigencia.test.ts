import { describe, expect, it } from 'vitest'
import { ejemploDeVigencia, faltaDeVigencia, mismaVigencia, resumenDeVigencia, vigenciaDe } from './vigencia'
import type { Vigencia } from './vigencia'

const HOY = new Date(2026, 9, 8) // 08/10/2026

const F30_1: Vigencia = {
  politica: 'CALENDAR_PERIOD', frequency_months: 1, cutoff_day: 18,
  period_offset_months: 1, warning_days: 5, grace_days: 0,
}

describe('ejemploDeVigencia', () => {
  it('un mensual dice qué período se pide, hasta cuándo sirve y desde cuándo vence', () => {
    const texto = ejemploDeVigencia(F30_1, HOY)
    expect(texto).toContain('el de septiembre se pide el 18/10 y sirve hasta el 18/11')
    expect(texto).toContain('Avisa desde el 13/11')
    expect(texto).toContain('sin el de septiembre figura vencida desde el 19/10')
  })

  it('la gracia corre el vencimiento', () => {
    const texto = ejemploDeVigencia({ ...F30_1, grace_days: 3 }, HOY)
    expect(texto).toContain('sirve hasta el 21/11')
    expect(texto).toContain('vencida desde el 22/10')
  })

  it('un corte 31 en un mes corto es el último día del mes', () => {
    const texto = ejemploDeVigencia({ ...F30_1, cutoff_day: 31 }, new Date(2027, 0, 10))
    // Hoy 10/01/2027: se exige el de diciembre, se pide el 31/01 y sirve
    // hasta el corte de febrero, que tiene 28 días.
    expect(texto).toContain('el de diciembre se pide el 31/01 y sirve hasta el 28/02')
  })

  it('un plazo desde la emisión dice cuándo vence uno emitido hoy', () => {
    const texto = ejemploDeVigencia(
      { politica: 'ISSUE_PLUS_MONTHS', validity_months: 12, warning_days: 30, grace_days: 0 }, HOY)
    expect(texto).toContain('uno emitido el 08/10/2026 vence el 08/10/2027')
    expect(texto).toContain('Avisa desde el 08/09/2027')
  })

  it('sumar meses no desborda el mes, igual que Postgres', () => {
    // 31/01 + 1 mes = 28/02 (Postgres), no 03/03 (Date de JavaScript).
    const texto = ejemploDeVigencia(
      { politica: 'ISSUE_PLUS_MONTHS', validity_months: 1, warning_days: 5, grace_days: 0 },
      new Date(2027, 0, 31))
    expect(texto).toContain('vence el 28/02/2027')
  })

  it('sin días de aviso propios dice que rige el aviso general', () => {
    const texto = ejemploDeVigencia(
      { politica: 'ISSUE_PLUS_MONTHS', validity_months: 12, warning_days: null, grace_days: 0 }, HOY)
    expect(texto).toContain('aviso general')
  })

  it('a una regla incompleta le dice qué le falta, sin inventar fechas', () => {
    expect(ejemploDeVigencia({ ...F30_1, cutoff_day: null }, HOY)).toBe('Falta el día tope.')
    expect(ejemploDeVigencia({ ...F30_1, warning_days: null }, HOY))
      .toBe('Falta indicar con cuántos días de aviso.')
    expect(ejemploDeVigencia({ politica: 'ISSUE_PLUS_MONTHS', validity_months: null }, HOY))
      .toBe('Faltan los meses que dura.')
  })

  it('los tipos sin parámetros lo dicen en una frase', () => {
    expect(ejemploDeVigencia({ politica: 'NONE' }, HOY)).toBe('No vence: se presenta una vez.')
    expect(ejemploDeVigencia({ politica: 'REQUIRED' }, HOY)).toContain('fecha que trae el documento')
  })
})

describe('faltaDeVigencia', () => {
  it('una regla completa no tiene faltas', () => {
    expect(faltaDeVigencia(F30_1)).toBeNull()
    expect(faltaDeVigencia({ ...F30_1, politica: 'NONE' })).toBeNull()
  })

  it('dice lo primero que falta, con las mismas palabras del ejemplo', () => {
    expect(faltaDeVigencia({ ...F30_1, cutoff_day: null })).toBe('Falta el día tope.')
    expect(faltaDeVigencia({ ...F30_1, warning_days: null }))
      .toBe('Falta indicar con cuántos días de aviso.')
    expect(faltaDeVigencia({ ...F30_1, politica: 'ISSUE_PLUS_MONTHS', validity_months: null }))
      .toBe('Faltan los meses que dura.')
    expect(ejemploDeVigencia({ ...F30_1, cutoff_day: null }, HOY)).toBe('Falta el día tope.')
  })
})

describe('resumenDeVigencia', () => {
  it('nombra cada tipo como lo diría la planilla', () => {
    expect(resumenDeVigencia(F30_1)).toBe('Mensual · tope día 18')
    expect(resumenDeVigencia({ politica: 'ISSUE_PLUS_MONTHS', validity_months: 12 })).toBe('Anual')
    expect(resumenDeVigencia({ politica: 'ISSUE_PLUS_MONTHS', validity_months: 24 })).toBe('Bienal')
    expect(resumenDeVigencia({ politica: 'ISSUE_PLUS_MONTHS', validity_months: 6 })).toBe('Cada 6 meses')
    expect(resumenDeVigencia({ politica: 'NONE' })).toBe('No vence')
    expect(resumenDeVigencia({ politica: 'OPTIONAL' })).toBe('Fecha del documento (opcional)')
  })
})

describe('vigenciaDe y mismaVigencia', () => {
  it('lee la vigencia del catálogo y la compara por contenido', () => {
    const v = vigenciaDe({ expiration_policy: 'CALENDAR_PERIOD', vigencia: {
      validity_months: null, frequency_months: 1, cutoff_day: 18,
      period_offset_months: 1, warning_days: 5, grace_days: 0,
    } })
    expect(mismaVigencia(v, F30_1)).toBe(true)
    expect(mismaVigencia(v, { ...F30_1, cutoff_day: 15 })).toBe(false)
  })

  it('un documento sin regla es su tipo con los parámetros vacíos', () => {
    const v = vigenciaDe({ expiration_policy: 'NONE', vigencia: null })
    expect(mismaVigencia(v, { politica: 'NONE' })).toBe(true)
  })
})
