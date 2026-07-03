'use client'

import { LayoutGrid, List } from 'lucide-react'

export type ViewMode = 'tabla' | 'tablero'

interface Props {
  value:    ViewMode
  onChange: (v: ViewMode) => void
}

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex border border-border rounded-lg overflow-hidden text-[11px] font-semibold">
      <button
        type="button"
        onClick={() => onChange('tablero')}
        className={`flex items-center gap-1 px-3 py-1.5 transition-colors ${value === 'tablero' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-50'}`}
      >
        <LayoutGrid size={12} /> Tablero
      </button>
      <button
        type="button"
        onClick={() => onChange('tabla')}
        className={`flex items-center gap-1 px-3 py-1.5 transition-colors border-l border-border ${value === 'tabla' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-50'}`}
      >
        <List size={12} /> Tabla
      </button>
    </div>
  )
}
