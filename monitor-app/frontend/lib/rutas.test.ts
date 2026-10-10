// @vitest-environment node
/**
 * Las rutas van en INGLÉS; la etiqueta que se ve, en español (estándar de la
 * normalización de rutas, Ronda 55, y pedido explícito del usuario: "las url
 * tienen que ser estándar de la industria"). Se coló dos veces una ruta en
 * español: este test obliga a que toda ruta nueva pase por esta lista.
 *
 * Las dos en español que quedan son redirecciones de enlaces viejos, a
 * propósito: estuvieron meses en el menú y no deben dar 404.
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', 'app')

function segmentos(dir: string, acc = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue
    // [param], (grupo), @slot y (.)intercepción no son texto de la URL.
    if (!/^[[(@]/.test(e.name)) acc.add(e.name)
    segmentos(join(dir, e.name), acc)
  }
  return acc
}

const EN_INGLES = [
  'access-denied', 'admin', 'api', 'auth', 'callback', 'carriers', 'certification', 'closures',
  'compliance', 'confirm', 'dashboard', 'forgot-password', 'history', 'inbox', 'insurance', 'login',
  'mfa', 'monitor', 'operations', 'pricing', 'reset-password', 'settings', 'setup', 'trips',
  'unavailable', 'v1', 'verify',
]
const REDIRECCIONES_VIEJAS = ['configuracion', 'usuarios']

describe('rutas', () => {
  it('toda ruta está en inglés (o es una redirección vieja declarada)', () => {
    const permitidas = new Set([...EN_INGLES, ...REDIRECCIONES_VIEJAS])
    expect([...segmentos(RAIZ)].filter(s => !permitidas.has(s)).sort()).toEqual([])
  })
})
