/** El borrador de la tabla de documentos (HU-C1, entrega 2c).
 *
 *  Lo que cambia el estado de alguien —cómo vence, cuándo se exige, si es
 *  obligatorio, si está activo— no se guarda al tocar la celda: se junta acá,
 *  se ensaya entero con "Ver efecto" y se publica entero. "Cuándo vence" se
 *  calcula al leer, así que guardarlo celda por celda cambiaría el estado de
 *  todas las empresas sin que nadie viera antes el número.
 *
 *  Lo que es solo etiqueta (el nombre, las formas de reconocerlo en el
 *  archivo) sigue guardándose al instante, como antes: no mueve a nadie.
 *
 *  Funciones puras: el borrador es un objeto por id, y cada edición devuelve
 *  uno nuevo. Un campo que vuelve a su valor guardado desaparece del
 *  borrador, así "N con cambios" nunca cuenta un cambio que no lo es. */
import type { CambioEnLote, CambiosDeRequisito } from '@/lib/api/requirements'
import type { ExigibleOn, RequirementOption } from '@/lib/types'
import { faltaDeVigencia, mismaVigencia, vigenciaDe, type Vigencia } from '@/lib/vigencia'

export type Edicion = {
  vigencia?: Vigencia
  exigible_on?: ExigibleOn
  is_active?: boolean
  requirement_level?: RequirementOption['requirement_level']
}
export type Campo = keyof Edicion
export type Borrador = Record<string, { requisito: RequirementOption; cambios: Edicion }>

/** Lo que muestra la fila: el borrador encima de lo guardado. */
export function valorDe(r: RequirementOption, b: Borrador) {
  const guardado = {
    vigencia: vigenciaDe(r),
    exigible_on: r.exigible_on ?? 'ON_ENTITY_START',
    is_active: r.is_active,
    requirement_level: r.requirement_level,
  }
  return { ...guardado, ...b[r.id]?.cambios }
}

function igualAlGuardado(r: RequirementOption, campo: Campo, valor: unknown): boolean {
  if (campo === 'vigencia') return mismaVigencia(valor as Vigencia, vigenciaDe(r))
  if (campo === 'exigible_on') return valor === (r.exigible_on ?? 'ON_ENTITY_START')
  return valor === r[campo]
}

export function editar(b: Borrador, r: RequirementOption, cambios: Edicion): Borrador {
  const actuales: Edicion = { ...b[r.id]?.cambios, ...cambios }
  for (const campo of Object.keys(actuales) as Campo[]) {
    if (igualAlGuardado(r, campo, actuales[campo])) delete actuales[campo]
  }
  const siguiente = { ...b }
  if (Object.keys(actuales).length) siguiente[r.id] = { requisito: r, cambios: actuales }
  else delete siguiente[r.id]
  return siguiente
}

export function camposCambiados(b: Borrador, id: string): Set<Campo> {
  return new Set(Object.keys(b[id]?.cambios ?? {}) as Campo[])
}

export function cambiosDelBorrador(b: Borrador): CambioEnLote[] {
  return Object.entries(b).map(([id, { cambios }]) => ({
    requirement_id: id, patch: cambios as CambiosDeRequisito,
  }))
}

/** Los documentos cuya regla está a medias: no se ensayan ni se publican. */
export function incompletos(b: Borrador): string[] {
  return Object.entries(b)
    .filter(([, { cambios }]) => cambios.vigencia && faltaDeVigencia(cambios.vigencia) !== null)
    .map(([id]) => id)
}

// ── Cómo se renueva, en las palabras de la planilla ─────────────────────────

export type Renovacion = 'nunca' | 'fecha' | 'fecha_opcional' | 'anual' | 'bienal' | 'mes' | 'otra'

export const RENOVACIONES: { valor: Exclude<Renovacion, 'otra'>; texto: string }[] = [
  { valor: 'nunca', texto: 'No vence' },
  { valor: 'fecha', texto: 'Fecha del documento' },
  { valor: 'fecha_opcional', texto: 'Fecha del documento (opcional)' },
  { valor: 'anual', texto: 'Cada año' },
  { valor: 'bienal', texto: 'Cada 2 años' },
  { valor: 'mes', texto: 'Cada mes' },
]

/** 'otra' es una regla que la celda no sabe escribir (cada 6 meses, un
 *  trimestral): se muestra tal cual y se edita en el panel, en vez de
 *  colapsarla en la opción más parecida al abrir la tabla. */
export function renovacionDe(v: Vigencia): Renovacion {
  switch (v.politica) {
    case 'NONE': return 'nunca'
    case 'REQUIRED': return 'fecha'
    case 'OPTIONAL': return 'fecha_opcional'
    case 'ISSUE_PLUS_MONTHS':
      return v.validity_months === 12 ? 'anual' : v.validity_months === 24 ? 'bienal' : 'otra'
    case 'CALENDAR_PERIOD':
      return v.frequency_months === 1 ? 'mes' : 'otra'
  }
}

/** La vigencia de una renovación, partiendo de la actual: el aviso y la
 *  gracia no se pierden por cambiar de anual a bienal. */
export function vigenciaPara(r: Exclude<Renovacion, 'otra'>, actual: Vigencia): Vigencia {
  const avisoYGracia = { warning_days: actual.warning_days ?? null, grace_days: actual.grace_days ?? 0 }
  switch (r) {
    // Un documento que no vence no guarda regla (services/vigencia.py).
    case 'nunca': return { politica: 'NONE' }
    case 'fecha': return { politica: 'REQUIRED', ...avisoYGracia }
    case 'fecha_opcional': return { politica: 'OPTIONAL', ...avisoYGracia }
    case 'anual': return { politica: 'ISSUE_PLUS_MONTHS', validity_months: 12, ...avisoYGracia }
    case 'bienal': return { politica: 'ISSUE_PLUS_MONTHS', validity_months: 24, ...avisoYGracia }
    case 'mes':
      // El día tope NO se inventa: queda vacío y la fila dice que falta.
      return actual.politica === 'CALENDAR_PERIOD' && actual.frequency_months === 1
        ? actual
        : { politica: 'CALENDAR_PERIOD', frequency_months: 1, cutoff_day: null,
            period_offset_months: 1, ...avisoYGracia }
  }
}

// ── Editar varios a la vez ───────────────────────────────────────────────────

export type EdicionEnLote = {
  renovacion?: Exclude<Renovacion, 'otra'>
  /** null = volver al aviso general. */
  aviso?: number | null
  exigible_on?: ExigibleOn
  is_active?: boolean
}

const SOLO_CONDUCTOR: ExigibleOn[] = ['MONTH_AFTER_START', 'ON_ENTITY_END']

/** Aplica la barra de selección a cada fila con SU valor actual. Lo que no
 *  vale para una fila se salta en vez de fallar al publicar: el aviso en un
 *  documento que no vence, o "al término" en una empresa (la base lo rechaza). */
export function aplicarEnLote(b: Borrador, filas: RequirementOption[], e: EdicionEnLote): Borrador {
  let siguiente = b
  for (const r of filas) {
    const actual = valorDe(r, siguiente)
    const cambios: Edicion = {}
    let vigencia = actual.vigencia
    if (e.renovacion) vigencia = vigenciaPara(e.renovacion, vigencia)
    if (e.aviso !== undefined && vigencia.politica !== 'NONE') {
      vigencia = { ...vigencia, warning_days: e.aviso }
    }
    if (vigencia !== actual.vigencia) cambios.vigencia = vigencia
    if (e.exigible_on && (r.target_entity === 'DRIVER' || !SOLO_CONDUCTOR.includes(e.exigible_on))) {
      cambios.exigible_on = e.exigible_on
    }
    if (e.is_active !== undefined) cambios.is_active = e.is_active
    if (Object.keys(cambios).length) siguiente = editar(siguiente, r, cambios)
  }
  return siguiente
}
