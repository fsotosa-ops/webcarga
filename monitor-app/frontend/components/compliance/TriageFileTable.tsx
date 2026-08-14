'use client'

import { Fragment } from 'react'
import { FileQuestion } from 'lucide-react'
import type { QueueRow } from '@/lib/types'

interface Props {
  rows:        QueueRow[]
  focusedId:   string | null
  selectedIds: Set<string>
  onFocus:     (id: string) => void
  onToggle:    (id: string, opts?: { range?: boolean }) => void
  onToggleAll: () => void
}

/** Panel izquierdo de la bandeja: la cola, como tabla.
 *
 *  Es tabla y no lista porque una columna única de nombres de archivo no se
 *  escanea ni se ordena, y sin eso no hay trabajo masivo posible. La columna
 *  Sugerencia hoy muestra un guion: la llena el agente de clasificación cuando
 *  exista, sobre el mismo contrato — el lugar existe desde ahora para no
 *  rehacer la fila entonces. */
export function TriageFileTable({
  rows, focusedId, selectedIds, onFocus, onToggle, onToggleAll,
}: Props) {
  function handleKey(e: React.KeyboardEvent) {
    if (!rows.length) return
    const i = rows.findIndex(r => r.id === focusedId)
    const cur = i < 0 ? 0 : i

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onFocus(rows[Math.min(cur + 1, rows.length - 1)].id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onFocus(rows[Math.max(cur - 1, 0)].id)
    } else if (e.key === ' ') {
      e.preventDefault()
      onToggle(rows[cur].id, e.shiftKey ? { range: true } : undefined)
    }
  }

  if (!rows.length) {
    return (
      <div className="p-6 text-center">
        <FileQuestion size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No hay documentos sin clasificar</p>
      </div>
    )
  }

  const allSelected = rows.every(r => selectedIds.has(r.id))

  // Las filas ya vienen ordenadas por empresa desde el servidor, así que el
  // encabezado de grupo se emite cuando cambia el nombre.
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = r.carrier_name ?? 'Sin empresa'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  let lastCarrier: string | null = null

  return (
    <table
      className="w-full text-left focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-lg"
      tabIndex={0}
      onKeyDown={handleKey}
    >
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="p-1.5 w-8">
            <input
              type="checkbox"
              aria-label="Seleccionar todos"
              checked={allSelected}
              onChange={onToggleAll}
            />
          </th>
          <th scope="col" className="p-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Archivo</th>
          <th scope="col" className="p-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-semibold w-16">Subido</th>
          <th scope="col" className="p-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-semibold w-32">Sugerencia</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const carrier = r.carrier_name ?? 'Sin empresa'
          const header = carrier !== lastCarrier ? carrier : null
          lastCarrier = carrier
          const focused = r.id === focusedId
          const checked = selectedIds.has(r.id)

          return (
            <Fragment key={r.id}>
              {header && (
                <tr className="bg-gray-50">
                  <td colSpan={4} className="px-1.5 py-1 text-[10px] font-semibold text-gray-500 tracking-wide">
                    {carrier} — {counts.get(carrier)} sin clasificar
                  </td>
                </tr>
              )}
              <tr
                onClick={() => onFocus(r.id)}
                aria-selected={checked}
                className={`cursor-pointer transition-colors ${
                  focused ? 'bg-accent/10' : 'hover:bg-gray-50'
                }`}
              >
                <td className="p-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${r.file_name}`}
                    checked={checked}
                    onChange={() => {}}
                    onClick={e => {
                      e.stopPropagation()
                      onToggle(r.id, e.shiftKey ? { range: true } : undefined)
                    }}
                  />
                </td>
                <td className="p-1.5 text-[11px] font-mono truncate max-w-0">{r.file_name}</td>
                <td className="p-1.5 text-[11px] text-gray-400">
                  {new Date(r.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                </td>
                <td className="p-1.5 text-[11px]">
                  <Suggestion row={r} />
                </td>
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

/** Hoy siempre devuelve un guion: ningún item llega con match. El lugar existe
 *  desde ahora para que la llegada del agente no obligue a rehacer la fila. */
function Suggestion({ row }: { row: QueueRow }) {
  if (row.match_status === 'AMBIGUOUS' && row.candidate_count > 0) {
    return <span className="text-amber-600">{row.candidate_count} posibles</span>
  }
  if (row.suggested_requirement_name) {
    return (
      <span className="text-green-700">
        {row.suggested_requirement_name}
        {row.confidence != null && (
          <span className="text-gray-400 ml-1">{Math.round(row.confidence * 100)}%</span>
        )}
      </span>
    )
  }
  return <span className="text-gray-300">—</span>
}
