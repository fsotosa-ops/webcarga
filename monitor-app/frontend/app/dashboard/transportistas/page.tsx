import { createGoldClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Building2, Truck, Users, ChevronRight } from 'lucide-react'
import type { DiarioTrip } from '@/lib/types'

interface EETTSummary {
  nombre: string
  rut: string | null
  conductores: number
  vehiculos: number
  viajes: number
  statuses: Record<string, number>
}

function aggregateEETTs(trips: DiarioTrip[]): EETTSummary[] {
  const map = new Map<string, { rut: string | null; conductores: Set<string>; vehiculos: Set<string>; statuses: Record<string, number> }>()

  for (const t of trips) {
    if (!t.eett) continue
    if (!map.has(t.eett)) {
      map.set(t.eett, { rut: t.rut_eett ?? null, conductores: new Set(), vehiculos: new Set(), statuses: {} })
    }
    const e = map.get(t.eett)!
    if (t.rut_conductor) e.conductores.add(t.rut_conductor)
    if (t.patente_tracto) e.vehiculos.add(t.patente_tracto)
    const s = t.normalized_status ?? 'OTRO'
    e.statuses[s] = (e.statuses[s] ?? 0) + 1
  }

  return Array.from(map.entries())
    .map(([nombre, { rut, conductores, vehiculos, statuses }]) => ({
      nombre,
      rut,
      conductores: conductores.size,
      vehiculos: vehiculos.size,
      viajes: Object.values(statuses).reduce((a, b) => a + b, 0),
      statuses,
    }))
    .sort((a, b) => b.viajes - a.viajes)
}

const STATUS_COLORS: Record<string, string> = {
  'RUTA': '#62a420',
  'EN LOCAL': '#ea6b25',
  'ASIGNADO': '#053bfa',
  'RETORNANDO': '#1cb9ec',
  'CANCELADO': '#b00020',
  'CERRADO FINALIZADO': '#9ca3af',
  'CERRADO INCOMPLETO': '#d97706',
}

export default async function TransportistasPage() {
  const goldSupabase = await createGoldClient()
  const { data: trips } = await goldSupabase.from('v_diario_trips').select(
    'eett, rut_eett, rut_conductor, patente_tracto, normalized_status'
  )

  const eettsRaw = aggregateEETTs((trips ?? []) as unknown as DiarioTrip[])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Empresas de Transporte</h1>
        <p className="text-xs text-gray-400 mt-0.5">{eettsRaw.length} transportistas con viajes registrados</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {eettsRaw.map(eett => {
          const slug = encodeURIComponent(eett.nombre)
          const topStatuses = Object.entries(eett.statuses).sort((a, b) => b[1] - a[1]).slice(0, 3)

          return (
            <Link
              key={eett.nombre}
              href={`/dashboard/transportistas/${slug}`}
              className="bg-white rounded-xl border border-border p-5 hover:border-accent hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between gap-2 mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                    <Building2 size={18} className="text-gray-500 group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-text-primary leading-tight line-clamp-2">{eett.nombre}</h2>
                    {eett.rut && <p className="text-xs text-gray-400 mt-0.5">{eett.rut}</p>}
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-accent shrink-0 mt-0.5 transition-colors" />
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { icon: Truck, label: 'Viajes', value: eett.viajes },
                  { icon: Users, label: 'Conductores', value: eett.conductores },
                  { icon: Truck, label: 'Vehículos', value: eett.vehiculos },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="font-mulish font-bold text-xl text-text-primary">{value}</p>
                    <p className="text-[10px] text-gray-400">{label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {topStatuses.map(([status, count]) => {
                  const color = STATUS_COLORS[status] ?? '#9ca3af'
                  return (
                    <span
                      key={status}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: `${color}18`, color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                      {status} ({count})
                    </span>
                  )
                })}
              </div>
            </Link>
          )
        })}

        {eettsRaw.length === 0 && (
          <div className="col-span-3 bg-white rounded-xl border border-border p-12 text-center text-sm text-gray-400">
            Sin datos de transportistas en el sistema
          </div>
        )}
      </div>
    </div>
  )
}
