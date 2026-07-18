'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Building2, ChevronLeft, ChevronRight, Search, Loader2, ShieldAlert, ShieldCheck, Plus, Check, X } from 'lucide-react'
import type { CarrierListFacets, CarrierListItem, ComplianceHealth, OperationalStatus } from '@/lib/types'
import { carriersApi } from '@/lib/api/carriers'
import { createClient } from '@/lib/supabase/client'
import { useTransporters } from '@/hooks/useTransporters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { TransporterCard, STATUS_LABELS, STATUS_CLS } from '@/components/dashboard/TransporterCard'
import { TransporterSlideOver } from '@/components/dashboard/TransporterSlideOver'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import { AlertStatTiles } from '@/components/dashboard/AlertStatTiles'
import { updatedRelative } from '@/lib/compliance'

const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])

type TransporterTab = 'active' | 'legacy'
type HealthTab = '' | ComplianceHealth

const LIMIT = 100
const VIEW_MODE_STORAGE_KEY = 'empresas:vista'
const VIEW_LABELS = { tablero: 'Tarjetas', tabla: 'Tabla' }

/** Cada tab mapea 1:1 a un operational_status real — hoy solo existen
 *  ACTIVE (38) y LEGACY_INACTIVE (208) en datos reales (INACTIVE es la baja
 *  manual de una empresa que sí llegó a operar, ver schemas/carrier.py,
 *  sin filas reales todavía). Filtrar server-side, no sobre una sola
 *  página — 208 > el límite de 100 por página del backend. */
const TABS: { id: TransporterTab; label: string; status: OperationalStatus }[] = [
  { id: 'active', label: 'Activas', status: 'ACTIVE' },
  { id: 'legacy', label: 'Inactivo', status: 'LEGACY_INACTIVE' },
]

/** Segundo eje de filtrado, independiente de Activas/Inactivo — agrupa por
 *  documentación obligatoria pendiente (mismo criterio que la ficha de
 *  empresa). Los conteos vienen de `facets`, ya acotados a la tab
 *  operational_status + búsqueda actuales (no cambian al clickear un
 *  health tab, igual que en /dashboard/seguros). */
const HEALTH_TABS: { id: HealthTab; label: string; facetKey: keyof CarrierListFacets }[] = [
  { id: '',        label: 'Todas',       facetKey: 'total' },
  { id: 'PENDING', label: 'Pendientes',  facetKey: 'pending' },
  { id: 'OK',      label: 'Al día',      facetKey: 'ok' },
]

const EMPTY_FACETS: CarrierListFacets = { pending: 0, ok: 0, total: 0 }

export default function EmpresasTransportePage() {
  const router = useRouter()
  const [q, setQ]                 = useState('')
  const [tab, setTab]             = useState<TransporterTab>('active')
  const [healthTab, setHealthTab] = useState<HealthTab>('')
  const [page, setPage]           = useState(1)
  const [viewMode, setViewMode]   = useState<ViewMode>('tablero')
  const [selected, setSelected]   = useState<CarrierListItem | null>(null)
  const [canEdit, setCanEdit]     = useState(false)
  const [addCarrierOpen, setAddCarrierOpen] = useState(false)
  const [carrierForm, setCarrierForm] = useState({ tax_id: '', business_name: '' })
  const [creatingCarrier, setCreatingCarrier] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const qDebounced = useDebouncedValue(q, 300)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
    })
  }, [])

  /** Alta manual de una empresa (distinta del bulk-load de Mage) — el
   *  backend siembra los compliance_records MISSING automáticamente al
   *  insertar. Redirige a la ficha recién creada: ahí ya existen los flujos
   *  reales de alta de conductores/equipos/contactos/pólizas ("+ Conductor"/
   *  "+ Equipo"/"+ Póliza"), no hace falta duplicarlos acá. */
  async function handleAddCarrier() {
    if (!carrierForm.tax_id || !carrierForm.business_name) return
    setCreatingCarrier(true); setCreateErr(null)
    try {
      const created = await carriersApi.create(carrierForm)
      router.push(`/dashboard/transportistas/empresa/${created.id}`)
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error al crear la empresa')
    } finally {
      setCreatingCarrier(false)
    }
  }

  const currentStatus = TABS.find(t => t.id === tab)!.status

  useEffect(() => { setPage(1) }, [tab, healthTab, qDebounced])

  const query = useTransporters({ q: qDebounced, operational_status: currentStatus, health: healthTab, page, limit: LIMIT })
  const items = useMemo(() => query.data?.data ?? [], [query.data])
  const tabTotal = query.data?.count ?? 0
  const healthFacets = query.data?.facets ?? EMPTY_FACETS
  const loading  = query.isPending
  const fetching = query.isFetching
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando empresas') : null

  // Conteos por tab independientes de la paginación (limit=1: solo interesa `count`).
  const otherTabId = tab === 'active' ? 'legacy' : 'active'
  const otherStatus = TABS.find(t => t.id === otherTabId)!.status
  const otherCountQuery = useQuery({
    queryKey: ['carriers-count', otherStatus, qDebounced],
    queryFn: () => carriersApi.list({ q: qDebounced, operational_status: otherStatus, limit: 1 }),
  })
  // healthFacets.total = conteo real de la tab actual sin el filtro de health
  // (a diferencia de tabTotal, que sí lo aplica) — así el badge de la tab no
  // cambia al clickear un health tab.
  const tabCounts: Record<TransporterTab, number> = {
    [tab]: healthFacets.total,
    [otherTabId]: otherCountQuery.data?.count ?? 0,
  } as Record<TransporterTab, number>
  const grandTotal = tabCounts.active + tabCounts.legacy

  const totalPages = Math.max(1, Math.ceil(tabTotal / LIMIT))

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'tabla' || saved === 'tablero') setViewMode(saved)
  }, [])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, v)
  }

  const emptyLabel = q ? 'Sin resultados' : `Sin empresas ${tab === 'active' ? 'activas' : 'inactivas'}`

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Empresas de Transporte</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading ? '…' : `${grandTotal.toLocaleString('es-CL')} empresa${grandTotal !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setAddCarrierOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              <Plus size={13} /> Nueva empresa
            </button>
          )}
          <ViewToggle value={viewMode} onChange={handleViewModeChange} labels={VIEW_LABELS} />
        </div>
      </div>

      {addCarrierOpen && (
        <div className="bg-white border border-border rounded-2xl p-4 max-w-sm space-y-2">
          <p className="text-xs font-bold text-text-primary mb-1">Nueva empresa</p>
          <input
            placeholder="Tax ID"
            value={carrierForm.tax_id}
            onChange={e => setCarrierForm(v => ({ ...v, tax_id: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <input
            placeholder="Razón social"
            value={carrierForm.business_name}
            onChange={e => setCarrierForm(v => ({ ...v, business_name: e.target.value }))}
            className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {createErr && <p className="text-xs text-red-500">{createErr}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleAddCarrier}
              disabled={creatingCarrier || !carrierForm.tax_id || !carrierForm.business_name}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {creatingCarrier ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Crear y abrir ficha
            </button>
            <button onClick={() => { setAddCarrierOpen(false); setCreateErr(null) }} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs Activas / Legacy — split principal, membresía mutuamente
         excluyente real, viene de operational_status ── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
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
              {t.label} <span className="ml-1 text-gray-400">{tabCounts[t.id]}</span>
            </button>
          )
        })}
      </div>

      {/* ── Tiles de alertas — segundo eje, viene de compliance_health.
         Clickeables (filtran), no solo informativos: dejan triagear y
         actuar rápido sin competir por espacio con Activas/Inactivo. ── */}
      <AlertStatTiles
        tiles={HEALTH_TABS.map(t => ({
          id: t.id, label: t.label, value: healthFacets[t.facetKey],
          tone: t.id === 'PENDING' ? 'danger' : t.id === 'OK' ? 'success' : 'neutral',
        }))}
        active={healthTab}
        onSelect={id => setHealthTab(id as HealthTab)}
      />

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
      ) : viewMode === 'tablero' ? (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          {items.map(item => (
            <TransporterCard key={item.id} item={item} onOpen={setSelected} selected={selected?.id === item.id} />
          ))}
        </div>
      ) : (
        <div className={`transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          <div className="md:hidden grid grid-cols-1 gap-3">
            {items.map(item => (
              <TransporterCard key={item.id} item={item} onOpen={setSelected} selected={selected?.id === item.id} />
            ))}
          </div>

          <div className="hidden md:block bg-white rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
                  <th className="px-3 py-3 text-left">Empresa</th>
                  <th className="px-3 py-3 text-left w-32">Tax ID</th>
                  <th className="px-3 py-3 text-left w-24">Estado</th>
                  <th className="px-3 py-3 text-left w-32">Documentación</th>
                  <th className="px-3 py-3 text-left w-28">Última actualización</th>
                  <th className="px-3 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                      selected?.id === item.id ? 'bg-accent/5' : i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/70'
                    }`}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <Building2 size={14} className="text-gray-400" />
                        </div>
                        <p className="font-semibold text-text-primary truncate leading-tight">
                          {item.business_name || <span className="italic text-gray-400">Sin nombre</span>}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-500">{item.tax_id}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CLS[item.operational_status]}`}>
                        {STATUS_LABELS[item.operational_status]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {item.compliance_health === 'PENDING' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                          <ShieldAlert size={9} /> {item.pending_mandatory} pendiente{item.pending_mandatory === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                          <ShieldCheck size={9} /> Al día
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">{updatedRelative(item.last_document_update) ?? '—'}</td>
                    <td className="px-3 py-3 text-center">
                      {/* prefetch=false: mismo motivo que TransporterCard — evita que Next.js
                         prefetchee las 100 filas visibles a la vez y agote el rate limit. */}
                      <Link
                        href={`/dashboard/transportistas/empresa/${item.id}`}
                        prefetch={false}
                        onClick={e => e.stopPropagation()}
                        title="Ver ficha completa"
                        className="text-gray-300 hover:text-accent transition-colors"
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
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

      <TransporterSlideOver item={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
