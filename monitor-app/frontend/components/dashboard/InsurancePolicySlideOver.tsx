'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X, Loader2, FileText, Upload, ExternalLink, Check, ShieldQuestion,
} from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment, InsurancePolicy, InsuranceSummaryRow, StoredFile } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'

const INSTALLMENT_STATUS_CFG: Record<string, { cls: string; label: string }> = {
  pagada:    { cls: 'bg-green-100 text-green-700', label: 'Pagada' },
  pendiente: { cls: 'bg-amber-50 text-amber-600',  label: 'Pendiente' },
  vencida:   { cls: 'bg-red-100 text-red-600',     label: 'Vencida' },
}

function InstallmentRow({
  installment, canAdmin, onPaid,
}: {
  installment: InsuranceInstallment
  canAdmin:    boolean
  onPaid:      (updated: InsuranceInstallment) => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const cfg = INSTALLMENT_STATUS_CFG[installment.status]

  async function markPaid() {
    setSaving(true); setErr(null)
    try {
      const updated = await insuranceApi.patchInstallment(installment.id, {
        status: 'pagada',
        paid_at: new Date().toISOString().slice(0, 10),
        expected_updated_at: installment.updated_at ?? undefined,
      })
      onPaid(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al marcar como pagada')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-gray-500 w-16 shrink-0">
          #{installment.installment_number}{installment.total_installments ? `/${installment.total_installments}` : ''}
        </span>
        <span className="font-mono text-gray-600 w-14 shrink-0">{installment.amount_uf != null ? `${installment.amount_uf} UF` : '—'}</span>
        <span className="font-mono text-gray-500 w-20 shrink-0">{formatExpiry(installment.due_date)}</span>
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.cls}`}>{cfg.label}</span>
      </div>
      <div className="flex items-center gap-2">
        {err && <span className="text-[10px] text-red-500">{err}</span>}
        {installment.status !== 'pagada' && (
          <button
            type="button"
            onClick={markPaid}
            disabled={!canAdmin || saving}
            title={!canAdmin ? 'Solo un administrador puede marcar cuotas como pagadas' : undefined}
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-border/60 text-gray-500 hover:text-accent hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
            Marcar pagada
          </button>
        )}
      </div>
    </div>
  )
}

function PolicyCard({
  policy, canAdmin, onChanged,
}: {
  policy:    InsurancePolicy
  canAdmin:  boolean
  onChanged: (updated: InsurancePolicy) => void
}) {
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [files, setFiles]         = useState<StoredFile[] | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [filesLoading, setFilesLoading] = useState(false)

  async function toggleFiles() {
    const next = !filesOpen
    setFilesOpen(next)
    if (next && files === null) {
      setFilesLoading(true)
      try { setFiles(await insuranceApi.listPolicyFiles(policy.id)) }
      catch { setFiles([]) }
      finally { setFilesLoading(false) }
    }
  }

  async function handleUpload(file: File) {
    setUploading(true); setUploadErr(null)
    try {
      await insuranceApi.uploadPolicyFile(policy.id, file)
      if (filesOpen) { setFiles(await insuranceApi.listPolicyFiles(policy.id)) }
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Error al subir el archivo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-primary">{policy.company}</p>
          <p className="text-[11px] text-gray-400 font-mono">
            Póliza {policy.policy_number}{policy.endorsement ? ` · Endoso ${policy.endorsement}` : ''}
          </p>
        </div>
        {policy.policy_type && (
          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
            {policy.policy_type}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-500">
        <p>Vigencia: <span className="font-mono text-gray-700">{formatExpiry(policy.valid_from)} – {formatExpiry(policy.valid_to)}</span></p>
        {policy.plate && <p>Patente: <span className="font-mono text-gray-700">{policy.plate}</span></p>}
        {policy.coverage && <p className="col-span-2">Cobertura: <span className="text-gray-700">{policy.coverage}</span></p>}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {policy.payment_url && (
          <a href={policy.payment_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
            <ExternalLink size={10} /> Link de pago
          </a>
        )}
        <button type="button" onClick={toggleFiles} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent">
          <FileText size={11} /> Archivo{files ? ` (${files.length})` : ''}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent cursor-pointer">
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          Subir
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
          />
        </label>
      </div>
      {uploadErr && <p className="text-[10px] text-red-500">{uploadErr}</p>}

      {filesOpen && (
        <div className="pt-1 border-t border-border/60 space-y-1">
          {filesLoading ? (
            <p className="text-[10px] text-gray-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Cargando…</p>
          ) : (files?.length ?? 0) === 0 ? (
            <p className="text-[10px] text-gray-300 italic">Sin archivos</p>
          ) : (
            files!.map(f => (
              <a key={f.id} href={f.url ?? undefined} target="_blank" rel="noreferrer"
                className={`block text-[10px] ${f.url ? 'text-accent hover:underline' : 'text-gray-400'}`}>
                v{f.version} · {f.file_name}
              </a>
            ))
          )}
        </div>
      )}

      <div className="pt-1 border-t border-border/60">
        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Cuotas</p>
        {(policy.installments ?? []).length === 0 ? (
          <p className="text-[11px] text-gray-300 italic">Sin cuotas registradas</p>
        ) : (
          policy.installments!.map(inst => (
            <InstallmentRow
              key={inst.id}
              installment={inst}
              canAdmin={canAdmin}
              onPaid={updated => onChanged({
                ...policy,
                installments: policy.installments!.map(i => i.id === updated.id ? updated : i),
              })}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface Props {
  row:       InsuranceSummaryRow | null
  canAdmin:  boolean
  onClose:   () => void
}

/** Slide-over de pólizas + cuotas de una empresa — plan §4.3. Mismo patrón
 *  visual que TripSlideOver (panel fijo a la derecha). */
export function InsurancePolicySlideOver({ row, canAdmin, onClose }: Props) {
  const queryClient = useQueryClient()
  const open = !!row

  const query = useQuery({
    queryKey: ['insurance', 'transporter', row?.transporter_id],
    queryFn: () => insuranceApi.getForTransporter(row!.transporter_id!),
    enabled: !!row?.transporter_id,
  })

  function handlePolicyChanged(updated: InsurancePolicy) {
    queryClient.setQueryData(
      ['insurance', 'transporter', row?.transporter_id],
      (old: { rut: string; transporter_id: string; policies: InsurancePolicy[] } | undefined) =>
        old ? { ...old, policies: old.policies.map(p => p.id === updated.id ? updated : p) } : old,
    )
  }

  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="px-5 py-4 bg-slate-900 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white truncate">{row?.business_name ?? row?.rut ?? 'Seguros'}</h3>
          {row && <p className="text-[11px] text-white/50 font-mono">{row.rut}</p>}
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {!row ? null : !row.transporter_id ? (
          <p className="text-sm text-gray-400 flex items-center gap-2">
            <ShieldQuestion size={16} /> Esta empresa no tiene ficha vinculada en Empresas — no es posible mostrar el detalle de pólizas.
          </p>
        ) : query.isPending ? (
          <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</p>
        ) : query.error ? (
          <p className="text-sm text-red-500">{query.error instanceof Error ? query.error.message : 'Error cargando pólizas'}</p>
        ) : (query.data?.policies.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-400 italic">Sin pólizas registradas</p>
        ) : (
          query.data!.policies.map(p => (
            <PolicyCard key={p.id} policy={p} canAdmin={canAdmin} onChanged={handlePolicyChanged} />
          ))
        )}
      </div>
    </div>
  )
}
