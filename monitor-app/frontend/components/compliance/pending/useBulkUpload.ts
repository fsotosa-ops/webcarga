'use client'

import { useRef, useState } from 'react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { datoQuePide, datosDelDocumento } from '@/lib/compliance'
import { periodoQueSeExige, vigenciaDe } from '@/lib/vigencia'
import { hoyEnChile } from '@/lib/utils/datetime'
import type { PendingMatchFile, PendingMatchRequirement, PendingSummaryRow } from '@/lib/types'

/** El contexto de una carga (Entrega D): el tipo desde Pendientes, la empresa desde su
 *  ficha, o nada desde Por asignar. Acota la propuesta; el flujo es el mismo. */
export type UploadContext = { requirement?: PendingSummaryRow | null; carrierId?: string | null }

/** Lo que la revisión necesita de un tipo: su nombre, su código y qué dato pide. */
export type UploadRule = Pick<PendingMatchRequirement, 'label' | 'requirement_code' | 'target_entity' | 'expiration_policy' | 'vigencia'>

export type BulkItem = {
  file: File
  match: PendingMatchFile
  recordId: string | null
  /** El tipo del registro elegido o propuesto; con el tipo fijado, siempre ese. */
  requirementId: string | null
  /** A quién va, dicho para la pantalla: lo trae el match o la elección. Se
   *  guarda en la fila porque, al guardar, quien ya cumplió sale de la lista
   *  de los que deben el documento y ya no se podría nombrar desde ahí. */
  label: string | null
  carrier: string | null
  /** Cómo llegó a su registro: la propuesta del servidor o una elección. */
  via: 'match' | 'manual' | null
  /** La fecha propia del archivo (impresa o de emisión), si su regla la pide. */
  date: string
  status: 'pending' | 'saving' | 'saved' | 'staged' | 'error'
  error?: string
}

export type BulkGroup = 'choose' | 'unassigned' | 'assigned'
export type BulkRow = {
  item: BulkItem
  index: number
  group: BulkGroup
  /** Otro archivo del lote va al mismo registro: `outranked` si el otro es
   *  estrictamente más fuerte y se queda; `tie` si nadie gana y bajan todos. */
  collision: BulkCollision | null
  /** A quién va el archivo con el que choca. */
  collisionLabel: string | null
  /** El tipo de la fila y qué dato pide, si se sabe. */
  rule: UploadRule | null
  ready: boolean
}
export type BulkCollision = 'outranked' | 'tie'

const CONCURRENCY = 3
/** El backend corta en 50 archivos por subida a Por asignar (`_MAX_FILES_PER_UPLOAD`):
 *  una tanda de 120 se manda en lotes encadenados. */
const STAGING_BATCH = 50
/** El mismo `_AMBIGUITY_MARGIN` del matcher del servidor. */
const AMBIGUITY_MARGIN = 0.05

/** La fuerza de un archivo en su registro. Guardado: ya lo ocupa, gana
 *  siempre. Propuesta del servidor: identificador o declaración sobre nombre,
 *  luego la confianza. Elección a mano: sin fuerza que comparar (empata). */
type Strength = { saved: true } | { saved: false; strong: boolean; confidence: number } | null
function strengthOf(it: BulkItem): Strength {
  if (it.status === 'saved') return { saved: true }
  if (it.via !== 'match' || !it.match.reason || it.match.confidence == null) return null
  return { saved: false, strong: it.match.reason !== 'name', confidence: it.match.confidence }
}
function outranks(a: Strength, b: Strength): boolean {
  if (!a || !b) return false
  if (a.saved || b.saved) return a.saved && !b.saved
  if (a.strong !== b.strong) return a.strong
  return a.confidence - b.confidence > AMBIGUITY_MARGIN
}

/** Regla de choque del lote (P23): la MISMA que `resolve_collisions` en el
 *  servidor (`document_matcher.py`). Entre los archivos que van a un mismo
 *  registro, si uno es estrictamente más fuerte que todos los demás, se queda y
 *  solo los otros bajan (`outranked`); si no, bajan todos (`tie`). Devuelve
 *  índice → motivo, solo de los que bajan. */
export function resolveCollisions(list: BulkItem[]): Map<number, BulkCollision> {
  const groups = new Map<string, number[]>()
  list.forEach((it, i) => { if (it.recordId) groups.set(it.recordId, [...(groups.get(it.recordId) ?? []), i]) })
  const demoted = new Map<number, BulkCollision>()
  for (const idx of groups.values()) {
    if (idx.length < 2) continue
    const winner = idx.find(i => idx.every(j => j === i || outranks(strengthOf(list[i]), strengthOf(list[j]))))
    for (const i of idx) {
      if (i === winner || list[i].status === 'saved') continue
      demoted.set(i, winner === undefined ? 'tie' : 'outranked')
    }
  }
  return demoted
}

/** El período que se exige hoy (`YYYY-MM`) según la regla del tipo (respeta su
 *  desfase). Vacío si la regla no lo define: se pide a mano. */
function proposedPeriod(rule: UploadRule): string {
  if (!rule.expiration_policy) return ''
  const p = periodoQueSeExige(
    vigenciaDe({ expiration_policy: rule.expiration_policy, vigencia: rule.vigencia }),
    new Date(`${hoyEnChile()}T12:00:00`))
  return p ? `${p.periodo.getFullYear()}-${String(p.periodo.getMonth() + 1).padStart(2, '0')}` : ''
}

function ruleOfSummary(r: PendingSummaryRow): UploadRule {
  return {
    label: r.label, requirement_code: r.requirement_code ?? '', target_entity: r.target_entity ?? 'CARRIER',
    expiration_policy: r.expiration_policy, vigencia: r.vigencia,
  }
}

/** Una carga en lote (spec 2026-10-11 §6; Entrega D). Nada se sube hasta `save()`:
 *  lo listo va a su registro, de a tres, y lo que quedó sin resolver va a Por asignar
 *  con lo que ya se sabía (su tipo y la empresa del contexto). Cada fila conserva su
 *  resultado; reintentar no repite lo ya guardado. */
export function useBulkUpload(context: UploadContext = {}) {
  const fixed = context.requirement ?? null
  const subirDocumento = useSubirDocumento()
  const [items, setItems] = useState<BulkItem[]>([])
  const [rules, setRules] = useState<Record<string, UploadRule>>(fixed ? { [fixed.key]: ruleOfSummary(fixed) } : {})
  /** El período, por tipo: es del lote, no de cada archivo (todos los F30-1 de una
   *  tanda son del mismo mes). */
  const [periods, setPeriods] = useState<Record<string, string>>({})
  const [matching, setMatching] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)
  const [staged, setStaged] = useState(0)
  const lastFiles = useRef<File[]>([])

  async function receive(files: File[]) {
    if (!files.length) return
    lastFiles.current = files
    setMatching(true)
    setMatchError(null)
    try {
      const res = await complianceApi.matchUploadFiles(files.map(f => f.name), {
        requirementId: fixed?.key, carrierId: context.carrierId ?? undefined,
      })
      const known: Record<string, UploadRule> = { ...(res.requirements ?? {}) }
      if (fixed) known[fixed.key] = ruleOfSummary(fixed)
      setRules(known)
      setPeriods(Object.fromEntries(Object.entries(known).map(([id, r]) => [id, proposedPeriod(r)])))
      setItems(files.map((file, i) => {
        const m = res.files[i]
        return {
          file, match: m, recordId: m.record_id, requirementId: fixed?.key ?? m.requirement_id,
          label: m.subject_label, carrier: m.carrier_name,
          via: m.record_id ? 'match' : null, date: '', status: 'pending',
        }
      }))
      setSavedOnce(false)
      setStaged(0)
    } catch (e) {
      setMatchError(e instanceof Error && e.message ? e.message : 'No se pudo revisar a quién va cada archivo')
    } finally {
      setMatching(false)
    }
  }

  const update = (i: number, patch: Partial<BulkItem>) =>
    setItems(prev => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  const ruleOf = (it: BulkItem): UploadRule | null => (it.requirementId ? rules[it.requirementId] ?? null : null)
  const pideOf = (it: BulkItem) => {
    const rule = ruleOf(it)
    return rule?.expiration_policy ? datoQuePide(rule.expiration_policy) : null
  }

  /** Agrupa y decide qué está listo. Dos archivos al mismo registro chocan
   *  (`resolveCollisions`): el que baja no está listo y se pide elegir (uno ya
   *  guardado ocupa su registro, así que el otro no lo pisa). Un archivo que
   *  el servidor ya bajó por un choque lo sigue diciendo hasta que se elija. */
  function rowsOf(list: BulkItem[]): BulkRow[] {
    const demoted = resolveCollisions(list)
    return list.map((item, index) => {
      const fromServer = !item.recordId && item.match.collision ? item.match.collision : null
      const collision = demoted.get(index) ?? fromServer
      const collisionLabel = !collision ? null
        : fromServer ? item.match.collision_subject_label ?? null
        : item.label
      const group: BulkGroup = item.status === 'saved' ? 'assigned'
        : collision ? 'choose'
        : item.recordId ? 'assigned'
        : item.match.status === 'ambiguous' ? 'choose' : 'unassigned'
      const pide = pideOf(item)
      const hasData = !pide ? true
        : pide.dato === 'periodo' ? /^\d{4}-\d{2}$/.test(periods[item.requirementId ?? ''] ?? '')
        : !pide.obligatorio || !!item.date
      const ready = (item.status === 'pending' || item.status === 'error')
        && !!item.recordId && !collision && hasData
      return { item, index, group, collision, collisionLabel, rule: ruleOf(item), ready }
    })
  }

  const dataOf = (it: BulkItem) => {
    const pide = pideOf(it)
    if (!pide) return undefined
    const valor = pide.dato === 'periodo' ? periods[it.requirementId ?? ''] ?? '' : it.date
    const datos = datosDelDocumento(pide.dato, valor)
    return Object.keys(datos).length ? datos : undefined
  }

  /** Lo que no se resolvió va a Por asignar, una tanda por tipo conocido: allí
   *  se elige de quién es, sin volver a subirlo. */
  async function stageUnresolved(list: BulkRow[]) {
    const byType = new Map<string, BulkRow[]>()
    for (const r of list) {
      const k = r.item.requirementId ?? ''
      byType.set(k, [...(byType.get(k) ?? []), r])
    }
    for (const [typeId, rows] of byType) {
      const rule = typeId ? rules[typeId] : null
      for (let i = 0; i < rows.length; i += STAGING_BATCH) {
        const batch = rows.slice(i, i + STAGING_BATCH)
        try {
          const res = await documentIngestApi.upload(context.carrierId ?? undefined, batch.map(r => r.item.file),
            rule ? { code: rule.requirement_code, target: rule.target_entity } : undefined)
          // La subida es por archivo: responde 201 aunque alguno no entre, y lo dice en
          // `errors`. Cada fila toma SU resultado; un duplicado ya está en Por asignar.
          const fallas = new Map(res.errors.map(e => [e.file_name, e.error]))
          let entraron = 0
          batch.forEach(r => {
            const falla = fallas.get(r.item.file.name)
            if (falla) update(r.index, { status: 'error', error: falla })
            else { update(r.index, { status: 'staged' }); entraron++ }
          })
          setStaged(n => n + entraron)
        } catch (e) {
          batch.forEach(r => update(r.index, {
            status: 'error', error: e instanceof Error && e.message ? e.message : 'No se pudo dejar en Por asignar',
          }))
        }
      }
    }
  }

  async function save() {
    const rows = rowsOf(items)
    const queue = rows.filter(r => r.ready)
    const unresolved = rows.filter(r => r.item.status === 'pending' && !r.ready && !r.item.recordId)
    if ((!queue.length && !unresolved.length) || saving) return
    // Si se cierra la pestaña a mitad, lo guardado queda guardado; el resto
    // no. El aviso existe solo mientras hay subidas en vuelo.
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    setSaving(true)
    setProgress({ done: 0, total: queue.length })
    let next = 0
    async function worker() {
      while (next < queue.length) {
        const { item, index } = queue[next++]
        update(index, { status: 'saving', error: undefined })
        try {
          await subirDocumento(item.recordId!, item.file, dataOf(item))
          update(index, { status: 'saved' })
        } catch (e) {
          update(index, { status: 'error', error: e instanceof Error && e.message ? e.message : 'No se pudo subir el documento' })
        }
        setProgress(p => (p ? { ...p, done: p.done + 1 } : p))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
      if (unresolved.length) await stageUnresolved(unresolved)
    } finally {
      window.removeEventListener('beforeunload', warn)
      setSaving(false)
      setProgress(null)
      setSavedOnce(true)
    }
  }

  const rows = rowsOf(items)
  const busy = saving || matching
  /** Los tipos del lote que piden período: uno por tipo, arriba de la lista. */
  const periodTypes = [...new Set(items.map(i => i.requirementId).filter((id): id is string => !!id))]
    .filter(id => {
      const policy = rules[id]?.expiration_policy
      return !!policy && datoQuePide(policy)?.dato === 'periodo'
    })
  return {
    items, rows, rules, fixed,
    receive, matching, matchError,
    retryMatch: () => void receive(lastFiles.current),
    choose: (i: number, recordId: string, who?: { label: string; carrier: string | null; requirementId?: string }) => {
      if (busy) return
      update(i, {
        recordId, label: who?.label ?? null, carrier: who?.carrier ?? null, via: 'manual',
        ...(who?.requirementId ? { requirementId: who.requirementId } : {}),
      })
    },
    remove: (i: number) => { if (!busy) setItems(prev => prev.filter((_, j) => j !== i)) },
    /** "Elegir otro": otro archivo para la misma fila (el que pesaba de más). */
    replaceFile: (i: number, file: File) => { if (!busy) update(i, { file, status: 'pending', error: undefined }) },
    setRowDate: (i: number, date: string) => update(i, { date }),
    periodTypes, periods,
    setPeriod: (requirementId: string, value: string) => setPeriods(p => ({ ...p, [requirementId]: value })),
    ready: rows.filter(r => r.ready).length,
    /** Lo que al guardar va a Por asignar. */
    toStage: rows.filter(r => r.item.status === 'pending' && !r.ready && !r.item.recordId).length,
    save, saving, progress,
    result: !saving && savedOnce ? {
      saved: items.filter(i => i.status === 'saved').length,
      staged,
      errors: items.filter(i => i.status === 'error').length,
      unresolved: rows.filter(r => r.item.status === 'pending' && !r.ready).length,
    } : null,
    reset: () => { if (!busy) { setItems([]); setSavedOnce(false); setMatchError(null); setStaged(0) } },
  }
}
