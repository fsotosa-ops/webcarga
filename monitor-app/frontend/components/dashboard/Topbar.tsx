interface Props {
  /** Nombre ya resuelto por el layout. */
  displayName: string
  role?: string | null
}

/** Recibe los datos del layout en vez de volver a pedirlos.
 *
 *  Antes llamaba a `getUser()` y consultaba `profiles` por su cuenta, y el
 *  layout que lo envuelve hacía exactamente lo mismo: dos llamadas a la API de
 *  Auth por cada render del dashboard. Con el prefetch de Next.js sobre una
 *  lista larga eso son cientos de llamadas por minuto y Supabase responde 429
 *  ("Many requests") — medido: 104 llamadas a /user en un solo minuto. */
export default function Topbar({ displayName, role }: Props) {
  const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <header className="h-14 bg-white border-b border-border/70 flex items-center px-4 md:px-6 shrink-0 gap-3">
      {/* Mobile brand — visible only when sidebar is hidden */}
      <div className="md:hidden flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shadow">
          <span className="text-white font-mulish font-bold text-xs">W</span>
        </div>
        <span className="font-mulish font-bold text-sm text-text-primary">WebCarga</span>
      </div>

      {/* Spacer on desktop (breadcrumb placeholder) */}
      <div className="hidden md:block flex-1" />

      <div className="flex items-center gap-2.5 ml-auto">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold"
            style={{ background: 'linear-gradient(135deg, #1cb9ec 0%, #0e8db5 100%)' }}
          >
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-text-primary leading-tight">{displayName}</p>
            <p className="text-xs text-gray-400 capitalize">{role ?? 'operador'}</p>
          </div>
        </div>
      </div>
    </header>
  )
}
