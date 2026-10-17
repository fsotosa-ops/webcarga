'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, BarChart3, Download, X } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import {
  FIELD_LABELS, GRANULARITY_LABELS, buildPivot, distinctFieldValues, applyFilters,
  type FieldId, type Granularity, type PivotFieldSpec, type PivotFilter,
} from '@/lib/utils/pivot'
import { PageContainer } from '@/components/ui/PageContainer'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { FIELD_LABEL } from '@/components/ui/Field'

/** El nombre de cada apartado del constructor (Filas, Columnas, Filtros). */
const SECTION_LABEL = `${FIELD_LABEL} mb-1.5`
/** Lo que agrega un campo: un selector punteado, porque suma en vez de mostrar. */
const ADD_FIELD = 'rounded-full border border-dashed border-border bg-white px-2.5 py-1 text-etiqueta text-informativo'

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
      <p className={SECTION_LABEL}>{label}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {specs.map((spec, i) => (
          <span key={spec.field} className="flex items-center gap-1 rounded-full bg-accent/10 py-1 pl-2.5 pr-1 text-etiqueta font-semibold text-accion">
            {FIELD_LABELS[spec.field]}
            {spec.field === 'date' && (
              <select
                value={spec.granularity ?? 'day'}
                onChange={e => {
                  const next = [...specs]
                  next[i] = { ...spec, granularity: e.target.value as Granularity }
                  onChange(next)
                }}
                aria-label="Agrupar la fecha por" className="ml-1 rounded-full border border-accent/30 bg-white px-1.5 py-0.5 text-etiqueta"
              >
                {ALL_GRANULARITIES.map(g => <option key={g} value={g}>{GRANULARITY_LABELS[g]}</option>)}
              </select>
            )}
            <button type="button" onClick={() => onChange(specs.filter(s => s.field !== spec.field))} aria-label={`Quitar ${FIELD_LABELS[spec.field]}`} className="hover:text-text-primary">
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        ))}
        {available.length > 0 && (
          <select
            value=""
            onChange={e => { if (e.target.value) onChange([...specs, { field: e.target.value as FieldId }]) }}
            className={ADD_FIELD}
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
    <PageContainer width="reading">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <EncabezadoDePagina
          titulo="Reportería"
          icono={<BarChart3 size={18} className="text-accent" />}
        />
        <Button onClick={handleExportCsv} disabled={!data}>
          <Download size={13} aria-hidden="true" /> CSV
        </Button>
      </div>

      {/* Filtro de período */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-2">
        <SegmentedControl label="Período" value={preset} onChange={setPreset}
          options={(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map(p => ({ id: p, label: PERIOD_LABELS[p] }))} />
        {preset === 'custom' ? (
          <div className="flex items-center gap-2 text-dato text-informativo">
            <input type="date" aria-label="Desde" value={customDesde} onChange={e => setCustomDesde(e.target.value)} className="rounded-md border border-border px-2.5 py-1.5 text-text-primary" />
            <span>a</span>
            <input type="date" aria-label="Hasta" value={customHasta} onChange={e => setCustomHasta(e.target.value)} className="rounded-md border border-border px-2.5 py-1.5 text-text-primary" />
          </div>
        ) : (
          <p className="text-etiqueta text-informativo">{desde} a {hasta}</p>
        )}
      </div>

      {/* Constructor de pivot */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldBucket label="Filas" specs={rowSpecs} onChange={setRowSpecs} />
          <FieldBucket label="Columnas" specs={colSpecs} onChange={setColSpecs} />
        </div>

        <div>
          <p className={SECTION_LABEL}>Filtros</p>
          <div className="space-y-2">
            {filterFields.map(field => {
              const allValues = distinctFieldValues(rows, { field })
              const selected = filterValues[field] ?? new Set(allValues)
              return (
                <div key={field} className="flex items-start gap-2 flex-wrap">
                  <span className="shrink-0 pt-1 text-etiqueta font-semibold text-informativo">{FIELD_LABELS[field]}:</span>
                  {allValues.map(v => (
                    <label key={v} className="flex items-center gap-1 rounded-full border border-border bg-bg-main px-2 py-0.5 text-etiqueta text-text-primary">
                      <input type="checkbox" checked={selected.has(v)} onChange={() => toggleFilterValue(field, v, allValues)} className="accent-accent" />
                      {v}
                    </label>
                  ))}
                  <button type="button" onClick={() => setFilterFields(filterFields.filter(f => f !== field))} aria-label={`Quitar el filtro ${FIELD_LABELS[field]}`} className="text-informativo hover:text-status-incidente">
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
            {availableFilterFields.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) setFilterFields([...filterFields, e.target.value as FieldId]) }}
                className={ADD_FIELD}
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
        <div className="flex items-center justify-center py-16 text-informativo">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : error ? (
        <p role="alert" className="rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">No se pudo cargar el reporte</p>
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-dato">
            <thead>
              <tr className="border-b border-border bg-bg-main">
                <th className={`${CABECERA} sticky left-0 bg-bg-main`}>{rowSpecs.map(s => FIELD_LABELS[s.field]).join(' / ') || '—'}</th>
                {pivot.colKeys.map(ck => <th key={ck} className={`${CABECERA} whitespace-nowrap text-right`}>{ck}</th>)}
                <th className={`${CABECERA} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {pivot.rowKeys.map(rk => (
                <tr key={rk}>
                  <td className="px-3 py-2 font-medium text-text-primary sticky left-0 bg-white">{rk}</td>
                  {pivot.colKeys.map(ck => <td key={ck} className="px-3 py-2 text-right tabular-nums">{pivot.cells[rk]?.[ck] ?? 0}</td>)}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{pivot.rowTotals[rk]}</td>
                </tr>
              ))}
              {pivot.rowKeys.length === 0 && (
                <tr><td colSpan={pivot.colKeys.length + 2} className="px-4 py-8 text-center text-informativo">Sin datos para este período o filtro</td></tr>
              )}
            </tbody>
            {pivot.rowKeys.length > 0 && (
              <tfoot>
                <tr className="border-t border-border bg-bg-main font-bold">
                  <td className="sticky left-0 bg-bg-main px-3 py-2">Total</td>
                  {pivot.colKeys.map(ck => <td key={ck} className="px-3 py-2 text-right tabular-nums">{pivot.colTotals[ck]}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums">{pivot.grandTotal}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </PageContainer>
  )
}
