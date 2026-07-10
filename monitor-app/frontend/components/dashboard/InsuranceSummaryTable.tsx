'use client'

import { ChevronRight, Building2 } from 'lucide-react'
import type { InsuranceSummaryRow } from '@/lib/types'
import { InsuranceStatusBadge } from './InsuranceStatusBadge'
import { formatExpiry } from '@/lib/compliance'

interface Props {
  rows:         InsuranceSummaryRow[]
  selectedRut?: string | null
  onSelect:     (row: InsuranceSummaryRow) => void
  emptyLabel?:  string
}

/** Tabla rollup por empresa del módulo Seguros (GET /insurance/summary) —
 *  plan §4.3. Testeable en aislamiento (sin fetch): recibe `rows` ya cargadas. */
export function InsuranceSummaryTable({ rows, selectedRut, onSelect, emptyLabel = 'Sin resultados' }: Props) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      {/* ── Mobile: cards ─────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-border/60">
        {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-gray-400">{emptyLabel}</p>}
        {rows.map(row => (
          <button
            key={row.rut}
            onClick={() => onSelect(row)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
              selectedRut === row.rut ? 'bg-accent/5' : 'hover:bg-gray-50/70'
            }`}
          >
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${row.insurance_ok ? 'bg-green-500' : 'bg-red-500'}`} />
            <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
              <Building2 size={15} className="text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-text-primary truncate leading-tight">
                {row.business_name ?? <span className="italic text-gray-400">{row.rut}</span>}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{row.rut}</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <InsuranceStatusBadge insuranceOk={row.insurance_ok} policiesCount={row.policies_count} />
                {row.overdue_count > 0 && (
                  <span className="text-[10px] font-semibold text-red-600">{row.overdue_count} vencida{row.overdue_count > 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
            <ChevronRight size={14} className="text-gray-300 shrink-0" />
          </button>
        ))}
      </div>

      {/* ── Desktop: table ────────────────────────────────────── */}
      <table className="hidden md:table w-full text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
            <th className="px-3 py-3 text-center w-8"></th>
            <th className="px-3 py-3 text-left">Empresa</th>
            <th className="px-3 py-3 text-center w-24">Pólizas vigentes</th>
            <th className="px-3 py-3 text-left w-40">Próxima cuota</th>
            <th className="px-3 py-3 text-center w-24">Cuotas vencidas</th>
            <th className="px-3 py-3 text-left w-24">% pagado</th>
            <th className="px-3 py-3 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.rut}
              onClick={() => onSelect(row)}
              className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                selectedRut === row.rut ? 'bg-accent/5' : i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/70'
              }`}
            >
              <td className="px-3 py-3 text-center">
                <span
                  role="img"
                  aria-label={row.insurance_ok ? 'Al día' : 'Con cuotas vencidas'}
                  title={row.insurance_ok ? 'Al día' : 'Con cuotas vencidas'}
                  className={`inline-block w-2.5 h-2.5 rounded-full ${row.insurance_ok ? 'bg-green-500' : 'bg-red-500'}`}
                />
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Building2 size={14} className="text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary truncate leading-tight">
                      {row.business_name ?? <span className="italic text-gray-400">Sin registrar</span>}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono">{row.rut}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{row.policies_count}</span></td>
              <td className="px-3 py-3">
                {row.next_due ? (
                  <span className="text-xs font-mono text-gray-600">
                    {formatExpiry(row.next_due.date)} {row.next_due.amount_uf != null && `· ${row.next_due.amount_uf} UF`}
                  </span>
                ) : <span className="text-[11px] text-gray-300">—</span>}
              </td>
              <td className="px-3 py-3 text-center">
                {row.overdue_count > 0
                  ? <span className="text-sm font-bold text-red-600">{row.overdue_count}</span>
                  : <span className="text-sm text-gray-300">0</span>}
              </td>
              <td className="px-3 py-3">
                <span className="text-xs font-mono text-gray-500">{row.paid_pct != null ? `${row.paid_pct.toFixed(0)}%` : '—'}</span>
              </td>
              <td className="px-3 py-3 text-center">
                <ChevronRight size={15} className="text-gray-300" />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-5 py-14 text-center text-sm text-gray-400">{emptyLabel}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
