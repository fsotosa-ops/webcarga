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
  'conditions':           'certification.configure',
  // Reglas de vencimiento de documentos: Certificación (spec RBAC §4).
  'expiry-alerts':        'certification.configure',
  'tms-statuses':         'operations.configure',
  'operational-statuses': 'operations.configure',
  'equipment-statuses':   'operations.configure',
  'alert-thresholds':     'operations.configure',
  'temperature-ranges':   'operations.configure',
  'driver-reasons':       'operations.configure',
  'unassigned-reasons':   'operations.configure',
  // Un origen es una ubicación marcada como origen: PATCH /locations.
  'origins':              'commercial.edit',
  'subtypes':             'operations.configure',
  'operation-types':      'operations.configure',
  'users':                'users.manage',
  'roles':                'roles.manage',
} as const satisfies Record<string, PermissionCode>

export type ClaveDeSeccion = keyof typeof PERMISO_DE_SECCION

export function usePuedeEditarSeccion(seccion: ClaveDeSeccion): boolean {
  return usePermiso(PERMISO_DE_SECCION[seccion])
}
