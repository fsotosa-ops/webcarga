'use client'

import { useEffect, useState } from 'react'
import { inputClass } from '@/components/ui/Field'

/** El comentario de una fila del cierre.
 *
 *  Guarda al salir del campo y no con cada tecla: un PATCH por letra sería una
 *  tormenta de escrituras sobre la tabla que el GET recalcula. Y solo si cambió:
 *  volver a mandar el mismo texto movería la hora de una decisión que nadie tomó
 *  de nuevo. El borrador se resincroniza desde el prop (la clase de bug que este
 *  frontend ya vio tres veces). */
export function RowComment({ valor, guardando, onGuardar, etiqueta }: {
  valor: string
  guardando: boolean
  onGuardar: (texto: string) => void
  etiqueta: string
}) {
  const [texto, setTexto] = useState(valor)
  useEffect(() => { setTexto(valor) }, [valor])

  return (
    <input type="text" value={texto} disabled={guardando} aria-label={etiqueta} placeholder="Comentario (opcional)"
      onChange={e => setTexto(e.target.value)}
      onBlur={() => { if (texto.trim() !== valor.trim()) onGuardar(texto) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={`${inputClass({ size: 'xs' })} w-full min-w-[12rem]`} />
  )
}
