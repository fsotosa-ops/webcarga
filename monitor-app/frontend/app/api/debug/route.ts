import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()
  const cookieNames = allCookies.map(c => c.name)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { session } } = await supabase.auth.getSession()
  const { data: { user } } = await supabase.auth.getUser()

  return NextResponse.json({
    cookieCount: allCookies.length,
    cookieNames,
    hasSession: !!session,
    hasUser: !!user,
    tokenPrefix: session?.access_token?.slice(0, 20) ?? null,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    fastapiUrl: process.env.FASTAPI_URL,
  })
}
