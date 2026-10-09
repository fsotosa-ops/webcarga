// @vitest-environment node
/** Los permisos de la pantalla vienen de la API (GET /me). Ninguna pantalla
 *  decide por rol: no hay jerarquía ni nombres de rol en el código. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..')
function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) recorrer(ruta, acc) }
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && !e.name.endsWith('.generated.ts')) acc.push(ruta)
  }
  return acc
}

describe('autorización en el frontend', () => {
  it('nadie decide por nombre de rol', () => {
    const malos = ['app', 'components', 'hooks', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(f => /hasRole\(|useRolMinimo|useCanEdit|useCanAdmin|\.from\('profiles'\)\.select\('role/.test(readFileSync(f, 'utf8')))
    expect(malos).toEqual([])
  })
})
