'use client'

import { CeldaDeRevision, BotonConfirmar, MarcaDeRevision, useRevisiones } from './revision'
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Check, BellRing } from 'lucide-react'
import { configApi } from '@/lib/api/config'
import type { AlertThresholdMeta, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'
import { INPUT, useConfigList, LoadState, useRowFeedback, SaveRowButton } from './shared'

// ── Alertas de Vencimiento (documentos) ───────────────────────────────────────

export function AlertasVencimientoTab() {
  const revisiones = useRevisiones('certification', 'expiry-alerts')
  const fetcher = useCallback(() => configApi.getAlertThresholds(), [])
  const { items, setItems, loading, error, reload } = useConfigList<AlertThresholdMeta>(fetcher)
  const [drafts, setDrafts] = useState<Record<string, Partial<AlertThresholdMeta>>>({})
  const fb = useRowFeedback()

  const merged = (row: AlertThresholdMeta) => ({ ...row, ...drafts[row.doc_type] })
  const isDirty = (row: AlertThresholdMeta) => !!drafts[row.doc_type] && Object.keys(drafts[row.doc_type]).length > 0

  function setDraft(key: string, patch: Partial<AlertThresholdMeta>) {
    setDrafts(d => ({ ...d, [key]: { ...d[key], ...patch } }))
  }

  async function save(row: AlertThresholdMeta) {
    const draft = drafts[row.doc_type]
    if (!draft) return
    await fb.run(row.doc_type, async () => {
      const updated = await configApi.patchAlertThreshold(row.doc_type, draft)
      setItems(prev => prev.map(r => (r.doc_type === row.doc_type ? updated : r)))
      setDrafts(d => { const n = { ...d }; delete n[row.doc_type]; return n })
    })
  }

  return (
    <div className="p-4 md:p-5 space-y-3">
      <p className="text-xs text-gray-400">
        Cuántos días antes del vencimiento de cada documento se enciende la alerta amarilla (advertencia) y la roja (crítico).
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <table className="w-full text-xs max-w-2xl">
          <thead>
            <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
              <th className="py-2 pr-3 text-left">Documento</th>
              <th className="py-2 pr-3 text-left">Advertencia (días antes)</th>
              <th className="py-2 pr-3 text-left">Crítico (días antes)</th>
              <th className="py-2 pr-3 text-left">Revisión</th>
              <th className="py-2 text-right w-[90px]" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {items.map(row => {
              const m = merged(row)
              return (
                <tr key={row.doc_type} className={isDirty(row) ? 'bg-accent/[0.03]' : ''}>
                  <td className="py-2.5 pr-3 font-medium text-slate-700">{row.label}</td>
                  <td className="py-2.5 pr-3">
                    <input type="number" min={1} value={m.warning_days}
                      onChange={e => setDraft(row.doc_type, { warning_days: Number(e.target.value) })}
                      aria-label={`Advertencia de ${row.label}`} className={INPUT + ' w-20'} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input type="number" min={0} value={m.error_days}
                      onChange={e => setDraft(row.doc_type, { error_days: Number(e.target.value) })}
                      aria-label={`Crítico de ${row.label}`} className={INPUT + ' w-20'} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <CeldaDeRevision id={row.doc_type} revisiones={revisiones} />
                  </td>
                  <td className="py-2.5 text-right">
                    <SaveRowButton dirty={isDirty(row)} saving={fb.saving === row.doc_type}
                      saved={!!fb.savedAt[row.doc_type]} onClick={() => save(row)} />
                    {fb.errors[row.doc_type] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[row.doc_type]}</p>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Rangos de Temperatura ─────────────────────────────────────────────────────

const EMPTY_RANGE = { cargo_type: '', label: '', min_c: 0, max_c: 5 }

export function RangosTemperaturaTab() {
  const revisiones = useRevisiones('operations', 'temperature-ranges')
  const fetcher = useCallback(() => configApi.getTemperatureRanges(), [])
  const { items, setItems, loading, error, reload } = useConfigList<TemperatureRangeMeta>(fetcher)
  const [drafts, setDrafts]       = useState<Record<string, Partial<TemperatureRangeMeta>>>({})
  const [nuevo, setNuevo]         = useState<typeof EMPTY_RANGE | null>(null)
  const [creating, setCreating]   = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const fb = useRowFeedback()

  const merged = (row: TemperatureRangeMeta) => ({ ...row, ...drafts[row.cargo_type] })
  const isDirty = (row: TemperatureRangeMeta) => !!drafts[row.cargo_type] && Object.keys(drafts[row.cargo_type]).length > 0

  function setDraft(key: string, patch: Partial<TemperatureRangeMeta>) {
    setDrafts(d => ({ ...d, [key]: { ...d[key], ...patch } }))
  }

  async function save(row: TemperatureRangeMeta) {
    const draft = drafts[row.cargo_type]
    if (!draft) return
    await fb.run(row.cargo_type, async () => {
      const updated = await configApi.patchTemperatureRange(row.cargo_type, draft)
      setItems(prev => prev.map(r => (r.cargo_type === row.cargo_type ? updated : r)))
      setDrafts(d => { const n = { ...d }; delete n[row.cargo_type]; return n })
    })
  }

  async function remove(row: TemperatureRangeMeta) {
    if (!window.confirm(`¿Eliminar el rango de "${row.cargo_type}"? Sus viajes quedarán sin clasificación de temperatura.`)) return
    await fb.run(row.cargo_type, async () => {
      await configApi.deleteTemperatureRange(row.cargo_type)
      setItems(prev => prev.filter(r => r.cargo_type !== row.cargo_type))
    })
  }

  async function create() {
    if (!nuevo || !nuevo.cargo_type.trim() || !nuevo.label.trim()) {
      setCreateErr('Tipo de carga y nombre son requeridos'); return
    }
    setCreating(true); setCreateErr(null)
    try {
      const created = await configApi.createTemperatureRange(nuevo)
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
      <p className="text-xs text-gray-400">
        Rango aceptable de temperatura por tipo de carga (tal como lo reporta el TMS, ej: FRIO, CONGELADO). Lecturas fuera del rango encienden el aviso rojo en el monitor.
      </p>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <>
          <table className="w-full text-xs max-w-2xl">
            <thead>
              <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
                <th className="py-2 pr-3 text-left">Tipo de carga</th>
                <th className="py-2 pr-3 text-left">Nombre</th>
                <th className="py-2 pr-3 text-left">Mín °C</th>
                <th className="py-2 pr-3 text-left">Máx °C</th>
                <th className="py-2 pr-3 text-left">Revisión</th>
                <th className="py-2 text-right w-[120px]" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map(row => {
                const m = merged(row)
                return (
                  <tr key={row.cargo_type} className={isDirty(row) ? 'bg-accent/[0.03]' : ''}>
                    <td className="py-2.5 pr-3 font-mono font-semibold text-slate-700">{row.cargo_type}</td>
                    <td className="py-2.5 pr-3">
                      <input value={m.label} onChange={e => setDraft(row.cargo_type, { label: e.target.value })}
                        aria-label={`Nombre de ${row.cargo_type}`} className={INPUT + ' w-32'} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <input type="number" step="0.5" value={m.min_c}
                        onChange={e => setDraft(row.cargo_type, { min_c: Number(e.target.value) })}
                        aria-label={`Mínimo de ${row.cargo_type}`} className={INPUT + ' w-20'} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <input type="number" step="0.5" value={m.max_c}
                        onChange={e => setDraft(row.cargo_type, { max_c: Number(e.target.value) })}
                        aria-label={`Máximo de ${row.cargo_type}`} className={INPUT + ' w-20'} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <CeldaDeRevision id={row.cargo_type} revisiones={revisiones} />
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <SaveRowButton dirty={isDirty(row)} saving={fb.saving === row.cargo_type}
                        saved={!!fb.savedAt[row.cargo_type]} onClick={() => save(row)} />
                      <button type="button" onClick={() => remove(row)} aria-label={`Eliminar rango de ${row.cargo_type}`}
                        className="ml-2 text-gray-300 hover:text-red-400 transition-colors align-middle">
                        <Trash2 size={13} />
                      </button>
                      {fb.errors[row.cargo_type] && <p className="text-[9px] text-red-500 mt-1">{fb.errors[row.cargo_type]}</p>}
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-gray-300 italic">Sin rangos configurados</td></tr>
              )}
            </tbody>
          </table>

          {nuevo ? (
            <div className="border border-accent/30 bg-accent/[0.03] rounded-xl p-3 space-y-2.5 max-w-2xl">
              <div className="flex items-center gap-2 flex-wrap">
                <input autoFocus value={nuevo.cargo_type}
                  onChange={e => setNuevo({ ...nuevo, cargo_type: e.target.value.toUpperCase() })}
                  placeholder="Tipo de carga (ej: FRIO)" aria-label="Tipo de carga nuevo" className={INPUT + ' w-40 font-mono'} />
                <input value={nuevo.label} onChange={e => setNuevo({ ...nuevo, label: e.target.value })}
                  placeholder="Nombre (ej: Frío)" aria-label="Nombre del rango nuevo" className={INPUT + ' w-32'} />
                <input type="number" step="0.5" value={nuevo.min_c}
                  onChange={e => setNuevo({ ...nuevo, min_c: Number(e.target.value) })}
                  aria-label="Mínimo del rango nuevo" className={INPUT + ' w-20'} />
                <span className="text-gray-300 text-xs">a</span>
                <input type="number" step="0.5" value={nuevo.max_c}
                  onChange={e => setNuevo({ ...nuevo, max_c: Number(e.target.value) })}
                  aria-label="Máximo del rango nuevo" className={INPUT + ' w-20'} />
                <span className="text-xs text-gray-400">°C</span>
              </div>
              {createErr && <p className="text-[10px] text-red-500">{createErr}</p>}
              <div className="flex items-center gap-2">
                <button type="button" onClick={create} disabled={creating}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {creating && <Loader2 size={12} className="animate-spin" />}
                  Crear rango
                </button>
                <button type="button" onClick={() => { setNuevo(null); setCreateErr(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setNuevo(EMPTY_RANGE)}
              className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80">
              <Plus size={13} /> Nuevo rango
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── Alertas del Monitor (umbrales de las alertas operacionales) ───────────────

const RULE_FIELDS: { key: keyof MonitorAlertRules; label: string; hint: string; unit: string; step: string }[] = [
  { key: 'stale_report_hours', label: 'Sin actualización del TMS', hint: 'Horas sin actualización del TMS en un viaje abierto para encender la alerta', unit: 'horas', step: '0.5' },
  // Hito 14 (minuta 29/07 §4.4): semáforo de tiempo en el local activo —
  // reemplaza al umbral binario "Detenido en local" (dwell_hours, sigue
  // existiendo en la DB pero ya no se edita acá ni se usa como alerta).
  { key: 'dwell_yellow_min', label: 'Semáforo local — amarillo', hint: 'Minutos en la parada activa para pasar de verde a amarillo', unit: 'min', step: '5' },
  { key: 'dwell_orange_min', label: 'Semáforo local — naranja',  hint: 'Minutos en la parada activa para pasar a naranja', unit: 'min', step: '5' },
  { key: 'dwell_red_min',    label: 'Semáforo local — rojo',     hint: 'Minutos en la parada activa para pasar a rojo', unit: 'min', step: '5' },
]

export function AlertasMonitorTab() {
  // Los umbrales son UN formulario, no una lista: su elemento es el
  // formulario entero, y revisarlo es decir "estos siete números están bien".
  const revisiones = useRevisiones('operations', 'alert-thresholds')
  const revision = revisiones.revisionDe('reglas')
  const [rules, setRules]     = useState<MonitorAlertRules | null>(null)
  const [draft, setDraft]     = useState<Partial<MonitorAlertRules>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    configApi.getMonitorAlertRules()
      .then(setRules)
      .catch(e => setError(e instanceof Error ? e.message : 'Error al cargar'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const merged = rules ? { ...rules, ...draft } : null
  const dirty = Object.keys(draft).length > 0

  async function save() {
    if (!dirty) return
    setSaving(true); setSaveErr(null)
    try {
      const updated = await configApi.patchMonitorAlertRules(draft)
      setRules(updated)
      setDraft({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-5 space-y-3 max-w-2xl">
      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <BellRing size={12} className="text-accent shrink-0" />
        Umbrales de las alertas operacionales del monitor (tarjetas sobre la lista de viajes).
      </p>
      <LoadState loading={loading} error={error} onRetry={load} />
      {!loading && !error && <MarcaDeRevision revision={revision} />}
      {!loading && !error && merged && (
        <div className={`border rounded-xl divide-y divide-border/50 ${dirty ? 'border-accent/30 bg-accent/[0.02]' : 'border-border'}`}>
          {RULE_FIELDS.map(f => (
            <div key={f.key} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-700">{f.label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{f.hint}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number" min={0} step={f.step}
                  value={merged[f.key] as number}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: Number(e.target.value) }))}
                  aria-label={f.label}
                  className={INPUT + ' w-20 text-right'}
                />
                <span className="text-[10px] text-gray-400 w-9">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {saveErr && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveErr}</p>}
      {!loading && !error && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || saving}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent/90 px-4 py-2 rounded-lg disabled:opacity-40 transition-colors">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Guardar cambios
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-600" role="status">
              <Check size={13} /> Guardado
            </span>
          )}
          {/* Guardar ya cuenta como revisar, así que confirmar sólo aparece
              cuando no hay nada que guardar. */}
          {!dirty && (
            <BotonConfirmar
              revisado={!!revision}
              pendiente={revisiones.confirmar.isPending}
              onConfirmar={() => revisiones.confirmar.mutate('reglas')}
            />
          )}
        </div>
      )}
    </div>
  )
}
