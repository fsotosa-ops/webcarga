import { esPestanaDeViajes, type PestanaDeViajes } from '@/lib/cierre/gruposDeViajes'

/** La URL del Cierre del Día, en un solo lugar (spec 2026-10-11). Claves y
 *  valores en inglés, como las rutas de la app; lo que se ve, en español. Lee
 *  también la forma vieja en español (?fecha=, ?tab=viajes) para no romper
 *  marcadores, el historial ni el ?next= del detalle de un viaje. */
export const CIERRE = '/dashboard/operations/closures'

export type PestanaDelCierre = 'fleet' | 'trips' | 'pending' | 'report'
export const PESTANAS_DEL_CIERRE: PestanaDelCierre[] = ['fleet', 'trips', 'pending', 'report']

export type EstadoDeLaUrlDelCierre = {
  date:  string | null
  tab:   PestanaDelCierre | null
  trips: PestanaDeViajes | null
}

type Parametros = Pick<URLSearchParams, 'get' | 'toString'>

/** Los valores de la URL vieja, en español. */
const PESTANA_VIEJA: Record<string, PestanaDelCierre> = {
  flota: 'fleet', viajes: 'trips', pendientes: 'pending', reporte: 'report',
}
const CLAVES_VIEJAS = ['fecha', 'viajes'] as const

function pestanaDe(v: string | null): PestanaDelCierre | null {
  if (v && (PESTANAS_DEL_CIERRE as string[]).includes(v)) return v as PestanaDelCierre
  return (v && PESTANA_VIEJA[v]) || null
}

export function leerUrlDelCierre(params: Parametros): EstadoDeLaUrlDelCierre {
  const trips = params.get('trips')
  return {
    date: params.get('date') ?? params.get('fecha'),
    tab: pestanaDe(params.get('tab')),
    trips: esPestanaDeViajes(trips) ? trips : null,
  }
}

export function esUrlVieja(params: Parametros): boolean {
  const tab = params.get('tab')
  return CLAVES_VIEJAS.some(c => params.get(c) !== null) || (tab !== null && tab in PESTANA_VIEJA)
}

/** La URL del Cierre con `cambios` aplicados. Conserva los parámetros ajenos y
 *  siempre escribe la forma en inglés. */
export function urlDelCierre(params: Parametros, cambios: Partial<EstadoDeLaUrlDelCierre>): string {
  const estado = { ...leerUrlDelCierre(params), ...cambios }
  const salida = new URLSearchParams(params.toString())
  for (const c of [...CLAVES_VIEJAS, 'date', 'tab', 'trips']) salida.delete(c)
  if (estado.date) salida.set('date', estado.date)
  if (estado.tab) salida.set('tab', estado.tab)
  if (estado.trips) salida.set('trips', estado.trips)
  return `${CIERRE}?${salida.toString()}`
}
