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
