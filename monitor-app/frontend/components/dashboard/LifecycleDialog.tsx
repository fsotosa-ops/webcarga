'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CamposDeMotivo } from '@/components/ui/CamposDeMotivo'
import { FIELD_LABEL, Field, inputClass } from '@/components/ui/Field'
import { eleccionCompleta, useReasons, type EleccionDeMotivo } from '@/hooks/useReasons'
import type { LifecycleAction, LifecycleBody, LifecycleScope } from '@/lib/api/lifecycle'
import type { CarrierDeactivationImpact } from '@/lib/types'
import { hoyEnChile } from '@/lib/utils/datetime'

export type FleetItem = { id: string; label: string }

interface Props {
  /** `activate` activa una empresa en onboarding (lo hace Certificación, 28/10): con
   *  `exception`, una que no cumple los obligatorios (motivo y fecha de compromiso);
   *  sin ella, una que cumple (solo la fecha desde la que rige). */
  action:    LifecycleAction
  exception?: boolean
  /** A quién se le cambia el estado: filtra los motivos que le aplican. */
  scope:     LifecycleScope
  /** Cómo se nombra en el título: "conductor Juan Pérez", "esta empresa". */
  label:     string
  onClose:   () => void
  onConfirm: (body: LifecycleBody) => Promise<void>
  /** Dar de baja una empresa (D2, P4): lo que toca, antes de confirmar.
   *  `undefined` = no aplica; `null` = todavía cargando. */
  impact?:   CarrierDeactivationImpact | null
  /** Reactivar una empresa (D2, P3): qué flota vuelve con ella. Todo viene marcado;
   *  lo que se desmarca sale de su roster hoy y queda en el historial. */
  fleet?:    { drivers: FleetItem[]; assets: FleetItem[] }
  /** Activar como excepción: lo que le falta ("2 obligatorios de la empresa"). */
  pending?:  string
}

const TEXTO = {
  deactivate: {
    title: 'Dar de baja', confirm: 'Confirmar baja', error: 'Error al dar de baja',
    domain: 'DEACTIVATION_REASON', sinMotivos: 'No hay motivos de baja activos: agrégalos en Configuración › Directorio.',
  },
  reactivate: {
    title: 'Reactivar', confirm: 'Reactivar', error: 'Error al reactivar',
    domain: 'REACTIVATION_REASON', sinMotivos: 'No hay motivos de reactivación activos: agrégalos en Configuración › Directorio.',
  },
  activate_exception: {
    title: 'Activar como excepción', confirm: 'Activar', error: 'Error al activar',
    domain: 'ACTIVATION_EXCEPTION_REASON',
    sinMotivos: 'No hay motivos de activación excepcional activos: agrégalos en Configuración › Directorio.',
  },
  activate: {
    title: 'Activar', confirm: 'Activar', error: 'Error al activar', domain: null, sinMotivos: '',
  },
  return_to_onboarding: {
    title: 'Volver a onboarding', confirm: 'Volver a onboarding', error: 'Error al volver a onboarding',
    domain: 'RETURN_TO_ONBOARDING_REASON',
    sinMotivos: 'No hay motivos para volver a onboarding activos: agrégalos en Configuración › Directorio.',
  },
} as const

/** `YYYY-MM-DD` más `n` días, sin pasar por la hora local. */
function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Qué pide cada acción, además del motivo: la fecha desde la que rige (activar rige
 *  por defecto desde mañana, para no entrar al Cierre del día en que se habilita) y,
 *  en la excepción, hasta cuándo la carpeta tiene que quedar completa. */
const DATES: Partial<Record<keyof typeof TEXTO, { effectiveOffset: number; commitment: boolean }>> = {
  activate: { effectiveOffset: 1, commitment: false },
  activate_exception: { effectiveOffset: 1, commitment: true },
  return_to_onboarding: { effectiveOffset: 0, commitment: false },
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`
}

/** Dar de baja o reactivar una empresa, un conductor o un equipo, con motivo.
 *
 *  Es la única ventana de cambio de estado del Directorio (plan 2026-10-21): el motivo
 *  sale del catálogo de Configuración y queda en la ficha y en la auditoría. Dar de
 *  baja una empresa muestra antes lo que toca; reactivarla deja elegir qué flota
 *  vuelve. Una variante es una prop, no un componente hermano. */
export function LifecycleDialog({ action, exception, scope, label, onClose, onConfirm, impact, fleet, pending }: Props) {
  const variant = action === 'activate' && exception ? 'activate_exception' : action
  const t = TEXTO[variant]
  const dates = DATES[variant]
  const { motivos, cargando } = useReasons(t.domain ?? 'DEACTIVATION_REASON', { noteCode: 'OTHER', scope, enabled: t.domain !== null })
  const [eleccion, setEleccion] = useState<EleccionDeMotivo>({ motivoId: '', nota: '' })
  const today = hoyEnChile()
  const [effective, setEffective] = useState(() => plusDays(today, dates?.effectiveOffset ?? 0))
  const [commitment, setCommitment] = useState('')
  const datesOk = !dates || (effective >= today && (!dates.commitment || (commitment !== '' && commitment >= effective)))
  const reasonOk = t.domain === null || eleccionCompleta(motivos, eleccion)
  const [kept, setKept] = useState<Set<string>>(
    () => new Set([...(fleet?.drivers ?? []), ...(fleet?.assets ?? [])].map(i => i.id)))
  const loadingImpact = impact === null

  function toggle(id: string) {
    setKept(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const group = (title: string, items: FleetItem[]) => (
    <fieldset className="space-y-1">
      <legend className={`${FIELD_LABEL} mb-1`}>{title}</legend>
      {items.length === 0 && <p className="text-dato text-informativo">Sin {title.toLowerCase()} en su roster.</p>}
      {items.map(i => (
        <label key={i.id} className="flex items-center gap-2 text-dato text-text-primary">
          <input type="checkbox" checked={kept.has(i.id)} onChange={() => toggle(i.id)} className="accent-accent" />
          {i.label}
        </label>
      ))}
    </fieldset>
  )

  return (
    <ConfirmDialog
      title={`${t.title}: ${label}`}
      confirmLabel={t.confirm}
      tone={action === 'deactivate' ? 'danger' : 'primary'}
      confirmDisabled={loadingImpact || !reasonOk || !datesOk}
      errorFallback={t.error}
      onConfirm={() => onConfirm({
        ...(t.domain !== null ? { reason_id: eleccion.motivoId, note: eleccion.nota.trim() || undefined } : {}),
        ...(dates ? { effective_date: effective } : {}),
        ...(dates?.commitment ? { exception_until: commitment } : {}),
        ...(fleet ? {
          driver_ids: fleet.drivers.filter(d => kept.has(d.id)).map(d => d.id),
          asset_ids:  fleet.assets.filter(a => kept.has(a.id)).map(a => a.id),
        } : {}),
      })}
      onClose={onClose}
    >
      <p className="text-informativo">
        {{
          deactivate: 'Deja de operar y de contar en los pendientes. Se puede reactivar en cualquier momento.',
          activate_exception: `No cumple los obligatorios para activarla${pending ? `: faltan ${pending}` : ''}. Queda activa como excepción, con el motivo registrado, hasta la fecha de compromiso. Si a esa fecha su carpeta no está completa, vuelve sola a onboarding.`,
          activate: 'Su carpeta está completa. Entra a la operación y al Cierre desde el día que elijas.',
          return_to_onboarding: 'Sale de la operación y del Cierre desde el día que elijas. Su flota queda vinculada. Se activa sola cuando su carpeta cumpla, o la activa Certificación.',
          reactivate: scope === 'carrier'
            ? 'Si su carpeta está completa, vuelve a operar. Si le faltan documentos obligatorios, queda en onboarding y se activa sola cuando cumpla.'
            : 'Vuelve a operar. La habilitación se recalcula: con documentos vencidos no puede tomar viajes hasta regularizarlos.',
        }[variant]}
      </p>

      {t.domain !== null && (
        <div className="space-y-3">
          <CamposDeMotivo
            variante="dialogo" motivos={motivos} cargando={cargando}
            eleccion={eleccion} onChange={setEleccion} sinMotivos={t.sinMotivos}
          />
        </div>
      )}

      {dates && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rige desde" required error={effective < today ? 'No puede ser anterior a hoy.' : undefined}>
            {(id, describedBy) => (
              <input id={id} type="date" min={today} value={effective} aria-describedby={describedBy}
                onChange={e => setEffective(e.target.value)} className={`${inputClass({ invalid: effective < today })} w-full`} />
            )}
          </Field>
          {dates.commitment && (
            <Field label="Carpeta completa a más tardar" required
              error={commitment !== '' && commitment < effective ? 'Tiene que ser desde el día en que rige.' : undefined}>
              {(id, describedBy) => (
                <input id={id} type="date" min={effective} value={commitment} aria-describedby={describedBy}
                  onChange={e => setCommitment(e.target.value)}
                  className={`${inputClass({ invalid: commitment !== '' && commitment < effective })} w-full`} />
              )}
            </Field>
          )}
        </div>
      )}

      {impact !== undefined && (
        <div className="rounded-md border border-border bg-bg-main px-3 py-2 text-dato text-informativo" aria-live="polite">
          {loadingImpact ? (
            <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Calculando qué toca la baja…</span>
          ) : (
            <ul className="space-y-0.5">
              <li>Su flota activa: {plural(impact.drivers, 'conductor', 'conductores')} y {plural(impact.assets, 'equipo', 'equipos')}. Quedan vinculados como historial.</li>
              <li>Viajes de hoy: {impact.trips_today}.</li>
              <li>Días abiertos del Cierre con su flota: {impact.open_closure_days}.</li>
            </ul>
          )}
        </div>
      )}

      {fleet && (
        <>
          <p className="text-informativo">
            Elige qué conductores y equipos vuelven con la empresa. Los que desmarques salen de su roster hoy.
          </p>
          {group('Conductores', fleet.drivers)}
          {group('Equipos', fleet.assets)}
        </>
      )}
    </ConfirmDialog>
  )
}
