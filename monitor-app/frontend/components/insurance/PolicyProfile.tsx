'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCheck, X } from 'lucide-react'
import { insuranceApi, type PolicyDetail } from '@/lib/api/insurance'
import { coverageTypesApi, policiesApi } from '@/lib/api/policies'
import { carriersApi } from '@/lib/api/carriers'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { fechaCorta, installmentsSummaryStyle, policyStateStyle } from '@/lib/states'
import { returnLink } from '@/lib/navegacion/directory'
import { POLICIES, policyHref } from '@/lib/navegacion/insurance'
import { hoyEnChile } from '@/lib/utils/datetime'
import type { ActionsMenuItem } from '@/components/ui/ActionsMenu'
import { Estado } from '@/components/ui/Estado'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { ProfileHeader } from '@/components/directory/ProfileHeader'
import { DetailsBlock, type DetailRow } from '@/components/directory/DetailsBlock'
import { AsidePanel, ProfileLayout } from '@/components/directory/ProfileLayout'
import { EntityCell } from '@/components/dashboard/EntityCell'
import { InstallmentsTable, PayInstallmentsDialog } from './InstallmentsTable'
import { PolicyFileRow } from './PolicyFileRow'

type Dialog = 'pay' | 'renew' | 'extend' | 'cancel' | 'delete' | 'installments' | null

const INPUT = 'w-full rounded-lg border border-border px-2.5 py-1.5 text-dato focus:outline-none focus:ring-2 focus:ring-accent/20'
const nombre = (p: { insurance_company: string; policy_number: string | null }) =>
  `${p.insurance_company}${p.policy_number ? ` · ${p.policy_number}` : ''}`
const masUnAno = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4, 10)}`

/**
 * La ficha de una póliza (Seguros E2, 15/10): la forma de las fichas nuevas. Al
 * centro, lo que se trabaja (cuotas y documentos); al costado, los datos
 * (detalles, coberturas, equipos cubiertos, historial de vigencia). El estado lo
 * calcula la base. Renovar y extender están habilitados los dos, a validar con
 * el negocio.
 */
export function PolicyProfile({ id }: { id: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const back = returnLink(searchParams.get('next'))
  const queryClient = useQueryClient()
  const canEdit = usePermiso('policies.edit')
  const canDelete = usePermiso('policies.delete')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const detail = useQuery({ queryKey: ['insurance', 'policy', id], queryFn: () => insuranceApi.get(id), retry: false })
  const p = detail.data
  const proponer = !!p && p.policy_state === 'EXPIRED' && !p.renewed_by_policy_id
  const candidates = useQuery({
    queryKey: ['insurance', 'policy', id, 'candidates'], queryFn: () => insuranceApi.renewalCandidates(id), enabled: proponer,
  })
  const coverageTypes = useQuery({ queryKey: ['coverage-types'], queryFn: () => coverageTypesApi.list(), enabled: canEdit })
  const carrierAssets = useQuery({
    queryKey: ['carrier-assets', p?.carrier_id], queryFn: () => carriersApi.listAssets(p!.carrier_id), enabled: canEdit && !!p,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['insurance'] })
  async function act(fn: () => Promise<unknown>, done?: string) {
    setActionError(null)
    try { await fn(); await refresh(); if (done) setNotice(done) } catch (e) {
      setActionError(e instanceof Error ? e.message : 'No se pudo completar la acción')
    }
  }

  if (detail.isError) {
    const status = (detail.error as { status?: number })?.status
    return status === 404
      ? <Estado tipo="vacio" titulo="No se encontró la póliza"><Link href={POLICIES} className="text-accion hover:underline">Volver a Pólizas</Link></Estado>
      : <Estado tipo="error" titulo="No se pudo abrir la póliza" detalle="Reintenta en unos segundos." />
  }
  if (!p) return <Estado tipo="cargando" />

  const overdue = p.installments.filter(i => i.installment_state === 'OVERDUE')
  const unpaid = p.installments.filter(i => i.installment_state !== 'PAID')
  const chips = [
    policyStateStyle(p),
    ...(p.installments.length ? [installmentsSummaryStyle({ overdue: overdue.length, unpaid: unpaid.length })] : []),
  ]
  const closed = p.policy_state === 'CANCELLED' || p.policy_state === 'RENEWED'
  const menuItems: ActionsMenuItem[] = [
    ...(canEdit && !closed ? [
      { id: 'renew', label: 'Renovar', onSelect: () => setDialog('renew') },
      { id: 'extend', label: 'Extender vigencia', onSelect: () => setDialog('extend') },
      { id: 'cancel', label: 'Cancelar póliza', destructive: true, onSelect: () => setDialog('cancel') },
    ] : []),
    ...(canDelete ? [{ id: 'delete', label: 'Eliminar', destructive: true, onSelect: () => setDialog('delete') }] : []),
  ]
  const toPay = overdue.length ? overdue : unpaid.slice(0, 1)

  const rows: DetailRow[] = [
    { label: 'Aseguradora', value: p.insurance_company },
    { label: 'N° de póliza', value: p.policy_number ?? <span className="text-informativo">Sin número</span> },
    { label: 'Vigencia', value: p.valid_from || p.valid_to
      ? `${p.valid_from ? fechaCorta(p.valid_from) : '…'} – ${p.valid_to ? fechaCorta(p.valid_to) : '…'}`
      : <span className="text-informativo">Sin fechas</span> },
    { label: 'Empresa', value: <EntityCell kind="carrier" id={p.carrier_id} label={p.carrier_name} /> },
    { label: 'Endoso', value: p.endorsement_number ?? <span className="text-informativo">Sin endoso</span> },
    { label: 'Portal', value: p.external_portal_url
      ? <a href={p.external_portal_url} target="_blank" rel="noreferrer" className="text-accion hover:underline">Abrir</a>
      : <span className="text-informativo">Sin enlace</span> },
    ...(p.renews_policy_id ? [{ label: 'Renueva a', value: <Link href={policyHref(p.renews_policy_id)} className="text-accion hover:underline">la póliza anterior</Link> }] : []),
    ...(p.renewed_by_policy_id ? [{ label: 'Renovada por', value: <Link href={policyHref(p.renewed_by_policy_id)} className="text-accion hover:underline">la póliza nueva</Link> }] : []),
    ...(p.cancelled_reason ? [{ label: 'Cancelada', value: p.cancelled_reason }] : []),
  ]
  const availableCoverages = (coverageTypes.data ?? []).filter(c => !p.coverages.some(x => x.coverage_type_id === c.id))
  const availableAssets = (carrierAssets.data ?? []).filter(a => !p.assets.some(x => x.asset_id === a.id))

  return (
    <div className="space-y-5 p-4 md:p-6">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1.5 text-dato font-semibold text-accion hover:underline">
          <ArrowLeft size={14} aria-hidden="true" />{back.label}
        </Link>
      )}
      <nav aria-label="Ruta" className="flex items-center gap-1.5 text-xs text-informativo">
        Seguros <span aria-hidden>›</span> <Link href={POLICIES} className="hover:text-accion">Pólizas</Link>
        <span aria-hidden>›</span> <span className="font-semibold text-text-primary">{nombre(p)}</span>
      </nav>

      <ProfileHeader
        title={nombre(p)}
        chips={chips}
        reason={null}
        onSeeDocuments={() => {}}
        primaryAction={canEdit && toPay.length ? (
          <button type="button" onClick={() => setDialog('pay')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-dato font-semibold text-white hover:bg-accent/90">
            <CheckCheck size={14} aria-hidden="true" /> Registrar pago
          </button>
        ) : undefined}
        menuItems={menuItems}
      />
      {notice && <p role="status" className="text-dato text-resuelto">{notice}</p>}
      {actionError && <p role="alert" className="text-dato text-status-incidente">{actionError}</p>}

      {proponer && candidates.data && candidates.data.length > 0 && canEdit && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-dato">
          {candidates.data.map(c => (
            <span key={c.id} className="flex flex-wrap items-center gap-3">
              <span>¿La reemplazó {nombre(c)}, que empezó el {fechaCorta(c.valid_from)}?</span>
              <button type="button" onClick={() => void act(() => insuranceApi.renewedBy(id, c.id), 'Listo: quedó como renovada.')}
                      className="font-semibold text-accion hover:underline">
                Sí, enlazar
              </button>
            </span>
          ))}
        </div>
      )}

      <ProfileLayout aside={<>
        <DetailsBlock rows={rows} canEdit={canEdit && !closed}
                      renderForm={close => <PolicyEditForm policy={p} onClose={close} onSaved={refresh} />} />
        <AsidePanel title="Coberturas">
          <ChipList items={p.coverages.map(c => ({ id: c.coverage_type_id, label: c.name }))} empty="Sin coberturas" canEdit={canEdit}
                    onRemove={cid => void act(() => policiesApi.unlinkCoverage(id, cid))} />
          {canEdit && availableCoverages.length > 0 && (
            <AddSelect label="Agregar cobertura" options={availableCoverages.map(c => ({ id: c.id, label: c.name }))}
                       onAdd={cid => void act(() => policiesApi.linkCoverage(id, cid))} />
          )}
        </AsidePanel>
        <AsidePanel title="Equipos cubiertos">
          <ChipList items={p.assets.map(a => ({ id: a.asset_id, label: a.license_plate }))} empty="Sin equipos cubiertos" canEdit={canEdit}
                    onRemove={aid => void act(() => policiesApi.unlinkAsset(id, aid))} mono />
          {canEdit && availableAssets.length > 0 && (
            <AddSelect label="Agregar equipo" options={availableAssets.map(a => ({ id: a.id, label: a.license_plate }))}
                       onAdd={aid => void act(() => policiesApi.linkAsset(id, aid))} />
          )}
        </AsidePanel>
        {p.term_changes.length > 0 && (
          <AsidePanel title="Historial de vigencia">
            <ul className="space-y-2 text-dato">
              {p.term_changes.map(t => (
                <li key={t.changed_at}>
                  Extendida al {fechaCorta(t.new_valid_to)}
                  <span className="text-informativo">
                    {t.previous_valid_to ? ` (antes ${fechaCorta(t.previous_valid_to)})` : ''}
                    {t.endorsement_number ? ` · endoso ${t.endorsement_number}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </AsidePanel>
        )}
      </>}>
        <div className="space-y-4">
          <Panel title="Cuotas" action={canEdit && !closed && (
            <button type="button" onClick={() => setDialog('installments')} className="text-dato font-semibold text-accion hover:underline">
              {p.installments.length ? '+ Agregar cuotas' : 'Generar calendario'}
            </button>
          )}>
            {p.installments.length
              ? <InstallmentsTable rows={p.installments} />
              : <Estado tipo="vacio" titulo="Esta póliza no tiene cuotas cargadas" />}
          </Panel>
          <Panel title="Documentos">
            <div className="overflow-hidden rounded-md border border-border">
              <PolicyFileRow label="Póliza" url={p.policy_document_url} canEdit={canEdit}
                             onUpload={f => act(() => policiesApi.uploadFile(id, f, 'document'))}
                             onDelete={() => act(() => policiesApi.deleteFile(id, 'document'))} />
              <PolicyFileRow label="Endoso" detail={p.endorsement_number ?? undefined} url={p.endorsement_document_url} canEdit={canEdit}
                             onUpload={f => act(() => policiesApi.uploadFile(id, f, 'endorsement'))}
                             onDelete={() => act(() => policiesApi.deleteFile(id, 'endorsement'))} />
            </div>
          </Panel>
        </div>
      </ProfileLayout>

      {dialog === 'pay' && (
        <PayInstallmentsDialog rows={toPay} onClose={() => setDialog(null)}
                               onDone={async errs => { setDialog(null); setActionError(errs.length ? errs.map(e => e.error).join(' · ') : null); await refresh() }} />
      )}
      {dialog === 'renew' && <RenewDialog policy={p} onClose={() => setDialog(null)}
        onDone={nueva => { setDialog(null); router.push(policyHref(nueva.id)) }} />}
      {dialog === 'extend' && <ExtendDialog policy={p} onClose={() => setDialog(null)}
        onDone={async () => { setDialog(null); setNotice('Listo: la vigencia quedó extendida.'); await refresh() }} />}
      {dialog === 'cancel' && <CancelDialog policy={p} onClose={() => setDialog(null)}
        onDone={async () => { setDialog(null); await refresh() }} />}
      {dialog === 'installments' && <InstallmentsDialog policy={p} onClose={() => setDialog(null)}
        onDone={async () => { setDialog(null); await refresh() }} />}
      {dialog === 'delete' && <DeleteDialog policy={p} onClose={() => setDialog(null)}
        onDone={async () => { await refresh(); router.push(POLICIES) }} />}
    </div>
  )
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-2xl border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lectura font-bold text-text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function ChipList({ items, empty, canEdit, onRemove, mono = false }: {
  items: { id: string; label: string }[]; empty: string; canEdit: boolean; onRemove: (id: string) => void; mono?: boolean
}) {
  if (!items.length) return <p className="text-dato text-informativo">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => (
        <span key={i.id} className={`inline-flex items-center gap-1 rounded-full bg-bg-main px-2 py-0.5 text-etiqueta font-semibold text-text-primary ${mono ? 'font-identificador' : ''}`}>
          {i.label}
          {canEdit && (
            <button type="button" aria-label={`Quitar ${i.label}`} onClick={() => onRemove(i.id)} className="text-informativo hover:text-status-incidente">
              <X size={10} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

function AddSelect({ label, options, onAdd }: { label: string; options: { id: string; label: string }[]; onAdd: (id: string) => void }) {
  return (
    <select aria-label={label} value="" onChange={e => { if (e.target.value) onAdd(e.target.value) }}
            className="mt-2 rounded-lg border border-border px-2 py-1 text-etiqueta focus:outline-none focus:ring-2 focus:ring-accent/20">
      <option value="">+ {label}…</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="text-etiqueta text-informativo">{label}</span>{children}</label>
}

/** Un formulario de la ficha en el panel lateral, con su error a la vista. */
function FormDialog({ title, confirm, onClose, onConfirm, disabled, destructive = false, children }: {
  title: string; confirm: string; onClose: () => void; onConfirm: () => Promise<void>; disabled?: boolean
  destructive?: boolean; children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setBusy(true); setError(null)
    try { await onConfirm() } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar') } finally { setBusy(false) }
  }
  return (
    <PanelLateral titulo={title} onCerrar={onClose} pie={
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-dato font-semibold text-informativo">Volver</button>
        <button type="button" onClick={() => void go()} disabled={busy || disabled}
                className={`rounded-md px-3 py-1.5 text-dato font-semibold text-white disabled:opacity-50 ${destructive ? 'bg-status-incidente hover:bg-status-incidente/90' : 'bg-accent hover:bg-accent/90'}`}>
          {confirm}
        </button>
      </div>
    }>
      <div className="space-y-3 p-4">
        {children}
        {error && <p role="alert" className="text-dato text-status-incidente">{error}</p>}
      </div>
    </PanelLateral>
  )
}

function PolicyEditForm({ policy, onClose, onSaved }: { policy: PolicyDetail; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({
    insurance_company: policy.insurance_company, policy_number: policy.policy_number ?? '',
    valid_from: policy.valid_from ?? '', valid_to: policy.valid_to ?? '',
    endorsement_number: policy.endorsement_number ?? '', external_portal_url: policy.external_portal_url ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setError(null)
    try {
      await policiesApi.patch(policy.id, {
        insurance_company: f.insurance_company, policy_number: f.policy_number || undefined,
        valid_from: f.valid_from || undefined, valid_to: f.valid_to || undefined,
        endorsement_number: f.endorsement_number || undefined, has_endorsement: !!f.endorsement_number || undefined,
        external_portal_url: f.external_portal_url || undefined, expected_updated_at: policy.updated_at ?? undefined,
      })
      await onSaved(); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  return (
    <div className="space-y-2">
      <Field label="Aseguradora"><input className={INPUT} value={f.insurance_company} onChange={set('insurance_company')} /></Field>
      <Field label="N° de póliza"><input className={INPUT} value={f.policy_number} onChange={set('policy_number')} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Desde"><input type="date" className={INPUT} value={f.valid_from} onChange={set('valid_from')} /></Field>
        <Field label="Hasta"><input type="date" className={INPUT} value={f.valid_to} onChange={set('valid_to')} /></Field>
      </div>
      <Field label="N° de endoso"><input className={INPUT} value={f.endorsement_number} onChange={set('endorsement_number')} /></Field>
      <Field label="Portal de la aseguradora"><input className={INPUT} value={f.external_portal_url} onChange={set('external_portal_url')} /></Field>
      {error && <p role="alert" className="text-dato text-status-incidente">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => void save()} disabled={!f.insurance_company.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-dato font-semibold text-white disabled:opacity-50">Guardar</button>
        <button type="button" onClick={onClose} className="px-2 text-dato text-informativo">Cancelar</button>
      </div>
    </div>
  )
}

function RenewDialog({ policy, onClose, onDone }: { policy: PolicyDetail; onClose: () => void; onDone: (p: PolicyDetail) => void }) {
  const desde = policy.valid_to ?? hoyEnChile()
  const [f, setF] = useState({ insurance_company: policy.insurance_company, policy_number: '', valid_from: desde, valid_to: masUnAno(desde) })
  return (
    <FormDialog title="Renovar póliza" confirm="Crear la renovación" onClose={onClose}
                disabled={!f.insurance_company.trim() || !f.valid_from || f.valid_to <= f.valid_from}
                onConfirm={async () => onDone(await insuranceApi.renew(policy.id, {
                  valid_from: f.valid_from, valid_to: f.valid_to,
                  policy_number: f.policy_number || undefined, insurance_company: f.insurance_company,
                }))}>
      <p className="text-dato text-informativo">La póliza nueva copia coberturas y equipos cubiertos. Esta queda como renovada.</p>
      <Field label="Aseguradora"><input className={INPUT} value={f.insurance_company} onChange={e => setF(v => ({ ...v, insurance_company: e.target.value }))} /></Field>
      <Field label="N° de la póliza nueva"><input className={INPUT} value={f.policy_number} onChange={e => setF(v => ({ ...v, policy_number: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Desde"><input type="date" className={INPUT} value={f.valid_from} onChange={e => setF(v => ({ ...v, valid_from: e.target.value }))} /></Field>
        <Field label="Hasta"><input type="date" className={INPUT} value={f.valid_to} onChange={e => setF(v => ({ ...v, valid_to: e.target.value }))} /></Field>
      </div>
    </FormDialog>
  )
}

function ExtendDialog({ policy, onClose, onDone }: { policy: PolicyDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ valid_to: policy.valid_to ? masUnAno(policy.valid_to) : '', endorsement_number: '', endorsement_date: hoyEnChile() })
  return (
    <FormDialog title="Extender vigencia" confirm="Extender" onClose={onClose}
                disabled={!f.valid_to || (!!policy.valid_to && f.valid_to <= policy.valid_to)}
                onConfirm={async () => { await insuranceApi.extend(policy.id, {
                  valid_to: f.valid_to, endorsement_number: f.endorsement_number || undefined, endorsement_date: f.endorsement_date || undefined,
                }); await onDone() }}>
      <p className="text-dato text-informativo">
        Vigente hasta {policy.valid_to ? fechaCorta(policy.valid_to) : 'sin fecha'}. La prórroga queda en el historial de la póliza.
      </p>
      <Field label="Nueva fecha de término"><input type="date" className={INPUT} value={f.valid_to} onChange={e => setF(v => ({ ...v, valid_to: e.target.value }))} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="N° de endoso"><input className={INPUT} value={f.endorsement_number} onChange={e => setF(v => ({ ...v, endorsement_number: e.target.value }))} /></Field>
        <Field label="Fecha del endoso"><input type="date" className={INPUT} value={f.endorsement_date} onChange={e => setF(v => ({ ...v, endorsement_date: e.target.value }))} /></Field>
      </div>
    </FormDialog>
  )
}

function CancelDialog({ policy, onClose, onDone }: { policy: PolicyDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('')
  return (
    <FormDialog title="Cancelar póliza" confirm="Cancelar la póliza" destructive onClose={onClose} disabled={reason.trim().length < 3}
                onConfirm={async () => { await insuranceApi.cancel(policy.id, reason.trim()); await onDone() }}>
      <p className="text-dato text-informativo">La póliza deja de contar para la empresa. Sus cuotas quedan en el historial.</p>
      <Field label="Motivo"><input className={INPUT} value={reason} onChange={e => setReason(e.target.value)} /></Field>
    </FormDialog>
  )
}

function InstallmentsDialog({ policy, onClose, onDone }: { policy: PolicyDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const hay = policy.installments.length > 0
  const [f, setF] = useState({ count: hay ? '1' : '12', amount_uf: '', first_due_date: '' })
  return (
    <FormDialog title={hay ? 'Agregar cuotas' : 'Generar calendario'} confirm={hay ? 'Agregar' : 'Generar'} onClose={onClose}
                disabled={!f.amount_uf || !f.first_due_date || Number(f.count) < 1}
                onConfirm={async () => {
                  // Una sola forma de crear cuotas: el calendario nuevo empieza en la 1.
                  await insuranceApi.appendInstallments(policy.id, { count: Number(f.count), amount_uf: Number(f.amount_uf), first_due_date: f.first_due_date })
                  await onDone()
                }}>
      <p className="text-dato text-informativo">Cuotas mensuales, todas dentro de la vigencia de la póliza.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="N° de cuotas"><input type="number" min={1} max={60} className={INPUT} value={f.count} onChange={e => setF(v => ({ ...v, count: e.target.value }))} /></Field>
        <Field label="Monto UF c/u"><input type="number" min={0} step="0.01" className={INPUT} value={f.amount_uf} onChange={e => setF(v => ({ ...v, amount_uf: e.target.value }))} /></Field>
      </div>
      <Field label="Primera fecha de vencimiento"><input type="date" className={INPUT} value={f.first_due_date} onChange={e => setF(v => ({ ...v, first_due_date: e.target.value }))} /></Field>
    </FormDialog>
  )
}

function DeleteDialog({ policy, onClose, onDone }: { policy: PolicyDetail; onClose: () => void; onDone: () => Promise<void> }) {
  return (
    <FormDialog title="Eliminar póliza" confirm="Eliminar" destructive onClose={onClose}
                onConfirm={async () => { await policiesApi.delete(policy.id); await onDone() }}>
      <p className="text-dato">Se borran la póliza {nombre(policy)}, sus cuotas y sus archivos. Si solo dejó de estar vigente, cancélala en su lugar.</p>
    </FormDialog>
  )
}

