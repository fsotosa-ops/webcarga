'use client'

import { Suspense, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { Download, Loader2, X } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { PendingDocumentsTable } from '@/components/dashboard/PendingDocumentsTable'
import { BulkDocumentUploadModal } from '@/components/dashboard/BulkDocumentUploadModal'
import { CarrierSearchPicker, type CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { PendingComplianceRow } from '@/lib/types'

type Tab = 'resumen' | 'pendientes' | 'sin-clasificar'

const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

function csvEscape(v: string) {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function exportCsv(rows: PendingComplianceRow[]) {
  const header = ['Empresa', 'Tipo certificación', 'Categoría', 'Sub categoría', 'Tipo de documento']
  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push([r.carrier_name, r.certification_type, r.category, r.subject_name ?? '', r.document_name].map(csvEscape).join(';'))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'certificacion_pendiente.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function CertificationPage() {
  return (
    <Suspense fallback={null}>
      <CertificationPageInner />
    </Suspense>
  )
}

/** Módulo Certificación (sábana) — cruza documentos de compliance
 *  pendientes de toda la flota en una sola pantalla, en vez de navegar
 *  empresa por empresa → conductor por conductor → tracto por tracto.
 *  Adapta el diseño validado en Figma (node-id=16-9949) al Compliance
 *  Engine ya construido — ver plan del módulo. Los tabs "RESUMEN"/
 *  "DOCUMENTOS SIN CLASIFICAR" quedan deshabilitados a propósito (sin
 *  criterios de aceptación definidos / requieren modelo de datos nuevo,
 *  ver plan). Único punto de carga de documentos de la app — Empresas
 *  (TransporterDocumentsPanel/DocumentChecklist) quedó en modo lectura
 *  y enlaza acá vía `?carrier_id=` para no duplicar el entry point. */
function CertificationPageInner() {
  const searchParams = useSearchParams()
  const carrierIdParam = searchParams.get('carrier_id')

  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('pendientes')
  const [category, setCategory] = useState<'' | 'CARRIER' | 'DRIVER' | 'ASSET'>('')
  const [operationType, setOperationType] = useState<'' | 'Tractoreo' | 'Equipo Completo'>('')
  const [q, setQ] = useState('')
  const [carrierFilter, setCarrierFilter] = useState<string | null>(carrierIdParam)
  const [carrierQuery, setCarrierQuery]   = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCarrier, setBulkCarrier] = useState<{ id: string; name: string; taxId: string } | null>(null)

  const qDebounced = useDebouncedValue(q, 300)

  const pendingQuery = useQuery({
    queryKey: ['compliance-pending', category, operationType, qDebounced, carrierFilter],
    queryFn: () => complianceApi.listPending({
      category: category || undefined,
      operationType: operationType || undefined,
      q: qDebounced || undefined,
      carrierId: carrierFilter || undefined,
      limit: 200,
    }),
  })
  const rows = pendingQuery.data?.rows ?? []
  const filteredCarrierName = rows[0]?.carrier_name

  const bulkSlotsQuery = useQuery({
    queryKey: ['compliance-pending-carrier', bulkCarrier?.id],
    queryFn: () => complianceApi.listPending({ carrierId: bulkCarrier!.id, limit: 200 }),
    enabled: !!bulkCarrier,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['compliance-pending'] })
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev => (prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id))))
  }

  async function handleUploadSingle(recordId: string, file: File) {
    await complianceApi.uploadFile(recordId, file)
    invalidate()
  }

  function handleCarrierPicked(c: CarrierSearchResult) {
    setCarrierFilter(c.id)
    setCarrierQuery(c.business_name)
  }

  function handleOpenBulkUpload() {
    const selectedRows = rows.filter(r => selected.has(r.id))
    if (!selectedRows.length) return
    const first = selectedRows[0]
    setBulkCarrier({ id: first.carrier_id, name: first.carrier_name, taxId: first.carrier_tax_id })
  }

  function handleBulkSaved() {
    setSelected(new Set())
    invalidate()
  }

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Certificación</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Documentación pendiente de toda la flota en una sola pantalla — sin navegar empresa por empresa.
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        <button
          disabled
          aria-pressed={tab === 'resumen'}
          title="Próximamente"
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-gray-300 cursor-not-allowed"
        >
          Resumen
        </button>
        <button
          onClick={() => setTab('pendientes')}
          aria-pressed={tab === 'pendientes'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'pendientes' ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Documentos Pendientes
        </button>
        <button
          disabled
          aria-pressed={tab === 'sin-clasificar'}
          title="Próximamente"
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-gray-300 cursor-not-allowed"
        >
          Documentos Sin Clasificar
        </button>
      </div>

      {tab === 'pendientes' && (
        <>
          <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">Filtrar por:</span>
            <select value={category} onChange={e => setCategory(e.target.value as typeof category)} aria-label="Filtrar por categoría" className={INPUT}>
              <option value="">Todas las categorías</option>
              <option value="CARRIER">Empresa</option>
              <option value="DRIVER">Chofer</option>
              <option value="ASSET">Equipo</option>
            </select>
            <select value={operationType} onChange={e => setOperationType(e.target.value as typeof operationType)} aria-label="Filtrar por tipo de operación" className={INPUT}>
              <option value="">Todos los tipos de operación</option>
              <option value="Tractoreo">Tractoreo</option>
              <option value="Equipo Completo">Equipo Completo</option>
            </select>
            <input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar por conductor o patente…"
              aria-label="Buscar" className={INPUT + ' w-64'}
            />
            {!carrierFilter ? (
              <div className="w-56 shrink-0">
                <CarrierSearchPicker
                  query={carrierQuery}
                  onQueryChange={setCarrierQuery}
                  onPick={handleCarrierPicked}
                  placeholder="Buscar empresa…"
                  size="sm"
                />
              </div>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold bg-accent/10 text-accent rounded-full pl-2.5 pr-1.5 py-1">
                {filteredCarrierName ?? 'Empresa'}
                <button
                  type="button"
                  onClick={() => { setCarrierFilter(null); setCarrierQuery('') }}
                  aria-label="Quitar filtro de empresa"
                  className="hover:bg-accent/20 rounded-full p-0.5 transition-colors"
                >
                  <X size={11} />
                </button>
              </span>
            )}
            <button
              onClick={() => exportCsv(rows)}
              disabled={rows.length === 0}
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
            >
              <Download size={13} />
              Exportar
            </button>
          </div>

          {pendingQuery.isPending && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
              <Loader2 size={14} className="animate-spin" /> Cargando…
            </div>
          )}
          {pendingQuery.error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              Error al cargar los documentos pendientes
            </p>
          )}
          {!pendingQuery.isPending && !pendingQuery.error && (
            <PendingDocumentsTable
              rows={rows}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onUploadSingle={handleUploadSingle}
              onOpenBulkUpload={handleOpenBulkUpload}
            />
          )}
        </>
      )}

      {bulkCarrier && (
        <BulkDocumentUploadModal
          open
          carrierId={bulkCarrier.id}
          carrierName={bulkCarrier.name}
          carrierTaxId={bulkCarrier.taxId}
          pendingSlots={bulkSlotsQuery.data?.rows ?? []}
          onClose={() => setBulkCarrier(null)}
          onSaved={handleBulkSaved}
        />
      )}
    </div>
  )
}
