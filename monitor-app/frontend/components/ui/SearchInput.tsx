'use client'

import { forwardRef } from 'react'
import { Search } from 'lucide-react'
import { inputClass } from '@/components/ui/Field'

/** El campo de búsqueda de la app, una sola vez (antes, una copia por lista). */
export const SearchInput = forwardRef<HTMLInputElement, {
  value: string
  onChange: (value: string) => void
  /** El nombre accesible. */
  label: string
  placeholder?: string
  /** `compact` dentro de un panel (un filtro); `default` en una barra. */
  size?: 'default' | 'compact'
  className?: string
}>(function SearchInput({ value, onChange, label, placeholder, size = 'default', className = '' }, ref) {
  const compacto = size === 'compact'
  return (
    <div className={`relative ${className}`}>
      <Search size={compacto ? 12 : 13} aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" />
      <input ref={ref} type="search" value={value} onChange={e => onChange(e.target.value)}
        aria-label={label} placeholder={placeholder}
        className={`w-full ${inputClass({ size: compacto ? 'xs' : 'sm' })} ${compacto ? 'pl-7' : 'pl-8'}`} />
    </div>
  )
})
