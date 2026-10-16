// @vitest-environment node
/**
 * C10 (Cierre con un solo patrón): el Cierre usa las piezas del kit y nada hecho a
 * mano que las repita. Si una de estas aparece, se usa la pieza del kit: no se
 * agrega una excepción aquí.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '../../../..')
/** Las pantallas del Cierre: la página y lo que dibuja cada pestaña. El resumen
 *  imprimible (el PDF) queda fuera a propósito: no cambia en esta entrega (D7). */
const DEL_CIERRE = [
  'app/dashboard/operations/closures/page.tsx',
  'components/dashboard/sections/FlotaDelDiaSection.tsx',
  'components/dashboard/sections/PasoViajesSection.tsx',
  'components/dashboard/sections/PreCierrePendingSection.tsx',
  'components/dashboard/sections/StatusReportSection.tsx',
  ...['components/dashboard/sections/fleet', 'components/dashboard/sections/pending', 'components/dashboard/sections/reporte']
    .flatMap(d => readdirSync(join(RAIZ, d)).filter(f => f.endsWith('.tsx') && !f.includes('.test.')).map(f => `${d}/${f}`))
    .filter(f => !f.endsWith('ResumenImprimible.tsx')),
]
const fuente = (f: string) => readFileSync(join(RAIZ, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const donde = (patron: RegExp) => DEL_CIERRE.filter(f => patron.test(fuente(f)))

describe('el Cierre con un solo patrón (C10)', () => {
  it('no queda CabeceraDeColumna', () => {
    expect(existsSync(join(RAIZ, 'components/dashboard/CabeceraDeColumna.tsx'))).toBe(false)
    expect(donde(/CabeceraDeColumna/)).toEqual([])
  })

  it('ni pestañas ni recuadros ni segmentados hechos a mano: Tabs, ShortcutTiles y SegmentedControl del kit', () => {
    expect(donde(/role="tablist"|role="tab"/)).toEqual([])
    expect(donde(/AlertStatTiles/)).toEqual([])
    // Un botón con aria-pressed es un segmentado o un recuadro: esos son del kit.
    expect(donde(/aria-pressed/)).toEqual([])
  })

  it('los encabezados de tabla no van en mayúsculas (CABECERA del kit)', () => {
    expect(donde(/\buppercase\b/)).toEqual([])
  })

  it('ninguna tabla del Cierre dibuja su encabezado con orden o filtro a mano: la tabla del kit lo hace', () => {
    expect(donde(/compararValores|useOrden\b|EncabezadoOrdenable\b(?!['"])/)).toEqual([])
  })
})
