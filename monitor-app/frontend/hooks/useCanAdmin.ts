'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const ADMIN_ROLES = new Set(['admin', 'owner'])

export function useCanAdmin(): boolean {
  const [canAdmin, setCanAdmin] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])
  return canAdmin
}
