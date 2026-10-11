'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Estado } from '@/components/ui/Estado'
import { Cifra } from '@/components/ui/Cifra'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { TmsChip } from '@/components/dashboard/TripTable'
import { EntityCell } from '@/components/dashboard/EntityCell'
import type { QuickViewTarget } from '@/lib/quickView'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import {
  GRUPOS_DE_VIAJES, PESTANAS_DE_VIAJES, diasAtras, esPestanaDeViajes, filasDePestana, pestanaInicial, viajesPorPatente,
  type FilaDeViaje, type PestanaDeViajes,
} from '@/lib/cierre/gruposDeViajes'
import type { CierreViajesResponse, GrupoDelCierre, TripsMeta, UnassignedReasonMeta, ViajeDelCierre } from '@/lib/types'

interface Props {
  /** La fecha del cierre: de ella salen los días de rezago y el "hace N días". */
  fecha:     string
  grupos:    Partial<CierreViajesResponse['grupos']> | undefined
  bloquean:  number | undefined
  cargando?: boolean
  /** Motivos de NO ASIGNACIÓN de viaje: sólo id y etiqueta. */
  motivos:   Pick<UnassignedReasonMeta, 'id' | 'label'>[]
  onCerrar:  (tripIds: string[], motivoId: string) => void | Promise<void>
  /** Quita el motivo y devuelve el viaje a su grupo (HU-D3). */
  onDeshacer?: (tripIds: string[]) => void | Promise<void>
  /** Para los colores del TMS, los mismos del Monitor. */
  meta?:      TripsMeta | null
  /** Día firmado: nada se declara ni se deshace (el backend también lo rechaza). */
  soloLectura?: boolean
  /** La pestaña que trae la URL (`?trips=`); la página es dueña de la URL. */
  pestana?:         PestanaDeViajes | null
  onCambiarPestana?: (p: PestanaDeViajes) => void
  /** El detalle de un viaje, con la vuelta a este Cierre: ahí se completa la flota
   *  de una asignación incompleta. La página es dueña de la URL. */
  tripHref: (tripId: string) => string
  /** Abre la vista rápida de una entidad de la fila. Sin él (sin `directory.read`)
   *  los nombres son texto. */
  onOpenQuickView?: (target: QuickViewTarget, tripId: string) => void
  /** La fila desde la que está abierta la vista rápida: queda marcada. */
  activeTripId?: string | null
}

/** Fecha de planificación corta, como la lee el coordinador: 02/10. */
function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** Cuenta desde el último reporte del TMS, no desde la planificación. */
function formatDiasSinNovedad(dias: number): string {
  return `${dias.toFixed(1).replace('.', ',')} días sin novedad`
}

/** Paso "Viajes" del Cierre del Día: tres pestañas que responden qué falta
 *  declarar, qué sigue vivo sin depender del cierre y qué ya se declaró (spec
 *  2026-10-11). Cómo se presenta cada grupo del backend lo dice
 *  `lib/cierre/gruposDeViajes.ts`, no este componente.
 *
 *  Puramente presentacional: el fetch, `bulkClose` y la URL viven en la página.
 *  Sin encabezado propio: vive dentro de una pestaña del Centro de Cierre. */
export function PasoViajesSection({
  fecha, grupos, bloquean, cargando = false, motivos, onCerrar, onDeshacer, meta, soloLectura = false,
  pestana: pestanaDeLaUrl, onCambiarPestana, tripHref, onOpenQuickView, activeTripId = null,
}: Props) {
  // La pestaña elegida a mano manda; si no hay, la de la URL; si no, la inicial.
  // La inicial se calcula UNA vez, con los primeros datos, y se congela: si se
  // recalculara, declarar el último viaje por resolver haría saltar la pestaña.
  // La página monta este componente con `key={fecha}`: otro día parte de cero.
  const [elegida, setElegida] = useState<PestanaDeViajes | null>(null)
  const [inicial, setInicial] = useState<PestanaDeViajes | null>(null)
  const [chip, setChip] = useState<GrupoDelCierre | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Buscador (minuta 09/10, ítem 22): cubre las tres pestañas.
  const [q, setQ] = useState('')
  const [motivoId, setMotivoId] = useState('')
  // El motivo elegido en una fila, todavía sin guardar (HU-D3).
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardandoFila, setGuardandoFila] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const qLower = q.trim().toLowerCase()
  const coincide = (v: ViajeDelCierre) => !qLower || [
    v.source_system_trip_id, v.client_name, v.tractor_plate, v.driver_name, v.carrier_name, v.origin, ...v.destinations,
  ].some(x => (x ?? '').toLowerCase().includes(qLower))

  function toggleSelected(tripId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId)
      return next
    })
  }

  // Camino de escritura: si `onCerrar` revienta, la selección y el motivo NO se
  // limpian, para reintentar sin volver a elegir todo.
  async function handleCerrar(ids: string[]) {
    if (ids.length === 0 || !motivoId) return
    setGuardando(true)
    setError(null)
    try {
      await onCerrar(ids, motivoId)
      setSelected(new Set())
      setMotivoId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cerrar los viajes seleccionados.')
    } finally {
      setGuardando(false)
    }
  }

  // Una fila sola se cierra con el MISMO escritor que el lote: declarar un viaje
  // es un único acto.
  async function handleCerrarFila(tripId: string) {
    const motivo = borrador[tripId]
    if (!motivo) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onCerrar([tripId], motivo)
      // Declarado en su fila: ya no puede quedar en el lote con otro motivo.
      setSelected(prev => {
        const next = new Set(prev)
        next.delete(tripId)
        return next
      })
      setBorrador(prev => {
        const { [tripId]: _, ...resto } = prev
        return resto
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el viaje.')
    } finally {
      setGuardandoFila(null)
    }
  }

  async function handleDeshacer(tripId: string) {
    if (!onDeshacer) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onDeshacer([tripId])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo deshacer.')
    } finally {
      setGuardandoFila(null)
    }
  }

  // Se guarda durante el render (patrón de React para estado derivado de la
  // primera respuesta), antes del corte por carga.
  if (grupos && inicial === null) setInicial(pestanaInicial(grupos))

  if (cargando || !grupos) {
    return <Estado tipo="cargando" />
  }

  const pestana: PestanaDeViajes = elegida
    ?? (esPestanaDeViajes(pestanaDeLaUrl ?? null) ? pestanaDeLaUrl! : inicial ?? pestanaInicial(grupos))
  function cambiarPestana(p: PestanaDeViajes) {
    setElegida(p)
    setChip(null)
    onCambiarPestana?.(p)
  }

  const porPestana = Object.fromEntries(PESTANAS_DE_VIAJES.map(p => {
    const todas = filasDePestana(grupos, p.id)
    return [p.id, { todas, coinciden: todas.filter(coincide) }]
  })) as Record<PestanaDeViajes, { todas: FilaDeViaje[]; coinciden: FilaDeViaje[] }>

  const info = PESTANAS_DE_VIAJES.find(p => p.id === pestana)!
  const { todas, coinciden } = porPestana[pestana]
  // Los chips aparecen solo si la pestaña junta más de un camino.
  const chips = Object.entries(GRUPOS_DE_VIAJES)
    .filter(([g, p]) => p.pestana === pestana && todas.some(f => f.grupo === g))
    .map(([g, p]) => ({ id: g, etiqueta: p.chip, n: coinciden.filter(f => f.grupo === g).length }))
  // Un chip que se quedó sin viajes (se declararon todos) deja de filtrar.
  const chipVigente = chips.some(c => c.id === chip) ? chip : null
  const filas = chipVigente ? coinciden.filter(f => f.grupo === chipVigente) : coinciden
  const repetidas = viajesPorPatente(todas)
  const declarar = pestana === 'to_resolve' && !soloLectura
  const deshacer = pestana === 'resolved' && !soloLectura && !!onDeshacer
  const otraConResultados = qLower && coinciden.length === 0
    ? PESTANAS_DE_VIAJES.find(p => porPestana[p.id].coinciden.length > 0)
    : undefined
  // El lote solo actúa sobre lo que sigue por resolver: un viaje que se declaró,
  // se deshizo o cambió de grupo sale solo de la selección.
  // Solo lo que se declara entra al lote: una asignación incompleta se completa.
  const porResolver = new Set(porPestana.to_resolve.todas
    .filter(f => GRUPOS_DE_VIAJES[f.grupo].action === 'declare').map(f => f.trip_id))
  const seleccion = [...selected].filter(id => porResolver.has(id))
  const n = soloLectura ? 0 : seleccion.length

  return (
    <div className="space-y-4">
      <Cifra
        valor={bloquean}
        etiqueta="bloquean la firma del día"
        tono={bloquean && bloquean > 0 ? 'atencion' : 'resuelto'}
      />

      {n > 0 && (
        // Pegada al TECHO del área de scroll: `position: sticky` no sale de la caja
        // de su padre, y al pie solo se pegaba ya abajo del todo.
        <div className="sticky top-0 z-20 flex items-center gap-2 bg-white border border-accent/20 shadow-sm rounded-lg px-3 py-2">
          <span className="text-etiqueta font-semibold text-text-primary">{n} seleccionado{n === 1 ? '' : 's'}</span>
          <select
            aria-label="Motivo"
            value={motivoId}
            onChange={e => setMotivoId(e.target.value)}
            className="text-etiqueta border border-border rounded-lg px-2 py-1 bg-white"
          >
            <option value="">— Elige un motivo —</option>
            {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!motivoId || guardando}
            onClick={() => handleCerrar(seleccion)}
            className="text-etiqueta font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
          >
            {guardando ? 'Cerrando…' : `No asignado por WebCarga · ${n} viaje${n === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div role="tablist" aria-label="Viajes del cierre" className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 overflow-x-auto max-w-full">
          {PESTANAS_DE_VIAJES.map(p => {
            const { todas: t, coinciden: c } = porPestana[p.id]
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === pestana}
                onClick={() => cambiarPestana(p.id)}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                  p.id === pestana ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary'
                }`}
              >
                {p.etiqueta}
                <span className="rounded-full bg-gray-200 px-1.5 text-[10px] font-bold tabular-nums text-text-secondary">
                  {qLower ? `${c.length} de ${t.length}` : t.length}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar Nº de viaje, patente, conductor, empresa o cliente…"
            aria-label="Buscar viaje"
            className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
          />
        </div>
      </div>

      <p className={`text-etiqueta ${TEXTO_APOYO}`}>{info.bajada}</p>
      {chips.length > 1 && (
        <ChipsDeFiltro opciones={chips} activo={chipVigente} onElegir={id => setChip(id as GrupoDelCierre | null)} />
      )}

      {todas.length === 0 ? (
        <Estado tipo="vacio" titulo={info.vacio} />
      ) : filas.length === 0 ? (
        <Estado
          tipo="vacio"
          titulo="Ningún viaje coincide con la búsqueda"
          detalle={otraConResultados
            ? `${porPestana[otraConResultados.id].coinciden.length} resultados en ${otraConResultados.etiqueta}`
            : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                {declarar && <th className="text-left px-3 py-2 w-8" />}
                <th className="text-left px-3 py-2">TMS · Cliente</th>
                <th className="text-left px-3 py-2">Nº viaje</th>
                <th className="text-left px-3 py-2">Fecha</th>
                {pestana !== 'resolved' && (
                  <th className="text-left px-3 py-2">{pestana === 'to_resolve' ? 'Por qué está aquí' : 'Situación'}</th>
                )}
                <th className="text-left px-3 py-2">Patente</th>
                <th className="text-left px-3 py-2">Conductor</th>
                <th className="text-left px-3 py-2">Empresa</th>
                <th className="text-left px-3 py-2">Origen · Destinos</th>
                <th className="text-left px-3 py-2">Tiempo</th>
                {/* En Por resolver la columna declara el motivo o lleva a completar la flota. */}
                {pestana === 'to_resolve' && <th className="text-left px-3 py-2">Resolver</th>}
                {pestana === 'resolved' && <th className="text-left px-3 py-2">Motivo de no asignación</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filas.map(v => {
                const presentacion = GRUPOS_DE_VIAJES[v.grupo]
                const atras = diasAtras(v.planning_date, fecha)
                const nro = v.source_system_trip_id ?? v.trip_id
                const otros = v.tractor_plate ? repetidas.get(v.tractor_plate) : undefined
                return (
                  <tr key={v.trip_id} aria-current={v.trip_id === activeTripId ? 'true' : undefined}
                      className={v.trip_id === activeTripId ? 'bg-accent/5 shadow-[inset_3px_0_0_var(--accent)]' : undefined}>
                    {declarar && presentacion.action !== 'declare' && <td className="px-3 py-2" />}
                    {declarar && presentacion.action === 'declare' && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar viaje ${nro}`}
                          checked={selected.has(v.trip_id)}
                          onChange={() => toggleSelected(v.trip_id)}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <TmsChip tms={v.source_system ?? ''} meta={meta} sourceTripId={v.source_system_trip_id} />
                      <span className={`block mt-1 text-etiqueta ${TEXTO_APOYO}`}>{v.client_name ?? '—'}</span>
                    </td>
                    <td data-testid="nro-viaje" className={`px-3 py-2 font-identificador ${TEXTO_CUERPO}`}>{nro}</td>
                    <td className={`px-3 py-2 tabular-nums ${TEXTO_CUERPO}`}>
                      {formatFecha(v.planning_date)}
                      {atras > 0 && <span className={`block text-etiqueta ${TEXTO_APOYO}`}>hace {atras} {atras === 1 ? 'día' : 'días'}</span>}
                    </td>
                    {pestana !== 'resolved' && (
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                        {presentacion.porQue(v, fecha)}
                        {presentacion.bloqueaLaFirma(v, fecha) && (
                          <span className="block text-etiqueta font-semibold text-accent">Bloquea la firma</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 font-identificador font-semibold text-text-primary">
                      <EntityCell kind="asset" id={v.tractor_asset_id} label={v.tractor_plate} mono
                                  onOpen={onOpenQuickView && (t => onOpenQuickView(t, v.trip_id))} />
                      {otros && (
                        <span title={`${v.tractor_plate}: ${otros.join(', ')}`} className={`block text-etiqueta font-normal ${TEXTO_APOYO}`}>
                          {otros.length} viajes
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                      <EntityCell kind="driver" id={v.driver_id} label={v.driver_name} unresolved
                                  onOpen={onOpenQuickView && (t => onOpenQuickView(t, v.trip_id))} />
                    </td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                      <EntityCell kind="carrier" id={v.carrier_id} label={v.carrier_name} unresolved
                                  onOpen={onOpenQuickView && (t => onOpenQuickView(t, v.trip_id))} />
                    </td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                      <span className="font-medium text-text-primary">{v.origin ?? '—'}</span>
                      {v.destinations.length > 0 && (
                        <span className={`block text-etiqueta ${TEXTO_APOYO}`}>{v.destinations.join(' · ')}</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{formatDiasSinNovedad(v.dias_sin_novedad)}</td>
                    {pestana === 'to_resolve' && (
                      <td className="px-3 py-2">
                        {presentacion.action === 'complete' ? (
                          <Link
                            href={tripHref(v.trip_id)}
                            aria-label={`Completar asignación del viaje ${nro}`}
                            className="text-etiqueta font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
                          >
                            Completar asignación
                          </Link>
                        ) : declarar ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Motivo del viaje ${nro}`}
                              value={borrador[v.trip_id] ?? ''}
                              disabled={guardandoFila === v.trip_id}
                              onChange={e => setBorrador(prev => ({ ...prev, [v.trip_id]: e.target.value }))}
                              className="text-etiqueta border border-border rounded-lg px-2 py-1 bg-white"
                            >
                              <option value="">— Elige un motivo —</option>
                              {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                            <button
                              type="button"
                              disabled={!borrador[v.trip_id] || guardandoFila === v.trip_id}
                              onClick={() => handleCerrarFila(v.trip_id)}
                              className="text-etiqueta font-semibold bg-accent text-white rounded-lg px-2.5 py-1 disabled:opacity-50"
                            >
                              {guardandoFila === v.trip_id ? 'Guardando…' : 'Guardar'}
                            </button>
                          </div>
                        ) : (
                          <span className={TEXTO_APOYO}>—</span>
                        )}
                      </td>
                    )}
                    {pestana === 'resolved' && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={TEXTO_CUERPO}>{presentacion.porQue(v, fecha)}</span>
                          {deshacer && (
                            <button
                              type="button"
                              aria-label={`Deshacer el motivo del viaje ${nro}`}
                              disabled={guardandoFila === v.trip_id}
                              onClick={() => handleDeshacer(v.trip_id)}
                              className="text-etiqueta font-semibold border border-border rounded-lg px-2.5 py-1 bg-white text-text-primary hover:bg-bg-main disabled:opacity-50"
                            >
                              {guardandoFila === v.trip_id ? 'Deshaciendo…' : 'Deshacer'}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && <Estado tipo="error" titulo={error} />}
    </div>
  )
}
