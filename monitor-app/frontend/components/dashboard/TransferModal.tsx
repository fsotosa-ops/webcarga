'use client'

import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CarrierSearchPicker, type CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'

interface Props {
  open:             boolean
  title:            string
  /** La empresa actual, para no ofrecerla como destino. **Null cuando el
   *  conductor o el vehículo no tiene ninguna**: ese es el caso de "asignar",
   *  y es una variante de este mismo modal, no un modal hermano. */
  currentCarrierId: string | null
  onClose:          () => void
  onTransfer:       (toCarrierId: string, toCarrierName: string) => Promise<void>
}

/** Mini-modal de transferencia (conductor/vehículo → otra empresa) — rol
 *  editor. Busca sobre carriersApi.list; el llamador orquesta la asignación
 *  real (assignDriver/assignAsset a la empresa nueva ya desactiva la
 *  asignación ACTIVE previa, ver H2.2 carriers.py — no hace falta un
 *  endpoint .../transfer dedicado).
 *
 *  **Con `currentCarrierId` en null hace la primera asignación** (2026-08-27).
 *  Es el bug crítico #5 de la minuta del 25/08: un conductor o una patente sin
 *  empresa no se podía vincular desde ninguna vista, y al 27/08 eso dejaba 8
 *  conductores con 278 viajes y 7 patentes con 82 viajes invisibles para el
 *  cierre del día. El endpoint siempre estuvo (`POST /carriers/{id}/drivers`);
 *  faltaba la puerta. Cambian la palabra y el ícono, no el mecanismo: una
 *  variante es una prop, no un componente hermano. */
export function TransferModal({ open, title, currentCarrierId, onClose, onTransfer }: Props) {
  // Sin empresa previa no hay "desde": es un alta de vínculo, y decirle
  // "transferencia" a eso le miente a quien aprieta el botón.
  const esPrimeraAsignacion = !currentCarrierId
  const [q, setQ]             = useState('')
  const [selected, setSelected] = useState<CarrierSearchResult | null>(null)

  if (!open) return null

  // No cerrar mientras el pedido viaja, y quedar abierto con el mensaje si falla (por
  // ejemplo el 409 de un día ya cerrado en el Cierre): es `ConfirmDialog`.
  function handleClose() {
    setQ(''); setSelected(null)
    onClose()
  }

  return (
    <ConfirmDialog
      title={title}
      confirmLabel={esPrimeraAsignacion ? 'Asignar a esta empresa' : 'Confirmar transferencia'}
      confirmDisabled={!selected}
      errorFallback="Error al transferir"
      onConfirm={() => onTransfer(selected!.id, selected!.business_name)}
      onClose={handleClose}
    >
      <CarrierSearchPicker
        query={q}
        onQueryChange={v => { setQ(v); setSelected(null) }}
        onPick={c => setSelected(c)}
        placeholder={esPrimeraAsignacion
          ? 'Buscar la empresa a la que pertenece (nombre o RUT)…'
          : 'Buscar empresa destino (nombre o RUT)…'}
        excludeId={currentCarrierId ?? undefined}
        selectedId={selected?.id ?? null}
        autoFocus
        size="md"
        maxHeightClass="max-h-56"
        showMinCharsHint
      />
    </ConfirmDialog>
  )
}
