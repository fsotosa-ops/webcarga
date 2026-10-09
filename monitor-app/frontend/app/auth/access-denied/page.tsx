'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ShieldOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/** La cuenta inició sesión pero no tiene acceso (seguridad, 09/10).
 *
 *  WebCarga entra solo por invitación: un administrador crea la cuenta en
 *  Configuración › Personas y accesos. Llegan acá:
 *   - una cuenta de Google o Microsoft que nadie invitó (el hook de Supabase
 *     Auth la rechaza y el callback trae el error);
 *   - una sesión sin perfil, o con el perfil desactivado.
 *
 *  Cierra la sesión al cargar: sin eso, /login ve una sesión activa y la
 *  devuelve al dashboard, que la vuelve a mandar acá. */
const MENSAJES: Record<string, { titulo: string; detalle: string }> = {
  deactivated: {
    titulo: 'Tu cuenta está desactivada',
    detalle: 'Si crees que es un error, habla con un administrador de WebCarga.',
  },
  'invalid-link': {
    titulo: 'El enlace ya no sirve',
    detalle:
      'El enlace de la invitación expiró o ya se usó. Entra con Google o Microsoft con el mismo email, o pide al administrador una nueva invitación.',
  },
  'not-invited': {
    titulo: 'Tu cuenta no tiene acceso',
    detalle:
      'WebCarga solo admite cuentas invitadas. Pide a un administrador que te dé acceso con este mismo email.',
  },
}

function Aviso() {
  const reason = useSearchParams().get('reason') ?? 'not-invited'
  const { titulo, detalle } = MENSAJES[reason] ?? MENSAJES['not-invited']

  useEffect(() => {
    void createClient().auth.signOut()
  }, [])

  return (
    <div className="max-w-sm text-center space-y-3">
      <ShieldOff size={28} className="mx-auto text-informativo" aria-hidden="true" />
      <h2 className="text-base font-semibold text-text-primary">{titulo}</h2>
      <p className="text-sm text-informativo">{detalle}</p>
      <Link href="/login" className="inline-block text-sm font-semibold text-accent hover:underline">
        Volver al inicio
      </Link>
    </div>
  )
}

export default function AccessDeniedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-main px-4">
      <Suspense fallback={null}>
        <Aviso />
      </Suspense>
    </main>
  )
}
