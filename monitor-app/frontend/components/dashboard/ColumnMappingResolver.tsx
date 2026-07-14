'use client'

import { useState } from 'react'
import type { UnresolvedColumn, ComplianceDocCatalogEntry, ColumnMappingResolution } from '@/lib/types'

const SHEET_ENTITY_TYPE = {
  Empresas: 'transporter', Conductores: 'driver', Vehiculos_Equipos: 'vehicle',
} as const

type RowState =
  | { mode: 'unset' }
  | { mode: 'map'; doc_code: string }
  | { mode: 'create'; doc_code: string; label: string }
  | { mode: 'ignore' }

interface Props {
  unresolvedColumns: UnresolvedColumn[]
  catalog:           ComplianceDocCatalogEntry[]
  onSubmit:          (resolutions: ColumnMappingResolution[]) => void
  submitting:        boolean
}

export function ColumnMappingResolver({ unresolvedColumns, catalog, onSubmit, submitting }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(
    () => Object.fromEntries(unresolvedColumns.map(c => [c.header, { mode: 'unset' } as RowState])),
  )

  function setRow(header: string, next: RowState) {
    setRows(prev => ({ ...prev, [header]: next }))
  }

  const allResolved = unresolvedColumns.every(c => {
    const r = rows[c.header]
    if (r.mode === 'unset') return false
    if (r.mode === 'map') return !!r.doc_code
    if (r.mode === 'create') return !!r.doc_code && !!r.label
    return true // ignore
  })

  function handleSubmit() {
    const resolutions: ColumnMappingResolution[] = unresolvedColumns.map(c => {
      const r = rows[c.header]
      if (r.mode === 'map') return { sheet: c.sheet, header: c.header, action: 'map', doc_code: r.doc_code }
      if (r.mode === 'create') return { sheet: c.sheet, header: c.header, action: 'create', doc_code: r.doc_code, label: r.label }
      return { sheet: c.sheet, header: c.header, action: 'ignore' }
    })
    onSubmit(resolutions)
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        {unresolvedColumns.length} columna{unresolvedColumns.length !== 1 ? 's' : ''} nueva{unresolvedColumns.length !== 1 ? 's' : ''} sin resolver.
      </p>
      <div className="space-y-4">
        {unresolvedColumns.map(c => {
          const entityType = SHEET_ENTITY_TYPE[c.sheet]
          const options = catalog.filter(d => d.entity_type === entityType)
          const row = rows[c.header]
          return (
            <div key={c.header} className="border border-border rounded-xl p-4">
              <p className="text-sm font-semibold text-slate-800">{c.header}</p>
              <p className="text-xs text-gray-400 mb-3">hoja {c.sheet}</p>

              {row.mode === 'create' ? (
                <div className="flex gap-2">
                  <input
                    aria-label={`Código para ${c.header}`}
                    placeholder="codigo_snake_case"
                    className="text-sm border border-border rounded-lg px-3 py-2 flex-1"
                    value={row.doc_code}
                    onChange={e => setRow(c.header, { mode: 'create', doc_code: e.target.value, label: row.label })}
                  />
                  <input
                    aria-label={`Etiqueta para ${c.header}`}
                    placeholder="Etiqueta legible"
                    className="text-sm border border-border rounded-lg px-3 py-2 flex-1"
                    value={row.label}
                    onChange={e => setRow(c.header, { mode: 'create', doc_code: row.doc_code, label: e.target.value })}
                  />
                </div>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    aria-label={`Mapeo para ${c.header}`}
                    className="text-sm border border-border rounded-lg px-3 py-2"
                    value={row.mode === 'map' ? row.doc_code : ''}
                    onChange={e => setRow(c.header, { mode: 'map', doc_code: e.target.value })}
                  >
                    <option value="">Mapear a documento existente...</option>
                    {options.map(o => <option key={o.doc_code} value={o.doc_code}>{o.label}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setRow(c.header, { mode: 'create', doc_code: '', label: '' })}
                    className="text-xs font-semibold text-accent hover:text-accent/80"
                  >
                    + Nuevo tipo de documento
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      aria-label={`Ignorar ${c.header}`}
                      checked={row.mode === 'ignore'}
                      onChange={e => setRow(c.header, e.target.checked ? { mode: 'ignore' } : { mode: 'unset' })}
                    />
                    Ignorar
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!allResolved || submitting}
        className="mt-4 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
      >
        {submitting ? 'Aplicando...' : 'Confirmar y continuar'}
      </button>
    </div>
  )
}
