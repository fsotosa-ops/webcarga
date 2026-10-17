import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/** S11 (Seguros E2): ninguna pantalla de Seguros calcula un estado. "Vencida",
 *  "por vencer" e "impaga" los calcula la base con la fecha de Chile
 *  (app.insurance_status); antes el navegador lo recalculaba con la fecha en UTC
 *  (`toISOString().slice(0, 10)`), que a las 21:00 de Chile ya es mañana. */
const RAIZ = join(__dirname, '..', '..')
function recorrer(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const ruta = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) return []
    return statSync(ruta).isDirectory() ? recorrer(ruta) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [ruta] : []
  })
}
const esDeSeguros = (ruta: string, src: string) =>
  /components\/insurance\/|app\/dashboard\/insurance\//.test(ruta) || /@\/lib\/api\/(insurance|policies)'/.test(src)
const REGLAS = [
  /toISOString\(\)\.slice\(0,\s*10\)/,
  /\bdue_date\s*[<>]=?/,
  /\bvalid_to\s*[<>]=?\s*(hoy|today|TODAY)/,
]

describe('Seguros no recalcula estados en el navegador', () => {
  it('S11: ningún archivo de Seguros compara fechas con hoy ni usa la fecha en UTC', () => {
    const hallazgos = ['app', 'components', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))
      .flatMap(ruta => {
        const src = readFileSync(ruta, 'utf8')
        if (!esDeSeguros(ruta, src)) return []
        return src.split('\n').flatMap((l, i) => REGLAS.some(r => r.test(l)) ? [`${ruta.slice(RAIZ.length + 1)}:${i + 1}: ${l.trim()}`] : [])
      })
    expect(hallazgos).toEqual([])
  })
})

/** E9 (Seguros por empresa, 17/10): el veredicto de una empresa lo decide la base
 *  (app.carrier_insurance_summary) y la pantalla lo lee por el glosario
 *  (`insuranceVerdictStyle`, `insuranceStanding`, `insuranceVerdictReason`). Una
 *  pantalla que compara `insurance_verdict` con un valor es una segunda regla que se
 *  separa de la primera el día que cambie el orden de gravedad. */
const COMPARA_VEREDICTO = [
  /\binsurance_verdict\s*[!=]==?/,
  /[!=]==?\s*[\w.?]*\binsurance_verdict\b/,
  /switch\s*\([^)]*\binsurance_verdict\b/,
]
const comparaVeredicto = (l: string) => COMPARA_VEREDICTO.some(r => r.test(l))

describe('El veredicto de Seguros se lee por el glosario', () => {
  it('la guardia reconoce una comparación (si no, pasaría sin mirar nada)', () => {
    expect(comparaVeredicto("if (r.insurance_verdict === 'EXPIRED') {")).toBe(true)
    expect(comparaVeredicto("'OVERDUE' !== row.insurance_verdict")).toBe(true)
    expect(comparaVeredicto('switch (fila.insurance_verdict) {')).toBe(true)
    expect(comparaVeredicto('insuranceVerdictStyle(r.insurance_verdict)')).toBe(false)
  })

  it('E9: ningún archivo de app/ ni components/ compara insurance_verdict con un valor', () => {
    const hallazgos = ['app', 'components'].flatMap(d => recorrer(join(RAIZ, d)))
      .flatMap(ruta => readFileSync(ruta, 'utf8').split('\n')
        .flatMap((l, i) => comparaVeredicto(l) ? [`${ruta.slice(RAIZ.length + 1)}:${i + 1}: ${l.trim()}`] : []))
    expect(hallazgos).toEqual([])
  })
})
