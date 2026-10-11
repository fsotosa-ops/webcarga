'use client'

import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, X } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { RenglonPendiente } from '@/components/compliance/RenglonPendiente'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { resumenDeVigencia, vigenciaDe } from '@/lib/vigencia'
import { pendingRowStatus } from '@/lib/pending'
import type { DatosDelDocumento } from '@/lib/compliance'
import type {
  EntityType, PendingComplianceRow, PendingFilter, PendingGroupBy, PendingSummaryResponse, PendingSummaryRow,
} from '@/lib/types'
import { BulkUploadReview } from './BulkUploadReview'
import { PendingLoadError, PendingSkeleton } from './PendingStates'

type Cifra = Exclude<PendingFilter, 'all'>
const NOMBRE: Record<PendingFilter, string> = {
  overdue: 'vencidos', expiring: 'por vencer', missing: 'que faltan', all: 'pendientes',
}
/** Por empresa, lo que debe cada quien, en el orden de la ficha. */
const SECCIONES: { entity: EntityType; titulo: string }[] = [
  { entity: 'CARRIER', titulo: 'La empresa' },
  { entity: 'DRIVER', titulo: 'Conductores' },
  { entity: 'ASSET', titulo: 'Equipos' },
]

/** La columna derecha de Pendientes: quién debe el documento elegido (o qué
 *  debe la empresa elegida), con los filtros por estado y la carga en la fila
 *  o en lote. */
export function PendingHoldersPanel({ groupBy, selected, state, onStateChange, canUpload, onBack }: {
  groupBy: PendingGroupBy
  selected: PendingSummaryRow
  state: PendingFilter
  onStateChange: (s: PendingFilter) => void
  canUpload: boolean
  /** En el teléfono, volver a la lista. */
  onBack?: () => void
}) {
  const qc = useQueryClient()
  const subirDocumento = useSubirDocumento()
  const [aviso, setAviso] = useState<string | null>(null)
  const requirementCode = groupBy === 'requirement' ? selected.requirement_code ?? undefined : undefined
  const carrierId = groupBy === 'carrier' ? selected.key : undefined
  // "Todos" son los tres estados que se deben, no `all`: `all` trae también
  // los documentos al día, y ofrecer "Subir" sobre uno al día no es pendiente.
  const apiState = state === 'all' ? 'pending' : state

  const lista = useQuery({
    queryKey: clavesCertificacion.colaPendientes(apiState, requirementCode, carrierId),
    queryFn: () => complianceApi.listPending({ state: apiState, requirementCode, carrierId, limit: 500 }),
  })

  /** Sube con la única implementación (que ya refresca todo Certificación:
   *  el resumen, la lista, la ficha y la vista rápida) y avisa cuántos quedan
   *  según el resumen que volvió del servidor. */
  async function subir(fila: PendingComplianceRow, archivo: File, datos?: DatosDelDocumento) {
    await subirDocumento(fila.id, archivo, datos)
    const fresco = qc.getQueryData<PendingSummaryResponse>(clavesCertificacion.resumenPendientes(groupBy))
    const quedan = fresco
      ? fresco.rows.find(r => r.key === selected.key)?.overdue ?? 0
      : Math.max(0, selected.overdue - (fila.document_state === 'OVERDUE' ? 1 : 0))
    const quien = fila.subject_name ?? fila.carrier_name
    const resto = quedan === 0 ? 'no quedan vencidos' : quedan === 1 ? 'queda 1 vencido' : `quedan ${quedan} vencidos`
    setAviso(`${fila.document_name} de ${quien} guardado · ${resto}`)
  }

  const cifras: Record<Cifra, number> = { overdue: selected.overdue, expiring: selected.expiring, missing: selected.missing }
  const filas = lista.data?.rows ?? []
  const regla = groupBy === 'requirement' && selected.expiration_policy
    ? resumenDeVigencia(vigenciaDe({ expiration_policy: selected.expiration_policy, vigencia: selected.vigencia }))
    : null

  function renglon(f: PendingComplianceRow) {
    const estado = pendingRowStatus(f)
    const titulo: ReactNode = groupBy === 'requirement'
      ? <>{f.subject_name ?? f.carrier_name}<span className="text-informativo">
          {f.subject_name ? ` · ${f.carrier_name}` : f.carrier_operation_types.length ? ` · ${f.carrier_operation_types.join(' · ')}` : ''}
        </span></>
      : <>{f.document_name}{f.subject_name && <span className="text-informativo"> · {f.subject_name}</span>}</>
    return (
      <RenglonPendiente
        key={f.id}
        fila={f}
        title={titulo}
        status={<StatusChip tone={estado.tone}>{estado.label}</StatusChip>}
        actionLabel={estado.action}
        puedeEditar={canUpload}
        onSubir={subir}
      />
    )
  }

  const otros = (['overdue', 'expiring', 'missing'] as const).filter(s => s !== state && cifras[s] > 0)

  return (
    <section aria-label={selected.label} className="min-w-0 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-lectura font-semibold text-text-primary">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Volver a la lista"
                    className="-ml-1 rounded p-1 text-accion hover:bg-bg-main md:hidden">
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          )}
          <span className="truncate">{selected.label}</span>
        </h2>
        {regla && <span className="text-etiqueta text-informativo">{regla}</span>}
        <span className="md:ml-auto">
          <SegmentedControl<PendingFilter>
            label="Estado"
            value={state}
            onChange={onStateChange}
            options={[
              { id: 'overdue', label: 'Vencidos', badge: String(cifras.overdue) },
              { id: 'expiring', label: 'Por vencer', badge: String(cifras.expiring) },
              { id: 'missing', label: 'Faltan', badge: String(cifras.missing) },
              { id: 'all', label: 'Todos', badge: String(cifras.overdue + cifras.expiring + cifras.missing) },
            ]}
          />
        </span>
      </div>

      {canUpload && groupBy === 'requirement' && <BulkUploadReview requirement={selected} />}

      {aviso && (
        <div role="status" className="mb-2 flex items-center gap-2 rounded-md bg-text-primary px-3 py-2 text-white">
          <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-etiqueta">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso"
                  className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {lista.isPending && <PendingSkeleton />}

      {lista.isError && <PendingLoadError onRetry={() => void lista.refetch()} />}

      {lista.isSuccess && filas.length === 0 && (
        <Estado tipo="vacio" titulo={`No hay ${selected.label} ${NOMBRE[state]}`}>
          {otros.length > 0 && (
            <p className="text-dato text-informativo">
              Hay{' '}
              {otros.map((s, i) => (
                <span key={s}>
                  {i > 0 && ' y '}
                  <button type="button" onClick={() => onStateChange(s)}
                          className="font-semibold text-accion hover:underline">
                    {`${cifras[s]} ${NOMBRE[s]}`}
                  </button>
                </span>
              ))}
              .
            </p>
          )}
        </Estado>
      )}

      {lista.isSuccess && filas.length > 0 && groupBy === 'requirement' && (
        <div className="overflow-hidden rounded-md border border-border">{filas.map(renglon)}</div>
      )}

      {lista.isSuccess && filas.length > 0 && groupBy === 'carrier' && (
        <div className="overflow-hidden rounded-md border border-border">
          {SECCIONES.map(({ entity, titulo }) => {
            const deEsta = filas.filter(f => f.entity_type === entity)
            if (deEsta.length === 0) return null
            const id = `pending-section-${entity}`
            return (
              <section key={entity} aria-labelledby={id}>
                <h3 id={id} className="border-b border-border bg-bg-main px-3 py-1.5 text-etiqueta font-semibold text-informativo">
                  {titulo}
                </h3>
                {deEsta.map(renglon)}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
