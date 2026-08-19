// @vitest-environment node
/**
 * La jerarquia de roles tiene UNA definicion.
 *
 * Estaba escrita nueve veces en siete archivos —`new Set(['editor','admin',
 * 'owner'])` y su gemela de admin— mientras `hasRole`, la unica que la definia
 * como jerarquia de verdad, no la llamaba nadie. Cuatro paginas ademas
 * reimplementaban el hook entero: sesion, consulta de perfil y comparacion,
 * copiado a mano.
 *
 * Agregar un rol nuevo obligaba a acordarse de siete lugares, y olvidarse de
 * uno no rompe nada: simplemente esa pantalla le niega permiso a alguien que
 * si lo tiene, sin error y sin aviso.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasRole } from './types'

const RAIZ = join(__dirname, '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}

const archivos = () => ['app', 'components', 'hooks', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))

describe('la jerarquia de roles', () => {
  it('responde por nivel minimo, no por pertenencia a un conjunto', () => {
    // Un owner puede todo lo que puede un editor. Con conjuntos sueltos eso
    // hay que acordarse de escribirlo en cada copia.
    expect(hasRole('owner', 'editor')).toBe(true)
    expect(hasRole('admin', 'editor')).toBe(true)
    expect(hasRole('editor', 'editor')).toBe(true)
    expect(hasRole('writer', 'editor')).toBe(false)
    expect(hasRole('viewer', 'admin')).toBe(false)
  })

  it('trata el rol ausente como el minimo, no como el maximo', () => {
    // El default importa: si un rol desconocido cayera del lado permisivo,
    // un perfil sin cargar daria permisos de edicion.
    expect(hasRole(undefined, 'editor')).toBe(false)
    expect(hasRole('rol-que-no-existe', 'viewer')).toBe(false)
  })

  it('nadie vuelve a escribir el conjunto de roles a mano', () => {
    const culpables: string[] = []
    for (const ruta of archivos()) {
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        // El orden canonico vive en `hasRole`; cualquier otra enumeracion de
        // roles es una copia que se va a desincronizar.
        if (/new Set\(\s*\[\s*['"](?:viewer|writer|editor|admin|owner)['"]/.test(linea)) {
          culpables.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`)
        }
      })
    }
    expect(culpables, `Usa hasRole(rol, minimo) en vez de un Set:\n${culpables.join('\n')}`)
      .toEqual([])
  })

  it('ninguna pantalla del cliente reimplementa la consulta del perfil', () => {
    // Cuatro paginas copiaban sesion + consulta + comparacion. Eso no es una
    // constante duplicada: es el hook entero escrito de nuevo.
    //
    // Los server components quedan FUERA a proposito: `admin/layout.tsx`
    // consulta el perfil para decidir un redirect antes de renderizar, que es
    // una cosa distinta y legitima — no puede usar un hook. Lo que si comparte
    // es la REGLA, y de eso se ocupa el test de abajo.
    const culpables: string[] = []
    for (const ruta of archivos()) {
      if (ruta.includes(join('hooks', 'use'))) continue   // los hooks SI la hacen
      const texto = readFileSync(ruta, 'utf8')
      const esDelCliente = texto.includes("@/lib/supabase/client")
      if (esDelCliente && /from\(['"]profiles['"]\)[\s\S]{0,120}select\(['"]role['"]\)/.test(texto)) {
        culpables.push(ruta.slice(RAIZ.length + 1))
      }
    }
    expect(culpables, `Usa useCanEdit() / useCanAdmin():\n${culpables.join('\n')}`).toEqual([])
  })

  it('nadie compara roles a mano, ni siquiera en el servidor', () => {
    // La decima copia tenia otra forma: `role !== 'admin' && role !== 'owner'`
    // en el layout de admin. Una jerarquia escrita como cadena de desigualdades
    // se desincroniza igual que un Set, y encima no se ve al buscar "Set".
    const culpables: string[] = []
    for (const ruta of archivos()) {
      if (ruta.endsWith(join('lib', 'types.ts'))) continue   // ahi vive la definicion
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (/role\s*[!=]==\s*['"](?:viewer|writer|editor|admin|owner)['"]/.test(linea)) {
          culpables.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`)
        }
      })
    }
    expect(culpables, `Usa hasRole(rol, minimo):\n${culpables.join('\n')}`).toEqual([])
  })
})
