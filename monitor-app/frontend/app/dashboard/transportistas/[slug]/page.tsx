import { createGoldClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Building2, ChevronRight, Truck, Users } from 'lucide-react'
import type { DiarioTrip } from '@/lib/types'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tab?: string }>
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

export default async function EETTDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { tab = 'conductores' } = await searchParams
  const eettNombre = decodeURIComponent(slug)

  const goldSupabase = await createGoldClient()
  const { data: raw } = await goldSupabase
    .from('v_diario_trips')
    .select('*')
    .eq('eett', eettNombre)

  const trips = (raw ?? []) as unknown as DiarioTrip[]

  if (trips.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-400">No se encontraron viajes para &quot;{eettNombre}&quot;</p>
        <Link href="/dashboard/transportistas" className="text-sm text-accent hover:underline mt-2 inline-block">
          ← Volver a transportistas
        </Link>
      </div>
    )
  }

  const rutEETT = trips[0].rut_eett

  // Aggregate conductores
  const conductoresMap = new Map<string, { nombre: string; vehiculos: Set<string>; viajes: number; lastStatus: string | null }>()
  for (const t of trips) {
    if (!t.rut_conductor) continue
    if (!conductoresMap.has(t.rut_conductor)) {
      conductoresMap.set(t.rut_conductor, { nombre: t.conductor ?? '—', vehiculos: new Set(), viajes: 0, lastStatus: null })
    }
    const c = conductoresMap.get(t.rut_conductor)!
    c.viajes++
    if (t.patente_tracto) c.vehiculos.add(t.patente_tracto)
    c.lastStatus = t.normalized_status ?? null
  }
  const conductores = Array.from(conductoresMap.entries())
    .map(([rut, d]) => ({ rut, ...d, vehiculos: d.vehiculos.size }))
    .sort((a, b) => b.viajes - a.viajes)

  // Aggregate vehiculos
  const vehiculosMap = new Map<string, { tipo: string | null; conductores: Set<string>; viajes: number }>()
  for (const t of trips) {
    if (!t.patente_tracto) continue
    if (!vehiculosMap.has(t.patente_tracto)) {
      vehiculosMap.set(t.patente_tracto, { tipo: t.tipo_vehiculo ?? null, conductores: new Set(), viajes: 0 })
    }
    const v = vehiculosMap.get(t.patente_tracto)!
    v.viajes++
    if (t.rut_conductor) v.conductores.add(t.rut_conductor)
  }
  const vehiculos = Array.from(vehiculosMap.entries())
    .map(([patente, d]) => ({ patente, ...d, conductores: d.conductores.size }))
    .sort((a, b) => b.viajes - a.viajes)

  const tabs = [
    { id: 'conductores', label: `Conductores (${conductores.length})` },
    { id: 'vehiculos', label: `Vehículos (${vehiculos.length})` },
    { id: 'viajes', label: `Viajes (${trips.length})` },
  ]

  const baseUrl = `/dashboard/transportistas/${slug}`

  return (
    <div className="p-6 space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors">Transportistas</Link>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium">{eettNombre}</span>
      </nav>

      {/* Header */}
      <div className="bg-white rounded-xl border border-border p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
          <Building2 size={22} className="text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-mulish font-bold text-xl text-text-primary">{eettNombre}</h1>
          {rutEETT && <p className="text-sm text-gray-400 mt-0.5">RUT: {rutEETT}</p>}
        </div>
        <div className="grid grid-cols-3 gap-6 shrink-0">
          {[
            { label: 'Conductores', value: conductores.length, icon: Users },
            { label: 'Vehículos',   value: vehiculos.length,   icon: Truck },
            { label: 'Viajes',      value: trips.length,       icon: Truck },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="font-mulish font-bold text-2xl text-text-primary">{value}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border">
        {tabs.map(t => (
          <Link
            key={t.id}
            href={`${baseUrl}?tab=${t.id}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-text-primary'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'conductores' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Conductor</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">RUT</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vehículos</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Viajes</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Último estado</th>
              </tr>
            </thead>
            <tbody>
              {conductores.map((c, i) => {
                const colors = c.lastStatus ? STATUS_COLORS[c.lastStatus] : null
                return (
                  <tr key={c.rut} className={`border-b border-border/60 last:border-0 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                    <td className="px-5 py-3">
                      <Link
                        href={`/dashboard/conductores/${encodeURIComponent(c.rut)}`}
                        className="font-medium text-text-primary hover:text-accent transition-colors"
                      >
                        {c.nombre}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-gray-500 font-mono text-xs">{c.rut}</td>
                    <td className="px-5 py-3 text-gray-600">{c.vehiculos}</td>
                    <td className="px-5 py-3">
                      <span className="font-semibold text-text-primary">{c.viajes}</span>
                    </td>
                    <td className="px-5 py-3">
                      {c.lastStatus ? (
                        <span
                          className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={colors ? { backgroundColor: colors.bg, color: colors.text } : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                        >
                          {c.lastStatus}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'vehiculos' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Patente</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Conductores</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Viajes</th>
              </tr>
            </thead>
            <tbody>
              {vehiculos.map((v, i) => (
                <tr key={v.patente} className={`border-b border-border/60 last:border-0 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                  <td className="px-5 py-3 font-mono font-semibold text-text-primary">{v.patente}</td>
                  <td className="px-5 py-3 text-gray-500">{v.tipo ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{v.conductores}</td>
                  <td className="px-5 py-3 font-semibold text-text-primary">{v.viajes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'viajes' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                {['Fecha', 'Conductor', 'Patente', 'Origen', 'Local', 'Estado'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-gray-500 uppercase tracking-wide text-[11px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trips.slice(0, 50).map((t, i) => {
                const colors = t.normalized_status ? STATUS_COLORS[t.normalized_status] : null
                return (
                  <tr key={`${t.status_id}-${i}`} className={`border-b border-border/60 last:border-0 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}>
                    <td className="px-4 py-2 text-gray-500">{t.fecha ?? '—'}</td>
                    <td className="px-4 py-2">
                      {t.rut_conductor ? (
                        <Link href={`/dashboard/conductores/${encodeURIComponent(t.rut_conductor)}`} className="font-medium text-text-primary hover:text-accent transition-colors">
                          {t.conductor ?? '—'}
                        </Link>
                      ) : (t.conductor ?? '—')}
                    </td>
                    <td className="px-4 py-2 font-mono">{t.patente_tracto ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-[120px] truncate">{t.cd_planta_origen ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-[120px] truncate">{t.local_asignado ?? '—'}</td>
                    <td className="px-4 py-2">
                      {t.normalized_status ? (
                        <span
                          className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={colors ? { backgroundColor: colors.bg, color: colors.text } : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                        >
                          {t.normalized_status}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {trips.length > 50 && (
            <div className="px-5 py-3 border-t border-border text-xs text-gray-400 text-center">
              Mostrando 50 de {trips.length} viajes
            </div>
          )}
        </div>
      )}
    </div>
  )
}
