'use client'

import type { MouseEvent, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { SEVERITY_ORDER, documentStateStyle, fleetMemberStyle, isCarrierDeactivated, summaryStyle, type ComplianceSummary, type DocumentState } from '@/lib/states'
import { assetHref, driverHref } from '@/lib/navegacion/directory'
import type { CarrierOperationalStatus, OperationalStatus } from '@/lib/types'

export type RosterRow = {
  id: string
  /** Nombre del conductor o patente del equipo. */
  name: string
  /** RUT del conductor o tipo del equipo. */
  detail: string
  operational_status: OperationalStatus
  compliance_summary: ComplianceSummary
}

type Health = DocumentState | ''

/** La flota de una empresa en su ficha (15/10): la misma tabla de Directorio ›
 *  Conductores y Equipos, filtrada por la empresa. Reemplaza la grilla de
 *  tarjetas con avatar y las cinco tarjetas de cifras. El clic abre la ficha del
 *  conductor o equipo en modal (`onOpen`); Ctrl/Cmd + clic en el nombre, en otra
 *  pestaña. */
export function FleetRosterTable({
  kind, rows, total, facets, health, onHealth, query, onQuery, carrierStatus, onOpen, filters, action, form,
}: {
  kind: 'driver' | 'asset'
  /** Las filas ya filtradas. */
  rows: RosterRow[]
  /** Cuántos tiene la empresa, sin filtros: distingue "no tiene" de "nada coincide". */
  total: number
  facets: Record<Health, number>
  health: Health
  onHealth: (h: Health) => void
  query: string
  onQuery: (q: string) => void
  carrierStatus?: CarrierOperationalStatus
  onOpen: (id: string) => void
  /** Filtros propios (el tipo de equipo). */
  filters?: ReactNode
  /** "+ Conductor" / "+ Equipo". */
  action?: ReactNode
  /** El alta, abierta. */
  form?: ReactNode
}) {
  const driver = kind === 'driver'
  const href = driver ? driverHref : assetHref
  const healthOptions: SegmentedOption<string>[] = [
    { id: 'all', label: 'Todos', badge: String(facets['']) },
    ...SEVERITY_ORDER.map(s => ({ id: s, label: documentStateStyle(s).label, badge: String(facets[s]) })),
  ]

  function openName(e: MouseEvent<HTMLAnchorElement>, id: string) {
    e.stopPropagation()
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onOpen(id)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" aria-hidden="true" />
          <input
            value={query}
            onChange={e => onQuery(e.target.value)}
            placeholder={driver ? 'Filtrar por nombre o RUT…' : 'Filtrar por patente…'}
            aria-label={driver ? 'Filtrar conductores' : 'Filtrar equipos'}
            className="w-56 rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-informativo focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <SegmentedControl label="Estado de sus documentos" options={healthOptions} value={health || 'all'}
                          onChange={id => onHealth(id === 'all' ? '' : id as DocumentState)} />
        {filters}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {form}

      {rows.length === 0 ? (
        <Estado tipo="vacio" titulo={total === 0 ? (driver ? 'Sin conductores registrados' : 'Sin equipos registrados') : 'Sin resultados'} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-dato">
            <thead>
              <tr className="border-b border-border bg-bg-main">
                <th scope="col" className={CABECERA}>{driver ? 'Conductor' : 'Patente'}</th>
                <th scope="col" className={CABECERA}>{driver ? 'RUT' : 'Tipo'}</th>
                <th scope="col" className={`${CABECERA} w-36`}>Estado</th>
                <th scope="col" className={`${CABECERA} w-36`}>Documentos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const life = fleetMemberStyle(kind, r.operational_status, carrierStatus)
                const docs = summaryStyle(r.compliance_summary, r.operational_status === 'ACTIVE' && !isCarrierDeactivated(carrierStatus))
                return (
                  <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg-main">
                    <td className="px-3 py-2.5">
                      <a href={href(r.id)} onClick={e => openName(e, r.id)}
                         className={`font-semibold text-text-primary hover:text-accent ${driver ? '' : 'font-identificador'}`}>
                        {r.name}
                      </a>
                    </td>
                    <td className={`px-3 py-2.5 text-etiqueta text-informativo ${driver ? 'font-identificador' : ''}`}>{r.detail}</td>
                    <td className="px-3 py-2.5"><StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip></td>
                    <td className="px-3 py-2.5"><StatusChip tone={docs.tone} icon={docs.icon}>{docs.label}</StatusChip></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
