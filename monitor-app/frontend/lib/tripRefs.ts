import type { TripRef } from '@/lib/types'

/** Los Nº de viaje de una fila (D8): uno por viaje, el del TMS o, sin él, su id. Son
 *  los valores de la columna "Nº viaje" para filtrar y contar, y lo que entra al Excel. */
export function tripCodes(trips: TripRef[] | undefined): string[] {
  return (trips ?? []).map(t => t.code ?? t.id)
}
