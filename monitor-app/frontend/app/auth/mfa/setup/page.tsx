'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { soloDigitos } from '@/lib/auth/codigo'

/** Inscribir la verificación en dos pasos (seguridad, 09/10).
 *
 *  Obligatoria para admin y owner: crean usuarios y cambian la configuración,
 *  así que una contraseña o una cuenta de Google robada no debe alcanzar. El
 *  layout del dashboard trae acá a quien tiene esos roles y no la inscribió;
 *  la API (require_admin) exige la sesión verificada (aal2). */
export default function MfaSetupPage() {
  const router = useRouter()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secreto, setSecreto] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const { data: lista } = await supabase.auth.mfa.listFactors()
      if (lista?.totp?.length) { router.replace('/auth/mfa/verify'); return }
      // Un intento anterior sin terminar deja un factor sin verificar con el
      // mismo nombre, y Supabase no deja inscribir otro igual.
      for (const f of lista?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'WebCarga' })
      if (error || !data) { setError(error?.message ?? 'No se pudo iniciar la inscripción'); return }
      setFactorId(data.id)
      setQr(data.totp.qr_code)
      setSecreto(data.totp.secret)
    })()
  }, [router])

  async function verificar(e: React.FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setEnviando(true)
    setError(null)
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: codigo })
    setEnviando(false)
    if (error) { setError('El código no coincide. Revisa la hora del teléfono y vuelve a intentarlo.'); return }
    router.replace('/dashboard/operations/monitor')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-main px-4">
      <form onSubmit={verificar} className="w-full max-w-sm space-y-4 text-center">
        <ShieldCheck size={28} className="mx-auto text-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold text-text-primary">Activa la verificación en dos pasos</h2>
        <p className="text-sm text-informativo">
          Tu rol administra WebCarga. Escanea el código con una app de autenticación (Google Authenticator,
          Microsoft Authenticator o similar) y escribe el código de 6 dígitos que muestra.
        </p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL SVG que entrega Supabase
          <img src={qr} alt="Código QR para la app de autenticación" className="mx-auto w-44 h-44" />
        ) : (
          !error && <p className="text-sm text-informativo">Preparando el código…</p>
        )}
        {qr && (
          <p className="text-xs text-informativo">
            Si recargas esta página, el código QR cambia: borra la entrada anterior de la app y vuelve a escanear.
          </p>
        )}
        {secreto && (
          <p className="text-xs text-informativo break-all">
            Si no puedes escanearlo, ingresa esta clave: <span className="font-mono text-text-primary">{secreto}</span>
          </p>
        )}
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={codigo}
          onChange={e => setCodigo(soloDigitos(e.target.value))}
          aria-label="Código de 6 dígitos"
          className="w-full px-3 py-2 rounded-lg border border-border text-center text-sm tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {error && <p className="text-sm text-status-incidente">{error}</p>}
        <button
          type="submit"
          disabled={!factorId || enviando || codigo.length !== 6}
          className="w-full py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-60"
        >
          {enviando ? 'Verificando…' : 'Activar'}
        </button>
      </form>
    </main>
  )
}
