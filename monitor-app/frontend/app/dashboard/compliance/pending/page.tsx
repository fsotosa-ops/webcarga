'use client'

import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { PendingSummaryList } from '@/components/compliance/pending/PendingSummaryList'
import { PendingHoldersPanel } from '@/components/compliance/pending/PendingHoldersPanel'
import { OperationsRequests } from '@/components/compliance/pending/OperationsRequests'
import { PendingLoadError, PendingSkeleton } from '@/components/compliance/pending/PendingStates'
import { defaultPendingFilter } from '@/lib/pending'
import type { PendingFilter, PendingGroupBy, PendingSummaryRow } from '@/lib/types'

const FILTROS: readonly PendingFilter[] = ['overdue', 'expiring', 'missing', 'all']

/** Certificación › Pendientes (spec 2026-10-11 §5): los documentos que se
 *  deben, por documento o por empresa.
 *
 *  Lo elegido vive en la URL (`?by=&doc=<requirement_code>&carrier=<id>&state=`),
 *  así que se comparte y "Volver" lo restituye. Sin `doc`/`carrier` el
 *  escritorio muestra el primero de la lista; el teléfono muestra la lista. */
function Pending() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const canUpload = usePermiso('documents.upload')

  const groupBy: PendingGroupBy = params.get('by') === 'carrier' ? 'carrier' : 'requirement'

  const resumen = useQuery({
    queryKey: clavesCertificacion.resumenPendientes(groupBy),
    queryFn: () => complianceApi.pendingSummary(groupBy),
  })
  const rows = resumen.data?.rows ?? []
  const pedidoEnUrl = params.get(groupBy === 'requirement' ? 'doc' : 'carrier')
  const esElPedido = (r: PendingSummaryRow) => pedidoEnUrl != null &&
    (groupBy === 'requirement' ? r.requirement_code === pedidoEnUrl : r.key === pedidoEnUrl)
  const desdeUrl = rows.find(esElPedido)

  /** Lo último que mostró el panel, nombrado en la URL o no. Al subir el
   *  último documento que se debía de ese documento o empresa, su fila sale
   *  del resumen que vuelve del servidor; sin esto `elegido` saltaba a
   *  `rows[0]`, el panel se remontaba (otra `key`) y se perdían el aviso de lo
   *  guardado y el resultado del lote (y la URL seguía nombrando lo anterior).
   *  Se mantiene el mismo panel, con sus cifras en cero, hasta que se elija
   *  otra cosa. Sin nada en la URL (el escritorio muestra el primero sin que
   *  se elija) vale lo mismo: lo que se estaba mostrando sigue, aunque ya no
   *  sea el primero o ya no esté. */
  const ultimo = useRef<{ groupBy: PendingGroupBy; row: PendingSummaryRow; desdeUrl: boolean } | null>(null)
  const previo = resumen.isSuccess && ultimo.current?.groupBy === groupBy ? ultimo.current : null
  const enCero = (r: PendingSummaryRow) => ({ ...r, overdue: 0, expiring: 0, missing: 0 })
  // Lo nombrado en la URL: si salió del resumen, el que ya se mostraba.
  const seleccion = pedidoEnUrl == null ? undefined
    : desdeUrl ?? (previo && esElPedido(previo.row) ? enCero(previo.row) : undefined)
  // Sin nada en la URL: el que se mostraba solo, con sus cifras frescas si sigue.
  const implicito = pedidoEnUrl == null && previo && !previo.desdeUrl
    ? rows.find(r => r.key === previo.row.key) ?? enCero(previo.row)
    : undefined
  const elegido = seleccion ?? implicito ?? rows[0] ?? null
  // `state` de la URL manda; sin él (o uno desconocido), el primer filtro con algo.
  const pedido = params.get('state') as PendingFilter
  const state: PendingFilter = FILTROS.includes(pedido) ? pedido : defaultPendingFilter(elegido)
  useEffect(() => {
    if (elegido) ultimo.current = { groupBy, row: elegido, desdeUrl: seleccion != null }
  })

  /** Elegir (doc, carrier, by) entra al historial: "Volver" del navegador
   *  —o el gesto del teléfono— vuelve a lo anterior. El filtro (`state`) lo
   *  reemplaza: recorrer filtros no son pasos que haya que deshacer. */
  function cambiar(next: Record<string, string | null>, modo: 'push' | 'replace' = 'push') {
    const qs = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null) qs.delete(k)
      else qs.set(k, v)
    }
    router[modo](`${pathname}?${qs}`, { scroll: false })
  }

  function elegir(key: string) {
    if (groupBy === 'carrier') return cambiar({ carrier: key, doc: null })
    const row = rows.find(r => r.key === key)
    if (row?.requirement_code) cambiar({ doc: row.requirement_code, carrier: null })
  }

  return (
    // pb-24 solo en el teléfono: el layout reserva pb-16 para la barra inferior,
    // pero con etiquetas en dos líneas la barra mide más y tapaba "Guardar" del lote.
    <div className="space-y-3 p-4 pb-24 md:p-6">
      <EncabezadoDePagina titulo="Pendientes" bajada="Solo empresas, conductores y equipos activos.">
        <SegmentedControl<PendingGroupBy>
          label="Ver por"
          value={groupBy}
          onChange={by => cambiar({ by, doc: null, carrier: null })}
          options={[{ id: 'requirement', label: 'Documento' }, { id: 'carrier', label: 'Empresa' }]}
        />
      </EncabezadoDePagina>
      <OperationsRequests />

      {resumen.isPending && (
        <div className="overflow-hidden rounded-lg border border-border bg-white"><PendingSkeleton rows={6} /></div>
      )}
      {resumen.isError && <PendingLoadError onRetry={() => void resumen.refetch()} />}
      {resumen.isSuccess && !elegido && (
        <Estado tipo="vacio" titulo="Todo al día" detalle="Ninguna empresa, conductor ni equipo activo debe documentos." />
      )}
      {resumen.isSuccess && elegido && (
        <div className="grid overflow-hidden rounded-lg border border-border bg-white md:min-h-[330px] md:grid-cols-[300px_1fr]">
          {/* Teléfono: una columna. La lista, o —si se eligió algo— quién lo debe. */}
          <div className={`border-border md:border-r ${seleccion ? 'hidden md:block' : ''}`}>
            <PendingSummaryList rows={rows} groupBy={groupBy} selectedKey={elegido.key} onSelect={elegir} />
          </div>
          <div className={`min-w-0 ${seleccion ? '' : 'hidden md:block'}`}>
            <PendingHoldersPanel
              key={`${groupBy}:${elegido.key}`}
              groupBy={groupBy}
              selected={elegido}
              state={state}
              onStateChange={s => cambiar({ state: s }, 'replace')}
              canUpload={canUpload}
              onBack={() => cambiar({ doc: null, carrier: null })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function PendingDocumentsPage() {
  return <Suspense fallback={null}><Pending /></Suspense>
}
