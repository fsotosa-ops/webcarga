import { createClient, createGoldClient } from '@/lib/supabase/server'
import DiarioTable from '@/components/dashboard/DiarioTable'
import type { UserRole } from '@/lib/types'

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

interface PageProps {
  searchParams: Promise<{ fecha?: string }>
}

export default async function DiarioPage({ searchParams }: PageProps) {
  const [supabase, goldSupabase] = await Promise.all([createClient(), createGoldClient()])
  const { data: { user } } = await supabase.auth.getUser()
  const { fecha: fechaParam } = await searchParams
  const fecha = fechaParam ?? todayISO()

  const [{ data: trips }, { data: manualFields }, { data: profile }] = await Promise.all([
    goldSupabase.from('v_diario_trips').select('*'),
    goldSupabase.from('diario_manual_fields').select('*').eq('fecha', fecha),
    supabase.from('profiles').select('role').eq('id', user?.id ?? '').single(),
  ])

  const userRole = ((profile?.role ?? 'viewer') as UserRole)

  const manualMap = new Map((manualFields ?? []).map(m => [m.dni_driver, m]))
  const rows = (trips ?? []).map(t => ({
    ...t,
    manual: t.rut_conductor ? (manualMap.get(t.rut_conductor) ?? null) : null,
  }))

  const displayDate = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary capitalize">{displayDate}</h1>
          <p className="text-xs text-gray-400 mt-0.5">{rows.length} viajes cargados</p>
        </div>
        <DateNav fecha={fecha} />
      </div>

      <DiarioTable rows={rows} userId={user?.id ?? ''} fecha={fecha} userRole={userRole} />
    </div>
  )
}

function DateNav({ fecha }: { fecha: string }) {
  const d = new Date(fecha + 'T12:00:00')
  const prev = new Date(d); prev.setDate(prev.getDate() - 1)
  const next = new Date(d); next.setDate(next.getDate() + 1)
  const todayISO = new Date().toISOString().split('T')[0]
  const isToday = fecha === todayISO

  const fmt = (dt: Date) => dt.toISOString().split('T')[0]

  return (
    <div className="flex items-center gap-1 shrink-0">
      <a
        href={`/dashboard/diario?fecha=${fmt(prev)}`}
        className="px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-white hover:border-accent transition-colors text-gray-500"
      >
        ← Anterior
      </a>
      {!isToday && (
        <a
          href="/dashboard/diario"
          className="px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-white hover:border-accent transition-colors text-accent font-medium"
        >
          Hoy
        </a>
      )}
      <a
        href={`/dashboard/diario?fecha=${fmt(next)}`}
        className="px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-white hover:border-accent transition-colors text-gray-500"
      >
        Siguiente →
      </a>
    </div>
  )
}
