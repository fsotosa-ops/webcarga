'use client'

import { useState } from 'react'
import Link from 'next/link'
import { carrierHref } from '@/lib/navegacion/directory'
import { ChevronRight } from 'lucide-react'
import type { CertificationStatusRow, ManagementType } from '@/lib/types'
import type { CarrierOperationalStatus, FunnelBucket } from '@/lib/types'
import {
  CARRIER_LIFECYCLE_GROUP_LABELS, FUNNEL_BUCKET_ORDER,
  funnelBucketStyle, lifecycleStyle, enablementStyleFromFlag,
  totalCounts,
} from '@/lib/states'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { ComplianceCounts } from '@/components/ui/ComplianceCounts'
import { TableHeader } from '@/components/ui/tabla/Table'

interface Props {
  /** El alcance `active`: empresas activas más cualquiera con archivos esperando. */
  rows:            CertificationStatusRow[]
  /** El complemento (`scope=catalog`), que se pide recién al elegir un ciclo de vida no activo. */
  catalogRows:     CertificationStatusRow[]
  /** Los cuatro estados del catálogo, NOMBRADOS: "no pedí", "vino vacío" y
   *  "falló" no se pueden dibujar igual. */
  catalogEstado:   'sin-pedir' | 'cargando' | 'listo' | 'error'
  onExpandCatalog: () => void
}

/** Qué códigos agrupa cada pestaña. Las etiquetas son las del glosario: acá
 *  solo se agrupan códigos. INACTIVE y LEGACY_INACTIVE se muestran igual (§3).
 *  `fromCatalog`: la pestaña necesita el catálogo; ONBOARDING no, porque sigue
 *  en el alcance activo (R-E2, decisión del usuario). */
const LIFECYCLE_TABS: { id: 'active' | 'onboarding' | 'inactive'; label: string;
                        status: CarrierOperationalStatus[]; fromCatalog: boolean }[] = [
  { id: 'active',     label: CARRIER_LIFECYCLE_GROUP_LABELS.active,     status: ['ACTIVE'],                      fromCatalog: false },
  { id: 'onboarding', label: CARRIER_LIFECYCLE_GROUP_LABELS.onboarding, status: ['ONBOARDING'],                  fromCatalog: false },
  { id: 'inactive',   label: CARRIER_LIFECYCLE_GROUP_LABELS.inactive,   status: ['INACTIVE', 'LEGACY_INACTIVE'], fromCatalog: true },
]

type LifecycleTab = (typeof LIFECYCLE_TABS)[number]

/** Las etiquetas visibles salen de acá y no del backend, que habla códigos: un
 *  renombre en `app.status_taxonomies` —hubo dos en dos días— no tiene por qué
 *  cambiar el contrato de la API. */
const GESTION: Record<ManagementType, string> = {
  TRACTOREO: 'Tractoreo',
  EQUIPO_COMPLETO: 'Equipo Completo',
}

function etiquetaGestion(tipos?: ManagementType[] | null): string | null {
  if (!tipos?.length) return null
  // La única empresa mixta se muestra como las dos, no se esconde una (§8).
  return tipos.map(t => GESTION[t]).join(' + ')
}

/** El embudo de certificación (D1).
 *
 *  Dos ejes que no se mezclan (spec §2, E-b):
 *  - el CICLO DE VIDA es un filtro arriba — Activas, En onboarding, Dadas de
 *    baja —, con las mismas pestañas que el Directorio;
 *  - entre las activas, el BALDE sale de `funnel_bucket`, que calcula la API
 *    con la misma regla que Pendientes. Este componente no decide ningún estado.
 *
 *  Antes "No activas" era un quinto balde y mezclaba el ciclo de vida con los
 *  documentos (conflicto 1 de la auditoría de estados). */
export function CertificationFunnel({ rows, catalogRows, catalogEstado, onExpandCatalog }: Props) {
  const [tab, setTab] = useState<LifecycleTab>(LIFECYCLE_TABS[0])
  const [plegados, setPlegados] = useState<Set<FunnelBucket>>(() => new Set<FunnelBucket>(['up_to_date']))

  const esActiva = (r: CertificationStatusRow) => r.operational_status === 'ACTIVE'
  const activas = rows.filter(esActiva)
  // Las no activas llegan por dos caminos: el alcance activo (ONBOARDING, y
  // las dadas de baja con archivos esperando) y el catálogo. Son disjuntos por
  // construcción del backend.
  const noActivas = [...rows.filter(r => !esActiva(r)), ...catalogRows]
  const deLaPestaña = (t: LifecycleTab) =>
    noActivas.filter(r => (t.status as string[]).includes(r.operational_status ?? ''))

  function elegir(id: string) {
    const t = LIFECYCLE_TABS.find(x => x.id === id)!
    setTab(t)
    if (t.fromCatalog && catalogEstado !== 'listo' && catalogEstado !== 'cargando') onExpandCatalog()
  }

  const opciones = LIFECYCLE_TABS.map(t => ({
    id: t.id,
    label: t.label,
    // Un cero sin haber preguntado se lee como "no hay ninguna" (regresión ya vista con el catálogo).
    badge: t.id === 'active' ? String(activas.length)
      : !t.fromCatalog || catalogEstado === 'listo' ? String(deLaPestaña(t).length) : undefined,
  }))

  const filas = deLaPestaña(tab)
  const pidiendo = tab.fromCatalog && (catalogEstado === 'cargando' || catalogEstado === 'sin-pedir')
  const fallo = tab.fromCatalog && catalogEstado === 'error'

  return (
    <div>
      <div className="px-4 py-2.5 border-b border-border">
        <SegmentedControl label="Ciclo de vida" options={opciones} value={tab.id} onChange={elegir} />
      </div>

      {(tab.status.includes('ACTIVE') ? activas.length > 0 : filas.length > 0) && <Columns />}

      {tab.status.includes('ACTIVE') ? (
        FUNNEL_BUCKET_ORDER.map(bucket => {
          const { label, icon: Icono, tone } = funnelBucketStyle(bucket)
          const delBalde = activas.filter(r => r.funnel_bucket === bucket)
          const plegado = plegados.has(bucket)
          return (
            <section key={bucket}>
              <h2>
                <button
                  type="button"
                  data-testid={`grupo-${bucket}`}
                  aria-expanded={!plegado}
                  onClick={() => setPlegados(prev => {
                    const next = new Set(prev)
                    if (next.has(bucket)) next.delete(bucket); else next.add(bucket)
                    return next
                  })}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border cursor-pointer transition-colors hover:bg-bg-main"
                >
                  <ChevronRight size={15} aria-hidden="true"
                                className={`shrink-0 transition-transform ${plegado ? '' : 'rotate-90'}`} />
                  <Icono size={14} className="shrink-0" aria-hidden="true" />
                  <span className="text-lectura font-bold text-text-primary">{label}</span>
                  <span className="ml-auto">
                    <StatusChip tone={delBalde.length ? tone : 'neutral'}>{delBalde.length}</StatusChip>
                  </span>
                </button>
              </h2>
              {!plegado && (delBalde.length
                ? <div className="pl-6 border-l-2 border-border">{delBalde.map(r => <FilaEmpresa key={r.entity_id} row={r} />)}</div>
                : <p className="px-4 py-2 text-etiqueta text-informativo border-b border-border">Ninguna</p>)}
            </section>
          )
        })
      ) : (
        <>
          {filas.length > 0 && <div>{filas.map(r => <FilaEmpresa key={r.entity_id} row={r} />)}</div>}
          {pidiendo ? (
            <Estado tipo="cargando" />
          ) : fallo ? (
            <Estado tipo="error" titulo="No se pudo cargar esta lista" detalle="Las empresas siguen guardadas.">
              <button type="button" onClick={onExpandCatalog}
                      className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
                Reintentar
              </button>
            </Estado>
          ) : filas.length === 0 ? (
            <Estado tipo="vacio" titulo="Ninguna empresa en este ciclo de vida" />
          ) : null}
        </>
      )}
    </div>
  )
}

/** El ancho de cada columna, el mismo en el encabezado y en la fila: así se
 *  alinean aunque una celda venga vacía (Entrega 2 de fichas). */
const COL = {
  type:     'w-32 shrink-0',
  trips:    'w-24 shrink-0',
  // En el teléfono no hay encabezado: estas celdas miden lo que su contenido,
  // y el nombre conserva su lugar.
  progress: 'md:w-44 shrink-0',
  pending:  'md:w-28 shrink-0',
  waiting:  'md:w-8 shrink-0',
}

/** El encabezado de la lista, una vez. En el teléfono no se ve (`TableHeader`),
 *  igual que Tipo y Viajes en la fila. */
function Columns() {
  return (
    <TableHeader>
      <span className="flex flex-1 items-center gap-2.5 px-1">
        <span className="w-3 shrink-0" />
        <span className="flex-1">Empresa</span>
        <span className={COL.type}>Tipo</span>
        <span className={COL.trips}>Viajes 30 días</span>
        <span className={COL.progress}>Avance</span>
        <span className={COL.pending}>Pendientes</span>
        <span className={COL.waiting} />
      </span>
    </TableHeader>
  )
}

/** La fila del embudo NAVEGA a la ficha de la empresa, así que es un enlace.
 *
 *  Fue un `role="button"` con `aria-expanded` mientras abría un cajón acá
 *  adentro; cuando el destino pasó a ser una página nueva, el contrato de
 *  accesibilidad se quedó puesto: un lector de pantalla anunciaba "botón,
 *  contraído" y activarlo sacaba de la pantalla, sin que nada en el árbol
 *  anticipara la navegación. El chevron prometía lo mismo con el mouse.
 *
 *  De yapa, un `<Link>` real devuelve abrir-en-pestaña-nueva. */
function FilaEmpresa({ row }: { row: CertificationStatusRow }) {
  const pct = row.total_count > 0
    ? Math.round((row.satisfied_count / row.total_count) * 100)
    : 0
  const activa = row.operational_status === 'ACTIVE'
  const alDia = row.funnel_bucket === 'up_to_date'
  const gestion = etiquetaGestion(row.management_types)

  return (
    <Link
      href={`${carrierHref(row.entity_id)}?tab=documentos`}
      // Sin precarga: el embudo lista decenas de empresas y precargar cada ficha
      // agota el límite de tasa (429), como en la lista de Empresas.
      prefetch={false}
      className="flex items-center gap-2.5 px-4 py-2 border-b border-border transition-colors hover:bg-bg-main"
    >
      <ChevronRight size={12} className="text-informativo shrink-0" aria-hidden="true" />
      {/* El sujeto es lo más fuerte de la fila: es lo que se escanea (§9). El
          ciclo de vida y la habilitación de una no activa van con el nombre, para
          que las columnas no se corran. */}
      <span className="flex flex-1 min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-dato font-semibold text-text-primary">{row.entity_name}</span>
        {!activa && (() => {
          const ciclo = lifecycleStyle('carrier', row.operational_status ?? '')
          const hab = enablementStyleFromFlag(row.compliance_summary?.can_operate ?? false, false)
          return (
            <>
              <StatusChip tone={ciclo.tone} icon={ciclo.icon}>{ciclo.label}</StatusChip>
              <StatusChip tone={hab.tone} icon={hab.icon}>{hab.label}</StatusChip>
            </>
          )
        })()}
      </span>

      <span className={`${COL.type} hidden sm:block truncate text-etiqueta text-informativo`}>{gestion}</span>

      {/* Marca de actividad. Va NEUTRA a propósito: el mockup la pintaba en
          rojo, pero el §9 reserva el rojo #b00020 para un solo significado
          —hay archivos esperando—. Si todo tiene color, el color deja de
          avisar. Y no ordena: hoy hay 0 viajes futuros vinculados, así que
          priorizar por actividad prometería una anticipación que los datos
          no tienen. */}
      <span data-testid={`viajes-${row.entity_id}`} className={`${COL.trips} hidden md:block text-etiqueta text-informativo tabular-nums`}>
        {(row.trips_30d ?? 0) > 0 ? row.trips_30d : ''}
      </span>

      {/* La barra mide 96px: con "1 de 382" el relleno daba 0,25px y se
          veia IGUAL que cero. "Empezado" y "no empezado" son cosas
          distintas y tienen que verse distinto, asi que cualquier avance
          mayor a cero ocupa al menos 3px. La barra deja de ser proporcional
          en el extremo bajo a proposito: ahi lo que importa es si arranco. */}
      <span className={`${COL.progress} flex items-center gap-2`}>
        <span className="hidden sm:block h-1.5 w-24 rounded-full bg-border overflow-hidden shrink-0">
          <span
            className={`block h-full rounded-full ${alDia ? 'bg-resuelto' : 'bg-accion'}`}
            style={{ width: pct > 0 ? `max(3px, ${pct}%)` : 0 }}
          />
        </span>
        <span className="text-etiqueta text-informativo tabular-nums whitespace-nowrap">
          {row.satisfied_count} de {row.total_count}
        </span>
      </span>

      <span className={`${COL.pending} flex`}>
        {row.compliance_summary && <ComplianceCounts counts={totalCounts(row.compliance_summary)} muted={!activa} />}
      </span>

      <span className={`${COL.waiting} ${row.unclassified_count > 0 ? 'flex' : 'hidden md:flex'} justify-end`}>
        {row.unclassified_count > 0 && (
          <span
            data-testid={`espera-${row.entity_id}`}
            title={`${row.unclassified_count} archivos esperando que los ubiques`}
            className="inline-flex items-center rounded-full bg-espera px-2 py-0.5 text-etiqueta font-bold tabular-nums text-white"
          >
            {row.unclassified_count}
          </span>
        )}
      </span>
    </Link>
  )
}
