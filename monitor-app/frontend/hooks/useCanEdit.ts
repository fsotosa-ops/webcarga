'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])

export function useCanEdit(): boolean {
  const [canEdit, setCanEdit] = useState(false)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
    })
  }, [])
  return canEdit
}
