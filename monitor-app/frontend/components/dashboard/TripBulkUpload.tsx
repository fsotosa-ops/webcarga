'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Upload, Download, Loader2, CheckCircle2, AlertTriangle,
  FileText, XCircle, ArrowLeft, ArrowRight,
} from 'lucide-react'
import type { AssignmentWarning, TripsMeta, CSVColumnDef, TripCreatePayload } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { parseCSV, looksMojibake, normalizeDate, parseStopsColumn } from '@/lib/utils/csv'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Button } from '@/components/ui/Button'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'

interface Props {
  open:      boolean
  onClose:   () => void
  onImported:(count: number) => void
  meta?:     TripsMeta | null
}

type Step = 'upload' | 'preview' | 'result'

interface ParsedRow {
  index:   number
  payload: TripCreatePayload | null
  errors:  string[]
}

interface ImportResult {
  created: number
  rowErrors: { row: number; error: string }[]
  /** Avisos de las filas que se importaron igual (empresa no habilitada, D1 §7.1). */
  warnings: AssignmentWarning[]
  message?: string
}

export function buildPayload(
  raw: Record<string, string>,
  columns: CSVColumnDef[],
  validStatuses: Set<string>,
): { payload: TripCreatePayload | null; errors: string[] } {
  const errors: string[] = []
  const payload: Partial<TripCreatePayload> & Record<string, unknown> = {}

  for (const col of columns) {
    const val = (raw[col.csv_key] ?? '').trim()
    if (col.required && !val) {
      errors.push(`Campo requerido vacío: "${col.label}"`)
      continue
    }
    if (!val) continue

    if (col.type === 'date') {
      const normalized = normalizeDate(val)
      if (!normalized) { errors.push(`Fecha inválida en "${col.label}": "${val}"`); continue }
      payload[col.field] = normalized
    } else if (col.type === 'status') {
      if (validStatuses.size > 0 && !validStatuses.has(val)) {
        errors.push(`Estado desconocido: "${val}"`)
        continue
      }
      payload[col.field] = val
    } else if (col.type === 'stops') {
      payload[col.field] = parseStopsColumn(val)
    } else {
      payload[col.field] = col.field.includes('plate') ? val.toUpperCase() : val
    }
  }

  if (!payload.planning_date) errors.push('Fecha de planificación requerida')

  return {
    payload: errors.length === 0 ? payload as TripCreatePayload : null,
    errors,
  }
}

function generateTemplate(columns: CSVColumnDef[]): string {
  // ';' — delimitador nativo de Excel es-CL (el parser autodetecta ambos)
  const header  = columns.map(c => c.csv_key).join(';')
  const example = columns.map(c => c.example).join(';')
  return `${header}\n${example}\n`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TripBulkUpload({ open, onClose, onImported, meta }: Props) {
  const [step, setStep]             = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [parsed, setParsed]         = useState<ParsedRow[]>([])
  const [fileErr, setFileErr]       = useState<string | null>(null)
  const [importing, setImporting]   = useState(false)
  const [result, setResult]         = useState<ImportResult | null>(null)
  const fileRef                     = useRef<HTMLInputElement>(null)

  const columns = meta?.csv_columns ?? []
  const validStatuses = new Set((meta?.statuses ?? []).map(s => s.id))

  const reset = useCallback(() => {
    setStep('upload'); setParsed([]); setResult(null); setImporting(false)
    setIsDragging(false); setFileErr(null)
  }, [])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  function parseText(text: string) {
    const { rows, headers } = parseCSV(text)
    if (headers.length < 2) {
      setFileErr('No se pudo leer el archivo: se esperaba un CSV con encabezados (revisa el formato con la plantilla)')
      return
    }
    const parsedRows: ParsedRow[] = rows.map((cells, i) => {
      const raw = Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? '']))
      const { payload, errors } = buildPayload(raw, columns, validStatuses)
      return { index: i + 2, payload, errors }  // +2: 1-indexed + header
    })
    if (parsedRows.length === 0) {
      setFileErr('El archivo no tiene filas de datos')
      return
    }
    setParsed(parsedRows)
    setStep('preview')
  }

  function processFile(file: File) {
    setFileErr(null)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileErr(`"${file.name}" no es un CSV — exporta la planilla como CSV o usa la plantilla`)
      return
    }
    const readAs = (encoding: string, onDone: (text: string) => void) => {
      const reader = new FileReader()
      reader.onload = e => onDone(e.target?.result as string)
      reader.readAsText(file, encoding)
    }
    readAs('utf-8', text => {
      // Excel/ANSI (Latin-1) leído como UTF-8 produce U+FFFD — reintentar
      if (looksMojibake(text)) readAs('ISO-8859-1', parseText)
      else parseText(text)
    })
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function downloadTemplate() {
    const csv  = generateTemplate(columns)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'plantilla_viajes.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport() {
    const valid = parsed.filter(r => r.payload !== null).map(r => r.payload!)
    if (!valid.length) return
    setImporting(true)
    try {
      const res = await tripsApi.bulkCreate(valid)
      setResult({ created: res.created, rowErrors: [], warnings: res.warnings ?? [] })
      setStep('result')
      onImported(res.created)
    } catch (e) {
      // El backend devuelve errores estructurados por fila:
      // {code, message, errors: [{row, code, error}]} (409 de la guarda, D1 §7.1).
      const detail = e instanceof ApiError ? e.detail : null
      const structured = detail && typeof detail === 'object' && 'errors' in detail
        ? detail as { message?: string; errors: { row: number; code?: string; error: string }[] }
        : null
      setResult({
        created: 0,
        rowErrors: structured?.errors ?? [],
        warnings: [],
        message: structured?.message ?? (e instanceof Error ? e.message : 'Error al importar'),
      })
      setStep('result')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  const validRows   = parsed.filter(r => r.payload !== null)
  const invalidRows = parsed.filter(r => r.errors.length > 0)

  const pluralize = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
  const description =
    step === 'upload' ? 'Sube un archivo CSV con los viajes a importar'
    : step === 'preview' ? pluralize(parsed.length, 'fila detectada', 'filas detectadas')
    : result && result.created > 0 ? 'Importación completada' : 'Importación fallida'
  const SUBHEADING = 'mb-2 text-etiqueta font-semibold text-informativo'

  return (
    <PanelLateral
      placement="center"
      ancho="amplio"
      titulo="Carga masiva de viajes"
      description={description}
      onCerrar={handleClose}
      pie={
        <div className="flex items-center gap-3">
          {step === 'upload' && <Button onClick={handleClose}>Cancelar</Button>}

          {step === 'preview' && (
            <>
              <Button onClick={() => { setStep('upload'); setFileErr(null) }}>
                <ArrowLeft size={13} aria-hidden="true" />
                Volver
              </Button>
              <Button variant="primary" className="flex-1" onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} aria-hidden="true" />}
                Importar {pluralize(validRows.length, 'viaje', 'viajes')}
              </Button>
            </>
          )}

          {step === 'result' && (
            <>
              {result && result.created === 0 && (
                <Button onClick={() => setStep('preview')}>
                  <ArrowLeft size={13} aria-hidden="true" />
                  Volver
                </Button>
              )}
              <Button variant="primary" className="flex-1" onClick={handleClose}>Cerrar</Button>
            </>
          )}
        </div>
      }
    >
      {/* Los pasos */}
      <ol className="-mx-4 -mt-4 mb-4 flex border-b border-border bg-bg-main">
        {(['upload', 'preview', 'result'] as Step[]).map((s, i) => (
          <li key={s} aria-current={step === s ? 'step' : undefined}
            className={`flex-1 py-2 text-center text-etiqueta font-semibold transition-colors ${
              step === s ? 'border-b-2 border-accent bg-white text-accion' : 'text-informativo'
            }`}>
            {i + 1}. {s === 'upload' ? 'Subir' : s === 'preview' ? 'Previsualizar' : 'Resultado'}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <div className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Subir archivo CSV"
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              isDragging ? 'scale-[1.01] border-accent bg-accent/5' : 'border-border hover:border-accent/50 hover:bg-bg-main'
            }`}
          >
            <Upload size={32} aria-hidden="true" className={`mx-auto mb-3 ${isDragging ? 'text-accent' : 'text-informativo'}`} />
            <p className="text-lectura font-semibold text-text-primary">Arrastra tu CSV aquí</p>
            <p className="mt-1 text-dato text-informativo">o haz clic para seleccionar</p>
            <p className="mt-3 text-etiqueta text-informativo">Acepta separador ; o , (compatible con Excel en español)</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} aria-label="Archivo CSV" />

          {fileErr && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">
              <XCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
              {fileErr}
            </p>
          )}

          <div className="flex items-center gap-2 border-t border-border pt-3">
            <FileText size={14} aria-hidden="true" className="shrink-0 text-informativo" />
            <p className="flex-1 text-dato text-informativo">¿No tienes el formato correcto?</p>
            <Button variant="link" onClick={downloadTemplate} disabled={columns.length === 0}>
              <Download size={13} aria-hidden="true" />
              Descargar plantilla
            </Button>
          </div>

          {columns.length > 0 && (
            <div className="rounded-md bg-bg-main p-3">
              <p className={SUBHEADING}>Columnas esperadas</p>
              <div className="flex flex-wrap gap-1.5">
                {columns.map(c => (
                  <span key={c.csv_key} className={`rounded-full border px-2 py-0.5 text-etiqueta ${
                    c.required ? 'border-accent/20 bg-accent/10 font-semibold text-accion' : 'border-border bg-white text-informativo'
                  }`}>
                    {c.csv_key}
                    {c.required && ' *'}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-etiqueta text-informativo">* campos requeridos · destinos: Local 1@2026-05-29 09:00|Local 2</p>
            </div>
          )}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full border border-resuelto/20 bg-resuelto/5 px-3 py-1.5 text-dato font-semibold text-resuelto">
              <CheckCircle2 size={13} aria-hidden="true" /> {pluralize(validRows.length, 'viaje válido', 'viajes válidos')}
            </span>
            {invalidRows.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning/10 px-3 py-1.5 text-dato font-semibold text-warning">
                <AlertTriangle size={13} aria-hidden="true" /> {pluralize(invalidRows.length, 'fila con error', 'filas con error')}
              </span>
            )}
          </div>

          {validRows.length > 0 && (
            <div>
              <p className={SUBHEADING}>Vista previa (primeras {Math.min(5, validRows.length)} filas)</p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[560px] text-dato">
                  <thead className="border-b border-border bg-bg-main">
                    <tr>
                      {['Fecha', 'TMS origen', 'ID origen', 'Patente', 'Conductor', 'Cliente', 'Estado', 'Destinos'].map(h => (
                        <th key={h} className={`${CABECERA} whitespace-nowrap`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 text-text-primary">
                    {validRows.slice(0, 5).map(r => (
                      <tr key={r.index}>
                        <td className="px-3 py-2">{r.payload!.planning_date}</td>
                        <td className="px-3 py-2 text-informativo">{r.payload!.origin_tms ?? '—'}</td>
                        <td className="px-3 py-2 font-identificador text-informativo">{r.payload!.source_system_trip_id ?? '—'}</td>
                        <td className="px-3 py-2 font-identificador font-semibold">{r.payload!.tractor_plate ?? '—'}</td>
                        <td className="px-3 py-2">{r.payload!.driver_name ?? '—'}</td>
                        <td className="px-3 py-2 text-informativo">{r.payload!.client_name ?? '—'}</td>
                        <td className="px-3 py-2 text-informativo">{r.payload!.current_status ?? '—'}</td>
                        <td className="px-3 py-2 text-informativo">{r.payload!.stops?.length ? pluralize(r.payload!.stops.length, 'parada', 'paradas') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {validRows.length > 5 && (
                <p className="mt-1.5 pl-1 text-etiqueta text-informativo">+ {validRows.length - 5} filas más no mostradas</p>
              )}
            </div>
          )}

          {invalidRows.length > 0 && (
            <div>
              <p className="mb-2 text-etiqueta font-semibold text-warning">Filas con errores (serán omitidas)</p>
              <div className="max-h-36 space-y-1.5 overflow-y-auto">
                {invalidRows.map(r => (
                  <div key={r.index} className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2">
                    <AlertTriangle size={11} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
                    <div>
                      <p className="text-etiqueta font-semibold text-warning">Fila {r.index}</p>
                      {r.errors.map((e, i) => <p key={i} className="text-etiqueta text-warning">{e}</p>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resultado — ícono según el resultado real */}
      {step === 'result' && result && (
        <div className="space-y-4 py-6">
          <div className="space-y-3 text-center">
            {result.created > 0
              ? <CheckCircle2 size={48} aria-hidden="true" className="mx-auto text-resuelto" />
              : <XCircle size={48} aria-hidden="true" className="mx-auto text-status-incidente" />}
            <p className="text-titulo font-bold text-text-primary">
              {result.created > 0 ? pluralize(result.created, 'viaje importado', 'viajes importados') : 'No se importó ningún viaje'}
            </p>
            <p className="text-lectura text-informativo">
              {result.created > 0
                ? 'Los viajes ya están disponibles en el Monitor.'
                : result.message ?? 'Revisa los errores e intenta nuevamente.'}
            </p>
          </div>

          {result.warnings.length > 0 && (
            <div role="status" className="max-h-44 space-y-1.5 overflow-y-auto">
              {result.warnings.map((w, i) => (
                <div key={i} className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2">
                  {w.row != null && <p className="text-etiqueta font-semibold text-warning">Fila {w.row}</p>}
                  <p className="text-etiqueta text-warning">{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {result.rowErrors.length > 0 && (
            <div className="max-h-44 space-y-1.5 overflow-y-auto">
              {result.rowErrors.map((re, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2">
                  <XCircle size={11} aria-hidden="true" className="mt-0.5 shrink-0 text-status-incidente" />
                  <div>
                    <p className="text-etiqueta font-semibold text-status-incidente">Fila {re.row}</p>
                    <p className="text-etiqueta text-status-incidente">{re.error}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PanelLateral>
  )
}
