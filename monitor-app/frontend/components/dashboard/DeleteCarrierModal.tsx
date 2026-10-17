'use client'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Props {
  label:     string
  onClose:   () => void
  onConfirm: () => Promise<void>
}

/** Confirmación de borrado real de una empresa — a diferencia de
 *  BajaReasonModal (soft, siempre permitido), el backend puede rechazar
 *  esto con 409 si la empresa tiene datos asociados; ese mensaje ya viene
 *  listo para mostrar (ver carriersApi.delete / DELETE /carriers/{id}). */
export function DeleteCarrierModal({ label, onClose, onConfirm }: Props) {
  return (
    <ConfirmDialog
      title={`Eliminar: ${label}`}
      confirmLabel="Confirmar eliminación"
      tone="danger"
      errorFallback="Error al eliminar"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-informativo">
        Esto borra la empresa de forma permanente. Solo funciona si no tiene conductores, equipos,
        pólizas, contactos ni documentos cargados; si los tiene, usa «Dar de baja» en su lugar.
      </p>
    </ConfirmDialog>
  )
}
