import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { EmailOtpType } from '@supabase/supabase-js'

/** Enlace de los correos de Supabase Auth (invitación, 09/10).
 *
 *  Patrón de Supabase para apps con servidor: la plantilla del correo apunta
 *  acá con `token_hash` y `type`, y el servidor valida el token y deja la
 *  sesión en las cookies. El enlace por defecto de Supabase devuelve los
 *  tokens en el fragmento (#) de la URL, que un route handler no ve.
 *
 *  Plantilla "Invite user" (panel de Supabase › Authentication › Emails):
 *    {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  // Cloud Run: request.url trae la dirección interna; el origen público viene
  // en x-forwarded-host (mismo criterio que /auth/callback).
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https'
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin

  if (tokenHash && type) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          },
        },
      }
    )
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(`${origin}/dashboard/operations/monitor`)
  }

  return NextResponse.redirect(`${origin}/auth/access-denied?reason=invalid-link`)
}
