'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useIsFetching, useQuery } from '@tanstack/react-query'
import {
  ChevronRight, ClipboardCheck, Truck, AlertTriangle, FileBarChart2, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { shippersApi } from '@/lib/api/locations'
import { dailyClosuresApi, isClosePendingError } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi, isEquipmentClosePendingError } from '@/lib/api/equipmentClosures'
import { FlotaDelDiaSection } from '@/components/dashboard/sections/FlotaDelDiaSection'
import { PreCierrePendingSection } from '@/components/dashboard/sections/PreCierrePendingSection'
import { StatusReportSection } from '@/components/dashboard/sections/StatusReportSection'
import type { TripsMeta } from '@/lib/types'

const ADMIN_ROLES = new Set(['admin', 'owner'])

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const TABS = [
  { id: 'flota',       label: 'Flota del día',  icon: Truck },
  { id: 'pendientes',  label: 'Pendientes',     icon: AlertTriangle },
  { id: 'reporte',     label: 'Reporte',        icon: FileBarChart2 },
] as const
type TabId = (typeof TABS)[number]['id']

export default function ClosuresCenterPage() {
  return (
    <Suspense fallback={null}>
      <ClosuresCenterPageInner />
    </Suspense>
  )
}

/** Centro de Cierre del Día unificado (Bloque 1) — fusiona lo que antes eran
 *  4 diálogos independientes en una sola página. Rediseño (feedback del
 *  usuario, 2026-08-04): funciona como un navtab de verdad — un solo lienzo
 *  (una card) con un tab bar arriba, y solo la sección activa se renderiza
 *  en el panel de abajo, en vez de apilar las 5 secciones en una columna
 *  larga con scroll y anclas. "Confirmar cierre" queda fijo al pie del
 *  mismo lienzo, visible sin importar qué tab esté activa — es la acción
 *  primaria de la página, no algo que dependa de estar en "Reporte".
 *
 *  Encadena 2 llamados: primero Tractoreo (dailyClosuresApi.close, bloquea
 *  si hay pendientes — motivo obligatorio, HU-03), y solo si ese tuvo
 *  éxito, Equipos Completos (equipmentClosuresApi.close, nunca bloquea —
 *  cierre pasivo). Si el primero falla, el segundo no se llama. */
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
  const [tab, setTab] = useState<TabId>('flota')

  // Las dos consultas que alimentan el cierre las dispara FlotaDelDiaSection;
  // acá sólo se observa su estado con las MISMAS queryKey — no se agrega una
  // consulta nueva ni se duplica el fetch.
  //
  // Los dos hooks se llaman SIEMPRE, cada uno en su línea: combinarlos con `||`
  // hace que el segundo no se ejecute cuando el primero es verdadero, y React
  // revienta por cambio en el orden de los hooks entre renders.
  const cargandoTractoreo = useIsFetching({ queryKey: ['daily-closure', fecha] })
  const cargandoEquipos = useIsFetching({ queryKey: ['equipment-closures', fecha] })
  const cargandoDatos = cargandoTractoreo > 0 || cargandoEquipos > 0

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
            Revisa pendientes, cierra Tractoreo y Equipos Completos, y comparte el reporte del día — todo en un solo lugar.
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

      {/* Un solo lienzo: tab bar arriba, panel de contenido abajo (solo la
          tab activa se renderiza), "Confirmar cierre" fijo al pie. */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div role="tablist" className="flex items-center gap-1 bg-gray-50 border-b border-border px-3 py-2 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            const isActive = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl whitespace-nowrap transition-colors ${
                  isActive ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary hover:bg-white/60'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {t.label}
              </button>
            )
          })}
        </div>

        <div className="p-5 sm:p-6">
          {tab === 'flota' && (
            <FlotaDelDiaSection
              fecha={fecha}
              unassignedReasons={tripsMeta?.unassigned_reasons ?? []}
              onSelectTrip={handleSelectTrip}
              onCreateManualTrip={handleCreateManualTrip}
            />
          )}
          {tab === 'pendientes' && <PreCierrePendingSection fecha={fecha} />}
          {tab === 'reporte' && <StatusReportSection fecha={fecha} shippers={shippersQuery.data} />}
        </div>

        <div className="border-t border-border bg-gray-50/60 p-5 sm:p-6 space-y-3">
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
          {/* Firmar el dia es un acto con nombre y hora: no puede ocurrir sobre
              datos que todavia no llegaron. El boton solo miraba `closing` (si
              el cierre esta en curso), asi que quedaba habilitado mientras el
              area de datos mostraba el spinner. */}
          <button
            type="button"
            disabled={closing || cargandoDatos}
            onClick={() => handleConfirmClose(false)}
            className="text-sm font-semibold bg-accent text-white rounded-lg px-4 py-2.5 disabled:opacity-40 flex items-center gap-2 hover:bg-accent/90 transition-colors"
          >
            {closing || cargandoDatos
              ? <Loader2 size={14} className="motion-safe:animate-spin" />
              : <ClipboardCheck size={14} />}
            Confirmar cierre
          </button>
        </div>
      </div>
    </div>
  )
}
