import { PESTANAS_DE_VIAJES } from '@/lib/cierre/gruposDeViajes'
import { EMPTY_VIEW, writeView } from '@/lib/table/viewInUrl'
import type { ClosureScope } from '@/lib/types'

/** La URL del Cierre del Día, en un solo lugar (spec 2026-10-11). Claves y
 *  valores en inglés, como las rutas de la app; lo que se ve, en español. Lee
 *  también la forma vieja en español (?fecha=, ?tab=viajes) y la sub-pestaña de
 *  Viajes de antes (?trips=), que hoy es el filtro de Situación (Cierre con un
 *  solo patrón, spec §4.2). */
export const CIERRE = '/dashboard/operations/closures'

export type PestanaDelCierre = 'fleet' | 'trips' | 'pending' | 'report'
export const PESTANAS_DEL_CIERRE: PestanaDelCierre[] = ['fleet', 'trips', 'pending', 'report']

export type EstadoDeLaUrlDelCierre = {
  date:  string | null
  tab:   PestanaDelCierre | null
  /** Qué se cierra (D1): uno para las cuatro pestañas; Tractoreo si la URL no dice. */
  scope: ClosureScope
}

type Parametros = Pick<URLSearchParams, 'get' | 'toString'>

/** Los valores de la URL vieja, en español. */
const PESTANA_VIEJA: Record<string, PestanaDelCierre> = {
  flota: 'fleet', viajes: 'trips', pendientes: 'pending', reporte: 'report',
}
const CLAVES_VIEJAS = ['fecha', 'viajes', 'trips'] as const
const ALCANCES: ClosureScope[] = ['tractoreo', 'equipo_completo']

function pestanaDe(v: string | null): PestanaDelCierre | null {
  if (v && (PESTANAS_DEL_CIERRE as string[]).includes(v)) return v as PestanaDelCierre
  return (v && PESTANA_VIEJA[v]) || null
}

export function leerUrlDelCierre(params: Parametros): EstadoDeLaUrlDelCierre {
  const scope = params.get('scope')
  return {
    date: params.get('date') ?? params.get('fecha'),
    tab: pestanaDe(params.get('tab')),
    scope: ALCANCES.includes(scope as ClosureScope) ? scope as ClosureScope : 'tractoreo',
  }
}

export function esUrlVieja(params: Parametros): boolean {
  const tab = params.get('tab')
  return CLAVES_VIEJAS.some(c => params.get(c) !== null) || (tab !== null && tab in PESTANA_VIEJA)
}

/** La URL del Cierre con `cambios` aplicados. Conserva los parámetros ajenos y
 *  siempre escribe la forma en inglés. Cambiar de pestaña deja atrás la vista de la
 *  tabla anterior (sus filtros son de OTRA tabla); cambiar de alcance la conserva y
 *  la sección decide qué filtros siguen aplicando (C7). */
export function urlDelCierre(params: Parametros, cambios: Partial<EstadoDeLaUrlDelCierre>): string {
  const antes = leerUrlDelCierre(params)
  const estado = { ...antes, ...cambios }
  const cambiaDePestana = cambios.tab !== undefined && cambios.tab !== antes.tab
  let salida = new URLSearchParams(params.toString())
  // La sub-pestaña vieja de Viajes pasa a ser el filtro de su columna Situación.
  const viejaDeViajes = PESTANAS_DE_VIAJES.find(p => p.id === params.get('trips'))
  if (cambiaDePestana) salida = writeView(salida, EMPTY_VIEW)
  for (const c of [...CLAVES_VIEJAS, 'date', 'tab', 'scope']) salida.delete(c)
  if (estado.date) salida.set('date', estado.date)
  if (estado.tab) salida.set('tab', estado.tab)
  if (estado.scope !== 'tractoreo') salida.set('scope', estado.scope)
  if (viejaDeViajes && !cambiaDePestana) {
    salida = writeView(salida, { ...EMPTY_VIEW, filters: { situation: [viejaDeViajes.etiqueta] } })
  }
  return `${CIERRE}?${salida.toString()}`
}
