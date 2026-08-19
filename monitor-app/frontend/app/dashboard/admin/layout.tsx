import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasRole } from '@/lib/types'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // La comparacion sale de `hasRole` y no se escribe a mano: es la MISMA
  // jerarquia que usan `useCanAdmin` y `useCanEdit`. Este es un server
  // component, asi que no puede usar el hook —que ademas trae la consulta del
  // lado del cliente—, pero la regla es una sola y se comparte igual.
  if (!hasRole(profile?.role, 'admin')) redirect('/dashboard/operations/monitor')

  return <>{children}</>
}
