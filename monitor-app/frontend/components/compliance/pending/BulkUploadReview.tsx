'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, Upload } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { StatusChip } from '@/components/ui/StatusChip'
import type { PendingComplianceRow, PendingSummaryRow } from '@/lib/types'
import { usePendingBulkUpload, type BulkRow } from './usePendingBulkUpload'

/** "1 archivo" / "3 archivos". */
const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`

/** Por qué el servidor lo asignó. Por nombre lleva su confianza: es la única
 *  razón que puede equivocarse. */
function reasonOf(row: BulkRow): { text: string; tone: 'resolved' | 'action' } | null {
  const { item } = row
  if (item.via !== 'match') return null
  if (item.match.reason === 'rut') return { text: 'por RUT', tone: 'resolved' }
  if (item.match.reason === 'plate') return { text: 'por patente', tone: 'resolved' }
  if (item.match.reason === 'name') {
    const pct = item.match.confidence != null ? ` · ${Math.round(item.match.confidence * 100)} %` : ''
    return { text: `por nombre${pct}`, tone: 'action' }
  }
  return null
}

const AMBIGUOUS: Record<string, string> = {
  CARRIER: 'hay más de una empresa posible',
  DRIVER: 'hay más de un conductor posible',
  ASSET: 'hay más de un equipo posible',
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const MAX_RESULTS = 8

/** El buscador entre quienes DEBEN el documento: el mismo universo del match,
 *  así que alguien al día no aparece (y no se le puede pisar un documento
 *  vigente desde aquí). */
function OwerPicker({ fileName, owers, loading, failed, onPick, onCancel }: {
  fileName: string
  owers: PendingComplianceRow[]
  loading: boolean
  failed: boolean
  onPick: (o: PendingComplianceRow) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const found = owers.filter(o => fold(`${o.subject_name ?? ''} ${o.carrier_name}`).includes(fold(q.trim())))
  return (
    <div className="mt-1.5 w-full rounded-md border border-border bg-white p-2">
      <div className="flex items-center gap-2">
        <input
          type="search" autoFocus value={q} onChange={e => setQ(e.target.value)}
          aria-label={`Buscar a quién va ${fileName}`}
          placeholder={loading ? 'Cargando quienes lo deben…' : `Buscar por nombre o empresa entre ${n(owers.length, 'que lo debe', 'que lo deben')}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-dato"
        />
        <button type="button" onClick={onCancel} className="text-etiqueta font-semibold text-accion hover:underline">
          Cancelar
        </button>
      </div>
      {failed && <p className="mt-1 text-etiqueta text-status-incidente">No se pudo cargar quienes deben el documento.</p>}
      {!loading && !failed && (
        <ul className="mt-1 max-h-56 overflow-y-auto">
          {found.slice(0, MAX_RESULTS).map(o => (
            <li key={o.id}>
              <button type="button" onClick={() => onPick(o)}
                      className="w-full rounded px-2 py-1 text-left text-dato text-text-primary hover:bg-bg-main">
                {o.subject_name ?? o.carrier_name}
                {o.subject_name && <span className="text-informativo"> · {o.carrier_name}</span>}
              </button>
            </li>
          ))}
          {found.length > MAX_RESULTS && (
            <li className="px-2 py-1 text-etiqueta text-informativo">
              {`${found.length - MAX_RESULTS} más; escribe para acotar.`}
            </li>
          )}
          {found.length === 0 && (
            <li className="px-2 py-1 text-etiqueta text-informativo">
              Nadie que lo deba coincide. Si ya está al día, no aparece aquí: quita el archivo y súbelo en Sin clasificar.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** La carga en lote sobre un documento (spec 2026-10-11 §6): soltar → revisar
 *  a quién va cada archivo → completar lo que pide la regla → guardar los
 *  listos. Nada se sube hasta "Guardar". */
export function BulkUploadReview({ requirement, done = false }: {
  requirement: PendingSummaryRow
  /** Nadie debe ya el documento: sin lote abierto no se ofrece soltar más. */
  done?: boolean
}) {
  const lote = usePendingBulkUpload(requirement)
  const input = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const requirementCode = requirement.requirement_code ?? undefined
  // La misma clave que la lista del panel en "Todos": si ya se pidió, sale de
  // la caché. Solo se pide cuando hay un lote que revisar.
  const owers = useQuery({
    queryKey: clavesCertificacion.colaPendientes('pending', requirementCode, undefined),
    queryFn: () => complianceApi.listPending({ state: 'pending', requirementCode, limit: 500 }),
    enabled: lote.items.length > 0,
  })
  const owerRows = owers.data?.rows ?? []
  const locked = lote.saving

  if (!lote.items.length) {
    if (done) return null
    return (
      <div className="mb-3">
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); void lote.receive(Array.from(e.dataTransfer.files)) }}
          className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-bg-main px-3 py-2 text-etiqueta text-informativo"
        >
          {lote.matching
            ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
            : <Upload size={14} aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            {lote.matching
              ? 'Revisando a quién va cada archivo…'
              : `Arrastra varios ${requirement.label} aquí para ver a quién corresponde cada uno antes de guardar.`}
          </span>
          <button type="button" disabled={lote.matching} onClick={() => input.current?.click()}
                  className="font-semibold text-accion hover:underline disabled:opacity-50">
            Elegir archivos
          </button>
          <input ref={input} type="file" multiple className="sr-only" aria-label={`Elegir varios ${requirement.label}`}
                 onChange={e => { void lote.receive(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>
        {lote.matchError && (
          <div role="alert" className="mt-1 flex items-center gap-2 text-etiqueta text-status-incidente">
            <AlertTriangle size={12} aria-hidden="true" />
            {lote.matchError}
            <button type="button" onClick={lote.retryMatch} className="font-semibold text-accion hover:underline">
              Reintentar
            </button>
          </div>
        )}
      </div>
    )
  }

  const byGroup = {
    choose: lote.rows.filter(r => r.group === 'choose'),
    unassigned: lote.rows.filter(r => r.group === 'unassigned'),
    assigned: lote.rows.filter(r => r.group === 'assigned'),
  }
  const unresolved = lote.rows.filter(r => r.item.status === 'pending' && !r.ready).length
  const dateLabel = lote.needs === 'emision' ? 'Emitido el' : lote.needs === 'vencimiento' ? 'Vence el' : null
  const percent = lote.progress ? Math.round((lote.progress.done / lote.progress.total) * 100) : 0
  const anySaved = lote.items.some(i => i.status === 'saved')

  function pick(index: number, o: PendingComplianceRow) {
    lote.choose(index, o.id, { label: o.subject_name ?? o.carrier_name, carrier: o.carrier_name })
    setPicking(null)
  }

  /** "A quién va": lo asignado con su razón, o cómo resolverlo. */
  function target(row: BulkRow): ReactNode {
    const { item, index } = row
    const name = item.file.name
    const who = item.label && (
      <span className="min-w-0">
        <span className="text-text-primary">{item.label}</span>
        {item.carrier && item.carrier !== item.label && <span className="text-informativo"> · {item.carrier}</span>}
      </span>
    )
    if (row.group === 'assigned') {
      const reason = reasonOf(row)
      return <span className="flex flex-wrap items-center gap-1.5">{who}{reason && <StatusChip tone={reason.tone}>{reason.text}</StatusChip>}</span>
    }
    const searchButton = (
      <button type="button" disabled={locked} onClick={() => setPicking(index)} aria-label={`Elegir a quién va ${name}`}
              className="rounded-md border border-warning/50 bg-white px-2 py-1 text-left text-dato text-informativo">
        {owers.isSuccess ? `Buscar entre ${n(owerRows.length, 'que lo debe', 'que lo deben')}…` : 'Buscar entre quienes lo deben…'}
      </button>
    )
    // Choque (regla P23): el que baja elige entre todos los que lo deben, no
    // en un desplegable con el único registro que ya ocupa el otro.
    if (row.collision === 'outranked') {
      return (
        <span className="flex flex-col items-start gap-1">
          <span className="text-etiqueta text-warning">{`Otro archivo ya va a ${row.collisionLabel ?? 'ese registro'}`}</span>
          {searchButton}
        </span>
      )
    }
    if (row.collision === 'tie') {
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {who ?? (row.collisionLabel && <span className="text-text-primary">{row.collisionLabel}</span>)}
          <span className="text-etiqueta text-warning">otro archivo del lote va al mismo; cambia uno o quítalo</span>
          {!item.recordId && searchButton}
        </span>
      )
    }
    if (row.group === 'choose' && item.match.candidates.length) {
      return (
        <select
          aria-label={`A quién va ${name}`} value="" disabled={locked}
          onChange={e => {
            const v = e.target.value
            if (v === '__search') { setPicking(index); return }
            const c = item.match.candidates.find(x => x.record_id === v)
            if (c) lote.choose(index, c.record_id, { label: c.subject_label, carrier: c.carrier_name })
          }}
          className="max-w-full rounded-md border border-warning/50 bg-white px-2 py-1 text-dato"
        >
          <option value="">{`Elige: ${item.match.candidates.map(c => c.subject_label).join(' / ')}`}</option>
          {item.match.candidates.map(c => <option key={c.record_id} value={c.record_id}>{c.subject_label}</option>)}
          <option value="__search">Buscar entre todos los que lo deben…</option>
        </select>
      )
    }
    return searchButton
  }

  function status(row: BulkRow): ReactNode {
    const { item, index } = row
    if (item.status === 'saving') {
      return <span className="inline-flex items-center gap-1 text-etiqueta text-informativo"><Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />Guardando…</span>
    }
    if (item.status === 'saved') {
      return <span className="inline-flex items-center gap-1 text-etiqueta font-semibold text-resuelto"><Check size={12} aria-hidden="true" />Guardado</span>
    }
    const actions = (
      <>
        {(row.group === 'assigned' || (row.collision && item.recordId)) && (
          <button type="button" disabled={locked} onClick={() => setPicking(index)} aria-label={`Cambiar a quién va ${item.file.name}`}
                  className="text-etiqueta font-semibold text-accion hover:underline disabled:opacity-50">
            Cambiar
          </button>
        )}
        <button type="button" disabled={locked} onClick={() => { setPicking(null); lote.remove(index) }}
                aria-label={`Quitar ${item.file.name}`}
                className="text-etiqueta font-semibold text-accion hover:underline disabled:opacity-50">
          Quitar
        </button>
      </>
    )
    if (item.status === 'error') {
      return (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <StatusChip tone="urgent">{`No se guardó: ${item.error}`}</StatusChip>
          <label className="cursor-pointer text-etiqueta font-semibold text-accion hover:underline">
            Elegir otro
            <input type="file" className="sr-only" aria-label={`Elegir otro archivo en lugar de ${item.file.name}`}
                   disabled={locked}
                   onChange={e => { const f = e.target.files?.[0]; if (f) lote.replaceFile(index, f); e.target.value = '' }} />
          </label>
          {actions}
        </span>
      )
    }
    return <span className="flex items-center justify-end gap-3">{actions}</span>
  }

  // "Hay más de una empresa posible" solo es cierto si nadie bajó por un choque.
  const collided = byGroup.choose.filter(r => r.collision).length
  const chooseHint = collided === 0 ? AMBIGUOUS[requirement.target_entity ?? 'CARRIER']
    : collided === byGroup.choose.length ? 'hay archivos que van al mismo destino'
    : 'elige a quién va cada uno'
  const groups = [
    { key: 'choose', title: 'Por elegir', hint: chooseHint, rows: byGroup.choose },
    { key: 'unassigned', title: 'Sin asignar',
      hint: 'el nombre no permite saber a quién va. Busca entre quienes lo deben; si ya está al día no aparece: quítalo y súbelo en Sin clasificar',
      rows: byGroup.unassigned },
    { key: 'assigned', title: 'Asignados', hint: `${byGroup.assigned.length} · revisa si quieres`, rows: byGroup.assigned },
  ].filter(g => g.rows.length)

  const saveLabel = lote.ready === 0 ? 'Guardar · nada listo todavía'
    : lote.ready === 1 ? 'Guardar 1 listo' : `Guardar los ${lote.ready} listos`

  return (
    <section aria-label="Carga en lote" className="mb-3 rounded-md border border-border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lectura font-semibold text-text-primary">
          {n(lote.items.length, `archivo de ${requirement.label}`, `archivos de ${requirement.label}`)}
        </span>
        {byGroup.assigned.length > 0 && <StatusChip tone="resolved">{n(byGroup.assigned.length, 'asignado', 'asignados')}</StatusChip>}
        {byGroup.choose.length > 0 && <StatusChip tone="warning">{`${byGroup.choose.length} por elegir`}</StatusChip>}
        {byGroup.unassigned.length > 0 && <StatusChip tone="urgent">{`${byGroup.unassigned.length} sin asignar`}</StatusChip>}
        <span className="text-etiqueta text-informativo md:ml-auto">Nada se guarda hasta que confirmes</span>
      </div>

      {lote.needs === 'periodo' && (
        <div className="my-2 flex flex-wrap items-center gap-3 rounded-md bg-bg-main px-3 py-2 text-dato">
          <label className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">Para todo el lote:</span> período
            <input type="month" value={lote.batchPeriod} disabled={locked}
                   onChange={e => lote.setBatchPeriod(e.target.value)} aria-label="Período para todo el lote"
                   className="rounded-md border border-border bg-white px-2 py-1" />
          </label>
          <span className="text-etiqueta text-informativo">
            {lote.batchPeriod
              ? 'Lo propone la regla. Cámbialo si el lote es de otro mes.'
              : 'La regla no define el período: indícalo para poder guardar.'}
          </span>
        </div>
      )}

      <div className="mt-2 overflow-hidden rounded-md border border-border">
        <div aria-hidden="true"
             className="hidden items-center gap-3 border-b border-border bg-bg-main px-3 py-1.5 text-etiqueta font-semibold text-informativo md:flex">
          <span className="w-1/3">Archivo</span>
          <span className="flex-1">Va a</span>
          {dateLabel && <span className="w-36">{dateLabel}</span>}
          <span className="w-40" />
        </div>
        {groups.map(g => (
          <div key={g.key} data-group={g.key}>
            <h3 className="border-b border-border bg-bg-main/60 px-3 py-1.5 text-dato font-semibold text-text-primary">
              {g.title} <span className="font-normal text-informativo">· {g.hint}</span>
            </h3>
            <ul>
              {g.rows.map(row => (
                <li key={row.index} className="border-b border-border px-3 py-2 text-dato last:border-b-0">
                  <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
                    <span className="min-w-0 truncate text-text-primary md:w-1/3">{row.item.file.name}</span>
                    <span className="min-w-0 md:flex-1">{target(row)}</span>
                    {dateLabel && (
                      <span className="md:w-36">
                        <input type="date" value={row.item.date} disabled={locked || row.item.status === 'saved'}
                               aria-label={`${dateLabel} · ${row.item.file.name}`}
                               onChange={e => lote.setRowDate(row.index, e.target.value)}
                               className={`rounded-md border bg-white px-2 py-1 ${
                                 lote.dateRequired && !row.item.date && row.item.status !== 'saved'
                                   ? 'border-status-incidente/45 text-status-incidente' : 'border-border'}`} />
                      </span>
                    )}
                    <span className="md:w-40 md:text-right">{status(row)}</span>
                  </div>
                  {picking === row.index && (
                    <OwerPicker
                      fileName={row.item.file.name}
                      owers={owerRows}
                      loading={owers.isPending}
                      failed={owers.isError}
                      onPick={o => pick(row.index, o)}
                      onCancel={() => setPicking(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {lote.progress && (
        <div className="mt-3">
          <span role="status" className="text-dato font-semibold text-text-primary">
            {`Guardando ${lote.progress.done} de ${lote.progress.total}…`}
          </span>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-main">
            <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-etiqueta text-informativo">
            Si se cierra la pestaña ahora, lo ya guardado queda guardado; lo demás no se sube.
          </p>
        </div>
      )}

      {lote.result && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2">
          <StatusChip tone="resolved">{n(lote.result.saved, 'guardado', 'guardados')}</StatusChip>
          {lote.result.errors > 0 && <StatusChip tone="urgent">{`${lote.result.errors} con error`}</StatusChip>}
          {lote.result.unresolved > 0 && <StatusChip tone="warning">{`${lote.result.unresolved} por resolver`}</StatusChip>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-3">
        <button type="button" disabled={!lote.ready || locked} onClick={() => void lote.save()}
                className="rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
          {saveLabel}
        </button>
        <button type="button" disabled={locked} onClick={() => { setPicking(null); lote.reset() }}
                className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main disabled:opacity-50">
          {anySaved ? 'Cerrar el lote' : 'Cancelar'}
        </button>
        {unresolved > 0 && !locked && (
          <span className="text-etiqueta text-informativo">
            {unresolved === 1
              ? 'El que falta resolver no se guarda; puedes completarlo y guardarlo después.'
              : `Los ${unresolved} por resolver no se guardan; puedes completarlos y guardarlos después.`}
          </span>
        )}
      </div>
    </section>
  )
}
