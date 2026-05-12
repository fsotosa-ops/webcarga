import type { Trip } from '@/lib/types'
import { createBrowserClient } from '@supabase/ssr'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function getToken(): Promise<string> {
  const sb = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? ''
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `Error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export type TripListResponse = {
  data: Trip[]
  count: number
  page: number
  limit: number
}

export type TripPatch = {
  activo?:         boolean
  trabajando?:     boolean
  asignado?:       boolean
  primera_vuelta?: boolean
  estado_manual?:  string
  locales?:        string
  observaciones?:  string
  comentarios?:    string
}

export const tripsApi = {
  list: (params?: {
    fecha?:       string
    view?:        'en_curso' | 'historial'
    q?:           string
    fecha_desde?: string
    fecha_hasta?: string
    status?:      string
    page?:        number
    limit?:       number
  }) => {
    const qs = new URLSearchParams()
    if (params?.fecha)       qs.set('fecha',       params.fecha)
    if (params?.view)        qs.set('view',        params.view)
    if (params?.q)           qs.set('q',           params.q)
    if (params?.fecha_desde) qs.set('fecha_desde', params.fecha_desde)
    if (params?.fecha_hasta) qs.set('fecha_hasta', params.fecha_hasta)
    if (params?.status)      qs.set('status',      params.status)
    if (params?.page)        qs.set('page',        String(params.page))
    if (params?.limit)       qs.set('limit',       String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TripListResponse>(`/api/v1/trips/${suffix}`)
  },

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
}
