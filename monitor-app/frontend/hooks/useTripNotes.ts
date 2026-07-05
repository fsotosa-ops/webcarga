'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tripsApi } from '@/lib/api/trips'
import type { TripNote } from '@/lib/types'

export type AddNotePayload = { body: string; note_type?: string; files?: File[] }

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
    mutationFn: (payload: AddNotePayload) => tripsApi.addNote(tripId!, payload),
    onSuccess: created => {
      queryClient.setQueryData<TripNote[]>(['trip-notes', tripId], old =>
        old ? [...old, created] : [created])
    },
  })
}

export function usePinTripNote(tripId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, pinned }: { noteId: string; pinned: boolean }) =>
      tripsApi.pinNote(tripId!, noteId, pinned),
    // Optimista con rollback: el pin es una acción binaria de baja fricción
    onMutate: async ({ noteId, pinned }) => {
      await queryClient.cancelQueries({ queryKey: ['trip-notes', tripId] })
      const prev = queryClient.getQueryData<TripNote[]>(['trip-notes', tripId])
      queryClient.setQueryData<TripNote[]>(['trip-notes', tripId], old =>
        old?.map(n => (n.id === noteId ? { ...n, pinned } : n)))
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['trip-notes', tripId], ctx.prev)
    },
  })
}
