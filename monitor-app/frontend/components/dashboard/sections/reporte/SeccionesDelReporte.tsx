'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { OperationTypeReport, ReasonRow } from '@/lib/types'
import type { TipoDeOperacion } from '@/lib/reporte/tiposDeOperacion'
import { sumar } from '@/lib/reporte/sumar'
import { TablaDeAsignados, usePlegado } from './TablaDeAsignados'

type Props = { reporte: OperationTypeReport; tipo: TipoDeOperacion }

const TH = 'px-3 py-2 whitespace-nowrap'
const CABECERA = 'bg-gray-50 text-[10px] font-bold text-gray-400 uppercase'

function Titulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-gray-400 uppercase mb-1.5">{children}</p>
}

/** Nunca una tabla vacía con encabezados: un mensaje que dice qué pasó. */
export function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border px-3 py-6 text-center text-xs text-gray-400 italic">
      {children}
    </div>
  )
}

function Cifra({ titulo, valor }: { titulo: string; valor: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <p className="text-[10px] font-bold text-gray-400 uppercase">{titulo}</p>
      <p className="text-xl font-bold text-text-primary">{valor}</p>
    </div>
  )
}

/** Las cuatro cifras del tipo, compartidas con el resumen imprimible. */
export function CuatroCifras({ reporte }: { reporte: OperationTypeReport }) {
  const s = reporte.summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Cifra titulo="Equipos activos" valor={s.total} />
      <Cifra titulo="Asignados" valor={s.assigned} />
      <Cifra titulo="No trabajaron" valor={s.not_working} />
      <Cifra titulo="Utilización" valor={<span className="text-accent">{s.utilization_pct}%</span>} />
    </div>
  )
}

const plural = (n: number | string, uno: string, varios: string) => `${n} ${Number(n) === 1 ? uno : varios}`

/** Los equipos que siguen en un viaje planificado días antes, por días atrás. */
export function ViajesDeVariosDias({ reporte }: { reporte: OperationTypeReport }) {
  const { total, by_days_back } = reporte.summary.multi_day
  return (
    <div>
      <Titulo>Viajes de varios días ({total})</Titulo>
      <div className="flex gap-2 flex-wrap">
        {Object.entries(by_days_back).map(([dias, n]) => (
          <span key={dias} className="text-[11px] bg-gray-50 border border-border rounded-full px-2.5 py-1">
            {plural(n, 'equipo', 'equipos')} — {plural(dias, 'día', 'días')}
          </span>
        ))}
        {total === 0 && <span className="text-[11px] text-gray-400 italic">Ninguno</span>}
      </div>
    </div>
  )
}

export function SeccionResumen({ reporte, tipo }: Props) {
  const s = reporte.summary
  if (s.total === 0) return <Vacio>No hay equipos de {tipo.etiqueta} enrolados</Vacio>
  return (
    <div className="space-y-4">
      <CuatroCifras reporte={reporte} />
      <ViajesDeVariosDias reporte={reporte} />
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Titulo>Asignados por cliente</Titulo>
          {s.by_client.length === 0 ? <Vacio>No hubo equipos de {tipo.etiqueta} asignados</Vacio> : (
            <div className="bg-white rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className={CABECERA}><th className={`text-left ${TH}`}>Cliente</th><th className={`text-right ${TH}`}>Asignados</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {s.by_client.map(c => (
                    <tr key={c.client_name}><td className="px-3 py-2">{c.client_name}</td><td className="px-3 py-2 text-right">{c.assigned}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <Titulo>Enrolados y asignados por origen habitual</Titulo>
          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={CABECERA}>
                  <th className={`text-left ${TH}`}>Origen habitual</th><th className={`text-right ${TH}`}>Enrolados</th><th className={`text-right ${TH}`}>Asignados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {s.by_home_origin.map(o => (
                  <tr key={o.origin}>
                    <td className="px-3 py-2">{o.origin}</td><td className="px-3 py-2 text-right">{o.enrolled}</td><td className="px-3 py-2 text-right">{o.assigned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Origen × empresa por motivo. Dibuja exactamente los motivos que manda la API:
 *  el backend ya manda solo los que ocurrieron. */
export function TablaDeMotivos({ reasons, rows }: { reasons: string[]; rows: ReasonRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Origen</th>
            <th className={`text-left ${TH}`}>Empresa</th>
            {reasons.map(m => <th key={m} className={`text-right ${TH}`}>{m}</th>)}
            <th className={`text-right ${TH}`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map(r => (
            <tr key={`${r.origin}-${r.carrier_name}`}>
              <td className="px-3 py-2 whitespace-nowrap">{r.origin}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.carrier_name ?? '—'}</td>
              {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{r.counts[m] ?? 0}</td>)}
              <td className="px-3 py-2 text-right font-bold">{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold bg-gray-50">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2" />
            {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{sumar(rows, r => r.counts[m])}</td>)}
            <td className="px-3 py-2 text-right">{sumar(rows, r => r.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function SeccionAsignados({ reporte, tipo }: Props) {
  const { rows, other_origin } = reporte.assigned
  const sinAsignacion = reporte.worked_without_assignment
  const plegado = usePlegado()
  return (
    <div className="space-y-4">
      {/* Decisión B (minuta 09/10): "lo importante es de dónde salió realmente". */}
      <p className="text-dato text-gray-500">Por el origen real del viaje.</p>
      {rows.length === 0
        ? <Vacio>No hubo equipos de {tipo.etiqueta} asignados</Vacio>
        : <TablaDeAsignados rows={rows} plegado={plegado} />}
      {sinAsignacion.rows.length > 0 && (
        <div>
          <Titulo>Trabajaron sin asignación</Titulo>
          <TablaDeMotivos reasons={sinAsignacion.reasons} rows={sinAsignacion.rows} />
        </div>
      )}
      {other_origin.length > 0 && (
        <div>
          <p className="text-etiqueta font-bold text-informativo uppercase mb-1.5">Cargaron en otro origen ({other_origin.length})</p>
          <div className="bg-white rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-etiqueta font-bold text-informativo uppercase border-b border-border">
                  <th className={`text-left ${TH}`}>Patente</th><th className={`text-left ${TH}`}>Empresa</th>
                  <th className={`text-left ${TH}`}>Origen habitual</th><th className={`text-left ${TH}`}>Cargó en</th>
                  <th className={`text-left ${TH}`}>Cliente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {other_origin.map((d, i) => (
                  <tr key={`${d.tractor_plate ?? i}-${d.origin}`}>
                    <td className="px-3 py-2 font-identificador">{d.tractor_plate ?? '—'}</td>
                    <td className="px-3 py-2">{d.carrier_name ?? '—'}</td>
                    <td className="px-3 py-2 text-informativo">{d.home_origin}</td>
                    <td className="px-3 py-2">{d.origin}</td>
                    <td className="px-3 py-2 text-informativo">{d.client_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function SeccionSegundasVueltas({ reporte, tipo }: Props) {
  if (reporte.second_legs.length === 0) return <Vacio>Ningún equipo de {tipo.etiqueta} hizo una segunda vuelta</Vacio>
  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Patente</th><th className={`text-left ${TH}`}>Empresa</th>
            <th className={`text-left ${TH}`}>Conductor</th><th className={`text-left ${TH}`}>Origen del viaje</th>
            <th className={`text-left ${TH}`}>Tipo de destino</th><th className={`text-right ${TH}`}>Vueltas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {reporte.second_legs.map(v => (
            <tr key={v.tractor_plate}>
              <td className="px-3 py-2 font-mono font-medium">{v.tractor_plate}</td>
              <td className="px-3 py-2">{v.carrier_name}</td>
              <td className="px-3 py-2">{v.driver_name ?? '—'}</td>
              <td className="px-3 py-2 text-gray-500">{v.origin ?? '—'}</td>
              <td className="px-3 py-2 text-gray-500">{v.destination_zone ?? '—'}</td>
              <td className="px-3 py-2 text-right font-bold text-accent">{v.legs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Detalle = OperationTypeReport['not_working']['detail'][number]

/** "No trabajaron" en una sola tabla (pedido del usuario 11/10): origen y empresa
 *  por motivo, y cada fila se abre en sus conductores (o equipos), cada uno con
 *  un 1 bajo su motivo. Lo que la fila cuenta y no tiene persona detrás es el
 *  faltante de la dotación, que va como su propia línea. */
function TablaDeNoTrabajaron({ reporte, porConductor }: { reporte: OperationTypeReport; porConductor: boolean }) {
  const { reasons, by_reason: rows, detail } = reporte.not_working
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const alternar = (clave: string) => setAbiertas(a => {
    const nueva = new Set(a)
    if (nueva.has(clave)) nueva.delete(clave)
    else nueva.add(clave)
    return nueva
  })
  const etiqueta = (d: Detalle) => (porConductor ? `${d.name} · ${d.tractor_plate ?? 'sin tracto reciente'}` : d.name)

  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Origen › Empresa</th>
            {reasons.map(m => <th key={m} className={`text-right ${TH}`}>{m}</th>)}
            <th className={`text-right ${TH}`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map(r => {
            const clave = `${r.origin}\u0000${r.carrier_name ?? ''}`
            const abierta = abiertas.has(clave)
            const hijos = detail.filter(d => (d.home_origin ?? 'Sin origen') === r.origin && d.carrier_name === r.carrier_name)
            const faltante = Object.fromEntries(reasons.map(m => [m, (r.counts[m] ?? 0) - hijos.filter(d => d.reason === m).length]))
            const totalFaltante = reasons.reduce((acc, m) => acc + Math.max(faltante[m], 0), 0)
            return [
              <tr key={clave} className="font-semibold">
                <td className="py-2 pl-3 pr-3">
                  <button type="button" aria-expanded={abierta} onClick={() => alternar(clave)}
                          className="flex items-center gap-1 text-left hover:text-accent">
                    <ChevronRight size={12} aria-hidden className={`transition-transform ${abierta ? 'rotate-90' : ''}`} />
                    {r.origin} › {r.carrier_name ?? '—'}
                  </button>
                </td>
                {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{r.counts[m] ?? 0}</td>)}
                <td className="px-3 py-2 text-right font-bold">{r.total}</td>
              </tr>,
              ...(abierta ? hijos.map((d, i) => (
                <tr key={`${clave}-${i}`} className="text-gray-500">
                  <td className={`py-2 pl-7 pr-3 ${porConductor ? '' : 'font-mono'}`}>{etiqueta(d)}</td>
                  {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{d.reason === m ? 1 : ''}</td>)}
                  <td className="px-3 py-2 text-right">1</td>
                </tr>
              )) : []),
              ...(abierta && totalFaltante > 0 ? [
                <tr key={`${clave}-faltante`} className="text-gray-500 italic">
                  <td className="py-2 pl-7 pr-3">Faltante de dotación</td>
                  {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{faltante[m] > 0 ? faltante[m] : ''}</td>)}
                  <td className="px-3 py-2 text-right">{totalFaltante}</td>
                </tr>,
              ] : []),
            ]
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-bold bg-gray-50">
            <td className="px-3 py-2">Total</td>
            {reasons.map(m => <td key={m} className="px-3 py-2 text-right">{sumar(rows, r => r.counts[m])}</td>)}
            <td className="px-3 py-2 text-right">{sumar(rows, r => r.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function SeccionNoTrabajaron({ reporte, tipo }: Props) {
  const porConductor = tipo.clave === 'tractoreo'
  if (reporte.not_working.by_reason.length === 0) {
    return <Vacio>No hay {porConductor ? 'conductores' : 'equipos'} de {tipo.etiqueta} sin trabajar</Vacio>
  }
  return (
    <div className="space-y-2">
      <p className="text-dato text-gray-500">
        Por motivo. Abre una empresa para ver {porConductor ? 'sus conductores' : 'sus equipos'}.
      </p>
      <TablaDeNoTrabajaron reporte={reporte} porConductor={porConductor} />
    </div>
  )
}

export function SeccionEmpresas({ reporte, tipo }: Props) {
  if (reporte.carriers.length === 0) return <Vacio>No hay empresas de {tipo.etiqueta} enroladas</Vacio>
  return (
    <div className="bg-white rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className={CABECERA}>
            <th className={`text-left ${TH}`}>Empresa</th><th className={`text-right ${TH}`}>Enrolados</th>
            <th className={`text-right ${TH}`}>Asignados</th><th className={`text-right ${TH}`}>No asignados</th>
            <th className={`text-right ${TH}`}>% utilización</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {reporte.carriers.map(r => (
            <tr key={r.carrier_name}>
              <td className="px-3 py-2 font-medium">{r.carrier_name}</td>
              <td className="px-3 py-2 text-right">{r.enrolled}</td>
              <td className="px-3 py-2 text-right text-green-700">{r.assigned}</td>
              <td className="px-3 py-2 text-right text-gray-400">{r.unassigned}</td>
              <td className="px-3 py-2 text-right font-bold text-accent">{r.utilization_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
