'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { inputClass } from '@/components/ui/Field'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Credenciales incorrectas. Intenta nuevamente.')
      setLoading(false)
      return
    }

    router.push('/dashboard/operations/monitor')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">
          Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={`${inputClass()} w-full`}
          placeholder="usuario@webcarga.cl"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-1">
          Contraseña
        </label>
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          className={`${inputClass()} w-full`}
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p className="text-sm text-status-incidente bg-status-incidente/5 px-3 py-2 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent/90 disabled:opacity-60 transition-colors"
      >
        {loading ? 'Ingresando...' : 'Ingresar'}
      </button>
    </form>
  )
}
