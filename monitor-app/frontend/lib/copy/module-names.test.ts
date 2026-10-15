// @vitest-environment node
/**
 * Los módulos se llaman "Por asignar" (Entrega D, 15/10; antes "Sin clasificar") y
 * "Directorio" (spec §3, E-h). Las
 * rutas siguen en inglés (`/dashboard/compliance/inbox`, `/dashboard/carriers`)
 * y los identificadores viejos (`PuenteALaBandeja`) se quedan: esto mira solo
 * el texto que ve una persona, con los comentarios quitados.
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
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) acc.push(ruta)
  }
  return acc
}

/** Quita los comentarios conservando los saltos de línea, para que el número
 *  de línea del hallazgo siga siendo el del archivo. */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const PROHIBIDOS: { re: RegExp; motivo: string }[] = [
  { re: /(^|[^A-Za-z])la [Bb]andeja(?![A-Za-z])/, motivo: 'el módulo se llama "Por asignar"' },
  // El MÓDULO: como destino ("a/en/de Sin clasificar"), en el menú o en un contador.
  // "Sin clasificar" como VALOR de un atributo (tipo de operación, zona de un local)
  // es otra cosa y se queda.
  { re: /(^|[^A-Za-z])(a|en|de) [Ss]in clasificar/, motivo: 'el módulo se llama "Por asignar" (Entrega D)' },
  { re: /label: 'Sin clasificar'/,               motivo: 'el módulo se llama "Por asignar" (Entrega D)' },
  { re: /\} sin clasificar/,                     motivo: 'el módulo se llama "Por asignar" (Entrega D)' },
  { re: /(en|a) Empresas(?![A-Za-z])/,           motivo: 'el enlace lleva al Directorio' },
  { re: />\s*Empresas\s*<\/a>/,                  motivo: 'el enlace lleva al Directorio' },
]

describe('los módulos se nombran como en el glosario', () => {
  it('encuentra archivos que revisar', () => {
    expect(['app', 'components', 'lib'].flatMap(d => recorrer(join(RAIZ, d))).length).toBeGreaterThan(50)
  })

  it('ningún texto dice "la bandeja" ni "Sin clasificar", ni llama "Empresas" al Directorio', () => {
    const hallazgos: string[] = []
    for (const ruta of ['app', 'components', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))) {
      sinComentarios(readFileSync(ruta, 'utf8')).split('\n').forEach((linea, i) => {
        for (const { re, motivo } of PROHIBIDOS) {
          if (re.test(linea)) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} → ${motivo}`)
        }
      })
    }
    expect(hallazgos, hallazgos.join('\n')).toEqual([])
  })
})
