'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PasswordStrength, { isPasswordValid, LARGO_MINIMO } from './PasswordStrength'

export default function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Tres entradas (09/10): el enlace del correo ya pasó por /auth/confirm y
  // trae la sesión; un enlace viejo trae `code` (PKCE, solo sirve en el mismo
  // navegador); o la persona la cambia desde el menú con su sesión abierta.
  useEffect(() => {
    const code = searchParams.get('code')
    const entrar = code
      ? supabase.auth.exchangeCodeForSession(code).then(({ error }) => !error)
      : supabase.auth.getUser().then(({ data }) => !!data.user)
    void entrar.then(ok => {
      if (ok) setReady(true)
      else setError('El enlace es inválido o ya expiró. Solicita uno nuevo.')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    if (!isPasswordValid(password)) {
      setError(`La contraseña necesita al menos ${LARGO_MINIMO} caracteres y combinar letras, números o símbolos.`)
      return
    }

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.updateUser({ password })
    // Con verificación en dos pasos inscrita, Supabase exige la sesión
    // verificada (aal2) para cambiar la contraseña: se pide el código y se vuelve.
    if (error && /aal2/i.test(`${error.code ?? ''} ${error.message}`)) {
      router.push('/auth/mfa/verify?next=/auth/reset-password')
      return
    }
    if (error) {
      setError('No se pudo actualizar la contraseña. Intenta nuevamente.')
      setLoading(false)
      return
    }

    setDone(true)
    setTimeout(() => router.push('/dashboard/operations/monitor'), 2000)
  }

  if (done) {
    return (
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-medium text-text-primary">Contraseña actualizada</p>
        <p className="text-sm text-gray-400">Redirigiendo al dashboard...</p>
      </div>
    )
  }

  if (error && !ready) {
    return (
      <div className="text-center space-y-4">
        <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg">{error}</p>
        <Link href="/forgot-password" className="text-sm text-accent hover:underline">
          Solicitar nuevo enlace
        </Link>
      </div>
    )
  }

  if (!ready) {
    return <p className="text-center text-sm text-gray-400">Verificando enlace...</p>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Nueva contraseña</label>
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder={`Mínimo ${LARGO_MINIMO} caracteres`}
        />
        <PasswordStrength password={password} />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">Confirmar contraseña</label>
        <input
          type="password"
          required
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Repite la contraseña"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent/90 disabled:opacity-60 transition-colors"
      >
        {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
      </button>
    </form>
  )
}
