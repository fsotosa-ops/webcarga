import { useQuery } from '@tanstack/react-query'
import type { PermissionCode } from '@/lib/authz/permisos.generated'
import type { NavBadge } from '@/lib/navegacion/menu'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { certificationRequestsApi } from '@/lib/api/certificationRequests'
import { insuranceApi } from '@/lib/api/insurance'
import { clavesCertificacion } from '@/lib/queries/certificacion'

/** Los contadores del menú, una vez: la barra lateral, la barra del teléfono y su cajón los
 *  leen de aquí. Una clave ausente es una cifra que todavía no llega (o que la persona no
 *  puede ver): no se dibuja, porque un "0" en vuelo afirma algo falso. */
export function useNavCounts(permissions: readonly PermissionCode[]): Partial<Record<NavBadge, number>> {
  const puedeClasificar = permissions.includes('documents.review')

  // Cuánto trabajo hay esperando en la bandeja. Se pide con limit=1: de la
  // respuesta solo interesa `total`.
  const inbox = useQuery({
    queryKey: clavesCertificacion.colaTotal(),
    queryFn: () => documentIngestApi.listQueue({ limit: 1 }),
    staleTime: 60_000,
    enabled: puedeClasificar,
  }).data?.total
  // Pedidos de Operaciones (Entrega B): los ve y los resuelve quien revisa documentos.
  const requests = useQuery({
    queryKey: ['certification-requests', 'open'],
    queryFn: () => certificationRequestsApi.listOpen(),
    staleTime: 60_000,
    enabled: puedeClasificar,
  }).data?.total
  // Cuotas de seguro vencidas: la API las cuenta con la fecha de Chile (limit=1:
  // solo interesa la cifra).
  const installments = useQuery({
    queryKey: ['insurance', 'installments', 'overdue-count'],
    queryFn: () => insuranceApi.listInstallments({ state: 'OVERDUE', limit: 1 }),
    staleTime: 60_000,
  }).data?.facets.OVERDUE

  return {
    ...(inbox !== undefined && { inbox }),
    ...(requests !== undefined && { requests }),
    ...(installments !== undefined && { installments }),
  }
}
