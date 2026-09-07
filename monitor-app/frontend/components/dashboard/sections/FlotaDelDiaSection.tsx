'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FilePlus2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'
import { AlertStatTiles } from '../AlertStatTiles'
import type { DriverDayStatusValue, UnassignedReasonMeta } from '@/lib/types'
import { Estado } from '@/components/ui/Estado'

/** Las tres vistas del cierre de flota. Conductores y tractos son DOS EJES
 *  distintos —el día se firma por los dos, con dos endpoints y dos tablas—,
 *  y hasta el 2026-09-07 la pestaña rotulada "Tractoreo" mostraba
 *  conductores: los 43 tractos que la API ya devolvía bajo
 *  `tractoreo.equipment` no los pintaba nadie, y 15 de ellos bloqueaban el
 *  cierre sin aparecer en ninguna lista. El badge decía "18 sin asignar"
 *  (conductores) junto a un error que decía "15 sin resolver" (tractos):
 *  dos números que nunca podían cuadrar porque no contaban lo mismo. */
type Vista = 'CONDUCTORES' | 'TRACTOREO' | 'EQUIPO_COMPLETO'
type RowCategory = 'total' | 'assigned' | 'unassigned' | 'mismatch'
const PAGE_SIZE = 10

const STATUS_LABEL: Record<DriverDayStatusValue, string> = {
  ASSIGNED: 'Asignado', UNASSIGNED: 'No asignado', MISMATCH: 'Por regularizar',
}
const STATUS_CLS: Record<DriverDayStatusValue, string> = {
  ASSIGNED:   'bg-green-50 text-green-700 border-green-200',
  UNASSIGNED: 'bg-amber-50 text-amber-700 border-amber-200',
  MISMATCH:   'bg-red-50 text-red-700 border-red-200',
}
const OPERATION_TYPE_CLS: Record<string, string> = {
  Tractoreo:         'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Equipo Completo': 'bg-gray-100 text-gray-600 border-transparent',
}

interface Props {
  fecha:              string
  unassignedReasons:  UnassignedReasonMeta[]
  onSelectTrip:       (tripId: string) => void
  /** Opcional a propósito: el botón "Crear viaje manual" sólo se dibuja si
   *  alguien puede honrarlo. La página del Cierre lo pasaba con un handler
   *  vacío (`TODO(Tarea 1.3/1.4)`), así que el botón se veía, se podía clicar
   *  y no pasaba nada — la peor de las tres opciones. */
  onCreateManualTrip?: (driverId: string, driverName: string) => void
}

/** "Flota del día" — el cierre tiene DOS EJES, y esta sección los muestra a
 *  los dos sobre la misma tabla: **Conductores** (`dailyClosuresApi`, el paso
 *  que exige motivo y bloquea la firma) y **Tractos** (`equipmentClosuresApi`,
 *  partido en Tractoreo y Equipo Completo por `requires_motivo`). Tres
 *  tarjetas, una sola tabla: tiles clickeables → buscador → filas con
 *  Conductor / Empresa / Tracto / Estado editable / Acción, iguales en las
 *  tres vistas ("tienen que cumplir el mismo diseño y funcionalidad,
 *  independiente del tipo de operación", feedback explícito 2026-08-04).
 *
 *  POR QUÉ CAMBIÓ (2026-09-07). Hasta esta ronda la pestaña rotulada
 *  "Tractoreo" mostraba CONDUCTORES: `equipment.tractoreo` —43 tractos el
 *  03-09— llegaba en la respuesta y no lo leía nadie. Los 5 viajes que Pablo
 *  reportó como "no aparecen en el cierre, ni como asignados ni como no
 *  asignados" (FCCP42, BSYF60, CZZG66, SVLT42, HKXW55) estaban los cinco en
 *  esa lista, ASSIGNED y con conductor; y los 15 que devolvían
 *  "no se puede cerrar el día" eran los UNASSIGNED sin motivo de la misma
 *  lista. No faltaba el dato: faltaba la superficie.
 *
 *  Un tracto sin `webcarga_operation_type_id` cae en Tractoreo por diseño
 *  (más riguroso que dejarlo pasar en silencio), así que ahora se ve y se
 *  puede resolver donde bloquea, en vez de escalar sólo como
 *  SIN_TIPO_OPERACION en la pestaña Pendientes. */
export function FlotaDelDiaSection({ fecha, unassignedReasons, onSelectTrip, onCreateManualTrip }: Props) {
  const queryClient = useQueryClient()
  const [vista, setVista] = useState<Vista>('CONDUCTORES')
  const [category, setCategory] = useState<RowCategory | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchReason, setBatchReason] = useState('')
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingReason, setSavingReason] = useState<string | null>(null)

  const driversQuery = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })
  const equipmentQuery = useQuery({
    queryKey: ['equipment-closures', fecha],
    queryFn: () => equipmentClosuresApi.get(fecha),
  })

  useEffect(() => { setCategory(''); setQ(''); setPage(1); setSelected(new Set()) }, [vista])
  useEffect(() => { setPage(1) }, [category, q])

  async function handleSetReason(entityId: string, reasonId: string) {
    setSavingReason(entityId)
    try {
      if (vista === 'CONDUCTORES') {
        await dailyClosuresApi.setReason(entityId, fecha, reasonId)
        await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
      } else {
        await equipmentClosuresApi.setReason(entityId, fecha, reasonId)
        await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
      }
    } finally {
      setSavingReason(null)
    }
  }

  function toggleSelected(entityId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(entityId)) next.delete(entityId); else next.add(entityId)
      return next
    })
  }

  async function handleApplyBatch() {
    if (!batchReason || selected.size === 0) return
    setSavingBatch(true)
    try {
      if (vista === 'CONDUCTORES') {
        await dailyClosuresApi.setReasonBatch(fecha, Array.from(selected), batchReason)
        await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
      } else {
        await equipmentClosuresApi.setReasonBatch(fecha, Array.from(selected), batchReason)
        await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
      }
      setSelected(new Set()); setBatchReason('')
    } finally {
      setSavingBatch(false)
    }
  }

  if (driversQuery.isLoading || !driversQuery.data || equipmentQuery.isLoading || !equipmentQuery.data) {
    return (
      <Estado tipo="cargando" />
    )
  }

  const drivers = driversQuery.data
  // Las dos listas de tractos salen del MISMO endpoint y del mismo universo:
  // `requires_motivo` es lo único que las separa (Tractoreo y "sin clasificar"
  // exigen motivo; Equipo Completo puro, no). Antes sólo se leía la segunda.
  const tractoreo = equipmentQuery.data.tractoreo
  const equiposCompletos = equipmentQuery.data.equipos_completos
  const equipos = vista === 'TRACTOREO' ? tractoreo : equiposCompletos
  const esConductores = vista === 'CONDUCTORES'
  const qLower = q.trim().toLowerCase()

  // ── Filas normalizadas a una sola forma, para que la tabla sea 100% la
  // misma estructura y funcionalidad sin importar el tipo de operación. ──
  type Row = {
    key: string
    entityId: string          // driver_id (Tractoreo) o asset_id (Equipo Completo) — selección + motivo
    primary: string           // Conductor (ambos tipos; en Equipo Completo puede ser "mejor esfuerzo")
    secondary: string | null  // Tracto/Equipo habitual (ambos tipos)
    carrierName: string | null
    statusLabel: string
    statusCls: string
    selectable: boolean
    selected: boolean
    driverId?: string | null  // conductor real, solo si se conoce — habilita "Crear viaje manual"
    tripId?: string | null       // el viaje que EXPLICA el problema (mismatch)
    todayTripId?: string | null  // el viaje de hoy, para "Ver viaje" de una fila sana
    carrierId?: string | null
    unassignedReasonId?: string | null
    driverPendingDocsCritical?: boolean | null
    suggestedReasonId?: string | null
    lastKnownOperationType?: string | null
  }

  const rows: Row[] = esConductores
    ? drivers.drivers.map(d => ({
        key: d.driver_id,
        entityId: d.driver_id,
        primary: d.full_name,
        secondary: d.last_known_tractor_plate,
        carrierName: d.carrier_name,
        statusLabel: STATUS_LABEL[d.status],
        statusCls: STATUS_CLS[d.status],
        selectable: d.status === 'UNASSIGNED',
        selected: selected.has(d.driver_id),
        driverId: d.driver_id,
        tripId: d.trip_id,
        todayTripId: d.today_trip_id,
        carrierId: d.carrier_id,
        unassignedReasonId: d.unassigned_reason_id,
        driverPendingDocsCritical: d.driver_pending_docs_critical,
        suggestedReasonId: d.suggested_reason_id,
        lastKnownOperationType: d.last_known_operation_type,
      }))
    : equipos.equipment.map(e => ({
        key: e.asset_id,
        entityId: e.asset_id,
        // El del VIAJE de hoy manda sobre el habitual: Pablo leía "Sin
        // conductor asignado" en una fila que decía "Asignado" y concluía que
        // el viaje había perdido al conductor, cuando lo que faltaba era la
        // fila del maestro `vehicle_driver_assignments`. Y cuando no hay
        // ninguno de los dos, el texto dice cuál falta en vez de sugerir que
        // el viaje viene vacío.
        primary: e.trip_driver_name
          ?? e.driver_name
          ?? (e.status === 'ASSIGNED' ? 'El TMS no reportó conductor' : 'Sin conductor habitual'),
        secondary: e.tractor_plate,
        carrierName: e.carrier_name,
        statusLabel: STATUS_LABEL[e.status],
        statusCls: STATUS_CLS[e.status],
        selectable: e.status === 'UNASSIGNED',
        selected: selected.has(e.asset_id),
        driverId: e.trip_driver_id ?? e.driver_id,
        tripId: e.trip_id,
        todayTripId: e.trip_id,
        carrierId: e.carrier_id,
        unassignedReasonId: e.unassigned_reason_id,
      }))

  const categoryFiltered = (
    category === 'total'      ? rows :
    category === 'assigned'   ? rows.filter(r => r.statusLabel === 'Asignado') :
    category === 'unassigned' ? rows.filter(r => r.statusLabel === 'No asignado') :
    category === 'mismatch'   ? rows.filter(r => r.statusLabel === 'Por regularizar') :
    rows.filter(r => r.statusLabel === 'Por regularizar' || (r.statusLabel === 'No asignado' && !r.unassignedReasonId))
  )
  const filtered = qLower === '' ? categoryFiltered : categoryFiltered.filter(r =>
    r.primary.toLowerCase().includes(qLower)
    || (r.carrierName ?? '').toLowerCase().includes(qLower)
    || (r.secondary ?? '').toLowerCase().includes(qLower),
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const totalCount = rows.length
  const assignedCount = rows.filter(r => r.statusLabel === 'Asignado').length
  const unassignedCount = rows.filter(r => r.statusLabel === 'No asignado').length
  const mismatchCount = rows.filter(r => r.statusLabel === 'Por regularizar').length
  const conductoresUtilizacionPct = drivers.total_drivers
    ? Math.round((drivers.assigned_count / drivers.total_drivers) * 1000) / 10
    : 0

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Qué se está cerrando" className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <TarjetaVista
          activa={esConductores}
          onClick={() => setVista('CONDUCTORES')}
          titulo="Conductores"
          asignados={drivers.assigned_count}
          sinAsignar={drivers.unassigned_count}
          utilizacionPct={conductoresUtilizacionPct}
          alerta={drivers.mismatch_count > 0 ? `${drivers.mismatch_count} por regularizar` : null}
        />
        <TarjetaVista
          activa={vista === 'TRACTOREO'}
          onClick={() => setVista('TRACTOREO')}
          titulo="Tractos · Tractoreo"
          asignados={tractoreo.summary.assigned}
          sinAsignar={tractoreo.summary.unassigned}
          utilizacionPct={tractoreo.summary.utilization_pct}
          alerta={tractoreo.pending_count > 0
            ? `${tractoreo.pending_count} sin motivo — bloquean el cierre`
            : null}
        />
        <TarjetaVista
          activa={vista === 'EQUIPO_COMPLETO'}
          onClick={() => setVista('EQUIPO_COMPLETO')}
          titulo="Tractos · Equipo Completo"
          asignados={equiposCompletos.summary.assigned}
          sinAsignar={equiposCompletos.summary.unassigned}
          utilizacionPct={equiposCompletos.summary.utilization_pct}
          alerta={null}
        />
      </div>

      <AlertStatTiles
        tiles={[
          { id: 'total', label: 'Total', value: totalCount, tone: 'neutral' },
          { id: 'assigned', label: 'Asignados', value: assignedCount, tone: 'success' },
          { id: 'unassigned', label: 'No asignados', value: unassignedCount, tone: 'neutral' },
          // MISMATCH sólo existe en el eje conductores: un tracto no puede
          // estar "en la empresa equivocada", esa pregunta es del conductor.
          ...(esConductores ? [{ id: 'mismatch', label: 'Por regularizar', value: mismatchCount, tone: 'danger' as const }] : []),
        ]}
        active={category}
        onSelect={id => setCategory(prev => (prev === id ? '' : id) as RowCategory | '')}
      />

      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={esConductores ? 'Buscar conductor, empresa o tracto…' : 'Buscar patente, empresa o conductor…'}
          aria-label="Buscar"
          className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
          <span className="text-[11px] font-semibold text-text-primary">{selected.size} seleccionados</span>
          <select
            aria-label="Motivo para la selección"
            value={batchReason}
            onChange={e => setBatchReason(e.target.value)}
            className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
          >
            <option value="">— Elegir motivo —</option>
            {unassignedReasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!batchReason || savingBatch}
            onClick={handleApplyBatch}
            className="text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
          >
            {savingBatch ? 'Aplicando…' : 'Aplicar a todos'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th className="text-left px-3 py-2 w-8" />
              <th className="text-left px-3 py-2">Conductor</th>
              <th className="text-left px-3 py-2">Empresa</th>
              <th className="text-left px-3 py-2">{esConductores ? 'Tracto habitual' : 'Patente'}</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {paged.length === 0 && (
              <tr>
                <td colSpan={6}>
                  {/* gray-300 en italica no llegaba a 4.5:1 de contraste, y
                      "sin resultados" hace dudar de si algo se rompio. */}
                  <Estado
                    tipo="vacio"
                    titulo="Nada en esta categoría"
                    detalle="Prueba con otra categoría o limpia el buscador."
                  />
                </td>
              </tr>
            )}
            {paged.map(r => (
              <tr key={r.key}>
                <td className="px-3 py-2">
                  {r.selectable && (
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${r.primary}`}
                      checked={r.selected}
                      onChange={() => toggleSelected(r.entityId)}
                    />
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-text-primary">{r.primary}</td>
                <td className="px-3 py-2 text-gray-500">{r.carrierName ?? '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-informativo">{r.secondary ?? (esConductores ? 'Sin tracto reciente' : '—')}</span>
                    {r.lastKnownOperationType && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${OPERATION_TYPE_CLS[r.lastKnownOperationType] ?? 'bg-gray-100 text-gray-500 border-transparent'}`}>
                        {r.lastKnownOperationType}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${r.statusCls}`}>
                    {r.statusLabel}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.statusLabel === 'No asignado' && (
                    <div className="space-y-1">
                      <select
                        value={r.unassignedReasonId ?? ''}
                        disabled={savingReason === r.entityId}
                        onChange={e => handleSetReason(r.entityId, e.target.value)}
                        className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                      >
                        <option value="">— Sin especificar —</option>
                        {unassignedReasons.map(reason => (
                          <option key={reason.id} value={reason.id}>{reason.label}</option>
                        ))}
                      </select>
                      {!r.unassignedReasonId && r.driverPendingDocsCritical && r.suggestedReasonId && (
                        <button
                          type="button"
                          onClick={() => handleSetReason(r.entityId, r.suggestedReasonId!)}
                          className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline"
                        >
                          Sugerido: {unassignedReasons.find(reason => reason.id === r.suggestedReasonId)?.label ?? 'Documentación vencida'}
                        </button>
                      )}
                      {r.driverId && onCreateManualTrip && (
                        <button
                          type="button"
                          onClick={() => onCreateManualTrip(r.driverId!, r.primary)}
                          className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                        >
                          <FilePlus2 size={10} /> Crear viaje manual
                        </button>
                      )}
                    </div>
                  )}
                  {r.statusLabel === 'Por regularizar' && (
                    r.tripId ? (
                      <button
                        type="button"
                        onClick={() => onSelectTrip(r.tripId!)}
                        className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                      >
                        <AlertTriangle size={11} /> Ver viaje
                      </button>
                    ) : (
                      <a
                        href={r.carrierId ? `/dashboard/carriers/${r.carrierId}` : '/dashboard/carriers'}
                        className="text-[11px] text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
                      >
                        <AlertTriangle size={11} /> Revisar en Empresas
                      </a>
                    )
                  )}
                  {r.statusLabel === 'Asignado' && r.todayTripId && (
                    <button
                      type="button"
                      onClick={() => onSelectTrip(r.todayTripId!)}
                      className="text-[11px] font-semibold text-accent hover:text-accent/80"
                    >
                      Ver viaje
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">
            {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <span className="text-xs text-gray-400">Página {currentPage} de {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Las tres tarjetas del cabezal son la MISMA tarjeta con datos distintos: una
 *  variante es una prop, no un componente hermano. Antes eran dos bloques de
 *  markup calcados donde el segundo, además, no tenía dónde poner su alerta —
 *  y la alerta del tercero (los tractos sin motivo) es justo el número que
 *  bloquea el cierre. */
function TarjetaVista({
  activa, onClick, titulo, asignados, sinAsignar, utilizacionPct, alerta,
}: {
  activa:         boolean
  onClick:        () => void
  titulo:         string
  asignados:      number
  sinAsignar:     number
  utilizacionPct: number
  alerta:         string | null
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-colors ${
        activa ? 'border-accent bg-accent/5' : 'border-border bg-white hover:border-accent/40'
      }`}
    >
      <p className="text-etiqueta font-bold text-informativo uppercase tracking-wide mb-1">{titulo}</p>
      <p className="text-xs text-text-primary">
        <span className="font-bold">{asignados}</span> asignados / <span className="font-bold">{sinAsignar}</span> sin asignar
      </p>
      <p className="text-etiqueta text-informativo mt-0.5">{utilizacionPct}% utilización</p>
      {alerta && <p className="text-etiqueta text-status-incidente mt-0.5">{alerta}</p>}
    </button>
  )
}
