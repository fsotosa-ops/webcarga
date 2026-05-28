'use client'

import { useState } from 'react'
import LoginForm from '@/components/auth/LoginForm'
import OAuthButtons from '@/components/auth/OAuthButtons'
import RegisterForm from '@/components/auth/RegisterForm'
import Link from 'next/link'

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login')

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 55% 35%, #1a3347 0%, #111d28 55%, #0c1620 100%)' }}
    >
      {/* Grid texture */}
      <div className="fixed inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Glow blob */}
      <div className="fixed pointer-events-none"
        style={{
          top: '10%', left: '55%', transform: 'translateX(-50%)',
          width: 480, height: 480,
          background: 'radial-gradient(circle, rgba(28,185,236,0.08) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      <div className="w-full max-w-[360px] relative z-10">

        {/* Logo mark */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="absolute inset-0 rounded-2xl blur-xl opacity-40"
              style={{ background: 'linear-gradient(135deg, #1cb9ec, #0e8db5)' }}
            />
            <div className="relative w-[52px] h-[52px] rounded-2xl flex items-center justify-center shadow-2xl"
              style={{ background: 'linear-gradient(135deg, #1cb9ec 0%, #0e8db5 100%)' }}
            >
              <span className="text-white font-mulish font-bold text-xl tracking-tight">W</span>
            </div>
          </div>
          <h1 className="font-mulish font-bold text-[22px] text-white tracking-tight leading-none">
            WebCarga
          </h1>
          <p className="text-white/35 text-xs mt-1.5 tracking-wider uppercase">
            Diario 2.0 · Operaciones
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.5)]"
          style={{ background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(20px)' }}
        >
          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {(['login', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3.5 text-[13px] font-semibold transition-all tracking-wide ${
                  tab === t
                    ? 'text-accent border-b-2 border-accent'
                    : 'text-gray-400 hover:text-gray-500 border-b-2 border-transparent'
                }`}
              >
                {t === 'login' ? 'Ingresar' : 'Registrarse'}
              </button>
            ))}
          </div>

          <div className="px-7 py-7">
            {tab === 'login' ? (
              <>
                {/* OAuth — solo iconos */}
                <OAuthButtons />

                {/* Divider */}
                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-100" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[10px] font-semibold text-gray-300 uppercase tracking-[0.15em]">
                      o con email
                    </span>
                  </div>
                </div>

                <LoginForm />

                <p className="text-center mt-4">
                  <Link
                    href="/forgot-password"
                    className="text-[11px] text-gray-400 hover:text-accent transition-colors"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </p>
              </>
            ) : (
              <RegisterForm onSwitchToLogin={() => setTab('login')} />
            )}
          </div>
        </div>

        <p className="text-center text-white/15 text-[11px] mt-6 tracking-wide">
          © {new Date().getFullYear()} WebCarga · Todos los derechos reservados
        </p>
      </div>
    </div>
  )
}
