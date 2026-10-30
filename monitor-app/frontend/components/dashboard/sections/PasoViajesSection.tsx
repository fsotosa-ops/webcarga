'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Button, buttonClass } from '@/components/ui/Button'
import { Field, inputClass } from '@/components/ui/Field'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { AsignarConductorDialog, type ViajeSinConductor } from '@/components/dashboard/AsignarConductorDialog'
import { Estado } from '@/components/ui/Estado'
import { Cifra } from '@/components/ui/Cifra'
import { StatusChip } from '@/components/ui/StatusChip'
import { TmsChip } from '@/components/dashboard/TripTable'
import { EntityCell } from '@/components/dashboard/EntityCell'
import type { QuickViewTarget } from '@/lib/quickView'
import { TEXTO_APOYO } from '@/lib/ui/texto'
import type { ClosureScope } from '@/lib/types'
import { inScope, scopeGap } from '@/lib/cierre/scope'
import { DESTINATION_ZONE_LABEL, OPERATION_TYPE_CONFLICT_LABEL, SCOPE_GAP_LABEL } from '@/lib/states'
import {
  GRUPOS_DE_VIAJES, PESTANAS_DE_VIAJES, diasAtras, closureTrips, conductorPorEmparejar, pestanaInicial, queFalta,
  situationOf, tripsToRegularize, viajesPorPatente, type FilaDeViaje,
} from '@/lib/cierre/gruposDeViajes'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { CierreViajesResponse, TripsMeta, UnassignedReasonMeta } from '@/lib/types'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { ShortcutTiles } from '@/components/ui/tabla/data/ShortcutTiles'

const TABLE_KEY = 'closure.trips'
const TABLE_KEY_POR_REGULARIZAR = 'closure.to_regularize'
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
  /** `por_regularizar` (30/10): la misma tabla, con solo los viajes por regularizar,
   *  para la tarjeta de la Flota del día. Se completa la asignación (el emparejamiento
   *  del Monitor, o el detalle del viaje) o se declara que no se tomará. Una variante
   *  es una prop, no un componente hermano. */
  variante?: 'viajes' | 'por_regularizar'
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
  tripHref, onOpenQuickView, activeTripId = null, variante = 'viajes',
}: Props) {
  const porRegularizar = variante === 'por_regularizar'
  // Dentro de la Flota del día la URL es de la tabla de la flota: la variante lleva su
  // vista (búsqueda, orden, filtros) en memoria, para no pisar los filtros de la otra.
  const [urlView, setUrlView] = useUrlView()
  const [vistaLocal, setVistaLocal] = useState<TableView>(EMPTY_VIEW)
  const [view, setView] = porRegularizar ? [vistaLocal, setVistaLocal] : [urlView, setUrlView]
  const preferencias = useTablePreferences(porRegularizar ? TABLE_KEY_POR_REGULARIZAR : TABLE_KEY)
  const queryClient = useQueryClient()
  // El viaje cuyo conductor se está emparejando, y los que se van a declarar "no se tomará".
  const [asignando, setAsignando] = useState<ViajeSinConductor | null>(null)
  const [noSeTomara, setNoSeTomara] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [motivoId, setMotivoId] = useState('')
  // El motivo elegido en una fila, todavía sin guardar (HU-D3).
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardandoFila, setGuardandoFila] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const todas = useMemo(
    () => (grupos ? (porRegularizar ? tripsToRegularize(grupos) : closureTrips(grupos)) : []),
    [grupos, porRegularizar])
  const filas = useMemo(() => todas.filter(v => inScope(v.scope, alcance)), [todas, alcance])
  const repetidas = useMemo(() => viajesPorPatente(filas), [filas])
  const pestanaDe = (v: FilaDeViaje) => GRUPOS_DE_VIAJES[v.grupo].pestana
  const nro = (v: FilaDeViaje) => v.source_system_trip_id ?? v.trip_id

  // Abre en la situación con trabajo (Por resolver, o En seguimiento si no hay),
  // una vez, con los primeros datos: declarar el último por resolver no hace saltar
  // la vista. Una situación elegida (en la URL) manda.
  const inicializada = useRef(false)
  useEffect(() => {
    if (porRegularizar || inicializada.current || !grupos) return
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
    // El estado que informa el TMS (Asignado, Publicada, En ruta, Cancelado…): sin él no
    // se entiende por qué un viaje está aquí (reunión del 30/10).
    { id: 'trip_status', header: 'Estado del viaje', value: v => v.trip_status },
    porRegularizar
      ? { id: 'why', header: 'Qué falta', value: v => queFalta(v).join(' · '),
          render: v => (
            <span className="flex flex-wrap gap-1">
              {queFalta(v).map(p => <StatusChip key={p} tone="urgent">{p}</StatusChip>)}
            </span>
          ) }
      : { id: 'why', header: 'Por qué está aquí', value: v => GRUPOS_DE_VIAJES[v.grupo].chip,
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
            {v.operation_type_conflict && <span className="ml-1.5"><StatusChip tone="warning">{OPERATION_TYPE_CONFLICT_LABEL}</StatusChip></span>}
            {otros && (
              <span title={`${v.tractor_plate}: ${otros.join(', ')}`} className={`block text-etiqueta font-normal ${TEXTO_APOYO}`}>
                {otros.length} viajes
              </span>
            )}
          </span>
        )
      } },
    { id: 'driver', header: 'Conductor', value: v => v.driver_name,
      render: v => porRegularizar && conductorPorEmparejar(v) && !soloLectura
        // El nombre que informó el TMS, como enlace: igual que en el Monitor, se busca
        // a la persona en el Directorio (o se le da de alta) desde aquí.
        ? (
          <span>
            <button type="button" onClick={() => setAsignando({ id: v.trip_id, driver_name_tms: v.driver_name_tms! })}
              aria-label={`Asignar conductor a ${v.driver_name_tms}`}
              className={buttonClass({ variant: 'link', size: 'sm' })}>
              {v.driver_name_tms}
            </button>
            <span className={`block text-etiqueta ${TEXTO_APOYO}`}>Lo informó el TMS · elige o da de alta</span>
          </span>
        )
        : <EntityCell kind="driver" id={v.driver_id} label={v.driver_name} unresolved onOpen={abrir(v.trip_id)} /> },
    { id: 'carrier', header: 'Empresa', value: v => v.carrier_name,
      render: v => <EntityCell kind="carrier" id={v.carrier_id} label={v.carrier_name} unresolved onOpen={abrir(v.trip_id)} /> },
    { id: 'origin', header: 'Origen · Destinos', value: v => v.origin,
      render: v => (
        <span>
          <span className="font-medium text-text-primary">{v.origin ?? '—'}</span>
          {v.destinations.length > 0 && <span className={`block text-etiqueta ${TEXTO_APOYO}`}>{v.destinations.join(' · ')}</span>}
        </span>
      ) },
    // La zona de su último destino, la misma del Reporte.
    { id: 'zone', header: 'Zona', value: v => v.destination_zone ?? null, options: Object.values(DESTINATION_ZONE_LABEL) },
    { id: 'idle', header: 'Tiempo sin novedad', filter: false, align: 'right', value: v => String(v.dias_sin_novedad),
      render: v => <span>{`${v.dias_sin_novedad.toFixed(1).replace('.', ',')} días`}</span> },
    { id: 'resolve', header: 'Resolver', filter: false, sortable: false, hideable: false, value: () => null,
      render: v => {
        const pestana = pestanaDe(v)
        const accion = GRUPOS_DE_VIAJES[v.grupo].action
        if (accion === 'regularize') {
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              {conductorPorEmparejar(v) && !soloLectura ? (
                <Button variant="primary" size="sm"
                  onClick={() => setAsignando({ id: v.trip_id, driver_name_tms: v.driver_name_tms! })}>
                  Asignar conductor
                </Button>
              ) : (
                <Link href={tripHref(v.trip_id)} aria-label={`Completar en el viaje ${nro(v)}`}
                  className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                  Completar en el viaje
                </Link>
              )}
              {!soloLectura && (
                <Button variant="secondary" size="sm" onClick={() => setNoSeTomara([v.trip_id])}
                  aria-label={`No se tomará el viaje ${nro(v)}`}>
                  No se tomará el viaje
                </Button>
              )}
            </span>
          )
        }
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
  ], [fecha, meta, repetidas, borrador, guardandoFila, soloLectura, motivos, onDeshacer, onOpenQuickView, tripHref, porRegularizar])

  const model = useDataTable({
    rows: filas, columns: columnas, getRowId: v => v.trip_id, view, onViewChange: setView, pageSize: 50,
    columnPrefs: preferencias.columns,
    search: (v, q) => [v.source_system_trip_id, v.client_name, v.tractor_plate, v.driver_name, v.carrier_name, v.origin, ...v.destinations]
      .some(x => (x ?? '').toLowerCase().includes(q)),
  })

  if (cargando || !grupos) return <Estado tipo="cargando" />

  // Solo lo que se declara entra al lote: en Viajes, lo que pide motivo; en Por
  // regularizar, todos ("No se tomará el viaje" vale para cualquiera).
  const declarable = (v: FilaDeViaje) => !soloLectura && (porRegularizar
    ? GRUPOS_DE_VIAJES[v.grupo].action === 'regularize'
    : pestanaDe(v) === 'to_resolve' && GRUPOS_DE_VIAJES[v.grupo].action === 'declare')
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

  const dialogos = (<>
    <AsignarConductorDialog viaje={asignando} onClose={() => setAsignando(null)}
      onAsignado={() => queryClient.invalidateQueries({ queryKey: ['cierre-viajes', fecha] })} />
    {noSeTomara && (
      <NoSeTomaraDialog cuantos={noSeTomara.length} motivos={motivos} onCancelar={() => setNoSeTomara(null)}
        onConfirmar={async motivo => {
          await onCerrar(noSeTomara, motivo)
          setSelected(prev => new Set([...prev].filter(id => !noSeTomara.includes(id))))
          setNoSeTomara(null)
        }} />
    )}
  </>)

  if (porRegularizar) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-dato font-semibold text-text-primary">
            {filas.length === 1 ? '1 viaje por regularizar' : `${filas.length} viajes por regularizar`}
          </h3>
          <p className={`text-etiqueta ${TEXTO_APOYO}`}>
            Completa la asignación o indica que no se tomará. Hasta resolverlos no se puede firmar el día.
          </p>
        </div>
        {n > 0 && (
          <div className="sticky top-0 z-20 flex items-center gap-2 rounded-lg border border-accent/20 bg-white px-3 py-2 shadow-sm">
            <span className="text-etiqueta font-semibold text-text-primary">{n} seleccionado{n === 1 ? '' : 's'}</span>
            <Button variant="secondary" size="sm" onClick={() => setNoSeTomara(seleccion)}>No se tomará el viaje</Button>
          </div>
        )}
        <TableToolbar model={model} searchPlaceholder="Buscar Nº de viaje, patente, conductor, empresa o cliente…" preferences={preferencias} />
        <DataTable model={model} label="Viajes por regularizar"
          empty="Nada por regularizar en este alcance: puedes firmar el día"
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
        {dialogos}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Cifra valor={bloquean} etiqueta="bloquean la firma del día"
        tono={bloquean && bloquean > 0 ? 'atencion' : 'resuelto'} />

      <ShortcutTiles model={model} groups={[{ tiles: [
        { value: null, label: 'Todos' },
        ...PESTANAS_DE_VIAJES.map(p => ({ column: SITUACION, value: p.etiqueta, label: p.etiqueta })),
      ] }]} />

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
      {dialogos}
    </div>
  )
}

/** "No se tomará el viaje" (30/10): el motivo de no asignación de siempre, para uno o
 *  varios. Escribe con el mismo `bulk-close` que el lote de la pestaña Viajes; el
 *  viaje sale de "Por regularizar" y queda en el historial (se deshace desde Viajes ›
 *  Resueltos). Mientras guarda no se cierra. */
function NoSeTomaraDialog({ cuantos, motivos, onCancelar, onConfirmar }: {
  cuantos: number
  motivos: Pick<UnassignedReasonMeta, 'id' | 'label'>[]
  onCancelar: () => void
  onConfirmar: (motivoId: string) => Promise<void>
}) {
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirmar() {
    if (!motivo) return
    setGuardando(true); setError(null)
    try {
      await onConfirmar(motivo)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar. Vuelve a intentarlo.')
      setGuardando(false)
    }
  }
  return (
    <PanelLateral placement="center" titulo="No se tomará el viaje" onCerrar={onCancelar} dismissible={!guardando}
      description={cuantos === 1
        ? 'Sale de Por regularizar y queda en el historial como no tomado.'
        : `Los ${cuantos} viajes salen de Por regularizar y quedan en el historial como no tomados.`}
      pie={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancelar} disabled={guardando}>Cancelar</Button>
          <Button variant="primary" onClick={() => void confirmar()} disabled={!motivo || guardando}>
            {guardando ? 'Guardando…' : 'No se tomará'}
          </Button>
        </div>
      }>
      <Field label="Motivo" required error={error}>
        {(id, d) => (
          <select id={id} aria-describedby={d} value={motivo} onChange={e => setMotivo(e.target.value)}
            className={`${inputClass()} w-full`}>
            <option value="">Elige un motivo</option>
            {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
      </Field>
    </PanelLateral>
  )
}
