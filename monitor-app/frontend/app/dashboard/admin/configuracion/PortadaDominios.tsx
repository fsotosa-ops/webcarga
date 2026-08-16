'use client'

import Link from 'next/link'
import { DOMINIOS } from './dominios'

/** La portada del modulo. Se deriva del registro: agregar un dominio no toca
 *  este archivo.
 *
 *  Hoy cada tarjeta dice cuantas secciones tiene. La senal de "sin revisar"
 *  —que es lo que convierte la portada en algo mas que un menu— llega en el
 *  Plan 2, junto con el registro de revision. */
export function PortadaDominios() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {DOMINIOS.map(d => {
        const cuerpo = (
          <>
            <p className="text-sm font-semibold text-text-primary">{d.titulo}</p>
            <p className="text-xs text-gray-500 mt-1">{d.proposito}</p>
            {!d.proximamente && (
              <p className="text-[11px] text-gray-400 mt-3 tabular-nums">
                {d.secciones.length === 1 ? '1 sección' : `${d.secciones.length} secciones`}
              </p>
            )}
          </>
        )

        // Un dominio reservado se dibuja apagado y NO es un enlace: parecer
        // visitable y no llevar a ningun lado es peor que no ofrecerlo.
        if (d.proximamente) {
          return (
            <div key={d.clave}
                 className="rounded-xl border border-dashed border-border p-4 opacity-50">
              {cuerpo}
              <p className="text-[11px] text-gray-400 mt-3">Reservado</p>
            </div>
          )
        }

        return (
          <Link key={d.clave}
                href={`/dashboard/admin/configuracion/${d.clave}`}
                prefetch={false}
                className="rounded-xl border border-border p-4 transition-colors hover:bg-gray-50/60">
            {cuerpo}
          </Link>
        )
      })}
    </div>
  )
}
