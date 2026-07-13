'use client'

import { useRef, useState } from 'react'
import { Link2, Upload, FileText, RotateCcw, Loader2, Check, X } from 'lucide-react'
import { transportersApi } from '@/lib/api/transporters'
import type { ComplianceStatus, DocumentVersion, TransporterDocument } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { getAlertStatus, formatExpiry } from '@/lib/compliance'

const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] = [
  { value: 'ok',         label: 'OK' },
  { value: 'pendiente',  label: 'Pendiente' },
  { value: 'actualizar', label: 'Actualizar' },
  { value: 'n_a',        label: 'N/A' },
  { value: 'factible',   label: 'Factible' },
]

// ── Una fila por documento — mismo lenguaje visual que DocumentChecklist,
//    pero con más acciones (link/upload/versiones/revertir) porque estos
//    documentos sí tienen archivo y edición manual detrás. ──────────────
function DocumentRow({
  tid, doc, canEdit, onUpdated,
}: {
  tid: string
  doc: TransporterDocument
  canEdit: boolean
  onUpdated: (patch: Partial<TransporterDocument>) => void
}) {
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)
  const [linkOpen, setLinkOpen]   = useState(false)
  const [linkDraft, setLinkDraft] = useState(doc.file_url ?? '')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions]   = useState<DocumentVersion[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function changeStatus(status: ComplianceStatus) {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.patchDocument(tid, doc.doc_code, { status })
      onUpdated({ status: res.status, manual_override: res.manual_override, updated_at: res.updated_at })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  async function saveLink() {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.patchDocument(tid, doc.doc_code, { file_url: linkDraft })
      onUpdated({ file_url: res.file_url, manual_override: res.manual_override, updated_at: res.updated_at })
      setLinkOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar el link')
    } finally {
      setBusy(false)
    }
  }

  async function handleUpload(file: File) {
    setBusy(true); setErr(null)
    try {
      const stored = await transportersApi.uploadDocumentFile(tid, doc.doc_code, file)
      onUpdated({ storage_path: stored.storage_path, manual_override: true })
      if (versionsOpen) await loadVersions()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al subir el archivo')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function loadVersions() {
    setVersionsLoading(true); setErr(null)
    try {
      setVersions(await transportersApi.listDocumentFiles(tid, doc.doc_code))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cargar versiones')
    } finally {
      setVersionsLoading(false)
    }
  }

  async function toggleVersions() {
    const next = !versionsOpen
    setVersionsOpen(next)
    if (next && versions === null) await loadVersions()
  }

  async function revertOverride() {
    setBusy(true); setErr(null)
    try {
      const res = await transportersApi.patchDocument(tid, doc.doc_code, { manual_override: false })
      onUpdated({ manual_override: res.manual_override })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir')
    } finally {
      setBusy(false)
    }
  }

  const alert = doc.expiry_date ? getAlertStatus(doc.expiry_date) : null
  const iconCls = doc.status === 'ok'
    ? 'bg-green-500 border-green-500 text-white'
    : doc.status === 'actualizar'
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
          <Check size={11} className={doc.status === 'ok' ? '' : 'opacity-0'} />
        </span>
        <span className="text-xs font-semibold text-text-primary flex-1 truncate">{doc.label}</span>

        {doc.expiry_date && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-gray-500 shrink-0">
            {formatExpiry(doc.expiry_date)} <ComplianceBadge status={alert} compact />
          </span>
        )}

        {doc.manual_override && (
          <span
            title="Editado manualmente — el pipeline no lo sobreescribe"
            className="text-[9px] font-semibold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full shrink-0"
          >
            manual
          </span>
        )}

        {canEdit ? (
          <select
            aria-label={`Estado de ${doc.label}`}
            value={doc.status ?? ''}
            disabled={busy}
            onChange={e => changeStatus(e.target.value as ComplianceStatus)}
            className="text-[11px] font-semibold border border-border rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:opacity-50 shrink-0"
          >
            <option value="">—</option>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : doc.file_url ? (
          <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline flex items-center gap-1 shrink-0">
            <Link2 size={10} /> Ver link
          </a>
        ) : null}

        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => setLinkOpen(v => !v)} title="Pegar link"
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors">
              <Link2 size={11} />
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} title="Subir archivo" disabled={busy}
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors disabled:opacity-50">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            </button>
            <input ref={fileInputRef} type="file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
            <button type="button" onClick={toggleVersions} title="Ver archivo / versiones"
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors">
              <FileText size={11} />
            </button>
            {doc.manual_override && (
              <button type="button" onClick={revertOverride} title="Revertir a valor del pipeline" disabled={busy}
                className="p-1 rounded border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 transition-colors disabled:opacity-50">
                <RotateCcw size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {linkOpen && (
        <div className="flex items-center gap-1 mt-2 pl-7">
          <input
            value={linkDraft}
            onChange={e => setLinkDraft(e.target.value)}
            placeholder="https://…"
            className="flex-1 min-w-0 text-[11px] border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button onClick={saveLink} disabled={busy} className="p-1 rounded bg-accent text-white disabled:opacity-50">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button onClick={() => setLinkOpen(false)} className="p-1 rounded text-gray-400 hover:text-gray-600">
            <X size={11} />
          </button>
        </div>
      )}

      {versionsOpen && (
        <div className="mt-2 pl-7 space-y-1">
          {versionsLoading ? (
            <p className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Cargando…</p>
          ) : (versions?.length ?? 0) === 0 ? (
            <p className="text-[10px] text-gray-300 italic">Sin archivos</p>
          ) : (
            versions!.map((v, i) => (
              <a key={v.storage_path ?? v.replaced_at ?? i} href={v.url ?? undefined} target="_blank" rel="noreferrer"
                className={`flex items-center justify-between text-[10px] gap-2 ${v.url ? 'text-accent hover:underline' : 'text-gray-400 pointer-events-none'}`}>
                <span className="truncate">
                  {v.status ?? '—'} · reemplazado {v.replaced_at ? formatExpiry(v.replaced_at) : '—'}
                </span>
                {!v.url && <span className="text-gray-300 shrink-0">(sin archivo)</span>}
              </a>
            ))
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-500 mt-1 pl-7">{err}</p>}
    </div>
  )
}

interface Props {
  tid: string
  documents: TransporterDocument[]
  canEdit: boolean
  onDocumentsChange: (docs: TransporterDocument[]) => void
}

/** Documentos de la empresa — sección siempre visible de la ficha (ya no
 *  colapsada por defecto: como sección propia de la nueva estructura de
 *  una sola página, no necesita ocultarse). Conserva todas las funciones
 *  (link, upload, versiones, revertir) — solo cambia el layout a filas. */
export function TransporterDocumentsPanel({ tid, documents, canEdit, onDocumentsChange }: Props) {
  const okCount = documents.filter(d => d.status === 'ok').length

  function handleUpdated(docCode: string, patch: Partial<TransporterDocument>) {
    onDocumentsChange(documents.map(d => d.doc_code === docCode ? { ...d, ...patch } : d))
  }

  if (documents.length === 0) {
    return <p className="text-xs text-gray-300 italic">Sin datos</p>
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{okCount} de {documents.length} completos</p>
      <div className="flex flex-col gap-1.5">
        {documents.map(doc => (
          <DocumentRow
            key={doc.doc_code}
            tid={tid}
            doc={doc}
            canEdit={canEdit}
            onUpdated={patch => handleUpdated(doc.doc_code, patch)}
          />
        ))}
      </div>
    </div>
  )
}
