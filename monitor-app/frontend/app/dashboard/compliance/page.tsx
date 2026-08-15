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
  /** Una sola fila abierta a la vez: el cajón es alto y dos abiertos obligan a
   *  desplazarse para comparar, que es justo lo que el cajón vino a evitar. */
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['certification-status', group, qDebounced],
    queryFn: () => complianceApi.listStatus({ group, q: qDebounced || undefined, limit: 200 }),
    enabled: !!group,
  })

  /** "Resto del catálogo" son 209 empresas sin actividad. Se piden recién al
   *  desplegar el grupo: traerlas siempre cuesta una consulta que casi nadie
   *  lee, y juntas con las activas no caben en el límite de 200. */
  const catalogQuery = useQuery({
    queryKey: ['certification-status-catalog', qDebounced],
    queryFn: () => complianceApi.listStatus({
      group: 'carrier', scope: 'catalog', q: qDebounced || undefined, limit: 300,
    }),
    enabled: group === 'carrier' && catalogoAbierto,
  })

  /** Cuántos archivos esperan que los ubiquen. Se pide con `limit: 1` — de la
   *  respuesta sólo interesa `total` — y comparte clave con el contador del
   *  Sidebar, así los dos se invalidan juntos y no pueden contradecirse. */
  const sinClasificar = useQuery({
    queryKey: ['ingest-queue-count'],
    queryFn: () => documentIngestApi.listQueue({ limit: 1 }),
    staleTime: 60_000,
  }).data?.total ?? 0

  function cambiarVista(v: Vista) {
    // La vista viaja en la URL: volver del detalle no pierde dónde estabas.
    router.replace(v === 'empresas' ? '/dashboard/compliance' : `/dashboard/compliance?vista=${v}`)
  }

  function handleCarrierCreated(created: CarrierCreateResult) {
    setNewCarrierOpen(false)
    router.push(`/dashboard/carriers/${created.id}?tab=documentos`)
  }

  const rows = statusQuery.data?.rows ?? []

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Certificación</h1>
        <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
          Qué le falta a cada empresa para estar en condiciones de operar, y qué
          documentos llegaron todavía sin asignar.
        </p>
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
          <div className="flex items-baseline gap-2 px-4 py-3 border-b border-border">
            <span className="text-2xl font-bold text-slate-800 tabular-nums leading-none">
              {statusQuery.data?.total_pending ?? 0}
            </span>
            <span className="text-xs text-gray-500">documentos por cubrir</span>
            {group === 'carrier' && (statusQuery.data?.total_unclassified ?? 0) > 0 && (
              <span className="text-xs text-gray-400">
                · {statusQuery.data?.total_unclassified} sin clasificar
              </span>
            )}
          </div>

          {statusQuery.isPending && (
            <p className="text-[11px] text-gray-500 p-3 flex items-center gap-1.5">
              <Loader2 size={11} className="motion-safe:animate-spin" /> Cargando…
            </p>
          )}
          {statusQuery.error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 m-3">
              No se pudo cargar el estado de la certificación
            </p>
          )}
          {!statusQuery.isPending && !statusQuery.error && (
            <div className="overflow-y-auto max-h-[64vh]">
              {group === 'carrier' ? (
                // Agrupando por empresa la lista es el embudo de certificación:
                // el usuario mueve empresas por etapas, no vigila un tablero.
                <CertificationFunnel
                  rows={rows}
                  catalogRows={catalogQuery.data?.rows ?? []}
                  catalogLoading={catalogQuery.isPending && catalogoAbierto}
                  onExpandCatalog={() => setCatalogoAbierto(true)}
                  openRowId={filaAbierta}
                  onToggleRow={id => setFilaAbierta(prev => (prev === id ? null : id))}
                  renderDrawer={r => (
                    <CarrierDrawer carrierId={r.entity_id} carrierName={r.entity_name} />
                  )}
                />
              ) : (
                <CertificationStatusTable rows={rows} group={group} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
