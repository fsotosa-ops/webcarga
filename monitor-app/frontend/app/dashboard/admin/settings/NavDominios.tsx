'use client'

import Link from 'next/link'
import { DOMINIOS } from './dominios'

/** Los dominios, para saltar entre ellos sin pasar por la portada. La portada
 *  orienta; no es un peaje que se paga en cada visita. */
export function NavDominios({ activo }: { activo: string }) {
  return (
    <nav aria-label="Áreas de configuración" className="flex flex-col gap-0.5 min-w-[170px]">
      {DOMINIOS.filter(d => !d.proximamente).map(d => {
        const esActivo = d.clave === activo
        return (
          <Link
            key={d.clave}
            href={`/dashboard/admin/settings/${d.clave}`}
            prefetch={false}
            aria-current={esActivo ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
              esActivo ? 'bg-accent/10 text-accent font-semibold' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {d.titulo}
          </Link>
        )
      })}
    </nav>
  )
}
