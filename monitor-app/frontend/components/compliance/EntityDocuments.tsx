'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { complianceApi } from '@/lib/api/compliance'
import { certificationRequestsApi } from '@/lib/api/certificationRequests'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { DOCUMENT_STATE_GROUP_LABELS, type DocumentState } from '@/lib/states'
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { Table, TableHeader } from '@/components/ui/tabla/Table'
import { SolicitarDocumento } from './SolicitarDocumento'
import { BulkUploadReview } from './pending/BulkUploadReview'
import { SubjectDocumentRows, useDocumentPreview } from './SubjectDocumentRows'

type Filter = 'OVERDUE' | 'MISSING' | 'EXPIRING' | 'all'
/** El orden de los filtros es el de Pendientes; abre en el primero con algo en
 *  el orden de urgencia: vencido, falta, por vencer. */
const URGENCY: Exclude<Filter, 'all'>[] = ['OVERDUE', 'MISSING', 'EXPIRING']

/** La sección Documentos de la ficha de un conductor o un equipo (Entrega 1 de
 *  fichas, 15/10): Pendientes en chico. El control segmentado de Pendientes, la
 *  franja de subida en lote y las mismas filas (`SubjectDocumentRows`) que la
 *  ficha de empresa. Pide por entidad: sin empresa igual muestra sus
 *  documentos (RF1; la ficha existe sin empresa, C5). */
export function EntityDocuments({ entityType, entityId, carrierId, requested }: {
  entityType: 'DRIVER' | 'ASSET'
  entityId: string
  carrierId: string | null
  /** Los requisitos que Operaciones ya pidió a Certificación (`requirement_id`). */
  requested?: ReadonlySet<string>
}) {
  const canEdit = usePermiso('documents.upload')
  const puedeRevisar = usePermiso('documents.review')
  const puedePedir = usePermiso('certification.request')
  const subirDocumento = useSubirDocumento()
  const queryClient = useQueryClient()
  const preview = useDocumentPreview(canEdit)
  const [chosen, setChosen] = useState<Filter | null>(null)

  const rowsQuery = useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId ?? undefined, entityId, 'todos'),
    queryFn: () => complianceApi.listPending({ carrierId: carrierId ?? undefined, entityId, estado: 'todos', limit: 200 }),
  })
  const rows = rowsQuery.data?.rows ?? []
  const count = (s: DocumentState) => rows.filter(r => r.document_state === s).length
  const filter: Filter = chosen ?? URGENCY.find(s => count(s) > 0) ?? 'all'
  const options: SegmentedOption<Filter>[] = [
    ...URGENCY.map(s => ({ id: s, label: DOCUMENT_STATE_GROUP_LABELS[s], badge: String(count(s)) })),
    { id: 'all' as const, label: 'Todos', badge: String(rows.length) },
  ]
  const visible = filter === 'all' ? rows : rows.filter(r => r.document_state === filter)

  return (
    <section aria-label="Documentos" className="space-y-3 rounded-2xl border border-border bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lectura font-bold text-text-primary">Documentos</h2>
        {rowsQuery.isSuccess && rows.length > 0 && (
          <SegmentedControl label="Filtrar documentos" options={options} value={filter} onChange={setChosen} />
        )}
      </div>
      {canEdit && <BulkUploadReview carrierId={carrierId} />}

      {rowsQuery.isPending && <Estado tipo="cargando" />}
      {rowsQuery.error && (
        <Estado tipo="error" titulo="No se pudo cargar la documentación"
                detalle={rowsQuery.error instanceof Error ? rowsQuery.error.message : undefined} />
      )}
      {rowsQuery.isSuccess && rows.length === 0 && (
        <Estado tipo="vacio" titulo="No se le exige ningún documento" />
      )}
      {rowsQuery.isSuccess && visible.length > 0 && (
        <Table header={<TableHeader><span className="flex-1">Documento</span><span className="w-52">Estado</span></TableHeader>}>
          <SubjectDocumentRows filas={visible} carrierId={carrierId} canEdit={canEdit} puedeRevisar={puedeRevisar}
                               preview={preview}
                               subir={(fila, archivo, datos) => subirDocumento(fila.id, archivo, datos)}
                               onFechaCorregida={() => { void invalidarCertificacion(queryClient) }}
                               requested={requested}
                               onRequest={puedePedir ? async fila => {
                                 await certificationRequestsApi.create({ entity_type: entityType, entity_id: entityId, requirement_id: fila.requirement_id })
                                 // La ficha lee de sus documentos qué está pedido.
                                 await queryClient.invalidateQueries({ queryKey: [entityType === 'DRIVER' ? 'driver-compliance-records' : 'asset-compliance-records', entityId] })
                               } : undefined} />
        </Table>
      )}
      {puedeRevisar && rowsQuery.isSuccess && <SolicitarDocumento entityType={entityType} entityId={entityId} />}
      {preview.modal}
    </section>
  )
}
