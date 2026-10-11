/** Las direcciones canónicas del Directorio: una por entidad, que depende solo de
 *  su id (HU 20261011/01). La de un conductor o un equipo resuelve su empresa al
 *  abrirse, así que un enlace guardado sigue sirviendo aunque cambie de empresa. */
import { destinoSeguro } from '@/lib/auth/destino'
import { CIERRE } from './cierre'
import { MONITOR } from './viaje'

const CARRIERS = '/dashboard/carriers'
const DRIVERS = '/dashboard/drivers'
const ASSETS = '/dashboard/assets'

function withReturn(url: string, returnTo?: string): string {
  if (!returnTo) return url
  return `${url}${url.includes('?') ? '&' : '?'}next=${encodeURIComponent(returnTo)}`
}

export const carrierHref = (id: string, returnTo?: string) => withReturn(`${CARRIERS}/${id}`, returnTo)
export const driverHref = (id: string, returnTo?: string) => withReturn(`${DRIVERS}/${id}`, returnTo)
export const assetHref = (id: string, returnTo?: string) => withReturn(`${ASSETS}/${id}`, returnTo)

/** La ficha de la empresa con el panel del conductor o del equipo abierto: adonde
 *  lleva la dirección canónica una vez que conoce la empresa. */
export function carrierPanelHref(
  carrierId: string, panel: { kind: 'driver' | 'asset'; id: string }, returnTo?: string,
): string {
  const query = panel.kind === 'driver' ? `tab=conductores&driver=${panel.id}` : `tab=equipos&asset=${panel.id}`
  return withReturn(`${CARRIERS}/${carrierId}?${query}`, returnTo)
}

/** El vínculo de vuelta de una ficha a la que se llegó con `?next=`: adónde lleva y
 *  qué dice (NN/g: el destino, no un ícono suelto). Solo rutas de la app, con el
 *  mismo resguardo que el login; si no, ninguno. */
export function returnLink(next: string | null | undefined): { href: string; label: string } | null {
  const href = destinoSeguro(next, '')
  if (!href) return null
  const label = href.startsWith(CIERRE) ? 'Volver al Cierre' : href.startsWith(MONITOR) ? 'Volver al Monitor' : 'Volver'
  return { href, label }
}
