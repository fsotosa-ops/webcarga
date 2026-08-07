'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  page: number
  totalPages: number
  total: number
  pageSize: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100, 200]

/** Bug 5.5: antes solo Anterior/Siguiente — Operaciones pidió poder saltar
 *  directo a una página o elegir cuántos registros ver por página. */
export function PaginationControls({
  page, totalPages, total, pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange, onPageSizeChange,
}: Props) {
  // Draft del input de página — permite borrar/escribir sin que cada tecla
  // dispare un fetch; se aplica (clampeado) al blur o Enter.
  const [pageDraft, setPageDraft] = useState(String(page))

  useEffect(() => {
    setPageDraft(String(page))
  }, [page])

  const commitPageDraft = () => {
    const parsed = parseInt(pageDraft, 10)
    const clamped = Number.isFinite(parsed) ? Math.min(totalPages, Math.max(1, parsed)) : page
    setPageDraft(String(clamped))
    if (clamped !== page) onPageChange(clamped)
  }

  return (
    <div className="flex items-center justify-between pt-2 pb-1 gap-3 flex-wrap">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-600"
      >
        <ChevronLeft size={13} /> Anterior
      </button>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          Página
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageDraft}
            onChange={e => setPageDraft(e.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
            aria-label="Ir a la página"
            className="w-12 px-1.5 py-1 text-xs text-center border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          de <span className="font-semibold text-gray-700">{totalPages}</span>
          <span className="text-gray-400">· {total.toLocaleString('es-CL')} viajes</span>
        </span>

        <label className="flex items-center gap-1.5">
          Por página
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            aria-label="Registros por página"
            className="px-1.5 py-1 text-xs border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {pageSizeOptions.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>

      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-gray-600"
      >
        Siguiente <ChevronRight size={13} />
      </button>
    </div>
  )
}
