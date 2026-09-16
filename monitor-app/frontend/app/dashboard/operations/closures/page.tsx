'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, ClipboardCheck, Truck, AlertTriangle, FileBarChart2, Route, Loader2, UserX, CheckCircle2, LockOpen,
} from 'lucide-react'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { shippersApi } from '@/lib/api/locations'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { closuresApi, isCierrePendienteError, type SinFlota } from '@/lib/api/closures'
import { SinFlotaList } from '@/components/dashboard/SinFlotaList'
import { PendientesDelCierre, type ItemPendiente } from '@/components/dashboard/PendientesDelCierre'
import { tripsApi } from '@/lib/api/trips'
import { taxonomiesApi } from '@/lib/api/config'
import { FlotaDelDiaSection } from '@/components/dashboard/sections/FlotaDelDiaSection'
import { PreCierrePendingSection } from '@/components/dashboard/sections/PreCierrePendingSection'
import { StatusReportSection } from '@/components/dashboard/sections/StatusReportSection'
import { PasoViajesSection } from '@/components/dashboard/sections/PasoViajesSection'
import { AvisoPosteriorAlCierre } from '@/components/dashboard/AvisoPosteriorAlCierre'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import type { PeriodoDeCierre, TripsMeta } from '@/lib/types'


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
 *  Firmar el día es UNA llamada (`closuresApi.cerrar`, 16/09): conductores y
 *  tractos en una transacción. Hasta entonces eran dos POST encadenados desde
 *  acá, y si el segundo fallaba el día quedaba medio firmado sin que nada lo
 *  dijera; y al salir bien la pantalla no decía nada — "no me figura ningún
 *  mensaje, de bien o mal" (Operaciones).
 *
 *  Que el día está cerrado lo dice el PERÍODO que trae el GET, no un aviso
 *  efímero: quien entra después, o recarga, ve lo mismo. */
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
  const [reabrirOpen, setReabrirOpen] = useState(false)
  const [notaReabrir, setNotaReabrir] = useState('')
  const [reabriendo, setReabriendo] = useState(false)
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

  const diaCerrado = cierreQuery.data?.closed ?? false

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

  async function refrescarCierre() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] }),
      queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] }),
    ])
  }

  async function handleConfirmClose(override?: boolean) {
    setClosing(true)
    setCloseError(null); setSinFlota(null)
    setPendientesConductores([]); setPendientesEquipos([])
    try {
      await closuresApi.cerrar(fecha, override, overrideNote)
      setOverridePending(false); setOverrideOpen(false); setOverrideNote('')
      await refrescarCierre()
    } catch (e) {
      if (isCierrePendienteError(e)) {
        setOverridePending(true)
        setSinFlota(e.detail.sin_flota?.length ? e.detail.sin_flota : null)
        setPendientesConductores(
          (e.detail.pending ?? []).map(d => ({
            clave: d.driver_id,
            texto: `${d.full_name} — ${d.status === 'MISMATCH' ? 'empresa por regularizar' : 'sin motivo'}`,
          })),
        )
        setPendientesEquipos(
          (e.detail.pending_equipment ?? []).map(p => ({
            clave: p.asset_id,
            texto: p.carrier_name ? `${p.tractor_plate} — ${p.carrier_name}` : p.tractor_plate,
            href: p.carrier_id ? `/dashboard/carriers/${p.carrier_id}?tab=equipos` : undefined,
          })),
        )
        setCloseError(e.detail.message)
      } else {
        // Incluye "el día ya está cerrado" (otra persona firmó antes): se
        // refresca para que la pantalla muestre esa firma.
        setCloseError(e instanceof Error ? e.message : 'No se pudo cerrar el día')
        await refrescarCierre()
      }
    } finally {
      setClosing(false)
    }
  }

  async function handleReabrir() {
    setReabriendo(true); setCloseError(null)
    try {
      await closuresApi.reabrir(fecha, notaReabrir)
      setReabrirOpen(false); setNotaReabrir('')
      await refrescarCierre()
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'No se pudo reabrir el día')
    } finally {
      setReabriendo(false)
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
      {/* Sin `overflow-hidden` (14/09): recortaba para redondear las esquinas,
          pero de paso convertia a esta card en el scrollport de cualquier
          `position: sticky` de adentro — y como la card no scrollea, la barra
          de seleccion de "Viajes" no se pegaba nunca. Medido en el navegador:
          con la pagina arriba quedaba 2.751 px fuera de lo visible. Las
          esquinas las redondean ahora la barra de pestanas y el pie, que son
          los dos unicos hijos con fondo propio. */}
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <div role="tablist" className="flex items-center gap-1 bg-gray-50 border-b border-border px-3 py-2 overflow-x-auto rounded-t-2xl">
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

        <div className="border-t border-border bg-gray-50/60 p-5 sm:p-6 space-y-3 rounded-b-2xl">
          {diaCerrado ? (
            <DiaCerrado periodo={cierreQuery.data?.periodo ?? null} />
          ) : (
            <div>
              <h2 className="text-sm font-bold text-text-primary">Confirmar cierre</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Firma conductores y tractos juntos. Los dos exigen motivo en sus pendientes; Equipo Completo nunca bloquea.
              </p>
            </div>
          )}

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
          {!diaCerrado && (
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
          )}
          {/* Reabrir es un acto explícito: admin, con una nota que diga por
              qué. Antes un día "se reabría" solo, con entrar a la pantalla. */}
          {diaCerrado && canAdmin && !reabrirOpen && (
            <button
              type="button"
              onClick={() => setReabrirOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-informativo border border-border rounded-lg px-3 py-1.5 bg-white hover:border-accent/40"
            >
              <LockOpen size={12} /> Reabrir día
            </button>
          )}
          {diaCerrado && reabrirOpen && (
            <div className="space-y-2">
              <textarea
                value={notaReabrir}
                onChange={e => setNotaReabrir(e.target.value)}
                aria-label="Motivo para reabrir el día"
                placeholder="Por qué se reabre (obligatorio)"
                className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-white"
                rows={2}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={reabriendo || !notaReabrir.trim()}
                  onClick={handleReabrir}
                  className="text-xs font-semibold bg-text-primary text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                  {reabriendo ? 'Reabriendo…' : 'Confirmar y reabrir'}
                </button>
                <button
                  type="button"
                  onClick={() => { setReabrirOpen(false); setNotaReabrir('') }}
                  className="text-xs text-informativo hover:text-text-primary"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const HORA = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

/** El día firmado, dicho con nombre, hora y cifras. Lo que Operaciones pidió
 *  ver al cerrar ("no entrega ningún aviso de cierre finalizado"), y lo que ve
 *  cualquiera que abra el día después. */
function DiaCerrado({ periodo }: { periodo: PeriodoDeCierre | null }) {
  const t = periodo?.frozen_totals
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-resuelto/20 bg-resuelto/5 px-4 py-3">
      <CheckCircle2 size={16} className="text-resuelto shrink-0 mt-0.5" />
      <div className="text-xs text-text-primary space-y-0.5">
        <p className="font-bold">
          Día cerrado
          {periodo?.closed_by_name && <> por {periodo.closed_by_name}</>}
          {periodo?.closed_at && <> el {HORA.format(new Date(periodo.closed_at))}</>}
        </p>
        {t && (
          <p className="text-informativo tabular-nums">
            {t.conductores_resueltos ?? 0} de {t.conductores ?? 0} conductores
            {t.tractos != null && <> · {t.tractos_resueltos ?? 0} de {t.tractos} tractos</>}
            {' '}resueltos
            {(periodo?.override_count ?? 0) > 0 && <> · {periodo!.override_count} forzados con nota</>}
          </p>
        )}
      </div>
    </div>
  )
}
