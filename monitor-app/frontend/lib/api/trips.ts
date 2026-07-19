import type { Trip, TripCreatePayload, TripNote, AvailableDriver } from '@/lib/types'
import { apiFetch } from './client'

export type TripListResponse = {
  data: Trip[]
  count: number
  page: number
  limit: number
}

export type TripPatch = {
  is_active?:      boolean
  is_working?:     boolean
  is_assigned?:    boolean
  is_first_leg?:   boolean
  manual_status?:  string
  notes?:          string
  comments?:       string
  origin_region?:  string
  origin_city?:    string
  driver_name?:    string
  driver_phone?:   string
  tractor_plate?:  string
  trailer_plate?:  string
  // cag_inicio_at/cag_fin_at removidos (Fase 1, 2026-07-18) — Carga
  // Inicio/Fin se edita vía TripStopPatch sobre la parada ORIGIN, mismo
  // mecanismo que Desc. Inicio/Fin de cualquier destino.
  unassigned_reason_id?: string
}

export type TripStopPatch = {
  desc_inicio?: string
  desc_fin?:    string
}

export type FleetLinkPayload = {
  carrier_id:        string
  driver_id?:        string
  tractor_asset_id?: string
  trailer_asset_id?: string
  tractor_plate?:    string
  trailer_plate?:    string
  driver_name?:      string
}

export const tripsApi = {
  list: (params?: {
    fecha?:          string
    view?:           'en_curso' | 'historial'
    q?:              string
    fecha_desde?:    string
    fecha_hasta?:    string
    status?:         string
    is_active?:      boolean
    is_working?:     boolean
    is_assigned?:    boolean
    second_leg_plus?: boolean
    tms?:            string
    client?:         string
    origin_region?:  string
    origin_city?:    string
    sort?:           'default' | 'status_reported_at_asc' | 'status_reported_at_desc'
    page?:           number
    limit?:          number
  }) => {
    const qs = new URLSearchParams()
    if (params?.fecha)           qs.set('fecha',           params.fecha)
    if (params?.view)            qs.set('view',            params.view)
    if (params?.q)               qs.set('q',               params.q)
    if (params?.fecha_desde)     qs.set('fecha_desde',     params.fecha_desde)
    if (params?.fecha_hasta)     qs.set('fecha_hasta',     params.fecha_hasta)
    if (params?.status)          qs.set('status',          params.status)
    if (params?.tms)             qs.set('tms',             params.tms)
    if (params?.client)          qs.set('client',          params.client)
    if (params?.origin_region)   qs.set('origin_region',   params.origin_region)
    if (params?.origin_city)     qs.set('origin_city',     params.origin_city)
    if (params?.sort)            qs.set('sort',            params.sort)
    if (params?.is_active       != null) qs.set('is_active',       String(params.is_active))
    if (params?.is_working      != null) qs.set('is_working',      String(params.is_working))
    if (params?.is_assigned     != null) qs.set('is_assigned',     String(params.is_assigned))
    if (params?.second_leg_plus != null) qs.set('second_leg_plus', String(params.second_leg_plus))
    if (params?.page)            qs.set('page',            String(params.page))
    if (params?.limit)           qs.set('limit',           String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TripListResponse>(`/api/v1/trips/${suffix}`)
  },

  create: (body: TripCreatePayload) =>
    apiFetch<Trip>('/api/v1/trips', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  bulkCreate: (rows: TripCreatePayload[]) =>
    apiFetch<{ created: number; ids: string[] }>('/api/v1/trips/bulk', {
      method: 'POST',
      body: JSON.stringify(rows),
    }),

  get: (id: string) =>
    apiFetch<Trip>(`/api/v1/trips/${id}`),

  patch: (id: string, body: TripPatch) =>
    apiFetch<Trip>(`/api/v1/trips/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  resetField: (id: string, field: string) =>
    apiFetch<{ ok: boolean; field: string }>(`/api/v1/trips/${id}/overrides/${field}`, {
      method: 'DELETE',
    }),

  patchStop: (id: string, stopId: string, body: TripStopPatch) =>
    apiFetch<Trip>(`/api/v1/trips/${id}/stops/${stopId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  assignFleetLink: (id: string, body: FleetLinkPayload) =>
    apiFetch<Trip>(`/api/v1/trips/${id}/fleet-link`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeFleetLink: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/trips/${id}/fleet-link`, {
      method: 'DELETE',
    }),

  availableDrivers: (fecha: string) =>
    apiFetch<AvailableDriver[]>(`/api/v1/trips/available-drivers?fecha=${encodeURIComponent(fecha)}`),

  listNotes: (id: string) =>
    apiFetch<TripNote[]>(`/api/v1/trips/${id}/notes`),

  addNote: (id: string, payload: { body: string; note_type?: string; files?: File[] }) => {
    const form = new FormData()
    form.set('body', payload.body)
    if (payload.note_type) form.set('note_type', payload.note_type)
    for (const f of payload.files ?? []) form.append('files', f)
    return apiFetch<TripNote>(`/api/v1/trips/${id}/notes`, {
      method: 'POST',
      body: form,
    })
  },

  pinNote: (id: string, noteId: string, pinned: boolean) =>
    apiFetch<{ ok: boolean; pinned: boolean }>(`/api/v1/trips/${id}/notes/${noteId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),
}
