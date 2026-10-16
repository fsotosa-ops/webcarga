import type { PermissionCode } from '@/lib/authz/permisos.generated'
import { usePermiso } from '@/lib/authz/PermisosProvider'

/** El permiso que edita cada sección de Configuración: el mismo que exige su
 *  API. Una sola fuente para la pantalla (qué se deja editar, quién confirma
 *  "está bien así"); el backend declara el mismo en services/revisiones.py y
 *  test_revisiones.py falla si se separan. Sin esto, la pantalla ofrecía
 *  acciones que la API respondía con 403 (revisión final RBAC, hallazgo 3).
 *
 *  Vive aparte de dominios.ts porque las pestañas lo importan y dominios.ts
 *  importa las pestañas. */
export const PERMISO_DE_SECCION = {
  // Ya no es una sección de Configuración (Parte 2: Certificación › Documentos
  // exigidos), pero sigue siendo la clave de su revisión, igual que en el backend.
  'certification/conditions':        'certification.configure',
  'certification/expiry-alerts':     'certification.configure',
  'operations/tms-statuses':         'operations.configure',
  'operations/operational-statuses': 'operations.configure',
  'operations/equipment-statuses':   'operations.configure',
  'operations/alert-thresholds':     'operations.configure',
  'operations/temperature-ranges':   'operations.configure',
  'operations/driver-reasons':       'operations.configure',
  'operations/unassigned-reasons':   'operations.configure',
  'operations/void-reasons':         'operations.configure',
  'fleet/subtypes':                  'operations.configure',
  'fleet/operation-types':           'operations.configure',
  'insurance/expiry-alerts':         'insurance.configure',
  'people/users':                    'users.manage',
  'people/roles':                    'roles.manage',
} as const satisfies Record<string, PermissionCode>

/** Las secciones que ni siquiera se pueden LEER sin un permiso: la API no lista
 *  personas ni roles sin `users.manage`. Las demás se leen dentro de un área visible. */
export const LECTURA_DE_SECCION: Partial<Record<keyof typeof PERMISO_DE_SECCION, PermissionCode>> = {
  'people/users': 'users.manage',
  'people/roles': 'users.manage',
}

/** `area/section`: la misma sección corta (p. ej. `expiry-alerts`) existe en más de
 *  un área (Certificación y Seguros). */
export type ClaveDeSeccion = keyof typeof PERMISO_DE_SECCION

export function usePuedeEditarSeccion(seccion: ClaveDeSeccion): boolean {
  return usePermiso(PERMISO_DE_SECCION[seccion])
}
