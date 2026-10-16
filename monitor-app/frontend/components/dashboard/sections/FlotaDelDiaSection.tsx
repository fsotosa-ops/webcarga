'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dailyClosuresApi, type CambiosDeLinea } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'
import { locationsApi } from '@/lib/api/locations'
import { CATEGORY_LABEL, SCOPE_LABEL } from '@/lib/states'
import {
  FLEET_ROW_GROUP_LABEL, buildFleetRows, type Destino, type FleetRow,
} from '@/lib/cierre/dayFleet'
import type { ClosureScope, UnassignedReasonMeta } from '@/lib/types'
import type { QuickViewTarget } from '@/lib/quickView'
import { useDayFleet } from '@/hooks/useDayFleet'
import { Estado } from '@/components/ui/Estado'
import { StatusChip } from '@/components/ui/StatusChip'
import { EntityCell } from '@/components/dashboard/EntityCell'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { ShortcutTiles, type ShortcutTile } from '@/components/ui/tabla/data/ShortcutTiles'
import { RowAction } from './fleet/RowAction'
import { RowComment } from './fleet/RowComment'

const TABLE_KEY = 'closure.fleet'

interface Props {
  fecha: string
  /** Qué se cierra: lo elige la página, una vez para las cuatro pestañas (D1). */
  alcance: ClosureScope
  unassignedReasons: UnassignedReasonMeta[]
  onSelectTrip: (tripId: string) => void
  /** Opcional: el botón "Crear viaje manual" solo se dibuja si alguien puede honrarlo. */
  onCreateManualTrip?: (driverId: string, driverName: string) => void
  /** Abre la vista rápida de una entidad de la fila; sin él, los nombres son texto. */
  onOpenQuickView?: (target: QuickViewTarget, rowKey: string) => void
  /** La fila desde la que está abierta la vista rápida: queda marcada. */
  activeRowKey?: string | null
}

/** Flota del día (Cierre con un solo patrón, spec §4): la tabla de datos del kit
 *  sobre las filas de `lib/cierre/flotaDelDia.ts`. Los recuadros son atajos del
 *  filtro de Estado, que lee la categoría del backend con las palabras del
 *  glosario; todas las columnas filtran y se pueden ocultar y mover; la vista vive
 *  en la URL. Lo que escribe (motivo, vigencia, comentario, lote) es lo de siempre. */
export function FlotaDelDiaSection({
  fecha, alcance, unassignedReasons, onSelectTrip, onCreateManualTrip, onOpenQuickView, activeRowKey = null,
}: Props) {
  const queryClient = useQueryClient()
  const flota = useDayFleet(fecha)
  const [view, setView] = useUrlView()
  const preferencias = useTablePreferences(TABLE_KEY)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchReason, setBatchReason] = useState('')
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingRow, setSavingRow] = useState<string | null>(null)
  const [errorAlGuardar, setErrorAlGuardar] = useState<string | null>(null)
  const [quitados, setQuitados] = useState<string | null>(null)

  // El catálogo de CD, para que el filtro ofrezca uno sin nadie ese día (es justo
  // el CD cuya asistencia hay que poder pedir). Si falla, el filtro se arma con lo que hay.
  const cdsQuery = useQuery({
    queryKey: ['origenes'],
    queryFn: () => locationsApi.list({ origin: true, operational_status: 'ACTIVE', limit: 200 }),
    staleTime: 5 * 60 * 1000,
  })
  const catalogoDeCds = useMemo(() => (cdsQuery.data?.data ?? []).map(cd => cd.name), [cdsQuery.data])

  const cerrado = flota.drivers?.closed ?? false
  const filas = useMemo(
    () => (flota.drivers && flota.equipment ? buildFleetRows(flota.drivers, flota.equipment, alcance) : []),
    [flota.drivers, flota.equipment, alcance],
  )

  async function handleSetReason(destino: Destino, cambios: CambiosDeLinea, filaKey: string) {
    setSavingRow(filaKey)
    setErrorAlGuardar(null)
    try {
      if (destino.tipo === 'DRIVER') await dailyClosuresApi.setReason(destino.id, fecha, cambios)
      else await equipmentClosuresApi.setReason(destino.id, fecha, cambios)
    } catch (e) {
      setErrorAlGuardar(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
    } finally {
      // Los dos ejes: un motivo de conductor puede escribirse solo en su tracto.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] }),
        queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] }),
      ])
      setSavingRow(null)
    }
  }

  // El lote se parte por destino: una selección mezcla filas que escriben en el
  // conductor y filas que escriben en el tracto.
  async function handleApplyBatch(destinos: Destino[]) {
    if (!batchReason || destinos.length === 0) return
    setSavingBatch(true)
    try {
      setErrorAlGuardar(null)
      const conductores = destinos.filter(d => d.tipo === 'DRIVER').map(d => d.id)
      const tractos = destinos.filter(d => d.tipo === 'ASSET').map(d => d.id)
      if (conductores.length) await dailyClosuresApi.setReasonBatch(fecha, conductores, { unassigned_reason_id: batchReason })
      if (tractos.length) await equipmentClosuresApi.setReasonBatch(fecha, tractos, { unassigned_reason_id: batchReason })
      setSelected(new Set()); setBatchReason('')
    } catch (e) {
      setErrorAlGuardar(e instanceof Error ? e.message : 'No se pudo aplicar el motivo')
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] }),
        queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] }),
      ])
      setSavingBatch(false)
    }
  }

  const abrir = (key: string) => onOpenQuickView && ((t: QuickViewTarget) => onOpenQuickView(t, key))
  const columnas = useMemo<DataColumn<FleetRow>[]>(() => [
    { id: 'primary', header: 'Conductor', hideable: false, value: r => r.primary,
      render: r => <span className="font-medium text-text-primary"><EntityCell kind="driver" id={r.driverId} label={r.primary} onOpen={abrir(r.key)} /></span> },
    { id: 'carrier', header: 'Empresa', value: r => r.carrierName,
      render: r => <EntityCell kind="carrier" id={r.carrierId} label={r.carrierName} onOpen={abrir(r.key)} /> },
    { id: 'plate', header: 'Patente', value: r => r.secondary,
      render: r => (
        <span className="flex items-center gap-1.5">
          <EntityCell kind="asset" id={r.assetId} label={r.secondary} mono
            empty={r.group === 'other_driver' ? 'Sin tracto habitual' : '—'} onOpen={abrir(r.key)} />
          {r.lastKnownOperationType && <StatusChip tone="neutral">{r.lastKnownOperationType}</StatusChip>}
        </span>
      ) },
    { id: 'tripCode', header: 'Nº viaje', value: r => r.tripCode,
      render: r => <span className="font-identificador text-informativo">{r.tripCode ?? '—'}</span> },
    // Origen habitual DECLARADO. "Sin origen" es un pendiente del directorio, no un dato faltante.
    { id: 'cd', header: 'Origen habitual', value: r => r.cd, options: catalogoDeCds,
      render: r => <span className="text-informativo">{r.cd ?? 'Sin origen'}</span> },
    { id: 'origin', header: 'Local de origen', value: r => r.origin },
    { id: 'cliente', header: 'Generador de carga', value: r => r.cliente },
    { id: 'status', header: 'Estado', value: r => CATEGORY_LABEL[r.categoria], options: Object.values(CATEGORY_LABEL),
      render: r => <StatusChip tone={r.categoria === 'ASIGNADO' ? 'resolved' : r.categoria === 'POR_REGULARIZAR' ? 'urgent' : 'warning'}>
        {CATEGORY_LABEL[r.categoria]}</StatusChip> },
    { id: 'group', header: 'Grupo', value: r => FLEET_ROW_GROUP_LABEL[r.group], defaultHidden: true },
    { id: 'reason', header: 'Motivo', sortable: false,
      value: r => unassignedReasons.find(m => m.id === r.unassignedReasonId)?.label ?? null,
      render: r => (
        <RowAction fila={r} fecha={fecha} cerrado={cerrado} guardando={savingRow === r.key} motivos={unassignedReasons}
          onSetReason={(d, c) => handleSetReason(d, c, r.key)} onSelectTrip={onSelectTrip} onCreateManualTrip={onCreateManualTrip} />
      ) },
    { id: 'comment', header: 'Comentario', filter: 'presence', sortable: false, value: r => r.comentario,
      render: r => (
        <RowComment valor={r.comentario ?? ''} guardando={cerrado || savingRow === r.key}
          etiqueta={`Comentario de ${r.primary}`} onGuardar={texto => handleSetReason(r.destino, { comentario: texto }, r.key)} />
      ) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [catalogoDeCds, unassignedReasons, cerrado, savingRow, fecha, onOpenQuickView, onSelectTrip, onCreateManualTrip])

  const model = useDataTable({
    rows: filas, columns: columnas, getRowId: r => r.key, view, onViewChange: setView, pageSize: 20,
    columnPrefs: preferencias.columns,
    search: (r, q) => [r.primary, r.carrierName, r.secondary, r.tripCode, r.origin].some(x => (x ?? '').toLowerCase().includes(q)),
  })

  // C7: al cambiar de alcance se conservan los filtros que siguen aplicando; los
  // valores que el nuevo alcance no tiene se quitan, y se dice cuáles.
  const alcanceAnterior = useRef(alcance)
  useEffect(() => {
    if (alcanceAnterior.current === alcance || flota.isPending) return
    alcanceAnterior.current = alcance
    const quitar: string[] = []
    const filters = { ...view.filters }
    for (const [columnId, valores] of Object.entries(view.filters)) {
      const c = model.columnById(columnId)
      if (!c || c.filter === 'presence' || c.options?.length) continue
      const presentes = new Set(filas.map(f => c.value(f)))
      const siguen = valores.filter(v => presentes.has(v))
      if (siguen.length < valores.length) {
        quitar.push(`${c.header}: ${valores.filter(v => !presentes.has(v)).join(', ')}`)
        if (siguen.length) filters[columnId] = siguen; else delete filters[columnId]
      }
    }
    if (quitar.length) {
      setView({ ...view, filters })
      setQuitados(`Se quitó ${quitar.join('; ')}: no está en ${SCOPE_LABEL[alcance]}.`)
    } else setQuitados(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alcance, flota.isPending])

  if (flota.isError) return <Estado tipo="error" titulo="No se pudo cargar la flota del día" />
  if (flota.isPending) return <Estado tipo="cargando" />

  const tiles: ShortcutTile[] = [
    { value: null, label: 'Todos' },
    { value: CATEGORY_LABEL.ASIGNADO, label: 'Asignados', tone: 'resolved' },
    // "No asignados" = los que nadie miró + los que trabajaron sin asignación (Operaciones, 16/09).
    { value: [CATEGORY_LABEL.SIN_RESOLVER, CATEGORY_LABEL.TRABAJANDO_SIN_ASIGNACION], label: 'No asignados' },
    { value: CATEGORY_LABEL.NO_TRABAJANDO, label: CATEGORY_LABEL.NO_TRABAJANDO },
    // Por regularizar solo existe en Tractoreo: un tracto no puede estar "en la empresa equivocada".
    ...(alcance === 'tractoreo' ? [{ value: CATEGORY_LABEL.POR_REGULARIZAR, label: CATEGORY_LABEL.POR_REGULARIZAR, tone: 'urgent' as const }] : []),
  ]
  const seleccionables = (r: FleetRow) => r.status === 'UNASSIGNED' && !cerrado
  const elegidas = filas.filter(r => selected.has(r.key) && seleccionables(r))
  const sinOrigen = filas.filter(r => !r.cd).length

  return (
    <div className="space-y-4">
      <ShortcutTiles model={model} columnId="status" tiles={tiles} />

      {sinOrigen > 0 && (
        <p className="text-etiqueta text-informativo">
          {sinOrigen === filas.length
            ? 'Todavía nadie tiene origen habitual, así que la asistencia por origen no se puede medir.'
            : `${sinOrigen} de ${filas.length} sin origen habitual: quedan fuera del corte por origen.`}{' '}
          <Link href="/dashboard/carriers" className="font-semibold text-accion hover:underline">Asignar desde el Directorio</Link>
        </p>
      )}

      <TableToolbar model={model} searchPlaceholder="Buscar patente, conductor o empresa…" preferences={preferencias} />

      {quitados && <p role="status" className="text-etiqueta text-informativo">{quitados}</p>}
      {errorAlGuardar && (
        <p role="alert" className="rounded-lg border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">
          {errorAlGuardar}
        </p>
      )}

      {elegidas.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <span className="text-etiqueta font-semibold text-text-primary">{elegidas.length} seleccionados</span>
          <select aria-label="Motivo para la selección" value={batchReason} onChange={e => setBatchReason(e.target.value)}
            className="rounded-lg border border-border bg-white px-2 py-1 text-etiqueta">
            <option value="">— Elegir motivo —</option>
            {unassignedReasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="button" disabled={!batchReason || savingBatch} onClick={() => handleApplyBatch(elegidas.map(r => r.destino))}
            className="rounded-lg bg-accent px-3 py-1 text-etiqueta font-semibold text-white disabled:opacity-50">
            {savingBatch ? 'Aplicando…' : 'Aplicar a todos'}
          </button>
        </div>
      )}

      <DataTable model={model} label="Flota del día" pageSizes={[20, 50, 100]}
        empty="Nada en esta vista. Prueba con otro recuadro o limpia los filtros."
        isRowActive={r => r.key === activeRowKey}
        selection={{
          isSelectable: seleccionables,
          isSelected: r => selected.has(r.key),
          label: r => `Seleccionar ${r.primary}`,
          onToggle: r => setSelected(prev => {
            const next = new Set(prev)
            if (next.has(r.key)) next.delete(r.key); else next.add(r.key)
            return next
          }),
        }} />
    </div>
  )
}
