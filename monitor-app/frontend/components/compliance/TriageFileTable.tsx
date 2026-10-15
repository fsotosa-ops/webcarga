'use client'

import { Fragment } from 'react'
import { AlertTriangle, FileQuestion } from 'lucide-react'
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
        <p className="text-xs text-gray-500">Todo asignado</p>
      </div>
    )
  }

  const allSelected = rows.every(r => selectedIds.has(r.id))

  // Agrupadas por lo que FALTA (Entrega D): cada grupo pide otra acción. Las filas
  // llegan en ese orden (`ordenarPorLoQueFalta`), así que el encabezado se emite
  // cuando cambia el grupo.
  const counts = new Map<LoQueFalta, number>()
  for (const r of rows) counts.set(loQueFalta(r), (counts.get(loQueFalta(r)) ?? 0) + 1)

  let lastGroup: LoQueFalta | null = null

  return (
    <table
      className="w-full text-left focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-lg"
      tabIndex={0}
      onKeyDown={handleKey}
    >
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pl-3 pr-1 w-9">
            <input
              type="checkbox"
              aria-label="Seleccionar todos"
              checked={allSelected}
              onChange={onToggleAll}
              className="cursor-pointer accent-accent focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-sm"
            />
          </th>
          <th scope="col" className="py-2 px-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Archivo</th>
          <th scope="col" className="py-2 px-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold w-20 text-right">Subido</th>
          <th scope="col" className="py-2 pl-2 pr-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold w-40">Sugerencia</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const group = loQueFalta(r)
          const header = group !== lastGroup ? group : null
          lastGroup = group
          const focused = r.id === focusedId
          const checked = selectedIds.has(r.id)

          return (
            <Fragment key={r.id}>
              {header && (
                <tr className="bg-bg-main">
                  <td colSpan={4} className="px-3 py-1.5 border-y border-border">
                    <span className="text-etiqueta font-bold text-text-primary">{GRUPO[header].titulo}</span>
                    <span className="text-etiqueta text-informativo ml-2 tabular-nums">{counts.get(header)}</span>
                    <span className="text-etiqueta text-informativo ml-2">· {GRUPO[header].ayuda}</span>
                  </td>
                </tr>
              )}
              <tr
                onClick={() => onFocus(r.id)}
                aria-selected={checked}
                // El foco se marcaba SOLO en color -- fondo gris y una barra de
                // acento --, asi que un lector de pantalla no podia decir cual
                // fila esta en juego, que es justo el dato que gobierna el panel
                // derecho. `aria-current` es el atributo para "el elemento
                // actual dentro de un conjunto".
                aria-current={focused ? 'true' : undefined}
                className={`cursor-pointer transition-colors border-b border-gray-100 ${
                  checked ? 'bg-accent/10' : focused ? 'bg-slate-100' : 'hover:bg-gray-50'
                }`}
              >
                <td className="py-1.5 pl-3 pr-1 relative">
                  {focused && (
                    <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" aria-hidden="true" />
                  )}
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${r.file_name}`}
                    checked={checked}
                    onChange={() => {}}
                    className="cursor-pointer accent-accent focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-sm"
                    onClick={e => {
                      e.stopPropagation()
                      onToggle(r.id, e.shiftKey ? { range: true } : undefined)
                    }}
                  />
                </td>
                <td className="py-1.5 px-2 text-[11px] font-mono text-slate-700 truncate max-w-0">{r.file_name}</td>
                <td className="py-1.5 px-2 text-[11px] text-gray-500 text-right tabular-nums whitespace-nowrap">
                  {new Date(r.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                </td>
                <td className="py-1.5 pl-2 pr-3 text-[11px]">
                  <Suggestion row={r} />
                </td>
              </tr>
              <Colisiones row={r} />
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

/** Tres señales distintas, ninguna reemplaza a otra — una fila puede traer
 *  las tres a la vez:
 *
 *  - `mismo_contenido > 1`: el mismo archivo entró más de una vez a la
 *    cola. El operador borra uno. En `null` no se sabe —el item entró sin
 *    hash— y entonces no se dice nada: afirmar "sin colisión" sobre algo que
 *    nadie pudo mirar es la mitad del defecto que la señal vino a arreglar.
 *  - `mismo_casillero > 1`: dos archivos DISTINTOS reclaman el mismo
 *    requisito destino. El operador elige cuál.
 *  - `casillero_ocupado`: mira `compliance_records`, no la cola. El
 *    requisito destino YA tiene un documento vigente — el ocupante fue
 *    confirmado y salió de la cola, así que `mismo_casillero` sigue diciendo
 *    1 y no ve este caso. Confirmar esta fila lo reemplaza (el anterior queda
 *    recuperable, pero quien confirma tiene que enterarse ANTES, no poder
 *    repararlo después). */
function Colisiones({ row }: { row: QueueRow }) {
  const avisos: string[] = []
  if (row.mismo_contenido != null && row.mismo_contenido > 1) avisos.push('Este archivo ya está en la cola')
  if (row.mismo_casillero > 1) avisos.push(`${row.mismo_casillero} archivos reclaman el mismo casillero`)
  if (row.casillero_ocupado) avisos.push('Este requisito ya tiene un documento — confirmar lo reemplaza')

  if (!avisos.length) return null

  return (
    <tr className="bg-espera/5">
      <td colSpan={4} className="pl-3 pr-3 pb-1.5">
        <div className="space-y-0.5">
          {avisos.map(aviso => (
            <p key={aviso} className="flex items-center gap-1.5 text-etiqueta text-espera">
              <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />
              {aviso}
            </p>
          ))}
        </div>
      </td>
    </tr>
  )
}

/** Cuando no hay sugerencia, el clasificador SÍ corrió: buscó una señal en el
 *  nombre del archivo (RUT, patente, nombre de conductor) y no encontró
 *  ninguna. Ese archivo espera una asignación manual. */
function Suggestion({ row }: { row: QueueRow }) {
  if (row.match_status === 'AMBIGUOUS' && row.candidate_count > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium">
        {row.candidate_count} posibles
      </span>
    )
  }
  if (row.suggested_subject_name || row.suggested_requirement_name) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium">
        {[row.suggested_requirement_name, row.suggested_subject_name ?? row.carrier_name].filter(Boolean).join(' · ')}
        {row.confidence != null && (
          <span className="text-emerald-600 tabular-nums">{Math.round(row.confidence * 100)}%</span>
        )}
      </span>
    )
  }
  return <span className="text-gray-500" title="Sin sugerencia — el clasificador no encontró ninguna señal en el nombre del archivo">—</span>
}


/** Lo que le falta a un archivo para poder asignarlo: el grupo de Por asignar. */
export type LoQueFalta = 'listo' | 'titular' | 'tipo' | 'sin_pista'

export function loQueFalta(r: QueueRow): LoQueFalta {
  const tipo = !!r.suggested_requirement_id
  const titular = !!r.suggested_entity_id
  return tipo && titular ? 'listo' : tipo ? 'titular' : titular ? 'tipo' : 'sin_pista'
}

const ORDEN: LoQueFalta[] = ['listo', 'titular', 'tipo', 'sin_pista']

/** El orden de la lista: por grupo, y dentro del grupo como llegan del servidor. */
export function ordenarPorLoQueFalta(rows: QueueRow[]): QueueRow[] {
  return ORDEN.flatMap(g => rows.filter(r => loQueFalta(r) === g))
}

const GRUPO: Record<LoQueFalta, { titulo: string; ayuda: string }> = {
  listo:     { titulo: 'Listos para asignar', ayuda: 'se sabe a quién va y qué es: confírmalo' },
  titular:   { titulo: 'Falta el titular',    ayuda: 'se sabe qué documento es' },
  tipo:      { titulo: 'Falta el tipo',       ayuda: 'se sabe de quién es' },
  sin_pista: { titulo: 'Sin pista',           ayuda: 'el nombre no dice de quién es ni qué es' },
}
