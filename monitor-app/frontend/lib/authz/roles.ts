import type { Acceso } from './acceso'
import { puedeOtorgar } from './acceso'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'

/** Las áreas con Operador y Supervisor (spec RBAC §4). El Supervisor incluye
 *  al Operador, así que por área se elige un nivel, no dos casillas. */
export const AREAS = [
  { clave: 'operations',    titulo: 'Operaciones'   },
  { clave: 'certification', titulo: 'Certificación' },
  { clave: 'insurance',     titulo: 'Seguros'       },
  { clave: 'commercial',    titulo: 'Comercial'     },
] as const
export type Area = (typeof AREAS)[number]['clave']
export type Nivel = 'none' | 'operator' | 'supervisor'

/** Roles de sistema que valen para toda la app, en el orden en que se muestran. */
export const ROLES_GENERALES = ['reader', 'admin', 'support', 'owner'] as const

export const TITULO_DE_AREA: Record<string, string> = {
  operations: 'Operaciones', directory: 'Directorio', certification: 'Certificación',
  insurance: 'Seguros', commercial: 'Comercial', reference: 'Referencia', admin: 'Administración',
}

export const codigoDe = (area: Area, nivel: Exclude<Nivel, 'none'>) => `${area}_${nivel}`

export function esRolDeArea(code: string): boolean {
  return AREAS.some(a => code === codigoDe(a.clave, 'operator') || code === codigoDe(a.clave, 'supervisor'))
}

export function nivelEnArea(codes: string[], area: Area): Nivel {
  if (codes.includes(codigoDe(area, 'supervisor'))) return 'supervisor'
  if (codes.includes(codigoDe(area, 'operator'))) return 'operator'
  return 'none'
}

export function conNivel(codes: string[], area: Area, nivel: Nivel): string[] {
  const resto = codes.filter(c => c !== codigoDe(area, 'operator') && c !== codigoDe(area, 'supervisor'))
  return nivel === 'none' ? resto : [...resto, codigoDe(area, nivel)]
}

/** Por qué quien edita no puede dar este rol, o null si puede. Misma regla que
 *  la API (assert_can_grant); el texto nombra lo que falta. */
export function motivoNoOtorgable(acceso: Acceso, rol: RoleInfo, catalogo: PermisoInfo[]): string | null {
  if (puedeOtorgar(acceso, rol)) return null
  if (rol.grants_all || rol.code === 'owner') return 'Solo un Propietario puede dar este rol'
  const tengo = new Set<string>(acceso.permissions)
  const faltan = rol.permissions.filter(p => !tengo.has(p))
    .map(p => catalogo.find(c => c.code === p)?.description ?? p)
  return `Incluye permisos que tú no tienes: ${faltan.slice(0, 2).join(' · ')}${faltan.length > 2 ? ` y ${faltan.length - 2} más` : ''}`
}

/** Los permisos efectivos de una combinación de roles. */
export function permisosDe(roles: RoleInfo[], codes: string[], catalogo: PermisoInfo[]): Set<string> {
  const out = new Set<string>()
  for (const r of roles.filter(r => codes.includes(r.code))) {
    for (const p of r.grants_all ? catalogo.map(c => c.code) : r.permissions) out.add(p)
  }
  return out
}

export function diferencia(antes: Set<string>, despues: Set<string>): { gana: string[]; pierde: string[] } {
  return {
    gana:   [...despues].filter(p => !antes.has(p)).sort(),
    pierde: [...antes].filter(p => !despues.has(p)).sort(),
  }
}
