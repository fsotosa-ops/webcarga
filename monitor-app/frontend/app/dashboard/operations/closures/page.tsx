'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { dailyClosuresApi, isClosePendingError } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi, isEquipmentClosePendingError } from '@/lib/api/equipmentClosures'
import { FleetDriverGapCard } from '@/components/dashboard/FleetDriverGapCard'
import { FleetOverviewSection } from '@/components/dashboard/sections/FleetOverviewSection'
import { TractoreoDriverClosureSection } from '@/components/dashboard/sections/TractoreoDriverClosureSection'
import type { TripsMeta } from '@/lib/types'

const ADMIN_ROLES = new Set(['admin', 'owner'])

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const SECTIONS = [
  { id: 'resumen',            label: 'Resumen del día' },
  { id: 'pendientes',         label: 'Pendientes' },
  { id: 'tractoreo',          label: 'Cerrar Tractoreo' },
  { id: 'equipos-completos',  label: 'Cerrar Equipos Completos' },
  { id: 'reporte',            label: 'Confirmar cierre → Reporte' },
] as const

function SectionPlaceholder({ nextTask }: { nextTask: string }) {
  return (
    <div className="bg-white rounded-xl border border-border border-dashed px-4 py-8 text-center">
      <p className="text-xs text-gray-400">Esta sección se construye en una tarea posterior del plan ({nextTask}).</p>
    </div>
  )
}

export default function ClosuresCenterPage() {
  return (
    <Suspense fallback={null}>
      <ClosuresCenterPageInner />
    </Suspense>
  )
}

/** Centro de Cierre del Día unificado (Tarea 10, plan 1.1) — fusiona lo que
 *  hoy son 4 diálogos independientes (Vista de Flota, Cerrar Día, Reporte,
 *  más el checkbox suelto de la sábana) en una sola página de secciones
 *  ancladas. Solo "Cerrar Tractoreo" (Tarea 7) tiene contenido real hoy —
 *  las otras 4 son placeholders que tareas futuras (1.2 a 1.5) reemplazan.
 *
 *  "Confirmar cierre" vive acá (no en una sección) porque encadena 2
 *  llamados: primero Tractoreo (dailyClosuresApi.close, bloquea si hay
 *  pendientes — motivo obligatorio, HU-03), y solo si ese tuvo éxito,
 *  Equipos Completos (equipmentClosuresApi.close, nunca bloquea — cierre
 *  pasivo). Si el primero falla, el segundo no se llama. */
function ClosuresCenterPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fecha = searchParams.get('fecha') || todayISO()

  const [tripsMeta, setTripsMeta] = useState<TripsMeta | null>(null)
  const [canAdmin, setCanAdmin] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [overridePending, setOverridePending] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideNote, setOverrideNote] = useState('')

  useEffect(() => {
    fetchTripsMeta().then(setTripsMeta).catch(() => { /* fallback gracioso — usa defaults en la sección */ })
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])

  function setFecha(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('fecha', next)
    router.replace(`/dashboard/operations/closures?${params.toString()}`)
  }

  async function handleConfirmClose(override?: boolean) {
    setClosing(true); setCloseError(null)
    try {
      await dailyClosuresApi.close(fecha, override, overrideNote)
      setOverridePending(false); setOverrideOpen(false); setOverrideNote('')
    } catch (e) {
      setClosing(false)
      if (isClosePendingError(e)) {
        setOverridePending(true)
        setCloseError(e.detail.message)
      } else {
        setCloseError(e instanceof Error ? e.message : 'No se pudo cerrar el día')
      }
      return
    }
    try {
      await equipmentClosuresApi.close(fecha)
    } catch (e) {
      setCloseError(
        isEquipmentClosePendingError(e)
          ? e.detail.message
          : e instanceof Error ? e.message : 'No se pudo cerrar equipos completos',
      )
    } finally {
      setClosing(false)
    }
  }

  function handleSelectTrip(tripId: string) {
    router.push(`/dashboard/operations/monitor/trips/${tripId}`)
  }

  function handleCreateManualTrip(_driverId: string, _driverName: string) {
    // TODO(Tarea 1.3/1.4): montar TripAssignDialog prellenado con el
    // conductor — esta página todavía no lo aloja, ver mismo patrón que
    // monitor/page.tsx (prefillFleet/handleNewTripFromFleet).
  }

  return (
    <div className="p-6 flex gap-6">
      <nav className="w-48 shrink-0 sticky top-6 self-start space-y-1">
        {SECTIONS.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="block text-xs text-gray-500 hover:text-accent px-2 py-1.5 rounded-lg hover:bg-accent/5"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="flex-1 space-y-8 max-w-4xl">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
            <ClipboardCheck size={18} className="text-accent" /> Centro de Cierre — {fecha}
          </h1>
          <input
            type="date"
            aria-label="Fecha del cierre"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="text-xs border border-border rounded-lg px-2 py-1.5"
          />
        </div>

        <section id="resumen" className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Resumen del día</h2>
          <FleetOverviewSection fecha={fecha} onSelectTrip={handleSelectTrip} />
        </section>

        <section id="pendientes" className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Pendientes</h2>
          <SectionPlaceholder nextTask="Tarea 1.3" />
          <FleetDriverGapCard />
        </section>

        <section id="tractoreo" className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Cerrar Tractoreo</h2>
          <TractoreoDriverClosureSection
            fecha={fecha}
            unassignedReasons={tripsMeta?.unassigned_reasons ?? []}
            onSelectTrip={handleSelectTrip}
            onCreateManualTrip={handleCreateManualTrip}
          />
        </section>

        <section id="equipos-completos" className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Cerrar Equipos Completos</h2>
          <SectionPlaceholder nextTask="Tarea 1.4" />
        </section>

        <section id="reporte" className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Confirmar cierre → Reporte</h2>
          <SectionPlaceholder nextTask="Tarea 1.5" />

          {closeError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{closeError}</p>
          )}
          {overridePending && canAdmin && !overrideOpen && (
            <button type="button" onClick={() => setOverrideOpen(true)} className="block text-[11px] font-semibold text-amber-700 underline">
              Forzar cierre con override
            </button>
          )}
          {overrideOpen && (
            <div className="space-y-2">
              <textarea
                value={overrideNote}
                onChange={e => setOverrideNote(e.target.value)}
                placeholder="Comentario de justificación (obligatorio)"
                className="w-full text-xs border border-border rounded-lg px-3 py-2"
                rows={2}
              />
              <button
                type="button"
                disabled={closing || !overrideNote.trim()}
                onClick={() => handleConfirmClose(true)}
                className="text-xs font-semibold bg-amber-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                {closing ? 'Cerrando…' : 'Confirmar override y cerrar'}
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={closing}
            onClick={() => handleConfirmClose(false)}
            className="text-sm font-semibold bg-accent text-white rounded-lg px-4 py-2 disabled:opacity-40 flex items-center gap-2"
          >
            {closing ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
            Confirmar cierre
          </button>
        </section>
      </div>
    </div>
  )
}
