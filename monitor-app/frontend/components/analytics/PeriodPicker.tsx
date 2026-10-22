'use client'

import { inputClass } from '@/components/ui/Field'
import {
  DATE_FIELD_LABELS, MAX_PERIOD_DAYS, PERIOD_LABELS, resolvePeriod, sumarDias, type DateField, type Period,
  type PeriodPreset,
} from '@/lib/analytics/period'

const SELECT = `${inputClass({ size: 'sm' })} w-auto`

/** Período con atajos y rango libre, y la fecha que manda (HU Analítica, criterio 3). `dateFields` vacío: el
 *  conjunto de datos tiene una sola fecha y no se pregunta. */
export function PeriodPicker({ period, onPeriod, dateField, onDateField, dateFields, today }: {
  period: Period
  onPeriod: (p: Period) => void
  dateField: DateField
  onDateField: (f: DateField) => void
  dateFields: DateField[]
  today: string
}) {
  const rango = resolvePeriod(period, today)
  // El tope de la API (400 días): el rango libre no deja elegir más.
  const desdeMinimo = sumarDias(rango.to, -(MAX_PERIOD_DAYS - 1))
  const hastaMaximo = sumarDias(rango.from, MAX_PERIOD_DAYS - 1)
  return (
    <div className="flex flex-wrap items-center gap-2 text-dato">
      <label className="inline-flex items-center gap-1.5">
        <span className="text-informativo">Período</span>
        <select aria-label="Período" value={period.preset} className={SELECT}
          onChange={e => {
            const preset = e.target.value as PeriodPreset
            onPeriod(preset === 'custom' ? { preset, ...rango } : { preset })
          }}>
          {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
        </select>
      </label>
      {period.preset === 'custom' && (
        <span className="inline-flex items-center gap-1.5">
          <input type="date" aria-label="Desde" value={rango.from} min={desdeMinimo} max={rango.to} className={SELECT}
            onChange={e => e.target.value && onPeriod({ preset: 'custom', from: e.target.value, to: rango.to })} />
          <span className="text-informativo">a</span>
          <input type="date" aria-label="Hasta" value={rango.to} min={rango.from} max={hastaMaximo} className={SELECT}
            onChange={e => e.target.value && onPeriod({ preset: 'custom', from: rango.from, to: e.target.value })} />
        </span>
      )}
      {dateFields.length > 1 && (
        <label className="inline-flex items-center gap-1.5">
          <span className="text-informativo">por</span>
          <select aria-label="Fecha del período" value={dateField} className={SELECT}
            onChange={e => onDateField(e.target.value as DateField)}>
            {dateFields.map(f => <option key={f} value={f}>{DATE_FIELD_LABELS[f]}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}
