'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, ClipboardCheck, Truck, AlertTriangle, FileBarChart2, Route, Loader2, UserX, CheckCircle2, LockOpen,
} from 'lucide-react'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
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
import { AjustesPosterioresAlCierre } from '@/components/dashboard/AjustesPosterioresAlCierre'
import { HistorialDeFirmas } from '@/components/dashboard/HistorialDeFirmas'
import { IndicadorDeAjustes } from '@/components/dashboard/IndicadorDeAjustes'
import { AvisoDeActualizacion } from '@/components/dashboard/AvisoDeActualizacion'
import { Estado } from '@/components/ui/Estado'
import { urlDelViaje } from '@/lib/navegacion/viaje'
import { esUrlVieja, leerUrlDelCierre, urlDelCierre } from '@/lib/navegacion/cierre'
import type { PestanaDeViajes } from '@/lib/cierre/gruposDeViajes'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import type { PeriodoDeCierre, TripsMeta } from '@/lib/types'
import { usePermiso } from '@/lib/authz/PermisosProvider'


function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const TABS = [
  // Los id viajan en la URL (?tab=): en inglés, como las rutas. La etiqueta, en español.
  { id: 'fleet',   label: 'Flota del día',  icon: Truck },
  { id: 'trips',   label: 'Viajes',         icon: Route },
  { id: 'pending', label: 'Pendientes',     icon: AlertTriangle },
  { id: 'report',  label: 'Reporte',        icon: FileBarChart2 },
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
  const url = leerUrlDelCierre(searchParams)
  const fecha = url.date || todayISO()

  const [tripsMeta, setTripsMeta] = useState<TripsMeta | null>(null)
  // Forzar con pendientes: closures.override; reabrir: closures.sign (RBAC).
  const puedeForzar = usePermiso('closures.override')
  // Firmar y reabrir son el mismo permiso (closures.sign).
  const puedeReabrir = usePermiso('closures.sign')
  const puedeFirmar = puedeReabrir
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
  // La pestaña vive en la URL (?tab=): así el detalle de un viaje abierto desde
  // acá puede devolver a la misma pestaña (bug 10/10).
  // Arranca de la URL y la mantiene al día con `replace` (sin entradas nuevas en
  // el historial, así que la URL y la pestaña no se desincronizan).
  const [tab, setTabState] = useState<TabId>(() => {
    return url.tab ?? 'fleet'
  })
  function setTab(next: TabId) {
    setTabState(next)
    router.replace(urlDelCierre(searchParams, { tab: next }))
  }
  // La pestaña de Viajes también vive en la URL (?trips=), por el mismo motivo
  // que ?tab=: volver del detalle de un viaje deja todo donde estaba.
  function setPestanaDeViajes(next: PestanaDeViajes) {
    router.replace(urlDelCierre(searchParams, { trips: next }))
  }
  // Un enlace viejo (?fecha=, ?tab=viajes) se lee igual y se reescribe en inglés,
  // sin entrada nueva en el historial.
  useEffect(() => {
    if (esUrlVieja(searchParams)) router.replace(urlDelCierre(searchParams, {}))
  }, [searchParams, router])

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
  // El día no se reabre: `cierre.ajustes` son los cambios posteriores a la firma,
  // viaje por viaje (spec 2026-10-10 §4).
  const cierreQuery = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
    // El Cierre se calcula en segundo plano (spec 2026-10-10): mientras el día
    // tiene cambios por entrar, se vuelve a pedir hasta que estén.
    refetchInterval: q => (q.state.data?.pendiente_desde ? 15_000 : false),
  })

  const diaCerrado = cierreQuery.data?.closed ?? false
  // Los ajustes sólo existen en un día firmado: en uno abierto, lo que cambia
  // entra en su recálculo (spec 2026-10-10 §4).
  const ajustes = diaCerrado ? (cierreQuery.data?.cierre?.ajustes ?? []) : []
  // El indicador está al pie de la tarjeta y la sección arriba del panel: además de
  // abrir la pestaña, hay que llevar la vista hasta la sección (spec §3).
  const ajustesRef = useRef<HTMLDivElement>(null)
  const [irAAjustes, setIrAAjustes] = useState(0)
  useEffect(() => {
    if (irAAjustes > 0) ajustesRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [irAAjustes])

  // Las veces que se firmó el día (spec 2026-10-10 §3). También en un día
  // reabierto: lo firmado antes sigue guardado, y es justo lo que se quiere ver.
  const firmasQuery = useQuery({
    queryKey: ['closure-signatures', fecha],
    queryFn: () => closuresApi.signatures(fecha),
  })

  // Cuando el día queda al día, las otras dos consultas del mismo día también
  // se refrescan: las tres leen las mismas líneas.
  const pendiente = cierreQuery.data?.pendiente_desde ?? null
  const pendienteAnterior = useRef<string | null>(null)
  useEffect(() => {
    if (pendienteAnterior.current && !pendiente) {
      queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
      queryClient.invalidateQueries({ queryKey: ['status-report', fecha] })
    }
    pendienteAnterior.current = pendiente
  }, [pendiente, fecha, queryClient])

  useEffect(() => {
    fetchTripsMeta().then(setTripsMeta).catch(() => { /* fallback gracioso — usa defaults en la sección */ })
  }, [])


  // Paso "Viajes" (Tarea 6) — sólo se pide mientras esa pestaña está activa;
  // las demás pestañas no la necesitan y el tab bar ya renderiza sólo la
  // sección activa.
  const cierreViajesQuery = useQuery({
    queryKey: ['cierre-viajes', fecha],
    queryFn: () => tripsApi.cierreViajes(fecha),
    enabled: tab === 'trips',
  })
  const motivosViajesQuery = useQuery({
    queryKey: ['taxonomies', 'TRIP_UNASSIGNED_REASON'],
    queryFn: () => taxonomiesApi.list('TRIP_UNASSIGNED_REASON'),
    enabled: tab === 'trips',
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

  // Mismo contrato que handleCerrarViajes: el error de escritura sube a la
  // sección, el refetch fallido no se disfraza de "no se deshizo".
  async function handleDeshacerViajes(tripIds: string[]) {
    await tripsApi.bulkReopen(tripIds)
    try {
      await queryClient.invalidateQueries({ queryKey: ['cierre-viajes', fecha] })
    } catch {
      // Ver handleCerrarViajes.
    }
  }


  function setFecha(next: string) {
    router.replace(urlDelCierre(searchParams, { date: next }))
  }

  async function refrescarCierre() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] }),
      queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] }),
      queryClient.invalidateQueries({ queryKey: ['closure-signatures', fecha] }),
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

  /** Este cierre, con su fecha y pestaña: a donde vuelve el detalle de un viaje. */
  function urlDeEsteCierre(): string {
    return urlDelCierre(searchParams, { date: fecha, tab })
  }

  function handleSelectTrip(tripId: string) {
    router.push(urlDelViaje(tripId, urlDeEsteCierre()))
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

      <HistorialDeFirmas firmas={firmasQuery.data?.signatures ?? []} />
      {cierreQuery.data && (
        <AvisoDeActualizacion pendienteDesde={pendiente} calculadoA={cierreQuery.data.calculado_a ?? null} />
      )}

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
                // El número de la pestaña dice qué cuenta: "Viajes 12" a secas no lo dice.
                aria-label={t.id === 'trips' && ajustes.length > 0
                  ? `Viajes, ${ajustes.length} ${ajustes.length === 1 ? 'ajuste posterior' : 'ajustes posteriores'} al cierre`
                  : undefined}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl whitespace-nowrap transition-colors ${
                  isActive ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary hover:bg-white/60'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {t.label}
                {t.id === 'trips' && ajustes.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-gray-200 px-1.5 text-[10px] font-bold tabular-nums text-text-secondary">
                    {ajustes.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="p-5 sm:p-6">
          {tab === 'fleet' && (
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
          {tab === 'trips' && (<>
            <div ref={ajustesRef} className="scroll-mt-4">
              <AjustesPosterioresAlCierre ajustes={ajustes} volverA={urlDeEsteCierre()} />
            </div>
            {cierreViajesQuery.isError ? (
              <Estado tipo="error" titulo="No se pudieron cargar los viajes" detalle="Intenta de nuevo en unos segundos.">
                <button
                  type="button"
                  onClick={() => { void cierreViajesQuery.refetch() }}
                  className="text-etiqueta font-semibold border border-border rounded-lg px-2.5 py-1 bg-white text-text-primary hover:bg-bg-main"
                >
                  Reintentar
                </button>
              </Estado>
            ) : (
              <PasoViajesSection
                // Otro día, otra selección, búsqueda y pestaña inicial.
                key={fecha}
                fecha={fecha}
                grupos={cierreViajesQuery.data?.grupos}
                bloquean={cierreViajesQuery.data?.bloquean}
                cargando={cierreViajesQuery.isLoading}
                motivos={motivosViajesQuery.data ?? []}
                onCerrar={handleCerrarViajes}
                onDeshacer={handleDeshacerViajes}
                meta={tripsMeta}
                soloLectura={diaCerrado}
                pestana={url.trips}
                onCambiarPestana={setPestanaDeViajes}
              />
            )}
          </>)}
          {tab === 'pending' && <PreCierrePendingSection fecha={fecha} />}
          {tab === 'report' && <StatusReportSection fecha={fecha} />}
        </div>

        <div className="border-t border-border bg-gray-50/60 p-5 sm:p-6 space-y-3 rounded-b-2xl">
          {diaCerrado ? (
            <DiaCerrado periodo={cierreQuery.data?.periodo ?? null} ajustes={ajustes.length} onVerAjustes={() => { setTab('trips'); setIrAAjustes(n => n + 1) }} />
          ) : (
            <div>
              <h2 className="text-sm font-bold text-text-primary">Confirmar cierre</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {puedeFirmar
                  ? 'Firma conductores y tractos juntos. Los dos exigen motivo en sus pendientes; Equipo Completo nunca bloquea.'
                  : 'El cierre lo firma Operaciones. Puedes revisarlo, pero no firmarlo.'}
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
          {overridePending && puedeForzar && !overrideOpen && (
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
          {!diaCerrado && puedeFirmar && (
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
          {diaCerrado && puedeReabrir && !reabrirOpen && (
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
function DiaCerrado({ periodo, ajustes, onVerAjustes }: {
  periodo: PeriodoDeCierre | null
  /** Ajustes posteriores a la firma vigente: el indicador lleva a la pestaña Viajes. */
  ajustes: number
  onVerAjustes: () => void
}) {
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
        <IndicadorDeAjustes cantidad={ajustes} onVer={onVerAjustes} />
      </div>
    </div>
  )
}
