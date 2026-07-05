'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tripsApi } from '@/lib/api/trips'
import type { TripNote } from '@/lib/types'

export function useTripNotes(tripId: string | null) {
  return useQuery({
    queryKey: ['trip-notes', tripId],
    queryFn: () => tripsApi.listNotes(tripId!),
    enabled: !!tripId,
  })
}

export function useAddTripNote(tripId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => tripsApi.addNote(tripId!, body),
    onSuccess: created => {
      queryClient.setQueryData<TripNote[]>(['trip-notes', tripId], old =>
        old ? [...old, created] : [created])
    },
  })
}
