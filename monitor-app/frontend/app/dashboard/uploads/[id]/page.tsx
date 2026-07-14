'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, XCircle } from 'lucide-react'
import {
  useCentralizerUpload, useApproveCentralizerUpload,
  useRejectCentralizerUpload, useApplyCentralizerUpload,
  useComplianceDocCatalog, useResolveColumnMappings,
} from '@/hooks/useCentralizerUploads'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { UploadDiffView } from '@/components/dashboard/UploadDiffView'
import { ColumnMappingResolver } from '@/components/dashboard/ColumnMappingResolver'

export default function UploadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const canAdmin = useCanAdmin()
  const { data, isLoading, error } = useCentralizerUpload(id)
  const approve = useApproveCentralizerUpload(id)
  const reject  = useRejectCentralizerUpload(id)
  const apply   = useApplyCentralizerUpload(id)
  const docCatalog = useComplianceDocCatalog()
  const resolveMappings = useResolveColumnMappings(id)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason]       = useState('')

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
  if (error || !data) return <p className="p-6 text-sm text-red-600">No se pudo cargar el upload.</p>

  const upload = data.data
  const busy = approve.isPending || reject.isPending || apply.isPending

  async function confirmReject() {
    await reject.mutateAsync(reason || undefined)
    setRejecting(false); setReason('')
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/dashboard/uploads" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-4">
        <ArrowLeft size={13} /> Volver al historial
      </Link>

      <div className="mb-6">
        <h1 className="text-lg font-bold text-slate-800">{upload.file_name}</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Subido por {upload.uploaded_by_name ?? '—'} · {new Date(upload.uploaded_at).toLocaleString('es-CL')} · estado: {upload.status}
        </p>
        {upload.rejection_reason && (
          <p className="text-xs text-red-600 mt-1">Motivo de rechazo: {upload.rejection_reason}</p>
        )}
      </div>

      {upload.status === 'failed' ? (
        <p className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <XCircle size={16} className="shrink-0 mt-0.5" />
          {upload.parse_errors[0]?.reason ?? 'Error al parsear el archivo.'}
        </p>
      ) : upload.status === 'pending_mapping' ? (
        canAdmin ? (
          <ColumnMappingResolver
            unresolvedColumns={upload.unresolved_columns ?? []}
            catalog={docCatalog.data?.data ?? []}
            submitting={resolveMappings.isPending}
            onSubmit={resolutions => resolveMappings.mutate(resolutions)}
          />
        ) : (
          <p className="text-sm text-gray-500 bg-gray-50 border border-border rounded-lg px-4 py-3">
            Este archivo tiene columnas nuevas que un admin debe resolver antes de continuar.
          </p>
        )
      ) : upload.diff ? (
        <UploadDiffView diff={upload.diff} />
      ) : null}

      {canAdmin && (upload.status === 'previewed' || upload.status === 'approved') && (
        <div className="sticky bottom-0 mt-6 border-t border-border bg-white py-4 flex flex-col gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] rounded-t-xl">
          {rejecting ? (
            <div className="flex items-center gap-3">
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Motivo del rechazo (opcional)"
                className="flex-1 text-sm border border-border rounded-lg px-3 py-2"
              />
              <button onClick={() => setRejecting(false)} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={confirmReject}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-40"
              >
                Confirmar rechazo
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40"
              >
                Rechazar
              </button>
              {upload.status === 'previewed' && (
                <button
                  onClick={() => approve.mutate()}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-40"
                >
                  {approve.isPending ? 'Aprobando...' : 'Aprobar'}
                </button>
              )}
              {upload.status === 'approved' && (
                <button
                  onClick={() => apply.mutate()}
                  disabled={busy}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-40"
                >
                  {apply.isPending ? 'Aplicando...' : 'Aplicar'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
