'use client'

import { useRef, useState } from 'react'
import { complianceApi } from '@/lib/api/compliance'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { datoQuePide, datosDelDocumento } from '@/lib/compliance'
import { periodoQueSeExige, vigenciaDe } from '@/lib/vigencia'
import { hoyEnChile } from '@/lib/utils/datetime'
import type { PendingMatchFile, PendingSummaryRow } from '@/lib/types'

export type BulkItem = {
  file: File
  match: PendingMatchFile
  recordId: string | null
  /** A quién va, dicho para la pantalla: lo trae el match o la elección. Se
   *  guarda en la fila porque, al guardar, quien ya cumplió sale de la lista
   *  de los que deben el documento y ya no se podría nombrar desde ahí. */
  label: string | null
  carrier: string | null
  /** Cómo llegó a su registro: la propuesta del servidor o una elección. */
  via: 'match' | 'manual' | null
  /** La fecha propia del archivo (impresa o de emisión), si su regla la pide. */
  date: string
  status: 'pending' | 'saving' | 'saved' | 'error'
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
  ready: boolean
}
export type BulkCollision = 'outranked' | 'tie'

const CONCURRENCY = 3
/** El mismo `_AMBIGUITY_MARGIN` del matcher del servidor. */
const AMBIGUITY_MARGIN = 0.05

/** La fuerza de un archivo en su registro. Guardado: ya lo ocupa, gana
 *  siempre. Propuesta del servidor: identificador (RUT, patente) sobre nombre,
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

/** Regla de choque del lote (P23): la MISMA que `resolve_owner_collisions`
 *  en el servidor (`document_matcher.py`). Entre los archivos que van a un
 *  mismo registro, si uno es estrictamente más fuerte que todos los demás,
 *  se queda y solo los otros bajan (`outranked`); si no, bajan todos (`tie`).
 *  Devuelve índice → motivo, solo de los que bajan. */
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

/** El período que se exige hoy (`YYYY-MM`), con la aritmética de la regla
 *  (respeta su desfase). Vacío si la regla no lo define: se pide a mano. */
function proposedPeriod(requirement: PendingSummaryRow): string {
  if (!requirement.expiration_policy) return ''
  const p = periodoQueSeExige(
    vigenciaDe({ expiration_policy: requirement.expiration_policy, vigencia: requirement.vigencia }),
    new Date(`${hoyEnChile()}T12:00:00`))
  return p ? `${p.periodo.getFullYear()}-${String(p.periodo.getMonth() + 1).padStart(2, '0')}` : ''
}

/** La carga en lote de Pendientes (spec 2026-10-11, sección 6). Nada se sube
 *  hasta `save()`; se guarda lo que está listo, de a tres, y cada fila conserva
 *  su resultado. Reintentar no repite lo ya guardado. */
export function usePendingBulkUpload(requirement: PendingSummaryRow) {
  const subirDocumento = useSubirDocumento()
  const pide = requirement.expiration_policy ? datoQuePide(requirement.expiration_policy) : null
  const [items, setItems] = useState<BulkItem[]>([])
  const [batchPeriod, setBatchPeriod] = useState('')
  const [matching, setMatching] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)
  const lastFiles = useRef<File[]>([])

  async function receive(files: File[]) {
    if (!files.length) return
    lastFiles.current = files
    setMatching(true)
    setMatchError(null)
    try {
      const { files: proposals } = await complianceApi.matchPendingFiles(requirement.key, files.map(f => f.name))
      setItems(files.map((file, i) => {
        const m = proposals[i]
        return {
          file, match: m, recordId: m.record_id, label: m.subject_label, carrier: m.carrier_name,
          via: m.record_id ? 'match' : null, date: '', status: 'pending',
        }
      }))
      setBatchPeriod(proposedPeriod(requirement))
      setSavedOnce(false)
    } catch (e) {
      setMatchError(e instanceof Error && e.message ? e.message : 'No se pudo revisar a quién va cada archivo')
    } finally {
      setMatching(false)
    }
  }

  const update = (i: number, patch: Partial<BulkItem>) =>
    setItems(prev => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  const needs = pide?.dato ?? null
  const dateRequired = !!pide && pide.dato !== 'periodo' && pide.obligatorio

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
      const hasData = !pide ? true
        : pide.dato === 'periodo' ? /^\d{4}-\d{2}$/.test(batchPeriod)
        : !dateRequired || !!item.date
      const ready = (item.status === 'pending' || item.status === 'error')
        && !!item.recordId && !collision && hasData
      return { item, index, group, collision, collisionLabel, ready }
    })
  }

  const dataOf = (it: BulkItem) => {
    if (!pide) return undefined
    const valor = pide.dato === 'periodo' ? batchPeriod : it.date
    const datos = datosDelDocumento(pide.dato, valor)
    return Object.keys(datos).length ? datos : undefined
  }

  async function save() {
    const queue = rowsOf(items).filter(r => r.ready)
    if (!queue.length || saving) return
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
    } finally {
      window.removeEventListener('beforeunload', warn)
      setSaving(false)
      setProgress(null)
      setSavedOnce(true)
    }
  }

  const rows = rowsOf(items)
  const busy = saving || matching
  return {
    items, rows, needs, dateRequired,
    receive, matching, matchError,
    retryMatch: () => void receive(lastFiles.current),
    choose: (i: number, recordId: string, who?: { label: string; carrier: string | null }) => {
      if (busy) return
      update(i, { recordId, label: who?.label ?? null, carrier: who?.carrier ?? null, via: 'manual' })
    },
    remove: (i: number) => { if (!busy) setItems(prev => prev.filter((_, j) => j !== i)) },
    /** "Elegir otro": otro archivo para la misma fila (el que pesaba de más). */
    replaceFile: (i: number, file: File) => { if (!busy) update(i, { file, status: 'pending', error: undefined }) },
    setRowDate: (i: number, date: string) => update(i, { date }),
    batchPeriod, setBatchPeriod,
    ready: rows.filter(r => r.ready).length,
    save, saving, progress,
    result: !saving && savedOnce ? {
      saved: items.filter(i => i.status === 'saved').length,
      errors: items.filter(i => i.status === 'error').length,
      unresolved: rows.filter(r => r.item.status === 'pending' && !r.ready).length,
    } : null,
    reset: () => { if (!busy) { setItems([]); setSavedOnce(false); setMatchError(null) } },
  }
}
