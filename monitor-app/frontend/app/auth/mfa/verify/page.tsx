'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { soloDigitos } from '@/lib/auth/codigo'

/** Segundo paso del ingreso (seguridad, 09/10): la cuenta tiene la
 *  verificación en dos pasos inscrita y la sesión todavía no la pasó. El
 *  layout del dashboard trae acá hasta que la sesión sea aal2. */
export default function MfaVerifyPage() {
  const router = useRouter()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await createClient().auth.mfa.listFactors()
      const totp = data?.totp?.[0]
      if (!totp) { router.replace('/auth/mfa/setup'); return }
      setFactorId(totp.id)
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
        <h2 className="text-base font-semibold text-text-primary">Verificación en dos pasos</h2>
        <p className="text-sm text-informativo">Escribe el código de 6 dígitos que muestra tu app de autenticación.</p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
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
          {enviando ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
