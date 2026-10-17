'use client'

import { Fragment } from 'react'
import { AlertTriangle, FileQuestion } from 'lucide-react'
import type { QueueRow } from '@/lib/types'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { StatusChip } from '@/components/ui/StatusChip'
import { EntityCell } from '@/components/dashboard/EntityCell'
import type { EntityKind } from '@/lib/api/entitySummary'

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
        <FileQuestion size={20} className="mx-auto text-informativo mb-2" />
        <p className="text-dato text-informativo">Todo asignado</p>
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
      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-lg"
      tabIndex={0}
      onKeyDown={handleKey}
    >
      <thead className="sticky top-0 z-10 bg-bg-main">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pl-3 pr-1 w-9">
            <input
              type="checkbox"
              aria-label="Seleccionar todos"
              checked={allSelected}
              onChange={onToggleAll}
              className="cursor-pointer accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
            />
          </th>
          <th scope="col" className={CABECERA}>Archivo</th>
          <th scope="col" className={`${CABECERA} hidden w-20 !text-right sm:table-cell`}>Subido</th>
          {/* Escalonada: en el teléfono el nombre del archivo conserva su lugar. */}
          <th scope="col" className={`${CABECERA} w-36 sm:w-56 xl:w-72`}>Sugerencia</th>
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
                className={`cursor-pointer transition-colors border-b border-border ${
                  checked ? 'bg-accent/10' : focused ? 'bg-bg-main' : 'hover:bg-bg-main'
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
                    className="cursor-pointer accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-sm"
                    onClick={e => {
                      e.stopPropagation()
                      onToggle(r.id, e.shiftKey ? { range: true } : undefined)
                    }}
                  />
                </td>
                <td className="py-1.5 px-3 max-w-0">
                  <span className="block truncate text-dato text-text-primary">{r.file_name}</span>
                  <Colisiones row={r} />
                </td>
                <td className="hidden py-1.5 px-3 text-dato text-informativo text-right tabular-nums whitespace-nowrap sm:table-cell">
                  {new Date(r.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                </td>
                <td className="py-1.5 px-3 text-dato max-w-0">
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

  // Dentro de la celda del archivo, con su ícono (Entrega 2 de fichas): la franja
  // rosada usaba el rojo de espera, que es solo para "hay archivos esperando".
  return (
    <span className="mt-0.5 block space-y-0.5">
      {avisos.map(aviso => (
        <span key={aviso} className="flex items-center gap-1.5 text-etiqueta text-informativo">
          <AlertTriangle size={11} className="shrink-0 text-warning" aria-hidden="true" />
          {aviso}
        </span>
      ))}
    </span>
  )
}

/** Cuando no hay sugerencia, el clasificador SÍ corrió: buscó una señal en el
 *  nombre del archivo (RUT, patente, nombre de conductor) y no encontró
 *  ninguna. Ese archivo espera una asignación manual. */
const KIND: Record<'CARRIER' | 'DRIVER' | 'ASSET', EntityKind> = { CARRIER: 'carrier', DRIVER: 'driver', ASSET: 'asset' }

function Suggestion({ row }: { row: QueueRow }) {
  if (row.match_status === 'AMBIGUOUS' && row.candidate_count > 0) {
    return <StatusChip tone="warning">{row.candidate_count} posibles</StatusChip>
  }
  const titular = row.suggested_subject_name ?? row.carrier_name
  if (row.suggested_subject_name || row.suggested_requirement_name) {
    // Una línea, sin borde (Entrega 2 de fichas): el requisito, el titular con
    // su vista rápida y el % en gris. El titular sin id resuelto es texto.
    // Sin titular sugerido se muestra la empresa del lote.
    const [kind, id]: [EntityKind, string | null | undefined] = row.suggested_subject_name
      ? [row.suggested_entity_type ? KIND[row.suggested_entity_type] : 'carrier', row.suggested_entity_id]
      : ['carrier', row.carrier_id]
    return (
      <span data-suggestion className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap"
            title={[row.suggested_requirement_name, titular].filter(Boolean).join(' · ')}>
        <span className="min-w-0 truncate">
          {row.suggested_requirement_name}
          {row.suggested_requirement_name && titular && ' · '}
          {titular && <EntityCell kind={kind} id={id} label={titular} />}
        </span>
        {row.confidence != null && (
          <span className="shrink-0 text-etiqueta text-informativo tabular-nums">{Math.round(row.confidence * 100)}%</span>
        )}
      </span>
    )
  }
  return <span className="text-informativo" title="Sin sugerencia — el clasificador no encontró ninguna señal en el nombre del archivo">—</span>
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
