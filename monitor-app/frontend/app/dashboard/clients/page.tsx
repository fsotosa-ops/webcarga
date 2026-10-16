'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { shippersApi, type ShipperRow } from '@/lib/api/locations'
import { tmsClientsApi } from '@/lib/api/tmsClients'
import { clientKeys, invalidateClients } from '@/lib/queries/clientes'
import { CLIENTS, clientHref } from '@/lib/navegacion/directory'
import { countOf, formatCount, placesLabel } from '@/lib/clients'
import { lifecycleStyle } from '@/lib/states'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { TmsClientLinks } from '@/components/directory/TmsClientLinks'
import { ClientNamePanel } from '@/components/directory/ClientNamePanel'

type Vista = 'activos' | 'inactivos' | 'sin-vincular'
const VISTAS: { id: Vista; label: string }[] = [
  { id: 'activos',      label: 'Activos' },
  { id: 'inactivos',    label: 'Inactivos' },
  { id: 'sin-vincular', label: 'Nombres del TMS sin vincular' },
]
const STATUS_DE_VISTA: Record<Exclude<Vista, 'sin-vincular'>, string> = { activos: 'ACTIVE', inactivos: 'INACTIVE' }
const UNLINKED = { unlinked: true } as const

const cifra = formatCount

/** Directorio › Clientes (Configuración, Parte 3): cada cliente con sus nombres
 *  en los TMS, sus lugares, sus empresas y sus viajes. Los clientes son pocos:
 *  la lista llega entera y se filtra aquí, así las cifras de los filtros son
 *  siempre las de lo que se ve. */
function ClientsList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const canEdit = usePermiso('commercial.edit')
  const [creando, setCreando] = useState(false)
  const vista = (VISTAS.find(v => v.id === searchParams.get('vista'))?.id ?? 'activos') as Vista
  const q = searchParams.get('q') ?? ''
  const returnTo = searchParams.toString() ? `${CLIENTS}?${searchParams.toString()}` : CLIENTS

  const clientes = useQuery({ queryKey: clientKeys.list({}), queryFn: shippersApi.list })
  const sinVincular = useQuery({ queryKey: clientKeys.tmsLinks(UNLINKED), queryFn: () => tmsClientsApi.list(UNLINKED) })

  const buscados = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (clientes.data ?? []).filter(c => !t || c.name.toLowerCase().includes(t))
  }, [clientes.data, q])
  const porEstado = (status: string) => buscados.filter(c => c.status === status)
  const cuenta: Record<Vista, number | undefined> = {
    activos:        clientes.data && porEstado('ACTIVE').length,
    inactivos:      clientes.data && porEstado('INACTIVE').length,
    'sin-vincular': sinVincular.data?.length,
  }

  function cambiar(next: { vista?: Vista; q?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    const v = next.vista ?? vista
    if (v === 'activos') params.delete('vista'); else params.set('vista', v)
    if (next.q !== undefined) { if (next.q) params.set('q', next.q); else params.delete('q') }
    const s = params.toString()
    router.replace(s ? `${CLIENTS}?${s}` : CLIENTS, { scroll: false })
  }

  async function crear(name: string) {
    const nuevo = await shippersApi.create({ name })
    await invalidateClients(qc)
    router.push(clientHref(nuevo.id))
  }

  const filas = vista === 'sin-vincular' ? [] : porEstado(STATUS_DE_VISTA[vista])

  return (
    <div className="p-4 md:p-6 space-y-3">
      <EncabezadoDePagina
        titulo="Clientes"
        bajada="Cada cliente con cómo lo llaman los TMS, sus lugares de carga y las empresas que lo atienden."
      >
        {canEdit && (
          <button type="button" onClick={() => setCreando(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90">
            <Plus size={14} aria-hidden /> Nuevo cliente
          </button>
        )}
      </EncabezadoDePagina>

      {creando && (
        <ClientNamePanel titulo="Nuevo cliente" accion="Crear cliente" onGuardar={crear} onCerrar={() => setCreando(false)} />
      )}

      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
        {vista !== 'sin-vincular' && (
          <div className="relative shrink-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo pointer-events-none" aria-hidden />
            <input value={q} onChange={e => cambiar({ q: e.target.value })} placeholder="Buscar cliente…" aria-label="Buscar cliente"
              className="pl-8 pr-3 py-1.5 text-dato border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 w-64 max-w-full bg-white placeholder:text-informativo" />
          </div>
        )}
        <SegmentedControl
          label="Clientes"
          options={VISTAS.map(v => ({ id: v.id, label: v.label, badge: cuenta[v.id] === undefined ? undefined : cifra(cuenta[v.id]!) }))}
          value={vista}
          onChange={id => cambiar({ vista: id })}
        />
      </div>

      {vista === 'sin-vincular' ? (
        <TmsClientLinks unlinked />
      ) : clientes.isError ? (
        <Estado tipo="error" titulo="No se pudieron cargar los clientes" />
      ) : clientes.isPending ? (
        <Estado tipo="cargando" />
      ) : clientes.data.length === 0 ? (
        <Estado tipo="vacio" titulo="Todavía no hay clientes" detalle="Se crean con Nuevo cliente." />
      ) : filas.length === 0 ? (
        <Estado tipo="vacio" titulo={q ? `Ningún cliente se llama «${q}»` : `No hay clientes ${vista}`} />
      ) : (
        <ClientsTable items={filas} returnTo={returnTo} />
      )}
    </div>
  )
}

function ClientsTable({ items, returnTo }: { items: ShipperRow[]; returnTo: string }) {
  const router = useRouter()
  return (
    <>
    {/* En el teléfono, una tarjeta por cliente (como Empresas). */}
    <ul aria-label="Clientes" className="md:hidden space-y-2">
      {items.map(c => {
        const estado = lifecycleStyle('shipper', c.status)
        return (
          <li key={c.id}>
            <Link href={clientHref(c.id, returnTo)} prefetch={false}
              className="block rounded-2xl border border-border bg-white px-3.5 py-3 hover:bg-bg-main">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-text-primary">{c.name}</span>
                <StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip>
              </span>
              <span className="mt-1 block text-etiqueta text-informativo">
                {placesLabel(c, { noun: true })} · {countOf(c.carriers, 'empresa', 'empresas')} · {countOf(c.trips_30d, 'viaje', 'viajes')} (30 días)
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
    <div className="hidden md:block bg-white rounded-2xl border border-border overflow-x-auto">
      <table className="w-full text-dato">
        <thead>
          <tr className="border-b border-border bg-bg-main">
            <th scope="col" className={CABECERA}>Cliente</th>
            <th scope="col" className={`${CABECERA} text-right`}>Nombres del TMS</th>
            <th scope="col" className={`${CABECERA} text-right`}>Lugares</th>
            <th scope="col" className={`${CABECERA} text-right`}>Empresas</th>
            <th scope="col" className={`${CABECERA} text-right`}>Viajes (30 días)</th>
            <th scope="col" className={CABECERA}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {items.map(c => {
            const href = clientHref(c.id, returnTo)
            const estado = lifecycleStyle('shipper', c.status)
            return (
              // La fila entera abre la ficha, como en Empresas; el nombre es el enlace.
              <tr key={c.id} onClick={() => router.push(href)}
                className="border-b border-border/60 last:border-0 cursor-pointer transition-colors hover:bg-bg-main">
                <td className="px-3 py-2.5">
                  <Link href={href} prefetch={false} onClick={e => e.stopPropagation()}
                    className="font-semibold text-text-primary hover:text-accent">{c.name}</Link>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cifra(c.tms_names)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{placesLabel(c)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cifra(c.carriers)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{cifra(c.trips_30d)}</td>
                <td className="px-3 py-2.5"><StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}

export default function ClientsPage() {
  return <Suspense fallback={<Estado tipo="cargando" />}><ClientsList /></Suspense>
}
