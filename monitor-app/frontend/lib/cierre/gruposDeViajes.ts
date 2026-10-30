import type { FleetGap, GrupoDelCierre, ViajeDelCierre } from '@/lib/types'

/** Las tres preguntas de la pestaña Viajes del Cierre (spec 2026-10-11): qué falta
 *  declarar, qué sigue vivo sin depender del cierre, y qué ya se declaró. Y una cuarta
 *  que NO vive en esa pestaña: lo que hay que regularizar antes de firmar (30/10), que
 *  se resuelve desde la tarjeta "Por regularizar" de la Flota del día. */
export type PestanaDeViajes = 'to_resolve' | 'tracking' | 'resolved' | 'to_regularize'

export type FilaDeViaje = ViajeDelCierre & { grupo: GrupoDelCierre }

export const PESTANAS_DE_VIAJES: { id: PestanaDeViajes; etiqueta: string; bajada: string; vacio: string }[] = [
  {
    id: 'to_resolve', etiqueta: 'Por resolver',
    bajada: 'Declara por qué no se tomó una oferta retirada o un viaje abandonado por el TMS.',
    vacio: 'Nada por resolver aquí. Lo que bloquea la firma está en Flota del día › Por regularizar',
  },
  {
    id: 'tracking', etiqueta: 'En seguimiento',
    bajada: 'No dependen del cierre: se miran. Los que esperan el cierre del TMS los sigue Facturación.',
    vacio: 'Ningún viaje en seguimiento',
  },
  {
    id: 'resolved', etiqueta: 'Resueltos',
    bajada: 'Declarados como no asignados por WebCarga. Se pueden deshacer.',
    vacio: 'Todavía no se declaró ningún viaje',
  },
]

/** Qué se hace con un viaje: declarar el motivo de no asignación, completar su flota
 *  en el detalle del viaje, o regularizarlo (completar o declarar que no se tomará). */
export type TripAction = 'declare' | 'complete' | 'regularize' | 'none'

type Presentacion = {
  pestana: PestanaDeViajes
  /** La etiqueta corta del filtro de chips dentro de la pestaña. */
  chip: string
  /** Lo mismo que cuenta `bloquean` en la API: los por regularizar. */
  bloqueaLaFirma: (v: ViajeDelCierre, fecha: string) => boolean
  action: TripAction
  /** "Por qué está aquí" (Por resolver), "Situación" (En seguimiento) o el motivo (Resueltos). */
  porQue: (v: ViajeDelCierre, fecha: string) => string
}

const siempre = () => true
const nunca = () => false

const PIEZA: Record<FleetGap, string> = { tractor: 'Tracto', driver: 'Conductor', carrier: 'Empresa' }

/** Qué le falta a un viaje por regularizar, en el orden en que se completa: "Sin
 *  asignar"; o las piezas que faltan (Tracto, Conductor, Empresa); o "Empresa distinta
 *  a la del conductor". Son las marcas de la columna "Qué falta". */
export function queFalta(v: ViajeDelCierre): string[] {
  if (v.is_assigned === false) return ['Sin asignar']
  const piezas = (['tractor', 'driver', 'carrier'] as const).filter(p => v.missing_fleet?.includes(p)).map(p => PIEZA[p])
  if (piezas.length) return piezas
  return v.carrier_mismatch ? ['Empresa distinta a la del conductor'] : ['Flota incompleta']
}

/** Hay con qué buscar al conductor: falta, pero el TMS informó un nombre (el caso que
 *  el Monitor ya empareja). */
export function conductorPorEmparejar(v: ViajeDelCierre): boolean {
  return v.is_assigned !== false && !v.driver_id && !!v.driver_name_tms
}

/** Días de calendario entre la planificación y la fecha del cierre. Se cuenta en
 *  UTC sobre fechas sin hora, así el huso horario del navegador no mueve el día. */
export function diasAtras(planning: string, fecha: string): number {
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${planning}T00:00:00Z`)) / 86_400_000)
}

/** Una sola definición de cómo se presenta cada grupo del backend. El tipo
 *  `Record<GrupoDelCierre, …>` obliga a clasificar aquí un grupo nuevo: si falta,
 *  no compila. Va anotado y no con `satisfies` para que todo `porQue` tenga la
 *  misma firma y se pueda llamar con (viaje, fecha) desde cualquier grupo. */
export const GRUPOS_DE_VIAJES: Record<GrupoDelCierre, Presentacion> = {
  // Reunión del 30/10: lo que el coordinador resuelve antes de firmar. Juntó "Del día",
  // "Rezago" y "Asignación incompleta", que vivían en la pestaña Viajes sin bloquear.
  por_regularizar: {
    pestana: 'to_regularize', chip: 'Por regularizar', bloqueaLaFirma: siempre, action: 'regularize',
    porQue: v => queFalta(v).join(' · '),
  },
  // Ofertas que el TMS retiró porque WebCarga no las tomó (Sodimac, 07/10).
  oferta_sin_declarar: {
    pestana: 'to_resolve', chip: 'Oferta retirada', bloqueaLaFirma: nunca, action: 'declare',
    porQue: () => 'Oferta retirada por el TMS',
  },
  // "Igual hay que cerrarlos" (Regla 5 de Pablo): se declaran como los demás.
  abandonado: {
    pestana: 'to_resolve', chip: 'Abandonado', bloqueaLaFirma: nunca, action: 'declare',
    porQue: () => 'Abandonado por el TMS',
  },
  en_curso: {
    pestana: 'tracking', chip: 'En ruta', bloqueaLaFirma: nunca, action: 'none',
    porQue: v => `En ruta · ${v.trip_status ?? 'sin estado'}`,
  },
  // Ítem 6 (minuta 09/10): asignado, falta que el TMS del cliente lo cierre.
  pendiente_cierre_tms: {
    pestana: 'tracking', chip: 'Espera cierre del TMS', bloqueaLaFirma: nunca, action: 'none',
    porQue: () => 'Espera cierre del TMS',
  },
  con_motivo: {
    pestana: 'resolved', chip: 'Con motivo', bloqueaLaFirma: nunca, action: 'none',
    porQue: v => v.unassigned_reason_label ?? 'Sin motivo',
  },
}

const GRUPOS = Object.keys(GRUPOS_DE_VIAJES) as GrupoDelCierre[]

/** Los viajes de una pestaña, de la planificación más antigua a la más nueva y, a
 *  igual fecha, por Nº de viaje. `Partial`: backend y frontend se despliegan por
 *  separado, y un grupo puede no llegar todavía. */
export function filasDePestana(
  grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>, pestana: PestanaDeViajes,
): FilaDeViaje[] {
  return GRUPOS
    .filter(g => GRUPOS_DE_VIAJES[g].pestana === pestana)
    .flatMap(g => (grupos[g] ?? []).map(v => ({ ...v, grupo: g })))
    .sort((a, b) => a.planning_date.localeCompare(b.planning_date)
      || (a.source_system_trip_id ?? a.trip_id).localeCompare(b.source_system_trip_id ?? b.trip_id, 'es', { numeric: true }))
}

/** Todos los viajes del Cierre en una lista, por pestaña (Por resolver, En
 *  seguimiento, Resueltos) y, dentro, en el orden de `filasDePestana`. */
export function closureTrips(grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>): FilaDeViaje[] {
  return PESTANAS_DE_VIAJES.flatMap(p => filasDePestana(grupos, p.id))
}

/** La palabra de la pestaña de un viaje: el valor de la columna Situación. */
export function situationOf(f: FilaDeViaje): string {
  return PESTANAS_DE_VIAJES.find(p => p.id === GRUPOS_DE_VIAJES[f.grupo].pestana)?.etiqueta ?? GRUPOS_DE_VIAJES[f.grupo].chip
}

/** Los viajes por regularizar, en el orden de `filasDePestana`. */
export function tripsToRegularize(grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>): FilaDeViaje[] {
  return filasDePestana(grupos, 'to_regularize')
}

export function pestanaInicial(grupos: Partial<Record<GrupoDelCierre, ViajeDelCierre[]>>): PestanaDeViajes {
  return filasDePestana(grupos, 'to_resolve').length > 0 ? 'to_resolve' : 'tracking'
}

/** Patente → Nº de sus viajes, solo las que aparecen más de una vez: dos viajes
 *  del mismo camión no son un duplicado, y la marca lo dice. */
export function viajesPorPatente(filas: FilaDeViaje[]): Map<string, string[]> {
  const porPatente = new Map<string, string[]>()
  for (const f of filas) {
    if (!f.tractor_plate) continue
    porPatente.set(f.tractor_plate, [...(porPatente.get(f.tractor_plate) ?? []), f.source_system_trip_id ?? f.trip_id])
  }
  return new Map([...porPatente].filter(([, viajes]) => viajes.length > 1))
}
