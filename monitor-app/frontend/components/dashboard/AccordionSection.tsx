'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface Props {
  title:       ReactNode
  defaultOpen?: boolean
  children:    ReactNode
}

export function AccordionSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 hover:text-gray-500 transition-colors"
      >
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </button>
      {open && children}
    </section>
  )
}
