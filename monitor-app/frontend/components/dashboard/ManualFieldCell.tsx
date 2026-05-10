'use client'

import { useState, useTransition } from 'react'
import { createGoldClient } from '@/lib/supabase/client'
import type { Database, DiarioManualFields } from '@/lib/types'

type GoldInsert = Database['gold']['Tables']['diario_manual_fields']['Insert']

type BoolField = keyof Pick<DiarioManualFields,
  'activo' | 'trabajando' | 'asignado' | 'sosafe' |
  'vacaciones' | 'asistencia_sabado_domingo' | 'disponible_domingo' | 'turno_manana'
>

type TextField = keyof Pick<DiarioManualFields, 'telefono' | 'observaciones' | 'comentarios' | 'pendientes_am'>

interface ToggleCellProps {
  fecha: string
  dniDriver: string
  field: BoolField
  value: boolean
  userId: string
}

export function ToggleCell({ fecha, dniDriver, field, value, userId }: ToggleCellProps) {
  const [current, setCurrent] = useState(value)
  const [, startTransition] = useTransition()
  const supabase = createGoldClient()

  function toggle() {
    const next = !current
    setCurrent(next)
    startTransition(async () => {
      await supabase
        .from('diario_manual_fields')
        .upsert(
          { fecha, dni_driver: dniDriver, [field]: next, updated_by: userId } as GoldInsert,
          { onConflict: 'fecha,dni_driver' }
        )
        .select()
    })
  }

  return (
    <button
      onClick={toggle}
      className={`w-8 h-5 rounded-full transition-colors relative ${
        current ? 'bg-accent' : 'bg-gray-200'
      }`}
      title={field}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          current ? 'left-3.5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

interface TextCellProps {
  fecha: string
  dniDriver: string
  field: TextField
  value: string | null
  userId: string
}

export function TextCell({ fecha, dniDriver, field, value, userId }: TextCellProps) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(value ?? '')
  const supabase = createGoldClient()

  async function save() {
    setEditing(false)
    await supabase
      .from('diario_manual_fields')
      .upsert(
        { fecha, dni_driver: dniDriver, [field]: current || null, updated_by: userId } as GoldInsert,
        { onConflict: 'fecha,dni_driver' }
      )
      .select()
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={current}
        onChange={e => setCurrent(e.target.value)}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && save()}
        className="w-full px-1 py-0.5 text-xs border border-accent rounded focus:outline-none"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left text-xs text-gray-600 hover:text-text-primary hover:bg-gray-50 px-1 py-0.5 rounded min-h-[1.5rem] truncate"
      title={current || 'Click para editar'}
    >
      {current || <span className="text-gray-300">—</span>}
    </button>
  )
}
