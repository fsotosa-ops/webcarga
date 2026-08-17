// @vitest-environment node
/**
 * El producto opera en Chile y el equipo no es rioplatense: el voseo es un
 * MUST del usuario, no una preferencia de estilo. Este test existe porque
 * cinco casos llegaron a produccion sin que nada los detectara — el mas
 * visible encabezaba el modulo de Cierre ("Revisa pendientes, cierra
 * Tractoreo...").
 *
 * Recorre el CODIGO FUENTE en vez de renderizar, a proposito: el voseo puede
 * estar en un mensaje de error, en un placeholder o en una rama que ningun
 * test monta. Un test que renderiza solo protege lo que ya se renderiza.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Formas verbales del voseo que aparecen en interfaz: imperativos y presentes
// de 2a persona rioplatense. Ninguna choca con vocabulario legitimo del
// dominio (patente, tracto, rampla, viaje, cierre...).
const VOSEO = [
  'revisá', 'cerrá', 'compartí', 'elegí', 'ingresá', 'seleccioná', 'agregá',
  'arrastrá', 'mirá', 'poné', 'hacé', 'tenés', 'podés', 'chequeá', 'verificá',
  'guardá', 'cargá', 'buscá', 'escribí', 'subí', 'marcá', 'confirmá', 'editá',
  'borrá', 'filtrá', 'andá', 'fijate', 'acordate', 'querés', 'sabés', 'debés',
]

const RAIZ = join(__dirname, '..', '..')

// Recorrido a mano en vez de un glob: `fs.globSync` existe en Node 24 pero no
// esta en los tipos de @types/node instalados, y agregar una dependencia solo
// para listar archivos no se justifica.
function recorrer(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(entrada.name) && !entrada.name.includes('.test.')) {
      acc.push(ruta)
    }
  }
  return acc
}

function archivosDeInterfaz(): string[] {
  return ['app', 'components', 'lib'].flatMap((d) => recorrer(join(RAIZ, d)))
}

describe('el texto de la interfaz esta en espanol neutral', () => {
  it('encuentra archivos que revisar', () => {
    // Guardia del guardia: si el glob deja de encontrar nada, el test de
    // abajo pasaria siempre y nadie se enteraria.
    expect(archivosDeInterfaz().length).toBeGreaterThan(50)
  })

  it('no usa formas de voseo', () => {
    const hallazgos: string[] = []

    for (const ruta of archivosDeInterfaz()) {
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        const bajo = linea.toLowerCase()
        for (const forma of VOSEO) {
          // \b no delimita bien con acentos en JS: se hace a mano.
          const re = new RegExp(`(^|[^a-záéíóúñ])${forma}([^a-záéíóúñ]|$)`)
          if (re.test(bajo)) {
            hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} → "${forma}"`)
            break
          }
        }
      })
    }

    expect(hallazgos, `Voseo encontrado:\n${hallazgos.join('\n')}`).toEqual([])
  })
})
