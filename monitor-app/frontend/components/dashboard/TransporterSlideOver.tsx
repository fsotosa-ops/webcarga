'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { X, Phone, Mail, ArrowRight } from 'lucide-react'
import type { CarrierListItem } from '@/lib/types'
import { carriersApi } from '@/lib/api/carriers'
import { InsuranceSummaryCard } from './InsuranceSummaryCard'
import { COMPLIANCE_STATUS_CONFIG, formatExpiry } from '@/lib/compliance'

const CONTACT_ROLE_LABELS: Record<string, string> = {
  LEGAL_REP: 'Representante legal', OPERATIONS: 'Operacional', FINANCE: 'Finanzas', DOCUMENTS: 'Documentos',
}

function contactRoleLabel(role: string): string {
  return CONTACT_ROLE_LABELS[role] ?? role
}

function SkeletonLine({ w = 'w-full' }: { w?: string }) {
  return <div className={`h-3 ${w} bg-gray-100 rounded animate-pulse`} />
}

const STATUS_LABELS: Record<CarrierListItem['operational_status'], string> = {
  ACTIVE: 'Activa', INACTIVE: 'Inactiva', LEGACY_INACTIVE: 'Legacy',
}

interface Props {
  item:    CarrierListItem | null
  onClose: () => void
}

/** Slide-over de resumen de una empresa — se abre al click en una tarjeta o
 *  fila del listado de Empresas. El header renderiza de inmediato con los
 *  datos ya disponibles en `item` (listado); documentos/contactos/seguros se
 *  cargan en segundo plano con estados de carga visibles por sección (nunca
 *  un spinner que borra el contenido ya mostrado). */
export function TransporterSlideOver({ item, onClose }: Props) {
  const open = !!item
  const panelRef = useRef<HTMLDivElement>(null)

  const query = useQuery({
    queryKey: ['carriers', 'detail', item?.id],
    queryFn: () => carriersApi.get(item!.id),
    enabled: !!item,
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  const carrier = query.data
  const records = carrier?.compliance_records ?? []
  const okCount = records.filter(r => r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL').length
  const issues = records.filter(r => !(r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL') || r.is_expired)
  const contacts = carrier?.contacts ?? []

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={item ? `Resumen de ${item.business_name || 'empresa'}` : 'Resumen de empresa'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {item && (
          <>
            <div className="px-5 py-4 bg-slate-900 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">
                  {item.business_name || <span className="italic text-white/50">Sin nombre</span>}
                </h3>
                <p className="text-[11px] text-white/50 font-mono">{item.tax_id}</p>
                <p className="text-[11px] text-white/70 mt-1">{STATUS_LABELS[item.operational_status]}</p>
              </div>
              <button onClick={onClose} aria-label="Cerrar resumen" className="text-white/50 hover:text-white transition-colors shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Documentos</p>
                {query.isPending ? (
                  <div className="space-y-1.5"><SkeletonLine /><SkeletonLine w="w-2/3" /></div>
                ) : query.error ? (
                  <p className="text-xs text-red-500">{query.error instanceof Error ? query.error.message : 'Error cargando documentos'}</p>
                ) : records.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Sin documentos registrados</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-700">
                      <span className="font-semibold">{okCount}</span> de <span className="font-semibold">{records.length}</span> documentos OK
                    </p>
                    {issues.length > 0 && (
                      <ul className="space-y-1">
                        {issues.map(r => {
                          const cfg = COMPLIANCE_STATUS_CONFIG[r.status]
                          return (
                            <li key={r.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-50 rounded-xl px-2.5 py-1.5">
                              <span className="text-gray-600 truncate">{r.name}</span>
                              <span className="flex items-center gap-2 shrink-0">
                                {r.expiration_date && <span className="font-mono text-gray-400">{formatExpiry(r.expiration_date)}</span>}
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${cfg.cls}`}>
                                  {cfg.label}
                                </span>
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Contactos</p>
                {query.isPending ? (
                  <div className="space-y-1.5"><SkeletonLine w="w-3/4" /><SkeletonLine w="w-1/2" /></div>
                ) : query.error ? (
                  <p className="text-xs text-red-500">{query.error instanceof Error ? query.error.message : 'Error cargando contactos'}</p>
                ) : contacts.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Sin contactos registrados</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {contacts.map(c => {
                      const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
                      return (
                        <div key={c.id} className="border border-border/60 rounded-xl p-2">
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{contactRoleLabel(c.contact_role)}</p>
                          <p className="text-xs font-semibold text-text-primary truncate">{name || <span className="text-gray-300 italic">sin nombre</span>}</p>
                          {c.phone && (
                            <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent">
                              <Phone size={10} /> {c.phone}
                            </a>
                          )}
                          {c.email && (
                            <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent truncate">
                              <Mail size={10} /> <span className="truncate">{c.email}</span>
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              <section>
                <InsuranceSummaryCard carrierId={item.id} taxId={item.tax_id} />
              </section>

              <Link
                href={`/dashboard/transportistas/empresa/${item.id}`}
                className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-white bg-accent hover:bg-accent/90 rounded-xl px-4 py-2.5 transition-colors"
              >
                Ver ficha completa <ArrowRight size={14} />
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  )
}
