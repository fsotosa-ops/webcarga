import Link from 'next/link'
import { CloudOff } from 'lucide-react'

/** Supabase Auth no responde: la sesión existe, pero no se puede confirmar.
 *
 *  Es la pantalla que faltó el 22/09. En vez de mandar a todos a /login —cuyo
 *  botón de Microsoft devolvía "Gateway Timeout"—, se dice qué pasa y que no
 *  es culpa de la persona. */
export default function AuthNoDisponiblePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-main px-4">
      <div className="max-w-sm text-center space-y-3">
        <CloudOff size={28} className="mx-auto text-informativo" aria-hidden="true" />
        <h1 className="text-base font-semibold text-text-primary">El servicio de acceso no responde</h1>
        <p className="text-sm text-informativo">
          Tu sesión sigue abierta, pero no pudimos confirmarla. No cierres sesión: espera unos minutos y
          vuelve a intentarlo.
        </p>
        <Link
          href="/dashboard/operations/monitor"
          className="inline-block text-sm font-semibold text-accent hover:underline"
        >
          Reintentar
        </Link>
      </div>
    </main>
  )
}
