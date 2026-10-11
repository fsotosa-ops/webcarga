import type { OperationTypeKey } from '@/lib/types'

export type TipoDeOperacion = { clave: OperationTypeKey; etiqueta: string; corta: string }

/** Los dos cortes del reporte, en el orden del selector. `corta` es para los
 *  nombres de hoja del Excel, que no pueden pasar de 31 caracteres. */
export const TIPOS_DE_OPERACION: TipoDeOperacion[] = [
  { clave: 'tractoreo', etiqueta: 'Tractoreo', corta: 'Tractoreo' },
  { clave: 'equipo_completo', etiqueta: 'Equipo Completo', corta: 'Eq. Completo' },
]
