'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight, ClipboardCheck, LayoutGrid, AlertTriangle, Truck, Package, FileBarChart2, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { shippersApi } from '@/lib/api/locations'
import { dailyClosuresApi, isClosePendingError } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi, isEquipmentClosePendingError } from '@/lib/api/equipmentClosures'
import { EquipoCompletoClosureSection } from '@/components/dashboard/sections/EquipoCompletoClosureSection'
import { FleetOverviewSection } from '@/components/dashboard/sections/FleetOverviewSection'
import { PreCierrePendingSection } from '@/components/dashboard/sections/PreCierrePendingSection'
import { StatusReportSection } from '@/components/dashboard/sections/StatusReportSection'
import { TractoreoDriverClosureSection } from '@/components/dashboard/sections/TractoreoDriverClosureSection'
import type { TripsMeta } from '@/lib/types'

const ADMIN_ROLES = new Set(['admin', 'owner'])

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const SECTIONS = [
  { id: 'resumen',            label: 'Resumen del día',              icon: LayoutGrid },
  { id: 'pendientes',         label: 'Pendientes',                   icon: AlertTriangle },
  { id: 'tractoreo',          label: 'Cerrar Tractoreo',             icon: Truck },
  { id: 'equipos-completos',  label: 'Cerrar Equipos Completos',     icon: Package },
  { id: 'reporte',            label: 'Reporte',                      icon: FileBarChart2 },
] as const

/** Card contenedora consistente con el resto del producto (Certificación,
 *  ficha de Empresa): bg blanco + borde + sombra + radio grande — cada
 *  sección del Centro de Cierre vive en la suya, en vez de flotar
 *  directamente sobre el canvas gris del layout (feedback explícito del
 *  usuario: "como si fuese el lienzo gris y se escribió sobre él"). */
function SectionCard({ id, title, meta, children }: { id: string; title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-bold text-text-primary">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  )
}

export default function ClosuresCenterPage() {
  return (
    <Suspense fallback={null}>
      <ClosuresCenterPageInner />
    </Suspense>
  )
}

/** Centro de Cierre del Día unificado (Bloque 1) — fusiona lo que antes eran
 *  4 diálogos independientes en una sola página de secciones ancladas.
 *  Rediseño visual (feedback del usuario, 2026-08-04): cada sección pasa a
 *  vivir en su propia card blanca (mismo lenguaje que Certificación/ficha de
 *  Empresa — header en card, tabs tipo pill, sombra+borde consistentes),
 *  con nav lateral con estado activo por scroll y un ancho de contenido que
 *  ya no se angosta con un max-w innecesario para una página de tablas.
 *
 *  "Confirmar cierre" vive en su propia card al final (no dentro de
 *  "Reporte") porque encadena 2 llamados: primero Tractoreo
 *  (dailyClosuresApi.close, bloquea si hay pendientes — motivo obligatorio,
 *  HU-03), y solo si ese tuvo éxito, Equipos Completos
 *  (equipmentClosuresApi.close, nunca bloquea — cierre pasivo). Si el
 *  primero falla, el segundo no se llama. */
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
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id)

  useEffect(() => {
    fetchTripsMeta().then(setTripsMeta).catch(() => { /* fallback gracioso — usa defaults en la sección */ })
  }, [])

  const shippersQuery = useQuery({
    queryKey: ['shippers'],
    queryFn: () => shippersApi.list(),
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])

  // Nav lateral con estado activo por scroll — misma idea que un scrollspy
  // de docs: la sección visible más arriba en el viewport marca el ítem
  // activo, sin depender de que el usuario haga click en el nav primero.
  // Guard de IntersectionObserver: no existe en jsdom (tests) ni en
  // navegadores muy viejos — sin él el nav simplemente no resalta la
  // sección activa, degradación aceptable.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveSection(visible[0].target.id)
      },
      { rootMargin: '-72px 0px -70% 0px', threshold: 0 },
    )
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
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
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Link href="/dashboard/operations/monitor" className="hover:text-accent">Operaciones</Link>
        <ChevronRight size={12} />
        <span className="font-semibold text-text-primary">Centro de Cierre</span>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <ClipboardCheck size={20} className="text-accent" /> Centro de Cierre del Día
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Revisá pendientes, cerrá Tractoreo y Equipos Completos, y compartí el reporte del día — todo en un solo lugar.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Fecha
          <input
            type="date"
            aria-label="Fecha del cierre"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40"
          />
        </label>
      </div>

      <div className="flex gap-6 items-start">
        <nav className="w-56 shrink-0 sticky top-6 self-start bg-white rounded-2xl border border-border shadow-sm p-2 space-y-0.5">
          {SECTIONS.map(s => {
            const Icon = s.icon
            const isActive = activeSection === s.id
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl transition-colors ${
                  isActive ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:text-text-primary hover:bg-gray-50'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {s.label}
              </a>
            )
          })}
        </nav>

        <div className="flex-1 min-w-0 space-y-6">
          <SectionCard id="resumen" title="Resumen del día">
            <FleetOverviewSection fecha={fecha} onSelectTrip={handleSelectTrip} />
          </SectionCard>

          <SectionCard id="pendientes" title="Pendientes">
            <PreCierrePendingSection fecha={fecha} />
          </SectionCard>

          <SectionCard id="tractoreo" title="Cerrar Tractoreo">
            <TractoreoDriverClosureSection
              fecha={fecha}
              unassignedReasons={tripsMeta?.unassigned_reasons ?? []}
              onSelectTrip={handleSelectTrip}
              onCreateManualTrip={handleCreateManualTrip}
            />
          </SectionCard>

          <SectionCard id="equipos-completos" title="Cerrar Equipos Completos">
            <EquipoCompletoClosureSection fecha={fecha} />
          </SectionCard>

          <SectionCard id="reporte" title="Reporte del día">
            <StatusReportSection fecha={fecha} shippers={shippersQuery.data} />
          </SectionCard>

          <section className="bg-accent/5 rounded-2xl border border-accent/20 p-5 sm:p-6 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-text-primary">Confirmar cierre</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Cierra Tractoreo (requiere motivo en todos los pendientes) y, si eso tiene éxito, Equipos Completos (nunca bloquea).
              </p>
            </div>

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
                  className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-white"
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
              className="text-sm font-semibold bg-accent text-white rounded-lg px-4 py-2.5 disabled:opacity-40 flex items-center gap-2 hover:bg-accent/90 transition-colors"
            >
              {closing ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
              Confirmar cierre
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
