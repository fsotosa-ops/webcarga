import { destinoSeguro } from '@/lib/auth/destino'

/** Abrir el detalle de un viaje y volver a donde se estaba (bug 10/10: desde el
 *  Cierre, cerrar el detalle llevaba siempre al Monitor). La pantalla de origen
 *  viaja en `?next=`, con el mismo resguardo que el login: solo rutas de la app. */
export const MONITOR = '/dashboard/operations/monitor'

export function urlDelViaje(tripId: string, volverA?: string): string {
  const url = `${MONITOR}/trips/${tripId}`
  return volverA ? `${url}?next=${encodeURIComponent(volverA)}` : url
}

export function volverDesdeElViaje(next: string | null | undefined): string {
  return destinoSeguro(next, MONITOR)
}
