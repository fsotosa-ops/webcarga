'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck } from 'lucide-react'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { StatusChip } from '@/components/ui/StatusChip'
import { BarraDeSeleccion } from '@/components/ui/BarraDeSeleccion'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { EntityCell } from '@/components/dashboard/EntityCell'
import { OUTSIDE_VALIDITY_STYLE, fechaCorta, installmentStateStyle } from '@/lib/states'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { hoyEnChile } from '@/lib/utils/datetime'
import { policyHref } from '@/lib/navegacion/insurance'
import { useOpenCarrierInsurance } from './CarrierInsurancePanel'
import { insuranceApi, type InstallmentRow } from '@/lib/api/insurance'

const uf = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} UF`)

/** Cuotas con selección múltiple y "Marcar pagadas…" (Seguros E2). La usan la
 *  ficha de la póliza y Seguros › Cuotas (`showPolicy`, con empresa y póliza). El
 *  estado lo manda la API; aquí solo se pinta. */
export function InstallmentsTable({ rows, showPolicy = false, returnTo, empty, busy = false }: {
  rows: InstallmentRow[]
  showPolicy?: boolean
  returnTo?: string
  /** Lo que se ve sin filas. La tabla sigue montada: un error de pago no se
   *  pierde cuando la cuota que falló sale del filtro. */
  empty?: ReactNode
  /** La lista se está actualizando: no se paga sobre filas que van a cambiar. */
  busy?: boolean
}) {
  const openInsurance = useOpenCarrierInsurance()
  const queryClient = useQueryClient()
  const canEdit = usePermiso('policies.edit')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const label = (r: InstallmentRow) => `cuota ${r.installment_number}${showPolicy ? ` de ${r.insurance_company}` : ''}`
  // En Cuotas se mezclan pólizas: el mensaje dice de cuál es la cuota.
  const cuota = (r: InstallmentRow | undefined) => !r ? 'Cuota' : `Cuota ${r.installment_number}${
    showPolicy ? ` · ${r.insurance_company}${r.policy_number ? ` ${r.policy_number}` : ''}` : ''}`

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['insurance'] })
  // Lo seleccionado cuenta solo mientras está a la vista: al cambiar de filtro o
  // de búsqueda la tabla sigue montada, y una selección vieja pagaría a ciegas.
  const visibles = rows.filter(r => selected.has(r.id) && !r.paid)

  async function undo(r: InstallmentRow) {
    try {
      const res = await insuranceApi.unpay([r.id])
      setErrors(res.errors.map(e => `${cuota(r)}: ${e.error}`))
      await refresh()
    } catch (e) {
      setErrors([`${cuota(r)}: ${e instanceof Error ? e.message : 'No se pudo deshacer el pago'}`])
    }
  }

  return (
    <div className="space-y-2">
      {canEdit && rows.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <BarraDeSeleccion seleccionados={visibles.length} ayuda="Marca las cuotas que se pagaron" onLimpiar={() => setSelected(new Set())}>
            <button type="button" onClick={() => setPaying(true)} disabled={busy}
                    className="inline-flex items-center gap-1.5 text-etiqueta font-semibold text-accion hover:underline disabled:opacity-50">
              <CheckCheck size={13} aria-hidden="true" /> Marcar pagadas…
            </button>
          </BarraDeSeleccion>
        </div>
      )}
      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-status-incidente/30 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">
          {errors.map(e => <p key={e}>{e}</p>)}
        </div>
      )}
      {rows.length === 0 && empty ? empty : (
      <div className="overflow-x-auto rounded-md border border-border bg-white">
        <table className="w-full text-dato">
          <thead>
            <tr className="border-b border-border bg-bg-main">
              {canEdit && <th scope="col" className={`${CABECERA} w-10`}><span className="sr-only">Seleccionar</span></th>}
              {showPolicy && <th scope="col" className={CABECERA}>Empresa</th>}
              {showPolicy && <th scope="col" className={CABECERA}>Póliza</th>}
              <th scope="col" className={`${CABECERA} w-28`}>Cuota</th>
              <th scope="col" className={`${CABECERA} w-28`}>Vence</th>
              <th scope="col" className={`${CABECERA} w-28`}>Monto</th>
              <th scope="col" className={CABECERA}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const s = installmentStateStyle(r)
              return (
                <tr key={r.id} className={`border-b border-border/60 last:border-0 ${selected.has(r.id) ? 'bg-accion/5' : ''}`}>
                  {canEdit && (
                    <td className="px-3 py-2.5">
                      {!r.paid && (
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                               aria-label={`Seleccionar ${label(r)}`} className="accent-accent" />
                      )}
                    </td>
                  )}
                  {showPolicy && <td className="px-3 py-2.5"><EntityCell kind="carrier" id={r.carrier_id} label={r.carrier_name} onOpen={openInsurance} /></td>}
                  {showPolicy && (
                    <td className="px-3 py-2.5">
                      <Link href={policyHref(r.policy_id, returnTo)} prefetch={false} className="text-text-primary hover:text-accent">
                        {r.insurance_company}{r.policy_number && <span className="text-informativo"> · {r.policy_number}</span>}
                      </Link>
                    </td>
                  )}
                  <td className="px-3 py-2.5 tabular-nums">{r.installment_number} de {r.installments_total}</td>
                  <td className="px-3 py-2.5 tabular-nums text-informativo">{r.due_date ? fechaCorta(r.due_date) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">{uf(r.amount_uf)}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
                      {r.outside_validity && <StatusChip tone={OUTSIDE_VALIDITY_STYLE.tone} icon={OUTSIDE_VALIDITY_STYLE.icon}>{OUTSIDE_VALIDITY_STYLE.label}</StatusChip>}
                      {canEdit && r.paid && (
                        <button type="button" onClick={() => void undo(r)} aria-label={`Deshacer pago de la ${label(r)}`}
                                className="text-etiqueta text-informativo hover:text-accion hover:underline">
                          Deshacer
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}
      {paying && (
        <PayInstallmentsDialog
          rows={visibles}
          onClose={() => setPaying(false)}
          onDone={async (errs) => {
            setErrors(errs.map(e => `${cuota(rows.find(r => r.id === e.id))}: ${e.error}`))
            setSelected(new Set())
            setPaying(false)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

/** Pide la fecha de pago (hoy en Chile por defecto) y marca las cuotas en un lote. */
export function PayInstallmentsDialog({ rows, onClose, onDone }: {
  rows: InstallmentRow[]
  onClose: () => void
  onDone: (errors: { id: string; error: string }[]) => void | Promise<void>
}) {
  const [paidOn, setPaidOn] = useState(hoyEnChile())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm() {
    setBusy(true); setError(null)
    try {
      const res = await insuranceApi.pay(rows.map(r => r.id), paidOn)
      await onDone(res.errors)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago')
    } finally {
      setBusy(false)
    }
  }
  return (
    <PanelLateral
      titulo="Registrar pago"
      onCerrar={onClose}
      pie={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-dato font-semibold text-informativo">Cancelar</button>
          <button type="button" onClick={() => void confirm()} disabled={busy || !paidOn || rows.length === 0}
                  className="rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90 disabled:opacity-50">
            Marcar {rows.length} pagada{rows.length === 1 ? '' : 's'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-dato text-informativo">
          {rows.map(r => `Cuota ${r.installment_number}`).join(', ')}
        </p>
        <label className="block space-y-1">
          <span className="text-etiqueta text-informativo">Fecha de pago</span>
          <input type="date" value={paidOn} max={hoyEnChile()} onChange={e => setPaidOn(e.target.value)} aria-label="Fecha de pago"
                 className="w-48 rounded-lg border border-border px-2.5 py-1.5 text-dato" />
        </label>
        {error && <p role="alert" className="text-dato text-status-incidente">{error}</p>}
      </div>
    </PanelLateral>
  )
}
