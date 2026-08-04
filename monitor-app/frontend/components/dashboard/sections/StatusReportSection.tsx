'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, History, Printer, FileDown } from 'lucide-react'
import { statusReportApi } from '@/lib/api/statusReport'
import { carriersApi } from '@/lib/api/carriers'
import type { Shipper } from '@/lib/api/locations'
import type { MotivoCrossTab, StatusReport, ZoneCrossTab } from '@/lib/types'
import { FleetDriverGapCard } from '../FleetDriverGapCard'

type Tab = 1 | 2 | 3 | 4 | 5 | 6 | 7

interface Props {
  fecha:      string
  shippers?:  Shipper[]
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Excel/CSV con el detalle completo de las 6 secciones (para pivotar en
 *  Excel) — pedido explícito del equipo de operaciones para compartir con
 *  coordinación. Mismo patrón de exportCsv que ya usa Certificación:
 *  bloques secuenciales con su propio encabezado, separados por línea en
 *  blanco, un solo archivo. */
function exportReportCsv(report: StatusReport, fecha: string) {
  const lines: string[] = [`Reporte de Estatus del Día;${fecha}`, '']

  lines.push('SECCIÓN 2 — Tractoreo asignado por empresa y CD')
  lines.push(['CD', 'Empresa', 'RM', 'Z0', 'Región', 'Sin clasificar', 'Total'].map(csvEscape).join(';'))
  for (const r of report.section2_tractoreo_asignado.por_empresa_y_cd) {
    lines.push([r.cd, r.carrier_name, r.RM, r.Z0, r['Región'], r['Sin clasificar'], r.total].map(csvEscape).join(';'))
  }
  lines.push('')

  lines.push('SECCIÓN 3 — Segundas y terceras vueltas')
  lines.push(['Empresa', 'CD de origen', 'Tipo de destino', 'Vueltas'].map(csvEscape).join(';'))
  for (const v of report.section3_vueltas) {
    lines.push([v.carrier_name, v.cd_origen, v.tipo_destino, v.vueltas].map(csvEscape).join(';'))
  }
  lines.push('')

  lines.push('SECCIÓN 4 — Tractoreo no trabajando, detalle por conductor')
  lines.push(['Conductor', 'Empresa', 'CD', 'Motivo', 'Tracto habitual', 'Tipo de operación'].map(csvEscape).join(';'))
  for (const d of report.section4_tractoreo_no_trabajando.driver_detail) {
    lines.push([d.full_name, d.carrier_name, d.cd_origen, d.unassigned_reason_label, d.tractor_plate, d.operation_type].map(csvEscape).join(';'))
  }
  lines.push('')

  lines.push('SECCIÓN 5 — Equipos Completos por empresa')
  lines.push(['Empresa', 'Enrolados', 'Asignados', 'No asignados', '% utilización'].map(csvEscape).join(';'))
  for (const r of report.section5_equipos_completos) {
    lines.push([r.carrier_name, r.enrolled, r.assigned, r.unassigned, r.utilization_pct].map(csvEscape).join(';'))
  }
  lines.push('')

  lines.push('SECCIÓN 6 — Resumen general por CD')
  lines.push(['CD', 'Enrolados', 'Asignados'].map(csvEscape).join(';'))
  for (const c of report.section6_resumen_general.por_cd) {
    lines.push([c.cd, c.enrolled, c.assigned].map(csvEscape).join(';'))
  }
  lines.push('')
  lines.push('SECCIÓN 6 — Resumen general por cliente')
  lines.push(['Cliente', 'Asignados'].map(csvEscape).join(';'))
  for (const c of report.section6_resumen_general.por_cliente) {
    lines.push([c.client_name, c.assigned].map(csvEscape).join(';'))
  }

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `reporte_estatus_${fecha}.csv`; a.click()
  URL.revokeObjectURL(url)
}

const ZONE_COLS: (keyof ZoneCrossTab)[] = ['RM', 'Z0', 'Región', 'Sin clasificar', 'total']
const MOTIVO_COLS = [
  'Panne', 'Mantención', 'Sin conductor', 'No se presentó', 'Vacaciones', 'Licencia',
  'Descanso', 'Se retiró sin carga', 'Sin carga disponible', 'Conductor no disponible',
  'A confirmar', 'Otro', 'total',
]
const OPERATION_TYPE_CLS: Record<string, string> = {
  Tractoreo:         'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Equipo Completo': 'bg-gray-100 text-gray-600 border-transparent',
}

function Pct({ value }: { value: number }) {
  return <span className="font-bold text-accent">{value}%</span>
}

/** Sección "Confirmar cierre → Reporte" del Centro de Cierre (Tarea 14,
 *  plan 1.5) — HU-04, extraída de StatusReportDialog.tsx sin semántica de
 *  diálogo. Agrega la Sección 7 (Tarea 8/9, inconsistencias de dotación,
 *  reusa FleetDriverGapCard tal cual) y un detalle plano por conductor en
 *  la Sección 4 (Tarea 6, driver_detail — muestra el tipo de operación del
 *  tracto habitual, satisface el pedido explícito del usuario de poder
 *  identificarlo por fila). El botón "Confirmar cierre" vive a nivel de
 *  página (Tarea 1.1), no acá — esta sección es solo de lectura. */
export function StatusReportSection({ fecha, shippers }: Props) {
  const [tab, setTab] = useState<Tab>(1)
  const [client, setClient] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['status-report', fecha, client],
    queryFn: () => statusReportApi.get(fecha, client || undefined),
  })

  // Mismo queryKey que FleetDriverGapCard — cacheado, no duplica el fetch
  // si el usuario ya visitó la tab 7. Se pide igual acá (independiente de
  // qué tab esté activa) para que el PDF de una página siempre tenga el
  // dato de inconsistencias disponible.
  const gapQuery = useQuery({
    queryKey: ['fleet-driver-gap'],
    queryFn: () => carriersApi.fleetDriverGap(),
  })

  const TABS: { id: Tab; label: string }[] = [
    { id: 1, label: '1. Resumen' },
    { id: 2, label: '2. Asignado' },
    { id: 3, label: '3. Vueltas' },
    { id: 4, label: '4. Sin trabajar' },
    { id: 5, label: '5. Eq. Completos' },
    { id: 6, label: '6. General' },
    { id: 7, label: '7. Dotación' },
  ]

  return (
    <div className="space-y-4">
      {data && (
        <>
          {/* Resumen imprimible de una página — visible solo al imprimir/
              "Guardar como PDF" (Ctrl+P triggered por handlePrint acá
              abajo). El resto de la página se oculta vía la regla global
              de acá abajo, para que el PDF no arrastre nav/sidebar/otras
              secciones del Centro de Cierre. */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #closures-print-summary, #closures-print-summary * { visibility: visible; }
              #closures-print-summary { position: absolute; inset: 0; padding: 32px; }
            }
          `}</style>
          <div id="closures-print-summary" className="hidden print:block text-sm">
            <h1 className="text-xl font-bold mb-1">WebCarga — Reporte de Estatus del Día</h1>
            <p className="text-gray-500 mb-6">{fecha}{client ? ` · ${client}` : ' · WebCarga consolidado'}</p>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="border border-gray-300 rounded-lg p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Total equipos activos</p>
                <p className="text-2xl font-bold">{data.section1_resumen.total_equipos_activos}</p>
              </div>
              <div className="border border-gray-300 rounded-lg p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Tractoreo</p>
                <p>{data.section1_resumen.tractoreo.assigned} asignados / {data.section1_resumen.tractoreo.unassigned} sin asignar</p>
                <p className="font-bold">{data.section1_resumen.tractoreo.utilization_pct}% utilización</p>
              </div>
              <div className="border border-gray-300 rounded-lg p-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Equipos Completos</p>
                <p>{data.section1_resumen.equipos_completos.assigned} asignados / {data.section1_resumen.equipos_completos.unassigned} sin asignar</p>
                <p className="font-bold">{data.section1_resumen.equipos_completos.utilization_pct}% utilización</p>
              </div>
            </div>
            <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">
              Viajes multi-día activos ({data.section1_resumen.multi_dia_activos.total})
            </p>
            <p className="mb-6">
              {Object.entries(data.section1_resumen.multi_dia_activos.por_dias_atras).map(([d, n]) => `${n} equipo(s) — ${d} día(s)`).join(' · ') || 'Ninguno'}
            </p>
            {gapQuery.data && gapQuery.data.rows.length > 0 && (
              <>
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">
                  Inconsistencias de dotación ({gapQuery.data.rows.length} empresas)
                </p>
                <table className="w-full text-xs border-collapse mb-6">
                  <thead>
                    <tr className="border-b border-gray-300 text-left">
                      <th className="py-1">Empresa</th><th className="py-1 text-right">Tractos</th><th className="py-1 text-right">Conductores</th><th className="py-1 text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapQuery.data.rows.map(r => (
                      <tr key={r.carrier_id} className="border-b border-gray-100">
                        <td className="py-1">{r.business_name}</td>
                        <td className="py-1 text-right">{r.n_tractos}</td>
                        <td className="py-1 text-right">{r.n_conductores}</td>
                        <td className="py-1 text-right">{r.gap > 0 ? `Faltan ${r.gap}` : `${Math.abs(r.gap)} de más`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <p className="text-[10px] text-gray-400">Generado el {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</p>
          </div>
        </>
      )}

      <div data-testid="report-body" className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto max-w-full">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                tab === t.id ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <select
            aria-label="Filtrar por cliente"
            value={client}
            onChange={e => setClient(e.target.value)}
            className="text-[11px] border border-border rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="">WebCarga consolidado</option>
            {(shippers ?? []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!data}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent disabled:opacity-40"
            title="Abre el diálogo de impresión — elegí 'Guardar como PDF' para descargarlo"
          >
            <Printer size={12} /> Descargar PDF
          </button>
          <button
            type="button"
            onClick={() => data && exportReportCsv(data, fecha)}
            disabled={!data}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent disabled:opacity-40"
          >
            <FileDown size={12} /> Descargar Excel
          </button>
          <Link
            href="/dashboard/operations/closures/history"
            target="_blank"
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent"
          >
            <History size={12} /> Ver histórico
          </Link>
        </div>
      </div>

      {tab === 7 ? (
        <FleetDriverGapCard />
      ) : isLoading || !data ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <>
          {tab === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Total equipos activos</p>
                  <p className="text-xl font-bold text-text-primary">{data.section1_resumen.total_equipos_activos}</p>
                </div>
                <div className="bg-white rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Tractoreo</p>
                  <p className="text-xs">
                    {data.section1_resumen.tractoreo.assigned} asignados / {data.section1_resumen.tractoreo.unassigned} sin asignar
                  </p>
                  <p className="text-[11px] mt-0.5"><Pct value={data.section1_resumen.tractoreo.utilization_pct} /> utilización</p>
                </div>
                <div className="bg-white rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Equipos Completos</p>
                  <p className="text-xs">
                    {data.section1_resumen.equipos_completos.assigned} asignados / {data.section1_resumen.equipos_completos.unassigned} sin asignar
                  </p>
                  <p className="text-[11px] mt-0.5"><Pct value={data.section1_resumen.equipos_completos.utilization_pct} /> utilización</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">
                  Viajes multi-día activos ({data.section1_resumen.multi_dia_activos.total})
                </p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(data.section1_resumen.multi_dia_activos.por_dias_atras).map(([dias, n]) => (
                    <span key={dias} className="text-[11px] bg-gray-50 border border-border rounded-full px-2.5 py-1">
                      {n} equipo(s) — {dias} día(s)
                    </span>
                  ))}
                  {data.section1_resumen.multi_dia_activos.total === 0 && (
                    <span className="text-[11px] text-gray-300 italic">Ninguno</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div className="space-y-4">
              <ZoneTable title="Por CD de origen" rows={data.section2_tractoreo_asignado.por_cd} />
              <ZoneTable title="Por empresa dentro de cada CD" rows={data.section2_tractoreo_asignado.por_empresa_y_cd} showCarrier />
            </div>
          )}

          {tab === 3 && (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                    <th className="text-left px-3 py-2">Empresa</th>
                    <th className="text-left px-3 py-2">CD de origen</th>
                    <th className="text-left px-3 py-2">Tipo de destino</th>
                    <th className="text-right px-3 py-2">Vueltas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.section3_vueltas.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-300 italic">Ningún equipo con 2+ vueltas hoy</td></tr>
                  )}
                  {data.section3_vueltas.map((v, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium">{v.carrier_name}</td>
                      <td className="px-3 py-2 text-gray-500">{v.cd_origen ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{v.tipo_destino ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-bold text-accent">{v.vueltas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 4 && (
            <div className="space-y-4">
              <MotivoTable title="Por CD" rows={data.section4_tractoreo_no_trabajando.por_cd} />
              <MotivoTable title="Por empresa dentro de cada CD" rows={data.section4_tractoreo_no_trabajando.por_empresa_y_cd} showCarrier />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Detalle por conductor</p>
                <div className="bg-white rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                        <th className="text-left px-3 py-2">Conductor</th>
                        <th className="text-left px-3 py-2">Empresa</th>
                        <th className="text-left px-3 py-2">CD</th>
                        <th className="text-left px-3 py-2">Motivo</th>
                        <th className="text-left px-3 py-2">Tracto habitual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.section4_tractoreo_no_trabajando.driver_detail.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">Sin conductores pendientes</td></tr>
                      )}
                      {data.section4_tractoreo_no_trabajando.driver_detail.map(d => (
                        <tr key={d.driver_id}>
                          <td className="px-3 py-2 font-medium">{d.full_name}</td>
                          <td className="px-3 py-2 text-gray-500">{d.carrier_name ?? '—'}</td>
                          <td className="px-3 py-2 text-gray-500">{d.cd_origen ?? 'Sin CD'}</td>
                          <td className="px-3 py-2 text-gray-500">{d.unassigned_reason_label ?? '—'}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-500">{d.tractor_plate ?? 'Sin tracto reciente'}</span>
                              {d.operation_type && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${OPERATION_TYPE_CLS[d.operation_type] ?? 'bg-gray-100 text-gray-500 border-transparent'}`}>
                                  {d.operation_type}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 5 && (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                    <th className="text-left px-3 py-2">Empresa</th>
                    <th className="text-right px-3 py-2">Enrolados</th>
                    <th className="text-right px-3 py-2">Asignados</th>
                    <th className="text-right px-3 py-2">No asignados</th>
                    <th className="text-right px-3 py-2">% utilización</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.section5_equipos_completos.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-300 italic">Sin equipos completos</td></tr>
                  )}
                  {data.section5_equipos_completos.map(r => (
                    <tr key={r.carrier_name}>
                      <td className="px-3 py-2 font-medium">{r.carrier_name}</td>
                      <td className="px-3 py-2 text-right">{r.enrolled}</td>
                      <td className="px-3 py-2 text-right text-green-700">{r.assigned}</td>
                      <td className="px-3 py-2 text-right text-gray-400">{r.unassigned}</td>
                      <td className="px-3 py-2 text-right"><Pct value={r.utilization_pct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 6 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Tractoreo total</p>
                  <p className="text-xs">
                    {data.section6_resumen_general.tractoreo.total} enrolados / {data.section6_resumen_general.tractoreo.assigned} asignados / {data.section6_resumen_general.tractoreo.unassigned} sin asignar
                  </p>
                  <p className="text-[11px] mt-0.5"><Pct value={data.section6_resumen_general.tractoreo.utilization_pct} /> utilización</p>
                </div>
                <div className="bg-white rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Equipos Completos total</p>
                  <p className="text-xs">
                    {data.section6_resumen_general.equipos_completos.total} enrolados / {data.section6_resumen_general.equipos_completos.assigned} asignados / {data.section6_resumen_general.equipos_completos.unassigned} sin asignar
                  </p>
                  <p className="text-[11px] mt-0.5"><Pct value={data.section6_resumen_general.equipos_completos.utilization_pct} /> utilización</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Por CD de origen</p>
                  <div className="bg-white rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                          <th className="text-left px-3 py-2">CD</th>
                          <th className="text-right px-3 py-2">Enrolados</th>
                          <th className="text-right px-3 py-2">Asignados</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {data.section6_resumen_general.por_cd.map(c => (
                          <tr key={c.cd}>
                            <td className="px-3 py-2">{c.cd}</td>
                            <td className="px-3 py-2 text-right">{c.enrolled}</td>
                            <td className="px-3 py-2 text-right text-green-700">{c.assigned}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">Por cliente</p>
                  <div className="bg-white rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
                          <th className="text-left px-3 py-2">Cliente</th>
                          <th className="text-right px-3 py-2">Asignados</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {data.section6_resumen_general.por_cliente.map(c => (
                          <tr key={c.client_name}>
                            <td className="px-3 py-2">{c.client_name}</td>
                            <td className="px-3 py-2 text-right text-green-700">{c.assigned}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  )
}

function ZoneTable({ title, rows, showCarrier }: { title: string; rows: ZoneCrossTab[]; showCarrier?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">{title}</p>
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
              <th className="text-left px-3 py-2">CD</th>
              {showCarrier && <th className="text-left px-3 py-2">Empresa</th>}
              {ZONE_COLS.map(c => <th key={c} className="text-right px-3 py-2">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 && (
              <tr><td colSpan={(showCarrier ? 2 : 1) + ZONE_COLS.length} className="px-3 py-4 text-center text-gray-300 italic">Sin datos</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2">{r.cd}</td>
                {showCarrier && <td className="px-3 py-2">{r.carrier_name}</td>}
                {ZONE_COLS.map(c => (
                  <td key={c} className={`px-3 py-2 text-right ${c === 'total' ? 'font-bold' : ''}`}>{r[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MotivoTable({ title, rows, showCarrier }: { title: string; rows: MotivoCrossTab[]; showCarrier?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">{title}</p>
      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 900 }}>
          <thead>
            <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase">
              <th className="text-left px-3 py-2 whitespace-nowrap">CD</th>
              {showCarrier && <th className="text-left px-3 py-2 whitespace-nowrap">Empresa</th>}
              {MOTIVO_COLS.map(c => <th key={c} className="text-right px-2 py-2 whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.length === 0 && (
              <tr><td colSpan={(showCarrier ? 2 : 1) + MOTIVO_COLS.length} className="px-3 py-4 text-center text-gray-300 italic">Sin datos</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2 whitespace-nowrap">{r.cd}</td>
                {showCarrier && <td className="px-3 py-2 whitespace-nowrap">{r.carrier_name}</td>}
                {MOTIVO_COLS.map(c => (
                  <td key={c} className={`px-2 py-2 text-right ${c === 'total' ? 'font-bold' : ''}`}>{(r[c] as number) ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
