import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { TmsClientListParams } from '@/lib/api/tmsClients'

/**
 * Las claves de caché de Directorio › Clientes (Configuración, Parte 3) y lo
 * que deja obsoleto un cambio en un cliente o en un vínculo del TMS.
 *
 * Los conteos de la lista y de la ficha cuentan nombres del TMS, lugares y
 * empresas: vincular un nombre del TMS o renombrar un cliente los cambia, y el
 * nombre del cliente aparece en los selectores (`shippers`) y en el Tarifario.
 */
export const clientKeys = {
  list:     (params: unknown) => ['clients', params] as const,
  detail:   (id: string) => ['client-detail', id] as const,
  tmsLinks: (params: TmsClientListParams) => ['tms-clients', params] as const,
  /** El directorio de clientes de los selectores (ClientPicker, Tarifario). */
  pickers:  () => ['shippers'] as const,
}

// Los lugares (Tarifario y ficha) también: Origen y Activo cambian los conteos.
const CLIENT_ROOTS: QueryKey[] = [
  ['clients'], ['client-detail'], ['tms-clients'], ['shippers'], ['tarifario-all'], ['tarifario-pending'],
]

export async function invalidateClients(qc: QueryClient): Promise<void> {
  await Promise.all(CLIENT_ROOTS.map(queryKey => qc.invalidateQueries({ queryKey })))
}
