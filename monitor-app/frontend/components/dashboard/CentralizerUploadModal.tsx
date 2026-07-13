'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { centralizerUploadsApi, type CentralizerUploadPreview } from '@/lib/api/centralizerUploads'
import { ApiError } from '@/lib/api/client'

interface Props {
  open:    boolean
  onClose: () => void
}

type Step = 'upload' | 'summary'

export function CentralizerUploadModal({ open, onClose }: Props) {
  const router = useRouter()
  const [step, setStep]             = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [fileErr, setFileErr]       = useState<string | null>(null)
  const [result, setResult]         = useState<CentralizerUploadPreview | null>(null)
  const fileRef  = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setStep('upload'); setResult(null); setUploading(false)
    setIsDragging(false); setFileErr(null)
  }, [])

  const handleClose = useCallback(() => { reset(); onClose() }, [reset, onClose])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, handleClose])

  async function processFile(file: File) {
    setFileErr(null)
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFileErr(`"${file.name}" no es un Excel (.xlsx)`)
      return
    }
    setUploading(true)
    try {
      const res = await centralizerUploadsApi.upload(file)
      setResult(res)
      setStep('summary')
    } catch (e) {
      const detail = e instanceof ApiError ? e.detail : null
      const message = detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : e instanceof Error ? e.message : 'Error al subir el archivo'
      setFileErr(message)
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function goToDetail() {
    if (!result) return
    router.push(`/dashboard/uploads/${result.upload_id}`)
    handleClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-backdrop-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Subir Excel EETT"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] focus:outline-none animate-modal-in"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-base text-slate-800">Subir Excel EETT</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'upload'  && 'Sube el archivo con las hojas Empresas, Conductores y Vehiculos_Equipos'}
              {step === 'summary' && 'Archivo subido — revisa el resumen'}
            </p>
          </div>
          <button onClick={handleClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-6">
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                role="button"
                tabIndex={0}
                aria-label="Subir archivo Excel"
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => !uploading && fileRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  isDragging ? 'border-accent bg-accent/5 scale-[1.01]' : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50/60'
                }`}
              >
                {uploading
                  ? <Loader2 size={32} className="mx-auto mb-3 animate-spin text-accent" />
                  : <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-accent' : 'text-gray-300'}`} />}
                <p className="text-sm font-semibold text-gray-600">
                  {uploading ? 'Subiendo y calculando diff...' : 'Arrastra tu Excel aquí'}
                </p>
                {!uploading && <p className="text-xs text-gray-400 mt-1">o haz clic para seleccionar</p>}
              </div>
              <input
                ref={fileRef} type="file" accept=".xlsx" className="hidden"
                onChange={onFileChange} aria-label="Archivo Excel" disabled={uploading}
              />

              {fileErr && (
                <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <XCircle size={13} className="shrink-0 mt-0.5" />
                  {fileErr}
                </p>
              )}
            </div>
          )}

          {step === 'summary' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                <CheckCircle2 size={16} className="shrink-0" />
                <p className="text-sm font-semibold">Archivo procesado</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.sheet_summary).map(([sheet, count]) => (
                  <span key={sheet} className="text-xs px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600">
                    {sheet}: {count}
                  </span>
                ))}
              </div>
              {result.parse_errors.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {result.parse_errors.length} fila{result.parse_errors.length !== 1 ? 's' : ''} con error de parseo — se puede ver el detalle en la página del upload
                </p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3">
          {step === 'upload' && (
            <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          )}
          {step === 'summary' && (
            <button onClick={goToDetail} className="flex-1 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 transition-colors">
              Ver diff completo
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
