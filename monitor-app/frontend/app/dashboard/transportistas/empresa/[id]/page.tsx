'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronRight, PenLine, Check, X, RotateCcw,
  Trash2, Loader2, AlertTriangle, ShieldCheck,
  Search, ArrowRightLeft, Phone, Mail,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { transportersApi } from '@/lib/api/transporters'
import type {
  TransporterProfile, TransporterDriver, TransporterVehicle, TransporterContact,
  ComplianceStatus, DriverGovernance, VehicleGovernance,
} from '@/lib/types'
import { ComplianceBadge } from '@/components/dashboard/ComplianceBadge'
import { EligibilityDot } from '@/components/dashboard/EligibilityDot'
import { InsuranceSummaryCard } from '@/components/dashboard/InsuranceSummaryCard'
import { TransporterDocumentsPanel } from '@/components/dashboard/TransporterDocumentsPanel'
import { TransferModal } from '@/components/dashboard/TransferModal'
import { describeEligibility } from '@/lib/utils/eligibility'
import {
  getAlertStatus, getDriverAlertStatus, getVehicleAlertStatus, formatExpiry, COMPLIANCE_STATUS_CONFIG,
} from '@/lib/compliance'

type Tab = 'conductores' | 'equipos'

const ACCOUNT_STAGES = ['Lead', 'Operational']
const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])
const ADMIN_ROLES  = new Set(['admin', 'owner'])

// Categoría de equipo derivada de `type`/`kind` para el filtro de la tab
// Equipos (plan §4.2: "filtro por tipo (tracto/rampla/camion/furgon)"). El
// contrato de TransporterVehicle solo trae `type` (texto libre), así que se
// clasifica por heurística sobre ese texto; los trailers (TransporterTrailer)
// no traen `type` y se categorizan siempre como 'rampla'.
type VehicleCategory = 'tracto' | 'rampla' | 'camion' | 'furgon' | 'otro'

function vehicleCategory(type: string | null | undefined): VehicleCategory {
  const t = (type ?? '').toLowerCase()
  if (t.includes('rampla') || t.includes('remolque')) return 'rampla'
  if (t.includes('tracto')) return 'tracto'
  if (t.includes('furg')) return 'furgon'
  if (t.includes('cami')) return 'camion'
  return 'otro'
}

const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  tracto: 'Tracto', rampla: 'Rampla', camion: 'Camión', furgon: 'Furgón', otro: 'Otro',
}

const VEHICLE_TYPES = [
  'Tractocamión',
  'Camión Rígido',
  'Camión Furgón',
  'Camión Refrigerado',
  'Plataforma',
  'Cisterna',
]

const INITIAL_COLORS = [
  '#0A66C2', '#10b981', '#8b5cf6', '#f59e0b',
  '#ef4444', '#06b6d4', '#64748b', '#e11d48',
]

function getInitialColor(name: string | null) {
  if (!name) return '#64748b'
  return INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length]
}

function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

// ── Governance helpers ────────────────────────────────────────────

const COMPLIANCE_CFG = COMPLIANCE_STATUS_CONFIG

function GovernanceStatusBadge({ status }: { status: ComplianceStatus | null }) {
  if (!status) return <span className="text-[10px] text-gray-300">—</span>
  const { cls, label } = COMPLIANCE_CFG[status]
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function GovernanceSelect({
  value,
  onChange,
}: {
  value: ComplianceStatus | null
  onChange: (v: ComplianceStatus | null) => void
}) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange((e.target.value as ComplianceStatus) || null)}
      className="flex-1 text-xs border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
    >
      <option value="">—</option>
      <option value="ok">OK</option>
      <option value="pendiente">Pendiente</option>
      <option value="actualizar">Actualizar</option>
      <option value="n_a">N/A</option>
      <option value="factible">Factible</option>
    </select>
  )
}

// Driver docs (Excel sheet "Conductores", no-expiry columns)
const DRIVER_DOC_LABELS: { key: keyof DriverGovernance; label: string }[] = [
  { key: 'anexo_3_gc',        label: 'Anexo 3 GC' },
  { key: 'epp',               label: 'EPP' },
  { key: 'das_odi',           label: 'DAS / ODI' },
  { key: 'hoja_de_vida',      label: 'Hoja de Vida' },
  { key: 'cert_antecedentes', label: 'Cert. Antecedentes' },
  { key: 'validado_gc_driver', label: 'Validado GC' },
  { key: 'contrato_trabajo',  label: 'Contrato Trabajo' },
  { key: 'creacion_gc_driver', label: 'Creación GC' },
]

// Vehicle docs (Excel sheet "Vehiculos_Equipos", no-expiry columns)
const VEHICLE_DOC_LABELS: { key: keyof VehicleGovernance; label: string }[] = [
  { key: 'padron',                 label: 'Padrón' },
  { key: 'poliza_rc',              label: 'Póliza RC' },
  { key: 'gps',                    label: 'GPS' },
  { key: 'seguro_carga',           label: 'Seguro Carga' },
  { key: 'mantencion_camara_frio', label: 'Cámara Frío' },
  { key: 'creacion_gc_vehicle',    label: 'Creación GC' },
]

const VEHICLE_EXPIRY_LABELS = [
  { key: 'circ_permit_expiry',     label: 'P. Circ.' },
  { key: 'tech_inspection_expiry', label: 'Rev. Téc.' },
  { key: 'gas_emissions_expiry',   label: 'Gases' },
  { key: 'soap_insurance_expiry',  label: 'SOAP' },
] as const

// ── Driver row ────────────────────────────────────────────────────
function DriverRow({
  driver, canEdit, canAdmin, expanded, onToggleExpand, onPatch, onRemove, onTransferClick,
}: {
  driver: TransporterDriver
  canEdit: boolean
  canAdmin: boolean
  expanded: boolean
  onToggleExpand: () => void
  onPatch: (body: { rut?: string; name?: string; governance?: DriverGovernance }) => Promise<void>
  onRemove: () => Promise<void>
  onTransferClick: () => void
}) {
  const [draft, setDraft]       = useState({ rut: driver.rut, name: driver.name })
  const [draftGov, setDraftGov] = useState<Partial<DriverGovernance>>({
    id_expiry:         driver.governance?.id_expiry         ?? null,
    license_expiry:    driver.governance?.license_expiry    ?? null,
    anexo_3_gc:   driver.governance?.anexo_3_gc   ?? null,
    epp:               driver.governance?.epp               ?? null,
    das_odi:           driver.governance?.das_odi           ?? null,
    hoja_de_vida:      driver.governance?.hoja_de_vida      ?? null,
    cert_antecedentes: driver.governance?.cert_antecedentes ?? null,
    validado_gc_driver:  driver.governance?.validado_gc_driver  ?? null,
    contrato_trabajo:  driver.governance?.contrato_trabajo  ?? null,
    creacion_gc_driver:  driver.governance?.creacion_gc_driver  ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  useEffect(() => {
    setDraft({ rut: driver.rut, name: driver.name })
    setDraftGov({
      id_expiry:         driver.governance?.id_expiry         ?? null,
      license_expiry:    driver.governance?.license_expiry    ?? null,
      anexo_3_gc:   driver.governance?.anexo_3_gc   ?? null,
      epp:               driver.governance?.epp               ?? null,
      das_odi:           driver.governance?.das_odi           ?? null,
      hoja_de_vida:      driver.governance?.hoja_de_vida      ?? null,
      cert_antecedentes: driver.governance?.cert_antecedentes ?? null,
      validado_gc_driver:  driver.governance?.validado_gc_driver  ?? null,
      contrato_trabajo:  driver.governance?.contrato_trabajo  ?? null,
      creacion_gc_driver:  driver.governance?.creacion_gc_driver  ?? null,
    })
  }, [driver])

  const dAlert = getDriverAlertStatus(driver)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      await onPatch({
        rut:        draft.rut,
        name:       draft.name,
        governance: { ...(driver.governance ?? {}), ...draftGov } as DriverGovernance,
      })
      onToggleExpand()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr className="border-b border-border/60 last:border-0 hover:bg-blue-50/20 transition-colors">
        {/* Conductor */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${
                dAlert === 'expired'       ? 'ring-2 ring-red-400' :
                dAlert === 'expiring_soon' ? 'ring-2 ring-amber-300' : ''
              }`}
              style={{ backgroundColor: getInitialColor(driver.name) }}
            >
              {driver.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 leading-tight">{driver.name}</p>
              <p className="text-[11px] font-mono text-gray-400 mt-0.5">{driver.rut}</p>
            </div>
          </div>
        </td>

        {/* Vencimientos */}
        <td className="px-4 py-3">
          <div className="space-y-0.5">
            {driver.governance?.id_expiry ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-400 w-7 shrink-0">C.I.</span>
                <span className="text-[11px] font-mono text-gray-600">{formatExpiry(driver.governance.id_expiry)}</span>
                <ComplianceBadge status={getAlertStatus(driver.governance.id_expiry)} compact />
              </div>
            ) : <p className="text-[11px] text-gray-200 italic">C.I. —</p>}
            {driver.governance?.license_expiry ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-400 w-7 shrink-0">Lic.</span>
                <span className="text-[11px] font-mono text-gray-600">{formatExpiry(driver.governance.license_expiry)}</span>
                <ComplianceBadge status={getAlertStatus(driver.governance.license_expiry)} compact />
              </div>
            ) : <p className="text-[11px] text-gray-200 italic">Lic. —</p>}
          </div>
        </td>

        {/* Documentación */}
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {DRIVER_DOC_LABELS.map(({ key, label }) => {
              const val = driver.governance?.[key as keyof DriverGovernance] as ComplianceStatus | null
              if (!val || val === 'n_a') return null
              const { cls } = COMPLIANCE_CFG[val]
              return (
                <span key={key} title={label} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>
                  {label}
                </span>
              )
            })}
            {!driver.governance && <span className="text-[11px] text-gray-300 italic">sin datos</span>}
          </div>
        </td>

        {/* Edit */}
        <td className="px-3 py-3">
          {(canEdit || canAdmin) && (
            <div className="flex items-center gap-1">
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={onToggleExpand}
                    title="Editar conductor"
                    className={`p-1.5 rounded-lg border transition-all ${
                      expanded
                        ? 'border-accent bg-accent/5 text-accent'
                        : 'border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5'
                    }`}
                  >
                    <PenLine size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={onRemove}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
              {canAdmin && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  title="Transferir a otra empresa"
                  className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 transition-all"
                >
                  <ArrowRightLeft size={12} />
                </button>
              )}
            </div>
          )}
        </td>
      </tr>

      {/* Expandable edit form */}
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={4} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2">Datos Conductor</p>
                <input
                  value={draft.name}
                  onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}
                  placeholder="Nombre completo"
                  className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                />
                <input
                  value={draft.rut}
                  onChange={e => setDraft(v => ({ ...v, rut: e.target.value }))}
                  placeholder="RUT"
                  className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[9px] text-gray-400 block mb-0.5">Venc. C.I.</label>
                    <input
                      type="date"
                      value={draftGov.id_expiry ?? ''}
                      onChange={e => setDraftGov(v => ({ ...v, id_expiry: e.target.value || null }))}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-400 block mb-0.5">Venc. Licencia</label>
                    <input
                      type="date"
                      value={draftGov.license_expiry ?? ''}
                      onChange={e => setDraftGov(v => ({ ...v, license_expiry: e.target.value || null }))}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2">Documentación</p>
                <div className="space-y-1.5">
                  {DRIVER_DOC_LABELS.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 w-36 shrink-0">{label}</span>
                      <GovernanceSelect
                        value={draftGov[key as keyof typeof draftGov] as ComplianceStatus | null}
                        onChange={v => setDraftGov(prev => ({ ...prev, [key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Guardar
              </button>
              <button
                type="button"
                onClick={onToggleExpand}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Mobile driver card ───────────────────────────────────────────
function MobileDriverCard({
  driver, canEdit, canAdmin, expanded, onToggleExpand, onPatch, onRemove, onTransferClick,
}: {
  driver: TransporterDriver
  canEdit: boolean
  canAdmin: boolean
  expanded: boolean
  onToggleExpand: () => void
  onPatch: (body: { rut?: string; name?: string; governance?: DriverGovernance }) => Promise<void>
  onRemove: () => Promise<void>
  onTransferClick: () => void
}) {
  const [draft, setDraft]       = useState({ rut: driver.rut, name: driver.name })
  const [draftGov, setDraftGov] = useState<Partial<DriverGovernance>>({
    id_expiry:         driver.governance?.id_expiry         ?? null,
    license_expiry:    driver.governance?.license_expiry    ?? null,
    anexo_3_gc:   driver.governance?.anexo_3_gc   ?? null,
    epp:               driver.governance?.epp               ?? null,
    das_odi:           driver.governance?.das_odi           ?? null,
    hoja_de_vida:      driver.governance?.hoja_de_vida      ?? null,
    cert_antecedentes: driver.governance?.cert_antecedentes ?? null,
    validado_gc_driver:  driver.governance?.validado_gc_driver  ?? null,
    contrato_trabajo:  driver.governance?.contrato_trabajo  ?? null,
    creacion_gc_driver:  driver.governance?.creacion_gc_driver  ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  useEffect(() => {
    setDraft({ rut: driver.rut, name: driver.name })
    setDraftGov({
      id_expiry:         driver.governance?.id_expiry         ?? null,
      license_expiry:    driver.governance?.license_expiry    ?? null,
      anexo_3_gc:   driver.governance?.anexo_3_gc   ?? null,
      epp:               driver.governance?.epp               ?? null,
      das_odi:           driver.governance?.das_odi           ?? null,
      hoja_de_vida:      driver.governance?.hoja_de_vida      ?? null,
      cert_antecedentes: driver.governance?.cert_antecedentes ?? null,
      validado_gc_driver:  driver.governance?.validado_gc_driver  ?? null,
      contrato_trabajo:  driver.governance?.contrato_trabajo  ?? null,
      creacion_gc_driver:  driver.governance?.creacion_gc_driver  ?? null,
    })
  }, [driver])

  const dAlert = getDriverAlertStatus(driver)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      await onPatch({
        rut:        draft.rut,
        name:       draft.name,
        governance: { ...(driver.governance ?? {}), ...draftGov } as DriverGovernance,
      })
      onToggleExpand()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-blue-50/20 transition-colors">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${
            dAlert === 'expired'       ? 'ring-2 ring-red-400' :
            dAlert === 'expiring_soon' ? 'ring-2 ring-amber-300' : ''
          }`}
          style={{ backgroundColor: getInitialColor(driver.name) }}
        >
          {getInitials(driver.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-text-primary leading-tight">{driver.name}</p>
          <p className="text-[11px] font-mono text-gray-400 mt-0.5">{driver.rut}</p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {driver.governance?.id_expiry && (
              <span className="flex items-center gap-1 text-[10px]">
                <span className="text-gray-400">C.I.</span>
                <span className="font-mono text-gray-600">{formatExpiry(driver.governance.id_expiry)}</span>
                <ComplianceBadge status={getAlertStatus(driver.governance.id_expiry)} compact />
              </span>
            )}
            {driver.governance?.license_expiry && (
              <span className="flex items-center gap-1 text-[10px]">
                <span className="text-gray-400">Lic.</span>
                <span className="font-mono text-gray-600">{formatExpiry(driver.governance.license_expiry)}</span>
                <ComplianceBadge status={getAlertStatus(driver.governance.license_expiry)} compact />
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {DRIVER_DOC_LABELS.map(({ key, label }) => {
              const val = driver.governance?.[key as keyof DriverGovernance] as ComplianceStatus | null
              if (!val || val === 'n_a') return null
              const { cls } = COMPLIANCE_CFG[val]
              return <span key={key} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span>
            })}
          </div>
        </div>
        {(canEdit || canAdmin) && (
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className={`p-1.5 rounded-lg border transition-all ${
                    expanded
                      ? 'border-accent bg-accent/5 text-accent'
                      : 'border-border/60 text-gray-400 hover:text-accent hover:border-accent'
                  }`}
                >
                  <PenLine size={13} />
                </button>
                <button type="button" onClick={onRemove} className="p-1.5 text-gray-300 hover:text-red-400 transition-colors">
                  <Trash2 size={12} />
                </button>
              </>
            )}
            {canAdmin && (
              <button
                type="button"
                onClick={onTransferClick}
                title="Transferir a otra empresa"
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-all"
              >
                <ArrowRightLeft size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div className="bg-slate-50 px-4 py-4 border-t border-border/40 space-y-3">
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Datos Conductor</p>
          <input
            value={draft.name}
            onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}
            placeholder="Nombre completo"
            className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
          />
          <input
            value={draft.rut}
            onChange={e => setDraft(v => ({ ...v, rut: e.target.value }))}
            placeholder="RUT"
            className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-gray-400 block mb-0.5">Venc. C.I.</label>
              <input
                type="date"
                value={draftGov.id_expiry ?? ''}
                onChange={e => setDraftGov(v => ({ ...v, id_expiry: e.target.value || null }))}
                className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-400 block mb-0.5">Venc. Licencia</label>
              <input
                type="date"
                value={draftGov.license_expiry ?? ''}
                onChange={e => setDraftGov(v => ({ ...v, license_expiry: e.target.value || null }))}
                className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
              />
            </div>
          </div>
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest pt-1">Documentación</p>
          <div className="space-y-1.5">
            {DRIVER_DOC_LABELS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-36 shrink-0">{label}</span>
                <GovernanceSelect
                  value={draftGov[key as keyof typeof draftGov] as ComplianceStatus | null}
                  onChange={v => setDraftGov(prev => ({ ...prev, [key]: v }))}
                />
              </div>
            ))}
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Guardar
            </button>
            <button
              type="button"
              onClick={onToggleExpand}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Vehicle row ───────────────────────────────────────────────────
function VehicleRow({
  vehicle, canEdit, canAdmin, expanded, onToggleExpand, onPatch, onRemove, onTransferClick,
}: {
  vehicle: TransporterVehicle
  canEdit: boolean
  canAdmin: boolean
  expanded: boolean
  onToggleExpand: () => void
  onPatch: (body: { type?: string; plate?: string; governance?: VehicleGovernance }) => Promise<void>
  onRemove: () => Promise<void>
  /** undefined en ramplas: no hay endpoint de transferencia para trailers (plan §4.2, alcance) */
  onTransferClick?: () => void
}) {
  const [draft, setDraft]       = useState({ type: vehicle.type, plate: vehicle.plate })
  const [draftGov, setDraftGov] = useState<Partial<VehicleGovernance>>({
    year:                   vehicle.governance?.year                   ?? null,
    circ_permit_expiry:     vehicle.governance?.circ_permit_expiry     ?? null,
    tech_inspection_expiry: vehicle.governance?.tech_inspection_expiry ?? null,
    gas_emissions_expiry:   vehicle.governance?.gas_emissions_expiry   ?? null,
    soap_insurance_expiry:  vehicle.governance?.soap_insurance_expiry  ?? null,
    padron:                 vehicle.governance?.padron                 ?? null,
    poliza_rc:              vehicle.governance?.poliza_rc              ?? null,
    gps:                    vehicle.governance?.gps                    ?? null,
    seguro_carga:           vehicle.governance?.seguro_carga           ?? null,
    mantencion_camara_frio: vehicle.governance?.mantencion_camara_frio ?? null,
    creacion_gc_vehicle:       vehicle.governance?.creacion_gc_vehicle       ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  useEffect(() => {
    setDraft({ type: vehicle.type, plate: vehicle.plate })
    setDraftGov({
      year:                   vehicle.governance?.year                   ?? null,
      circ_permit_expiry:     vehicle.governance?.circ_permit_expiry     ?? null,
      tech_inspection_expiry: vehicle.governance?.tech_inspection_expiry ?? null,
      gas_emissions_expiry:   vehicle.governance?.gas_emissions_expiry   ?? null,
      soap_insurance_expiry:  vehicle.governance?.soap_insurance_expiry  ?? null,
      padron:                 vehicle.governance?.padron                 ?? null,
      poliza_rc:              vehicle.governance?.poliza_rc              ?? null,
      gps:                    vehicle.governance?.gps                    ?? null,
      seguro_carga:           vehicle.governance?.seguro_carga           ?? null,
      mantencion_camara_frio: vehicle.governance?.mantencion_camara_frio ?? null,
      creacion_gc_vehicle:       vehicle.governance?.creacion_gc_vehicle       ?? null,
    })
  }, [vehicle])

  const vAlert = getVehicleAlertStatus(vehicle)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      await onPatch({
        type:       draft.type,
        plate:      draft.plate,
        governance: { ...(vehicle.governance ?? {}), ...draftGov } as VehicleGovernance,
      })
      onToggleExpand()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr className="border-b border-border/60 last:border-0 hover:bg-blue-50/20 transition-colors">
        {/* Equipo */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-black bg-slate-800 text-white px-2.5 py-0.5 rounded-lg font-mono shadow-sm whitespace-nowrap">
              {vehicle.plate}
            </span>
            {vAlert !== 'ok' && <ComplianceBadge status={vAlert} compact />}
          </div>
          {vehicle.type && <span className="text-[10px] text-gray-400 mt-0.5 block truncate max-w-[120px]">{vehicle.type}</span>}
        </td>

        {/* Tipo — categoría derivada (tracto/rampla/camion/furgon/otro) */}
        <td className="px-2 py-2.5">
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {VEHICLE_CATEGORY_LABELS[vehicleCategory(vehicle.type)]}
          </span>
        </td>

        {/* Padrón */}
        <td className="px-2 py-2.5 text-center">
          <GovernanceStatusBadge status={vehicle.governance?.padron ?? null} />
        </td>

        {/* P. Circ. */}
        <td className="px-2 py-2.5">
          {vehicle.governance?.circ_permit_expiry ? (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[10px] font-mono text-gray-600">{formatExpiry(vehicle.governance.circ_permit_expiry)}</span>
              <ComplianceBadge status={getAlertStatus(vehicle.governance.circ_permit_expiry)} compact />
            </div>
          ) : <span className="text-gray-200 text-[10px]">—</span>}
        </td>

        {/* Re. Téc. */}
        <td className="px-2 py-2.5">
          {vehicle.governance?.tech_inspection_expiry ? (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[10px] font-mono text-gray-600">{formatExpiry(vehicle.governance.tech_inspection_expiry)}</span>
              <ComplianceBadge status={getAlertStatus(vehicle.governance.tech_inspection_expiry)} compact />
            </div>
          ) : <span className="text-gray-200 text-[10px]">—</span>}
        </td>

        {/* Gases */}
        <td className="px-2 py-2.5">
          {vehicle.governance?.gas_emissions_expiry ? (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[10px] font-mono text-gray-600">{formatExpiry(vehicle.governance.gas_emissions_expiry)}</span>
              <ComplianceBadge status={getAlertStatus(vehicle.governance.gas_emissions_expiry)} compact />
            </div>
          ) : <span className="text-gray-200 text-[10px]">—</span>}
        </td>

        {/* SOAP */}
        <td className="px-2 py-2.5">
          {vehicle.governance?.soap_insurance_expiry ? (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-[10px] font-mono text-gray-600">{formatExpiry(vehicle.governance.soap_insurance_expiry)}</span>
              <ComplianceBadge status={getAlertStatus(vehicle.governance.soap_insurance_expiry)} compact />
            </div>
          ) : <span className="text-gray-200 text-[10px]">—</span>}
        </td>

        {/* Póliza RC */}
        <td className="px-2 py-2.5 text-center">
          <GovernanceStatusBadge status={vehicle.governance?.poliza_rc ?? null} />
        </td>

        {/* Año */}
        <td className="px-2 py-2.5 text-center">
          <span className="text-[10px] font-mono text-gray-600">
            {vehicle.governance?.year ?? <span className="text-gray-200">—</span>}
          </span>
        </td>

        {/* GPS */}
        <td className="px-2 py-2.5 text-center">
          <GovernanceStatusBadge status={vehicle.governance?.gps ?? null} />
        </td>

        {/* Seg. Carga */}
        <td className="px-2 py-2.5 text-center">
          <GovernanceStatusBadge status={vehicle.governance?.seguro_carga ?? null} />
        </td>

        {/* Cám. Frío */}
        <td className="px-2 py-2.5 text-center">
          <GovernanceStatusBadge status={vehicle.governance?.mantencion_camara_frio ?? null} />
        </td>

        {/* Creación GC */}
        <td className="px-2 py-2.5 text-center">
          <GovernanceStatusBadge status={vehicle.governance?.creacion_gc_vehicle ?? null} />
        </td>

        {/* Edit */}
        <td className="px-2 py-2.5">
          {(canEdit || (canAdmin && onTransferClick)) && (
            <div className="flex items-center gap-1">
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={onToggleExpand}
                    title="Editar equipo"
                    className={`p-1.5 rounded-lg border transition-all ${
                      expanded
                        ? 'border-accent bg-accent/5 text-accent'
                        : 'border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5'
                    }`}
                  >
                    <PenLine size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={onRemove}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
              {canAdmin && onTransferClick && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  title="Transferir a otra empresa"
                  className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 transition-all"
                >
                  <ArrowRightLeft size={12} />
                </button>
              )}
            </div>
          )}
        </td>
      </tr>

      {/* Expandable edit form */}
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={14} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2">Datos Tracto</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-gray-400 uppercase block mb-0.5">Tipo</label>
                    <select
                      value={draft.type}
                      onChange={e => setDraft(v => ({ ...v, type: e.target.value }))}
                      className="w-full text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                    >
                      <option value="">—</option>
                      {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-400 uppercase block mb-0.5">Patente</label>
                    <input
                      value={draft.plate}
                      onChange={e => setDraft(v => ({ ...v, plate: e.target.value.toUpperCase() }))}
                      className="w-full text-sm font-mono border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white uppercase"
                    />
                  </div>
                </div>
                <div className="pt-1">
                  <label className="text-[9px] text-gray-400 uppercase block mb-0.5">Año</label>
                  <input
                    type="number"
                    min={1990} max={2030}
                    value={draftGov.year ?? ''}
                    onChange={e => setDraftGov(v => ({ ...v, year: e.target.value ? parseInt(e.target.value) : null }))}
                    placeholder="2020"
                    className="w-full text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {VEHICLE_EXPIRY_LABELS.map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-[9px] text-gray-400 block mb-0.5">{label}</label>
                      <input
                        type="date"
                        value={draftGov[key] ?? ''}
                        onChange={e => setDraftGov(v => ({ ...v, [key]: e.target.value || null }))}
                        className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2">Documentación</p>
                <div className="space-y-1.5">
                  {VEHICLE_DOC_LABELS.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 w-36 shrink-0">{label}</span>
                      <GovernanceSelect
                        value={draftGov[key as keyof typeof draftGov] as ComplianceStatus | null}
                        onChange={v => setDraftGov(prev => ({ ...prev, [key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Guardar
              </button>
              <button
                type="button"
                onClick={onToggleExpand}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Mobile vehicle card ──────────────────────────────────────────
function MobileVehicleCard({
  vehicle, canEdit, canAdmin, expanded, onToggleExpand, onPatch, onRemove, onTransferClick,
}: {
  vehicle: TransporterVehicle
  canEdit: boolean
  canAdmin: boolean
  expanded: boolean
  onToggleExpand: () => void
  onPatch: (body: { type?: string; plate?: string; governance?: VehicleGovernance }) => Promise<void>
  onRemove: () => Promise<void>
  onTransferClick?: () => void
}) {
  const [draft, setDraft]       = useState({ type: vehicle.type, plate: vehicle.plate })
  const [draftGov, setDraftGov] = useState<Partial<VehicleGovernance>>({
    year:                   vehicle.governance?.year                   ?? null,
    circ_permit_expiry:     vehicle.governance?.circ_permit_expiry     ?? null,
    tech_inspection_expiry: vehicle.governance?.tech_inspection_expiry ?? null,
    gas_emissions_expiry:   vehicle.governance?.gas_emissions_expiry   ?? null,
    soap_insurance_expiry:  vehicle.governance?.soap_insurance_expiry  ?? null,
    padron:                 vehicle.governance?.padron                 ?? null,
    poliza_rc:              vehicle.governance?.poliza_rc              ?? null,
    gps:                    vehicle.governance?.gps                    ?? null,
    seguro_carga:           vehicle.governance?.seguro_carga           ?? null,
    mantencion_camara_frio: vehicle.governance?.mantencion_camara_frio ?? null,
    creacion_gc_vehicle:       vehicle.governance?.creacion_gc_vehicle       ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  useEffect(() => {
    setDraft({ type: vehicle.type, plate: vehicle.plate })
    setDraftGov({
      year:                   vehicle.governance?.year                   ?? null,
      circ_permit_expiry:     vehicle.governance?.circ_permit_expiry     ?? null,
      tech_inspection_expiry: vehicle.governance?.tech_inspection_expiry ?? null,
      gas_emissions_expiry:   vehicle.governance?.gas_emissions_expiry   ?? null,
      soap_insurance_expiry:  vehicle.governance?.soap_insurance_expiry  ?? null,
      padron:                 vehicle.governance?.padron                 ?? null,
      poliza_rc:              vehicle.governance?.poliza_rc              ?? null,
      gps:                    vehicle.governance?.gps                    ?? null,
      seguro_carga:           vehicle.governance?.seguro_carga           ?? null,
      mantencion_camara_frio: vehicle.governance?.mantencion_camara_frio ?? null,
      creacion_gc_vehicle:       vehicle.governance?.creacion_gc_vehicle       ?? null,
    })
  }, [vehicle])

  const vAlert = getVehicleAlertStatus(vehicle)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      await onPatch({
        type:       draft.type,
        plate:      draft.plate,
        governance: { ...(vehicle.governance ?? {}), ...draftGov } as VehicleGovernance,
      })
      onToggleExpand()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-blue-50/20 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black bg-slate-800 text-white px-2.5 py-0.5 rounded-lg font-mono shadow-sm">
              {vehicle.plate}
            </span>
            {vehicle.type && <span className="text-xs text-gray-500">{vehicle.type}</span>}
            {vAlert !== 'ok' && <ComplianceBadge status={vAlert} compact />}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
            {VEHICLE_EXPIRY_LABELS.map(({ key, label }) => {
              const expiry = vehicle.governance?.[key]
              if (!expiry) return null
              return (
                <div key={key} className="flex items-center gap-1 text-[10px]">
                  <span className="text-gray-400 w-14 shrink-0">{label}</span>
                  <span className="font-mono text-gray-600">{formatExpiry(expiry)}</span>
                  <ComplianceBadge status={getAlertStatus(expiry)} compact />
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {VEHICLE_DOC_LABELS.map(({ key, label }) => {
              const val = vehicle.governance?.[key as keyof VehicleGovernance] as ComplianceStatus | null
              if (!val || val === 'n_a') return null
              const { cls } = COMPLIANCE_CFG[val]
              return <span key={key} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span>
            })}
            {vehicle.governance?.year && (
              <span className="text-[9px] font-mono text-gray-400 px-1.5 py-0.5 border border-border/60 rounded-full">
                {vehicle.governance.year}
              </span>
            )}
          </div>
        </div>
        {(canEdit || (canAdmin && onTransferClick)) && (
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={onToggleExpand}
                  className={`p-1.5 rounded-lg border transition-all ${
                    expanded
                      ? 'border-accent bg-accent/5 text-accent'
                      : 'border-border/60 text-gray-400 hover:text-accent hover:border-accent'
                  }`}
                >
                  <PenLine size={13} />
                </button>
                <button type="button" onClick={onRemove} className="p-1.5 text-gray-300 hover:text-red-400 transition-colors">
                  <Trash2 size={12} />
                </button>
              </>
            )}
            {canAdmin && onTransferClick && (
              <button
                type="button"
                onClick={onTransferClick}
                title="Transferir a otra empresa"
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent transition-all"
              >
                <ArrowRightLeft size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div className="bg-slate-50 px-4 py-4 border-t border-border/40 space-y-3">
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Datos Tracto</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-gray-400 uppercase block mb-0.5">Tipo</label>
              <select
                value={draft.type}
                onChange={e => setDraft(v => ({ ...v, type: e.target.value }))}
                className="w-full text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
              >
                <option value="">—</option>
                {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-gray-400 uppercase block mb-0.5">Patente</label>
              <input
                value={draft.plate}
                onChange={e => setDraft(v => ({ ...v, plate: e.target.value.toUpperCase() }))}
                className="w-full text-sm font-mono border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white uppercase"
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] text-gray-400 uppercase block mb-0.5">Año</label>
            <input
              type="number"
              min={1990} max={2030}
              value={draftGov.year ?? ''}
              onChange={e => setDraftGov(v => ({ ...v, year: e.target.value ? parseInt(e.target.value) : null }))}
              placeholder="2020"
              className="w-full text-sm border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {VEHICLE_EXPIRY_LABELS.map(({ key, label }) => (
              <div key={key}>
                <label className="text-[9px] text-gray-400 block mb-0.5">{label}</label>
                <input
                  type="date"
                  value={draftGov[key] ?? ''}
                  onChange={e => setDraftGov(v => ({ ...v, [key]: e.target.value || null }))}
                  className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                />
              </div>
            ))}
          </div>
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest pt-1">Documentación</p>
          <div className="space-y-1.5">
            {VEHICLE_DOC_LABELS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-36 shrink-0">{label}</span>
                <GovernanceSelect
                  value={draftGov[key as keyof typeof draftGov] as ComplianceStatus | null}
                  onChange={v => setDraftGov(prev => ({ ...prev, [key]: v }))}
                />
              </div>
            ))}
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Guardar
            </button>
            <button
              type="button"
              onClick={onToggleExpand}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Editable field ────────────────────────────────────────────────
function EditableField({
  label, value, field, isProtected, canEdit, onSave, onReset, options,
}: {
  label: string; value: string | null; field: string
  isProtected: boolean; canEdit: boolean
  onSave: (field: string, val: string) => Promise<void>
  onReset: (field: string) => Promise<void>
  options?: string[]
}) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value ?? '')
  const [saving, setSaving]     = useState(false)
  const [fieldErr, setFieldErr] = useState<string | null>(null)

  const handleSave = async () => {
    if (draft === (value ?? '')) { setEditing(false); return }
    setSaving(true); setFieldErr(null)
    try { await onSave(field, draft); setEditing(false) }
    catch (e) { setFieldErr(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div className="py-3 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 w-32 shrink-0">{label}</span>
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            {options ? (
              <select
                className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              >
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                autoFocus
              />
            )}
            <button onClick={handleSave} disabled={saving}
              className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button onClick={() => { setEditing(false); setFieldErr(null) }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-text-primary flex-1 truncate">
              {value || <span className="text-gray-300 italic">sin datos</span>}
            </span>
            {isProtected && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 shrink-0">Protegido</span>
            )}
            {canEdit && (
              <button
                onClick={() => { setDraft(value ?? ''); setEditing(true) }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 shrink-0"
              >
                <PenLine size={13} />
              </button>
            )}
            {isProtected && canEdit && (
              <button
                onClick={async () => { setSaving(true); try { await onReset(field) } finally { setSaving(false) } }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 shrink-0"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </button>
            )}
          </div>
        )}
      </div>
      {fieldErr && <p className="text-xs text-red-500 mt-1 pl-[9.5rem]">{fieldErr}</p>}
    </div>
  )
}

// ── Contactos (app.transporter_contacts) ───────────────────────────
const CONTACT_ROLE_LABELS: Record<TransporterContact['role'], string> = {
  rep_legal:   'Representante legal',
  operacional: 'Operacional',
  finanzas:    'Finanzas',
  documentos:  'Documentos',
}

function ContactsSection({ contacts, tp }: { contacts: TransporterContact[]; tp: TransporterProfile }) {
  const byRole = new Map(contacts.map(c => [c.role, c]))
  const roles = Object.keys(CONTACT_ROLE_LABELS) as TransporterContact['role'][]
  const hasAny = contacts.some(c => c.name || c.phone || c.email)

  if (!hasAny) {
    // Fallback legacy: contactability (emails/phones sueltos) — igual que antes
    const emails = tp.contactability?.emails ?? []
    const phones = tp.contactability?.phones ?? []
    if (emails.length === 0 && phones.length === 0) return null
    return (
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Contactabilidad</h3>
        <div className="flex flex-wrap gap-1.5">
          {emails.map(e => <span key={e} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e}</span>)}
          {phones.map(p => <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p}</span>)}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Contactos</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {roles.map(role => {
          const c = byRole.get(role)
          return (
            <div key={role} className="border border-border/60 rounded-lg p-2.5">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">{CONTACT_ROLE_LABELS[role]}</p>
              {c?.name || c?.phone || c?.email ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{c.name ?? <span className="text-gray-300 italic">sin nombre</span>}</p>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent">
                      <Phone size={10} /> {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent truncate">
                      <Mail size={10} /> <span className="truncate">{c.email}</span>
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-300 italic">Sin datos</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmpresaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tp, setTp]               = useState<TransporterProfile | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [canEdit, setCanEdit]     = useState(false)
  const [canAdmin, setCanAdmin]   = useState(false)
  const [editOpen, setEditOpen]   = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('conductores')

  const [expandedDriver,  setExpandedDriver]  = useState<string | null>(null)
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null)
  const [driverQ,         setDriverQ]         = useState('')
  const [vehicleQ,        setVehicleQ]        = useState('')
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<VehicleCategory | 'todos'>('todos')

  const [addDriverOpen,  setAddDriverOpen]  = useState(false)
  const [driverForm,     setDriverForm]     = useState({ rut: '', name: '' })
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [vehicleForm,    setVehicleForm]    = useState({ type: '', plate: '' })
  const [submitting,     setSubmitting]     = useState(false)

  const [transferTarget, setTransferTarget] = useState<
    { kind: 'driver' | 'vehicle'; id: string; label: string } | null
  >(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setTp(await transportersApi.get(id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error cargando datos') }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSaveField = async (field: string, value: string) => {
    setTp(await transportersApi.patch(id, { [field]: value }))
  }
  const handleResetField = async (field: string) => {
    await transportersApi.resetField(id, field); await load()
  }

  const handleAddDriver = async () => {
    if (!driverForm.rut || !driverForm.name) return
    setSubmitting(true)
    try {
      await transportersApi.addDriver(id, driverForm)
      setDriverForm({ rut: '', name: '' })
      setAddDriverOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handlePatchDriver = async (did: string, body: { rut?: string; name?: string; governance?: DriverGovernance }) => {
    const res = await transportersApi.patchDriver(id, did, body)
    setTp(prev => prev ? { ...prev, drivers: prev.drivers.map(d => d.id === did ? res.data : d) } : prev)
  }

  const handleRemoveDriver = async (did: string) => {
    await transportersApi.removeDriver(id, did); await load()
  }

  const handleAddVehicle = async () => {
    if (!vehicleForm.plate) return
    setSubmitting(true)
    try {
      await transportersApi.addVehicle(id, vehicleForm)
      setVehicleForm({ type: '', plate: '' })
      setAddVehicleOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handlePatchVehicle = async (vid: string, body: { type?: string; plate?: string; governance?: VehicleGovernance }) => {
    const res = await transportersApi.patchVehicle(id, vid, body)
    setTp(prev => prev ? { ...prev, vehicles: prev.vehicles.map(v => v.id === vid ? res.data : v) } : prev)
  }

  const handleRemoveVehicle = async (vid: string) => {
    try {
      await transportersApi.removeVehicle(id, vid)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar equipo')
    }
  }

  const handleRemoveTrailer = async (trid: string) => {
    try {
      await transportersApi.removeTrailer(id, trid)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar rampla')
    }
  }

  const handleConfirmTransfer = async (toTransporterId: string) => {
    if (!transferTarget) return
    try {
      if (transferTarget.kind === 'driver') {
        await transportersApi.transferDriver(id, transferTarget.id, toTransporterId)
      } else {
        await transportersApi.transferVehicle(id, transferTarget.id, toTransporterId)
      }
      setTransferTarget(null)
      await load()
    } catch (e) {
      // Se relanza para que TransferModal muestre el error junto a la acción
      throw e
    }
  }

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Cargando…
    </div>
  )
  if (error || !tp) return (
    <div className="p-6 text-sm text-red-500">
      {error ?? 'No encontrado'}
      <Link href="/dashboard/transportistas" className="block mt-2 text-accent hover:underline text-xs">← Volver</Link>
    </div>
  )

  const protected_      = new Set(tp.manually_edited_fields)
  const initColor       = getInitialColor(tp.business_name)
  const initials        = getInitials(tp.business_name)

  const driverAlerts    = tp.drivers.filter(d => getDriverAlertStatus(d) !== 'ok')
  const vehicleAlerts   = tp.vehicles.filter(v => getVehicleAlertStatus(v) !== 'ok')
  const expiredDrivers  = driverAlerts.filter(d => getDriverAlertStatus(d) === 'expired').length
  const expiredVehicles = vehicleAlerts.filter(v => getVehicleAlertStatus(v) === 'expired').length

  const filteredDrivers = tp.drivers.filter(d =>
    !driverQ || d.name.toLowerCase().includes(driverQ.toLowerCase()) || d.rut.includes(driverQ)
  )

  // Equipos: tractos/camiones/furgones (con gobernanza completa) + ramplas
  // (sin gobernanza en el contrato actual) unificados para el filtro de Tipo.
  const allEquipment: (TransporterVehicle & { isTrailer: boolean })[] = [
    ...tp.vehicles.map(v => ({ ...v, isTrailer: false })),
    ...tp.trailers.map(t => ({ id: t.id, type: 'Rampla', plate: t.plate, governance: null, isTrailer: true })),
  ]
  const filteredVehicles = allEquipment.filter(v => {
    const matchesQ = !vehicleQ ||
      v.plate.toLowerCase().includes(vehicleQ.toLowerCase()) ||
      (v.type ?? '').toLowerCase().includes(vehicleQ.toLowerCase())
    const matchesType = vehicleTypeFilter === 'todos' || vehicleCategory(v.type) === vehicleTypeFilter
    return matchesQ && matchesType
  })

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'conductores', label: 'Conductores', count: tp.drivers.length },
    { key: 'equipos',     label: 'Equipos',     count: tp.vehicles.length + tp.trailers.length },
  ]

  return (
    <div className="p-4 md:p-6 space-y-5 relative">
      {editOpen && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setEditOpen(false)} />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors shrink-0">Empresas</Link>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium truncate">{tp.business_name ?? id}</span>
      </nav>

      {/* Company Header + Seguros */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div
              className="w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center font-bold text-lg md:text-xl text-white shrink-0 shadow-sm"
              style={{ backgroundColor: initColor }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <EligibilityDot
                  eligible={tp.eligibility.eligible}
                  blockingReasons={tp.eligibility.blocking_reasons}
                  compliancePct={tp.eligibility.compliance_pct}
                  size="md"
                />
                <h1 className="font-mulish font-black text-xl md:text-2xl text-text-primary leading-tight">
                  {tp.business_name ?? '—'}
                </h1>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 pl-4">
                {describeEligibility(tp.eligibility.eligible, tp.eligibility.blocking_reasons, tp.eligibility.compliance_pct)}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {tp.rut && (
                  <p className="text-xs text-gray-500">
                    RUT: <span className="font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-border/60">{tp.rut}</span>
                  </p>
                )}
                {tp.account_stage && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {tp.account_stage}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  tp.in_admin ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tp.in_admin ? 'En admin' : 'No registrada en admin'}
                </span>
                {tp.clients.map(c => (
                  <span key={c} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{c}</span>
                ))}
                {(expiredDrivers > 0 || expiredVehicles > 0) && (
                  <span className="inline-flex items-center gap-1 text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-2 py-0.5">
                    <AlertTriangle size={11} />
                    {expiredDrivers > 0 && `${expiredDrivers} cond.`}
                    {expiredDrivers > 0 && expiredVehicles > 0 && ' · '}
                    {expiredVehicles > 0 && `${expiredVehicles} veh.`}
                    {' '}vencido{expiredDrivers + expiredVehicles > 1 ? 's' : ''}
                  </span>
                )}
                {driverAlerts.length === 0 && vehicleAlerts.length === 0 && tp.drivers.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-100 rounded-lg px-2 py-0.5">
                    <ShieldCheck size={11} />
                    Documentación al día
                  </span>
                )}
              </div>

              {/* Documentos de la empresa — inline collapsible */}
              <TransporterDocumentsPanel
                tid={tp.id}
                documents={tp.documents}
                canEdit={canEdit}
                onDocumentsChange={docs => setTp(prev => prev ? { ...prev, documents: docs } : prev)}
              />
            </div>
          </div>

          {canEdit && (
            <button
              onClick={() => setEditOpen(true)}
              className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold transition border border-border shadow-sm shrink-0"
            >
              Editar Empresa
            </button>
          )}
        </div>
      </div>

      <InsuranceSummaryCard transporterId={tp.id} rut={tp.rut} />
      </div>

      <ContactsSection contacts={tp.contacts} tp={tp} />

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-border overflow-hidden shadow-sm">
        {/* Tab nav */}
        <div className="flex border-b border-border bg-gray-50">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-5 py-3.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === t.key
                  ? 'border-accent text-accent bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                activeTab === t.key ? 'bg-accent/10 text-accent' : 'bg-gray-200 text-gray-500'
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── CONDUCTORES TAB ── */}
        {activeTab === 'conductores' && (
          <div>
            <div className="px-5 py-3 border-b border-border bg-white flex items-center justify-between gap-3 flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  value={driverQ}
                  onChange={e => setDriverQ(e.target.value)}
                  placeholder="Filtrar por nombre o RUT…"
                  className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
                />
              </div>
              <div className="flex items-center gap-2">
                {driverAlerts.length > 0 && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    expiredDrivers > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {driverAlerts.length} con alerta
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => setAddDriverOpen(v => !v)}
                    className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
                  >
                    + Conductor
                  </button>
                )}
              </div>
            </div>

            {addDriverOpen && (
              <div className="px-5 py-3 border-b border-border bg-gray-50/80 flex items-center gap-2">
                <input
                  placeholder="RUT"
                  value={driverForm.rut}
                  onChange={e => setDriverForm(v => ({ ...v, rut: e.target.value }))}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-32"
                />
                <input
                  placeholder="Nombre completo"
                  value={driverForm.name}
                  onChange={e => setDriverForm(v => ({ ...v, name: e.target.value }))}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 flex-1"
                />
                <button
                  onClick={handleAddDriver}
                  disabled={submitting || !driverForm.rut || !driverForm.name}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
                </button>
                <button onClick={() => setAddDriverOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* ── Mobile: driver cards ─────────────────────────────── */}
            <div className="md:hidden divide-y divide-border/60">
              {filteredDrivers.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-gray-300">
                  {driverQ ? 'Sin resultados' : 'Sin conductores registrados'}
                </p>
              )}
              {filteredDrivers.map(d => (
                <MobileDriverCard
                  key={d.id}
                  driver={d}
                  canEdit={canEdit}
                  canAdmin={canAdmin}
                  expanded={expandedDriver === d.id}
                  onToggleExpand={() => setExpandedDriver(prev => prev === d.id ? null : d.id)}
                  onPatch={body => handlePatchDriver(d.id, body)}
                  onRemove={() => handleRemoveDriver(d.id)}
                  onTransferClick={() => setTransferTarget({ kind: 'driver', id: d.id, label: `conductor ${d.name}` })}
                />
              ))}
            </div>

            {/* ── Desktop: table ───────────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 680 }}>
                <thead>
                  <tr className="bg-slate-800 text-[11px] font-semibold text-white uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Conductor</th>
                    <th className="px-4 py-3 text-left">Vencimientos</th>
                    <th className="px-4 py-3 text-left">Documentación</th>
                    <th className="px-3 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {filteredDrivers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-300">
                        {driverQ ? 'Sin resultados' : 'Sin conductores registrados'}
                      </td>
                    </tr>
                  )}
                  {filteredDrivers.map(d => (
                    <DriverRow
                      key={d.id}
                      driver={d}
                      canEdit={canEdit}
                      canAdmin={canAdmin}
                      expanded={expandedDriver === d.id}
                      onToggleExpand={() => setExpandedDriver(prev => prev === d.id ? null : d.id)}
                      onPatch={body => handlePatchDriver(d.id, body)}
                      onRemove={() => handleRemoveDriver(d.id)}
                      onTransferClick={() => setTransferTarget({ kind: 'driver', id: d.id, label: `conductor ${d.name}` })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── EQUIPOS TAB ── */}
        {activeTab === 'equipos' && (
          <div>
            <div className="px-5 py-3 border-b border-border bg-white flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    value={vehicleQ}
                    onChange={e => setVehicleQ(e.target.value)}
                    placeholder="Filtrar por patente o tipo…"
                    className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
                  />
                </div>
                <select
                  value={vehicleTypeFilter}
                  onChange={e => setVehicleTypeFilter(e.target.value as VehicleCategory | 'todos')}
                  className="text-sm border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                >
                  <option value="todos">Todos los tipos</option>
                  {(Object.keys(VEHICLE_CATEGORY_LABELS) as VehicleCategory[]).map(cat => (
                    <option key={cat} value={cat}>{VEHICLE_CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                {vehicleAlerts.length > 0 && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    expiredVehicles > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {vehicleAlerts.length} con alerta
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => setAddVehicleOpen(v => !v)}
                    className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
                  >
                    + Equipo
                  </button>
                )}
              </div>
            </div>

            {addVehicleOpen && (
              <div className="px-5 py-3 border-b border-border bg-gray-50/80 flex items-center gap-2">
                <select
                  value={vehicleForm.type}
                  onChange={e => setVehicleForm(v => ({ ...v, type: e.target.value }))}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-36 bg-white"
                >
                  <option value="">Tipo…</option>
                  {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  placeholder="Patente"
                  value={vehicleForm.plate}
                  onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value }))}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-24 font-mono uppercase"
                />
                <button
                  onClick={handleAddVehicle}
                  disabled={submitting || !vehicleForm.plate}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
                </button>
                <button onClick={() => setAddVehicleOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* ── Mobile: vehicle cards ─────────────────────────────── */}
            <div className="md:hidden divide-y divide-border/60">
              {filteredVehicles.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-gray-300">
                  {vehicleQ ? 'Sin resultados' : 'Sin equipos registrados'}
                </p>
              )}
              {filteredVehicles.map(v => (
                <MobileVehicleCard
                  key={v.id}
                  vehicle={v}
                  canEdit={canEdit}
                  canAdmin={canAdmin}
                  expanded={expandedVehicle === v.id}
                  onToggleExpand={() => setExpandedVehicle(prev => prev === v.id ? null : v.id)}
                  onPatch={body => handlePatchVehicle(v.id, body)}
                  onRemove={() => v.isTrailer ? handleRemoveTrailer(v.id) : handleRemoveVehicle(v.id)}
                  onTransferClick={v.isTrailer ? undefined : () => setTransferTarget({ kind: 'vehicle', id: v.id, label: `equipo ${v.plate}` })}
                />
              ))}
            </div>

            {/* ── Desktop: table ───────────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 1080 }}>
                <thead>
                  <tr className="bg-slate-800 text-[9px] font-semibold text-white uppercase tracking-wide">
                    <th className="px-3 py-2.5 text-left w-32">Equipo</th>
                    <th className="px-2 py-2.5 text-left w-20">Tipo</th>
                    <th className="px-2 py-2.5 text-center w-20">Padrón</th>
                    <th className="px-2 py-2.5 text-left w-24">P. Circ.</th>
                    <th className="px-2 py-2.5 text-left w-24">Re. Téc.</th>
                    <th className="px-2 py-2.5 text-left w-24">Gases</th>
                    <th className="px-2 py-2.5 text-left w-24">SOAP</th>
                    <th className="px-2 py-2.5 text-center w-20">Póliza RC</th>
                    <th className="px-2 py-2.5 text-center w-14">Año</th>
                    <th className="px-2 py-2.5 text-center w-20">GPS</th>
                    <th className="px-2 py-2.5 text-center w-20">Seg. Carga</th>
                    <th className="px-2 py-2.5 text-center w-20">Cám. Frío</th>
                    <th className="px-2 py-2.5 text-center w-24">Creación GC</th>
                    <th className="px-2 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {filteredVehicles.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-4 py-10 text-center text-sm text-gray-300">
                        {vehicleQ ? 'Sin resultados' : 'Sin equipos registrados'}
                      </td>
                    </tr>
                  )}
                  {filteredVehicles.map(v => (
                    <VehicleRow
                      key={v.id}
                      vehicle={v}
                      canEdit={canEdit}
                      canAdmin={canAdmin}
                      expanded={expandedVehicle === v.id}
                      onToggleExpand={() => setExpandedVehicle(prev => prev === v.id ? null : v.id)}
                      onPatch={body => handlePatchVehicle(v.id, body)}
                      onRemove={() => v.isTrailer ? handleRemoveTrailer(v.id) : handleRemoveVehicle(v.id)}
                      onTransferClick={v.isTrailer ? undefined : () => setTransferTarget({ kind: 'vehicle', id: v.id, label: `equipo ${v.plate}` })}
                    />
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}
      </div>

      {/* ── Edit Slide-Over ── */}
      <div
        className={`
          fixed inset-y-0 right-0 z-50
          w-full sm:w-[440px]
          bg-white border-l border-border shadow-2xl flex flex-col
          transition-transform duration-300
          ${editOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="px-5 py-4 bg-slate-900 flex items-center justify-between shrink-0">
          <h3 className="text-base font-bold text-white">Editar Datos Empresa</h3>
          <button onClick={() => setEditOpen(false)} className="text-white/50 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Admin ID</span>
            <span className="text-sm font-mono text-gray-500">{tp.admin_id ?? '—'}</span>
          </div>
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Transporter ID</span>
            <span className="text-xs font-mono text-gray-400 select-all break-all">{tp.id}</span>
          </div>

          {([
            { label: 'Razón Social', field: 'business_name', value: tp.business_name },
            { label: 'RUT',          field: 'rut',           value: tp.rut },
            { label: 'Estado',       field: 'account_stage', value: tp.account_stage, options: ACCOUNT_STAGES },
          ] as const).map(f => (
            <EditableField
              key={f.field}
              label={f.label}
              value={f.value ?? null}
              field={f.field}
              isProtected={protected_.has(f.field)}
              canEdit={canEdit}
              onSave={handleSaveField}
              onReset={handleResetField}
              options={'options' in f ? f.options : undefined}
            />
          ))}

          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Contactabilidad</h2>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Emails</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.emails ?? []).length > 0
                  ? tp.contactability!.emails.map(e => (
                      <span key={e} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin emails</span>}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Teléfonos</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.phones ?? []).length > 0
                  ? tp.contactability!.phones.map(p => (
                      <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin teléfonos</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TransferModal
        open={!!transferTarget}
        title={transferTarget ? `Transferir ${transferTarget.label}` : 'Transferir'}
        currentTransporterId={id}
        onClose={() => setTransferTarget(null)}
        onTransfer={handleConfirmTransfer}
      />
    </div>
  )
}
