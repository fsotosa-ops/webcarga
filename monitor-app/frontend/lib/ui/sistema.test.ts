// @vitest-environment node
/**
 * Los guardias que hacen que el sistema gane.
 *
 * Este proyecto YA tenia tokens de color antes de esta ronda, y la auditoria
 * del 2026-08-16 midio 571 usos de tokens contra 1.824 de color crudo de
 * Tailwind, sobre 148 combinaciones distintas. O sea: la convencion sola ya
 * perdio una vez aca. Un componente o un token sin algo que los haga ganar es
 * una sugerencia.
 *
 * Los dos topes SOLO pueden bajar. Subirlos para que pase la suite es
 * exactamente lo que estos tests vienen a impedir.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}

const archivos = () => ['app', 'components'].flatMap((d) => recorrer(join(RAIZ, d)))

// Las 22 familias de color de Tailwind. Un `text-gray-500` suelto no es un
// error en si mismo — es una decision de color tomada fuera del sistema, y
// 1.824 de esas es por que la app se ve como se ve.
const FAMILIAS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
].join('|')
const COLOR_CRUDO = new RegExp(`\\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:${FAMILIAS})-\\d{2,3}\\b`, 'g')

export function usosDeColorCrudo(): number {
  let total = 0
  for (const ruta of archivos()) {
    total += (readFileSync(ruta, 'utf8').match(COLOR_CRUDO) ?? []).length
  }
  return total
}

export function h1FueraDelEncabezado(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    // El propio componente es el unico que puede escribir un <h1>.
    if (ruta.endsWith('EncabezadoDePagina.tsx')) continue
    readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
      if (/<h1[\s>]/.test(linea)) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`)
    })
  }
  return hallazgos
}

describe('el sistema visual se usa, no solo existe', () => {
  it('encuentra archivos que revisar', () => {
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('no crece el color decidido fuera del sistema', () => {
    // Medido el 2026-08-16. Baja al migrar cada pantalla a los tokens.
    // 1.765 -> 1.755 en la Ronda 129: CarrierDrawer paso a tokens al soltar la
    // zona de arrastre (sky/gray/amber/red crudos -> accent/informativo/border).
    // 1.755 -> 1.753 en la Ronda 138: VehicleRosterCard dejo de repetir la
    // tabla de etiquetas de chasis, y la baja de empresa se pinto con
    // `status-incidente` en vez de `red-*` crudo.
    const DEUDA = 1753

    const total = usosDeColorCrudo()
    expect(
      total,
      `Usos de color crudo de Tailwind: ${total} (tope actual ${DEUDA}).\n` +
        `Si subio, hay una decision de color nueva tomada fuera del sistema.\n` +
        `Los tokens estan en app/globals.css: accent, espera, accion, resuelto, status-*.`,
    ).toBeLessThanOrEqual(DEUDA)
  })

  it('no crecen los encabezados de pagina escritos a mano', () => {
    // Medido el 2026-08-16: eran 15 <h1> con SIETE combinaciones distintas de
    // clases. Baja a medida que cada pagina usa <EncabezadoDePagina>.
    const DEUDA = 9

    const hallazgos = h1FueraDelEncabezado()
    expect(
      hallazgos.length,
      `<h1> fuera de EncabezadoDePagina: ${hallazgos.length} (tope actual ${DEUDA}).\n` +
        `Usa <EncabezadoDePagina titulo="…" /> en vez de escribirlo a mano.\n${hallazgos.join('\n')}`,
    ).toBeLessThanOrEqual(DEUDA)
  })
})
