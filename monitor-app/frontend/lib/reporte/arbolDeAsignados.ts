import type { AssignedRow } from '@/lib/types'
import { sumar } from './sumar'

export type Cifras = Pick<AssignedRow, 'rm' | 'z0' | 'region' | 'unclassified' | 'total'>

/** Las columnas de zona, en el orden del CSV de Pablo. */
export const COLUMNAS_DE_ZONA = [
  { clave: 'rm', etiqueta: 'RM' },
  { clave: 'z0', etiqueta: 'Z0' },
  { clave: 'region', etiqueta: 'Región' },
  { clave: 'unclassified', etiqueta: 'Sin clasificar' },
  { clave: 'total', etiqueta: 'Total' },
] as const satisfies readonly { clave: keyof Cifras; etiqueta: string }[]

type NodoEmpresa = { carrier_name: string; cifras: Cifras }
type NodoOrigen = { clave: string; origin: string; cifras: Cifras; empresas: NodoEmpresa[] }
type NodoCliente = { clave: string; client_name: string; cifras: Cifras; origenes: NodoOrigen[] }
export type ArbolDeAsignados = { clientes: NodoCliente[]; total: Cifras }

export type FilaDelArbol = { nivel: 0 | 1 | 2; clave: string; etiqueta: string; cifras: Cifras; plegable: boolean }

function cifrasDe(filas: AssignedRow[]): Cifras {
  return {
    rm: sumar(filas, f => f.rm), z0: sumar(filas, f => f.z0), region: sumar(filas, f => f.region),
    unclassified: sumar(filas, f => f.unclassified), total: sumar(filas, f => f.total),
  }
}

/** Agrupa conservando el orden de llegada: la API ya manda las filas ordenadas. */
function agrupar(filas: AssignedRow[], clave: (f: AssignedRow) => string): [string, AssignedRow[]][] {
  const grupos = new Map<string, AssignedRow[]>()
  for (const f of filas) grupos.set(clave(f), [...(grupos.get(clave(f)) ?? []), f])
  return [...grupos]
}

/** Cliente → Origen del viaje → Empresa, con subtotales: la tabla dinámica que
 *  describió Pablo. Una sola definición para la pantalla y el Excel, así los dos
 *  dan los mismos números. */
export function arbolDeAsignados(rows: AssignedRow[]): ArbolDeAsignados {
  const clientes = agrupar(rows, r => r.client_name).map(([cliente, delCliente]) => ({
    clave: cliente,
    client_name: cliente,
    cifras: cifrasDe(delCliente),
    origenes: agrupar(delCliente, r => r.origin).map(([origen, delOrigen]) => ({
      // El mismo origen bajo dos clientes son dos nodos: la clave lleva al cliente.
      clave: `${cliente}\u0000${origen}`,
      origin: origen,
      cifras: cifrasDe(delOrigen),
      empresas: delOrigen.map(f => ({ carrier_name: f.carrier_name, cifras: cifrasDe([f]) })),
    })),
  }))
  return { clientes, total: cifrasDe(rows) }
}

/** Las filas en orden de lectura. `estaAbierto` dice si un cliente (nivel 0) o un
 *  origen (nivel 1) muestra su detalle; sin él, todo abierto. */
export function filasDelArbol(
  arbol: ArbolDeAsignados, estaAbierto: (clave: string, nivel: 0 | 1) => boolean = () => true,
): FilaDelArbol[] {
  const filas: FilaDelArbol[] = []
  for (const c of arbol.clientes) {
    filas.push({ nivel: 0, clave: c.clave, etiqueta: c.client_name, cifras: c.cifras, plegable: true })
    if (!estaAbierto(c.clave, 0)) continue
    for (const o of c.origenes) {
      filas.push({ nivel: 1, clave: o.clave, etiqueta: o.origin, cifras: o.cifras, plegable: true })
      if (!estaAbierto(o.clave, 1)) continue
      for (const e of o.empresas) {
        filas.push({ nivel: 2, clave: `${o.clave}\u0000${e.carrier_name}`, etiqueta: e.carrier_name,
                     cifras: e.cifras, plegable: false })
      }
    }
  }
  return filas
}
