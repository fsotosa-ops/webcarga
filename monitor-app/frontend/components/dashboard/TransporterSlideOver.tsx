'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { X, Phone, Mail, ArrowRight } from 'lucide-react'
import type { CarrierListItem } from '@/lib/types'
import { carriersApi } from '@/lib/api/carriers'
import { InsuranceSummaryCard } from './InsuranceSummaryCard'
import { CompletionRing } from './CompletionRing'
import { STATUS_LABELS, STATUS_CLS } from './TransporterCard'
import { evidenciaDeDocumento, formatExpiry } from '@/lib/compliance'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

const CONTACT_ROLE_LABELS: Record<string, string> = {
  LEGAL_REP: 'Representante legal', OPERATIONS: 'Operacional', FINANCE: 'Finanzas', DOCUMENTS: 'Documentos',
}

function contactRoleLabel(role: string): string {
  return CONTACT_ROLE_LABELS[role] ?? role
}

function SkeletonLine({ w = 'w-full' }: { w?: string }) {
  return <div className={`h-3 ${w} bg-gray-100 rounded animate-pulse`} />
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

  if (!open) return null

  const carrier = query.data
  const records = carrier?.compliance_records ?? []
  const okCount = records.filter(r => r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL').length
  const issues = records.filter(r => !(r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL') || r.is_expired)
  const contacts = carrier?.contacts ?? []

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Resumen de ${item.business_name || 'empresa'}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-4xl h-[75vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none animate-modal-in"
        >
            <button onClick={onClose} aria-label="Cerrar resumen" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>

            <div className="sm:w-[320px] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-5">
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                  style={{ backgroundColor: getInitialColor(item.business_name) }}
                >
                  {getInitials(item.business_name)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">
                    {item.business_name || <span className="italic text-gray-400">Sin nombre</span>}
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono">{item.tax_id}</p>
                </div>
              </div>

              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border mb-5 ${STATUS_CLS[item.operational_status]}`}>
                {STATUS_LABELS[item.operational_status]}
              </span>

              {!query.isPending && !query.error && records.length > 0 && (
                <div className="flex items-center gap-3 mb-5">
                  <CompletionRing ok={okCount} total={records.length} />
                  <p className="text-[11px] text-gray-500">{okCount} de {records.length}<br />documentos al día</p>
                </div>
              )}

              <Link
                href={`/dashboard/carriers/${item.id}`}
                className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-white bg-accent hover:bg-accent/90 rounded-xl px-4 py-2.5 transition-colors"
              >
                Ver ficha completa <ArrowRight size={14} />
              </Link>
            </div>

            <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-5">
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Documentos</p>
                {query.isPending ? (
                  <div className="space-y-1.5"><SkeletonLine /><SkeletonLine w="w-2/3" /></div>
                ) : query.error ? (
                  <p className="text-xs text-red-500">{query.error instanceof Error ? query.error.message : 'Error cargando documentos'}</p>
                ) : records.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Sin documentos registrados</p>
                ) : issues.length === 0 ? (
                  <p className="text-xs text-green-600 font-semibold">Todos los documentos al día</p>
                ) : (
                  <div className="space-y-2">
                    {issues.length > 0 && (
                      <ul className="space-y-1">
                        {issues.map(r => {
                          const cfg = evidenciaDeDocumento(r.status, r.expiration_date, r.file_url !== null)
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
            </div>
        </div>
      </div>
    </>
  )
}
