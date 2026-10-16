import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { TmsClientListParams } from '@/lib/api/tmsClients'

/**
 * Las claves de caché de Directorio › Clientes (Configuración, Parte 3) y lo
 * que deja obsoleto un cambio en un cliente o en un vínculo del TMS.
 *
 * Los conteos de la lista y de la ficha cuentan nombres del TMS, lugares y
 * empresas: vincular un nombre del TMS o renombrar un cliente los cambia, y el
 * nombre del cliente aparece en los selectores y en el Tarifario.
 */
export const clientKeys = {
  /** Todos los clientes con sus cifras (`useClients`): la lista y los selectores. */
  all:      () => ['clients'] as const,
  detail:   (id: string) => ['client-detail', id] as const,
  tmsLinks: (params: TmsClientListParams) => ['tms-clients', params] as const,
}

// Los lugares (Tarifario y ficha) también: Origen y Activo cambian los conteos. Y
// las empresas filtradas por cliente (pestaña Empresas de la ficha, raíz `carriers`):
// vincular un cliente desde la ficha de la empresa las cambia.
const CLIENT_ROOTS: QueryKey[] = [
  ['clients'], ['client-detail'], ['tms-clients'], ['tarifario-all'], ['tarifario-pending'], ['carriers'],
]

export async function invalidateClients(qc: QueryClient): Promise<void> {
  await Promise.all(CLIENT_ROOTS.map(queryKey => qc.invalidateQueries({ queryKey })))
}
