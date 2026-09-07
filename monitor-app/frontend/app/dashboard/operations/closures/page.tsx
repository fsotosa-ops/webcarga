'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, ClipboardCheck, Truck, AlertTriangle, FileBarChart2, Route, Loader2, UserX,
} from 'lucide-react'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { shippersApi } from '@/lib/api/locations'
import { dailyClosuresApi, isClosePendingError, type SinFlota } from '@/lib/api/dailyClosures'
import { SinFlotaList } from '@/components/dashboard/SinFlotaList'
import { PendientesDelCierre, type ItemPendiente } from '@/components/dashboard/PendientesDelCierre'
import { equipmentClosuresApi, isEquipmentClosePendingError } from '@/lib/api/equipmentClosures'
import { tripsApi } from '@/lib/api/trips'
import { taxonomiesApi } from '@/lib/api/config'
import { FlotaDelDiaSection } from '@/components/dashboard/sections/FlotaDelDiaSection'
import { PreCierrePendingSection } from '@/components/dashboard/sections/PreCierrePendingSection'
import { StatusReportSection } from '@/components/dashboard/sections/StatusReportSection'
import { PasoViajesSection } from '@/components/dashboard/sections/PasoViajesSection'
import { AvisoPosteriorAlCierre } from '@/components/dashboard/AvisoPosteriorAlCierre'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import type { TripsMeta } from '@/lib/types'


function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const TABS = [
  { id: 'flota',       label: 'Flota del día',  icon: Truck },
  { id: 'viajes',      label: 'Viajes',         icon: Route },
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
 *  Encadena 2 llamados: primero los CONDUCTORES (dailyClosuresApi.close) y,
 *  sólo si ese tuvo éxito, los TRACTOS (equipmentClosuresApi.close). Si el
 *  primero falla, el segundo no se llama, y el override viaja a los dos.
 *
 *  "Equipos Completos nunca bloquea" describía sólo la mitad del segundo
 *  paso: los tractos de Equipo Completo puro son pasivos, pero los de
 *  Tractoreo —y los que no tienen tipo de operación, que caen ahí— exigen
 *  motivo y devuelven 409. Ese 409 es el que dejó `app.equipment_closures`
 *  vacía desde que existe: el override no llegaba y el detalle no se
 *  mostraba. */
function ClosuresCenterPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const fecha = searchParams.get('fecha') || todayISO()

  const [tripsMeta, setTripsMeta] = useState<TripsMeta | null>(null)
  const canAdmin = useCanAdmin()
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [overridePending, setOverridePending] = useState(false)
  // Mismo hueco que tenía CloseDayDialog: el 409 trae los viajes cuya flota no
  // está en el directorio y esta pantalla sólo mostraba el texto del mensaje.
  const [sinFlota, setSinFlota] = useState<SinFlota[] | null>(null)
  // El mismo hueco que sinFlota tenía, en las otras dos listas: el 409 trae
  // quiénes bloquean y hasta el 2026-09-07 la pantalla mostraba sólo el
  // número. Un número sin sus filas no dice qué hacer.
  const [pendientesConductores, setPendientesConductores] = useState<ItemPendiente[]>([])
  const [pendientesEquipos, setPendientesEquipos] = useState<ItemPendiente[]>([])
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

  // Tarea 7 (plan cierre-paso-viajes): misma queryKey que FlotaDelDiaSection
  // — se comparte la respuesta ya en caché, no se dispara un segundo fetch.
  // El día no se reabre: `posteriores_al_cierre` es sólo el delta que llegó
  // después de la firma.
  const cierreQuery = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })

  useEffect(() => {
    fetchTripsMeta().then(setTripsMeta).catch(() => { /* fallback gracioso — usa defaults en la sección */ })
  }, [])

  const shippersQuery = useQuery({
    queryKey: ['shippers'],
    queryFn: () => shippersApi.list(),
    staleTime: 5 * 60_000,
  })

  // Paso "Viajes" (Tarea 6) — sólo se pide mientras esa pestaña está activa;
  // las demás pestañas no la necesitan y el tab bar ya renderiza sólo la
  // sección activa.
  const cierreViajesQuery = useQuery({
    queryKey: ['cierre-viajes', fecha],
    queryFn: () => tripsApi.cierreViajes(fecha),
    enabled: tab === 'viajes',
  })
  const motivosViajesQuery = useQuery({
    queryKey: ['taxonomies', 'TRIP_UNASSIGNED_REASON'],
    queryFn: () => taxonomiesApi.list('TRIP_UNASSIGNED_REASON'),
    enabled: tab === 'viajes',
    staleTime: 5 * 60_000,
  })

  // Si `bulkClose` revienta, la excepción sube tal cual: `PasoViajesSection`
  // la captura (mismo camino de escritura que `handleConfirmClose` con
  // `closeError`) y muestra el error sin limpiar la selección — nadie cree
  // que cerró N viajes cuando no cerró ninguno. El `invalidateQueries` de
  // abajo va aparte: si el cierre YA tuvo éxito, que el refetch falle no
  // puede disfrazarse de "no se cerró nada".
  async function handleCerrarViajes(tripIds: string[], motivoId: string) {
    await tripsApi.bulkClose(tripIds, motivoId)
    try {
      await queryClient.invalidateQueries({ queryKey: ['cierre-viajes', fecha] })
    } catch {
      // La próxima vez que se entre a la pestaña "Viajes" vuelve a pedir el
      // dato — no hace falta reintentar acá.
    }
  }


  function setFecha(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('fecha', next)
    router.replace(`/dashboard/operations/closures?${params.toString()}`)
  }

  async function handleConfirmClose(override?: boolean) {
    setClosing(true)
    setCloseError(null); setSinFlota(null)
    setPendientesConductores([]); setPendientesEquipos([])
    try {
      await dailyClosuresApi.close(fecha, override, overrideNote)
    } catch (e) {
      setClosing(false)
      if (isClosePendingError(e)) {
        setOverridePending(true)
        setSinFlota(e.detail.sin_flota ?? null)
        setPendientesConductores(
          (e.detail.pending ?? []).map(d => ({
            clave: d.driver_id,
            texto: `${d.full_name} — ${d.status === 'MISMATCH' ? 'empresa por regularizar' : 'sin motivo'}`,
          })),
        )
        setCloseError(e.detail.message)
      } else {
        setCloseError(e instanceof Error ? e.message : 'No se pudo cerrar el día')
      }
      return
    }
    // El override del admin también viaja acá. Antes se llamaba sin él, así que
    // con equipos pendientes el segundo paso devolvía 409 siempre y el día no
    // se podía firmar ni forzando: `app.equipment_closures` quedó vacía desde
    // que existe.
    try {
      await equipmentClosuresApi.close(fecha, override, overrideNote)
      setOverridePending(false); setOverrideOpen(false); setOverrideNote('')
    } catch (e) {
      if (isEquipmentClosePendingError(e)) {
        setOverridePending(true)
        setPendientesEquipos(
          (e.detail.pending ?? []).map(p => ({
            clave: p.asset_id,
            texto: p.carrier_name ? `${p.tractor_plate} — ${p.carrier_name}` : p.tractor_plate,
            href: p.carrier_id ? `/dashboard/carriers/${p.carrier_id}?tab=equipos` : undefined,
          })),
        )
        setCloseError(e.detail.message)
      } else {
        setCloseError(e instanceof Error ? e.message : 'No se pudo cerrar equipos completos')
      }
    } finally {
      setClosing(false)
    }
  }

  function handleSelectTrip(tripId: string) {
    router.push(`/dashboard/operations/monitor/trips/${tripId}`)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Link href="/dashboard/operations/monitor" className="hover:text-accent">Operaciones</Link>
        <ChevronRight size={12} />
        <span className="font-semibold text-text-primary">Centro de Cierre</span>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm p-5 sm:p-6 flex items-center justify-between gap-4 flex-wrap">
        <EncabezadoDePagina
          titulo="Centro de Cierre del Día"
          icono={<ClipboardCheck size={20} className="text-accent" />}
          bajada="Revisa pendientes, cierra los conductores y los tractos del día, y comparte el reporte — todo en un solo lugar."
        />
        <label className="flex items-center gap-2 text-etiqueta text-gray-500">
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

      {/* Va AL LADO del encabezado de arriba, no lo reemplaza: el día sigue
          firmado y sigue diciendo "Cerrado" — esto es el delta que llegó
          después, nunca una reapertura. */}
      <AvisoPosteriorAlCierre
        cantidad={cierreQuery.data?.cierre?.posteriores_al_cierre ?? 0}
      />

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
              // Sin `onCreateManualTrip`: esta página todavía no aloja el
              // TripAssignDialog (TODO Tarea 1.3/1.4, mismo patrón que
              // monitor/page.tsx con prefillFleet/handleNewTripFromFleet), y
              // hasta el 2026-09-07 lo pasaba con un handler vacío — el botón
              // se veía y no hacía nada. La sección ya no lo dibuja si nadie
              // puede responderle.
            />
          )}
          {tab === 'viajes' && (
            cierreViajesQuery.isError ? (
              <Estado
                tipo="error"
                titulo="No se pudieron cargar los viajes"
                detalle="Intenta de nuevo en unos segundos."
              />
            ) : (
              <PasoViajesSection
                grupos={cierreViajesQuery.data?.grupos}
                bloquean={cierreViajesQuery.data?.bloquean}
                cargando={cierreViajesQuery.isLoading}
                motivos={motivosViajesQuery.data ?? []}
                onCerrar={handleCerrarViajes}
              />
            )
          )}
          {tab === 'pendientes' && <PreCierrePendingSection fecha={fecha} />}
          {tab === 'reporte' && <StatusReportSection fecha={fecha} shippers={shippersQuery.data} />}
        </div>

        <div className="border-t border-border bg-gray-50/60 p-5 sm:p-6 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Confirmar cierre</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Cierra primero los conductores y después los tractos. Los dos exigen motivo en sus pendientes; Equipo Completo nunca bloquea.
            </p>
          </div>

          {closeError && (
            <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <p>{closeError}</p>
              <PendientesDelCierre
                titulo="Conductores sin resolver"
                icono={<UserX size={11} />}
                items={pendientesConductores}
              />
              <PendientesDelCierre
                titulo="Tractos sin motivo"
                icono={<Truck size={11} />}
                items={pendientesEquipos}
              />
              {sinFlota && <SinFlotaList casos={sinFlota} />}
            </div>
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
