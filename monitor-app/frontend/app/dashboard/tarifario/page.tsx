'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'
import { AlertStatTiles } from '@/components/dashboard/AlertStatTiles'
import { INPUT, LoadState, SaveRowButton, useRowFeedback } from '../admin/configuracion/shared'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

const OPERATION_TYPE_OPTIONS = ['RM', 'Z0', 'Region Norte', 'Region Sur']
const LIMIT = 50

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

/** Tarifario 1.0 (Fase 5, HU-17) — spec
 *  docs/superpowers/specs/2026-07-22-tarifario-design.md. Sin lógica de
 *  rutas/origen ni alertas de cobertura (recortado explícitamente por el
 *  usuario durante el brainstorming) — solo tarifa (texto libre) + vigencia
 *  por local, sobre el mismo catálogo que antes vivía en Configuración >
 *  Locales.
 *
 *  Ronda 43 (Fase C, Tareas 7-8): rediseño tipo SaaS (filtro + paginación de
 *  servidor + acción primaria en el header, plan
 *  docs/superpowers/plans/2026-07-22-post-weekly-refinamiento-v2-plan.md) +
 *  absorbe por completo la gestión de locales (Formato/Dirección/Región/
 *  Clasificación/Activo, filtro "Solo sin clasificar" de HU-16) — la
 *  pestaña Locales de Configuración se retira, esta pantalla es ahora la
 *  única fuente de mantenimiento del catálogo. Paginación de servidor
 *  verificada contra datos reales antes de agregarla: el generador de carga
 *  con más volumen tiene 566 locales activos. */
export default function TarifarioPage() {
  const queryClient = useQueryClient()
  const [shippers, setShippers]   = useState<Shipper[]>([])
  const [shipperId, setShipperId] = useState('')
  const [q, setQ]                 = useState('')
  const [onlyIncomplete, setOnlyIncomplete] = useState(false)
  const [page, setPage]           = useState(1)
  const qDebounced = useDebouncedValue(q, 300)

  useEffect(() => { shippersApi.list().then(setShippers).catch(() => setShippers([])) }, [])
  useEffect(() => { setPage(1) }, [shipperId, qDebounced, onlyIncomplete])

  // HU-15/16: conteo global de locales sin clasificar, independiente del
  // generador de carga elegido — para que el pendiente se note aunque
  // todavía no se haya seleccionado ninguno.
  const incompleteTotalQuery = useQuery({
    queryKey: ['locations-incomplete-total'],
    queryFn: () => locationsApi.list({ incomplete: true, limit: 1 }),
  })
  const incompleteTotal = incompleteTotalQuery.data?.count ?? null

  const listQuery = useQuery({
    queryKey: ['tarifario-locations', shipperId, qDebounced, onlyIncomplete, page],
    queryFn: () => locationsApi.list({
      entity_type: 'SHIPPER', entity_id: shipperId, q: qDebounced,
      incomplete: onlyIncomplete, include_rate: true, page, limit: LIMIT,
    }),
    enabled: !!shipperId,
  })
  const items      = listQuery.data?.data ?? []
  const count      = listQuery.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(count / LIMIT))
  const loading    = listQuery.isPending && !!shipperId
  const error      = listQuery.error ? (listQuery.error instanceof Error ? listQuery.error.message : 'Error al cargar') : null

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const fb = useRowFeedback()

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tarifario-locations'] })
    queryClient.invalidateQueries({ queryKey: ['locations-incomplete-total'] })
  }

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
      invalidate()
    })
  }

  async function toggleActive(loc: Location) {
    const next = loc.operational_status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    await fb.run(loc.id, async () => {
      await locationsApi.patch(loc.id, { operational_status: next })
      invalidate()
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Tarifario</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Local, formato, dirección, clasificación y tarifa vigente por generador de carga — texto libre para la tarifa a propósito (depende del contexto de cada viaje, sin cálculo automático en esta versión).
          </p>
        </div>
        {shipperId && <LocationCreateForm shipperId={shipperId} onCreated={invalidate} />}
      </div>

      {!!incompleteTotal && (
        <AlertStatTiles
          tiles={[{
            id: 'incomplete', label: 'Sin clasificar (todos los generadores)',
            value: incompleteTotal, tone: 'danger',
          }]}
          active={onlyIncomplete ? 'incomplete' : ''}
          onSelect={() => setOnlyIncomplete(v => !v)}
        />
      )}

      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
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
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar por nombre o N° de local…"
              aria-label="Buscar local"
              className={INPUT + ' pl-7 w-64'}
            />
          </div>
        )}
      </div>

      {!shipperId && (
        <p className="bg-white rounded-2xl border border-border px-4 py-14 text-center text-sm text-gray-400">
          Elegí un generador de carga para ver sus locales.
        </p>
      )}

      {shipperId && (
        <>
          <LoadState loading={loading} error={error} onRetry={() => listQuery.refetch()} />
          {!loading && !error && (
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
                          <select value={d.operation_type}
                            onChange={e => setDraft(loc, { operation_type: e.target.value })}
                            aria-label={`Clasificación de ${loc.name}`} className={INPUT + ' w-28'}>
                            <option value="">Sin clasificar</option>
                            {OPERATION_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
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
                    <tr><td colSpan={11} className="py-4 text-center text-gray-300 italic">Sin locales para este generador de carga</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          )}

          {!loading && !error && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <span className="text-xs text-gray-400">Página {page} de {totalPages} ({count} locales)</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
