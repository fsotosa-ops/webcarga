'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FilePlus2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'
import { AlertStatTiles } from '../AlertStatTiles'
import { CabeceraDeColumna, compararValores, type Orden } from '../CabeceraDeColumna'
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
/** "No trabajando" son los que YA tienen motivo. Antes caían en "No
 *  asignados" junto a los que todavía nadie miró, así que el número de lo
 *  pendiente no bajaba nunca aunque el trabajo avanzara. Pedido del usuario
 *  (07/09): al marcar una Acción, la fila se descuenta de No asignados y pasa
 *  a contarse acá. */
type RowCategory = 'total' | 'assigned' | 'unassigned' | 'noTrabajando' | 'mismatch'

/** Cuántas filas por página. El usuario pidió 20/50/100 "para que equilibre
 *  con la paginación": con 10 fijas y 81 tractos, revisar el día eran nueve
 *  saltos de página. */
const TAMANOS_DE_PAGINA = [20, 50, 100] as const

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
  const [pageSize, setPageSize] = useState<number>(TAMANOS_DE_PAGINA[0])
  const [orden, setOrden] = useState<Orden>(null)
  /** Un conjunto de valores elegidos por columna. Vacío = sin filtro. */
  const [filtros, setFiltros] = useState<Record<string, Set<string>>>({})

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

  useEffect(() => {
    setCategory(''); setQ(''); setPage(1); setSelected(new Set())
    // Los filtros y el orden son de ESTA tabla: al cambiar de eje las columnas
    // cambian de significado y un filtro heredado dejaría la tabla vacía sin
    // que se vea por qué.
    setOrden(null); setFiltros({})
  }, [vista])
  useEffect(() => { setPage(1) }, [category, q, pageSize, filtros, orden])

  async function handleSetReason(entityId: string, reasonId: string, comentario?: string | null) {
    setSavingReason(entityId)
    try {
      if (vista === 'CONDUCTORES') {
        await dailyClosuresApi.setReason(entityId, fecha, reasonId, comentario)
        await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
      } else {
        await equipmentClosuresApi.setReason(entityId, fecha, reasonId, comentario)
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
    tripCode?: string | null
    origin?: string | null
    comentario?: string | null
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
        tripCode: d.today_trip_code,
        origin: d.today_trip_origin,
        comentario: d.comentario,
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
        tripCode: e.today_trip_code,
        origin: e.today_trip_origin,
        comentario: e.comentario,
      }))

  // "No asignado" se parte en dos: los que todavía nadie miró y los que ya
  // tienen motivo. Antes eran el mismo número, así que resolver una fila no
  // movía el contador de lo pendiente.
  const sinResolver = (r: Row) => r.statusLabel === 'No asignado' && !r.unassignedReasonId
  const noTrabajando = (r: Row) => r.statusLabel === 'No asignado' && !!r.unassignedReasonId

  const categoryFiltered = (
    category === 'total'        ? rows :
    category === 'assigned'     ? rows.filter(r => r.statusLabel === 'Asignado') :
    category === 'unassigned'   ? rows.filter(sinResolver) :
    category === 'noTrabajando' ? rows.filter(noTrabajando) :
    category === 'mismatch'     ? rows.filter(r => r.statusLabel === 'Por regularizar') :
    rows.filter(r => r.statusLabel === 'Por regularizar' || sinResolver(r))
  )

  // ── Filtro por columna, orden y paginación ───────────────────────────────
  // Los valores de cada filtro salen de las filas que hay, no de un catálogo:
  // el desplegable nunca ofrece algo que no está en la tabla.
  const valorDeColumna = (r: Row, col: string): string | null => (
    col === 'primary'  ? r.primary :
    col === 'carrier'  ? r.carrierName :
    col === 'plate'    ? r.secondary :
    col === 'tripCode' ? r.tripCode ?? null :
    col === 'origin'   ? r.origin ?? null :
    col === 'status'   ? r.statusLabel : null
  )
  const COLUMNAS_FILTRABLES = ['primary', 'carrier', 'plate', 'tripCode', 'origin', 'status']
  const valoresPorColumna: Record<string, string[]> = Object.fromEntries(
    COLUMNAS_FILTRABLES.map(col => [
      col,
      Array.from(new Set(categoryFiltered.map(r => valorDeColumna(r, col)).filter((v): v is string => !!v)))
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })),
    ]),
  )

  const columnFiltered = categoryFiltered.filter(r =>
    COLUMNAS_FILTRABLES.every(col => {
      const elegidos = filtros[col]
      if (!elegidos || elegidos.size === 0) return true
      const v = valorDeColumna(r, col)
      return v !== null && elegidos.has(v)
    }),
  )

  const buscados = qLower === '' ? columnFiltered : columnFiltered.filter(r =>
    r.primary.toLowerCase().includes(qLower)
    || (r.carrierName ?? '').toLowerCase().includes(qLower)
    || (r.secondary ?? '').toLowerCase().includes(qLower)
    || (r.tripCode ?? '').toLowerCase().includes(qLower)
    || (r.origin ?? '').toLowerCase().includes(qLower),
  )

  const filtered = orden
    ? [...buscados].sort((a, b) =>
        compararValores(valorDeColumna(a, orden.columna), valorDeColumna(b, orden.columna), orden.dir))
    : buscados

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const totalCount = rows.length
  const assignedCount = rows.filter(r => r.statusLabel === 'Asignado').length
  const unassignedCount = rows.filter(sinResolver).length
  const noTrabajandoCount = rows.filter(noTrabajando).length
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
          { id: 'noTrabajando', label: 'No trabajando', value: noTrabajandoCount, tone: 'neutral' },
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
            <tr className="bg-gray-50 text-etiqueta font-bold text-informativo uppercase tracking-wide">
              <th className="text-left px-3 py-2 w-8" />
              {([
                ['primary',  'Conductor'],
                ['carrier',  'Empresa'],
                ['plate',    esConductores ? 'Tracto habitual' : 'Patente'],
                ['tripCode', 'Nº viaje'],
                ['origin',   'Local de origen'],
                ['status',   'Estado'],
              ] as const).map(([id, titulo]) => (
                <CabeceraDeColumna
                  key={id}
                  id={id}
                  titulo={titulo}
                  valores={valoresPorColumna[id] ?? []}
                  orden={orden}
                  onOrden={setOrden}
                  seleccionados={filtros[id] ?? new Set()}
                  onFiltro={sel => setFiltros(f => ({ ...f, [id]: sel }))}
                />
              ))}
              <th className="text-left px-3 py-2">Acción</th>
              {/* Columna propia y no un renglón bajo el motivo (pedido del
                  usuario, 07/09): metido dentro de "Acción" competía por el
                  ancho con el desplegable y se leía como un pie de página del
                  motivo, no como el dato que es. */}
              <th className="text-left px-3 py-2">Comentario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {paged.length === 0 && (
              <tr>
                <td colSpan={9}>
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
                <td className="px-3 py-2 font-identificador text-informativo">{r.tripCode ?? '—'}</td>
                <td className="px-3 py-2 text-informativo">{r.origin ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`text-etiqueta font-semibold px-2 py-0.5 rounded-full border ${r.statusCls}`}>
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
                {/* El comentario acompaña al motivo: sin motivo elegido no hay
                    qué comentar, porque un texto libre sin categoría no se
                    agrupa ni se cuenta. La celda lo dice con un guion en vez de
                    dejar un campo que no guarda nada. */}
                <td className="px-3 py-2 min-w-[12rem]">
                  {r.unassignedReasonId ? (
                    <ComentarioDeFila
                      valor={r.comentario ?? ''}
                      guardando={savingReason === r.entityId}
                      onGuardar={texto => handleSetReason(r.entityId, r.unassignedReasonId!, texto)}
                      etiqueta={`Comentario de ${r.primary}`}
                    />
                  ) : (
                    <span className="text-informativo">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <p className="text-etiqueta text-informativo">
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
              {filtered.length !== rows.length && ` de ${rows.length}`}
            </p>
            {/* Con 10 filas fijas y 81 tractos, revisar el día eran nueve
                saltos de página. El usuario pidió 20/50/100 "para que
                equilibre con la paginación". */}
            <label className="flex items-center gap-1.5 text-etiqueta text-informativo">
              Ver
              <select
                value={pageSize}
                aria-label="Filas por página"
                onChange={e => setPageSize(Number(e.target.value))}
                className="text-etiqueta border border-border rounded-lg px-1.5 py-1 bg-white"
              >
                {TAMANOS_DE_PAGINA.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
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

/** El comentario de una fila del cierre.
 *
 *  Guarda al salir del campo y no con cada tecla: son 81 filas y un PATCH por
 *  letra sería una tormenta de escrituras sobre la misma tabla que el GET ya
 *  recalcula. Y sólo si cambió — volver a mandar el mismo texto reescribiría
 *  `resolved_at` y movería la hora de una decisión que nadie tomó de nuevo.
 *
 *  El draft se resincroniza desde el prop: es la clase de bug que este
 *  frontend ya vio tres veces (ContactCard, TransporterDocumentsPanel). */
function ComentarioDeFila({
  valor, guardando, onGuardar, etiqueta,
}: {
  valor:     string
  guardando: boolean
  onGuardar: (texto: string) => void
  etiqueta:  string
}) {
  const [texto, setTexto] = useState(valor)
  useEffect(() => { setTexto(valor) }, [valor])

  return (
    <input
      type="text"
      value={texto}
      disabled={guardando}
      aria-label={etiqueta}
      placeholder="Comentario (opcional)"
      onChange={e => setTexto(e.target.value)}
      onBlur={() => { if (texto.trim() !== valor.trim()) onGuardar(texto) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-full text-etiqueta border border-border rounded-lg px-2 py-1 bg-white placeholder:text-informativo/60 focus:outline-none focus:ring-2 focus:ring-accent/20"
    />
  )
}
