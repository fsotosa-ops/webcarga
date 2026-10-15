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
