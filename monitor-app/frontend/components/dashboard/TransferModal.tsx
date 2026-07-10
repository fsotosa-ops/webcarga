'use client'

import { useState } from 'react'
import { X, Search, Loader2, Building2, ArrowRightLeft } from 'lucide-react'
import { transportersApi } from '@/lib/api/transporters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'

interface Props {
  open:                  boolean
  title:                 string
  currentTransporterId:  string
  onClose:               () => void
  onTransfer:            (toTransporterId: string) => Promise<void>
}

/** Mini-modal de transferencia (conductor/vehículo → otra empresa) — rol admin.
 *  Busca sobre transportersApi.list y hace POST .../transfer al confirmar. */
export function TransferModal({ open, title, currentTransporterId, onClose, onTransfer }: Props) {
  const [q, setQ]             = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]         = useState<string | null>(null)
  const qDebounced = useDebouncedValue(q, 250)

  const query = useQuery({
    queryKey: ['transporters', 'transfer-search', qDebounced],
    queryFn: () => transportersApi.list({ q: qDebounced, limit: 10 }),
    enabled: open && qDebounced.length >= 2,
  })

  const results = (query.data?.data ?? []).filter(t => t.id !== currentTransporterId)

  if (!open) return null

  async function handleConfirm() {
    if (!selectedId) return
    setSubmitting(true); setErr(null)
    try {
      await onTransfer(selectedId)
      handleClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al transferir')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClose() {
    setQ(''); setSelectedId(null); setErr(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 bg-slate-900 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ArrowRightLeft size={14} /> {title}
          </h3>
          <button onClick={handleClose} className="text-white/50 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              autoFocus
              value={q}
              onChange={e => { setQ(e.target.value); setSelectedId(null) }}
              placeholder="Buscar empresa destino (nombre o RUT)…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="max-h-56 overflow-y-auto border border-border rounded-lg divide-y divide-border/60">
            {q.length < 2 && (
              <p className="px-3 py-6 text-center text-xs text-gray-400">Escribe al menos 2 caracteres…</p>
            )}
            {q.length >= 2 && query.isFetching && (
              <p className="px-3 py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Buscando…
              </p>
            )}
            {q.length >= 2 && !query.isFetching && results.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-gray-400">Sin resultados</p>
            )}
            {results.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  selectedId === t.id ? 'bg-accent/10' : 'hover:bg-gray-50'
                }`}
              >
                <Building2 size={13} className="text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-primary truncate">{t.business_name}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{t.rut ?? '—'}</p>
                </div>
              </button>
            ))}
          </div>

          {err && <p className="text-xs text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={!selectedId || submitting}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Confirmar transferencia'}
            </button>
            <button
              onClick={handleClose}
              className="px-3 py-2 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
