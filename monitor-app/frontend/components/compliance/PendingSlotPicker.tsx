'use client'

import { ENTITY_TYPE } from '@/lib/states'
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
      <p className="text-etiqueta font-semibold text-text-primary">
        {rows.length === 1 ? 'Le falta 1 documento' : `Le faltan ${rows.length} documentos`}
      </p>

      <div className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-2">
        {(['CARRIER', 'DRIVER', 'ASSET'] as const).map(tipo => {
          const items = porTipo.get(tipo)
          if (!items?.length) return null
          const Icono = ENTITY_TYPE[tipo].icon

          return (
            <div key={tipo}>
              <p className="flex items-center gap-1.5 text-etiqueta text-informativo mb-1">
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
                          subject_label:  r.subject_name ?? r.carrier_name ?? 'Sin empresa',
                          requirement_id: r.requirement_id,
                          record_id:      r.id,
                          document_name:  r.document_name,
                        })}
                        aria-pressed={activo}
                        className={`w-full text-left rounded-md px-2 py-1.5 text-etiqueta transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                          activo
                            ? 'bg-accent text-white font-semibold'
                            : 'bg-bg-main hover:bg-bg-main text-text-primary'
                        }`}
                      >
                        <span className="block truncate">{r.document_name}</span>
                        {r.subject_name && tipo !== 'CARRIER' && (
                          <span className={`block truncate text-etiqueta ${activo ? 'text-white/80' : 'text-informativo'}`}>
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
