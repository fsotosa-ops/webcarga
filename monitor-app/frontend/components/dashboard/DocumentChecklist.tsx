'use client'

import { useState } from 'react'
import { AlertTriangle, Upload, Eye } from 'lucide-react'
import { dueRelative, fileHistoryLabel, formatExpiry } from '@/lib/compliance'
import { StatusChip } from '@/components/ui/StatusChip'
import { useGestoDeCarga } from '@/hooks/useGestoDeCarga'
import type { DatosDelDocumento } from '@/lib/compliance'
import { PedirDatoDelDocumento } from '@/components/compliance/PedirDatoDelDocumento'
import { ReassignDocument } from '@/components/compliance/ReassignDocument'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { ComplianceStatus, PoliticaVencimiento } from '@/lib/types'
import { documentStateCounts, documentStateStyle, type AlertSeverity, type DocumentState } from '@/lib/states'

/** Fila del checklist — mapea 1:1 contra un public.compliance_records real
 *  (ver lib/utils/complianceChecklist.ts), no un catálogo hardcodeado. */
export type ChecklistItem = {
  id:                string  // compliance_records.id — llave para las acciones
  /** El requisito que cubre. Necesario para cargar contra el correcto. */
  requirement_id:    string
  requirement_code:  string
  label:             string  // compliance_requirements.name
  status:            ComplianceStatus
  requires_file:     boolean
  expiration_date:   string | null
  document_state:    DocumentState
  days_to_expiry:    number | null
  alert_severity:    AlertSeverity | null
  file_url:          string | null
  /** Qué hace su requisito con la fecha de vencimiento. Sin esto la ficha
   *  subía el archivo y dejaba que el servidor lo rechazara con 422 —el mismo
   *  defecto que Certificación— para 5 de los 12 requisitos de conductor y 8
   *  de los 10 de vehículo. Puede faltar mientras el backend no lo mande;
   *  la ausencia significa "no sé", nunca "no vence". */
  expiration_policy?: PoliticaVencimiento
}

interface Props {
  items:               ChecklistItem[]
  /** Subir, reemplazar, corregir el vencimiento o borrar: la API pide
   *  `documents.upload`. No es lo mismo que editar la ficha (`directory.edit`):
   *  confundirlos mostraba "Subir" a quien después recibía 403 (L5, 11/10). */
  canUpload:           boolean
  /** Reasignar un documento a otro requisito o sujeto: `documents.review`. */
  canReview?:          boolean
  /** El tercer argumento lo pone el gesto compartido cuando el requisito pide
   *  fecha. Quien lo implemente debe pasarlo a `complianceApi.uploadFile`.
   *
   *  **Devuelve `Promise<void>` y el gesto la espera**: los dos llamadores
   *  reales (`DriverDetailPanel`, `VehicleDetailPanel`) llaman al backend, y
   *  tipar esto como `void` hacía que el renglón dijera "listo" mientras la
   *  subida fallaba, con el motivo perdiéndose como un rechazo no manejado. */
  onUpload?:           (recordId: string, file: File, datos?: DatosDelDocumento) => void | Promise<void>
  onStatusChange?:     (recordId: string, status: ComplianceStatus) => void
  onExpirationChange?: (recordId: string, expirationDate: string) => void
  onDelete?:           (recordId: string) => Promise<void>
  hideCounter?:        boolean
  /** Habilita corregir un documento mal cargado (HU-03). Necesita la empresa
   *  para ofrecerle sus huecos como destino. */
  carrierId?:          string
  onReassigned?:       () => void
}

/** Lo único que se guarda a mano en un requisito sin archivo (auditoría B: en
 *  uso solo MISSING y APPROVED_MANUAL). Se dice como historial del archivo, no
 *  como estado: el estado lo calcula la API (D-R16). */
const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] =
  (['MISSING', 'APPROVED_MANUAL'] as const).map(value => ({ value, label: fileHistoryLabel(value) }))

function ChecklistRow({ item, canUpload, canReview, onUpload, onStatusChange, onExpirationChange, onDelete, carrierId, onReassigned }: {
  item: ChecklistItem
  canUpload: boolean
  canReview: boolean
  onUpload?: (recordId: string, file: File, datos?: DatosDelDocumento) => void | Promise<void>
  onStatusChange?: (recordId: string, status: ComplianceStatus) => void
  onExpirationChange?: (recordId: string, expirationDate: string) => void
  onDelete?: (recordId: string) => Promise<void>
  carrierId?: string
  onReassigned?: () => void
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const state = documentStateStyle(item.document_state)
  /** EL MISMO gesto que Certificación, no una segunda versión: recibe el
   *  archivo, pide la fecha si el requisito la exige, y no sube nada hasta
   *  estar completo. Es un hook y no el componente `RenglonPendiente` porque
   *  este nodo tiene otra forma —círculo de estado, vista previa,
   *  reasignación— y envolver uno en otro dibujaría el nombre dos veces. */
  const carga = useGestoDeCarga({
    politica: item.expiration_policy ?? 'OPTIONAL',
    puedeEditar: canUpload && !!onUpload,
    onSubir: async (archivo, datos) => { await onUpload?.(item.id, archivo, datos) },
  })
  /** Soltar un archivo encima sólo carga lo que FALTA. Sobre una fila que ya
   *  tiene documento, un arrastre accidental lo reemplazaría sin que nadie lo
   *  pidiera; reemplazar sigue siendo un clic explícito en su propio control. */
  /** Se carga con archivo salvo que quien llama haya pedido el modo "marcar a
   *  mano" (requisito sin archivo + `onStatusChange`). Sin ese modo, una fila
   *  con `requires_file = false` —como nacen los documentos creados desde
   *  Configuración— quedaba sin ninguna acción, mientras Certificación sí la
   *  dejaba subir (L4, 11/10). */
  const marcaAMano = !item.requires_file && !!onStatusChange
  const conArchivo = !marcaAMano
  const zona = conArchivo && !item.file_url ? carga.propsDeZona() : {}
  const relative = dueRelative(item.days_to_expiry)

  const fechaId = `vence-ficha-${item.id}`

  return (
    <div
      title={`${item.label} — ${state.label}`}
      className="px-3 py-2 rounded-lg bg-gray-50"
      {...zona}
    >
    <div className="flex items-center gap-2.5">
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-text-primary truncate block">{item.label}</span>
        {(item.expiration_date || relative || (canUpload && onExpirationChange)) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {item.expiration_date && (
              <span className="text-[10px] text-gray-400">
                Vence: <span className="font-mono text-gray-500">{formatExpiry(item.expiration_date)}</span>
              </span>
            )}
            {relative && (
              <span className="text-etiqueta text-informativo">
                ({relative})
              </span>
            )}
            {canUpload && onExpirationChange && (
              <input
                type="date"
                aria-label={`Fecha de vencimiento de ${item.label}`}
                value={item.expiration_date ?? ''}
                onChange={e => onExpirationChange(item.id, e.target.value)}
                className="text-[10px] text-gray-500 border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white"
              />
            )}
          </div>
        )}
      </div>
      <StatusChip tone={state.tone} icon={state.icon}>{state.label}</StatusChip>
      {item.file_url && (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`Ver ${item.label}`}
          title="Ver documento"
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-accent hover:underline shrink-0"
        >
          <Eye size={12} /> Ver
        </button>
      )}
      {/* Estado "Falta" con carga habilitada: CTA visible en vez de un
         link chico — cargar debe ser la acción obvia (pedido explícito
         del usuario 2026-07-18). */}
      {canUpload && conArchivo && !item.file_url && onUpload && (
        <label className="flex items-center gap-1 text-[11px] font-semibold text-accent border border-dashed border-accent/40 rounded-md px-2 py-1 hover:bg-accent/5 transition-colors cursor-pointer shrink-0">
          <Upload size={11} /> Subir documento
          <input
            type="file"
            className="hidden"
            aria-label={`Subir ${item.label}`}
            {...carga.propsDeInput()}
          />
        </label>
      )}
      {/* HU-03: el archivo está, pero puede estar en el lugar equivocado. */}
      {canReview && item.file_url && carrierId && (
        <ReassignDocument
          recordId={item.id}
          carrierId={carrierId}
          onDone={() => onReassigned?.()}
        />
      )}
      {canUpload && conArchivo && item.file_url && onUpload && (
        <label
          title="Reemplazar archivo"
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-accent cursor-pointer shrink-0"
        >
          <Upload size={11} />
          <input
            type="file"
            className="hidden"
            aria-label={`Reemplazar ${item.label}`}
            {...carga.propsDeInput()}
          />
        </label>
      )}
      {canUpload && marcaAMano && (
        <select
          aria-label={`Estado de ${item.label}`}
          value={item.status}
          onChange={e => onStatusChange(item.id, e.target.value as ComplianceStatus)}
          className="text-[11px] font-semibold border border-border rounded-md px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white shrink-0"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {previewOpen && item.file_url && (
        <DocumentPreviewModal
          label={item.label}
          url={item.file_url}
          canEdit={canUpload}
          onClose={() => setPreviewOpen(false)}
          onDelete={canUpload && onDelete ? () => onDelete(item.id) : undefined}
        />
      )}
    </div>

    {/* Lo que el gesto necesita preguntar antes de subir. Sin esto, elegir un
        archivo para un requisito que exige fecha no mostraría nada y el
        usuario leería "no pasó nada" — que es literalmente el reporte que
        originó este trabajo. */}
    <PedirDatoDelDocumento carga={carga} id={fechaId} />

    {carga.estado.tipo === 'error' && (
      <div role="alert" className="flex items-center gap-2 flex-wrap mt-2">
        <AlertTriangle size={12} className="text-espera shrink-0" aria-hidden="true" />
        <span className="text-etiqueta text-espera">{carga.estado.motivo}</span>
        {carga.estado.archivo && (
          <button
            type="button"
            onClick={carga.reintentar}
            className="text-etiqueta font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70"
          >
            Reintentar
          </button>
        )}
      </div>
    )}
    </div>
  )
}

/** Checklist de documentos — lista vertical de filas (icono + nombre +
 *  acción). Genérico: data-driven desde compliance_records, no un catálogo
 *  hardcodeado por módulo. Por defecto cada fila se carga con archivo, como en
 *  Certificación. Cambiar el estado a mano es la excepción: solo para un
 *  requisito sin archivo (`requires_file = false`) y solo si quien llama pasa
 *  `onStatusChange`; un mismo carrier/driver/asset puede mezclar los dos. */
export function DocumentChecklist({ items, canUpload, canReview = false, onUpload, onStatusChange, onExpirationChange, onDelete, hideCounter, carrierId, onReassigned }: Props) {
  const upToDate = documentStateCounts(items).UP_TO_DATE

  return (
    <div>
      {items.length > 0 && !hideCounter && (
        <p className="text-xs text-gray-400 mb-2">{upToDate} de {items.length} {documentStateStyle('UP_TO_DATE').label.toLowerCase()}</p>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map(item => (
          <ChecklistRow
            key={item.id}
            item={item}
            canUpload={canUpload}
            canReview={canReview}
            onUpload={onUpload}
            onStatusChange={onStatusChange}
            onExpirationChange={onExpirationChange}
            onDelete={onDelete}
            carrierId={carrierId}
            onReassigned={onReassigned}
          />
        ))}
      </div>
    </div>
  )
}
