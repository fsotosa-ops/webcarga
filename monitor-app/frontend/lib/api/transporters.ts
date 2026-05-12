import type {
  TransporterListResponse,
  TransporterProfile,
  TransporterDriver,
  TransporterVehicle,
  TransporterTrailer,
  TransporterContactability,
} from '@/lib/types'
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

export type TransporterPatch = {
  business_name?: string
  rut?: string
  account_stage?: string
  contactability?: TransporterContactability
  drivers?: TransporterDriver[]
  vehicles?: TransporterVehicle[]
  trailers?: TransporterTrailer[]
}

export const transportersApi = {
  list: (params?: { q?: string; stage?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.q)     qs.set('q',     params.q)
    if (params?.stage) qs.set('stage', params.stage)
    if (params?.page)  qs.set('page',  String(params.page))
    if (params?.limit) qs.set('limit', String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return apiFetch<TransporterListResponse>(`/api/v1/transporters/${suffix}`)
  },

  get: (id: string) =>
    apiFetch<TransporterProfile>(`/api/v1/transporters/${id}`),

  patch: (id: string, body: TransporterPatch) =>
    apiFetch<TransporterProfile>(`/api/v1/transporters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  resetField: (id: string, field: string) =>
    apiFetch<{ ok: boolean; field: string }>(`/api/v1/transporters/${id}/overrides/${field}`, {
      method: 'DELETE',
    }),

  addDriver: (id: string, body: { rut: string; name: string }) =>
    apiFetch<{ data: TransporterDriver }>(`/api/v1/transporters/${id}/drivers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeDriver: (id: string, did: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/drivers/${did}`, {
      method: 'DELETE',
    }),

  addVehicle: (id: string, body: { type: string; plate: string }) =>
    apiFetch<{ data: TransporterVehicle }>(`/api/v1/transporters/${id}/vehicles`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeVehicle: (id: string, vid: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/vehicles/${vid}`, {
      method: 'DELETE',
    }),

  addTrailer: (id: string, body: { plate: string }) =>
    apiFetch<{ data: TransporterTrailer }>(`/api/v1/transporters/${id}/trailers`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeTrailer: (id: string, trid: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transporters/${id}/trailers/${trid}`, {
      method: 'DELETE',
    }),
}
