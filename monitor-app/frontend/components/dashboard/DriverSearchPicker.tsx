'use client'

import { Search, Loader2, User } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import { CARRIER_DEACTIVATED_LABEL, isCarrierDeactivated } from '@/lib/states'
import type { DriverPickCandidate } from '@/lib/types'
import { inputClass } from '@/components/ui/Field'

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
        <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Buscar conductor"
          className={`${inputClass({ size: 'sm' })} w-full pl-8`}
        />
      </div>

      {label && (
        <p className="mb-1 mt-2 text-etiqueta font-semibold text-informativo">{label}</p>
      )}

      <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border/60 mt-1.5">
        {searching && searchQuery.isFetching && (
          <p className="flex items-center justify-center gap-1.5 px-3 py-2 text-center text-etiqueta text-informativo">
            <Loader2 size={11} className="animate-spin" /> Buscando…
          </p>
        )}
        {searching && !searchQuery.isFetching && results.length === 0 && (
          <p className="px-3 py-2 text-center text-etiqueta text-informativo">
            Sin resultados en el directorio de Empresas
          </p>
        )}
        {!searching && results.length === 0 && (
          <p className="px-3 py-2 text-center text-etiqueta text-informativo">
            Escribe para buscar…
          </p>
        )}
        {results.map(d => (
          <button
            key={d.driver_id}
            type="button"
            onClick={() => onPick(d)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-main transition-colors"
          >
            <User size={12} aria-hidden="true" className="shrink-0 text-informativo" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-dato font-semibold text-text-primary">{d.driver_name}</p>
              <p className="text-etiqueta text-informativo">
                {d.carrier_name ?? 'Sin empresa'}{d.tractor_plate ? ` · ${d.tractor_plate}` : ''}
                {isCarrierDeactivated(d.carrier_operational_status) && <> · {CARRIER_DEACTIVATED_LABEL}</>}
              </p>
            </div>
            {/* HU-06 (Fase 3): % de similitud — solo presente en sugerencias
                de fuzzy match, nunca en búsqueda manual por texto. */}
            {d.similarity != null && (
              <span className="shrink-0 rounded-full bg-warning/10 px-1.5 py-0.5 text-etiqueta font-bold text-warning">
                {Math.round(d.similarity * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
