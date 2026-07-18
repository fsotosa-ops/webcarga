'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Loader2, Check, Eye } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import type { ComplianceRecord, ComplianceStatus, DocumentVersion } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { COMPLIANCE_STATUS_CONFIG, complianceAlertStatus, formatExpiry } from '@/lib/compliance'

/** PENDING_REVIEW excluido a propósito: no existe un proceso de due
 *  diligence separado del negocio hoy — quien sube un documento ya lo
 *  revisó (POST .../file fuerza APPROVED_MANUAL directo, ver
 *  routers/compliance.py). El valor sigue siendo válido en el CHECK
 *  constraint para datos legacy, solo deja de ofrecerse acá. */
const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] =
  (Object.entries(COMPLIANCE_STATUS_CONFIG) as [ComplianceStatus, { label: string }][])
    .filter(([value]) => value !== 'PENDING_REVIEW')
    .map(([value, cfg]) => ({ value, label: cfg.label }))

// ── Una fila por compliance_record — mismo lenguaje visual que
//    DocumentChecklist, pero con más acciones (upload/versiones) porque
//    estos documentos sí tienen archivo y revisión manual detrás. No hay
//    "pegar link" ni "revertir a valor del pipeline": el backend nuevo solo
//    soporta status/expiration_date por PATCH y evidencia real por POST
//    .../file (ver routers/compliance.py) — no un file_url editable a mano
//    ni un un-override explícito. ──────────────────────────────────────
function DocumentRow({
  record, canEdit, onUpdated,
}: {
  record: ComplianceRecord
  canEdit: boolean
  onUpdated: () => void
}) {
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions]   = useState<DocumentVersion[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function changeStatus(status: ComplianceStatus) {
    setBusy(true); setErr(null)
    try {
      await complianceApi.patch(record.id, { status })
      onUpdated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  async function changeExpiration(expirationDate: string) {
    setBusy(true); setErr(null)
    try {
      await complianceApi.patch(record.id, { expiration_date: expirationDate })
      onUpdated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  async function handleUpload(file: File) {
    setBusy(true); setErr(null)
    try {
      await complianceApi.uploadFile(record.id, file)
      onUpdated()
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
      setVersions(await complianceApi.listFiles(record.id))
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

  async function handleDelete() {
    await complianceApi.deleteFile(record.id)
    onUpdated()
    if (versionsOpen) await loadVersions()
  }

  const alert = complianceAlertStatus(record.is_expired, record.is_expiring_soon)
  const approved = record.status === 'APPROVED' || record.status === 'APPROVED_MANUAL'
  const iconCls = approved && !record.is_expired
    ? 'bg-green-500 border-green-500 text-white'
    : record.status === 'EXPIRED' || record.status === 'REJECTED' || (approved && record.is_expired)
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
          <Check size={11} className={approved && !record.is_expired ? '' : 'opacity-0'} />
        </span>
        <span className="text-xs font-semibold text-text-primary flex-1 truncate">{record.name}</span>

        {(record.expiration_date || canEdit) && (
          <span className="flex items-center gap-1.5 shrink-0">
            {record.expiration_date && (
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="text-gray-400">Vence:</span>
                <span className="font-mono">{formatExpiry(record.expiration_date)}</span>
                <ComplianceBadge status={alert} compact />
              </span>
            )}
            {canEdit && (
              <input
                type="date"
                aria-label={`Fecha de vencimiento de ${record.name}`}
                value={record.expiration_date ?? ''}
                disabled={busy}
                onChange={e => changeExpiration(e.target.value)}
                className="text-[10px] text-gray-500 border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50"
              />
            )}
          </span>
        )}

        {canEdit && (
          <select
            aria-label={`Estado de ${record.name}`}
            value={record.status}
            disabled={busy}
            onChange={e => changeStatus(e.target.value as ComplianceStatus)}
            className="text-[11px] font-semibold border border-border rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:opacity-50 shrink-0"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {record.file_url && (
          <button
            type="button" onClick={() => setPreviewOpen(true)}
            className="text-[11px] text-accent hover:underline flex items-center gap-1 shrink-0"
          >
            <Eye size={12} /> Ver archivo
          </button>
        )}

        {/* Estado "Falta" con carga habilitada: CTA visible en vez de solo
           el ícono chico — cargar debe ser la acción obvia, no una que haya
           que buscar (pedido explícito del usuario 2026-07-18). */}
        {canEdit && record.requires_file && !record.file_url && (
          <button
            type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}
            className="flex items-center gap-1 text-[11px] font-semibold text-accent border border-dashed border-accent/40 rounded-md px-2 py-1 hover:bg-accent/5 transition-colors disabled:opacity-50 shrink-0"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            Subir documento
          </button>
        )}

        {canEdit && record.requires_file && (
          <div className="flex items-center gap-1 shrink-0">
            {record.file_url && (
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Reemplazar archivo" disabled={busy}
                className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors disabled:opacity-50">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              </button>
            )}
            <input ref={fileInputRef} type="file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
            <button type="button" onClick={toggleVersions} title="Ver historial de versiones"
              className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors">
              <FileText size={11} />
            </button>
          </div>
        )}
      </div>

      {previewOpen && record.file_url && (
        <DocumentPreviewModal
          label={record.name}
          url={record.file_url}
          canEdit={canEdit}
          onClose={() => setPreviewOpen(false)}
          onDelete={canEdit ? handleDelete : undefined}
        />
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
  records:   ComplianceRecord[]
  canEdit:   boolean
  onChanged: () => void
}

/** Documentos de la empresa — sección siempre visible de la ficha. A
 *  diferencia de DocumentChecklist (usada en conductores/vehículos), acá se
 *  muestran select de estado y subida de archivo a la vez cuando
 *  requires_file, porque este panel es la superficie de revisión: subir
 *  evidencia y aprobar/rechazar son pasos separados del mismo flujo. */
export function TransporterDocumentsPanel({ records, canEdit, onChanged }: Props) {
  const approvedCount = records.filter(r => r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL').length

  if (records.length === 0) {
    return <p className="text-xs text-gray-300 italic">Sin datos</p>
  }

  return (
    <div>
      <p className="text-xs text-gray-400 mb-2">{approvedCount} de {records.length} completos</p>
      <div className="flex flex-col gap-1.5">
        {records.map(record => (
          <DocumentRow key={record.id} record={record} canEdit={canEdit} onUpdated={onChanged} />
        ))}
      </div>
    </div>
  )
}
