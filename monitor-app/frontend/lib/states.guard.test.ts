// @vitest-environment node
/**
 * Spec D1 §8.5: ninguna etiqueta de estado escrita a mano fuera de
 * `lib/states.ts`, y ningún componente recalculando un estado documental.
 *
 * Los dos topes SOLO bajan. La Task 12 los baja al migrar la ficha, la Task 13
 * el Directorio, la Task 14 el embudo; la Task 16 los cambia por `toEqual([])`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..')
const GLOSARIO = 'lib/states.ts'

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && !e.name.includes('.fixtures.')) {
      acc.push(ruta)
    }
  }
  return acc
}
const archivos = () => ['app', 'components', 'lib', 'hooks'].flatMap(d => recorrer(join(RAIZ, d)))
const relativa = (ruta: string) => ruta.slice(RAIZ.length + 1)

/** Un comentario puede citar la palabra ("decía 'Inactiva'"); el código no. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** Las palabras del glosario (§3), sus plurales de pestaña y los sinónimos que
 *  la spec retira ("Inactiva", "Onboarding", "De baja", "Aprobado (manual)"…). */
const ETIQUETAS = [
  'Al día', 'Por vencer', 'Vencido', 'Vencidos', 'Falta', 'Faltan', 'Aún no se exige', 'Todavía no se exige',
  'Activa', 'Activas', 'Activo', 'En onboarding', 'Onboarding', 'Dada de baja', 'Dado de baja', 'Dadas de baja',
  'De baja', 'Inactiva', 'Inactivas', 'Inactivo', 'Habilitada', 'No habilitada', 'Habilitadas', 'No habilitadas',
  'Aprobado (manual)', 'Vence pronto',
]
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ALT = ETIQUETAS.map(escapar).join('|')
// Un literal que ES la etiqueta ('Falta', "Al día", `Vencido`), o el texto de
// JSX que la empieza (<span>Vencido{fecha}</span>). 'Falta el archivo' no es
// una etiqueta de estado y no coincide.
const ETIQUETA = new RegExp(`(['"\`])(${ALT})\\1|>\\s*(${ALT})\\s*(?=[<{])`, 'g')

export function etiquetasEn(src: string): string[] {
  return [...sinComentarios(src).matchAll(ETIQUETA)].map(m => m[2] ?? m[3])
}

/** La misma palabra, otro dominio. Cada entrada dice por qué. */
const OTROS_DOMINIOS: Record<string, { etiquetas: string[]; motivo: string }> = {
  'components/admin/UsersTable.tsx':        { etiquetas: ['Activo', 'Inactivo'], motivo: 'cuenta de usuario, no ciclo de vida del Directorio' },
  'components/dashboard/LocationsTable.tsx': { etiquetas: ['Activo', 'Inactivo'], motivo: 'lugar de carga o entrega' },
  'components/dashboard/IndicatorSwitches.tsx': { etiquetas: ['Activo'], motivo: 'indicador is_active del viaje' },
  'lib/utils/alertSignals.ts':              { etiquetas: ['Activo'], motivo: 'indicador is_active del viaje' },
  'app/dashboard/insurance/page.tsx':       { etiquetas: ['Por vencer', 'Al día'], motivo: 'vigencia de póliza (Seguros ≠ Certificación)' },
  'lib/insurance.tsx':                      { etiquetas: ['Al día', 'Vence pronto'], motivo: 'vigencia de póliza (Seguros ≠ Certificación)' },
}

export function etiquetasEscritasAMano(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    const rel = relativa(ruta)
    if (rel === GLOSARIO) continue
    const permitidas = OTROS_DOMINIOS[rel]?.etiquetas ?? []
    sinComentarios(readFileSync(ruta, 'utf8')).split('\n').forEach((linea, i) => {
      for (const e of etiquetasEn(linea)) if (!permitidas.includes(e)) hallazgos.push(`${rel}:${i + 1} → ${e}`)
    })
  }
  return hallazgos
}

/** Campos con los que un componente recalcula un estado que ya manda la API. */
const RECALCULO = /\.(is_expired|is_expiring_soon|compliance_health|pending_mandatory|urgencia)\b/g

export function lecturasDeRecalculo(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    const rel = relativa(ruta)
    if (rel === GLOSARIO || rel === 'lib/types.ts') continue
    sinComentarios(readFileSync(ruta, 'utf8')).split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(RECALCULO)) hallazgos.push(`${rel}:${i + 1} → ${m[0]}`)
    })
  }
  return hallazgos
}

describe('el glosario manda (spec D1 §8.5)', () => {
  it('encuentra archivos que revisar', () => {
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('reconoce una etiqueta en un literal y en texto de JSX, y no una frase que la contiene', () => {
    expect(etiquetasEn(`const a = 'Falta'`)).toEqual(['Falta'])
    expect(etiquetasEn(`<span className="x">Vencido{fecha}</span>`)).toEqual(['Vencido'])
    expect(etiquetasEn(`label: 'Falta el archivo'`)).toEqual([])
    expect(etiquetasEn(`// decía 'Inactiva'`)).toEqual([])
  })

  it('la lista de otros dominios no se pudre', () => {
    for (const [rel, { etiquetas }] of Object.entries(OTROS_DOMINIOS)) {
      expect(existsSync(join(RAIZ, rel)), `${rel} ya no existe: sácalo de OTROS_DOMINIOS`).toBe(true)
      const halladas = etiquetasEn(readFileSync(join(RAIZ, rel), 'utf8'))
      expect(etiquetas.some(e => halladas.includes(e)), `${rel} ya no dice ${etiquetas.join('/')}: sácalo`).toBe(true)
    }
  })

  it('no crecen las etiquetas de estado escritas a mano', () => {
    // 45 medidas el 12/10 (comentarios fuera). 45 -> 19 en la Task 11: lib/types,
    // lib/pending, vigenciaDeLaFila y Pendientes leen el glosario, y 13 son de
    // otro dominio (OTROS_DOMINIOS). Quedan: ficha (2), Directorio (4), Seguros
    // (2), FiltroDeEstado (3), DocumentStatusBar (2), ComplianceBadge (2),
    // lib/compliance (3, Task 12) y el embudo (1, Task 14).
    // 19 -> 14 en la Task 12: salen ComplianceBadge (2) y lib/compliance (3).
    const DEUDA = 14
    const h = etiquetasEscritasAMano()
    expect(h.length, `Etiquetas de estado fuera de lib/states.ts: ${h.length} (tope ${DEUDA}).\n${h.join('\n')}`)
      .toBeLessThanOrEqual(DEUDA)
  })

  it('no crecen las lecturas que recalculan un estado', () => {
    // 48 medidas el 12/10. 48 -> 42 en la Task 11: vigenciaDeLaFila y
    // RenglonPendiente leen document_state en vez de urgencia.
    // 42 -> 21 en la Task 12: la ficha, Certificación, DocumentChecklist, el
    // banner, el panel, el slide-over y el mapeo leen document_state.
    const DEUDA = 21
    const h = lecturasDeRecalculo()
    expect(h.length, `Lecturas de recálculo: ${h.length} (tope ${DEUDA}).\n${h.join('\n')}`).toBeLessThanOrEqual(DEUDA)
  })
})
