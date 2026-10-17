'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Estado } from '@/components/ui/Estado'
import { Cifra } from '@/components/ui/Cifra'
import { StatusChip } from '@/components/ui/StatusChip'
import { TmsChip } from '@/components/dashboard/TripTable'
import { EntityCell } from '@/components/dashboard/EntityCell'
import type { QuickViewTarget } from '@/lib/quickView'
import { TEXTO_APOYO } from '@/lib/ui/texto'
import type { ClosureScope } from '@/lib/types'
import { inScope, scopeGap } from '@/lib/cierre/scope'
import { SCOPE_GAP_LABEL } from '@/lib/states'
import {
  GRUPOS_DE_VIAJES, PESTANAS_DE_VIAJES, diasAtras, closureTrips, pestanaInicial, situationOf, viajesPorPatente,
  type FilaDeViaje,
} from '@/lib/cierre/gruposDeViajes'
import type { CierreViajesResponse, TripsMeta, UnassignedReasonMeta } from '@/lib/types'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { ShortcutTiles } from '@/components/ui/tabla/data/ShortcutTiles'

const TABLE_KEY = 'closure.trips'
const SITUACION = 'situation'

interface Props {
  /** La fecha del cierre: de ella salen los días de rezago y el "hace N días". */
  fecha:     string
  /** Qué se cierra (D6): sus viajes y los que no tienen tracto. */
  alcance:   ClosureScope
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
  /** El detalle de un viaje, con la vuelta a este Cierre (ahí se completa la flota). */
  tripHref: (tripId: string) => string
  onOpenQuickView?: (target: QuickViewTarget, tripId: string) => void
  activeTripId?: string | null
}

/** Fecha de planificación corta, como la lee el coordinador: 02/10. */
function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** Paso "Viajes" del Cierre (Cierre con un solo patrón, D3): una tabla con todos
 *  los viajes del día. "Por resolver / En seguimiento / Resueltos" son atajos del
 *  filtro Situación, y el camino por el que llegó cada viaje es la columna "Por qué
 *  está aquí". Cómo se presenta cada grupo lo dice `lib/cierre/gruposDeViajes.ts`.
 *  El fetch, `bulkClose` y la pestaña viven en la página. */
export function PasoViajesSection({
  fecha, alcance, grupos, bloquean, cargando = false, motivos, onCerrar, onDeshacer, meta, soloLectura = false,
  tripHref, onOpenQuickView, activeTripId = null,
}: Props) {
  const [view, setView] = useUrlView()
  const preferencias = useTablePreferences(TABLE_KEY)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [motivoId, setMotivoId] = useState('')
  // El motivo elegido en una fila, todavía sin guardar (HU-D3).
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardandoFila, setGuardandoFila] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const todas = useMemo(() => (grupos ? closureTrips(grupos) : []), [grupos])
  const filas = useMemo(() => todas.filter(v => inScope(v.scope, alcance)), [todas, alcance])
  const repetidas = useMemo(() => viajesPorPatente(filas), [filas])
  const pestanaDe = (v: FilaDeViaje) => GRUPOS_DE_VIAJES[v.grupo].pestana
  const nro = (v: FilaDeViaje) => v.source_system_trip_id ?? v.trip_id

  // Abre en la situación con trabajo (Por resolver, o En seguimiento si no hay),
  // una vez, con los primeros datos: declarar el último por resolver no hace saltar
  // la vista. Una situación elegida (en la URL) manda.
  const inicializada = useRef(false)
  useEffect(() => {
    if (inicializada.current || !grupos) return
    inicializada.current = true
    if (view.filters[SITUACION]) return
    const inicial = PESTANAS_DE_VIAJES.find(p => p.id === pestanaInicial(grupos))!.etiqueta
    setView({ ...view, filters: { ...view.filters, [SITUACION]: [inicial] } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos])

  async function handleCerrar(ids: string[]) {
    if (ids.length === 0 || !motivoId) return
    setGuardando(true)
    setError(null)
    try {
      await onCerrar(ids, motivoId)
      setSelected(new Set())
      setMotivoId('')
    } catch (e) {
      // La selección y el motivo NO se limpian: se reintenta sin volver a elegir todo.
      setError(e instanceof Error ? e.message : 'No se pudieron cerrar los viajes seleccionados.')
    } finally {
      setGuardando(false)
    }
  }

  // Una fila sola se cierra con el MISMO escritor que el lote: declarar un viaje es un único acto.
  async function handleCerrarFila(tripId: string) {
    const motivo = borrador[tripId]
    if (!motivo) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onCerrar([tripId], motivo)
      setSelected(prev => { const next = new Set(prev); next.delete(tripId); return next })
      setBorrador(prev => { const { [tripId]: _, ...resto } = prev; return resto })
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

  const abrir = (tripId: string) => onOpenQuickView && ((t: QuickViewTarget) => onOpenQuickView(t, tripId))
  const columnas = useMemo<DataColumn<FilaDeViaje>[]>(() => [
    { id: SITUACION, header: 'Situación', value: situationOf, defaultHidden: true,
      options: PESTANAS_DE_VIAJES.map(p => p.etiqueta) },
    { id: 'trip', header: 'Nº viaje', hideable: false, value: nro,
      render: v => <span data-testid="nro-viaje" className="font-identificador text-text-primary">{nro(v)}</span> },
    { id: 'tms', header: 'TMS', value: v => v.source_system,
      render: v => <TmsChip tms={v.source_system ?? ''} meta={meta} sourceTripId={v.source_system_trip_id} /> },
    { id: 'client', header: 'Cliente', value: v => v.client_name },
    { id: 'date', header: 'Fecha', value: v => v.planning_date,
      render: v => {
        const atras = diasAtras(v.planning_date, fecha)
        return (
          <span className="tabular-nums">
            {formatFecha(v.planning_date)}
            {atras > 0 && <span className={`block text-etiqueta ${TEXTO_APOYO}`}>hace {atras} {atras === 1 ? 'día' : 'días'}</span>}
          </span>
        )
      } },
    { id: 'why', header: 'Por qué está aquí', value: v => GRUPOS_DE_VIAJES[v.grupo].chip,
      render: v => (
        <span>
          {GRUPOS_DE_VIAJES[v.grupo].porQue(v, fecha)}
          {GRUPOS_DE_VIAJES[v.grupo].bloqueaLaFirma(v, fecha) && (
            <span className="block text-etiqueta font-semibold text-accent">Bloquea la firma</span>
          )}
        </span>
      ) },
    { id: 'plate', header: 'Patente', value: v => v.tractor_plate,
      render: v => {
        const otros = v.tractor_plate ? repetidas.get(v.tractor_plate) : undefined
        return (
          <span className="font-identificador font-semibold text-text-primary">
            <EntityCell kind="asset" id={v.tractor_asset_id} label={v.tractor_plate} mono onOpen={abrir(v.trip_id)} />
            {scopeGap(v) && <span className="ml-1.5"><StatusChip tone="warning">{SCOPE_GAP_LABEL[scopeGap(v)!]}</StatusChip></span>}
            {otros && (
              <span title={`${v.tractor_plate}: ${otros.join(', ')}`} className={`block text-etiqueta font-normal ${TEXTO_APOYO}`}>
                {otros.length} viajes
              </span>
            )}
          </span>
        )
      } },
    { id: 'driver', header: 'Conductor', value: v => v.driver_name,
      render: v => <EntityCell kind="driver" id={v.driver_id} label={v.driver_name} unresolved onOpen={abrir(v.trip_id)} /> },
    { id: 'carrier', header: 'Empresa', value: v => v.carrier_name,
      render: v => <EntityCell kind="carrier" id={v.carrier_id} label={v.carrier_name} unresolved onOpen={abrir(v.trip_id)} /> },
    { id: 'origin', header: 'Origen · Destinos', value: v => v.origin,
      render: v => (
        <span>
          <span className="font-medium text-text-primary">{v.origin ?? '—'}</span>
          {v.destinations.length > 0 && <span className={`block text-etiqueta ${TEXTO_APOYO}`}>{v.destinations.join(' · ')}</span>}
        </span>
      ) },
    { id: 'idle', header: 'Tiempo sin novedad', filter: false, align: 'right', value: v => String(v.dias_sin_novedad),
      render: v => <span>{`${v.dias_sin_novedad.toFixed(1).replace('.', ',')} días`}</span> },
    { id: 'resolve', header: 'Resolver', filter: false, sortable: false, hideable: false, value: () => null,
      render: v => {
        const pestana = pestanaDe(v)
        const accion = GRUPOS_DE_VIAJES[v.grupo].action
        if (pestana === 'to_resolve' && accion === 'complete') {
          return (
            <Link href={tripHref(v.trip_id)} aria-label={`Completar asignación del viaje ${nro(v)}`}
              className="rounded text-etiqueta font-semibold text-accion hover:underline">
              Completar asignación
            </Link>
          )
        }
        if (pestana === 'to_resolve' && !soloLectura) {
          return (
            <span className="flex items-center gap-1.5">
              <select aria-label={`Motivo del viaje ${nro(v)}`} value={borrador[v.trip_id] ?? ''} disabled={guardandoFila === v.trip_id}
                onChange={e => setBorrador(prev => ({ ...prev, [v.trip_id]: e.target.value }))}
                className="rounded-lg border border-border bg-white px-2 py-1 text-etiqueta">
                <option value="">— Elige un motivo —</option>
                {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <button type="button" disabled={!borrador[v.trip_id] || guardandoFila === v.trip_id}
                onClick={() => handleCerrarFila(v.trip_id)}
                className="rounded-lg bg-accent px-2.5 py-1 text-etiqueta font-semibold text-white disabled:opacity-50">
                {guardandoFila === v.trip_id ? 'Guardando…' : 'Guardar'}
              </button>
            </span>
          )
        }
        if (pestana === 'resolved' && !soloLectura && onDeshacer) {
          return (
            <button type="button" aria-label={`Deshacer el motivo del viaje ${nro(v)}`} disabled={guardandoFila === v.trip_id}
              onClick={() => handleDeshacer(v.trip_id)}
              className="rounded-lg border border-border bg-white px-2.5 py-1 text-etiqueta font-semibold text-text-primary hover:bg-bg-main disabled:opacity-50">
              {guardandoFila === v.trip_id ? 'Deshaciendo…' : 'Deshacer'}
            </button>
          )
        }
        return <span className={TEXTO_APOYO}>—</span>
      } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [fecha, meta, repetidas, borrador, guardandoFila, soloLectura, motivos, onDeshacer, onOpenQuickView, tripHref])

  const model = useDataTable({
    rows: filas, columns: columnas, getRowId: v => v.trip_id, view, onViewChange: setView, pageSize: 50,
    columnPrefs: preferencias.columns,
    search: (v, q) => [v.source_system_trip_id, v.client_name, v.tractor_plate, v.driver_name, v.carrier_name, v.origin, ...v.destinations]
      .some(x => (x ?? '').toLowerCase().includes(q)),
  })

  if (cargando || !grupos) return <Estado tipo="cargando" />

  // Solo lo que se declara entra al lote: una asignación incompleta se completa.
  const declarable = (v: FilaDeViaje) => !soloLectura && pestanaDe(v) === 'to_resolve' && GRUPOS_DE_VIAJES[v.grupo].action === 'declare'
  const seleccion = filas.filter(v => selected.has(v.trip_id) && declarable(v)).map(v => v.trip_id)
  const n = seleccion.length

  // Sin resultados en la situación elegida: se dice dónde hay.
  const elegida = view.filters[SITUACION]?.[0]
  const otra = model.rows.length === 0 && elegida
    ? PESTANAS_DE_VIAJES.find(p => p.etiqueta !== elegida && model.facetCount(SITUACION, p.etiqueta) > 0)
    : undefined
  const vacio = model.rows.length === 0 && elegida && !view.q && Object.keys(view.filters).length === 1
    ? PESTANAS_DE_VIAJES.find(p => p.etiqueta === elegida)?.vacio
    : 'Ningún viaje coincide'

  return (
    <div className="space-y-4">
      <Cifra valor={bloquean} etiqueta="bloquean la firma del día"
        tono={bloquean && bloquean > 0 ? 'atencion' : 'resuelto'} />

      <ShortcutTiles model={model} columnId={SITUACION}
        tiles={[{ value: null, label: 'Todos' }, ...PESTANAS_DE_VIAJES.map(p => ({ value: p.etiqueta, label: p.etiqueta }))]} />

      {n > 0 && (
        // Pegada al techo del área de scroll: `position: sticky` no sale de la caja de su padre.
        <div className="sticky top-0 z-20 flex items-center gap-2 rounded-lg border border-accent/20 bg-white px-3 py-2 shadow-sm">
          <span className="text-etiqueta font-semibold text-text-primary">{n} seleccionado{n === 1 ? '' : 's'}</span>
          <select aria-label="Motivo" value={motivoId} onChange={e => setMotivoId(e.target.value)}
            className="rounded-lg border border-border bg-white px-2 py-1 text-etiqueta">
            <option value="">— Elige un motivo —</option>
            {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button type="button" disabled={!motivoId || guardando} onClick={() => handleCerrar(seleccion)}
            className="rounded-lg bg-accent px-3 py-1 text-etiqueta font-semibold text-white disabled:opacity-50">
            {guardando ? 'Cerrando…' : `No asignado por WebCarga · ${n} viaje${n === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <TableToolbar model={model} searchPlaceholder="Buscar Nº de viaje, patente, conductor, empresa o cliente…" preferences={preferencias} />

      <DataTable model={model} label="Viajes del cierre"
        empty={otra ? `${vacio}. ${model.facetCount(SITUACION, otra.etiqueta)} en ${otra.etiqueta}.` : vacio}
        isRowActive={v => v.trip_id === activeTripId}
        selection={{
          isSelectable: declarable,
          isSelected: v => selected.has(v.trip_id),
          label: v => `Seleccionar viaje ${nro(v)}`,
          onToggle: v => setSelected(prev => {
            const next = new Set(prev)
            if (next.has(v.trip_id)) next.delete(v.trip_id); else next.add(v.trip_id)
            return next
          }),
        }} />

      {error && <Estado tipo="error" titulo={error} />}
    </div>
  )
}
