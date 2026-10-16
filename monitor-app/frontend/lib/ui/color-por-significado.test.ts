import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/** P1.6 (Configuración, Parte 1): el color de un estado o un vocabulario sale de
 *  su significado (lib/states.ts), no de un `bg_color`/`text_color` guardado por
 *  fila. Ningún archivo los lee; la API los rechaza en escritura y la contracción
 *  borra las columnas. */
const RAIZ = join(__dirname, '..', '..')
function recorrer(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const ruta = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) return []
    return statSync(ruta).isDirectory() ? recorrer(ruta) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [ruta] : []
  })
}


describe('El color sale del significado', () => {
  it('P1.6: ningún archivo lee bg_color ni text_color', () => {
    const hallazgos = ['app', 'components', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(ruta => /\b\w*(bg_color|text_color)\b/.test(readFileSync(ruta, 'utf8')))
      .map(ruta => relative(RAIZ, ruta))
    expect(hallazgos).toEqual([])
  })
})
