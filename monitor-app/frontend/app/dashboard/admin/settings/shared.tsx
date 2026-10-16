'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'

export const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

// ── Estado de carga con error visible + reintentar ───────────────────────────

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
