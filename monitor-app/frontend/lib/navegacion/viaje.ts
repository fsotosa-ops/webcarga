import { destinoSeguro } from '@/lib/auth/destino'
import { CIERRE } from './cierre'

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

// La ruta del Cierre vive en su módulo; se re-exporta para quien la importa de acá.
export { CIERRE }

/** Qué dice el vínculo de vuelta del detalle (spec 2026-10-10 §4): adónde lleva,
 *  no un ícono suelto (NN/g). Usa el mismo destino seguro que `volverDesdeElViaje`,
 *  así la etiqueta nunca promete un lugar distinto del que se abre. */
export function etiquetaDeVuelta(next: string | null | undefined): string {
  return volverDesdeElViaje(next).startsWith(CIERRE) ? 'Volver al Cierre' : 'Volver al Monitor'
}
