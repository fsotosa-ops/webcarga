'use client'

import chileLocations from '@/lib/data/chile-locations.json'

// Generado desde country-state-city (devDependency) por
// scripts/generate-chile-locations.mjs — solo Chile, para no embarcar el
// dataset mundial (~11MB) en el bundle.
type Region = { code: string; name: string; cities: string[] }
export const CHILE_REGIONS = chileLocations as Region[]

const SELECT_SM = 'w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'
const SELECT_MD = 'w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

interface Props {
  region:    string | null
  city:      string | null
  /** Cambiar la región resetea la ciudad */
  onChange:  (region: string | null, city: string | null) => void
  size?:     'sm' | 'md'
  disabled?: boolean
  /** Prefijo para los aria-label (ej: "destino 2") — distingue instancias múltiples */
  labelSuffix?: string
}

/**
 * Par de dropdowns dependientes Región → Ciudad/Comuna de Chile.
 * Valores desconocidos (ej: data vieja o tipeada) se conservan como opción
 * extra para no perderlos al re-guardar.
 */
export function RegionCityPicker({ region, city, onChange, size = 'md', disabled, labelSuffix }: Props) {
  const cls = size === 'sm' ? SELECT_SM : SELECT_MD
  const suffix = labelSuffix ? ` ${labelSuffix}` : ''

  const selectedRegion = CHILE_REGIONS.find(r => r.name === region)
  const cities = selectedRegion?.cities ?? []
  const unknownRegion = !!region && !selectedRegion
  const unknownCity   = !!city && !cities.includes(city)

  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        value={region ?? ''}
        onChange={e => onChange(e.target.value || null, null)}
        aria-label={`Región${suffix}`}
        disabled={disabled}
        className={cls}
      >
        <option value="">— Región…</option>
        {unknownRegion && <option value={region!}>{region}</option>}
        {CHILE_REGIONS.map(r => (
          <option key={r.code} value={r.name}>{r.name}</option>
        ))}
      </select>
      <select
        value={city ?? ''}
        onChange={e => onChange(region, e.target.value || null)}
        aria-label={`Ciudad${suffix}`}
        disabled={disabled || !region}
        className={cls + ' disabled:bg-gray-50 disabled:text-gray-300'}
      >
        <option value="">— Ciudad…</option>
        {unknownCity && <option value={city!}>{city}</option>}
        {cities.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  )
}
