'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { DOMINIOS } from './dominios'
import { inventarioApi, type InventarioConfig } from '@/lib/api/config'

/** La portada del modulo: una fila por dominio, con lo que ese dominio gobierna
 *  en numeros reales.
 *
 *  La primera version mostraba "N secciones", que describe la NAVEGACION y no
 *  el contenido: Certificacion con 37 documentos se veia identica a Personas
 *  con 10 usuarios, y la unica senal era un conteo que a nadie le sirve.
 *
 *  Filas y no tarjetas porque es el lenguaje que la app ya habla —el embudo de
 *  Certificacion es una lista de filas— y porque una fila ancha deja lugar al
 *  inventario sin dejar media pantalla vacia.
 *
 *  Sin color de estado a proposito. La app tiene tres colores con significado
 *  fijo (--espera, --accion, --resuelto) y en esta pantalla todavia no hay nada
 *  esperando ni resuelto: pintarla seria gastar la senal. Cuando entre el
 *  registro de revision (Plan 2), "12 sin revisar" ocupa el lugar del
 *  inventario en la misma linea, y AHI el color significa algo.
 *
 *  Todo se deriva del registro: agregar un dominio no toca este archivo. */
export function PortadaDominios() {
  // react-query, que es lo que el modulo ya usa.
  // La primera version resolvia esto con un useEffect a mano y dejaba `{}`
  // significando DOS cosas -- "cargo vacio" y "fallo" --, que es el defecto
  // que este proyecto ya arrastro cinco veces. Aca los estados vienen
  // nombrados y el error deja de tragarse.
  const inv = useQuery({
    queryKey: ['config-inventario'],
    queryFn: inventarioApi.get,
  })

  return (
    // La superficie LLENA el area de trabajo en vez de flotar sobre el gris
    // del layout: medido, la pantalla de dominio cubria el 28% del alto util
    // contra el 78% de /dashboard/compliance.
    <div className="bg-white border border-border rounded-2xl overflow-hidden
                    min-h-[calc(100vh-12rem)]">
      {DOMINIOS.map((d, i) => {
        const Icono   = d.icono
        const dominio = inv.data?.[d.clave]
        const pares   = dominio?.pares ?? []
        const revision = dominio?.revision
        const primera = i === 0

        const cuerpo = (
          <>
            <span
              aria-hidden="true"
              className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                d.proximamente ? 'bg-gray-100 text-gray-400' : 'bg-accent/10 text-accion'
              }`}
            >
              <Icono size={15} />
            </span>

            <span className="flex-1 min-w-0">
              <span className="block font-mulish font-bold text-sm text-text-primary">
                {d.titulo}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">{d.proposito}</span>

              {d.proximamente ? (
                <span className="block text-[11px] text-gray-400 mt-2">Reservado</span>
              ) : (
                <span className="block text-xs text-gray-600 mt-2 tabular-nums min-h-[1rem]">
                  {/* Tres estados, dibujados distinto. El inventario es
                      informativo: si falla, la fila sigue siendo navegable
                      -- una portada sin conteos sirve, una que no deja entrar
                      no -- pero el fallo SE DICE, no parece un cero. */}
                  {inv.isPending
                    ? <span className="inline-block w-40 h-3 bg-gray-100 rounded animate-pulse align-middle" />
                    : inv.isError
                    ? <span className="text-gray-400">Sin datos por ahora</span>
                    : pares.map((p, n) => (
                        <span key={p.etiqueta}>
                          {n > 0 && <span className="text-gray-300"> · </span>}
                          <b className="font-semibold text-text-primary">{p.n}</b> {p.etiqueta}
                        </span>
                      ))}
                  {/* Cuando no hay pendientes se dice "al día", NO "0": un cero
                      ahí volvería a significar dos cosas ("ninguno" contra
                      "todavía no cargué"), el defecto que ya ocurrió en el
                      embudo de Certificación. Y un dominio sin nada revisable
                      —Personas— no dibuja nada, que es un tercer estado
                      distinto de los dos. */}
                  {revision && (
                    <>
                      <span className="text-gray-300"> · </span>
                      {revision.sin_revisar > 0 ? (
                        <b className="font-semibold text-amber-700">
                          {`${revision.sin_revisar} sin revisar`}
                        </b>
                      ) : (
                        <span className="text-resuelto">al día</span>
                      )}
                    </>
                  )}
                </span>
              )}
            </span>

            {!d.proximamente && (
              <ChevronRight size={15} className="shrink-0 self-center text-gray-300" aria-hidden="true" />
            )}
          </>
        )

        const borde = primera ? '' : 'border-t border-border'

        // Un dominio reservado se dibuja apagado y NO es un enlace: parecer
        // visitable y no llevar a ningun lado es peor que no ofrecerlo.
        if (d.proximamente) {
          return (
            <div key={d.clave} className={`flex gap-3 px-4 py-3.5 opacity-50 ${borde}`}>
              {cuerpo}
            </div>
          )
        }

        // "Sin revisar" es un FILTRO, no un adorno: el número entra al dominio
        // con el filtro puesto. Es el camino corto entre "algo falta" y "lo
        // estoy resolviendo".
        const destino = revision && revision.sin_revisar > 0
          ? `/dashboard/admin/settings/${d.clave}?revision=pendiente`
          : `/dashboard/admin/settings/${d.clave}`

        return (
          <Link
            key={d.clave}
            href={destino}
            prefetch={false}
            className={`flex gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50/70
                        focus-visible:outline-none focus-visible:bg-accent/5 ${borde}`}
          >
            {cuerpo}
          </Link>
        )
      })}
    </div>
  )
}
