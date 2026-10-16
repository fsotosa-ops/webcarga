import type { ClosureScope } from '@/lib/types'

/** Si algo del Cierre (un viaje, un aviso) se ve en el alcance elegido (D6): el de
 *  su tracto; sin alcance (un viaje sin tracto, un aviso de empresa) se ve en los dos,
 *  porque es justo lo que hay que resolver. `undefined`: el backend todavía no lo manda. */
export function inScope(scope: ClosureScope | null | undefined, alcance: ClosureScope): boolean {
  return !scope || scope === alcance
}
