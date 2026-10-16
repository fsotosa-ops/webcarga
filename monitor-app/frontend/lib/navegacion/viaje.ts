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

/** El Monitor filtrado por un texto (RUT o patente): "Ver viajes en el Monitor" de
 *  la ficha de un conductor o un equipo (D4). Abre el historial, no solo lo que
 *  está en curso: la ficha resume sus viajes de 30 días. */
export function monitorSearchHref(q: string): string {
  return `${MONITOR}?tab=historial&q=${encodeURIComponent(q)}`
}

/** El Monitor filtrado por un cliente del directorio, por su id: "Ver en el
 *  Monitor" de la ficha de un cliente (Configuración, Parte 3). */
export function monitorClientHref(shipperId: string): string {
  return `${MONITOR}?tab=historial&client=${encodeURIComponent(shipperId)}`
}

/** Lo que la URL del Monitor abre ya puesto: la pestaña, la búsqueda y el
 *  cliente. Lee lo que escriben los dos enlaces de arriba. */
export function monitorFiltersFromUrl(params: URLSearchParams): {
  tab?: 'historial' | 'en_curso'; q?: string; fClient?: string[]
} {
  const tab = params.get('tab')
  const q = params.get('q')
  const client = params.get('client')
  return {
    ...(tab === 'historial' || tab === 'en_curso' ? { tab } : {}),
    ...(q ? { q } : {}),
    ...(client ? { fClient: client.split(',').filter(Boolean) } : {}),
  }
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
