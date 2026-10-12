// @vitest-environment node
/**
 * Spec D1 §8.5: ninguna etiqueta de estado escrita a mano fuera de
 * `lib/states.ts`, y ningún componente recalculando un estado documental.
 *
 * Estado final (Task 16, contraer): ninguna etiqueta fuera del glosario
 * (`toEqual([])`), y ninguna lectura de recálculo salvo el residuo con motivo
 * de RESIDUO_DE_RECALCULO (R-E6). Las Tasks 11-14 bajaron los topes hasta acá.
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

/** Lo único que queda leyendo un campo de la lista de arriba, con su motivo. */
const RESIDUO_DE_RECALCULO: Record<string, { campos: string[]; motivo: string }> = {
  'components/compliance/CertificationStatusTable.tsx': {
    campos: ['.pending_mandatory'],
    motivo: 'R-E6: /compliance-records/status manda pending_mandatory tal cual; la tabla solo lo compara con 0 ' +
      'para pintar, no recalcula un estado del documento',
  },
}

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

  it('ninguna etiqueta de estado escrita a mano fuera del glosario', () => {
    // 45 medidas el 12/10; las Tasks 11-14 las llevaron a 0 (lib/types, Pendientes,
    // la ficha, el Directorio, el roster, la vista rápida y el embudo leen el glosario).
    // Si aparece una, se corrige el archivo, no esta lista.
    expect(etiquetasEscritasAMano()).toEqual([])
  })

  it('ninguna lectura que recalcule un estado, salvo el residuo con motivo', () => {
    // 48 medidas el 12/10; las Tasks 11-14 las llevaron a 3, todas de
    // CertificationStatusTable.tsx (pending_mandatory, R-E6). La Task 16 retiró
    // compliance_health, urgencia y pending_mandatory del Directorio: el residuo
    // es el final de D1 y vive en RESIDUO_DE_RECALCULO con su motivo.
    const fuera = lecturasDeRecalculo().filter(h => {
      const [rel, campo] = [h.split(':')[0], h.split(' → ')[1]]
      return !RESIDUO_DE_RECALCULO[rel]?.campos.includes(campo)
    })
    expect(fuera).toEqual([])
  })

  it('el residuo de recálculo no se pudre', () => {
    for (const [rel, { campos }] of Object.entries(RESIDUO_DE_RECALCULO)) {
      expect(existsSync(join(RAIZ, rel)), `${rel} ya no existe: sácalo de RESIDUO_DE_RECALCULO`).toBe(true)
      const leidos = lecturasDeRecalculo().filter(h => h.startsWith(`${rel}:`)).map(h => h.split(' → ')[1])
      for (const c of campos) expect(leidos, `${rel} ya no lee ${c}: sácalo`).toContain(c)
    }
  })
})
