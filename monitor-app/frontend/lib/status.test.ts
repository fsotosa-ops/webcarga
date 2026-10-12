// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { statusLabel } from '@/lib/types'

describe('statusLabel (bloque 0, 0.7)', () => {
  it('concuerda en género: la empresa dada de baja, el conductor y el equipo dados de baja', () => {
    expect(statusLabel('carrier', 'INACTIVE')).toBe('Dada de baja')
    expect(statusLabel('carrier', 'LEGACY_INACTIVE')).toBe('Dada de baja')
    expect(statusLabel('carrier', 'ACTIVE')).toBe('Activa')
    expect(statusLabel('carrier', 'ONBOARDING')).toBe('En onboarding')
    expect(statusLabel('driver', 'INACTIVE')).toBe('Dado de baja')
    expect(statusLabel('asset', 'ACTIVE')).toBe('Activo')
  })

  it('"Inactiva" ya no es una etiqueta de estado en ninguna pantalla', () => {
    const RAIZ = join(__dirname, '..')
    const recorrer = (dir: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) recorrer(ruta, acc) }
        else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) acc.push(ruta)
      }
      return acc
    }
    const con = ['app', 'components'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(r => readFileSync(r, 'utf8').includes("'Inactiva'"))
    expect(con).toEqual([])
  })
})
