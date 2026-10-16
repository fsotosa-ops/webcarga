/** Los avisos de Pendientes como filas de una tabla (Cierre con un solo patrón, spec
 *  §4.6): una fila por aviso, con su tipo, de qué se trata, su empresa y sus viajes.
 *  El contenido es el de antes; cambia la forma. La acción de cada fila la dibuja la
 *  sección con `source`, el aviso tal como llega. */
import type { ClosureScope, FleetDriverGapRow, NoticeType, PreCierreEscalations, TripRef } from '@/lib/types'

type Source<K extends NoticeType> = K extends 'FLEET_DRIVER_GAP'
  ? FleetDriverGapRow
  : NonNullable<PreCierreEscalations[Exclude<K, 'FLEET_DRIVER_GAP'>]>[number]

type NoticeBase = {
  key: string
  /** De qué se trata: la patente, el conductor o la empresa sobre la que se actúa. */
  subject: string
  carrier: string | null
  trips: TripRef[]
  /** Qué pasa y qué cuesta, en una frase. */
  detail: string
  /** El alcance del aviso (D6); `null` se ve en los dos. */
  scope: ClosureScope | null
}

export type Notice = { [K in NoticeType]: NoticeBase & { type: K; source: Source<K> } }[NoticeType]

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** El desbalance de dotación de una empresa en una frase: lo dicen Pendientes y
 *  Reporte › Dotación con las mismas palabras. */
export function describeFleetGap(g: FleetDriverGapRow): string {
  const cuanto = g.gap > 0
    ? `Faltan ${plural(g.gap, 'conductor', 'conductores')}`
    : `${plural(Math.abs(g.gap), 'conductor', 'conductores')} de más`
  return `${cuanto} · ${plural(g.n_tractos, 'tracto', 'tractos')} / ${plural(g.n_conductores, 'conductor', 'conductores')}`
}

export function buildNotices(esc: PreCierreEscalations, gap: FleetDriverGapRow[] | undefined): Notice[] {
  // `?? []`: backend y frontend se despliegan por separado; una clave que todavía no
  // llega no puede llevarse la lista entera.
  const base = { trips: [] as TripRef[], scope: null }
  return [
    // La propuesta va primero: es la única que se resuelve con un clic.
    ...(esc.CONDUCTOR_SIN_EMPRESA ?? []).map((s): Notice => ({
      ...base, type: 'CONDUCTOR_SIN_EMPRESA', source: s, key: `CONDUCTOR_SIN_EMPRESA:${s.driver_id}`,
      subject: s.driver_name, carrier: s.carrier_name, trips: s.trips ?? [], scope: s.scope ?? null,
      detail: `Manejó ${s.viajes === 1 ? 'un viaje' : `${s.viajes} viajes`} con un tracto de ${s.carrier_name} y no tiene empresa asignada. Sin empresa no aparece en el cierre del día.`,
    })),
    ...(esc.PATENTE_NO_REGISTRADA ?? []).map((s): Notice => ({
      ...base, type: 'PATENTE_NO_REGISTRADA', source: s, key: `PATENTE_NO_REGISTRADA:${s.tractor_plate}`,
      subject: s.tractor_plate, carrier: s.tms_carrier_name ?? null, scope: s.scope ?? null,
      detail: `${s.reason}${s.tms_carrier_name ? `. El TMS la informa en "${s.tms_carrier_name}"` : ''}. No bloquea el cierre. ¿A qué empresa pertenece?`,
    })),
    ...(esc.EMPRESA_ONBOARDING ?? []).map((s): Notice => ({
      ...base, type: 'EMPRESA_ONBOARDING', source: s, key: `EMPRESA_ONBOARDING:${s.carrier_id}`,
      subject: s.carrier_name, carrier: s.carrier_name, scope: s.scope ?? null,
      detail: 'Está en onboarding. ¿Activarla para incluirla en el cierre?',
    })),
    ...(esc.SIN_TIPO_OPERACION ?? []).map((s): Notice => ({
      ...base, type: 'SIN_TIPO_OPERACION', source: s, key: `SIN_TIPO_OPERACION:${s.carrier_id}:${s.tractor_plate ?? ''}`,
      subject: s.tractor_plate ?? s.carrier_name, carrier: s.carrier_name, scope: s.scope ?? null,
      detail: 'Sin tipo de operación. Cuenta como Tractoreo y exige motivo, así que bloquea el cierre del día hasta resolverlo.',
    })),
    ...(esc.EMPRESA_NO_RECONOCIDA ?? []).map((s, i): Notice => ({
      ...base, type: 'EMPRESA_NO_RECONOCIDA', source: s, key: `EMPRESA_NO_RECONOCIDA:${s.tractor_plate}:${i}`,
      subject: s.tractor_plate, carrier: s.directory_carrier_name, scope: s.scope ?? null,
      detail: `El TMS reporta "${s.tms_carrier_name}" y el directorio tiene "${s.directory_carrier_name}": sin coincidencia única.`,
    })),
    ...(esc.CONDUCTOR_NO_REGISTRADO ?? []).map((s): Notice => ({
      ...base, type: 'CONDUCTOR_NO_REGISTRADO', source: s, key: `CONDUCTOR_NO_REGISTRADO:${s.driver_rut}`,
      subject: `RUT ${s.driver_rut}`, carrier: null, scope: s.scope ?? null,
      detail: s.reason
        ? 'El TMS informó un RUT que no es válido. Hay que corregirlo en el TMS.'
        : `Conductor no registrado${s.driver_name_tms ? `; el TMS lo llama "${s.driver_name_tms}"` : ''}.`,
    })),
    // Se resuelve con el transportista, no en el sistema: un aviso sin acción.
    ...(gap ?? []).map((g): Notice => ({
      ...base, type: 'FLEET_DRIVER_GAP', source: g, key: `FLEET_DRIVER_GAP:${g.carrier_id}`,
      subject: g.business_name, carrier: g.business_name,
      detail: describeFleetGap(g),
    })),
  ]
}
