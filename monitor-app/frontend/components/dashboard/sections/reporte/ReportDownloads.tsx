'use client'

import { useRef, useState } from 'react'
import { FileDown } from 'lucide-react'
import { Popover } from '@/components/ui/Popover'
import type { HojaDeExcel } from '@/lib/reporte/exportarReporte'

type Alcance = 'visible' | 'day'

/** "Descargar Excel" del Reporte (D7, C13): el estándar "se exporta lo que ves, y se
 *  dice". Por defecto lo que estás viendo, con su recorte en una línea; o el día
 *  completo, como antes. Cada opción arma sus hojas recién al descargar. */
export function ReportDownloads({ disabled, recorte, visible, day, className }: {
  disabled: boolean
  /** Qué se está viendo, en palabras: "Tractoreo · Segundas vueltas · Empresa: Hasa · 3 filas". */
  recorte: string
  visible: { hojas: () => HojaDeExcel[]; archivo: string }
  day: { hojas: () => Promise<HojaDeExcel[]>; archivo: string }
  className: string
}) {
  const boton = useRef<HTMLButtonElement>(null)
  const [abierto, setAbierto] = useState(false)
  const [cual, setCual] = useState<Alcance>('visible')
  const [bajando, setBajando] = useState(false)

  async function descargar() {
    setBajando(true)
    try {
      const { descargarExcel } = await import('@/lib/reporte/exportarReporte')
      if (cual === 'visible') await descargarExcel(visible.hojas(), visible.archivo)
      else await descargarExcel(await day.hojas(), day.archivo)
      setAbierto(false)
    } finally {
      setBajando(false)
    }
  }

  const opcion = (valor: Alcance, titulo: string, detalle: string) => (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5 hover:bg-bg-main">
      <input type="radio" name="descarga" checked={cual === valor} onChange={() => setCual(valor)} className="mt-0.5 accent-accent" />
      <span>
        <span className="block text-dato font-medium text-text-primary">{titulo}</span>
        <span className="block text-etiqueta text-informativo">{detalle}</span>
      </span>
    </label>
  )

  return (
    <>
      <button ref={boton} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => { setCual('visible'); setAbierto(a => !a) }} className={className}>
        <FileDown size={12} aria-hidden="true" /> Descargar Excel
      </button>
      <Popover anchor={boton} open={abierto} onClose={() => setAbierto(false)} label="Descargar Excel" width={300}>
        <fieldset className="space-y-0.5">
          <legend className="sr-only">Qué descargar</legend>
          {opcion('visible', 'Lo que estás viendo', recorte)}
          {opcion('day', 'Todo el día', 'Los dos tipos de operación y todas las secciones, sin filtros')}
        </fieldset>
        <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
          <button type="button" disabled={bajando} onClick={() => { void descargar() }}
            className="rounded-lg bg-accent px-3 py-1 text-etiqueta font-semibold text-white disabled:opacity-50">
            Descargar
          </button>
        </div>
      </Popover>
    </>
  )
}
