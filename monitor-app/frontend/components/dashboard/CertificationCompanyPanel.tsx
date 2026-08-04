'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Upload, Loader2, ArrowRight } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { BulkDocumentUploadModal } from './BulkDocumentUploadModal'

interface Props {
  carrierId: string | null
  onClose:   () => void
}

/** Panel de documentos de una empresa — se abre al clickear una empresa en
 *  la sábana de Certificación (Ronda 89). Mismo patrón de dialog que
 *  TransporterSlideOver (Empresas), pero angosto en propósito: solo
 *  pendientes de compliance + acciones de carga — el resumen de
 *  contactos/seguros sigue siendo exclusivo del slide-over de Empresas. */
export function CertificationCompanyPanel({ carrierId, onClose }: Props) {
  const open = !!carrierId
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [bulkOpen, setBulkOpen] = useState(false)

  const query = useQuery({
    queryKey: ['compliance-pending-carrier-panel', carrierId],
    queryFn: () => complianceApi.listPending({ carrierId: carrierId!, limit: 200 }),
    enabled: !!carrierId,
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['compliance-pending-carrier-panel', carrierId] })
    queryClient.invalidateQueries({ queryKey: ['compliance-pending'] })
  }

  async function handleUploadSingle(recordId: string, file: File) {
    await complianceApi.uploadFile(recordId, file)
    invalidate()
  }

  function handleBulkSaved() {
    setBulkOpen(false)
    invalidate()
  }

  if (!open) return null

  const rows = query.data?.rows ?? []
  const carrierName = rows[0]?.carrier_name ?? ''
  const carrierTaxId = rows[0]?.carrier_tax_id ?? ''

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Documentos pendientes de ${carrierName || 'la empresa'}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-lg max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <p className="text-sm font-bold text-text-primary truncate">
                {query.isPending ? 'Cargando…' : (carrierName || 'Empresa')}
              </p>
              {carrierTaxId && <p className="text-[11px] text-gray-400 font-mono">{carrierTaxId}</p>}
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-3">
            {query.isPending && (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
            )}
            {query.error && (
              <p className="text-xs text-red-500">
                {query.error instanceof Error ? query.error.message : 'Error al cargar los documentos pendientes'}
              </p>
            )}
            {!query.isPending && !query.error && rows.length === 0 && (
              <p className="text-xs text-gray-400 italic">Sin documentos pendientes</p>
            )}
            {!query.isPending && !query.error && rows.map(r => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{r.document_name}</p>
                  <p className="text-[10px] text-gray-400">{r.subject_name ?? r.category}</p>
                </div>
                <label className="flex items-center gap-1 text-[11px] font-semibold text-accent border border-dashed border-accent/40 rounded-md px-2 py-1 hover:bg-accent/5 transition-colors cursor-pointer shrink-0">
                  <Upload size={11} /> Subir
                  <input
                    type="file"
                    className="hidden"
                    aria-label={`Subir ${r.document_name}`}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadSingle(r.id, f) }}
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-border px-5 py-4 space-y-2">
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              disabled={rows.length === 0}
              className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              Subir masivo
            </button>
            <Link
              href={`/dashboard/carriers/${carrierId}`}
              className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 hover:text-accent transition-colors py-1"
            >
              Ver ficha completa <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {bulkOpen && (
        <BulkDocumentUploadModal
          open
          carrierId={carrierId!}
          carrierName={carrierName}
          carrierTaxId={carrierTaxId}
          pendingSlots={rows}
          onClose={() => setBulkOpen(false)}
          onSaved={handleBulkSaved}
        />
      )}
    </>
  )
}
