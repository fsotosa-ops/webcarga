import { createBrowserClient } from '@supabase/ssr'

const BASE = ''

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

export type FilterGroup = {
  id:         string
  name:       string
  statuses:   string[]
  color:      GroupColor
  created_at: string
  updated_at: string
}

export type GroupColor = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'teal' | 'amber' | 'pink' | 'slate'

export const filterGroupsApi = {
  list: () =>
    apiFetch<FilterGroup[]>('/api/v1/filter-groups'),

  create: (body: { name: string; statuses: string[]; color: GroupColor }) =>
    apiFetch<FilterGroup>('/api/v1/filter-groups', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; statuses?: string[]; color?: GroupColor }) =>
    apiFetch<FilterGroup>(`/api/v1/filter-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/filter-groups/${id}`, { method: 'DELETE' }),
}
