'use client'

import { useState } from 'react'
import type { Location } from '@/lib/types'
import { locationsApi } from '@/lib/api/locations'
import { INPUT, SaveRowButton, useRowFeedback } from '@/app/dashboard/admin/configuracion/shared'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

type RowDraft = {
  name: string
  format: string
  address: string
  operation_type: string
  tarifa: string
  valid_from: string
  valid_to: string
}

const emptyDraft = (loc: Location): RowDraft => ({
  name: loc.name,
  format: loc.format ?? '',
  address: loc.address ?? '',
  operation_type: loc.operation_type ?? '',
  tarifa: loc.current_rate ?? '',
  valid_from: loc.current_rate_valid_from ?? '',
  valid_to: loc.current_rate_valid_to ?? '',
})

/** Tabla completa de gestión de locales — extraída de TarifarioPage
 *  (Robustecer Tarifario, 2026-07-27) para que la página pueda alternar
 *  entre esta tabla y la tab de triage sin duplicar el estado de drafts.
 *  Recibe los locales ya cargados por el padre — sin fetching propio. */
export function LocationsTable({ items, onChanged }: { items: Location[]; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const fb = useRowFeedback()

  const draftFor = (loc: Location) => drafts[loc.id] ?? emptyDraft(loc)
  const isDirty = (loc: Location) => {
    const d = drafts[loc.id]
    if (!d) return false
    const base = emptyDraft(loc)
    return d.name !== base.name || d.format !== base.format || d.address !== base.address
      || d.operation_type !== base.operation_type
      || d.tarifa !== base.tarifa || d.valid_from !== base.valid_from || d.valid_to !== base.valid_to
  }

  function setDraft(loc: Location, patch: Partial<RowDraft>) {
    setDrafts(d => ({ ...d, [loc.id]: { ...draftFor(loc), ...patch } }))
  }

  async function save(loc: Location) {
    const d = draftFor(loc)
    const base = emptyDraft(loc)
    await fb.run(loc.id, async () => {
      const locationChanged = d.name !== base.name || d.format !== base.format
        || d.address !== base.address || d.operation_type !== base.operation_type
      if (locationChanged) {
        await locationsApi.patch(loc.id, {
          name: d.name, format: d.format || null, address: d.address || null,
          operation_type: d.operation_type || null,
        })
      }
      const rateChanged = d.tarifa !== base.tarifa || d.valid_from !== base.valid_from || d.valid_to !== base.valid_to
      if (rateChanged && d.tarifa.trim()) {
        await locationsApi.createRate(loc.id, {
          tarifa: d.tarifa, valid_from: d.valid_from || undefined, valid_to: d.valid_to || null,
        })
      }
      setDrafts(dr => { const n = { ...dr }; delete n[loc.id]; return n })
      onChanged()
    })
  }

  async function toggleActive(loc: Location) {
    const next = loc.operational_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    await fb.run(loc.id, async () => {
      await locationsApi.patch(loc.id, { operational_status: next })
      onChanged()
    })
  }

  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[1080px]">
        <thead>
          <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border bg-gray-50">
            <th className="py-2.5 px-3 text-left">N° Local</th>
            <th className="py-2.5 px-3 text-left">Nombre</th>
            <th className="py-2.5 px-3 text-left">Formato</th>
            <th className="py-2.5 px-3 text-left">Dirección</th>
            <th className="py-2.5 px-3 text-left">Región</th>
            <th className="py-2.5 px-3 text-left">Clasificación</th>
            <th className="py-2.5 px-3 text-left">Activo</th>
            <th className="py-2.5 px-3 text-left">Tarifa vigente</th>
            <th className="py-2.5 px-3 text-left">Válido desde</th>
            <th className="py-2.5 px-3 text-left">Válido hasta</th>
            <th className="py-2.5 px-3 text-right w-[100px]" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map(loc => {
            const d = draftFor(loc)
            const dirty = isDirty(loc)
            const incomplete = !loc.operation_type
            return (
              <tr key={loc.id} className={`hover:bg-gray-50/60 transition-colors ${dirty ? 'bg-accent/[0.03]' : incomplete ? 'bg-amber-50/50' : ''}`}>
                <td className="py-2.5 px-3 font-mono text-gray-500">{loc.site_number ?? '—'}</td>
                <td className="py-2.5 px-3">
                  <input value={d.name} onChange={e => setDraft(loc, { name: e.target.value })}
                    aria-label={`Nombre de ${loc.name}`} className={INPUT + ' w-36'} />
                </td>
                <td className="py-2.5 px-3">
                  <input value={d.format} onChange={e => setDraft(loc, { format: e.target.value })}
                    aria-label={`Formato de ${loc.name}`} className={INPUT + ' w-24'} />
                </td>
                <td className="py-2.5 px-3">
                  <input value={d.address} onChange={e => setDraft(loc, { address: e.target.value })}
                    aria-label={`Dirección de ${loc.name}`} className={INPUT + ' w-40'} />
                </td>
                <td className="py-2.5 px-3 text-gray-500 max-w-[100px] truncate">{loc.region_name ?? '—'}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1">
                    <select value={d.operation_type}
                      onChange={e => setDraft(loc, { operation_type: e.target.value })}
                      aria-label={`Clasificación de ${loc.name}`} className={INPUT + ' w-28'}>
                      <option value="">Sin clasificar</option>
                      {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    {!loc.is_manual_override && loc.operation_type && (
                      <span className="text-[9px] text-gray-400">auto</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <button type="button" onClick={() => toggleActive(loc)}
                    aria-label={`${loc.operational_status === 'ACTIVE' ? 'Desactivar' : 'Activar'} ${loc.name}`}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      loc.operational_status === 'ACTIVE'
                        ? 'bg-green-50 text-green-600 border border-green-100'
                        : 'bg-gray-50 text-gray-400 border border-gray-100'
                    }`}>
                    {loc.operational_status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td className="py-2.5 px-3">
                  <input value={d.tarifa} onChange={e => setDraft(loc, { tarifa: e.target.value })}
                    placeholder="Ej. 450.000 CLP" aria-label={`Tarifa de ${loc.name}`} className={INPUT + ' w-32'} />
                </td>
                <td className="py-2.5 px-3">
                  <input type="date" value={d.valid_from} onChange={e => setDraft(loc, { valid_from: e.target.value })}
                    aria-label={`Válido desde de ${loc.name}`} className={INPUT + ' w-36'} />
                </td>
                <td className="py-2.5 px-3">
                  <input type="date" value={d.valid_to} onChange={e => setDraft(loc, { valid_to: e.target.value })}
                    aria-label={`Válido hasta de ${loc.name}`} className={INPUT + ' w-36'} />
                </td>
                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                  <SaveRowButton dirty={dirty} saving={fb.saving === loc.id}
                    saved={!!fb.savedAt[loc.id]} onClick={() => save(loc)} />
                  {fb.errors[loc.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[loc.id]}</p>}
                </td>
              </tr>
            )
          })}
          {items.length === 0 && (
            <tr><td colSpan={11} className="py-4 text-center text-gray-300 italic">Sin locales para este filtro</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
