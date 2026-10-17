import type { ClosureScope } from '@/lib/types'

/** Si algo del Cierre (un viaje, un aviso) se ve en el alcance elegido (D6): el de
 *  su tracto; sin alcance (un viaje sin tracto, un aviso de empresa) se ve en los dos,
 *  porque es justo lo que hay que resolver. `undefined`: el backend todavía no lo manda. */
export function inScope(scope: ClosureScope | null | undefined, alcance: ClosureScope): boolean {
  return !scope || scope === alcance
}

export type ScopeGap = 'NO_TRACTOR' | 'NO_OPERATION_TYPE'

/** Por qué un viaje no tiene alcance (y se ve en los dos): sin tracto, o con un tracto
 *  del directorio que no tiene tipo de operación (el aviso "Sin tipo de operación" de
 *  Pendientes). Una patente que el directorio no conoce ya lo dice su celda. `null`
 *  si tiene alcance o si el backend todavía no lo manda. */
export function scopeGap(v: { scope?: ClosureScope | null; tractor_plate: string | null; tractor_asset_id?: string | null }): ScopeGap | null {
  if (v.scope !== null) return null
  if (!v.tractor_plate && !v.tractor_asset_id) return 'NO_TRACTOR'
  return v.tractor_asset_id ? 'NO_OPERATION_TYPE' : null
}
