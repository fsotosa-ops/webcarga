'use client'

import { useState } from 'react'
import { Check, PenLine, X } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { ApiError } from '@/lib/api/client'
import type { ManagementType } from '@/lib/types'

const GESTIONES: { codigo: ManagementType; label: string }[] = [
  { codigo: 'TRACTOREO',       label: 'Tractoreo' },
  { codigo: 'EQUIPO_COMPLETO', label: 'Equipo Completo' },
]

interface Props {
  carrierId: string
  /** Lo declarado hoy. Null o vacío = nadie lo eligió nunca. */
  declarado: ManagementType[] | null
  canEdit: boolean
  onGuardado: () => Promise<void> | void
}

/**
 * El tipo de gestión que la empresa DECLARA, editable después del alta.
 *
 * POR QUÉ EXISTE. Otra capacidad sin puerta: la columna existe, el `PATCH` la
 * acepta (`carriers.py`, `management_types = COALESCE($5, management_types)`),
 * pero el cliente HTTP no la exponía y lo único que la escribía era el panel de
 * alta. Resultado medido el 27/08: **0 de 248 empresas** lo tienen cargado. Es
 * el punto 8 de la sección 4 de la minuta del 25/08.
 *
 * Y no es decorativo: los requisitos de Certificación se filtran por
 * `applies_to_management_types`, así que con la columna vacía esas reglas no le
 * aplican a nadie.
 *
 * **No confundir con el chip de al lado.** Ese muestra
 * `carrier_operation_types`, que se DERIVA de los vehículos de la flota
 * (`assets.webcarga_operation_type_id`) y es de sólo lectura porque se edita en
 * cada vehículo. Éste es lo que la empresa dice de sí misma, y sirve sobre todo
 * mientras todavía no registró flota. Son dos datos hermanos: la flota manda
 * cuando existe.
 *
 * Dos marcas independientes y no un desplegable de tres: marcar las dos **es**
 * el caso mixto.
 */
export function GestionDeclarada({ carrierId, declarado, canEdit, onGuardado }: Props) {
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState<ManagementType[]>(declarado ?? [])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El botón que ABRE la edición resetea el borrador desde la prop. Sin esto,
  // el `useState` inicial se queda con lo que había la primera vez que se
  // montó y edita un valor viejo — la clase de bug que ya apareció tres veces
  // en este frontend.
  function abrir() {
    setBorrador(declarado ?? [])
    setError(null)
    setEditando(true)
  }

  function alternar(codigo: ManagementType) {
    setBorrador(v => (v.includes(codigo) ? v.filter(x => x !== codigo) : [...v, codigo]))
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await carriersApi.patch(carrierId, { management_types: borrador })
      await onGuardado()
      setEditando(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar el tipo de gestión')
    } finally {
      setGuardando(false)
    }
  }

  if (!editando) {
    const etiqueta = declarado?.length
      ? declarado.map(t => GESTIONES.find(g => g.codigo === t)?.label ?? t).join(' + ')
      : 'Gestión sin declarar'
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`text-etiqueta px-2 py-0.5 rounded-full ${
          declarado?.length ? 'bg-accent/10 text-accent font-semibold' : 'bg-accent/5 text-informativo font-medium'
        }`}>
          {etiqueta}
        </span>
        {canEdit && (
          <button type="button" onClick={abrir}
                  aria-label="Editar el tipo de gestión"
                  className="text-informativo hover:text-accent">
            <PenLine size={11} />
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-2 py-0.5">
      {GESTIONES.map(({ codigo, label }) => (
        <label key={codigo} className="flex items-center gap-1 text-etiqueta text-text-primary cursor-pointer">
          <input type="checkbox" aria-label={label} checked={borrador.includes(codigo)}
                 onChange={() => alternar(codigo)} className="accent-accent cursor-pointer" />
          {label}
        </label>
      ))}
      <button type="button" onClick={guardar} disabled={guardando}
              aria-label="Guardar el tipo de gestión"
              className="text-accent hover:opacity-80 disabled:opacity-40">
        <Check size={12} />
      </button>
      <button type="button" onClick={() => setEditando(false)} disabled={guardando}
              aria-label="Cancelar" className="text-informativo hover:text-text-primary disabled:opacity-40">
        <X size={12} />
      </button>
      {error && <span className="text-etiqueta text-status-incidente">{error}</span>}
    </span>
  )
}
