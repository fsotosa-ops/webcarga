import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm'
import LogoWebCarga from '@/components/brand/LogoWebCarga'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center mb-6">
            <LogoWebCarga forma="isotipo" alto={48} className="mb-3" />
            <h1 className="font-mulish font-bold text-xl text-text-primary">Recuperar contraseña</h1>
            <p className="text-sm text-gray-400 mt-1 text-center">
              Te enviaremos un enlace para restablecer tu contraseña
            </p>
          </div>
          <ForgotPasswordForm />
        </div>
      </div>
    </div>
  )
}
