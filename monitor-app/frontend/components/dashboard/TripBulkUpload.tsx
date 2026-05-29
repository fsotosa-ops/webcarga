'use client'

import { useState, useRef, useCallback } from 'react'
import { X, Upload, Download, Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react'
import type { TripsMeta, CSVColumnDef, TripCreatePayload } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'

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
  raw:     Record<string, string>
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSVText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
  return { headers, rows }
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  // DD/MM/YYYY or DD-MM-YYYY
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  return null
}

function buildPayload(
  raw: Record<string, string>,
  columns: CSVColumnDef[],
): { payload: TripCreatePayload | null; errors: string[] } {
  const errors: string[] = []
  const payload: Partial<TripCreatePayload> = {}

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
      ;(payload as Record<string, string>)[col.field] = normalized
    } else {
      ;(payload as Record<string, string>)[col.field] = col.field.includes('plate') ? val.toUpperCase() : val
    }
  }

  if (!payload.planning_date) errors.push('Fecha de planificación requerida')
  if (!payload.tms_name) payload.tms_name = 'manual'

  return {
    payload: errors.length === 0 ? payload as TripCreatePayload : null,
    errors,
  }
}

function generateTemplate(columns: CSVColumnDef[]): string {
  const header  = columns.map(c => c.csv_key).join(',')
  const example = columns.map(c => c.example).join(',')
  return `${header}\n${example}\n`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TripBulkUpload({ open, onClose, onImported, meta }: Props) {
  const [step, setStep]           = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [parsed, setParsed]       = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<{ created: number } | null>(null)
  const fileRef                   = useRef<HTMLInputElement>(null)

  const columns = meta?.csv_columns ?? []

  const reset = useCallback(() => {
    setStep('upload'); setParsed([]); setResult(null); setImporting(false); setIsDragging(false)
  }, [])

  function handleClose() { reset(); onClose() }

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) return
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { rows } = parseCSVText(text)
      const parsedRows: ParsedRow[] = rows.map((raw, i) => {
        const { payload, errors } = buildPayload(raw, columns)
        return { index: i + 2, payload, errors, raw }  // +2: 1-indexed + skip header
      })
      setParsed(parsedRows)
      setStep('preview')
    }
    reader.readAsText(file, 'utf-8')
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
      setResult({ created: res.created })
      setStep('result')
      onImported(res.created)
    } catch (e) {
      setResult({ created: 0 })
      setStep('result')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  const validRows   = parsed.filter(r => r.payload !== null)
  const invalidRows = parsed.filter(r => r.errors.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-slate-800">Carga Masiva de Viajes</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'upload'  && 'Sube un archivo CSV con los viajes a importar'}
              {step === 'preview' && `${parsed.length} filas detectadas`}
              {step === 'result'  && 'Importación completada'}
            </p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
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
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-accent bg-accent/5 scale-[1.01]'
                    : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50/60'
                }`}
              >
                <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-accent' : 'text-gray-300'}`} />
                <p className="text-sm font-semibold text-gray-600">Arrastra tu CSV aquí</p>
                <p className="text-xs text-gray-400 mt-1">o haz clic para seleccionar</p>
                <p className="text-[10px] text-gray-300 mt-3">Solo archivos .csv</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />

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
                  <p className="text-[9px] text-gray-400 mt-2">* campos requeridos</p>
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
                    <table className="text-xs w-full min-w-[500px]">
                      <thead>
                        <tr className="bg-slate-800 text-[9px] font-bold text-slate-300 uppercase tracking-wide">
                          {['Fecha', 'Fuente', 'ID origen', 'Patente', 'Conductor', 'Cliente', 'Estado'].map(h => (
                            <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {validRows.slice(0, 5).map(r => (
                          <tr key={r.index} className="hover:bg-gray-50/40">
                            <td className="px-3 py-2 text-slate-700">{r.payload!.planning_date}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.tms_name ?? 'manual'}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-400">{r.payload!.source_trip_id ?? '—'}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-700">{r.payload!.tractor_plate ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-700">{r.payload!.driver_name ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.client_name ?? '—'}</td>
                            <td className="px-3 py-2 text-gray-500">{r.payload!.current_status ?? '—'}</td>
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

          {/* ── Step: result ── */}
          {step === 'result' && result && (
            <div className="text-center py-8 space-y-3">
              <CheckCircle2 size={48} className="mx-auto text-green-500" />
              <p className="text-lg font-bold text-slate-800">
                {result.created > 0 ? `${result.created} viaje${result.created !== 1 ? 's' : ''} importado${result.created !== 1 ? 's' : ''}` : 'Sin viajes importados'}
              </p>
              <p className="text-sm text-gray-500">
                {result.created > 0
                  ? 'Los viajes ya están disponibles en el Diario.'
                  : 'Revisa los errores e intenta nuevamente.'}
              </p>
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
              <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
                ← Volver
              </button>
              <button
                onClick={handleImport}
                disabled={importing || validRows.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {importing && <Loader2 size={14} className="animate-spin" />}
                Importar {validRows.length} viaje{validRows.length !== 1 ? 's' : ''} →
              </button>
            </>
          )}

          {step === 'result' && (
            <button onClick={handleClose} className="flex-1 px-4 py-2 text-sm font-semibold bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors text-center">
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
