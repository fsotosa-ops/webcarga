'use client'

import type { KeyboardEvent } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { resumenDeVigencia, vigenciaDe } from '@/lib/vigencia'
import type { PendingGroupBy, PendingSummaryRow } from '@/lib/types'

/** La columna izquierda de Pendientes: los documentos (o las empresas) con lo
 *  que se debe de cada uno. Es una lista de selección (listbox): ↑ ↓ cambian
 *  la elegida, como una bandeja de correo. */
export function PendingSummaryList({ rows, groupBy, selectedKey, onSelect }: {
  rows: PendingSummaryRow[]
  groupBy: PendingGroupBy
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rows.findIndex(r => r.key === selectedKey)
    const j = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)
    if (rows[j] && j !== i) onSelect(rows[j].key)
  }

  const optionId = (key: string) => `pending-option-${key}`

  return (
    <ul role="listbox" aria-label={groupBy === 'requirement' ? 'Documentos' : 'Empresas'} tabIndex={0}
        aria-activedescendant={selectedKey ? optionId(selectedKey) : undefined}
        onKeyDown={onKeyDown}
        className="divide-y divide-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
      {rows.map(r => {
        const on = r.key === selectedKey
        const regla = r.expiration_policy
          ? resumenDeVigencia(vigenciaDe({ expiration_policy: r.expiration_policy, vigencia: r.vigencia }))
          : null
        return (
          <li key={r.key} id={optionId(r.key)} role="option" aria-selected={on} onClick={() => onSelect(r.key)}
              className={`flex cursor-pointer items-center gap-1.5 px-3 py-2.5 transition-colors ${
                on ? 'bg-accion/5 shadow-[inset_3px_0_0_var(--accion)]' : 'hover:bg-bg-main'}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-dato text-text-primary">{r.label}</span>
              {regla && <span className="block truncate text-etiqueta text-informativo">{regla}</span>}
            </span>
            <span className="flex shrink-0 gap-1 tabular-nums"
                  aria-label={`${r.overdue} vencidos, ${r.expiring} por vencer, ${r.missing} faltan`}>
              <StatusChip tone="urgent">{r.overdue}</StatusChip>
              <StatusChip tone="warning">{r.expiring}</StatusChip>
              <StatusChip tone="neutral">{r.missing}</StatusChip>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
