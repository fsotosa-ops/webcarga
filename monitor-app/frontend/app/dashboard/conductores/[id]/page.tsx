import { createGoldClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { User, ChevronRight, Truck } from 'lucide-react'
import type { DiarioTrip } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'RUTA':               { bg: '#eef6e6', text: '#62a420' },
  'EN LOCAL':           { bg: '#fef0e6', text: '#ea6b25' },
  'ASIGNADO':           { bg: '#e8eeff', text: '#053bfa' },
  'RETORNANDO':         { bg: '#e6f8fd', text: '#0e8db5' },
  'CANCELADO':          { bg: '#fee2e2', text: '#b00020' },
  'CERRADO FINALIZADO': { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO INCOMPLETO': { bg: '#fef3c7', text: '#d97706' },
}

export default async function ConductorPage({ params }: PageProps) {
  const { id } = await params
  const driverId = decodeURIComponent(id)

  const goldSupabase = await createGoldClient()
  // rut_conductor in the gold view = dni_driver from silver (internal TMS driver ID)
  const { data: raw } = await goldSupabase
    .from('v_diario_trips')
    .select('*')
    .eq('rut_conductor', driverId)

  const trips = (raw ?? []) as unknown as DiarioTrip[]

  if (trips.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-400">No se encontraron viajes para conductor ID &quot;{driverId}&quot;</p>
        <Link href="/dashboard/diario" className="text-sm text-accent hover:underline mt-2 inline-block">← Volver al diario</Link>
      </div>
    )
  }

  const conductorName = trips[0].conductor ?? '—'
  const eett = trips[0].eett ?? null

  // Vehículos utilizados
  const vehiculosMap = new Map<string, { tipo: string | null; rampla: string | null; viajes: number }>()
  for (const t of trips) {
    if (!t.patente_tracto) continue
    if (!vehiculosMap.has(t.patente_tracto)) {
      vehiculosMap.set(t.patente_tracto, { tipo: t.tipo_vehiculo ?? null, rampla: t.patente_rampla ?? null, viajes: 0 })
    }
    vehiculosMap.get(t.patente_tracto)!.viajes++
  }
  const vehiculos = Array.from(vehiculosMap.entries())
    .map(([patente, d]) => ({ patente, ...d }))
    .sort((a, b) => b.viajes - a.viajes)

  // Status distribution
  const statusCounts: Record<string, number> = {}
  for (const t of trips) {
    const s = t.normalized_status ?? 'OTRO'
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
  }

  const currentStatus = trips.find(t =>
    t.normalized_status && !t.normalized_status.startsWith('CERRADO') && t.normalized_status !== 'CANCELADO'
  )?.normalized_status ?? null

  return (
    <div className="p-6 space-y-5">
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 flex-wrap">
        {eett ? (
          <>
            <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors">Transportistas</Link>
            <ChevronRight size={13} />
            <Link href={`/dashboard/transportistas/${encodeURIComponent(eett)}`} className="hover:text-accent transition-colors">{eett}</Link>
            <ChevronRight size={13} />
          </>
        ) : (
          <>
            <Link href="/dashboard/diario" className="hover:text-accent transition-colors">Diario</Link>
            <ChevronRight size={13} />
          </>
        )}
        <span className="text-text-primary font-medium">{conductorName}</span>
      </nav>

      <div className="bg-white rounded-xl border border-border p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
          <User size={22} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-mulish font-bold text-xl text-text-primary">{conductorName}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-xs text-gray-400 font-mono">ID: {driverId}</span>
            {eett && (
              <Link href={`/dashboard/transportistas/${encodeURIComponent(eett)}`} className="text-xs text-accent hover:underline">
                {eett}
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-center">
            <p className="font-mulish font-bold text-2xl text-text-primary">{trips.length}</p>
            <p className="text-xs text-gray-400">Viajes</p>
          </div>
          <div className="text-center">
            <p className="font-mulish font-bold text-2xl text-text-primary">{vehiculos.length}</p>
            <p className="text-xs text-gray-400">Vehículos</p>
          </div>
          {currentStatus && (
            <div className="text-center">
              <span
                className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold"
                style={STATUS_COLORS[currentStatus]
                  ? { backgroundColor: STATUS_COLORS[currentStatus].bg, color: STATUS_COLORS[currentStatus].text }
                  : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
              >
                {currentStatus}
              </span>
              <p className="text-[10px] text-gray-400 mt-0.5">Estado actual</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Vehículos utilizados</h2>
          </div>
          {vehiculos.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">Sin vehículos registrados</div>
          ) : (
            <div className="divide-y divide-border">
              {vehiculos.map(v => (
                <div key={v.patente} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Truck size={14} className="text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-semibold text-text-primary">{v.patente}</p>
                    <p className="text-xs text-gray-400">{v.tipo ?? 'Tipo desconocido'}{v.rampla ? ` · Rampla: ${v.rampla}` : ''}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{v.viajes} viajes</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Distribución de estados</h2>
          </div>
          <div className="p-5 space-y-2.5">
            {Object.entries(statusCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => {
                const colors = STATUS_COLORS[status]
                const pct = Math.round((count / trips.length) * 100)
                return (
                  <div key={status} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-primary">{status}</span>
                      <span className="text-xs text-gray-400">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colors?.text ?? '#9ca3af' }} />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Historial de viajes</h2>
          </div>
          <div className="divide-y divide-border/60 max-h-[400px] overflow-y-auto">
            {trips.slice(0, 20).map((t, i) => {
              const colors = t.normalized_status ? STATUS_COLORS[t.normalized_status] : null
              return (
                <div key={`${t.status_id}-${i}`} className="px-5 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-400">{t.fecha ?? '—'}</span>
                    {t.normalized_status && (
                      <span
                        className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                        style={colors ? { backgroundColor: colors.bg, color: colors.text } : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                      >
                        {t.normalized_status}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5 truncate">
                    {[t.cd_planta_origen, t.local_asignado].filter(Boolean).join(' → ') || 'Sin ruta'}
                  </p>
                  {t.patente_tracto && <p className="text-[10px] text-gray-400 font-mono mt-0.5">{t.patente_tracto}</p>}
                </div>
              )
            })}
            {trips.length > 20 && (
              <div className="px-5 py-3 text-xs text-gray-400 text-center">+{trips.length - 20} viajes más</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
