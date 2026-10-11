import { useCallback, useMemo, useState } from 'react'
import type { EntityKind } from '@/lib/api/entitySummary'

/** Qué entidad muestra la vista rápida. `label` es lo que ya se ve en la fila
 *  (nombre o patente): el encabezado se dibuja con eso mientras carga. */
export type QuickViewTarget = { kind: EntityKind; id: string; label: string }

/** La vista rápida es UN panel: abrir desde una fila empieza de cero; un nombre
 *  dentro del panel apila esa entidad, y "Volver" la saca (HU 20261011/01). */
export function useQuickView() {
  const [stack, setStack] = useState<QuickViewTarget[]>([])
  const open = useCallback((target: QuickViewTarget) => setStack([target]), [])
  const navigate = useCallback((target: QuickViewTarget) => setStack(s => [...s, target]), [])
  const back = useCallback(() => setStack(s => s.slice(0, -1)), [])
  const close = useCallback(() => setStack([]), [])
  return useMemo(() => ({
    current: stack.at(-1) ?? null,
    canGoBack: stack.length > 1,
    open, navigate, back, close,
  }), [stack, open, navigate, back, close])
}
