'use client'

import { useRef } from 'react'
import { Upload } from 'lucide-react'
import type { PendingComplianceRow } from '@/lib/types'
import { expiryRelative, formatExpiry } from '@/lib/compliance'

interface Props {
  rows:              PendingComplianceRow[]
  selected:          Set<string>
  onToggle:          (id: string) => void
  onToggleAll:       () => void
  /** Camino rápido 1-a-1 — el botón de la fila abre el selector nativo y
   *  sube directo, mismo patrón que DocumentChecklist.tsx. */
  onUploadSingle:    (recordId: string, file: File) => void
  /** Habilitado solo si toda la selección es de UNA sola empresa (regla de
   *  negocio del diseño validado en Figma). */
  onOpenBulkUpload:  () => void
  /** Abre el panel de documentos de esa empresa (Ronda 89) — clic en el
   *  nombre de la fila, coexiste con el checkbox de selección múltiple. */
  onOpenCompanyPanel: (carrierId: string) => void
}

/** Sábana de documentos pendientes — cruza toda la flota en una sola tabla,
 *  en vez de navegar empresa por empresa → conductor por conductor → tracto
 *  por tracto (módulo Documentos, HU §4.7 de la minuta 2026-07-29). No
 *  extiende TripTable.tsx (esa está acoplada a polling/sort que acá no
 *  hace falta) — tabla nueva, simple, orden ya viene resuelto del backend
 *  (empresa → categoría → sujeto). */
export function PendingDocumentsTable({ rows, selected, onToggle, onToggleAll, onUploadSingle, onOpenBulkUpload, onOpenCompanyPanel }: Props) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const selectedRows = rows.filter(r => selected.has(r.id))
  const distinctCarriers = new Set(selectedRows.map(r => r.carrier_id))
  const canBulkUpload = selectedRows.length > 0 && distinctCarriers.size === 1
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  function handleFileChange(recordId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUploadSingle(recordId, file)
    e.target.value = ''
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/5 border-b border-border flex-wrap">
          <p className="text-xs font-semibold text-slate-700">
            {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
          </p>
          {distinctCarriers.size > 1 && (
            <p className="text-[11px] text-amber-600">
              La carga masiva solo puede ser de una empresa a la vez
            </p>
          )}
          <button
            type="button"
            onClick={onOpenBulkUpload}
            disabled={!canBulkUpload}
            className="ml-auto text-xs font-semibold bg-accent text-white rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
          >
            Subir masivo
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[820px]">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th className="px-3 py-2.5 text-left w-8">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todo"
                  checked={allSelected}
                  onChange={onToggleAll}
                />
              </th>
              <th className="px-3 py-2.5 text-left">EETT</th>
              <th className="px-3 py-2.5 text-left">Tipo certificación</th>
              <th className="px-3 py-2.5 text-left">Categoría</th>
              <th className="px-3 py-2.5 text-left">Sub categoría</th>
              <th className="px-3 py-2.5 text-left">Tipo de documento</th>
              <th className="px-3 py-2.5 text-left">Vencimiento</th>
              <th className="px-3 py-2.5 text-left w-16">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-300 italic">
                  Sin documentos pendientes
                </td>
              </tr>
            )}
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${r.document_name} de ${r.subject_name ?? r.carrier_name}`}
                    checked={selected.has(r.id)}
                    onChange={() => onToggle(r.id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpenCompanyPanel(r.carrier_id)}
                    className="font-semibold text-text-primary hover:text-accent hover:underline whitespace-nowrap transition-colors"
                  >
                    {r.carrier_name}
                  </button>
                  {r.carrier_operation_types.length > 0 && (
                    <div className="flex gap-1 mt-0.5">
                      {r.carrier_operation_types.map(t => (
                        <span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.certification_type}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.category}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.subject_name ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.document_name}</td>
                {/* El campo ya venia en el payload de /pending y no se
                    renderizaba: sin el no hay forma de ver que esta por vencer. */}
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.expiration_date ? (
                    <span className="flex flex-col leading-tight">
                      <span>{formatExpiry(r.expiration_date)}</span>
                      <span className="text-[9px] text-gray-400">
                        {expiryRelative(r.expiration_date, false)}
                      </span>
                    </span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    aria-label={`Subir ${r.document_name}`}
                    onClick={() => fileInputRefs.current[r.id]?.click()}
                    className="p-1.5 rounded-lg border border-border text-accent hover:bg-accent/5 transition-colors"
                  >
                    <Upload size={13} />
                  </button>
                  <input
                    ref={el => { fileInputRefs.current[r.id] = el }}
                    type="file"
                    className="hidden"
                    aria-label={`Archivo para ${r.document_name}`}
                    onChange={e => handleFileChange(r.id, e)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
