'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import { useTripsMeta } from '@/hooks/useTripsMeta'
import type { Trip } from '@/lib/types'
import { TripDetailView } from '@/components/dashboard/TripDetailView'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'

export default function TripDetailOverlay() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id) })
  const metaQuery = useTripsMeta()

  function dismiss() { router.back() }

  function handleSaved(updated: Trip) {
    queryClient.setQueryData(['trip', id], updated)
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  return (
    // La ventana del kit (fondo, Escape, foco, Tab y capas: la vista rápida puede
    // abrirse encima). Ocupa la pantalla en el teléfono y deja un margen desde md.
    <Dialog
      label={tripQuery.data ? `Detalle de viaje ${tripQuery.data.source_system_trip_id ?? tripQuery.data.tractor_plate ?? ''}` : 'Detalle de viaje'}
      onClose={dismiss}
      className="inset-0 flex flex-col overflow-hidden bg-white animate-modal-in md:inset-4 md:rounded-2xl md:shadow-2xl"
    >
      {tripQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-dato text-informativo">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Cargando viaje…
        </div>
      ) : tripQuery.isError || !tripQuery.data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-dato text-informativo">No se pudo cargar este viaje.</p>
          <Button variant="link" onClick={dismiss}>Volver a Monitor</Button>
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
    </Dialog>
  )
}
