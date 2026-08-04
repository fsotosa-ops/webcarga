'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { PendingDocumentsTable } from '@/components/dashboard/PendingDocumentsTable'
import { BulkDocumentUploadModal } from '@/components/dashboard/BulkDocumentUploadModal'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { PendingComplianceRow } from '@/lib/types'

type Tab = 'certificacion' | 'pendientes' | 'sin-clasificar'

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
  a.href = url; a.download = 'documentos_pendientes.csv'; a.click()
  URL.revokeObjectURL(url)
}

/** Módulo Documentos (sábana) — cruza documentos pendientes de toda la
 *  flota en una sola pantalla, en vez de navegar empresa por empresa →
 *  conductor por conductor → tracto por tracto. Adapta el diseño validado
 *  en Figma (node-id=16-9949) al Compliance Engine ya construido — ver
 *  plan del módulo. Los tabs "CERTIFICACION"/"DOCUMENTOS SIN CLASIFICAR"
 *  quedan deshabilitados a propósito (sin criterios de aceptación
 *  definidos / requieren modelo de datos nuevo, ver plan). */
export default function DocumentsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('pendientes')
  const [category, setCategory] = useState<'' | 'CARRIER' | 'DRIVER' | 'ASSET'>('')
  const [operationType, setOperationType] = useState<'' | 'Tractoreo' | 'Equipo Completo'>('')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCarrier, setBulkCarrier] = useState<{ id: string; name: string; taxId: string } | null>(null)

  const qDebounced = useDebouncedValue(q, 300)

  const pendingQuery = useQuery({
    queryKey: ['compliance-pending', category, operationType, qDebounced],
    queryFn: () => complianceApi.listPending({
      category: category || undefined,
      operationType: operationType || undefined,
      q: qDebounced || undefined,
      limit: 200,
    }),
  })
  const rows = pendingQuery.data?.rows ?? []

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
        <h1 className="font-mulish font-bold text-xl text-text-primary">Documentos</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Documentación pendiente de toda la flota en una sola pantalla — sin navegar empresa por empresa.
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        <button
          disabled
          aria-pressed={tab === 'certificacion'}
          title="Próximamente"
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-gray-300 cursor-not-allowed"
        >
          Certificación
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
              placeholder="Buscar por empresa, conductor o patente…"
              aria-label="Buscar" className={INPUT + ' w-64'}
            />
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
