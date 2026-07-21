'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, BarChart3, Download, X } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import {
  FIELD_LABELS, GRANULARITY_LABELS, buildPivot, distinctFieldValues, applyFilters,
  type FieldId, type Granularity, type PivotFieldSpec, type PivotFilter,
} from '@/lib/utils/pivot'

const ALL_FIELDS: FieldId[] = ['carrier', 'client', 'status', 'reason', 'date']
const ALL_GRANULARITIES: Granularity[] = ['day', 'week', 'month', 'quarter', 'semester']

type PeriodPreset = 'hoy' | 'semana' | 'mes' | 'trimestre' | 'semestre' | 'custom'
const PERIOD_LABELS: Record<PeriodPreset, string> = {
  hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', trimestre: 'Este trimestre', semestre: 'Este semestre', custom: 'Rango personalizado',
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

/** Rango [desde, hasta] para un preset de período — todo en huso horario de
 *  Chile, mismo criterio que todayISO() ya usado en el Diario. */
function presetRange(preset: PeriodPreset, today: string): { desde: string; hasta: string } {
  const [y, m, d] = today.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (preset === 'hoy') return { desde: today, hasta: today }
  if (preset === 'semana') {
    const dow = (date.getDay() + 6) % 7
    const start = new Date(date); start.setDate(date.getDate() - dow)
    const end = new Date(start); end.setDate(start.getDate() + 6)
    return { desde: fmt(start), hasta: fmt(end) }
  }
  if (preset === 'mes') {
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 0)
    return { desde: fmt(start), hasta: fmt(end) }
  }
  if (preset === 'trimestre') {
    const q = Math.floor((m - 1) / 3)
    const start = new Date(y, q * 3, 1)
    const end = new Date(y, q * 3 + 3, 0)
    return { desde: fmt(start), hasta: fmt(end) }
  }
  // semestre
  const half = m <= 6 ? 0 : 1
  const start = new Date(y, half * 6, 1)
  const end = new Date(y, half * 6 + 6, 0)
  return { desde: fmt(start), hasta: fmt(end) }
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Selector de campos para un "cajón" del pivot (Filas/Columnas) — chips +
 *  "+ Agregar campo", con selector de granularidad inline para "Fecha". */
function FieldBucket({ label, specs, onChange }: { label: string; specs: PivotFieldSpec[]; onChange: (specs: PivotFieldSpec[]) => void }) {
  const available = ALL_FIELDS.filter(f => !specs.some(s => s.field === f))
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {specs.map((spec, i) => (
          <span key={spec.field} className="flex items-center gap-1 bg-accent/10 text-accent text-[11px] font-semibold rounded-full pl-2.5 pr-1 py-1">
            {FIELD_LABELS[spec.field]}
            {spec.field === 'date' && (
              <select
                value={spec.granularity ?? 'day'}
                onChange={e => {
                  const next = [...specs]
                  next[i] = { ...spec, granularity: e.target.value as Granularity }
                  onChange(next)
                }}
                className="ml-1 text-[10px] bg-white border border-accent/30 rounded-full px-1.5 py-0.5"
              >
                {ALL_GRANULARITIES.map(g => <option key={g} value={g}>{GRANULARITY_LABELS[g]}</option>)}
              </select>
            )}
            <button type="button" onClick={() => onChange(specs.filter(s => s.field !== spec.field))} className="hover:text-accent/60">
              <X size={11} />
            </button>
          </span>
        ))}
        {available.length > 0 && (
          <select
            value=""
            onChange={e => { if (e.target.value) onChange([...specs, { field: e.target.value as FieldId }]) }}
            className="text-[11px] border border-dashed border-gray-300 rounded-full px-2.5 py-1 text-gray-400 bg-white"
          >
            <option value="">+ Agregar campo</option>
            {available.map(f => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}

/** Reportería (spec 2026-07-21-cuadratura-reporteria-redesign-design.md) —
 *  tabla dinámica real sobre el histórico de cuadratura diaria. Sin
 *  agregación en el backend: trae el dataset plano del rango y arma
 *  filas/columnas/filtros 100% en el cliente. */
export default function ReporteriaPage() {
  const today = todayISO()
  const [preset, setPreset] = useState<PeriodPreset>('mes')
  const [customDesde, setCustomDesde] = useState(today)
  const [customHasta, setCustomHasta] = useState(today)
  const [rowSpecs, setRowSpecs] = useState<PivotFieldSpec[]>([{ field: 'carrier' }])
  const [colSpecs, setColSpecs] = useState<PivotFieldSpec[]>([{ field: 'status' }])
  const [filterFields, setFilterFields] = useState<FieldId[]>([])
  const [filterValues, setFilterValues] = useState<Record<string, Set<string>>>({})

  const { desde, hasta } = preset === 'custom' ? { desde: customDesde, hasta: customHasta } : presetRange(preset, today)

  const { data, isLoading, error } = useQuery({
    queryKey: ['daily-closures-report', desde, hasta],
    queryFn: () => dailyClosuresApi.report(desde, hasta),
  })

  const rows = data?.rows ?? []

  const availableFilterFields = ALL_FIELDS.filter(f => !filterFields.includes(f))

  const filters: PivotFilter[] = useMemo(() => filterFields.map(field => ({
    spec: { field },
    allowed: filterValues[field] ?? new Set(distinctFieldValues(rows, { field })),
  })), [filterFields, filterValues, rows])

  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters])
  const pivot = useMemo(() => buildPivot(filteredRows, rowSpecs, colSpecs), [filteredRows, rowSpecs, colSpecs])

  function toggleFilterValue(field: FieldId, value: string, allValues: string[]) {
    setFilterValues(prev => {
      const current = prev[field] ?? new Set(allValues)
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return { ...prev, [field]: next }
    })
  }

  function handleExportCsv() {
    const header = ['', ...pivot.colKeys, 'Total']
    const body = pivot.rowKeys.map(rk => [rk, ...pivot.colKeys.map(ck => pivot.cells[rk]?.[ck] ?? 0), pivot.rowTotals[rk]])
    const totalRow = ['Total', ...pivot.colKeys.map(ck => pivot.colTotals[ck]), pivot.grandTotal]
    downloadCsv(`reporteria_${desde}_${hasta}.csv`, toCsv([header, ...body, totalRow]))
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <BarChart3 size={18} className="text-accent" /> Reportería
        </h1>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!data}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-accent border border-border rounded-lg px-2.5 py-1.5 disabled:opacity-40"
        >
          <Download size={13} /> CSV
        </button>
      </div>

      {/* Filtro de período */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                preset === p ? 'bg-accent text-white border-accent' : 'text-gray-500 border-border hover:border-gray-300'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <input type="date" value={customDesde} onChange={e => setCustomDesde(e.target.value)} className="border border-border rounded-lg px-2.5 py-1.5" />
            <span>a</span>
            <input type="date" value={customHasta} onChange={e => setCustomHasta(e.target.value)} className="border border-border rounded-lg px-2.5 py-1.5" />
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">{desde} a {hasta}</p>
        )}
      </div>

      {/* Constructor de pivot */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldBucket label="Filas" specs={rowSpecs} onChange={setRowSpecs} />
          <FieldBucket label="Columnas" specs={colSpecs} onChange={setColSpecs} />
        </div>

        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Filtros</p>
          <div className="space-y-2">
            {filterFields.map(field => {
              const allValues = distinctFieldValues(rows, { field })
              const selected = filterValues[field] ?? new Set(allValues)
              return (
                <div key={field} className="flex items-start gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-gray-500 shrink-0 pt-1">{FIELD_LABELS[field]}:</span>
                  {allValues.map(v => (
                    <label key={v} className="flex items-center gap-1 text-[11px] text-gray-600 bg-gray-50 border border-border rounded-full px-2 py-0.5">
                      <input type="checkbox" checked={selected.has(v)} onChange={() => toggleFilterValue(field, v, allValues)} className="accent-accent" />
                      {v}
                    </label>
                  ))}
                  <button type="button" onClick={() => setFilterFields(filterFields.filter(f => f !== field))} className="text-gray-300 hover:text-red-400">
                    <X size={12} />
                  </button>
                </div>
              )
            })}
            {availableFilterFields.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) setFilterFields([...filterFields, e.target.value as FieldId]) }}
                className="text-[11px] border border-dashed border-gray-300 rounded-full px-2.5 py-1 text-gray-400 bg-white"
              >
                <option value="">+ Agregar filtro</option>
                {availableFilterFields.map(f => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Tabla pivot */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : error ? (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">No se pudo cargar el reporte</p>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                <th className="text-left px-3 py-2 sticky left-0 bg-gray-50">{rowSpecs.map(s => FIELD_LABELS[s.field]).join(' / ') || '—'}</th>
                {pivot.colKeys.map(ck => <th key={ck} className="text-right px-3 py-2 whitespace-nowrap">{ck}</th>)}
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {pivot.rowKeys.map(rk => (
                <tr key={rk}>
                  <td className="px-3 py-2 font-medium text-text-primary sticky left-0 bg-white">{rk}</td>
                  {pivot.colKeys.map(ck => <td key={ck} className="px-3 py-2 text-right">{pivot.cells[rk]?.[ck] ?? 0}</td>)}
                  <td className="px-3 py-2 text-right font-semibold">{pivot.rowTotals[rk]}</td>
                </tr>
              ))}
              {pivot.rowKeys.length === 0 && (
                <tr><td colSpan={pivot.colKeys.length + 2} className="px-4 py-8 text-center text-gray-300 italic">Sin datos para este período/filtro</td></tr>
              )}
            </tbody>
            {pivot.rowKeys.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-gray-50">Total</td>
                  {pivot.colKeys.map(ck => <td key={ck} className="px-3 py-2 text-right">{pivot.colTotals[ck]}</td>)}
                  <td className="px-3 py-2 text-right">{pivot.grandTotal}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
