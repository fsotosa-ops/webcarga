/** Cómo vence un tipo de documento, del lado de la pantalla (HU-C1, entrega 2b).
 *
 *  El vencimiento DE VERDAD lo calcula el backend (`app/services/vencimientos.py`),
 *  que es la única definición. Este módulo sólo arma el EJEMPLO de la regla que
 *  alguien está editando, para que WebCarga confirme con fechas reales que la
 *  regla dice lo que la planilla dice. Es la misma aritmética de
 *  `corte_del_periodo` y `vence_segun_regla` (migraciones 20261008130000 y
 *  20261008140000): si divergen, el ejemplo miente — por eso tiene sus tests. */
import type { PoliticaVencimiento, ReglaDeVigencia } from './types'

export type Vigencia = { politica: PoliticaVencimiento } & Partial<ReglaDeVigencia>

const PARAMETROS = [
  'validity_months', 'frequency_months', 'cutoff_day',
  'period_offset_months', 'warning_days', 'grace_days',
] as const

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** La vigencia guardada de un tipo del catálogo. */
export function vigenciaDe(requisito: {
  expiration_policy: PoliticaVencimiento
  vigencia?: ReglaDeVigencia | null
}): Vigencia {
  return { politica: requisito.expiration_policy, ...(requisito.vigencia ?? {}) }
}

/** Por contenido: un parámetro ausente y uno `null` son lo mismo, y una gracia
 *  ausente es 0 (el default de la base). */
export function mismaVigencia(a: Vigencia, b: Vigencia): boolean {
  if (a.politica !== b.politica) return false
  return PARAMETROS.every(p => {
    const normal = (v: number | null | undefined) => (p === 'grace_days' ? v ?? 0 : v ?? null)
    return normal(a[p]) === normal(b[p])
  })
}

// ── Fechas ───────────────────────────────────────────────────────────────────

function sumarMeses(d: Date, meses: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + meses, 1)
}

function sumarDias(d: Date, dias: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias)
}

/** El día de corte de un mes; un corte 31 en un mes corto es su último día. */
function corte(mes: Date, dia: number): Date {
  const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
  return new Date(mes.getFullYear(), mes.getMonth(), Math.min(dia, ultimo))
}

const dd = (n: number) => String(n).padStart(2, '0')
const corta = (d: Date) => `${dd(d.getDate())}/${dd(d.getMonth() + 1)}`
const larga = (d: Date) => `${corta(d)}/${d.getFullYear()}`

// ── El ejemplo ──────────────────────────────────────────────────────────────

function frasesDeAviso(vence: Date, v: Vigencia, formato: (d: Date) => string): string {
  return v.warning_days == null
    ? 'Avisa según el aviso general de Configuración › Alertas.'
    : `Avisa desde el ${formato(sumarDias(vence, -v.warning_days))}.`
}

/** Lo primero que le falta a la regla para poder guardarse, o null si está
 *  completa. Es la MISMA coherencia que hace cumplir la base
 *  (`validar_vigencia_de_requisito`): la pantalla la usa para no pedir una
 *  vista previa ni publicar algo que la base va a rechazar con su mensaje
 *  técnico. */
export function faltaDeVigencia(v: Vigencia): string | null {
  if (v.politica === 'ISSUE_PLUS_MONTHS' && !v.validity_months) return 'Faltan los meses que dura.'
  if (v.politica === 'CALENDAR_PERIOD') {
    if (!v.frequency_months) return 'Falta cada cuántos meses se renueva.'
    if (!v.cutoff_day) return 'Falta el día tope.'
    if (v.period_offset_months == null) return 'Falta de qué mes es el documento.'
    if (v.warning_days == null) return 'Falta indicar con cuántos días de aviso.'
  }
  return null
}

/** La regla escrita con fechas, contada desde `hoy`. Si a la regla le falta un
 *  parámetro, dice cuál en vez de inventar una fecha. */
export function ejemploDeVigencia(v: Vigencia, hoy: Date): string {
  const falta = faltaDeVigencia(v)
  if (falta) return falta
  const gracia = v.grace_days ?? 0
  switch (v.politica) {
    case 'NONE':
      return 'No vence: se presenta una vez.'
    case 'REQUIRED':
    case 'OPTIONAL': {
      const tolera = gracia ? ` y se tolera ${gracia} días después` : ''
      const aviso = v.warning_days == null
        ? 'avisa según el aviso general de Configuración › Alertas'
        : `avisa ${v.warning_days} días antes`
      return `Vence en la fecha que trae el documento${tolera}; ${aviso}.`
    }
    case 'ISSUE_PLUS_MONTHS': {
      // Como `issue_date + make_interval(months => n)` de Postgres: el 31/01
      // más un mes es el 28/02, no el 03/03 de Date. `faltaDeVigencia` ya
      // comprobó que los meses están.
      const vence = sumarDias(
        corte(sumarMeses(new Date(hoy.getFullYear(), hoy.getMonth(), 1), v.validity_months!),
          hoy.getDate()),
        gracia)
      return `Así queda: uno emitido el ${larga(hoy)} vence el ${larga(vence)}. `
        + frasesDeAviso(vence, v, larga)
    }
    case 'CALENDAR_PERIOD': {
      // `faltaDeVigencia` ya comprobó que los cuatro parámetros están.
      const offset = v.period_offset_months!, dia = v.cutoff_day!, cada = v.frequency_months!
      // El período que se exige hoy, y el mes en que se pide.
      const inicioDelMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      const periodo = sumarMeses(inicioDelMes, -offset)
      const sePide = corte(sumarMeses(periodo, offset), dia)
      const sirveHasta = sumarDias(corte(sumarMeses(periodo, offset + cada), dia), gracia)
      const vencidaDesde = sumarDias(sePide, gracia + 1)
      const mes = MESES[periodo.getMonth()]
      return `Así queda: el de ${mes} se pide el ${corta(sePide)} y sirve hasta el `
        + `${corta(sirveHasta)}. ${frasesDeAviso(sirveHasta, v, corta)} `
        + `Una empresa sin el de ${mes} figura vencida desde el ${corta(vencidaDesde)}.`
    }
  }
}

/** En una línea, como lo diría la planilla de WebCarga. */
export function resumenDeVigencia(v: Vigencia): string {
  switch (v.politica) {
    case 'NONE': return 'No vence'
    case 'REQUIRED': return 'Fecha del documento'
    case 'OPTIONAL': return 'Fecha del documento (opcional)'
    case 'ISSUE_PLUS_MONTHS':
      if (v.validity_months === 12) return 'Anual'
      if (v.validity_months === 24) return 'Bienal'
      return `Cada ${v.validity_months} meses`
    case 'CALENDAR_PERIOD': {
      const cada = v.frequency_months === 1 ? 'Mensual' : `Cada ${v.frequency_months} meses`
      return `${cada} · tope día ${v.cutoff_day}`
    }
  }
}
