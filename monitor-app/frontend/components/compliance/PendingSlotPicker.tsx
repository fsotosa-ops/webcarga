'use client'

import { Building2, Truck, User } from 'lucide-react'
import type { PendingComplianceRow } from '@/lib/types'

export type Slot = {
  entity_type:    'CARRIER' | 'DRIVER' | 'ASSET'
  entity_id:      string
  subject_label:  string
  /** El id, no el código: traducirlo después contra el catálogo era un paso
   *  frágil que había que repetir en cada consumidor. */
  requirement_id: string
  record_id:      string
  document_name:  string
}

interface Props {
  rows:     PendingComplianceRow[]
  selected: Slot | null
  onPick:   (slot: Slot) => void
}

const ICONO = {
  CARRIER: Building2,
  DRIVER:  User,
  ASSET:   Truck,
} as const

const GRUPO = {
  CARRIER: 'Empresa',
  DRIVER:  'Conductores',
  ASSET:   'Equipos',
} as const

/** Qué le falta a esta empresa, y el atajo para cubrirlo.
 *
 *  Antes el panel pedía "Sujeto" y "Tipo de documento" en dos desplegables
 *  genéricos: había que saber de memoria qué le faltaba a la empresa para
 *  elegir bien. El dato ya estaba cargado — se usaba sólo para armar el
 *  desplegable — pero nunca se mostraba. Acá se muestra, y clasificar pasa a
 *  ser elegir el hueco real en vez de describirlo. */
export function PendingSlotPicker({ rows, selected, onPick }: Props) {
  if (!rows.length) return null

  const porTipo = new Map<'CARRIER' | 'DRIVER' | 'ASSET', PendingComplianceRow[]>()
  for (const r of rows) {
    const t = r.entity_type as 'CARRIER' | 'DRIVER' | 'ASSET'
    porTipo.set(t, [...(porTipo.get(t) ?? []), r])
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-gray-600">
        {rows.length === 1 ? 'Le falta 1 documento' : `Le faltan ${rows.length} documentos`}
      </p>

      <div className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-2">
        {(['CARRIER', 'DRIVER', 'ASSET'] as const).map(tipo => {
          const items = porTipo.get(tipo)
          if (!items?.length) return null
          const Icono = ICONO[tipo]

          return (
            <div key={tipo}>
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                <Icono size={11} /> {GRUPO[tipo]}
              </p>
              <ul className="space-y-0.5">
                {items.map(r => {
                  const activo = selected?.record_id === r.id
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onPick({
                          entity_type:    r.entity_type as 'CARRIER' | 'DRIVER' | 'ASSET',
                          entity_id:      r.entity_id,
                          subject_label:  r.subject_name ?? r.carrier_name,
                          requirement_id: r.requirement_id,
                          record_id:      r.id,
                          document_name:  r.document_name,
                        })}
                        aria-pressed={activo}
                        className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                          activo
                            ? 'bg-accent text-white font-semibold'
                            : 'bg-gray-50 hover:bg-gray-100 text-slate-700'
                        }`}
                      >
                        <span className="block truncate">{r.document_name}</span>
                        {r.subject_name && tipo !== 'CARRIER' && (
                          <span className={`block truncate text-[10px] ${activo ? 'text-white/80' : 'text-gray-500'}`}>
                            {r.subject_name}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
