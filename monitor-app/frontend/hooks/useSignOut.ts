import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/** Cerrar la sesión y volver al ingreso. Lo usan la barra lateral y el cajón del teléfono. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter()
  return async () => {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }
}
