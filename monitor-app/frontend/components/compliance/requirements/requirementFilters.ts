/** Los filtros de Certificación › Documentos exigidos (Configuración, Parte 2).
 *
 *  Funciones puras: la lista llega entera (114 documentos, una consulta) y se
 *  cuenta aquí, así la cifra de cada filtro es siempre la de lo que se ve. */
import type { RequirementOption } from '@/lib/types'

export type EntityFilter = 'todos' | RequirementOption['target_entity']
export type StateFilter = 'todos' | 'sin-revisar' | 'con-condicion' | 'mensuales' | 'sin-vigencia'

export const ENTITY_FILTERS: { id: EntityFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'CARRIER', label: 'Empresa' },
  { id: 'DRIVER', label: 'Conductor' },
  { id: 'ASSET', label: 'Equipo' },
]

export const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'sin-revisar', label: 'Sin revisar' },
  { id: 'con-condicion', label: 'Con condición' },
  { id: 'mensuales', label: 'Mensuales' },
  { id: 'sin-vigencia', label: 'Sin vigencia' },
]

/** Períodos de un mes (F30, cotizaciones): un trimestral no es mensual. */
export function esMensual(r: RequirementOption): boolean {
  return r.expiration_policy === 'CALENDAR_PERIOD' && r.vigencia?.frequency_months === 1
}

export function tieneCondicion(r: RequirementOption): boolean {
  return Boolean(r.applies_to_fleet_service_type_ids?.length || r.applies_to_management_types?.length)
}

/** "Sin vigencia" es `!is_active`: el documento no se le exige a nadie. Es la
 *  palabra que la pantalla ya usaba; el 16/10 eran 77, 75 de ellos el catálogo
 *  cargado apagado el 09/10. */
export function matchesState(r: RequirementOption, state: StateFilter, sinRevisar: (id: string) => boolean): boolean {
  switch (state) {
    case 'todos': return true
    case 'sin-revisar': return sinRevisar(r.id)
    case 'con-condicion': return tieneCondicion(r)
    case 'mensuales': return esMensual(r)
    case 'sin-vigencia': return !r.is_active
  }
}

export function matchesSearch(r: RequirementOption, q: string): boolean {
  const t = q.trim().toLowerCase()
  return !t || `${r.name} ${r.requirement_code}`.toLowerCase().includes(t)
}

export function isEntityFilter(v: string | null): v is EntityFilter {
  return ENTITY_FILTERS.some(f => f.id === v)
}

export function isStateFilter(v: string | null): v is StateFilter {
  return STATE_FILTERS.some(f => f.id === v)
}
