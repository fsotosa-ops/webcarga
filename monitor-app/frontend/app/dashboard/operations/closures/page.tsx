'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardCheck, Truck, Loader2, UserX, CheckCircle2, LockOpen,
} from 'lucide-react'
import { fetchTripsMeta } from '@/lib/api/tripsMeta'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { closuresApi, isCierrePendienteError, type SinFlota } from '@/lib/api/closures'
import { SinFlotaList } from '@/components/dashboard/SinFlotaList'
import { PendientesDelCierre, type ItemPendiente } from '@/components/dashboard/PendientesDelCierre'
import { tripsApi } from '@/lib/api/trips'
import { taxonomiesApi } from '@/lib/api/config'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import { FlotaDelDiaSection } from '@/components/dashboard/sections/FlotaDelDiaSection'
import { PreCierrePendingSection } from '@/components/dashboard/sections/PreCierrePendingSection'
import { StatusReportSection } from '@/components/dashboard/sections/StatusReportSection'
import { PasoViajesSection } from '@/components/dashboard/sections/PasoViajesSection'
import { AjustesPosterioresAlCierre } from '@/components/dashboard/AjustesPosterioresAlCierre'
import { HistorialDeFirmas } from '@/components/dashboard/HistorialDeFirmas'
import { IndicadorDeAjustes } from '@/components/dashboard/IndicadorDeAjustes'
import { AvisoDeActualizacion, refetchWhilePending } from '@/components/dashboard/AvisoDeActualizacion'
import { Estado } from '@/components/ui/Estado'
import { urlDelViaje } from '@/lib/navegacion/viaje'
import { esUrlVieja, leerUrlDelCierre, urlDelCierre } from '@/lib/navegacion/cierre'
import { GRUPOS_DE_VIAJES, closureTrips } from '@/lib/cierre/gruposDeViajes'
import { scopeSummary } from '@/lib/cierre/dayFleet'
import { useClosureNotices } from '@/hooks/useClosureNotices'
import { inScope } from '@/lib/cierre/scope'
import { REPORT_CLIENT_FILTER, reportSectionOf, type ReportSection } from '@/lib/reporte/secciones'
import { SCOPE_LABEL } from '@/lib/states'
import { useDayFleet } from '@/hooks/useDayFleet'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Tabs } from '@/components/ui/Tabs'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import type { ClosureScope, PeriodoDeCierre, TripsMeta } from '@/lib/types'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EntityQuickView } from '@/components/dashboard/EntityQuickView'
import { useQuickView, type QuickViewTarget } from '@/lib/quickView'
import { PageContainer } from '@/components/ui/PageContainer'
import { Button } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Field'


function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

// Los id viajan en la URL (?tab=): en inglés, como las rutas. La etiqueta, en español.
const TABS = [
  { id: 'fleet',   label: 'Flota del día' },
  { id: 'trips',   label: 'Viajes' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'report',  label: 'Reporte' },
] as const
type TabId = (typeof TABS)[number]['id']
const ALCANCES: ClosureScope[] = ['tractoreo', 'equipo_completo']

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
  const puedePedirDocumentos = usePermiso('certification.request')
  // Firmar y reabrir son el mismo permiso (closures.sign).
  const puedeReabrir = usePermiso('closures.sign')
  const puedeFirmar = puedeReabrir
  // Vista rápida de empresa, conductor o equipo (HU 20261011/01): sin salir del
  // Cierre; `quickViewOrigin` marca la fila desde la que se abrió.
  const puedeVerDirectorio = usePermiso('directory.read')
  const quickView = useQuickView()
  const [quickViewOrigin, setQuickViewOrigin] = useState<string | null>(null)
  function openQuickView(target: QuickViewTarget, origin: string) {
    quickView.open(target)
    setQuickViewOrigin(origin)
  }
  function closeQuickView() {
    quickView.close()
    setQuickViewOrigin(null)
  }
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
  // La sección del Reporte, en la URL (?section=): cambiarla deja atrás los filtros de su
  // tabla, salvo el Cliente, que vale para todo el Reporte.
  function setSeccionDelReporte(section: ReportSection) {
    router.replace(urlDelCierre(searchParams, { section }, { keepFilters: [REPORT_CLIENT_FILTER] }))
  }
  // Qué se cierra (D1): uno para las cuatro pestañas, en la URL (?scope=).
  const alcance = url.scope
  function setAlcance(next: ClosureScope) {
    router.replace(urlDelCierre(searchParams, { scope: next }))
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
    refetchInterval: refetchWhilePending,
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


  // Paso "Viajes": se pide al abrir la página (no solo con la pestaña): su número va en la pestaña (D4).
  const cierreViajesQuery = useQuery({
    queryKey: ['cierre-viajes', fecha],
    queryFn: () => tripsApi.cierreViajes(fecha),
    refetchInterval: refetchWhilePending,
  })
  // El resumen del alcance, de las mismas filas que dibuja la Flota del día.
  const flota = useDayFleet(fecha)
  const resumen = flota.drivers && flota.equipment ? scopeSummary(flota.drivers, flota.equipment, alcance) : null
  // Lo que falta hacer en cada pestaña, dentro del alcance (D4): Por resolver y avisos.
  const porResolver = cierreViajesQuery.data
    ? closureTrips(cierreViajesQuery.data.grupos)
      .filter(v => GRUPOS_DE_VIAJES[v.grupo].pestana === 'to_resolve' && inScope(v.scope, alcance)).length
    : null
  const avisos = useClosureNotices(fecha, alcance).notices?.length || null

  const motivosViajesQuery = useQuery({
    queryKey: taxonomyKey('TRIP_UNASSIGNED_REASON'),
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
    <PageContainer>
      <EncabezadoDePagina titulo="Cierre del día" bajada="Revisa la flota, resuelve los viajes y firma el día.">
        <label className="flex items-center gap-2 text-etiqueta text-informativo">
          Fecha
          <input
            type="date"
            aria-label="Fecha del cierre"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className={`${inputClass({ size: 'sm' })}`}
          />
        </label>
      </EncabezadoDePagina>

      {/* Qué se cierra (D1): una vez, arriba de las pestañas, y vale para las cuatro. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-etiqueta text-informativo">Qué se cierra</span>
        <SegmentedControl label="Qué se cierra" value={alcance} onChange={setAlcance}
          options={ALCANCES.map(a => ({ id: a, label: SCOPE_LABEL[a] }))} />
        {resumen && (
          <span className="text-dato text-text-primary">
            {/* Las palabras de los recuadros: asignados + no asignados + por regularizar = todos. */}
            {resumen.assigned} asignados · {resumen.unassigned} no asignados
            {resumen.toRegularize ? ` · ${resumen.toRegularize} por regularizar` : ''}
            {' · '}{String(resumen.utilizationPct).replace('.', ',')} % de utilización
            {resumen.blocking ? (
              <span className="text-status-incidente"> · {resumen.blocking} sin motivo {resumen.blocking === 1 ? 'bloquea' : 'bloquean'} la firma</span>
            ) : null}
          </span>
        )}
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
        <div className="rounded-t-2xl border-b border-border px-3 py-2">
          <Tabs label="Secciones del cierre" value={tab} onChange={setTab} tabs={[
            { id: 'fleet', label: 'Flota del día' },
            // El número dice qué falta hacer (D4): con el día firmado, los ajustes posteriores.
            diaCerrado
              ? { id: 'trips', label: 'Viajes', count: ajustes.length || null,
                  ariaLabel: ajustes.length ? `Viajes, ${ajustes.length} ${ajustes.length === 1 ? 'ajuste posterior' : 'ajustes posteriores'} al cierre` : undefined }
              : { id: 'trips', label: 'Viajes', count: porResolver, urgent: !!porResolver },
            { id: 'pending', label: 'Pendientes', count: avisos },
            { id: 'report', label: 'Reporte' },
          ]} />
        </div>

        <div className="p-5 sm:p-6">
          {tab === 'fleet' && (
            <FlotaDelDiaSection
              fecha={fecha}
              alcance={alcance}
              unassignedReasons={tripsMeta?.unassigned_reasons ?? []}
              onSelectTrip={handleSelectTrip}
              onOpenQuickView={puedeVerDirectorio ? openQuickView : undefined}
              activeRowKey={quickView.current ? quickViewOrigin : null}
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
                // Otro día, otra selección y situación inicial.
                key={fecha}
                fecha={fecha}
                alcance={alcance}
                grupos={cierreViajesQuery.data?.grupos}
                bloquean={cierreViajesQuery.data?.bloquean}
                tripHref={id => urlDelViaje(id, urlDeEsteCierre())}
                onOpenQuickView={puedeVerDirectorio ? openQuickView : undefined}
                activeTripId={quickView.current ? quickViewOrigin : null}
                cargando={cierreViajesQuery.isLoading}
                motivos={motivosViajesQuery.data ?? []}
                onCerrar={handleCerrarViajes}
                onDeshacer={handleDeshacerViajes}
                meta={tripsMeta}
                // Mientras no se sabe si el día está firmado, nada se declara: las
                // acciones que escriben esperan la información de la que dependen.
                soloLectura={diaCerrado || cierreQuery.isLoading}
              />
            )}
          </>)}
          {tab === 'pending' && (
            <PreCierrePendingSection fecha={fecha} alcance={alcance} tripHref={id => urlDelViaje(id, urlDeEsteCierre())} />
          )}
          {tab === 'report' && (
            <StatusReportSection fecha={fecha} alcance={alcance} section={reportSectionOf(url.section)}
              onSectionChange={setSeccionDelReporte} tripHref={id => urlDelViaje(id, urlDeEsteCierre())} />
          )}
        </div>

        <div className="border-t border-border bg-bg-main/60 p-5 sm:p-6 space-y-3 rounded-b-2xl">
          {diaCerrado ? (
            <DiaCerrado periodo={cierreQuery.data?.periodo ?? null} ajustes={ajustes.length} onVerAjustes={() => { setTab('trips'); setIrAAjustes(n => n + 1) }} />
          ) : (
            <div>
              <h2 className="text-lectura font-semibold text-text-primary">Confirmar cierre</h2>
              <p className="mt-0.5 text-dato text-informativo">
                {puedeFirmar
                  ? 'Firma conductores y tractos juntos. Los dos exigen motivo en sus pendientes; Equipo Completo nunca bloquea.'
                  : 'El cierre lo firma Operaciones. Puedes revisarlo, pero no firmarlo.'}
              </p>
            </div>
          )}

          {closeError && (
            <div className="rounded-lg border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">
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
            <Button variant="link" size="sm" onClick={() => setOverrideOpen(true)}>Forzar cierre con override</Button>
          )}
          {overrideOpen && (
            <div className="space-y-2">
              <textarea
                value={overrideNote}
                onChange={e => setOverrideNote(e.target.value)}
                placeholder="Comentario de justificación (obligatorio)"
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-dato"
                rows={2}
              />
              {/* Salta la regla de los pendientes: es la acción de riesgo. */}
              <Button variant="danger" disabled={closing || !overrideNote.trim()} onClick={() => handleConfirmClose(true)}>
                {closing ? 'Cerrando…' : 'Confirmar override y cerrar'}
              </Button>
            </div>
          )}
          {/* Firmar el dia es un acto con nombre y hora: no puede ocurrir sobre
              datos que todavia no llegaron. El boton solo miraba `closing` (si
              el cierre esta en curso), asi que quedaba habilitado mientras el
              area de datos mostraba el spinner. */}
          {!diaCerrado && puedeFirmar && (
            <Button variant="primary" disabled={closing || cargandoDatos} onClick={() => handleConfirmClose(false)}>
              {closing || cargandoDatos
                ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
                : <ClipboardCheck size={14} aria-hidden="true" />}
              Confirmar cierre
            </Button>
          )}
          {/* Reabrir es un acto explícito: admin, con una nota que diga por
              qué. Antes un día "se reabría" solo, con entrar a la pantalla. */}
          {diaCerrado && puedeReabrir && !reabrirOpen && (
            <Button onClick={() => setReabrirOpen(true)}>
              <LockOpen size={12} aria-hidden="true" /> Reabrir día
            </Button>
          )}
          {diaCerrado && reabrirOpen && (
            <div className="space-y-2">
              <textarea
                value={notaReabrir}
                onChange={e => setNotaReabrir(e.target.value)}
                aria-label="Motivo para reabrir el día"
                placeholder="Por qué se reabre (obligatorio)"
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-dato"
                rows={2}
              />
              <div className="flex items-center gap-2">
                {/* Deshace una firma: es la acción de riesgo. */}
                <Button variant="danger" disabled={reabriendo || !notaReabrir.trim()} onClick={handleReabrir}>
                  {reabriendo ? 'Reabriendo…' : 'Confirmar y reabrir'}
                </Button>
                <Button variant="link" onClick={() => { setReabrirOpen(false); setNotaReabrir('') }}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {quickView.current && (
        <EntityQuickView
          // Otra entidad, otro panel: el foco y el scroll empiezan de nuevo.
          key={`${quickView.current.kind}:${quickView.current.id}`}
          target={quickView.current}
          canGoBack={quickView.canGoBack}
          onNavigate={quickView.navigate}
          onBack={quickView.back}
          onClose={closeQuickView}
          returnTo={urlDeEsteCierre()}
          closureDate={fecha}
          canRequestDocuments={puedePedirDocumentos}
        />
      )}
    </PageContainer>
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
      <CheckCircle2 size={16} className="text-resuelto shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-0.5 text-dato text-text-primary">
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
