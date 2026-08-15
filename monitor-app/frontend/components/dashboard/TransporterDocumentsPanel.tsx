'use client'

import { useState } from 'react'
import { Check, Eye, FileText, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import type { ComplianceRecord, DocumentVersion } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import { complianceAlertStatus, formatExpiry } from '@/lib/compliance'
import { useCanEdit } from '@/hooks/useCanEdit'
import { ReassignDocument } from '@/components/compliance/ReassignDocument'
import { ExpirationDateCell } from './ExpirationDateCell'

// ── Una fila por compliance_record — solo lectura. La carga/edición real
//    vive en el módulo Certificación (Ronda 88): acá se ve el estado, se
//    puede previsualizar el archivo vigente y su historial de versiones,
//    pero subir/reemplazar/cambiar estado se hace desde ahí para no
//    duplicar el entry point. "Ver historial" queda disponible para
//    cualquiera (es lectura, no edición — antes estaba atado sin motivo
//    a canEdit). ──────────────────────────────────────────────────────
function DocumentRow({ record, carrierId, onChanged }: {
  record: ComplianceRecord; carrierId?: string; onChanged?: () => void
}) {
  const canEdit = useCanEdit()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function toggleVersions() {
    const next = !versionsOpen
    setVersionsOpen(next)
    if (next && versions === null) {
      setVersionsLoading(true); setErr(null)
      try {
        setVersions(await complianceApi.listFiles(record.id))
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error al cargar versiones')
      } finally {
        setVersionsLoading(false)
      }
    }
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

        {/* HU-02: el vencimiento se puede declarar SIN adjuntar el archivo — el
            requisito sigue pendiente, pero ya alimenta las alertas. */}
        <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-gray-500">
          <ExpirationDateCell
            recordId={record.id}
            value={record.expiration_date ?? null}
            required={false}
            canEdit={canEdit}
            onSaved={() => onChanged?.()}
          />
          {record.expiration_date && <ComplianceBadge status={alert} compact />}
        </span>

        {/* HU-03: el archivo está cargado, pero puede estar en el requisito
            equivocado. */}
        {canEdit && record.file_url && carrierId && (
          <ReassignDocument
            recordId={record.id}
            carrierId={carrierId}
            onDone={() => onChanged?.()}
          />
        )}

        {record.file_url && (
          <button
            type="button" onClick={() => setPreviewOpen(true)}
            className="text-[11px] text-accent hover:underline flex items-center gap-1 shrink-0"
          >
            <Eye size={12} /> Ver archivo
          </button>
        )}
        {record.requires_file && (
          <button type="button" onClick={toggleVersions} title="Ver historial de versiones"
            className="p-1 rounded border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-colors shrink-0">
            <FileText size={11} />
          </button>
        )}
      </div>

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
                  {v.status ?? '—'} · {v.is_current
                    ? 'vigente'
                    : `reemplazado ${v.replaced_at ? formatExpiry(v.replaced_at) : '—'}`}
                </span>
                {!v.url && <span className="text-gray-300 shrink-0">(sin archivo)</span>}
              </a>
            ))
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-500 mt-1 pl-7">{err}</p>}

      {previewOpen && record.file_url && (
        <DocumentPreviewModal
          label={record.name}
          url={record.file_url}
          canEdit={false}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}

interface Props {
  records: ComplianceRecord[]
  /** Habilita corregir un documento mal cargado (HU-03). */
  carrierId?: string
  /** Avisa que hay que releer la ficha: se declaró un vencimiento (HU-02). */
  onChanged?: () => void
}

/** Documentos de la empresa — sección siempre visible de la ficha, solo
 *  lectura desde Ronda 88 (decisión explícita del usuario: Empresas
 *  gestiona entidades — baja/transferir/asignar —, Certificación es el
 *  único lugar para subir/editar documentación, evita el entry point
 *  duplicado que existía antes). */
export function TransporterDocumentsPanel({ records, carrierId, onChanged }: Props) {
  const approvedCount = records.filter(r => r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL').length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400">
          {records.length === 0 ? 'Sin datos' : `${approvedCount} de ${records.length} completos`}
        </p>
        {/* El link de salida a Certificación se retiró: la carga vive ahora
            en esta misma ficha (CarrierDocumentsTab). */}
      </div>
      {records.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {records.map(record => (
            <DocumentRow key={record.id} record={record} carrierId={carrierId} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}
