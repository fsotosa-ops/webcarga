import type { RequirementOption } from '@/lib/types'

const UNIVERSO: Record<string, string> = {
  ASSET:   'Todos los vehículos',
  CARRIER: 'Todas las empresas',
  DRIVER:  'Todos los conductores',
}

/** Cómo se nombra cada dimensión de la condición, y cuántos valores tiene.
 *
 *  Las etiquetas VIENEN DEL CATÁLOGO, no de un mapa escrito acá. El de tipos
 *  de gestión estaba copiado en tres lugares del frontend más la función de
 *  Postgres, y renombrar uno en Configuración dejaba las cuatro copias
 *  diciendo cosas distintas — la de Postgres, además, en silencio y cambiando
 *  a qué empresas alcanzaba la regla. */
export interface Vocabulario {
  /** Etiqueta de un subtipo de vehículo, por su id. */
  subtipo:        (id: string) => string
  totalSubtipos:  number
  /** Etiqueta de un tipo de gestión, por su CÓDIGO estable. */
  gestion:        (code: string) => string
  totalGestiones: number
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
  vocabulario: Vocabulario,
): string {
  const subtipos = r.applies_to_fleet_service_type_ids
  const gestiones = r.applies_to_management_types

  if (subtipos?.length) {
    if (subtipos.length === 1) return `Sólo ${vocabulario.subtipo(subtipos[0])}`
    // "Sólo 9" cuando el catálogo tiene 10 SUBESTIMA: se lee como una
    // restricción fuerte y en realidad excluye uno solo. Con el total a la
    // vista la fila se lee igual que la columna de al lado ("36 de 118").
    // Sin catálogo cargado no hay total que enunciar: "9 de 0" seria peor que
    // no decirlo.
    return vocabulario.totalSubtipos > 0
      ? `${subtipos.length} de ${vocabulario.totalSubtipos} subtipos`
      : `Sólo ${subtipos.length} subtipos`
  }
  if (gestiones?.length) {
    // Mismo par de formas que los subtipos, por la misma razón: una regla que
    // marca todas las gestiones menos una no es una restricción fuerte, y
    // "Sólo 1" tiene que decir cuál.
    if (gestiones.length === 1) return `Sólo ${vocabulario.gestion(gestiones[0])}`
    return vocabulario.totalGestiones > 0
      ? `${gestiones.length} de ${vocabulario.totalGestiones} tipos de gestión`
      : `Sólo ${gestiones.length} tipos de gestión`
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
  vocabulario: Vocabulario,
): { regla: string; alcance: string } {
  const cuenta = `${r.alcance.alcanzadas} de ${r.alcance.universo}`
  if (!r.is_active) return { regla: 'No se exige', alcance: `Alcanzaría a ${cuenta}` }
  return { regla: fraseDeLaRegla(r, vocabulario), alcance: cuenta }
}
