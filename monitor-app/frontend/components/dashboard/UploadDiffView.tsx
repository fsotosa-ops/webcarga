'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CentralizerDiff, CentralizerEntityDiff, CentralizerChangeType } from '@/lib/types'

const ENTITY_LABELS = { transporters: 'Empresas', drivers: 'Conductores', vehicles: 'Vehículos' } as const
type EntityKind = keyof typeof ENTITY_LABELS

const BUCKET_TABS: { id: CentralizerChangeType; label: string }[] = [
  { id: 'new',      label: 'Nuevas' },
  { id: 'updated',  label: 'Modificadas' },
  { id: 'conflict', label: 'Conflictos' },
]

function entityLabel(row: CentralizerEntityDiff, kind: EntityKind): string {
  if (kind === 'transporters') return String(row.parsed_row.business_name ?? row.entity_key)
  if (kind === 'drivers')      return String(row.parsed_row.full_name ?? row.entity_key)
  return String(row.parsed_row.plate ?? row.entity_key)
}

function DiffCard({ row, kind }: { row: CentralizerEntityDiff; kind: EntityKind }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-border rounded-xl p-3 mb-2">
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-semibold text-slate-800">{entityLabel(row, kind)}</span>
        <span className="flex items-center gap-2 text-xs text-gray-400">
          {row.field_diffs.length} campo{row.field_diffs.length !== 1 ? 's' : ''}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
          {row.field_diffs.map((fd, i) => (
            <p key={i} className={`text-xs ${fd.conflict ? 'text-red-600' : 'text-gray-600'}`}>
              <span className="font-mono">{fd.field}</span>: {String(fd.old ?? '—')} → {String(fd.new ?? '—')}
              {fd.conflict && ' (conflicto — no se aplica)'}
            </p>
          ))}
          {row.conflict_reason && (
            <p className="text-xs text-red-600 font-semibold">Motivo: {row.conflict_reason}</p>
          )}
        </div>
      )}
    </div>
  )
}

export function UploadDiffView({ diff }: { diff: CentralizerDiff }) {
  const [tab, setTab] = useState<CentralizerChangeType | 'errors'>('new')

  const buckets = useMemo(() => {
    const result: Record<CentralizerChangeType, Partial<Record<EntityKind, CentralizerEntityDiff[]>>> = {
      new: {}, updated: {}, unchanged: {}, conflict: {},
    }
    for (const kind of ['transporters', 'drivers', 'vehicles'] as EntityKind[]) {
      for (const row of diff[kind]) {
        result[row.change_type][kind] ??= []
        result[row.change_type][kind]!.push(row)
      }
    }
    return result
  }, [diff])

  const counts = {
    new:       Object.values(buckets.new).flat().length,
    updated:   Object.values(buckets.updated).flat().length,
    conflict:  Object.values(buckets.conflict).flat().length,
    unchanged: Object.values(buckets.unchanged).flat().length,
    errors:    diff.parse_errors.length,
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="text-xs px-3 py-1.5 rounded-full bg-green-50 border border-green-100 text-green-700 font-semibold">Nuevas {counts.new}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 font-semibold">Modificadas {counts.updated}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-red-50 border border-red-100 text-red-700 font-semibold">Conflictos {counts.conflict}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-gray-400">Sin cambios {counts.unchanged}</span>
        <span className="text-xs px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-gray-400">Errores {counts.errors}</span>
      </div>

      <div className="flex border-b border-border mb-4">
        {[...BUCKET_TABS, { id: 'errors' as const, label: 'Errores' }].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'errors' ? (
        <div className="space-y-1.5">
          {diff.parse_errors.length === 0 && <p className="text-sm text-gray-400">Sin errores de parseo.</p>}
          {diff.parse_errors.map((pe, i) => (
            <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">{pe.sheet}</span>
                {pe.identifier && ` · ${pe.identifier}`}
                {pe.row && ` · fila ${pe.row}`} — {pe.reason}
              </p>
            </div>
          ))}
        </div>
      ) : (
        (['transporters', 'drivers', 'vehicles'] as EntityKind[]).map(kind => {
          const rows = buckets[tab][kind] ?? []
          if (rows.length === 0) return null
          return (
            <div key={kind} className="mb-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                {ENTITY_LABELS[kind]} ({rows.length})
              </p>
              {rows.map(row => <DiffCard key={row.entity_key} row={row} kind={kind} />)}
            </div>
          )
        })
      )}
    </div>
  )
}
