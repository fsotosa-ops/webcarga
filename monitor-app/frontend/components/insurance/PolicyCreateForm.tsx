'use client'

import { Check, Loader2, X } from 'lucide-react'

export type PolicyFormState = {
  insurance_company: string; policy_number: string
  valid_from: string; valid_to: string
  has_endorsement: boolean; endorsement_number: string
}

/** Formulario de alta de póliza — expone los mismos campos que soporta
 *  InsurancePolicyCreateBody (insurance_company/policy_number/valid_from/
 *  valid_to), no solo aseguradora+número. El plazo de "Por vencer" ya no es
 *  por póliza: es uno solo, en la base (Seguros E1, 15/10). Antes el
 *  formulario dejaba vigencia/alerta de vencimiento sin setear al crear,
 *  aunque el modelo real de datos (y el estado calculado de la póliza)
 *  depende de esos campos — una póliza recién creada quedaba "incompleta"
 *  respecto al resto. Reusado en el quick-add del sidebar y en el estado
 *  vacío (sin pólizas todavía). */
export function PolicyCreateForm({ form, onChange, onSubmit, onCancel, submitting, error, compact = false }: {
  form: PolicyFormState
  onChange: (form: PolicyFormState) => void
  onSubmit: () => void
  onCancel: () => void
  submitting: boolean
  error?: string | null
  compact?: boolean
}) {
  const inputCls = compact
    ? 'w-full text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30'
    : 'w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/30'
  const labelCls = 'text-etiqueta text-informativo'
  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <input
        placeholder="Aseguradora"
        value={form.insurance_company}
        onChange={e => onChange({ ...form, insurance_company: e.target.value })}
        className={inputCls}
      />
      <input
        placeholder="N° de póliza"
        value={form.policy_number}
        onChange={e => onChange({ ...form, policy_number: e.target.value })}
        className={inputCls}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className={labelCls}>Vigencia desde</label>
          <input type="date" aria-label="Vigencia desde" value={form.valid_from}
            onChange={e => onChange({ ...form, valid_from: e.target.value })} className={inputCls} />
        </div>
        <div className="space-y-0.5">
          <label className={labelCls}>Vigencia hasta</label>
          <input type="date" aria-label="Vigencia hasta" value={form.valid_to}
            onChange={e => onChange({ ...form, valid_to: e.target.value })} className={inputCls} />
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-informativo cursor-pointer">
        <input type="checkbox" checked={form.has_endorsement}
          onChange={e => onChange({ ...form, has_endorsement: e.target.checked })} />
        Tiene endoso
      </label>
      {form.has_endorsement && (
        <input
          placeholder="N° de endoso"
          value={form.endorsement_number}
          onChange={e => onChange({ ...form, endorsement_number: e.target.value })}
          className={inputCls}
        />
      )}
      {error && <p className="text-xs text-status-incidente">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={submitting || !form.insurance_company}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-50 ${
            compact ? 'flex-1 px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
          }`}
        >
          {submitting ? <Loader2 size={compact ? 12 : 13} className="animate-spin" /> : <Check size={compact ? 12 : 13} />}
          Guardar
        </button>
        <button onClick={onCancel} className={compact ? 'p-1.5 text-informativo hover:text-text-primary' : 'text-sm text-informativo hover:text-text-primary px-2'}>
          {compact ? <X size={14} /> : 'Cancelar'}
        </button>
      </div>
    </div>
  )
}
