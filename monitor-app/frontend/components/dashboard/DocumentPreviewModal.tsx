'use client'

import { useState } from 'react'
import { X, Download, Trash2, Loader2 } from 'lucide-react'

/** PDF/imagen se embeben directo (el navegador ya sabe renderizarlos sin
 *  librerías extra); Word/Excel no tienen visor nativo — se ofrece
 *  descarga en vez de un iframe roto. Decisión explícita del usuario
 *  2026-07-18: cubre "la gran mayoría" de los documentos reales de
 *  compliance (licencias, certificados, pólizas escaneadas). */
function previewKind(url: string): 'pdf' | 'image' | 'none' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'].includes(ext)) return 'image'
  return 'none'
}

/** El storage_path real es `{stamp}_{nombre_original}` (ver
 *  upload_document_version) — se limpia el prefijo de fecha para que la
 *  descarga tenga un nombre legible en vez del timestamp interno. */
function downloadName(url: string): string {
  const basename = decodeURIComponent(url.split('?')[0].split('/').pop() ?? 'archivo')
  return basename.replace(/^\d{8}T\d{6,}_?/, '') || basename
}

/** Descarga forzada real (no solo abrir en pestaña nueva) — se trae el
 *  blob primero porque el atributo `download` de <a> no funciona
 *  cross-origin contra una signed URL de Supabase Storage. */
async function triggerDownload(url: string) {
  const res = await fetch(url)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = downloadName(url)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

interface Props {
  label:      string
  url:        string
  canEdit:    boolean
  onClose:    () => void
  /** Si se pasa, habilita el botón Eliminar (con confirmación inline). */
  onDelete?:  () => Promise<void>
}

/** Modal compartido de preview/descarga/borrado de un documento — mismo
 *  componente para Empresas (TransporterDocumentsPanel), Conductores/
 *  Vehículos (DocumentChecklist) y Seguros (PolicyFileRow), pedido
 *  explícito del usuario 2026-07-18 de unificar la experiencia. */
export function DocumentPreviewModal({ label, url, canEdit, onClose, onDelete }: Props) {
  const [downloading, setDownloading]     = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const kind = previewKind(url)

  async function handleDownload() {
    setDownloading(true); setError(null)
    try {
      await triggerDownload(url)
    } catch {
      setError('No se pudo descargar el archivo')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setDeleting(true); setError(null)
    try {
      await onDelete()
      onClose()
    } catch {
      setError('No se pudo eliminar el archivo')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold text-text-primary truncate pr-2">{label}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button" onClick={handleDownload} disabled={downloading} title="Descargar"
              aria-label={`Descargar ${label}`}
              className="p-1.5 rounded-lg text-gray-400 hover:text-accent hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            </button>
            {canEdit && onDelete && (
              confirmDelete ? (
                <span className="flex items-center gap-1.5 pl-1">
                  <span className="text-[11px] text-red-500">¿Eliminar?</span>
                  <button
                    type="button" onClick={handleDelete} disabled={deleting}
                    className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50"
                  >
                    {deleting ? 'Eliminando…' : 'Sí'}
                  </button>
                  <button
                    type="button" onClick={() => setConfirmDelete(false)}
                    className="text-[11px] text-gray-400 hover:underline"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button" onClick={() => setConfirmDelete(true)} title="Eliminar"
                  aria-label={`Eliminar ${label}`}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )
            )}
            <button
              type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar"
              className="p-1.5 rounded-lg text-gray-400 hover:text-text-primary hover:bg-gray-50 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {error && <p className="text-[11px] text-red-500 px-4 pt-2">{error}</p>}

        <div className="flex-1 min-h-0 bg-gray-50 flex items-center justify-center overflow-auto">
          {kind === 'pdf' && <iframe src={url} title={label} className="w-full h-full" />}
          {kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
          )}
          {kind === 'none' && (
            <div className="text-center p-6">
              <p className="text-sm text-gray-400 mb-3">Vista previa no disponible para este tipo de archivo.</p>
              <button
                type="button" onClick={handleDownload} disabled={downloading}
                className="text-sm font-semibold text-accent hover:underline disabled:opacity-50"
              >
                {downloading ? 'Descargando…' : 'Descargar para verlo'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
