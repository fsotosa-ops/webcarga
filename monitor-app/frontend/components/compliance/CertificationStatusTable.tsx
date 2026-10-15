'use client'

import { AlertTriangle, Building2 } from 'lucide-react'
import type { CertificationStatusRow } from '@/lib/types'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'

/** Certificación agrupada por requisito: cuánto se cubrió de cada documento.
 *
 *  Era la tabla de cuatro agrupaciones. Empresa usa el embudo, y Conductor y
 *  Vehículo son las listas del Directorio desde la Entrega C (14/10): esta tabla
 *  quedó solo con el requisito, que no tiene empresa (cruza todas). */
export function CertificationStatusTable({ rows }: { rows: CertificationStatusRow[] }) {
  if (!rows.length) {
    return (
      <div className="p-8 text-center">
        <Building2 size={20} className="mx-auto text-informativo mb-2" />
        <p className="text-dato text-informativo">No hay requisitos que coincidan</p>
      </div>
    )
  }

  return (
    <table className="w-full text-left">
      <thead className="sticky top-0 z-10 bg-bg-main">
        <tr className="border-b border-border">
          <th scope="col" className={CABECERA}>Documento</th>
          <th scope="col" className={`${CABECERA} w-56`}>Documentación</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pct = r.total_count > 0 ? Math.round((r.satisfied_count / r.total_count) * 100) : 0
          const alDia = r.total_count > 0 && r.pending_count === 0
          return (
            <tr key={r.entity_id} className="border-b border-border hover:bg-bg-main">
              <td className="px-3 py-2">
                <span className="text-dato font-medium text-text-primary">{r.entity_name}</span>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-24 rounded-full bg-border overflow-hidden shrink-0">
                    <span className={`block h-full rounded-full ${alDia ? 'bg-resuelto' : 'bg-accion'}`} style={{ width: pct > 0 ? `max(3px, ${pct}%)` : 0 }} />
                  </span>
                  <span className="text-etiqueta text-informativo tabular-nums whitespace-nowrap">
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
