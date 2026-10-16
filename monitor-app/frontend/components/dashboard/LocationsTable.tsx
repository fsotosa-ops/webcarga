'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi } from '@/lib/api/locations'
import { useTripsMeta } from '@/hooks/useTripsMeta'
import { lifecycleStyle } from '@/lib/states'
import { StatusChip } from '@/components/ui/StatusChip'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { Estado } from '@/components/ui/Estado'
import { INPUT, SaveRowButton, useRowFeedback } from '@/app/dashboard/admin/settings/shared'

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

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : iso
}

/** Resumen de tarifa vigente cuando no se está editando — "450.000 CLP ·
 *  desde 22/07/26" o "Sin tarifa" si no hay ninguna. Reemplaza los 3
 *  inputs siempre visibles (ajuste 2026-07-28: esos 3 inputs eran la
 *  causa principal del scroll horizontal de la tabla). */
function rateSummary(loc: Location): string {
  if (!loc.current_rate) return 'Sin tarifa'
  const from = loc.current_rate_valid_from ? ` · desde ${formatShortDate(loc.current_rate_valid_from)}` : ''
  return `${loc.current_rate}${from}`
}

const CELDA = 'py-2.5 px-2'

/** La lista de lugares de carga: el Tarifario y la pestaña Lugares de la ficha
 *  de un cliente (Configuración, Parte 3). Recibe los lugares ya cargados por
 *  el padre — sin fetching propio de lugares.
 *
 *  Ajuste 2026-07-28 (sin scroll horizontal): N° Local se fusiona como
 *  badge dentro de Nombre, la clasificación automática se marca con un
 *  punto en vez de texto "auto", y Tarifa/Válido desde/Válido hasta
 *  colapsan en un resumen de una línea que se expande a los 3 inputs
 *  solo al click en "Editar".
 *
 *  Sin `canEdit` (la API exige commercial.edit) se lee todo y no hay un solo
 *  control. Las zonas salen del catálogo de la API (`meta.operation_types`). */
export function LocationsTable({ items, onChanged, canEdit, emptyTitle = 'Sin lugares para este filtro' }: {
  items: Location[]; onChanged: () => void; canEdit: boolean
  /** Qué decir sin lugares; la ficha de un cliente sin filtros dice otra cosa. */
  emptyTitle?: string
}) {
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({})
  const [editingRate, setEditingRate] = useState<string | null>(null)
  const fb = useRowFeedback()
  const zonas = useTripsMeta().data?.operation_types ?? []
  const zonaLabel = (id: string) => zonas.find(z => z.id === id)?.label ?? id

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
      setEditingRate(r => r === loc.id ? null : r)
      onChanged()
    })
  }

  /** Activo y Origen se guardan al instante, como un interruptor. */
  async function patchNow(loc: Location, body: Partial<Pick<Location, 'operational_status' | 'is_origin'>>) {
    await fb.run(loc.id, async () => {
      await locationsApi.patch(loc.id, body)
      onChanged()
    })
  }

  if (items.length === 0) return <Estado tipo="vacio" titulo={emptyTitle} />

  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-dato">
        <thead>
          <tr className="border-b border-border bg-bg-main">
            <th scope="col" className={CABECERA}>Nombre</th>
            <th scope="col" className={CABECERA}>Formato</th>
            <th scope="col" className={CABECERA}>Dirección</th>
            <th scope="col" className={CABECERA}>Región</th>
            <th scope="col" className={CABECERA}>Clasificación</th>
            <th scope="col" className={CABECERA}>Origen</th>
            <th scope="col" className={CABECERA}>Activo</th>
            <th scope="col" className={CABECERA}>Tarifa vigente</th>
            {canEdit && <th scope="col" className={`${CABECERA} w-[72px]`}><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {items.map(loc => {
            const d = draftFor(loc)
            const dirty = isDirty(loc)
            const incomplete = !loc.operation_type
            const isEditingRate = editingRate === loc.id
            const estado = lifecycleStyle('location', loc.operational_status)
            const activo = loc.operational_status === 'ACTIVE'
            return (
              <tr key={loc.id} className={`transition-colors hover:bg-bg-main ${dirty ? 'bg-accent/5' : incomplete ? 'bg-warning/5' : ''}`}>
                <td className={CELDA}>
                  <div className="flex items-center gap-1">
                    {loc.site_number && (
                      <span className="font-identificador text-etiqueta text-informativo shrink-0">{loc.site_number}</span>
                    )}
                    {canEdit
                      ? <input value={d.name} onChange={e => setDraft(loc, { name: e.target.value })}
                          aria-label={`Nombre de ${loc.name}`} className={INPUT + ' w-28'} />
                      : <span className="font-semibold text-text-primary">{loc.name}</span>}
                  </div>
                </td>
                <td className={CELDA}>
                  {canEdit
                    ? <input value={d.format} onChange={e => setDraft(loc, { format: e.target.value })}
                        aria-label={`Formato de ${loc.name}`} className={INPUT + ' w-20'} />
                    : <span className="text-informativo">{loc.format ?? '—'}</span>}
                </td>
                <td className={CELDA}>
                  {canEdit
                    ? <input value={d.address} onChange={e => setDraft(loc, { address: e.target.value })}
                        aria-label={`Dirección de ${loc.name}`} className={INPUT + ' w-28'} />
                    : <span className="text-informativo">{loc.address ?? '—'}</span>}
                </td>
                <td className={`${CELDA} text-informativo max-w-[80px] truncate`} title={loc.region_name ?? undefined}>{loc.region_name ?? '—'}</td>
                <td className={CELDA}>
                  <div className="flex items-center gap-1">
                    {canEdit ? (
                      <select value={d.operation_type}
                        onChange={e => setDraft(loc, { operation_type: e.target.value })}
                        aria-label={`Clasificación de ${loc.name}`} className={INPUT + ' w-24'}>
                        <option value="">Sin clasificar</option>
                        {zonas.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-informativo">{loc.operation_type ? zonaLabel(loc.operation_type) : 'Sin clasificar'}</span>
                    )}
                    {!loc.is_manual_override && loc.operation_type && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent/50 shrink-0" title="Clasificado automáticamente" />
                    )}
                  </div>
                </td>
                <td className={CELDA}>
                  {canEdit ? (
                    <input type="checkbox" checked={loc.is_origin}
                      onChange={() => patchNow(loc, { is_origin: !loc.is_origin })}
                      aria-label={`Origen: ${loc.name}`} className="accent-accent" />
                  ) : (
                    <span className="text-informativo">{loc.is_origin ? 'Origen' : '—'}</span>
                  )}
                </td>
                <td className={CELDA}>
                  {canEdit ? (
                    <button type="button" onClick={() => patchNow(loc, { operational_status: activo ? 'INACTIVE' : 'ACTIVE' })}
                      aria-label={`${activo ? 'Desactivar' : 'Activar'} ${loc.name}`}>
                      <StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip>
                    </button>
                  ) : (
                    <StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip>
                  )}
                </td>
                <td className={CELDA}>
                  {canEdit && isEditingRate ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <input value={d.tarifa} onChange={e => setDraft(loc, { tarifa: e.target.value })}
                        placeholder="Ej. 450.000 CLP" aria-label={`Tarifa de ${loc.name}`} className={INPUT + ' w-24'} />
                      <input type="date" value={d.valid_from} onChange={e => setDraft(loc, { valid_from: e.target.value })}
                        aria-label={`Válido desde de ${loc.name}`} className={INPUT + ' w-28'} />
                      <input type="date" value={d.valid_to} onChange={e => setDraft(loc, { valid_to: e.target.value })}
                        aria-label={`Válido hasta de ${loc.name}`} className={INPUT + ' w-28'} />
                    </div>
                  ) : canEdit ? (
                    <button type="button" onClick={() => setEditingRate(loc.id)}
                      aria-label={`Editar tarifa de ${loc.name}`}
                      className="flex items-center gap-1 text-informativo hover:text-accent">
                      {rateSummary(loc)} <Pencil size={10} />
                    </button>
                  ) : (
                    <span className="text-informativo">{rateSummary(loc)}</span>
                  )}
                </td>
                {canEdit && (
                  <td className={`${CELDA} text-right whitespace-nowrap`}>
                    <SaveRowButton dirty={dirty} saving={fb.saving === loc.id}
                      saved={!!fb.savedAt[loc.id]} onClick={() => save(loc)} />
                    {fb.errors[loc.id] && <p role="alert" className="text-etiqueta text-status-incidente mt-1">{fb.errors[loc.id]}</p>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
