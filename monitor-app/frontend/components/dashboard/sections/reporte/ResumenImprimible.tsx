'use client'

import type { FleetDriverGapRow, StatusReport } from '@/lib/types'
import { TIPOS_DE_OPERACION } from '@/lib/reporte/tiposDeOperacion'
import { SCOPE_LABEL } from '@/lib/states'
import { CuatroCifras, ViajesDeVariosDias } from './SeccionesDelReporte'

/** Resumen imprimible de una página: los dos tipos lado a lado (spec 2026-10-11 §4).
 *  El PDF queda como estaba (D7). */
export function ResumenImprimible({ fecha, porTipo, faltante, clientes }: {
  fecha: string; porTipo: NonNullable<StatusReport['by_operation_type']>; faltante: FleetDriverGapRow[] | undefined; clientes: string[]
}) {
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #closures-print-summary, #closures-print-summary * { visibility: visible; }
          #closures-print-summary { position: absolute; inset: 0; padding: 32px; }
        }
      `}</style>
      <div id="closures-print-summary" data-testid="resumen-imprimible" className="hidden print:block text-sm">
        <h1 className="text-xl font-bold mb-1">WebCarga — Reporte de Estatus del Día</h1>
        <p className="text-informativo mb-6">{fecha} · {clientes.length ? clientes.join(', ') : 'Todos los clientes'}</p>
        <div className="grid grid-cols-2 gap-6 mb-6">
          {TIPOS_DE_OPERACION.map(t => (
            <div key={t.clave} className="space-y-3">
              <p className="text-etiqueta font-bold text-informativo uppercase">{SCOPE_LABEL[t.clave]}</p>
              <CuatroCifras reporte={porTipo[t.clave]} />
              <ViajesDeVariosDias reporte={porTipo[t.clave]} />
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {porTipo[t.clave].summary.by_client.map(c => (
                    <tr key={c.client_name} className="border-b border-border">
                      <td className="py-1">{c.client_name}</td><td className="py-1 text-right">{c.assigned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        {faltante && faltante.length > 0 && (
          <>
            <p className="text-etiqueta font-bold text-informativo uppercase mb-1.5">
              Inconsistencias de dotación ({faltante.length} empresas)
            </p>
            <table className="w-full text-xs border-collapse mb-6">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-1">Empresa</th><th className="py-1 text-right">Tractos</th><th className="py-1 text-right">Conductores</th><th className="py-1 text-right">Gap</th>
                </tr>
              </thead>
              <tbody>
                {faltante.map(r => (
                  <tr key={r.carrier_id} className="border-b border-border">
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
        <p className="text-etiqueta text-informativo">Generado el {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</p>
      </div>
    </>
  )
}
