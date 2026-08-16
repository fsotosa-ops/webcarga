import type { RequirementOption } from '@/lib/types'

const UNIVERSO: Record<string, string> = {
  ASSET:   'Todos los vehículos',
  CARRIER: 'Todas las empresas',
  DRIVER:  'Todos los conductores',
}

const GESTION: Record<string, string> = {
  TRACTOREO:       'Tractoreo',
  EQUIPO_COMPLETO: 'Equipo Completo',
}

/** La regla, en una frase que se lee de un vistazo.
 *
 *  Se DERIVA de la regla, nunca se escribe al lado: si el texto se redactara a
 *  mano quedarian dos fuentes de verdad de la misma condicion, que es el
 *  defecto que costo el critico del Tramo 3. Cuando se agregue una tercera
 *  dimension de condicion, se agrega una rama aca y la tabla no se toca.
 *
 *  Habla SOLO de la condicion. La vigencia es otra columna del catalogo y se
 *  resuelve aparte, en `celdaSeExigeA`. */
export function fraseDeLaRegla(
  r: Pick<RequirementOption,
    'target_entity' | 'applies_to_fleet_service_type_ids' | 'applies_to_management_types'>,
  etiquetaSubtipo: (id: string) => string,
): string {
  const subtipos = r.applies_to_fleet_service_type_ids
  const gestiones = r.applies_to_management_types

  if (subtipos?.length) {
    return subtipos.length === 1
      ? `Sólo ${etiquetaSubtipo(subtipos[0])}`
      : `Sólo ${subtipos.length} subtipos`
  }
  if (gestiones?.length) {
    return gestiones.length === 1
      ? `Sólo ${GESTION[gestiones[0]] ?? gestiones[0]}`
      : 'Tractoreo y Equipo Completo'
  }
  return UNIVERSO[r.target_entity] ?? 'Todas'
}

/** Lo que dice la celda "Se exige a" de una fila: la regla y su alcance.
 *
 *  `alcance.alcanzadas` cuenta LA CONDICION, no la vigencia — es un solo
 *  significado a proposito, y mezclarle la vigencia fabricaria un numero con
 *  dos sentidos, que es un defecto que este proyecto ya tuvo cinco veces. La
 *  consecuencia es que los dos requisitos apagados traen "248 de 248": leido
 *  literal, la fila diria "Todas las empresas · 248 de 248 · Sin vigencia" y se
 *  contradiria sola.
 *
 *  Se resuelve ACA, en la celda, y no en el conteo: una regla sin vigencia no
 *  se le exige a nadie, y su alcance se enuncia en condicional porque es a
 *  cuantos ALCANZARIA si volviera a exigirse. La condicion guardada no se
 *  pierde — sigue en el dato y reaparece en el panel al encenderla. */
export function celdaSeExigeA(
  r: Pick<RequirementOption,
    'target_entity' | 'is_active' | 'alcance' |
    'applies_to_fleet_service_type_ids' | 'applies_to_management_types'>,
  etiquetaSubtipo: (id: string) => string,
): { regla: string; alcance: string } {
  const cuenta = `${r.alcance.alcanzadas} de ${r.alcance.universo}`
  if (!r.is_active) return { regla: 'No se exige', alcance: `Alcanzaría a ${cuenta}` }
  return { regla: fraseDeLaRegla(r, etiquetaSubtipo), alcance: cuenta }
}
