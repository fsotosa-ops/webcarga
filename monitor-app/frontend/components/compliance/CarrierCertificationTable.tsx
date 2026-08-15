'use client'

import Link from 'next/link'
import { AlertTriangle, Building2, Check } from 'lucide-react'
import type { CarrierCertificationRow } from '@/lib/types'

interface Props {
  rows: CarrierCertificationRow[]
}

/** La vista por defecto del módulo: cómo va cada empresa.
 *
 *  Las dos mitades del trabajo viven en la misma fila — lo que falta y lo que
 *  llegó sin clasificar. Tenerlas en dos listas hermanas obligaba a cruzarlas
 *  de memoria, que es exactamente lo que hacía al módulo confuso. */
export function CarrierCertificationTable({ rows }: Props) {
  if (!rows.length) {
    return (
      <div className="p-8 text-center">
        <Building2 size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-500">No hay empresas que coincidan</p>
      </div>
    )
  }

  return (
    <table className="w-full text-left">
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pl-3 pr-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Empresa</th>
          <th scope="col" className="py-2 px-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold w-56">Documentación</th>
          <th scope="col" className="py-2 pl-2 pr-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold w-32">Sin clasificar</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pct = r.total_count > 0 ? Math.round((r.satisfied_count / r.total_count) * 100) : 0
          const alDia = r.total_count > 0 && r.pending_count === 0

          return (
            <tr key={r.carrier_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <td className="py-2 pl-3 pr-2">
                <Link
                  href={`/dashboard/carriers/${r.carrier_id}?tab=documentos`}
                  className="text-xs font-medium text-slate-800 hover:text-accent transition-colors"
                >
                  {r.carrier_name}
                </Link>
                {r.operational_status !== 'ACTIVE' && (
                  <span className="ml-2 text-[10px] text-gray-500">no activa</span>
                )}
              </td>

              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    <span
                      className={`block h-full rounded-full ${alDia ? 'bg-emerald-500' : 'bg-accent'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="text-[11px] text-gray-600 tabular-nums whitespace-nowrap">
                    {r.satisfied_count} de {r.total_count}
                  </span>
                  {r.pending_mandatory > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-red-700"
                      title={`${r.pending_mandatory} obligatorios por ley sin cubrir`}
                    >
                      <AlertTriangle size={11} /> {r.pending_mandatory}
                    </span>
                  )}
                </div>
              </td>

              <td className="py-2 pl-2 pr-3">
                {r.unclassified_count > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold tabular-nums">
                    {r.unclassified_count}
                  </span>
                ) : alDia ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
                    <Check size={11} /> al día
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-400">—</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
