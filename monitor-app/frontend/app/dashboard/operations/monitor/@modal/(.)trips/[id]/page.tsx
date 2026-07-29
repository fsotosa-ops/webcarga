'use client'

import { useEffect, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip } from '@/lib/types'
import { TripDetailView } from '@/components/dashboard/TripDetailView'

export default function TripDetailOverlay() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)

  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id) })
  const metaQuery = useQuery({ queryKey: ['trips-meta'], queryFn: fetchTripsMeta, staleTime: 60 * 60 * 1000 })

  function dismiss() { router.back() }

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { dismiss(); return }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function handleSaved(updated: Trip) {
    queryClient.setQueryData(['trip', id], updated)
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={dismiss} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={tripQuery.data ? `Detalle de viaje ${tripQuery.data.source_system_trip_id ?? tripQuery.data.tractor_plate ?? ''}` : 'Detalle de viaje'}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-white md:inset-4 md:rounded-2xl md:shadow-2xl overflow-hidden focus:outline-none animate-modal-in"
      >
        {tripQuery.isPending ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" /> Cargando viaje…
          </div>
        ) : tripQuery.isError || !tripQuery.data ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-gray-500">No se pudo cargar este viaje.</p>
            <button type="button" onClick={dismiss} className="text-xs font-semibold text-accent hover:underline">
              Volver a Monitor
            </button>
          </div>
        ) : (
          <TripDetailView
            trip={tripQuery.data}
            onSaved={handleSaved}
            onDismiss={dismiss}
            meta={metaQuery.data ?? null}
            focusNotes={searchParams.get('focus') === 'bitacora'}
          />
        )}
      </div>
    </>
  )
}
