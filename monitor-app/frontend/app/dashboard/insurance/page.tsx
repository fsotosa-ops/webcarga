'use client'

import { Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { createClient } from '@/lib/supabase/client'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { POLICY_HEALTH_CONFIG } from '@/lib/insurance'
import { dueRelative } from '@/lib/utils/installments'
import { InsurancePolicyModal } from '@/components/dashboard/InsurancePolicyModal'
import type { CarrierInsuranceOverviewItem, InsuranceOverviewFacets } from '@/lib/types'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'

const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])
const ADMIN_ROLES  = new Set(['admin', 'owner'])

const LIMIT = 50

type HealthTab = '' | 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' | 'NONE'
type StatusTab = 'active' | 'legacy'

/** Tabs mapean 1:1 a worst_policy_health — misma fuente real (app.carrier_insurance_status)
 *  que la tab Seguros de la ficha de empresa (H3 rediseño, "landing sincronizada con
 *  Empresas", 2026-07-16). Los conteos vienen de `facets`, no del tamaño de la página
 *  actual — necesario porque hay ~246 empresas y el límite de página es 100. */
const TABS: { id: HealthTab; label: string; facetKey: keyof InsuranceOverviewFacets }[] = [
  { id: '',               label: 'Todas',       facetKey: 'total' },
  { id: 'EXPIRED',        label: 'Vencidas',     facetKey: 'expired' },
  { id: 'EXPIRING_SOON',  label: 'Por vencer',   facetKey: 'expiring_soon' },
  { id: 'VALID',          label: 'Al día',       facetKey: 'valid' },
  { id: 'NONE',           label: 'Sin póliza',   facetKey: 'no_policy' },
]

/** Segundo eje, independiente de los health tabs — mismo operational_status
 *  y mismo concepto Activo/Inactivo (no Activo/Legacy) que la landing de
 *  Empresas (pedido explícito del usuario 2026-07-18: Seguros debe tener
 *  la misma separación). */
const STATUS_TABS: { id: StatusTab; label: string; status: 'ACTIVE' | 'LEGACY_INACTIVE' }[] = [
  { id: 'active', label: 'Activas',  status: 'ACTIVE' },
  { id: 'legacy', label: 'Inactivo', status: 'LEGACY_INACTIVE' },
]

const EMPTY_FACETS: InsuranceOverviewFacets = {
  expired: 0, expiring_soon: 0, valid: 0, cancelled: 0, no_policy: 0, total: 0,
}

export default function SegurosPage() {
  return (
    <Suspense fallback={null}>
      <SegurosPageInner />
    </Suspense>
  )
}

/** Lee `?q=` al montar (deep link desde InsuranceSummaryCard en la ficha de
 *  empresa, con el tax_id de esa empresa) — no se resincroniza si la URL
 *  cambia después, el usuario puede seguir editando la búsqueda libremente. */
function SegurosPageInner() {
  const searchParams = useSearchParams()
  const [q, setQ]           = useState(() => searchParams.get('q') ?? '')
  const [tab, setTab]       = useState<HealthTab>('')
  const [statusTab, setStatusTab] = useState<StatusTab>('active')
  const [page, setPage]     = useState(1)
  const [canEdit, setCanEdit]   = useState(false)
  const [canAdmin, setCanAdmin] = useState(false)
  const [selected, setSelected] = useState<CarrierInsuranceOverviewItem | null>(null)
  const qDebounced = useDebouncedValue(q, 300)

  useEffect(() => { setPage(1) }, [tab, statusTab, qDebounced])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
    })
  }, [])

  const currentOperationalStatus = STATUS_TABS.find(t => t.id === statusTab)!.status

  const query = useQuery({
    queryKey: ['carriers-insurance-overview', qDebounced, tab, statusTab, page],
    queryFn: () => carriersApi.listInsuranceOverview({
      q: qDebounced, health: tab, operational_status: currentOperationalStatus, page, limit: LIMIT,
    }),
  })

  // Conteo del otro status tab, independiente de la paginación y del health
  // tab actual (limit=1: solo interesa `facets.total`) — mismo patrón que
  // Activas/Inactivo en /dashboard/carriers.
  const otherStatusTabId = statusTab === 'active' ? 'legacy' : 'active'
  const otherOperationalStatus = STATUS_TABS.find(t => t.id === otherStatusTabId)!.status
  const otherStatusQuery = useQuery({
    queryKey: ['carriers-insurance-overview-count', otherOperationalStatus, qDebounced],
    queryFn: () => carriersApi.listInsuranceOverview({ q: qDebounced, operational_status: otherOperationalStatus, page: 1, limit: 1 }),
  })

  const items   = query.data?.data ?? []
  const facets  = query.data?.facets ?? EMPTY_FACETS
  const total   = query.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))
  const loading  = query.isPending
  const fetching = query.isFetching
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando seguros') : null

  const statusTabCounts: Record<StatusTab, number> = {
    [statusTab]: facets.total,
    [otherStatusTabId]: otherStatusQuery.data?.facets.total ?? 0,
  } as Record<StatusTab, number>

  const emptyLabel = q ? 'Sin resultados' : `Sin empresas ${statusTab === 'active' ? 'activas' : 'inactivas'} en esta categoría`

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <EncabezadoDePagina
          titulo="Seguros"
          bajada={loading ? '…' : `${facets.total.toLocaleString('es-CL')} empresa${facets.total !== 1 ? 's' : ''} con seguimiento de pólizas`}
        />
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {STATUS_TABS.map(t => {
          const active = statusTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setStatusTab(t.id)}
              aria-pressed={active}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                active ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label} <span className="ml-1 text-gray-400">{statusTabCounts[t.id]}</span>
            </button>
          )
        })}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                active ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label} <span className="ml-1 text-gray-400">{facets[t.facetKey]}</span>
            </button>
          )
        })}
      </div>

      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Nombre o tax_id…"
            className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-60 bg-white placeholder:text-gray-400 transition-all"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <p className="bg-white rounded-2xl border border-border px-4 py-14 text-center text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <div className={`transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          {/* Mobile: cards (misma resolución que TransporterCard en Empresas — una tabla
             de 6 columnas no cabe en un viewport angosto sin recortar información). */}
          <div className="md:hidden grid grid-cols-1 gap-3">
            {items.map(item => {
              const health = item.worst_policy_health
              const badge = health ? POLICY_HEALTH_CONFIG[health] : null
              const nextPayLabel = dueRelative(item.next_payment_date, item.total_overdue_installments > 0)
              return (
                <div
                  key={item.carrier_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(item)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(item) } }}
                  className="text-left bg-white border border-border rounded-2xl p-4 space-y-3 cursor-pointer transition-all hover:shadow-md hover:border-gray-300"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-text-primary truncate leading-tight">
                        {item.business_name || <span className="italic text-gray-400">Sin nombre</span>}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{item.tax_id}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 shrink-0" />
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
                    {badge ? (
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                        {badge.icon} {badge.label}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                        Sin póliza
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 text-right">
                      {item.total_policies} póliza{item.total_policies === 1 ? '' : 's'}
                      {item.total_overdue_installments > 0 && <span className="text-red-600 font-semibold"> · {item.total_overdue_installments} vencida{item.total_overdue_installments === 1 ? '' : 's'}</span>}
                      {nextPayLabel && ` · ${nextPayLabel}`}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: tabla completa */}
          <div className="hidden md:block bg-white rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
                  <th className="px-3 py-3 text-left">Empresa</th>
                  <th className="px-3 py-3 text-left w-32">Estado</th>
                  <th className="px-3 py-3 text-center w-24">Pólizas</th>
                  <th className="px-3 py-3 text-center w-28">Cuotas vencidas</th>
                  <th className="px-3 py-3 text-left w-40">Próximo pago</th>
                  <th className="px-3 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const health = item.worst_policy_health
                  const badge = health ? POLICY_HEALTH_CONFIG[health] : null
                  const nextPayLabel = dueRelative(item.next_payment_date, item.total_overdue_installments > 0)
                  return (
                    <tr
                      key={item.carrier_id}
                      onClick={() => setSelected(item)}
                      className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                        selected?.carrier_id === item.carrier_id ? 'bg-accent/5' : i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/70'
                      }`}
                    >
                      <td className="px-3 py-3">
                        <p className="font-semibold text-text-primary truncate leading-tight">
                          {item.business_name || <span className="italic text-gray-400">Sin nombre</span>}
                        </p>
                        <p className="text-[11px] text-gray-400 font-mono">{item.tax_id}</p>
                      </td>
                      <td className="px-3 py-3">
                        {badge ? (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                            {badge.icon} {badge.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                            Sin póliza
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center font-bold text-sm text-slate-700">{item.total_policies}</td>
                      <td className="px-3 py-3 text-center">
                        {item.total_overdue_installments > 0 ? (
                          <span className="font-bold text-sm text-red-600">{item.total_overdue_installments}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{nextPayLabel ?? '—'}</td>
                      <td className="px-3 py-3 text-center text-gray-300"><ChevronRight size={15} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={13} /> Anterior
          </button>
          <span className="text-xs text-gray-400">Página {page} de {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Siguiente <ChevronRight size={13} />
          </button>
        </div>
      )}

      <InsurancePolicyModal
        carrierId={selected?.carrier_id ?? null}
        displayName={selected?.business_name || selected?.tax_id || ''}
        onClose={() => setSelected(null)}
        canAdmin={canAdmin}
        canEdit={canEdit}
      />
    </div>
  )
}
