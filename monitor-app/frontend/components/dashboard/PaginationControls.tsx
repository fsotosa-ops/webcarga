'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { inputClass } from '@/components/ui/Field'

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
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-bg-main transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-primary"
      >
        <ChevronLeft size={13} /> Anterior
      </button>

      <div className="flex items-center gap-3 text-xs text-informativo">
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
            className={`${inputClass({ size: 'xs' })} w-12 text-center`}
          />
          de <span className="font-semibold text-text-primary">{totalPages}</span>
          <span className="text-informativo">· {total.toLocaleString('es-CL')} viajes</span>
        </span>

        <label className="flex items-center gap-1.5">
          Por página
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            aria-label="Registros por página"
            className={`${inputClass({ size: 'xs' })}`}
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
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-white hover:bg-bg-main transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-text-primary"
      >
        Siguiente <ChevronRight size={13} />
      </button>
    </div>
  )
}
