'use client'

import { useState } from 'react'
import { Check, Circle, AlertTriangle, Upload, Eye } from 'lucide-react'
import { COMPLIANCE_STATUS_CONFIG, expiryRelative, formatExpiry } from '@/lib/compliance'
import { useGestoDeCarga } from '@/hooks/useGestoDeCarga'
import { ReassignDocument } from '@/components/compliance/ReassignDocument'
import { DocumentPreviewModal } from './DocumentPreviewModal'
import type { ComplianceStatus, PoliticaVencimiento } from '@/lib/types'

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
  is_expired:        boolean
  is_expiring_soon:  boolean
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
  canEdit:             boolean
  /** El tercer argumento lo pone el gesto compartido cuando el requisito pide
   *  fecha. Quien lo implemente debe pasarlo a `complianceApi.uploadFile`.
   *
   *  **Devuelve `Promise<void>` y el gesto la espera**: los dos llamadores
   *  reales (`DriverDetailPanel`, `VehicleDetailPanel`) llaman al backend, y
   *  tipar esto como `void` hacía que el renglón dijera "listo" mientras la
   *  subida fallaba, con el motivo perdiéndose como un rechazo no manejado. */
  onUpload?:           (recordId: string, file: File, vencimiento?: string) => void | Promise<void>
  onStatusChange?:     (recordId: string, status: ComplianceStatus) => void
  onExpirationChange?: (recordId: string, expirationDate: string) => void
  onDelete?:           (recordId: string) => Promise<void>
  hideCounter?:        boolean
  /** Habilita corregir un documento mal cargado (HU-03). Necesita la empresa
   *  para ofrecerle sus huecos como destino. */
  carrierId?:          string
  onReassigned?:       () => void
}

/** PENDING_REVIEW excluido a propósito, mismo criterio que
 *  TransporterDocumentsPanel: no existe un proceso de due diligence
 *  separado del negocio hoy — subir un documento ya lo aprueba
 *  (decisión explícita del usuario 2026-07-18). */
const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] =
  (Object.entries(COMPLIANCE_STATUS_CONFIG) as [ComplianceStatus, { label: string }][])
    .filter(([value]) => value !== 'PENDING_REVIEW')
    .map(([value, cfg]) => ({ value, label: cfg.label }))

function nodeState(item: ChecklistItem): 'ok' | 'overdue' | 'pending' {
  const approved = item.status === 'APPROVED' || item.status === 'APPROVED_MANUAL'
  if (approved) return item.is_expired ? 'overdue' : 'ok'
  if (item.status === 'EXPIRED' || item.status === 'REJECTED') return 'overdue'
  return 'pending'
}

function stateLabel(state: 'ok' | 'overdue' | 'pending'): string {
  return state === 'ok' ? 'al día' : state === 'overdue' ? 'vencido' : 'pendiente'
}

/** Cuenta cuántos documentos están "al día" — compartido con quien
 *  necesite mostrar el mismo porcentaje fuera de esta lista (ej. un
 *  anillo de progreso en el panel de detalle). */
export function checklistCompletion(items: ChecklistItem[]): { ok: number; total: number } {
  return { ok: items.filter(item => nodeState(item) === 'ok').length, total: items.length }
}

function ChecklistRow({ item, canEdit, onUpload, onStatusChange, onExpirationChange, onDelete, carrierId, onReassigned }: {
  item: ChecklistItem
  canEdit: boolean
  onUpload?: (recordId: string, file: File, vencimiento?: string) => void | Promise<void>
  onStatusChange?: (recordId: string, status: ComplianceStatus) => void
  onExpirationChange?: (recordId: string, expirationDate: string) => void
  onDelete?: (recordId: string) => Promise<void>
  carrierId?: string
  onReassigned?: () => void
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const state = nodeState(item)
  /** EL MISMO gesto que Certificación, no una segunda versión: recibe el
   *  archivo, pide la fecha si el requisito la exige, y no sube nada hasta
   *  estar completo. Es un hook y no el componente `RenglonPendiente` porque
   *  este nodo tiene otra forma —círculo de estado, vista previa,
   *  reasignación— y envolver uno en otro dibujaría el nombre dos veces. */
  const carga = useGestoDeCarga({
    politica: item.expiration_policy ?? 'OPTIONAL',
    puedeEditar: canEdit && !!onUpload,
    onSubir: async (archivo, vencimiento) => { await onUpload?.(item.id, archivo, vencimiento) },
  })
  /** Soltar un archivo encima sólo carga lo que FALTA. Sobre una fila que ya
   *  tiene documento, un arrastre accidental lo reemplazaría sin que nadie lo
   *  pidiera; reemplazar sigue siendo un clic explícito en su propio control. */
  const zona = item.requires_file && !item.file_url ? carga.propsDeZona() : {}
  const iconCls = state === 'ok'
    ? 'bg-green-500 border-green-500 text-white'
    : state === 'overdue'
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'
  const relative = expiryRelative(item.expiration_date, item.is_expired)

  const fechaId = `vence-ficha-${item.id}`

  return (
    <div
      title={`${item.label} — ${stateLabel(state)}`}
      className="px-3 py-2 rounded-lg bg-gray-50"
      {...zona}
    >
    <div className="flex items-center gap-2.5">
      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${iconCls}`}>
        {state === 'ok' ? <Check size={11} /> : state === 'overdue' ? <AlertTriangle size={10} /> : <Circle size={10} />}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-semibold text-text-primary truncate block">{item.label}</span>
        {(item.expiration_date || (canEdit && onExpirationChange)) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {item.expiration_date && (
              <span className="text-[10px] text-gray-400">
                Vence: <span className="font-mono text-gray-500">{formatExpiry(item.expiration_date)}</span>
              </span>
            )}
            {relative && (
              <span className={`text-[10px] ${item.is_expired ? 'text-red-500 font-semibold' : item.is_expiring_soon ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                ({relative})
              </span>
            )}
            {canEdit && onExpirationChange && (
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
      {canEdit && item.requires_file && !item.file_url && onUpload && (
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
      {canEdit && item.file_url && carrierId && (
        <ReassignDocument
          recordId={item.id}
          carrierId={carrierId}
          onDone={() => onReassigned?.()}
        />
      )}
      {canEdit && item.requires_file && item.file_url && onUpload && (
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
      {canEdit && !item.requires_file && onStatusChange && (
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
          canEdit={canEdit}
          onClose={() => setPreviewOpen(false)}
          onDelete={canEdit && onDelete ? () => onDelete(item.id) : undefined}
        />
      )}
    </div>

    {/* Lo que el gesto necesita preguntar antes de subir. Sin esto, elegir un
        archivo para un requisito que exige fecha no mostraría nada y el
        usuario leería "no pasó nada" — que es literalmente el reporte que
        originó este trabajo. */}
    {carga.estado.tipo === 'pidiendo-fecha' && (
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <label htmlFor={fechaId} className="text-etiqueta text-informativo">
          Vence el
        </label>
        <input
          id={fechaId}
          type="date"
          value={carga.vencimiento}
          onChange={e => carga.setVencimiento(e.target.value)}
          className="text-dato border border-border rounded-lg px-2 py-1 bg-white"
        />
        <button
          type="button"
          onClick={carga.guardar}
          className="text-etiqueta font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70"
        >
          Guardar
        </button>
        <span className="text-etiqueta text-informativo truncate">
          {carga.estado.archivo.name}
          {(item.expiration_policy ?? 'OPTIONAL') === 'REQUIRED'
            ? ' · este documento no vale sin su vencimiento'
            : ' · puedes guardarlo sin la fecha'}
        </span>
      </div>
    )}

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
 *  hardcodeado por módulo. La acción por fila se decide por
 *  `item.requires_file` (subir archivo vs. cambiar estado a mano) — no por
 *  cuál callback pasó el llamador, porque un mismo carrier/driver/asset
 *  mezcla requisitos con y sin archivo en el mismo checklist. */
export function DocumentChecklist({ items, canEdit, onUpload, onStatusChange, onExpirationChange, onDelete, hideCounter, carrierId, onReassigned }: Props) {
  const { ok: okCount } = checklistCompletion(items)

  return (
    <div>
      {items.length > 0 && !hideCounter && (
        <p className="text-xs text-gray-400 mb-2">{okCount} de {items.length} completos</p>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map(item => (
          <ChecklistRow
            key={item.id}
            item={item}
            canEdit={canEdit}
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
