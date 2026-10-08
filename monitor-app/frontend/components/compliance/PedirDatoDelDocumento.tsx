'use client'

import type { useGestoDeCarga } from '@/hooks/useGestoDeCarga'

/** Lo que el gesto de carga pregunta ANTES de subir: la fecha de vencimiento,
 *  la de emisión o el período, según el tipo (HU-C1, entrega 2b).
 *
 *  Una sola pieza para las dos superficies que suben (el renglón de
 *  Certificación y el nodo de la ficha): las dos tenían este bloque copiado, y
 *  sumarle emisión y período en las dos copias es como divergen. */
const COMO: Record<'vencimiento' | 'emision' | 'periodo', { etiqueta: string; tipo: 'date' | 'month' }> = {
  vencimiento: { etiqueta: 'Vence el',   tipo: 'date' },
  emision:     { etiqueta: 'Emitido el', tipo: 'date' },
  periodo:     { etiqueta: 'Período',    tipo: 'month' },
}

export function PedirDatoDelDocumento({ carga, id, className = '' }: {
  carga: ReturnType<typeof useGestoDeCarga>
  id: string
  className?: string
}) {
  if (carga.estado.tipo !== 'pidiendo-fecha' || !carga.pide) return null
  const { dato, obligatorio } = carga.pide
  const como = COMO[dato]
  const ayuda =
    dato === 'periodo' ? ' · el mes que cubre el documento'
    : dato === 'emision' ? ' · el vencimiento se calcula desde la emisión'
    : obligatorio ? ' · este documento no vale sin su vencimiento'
    : ' · puedes guardarlo sin la fecha'

  return (
    <div className={`flex items-center gap-2 flex-wrap mt-2 ${className}`}>
      <label htmlFor={id} className="text-etiqueta text-informativo">{como.etiqueta}</label>
      <input
        id={id}
        type={como.tipo}
        value={carga.valor}
        onChange={e => carga.setValor(e.target.value)}
        className="text-dato border border-border rounded-lg px-2 py-1 bg-white"
      />
      <button
        type="button"
        onClick={carga.guardar}
        disabled={obligatorio && !carga.valor}
        className="text-etiqueta font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Guardar
      </button>
      <span className="text-etiqueta text-informativo truncate">
        {carga.estado.archivo.name}{ayuda}
      </span>
    </div>
  )
}
