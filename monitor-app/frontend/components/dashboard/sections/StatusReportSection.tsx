'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Loader2, History, Printer, FileDown, Copy, Check, RotateCw } from 'lucide-react'
import { statusReportApi } from '@/lib/api/statusReport'
import type { OperationTypeKey } from '@/lib/types'
import { FleetDriverGapCard } from '../FleetDriverGapCard'
import { descargarReporteExcel } from '@/lib/reporte/exportarReporte'
import { TIPOS_DE_OPERACION } from '@/lib/reporte/tiposDeOperacion'
import {
  CuatroCifras, ViajesDeVariosDias, SeccionAsignados, SeccionEmpresas, SeccionNoTrabajaron, SeccionResumen, SeccionSegundasVueltas, Vacio,
} from './reporte/SeccionesDelReporte'

type Seccion = 'resumen' | 'asignados' | 'segundas_vueltas' | 'no_trabajaron' | 'empresas' | 'dotacion'

/** Seis secciones nombradas por la pregunta que responden (spec 2026-10-11). */
const SECCIONES: { id: Seccion; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'asignados', label: 'Asignados' },
  { id: 'segundas_vueltas', label: 'Segundas vueltas' },
  { id: 'no_trabajaron', label: 'No trabajaron' },
  { id: 'empresas', label: 'Empresas' },
  { id: 'dotacion', label: 'Dotación' },
]

const PILDORA = 'text-[11px] font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors'
const pildora = (activa: boolean) =>
  `${PILDORA} ${activa ? 'bg-white text-accent shadow-sm' : 'text-gray-500 hover:text-text-primary'}`
const ACCION = 'flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent disabled:opacity-40'

/** 2026-08-02 → 02/08, como lo escribe Operaciones en el correo del día. */
const diaYMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

/** El HTML a la vista, sin controles: en un correo, los botones del árbol se verían
 *  como botones y el chevron como un ícono suelto. Queda el texto de cada fila. */
function htmlParaPegar(nodo: HTMLElement): string {
  const copia = nodo.cloneNode(true) as HTMLElement
  copia.querySelectorAll('svg').forEach(svg => svg.remove())
  copia.querySelectorAll('button').forEach(boton => boton.replaceWith(boton.textContent ?? ''))
  return copia.innerHTML
}

interface Props {
  fecha:      string
}

/** Reporte de estatus del día (Cierre › Reporte). Un tipo de operación a la vez,
 *  elegido arriba; seis secciones; solo lectura. El botón "Confirmar cierre"
 *  vive en la página, no acá. */
export function StatusReportSection({ fecha }: Props) {
  const [tipo, setTipo] = useState<OperationTypeKey>('tractoreo')
  const [seccion, setSeccion] = useState<Seccion>('resumen')
  // El cliente elegido, por id del directorio (spec 2026-10-11), con su nombre
  // para mostrarlo aunque el reporte de otro día no lo traiga.
  const [clienteElegido, setClienteElegido] = useState<{ id: string; name: string } | null>(null)
  const client = clienteElegido?.id ?? ''
  // Lo que está a la vista, para "Copiar estatus": el coordinador lo pega tal cual
  // en el correo o el chat del día (minuta 09/10). Lo plegado no está en el DOM,
  // así que no se copia: se copia lo que se ve.
  const contenidoRef = useRef<HTMLDivElement>(null)
  const [copiado, setCopiado] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['status-report', fecha, client],
    queryFn: () => statusReportApi.get(fecha, client || undefined),
  })
  // Sin datos de reemplazo mientras carga: mostrar el reporte de otro día o
  // cliente bajo el encabezado nuevo (y dejar exportarlo) sería afirmar algo
  // falso. Lo único que se conserva es la lista de clientes, para que el filtro
  // no desaparezca al elegir. Se guarda durante el render (estado derivado).
  const [clientesConocidos, setClientesConocidos] = useState(data?.clients)
  if (data?.clients && data.clients !== clientesConocidos) setClientesConocidos(data.clients)
  // El faltante de dotación viene en el reporte, con el mismo filtro de cliente:
  // lo leen la pestaña Dotación, el PDF y el Excel.
  const faltante = data?.fleet_driver_gap

  const porTipo = data?.by_operation_type
  const tipoActual = TIPOS_DE_OPERACION.find(t => t.clave === tipo)!
  const reporte = porTipo?.[tipo]
  // Las opciones salen del día (spec 2026-10-11): solo quien operó, con su
  // cantidad. Si el cliente elegido no operó ese día, se conserva con (0) en vez
  // de resetearse en silencio.
  const opcionesDeCliente = [
    ...(clientesConocidos ?? []),
    ...(clienteElegido && !(clientesConocidos ?? []).some(c => c.shipper_id === clienteElegido.id)
      ? [{ shipper_id: clienteElegido.id, client_name: clienteElegido.name, assigned: 0, by_operation_type: undefined }]
      : []),
  ]

  async function copiarEstatus() {
    const nodo = contenidoRef.current
    if (!nodo) return
    const nombre = SECCIONES.find(s => s.id === seccion)?.label ?? ''
    const encabezado = `Estatus del día ${diaYMes(fecha)} · ${tipoActual.etiqueta} · ${nombre}`
    const html = `<p><b>${encabezado}</b></p>${htmlParaPegar(nodo)}`
    const texto = `${encabezado}\n\n${nodo.innerText ?? nodo.textContent ?? ''}`
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      })])
    } else {
      await navigator.clipboard.writeText(texto)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="space-y-4">
      {porTipo && (
        <>
          {/* Resumen imprimible de una página: los dos tipos lado a lado (spec §4). */}
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #closures-print-summary, #closures-print-summary * { visibility: visible; }
              #closures-print-summary { position: absolute; inset: 0; padding: 32px; }
            }
          `}</style>
          <div id="closures-print-summary" data-testid="resumen-imprimible" className="hidden print:block text-sm">
            <h1 className="text-xl font-bold mb-1">WebCarga — Reporte de Estatus del Día</h1>
            <p className="text-gray-500 mb-6">{fecha}{clienteElegido ? ` · ${clienteElegido.name}` : ' · Todos los clientes'}</p>
            <div className="grid grid-cols-2 gap-6 mb-6">
              {TIPOS_DE_OPERACION.map(t => (
                <div key={t.clave} className="space-y-3">
                  <p className="text-[10px] font-bold text-gray-500 uppercase">{t.etiqueta}</p>
                  <CuatroCifras reporte={porTipo[t.clave]} />
                  <ViajesDeVariosDias reporte={porTipo[t.clave]} />
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {porTipo[t.clave].summary.by_client.map(c => (
                        <tr key={c.client_name} className="border-b border-gray-100">
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
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">
                  Inconsistencias de dotación ({faltante.length} empresas)
                </p>
                <table className="w-full text-xs border-collapse mb-6">
                  <thead>
                    <tr className="border-b border-gray-300 text-left">
                      <th className="py-1">Empresa</th><th className="py-1 text-right">Tractos</th><th className="py-1 text-right">Conductores</th><th className="py-1 text-right">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faltante.map(r => (
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

      <div data-testid="report-body" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto max-w-full">
            {TIPOS_DE_OPERACION.map(t => (
              <button key={t.clave} type="button" aria-pressed={tipo === t.clave}
                      disabled={seccion === 'dotacion'} onClick={() => setTipo(t.clave)}
                      className={`${pildora(tipo === t.clave)} disabled:opacity-40`}>
                {t.etiqueta}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select aria-label="Filtrar por cliente" value={client}
                    onChange={e => {
                      const elegido = opcionesDeCliente.find(c => c.shipper_id === e.target.value)
                      setClienteElegido(elegido ? { id: elegido.shipper_id, name: elegido.client_name } : null)
                    }}
                    className="text-[11px] border border-border rounded-lg px-2 py-1.5 bg-white">
              <option value="">Todos los clientes</option>
              {opcionesDeCliente.map(c => (
                // La cantidad del tipo a la vista: la misma que dicen las tarjetas.
                <option key={c.shipper_id} value={c.shipper_id}>
                  {c.client_name} ({c.by_operation_type?.[tipo] ?? c.assigned})
                </option>
              ))}
            </select>
            <button type="button" onClick={() => window.print()} disabled={!porTipo} className={ACCION}
                    title="Abre el diálogo de impresión — elige 'Guardar como PDF' para descargarlo">
              <Printer size={12} /> Descargar PDF
            </button>
            <button type="button" disabled={!porTipo} className={ACCION}
                    onClick={() => { if (porTipo) void descargarReporteExcel(porTipo, fecha, faltante) }}>
              <FileDown size={12} /> Descargar Excel
            </button>
            <button type="button" onClick={() => { void copiarEstatus() }} disabled={!reporte || seccion === 'dotacion'}
                    className={ACCION} title="Copia la sección a la vista, lista para pegar en un correo o un chat">
              {copiado ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar estatus</>}
            </button>
            <Link href="/dashboard/operations/closures/history" target="_blank" className={ACCION}>
              <History size={12} /> Ver histórico
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-border overflow-x-auto max-w-full print:hidden">
          {SECCIONES.map(s => (
            <button key={s.id} type="button" aria-pressed={seccion === s.id} onClick={() => setSeccion(s.id)}
                    className={pildora(seccion === s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        {clienteElegido && (seccion === 'no_trabajaron' || seccion === 'dotacion') ? (
          // El cliente es un dato del viaje (decisión del usuario 11/10): lo que
          // no tuvo viaje no es de ningún cliente, y "no hay" sería falso.
          <Vacio>Lo que no tuvo viaje no es de ningún cliente. Elige «Todos los clientes» para verlo.</Vacio>
        ) : seccion === 'dotacion' ? (
          faltante && faltante.length === 0
          ? <Vacio>No hay empresas con desbalance de dotación</Vacio>
          : <FleetDriverGapCard rows={faltante} />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center justify-center gap-3 py-16 text-xs text-gray-500">
            No se pudo cargar el reporte.
            <button type="button" onClick={() => { void refetch() }} className={ACCION}>
              <RotateCw size={12} /> Reintentar
            </button>
          </div>
        ) : !reporte ? (
          // Un backend anterior al rediseño todavía no manda `by_operation_type`.
          <p role="status" className="py-16 text-center text-xs text-gray-400">Actualizando el reporte…</p>
        ) : (
          <div ref={contenidoRef}>
            {seccion === 'resumen' && <SeccionResumen reporte={reporte} tipo={tipoActual} />}
            {seccion === 'asignados' && <SeccionAsignados reporte={reporte} tipo={tipoActual} />}
            {seccion === 'segundas_vueltas' && <SeccionSegundasVueltas reporte={reporte} tipo={tipoActual} />}
            {seccion === 'no_trabajaron' && <SeccionNoTrabajaron reporte={reporte} tipo={tipoActual} />}
            {seccion === 'empresas' && <SeccionEmpresas reporte={reporte} tipo={tipoActual} />}
          </div>
        )}
      </div>
    </div>
  )
}
