'use client'

import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { useCanEdit } from '@/hooks/useCanEdit'

interface Props {
  carrierId:   string
  carrierName: string
}

/** El puente de una empresa a la Bandeja.
 *
 *  La Bandeja existe como DESTINO y no como zona encima del casillero: es el
 *  camino de "me llegaron veinte por correo", no el de "a esta persona le
 *  falta la licencia". Es un enlace justamente para que no compita con el
 *  renglón por el mismo archivo soltado.
 *
 *  **Llega con la empresa ya elegida**, y eso no es comodidad: es precisión.
 *  Fijada la empresa, el motor de clasificación acota el universo a sus
 *  entidades —~2 conductores y ~3 vehículos, contra 87 y 124 del catálogo
 *  entero—, así que elegir sujeto pasa a ser un clic. Sin el parámetro, la
 *  capacidad existía y no tenía puerta.
 *
 *  Vive acá y no en cada pantalla porque lo usan la ficha y el cajón: estaba
 *  escrito verbatim en los dos y un cambio de copy había que hacerlo en dos
 *  lados sin que nada lo obligara. */
export function PuenteALaBandeja({ carrierId, carrierName }: Props) {
  const canEdit = useCanEdit()
  if (!canEdit) return null

  return (
    <p className="text-etiqueta text-informativo pt-1 flex items-center gap-1.5">
      <Inbox size={11} aria-hidden="true" />
      ¿Tienes muchos documentos de {carrierName}?{' '}
      <Link
        href={`/dashboard/compliance/inbox?empresa=${carrierId}`}
        className="font-semibold text-accion transition-opacity hover:opacity-70"
      >
        Llévalos a la Bandeja
      </Link>
    </p>
  )
}
