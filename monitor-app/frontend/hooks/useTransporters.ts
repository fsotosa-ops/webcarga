'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { carriersApi, type CarrierListParams } from '@/lib/api/carriers'
import { directoryKeys } from '@/lib/queries/directorio'

/**
 * Lista de empresas vía TanStack Query — mismo patrón que hooks/useTrips.ts.
 * `keepPreviousData`: al cambiar filtros/búsqueda, la data anterior queda
 * visible hasta que llegue la nueva (sin flash de "cargando").
 */
export function useTransporters(params: CarrierListParams) {
  return useQuery({
    queryKey: directoryKeys.carrierList(params),
    queryFn: () => carriersApi.list(params),
    placeholderData: keepPreviousData,
  })
}
