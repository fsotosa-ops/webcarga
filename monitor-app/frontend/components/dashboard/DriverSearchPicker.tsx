'use client'

import { Search, Loader2, User } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import type { DriverPickCandidate } from '@/lib/types'

interface Props {
  query:          string
  onQueryChange:  (q: string) => void
  onPick:         (d: DriverPickCandidate) => void
  /** Mostrado cuando el campo está vacío (ej: conductores disponibles hoy) */
  suggested?:     DriverPickCandidate[]
  suggestedLabel?: string
  placeholder?:   string
  minChars?:      number
  autoFocus?:     boolean
}

export function DriverSearchPicker({
  query, onQueryChange, onPick, suggested = [], suggestedLabel = 'Disponibles hoy',
  placeholder = 'Buscar conductor (nombre o RUT)…', minChars = 2, autoFocus,
}: Props) {
  const qDebounced = useDebouncedValue(query, 250)
  const searching = query.trim().length >= minChars

  const searchQuery = useQuery({
    queryKey: ['drivers', 'search', qDebounced],
    queryFn: () => driversApi.search(qDebounced),
    enabled: searching && qDebounced.trim().length >= minChars,
  })

  const results = searching ? (searchQuery.data ?? []) : suggested
  const label   = searching ? null : (suggested.length > 0 ? suggestedLabel : null)

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar conductor"
          className="w-full text-sm border border-border rounded-lg pl-8 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
        />
      </div>

      {label && (
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-2 mb-1">{label}</p>
      )}

      <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5">
        {searching && searchQuery.isFetching && (
          <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Buscando…
          </p>
        )}
        {searching && !searchQuery.isFetching && results.length === 0 && (
          <p className="px-3 py-2 text-center text-[11px] text-gray-400">
            Sin resultados en el directorio de Empresas
          </p>
        )}
        {!searching && results.length === 0 && (
          <p className="px-3 py-2 text-center text-[11px] text-gray-300 italic">
            Escribe para buscar…
          </p>
        )}
        {results.map(d => (
          <button
            key={d.driver_id}
            type="button"
            onClick={() => onPick(d)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
          >
            <User size={12} className="text-gray-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-text-primary truncate">{d.driver_name}</p>
              <p className="text-[10px] text-gray-400">
                {d.carrier_name ?? 'Sin empresa'}{d.tractor_plate ? ` · ${d.tractor_plate}` : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
