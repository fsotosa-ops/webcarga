import { useQuery } from '@tanstack/react-query'
import { shippersApi } from '@/lib/api/locations'
import { clientKeys } from '@/lib/queries/clientes'

/** El directorio de clientes con sus cifras: Directorio › Clientes, los
 *  selectores de cliente y el Tarifario leen esta misma caché, y un cambio la
 *  refresca con `invalidateClients`. */
export function useClients() {
  return useQuery({ queryKey: clientKeys.all(), queryFn: () => shippersApi.list() })
}
