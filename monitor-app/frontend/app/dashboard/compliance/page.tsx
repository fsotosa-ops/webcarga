'use client'

import { Suspense, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Loader2, Plus } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { CertificationStatusTable } from '@/components/compliance/CertificationStatusTable'
import { CertificationFunnel } from '@/components/compliance/CertificationFunnel'
import { CarrierDrawer } from '@/components/compliance/CarrierDrawer'
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { CarrierCreateResult } from '@/lib/api/carriers'
import type { CertificationGroup } from '@/lib/types'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { Cifra } from '@/components/ui/Cifra'
import { Estado } from '@/components/ui/Estado'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { useFilaAbierta } from '@/hooks/useFilaAbierta'

type Vista = 'empresas' | 'conductores' | 'vehiculos' | 'requisitos'

/** Las cuatro agrupaciones miran los MISMOS pendientes, agrupados distinto: el
 *  control no crea vistas nuevas y no hay dos listas que sincronizar (§4).
 *
 *  La bandeja ya no es una vista de este conmutador (Task 5): tiene ruta
 *  propia en `/dashboard/compliance/inbox` y entrada propia en el sidebar,
 *  porque es otro trabajo — archivos sin destino, no requisitos sin
 *  documento. `?vista=documentos` sigue reconociéndose acá abajo, pero sólo
 *  para redirigir a la ruta nueva: es lo que hace que un enlace guardado no
 *  quede roto. */
const AGRUPACIONES: { id: Vista; label: string; group: CertificationGroup }[] = [
  { id: 'empresas',    label: 'Empresa',   group: 'carrier' },
  { id: 'conductores', label: 'Conductor', group: 'driver' },
  { id: 'vehiculos',   label: 'Vehículo',  group: 'asset' },
  { id: 'requisitos',  label: 'Requisito', group: 'requirement' },
]

function csvEscape(v: string) {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Exportación de todo lo pendiente. Vivía en la sábana de pendientes; la
 *  sábana se retiró al unificar el módulo, pero la capacidad no tenía por qué
 *  irse con ella. */
async function exportarPendientes() {
  const { rows } = await complianceApi.listPending({ limit: 200 })
  const header = ['Empresa', 'Tipo certificación', 'Categoría', 'Sub categoría', 'Tipo de documento']
  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push([r.carrier_name, r.certification_type, r.category, r.subject_name ?? '', r.document_name]
      .map(csvEscape).join(';'))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'certificacion_pendiente.csv'; a.click()
  URL.revokeObjectURL(url)
}

const INPUT = 'text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all'

export default function CertificationPage() {
  return (
    <Suspense fallback={null}>
      <CertificationPageInner />
    </Suspense>
  )
}

/** Módulo Certificación — una sola lista de empresas, cuatro maneras de
 *  agruparla.
 *
 *  La bandeja de sin clasificar dejó de ser una de esas maneras (Task 5):
 *  vivió acá adentro un tiempo porque se la trató como una vista más del
 *  mismo objeto, y no lo es — es otro objeto (archivos sin destino, no
 *  requisitos sin documento). Ahora tiene ruta y entrada de sidebar propias;
 *  lo único que queda de esa decisión es el redirect de abajo, para que un
 *  enlace guardado con `?vista=documentos` no quede roto. */
function CertificationPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const param = searchParams.get('vista')

  /** Enlace viejo a la bandeja: se conserva el reconocimiento del parámetro
   *  únicamente para reenviar a su ruta nueva. `replace` y no `push`: llegar
   *  por un enlace guardado no es un paso de navegación que el botón atrás
   *  deba reponer. */
  useEffect(() => {
    if (param === 'documentos') router.replace('/dashboard/compliance/inbox')
  }, [param, router])

  const esVistaConocida = AGRUPACIONES.some(v => v.id === param)
  const vista: Vista = esVistaConocida ? (param as Vista) : 'empresas'
  // `vista` sólo puede ser uno de los cuatro `id` de AGRUPACIONES (o el
  // default 'empresas'), así que el `.find()` siempre encuentra: a diferencia
  // de cuando existía `documentos`, ya no hay una vista sin grupo.
  const group = AGRUPACIONES.find(v => v.id === vista)!.group
  const [q, setQ] = useState('')
  const [newCarrierOpen, setNewCarrierOpen] = useState(false)
  const [exportando, setExportando] = useState(false)
  const qDebounced = useDebouncedValue(q, 300)

  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  /** Una sola fila abierta a la vez. La regla y su razón viven en el hook,
   *  porque este módulo tiene cuatro listas del mismo objeto. */
  const { abierta: filaAbierta, alternar: alternarFila } = useFilaAbierta()

  const estaSaliendo = param === 'documentos'

  const statusQuery = useQuery({
    queryKey: clavesCertificacion.estado(group, qDebounced),
    queryFn: () => complianceApi.listStatus({ group, q: qDebounced || undefined, limit: 200 }),
    enabled: !estaSaliendo,
  })

  /** "Resto del catálogo" son 209 empresas sin actividad. Se piden recién al
   *  desplegar el grupo: traerlas siempre cuesta una consulta que casi nadie
   *  lee, y juntas con las activas no caben en el límite de 200. */
  const catalogQuery = useQuery({
    queryKey: clavesCertificacion.catalogo(qDebounced),
    queryFn: () => complianceApi.listStatus({
      group: 'carrier', scope: 'catalog', q: qDebounced || undefined, limit: 300,
    }),
    enabled: group === 'carrier' && catalogoAbierto,
  })

  /** Ir a la ficha de una empresa (Task 4). Antes esto abría su cajón sin
   *  salir de Certificación; ahora que la ficha existe como pantalla propia,
   *  abrir el cajón acá adentro sería mostrar una versión resumida de una
   *  pantalla que ya tiene una completa. */
  function irAEmpresa(carrierId: string) {
    router.push(`/dashboard/compliance/${carrierId}`)
  }

  function cambiarVista(v: Vista) {
    // La vista viaja en la URL: volver del detalle no pierde dónde estabas.
    router.replace(v === 'empresas' ? '/dashboard/compliance' : `/dashboard/compliance?vista=${v}`)
  }

  function handleCarrierCreated(created: CarrierCreateResult) {
    setNewCarrierOpen(false)
    // Cuarto y ultimo punto de fuga al Empresas legacy, y ronda de arreglo 1
    // de la Task 5: cuando la vista Empresas abria el cajon en la misma
    // pantalla, aterrizar en `?abierta=<id>` bastaba. Ahora que la fila
    // navega a la ficha (Task 4) en vez de abrir el cajon, quedarse en la
    // lista con ese parametro no abria nada: la empresa recien creada
    // probablemente ni figura en el embudo, que solo lista las que tienen
    // pendientes. El punto de "no salir del modulo" nunca fue solo eso — era
    // quedar donde se puede seguir trabajando, y eso es la ficha, cargandole
    // los documentos que todavia no tiene.
    router.push(`/dashboard/compliance/${created.id}`)
  }

  const rows = statusQuery.data?.rows ?? []

  // El efecto de arriba ya disparó el reemplazo: nada que dibujar acá.
  if (estaSaliendo) return null

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <EncabezadoDePagina
          titulo="Certificación"
          bajada="Qué le falta a cada empresa para estar en condiciones de operar, y qué documentos llegaron todavía sin asignar."
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">Agrupar por</span>
        <div
          role="group"
          aria-label="Agrupar por"
          className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit"
        >
          {AGRUPACIONES.map(({ id: v, label }) => (
            <button
              key={v}
              onClick={() => cambiarVista(v)}
              aria-pressed={vista === v}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                vista === v ? 'bg-white text-text-primary shadow-sm' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {group && (
          <>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={group === 'carrier' ? 'Buscar empresa…'
                : group === 'driver' ? 'Buscar conductor…'
                : group === 'requirement' ? 'Buscar documento…' : 'Buscar patente…'}
              aria-label="Buscar"
              className={INPUT + ' w-64'}
            />
            <div className="ml-auto flex items-center gap-2">
              {group === 'carrier' && (<>
              <button
                type="button"
                onClick={async () => {
                  setExportando(true)
                  try { await exportarPendientes() } finally { setExportando(false) }
                }}
                disabled={exportando}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-accent transition-colors disabled:opacity-50 cursor-pointer"
              >
                {exportando
                  ? <Loader2 size={13} className="motion-safe:animate-spin" />
                  : <Download size={13} />}
                Exportar pendientes
              </button>
              <button
                type="button"
                onClick={() => setNewCarrierOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-accent border border-accent/30 rounded-lg px-2.5 py-1.5 hover:bg-accent/5 transition-colors cursor-pointer"
              >
                <Plus size={13} /> Nueva empresa
              </button>
              </>)}
            </div>
          </>
        )}
      </div>

      <NewCarrierPanel
        open={newCarrierOpen}
        onClose={() => setNewCarrierOpen(false)}
        onCreated={handleCarrierCreated}
      />

      <div className="border border-border rounded-xl bg-white overflow-hidden">
        <div className="flex items-baseline gap-2 px-4 py-3 border-b border-border min-h-[3.25rem]">
          <Cifra
            valor={statusQuery.data?.total_pending}
            etiqueta="documentos por cubrir"
            cargando={statusQuery.isPending}
          />
          {!statusQuery.isPending &&
            group === 'carrier' &&
            (statusQuery.data?.total_unclassified ?? 0) > 0 && (
              <span className="text-etiqueta text-gray-400">
                · {statusQuery.data?.total_unclassified} sin clasificar
              </span>
            )}
        </div>

        {statusQuery.isPending && <Estado tipo="cargando" />}
        {statusQuery.error && (
          <Estado
            tipo="error"
            titulo="No se pudo cargar el estado de la certificación"
            detalle="Vuelve a intentarlo; si sigue fallando, avisa al equipo."
          />
        )}
        {!statusQuery.isPending && !statusQuery.error && (
          <div className="overflow-y-auto max-h-[64vh]">
            {group === 'carrier' ? (
              // Agrupando por empresa la lista es el embudo de certificación:
              // el usuario mueve empresas por etapas, no vigila un tablero.
              // La fila navega a la ficha de la empresa (Task 4) en vez de
              // abrir el cajón acá adentro: la ficha ya es la pantalla
              // completa, y el cajón sólo mostraba un resumen de lo mismo.
              <CertificationFunnel
                rows={rows}
                catalogRows={catalogQuery.data?.rows ?? []}
                catalogEstado={
                  !catalogoAbierto        ? 'sin-pedir'
                    : catalogQuery.isError  ? 'error'
                    : catalogQuery.isPending ? 'cargando'
                    : 'listo'
                }
                // Volver a desplegar el grupo tras un error tiene que
                // reintentar de verdad: `setCatalogoAbierto(true)` cuando ya
                // está en `true` no dispara nada, así que el usuario quedaba
                // sin forma de recuperarse salvo recargar la página.
                onExpandCatalog={() => {
                  setCatalogoAbierto(true)
                  if (catalogQuery.isError) catalogQuery.refetch()
                }}
              />
            ) : (
              <CertificationStatusTable
                rows={rows}
                group={group}
                openRowId={filaAbierta}
                onToggleRow={alternarFila}
                // El MISMO cajón que la vista Empresas, acotado al sujeto —
                // una prop, no un componente hermano.
                renderDrawer={r => r.carrier_id ? (
                  <CarrierDrawer
                    carrierId={r.carrier_id}
                    carrierName={r.carrier_name ?? ''}
                    subject={{
                      entity_type: group === 'driver' ? 'DRIVER' : 'ASSET',
                      entity_id: r.entity_id,
                    }}
                  />
                ) : null}
                onIrAEmpresa={irAEmpresa}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
