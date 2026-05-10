import { Suspense } from 'react'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-sidebar flex items-center justify-center mb-3">
              <span className="text-white font-mulish font-bold text-lg">W</span>
            </div>
            <h1 className="font-mulish font-bold text-xl text-text-primary">Nueva contraseña</h1>
            <p className="text-sm text-gray-400 mt-1">Elige una contraseña segura para tu cuenta</p>
          </div>
          <Suspense fallback={<p className="text-center text-sm text-gray-400">Cargando...</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
