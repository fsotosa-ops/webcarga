import { useQuery } from '@tanstack/react-query'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'

/** Los catálogos de `/trips/meta` (estados, zonas, orígenes…). Cambian poco:
 *  una lectura por hora, compartida por todas las pantallas que los usan. */
export function useTripsMeta() {
  return useQuery({ queryKey: ['trips-meta'], queryFn: fetchTripsMeta, staleTime: 60 * 60 * 1000 })
}
