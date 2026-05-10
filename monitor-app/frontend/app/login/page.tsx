'use client'

import { useState } from 'react'
import LoginForm from '@/components/auth/LoginForm'
import OAuthButtons from '@/components/auth/OAuthButtons'
import RegisterForm from '@/components/auth/RegisterForm'
import Link from 'next/link'

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login')

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at 60% 40%, #1e3448 0%, #182635 50%, #111d28 100%)' }}
    >
      {/* Subtle grid texture overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="w-full max-w-[380px] relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #1cb9ec 0%, #0e8db5 100%)' }}
          >
            <span className="text-white font-mulish font-bold text-xl">W</span>
          </div>
          <h1 className="font-mulish font-bold text-2xl text-white tracking-tight">WebCarga</h1>
          <p className="text-white/40 text-sm mt-1">Diario 2.0 · Operaciones</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setTab('login')}
              className={`flex-1 py-3.5 text-sm font-medium transition-all ${
                tab === 'login'
                  ? 'text-accent border-b-2 border-accent bg-accent/3'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Ingresar
            </button>
            <button
              onClick={() => setTab('register')}
              className={`flex-1 py-3.5 text-sm font-medium transition-all ${
                tab === 'register'
                  ? 'text-accent border-b-2 border-accent bg-accent/3'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Registrarse
            </button>
          </div>

          <div className="p-7">
            {tab === 'login' ? (
              <>
                <LoginForm />

                <p className="text-center mt-4">
                  <Link href="/forgot-password" className="text-xs text-gray-400 hover:text-accent transition-colors">
                    ¿Olvidaste tu contraseña?
                  </Link>
                </p>

                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-100" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[11px] text-gray-400 uppercase tracking-widest">o</span>
                  </div>
                </div>

                <OAuthButtons />
              </>
            ) : (
              <RegisterForm onSwitchToLogin={() => setTab('login')} />
            )}
          </div>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          © {new Date().getFullYear()} WebCarga — Todos los derechos reservados
        </p>
      </div>
    </div>
  )
}
