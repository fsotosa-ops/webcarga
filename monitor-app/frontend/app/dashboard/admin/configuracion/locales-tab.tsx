'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { INPUT, LoadState, SaveRowButton, useConfigList, useRowFeedback } from './shared'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'

// OPERATION_TYPE_OPTIONS se mantiene acá (además de en LocationCreateForm)
// porque esta tabla la usa para el selector de clasificación por FILA
// existente, un caso de uso distinto del formulario de alta — duplicar un
// array de 4 strings es más barato que forzar un import cruzado para algo
// tan chico.
const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']

export function LocalesTab() {
  const [shippers, setShippers]   = useState<Shipper[]>([])
  const [shipperId, setShipperId] = useState('')
  // HU-15/16 (Fase 4): locales auto-registrados desde el TMS sin
  // clasificación todavía (trg_reconcile_new_trip_stop_location) — el
  // conteo global es independiente del generador de carga seleccionado,
  // para que se note el pendiente aunque todavía no se eligió ninguno.
  const [incompleteTotal, setIncompleteTotal]     = useState<number | null>(null)
  const [onlyIncomplete, setOnlyIncomplete]       = useState(false)

  useEffect(() => { shippersApi.list().then(setShippers).catch(() => setShippers([])) }, [])
  useEffect(() => {
    locationsApi.list({ incomplete: true }).then(rows => setIncompleteTotal(rows.length)).catch(() => setIncompleteTotal(null))
  }, [])

  const fetcher = useCallback(
    () => (shipperId
      ? locationsApi.list({ entity_type: 'SHIPPER', entity_id: shipperId, incomplete: onlyIncomplete })
      : Promise.resolve([])),
    [shipperId, onlyIncomplete],
  )
  const { items, setItems, loading, error, reload } = useConfigList<Location>(fetcher)
  const [drafts, setDrafts]       = useState<Record<string, Partial<Location>>>({})
  const fb = useRowFeedback()

  const merged = (row: Location) => ({ ...row, ...drafts[row.id] })
  const isDirty = (row: Location) => !!drafts[row.id] && Object.keys(drafts[row.id]).length > 0

  function setDraft(id: string, patch: Partial<Location>) {
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  async function save(row: Location) {
    const draft = drafts[row.id]
    if (!draft) return
    await fb.run(row.id, async () => {
      const updated = await locationsApi.patch(row.id, draft)
      setItems(prev => prev.map(r => (r.id === row.id ? updated : r)))
      setDrafts(d => { const n = { ...d }; delete n[row.id]; return n })
    })
  }

  async function toggleActive(row: Location) {
    const next = row.operational_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    await fb.run(row.id, async () => {
      const updated = await locationsApi.patch(row.id, { operational_status: next })
      setItems(prev => prev.map(r => (r.id === row.id ? updated : r)))
    })
  }

  return (
    <div className="p-4 md:p-5 space-y-3">
      <p className="text-xs text-gray-400">
        Locales por generador de carga, con su clasificación RM/Zona Cero — poblado inicialmente desde la planilla del generador (bronze.raw_shipper_locations), editable acá para corregir o robustecer datos. Los que llegan nuevos desde el TMS sin cruce se registran solos, incompletos (HU-15).
      </p>

      {!!incompleteTotal && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertCircle size={12} className="shrink-0" />
          {incompleteTotal} local{incompleteTotal === 1 ? '' : 'es'} sin clasificar en total (todos los generadores de carga).
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={shipperId}
          onChange={e => setShipperId(e.target.value)}
          aria-label="Generador de carga"
          className={INPUT + ' w-56'}
        >
          <option value="">Seleccionar generador de carga…</option>
          {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {shipperId && (
          <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <input type="checkbox" checked={onlyIncomplete} onChange={e => setOnlyIncomplete(e.target.checked)} />
            Solo sin clasificar
          </label>
        )}
      </div>

      {!shipperId && (
        <p className="text-xs text-gray-300 italic py-4">Elegí un generador de carga para ver sus locales.</p>
      )}

      {shipperId && (
        <>
          <LoadState loading={loading} error={error} onRetry={reload} />
          {!loading && !error && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[860px]">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-3 text-left">N° Local</th>
                      <th className="py-2 pr-3 text-left">Nombre</th>
                      <th className="py-2 pr-3 text-left">Formato</th>
                      <th className="py-2 pr-3 text-left">Dirección</th>
                      <th className="py-2 pr-3 text-left">Región</th>
                      <th className="py-2 pr-3 text-left">Clasificación</th>
                      <th className="py-2 pr-3 text-left">Activo</th>
                      <th className="py-2 text-right w-[100px]" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {items.map(row => {
                      const m = merged(row)
                      const incomplete = !m.operation_type
                      return (
                        <tr key={row.id} className={isDirty(row) ? 'bg-accent/[0.03]' : incomplete ? 'bg-amber-50/50' : ''}>
                          <td className="py-2.5 pr-3 font-mono text-gray-500">{row.site_number ?? '—'}</td>
                          <td className="py-2.5 pr-3">
                            <input value={m.name} onChange={e => setDraft(row.id, { name: e.target.value })}
                              aria-label={`Nombre de ${row.name}`} className={INPUT + ' w-36'} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input value={m.format ?? ''} onChange={e => setDraft(row.id, { format: e.target.value })}
                              aria-label={`Formato de ${row.name}`} className={INPUT + ' w-24'} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input value={m.address ?? ''} onChange={e => setDraft(row.id, { address: e.target.value })}
                              aria-label={`Dirección de ${row.name}`} className={INPUT + ' w-40'} />
                          </td>
                          <td className="py-2.5 pr-3 text-gray-500 max-w-[100px] truncate">{row.region_name ?? '—'}</td>
                          <td className="py-2.5 pr-3">
                            <select value={m.operation_type ?? ''}
                              onChange={e => setDraft(row.id, { operation_type: e.target.value || null })}
                              aria-label={`Clasificación de ${row.name}`} className={INPUT + ' w-28'}>
                              <option value="">Sin clasificar</option>
                              {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                          <td className="py-2.5 pr-3">
                            <button type="button" onClick={() => toggleActive(row)}
                              aria-label={`${row.operational_status === 'ACTIVE' ? 'Desactivar' : 'Activar'} ${row.name}`}
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                row.operational_status === 'ACTIVE'
                                  ? 'bg-green-50 text-green-600 border border-green-100'
                                  : 'bg-gray-50 text-gray-400 border border-gray-100'
                              }`}>
                              {row.operational_status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                            </button>
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            <SaveRowButton dirty={isDirty(row)} saving={fb.saving === row.id}
                              saved={!!fb.savedAt[row.id]} onClick={() => save(row)} />
                            {fb.errors[row.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[row.id]}</p>}
                          </td>
                        </tr>
                      )
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={8} className="py-4 text-center text-gray-300 italic">Sin locales para este generador de carga</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <LocationCreateForm shipperId={shipperId} onCreated={created => setItems(prev => [...prev, created])} />
            </>
          )}
        </>
      )}
    </div>
  )
}
