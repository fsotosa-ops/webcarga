import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-sidebar flex items-center justify-center mb-3">
              <span className="text-white font-mulish font-bold text-lg">W</span>
            </div>
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
