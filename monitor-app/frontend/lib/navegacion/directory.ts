/** Las direcciones canónicas del Directorio: una por entidad, que depende solo de
 *  su id (HU 20261011/01). La de un conductor o un equipo resuelve su empresa al
 *  abrirse, así que un enlace guardado sigue sirviendo aunque cambie de empresa. */
import { destinoSeguro } from '@/lib/auth/destino'
import { CIERRE } from './cierre'
import { MONITOR } from './viaje'
import { INSTALLMENTS, POLICIES } from './insurance'

const CARRIERS = '/dashboard/carriers'
const DRIVERS = '/dashboard/drivers'
const ASSETS = '/dashboard/assets'
export const CLIENTS = '/dashboard/clients'

function withReturn(url: string, returnTo?: string): string {
  if (!returnTo) return url
  return `${url}${url.includes('?') ? '&' : '?'}next=${encodeURIComponent(returnTo)}`
}

export const carrierHref = (id: string, returnTo?: string) => withReturn(`${CARRIERS}/${id}`, returnTo)
export const driverHref = (id: string, returnTo?: string) => withReturn(`${DRIVERS}/${id}`, returnTo)
export const assetHref = (id: string, returnTo?: string) => withReturn(`${ASSETS}/${id}`, returnTo)
export const clientHref = (id: string, returnTo?: string) => withReturn(`${CLIENTS}/${id}`, returnTo)

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
  const label = href.startsWith(CIERRE) ? 'Volver al Cierre'
    : href.startsWith(MONITOR) ? 'Volver al Monitor'
    // Las listas del Directorio, con sus filtros (N3, Entrega 1 de fichas).
    : href.startsWith(DRIVERS) ? 'Volver a Conductores'
    : href.startsWith(ASSETS) ? 'Volver a Equipos'
    : href.startsWith(`${CLIENTS}/`) ? 'Volver al cliente'
    : href.startsWith(CLIENTS) ? 'Volver a Clientes'
    : href.startsWith(INSTALLMENTS) ? 'Volver a Cuotas'
    : href.startsWith(`${POLICIES}/policies/`) ? 'Volver a la póliza'
    : href.startsWith(POLICIES) ? 'Volver a Pólizas'
    : href.startsWith(`${CARRIERS}/`) ? 'Volver a la empresa'
    : href.startsWith(CARRIERS) ? 'Volver al Directorio'
    : 'Volver'
  return { href, label }
}
