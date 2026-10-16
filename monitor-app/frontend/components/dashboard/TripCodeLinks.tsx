import Link from 'next/link'
import type { TripRef } from '@/lib/types'

/** Los Nº de viaje de una fila (D8): uno por viaje. Es el valor de la columna "Nº
 *  viaje" para filtrar y contar, y lo que entra al Excel. */
export function tripCodes(trips: TripRef[] | undefined): string[] {
  return (trips ?? []).map(t => t.code ?? t.id)
}

/** La celda "Nº viaje" de una fila con viajes: todos los de la fila, cada uno abre
 *  su viaje con la vuelta a la pantalla de origen (la que arma `href`). */
export function TripCodeLinks({ trips, href }: { trips: TripRef[] | undefined; href: (tripId: string) => string }) {
  if (!trips?.length) return <span className="text-informativo">—</span>
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {trips.map(t => (
        <Link key={t.id} href={href(t.id)} aria-label={`Ver viaje ${t.code ?? t.id}`}
          className="font-identificador text-accion hover:underline">
          {t.code ?? t.id}
        </Link>
      ))}
    </span>
  )
}
