'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, FileBarChart2, X } from 'lucide-react'
import { statusReportApi } from '@/lib/api/statusReport'
import type { Shipper } from '@/lib/api/locations'
import type { MotivoCrossTab, ZoneCrossTab } from '@/lib/types'

type Tab = 1 | 2 | 3 | 4 | 5 | 6

interface Props {
  open:     boolean
  fecha:    string
  shippers?: Shipper[]
  onClose:  () => void
}

const ZONE_COLS: (keyof ZoneCrossTab)[] = ['RM', 'Z0', 'Región', 'Sin clasificar', 'total']
const MOTIVO_COLS = [
  'Panne', 'Mantención', 'Sin conductor', 'No se presentó', 'Vacaciones', 'Licencia',
  'Descanso', 'Se retiró sin carga', 'Sin carga disponible', 'Conductor no disponible',
  'A confirmar', 'Otro', 'total',
]

function Pct({ value }: { value: number }) {
  return <span className="font-bold text-accent">{value}%</span>
}

/** "Reporte de Estatus del Día" — Fase 5, HU-04. 6 secciones (resumen
 *  ejecutivo, tractoreo asignado por CD/empresa, vueltas, tractoreo no
 *  trabajando por CD/empresa, equipos completos por empresa, resumen
 *  general), navegables por tabs dentro del mismo diálogo — igual criterio
 *  de "página propia diferida a un checkpoint futuro" que el resto de los
 *  diálogos de esta fase (Vista de Flota, Cerrar el Día). */
export function StatusReportDialog({ open, fecha, shippers, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>(1)
  const [client, setClient] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['status-report', fecha, client],
    queryFn: () => statusReportApi.get(fecha, client || undefined),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    setTab(1); setClient('')
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const TABS: { id: Tab; label: string }[] = [
    { id: 1, label: '1. Resumen' },
    { id: 2, label: '2. Tractoreo asignado' },
    { id: 3, label: '3. Vueltas' },
    { id: 4, label: '4. Tractoreo sin trabajar' },
    { id: 5, label: '5. Equipos Completos' },
    { id: 6, label: '6. Resumen general' },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Reporte de Estatus del Día"
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[94vw] max-w-5xl max-h-[85vh] overflow-hidden flex flex-col focus:outline-none animate-modal-in"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <FileBarChart2 size={16} className="text-accent" /> Reporte de Estatus — {fecha}
            </h2>
            <div className="flex items-center gap-3">
              <select
                aria-label="Filtrar por cliente"
                value={client}
                onChange={e => setClient(e.target.value)}
                className="text-[11px] border border-border rounded-lg px-2 py-1.5 bg-white"
              >
                <option value="">WebCarga consolidado</option>
                {(shippers ?? []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 px-5 pt-3 border-b border-border shrink-0 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-colors ${
                  tab === t.id ? 'text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {isLoading || !data ? (
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
      </div>
    </>
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
