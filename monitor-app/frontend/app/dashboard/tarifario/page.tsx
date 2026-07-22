'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Location } from '@/lib/types'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'
import { INPUT, LoadState, SaveRowButton, useConfigList, useRowFeedback } from '../admin/configuracion/shared'

type RateDraft = { tarifa: string; valid_from: string; valid_to: string }

const emptyDraft = (loc: Location): RateDraft => ({
  tarifa: loc.current_rate ?? '',
  valid_from: loc.current_rate_valid_from ?? '',
  valid_to: loc.current_rate_valid_to ?? '',
})

/** Tarifario 1.0 (Fase 5, HU-17) — spec
 *  docs/superpowers/specs/2026-07-22-tarifario-design.md. Sin lógica de
 *  rutas/origen ni alertas de cobertura (recortado explícitamente por el
 *  usuario durante el brainstorming) — solo tarifa (texto libre) + vigencia
 *  por local, sobre el mismo catálogo que Configuración > Locales (Fase 4).
 *  También puede crear locales nuevos ("el motor de update de
 *  public.locations también y al tarifario"). */
export default function TarifarioPage() {
  const [shippers, setShippers]   = useState<Shipper[]>([])
  const [shipperId, setShipperId] = useState('')

  useEffect(() => { shippersApi.list().then(setShippers).catch(() => setShippers([])) }, [])

  const fetcher = useCallback(
    () => (shipperId
      ? locationsApi.list({ entity_type: 'SHIPPER', entity_id: shipperId, include_rate: true })
      : Promise.resolve([])),
    [shipperId],
  )
  const { items, setItems, loading, error, reload } = useConfigList<Location>(fetcher)
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({})
  const fb = useRowFeedback()

  const draftFor = (loc: Location) => drafts[loc.id] ?? emptyDraft(loc)
  const isDirty = (loc: Location) => {
    const d = drafts[loc.id]
    if (!d) return false
    const base = emptyDraft(loc)
    return d.tarifa !== base.tarifa || d.valid_from !== base.valid_from || d.valid_to !== base.valid_to
  }

  function setDraft(loc: Location, patch: Partial<RateDraft>) {
    setDrafts(d => ({ ...d, [loc.id]: { ...draftFor(loc), ...patch } }))
  }

  async function save(loc: Location) {
    const d = draftFor(loc)
    if (!d.tarifa.trim()) return
    await fb.run(loc.id, async () => {
      await locationsApi.createRate(loc.id, {
        tarifa: d.tarifa,
        valid_from: d.valid_from || undefined,
        valid_to: d.valid_to || null,
      })
      setDrafts(dr => { const n = { ...dr }; delete n[loc.id]; return n })
      reload()
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Tarifario</h1>
        <p className="text-xs text-gray-400 mt-1">
          Tarifa por local, con vigencia — texto libre a propósito (depende del contexto de cada viaje, sin cálculo automático en esta versión).
        </p>
      </div>

      <select
        value={shipperId}
        onChange={e => setShipperId(e.target.value)}
        aria-label="Generador de carga"
        className={INPUT + ' w-56'}
      >
        <option value="">Seleccionar generador de carga…</option>
        {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {!shipperId && (
        <p className="text-xs text-gray-300 italic py-4">Elegí un generador de carga para ver sus locales.</p>
      )}

      {shipperId && (
        <>
          <LoadState loading={loading} error={error} onRetry={reload} />
          {!loading && !error && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[760px]">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-3 text-left">N° Local</th>
                      <th className="py-2 pr-3 text-left">Nombre</th>
                      <th className="py-2 pr-3 text-left">Tarifa vigente</th>
                      <th className="py-2 pr-3 text-left">Válido desde</th>
                      <th className="py-2 pr-3 text-left">Válido hasta</th>
                      <th className="py-2 text-right w-[100px]" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {items.map(loc => {
                      const d = draftFor(loc)
                      const dirty = isDirty(loc)
                      return (
                        <tr key={loc.id} className={dirty ? 'bg-accent/[0.03]' : ''}>
                          <td className="py-2.5 pr-3 font-mono text-gray-500">{loc.site_number ?? '—'}</td>
                          <td className="py-2.5 pr-3">{loc.name}</td>
                          <td className="py-2.5 pr-3">
                            <input value={d.tarifa} onChange={e => setDraft(loc, { tarifa: e.target.value })}
                              placeholder="Ej. 450.000 CLP" aria-label={`Tarifa de ${loc.name}`} className={INPUT + ' w-32'} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input type="date" value={d.valid_from} onChange={e => setDraft(loc, { valid_from: e.target.value })}
                              aria-label={`Válido desde de ${loc.name}`} className={INPUT + ' w-36'} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input type="date" value={d.valid_to} onChange={e => setDraft(loc, { valid_to: e.target.value })}
                              aria-label={`Válido hasta de ${loc.name}`} className={INPUT + ' w-36'} />
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            <SaveRowButton dirty={dirty} saving={fb.saving === loc.id}
                              saved={!!fb.savedAt[loc.id]} onClick={() => save(loc)} />
                            {fb.errors[loc.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[loc.id]}</p>}
                          </td>
                        </tr>
                      )
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={6} className="py-4 text-center text-gray-300 italic">Sin locales para este generador de carga</td></tr>
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
