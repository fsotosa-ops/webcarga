'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'

interface Props {
  fecha: string
}

/** Sección "Cerrar Equipos Completos" del Centro de Cierre (Tarea 13, plan
 *  1.4) — HU-03 Bloque 2, extraída del bloque pasivo de
 *  EquipmentCloseDayDialog.tsx (Bloque 1/Tractoreo de ese diálogo queda sin
 *  tocar, sigue en uso desde monitor/page.tsx hasta la Tarea 1.6) sin
 *  cambios de lógica: solo resumen por empresa, nunca bloquea el cierre. */
export function EquipoCompletoClosureSection({ fecha }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['equipment-closure', fecha],
    queryFn: () => equipmentClosuresApi.get(fecha),
  })

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
        {data.equipos_completos.summary.utilization_pct}% utilización (no bloquea el cierre)
      </p>
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th className="text-left px-3 py-2">Empresa</th>
              <th className="text-right px-3 py-2">Enrolados</th>
              <th className="text-right px-3 py-2">Asignados</th>
              <th className="text-right px-3 py-2">No asignados</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {data.equipos_completos.by_carrier.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos completos hoy</td></tr>
            )}
            {data.equipos_completos.by_carrier.map(b => (
              <tr key={b.carrier_id ?? 'sin_empresa'}>
                <td className="px-3 py-2 font-medium text-text-primary">{b.carrier_name ?? '—'}</td>
                <td className="px-3 py-2 text-right">{b.enrolled}</td>
                <td className="px-3 py-2 text-right text-green-700">{b.assigned}</td>
                <td className="px-3 py-2 text-right text-gray-400">{b.unassigned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
