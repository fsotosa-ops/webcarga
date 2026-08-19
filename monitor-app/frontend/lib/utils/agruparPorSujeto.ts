import type { PendingComplianceRow } from '@/lib/types'

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
 *  La comparten el cajón (`CarrierDrawer`, que sólo pide `estado='falta'`) y
 *  la ficha de empresa (que pide `estado='todos'`): agrupar por sujeto es EL
 *  MISMO problema en los dos, sólo cambia qué filas llegan. Antes vivía sólo
 *  dentro de `CarrierDrawer`; se extrajo acá al escribir la ficha para no
 *  tener una segunda copia del mismo agrupado — que es exactamente el defecto
 *  que este repo ya tuvo con el renglón de carga y con el cajón mismo. */
export function agruparPorSujeto(rows: PendingComplianceRow[]): Sujeto[] {
  const porClave = new Map<string, Sujeto>()
  for (const r of rows) {
    const clave = `${r.entity_type}:${r.entity_id}`
    if (!porClave.has(clave)) {
      porClave.set(clave, {
        clave,
        titulo: r.entity_type === 'CARRIER' ? 'De la empresa' : (r.subject_name ?? 'Sin nombre'),
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
