'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react'

// ── Vocabulario compartido ────────────────────────────────────────────────────

// Taxonomía de grupos del tablero (misma que app.trip_statuses.group_id y
// app.operational_states.group_id) — labels humanos, ids internos ocultos
export const GROUP_OPTIONS = [
  { id: 'en_ruta',    label: 'En Ruta'    },
  { id: 'en_local',   label: 'En Local'   },
  { id: 'retornando', label: 'Retornando' },
  { id: 'cerrado',    label: 'Cerrado'    },
  { id: 'problema',   label: 'Problema'   },
  { id: 'otro',       label: 'Otro'       },
]

export const COLOR_PALETTE = [
  { bg: '#eff6ff', text: '#1d4ed8', label: 'Azul'     },
  { bg: '#f0fdf4', text: '#166534', label: 'Verde'    },
  { bg: '#fef9c3', text: '#854d0e', label: 'Amarillo' },
  { bg: '#fff7ed', text: '#c2410c', label: 'Naranja'  },
  { bg: '#fef2f2', text: '#b91c1c', label: 'Rojo'     },
  { bg: '#f5f3ff', text: '#6d28d9', label: 'Violeta'  },
  { bg: '#ecfdf5', text: '#065f46', label: 'Teal'     },
  { bg: '#f3f4f6', text: '#374151', label: 'Gris'     },
]

export const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

// ── Carga de listas con error visible + reintentar ───────────────────────────

export function useConfigList<T>(fetcher: () => Promise<T[]>) {
  const [items, setItems]     = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetcher()
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Error al cargar'))
      .finally(() => setLoading(false))
  }, [fetcher])

  useEffect(() => { load() }, [load])
  return { items, setItems, loading, error, reload: load }
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) {
    return (
      <div className="space-y-2 py-2" aria-label="Cargando">
        {[0, 1, 2].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
        <p className="text-xs text-red-600 flex-1">{error}</p>
        <button type="button" onClick={onRetry} className="flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:text-red-900">
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    )
  }
  return null
}

// ── Feedback de guardado por fila (check verde efímero + error visible) ──────

export function useRowFeedback() {
  const [saving, setSaving]   = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Record<string, number>>({})
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout) }, [])

  async function run(key: string, fn: () => Promise<void>) {
    setSaving(key)
    setErrors(e => { const n = { ...e }; delete n[key]; return n })
    try {
      await fn()
      setSavedAt(s => ({ ...s, [key]: Date.now() }))
      clearTimeout(timers.current[key])
      timers.current[key] = setTimeout(
        () => setSavedAt(s => { const n = { ...s }; delete n[key]; return n }),
        2000,
      )
    } catch (e) {
      setErrors(prev => ({ ...prev, [key]: e instanceof Error ? e.message : 'Error al guardar' }))
    } finally {
      setSaving(null)
    }
  }

  return { saving, savedAt, errors, run }
}

export function SaveRowButton({
  dirty, saving, saved, onClick,
}: {
  dirty: boolean; saving: boolean; saved: boolean; onClick: () => void
}) {
  if (saved) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-600" role="status">
        <Check size={12} /> Guardado
      </span>
    )
  }
  if (!dirty) return <span className="inline-block w-[70px]" />
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-accent hover:bg-accent/90 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
    >
      {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
      Guardar
    </button>
  )
}

// ── Selector de color por swatches (único sistema del módulo) ─────────────────

export function SwatchPicker({
  bg, text, onPick, name,
}: {
  bg: string; text: string; onPick: (c: { bg: string; text: string }) => void; name: string
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={`Color de ${name}`}>
      {COLOR_PALETTE.map(c => {
        const active = c.bg === bg && c.text === text
        return (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={c.label}
            title={c.label}
            onClick={() => onPick({ bg: c.bg, text: c.text })}
            className={`w-5 h-5 rounded-full border-2 transition-all ${active ? 'border-accent scale-110' : 'border-transparent hover:scale-105'}`}
            style={{ backgroundColor: c.bg }}
          >
            <span className="block w-1.5 h-1.5 rounded-full mx-auto" style={{ backgroundColor: c.text }} />
          </button>
        )
      })}
    </div>
  )
}

// ── Flechas de orden (sort_order editable) ────────────────────────────────────

export function SortArrows({
  onUp, onDown, disabledUp, disabledDown, name,
}: {
  onUp: () => void; onDown: () => void; disabledUp: boolean; disabledDown: boolean; name: string
}) {
  return (
    <div className="flex flex-col">
      <button type="button" onClick={onUp} disabled={disabledUp} aria-label={`Subir ${name}`}
        className="text-gray-300 hover:text-accent disabled:opacity-30 disabled:hover:text-gray-300">
        <ChevronUp size={13} />
      </button>
      <button type="button" onClick={onDown} disabled={disabledDown} aria-label={`Bajar ${name}`}
        className="text-gray-300 hover:text-accent disabled:opacity-30 disabled:hover:text-gray-300">
        <ChevronDown size={13} />
      </button>
    </div>
  )
}
