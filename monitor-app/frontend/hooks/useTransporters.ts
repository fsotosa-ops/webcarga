'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { transportersApi, type TransporterListParams } from '@/lib/api/transporters'

/**
 * Lista de empresas vía TanStack Query — mismo patrón que hooks/useTrips.ts.
 * `keepPreviousData`: al cambiar filtros/búsqueda, la data anterior queda
 * visible hasta que llegue la nueva (sin flash de "cargando").
 */
export function useTransporters(params: TransporterListParams) {
  return useQuery({
    queryKey: ['transporters', params],
    queryFn: () => transportersApi.list(params),
    placeholderData: keepPreviousData,
  })
}
