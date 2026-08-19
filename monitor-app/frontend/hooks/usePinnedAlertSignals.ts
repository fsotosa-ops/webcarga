'use client'

import { useEffect, useState } from 'react'
import type { AlertSignalId } from '@/lib/utils/alertSignals'

const STORAGE_KEY = 'diario:alertas-pineadas'
const DEFAULT_PINNED: AlertSignalId[] = ['dwell_severity', 'temp_out', 'stale', 'tms_dropped']

/** Qué señales quedan siempre visibles como tile fuera del popover "Alertas"
 *  — personalizable por usuario, persistido en localStorage. Mismo mecanismo
 *  que VIEW_MODE_STORAGE_KEY en page.tsx (sin backend, sin tabla de
 *  preferencias nueva). El preset de fábrica (2026-08-01: Detenido en local,
 *  Temp fuera de rango, Sin actualización del TMS — 'off_time'/'unassigned'
 *  fueron descartados como alertas) es el que ve cualquier usuario que
 *  nunca tocó el pin.
 *
 *  2026-08-18: se suma 'tms_dropped' ("Ya no está en el TMS"). Va fijada
 *  de fábrica a propósito — es una condición que hasta ahora no se veía en
 *  ninguna pantalla (Sodimac elimina viajes de su portal sin cambiar el
 *  estado), así que dejarla sólo dentro del popover la mantendría invisible.
 *  Volumen medido: 2-3 viajes por día, no es una tile ruidosa. */
export function usePinnedAlertSignals() {
  const [pinned, setPinned] = useState<AlertSignalId[]>(DEFAULT_PINNED)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) setPinned(parsed)
    } catch {
      // localStorage corrupto/editado a mano — se ignora, queda el default
    }
  }, [])

  function togglePin(id: AlertSignalId) {
    setPinned(prev => {
      const next = prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return { pinned, togglePin }
}
