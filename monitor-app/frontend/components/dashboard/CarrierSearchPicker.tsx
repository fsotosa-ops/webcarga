'use client'

import { useState } from 'react'
import { Search, Loader2, Building2 } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import { inputClass } from '@/components/ui/Field'

export type CarrierSearchResult = { id: string; business_name: string; tax_id: string }

interface Props {
  query:           string
  onQueryChange:   (q: string) => void
  /** Puede ser async (ej: cargar el roster antes de confirmar la selección) —
   *  mientras la promesa está pendiente, la fila elegida muestra un spinner y
   *  el resto queda deshabilitado; si rechaza, el error se muestra inline. */
  onPick:          (c: CarrierSearchResult) => void | Promise<void>
  placeholder?:    string
  /** Excluye este id de los resultados (ej: no ofrecer la empresa actual como destino de transferencia) */
  excludeId?:      string
  /** Resalta esta fila como ya elegida sin sacar la lista de la vista (patrón TransferModal) */
  selectedId?:     string | null
  minChars?:       number
  autoFocus?:      boolean
  /** sm = inputs/labels más chicos (uso embebido en panel), md = tamaño estándar de diálogo */
  size?:           'sm' | 'md'
  maxHeightClass?: string
  /** Muestra "Escribe al menos N caracteres…" en vez de no renderizar nada bajo el mínimo */
  showMinCharsHint?: boolean
  helperText?:     React.ReactNode
  /** El `id` del campo de búsqueda, para que una etiqueta de `Field` lo nombre.
   *  Sin él, el campo se nombra solo ("Buscar empresa transportista"). */
  inputId?:        string
  describedBy?:    string
}

export function CarrierSearchPicker({
  query, onQueryChange, onPick, placeholder = 'Buscar empresa (nombre o RUT)…',
  excludeId, selectedId, minChars = 2, autoFocus, size = 'md',
  maxHeightClass = 'max-h-40', showMinCharsHint = false, helperText, inputId, describedBy,
}: Props) {
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [err, setErr]             = useState<string | null>(null)
  const qDebounced = useDebouncedValue(query, 250)

  const searchQuery = useQuery({
    queryKey: ['carriers', 'search-picker', qDebounced],
    queryFn: () => carriersApi.list({ q: qDebounced, limit: 10 }),
    enabled: qDebounced.length >= minChars,
  })
  const results = (searchQuery.data?.data ?? []).filter(c => c.id !== excludeId)

  async function handlePick(c: CarrierSearchResult) {
    setPickingId(c.id); setErr(null)
    try {
      await onPick(c)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al seleccionar la empresa')
    } finally {
      setPickingId(null)
    }
  }

  const inputCls  = size === 'sm'
    ? `w-full ${inputClass({ size: 'sm' })} pl-7`
    : `w-full ${inputClass()} pl-8`
  const iconSize  = size === 'sm' ? 12 : 13
  const nameCls   = size === 'sm' ? 'text-[11px] font-semibold text-text-primary truncate' : 'text-[11px] font-semibold text-text-primary truncate'
  const showList  = showMinCharsHint || query.length >= minChars

  return (
    <div className="relative">
      <div className="relative">
        <Search size={iconSize} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo pointer-events-none" />
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={placeholder}
          id={inputId}
          aria-label={inputId ? undefined : 'Buscar empresa transportista'}
          aria-describedby={describedBy}
          className={inputCls}
        />
      </div>
      {showList && (
        <div className={`${maxHeightClass} overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5`}>
          {query.length < minChars && (
            <p className="px-3 py-6 text-center text-xs text-informativo">Escribe al menos {minChars} caracteres…</p>
          )}
          {query.length >= minChars && searchQuery.isFetching && (
            <p className="px-3 py-2 text-center text-[11px] text-informativo flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Buscando…
            </p>
          )}
          {query.length >= minChars && !searchQuery.isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-center text-[11px] text-informativo">Sin resultados</p>
          )}
          {query.length >= minChars && results.map(c => (
            <button
              key={c.id}
              type="button"
              disabled={pickingId === c.id}
              onClick={() => handlePick({ id: c.id, business_name: c.business_name, tax_id: c.tax_id })}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                selectedId === c.id ? 'bg-accent/10' : 'hover:bg-bg-main'
              }`}
            >
              <Building2 size={12} className="text-informativo shrink-0" />
              <div className="min-w-0 flex-1">
                <p className={nameCls}>{c.business_name}</p>
                <p className="text-etiqueta text-informativo font-mono">{c.tax_id}</p>
              </div>
              {pickingId === c.id && <Loader2 size={11} className="animate-spin shrink-0" />}
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-[11px] text-status-incidente mt-1">{err}</p>}
      {helperText}
    </div>
  )
}
