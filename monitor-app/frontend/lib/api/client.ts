import { createBrowserClient } from '@supabase/ssr'

const BASE = ''

// Singleton: evita crear un cliente Supabase nuevo en cada request
let sb: ReturnType<typeof createBrowserClient> | null = null

function supabase() {
  sb ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  return sb
}

export async function getToken(): Promise<string> {
  const { data } = await supabase().auth.getSession()
  return data.session?.access_token ?? ''
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken()
  // Con FormData el browser setea el Content-Type (incluye el boundary del multipart)
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
