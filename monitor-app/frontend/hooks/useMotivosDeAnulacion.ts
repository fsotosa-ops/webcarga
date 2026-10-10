import { useQuery } from '@tanstack/react-query'
import { taxonomiesApi } from '@/lib/api/config'

/** Un motivo del catálogo TRIP_VOID_REASON. `pideNota`: el comentario es
 *  obligatorio. Lo decide el código (OTRO), no la etiqueta, así renombrar
 *  "Otro" en Configuración no rompe la regla — la misma que aplica el backend
 *  (services/anular_viajes.py). */
export type MotivoDeAnulacion = { id: string; label: string; pideNota: boolean }

export type EleccionDeMotivo = { motivoId: string; nota: string }

/** Los motivos activos de anulación, en el orden de Configuración. */
export function useMotivosDeAnulacion(): { motivos: MotivoDeAnulacion[]; cargando: boolean } {
  const q = useQuery({
    queryKey: ['taxonomies', 'TRIP_VOID_REASON'],
    queryFn: () => taxonomiesApi.list('TRIP_VOID_REASON'),
    staleTime: 5 * 60_000,
  })
  return {
    cargando: q.isLoading,
    motivos: (q.data ?? []).map(r => ({ id: r.id, label: r.label, pideNota: r.code === 'OTRO' })),
  }
}

/** Si la elección alcanza para confirmar: hay motivo y, si lo pide, comentario. */
export function eleccionCompleta(motivos: MotivoDeAnulacion[], e: EleccionDeMotivo): boolean {
  const m = motivos.find(x => x.id === e.motivoId)
  return !!m && (!m.pideNota || e.nota.trim().length > 0)
}
