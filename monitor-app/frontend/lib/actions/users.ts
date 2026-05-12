'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types'

export async function createUser(formData: FormData) {
  const email = formData.get('email') as string
  const full_name = formData.get('full_name') as string
  const password = (formData.get('password') as string) || ''
  const role = (formData.get('role') as string) || 'viewer'

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return { error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en el servidor.' }
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    {
      cookies: {
        getAll: async () => (await cookies()).getAll(),
        setAll: async (cookiesToSet) => {
          try {
            const store = await cookies()
            cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options))
          } catch { /* server component */ }
        },
      },
    }
  )

  const createParams: Parameters<typeof supabase.auth.admin.createUser>[0] = {
    email,
    email_confirm: true,
    user_metadata: { full_name },
  }
  if (password) createParams.password = password

  const { data, error } = await supabase.auth.admin.createUser(createParams)

  if (error) return { error: error.message }

  if (data.user) {
    await supabase.from('profiles').update({ role }).eq('id', data.user.id)
  }

  return { success: true }
}

export async function deleteUser(userId: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY no configurada.' }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    {
      cookies: {
        getAll: async () => (await cookies()).getAll(),
        setAll: async () => {},
      },
    }
  )

  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return { error: error.message }
  return { success: true }
}
