import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types'

async function getCookieStore() {
  return cookies()
}

function buildCookieHandlers(cookieStore: Awaited<ReturnType<typeof getCookieStore>>) {
  return {
    getAll() {
      return cookieStore.getAll()
    },
    setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
        )
      } catch {
        // Called from Server Component — middleware refreshes the session
      }
    },
  }
}

export async function createClient() {
  const cookieStore = await getCookieStore()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: buildCookieHandlers(cookieStore) }
  )
}

export async function createGoldClient() {
  const cookieStore = await getCookieStore()
  return createServerClient<Database, 'gold'>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: buildCookieHandlers(cookieStore),
      db: { schema: 'gold' },
    }
  )
}
