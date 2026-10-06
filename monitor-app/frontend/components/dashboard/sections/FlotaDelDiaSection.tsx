'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FilePlus2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { dailyClosuresApi, type CambiosDeLinea } from '@/lib/api/dailyClosures'
import { equipmentClosuresApi } from '@/lib/api/equipmentClosures'
import { locationsApi } from '@/lib/api/locations'
import { AlertStatTiles } from '../AlertStatTiles'
import { CabeceraDeColumna, compararValores, type Orden } from '../CabeceraDeColumna'
import type {
  CategoriaDeLinea, DailyClosureStatus, DriverDayStatusValue, EquipmentClosureStatus, UnassignedReasonMeta,
} from '@/lib/types'
import { Estado } from '@/components/ui/Estado'

/** Las tres vistas del cierre de flota. Conductores y tractos son DOS EJES
 *  distintos —el día se firma por los dos, con dos endpoints y dos tablas—,
 *  y hasta el 2026-09-07 la pestaña rotulada "Tractoreo" mostraba
 *  conductores: los 43 tractos que la API ya devolvía bajo
 *  `tractoreo.equipment` no los pintaba nadie, y 15 de ellos bloqueaban el
 *  cierre sin aparecer en ninguna lista. El badge decía "18 sin asignar"
 *  (conductores) junto a un error que decía "15 sin resolver" (tractos):
 *  dos números que nunca podían cuadrar porque no contaban lo mismo. */
//
// 06/10 (HU-D1, minuta del 02/10): Conductores y Tractoreo se FUSIONARON en
// una sola vista, una fila por patente con su conductor habitual al lado. El
// coordinador cerraba los 41 conductores y después repetía lo mismo en los 45
// tractos. Las dos familias de líneas siguen existiendo en la base (el día se
// firma por las dos); lo que se unió es la superficie. El motivo de una fila
// se escribe en el CONDUCTOR cuando los dos están sin carga, y el tracto lo
// hereda (_SQL_SINCRONIZAR_TRACTOS); si no, en el tracto. Los conductores que
// no son habituales de ningún tracto van al final, en su propio grupo.
type Vista = 'TRACTOREO' | 'EQUIPO_COMPLETO'

/** A qué línea del cierre escribe una fila: es lo que antes decidía la vista. */
type Destino = { tipo: 'DRIVER' | 'ASSET'; id: string }
/** Qué tile cuenta qué lo decide la CATEGORÍA que manda el backend, y ésta
 *  sale del grupo del motivo en el catálogo:
 *  - "No asignados": sin carga y trabajando — los que nadie miró todavía y los
 *    que tienen un motivo de "trabajó sin asignación" (Esperando carga, Camino
 *    al CD, Se retira sin carga). Solicitud de Operaciones, 16/09.
 *  - "No trabajando": motivo de "no trabajó" (Vacaciones, Panne).
 *  Hasta el 16/09 la regla vivía acá como "tiene motivo = no trabajó". */
// La pantalla ABRE en 'total' (decision del usuario, 14/09). Hasta el 04/08
// abria en una categoria anonima —el string vacio, la union de "No asignados"
// y "Por regularizar"— que NO tenia tile: se veia "43 Total" arriba y una sola
// fila abajo, con los cinco tiles apagados y nada que explicara el recorte.
// Con 'total' el numero de arriba es el numero de filas de abajo, y no hizo
// falta inventar ninguna etiqueta nueva.
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
  const [vista, setVista] = useState<Vista>('TRACTOREO')
  const [category, setCategory] = useState<RowCategory>('total')
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
  /** Un guardado que falla tiene que decirlo: antes el error se perdía y el
   *  desplegable volvía a su valor como si nada. */
  const [errorAlGuardar, setErrorAlGuardar] = useState<string | null>(null)

  const driversQuery = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })
  const equipmentQuery = useQuery({
    queryKey: ['equipment-closures', fecha],
    queryFn: () => equipmentClosuresApi.get(fecha),
  })
  // El catálogo de CD, para que el filtro pueda ofrecer uno que no tenga a
  // nadie ese día. Si falla, el filtro se arma igual con lo que haya en la
  // tabla: la pantalla del cierre no se cae por el desplegable.
  const cdsQuery = useQuery({
    queryKey: ['origenes'],
    queryFn: () => locationsApi.list({ origin: true, operational_status: 'ACTIVE', limit: 200 }),
    staleTime: 5 * 60 * 1000,
  })
  const catalogoDeCds = (cdsQuery.data?.data ?? []).map(cd => cd.name)

  useEffect(() => {
    setCategory('total'); setQ(''); setPage(1); setSelected(new Set())
    // Los filtros y el orden son de ESTA tabla: al cambiar de eje las columnas
    // cambian de significado y un filtro heredado dejaría la tabla vacía sin
    // que se vea por qué.
    setOrden(null); setFiltros({})
  }, [vista])
  useEffect(() => { setPage(1) }, [category, q, pageSize, filtros, orden])

  // Sólo viajan las claves de lo que cambió: comentar no manda el motivo, y el
  // backend conserva el que había. No mandar la clave no es pedir que quede
  // vacía.
  async function handleSetReason(destino: Destino, cambios: CambiosDeLinea, filaKey: string = destino.id) {
    setSavingReason(filaKey)
    setErrorAlGuardar(null)
    try {
      if (destino.tipo === 'DRIVER') {
        await dailyClosuresApi.setReason(destino.id, fecha, cambios)
      } else {
        await equipmentClosuresApi.setReason(destino.id, fecha, cambios)
      }
    } catch (e) {
      setErrorAlGuardar(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
    } finally {
      // Los dos ejes: un motivo de conductor puede escribirse solo en su tracto.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] }),
        queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] }),
      ])
      setSavingReason(null)
    }
  }

  function toggleSelected(filaKey: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(filaKey)) next.delete(filaKey); else next.add(filaKey)
      return next
    })
  }

  // La selección guarda la CLAVE de la fila y el lote se parte por destino: en
  // la vista fusionada una selección mezcla filas que escriben en el conductor
  // y filas que escriben en el tracto.
  async function handleApplyBatch(destinos: Destino[]) {
    if (!batchReason || destinos.length === 0) return
    setSavingBatch(true)
    try {
      setErrorAlGuardar(null)
      const conductores = destinos.filter(d => d.tipo === 'DRIVER').map(d => d.id)
      const tractos = destinos.filter(d => d.tipo === 'ASSET').map(d => d.id)
      if (conductores.length) {
        await dailyClosuresApi.setReasonBatch(fecha, conductores, { unassigned_reason_id: batchReason })
      }
      if (tractos.length) {
        await equipmentClosuresApi.setReasonBatch(fecha, tractos, { unassigned_reason_id: batchReason })
      }
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
  const esTractoreo = vista === 'TRACTOREO'
  // Un día firmado no se edita: el backend responde 409, y la tabla no
  // ofrece lo que no se puede hacer. Se reabre desde el pie del cierre.
  const cerrado = drivers.closed
  const grupoDeMotivo = (id: string | null | undefined) =>
    unassignedReasons.find(r => r.id === id)?.group ?? 'no_trabajando'
  const qLower = q.trim().toLowerCase()

  // ── Filas normalizadas a una sola forma, para que la tabla sea 100% la
  // misma estructura y funcionalidad sin importar el tipo de operación. ──
  type Row = {
    key: string
    destino: Destino          // a qué línea escribe el motivo de la fila
    /** El tracto tiene un motivo PROPIO distinto del conductor (alguien lo
     *  escribió a mano): se muestra y se edita aparte, si no quedaría oculto
     *  y bloqueando el cierre sin que se vea por qué. */
    tractoPropio?: { assetId: string; reasonId: string | null } | null
    soloConductor?: boolean   // conductor que no es habitual de ningún tracto
    primary: string           // Conductor (ambos tipos; en Equipo Completo puede ser "mejor esfuerzo")
    secondary: string | null  // Tracto/Equipo habitual (ambos tipos)
    carrierName: string | null
    statusLabel: string
    statusCls: string
    categoria: CategoriaDeLinea
    selectable: boolean
    selected: boolean
    driverId?: string | null  // conductor real, solo si se conoce — habilita "Crear viaje manual"
    tripId?: string | null       // el viaje que EXPLICA el problema (mismatch)
    todayTripId?: string | null  // el viaje de hoy, para "Ver viaje" de una fila sana
    carrierId?: string | null
    unassignedReasonId?: string | null
    validUntil?: string | null
    tripCode?: string | null
    origin?: string | null    // de dónde salió la carga HOY (el hecho del TMS)
    cd?: string | null        // Origen habitual DECLARADO: de quién es la asistencia
    cliente?: string | null   // generador de carga: quien pone la carga, no quien la mueve
    clienteEsHabilitado?: boolean  // true = operaciones de la empresa, no el cliente de un viaje
    comentario?: string | null
    driverPendingDocsCritical?: boolean | null
    suggestedReasonId?: string | null
    lastKnownOperationType?: string | null
    reasonFromDriverName?: string | null
  }

  type FilaConductor = DailyClosureStatus['drivers'][number]
  type FilaTracto = EquipmentClosureStatus['tractoreo']['equipment'][number]

  const filaDeConductor = (d: FilaConductor, extra: Partial<Row> = {}): Row => ({
    key: `driver:${d.driver_id}`,
    destino: { tipo: 'DRIVER', id: d.driver_id },
    primary: d.full_name,
    secondary: null,
    carrierName: d.carrier_name,
    statusLabel: STATUS_LABEL[d.status],
    statusCls: STATUS_CLS[d.status],
    categoria: d.category,
    selectable: d.status === 'UNASSIGNED' && !cerrado,
    selected: selected.has(`driver:${d.driver_id}`),
    driverId: d.driver_id,
    tripId: d.trip_id,
    todayTripId: d.today_trip_id,
    carrierId: d.carrier_id,
    unassignedReasonId: d.unassigned_reason_id,
    validUntil: d.valid_until,
    tripCode: d.today_trip_code,
    origin: d.today_trip_origin,
    cd: d.home_cd_name,
    // Sin viaje no hay cliente real, pero sí se sabe a qué operaciones
    // está habilitada su empresa. Se muestran distinto para no hacerlas
    // pasar por un hecho del día.
    cliente: d.client_names.length
      ? d.client_names.join(', ')
      : (d.carrier_shipper_names?.length ? d.carrier_shipper_names.join(' · ') : null),
    clienteEsHabilitado: d.client_names.length === 0,
    comentario: d.comentario,
    driverPendingDocsCritical: d.driver_pending_docs_critical,
    suggestedReasonId: d.suggested_reason_id,
    lastKnownOperationType: d.last_known_operation_type,
    ...extra,
  })

  const filaDeTracto = (e: FilaTracto): Row => ({
    key: `asset:${e.asset_id}`,
    destino: { tipo: 'ASSET', id: e.asset_id },
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
    categoria: e.category,
    selectable: e.status === 'UNASSIGNED' && !cerrado,
    selected: selected.has(`asset:${e.asset_id}`),
    driverId: e.trip_driver_id ?? e.driver_id,
    tripId: e.trip_id,
    todayTripId: e.trip_id,
    carrierId: e.carrier_id,
    unassignedReasonId: e.unassigned_reason_id,
    validUntil: e.valid_until,
    tripCode: e.today_trip_code,
    origin: e.today_trip_origin,
    cd: e.home_cd_name,
    cliente: e.today_trip_client
      ?? (e.carrier_shipper_names?.length ? e.carrier_shipper_names.join(' · ') : null),
    clienteEsHabilitado: !e.today_trip_client,
    comentario: e.comentario,
    reasonFromDriverName: e.reason_from_driver_name,
  })

  // Vista fusionada: una fila por patente, con la línea del conductor habitual
  // encima cuando los dos cuentan lo mismo ese día.
  const conductorPorId = new Map(drivers.drivers.map(d => [d.driver_id, d]))
  const conductoresCubiertos = new Set<string>()
  const filasDeTractoreo: Row[] = tractoreo.equipment.map(e => {
    const d = e.driver_id ? conductorPorId.get(e.driver_id) : undefined
    const base = filaDeTracto(e)
    if (!d) return base
    // Un conductor que trabajó (en éste o en otro tracto) ya está contado: su
    // tracto sin carga necesita su propio motivo y la fila escribe en el tracto.
    if (d.status === 'ASSIGNED') {
      conductoresCubiertos.add(d.driver_id)
      return base
    }
    // Los dos sin carga: la fila ES el conductor y el tracto lo hereda.
    if (d.status === 'UNASSIGNED' && e.status === 'UNASSIGNED') {
      conductoresCubiertos.add(d.driver_id)
      const propio = e.unassigned_reason_id !== d.unassigned_reason_id && !e.reason_from_driver_name
      return filaDeConductor(d, {
        key: base.key,
        secondary: e.tractor_plate,
        carrierName: e.carrier_name ?? d.carrier_name,
        cd: e.home_cd_name ?? d.home_cd_name,
        tractoPropio: propio ? { assetId: e.asset_id, reasonId: e.unassigned_reason_id } : null,
      })
    }
    // Tracto asignado (lo manejó otro) con el habitual sin carga, o el habitual
    // por regularizar: son dos hechos distintos, el conductor va en su fila.
    return base
  })
  // Los que no quedaron dentro de una fila de tracto: los que no son habituales
  // de ninguno, y los que sí lo son pero ese día su tracto lo manejó otro (o
  // están por regularizar). En ese caso se muestra la patente: es un hecho
  // del directorio, y ayuda a entender por qué el conductor va aparte.
  const patenteHabitual = new Map(
    tractoreo.equipment.filter(e => e.driver_id).map(e => [e.driver_id!, e.tractor_plate]))
  const filasDeConductoresSinTracto: Row[] = drivers.drivers
    .filter(d => !conductoresCubiertos.has(d.driver_id))
    .map(d => filaDeConductor(d, { soloConductor: true, secondary: patenteHabitual.get(d.driver_id) ?? null }))

  const rows: Row[] = esTractoreo
    ? [...filasDeTractoreo, ...filasDeConductoresSinTracto]
    : equiposCompletos.equipment.map(filaDeTracto)

  const noAsignado = (r: Row) => r.categoria === 'SIN_RESOLVER' || r.categoria === 'TRABAJANDO_SIN_ASIGNACION'
  const noTrabajando = (r: Row) => r.categoria === 'NO_TRABAJANDO'

  const categoryFiltered = (
    category === 'assigned'     ? rows.filter(r => r.categoria === 'ASIGNADO') :
    category === 'unassigned'   ? rows.filter(noAsignado) :
    category === 'noTrabajando' ? rows.filter(noTrabajando) :
    category === 'mismatch'     ? rows.filter(r => r.categoria === 'POR_REGULARIZAR') :
    rows  // 'total', que es tambien con la que abre
  )

  // ── Filtro por columna, orden y paginación ───────────────────────────────
  // Los valores de cada filtro salen de las filas que hay, no de un catálogo:
  // el desplegable nunca ofrece algo que no está en la tabla.
  const valorDeColumna = (r: Row, col: string): string | null => (
    col === 'primary'  ? r.primary :
    col === 'carrier'  ? r.carrierName :
    col === 'plate'    ? r.secondary :
    col === 'tripCode' ? r.tripCode ?? null :
    col === 'cd'       ? r.cd ?? null :
    col === 'origin'   ? r.origin ?? null :
    col === 'cliente'  ? r.cliente ?? null :
    col === 'status'   ? r.statusLabel : null
  )
  const COLUMNAS_FILTRABLES = ['primary', 'carrier', 'plate', 'tripCode', 'cd', 'origin', 'cliente', 'status']
  const valoresPorColumna: Record<string, string[]> = Object.fromEntries(
    COLUMNAS_FILTRABLES.map(col => [
      col,
      Array.from(new Set([
        ...categoryFiltered.map(r => valorDeColumna(r, col)).filter((v): v is string => !!v),
        // CD es la ÚNICA columna cuyo desplegable se alimenta del catálogo y no
        // sólo de las filas presentes. Es a propósito y contra el criterio
        // general de arriba: un CD sin nadie ese día es exactamente el CD cuya
        // asistencia hay que poder pedir. Si desaparece del filtro, la pregunta
        // no se puede hacer.
        ...(col === 'cd' ? catalogoDeCds : []),
      ]))
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

  // Los tiles cuentan sobre las filas FILTRADAS por columna, no sobre el día
  // entero: elegir un CD tiene que dar la asistencia de ese CD, que es el
  // pedido de Operaciones. Se usa `alcance` y no `filtered` a propósito —
  // filtered ya aplicó el recorte por categoría, y entonces cada tile se
  // contaría a sí mismo.
  const alcance = rows.filter(r =>
    COLUMNAS_FILTRABLES.every(col => {
      const elegidos = filtros[col]
      if (!elegidos || elegidos.size === 0) return true
      const v = valorDeColumna(r, col)
      return v !== null && elegidos.has(v)
    }),
  )
  const totalCount = alcance.length
  const assignedCount = alcance.filter(r => r.categoria === 'ASIGNADO').length
  const unassignedCount = alcance.filter(noAsignado).length
  const noTrabajandoCount = alcance.filter(noTrabajando).length
  const mismatchCount = alcance.filter(r => r.categoria === 'POR_REGULARIZAR').length
  // Cuántos no tienen Origen habitual. Es un pendiente del directorio, no un dato
  // faltante: la pantalla lo nombra y dice dónde se arregla, en vez de dejar
  // una columna llena de "Sin origen" sin explicación.
  const sinOrigen = rows.filter(r => !r.cd).length
  const filasTractoreoTotales = [...filasDeTractoreo, ...filasDeConductoresSinTracto]
  // Lo que bloquea la firma, contado sobre las dos familias de líneas: una
  // fila fusionada cuenta una vez, y un tracto con motivo propio pendiente
  // también bloquea aunque su conductor ya tenga motivo.
  const pendientesTractoreo = filasTractoreoTotales.filter(r =>
    r.categoria === 'SIN_RESOLVER' || (r.tractoPropio && !r.tractoPropio.reasonId)).length

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Qué se está cerrando" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <TarjetaVista
          activa={esTractoreo}
          onClick={() => setVista('TRACTOREO')}
          titulo="Tractoreo · Tractos y conductores"
          asignados={filasTractoreoTotales.filter(r => r.categoria === 'ASIGNADO').length}
          sinAsignar={filasTractoreoTotales.filter(r => r.categoria !== 'ASIGNADO').length}
          utilizacionPct={filasTractoreoTotales.length
            ? Math.round(filasTractoreoTotales.filter(r => r.categoria === 'ASIGNADO').length / filasTractoreoTotales.length * 1000) / 10
            : 0}
          alerta={pendientesTractoreo > 0
            ? `${pendientesTractoreo} sin motivo — bloquean el cierre`
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
          ...(esTractoreo ? [{ id: 'mismatch', label: 'Por regularizar', value: mismatchCount, tone: 'danger' as const }] : []),
        ]}
        active={category}
        onSelect={id => setCategory(prev => (prev === id ? 'total' : id) as RowCategory)}
      />

      {sinOrigen > 0 && (
        <p className="text-[11px] text-informativo">
          {sinOrigen === rows.length
            ? 'Todavía nadie tiene origen habitual, así que la asistencia por origen no se puede medir.'
            : `${sinOrigen} de ${rows.length} sin origen habitual: quedan fuera del corte por origen.`}{' '}
          <Link href="/dashboard/carriers" className="font-semibold text-accion hover:underline">
            Asignar desde el Directorio
          </Link>
        </p>
      )}

      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar patente, conductor o empresa…"
          aria-label="Buscar"
          className="w-full pl-8 pr-3 py-2 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 bg-white"
        />
      </div>

      {errorAlGuardar && (
        <p role="alert" className="text-xs text-status-incidente bg-status-incidente/5 border border-status-incidente/20 rounded-lg px-3 py-2">
          {errorAlGuardar}
        </p>
      )}

      {selected.size > 0 && !cerrado && (
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
            onClick={() => handleApplyBatch(rows.filter(r => selected.has(r.key)).map(r => r.destino))}
            className="text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
          >
            {savingBatch ? 'Aplicando…' : 'Aplicar a todos'}
          </button>
        </div>
      )}

      {/* `overflow-x-auto`, no `hidden` (14/09): la tabla mide ~1.030 px y en un
          telefono de 390 quedaba CORTADA sin manera de llegar a las dos ultimas
          columnas — Accion y Comentario, justo las que se usan para cerrar el
          dia. Medido en el navegador a 390 px. Ya pasaba con 9 columnas; la
          decima lo empeoro.
          Contrapartida asumida: el desplegable de filtro de `CabeceraDeColumna`
          es `absolute` y cuelga del `th`, asi que con MUY pocas filas puede
          quedar recortado por abajo. Medido con la tabla llena: le sobran 707
          px. La solucion de fondo es un portal, y eso es otro alcance. */}
      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[60rem] text-xs">
          <thead>
            <tr className="bg-gray-50 text-etiqueta font-bold text-informativo uppercase tracking-wide">
              <th className="text-left px-3 py-2 w-8" />
              {([
                ['primary',  'Conductor'],
                ['carrier',  'Empresa'],
                ['plate',    'Patente'],
                ['tripCode', 'Nº viaje'],
                ['cd',       'Origen habitual'],
                ['origin',   'Local de origen'],
                ['cliente',  'Generador de carga'],
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
                <td colSpan={11}>
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
            {paged.map((r, i) => (
              <Fragment key={r.key}>
              {/* El grupo de los conductores sin tracto se anuncia una vez, en la
                  primera de sus filas, mientras la tabla esté en su orden
                  natural (con un orden por columna se mezclan a propósito). */}
              {esTractoreo && !orden && r.soloConductor && !paged[i - 1]?.soloConductor && (
                <tr>
                  <td colSpan={11} className="px-3 py-2 bg-bg-main text-etiqueta font-bold uppercase tracking-wide text-informativo">
                    Otros conductores del día
                  </td>
                </tr>
              )}
              <tr>
                <td className="px-3 py-2">
                  {r.selectable && (
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${r.primary}`}
                      checked={r.selected}
                      onChange={() => toggleSelected(r.key)}
                    />
                  )}
                </td>
                <td className="px-3 py-2 font-medium text-text-primary">{r.primary}</td>
                <td className="px-3 py-2 text-gray-500">{r.carrierName ?? '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-informativo">{r.secondary ?? (r.soloConductor ? 'Sin tracto habitual' : '—')}</span>
                    {r.lastKnownOperationType && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${OPERATION_TYPE_CLS[r.lastKnownOperationType] ?? 'bg-gray-100 text-gray-500 border-transparent'}`}>
                        {r.lastKnownOperationType}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 font-identificador text-informativo">{r.tripCode ?? '—'}</td>
                {/* Origen habitual DECLARADO. "Sin origen" no es un dato faltante: es un
                    pendiente del directorio, y por eso se nombra en vez de
                    poner una raya como en las columnas que sí pueden ir vacías. */}
                <td className="px-3 py-2 text-informativo">{r.cd ?? 'Sin origen'}</td>
                <td className="px-3 py-2 text-informativo">{r.origin ?? '—'}</td>
                <td className="px-3 py-2 text-informativo">
                  {/* Sin viaje, lo que se muestra son las operaciones a las que
                      su empresa está habilitada — no un hecho del día. Va en
                      cursiva para que no se lea como el cliente de un viaje. */}
                  {r.cliente
                    ? <span className={r.clienteEsHabilitado ? 'italic' : ''}>{r.cliente}</span>
                    : '—'}
                </td>
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
                        aria-label={`Motivo de ${r.primary}`}
                        disabled={cerrado || savingReason === r.key}
                        onChange={e => handleSetReason(r.destino, { unassigned_reason_id: e.target.value || null }, r.key)}
                        className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                      >
                        <option value="">— Sin especificar —</option>
                        {unassignedReasons.map(reason => (
                          <option key={reason.id} value={reason.id}>{reason.label}</option>
                        ))}
                      </select>
                      {/* El motivo se escribió en el conductor y el tracto lo
                          sigue solo (01/10): decirlo evita que lo repitan a mano. */}
                      {r.unassignedReasonId && r.reasonFromDriverName && (
                        <p className="text-etiqueta text-informativo">Heredado de {r.reasonFromDriverName}</p>
                      )}
                      {/* El tracto tiene un motivo propio, distinto del conductor:
                          se edita aparte. "Sin especificar" acá lo devuelve a
                          heredar del conductor (HU-D3). */}
                      {r.tractoPropio && (
                        <label className="flex items-center gap-1 text-etiqueta text-informativo">
                          Tracto
                          <select
                            value={r.tractoPropio.reasonId ?? ''}
                            aria-label={`Motivo del tracto ${r.secondary ?? ''}`}
                            disabled={cerrado || savingReason === r.key}
                            onChange={e => handleSetReason(
                              { tipo: 'ASSET', id: r.tractoPropio!.assetId },
                              { unassigned_reason_id: e.target.value || null }, r.key)}
                            className="text-etiqueta border border-border rounded-lg px-1.5 py-0.5 bg-white"
                          >
                            <option value="">— Igual que el conductor —</option>
                            {unassignedReasons.map(reason => (
                              <option key={reason.id} value={reason.id}>{reason.label}</option>
                            ))}
                          </select>
                          {/* Alguien lo dejó en blanco a mano: el desplegable ya
                              muestra la opción vacía y no habría cómo elegirla. */}
                          {!r.tractoPropio.reasonId && !cerrado && (
                            <button
                              type="button"
                              disabled={savingReason === r.key}
                              onClick={() => handleSetReason(
                                { tipo: 'ASSET', id: r.tractoPropio!.assetId },
                                { unassigned_reason_id: null }, r.key)}
                              className="font-semibold text-accent hover:underline"
                            >
                              Usar el del conductor
                            </button>
                          )}
                        </label>
                      )}
                      {/* Vigencia: sólo un motivo de "no trabajó" puede
                          arrastrarse a los días siguientes (Vacaciones,
                          Licencia). Trabajar sin asignación es un hecho de
                          ese día. */}
                      {r.unassignedReasonId && grupoDeMotivo(r.unassignedReasonId) === 'no_trabajando' && (
                        <label className="flex items-center gap-1 text-[10px] text-informativo">
                          Hasta
                          <input
                            type="date"
                            min={fecha}
                            value={r.validUntil ?? ''}
                            aria-label={`Vigencia del motivo de ${r.primary}`}
                            disabled={cerrado || savingReason === r.key}
                            onChange={e => handleSetReason(r.destino, { valid_until: e.target.value || null }, r.key)}
                            className="text-[10px] border border-border rounded-lg px-1.5 py-0.5 bg-white"
                          />
                        </label>
                      )}
                      {!cerrado && !r.unassignedReasonId && r.driverPendingDocsCritical && r.suggestedReasonId && (
                        <button
                          type="button"
                          onClick={() => handleSetReason(r.destino, { unassigned_reason_id: r.suggestedReasonId! }, r.key)}
                          className="block text-[10px] text-amber-600 hover:text-amber-800 hover:underline"
                        >
                          Sugerido: {unassignedReasons.find(reason => reason.id === r.suggestedReasonId)?.label ?? 'Documentación vencida'}
                        </button>
                      )}
                      {!cerrado && r.driverId && onCreateManualTrip && (
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
                {/* Se puede comentar CUALQUIER fila (pedido del usuario,
                    14/09). Antes el campo solo existía si la fila ya tenía
                    motivo guardado —287 de 4.540 filas—, así que en el 94%
                    restante había un guion y no un lugar donde escribir: por
                    eso no se guardó nunca ni un comentario. El motivo no se
                    manda acá; el backend conserva el que haya. */}
                <td className="px-3 py-2 min-w-[12rem]">
                  <ComentarioDeFila
                    valor={r.comentario ?? ''}
                    guardando={cerrado || savingReason === r.key}
                    onGuardar={texto => handleSetReason(r.destino, { comentario: texto }, r.key)}
                    etiqueta={`Comentario de ${r.primary}`}
                  />
                </td>
              </tr>
              </Fragment>
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
