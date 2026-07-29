'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { tripsApi, type TripListResponse } from '@/lib/api/trips'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import type { Trip } from '@/lib/types'
import { TripDetailView } from '@/components/dashboard/TripDetailView'

export default function TripDetailStandalonePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const tripQuery = useQuery({ queryKey: ['trip', id], queryFn: () => tripsApi.get(id) })
  const metaQuery = useQuery({ queryKey: ['trips-meta'], queryFn: fetchTripsMeta, staleTime: 60 * 60 * 1000 })

  function handleSaved(updated: Trip) {
    queryClient.setQueryData(['trip', id], updated)
    queryClient.setQueriesData<TripListResponse>({ queryKey: ['trips'] }, old =>
      old ? { ...old, data: old.data.map(t => (t.id === updated.id ? updated : t)) } : old)
  }

  if (tripQuery.isPending) {
    return (
      <div className="h-screen flex items-center justify-center bg-white text-gray-400 gap-2 text-sm">
        <Loader2 size={16} className="animate-spin" /> Cargando viaje…
      </div>
    )
  }

  if (tripQuery.isError || !tripQuery.data) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white gap-3">
        <p className="text-sm text-gray-500">No se pudo cargar este viaje.</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/operations/monitor')}
          className="text-xs font-semibold text-accent hover:underline"
        >
          Volver a Monitor
        </button>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TripDetailView
        trip={tripQuery.data}
        onSaved={handleSaved}
        onDismiss={() => router.push('/dashboard/operations/monitor')}
        meta={metaQuery.data ?? null}
        focusNotes={searchParams.get('focus') === 'bitacora'}
      />
    </div>
  )
}
