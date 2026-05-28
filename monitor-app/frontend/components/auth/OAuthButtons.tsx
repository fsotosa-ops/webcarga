'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function OAuthButtons() {
  const supabase = createClient()
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState<'google' | 'azure' | null>(null)

  async function signInWith(provider: 'google' | 'azure') {
    setError(null)
    setLoading(provider)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          ...(provider === 'azure' && { scopes: 'email profile' }),
        },
      })
      if (error) setError(error.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado')
    } finally {
      setLoading(null)
    }
  }

  const Spinner = () => (
    <span className="w-5 h-5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
  )

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-red-500 text-center bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex gap-3">
        {/* Google */}
        <button
          onClick={() => signInWith('google')}
          disabled={loading !== null}
          title="Continuar con Google"
          className="flex-1 flex items-center justify-center h-11 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 active:scale-[0.97] disabled:opacity-50 transition-all duration-150 shadow-sm"
        >
          {loading === 'google' ? <Spinner /> : <GoogleIcon />}
        </button>

        {/* Microsoft */}
        <button
          onClick={() => signInWith('azure')}
          disabled={loading !== null}
          title="Continuar con Microsoft"
          className="flex-1 flex items-center justify-center h-11 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 active:scale-[0.97] disabled:opacity-50 transition-all duration-150 shadow-sm"
        >
          {loading === 'azure' ? <Spinner /> : <MicrosoftIcon />}
        </button>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
