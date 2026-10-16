'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AssignedRow } from '@/lib/types'
import { TripCodeLinks } from '@/components/dashboard/TripCodeLinks'
import {
  COLUMNAS_DE_ZONA, arbolDeAsignados, filasDelArbol, type FilaDelArbol, type NivelPlegable,
} from '@/lib/reporte/arbolDeAsignados'

const SANGRIA = ['pl-3', 'pl-7', 'pl-11', 'pl-14'] as const
const PESO = ['bg-gray-50 font-bold', 'font-semibold', '', 'text-gray-500'] as const

function alternar(conjunto: ReadonlySet<string>, clave: string): Set<string> {
  const nuevo = new Set(conjunto)
  if (nuevo.has(clave)) nuevo.delete(clave)
  else nuevo.add(clave)
  return nuevo
}

export type Plegado = {
  estaAbierto: (clave: string, nivel: NivelPlegable) => boolean
  alternar:    (fila: FilaDelArbol) => void
}

/** Qué está abierto en el árbol. Los clientes abren abiertos; los orígenes y las
 *  empresas, cerrados (spec 2026-10-11). Guarda solo lo que la persona tocó, nunca una copia
 *  de los datos: cambiar de tipo o de cliente no lo deja desfasado. Vive en la
 *  sección y no en la tabla, porque la tabla se desmonta cuando un tipo no tiene
 *  asignados, y al volver se perdería. */
export function usePlegado(): Plegado {
  const [clientesPlegados, setClientesPlegados] = useState<ReadonlySet<string>>(new Set())
  // Orígenes y empresas: sus claves no chocan (la de empresa lleva al origen).
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set())
  return {
    estaAbierto: (clave, nivel) => (nivel === 0 ? !clientesPlegados.has(clave) : abiertos.has(clave)),
    alternar: fila => {
      if (fila.nivel === 0) setClientesPlegados(c => alternar(c, fila.clave))
      else setAbiertos(o => alternar(o, fila.clave))
    },
  }
}

/** Asignados como tabla dinámica: Cliente → Origen del viaje → Empresa →
 *  Conductor, con subtotales. Cada conductor con sus Nº de viaje del día (D8). */
export function TablaDeAsignados({ rows, plegado, tripHref }: {
  rows: AssignedRow[]; plegado: Plegado; tripHref: (tripId: string) => string
}) {
  const arbol = useMemo(() => arbolDeAsignados(rows), [rows])
  const { estaAbierto } = plegado

  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
            <th className="text-left px-3 py-2">Cliente › Origen › Empresa › Conductor</th>
            <th className="text-left px-3 py-2">Nº viaje</th>
            {COLUMNAS_DE_ZONA.map(z => <th key={z.clave} className="text-right px-3 py-2">{z.etiqueta}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {filasDelArbol(arbol, estaAbierto).map(f => {
            const abierto = f.plegable && estaAbierto(f.clave, f.nivel as NivelPlegable)
            return (
              <tr key={f.clave} className={PESO[f.nivel]}>
                <td className={`py-2 pr-3 ${SANGRIA[f.nivel]}`}>
                  {f.plegable ? (
                    <button type="button" aria-expanded={abierto} onClick={() => plegado.alternar(f)}
                            className="flex items-center gap-1 text-left hover:text-accent">
                      <ChevronRight size={12} aria-hidden className={`transition-transform ${abierto ? 'rotate-90' : ''}`} />
                      {f.etiqueta}
                    </button>
                  ) : f.etiqueta}
                </td>
                <td className="px-3 py-2">{f.nivel === 3 && <TripCodeLinks trips={f.trips} href={tripHref} />}</td>
                {COLUMNAS_DE_ZONA.map(z => (
                  <td key={z.clave} className={`px-3 py-2 text-right ${z.clave === 'total' ? 'font-bold' : ''}`}>
                    {f.cifras[z.clave]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold bg-gray-50">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2" />
            {COLUMNAS_DE_ZONA.map(z => <td key={z.clave} className="px-3 py-2 text-right">{arbol.total[z.clave]}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
