'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Inbox, Loader2, Upload } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { StatusChip } from '@/components/ui/StatusChip'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { datoQuePide } from '@/lib/compliance'
import type { PendingComplianceRow, PendingSummaryRow } from '@/lib/types'
import { useBulkUpload, type BulkRow } from './useBulkUpload'

/** "1 archivo" / "3 archivos". */
const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`

/** Por qué el servidor lo asignó. Por nombre lleva su confianza: es la única
 *  razón que puede equivocarse. */
function reasonOf(row: BulkRow): { text: string; tone: 'resolved' | 'action' } | null {
  const { item } = row
  if (item.via !== 'match') return null
  if (item.match.reason === 'rut') return { text: 'por RUT', tone: 'resolved' }
  if (item.match.reason === 'plate') return { text: 'por patente', tone: 'resolved' }
  if (item.match.reason === 'declared') return { text: 'por la empresa elegida', tone: 'resolved' }
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

/** El buscador entre quienes DEBEN el documento de esa fila: el mismo universo del
 *  match, así que alguien al día no aparece (y no se le puede pisar un documento
 *  vigente desde aquí). */
function OwerPicker({ fileName, requirementCode, carrierId, onPick, onCancel }: {
  fileName: string
  requirementCode: string
  carrierId?: string | null
  onPick: (o: PendingComplianceRow) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  // La misma clave que la lista del panel de Pendientes en "Todos": si ya se pidió, sale de la caché.
  const owers = useQuery({
    queryKey: clavesCertificacion.colaPendientes('pending', requirementCode, carrierId ?? undefined),
    queryFn: () => complianceApi.listPending({ state: 'pending', requirementCode, carrierId: carrierId ?? undefined, limit: 500 }),
  })
  const rows = owers.data?.rows ?? []
  const found = rows.filter(o => fold(`${o.subject_name ?? ''} ${o.carrier_name}`).includes(fold(q.trim())))
  return (
    <div className="mt-1.5 w-full rounded-md border border-border bg-white p-2">
      <div className="flex items-center gap-2">
        <input
          type="search" autoFocus value={q} onChange={e => setQ(e.target.value)}
          aria-label={`Buscar a quién va ${fileName}`}
          placeholder={owers.isPending ? 'Cargando quienes lo deben…' : `Buscar por nombre o empresa entre ${n(rows.length, 'que lo debe', 'que lo deben')}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-dato"
        />
        <button type="button" onClick={onCancel} className="text-etiqueta font-semibold text-accion hover:underline">
          Cancelar
        </button>
      </div>
      {owers.isError && <p className="mt-1 text-etiqueta text-status-incidente">No se pudo cargar quienes deben el documento.</p>}
      {owers.isSuccess && (
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
              Nadie que lo deba coincide. Si ya está al día, no aparece aquí: al guardar, el archivo queda en Por asignar.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * La revisión de una carga en lote (spec 2026-10-11 §6; Entrega D, 15/10): soltar →
 * revisar a qué registro va cada archivo → completar lo que pide su regla → guardar.
 * Nada se sube hasta "Guardar"; lo que no se resolvió queda en Por asignar con lo
 * que ya se sabía.
 *
 * Es UNA sola forma de subir documentos, con el contexto como prop: el tipo
 * (`requirement`, desde Pendientes), la empresa (`carrierId`, desde su ficha) o nada
 * (desde Por asignar). El disparador también: la zona de arrastre del panel de
 * Pendientes, o un botón (con arrastre sobre toda la página) que abre la revisión en
 * un panel.
 */
export function BulkUploadReview({ requirement, carrierId, done = false, trigger = 'dropzone' }: {
  requirement?: PendingSummaryRow | null
  carrierId?: string | null
  /** Nadie debe ya el documento: sin lote abierto no se ofrece soltar más. */
  done?: boolean
  trigger?: 'dropzone' | 'button'
}) {
  const lote = useBulkUpload({ requirement, carrierId })
  const input = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const qc = useQueryClient()
  const locked = lote.saving
  const fixed = lote.fixed

  // Con botón, soltar archivos en cualquier parte de la página abre la misma revisión:
  // sin esto el navegador navegaba al archivo y sacaba a la persona de la aplicación.
  const { receive } = lote
  const idle = lote.items.length === 0 && !lote.matching
  useEffect(() => {
    if (trigger !== 'button' || !idle) return
    const prevenir = (e: DragEvent) => e.preventDefault()
    const soltar = (e: DragEvent) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (files?.length) void receive(Array.from(files))
    }
    window.addEventListener('dragover', prevenir)
    window.addEventListener('drop', soltar)
    return () => {
      window.removeEventListener('dragover', prevenir)
      window.removeEventListener('drop', soltar)
    }
  }, [trigger, idle, receive])

  // Guardar cambia Pendientes, la ficha y Por asignar.
  const result = lote.result
  useEffect(() => { if (result) void invalidarCertificacion(qc) }, [result, qc])

  const fileInput = (
    <input ref={input} type="file" multiple className="sr-only"
           aria-label={fixed ? `Elegir varios ${fixed.label}` : 'Elegir documentos'}
           onChange={e => { void lote.receive(Array.from(e.target.files ?? [])); e.target.value = '' }} />
  )
  const matchError = lote.matchError && (
    <div role="alert" className="mt-1 flex items-center gap-2 text-etiqueta text-status-incidente">
      <AlertTriangle size={12} aria-hidden="true" />
      {lote.matchError}
      <button type="button" onClick={lote.retryMatch} className="font-semibold text-accion hover:underline">
        Reintentar
      </button>
    </div>
  )

  if (!lote.items.length) {
    if (trigger === 'button') {
      return (
        <span className="inline-flex flex-col items-end">
          <button type="button" disabled={lote.matching} onClick={() => input.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
            {lote.matching ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
            {lote.matching ? 'Revisando…' : 'Subir documentos'}
          </button>
          {fileInput}
          {matchError}
        </span>
      )
    }
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
              : `Arrastra varios ${fixed?.label ?? 'documentos'} aquí para ver a quién corresponde cada uno antes de guardar.`}
          </span>
          <button type="button" disabled={lote.matching} onClick={() => input.current?.click()}
                  className="font-semibold text-accion hover:underline disabled:opacity-50">
            Elegir archivos
          </button>
          {fileInput}
        </div>
        {matchError}
      </div>
    )
  }

  const byGroup = {
    choose: lote.rows.filter(r => r.group === 'choose'),
    unassigned: lote.rows.filter(r => r.group === 'unassigned'),
    assigned: lote.rows.filter(r => r.group === 'assigned'),
  }
  const percent = lote.progress ? Math.round((lote.progress.done / lote.progress.total) * 100) : 0
  const anyDone = lote.items.some(i => i.status === 'saved' || i.status === 'staged')
  const dateLabelOf = (row: BulkRow) => {
    const pide = row.rule?.expiration_policy ? datoQuePide(row.rule.expiration_policy) : null
    if (!pide || pide.dato === 'periodo') return null
    return { label: pide.dato === 'emision' ? 'Emitido el' : 'Vence el', required: pide.obligatorio }
  }
  const anyDate = lote.rows.some(r => dateLabelOf(r))

  function pick(index: number, o: PendingComplianceRow) {
    lote.choose(index, o.id, { label: o.subject_name ?? o.carrier_name, carrier: o.carrier_name, requirementId: o.requirement_id })
    setPicking(null)
  }

  /** "A quién va": lo asignado con su razón, o cómo resolverlo. Sin el tipo fijado,
   *  dice también qué documento es. */
  function target(row: BulkRow): ReactNode {
    const { item, index } = row
    const name = item.file.name
    const type = !fixed && row.rule && <span className="font-semibold text-text-primary">{row.rule.label}</span>
    const who = item.label && (
      <span className="min-w-0">
        <span className="text-text-primary">{item.label}</span>
        {item.carrier && item.carrier !== item.label && <span className="text-informativo"> · {item.carrier}</span>}
      </span>
    )
    if (row.group === 'assigned') {
      const reason = reasonOf(row)
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {type}{type && <span aria-hidden="true">·</span>}{who}
          {reason && <StatusChip tone={reason.tone}>{reason.text}</StatusChip>}
        </span>
      )
    }
    // Buscar a mano solo se ofrece con el tipo conocido (entre quienes lo deben). Sin
    // tipo, lo resuelve Por asignar, que tiene el formulario completo.
    const searchButton = row.rule ? (
      <button type="button" disabled={locked} onClick={() => setPicking(index)} aria-label={`Elegir a quién va ${name}`}
              className="rounded-md border border-warning/50 bg-white px-2 py-1 text-left text-dato text-informativo">
        Buscar entre quienes lo deben…
      </button>
    ) : (
      <span className="inline-flex items-center gap-1 text-etiqueta text-informativo">
        <Inbox size={12} aria-hidden="true" /> queda en Por asignar
      </span>
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
      const typeLabel = (id: string) => (!fixed && lote.rules[id] ? ` (${lote.rules[id].label})` : '')
      return (
        <select
          aria-label={`A quién va ${name}`} value="" disabled={locked}
          onChange={e => {
            const v = e.target.value
            if (v === '__search') { setPicking(index); return }
            const c = item.match.candidates.find(x => x.record_id === v)
            if (c) lote.choose(index, c.record_id, { label: c.subject_label, carrier: c.carrier_name, requirementId: c.requirement_id })
          }}
          className="max-w-full rounded-md border border-warning/50 bg-white px-2 py-1 text-dato"
        >
          <option value="">{`Elige: ${item.match.candidates.map(c => c.subject_label).join(' / ')}`}</option>
          {item.match.candidates.map(c => (
            <option key={c.record_id} value={c.record_id}>{`${c.subject_label}${typeLabel(c.requirement_id)}`}</option>
          ))}
          {row.rule && <option value="__search">Buscar entre todos los que lo deben…</option>}
        </select>
      )
    }
    return <span className="flex flex-wrap items-center gap-1.5">{type}{searchButton}</span>
  }

  function status(row: BulkRow): ReactNode {
    const { item, index } = row
    if (item.status === 'saving') {
      return <span className="inline-flex items-center gap-1 text-etiqueta text-informativo"><Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />Guardando…</span>
    }
    if (item.status === 'saved') {
      return <span className="inline-flex items-center gap-1 text-etiqueta font-semibold text-resuelto"><Check size={12} aria-hidden="true" />Guardado</span>
    }
    if (item.status === 'staged') {
      return <span className="inline-flex items-center gap-1 text-etiqueta font-semibold text-informativo"><Inbox size={12} aria-hidden="true" />En Por asignar</span>
    }
    const actions = (
      <>
        {row.rule && (row.group === 'assigned' || (row.collision && item.recordId)) && (
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
  const chooseHint = collided === byGroup.choose.length && collided > 0 ? 'hay archivos que van al mismo destino'
    : collided > 0 || !fixed ? 'elige a quién va cada uno'
    : AMBIGUOUS[fixed.target_entity ?? 'CARRIER']
  const groups = [
    { key: 'choose', title: 'Por elegir', hint: chooseHint, rows: byGroup.choose },
    { key: 'unassigned', title: 'Sin asignar', hint: 'al guardar quedan en Por asignar, con lo que ya se sabe', rows: byGroup.unassigned },
    { key: 'assigned', title: 'Asignados', hint: `${byGroup.assigned.length} · revisa si quieres`, rows: byGroup.assigned },
  ].filter(g => g.rows.length)

  const saveLabel = [
    lote.ready === 0 ? 'Guardar' : lote.ready === 1 ? 'Guardar 1 listo' : `Guardar los ${lote.ready} listos`,
    lote.toStage === 0 ? null : `${lote.toStage} a Por asignar`,
  ].filter(Boolean).join(' · ')
  const saveText = lote.ready === 0 && lote.toStage === 0 ? 'Guardar · nada listo todavía' : saveLabel
  const title = fixed
    ? n(lote.items.length, `archivo de ${fixed.label}`, `archivos de ${fixed.label}`)
    : `${n(lote.items.length, 'archivo', 'archivos')} · revisa a quién va cada uno`

  const summary = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-lectura font-semibold text-text-primary">{title}</span>
      {byGroup.assigned.length > 0 && <StatusChip tone="resolved">{n(byGroup.assigned.length, 'asignado', 'asignados')}</StatusChip>}
      {byGroup.choose.length > 0 && <StatusChip tone="warning">{`${byGroup.choose.length} por elegir`}</StatusChip>}
      {byGroup.unassigned.length > 0 && <StatusChip tone="urgent">{`${byGroup.unassigned.length} sin asignar`}</StatusChip>}
      <span className="text-etiqueta text-informativo md:ml-auto">Nada se guarda hasta que confirmes</span>
    </div>
  )

  const body = (
    <>
      {lote.periodTypes.map(id => (
        <div key={id} className="my-2 flex flex-wrap items-center gap-3 rounded-md bg-bg-main px-3 py-2 text-dato">
          <label className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{fixed ? 'Para todo el lote:' : `${lote.rules[id].label}:`}</span> período
            <input type="month" value={lote.periods[id] ?? ''} disabled={locked}
                   onChange={e => lote.setPeriod(id, e.target.value)}
                   aria-label={fixed ? 'Período para todo el lote' : `Período de ${lote.rules[id].label}`}
                   className="rounded-md border border-border bg-white px-2 py-1" />
          </label>
          <span className="text-etiqueta text-informativo">
            {lote.periods[id]
              ? 'Lo propone la regla. Cámbialo si el lote es de otro mes.'
              : 'La regla no define el período: indícalo para poder guardar.'}
          </span>
        </div>
      ))}

      <div className="mt-2 overflow-hidden rounded-md border border-border">
        <div aria-hidden="true"
             className="hidden items-center gap-3 border-b border-border bg-bg-main px-3 py-1.5 text-etiqueta font-semibold text-informativo md:flex">
          <span className="w-1/3">Archivo</span>
          <span className="flex-1">Va a</span>
          {anyDate && <span className="w-36">Fecha</span>}
          <span className="w-40" />
        </div>
        {groups.map(g => (
          <div key={g.key} data-group={g.key}>
            <h3 className="border-b border-border bg-bg-main/60 px-3 py-1.5 text-dato font-semibold text-text-primary">
              {g.title} <span className="font-normal text-informativo">· {g.hint}</span>
            </h3>
            <ul>
              {g.rows.map(row => {
                const date = dateLabelOf(row)
                const done = row.item.status === 'saved' || row.item.status === 'staged'
                return (
                  <li key={row.index} className="border-b border-border px-3 py-2 text-dato last:border-b-0">
                    <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-3">
                      <span className="min-w-0 truncate text-text-primary md:w-1/3">{row.item.file.name}</span>
                      <span className="min-w-0 md:flex-1">{target(row)}</span>
                      {anyDate && (
                        <span className="md:w-36">
                          {date && (
                            <input type="date" value={row.item.date} disabled={locked || done}
                                   aria-label={`${date.label} · ${row.item.file.name}`}
                                   onChange={e => lote.setRowDate(row.index, e.target.value)}
                                   className={`rounded-md border bg-white px-2 py-1 ${
                                     date.required && !row.item.date && !done
                                       ? 'border-status-incidente/45 text-status-incidente' : 'border-border'}`} />
                          )}
                        </span>
                      )}
                      <span className="md:w-40 md:text-right">{status(row)}</span>
                    </div>
                    {picking === row.index && row.rule && (
                      <OwerPicker
                        fileName={row.item.file.name}
                        requirementCode={row.rule.requirement_code}
                        carrierId={carrierId}
                        onPick={o => pick(row.index, o)}
                        onCancel={() => setPicking(null)}
                      />
                    )}
                  </li>
                )
              })}
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
          {lote.result.staged > 0 && <StatusChip tone="neutral">{`${lote.result.staged} en Por asignar`}</StatusChip>}
          {lote.result.errors > 0 && <StatusChip tone="urgent">{`${lote.result.errors} con error`}</StatusChip>}
          {lote.result.unresolved > 0 && <StatusChip tone="warning">{`${lote.result.unresolved} por resolver`}</StatusChip>}
        </div>
      )}
    </>
  )

  const actions = (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={(!lote.ready && !lote.toStage) || locked} onClick={() => void lote.save()}
              className="rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
        {saveText}
      </button>
      <button type="button" disabled={locked} onClick={() => { setPicking(null); lote.reset() }}
              className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main disabled:opacity-50">
        {anyDone ? 'Cerrar el lote' : 'Cancelar'}
      </button>
    </div>
  )

  if (trigger === 'button') {
    return (
      <PanelLateral titulo="Subir documentos" ancho="amplio" pie={actions}
                    onCerrar={() => { if (!locked) { setPicking(null); lote.reset() } }}>
        <div className="p-4">{summary}{body}</div>
      </PanelLateral>
    )
  }
  return (
    <section aria-label="Carga en lote" className="mb-3 rounded-md border border-border bg-white p-3">
      {summary}
      {body}
      <div className="pt-3">{actions}</div>
    </section>
  )
}
