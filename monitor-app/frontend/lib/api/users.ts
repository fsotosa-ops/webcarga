import type { Profile, UserRole } from '@/lib/types'
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

export type UserPatch = {
  role?:      UserRole
  active?:    boolean
  full_name?: string
}

export const usersApi = {
  list: () =>
    apiFetch<Profile[]>('/api/v1/users'),

  patch: (id: string, body: UserPatch) =>
    apiFetch<Profile>(`/api/v1/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}
