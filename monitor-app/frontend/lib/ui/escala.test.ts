// @vitest-environment node
/**
 * La auditoria del 2026-08-16 midio 8-9 tamanos de letra por pantalla, con
 * 428 elementos a 10px o menos en el Monitor (248 a 10px, 152 a 9px, 28 a
 * 8px). Eso no es jerarquia, es ruido — y es la causa principal de que la app
 * se lea como tosca.
 *
 * Este test no impide usar Tailwind: impide seguir bajando. Cualquier
 * `text-[9px]` o `text-[10px]` NUEVO rompe la suite.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')

// El minimo de la escala. Ver app/globals.css → --text-etiqueta.
const MINIMO_PX = 11

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

export function tamanosPorDebajoDelMinimo(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
      const usos = linea.match(/text-\[(\d+(?:\.\d+)?)px\]/g)
      if (!usos) return
      for (const uso of usos) {
        const px = Number(uso.match(/\d+(?:\.\d+)?/)![0])
        if (px < MINIMO_PX) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} → ${uso}`)
      }
    })
  }
  return hallazgos
}

describe('la escala tipografica', () => {
  it('encuentra archivos que revisar', () => {
    // Guardia del guardia: si el recorrido deja de encontrar nada, el test de
    // abajo pasaria siempre y nadie se enteraria.
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('no crece la deuda de tamanos por debajo de 11px', () => {
    // Deuda heredada, MEDIDA el 2026-08-16 (no estimada). Este numero SOLO
    // puede bajar: se reduce al migrar cada pantalla, y cuando llegue a 0 la
    // asercion pasa a `toEqual([])`. Subirlo para que pase la suite es
    // exactamente lo que este test viene a impedir.
    const DEUDA = 268

    const hallazgos = tamanosPorDebajoDelMinimo()
    expect(
      hallazgos.length,
      `Tamanos por debajo de ${MINIMO_PX}px: ${hallazgos.length} (tope actual ${DEUDA}).\n` +
        `Si subio, hay uno nuevo. Los primeros:\n${hallazgos.slice(0, 10).join('\n')}`,
    ).toBeLessThanOrEqual(DEUDA)
  })
})
