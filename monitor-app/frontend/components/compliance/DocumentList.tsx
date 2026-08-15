'use client'

import { useState } from 'react'
import { Check, Eye, FileText, Loader2, Upload } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceAlertStatus, formatExpiry } from '@/lib/compliance'
import { useCanEdit } from '@/hooks/useCanEdit'
import { ComplianceBadge } from '@/components/dashboard/ComplianceBadge'
import { DocumentPreviewModal } from '@/components/dashboard/DocumentPreviewModal'
import { ExpirationDateCell } from '@/components/dashboard/ExpirationDateCell'
import { ReassignDocument } from './ReassignDocument'
import type { ComplianceRecord, DocumentVersion } from '@/lib/types'

type EntityType = 'CARRIER' | 'DRIVER' | 'ASSET'

interface Props {
  records:    ComplianceRecord[]
  /** Empresa a la que se le carga el archivo. `null` en un conductor o
   *  vehículo sin asignación activa: ahí no hay lote al que asociarlo. */
  carrierId:  string | null
  entityType: EntityType
  entityId:   string
  onChanged:  () => void
}

/** Los documentos de una entidad — **el** listado, para los tres niveles.
 *
 *  Antes había dos: uno para la empresa y otro para conductor/vehículo. Con
 *  dos, "la misma gramática en cada nivel" es una frase: divergen. */
export function DocumentList({ records, carrierId, entityType, entityId, onChanged }: Props) {
  const cubiertos = records.filter(
    r => r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL',
  ).length

  if (!records.length) {
    return (
      <p className="text-[11px] text-gray-500 py-3">
        Todavía no hay requisitos definidos para esta entidad.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-[11px] text-gray-500 tabular-nums">
          {cubiertos} de {records.length} al día
        </p>
        {!carrierId && (
          <p className="text-[11px] text-amber-700">
            · Sin empresa asignada: no se pueden cargar documentos hasta que tenga una.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {records.map(record => (
          <DocumentRow
            key={record.id}
            record={record}
            carrierId={carrierId}
            entityType={entityType}
            entityId={entityId}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  )
}

function DocumentRow({ record, carrierId, entityType, entityId, onChanged }: {
  record: ComplianceRecord; carrierId: string | null
  entityType: EntityType; entityId: string; onChanged: () => void
}) {
  const canEdit = useCanEdit()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
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

  async function subir(file: File) {
    if (!carrierId) return
    setSubiendo(true); setErr(null)
    try {
      // La MISMA puerta que la bandeja, con el requisito ya conocido.
      await documentIngestApi.uploadAndClassify({
        carrierId, entityType, entityId,
        requirementId: record.requirement_id,
        file,
      })
      setVersions(null)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo cargar el documento')
    } finally {
      setSubiendo(false)
    }
  }

  const alert = complianceAlertStatus(record.is_expired, record.is_expiring_soon)
  const aprobado = record.status === 'APPROVED' || record.status === 'APPROVED_MANUAL'
  const iconCls = aprobado && !record.is_expired
    ? 'bg-green-500 border-green-500 text-white'
    : record.status === 'EXPIRED' || record.status === 'REJECTED' || (aprobado && record.is_expired)
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  const puedeCargar = canEdit && !!carrierId

  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
          <Check size={11} className={aprobado && !record.is_expired ? '' : 'opacity-0'} />
        </span>
        <span className="text-xs font-semibold text-text-primary flex-1 truncate min-w-0">{record.name}</span>

        {/* HU-02: el vencimiento se declara con o sin archivo adjunto. */}
        <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-gray-500">
          <ExpirationDateCell
            recordId={record.id}
            value={record.expiration_date ?? null}
            required={false}
            canEdit={canEdit}
            onSaved={onChanged}
          />
          {record.expiration_date && <ComplianceBadge status={alert} compact />}
        </span>

        {/* HU-03: está cargado, pero puede estar en el requisito equivocado. */}
        {canEdit && record.file_url && carrierId && (
          <ReassignDocument recordId={record.id} carrierId={carrierId} onDone={onChanged} />
        )}

        {record.file_url && (
          <button
            type="button" onClick={() => setPreviewOpen(true)}
            className="text-[11px] text-accent hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <Eye size={12} /> Ver archivo
          </button>
        )}

        {puedeCargar && record.requires_file && (
          <label
            title={record.file_url ? 'Reemplazar archivo' : 'Subir archivo'}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent cursor-pointer shrink-0"
          >
            {subiendo
              ? <Loader2 size={11} className="motion-safe:animate-spin" />
              : <Upload size={11} />}
            {!record.file_url && 'Subir'}
            <input
              type="file"
              className="hidden"
              aria-label={`${record.file_url ? 'Reemplazar' : 'Subir'} ${record.name}`}
              onChange={e => { const f = e.target.files?.[0]; if (f) subir(f) }}
            />
          </label>
        )}

        {record.requires_file && (
          <button
            type="button" onClick={toggleVersions} title="Ver historial de versiones"
            className="p-1 rounded border border-border/60 text-gray-500 hover:text-accent hover:border-accent transition-colors shrink-0 cursor-pointer"
          >
            <FileText size={11} />
          </button>
        )}
      </div>

      {versionsOpen && (
        <div className="mt-2 pl-7 space-y-1">
          {versionsLoading ? (
            <p className="text-[10px] text-gray-500 flex items-center gap-1">
              <Loader2 size={10} className="motion-safe:animate-spin" /> Cargando…
            </p>
          ) : (versions?.length ?? 0) === 0 ? (
            <p className="text-[10px] text-gray-500 italic">Sin archivos</p>
          ) : (
            versions!.map((v, i) => (
              <a
                key={v.storage_path ?? v.replaced_at ?? i}
                href={v.url ?? undefined} target="_blank" rel="noreferrer"
                className={`flex items-center justify-between text-[10px] gap-2 ${
                  v.url ? 'text-accent hover:underline' : 'text-gray-500 pointer-events-none'
                }`}
              >
                <span className="truncate">
                  {v.status ?? '—'} · {v.is_current
                    ? 'vigente'
                    : `reemplazado ${v.replaced_at ? formatExpiry(v.replaced_at) : '—'}`}
                </span>
                {!v.url && <span className="text-gray-500 shrink-0">(sin archivo)</span>}
              </a>
            ))
          )}
        </div>
      )}

      {err && <p className="text-[10px] text-red-600 mt-1 pl-7">{err}</p>}

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
