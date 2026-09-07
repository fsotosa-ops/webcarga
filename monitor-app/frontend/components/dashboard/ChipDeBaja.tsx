'use client'

import { UserX } from 'lucide-react'
import type { OperationalStatus } from '@/lib/types'

/**
 * "Dado de baja", dicho en la lista.
 *
 * POR QUÉ EXISTE. `operational_status` viajaba en el payload del roster de
 * conductores (`carriers.py:594`) y en el de equipos, y ninguna tarjeta lo
 * dibujaba: había que abrir la ficha, de a una, para descubrir que el botón
 * decía "Reactivar" en vez de "Dar de baja". Pablo, 04/09: *"yo ayer di de baja
 * a los 3 conductores de Casillas. Ahí están. Están todos dados de baja, pero
 * aquí no me dice nada"*.
 *
 * Va EN LUGAR del pill de documentación, no al lado: un conductor de baja con
 * los papeles al día se veía con un "Al día" verde, que es exactamente la
 * lectura contraria. Una fila dice un estado.
 */
export function ChipDeBaja({ estado }: { estado: OperationalStatus }) {
  if (estado === 'ACTIVE') return null
  return (
    <span className="inline-flex items-center gap-1 text-etiqueta font-semibold px-1.5 py-0.5 rounded-full border border-border text-informativo mt-0.5">
      <UserX size={9} /> Dado de baja
    </span>
  )
}
