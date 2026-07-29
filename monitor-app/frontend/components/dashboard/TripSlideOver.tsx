'use client'

import { useEffect, useRef } from 'react'
import type { Trip, TripsMeta } from '@/lib/types'
import { TripDetailView } from './TripDetailView'

interface Props {
  trip:        Trip | null
  onClose:     () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
}

export function TripSlideOver({ trip, onClose, onSaved, meta, focusNotes = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Semántica de diálogo: Escape cierra, Tab queda atrapado en el panel, el
  // foco vuelve al origen al cerrar — igual que antes de extraer
  // TripDetailView, ver docs/superpowers/plans/2026-07-29-trip-detail-immersive-page-plan.md
  useEffect(() => {
    if (!trip) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [trip?.id, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!trip) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de viaje ${trip.source_system_trip_id ?? trip.tractor_plate ?? ''}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-white md:inset-4 md:rounded-2xl md:shadow-2xl overflow-hidden focus:outline-none animate-modal-in"
      >
        <TripDetailView trip={trip} onSaved={onSaved} onDismiss={onClose} meta={meta} focusNotes={focusNotes} />
      </div>
    </>
  )
}
