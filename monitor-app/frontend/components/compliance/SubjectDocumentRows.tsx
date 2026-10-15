'use client'

import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { camposQuePide, puedeCorregirVencimiento, type DatosDelDocumento } from '@/lib/compliance'
import { documentEvidenceStyle } from '@/lib/states'
import { pendingRowStatus } from '@/lib/pending'
import { invalidarCertificacion } from '@/lib/queries/certificacion'
import { RenglonPendiente } from '@/components/compliance/RenglonPendiente'
import { AvisoDeFila } from '@/components/compliance/AvisoDeFila'
import { DocumentVersions } from '@/components/compliance/DocumentVersions'
import { ReassignDocument } from '@/components/compliance/ReassignDocument'
import { RequestToCertification } from '@/components/compliance/RequestToCertification'
import { ExpirationDateCell } from '@/components/dashboard/ExpirationDateCell'
import { DocumentPreviewModal } from '@/components/dashboard/DocumentPreviewModal'
import { StatusChip } from '@/components/ui/StatusChip'
import type { PendingComplianceRow } from '@/lib/types'

/** "Ver" un documento, con su aviso si no abre nada. Movido de la ficha de
 *  empresa (Entrega 1 de fichas, 15/10) para que la ficha de un conductor o un
 *  equipo lo haga igual. Se guarda el id y no la fila: `/pending` nunca trae
 *  `file_url` firmada (firmar ahí sería una llamada por archivo), así que se
 *  vuelve a pedir el registro de a uno cuando alguien elige "Ver". */
export function useDocumentPreview(canEdit: boolean) {
  const [viendoId, setViendoId] = useState<string | null>(null)
  const [viendoLabel, setViendoLabel] = useState('')
  const previewQuery = useQuery({
    queryKey: ['compliance-record-file', viendoId],
    queryFn: () => complianceApi.get(viendoId!),
    enabled: !!viendoId,
  })
  /** Por qué "Ver" no abrió nada: no puede parecer que no pasó nada. */
  const avisoVer =
    !viendoId || previewQuery.isFetching       ? null
    : previewQuery.error                       ? 'No se pudo abrir el documento. Vuelve a intentarlo.'
    : previewQuery.data && !previewQuery.data.file_url
                                               ? 'Este registro no tiene un archivo que abrir.'
    : null

  function ver(fila: PendingComplianceRow) {
    // Volver a tocar "Ver" sobre la MISMA fila no cambia el estado: sin este
    // refetch el botón quedaba muerto hasta recargar (React Query no reintenta
    // sola una consulta en error).
    if (viendoId === fila.id) { void previewQuery.refetch(); return }
    setViendoId(fila.id)
    setViendoLabel(fila.document_name)
  }

  const modal = viendoId && previewQuery.data?.file_url ? (
    <DocumentPreviewModal label={viendoLabel} url={previewQuery.data.file_url} canEdit={canEdit} onClose={() => setViendoId(null)} />
  ) : null

  return { viendoId, avisoVer, previewFetching: previewQuery.isFetching, ver, modal }
}

export type DocumentPreview = ReturnType<typeof useDocumentPreview>

/** Un documento al día: nombre, vencimiento editable, estado y "Ver". */
function FilaDocumento({ fila, viendo, avisoVer, onVer, puedeEditar, onFechaCorregida, acciones }: {
  fila:     PendingComplianceRow
  acciones?: ReactNode
  viendo:   boolean
  avisoVer: string | null
  puedeEditar: boolean
  onFechaCorregida: () => void
  /** Ausente cuando no hay archivo que abrir: estar al día no implica tenerlo
   *  (una aprobación manual sin evidencia adjunta no tiene blob). */
  onVer?:   () => void
}) {
  // "Falta" significaba dos cosas: no saber nada del documento, y saber cuándo
  // vence pero no tener el papel. El segundo ya no hay que averiguarlo, hay
  // que pedirlo.
  const s = documentEvidenceStyle(fila.document_state, fila.expiration_date, fila.tiene_archivo)
  return (
    <div className="min-h-10 border-b border-border px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-dato text-text-primary">{fila.document_name}</span>
        <span className="shrink-0 tabular-nums">
          <ExpirationDateCell recordId={fila.id} value={fila.expiration_date ?? null}
                              required={fila.expiration_policy === 'REQUIRED'} canEdit={puedeEditar} onSaved={onFechaCorregida} />
        </span>
        <span className="shrink-0"><StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip></span>
        {acciones}
        {onVer && (
          <button type="button" onClick={onVer} disabled={viendo}
                  className="inline-flex shrink-0 items-center gap-1.5 text-etiqueta font-semibold text-accion transition-opacity hover:opacity-70 disabled:opacity-50">
            {viendo ? <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            Ver
          </button>
        )}
      </div>
      {avisoVer && <AvisoDeFila mensaje={avisoVer} onReintentar={onVer} />}
    </div>
  )
}

/** Las filas de documentos de UN sujeto (empresa, conductor o equipo), con lo
 *  que se hace sobre cada una. Las comparten la ficha de empresa (una tarjeta
 *  por sujeto) y la de conductor o equipo (Entrega 1 de fichas, 15/10). Lo que
 *  falta, vence o venció se dice con las palabras de Pendientes
 *  (`pendingRowStatus`): un solo vocabulario en toda la app. */
export function SubjectDocumentRows({ filas, carrierId, canEdit, puedeRevisar, preview, subir, onFechaCorregida, onRequest, requested }: {
  filas: PendingComplianceRow[]
  /** Reasignar a otro requisito busca dentro de la empresa; sin empresa no se ofrece. */
  carrierId: string | null
  canEdit: boolean
  puedeRevisar: boolean
  preview: DocumentPreview
  subir: (fila: PendingComplianceRow, archivo: File, datos?: DatosDelDocumento) => Promise<void>
  /** Una fecha nueva puede mover el documento de estado: quien lo aloja repide. */
  onFechaCorregida: () => void
  /** Para quien no sube pero puede pedir (Operaciones, Entrega B): pedir el documento a Certificación. */
  onRequest?: (fila: PendingComplianceRow) => Promise<void>
  /** Los requisitos ya pedidos (`requirement_id`), que no se vuelven a pedir. */
  requested?: ReadonlySet<string>
}) {
  const queryClient = useQueryClient()
  async function quitarSolicitud(recordId: string) {
    await complianceApi.quitarSolicitud(recordId)
    await invalidarCertificacion(queryClient)
  }
  /** Con archivo: sus versiones y reasignarlo a otro requisito (HU-03). Reasignar
   *  es `documents.review`, el permiso que exige la API: con solo poder subir
   *  sería un botón que responde 403. */
  const accionesDe = (f: PendingComplianceRow) => f.tiene_archivo ? (
    <>
      <DocumentVersions recordId={f.id} />
      {puedeRevisar && carrierId && <ReassignDocument recordId={f.id} carrierId={carrierId} onDone={() => { void invalidarCertificacion(queryClient) }} />}
    </>
  ) : undefined

  return <>{filas.map(f => {
    const ver = f.tiene_archivo ? () => preview.ver(f) : undefined
    const viendo = preview.viendoId === f.id && preview.previewFetching
    const avisoVer = preview.viendoId === f.id ? preview.avisoVer : null
    if (f.document_state === 'UP_TO_DATE') {
      return (
        <FilaDocumento key={f.id} fila={f} viendo={viendo} avisoVer={avisoVer} onVer={ver}
                       puedeEditar={puedeCorregirVencimiento(f.status, { puedeCargar: canEdit, puedeRevisar })}
                       onFechaCorregida={onFechaCorregida} acciones={accionesDe(f)} />
      )
    }
    const estado = pendingRowStatus(f)
    const pedir = !canEdit && onRequest
      ? <RequestToCertification label={f.document_name} requested={!!requested?.has(f.requirement_id)} onRequest={() => onRequest(f)} />
      : null
    return (
      <RenglonPendiente
        key={f.id}
        fila={f}
        status={<span className="flex flex-col items-start gap-0.5">
          <StatusChip tone={estado.tone}>{estado.label}</StatusChip>
          {estado.detail && <span className="text-etiqueta text-informativo">{estado.detail}</span>}
        </span>}
        actionLabel={estado.action}
        puedeEditar={canEdit}
        puedeCorregirFecha={puedeCorregirVencimiento(f.status, { puedeCargar: canEdit, puedeRevisar })}
        onSubir={subir}
        onVer={ver}
        // Según la POLÍTICA del requisito y no según haya archivo: declarar un
        // vencimiento sin tener el escaneo es deliberado. `NONE` no la ofrece.
        onFechaCorregida={camposQuePide(f.expiration_policy ?? 'OPTIONAL').fecha !== 'no' ? onFechaCorregida : undefined}
        onQuitarSolicitud={puedeRevisar && f.a_pedido && !f.tiene_archivo ? () => { void quitarSolicitud(f.id) } : undefined}
        viendo={viendo}
        avisoVer={avisoVer}
        acciones={<>{accionesDe(f)}{pedir}</>}
      />
    )
  })}</>
}
