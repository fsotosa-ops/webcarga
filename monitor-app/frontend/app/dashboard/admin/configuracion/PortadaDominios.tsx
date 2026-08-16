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
  // react-query, que es lo que el modulo ya usa (RequirementConditionsPanel).
  // La primera version resolvia esto con un useEffect a mano y dejaba `{}`
  // significando DOS cosas -- "cargo vacio" y "fallo" --, que es el defecto
  // que este proyecto ya arrastro cinco veces. Aca los estados vienen
  // nombrados y el error deja de tragarse.
  const inv = useQuery({
    queryKey: ['config-inventario'],
    queryFn: inventarioApi.get,
  })

  return (
    <div className="bg-white border border-border rounded-2xl overflow-hidden">
      {DOMINIOS.map((d, i) => {
        const Icono   = d.icono
        const pares   = inv.data?.[d.clave] ?? []
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

        return (
          <Link
            key={d.clave}
            href={`/dashboard/admin/configuracion/${d.clave}`}
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
