'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  X, Upload, Download, Loader2, CheckCircle2, AlertTriangle,
  FileText, XCircle, ArrowLeft, ArrowRight,
} from 'lucide-react'
import type { TripsMeta, CSVColumnDef, TripCreatePayload } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { parseCSV, looksMojibake, normalizeDate, parseStopsColumn } from '@/lib/utils/csv'

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
  const panelRef                    = useRef<HTMLDivElement>(null)

  const columns = meta?.csv_columns ?? []
  const validStatuses = new Set((meta?.statuses ?? []).map(s => s.id))

  const reset = useCallback(() => {
    setStep('upload'); setParsed([]); setResult(null); setImporting(false)
    setIsDragging(false); setFileErr(null)
  }, [])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  // Semántica de diálogo: Escape cierra, foco inicial y retorno
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, handleClose])

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
      setResult({ created: res.created, rowErrors: [] })
      setStep('result')
      onImported(res.created)
    } catch (e) {
      // El backend devuelve errores estructurados por fila: {message, errors: [{row, error}]}
      const detail = e instanceof ApiError ? e.detail : null
      const structured = detail && typeof detail === 'object' && 'errors' in detail
        ? detail as { message?: string; errors: { row: number; error: string }[] }
        : null
      setResult({
        created: 0,
        rowErrors: structured?.errors ?? [],
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-backdrop-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Carga masiva de viajes"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] focus:outline-none animate-modal-in"
      >

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-slate-800">Carga Masiva de Viajes</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'upload'  && 'Sube un archivo CSV con los viajes a importar'}
              {step === 'preview' && `${parsed.length} filas detectadas`}
              {step === 'result'  && (result && result.created > 0 ? 'Importación completada' : 'Importación fallida')}
            </p>
          </div>
          <button onClick={handleClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex shrink-0 border-b border-border/50 bg-gray-50/50">
          {(['upload', 'preview', 'result'] as Step[]).map((s, i) => (
            <div key={s} className={`flex-1 py-2 text-center text-[11px] font-semibold transition-colors ${
              step === s ? 'text-accent border-b-2 border-accent bg-white' : 'text-gray-400'
            }`}>
              {i + 1}. {s === 'upload' ? 'Subir' : s === 'preview' ? 'Previsualizar' : 'Resultado'}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6">

          {/* ── Step: upload ── */}
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
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  isDragging
                    ? 'border-accent bg-accent/5 scale-[1.01]'
                    : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50/60'
                }`}
              >
                <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-accent' : 'text-gray-300'}`} />
                <p className="text-sm font-semibold text-gray-600">Arrastra tu CSV aquí</p>
                <p className="text-xs text-gray-400 mt-1">o haz clic para seleccionar</p>
                <p className="text-[10px] text-gray-300 mt-3">Acepta separador ; o , (Excel es-CL compatible)</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} aria-label="Archivo CSV" />

              {fileErr && (
                <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <XCircle size={13} className="shrink-0 mt-0.5" />
                  {fileErr}
                </p>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                <FileText size={14} className="text-gray-400 shrink-0" />
                <p className="text-xs text-gray-500 flex-1">
                  ¿No tienes el formato correcto?
                </p>
                <button
                  onClick={downloadTemplate}
                  disabled={columns.length === 0}
                  className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
                >
                  <Download size={13} />
                  Descargar plantilla
                </button>
              </div>

              {columns.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Columnas esperadas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {columns.map(c => (
                      <span key={c.csv_key} className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        c.required
                          ? 'bg-accent/10 text-accent border-accent/20 font-semibold'
                          : 'bg-white text-gray-500 border-gray-200'
                      }`}>
                        {c.csv_key}
                        {c.required && ' *'}
                      </span>
                    ))}
                  </div>
                  <p className="text-[9px] text-gray-400 mt-2">* campos requeridos · destinos: Local 1@2026-05-29 09:00|Local 2</p>
                </div>
              )}
            </div>
          )}

          {/* ── Step: preview ── */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Summary chips */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-3 py-1.5 rounded-full">
                  <CheckCircle2 size={13} /> {validRows.length} viaje{validRows.length !== 1 ? 's' : ''} válido{validRows.length !== 1 ? 's' : ''}
                </span>
                {invalidRows.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-full">
                    <AlertTriangle size={13} /> {invalidRows.length} fila{invalidRows.length !== 1 ? 's' : ''} con error
                  </span>
                )}
              </div>

              {/* Preview table */}
              {validRows.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                    Vista previa (primeras {Math.min(5, validRows.length)} filas)
                  </p>
                  <div className="overflow-x-auto border border-border rounded-xl">
                    <table className="text-xs w-full min-w-[560px]">
                      <thead>
                        <tr className="bg-slate-800 text-[9px] font-bold text-slate-300 uppercase tracking-wide">
                          {['Fecha', 'TMS origen', 'ID origen', 'Patente', 'Conductor', 'Cliente', 'Estado', 'Destinos'].map(h => (
                            <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {validRows.slice(0, 5).map(r => (
                          <tr key={r.index} className="hover:bg-gray-50/40">
                            <td className="px-3 py-2 text-slate-700">{r.payload!.planning_date}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.origin_tms ?? '—'}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-400">{r.payload!.source_system_trip_id ?? '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-700">{r.payload!.tractor_plate ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-700">{r.payload!.driver_name ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.client_name ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.current_status ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.stops?.length ? `${r.payload!.stops.length} parada${r.payload!.stops.length !== 1 ? 's' : ''}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {validRows.length > 5 && (
                    <p className="text-[10px] text-gray-400 mt-1.5 pl-1">
                      + {validRows.length - 5} filas más no mostradas
                    </p>
                  )}
                </div>
              )}

              {/* Errors */}
              {invalidRows.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-2">
                    Filas con errores (serán omitidas)
                  </p>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {invalidRows.map(r => (
                      <div key={r.index} className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                        <AlertTriangle size={11} className="text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[10px] font-semibold text-amber-700">Fila {r.index}</p>
                          {r.errors.map((e, i) => (
                            <p key={i} className="text-[10px] text-amber-600">{e}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step: result — ícono según el resultado real ── */}
          {step === 'result' && result && (
            <div className="py-6 space-y-4">
              <div className="text-center space-y-3">
                {result.created > 0
                  ? <CheckCircle2 size={48} className="mx-auto text-green-500" />
                  : <XCircle size={48} className="mx-auto text-red-400" />}
                <p className="text-lg font-bold text-slate-800">
                  {result.created > 0
                    ? `${result.created} viaje${result.created !== 1 ? 's' : ''} importado${result.created !== 1 ? 's' : ''}`
                    : 'No se importó ningún viaje'}
                </p>
                <p className="text-sm text-gray-500">
                  {result.created > 0
                    ? 'Los viajes ya están disponibles en el Diario.'
                    : result.message ?? 'Revisa los errores e intenta nuevamente.'}
                </p>
              </div>

              {result.rowErrors.length > 0 && (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {result.rowErrors.map((re, i) => (
                    <div key={i} className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-semibold text-red-700">Fila {re.row}</p>
                        <p className="text-[10px] text-red-600">{re.error}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3">
          {step === 'upload' && (
            <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          )}

          {step === 'preview' && (
            <>
              <button onClick={() => { setStep('upload'); setFileErr(null) }} className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
                <ArrowLeft size={13} />
                Volver
              </button>
              <button
                onClick={handleImport}
                disabled={importing || validRows.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                Importar {validRows.length} viaje{validRows.length !== 1 ? 's' : ''}
              </button>
            </>
          )}

          {step === 'result' && (
            <>
              {result && result.created === 0 && (
                <button onClick={() => setStep('preview')} className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
                  <ArrowLeft size={13} />
                  Volver
                </button>
              )}
              <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors text-center">
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
