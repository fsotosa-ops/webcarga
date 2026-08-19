'use client'

import { Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Inbox, Loader2, Plus } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { CertificationStatusTable } from '@/components/compliance/CertificationStatusTable'
import { CertificationFunnel } from '@/components/compliance/CertificationFunnel'
import { CarrierDrawer } from '@/components/compliance/CarrierDrawer'
import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { CarrierCreateResult } from '@/lib/api/carriers'
import type { CertificationGroup } from '@/lib/types'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { Cifra } from '@/components/ui/Cifra'
import { Estado } from '@/components/ui/Estado'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { enlaceAFilaAbierta, useFilaAbierta } from '@/hooks/useFilaAbierta'

type Vista = 'empresas' | 'conductores' | 'vehiculos' | 'requisitos' | 'documentos'

/** Las cuatro agrupaciones miran los MISMOS pendientes, agrupados distinto: el
 *  control no crea vistas nuevas y no hay dos listas que sincronizar (§4).
 *
 *  `documentos` no está acá a propósito: la bandeja no es una quinta
 *  agrupación. Son archivos que todavía no pertenecen a nada, así que vive
 *  detrás de su propio botón, con contador. Sigue viajando en `?vista=` para
 *  no romper los enlaces que ya existen. */
const AGRUPACIONES: { id: Vista; label: string; group: CertificationGroup }[] = [
  { id: 'empresas',    label: 'Empresa',   group: 'carrier' },
  { id: 'conductores', label: 'Conductor', group: 'driver' },
  { id: 'vehiculos',   label: 'Vehículo',  group: 'asset' },
  { id: 'requisitos',  label: 'Requisito', group: 'requirement' },
]

const VISTA_BANDEJA: Vista = 'documentos'

function csvEscape(v: string) {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Exportación de todo lo pendiente. Vivía en la sábana de pendientes; la
 *  sábana se retiró al unificar el módulo, pero la capacidad no tenía por qué
 *  irse con ella. */
async function exportarPendientes() {
  const { rows } = await complianceApi.listPending({ limit: 200 })
  const header = ['Empresa', 'Tipo certificación', 'Categoría', 'Sub categoría', 'Tipo de documento']
  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push([r.carrier_name, r.certification_type, r.category, r.subject_name ?? '', r.document_name]
      .map(csvEscape).join(';'))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'certificacion_pendiente.csv'; a.click()
  URL.revokeObjectURL(url)
}

const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

export default function CertificationPage() {
  return (
    <Suspense fallback={null}>
      <CertificationPageInner />
    </Suspense>
  )
}

/** Módulo Certificación — una sola lista, dos maneras de mirarla.
 *
 *  Antes esto eran tres cosas distintas en el menú: la sábana de pendientes,
 *  la bandeja de sin clasificar y Empresas. Son vistas del mismo objeto —el
 *  estado documental de una empresa— y tenerlas separadas obligaba a cruzarlas
 *  de memoria. Acá "Por empresa" responde cómo va cada una, y "Por documento"
 *  es la cola transversal, útil cuando llega una tanda grande y no importa de
 *  qué empresa es. */
function CertificationPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const param = searchParams.get('vista')
  const esVistaConocida = param === VISTA_BANDEJA || AGRUPACIONES.some(v => v.id === param)
  const vista: Vista = esVistaConocida ? (param as Vista) : 'empresas'
  const group = AGRUPACIONES.find(v => v.id === vista)?.group
  const [q, setQ] = useState('')
  const [newCarrierOpen, setNewCarrierOpen] = useState(false)
  const [exportando, setExportando] = useState(false)
  const qDebounced = useDebouncedValue(q, 300)

  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  /** Una sola fila abierta a la vez. La regla y su razón viven en el hook,
   *  porque este módulo tiene cuatro listas del mismo objeto. */
  const { abierta: filaAbierta, alternar: alternarFila } = useFilaAbierta()

  const statusQuery = useQuery({
    queryKey: clavesCertificacion.estado(group ?? '', qDebounced),
    queryFn: () => complianceApi.listStatus({ group, q: qDebounced || undefined, limit: 200 }),
    enabled: !!group,
  })

  /** "Resto del catálogo" son 209 empresas sin actividad. Se piden recién al
   *  desplegar el grupo: traerlas siempre cuesta una consulta que casi nadie
   *  lee, y juntas con las activas no caben en el límite de 200. */
  const catalogQuery = useQuery({
    queryKey: clavesCertificacion.catalogo(qDebounced),
    queryFn: () => complianceApi.listStatus({
      group: 'carrier', scope: 'catalog', q: qDebounced || undefined, limit: 300,
    }),
    enabled: group === 'carrier' && catalogoAbierto,
  })

  /** Cuántos archivos esperan que los ubiquen. Se pide con `limit: 1` — de la
   *  respuesta sólo interesa `total` — y comparte clave con el contador del
   *  Sidebar, así los dos se invalidan juntos y no pueden contradecirse. */
  const sinClasificar = useQuery({
    queryKey: clavesCertificacion.colaTotal(),
    queryFn: () => documentIngestApi.listQueue({ limit: 1 }),
    staleTime: 60_000,
  }).data?.total ?? 0

  /** Ir a una empresa SIN salir de Certificación: cambia de vista y deja su
   *  fila abierta. Antes esto era un enlace a la ficha de Empresas, o sea que
   *  el módulo empujaba de vuelta al flujo que vino a reemplazar.
   *
   *  La empresa viaja en la URL y no sólo en el estado: es lo que hace que
   *  volver con el botón atrás caiga donde estabas, y que el enlace se pueda
   *  compartir. */
  function irAEmpresa(carrierId: string) {
    router.push(enlaceAFilaAbierta('/dashboard/compliance', carrierId))
  }

  function cambiarVista(v: Vista) {
    // La vista viaja en la URL: volver del detalle no pierde dónde estabas.
    router.replace(v === 'empresas' ? '/dashboard/compliance' : `/dashboard/compliance?vista=${v}`)
  }

  function handleCarrierCreated(created: CarrierCreateResult) {
    setNewCarrierOpen(false)
    // Cuarto y ultimo punto de fuga al Empresas legacy. Crear una empresa
    // desde Certificacion y aterrizar en otro modulo obligaba a rehacer el
    // filtro para volver a la cola de trabajo, que es justo lo que este
    // modulo vino a evitar.
    router.push(enlaceAFilaAbierta('/dashboard/compliance', created.id))
  }

  const rows = statusQuery.data?.rows ?? []

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <EncabezadoDePagina
          titulo="Certificación"
          bajada="Qué le falta a cada empresa para estar en condiciones de operar, y qué documentos llegaron todavía sin asignar."
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">Agrupar por</span>
        <div
          role="group"
          aria-label="Agrupar por"
          className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit"
        >
          {AGRUPACIONES.map(({ id: v, label }) => (
            <button
              key={v}
              onClick={() => cambiarVista(v)}
              aria-pressed={vista === v}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                vista === v ? 'bg-white text-text-primary shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* La bandeja vive detrás de su propio botón, con contador: no es una
            agrupación más. El rojo #b00020 con su único significado — hay
            archivos esperando (§9). Sin archivos no se dibuja un cero: un cero
            en rojo pediría atención sobre nada. */}
        <button
          type="button"
          onClick={() => cambiarVista(VISTA_BANDEJA)}
          aria-pressed={vista === VISTA_BANDEJA}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            vista === VISTA_BANDEJA
              ? 'border-accent/40 bg-accent/5 text-text-primary'
              : 'border-border bg-white text-gray-600 hover:text-gray-800'
          }`}
        >
          <Inbox size={13} />
          Sin clasificar
          {sinClasificar > 0 && (
            <span
              className="rounded-full bg-espera px-1.5 py-px text-[10px] font-bold tabular-nums text-white"
            >
              {sinClasificar}
            </span>
          )}
        </button>

        {group && (
          <>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={group === 'carrier' ? 'Buscar empresa…'
                : group === 'driver' ? 'Buscar conductor…'
                : group === 'requirement' ? 'Buscar documento…' : 'Buscar patente…'}
              aria-label="Buscar"
              className={INPUT + ' w-64'}
            />
            <div className="ml-auto flex items-center gap-2">
              {group === 'carrier' && (<>
              <button
                type="button"
                onClick={async () => {
                  setExportando(true)
                  try { await exportarPendientes() } finally { setExportando(false) }
                }}
                disabled={exportando}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-accent transition-colors disabled:opacity-50 cursor-pointer"
              >
                {exportando
                  ? <Loader2 size={13} className="motion-safe:animate-spin" />
                  : <Download size={13} />}
                Exportar pendientes
              </button>
              <button
                type="button"
                onClick={() => setNewCarrierOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent border border-accent/30 rounded-lg px-2.5 py-1.5 hover:bg-accent/5 transition-colors cursor-pointer"
              >
                <Plus size={13} /> Nueva empresa
              </button>
              </>)}
            </div>
          </>
        )}
      </div>

      <NewCarrierPanel
        open={newCarrierOpen}
        onClose={() => setNewCarrierOpen(false)}
        onCreated={handleCarrierCreated}
      />

      {!group ? (
        <TriageWorkbench />
      ) : (
        <div className="border border-border rounded-xl bg-white overflow-hidden">
          <div className="flex items-baseline gap-2 px-4 py-3 border-b border-border min-h-[3.25rem]">
            <Cifra
              valor={statusQuery.data?.total_pending}
              etiqueta="documentos por cubrir"
              cargando={statusQuery.isPending}
            />
            {!statusQuery.isPending &&
              group === 'carrier' &&
              (statusQuery.data?.total_unclassified ?? 0) > 0 && (
                <span className="text-etiqueta text-gray-400">
                  · {statusQuery.data?.total_unclassified} sin clasificar
                </span>
              )}
          </div>

          {statusQuery.isPending && <Estado tipo="cargando" />}
          {statusQuery.error && (
            <Estado
              tipo="error"
              titulo="No se pudo cargar el estado de la certificación"
              detalle="Vuelve a intentarlo; si sigue fallando, avisa al equipo."
            />
          )}
          {!statusQuery.isPending && !statusQuery.error && (
            <div className="overflow-y-auto max-h-[64vh]">
              {group === 'carrier' ? (
                // Agrupando por empresa la lista es el embudo de certificación:
                // el usuario mueve empresas por etapas, no vigila un tablero.
                <CertificationFunnel
                  rows={rows}
                  catalogRows={catalogQuery.data?.rows ?? []}
                  catalogEstado={
                    !catalogoAbierto        ? 'sin-pedir'
                      : catalogQuery.isError  ? 'error'
                      : catalogQuery.isPending ? 'cargando'
                      : 'listo'
                  }
                  // Volver a desplegar el grupo tras un error tiene que
                  // reintentar de verdad: `setCatalogoAbierto(true)` cuando ya
                  // está en `true` no dispara nada, así que el usuario quedaba
                  // sin forma de recuperarse salvo recargar la página.
                  onExpandCatalog={() => {
                    setCatalogoAbierto(true)
                    if (catalogQuery.isError) catalogQuery.refetch()
                  }}
                  openRowId={filaAbierta}
                  onToggleRow={alternarFila}
                  renderDrawer={r => (
                    <CarrierDrawer carrierId={r.entity_id} carrierName={r.entity_name} />
                  )}
                />
              ) : (
                <CertificationStatusTable
                  rows={rows}
                  group={group}
                  openRowId={filaAbierta}
                  onToggleRow={alternarFila}
                  // El MISMO cajón que la vista Empresas, acotado al sujeto —
                  // una prop, no un componente hermano.
                  renderDrawer={r => r.carrier_id ? (
                    <CarrierDrawer
                      carrierId={r.carrier_id}
                      carrierName={r.carrier_name ?? ''}
                      subject={{
                        entity_type: group === 'driver' ? 'DRIVER' : 'ASSET',
                        entity_id: r.entity_id,
                      }}
                    />
                  ) : null}
                  onIrAEmpresa={irAEmpresa}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
