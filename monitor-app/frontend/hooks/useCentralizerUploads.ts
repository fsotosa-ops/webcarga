'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { centralizerUploadsApi } from '@/lib/api/centralizerUploads'

export function useCentralizerUploads(params?: { page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['centralizer-uploads', params],
    queryFn: () => centralizerUploadsApi.list(params),
  })
}

export function useCentralizerUpload(id: string) {
  return useQuery({
    queryKey: ['centralizer-upload', id],
    queryFn: () => centralizerUploadsApi.get(id),
    enabled: !!id,
  })
}

export function useApproveCentralizerUpload(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => centralizerUploadsApi.approve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}

export function useRejectCentralizerUpload(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reason?: string) => centralizerUploadsApi.reject(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}

export function useApplyCentralizerUpload(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => centralizerUploadsApi.apply(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}
