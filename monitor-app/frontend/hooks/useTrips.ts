'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { tripsApi } from '@/lib/api/trips'

export type TripListParams = NonNullable<Parameters<typeof tripsApi.list>[0]>

const POLL_INTERVAL_MS = 60_000

/**
 * Lista de viajes vía TanStack Query.
 * - `poll: true` refresca cada 60s (solo la vista "En Curso" — Historial no lo necesita).
 * - `keepPreviousData`: al cambiar filtros la data anterior queda visible hasta que llegue la nueva.
 */
export function useTrips(params: TripListParams, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['trips', params],
    queryFn: () => tripsApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: opts.poll ? POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: true,
  })
}
