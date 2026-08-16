'use client'

import { useCallback, useState } from 'react'
import { Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { taxonomiesApi, type Direccion, type TaxonomyRow, type TaxonomyDomain } from '@/lib/api/config'
import {
  GROUP_OPTIONS, INPUT, useConfigList, LoadState, useRowFeedback,
  SaveRowButton, SwatchPicker, SortArrows,
} from './shared'

function Badge({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: bg, color: text }}>
      {label || '—'}
    </span>
  )
}

const GROUP_HINT = 'Define en qué columna del tablero aparecen los viajes con este estado'

// Los estados del tablero (`app.trip_statuses`) se editan en `estados-tabla.tsx`
// y `EstadoPanel.tsx` — lista con panel, en vez de las 25 filas de 8 pastillas
// que tenía esta pestaña. Este archivo se queda sólo con `TaxonomyTab` y sus
// dos usos (`EstadosOperacionalesTab`, `EstadosEquipoTab`), que no se tocan.

// ── Taxonomía genérica (app.status_taxonomies) ────────────────────────────────
// Reemplaza el cuerpo de EstadosOperacionalesTab — parametrizado por domain,
// reusado también para "Estados de Equipo" (EQUIPMENT_STATE).

const emptyNew = (withGroup: boolean) =>
  ({ label: '', bg_color: '#f3f4f6', text_color: '#374151', group: withGroup ? 'otro' : undefined })

interface TaxonomyTabProps {
  domain:   TaxonomyDomain
  title:    string
  hint:     string
  newLabel: string
}

export function TaxonomyTab({ domain, hint, newLabel }: TaxonomyTabProps) {
  const fetcher = useCallback(() => taxonomiesApi.list(domain), [domain])
  const { items, setItems, loading, error, reload } = useConfigList<TaxonomyRow>(fetcher)
  const [drafts, setDrafts]     = useState<Record<string, Partial<TaxonomyRow>>>({})
  const showGroup = domain === 'OPERATIONAL_STATE'
  const [nuevo, setNuevo]       = useState<ReturnType<typeof emptyNew> | null>(null)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  // Cuántas condiciones de documento seguían usando el último valor desactivado.
  // null = no hay nada que avisar. Sólo los subtipos de vehículo llegan a tener
  // condiciones apuntándoles, así que en las demás secciones esto nunca se dibuja.
  const [avisoUso, setAvisoUso] = useState<number | null>(null)
  const fb = useRowFeedback()

  const visibles = items.filter(s => s.active)
  const merged = (row: TaxonomyRow) => ({ ...row, ...drafts[row.id] })
  const isDirty = (row: TaxonomyRow) => !!drafts[row.id] && Object.keys(drafts[row.id]).length > 0

  function setDraft(id: string, patch: Partial<TaxonomyRow>) {
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  async function save(row: TaxonomyRow) {
    const draft = drafts[row.id]
    if (!draft) return
    await fb.run(row.id, async () => {
      const updated = await taxonomiesApi.patch(row.id, draft)
      setItems(prev => prev.map(r => (r.id === row.id ? updated : r)))
      setDrafts(d => { const n = { ...d }; delete n[row.id]; return n })
    })
  }

  // Mover lo resuelve el SERVIDOR, en una sola transacción. Acá había dos
  // PATCH seguidos y si el segundo no llegaba las dos filas quedaban con el
  // mismo número — un empate que esta pantalla no sabía deshacer. Ahora se
  // manda la dirección y vuelve el dominio completo ya ordenado, así que
  // tampoco hace falta recalcular el orden del lado del navegador.
  async function move(idx: number, direccion: Direccion) {
    const quien = visibles[idx]
    if (!quien) return
    await fb.run(quien.id, async () => {
      setItems(await taxonomiesApi.move(quien.id, direccion))
    })
  }

  async function deactivate(row: TaxonomyRow) {
    if (!window.confirm(`¿Desactivar "${row.label}"? Dejará de aparecer como opción.`)) return
    await fb.run(row.id, async () => {
      const r = await taxonomiesApi.deactivate(row.id)
      // Se guarda ANTES de sacar la fila: la desaparición de la fila es la
      // señal de que el borrado terminó, y el aviso tiene que estar puesto
      // para entonces.
      setAvisoUso(r.en_uso_por > 0 ? r.en_uso_por : null)
      setItems(prev => prev.filter(r2 => r2.id !== row.id))
    })
  }

  async function create() {
    if (!nuevo || !nuevo.label.trim()) { setCreateErr('El nombre es requerido'); return }
    setCreating(true); setCreateErr(null)
    try {
      const created = await taxonomiesApi.create({ domain, ...nuevo })
      setItems(prev => [...prev, created])
      setNuevo(null)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-4 md:p-5 space-y-3">
      <p className="text-xs text-gray-400">{hint}</p>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <>
          {avisoUso !== null && (
            <p role="status"
               className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
              <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden="true" />
              Se desactivó, y {avisoUso === 1
                ? 'una regla de documento seguía usándolo'
                : `${avisoUso} reglas de documento seguían usándolo`}.
              Revisa Certificación · Condiciones.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
                  <th className="py-2 pr-2 text-left w-8" aria-label="Orden" />
                  <th className="py-2 pr-3 text-left">Vista previa</th>
                  <th className="py-2 pr-3 text-left">Nombre</th>
                  <th className="py-2 pr-3 text-left">Color</th>
                  {showGroup && <th className="py-2 pr-3 text-left" title={GROUP_HINT}>Columna del tablero</th>}
                  <th className="py-2 text-right w-[120px]" aria-label="Acciones" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visibles.map((row, idx) => {
                  const m = merged(row)
                  return (
                    <tr key={row.id} className={isDirty(row) ? 'bg-accent/[0.03]' : ''}>
                      <td className="py-2 pr-2">
                        <SortArrows name={row.label} onUp={() => move(idx, 'up')} onDown={() => move(idx, 'down')}
                          disabledUp={idx === 0} disabledDown={idx === visibles.length - 1} />
                      </td>
                      <td className="py-2 pr-3"><Badge label={m.label} bg={m.bg_color} text={m.text_color} /></td>
                      <td className="py-2 pr-3">
                        <input value={m.label} onChange={e => setDraft(row.id, { label: e.target.value })}
                          aria-label={`Nombre de ${row.label}`} className={INPUT + ' w-36'} />
                      </td>
                      <td className="py-2 pr-3">
                        <SwatchPicker name={row.label} bg={m.bg_color} text={m.text_color}
                          onPick={c => setDraft(row.id, { bg_color: c.bg, text_color: c.text })} />
                      </td>
                      {showGroup && (
                        <td className="py-2 pr-3">
                          <select value={m.group ?? 'otro'} onChange={e => setDraft(row.id, { group: e.target.value })}
                            aria-label={`Columna del tablero de ${row.label}`} title={GROUP_HINT} className={INPUT}>
                            {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                          </select>
                        </td>
                      )}
                      <td className="py-2 text-right whitespace-nowrap">
                        <SaveRowButton dirty={isDirty(row)} saving={fb.saving === row.id}
                          saved={!!fb.savedAt[row.id]} onClick={() => save(row)} />
                        <button type="button" onClick={() => deactivate(row)} aria-label={`Desactivar ${row.label}`}
                          className="ml-2 text-gray-300 hover:text-red-400 transition-colors align-middle">
                          <Trash2 size={13} />
                        </button>
                        {fb.errors[row.id] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[row.id]}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {nuevo ? (
            <div className="border border-accent/30 bg-accent/[0.03] rounded-xl p-3 space-y-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <input autoFocus value={nuevo.label} onChange={e => setNuevo({ ...nuevo, label: e.target.value })}
                  placeholder="Nombre" aria-label={`Nombre de ${newLabel} nuevo`} className={INPUT + ' w-44'} />
                <SwatchPicker name={`nuevo ${newLabel}`} bg={nuevo.bg_color} text={nuevo.text_color}
                  onPick={c => setNuevo({ ...nuevo, bg_color: c.bg, text_color: c.text })} />
                {showGroup && (
                  <select value={nuevo.group} onChange={e => setNuevo({ ...nuevo, group: e.target.value })}
                    aria-label={`Columna del tablero de ${newLabel} nuevo`} className={INPUT}>
                    {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                )}
                <Badge label={nuevo.label || 'Vista previa'} bg={nuevo.bg_color} text={nuevo.text_color} />
              </div>
              {createErr && <p className="text-[10px] text-red-500">{createErr}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={create} disabled={creating}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {creating && <Loader2 size={12} className="animate-spin" />}
                  Crear
                </button>
                <button type="button" onClick={() => { setNuevo(null); setCreateErr(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setNuevo(emptyNew(showGroup))}
              className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80">
              <Plus size={13} /> Nuevo {newLabel}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export const EstadosOperacionalesTab = () => (
  <TaxonomyTab
    domain="OPERATIONAL_STATE"
    title="Estados Operacionales"
    hint="Estados que operaciones asigna manualmente a un viaje (override). La columna del tablero define dónde cae la tarjeta al arrastrarla."
    newLabel="estado operacional"
  />
)

export const EstadosEquipoTab = () => (
  <TaxonomyTab
    domain="EQUIPMENT_STATE"
    title="Estados de Equipo"
    hint="Motivo manual cuando un equipo/tracto activo no tiene viaje asignado hoy (en pana, en mantención, prestado, etc.)."
    newLabel="estado de equipo"
  />
)
