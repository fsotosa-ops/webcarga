'use client'

import { LayoutGrid, List } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

export type ViewMode = 'tabla' | 'tablero'

interface Props {
  value:    ViewMode
  onChange: (v: ViewMode) => void
  /** Etiquetas del toggle — default es el vocabulario del Diario (Tablero/Tabla).
   *  Otros módulos (ej. Empresas) pueden pasar sus propias etiquetas (Tarjetas/Tabla)
   *  sin acoplarse al copy del Diario. */
  labels?: { tablero: string; tabla: string }
}

const DEFAULT_LABELS = { tablero: 'Tablero', tabla: 'Tabla' }

/** Cómo se dibuja la lista: el control segmentado del kit (15/10), para que lo
 *  elegido no se confunda con la acción principal de la página. */
export function ViewToggle({ value, onChange, labels = DEFAULT_LABELS }: Props) {
  return (
    <SegmentedControl
      label="Vista"
      options={[
        { id: 'tablero', label: labels.tablero, Icon: LayoutGrid },
        { id: 'tabla',   label: labels.tabla,   Icon: List },
      ]}
      value={value}
      onChange={onChange}
    />
  )
}
