'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Upload as UploadIcon, Loader2 } from 'lucide-react'
import { useCentralizerUploads } from '@/hooks/useCentralizerUploads'
import { useCanEdit } from '@/hooks/useCanEdit'
import { CentralizerUploadModal } from '@/components/dashboard/CentralizerUploadModal'
import type { CentralizerUploadStatus } from '@/lib/types'

const STATUS_LABELS: Record<CentralizerUploadStatus, string> = {
  parsed: 'Procesando', previewed: 'Pendiente de revisión', approved: 'Aprobado, pendiente de aplicar',
  applied: 'Aplicado', rejected: 'Rechazado', failed: 'Falló el parseo',
}

const STATUS_STYLES: Record<CentralizerUploadStatus, string> = {
  parsed: 'bg-gray-50 text-gray-500 border-gray-200',
  previewed: 'bg-amber-50 text-amber-700 border-amber-100',
  approved: 'bg-blue-50 text-blue-700 border-blue-100',
  applied: 'bg-green-50 text-green-700 border-green-100',
  rejected: 'bg-red-50 text-red-700 border-red-100',
  failed: 'bg-red-50 text-red-700 border-red-100',
}

export default function UploadsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const canEdit = useCanEdit()
  const { data, isLoading } = useCentralizerUploads({ limit: 50 })
  const uploads = data?.data ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-slate-800">Historial de Uploads</h1>
        {canEdit && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-accent/90 transition-colors"
          >
            <UploadIcon size={14} />
            Subir Excel EETT
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-300" size={24} /></div>
      ) : uploads.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-12">Todavía no se ha subido ningún archivo.</p>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-[10px] font-bold text-slate-300 uppercase tracking-wide">
                <th className="px-4 py-2 text-left">Archivo</th>
                <th className="px-4 py-2 text-left">Subido por</th>
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {uploads.map(u => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/uploads/${u.id}`} className="text-accent font-semibold hover:underline">
                      {u.file_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.uploaded_by_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(u.uploaded_at).toLocaleString('es-CL')}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${STATUS_STYLES[u.status]}`}>
                      {STATUS_LABELS[u.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CentralizerUploadModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
