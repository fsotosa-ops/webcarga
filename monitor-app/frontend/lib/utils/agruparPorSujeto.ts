import type { PendingComplianceRow } from '@/lib/types'

/** Lo mínimo que hace falta para identificar un sujeto: tipo, id y nombre.
 *  `PendingComplianceRow` y `ComplianceSummarySubject` traen las tres, así
 *  que `claveDeSujeto`/`tituloDeSujeto` sirven para las dos sin acoplarse a
 *  ninguna en particular. */
type SujetoIdentificable = {
  entity_type:  PendingComplianceRow['entity_type']
  entity_id:    string
  subject_name: string | null
}

/** La clave de un sujeto — tipo y id, sin ambigüedad entre un conductor y un
 *  vehículo que compartieran id por casualidad. */
export function claveDeSujeto(s: SujetoIdentificable): string {
  return `${s.entity_type}:${s.entity_id}`
}

/** Cómo se titula un sujeto: "De la empresa" para el CARRIER, su nombre para
 *  conductor o vehículo. Antes vivía escrito dos veces —acá y en la ficha de
 *  empresa (`page.tsx`)—, con los mismos literales 'De la empresa' y 'Sin
 *  nombre' repetidos: cambiar uno dejaba el otro atrás, y las dos superficies
 *  se ven en la misma sesión (cajón y ficha). */
export function tituloDeSujeto(s: SujetoIdentificable): string {
  return s.entity_type === 'CARRIER' ? 'De la empresa' : (s.subject_name ?? 'Sin nombre')
}

/** Un sujeto de Certificación: la empresa misma, uno de sus conductores o uno
 *  de sus vehículos, con las filas de `/pending` que le corresponden. */
export type Sujeto = {
  clave:      string
  titulo:     string
  entityType: PendingComplianceRow['entity_type']
  entityId:   string
  filas:      PendingComplianceRow[]
}

/** Agrupa filas de `/pending` por sujeto, en el orden CARRIER→DRIVER→ASSET y
 *  con "De la empresa" como título del sujeto CARRIER.
 *
 *  Hoy la usa sólo `CarrierDrawer` (que pide `estado='falta'`): la ficha de
 *  empresa (`page.tsx`) dejó de llamarla con Task 2 de perf/compresion-y-resumen
 *  —agrupa `ComplianceSummarySubject[]` del resumen, no filas de detalle—,
 *  pero sigue compartiendo `claveDeSujeto`/`tituloDeSujeto` con ella: es el
 *  mismo problema de identificar un sujeto, sólo cambia la forma del objeto
 *  que lo trae. */
export function agruparPorSujeto(rows: PendingComplianceRow[]): Sujeto[] {
  const porClave = new Map<string, Sujeto>()
  for (const r of rows) {
    const clave = claveDeSujeto(r)
    if (!porClave.has(clave)) {
      porClave.set(clave, {
        clave,
        titulo: tituloDeSujeto(r),
        entityType: r.entity_type,
        entityId: r.entity_id,
        filas: [],
      })
    }
    porClave.get(clave)!.filas.push(r)
  }
  const orden = { CARRIER: 0, DRIVER: 1, ASSET: 2 } as const
  return [...porClave.values()].sort((a, b) =>
    orden[a.entityType] - orden[b.entityType] || a.titulo.localeCompare(b.titulo))
}
