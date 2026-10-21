import { useReasons, type ReasonOption } from '@/hooks/useReasons'

export { eleccionCompleta, type EleccionDeMotivo } from '@/hooks/useReasons'

/** Un motivo del catálogo TRIP_VOID_REASON. */
export type MotivoDeAnulacion = ReasonOption

/** Los motivos activos de anulación, en el orden de Configuración. `OTRO` pide
 *  comentario (services/anular_viajes.py). */
export function useMotivosDeAnulacion(): { motivos: MotivoDeAnulacion[]; cargando: boolean } {
  return useReasons('TRIP_VOID_REASON', { noteCode: 'OTRO' })
}
