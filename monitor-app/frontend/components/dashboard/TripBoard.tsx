'use client'

import { useState } from 'react'
import {
  DndContext, useDraggable, useDroppable,
  PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { GripVertical, Loader2, X } from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { TripCard } from './TripCard'

interface Group {
  id:       string
  label:    string
  statuses: string[]
}

interface Props {
  trips:               Trip[]
  groups:              Group[]
  meta?:               TripsMeta | null
  onSaved:             (t: Trip) => void
  onSelect:            (t: Trip) => void
  onSelectFocusNotes:  (t: Trip) => void
  updatedIds?: Set<string>
}

/** Grupo del tablero de un viaje — resuelve AMBOS vocabularios:
 *  manual_status (estados operacionales) y current_status (estados TMS).
 *  Antes un override manual no matcheaba ningún grupo y caía a "Otro". */
export function groupOfTrip(trip: Trip, meta: TripsMeta | null | undefined, groups: Group[]): string {
  if (trip.manual_status) {
    const op = meta?.operational_states.find(s => s.id === trip.manual_status)
    if (op?.group) return op.group
  }
  const status = trip.manual_status ?? trip.current_status ?? ''
  const tms = meta?.statuses.find(s => s.id === status)
  if (tms?.group) return tms.group
  // Fallback para meta ausente: membresía por lista de estados del grupo
  const byList = groups.find(g => g.statuses.includes(status))
  return byList?.id ?? 'otro'
}

function DraggableCard({ trip, children }: { trip: Trip; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: trip.id,
    data: { trip },
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`relative group/card ${isDragging ? 'opacity-80 z-30 shadow-xl rotate-1' : ''}`}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
    >
      <GripVertical
        size={11}
        className="absolute right-1.5 top-1.5 text-gray-400 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none"
        aria-hidden="true"
      />
      {children}
    </div>
  )
}

function Column({
  group, count, isValidTarget, children,
}: {
  group: Group; count: number; isValidTarget: boolean; children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id, disabled: !isValidTarget })
  return (
    <div
      ref={setNodeRef}
      className={`flex-none w-[220px] rounded-xl p-2 transition-colors ${
        isOver && isValidTarget ? 'bg-accent/10 ring-2 ring-accent/40' : 'bg-gray-50'
      } ${!isValidTarget ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-etiqueta font-bold text-gray-500 uppercase tracking-wide">{group.label}</span>
        <span className="text-etiqueta text-gray-400">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function TripBoard({ trips, groups, meta, onSaved, onSelect, onSelectFocusNotes, updatedIds }: Props) {
  const [dragging, setDragging] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [moveErr, setMoveErr]   = useState<string | null>(null)
  // Drop en un grupo con varios estados operacionales → el operador elige cuál
  const [choice, setChoice] = useState<{ trip: Trip; groupId: string } | null>(null)

  const sensors = useSensors(
    // distance: distingue click (abre detalle) de drag — sin handle dedicado
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const opStatesOf = (groupId: string) =>
    (meta?.operational_states ?? []).filter(s => (s.group ?? 'otro') === groupId)

  const byGroup: Record<string, Trip[]> = { otro: [] }
  for (const g of groups) byGroup[g.id] = byGroup[g.id] ?? []
  for (const trip of trips) {
    const gid = groupOfTrip(trip, meta, groups)
    ;(byGroup[gid] ?? byGroup['otro']).push(trip)
  }

  // Columna "Otro" sintética solo cuando hace falta (viajes sin grupo)
  const hasOtroGroup = groups.some(g => g.id === 'otro')
  const allGroups = !hasOtroGroup && byGroup['otro'].length > 0
    ? [...groups, { id: 'otro', label: 'Otro', statuses: [] }]
    : groups

  async function applyMove(trip: Trip, manualStatusId: string) {
    const original = trip
    setSavingId(trip.id)
    setMoveErr(null)
    // Optimista: la tarjeta salta a la columna destino de inmediato
    onSaved({ ...trip, manual_status: manualStatusId })
    try {
      const updated = await tripsApi.patch(trip.id, { manual_status: manualStatusId } as TripPatch)
      onSaved(updated)
    } catch (e) {
      onSaved(original)  // rollback
      setMoveErr(e instanceof Error ? e.message : 'Error al mover el viaje')
    } finally {
      setSavingId(null)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false)
    const trip = event.active.data.current?.trip as Trip | undefined
    const targetGroup = event.over?.id as string | undefined
    if (!trip || !targetGroup) return
    if (groupOfTrip(trip, meta, groups) === targetGroup) return

    const candidates = opStatesOf(targetGroup)
    if (candidates.length === 0) return
    if (candidates.length === 1) {
      applyMove(trip, candidates[0].id)
    } else {
      setChoice({ trip, groupId: targetGroup })
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => { setDragging(true); setMoveErr(null) }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(false)}
    >
      {moveErr && (
        <div className="mb-2 flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 text-dato rounded-lg px-3 py-2">
          <span className="flex-1">{moveErr}</span>
          <button type="button" onClick={() => setMoveErr(null)} aria-label="Cerrar error"><X size={12} /></button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {allGroups.map(g => {
          const colTrips = byGroup[g.id] ?? []
          // Durante el drag, solo son destino válido las columnas con al menos
          // un estado operacional asignable
          const isValidTarget = !dragging || opStatesOf(g.id).length > 0
          return (
            <Column key={g.id} group={g} count={colTrips.length} isValidTarget={isValidTarget}>
              {colTrips.map(trip => (
                <DraggableCard key={trip.id} trip={trip}>
                  {savingId === trip.id && (
                    <span className="absolute left-1.5 top-1.5 z-10">
                      <Loader2 size={11} className="animate-spin text-accent" />
                    </span>
                  )}
                  <TripCard trip={trip} meta={meta} onSaved={onSaved} onSelect={onSelect}
                    onSelectFocusNotes={onSelectFocusNotes} updated={updatedIds?.has(trip.id)} />
                </DraggableCard>
              ))}
              {colTrips.length === 0 && (
                <p className="text-etiqueta text-gray-400 text-center py-4">Sin viajes</p>
              )}
            </Column>
          )
        })}
      </div>

      {/* Selección de estado cuando el grupo destino tiene varios */}
      {choice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-backdrop-in"
          onClick={() => setChoice(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Elegir estado operativo"
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-xl shadow-2xl p-4 w-72 space-y-2 animate-modal-in"
          >
            <p className="text-dato font-semibold text-text-primary">
              ¿A qué estado pasa {choice.trip.tractor_plate ?? 'el viaje'}?
            </p>
            <div className="space-y-1">
              {opStatesOf(choice.groupId).map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { applyMove(choice.trip, s.id); setChoice(null) }}
                  className="w-full text-left px-3 py-2 rounded-lg text-dato font-semibold hover:bg-gray-50 border border-transparent hover:border-border transition-colors"
                  style={{ backgroundColor: s.bg_color, color: s.text_color }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setChoice(null)}
              className="w-full text-center text-etiqueta text-gray-400 hover:text-gray-500 pt-1">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </DndContext>
  )
}
