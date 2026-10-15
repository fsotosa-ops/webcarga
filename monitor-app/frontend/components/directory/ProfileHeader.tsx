'use client'

import type { ReactNode } from 'react'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { StatusChip } from '@/components/ui/StatusChip'
import { ActionsMenu, type ActionsMenuItem } from '@/components/ui/ActionsMenu'
import type { StateStyle } from '@/lib/states'

/** El encabezado de una ficha del Directorio (Entrega 1 de fichas, 15/10): quién
 *  es, cómo está y, si no puede operar, por qué, en una línea. A la derecha la
 *  acción principal y el "⋯". Nada más: los pendientes viven en la sección
 *  Documentos (cada dato, una vez). Mientras no llega el resumen no se dibuja
 *  ningún chip: un estado en vuelo miente. */
export function ProfileHeader({ title, chips, reason, onSeeDocuments, primaryAction, menuItems }: {
  title: string
  /** `null` mientras carga el resumen. */
  chips: StateStyle[] | null
  reason: string | null
  onSeeDocuments: () => void
  primaryAction?: ReactNode
  menuItems: ActionsMenuItem[]
}) {
  return (
    <EncabezadoDePagina
      titulo={title}
      bajada={chips && (
        <span className="flex flex-wrap items-center gap-2">
          {chips.map(c => <StatusChip key={c.label} tone={c.tone} icon={c.icon}>{c.label}</StatusChip>)}
          {reason && (
            <span className="text-dato text-informativo">
              <span>{reason}</span> ·{' '}
              <button type="button" onClick={onSeeDocuments} className="font-medium text-accion hover:underline">
                Ver documentos
              </button>
            </span>
          )}
        </span>
      )}
    >
      {primaryAction}
      <ActionsMenu label="Más acciones" items={menuItems} />
    </EncabezadoDePagina>
  )
}
