import type { FleetGap, GrupoDelCierre, ViajeDelCierre } from '@/lib/types'

/** Las tres preguntas de la pestaña Viajes del Cierre (spec 2026-10-11): qué falta
 *  declarar, qué sigue vivo sin depender del cierre, y qué ya se declaró. */
export type PestanaDeViajes = 'to_resolve' | 'tracking' | 'resolved'

export type FilaDeViaje = ViajeDelCierre & { grupo: GrupoDelCierre }

export const PESTANAS_DE_VIAJES: { id: PestanaDeViajes; etiqueta: string; bajada: string; vacio: string }[] = [
  {
    id: 'to_resolve', etiqueta: 'Por resolver',
    bajada: 'Declara por qué no se tomó un viaje, o completa la flota de una asignación incompleta.',
    vacio: 'Nada por resolver: puedes firmar el día',
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

/** Qué se hace con un viaje de Por resolver: declarar el motivo de no asignación
 *  o completar su flota en el detalle del viaje. */
export type TripAction = 'declare' | 'complete' | 'none'

type Presentacion = {
  pestana: PestanaDeViajes
  /** La etiqueta corta del filtro de chips dentro de la pestaña. */
  chip: string
  /** Lo mismo que cuenta `bloquean` en la API: hoy, rezago y la asignación incompleta del día. */
  bloqueaLaFirma: (v: ViajeDelCierre, fecha: string) => boolean
  action: TripAction
  /** "Por qué está aquí" (Por resolver), "Situación" (En seguimiento) o el motivo (Resueltos). */
  porQue: (v: ViajeDelCierre, fecha: string) => string
}

const siempre = () => true
const nunca = () => false

const PIEZA: Record<FleetGap, string> = { tractor: 'tracto', driver: 'conductor' }

/** "Falta conductor", "Falta tracto" o "Falta tracto y conductor". */
function loQueFalta(v: ViajeDelCierre): string {
  const piezas = (['tractor', 'driver'] as const).filter(p => v.missing_fleet?.includes(p)).map(p => PIEZA[p])
  return piezas.length ? `Falta ${piezas.join(' y ')}` : 'Flota incompleta'
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

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
  hoy: { pestana: 'to_resolve', chip: 'Del día', bloqueaLaFirma: siempre, action: 'declare', porQue: () => 'Del día' },
  rezago: {
    pestana: 'to_resolve', chip: 'Rezago', bloqueaLaFirma: siempre, action: 'declare',
    porQue: (v, fecha) => `Rezago · ${plural(diasAtras(v.planning_date, fecha), 'día', 'días')}`,
  },
  // Minuta 09/10 §2.4: asignado, pero sin tracto o sin conductor resueltos. Se
  // completa en el detalle del viaje, no se declara; bloquea solo si es del día.
  incomplete_assignment: {
    pestana: 'to_resolve', chip: 'Asignación incompleta', action: 'complete',
    bloqueaLaFirma: (v, fecha) => v.planning_date === fecha,
    porQue: v => loQueFalta(v),
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

export function esPestanaDeViajes(v: string | null): v is PestanaDeViajes {
  return PESTANAS_DE_VIAJES.some(p => p.id === v)
}

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
