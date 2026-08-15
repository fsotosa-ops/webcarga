'use client'

import { Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Loader2, Plus } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { CertificationStatusTable } from '@/components/compliance/CertificationStatusTable'
import { CertificationFunnel } from '@/components/compliance/CertificationFunnel'
import { TriageWorkbench } from '@/components/compliance/TriageWorkbench'
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { CarrierCreateResult } from '@/lib/api/carriers'
import type { CertificationGroup } from '@/lib/types'

type Vista = 'empresas' | 'conductores' | 'vehiculos' | 'documentos'

// Las tres primeras son la misma lista agrupada distinto; la cuarta es la cola.
const VISTAS: { id: Vista; label: string; group?: CertificationGroup }[] = [
  { id: 'empresas',    label: 'Empresas',    group: 'carrier' },
  { id: 'conductores', label: 'Conductores', group: 'driver' },
  { id: 'vehiculos',   label: 'Vehículos',   group: 'asset' },
  { id: 'documentos',  label: 'Documentos' },
]

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
  const vista: Vista = VISTAS.some(v => v.id === param) ? (param as Vista) : 'empresas'
  const group = VISTAS.find(v => v.id === vista)?.group
  const [q, setQ] = useState('')
  const [newCarrierOpen, setNewCarrierOpen] = useState(false)
  const [exportando, setExportando] = useState(false)
  const qDebounced = useDebouncedValue(q, 300)

  const [catalogoAbierto, setCatalogoAbierto] = useState(false)

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
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {VISTAS.map(({ id: v, label }) => (
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

        {group && (
          <>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={group === 'carrier' ? 'Buscar empresa…'
                : group === 'driver' ? 'Buscar conductor…' : 'Buscar patente…'}
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
