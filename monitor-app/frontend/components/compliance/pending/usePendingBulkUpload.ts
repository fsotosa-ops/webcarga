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
  /** Otro archivo del lote va al mismo registro. */
  collision: boolean
  ready: boolean
}

const CONCURRENCY = 3

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

  /** Agrupa y decide qué está listo. Dos archivos al mismo registro chocan:
   *  ninguno está listo y los dos se piden elegir (uno ya guardado ocupa su
   *  registro igual, así que el otro no lo pisa). */
  function rowsOf(list: BulkItem[]): BulkRow[] {
    const count = new Map<string, number>()
    for (const it of list) if (it.recordId) count.set(it.recordId, (count.get(it.recordId) ?? 0) + 1)
    return list.map((item, index) => {
      const collision = item.status !== 'saved' && !!item.recordId && (count.get(item.recordId) ?? 0) > 1
      const group: BulkGroup = item.status === 'saved' ? 'assigned'
        : collision ? 'choose'
        : item.recordId ? 'assigned'
        : item.match.status === 'ambiguous' ? 'choose' : 'unassigned'
      const hasData = !pide ? true
        : pide.dato === 'periodo' ? /^\d{4}-\d{2}$/.test(batchPeriod)
        : !dateRequired || !!item.date
      const ready = (item.status === 'pending' || item.status === 'error')
        && !!item.recordId && !collision && hasData
      return { item, index, group, collision, ready }
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
