'use client'

import { useState } from 'react'
import { Search, Loader2, MapPin } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { locationsApi } from '@/lib/api/locations'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

interface Props {
  /** Nombre del local — texto libre o el nombre exacto de un local real de
   *  public.locations. Elegir una sugerencia solo reemplaza este texto, no
   *  hay ningún otro campo que sincronizar (ver LocationPicker.tsx). */
  value:        string
  onChange:     (name: string) => void
  placeholder?: string
  ariaLabel:    string
  size?:        'sm' | 'md'
}

/** Autocompletado contra public.locations (2026-07-28) — antes el Origen/
 *  Destinos de un viaje manual eran texto 100% libre, sin ninguna relación
 *  con el diccionario real de locales que usa Tarifario. Un operador podía
 *  tipear "CD Puerto Santiago 1" cuando ya existía "CD PUERTO SANTIAGO 1",
 *  generando duplicados. Mismo patrón que ClientPicker: el valor real sigue
 *  siendo texto libre (compatible con el payload de siempre), la búsqueda
 *  solo ofrece reusar un nombre existente en vez de inventar uno nuevo. */
export function LocationPicker({ value, onChange, placeholder, ariaLabel, size = 'md' }: Props) {
  const [open, setOpen] = useState(false)
  const qDebounced = useDebouncedValue(value, 250)

  const locationsQuery = useQuery({
    queryKey: ['locations-picker', qDebounced],
    queryFn: () => locationsApi.list({ q: qDebounced, operational_status: 'ACTIVE', limit: 8 }),
    enabled: open && qDebounced.trim().length >= 2,
  })
  const results = locationsQuery.data?.data ?? []
  const searching = qDebounced.trim().length >= 2

  const inputCls = size === 'sm'
    ? 'w-full text-xs border border-border rounded-lg pl-7 pr-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20'
    : 'w-full text-sm border border-border rounded-lg pl-8 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300'
  const iconSize = size === 'sm' ? 12 : 13

  return (
    <div className="relative">
      <div className="relative">
        <Search size={iconSize} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={inputCls}
        />
      </div>
      {open && searching && (
        <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5 absolute z-10 bg-white w-full shadow-lg">
          {locationsQuery.isFetching && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Buscando…
            </p>
          )}
          {!locationsQuery.isFetching && results.map(loc => (
            <button
              key={loc.id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(loc.name); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
            >
              <MapPin size={12} className="text-gray-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-text-primary truncate">{loc.name}</p>
                {loc.site_number && <p className="text-[10px] text-gray-400 font-mono">{loc.site_number}</p>}
              </div>
            </button>
          ))}
          {!locationsQuery.isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400">Sin locales existentes — se guardará como texto libre</p>
          )}
        </div>
      )}
    </div>
  )
}
