'use client'

import { useState } from 'react'
import { Check, Copy, FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { DataTableModel } from './useDataTable'
import { visibleTable, viewForPasting } from './viewExport'

/** Bajar o copiar lo que se ve de una tabla del kit (reunión con WebCarga, 16/10: la
 *  vista de cada persona se manda al CD por correo o WhatsApp). Es la vista tal cual:
 *  las columnas de la persona en su orden y todas las filas que pasan sus filtros, no
 *  solo la página. Va en `actions` de `TableToolbar`; la tabla que la quiera la enciende. */
export function ViewExportActions<T>({ model, title, fileName }: {
  model: DataTableModel<T>
  /** Qué tabla es, en palabras: "Flota del día 22/10 · Tractoreo". Encabeza el archivo y la copia. */
  title: string
  fileName: string
}) {
  const [copiado, setCopiado] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vacia = model.rows.length === 0

  async function copiar() {
    setError(null)
    const { text, html } = viewForPasting(model, title)
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
      } else {
        await navigator.clipboard.writeText(text)
      }
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setError('No se pudo copiar. Revisa que el navegador permita usar el portapapeles.')
    }
  }

  async function descargar() {
    setError(null)
    setBajando(true)
    try {
      const { descargarExcel, hojaDeLaTabla } = await import('@/lib/reporte/exportarReporte')
      const { columns, rows } = visibleTable(model)
      const { heading } = viewForPasting(model, title)
      await descargarExcel([hojaDeLaTabla(title, heading, columns, rows)], fileName)
    } catch (e) {
      console.error('Descargar Excel de la vista', e)
      setError('No se pudo descargar el Excel. Vuelve a intentarlo.')
    } finally {
      setBajando(false)
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button disabled={vacia || bajando} onClick={() => { void descargar() }}
        title="Baja lo que estás viendo: tus columnas, en tu orden, con tus filtros">
        {bajando ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" /> : <FileDown size={14} aria-hidden="true" />}
        Descargar Excel
      </Button>
      <Button disabled={vacia} onClick={() => { void copiar() }}
        title="Copia lo que estás viendo, listo para pegar en un correo o en WhatsApp">
        {copiado ? <><Check size={14} aria-hidden="true" /> Copiado</> : <><Copy size={14} aria-hidden="true" /> Copiar</>}
      </Button>
      {error && <span role="alert" className="text-etiqueta text-status-incidente">{error}</span>}
    </span>
  )
}
