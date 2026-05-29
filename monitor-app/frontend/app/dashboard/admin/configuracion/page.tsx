'use client'

import { useState, useEffect } from 'react'
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import { configApi, type TripStatusRow, type OperationalStateRow } from '@/lib/api/config'
import type { AlertThresholdMeta } from '@/lib/types'

type Tab = 'estados_tms' | 'estados_op' | 'alertas'

const GROUP_OPTIONS = [
  { id: 'en_ruta',    label: 'En Ruta'    },
  { id: 'en_local',   label: 'En Local'   },
  { id: 'retornando', label: 'Retornando' },
  { id: 'cerrado',    label: 'Cerrado'    },
  { id: 'problema',   label: 'Problema'   },
  { id: 'otro',       label: 'Otro'       },
]

const COLOR_PALETTE = [
  { bg: '#eff6ff', text: '#1d4ed8', label: 'Azul'    },
  { bg: '#f0fdf4', text: '#166534', label: 'Verde'   },
  { bg: '#fef9c3', text: '#854d0e', label: 'Amarillo'},
  { bg: '#fff7ed', text: '#c2410c', label: 'Naranja' },
  { bg: '#fef2f2', text: '#b91c1c', label: 'Rojo'    },
  { bg: '#f5f3ff', text: '#6d28d9', label: 'Violeta' },
  { bg: '#ecfdf5', text: '#065f46', label: 'Teal'    },
  { bg: '#f3f4f6', text: '#374151', label: 'Gris'    },
]

// ── Status Badge Preview ──────────────────────────────────────────────────────
function StatusBadge({ label, bg_color, text_color }: { label: string; bg_color: string; text_color: string }) {
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: bg_color, color: text_color }}
    >
      {label || '—'}
    </span>
  )
}

// ── Tab: Estados TMS ─────────────────────────────────────────────────────────
function EstadosTMSTab() {
  const [statuses, setStatuses]   = useState<TripStatusRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState<string | null>(null)
  const [drafts, setDrafts]       = useState<Record<string, Partial<TripStatusRow>>>({})

  useEffect(() => {
    configApi.getStatuses()
      .then(data => { setStatuses(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function setDraft(id: string, field: string, value: string) {
    setDrafts(d => ({ ...d, [id]: { ...d[id], [field]: value } }))
  }

  async function saveDraft(status: TripStatusRow) {
    const draft = drafts[status.id]
    if (!draft || Object.keys(draft).length === 0) return
    setSaving(status.id)
    try {
      const updated = await configApi.patchStatus(status.id, draft as Parameters<typeof configApi.patchStatus>[1])
      setStatuses(prev => prev.map(s => s.id === status.id ? { ...s, ...updated } : s))
      setDrafts(d => { const n = { ...d }; delete n[status.id]; return n })
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Los IDs de estado los define el TMS y no pueden cambiarse. Puedes editar el label, colores y agrupación.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
              <th className="px-4 py-2.5 text-left">ID (TMS)</th>
              <th className="px-4 py-2.5 text-left">Label</th>
              <th className="px-4 py-2.5 text-left">Preview</th>
              <th className="px-4 py-2.5 text-left">Color fondo</th>
              <th className="px-4 py-2.5 text-left">Color texto</th>
              <th className="px-4 py-2.5 text-left">Grupo</th>
              <th className="px-3 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {statuses.map(status => {
              const draft = drafts[status.id] ?? {}
              const current = { ...status, ...draft }
              const isDirty = Object.keys(draft).length > 0
              return (
                <tr key={status.id} className={isDirty ? 'bg-accent/3' : ''}>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-slate-600">{status.id}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={current.label ?? ''}
                      onChange={e => setDraft(status.id, 'label', e.target.value)}
                      className="text-xs border border-border rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge label={current.label ?? status.id} bg_color={current.bg_color ?? status.bg_color} text_color={current.text_color ?? status.text_color} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={current.bg_color ?? '#f3f4f6'}
                        onChange={e => setDraft(status.id, 'bg_color', e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border border-border"
                      />
                      <input
                        value={current.bg_color ?? ''}
                        onChange={e => setDraft(status.id, 'bg_color', e.target.value)}
                        className="font-mono text-[11px] border border-border rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={current.text_color ?? '#374151'}
                        onChange={e => setDraft(status.id, 'text_color', e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border border-border"
                      />
                      <input
                        value={current.text_color ?? ''}
                        onChange={e => setDraft(status.id, 'text_color', e.target.value)}
                        className="font-mono text-[11px] border border-border rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={current.group ?? status.group}
                      onChange={e => setDraft(status.id, 'group', e.target.value)}
                      className="text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20 bg-white"
                    >
                      {GROUP_OPTIONS.map(g => (
                        <option key={g.id} value={g.id}>{g.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    {isDirty && (
                      <button
                        onClick={() => saveDraft(status)}
                        disabled={saving === status.id}
                        className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {saving === status.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab: Estados Operacionales ────────────────────────────────────────────────
function EstadosOperacionalesTab() {
  const [states, setStates]       = useState<OperationalStateRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [showNew, setShowNew]     = useState(false)
  const [newLabel, setNewLabel]   = useState('')
  const [newBg, setNewBg]         = useState('#eff6ff')
  const [newText, setNewText]     = useState('#1d4ed8')
  const [creating, setCreating]   = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [editId, setEditId]       = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<OperationalStateRow>>({})
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  useEffect(() => {
    configApi.getOperationalStates()
      .then(data => { setStates(data.filter(s => s.active)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handleCreate() {
    if (!newLabel.trim()) { setErr('El label es requerido'); return }
    setCreating(true); setErr(null)
    try {
      const created = await configApi.createOperationalState({ label: newLabel.trim(), bg_color: newBg, text_color: newText })
      setStates(prev => [...prev, created])
      setNewLabel(''); setShowNew(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveEdit(id: string) {
    setSaving(true); setErr(null)
    try {
      const updated = await configApi.patchOperationalState(id, editDraft)
      setStates(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s))
      setEditId(null); setEditDraft({})
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Desactivar este estado operacional?')) return
    setDeleting(id)
    try {
      await configApi.deleteOperationalState(id)
      setStates(prev => prev.filter(s => s.id !== id))
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Estados que el equipo de operaciones usa para gestionar viajes e interacciones con conductores.</p>

      <div className="space-y-2">
        {states.map(state => (
          <div key={state.id} className="flex items-center gap-3 p-3 bg-gray-50/60 rounded-xl border border-border/60">
            {editId === state.id ? (
              <>
                <input
                  value={editDraft.label ?? state.label}
                  onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))}
                  className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <div className="flex items-center gap-1.5">
                  {COLOR_PALETTE.map(c => (
                    <button
                      key={c.bg}
                      type="button"
                      title={c.label}
                      onClick={() => setEditDraft(d => ({ ...d, bg_color: c.bg, text_color: c.text }))}
                      className={`w-5 h-5 rounded-full border-2 transition-transform ${
                        (editDraft.bg_color ?? state.bg_color) === c.bg ? 'border-slate-700 scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c.bg }}
                    />
                  ))}
                </div>
                <StatusBadge
                  label={editDraft.label ?? state.label}
                  bg_color={editDraft.bg_color ?? state.bg_color}
                  text_color={editDraft.text_color ?? state.text_color}
                />
                <button onClick={() => handleSaveEdit(state.id)} disabled={saving} className="p-1.5 rounded-lg bg-accent text-white disabled:opacity-50">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                </button>
                <button onClick={() => { setEditId(null); setEditDraft({}) }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              </>
            ) : (
              <>
                <StatusBadge label={state.label} bg_color={state.bg_color} text_color={state.text_color} />
                <span className="flex-1 text-sm text-slate-700">{state.label}</span>
                <button
                  onClick={() => { setEditId(state.id); setEditDraft({ label: state.label, bg_color: state.bg_color, text_color: state.text_color }) }}
                  className="text-xs text-gray-400 hover:text-accent transition-colors px-2 py-1 rounded"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(state.id)}
                  disabled={deleting === state.id}
                  className="p-1.5 text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {deleting === state.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {showNew ? (
        <div className="border border-accent/20 rounded-xl p-4 bg-accent/3 space-y-3">
          <p className="text-xs font-semibold text-gray-600">Nuevo estado operacional</p>
          <input
            autoFocus
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Ej: En seguimiento, Esperando descarga…"
            maxLength={60}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Color:</span>
            {COLOR_PALETTE.map(c => (
              <button
                key={c.bg}
                type="button"
                title={c.label}
                onClick={() => { setNewBg(c.bg); setNewText(c.text) }}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  newBg === c.bg ? 'border-slate-700 scale-110' : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: c.bg }}
              />
            ))}
            <StatusBadge label={newLabel || 'Preview'} bg_color={newBg} text_color={newText} />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newLabel.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Crear
            </button>
            <button onClick={() => { setShowNew(false); setNewLabel(''); setErr(null) }}
              className="px-3 py-2 text-xs text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 transition-colors"
        >
          <Plus size={14} /> Nuevo estado operacional
        </button>
      )}
    </div>
  )
}

// ── Tab: Alertas de Vencimiento ───────────────────────────────────────────────
function AlertasTab() {
  const [thresholds, setThresholds] = useState<AlertThresholdMeta[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState<string | null>(null)
  const [drafts, setDrafts]         = useState<Record<string, Partial<AlertThresholdMeta>>>({})

  useEffect(() => {
    configApi.getAlertThresholds()
      .then(data => { setThresholds(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function setDraft(doc_type: string, field: 'warning_days' | 'error_days', value: string) {
    const num = parseInt(value, 10)
    if (!isNaN(num)) setDrafts(d => ({ ...d, [doc_type]: { ...d[doc_type], [field]: num } }))
  }

  async function saveDraft(t: AlertThresholdMeta) {
    const draft = drafts[t.doc_type]
    if (!draft) return
    setSaving(t.doc_type)
    try {
      const updated = await configApi.patchAlertThreshold(t.doc_type, draft)
      setThresholds(prev => prev.map(x => x.doc_type === t.doc_type ? updated : x))
      setDrafts(d => { const n = { ...d }; delete n[t.doc_type]; return n })
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Configura cuántos días antes del vencimiento se muestra cada tipo de alerta.
        <strong className="text-gray-700"> Warning</strong>: días de anticipación para alerta ámbar.
        <strong className="text-gray-700"> Error</strong>: 0 = alerta roja el mismo día del vencimiento.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide border-b border-border">
              <th className="px-4 py-2.5 text-left">Documento</th>
              <th className="px-4 py-2.5 text-center w-36">Warning (días)</th>
              <th className="px-4 py-2.5 text-center w-36">Error (días)</th>
              <th className="px-3 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {thresholds.map(t => {
              const draft = drafts[t.doc_type] ?? {}
              const isDirty = Object.keys(draft).length > 0
              return (
                <tr key={t.doc_type} className={isDirty ? 'bg-accent/3' : ''}>
                  <td className="px-4 py-2.5 text-sm text-slate-700 font-medium">{t.label}</td>
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="number"
                      min={1}
                      value={draft.warning_days ?? t.warning_days}
                      onChange={e => setDraft(t.doc_type, 'warning_days', e.target.value)}
                      className="w-20 text-center text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <input
                      type="number"
                      min={0}
                      value={draft.error_days ?? t.error_days}
                      onChange={e => setDraft(t.doc_type, 'error_days', e.target.value)}
                      className="w-20 text-center text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    {isDirty && (
                      <button
                        onClick={() => saveDraft(t)}
                        disabled={saving === t.doc_type}
                        className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {saving === t.doc_type ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ConfiguracionPage() {
  const [tab, setTab] = useState<Tab>('estados_tms')

  const TABS: { key: Tab; label: string; desc: string }[] = [
    { key: 'estados_tms', label: 'Estados TMS',          desc: 'Colores y agrupación' },
    { key: 'estados_op',  label: 'Estados Operacionales', desc: 'Vocabulario del equipo' },
    { key: 'alertas',     label: 'Alertas de Vencimiento', desc: 'Umbrales en días' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-6 flex-1 overflow-y-auto">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Configuración</h1>
        <p className="text-xs text-gray-400 mt-0.5">Administra los metadatos de la app sin necesidad de deploy</p>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="flex border-b border-border">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 px-4 py-3.5 text-left transition-colors border-b-2 ${
                tab === t.key
                  ? 'border-accent bg-accent/3'
                  : 'border-transparent hover:bg-gray-50/60'
              }`}
            >
              <p className={`text-xs font-semibold ${tab === t.key ? 'text-accent' : 'text-gray-600'}`}>{t.label}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 hidden sm:block">{t.desc}</p>
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'estados_tms' && <EstadosTMSTab />}
          {tab === 'estados_op'  && <EstadosOperacionalesTab />}
          {tab === 'alertas'     && <AlertasTab />}
        </div>
      </div>
    </div>
  )
}
