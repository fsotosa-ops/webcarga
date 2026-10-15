'use client'

import { AlertTriangle, Building2 } from 'lucide-react'
import type { CertificationStatusRow } from '@/lib/types'

/** Certificación agrupada por requisito: cuánto se cubrió de cada documento.
 *
 *  Era la tabla de cuatro agrupaciones. Empresa usa el embudo, y Conductor y
 *  Vehículo son las listas del Directorio desde la Entrega C (14/10): esta tabla
 *  quedó solo con el requisito, que no tiene empresa (cruza todas). */
export function CertificationStatusTable({ rows }: { rows: CertificationStatusRow[] }) {
  if (!rows.length) {
    return (
      <div className="p-8 text-center">
        <Building2 size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-500">No hay requisitos que coincidan</p>
      </div>
    )
  }

  return (
    <table className="w-full text-left">
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pl-3 pr-2 text-etiqueta uppercase tracking-wider text-gray-500 font-semibold">Documento</th>
          <th scope="col" className="py-2 px-2 text-etiqueta uppercase tracking-wider text-gray-500 font-semibold w-56">Documentación</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pct = r.total_count > 0 ? Math.round((r.satisfied_count / r.total_count) * 100) : 0
          const alDia = r.total_count > 0 && r.pending_count === 0
          return (
            <tr key={r.entity_id} className="border-b border-border hover:bg-gray-50">
              <td className="py-2 pl-3 pr-2">
                <span className="text-xs font-medium text-text-primary">{r.entity_name}</span>
              </td>
              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    <span className={`block h-full rounded-full ${alDia ? 'bg-resuelto' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-etiqueta text-gray-600 tabular-nums whitespace-nowrap">
                    {r.satisfied_count} de {r.total_count}
                  </span>
                  {r.pending_mandatory > 0 && (
                    <span className="inline-flex items-center gap-1 text-etiqueta text-status-incidente"
                          title={`${r.pending_mandatory} obligatorios por ley sin cubrir`}>
                      <AlertTriangle size={11} /> {r.pending_mandatory}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
