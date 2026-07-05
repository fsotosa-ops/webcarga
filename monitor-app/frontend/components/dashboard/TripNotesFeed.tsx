'use client'

import { useState } from 'react'
import { Loader2, Send, Archive } from 'lucide-react'
import type { Trip } from '@/lib/types'
import { useTripNotes, useAddTripNote } from '@/hooks/useTripNotes'
import { formatRelativeTime, fmtDT } from '@/lib/utils/datetime'

interface Props {
  trip: Trip
}

export function TripNotesFeed({ trip }: Props) {
  const [draft, setDraft] = useState('')
  const notesQuery = useTripNotes(trip.id)
  const addNote    = useAddTripNote(trip.id)

  const legacyText = [trip.observaciones, trip.comentarios]
    .filter(Boolean)
    .join('\n')

  function handleSubmit() {
    const body = draft.trim()
    if (!body || addNote.isPending) return
    addNote.mutate(body, { onSuccess: () => setDraft('') })
  }

  return (
    <div className="space-y-3">
      {/* Feed */}
      <div className="space-y-2.5 max-h-72 overflow-y-auto">
        {legacyText && (
          <div className="bg-gray-50 border border-border/60 rounded-lg px-3 py-2">
            <p className="flex items-center gap-1 text-[9px] text-gray-400 mb-1">
              <Archive size={9} /> Nota anterior (campo legacy, solo lectura)
            </p>
            <p className="text-xs text-gray-500 whitespace-pre-wrap">{legacyText}</p>
          </div>
        )}

        {notesQuery.isPending && (
          <p className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <Loader2 size={10} className="animate-spin" /> Cargando bitácora…
          </p>
        )}
        {notesQuery.error && (
          <p className="text-[10px] text-red-500">
            {notesQuery.error instanceof Error ? notesQuery.error.message : 'Error cargando la bitácora'}
          </p>
        )}
        {notesQuery.data?.length === 0 && !legacyText && (
          <p className="text-[10px] text-gray-300 italic">Sin novedades registradas</p>
        )}

        {(notesQuery.data ?? []).map(note => (
          <div key={note.id} className="bg-white border border-border/60 rounded-lg px-3 py-2">
            <p className="flex items-baseline justify-between gap-2 mb-0.5">
              <span className="text-[10px] font-semibold text-slate-600 truncate">
                {note.author_name ?? 'Usuario'}
              </span>
              <span className="text-[9px] text-gray-300 whitespace-nowrap shrink-0" title={fmtDT(note.created_at)}>
                {formatRelativeTime(note.created_at)}
              </span>
            </p>
            <p className="text-xs text-slate-700 whitespace-pre-wrap">{note.body}</p>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div>
        <textarea
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
          }}
          placeholder="Registrar novedad… (⌘↵ para enviar)"
          className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
        />
        {addNote.error && (
          <p className="text-[10px] text-red-500 mt-1">
            {addNote.error instanceof Error ? addNote.error.message : 'Error al guardar la nota'}
          </p>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={addNote.isPending || !draft.trim()}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 bg-accent text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {addNote.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Agregar nota
        </button>
      </div>
    </div>
  )
}
