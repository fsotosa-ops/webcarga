'use client'

import { useRef, useState } from 'react'
import {
  ChevronDown, Loader2, Link2, Upload, FileText, RotateCcw, PenLine, Check, X,
} from 'lucide-react'
import { transportersApi } from '@/lib/api/transporters'
import type { ComplianceStatus, StoredFile, TransporterDocument } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { COMPLIANCE_STATUS_CONFIG, getAlertStatus, formatExpiry } from '@/lib/compliance'

const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] = [
  { value: 'ok',         label: 'OK' },
  { value: 'pendiente',  label: 'Pendiente' },
  { value: 'actualizar', label: 'Actualizar' },
  { value: 'n_a',        label: 'N/A' },
  { value: 'factible',   label: 'Factible' },
]

function StatusPill({ status }: { status: ComplianceStatus | null }) {
  if (!status) return <span className="text-[10px] text-gray-300">Sin estado</span>
  const { cls, label } = COMPLIANCE_STATUS_CONFIG[status]
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>{label}</span>
}

// ── Single document card ────────────────────────────────────────────────
function DocumentCard({
  tid, doc, canEdit, onUpdated,
}: {
  tid: string
  doc: TransporterDocument
  canEdit: boolean
  onUpdated: (updated: Partial<TransporterDocument>) => void
}) {
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)
  const [linkOpen, setLinkOpen]   = useState(false)
  const [linkDraft, setLinkDraft] = useState(doc.file_url ?? '')
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions]   = useState<StoredFile[] | null>(null)
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

  return (
    <div className="bg-gray-50 border border-border/60 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-1">
        <p className="text-[9px] text-gray-400 uppercase font-bold leading-tight flex-1">{doc.label}</p>
        {doc.manual_override && (
          <span
            title="Editado manualmente — el pipeline no lo sobreescribe"
            className="text-[8px] font-semibold text-blue-500 bg-blue-50 px-1 py-0.5 rounded shrink-0"
          >
            manual
          </span>
        )}
      </div>

      {canEdit ? (
        <select
          value={doc.status ?? ''}
          disabled={busy}
          onChange={e => changeStatus(e.target.value as ComplianceStatus)}
          className="w-full text-xs border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:opacity-50"
        >
          <option value="">—</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <StatusPill status={doc.status} />
      )}

      {doc.expiry_date && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-gray-500">{formatExpiry(doc.expiry_date)}</span>
          <ComplianceBadge status={alert} compact />
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-1 flex-wrap pt-0.5">
          <button
            type="button"
            onClick={() => setLinkOpen(v => !v)}
            title="Pegar link"
            className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors"
          >
            <Link2 size={11} />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Subir archivo"
            disabled={busy}
            className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
          />
          <button
            type="button"
            onClick={toggleVersions}
            title="Ver archivo / versiones"
            className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors"
          >
            <FileText size={11} />
          </button>
          {doc.manual_override && (
            <button
              type="button"
              onClick={revertOverride}
              title="Revertir a valor del pipeline"
              disabled={busy}
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      )}

      {!canEdit && doc.file_url && (
        <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline flex items-center gap-1">
          <Link2 size={9} /> Ver link
        </a>
      )}

      {linkOpen && (
        <div className="flex items-center gap-1 pt-0.5">
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
        <div className="pt-1 border-t border-border/60 space-y-1">
          {versionsLoading ? (
            <p className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Cargando…</p>
          ) : (versions?.length ?? 0) === 0 ? (
            <p className="text-[10px] text-gray-300 italic">Sin archivos</p>
          ) : (
            versions!.map(v => (
              <a
                key={v.id}
                href={v.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className={`flex items-center justify-between text-[10px] gap-2 ${v.url ? 'text-accent hover:underline' : 'text-gray-400 pointer-events-none'}`}
              >
                <span className="truncate">v{v.version} · {v.file_name}</span>
                {!v.url && <span className="text-gray-300 shrink-0">(sin URL)</span>}
              </a>
            ))
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-500">{err}</p>}
    </div>
  )
}

// ── Panel (collapsible section, same shell as the previous CompanyDocsPanel) ──
export function TransporterDocumentsPanel({
  tid, documents, canEdit, onDocumentsChange,
}: {
  tid: string
  documents: TransporterDocument[]
  canEdit: boolean
  onDocumentsChange: (docs: TransporterDocument[]) => void
}) {
  const [open, setOpen] = useState(false)

  const okCount      = documents.filter(d => d.status === 'ok').length
  const pendingCount = documents.filter(d => d.status === 'pendiente' || d.status === 'actualizar').length
  const overrideCount = documents.filter(d => d.manual_override).length

  function handleUpdated(docCode: string, patch: Partial<TransporterDocument>) {
    onDocumentsChange(documents.map(d => d.doc_code === docCode ? { ...d, ...patch } : d))
  }

  return (
    <div className="border-t border-border/60 mt-4 pt-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors w-full"
      >
        <ChevronDown size={13} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="font-semibold uppercase tracking-wide text-[10px]">Documentos de la Empresa</span>
        <span className="flex items-center gap-1.5 ml-1">
          {okCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{okCount} OK</span>
          )}
          {pendingCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">{pendingCount} pendiente{pendingCount > 1 ? 's' : ''}</span>
          )}
          {overrideCount > 0 && (
            <span title="Documentos editados manualmente" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 flex items-center gap-1">
              <PenLine size={9} /> {overrideCount}
            </span>
          )}
          {documents.length === 0 && <span className="text-[10px] text-gray-300">sin datos</span>}
        </span>
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {documents.map(doc => (
            <DocumentCard
              key={doc.doc_code}
              tid={tid}
              doc={doc}
              canEdit={canEdit}
              onUpdated={patch => handleUpdated(doc.doc_code, patch)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
