import { apiFetch } from './client'
import type { StatusMeta, OperationalStateMeta, AlertThresholdMeta, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'


export type TripStatusRow = StatusMeta & { sort_order: number }

/** Una posición arriba o una abajo. El destino lo decide la lista, no el
 *  cliente: mandar un `sort_order` calculado acá es lo que dejaba dos filas
 *  con el mismo número cuando la segunda llamada no llegaba. */
export type Direccion = 'up' | 'down'

export const configApi = {
  // ── TMS Statuses (edit only — IDs are fixed by TMS) ──────────────────────
  getStatuses: () =>
    apiFetch<TripStatusRow[]>('/api/v1/config/statuses'),

  patchStatus: (id: string, body: Partial<Pick<StatusMeta, 'label' | 'bg_color' | 'text_color' | 'group'>>) =>
    apiFetch<TripStatusRow>(`/api/v1/config/statuses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  // Devuelve la lista completa ya ordenada: mover cambia el conjunto, no una
  // fila, y el servidor lo hace en UNA transacción.
  moveStatus: (id: string, direction: Direccion) =>
    apiFetch<TripStatusRow[]>(`/api/v1/config/statuses/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),

  // ── Alert thresholds ──────────────────────────────────────────────────────
  getAlertThresholds: () =>
    apiFetch<AlertThresholdMeta[]>('/api/v1/config/alert-thresholds'),

  patchAlertThreshold: (doc_type: string, body: { warning_days?: number; error_days?: number }) =>
    apiFetch<AlertThresholdMeta>(`/api/v1/config/alert-thresholds/${doc_type}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // ── Temperature ranges (CRUD — cargo_type is free text, not a fixed enum) ──
  getTemperatureRanges: () =>
    apiFetch<TemperatureRangeMeta[]>('/api/v1/config/temperature-ranges'),

  createTemperatureRange: (body: TemperatureRangeMeta) =>
    apiFetch<TemperatureRangeMeta>('/api/v1/config/temperature-ranges', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patchTemperatureRange: (cargo_type: string, body: Partial<Pick<TemperatureRangeMeta, 'label' | 'min_c' | 'max_c'>>) =>
    apiFetch<TemperatureRangeMeta>(`/api/v1/config/temperature-ranges/${encodeURIComponent(cargo_type)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteTemperatureRange: (cargo_type: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/config/temperature-ranges/${encodeURIComponent(cargo_type)}`, {
      method: 'DELETE',
    }),

  // ── Reglas de alerta del monitor ──────────────────────────────────────────
  getMonitorAlertRules: () =>
    apiFetch<MonitorAlertRules>('/api/v1/config/monitor-alert-rules'),

  patchMonitorAlertRules: (body: Partial<MonitorAlertRules>) =>
    apiFetch<MonitorAlertRules>('/api/v1/config/monitor-alert-rules', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}

// ── Taxonomías configurables (app.status_taxonomies) ────────────────────────
// Reemplaza el CRUD de operational-states — mismo endpoint genérico sirve
// también EQUIPMENT_STATE (Tarea 7) y DRIVER_REASON (usado solo de lectura
// hoy, vía GET /trips/meta).
export type TaxonomyDomain =
  | 'OPERATIONAL_STATE' | 'DRIVER_REASON' | 'EQUIPMENT_STATE'
  // Los dos de clasificación de vehículos. Existen en la base desde
  // 20260802030000 / 20260803050000 pero el tipo nunca los nombró, porque
  // hasta el Tramo 2 la app sólo los leía.
  | 'FLEET_SERVICE_TYPE' | 'WEBCARGA_OPERATION_TYPE'
  // Por qué WebCarga NO tomó una carga que le ofrecieron (Cierre del Día,
  // paso Viajes) — no confundir con DRIVER_REASON, que responde por qué un
  // conductor faltó. Sembrado en 20260818130000_trip_unassigned_reasons.sql.
  | 'TRIP_UNASSIGNED_REASON'
/** `code` es el identificador ESTABLE de un valor del catálogo, separado del
 *  nombre visible. Lo tienen sólo los vocabularios a los que otras tablas
 *  apuntan por texto —hoy WEBCARGA_OPERATION_TYPE— y por eso es opcional. Es
 *  lo que permite renombrar "Equipo Completo" sin cambiar a qué empresas
 *  alcanza una regla. */
export type TaxonomyRow = OperationalStateMeta & {
  sort_order: number
  active: boolean
  code: string | null
}

export const taxonomiesApi = {
  list: (domain: TaxonomyDomain) =>
    apiFetch<TaxonomyRow[]>(`/api/v1/config/taxonomies?domain=${domain}`),

  create: (body: { domain: TaxonomyDomain; label: string; bg_color: string; text_color: string; sort_order?: number; group?: string }) =>
    apiFetch<TaxonomyRow>('/api/v1/config/taxonomies', {
      method: 'POST',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  patch: (id: string, body: Partial<{ label: string; bg_color: string; text_color: string; active: boolean; group: string }>) =>
    apiFetch<TaxonomyRow>(`/api/v1/config/taxonomies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, group: undefined, group_id: body.group }),
    }),

  // Mueve dentro de SU dominio, en una sola transacción. Devuelve el dominio
  // completo ya ordenado.
  move: (id: string, direction: Direccion) =>
    apiFetch<TaxonomyRow[]>(`/api/v1/config/taxonomies/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),

  // Devuelve cuántas condiciones de documento seguían apuntando al valor. El
  // borrado es lógico, así que ninguna regla se rompe — pero el valor deja de
  // aparecer en las casillas de Condiciones y la regla se ve como "0 marcas"
  // sin serlo, así que quien desactiva tiene que enterarse en el momento.
  deactivate: (id: string) =>
    apiFetch<{ desactivado: boolean; en_uso_por: number }>(
      `/api/v1/config/taxonomies/${id}`, { method: 'DELETE' },
    ),
}

/** Qué gobierna cada dominio de Configuración, en números reales. Las claves
 *  son las del registro de dominios; los pares se dibujan tal cual, así que la
 *  portada no sabe nada de dominios en particular. */
export interface DominioDelInventario {
  pares: { n: number; etiqueta: string }[]
  /** Cuántas decisiones nadie tomó todavía. `null` cuando el dominio no tiene
   *  nada revisable —Personas y accesos—, que NO es lo mismo que cero: un cero
   *  ahí sería otro número con dos significados. */
  revision: { total: number; sin_revisar: number } | null
}

export type InventarioConfig = Record<string, DominioDelInventario>

export const inventarioApi = {
  get: (): Promise<InventarioConfig> => apiFetch<InventarioConfig>('/api/v1/config/inventario'),
}

// ── Registro de revisión ────────────────────────────────────────────────────
// Separa "lo revisamos y va así" de "nadie lo miró todavía", que hasta ahora se
// veían igual: la columna vacía.

export interface Revision {
  element_id:  string
  reviewed_at: string
  reviewed_by: string | null
}

export interface ResultadoDeBusqueda {
  domain:  string
  section: string
  id:      string
  label:   string
  /** Lo que va en la URL para abrir ESTE elemento, que no siempre es el `id`:
   *  Condiciones abre su panel por código (`?doc=MANTENCION_FRIO`), no por
   *  uuid. Lo declara cada sección en el backend, junto a su enumeración. */
  abre:    string
}

export const busquedaConfigApi = {
  /** Busca sobre el CONTENIDO —una condición, un rango, un subtipo—, no sobre
   *  los títulos de las secciones: es lo que hace que el módulo escale a 20 o
   *  200 ajustes. Sale de la misma enumeración que cuenta lo pendiente. */
  buscar: (q: string) =>
    apiFetch<ResultadoDeBusqueda[]>(`/api/v1/config/search?q=${encodeURIComponent(q)}`),
}

export const revisionesApi = {
  /** Los elementos YA revisados de una sección. La lista de elementos la tiene
   *  la pantalla: pedirle al backend que la repita crearía una segunda
   *  definición de qué elementos hay. */
  list: (domain: string, section: string) =>
    apiFetch<Revision[]>(
      `/api/v1/config/reviews?domain=${encodeURIComponent(domain)}&section=${encodeURIComponent(section)}`),

  /** "Lo miré y está bien así" — el único caso que no deja rastro solo.
   *  Guardar un cambio ya cuenta como revisar, y eso lo registra el propio
   *  endpoint que guarda. */
  confirm: (domain: string, section: string, element_id: string) =>
    apiFetch<{ revisado: boolean }>('/api/v1/config/reviews', {
      method: 'POST',
      body: JSON.stringify({ domain, section, element_id }),
    }),
}
