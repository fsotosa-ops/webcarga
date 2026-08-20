'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Building2, Check, ChevronRight, Clock, Loader2, Plus,
} from 'lucide-react'
import type {
  CertificationStatusRow, FunnelGroup, ManagementType,
} from '@/lib/types'

interface Props {
  /** Las empresas del alcance `active`: operativas más cualquiera con
   *  documentos esperando. */
  rows:             CertificationStatusRow[]
  /** El complemento, que se pide recién al desplegar el grupo. */
  catalogRows:      CertificationStatusRow[]
  /** Los cuatro estados del catálogo, NOMBRADOS. Antes se deducían de un
   *  booleano más el largo del arreglo, y eso dejaba "no pedí", "vino vacío" y
   *  "falló" indistinguibles: los tres se dibujaban igual y un error se veía
   *  como un catálogo vacío. Es la misma clase de defecto —un valor con varios
   *  significados— que este componente ya tuvo con el "0". */
  catalogEstado:    'sin-pedir' | 'cargando' | 'listo' | 'error'
  onExpandCatalog:  () => void
}

/** El embudo de certificación.
 *
 *  El eje NO es "cuánto le falta a cada empresa": las 39 activas tienen el
 *  mismo denominador y entre 1 y 3 documentos cubiertos, así que ordenar por
 *  completitud no discrimina nada — la diferencia entre la primera fila y la
 *  trigésima es un documento. Ese fue el error del diseño anterior.
 *
 *  El eje es **en qué punto de la certificación está cada empresa**, porque el
 *  usuario no vigila un tablero: mueve empresas por un embudo. */
const ETAPAS: { id: FunnelGroup; titulo: string; icono: typeof Plus; tono: string }[] = [
  { id: 'sin_documentos', titulo: 'Recién creadas · sin documentos', icono: Plus,           tono: 'bg-sky-50 text-sky-800' },
  { id: 'en_proceso',     titulo: 'En proceso',                      icono: Clock,          tono: 'bg-gray-50 text-gray-500' },
  { id: 'renovar',        titulo: 'Hay que renovar',                 icono: AlertTriangle,  tono: 'bg-amber-50 text-amber-800' },
  { id: 'al_dia',         titulo: 'Certificadas y al día',           icono: Check,          tono: 'bg-emerald-50 text-resuelto' },
  { id: 'catalogo',       titulo: 'Resto del catálogo',              icono: Building2,      tono: 'bg-gray-50 text-gray-500' },
]

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

export function CertificationFunnel({
  rows, catalogRows, catalogEstado, onExpandCatalog,
}: Props) {
  // Los dos grupos del fondo arrancan plegados: uno está vacío y el otro son
  // 209 empresas sin actividad. Ninguno es el trabajo de hoy.
  const [plegados, setPlegados] = useState<Set<FunnelGroup>>(
    () => new Set<FunnelGroup>(['al_dia', 'catalogo']),
  )

  function alternar(etapa: FunnelGroup) {
    setPlegados(prev => {
      const next = new Set(prev)
      if (next.has(etapa)) {
        next.delete(etapa)
        // El catálogo se pide recién acá: son 209 filas que casi nunca se
        // miran, y traerlas siempre cuesta una consulta que nadie leyó.
        if (etapa === 'catalogo') onExpandCatalog()
      } else {
        next.add(etapa)
      }
      return next
    })
  }

  return (
    <div>
      {ETAPAS.map(({ id, titulo, icono: Icono, tono }) => {
        const deEstaEtapa = id === 'catalogo'
          ? catalogRows
          : rows.filter(r => r.funnel_group === id)
        const plegado = plegados.has(id)
        const vencidos = deEstaEtapa.reduce((n, r) => n + (r.expired_count ?? 0), 0)

        return (
          <section key={id}>
            <button
              type="button"
              data-testid={`grupo-${id}`}
              onClick={() => alternar(id)}
              aria-expanded={!plegado}
              className={`w-full flex items-center gap-2 px-4 py-1.5 border-b border-border cursor-pointer transition-colors hover:brightness-[0.98] ${tono}`}
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${plegado ? '' : 'rotate-90'}`}
                aria-hidden="true"
              />
              <Icono size={12} aria-hidden="true" />
              {/* Andamiaje: versalitas, 10px, no compite con el sujeto (§9). */}
              <span className="text-etiqueta font-semibold uppercase tracking-[.11em]">
                {titulo}
              </span>
              <span className="ml-auto flex items-center gap-2 text-etiqueta font-medium tabular-nums">
                {id === 'renovar' && vencidos > 0 && (
                  <span className="font-normal">
                    {vencidos === 1 ? '1 documento vencido' : `${vencidos} documentos vencidos`}
                  </span>
                )}
                {/* Cada estado del catálogo se dibuja distinto, porque decir lo
                 *  mismo para todos fue el defecto anterior: "0" mientras no se
                 *  había pedido invitaba a no abrir el grupo, y 209 empresas
                 *  quedaban invisibles detrás de ese cero. El conteo sólo
                 *  aparece cuando de verdad hay dato que contar. */}
                {id !== 'catalogo'
                  ? deEstaEtapa.length
                  : catalogEstado === 'cargando'
                    ? <Loader2 size={11} className="motion-safe:animate-spin" />
                    : catalogEstado === 'error'
                      ? <span className="text-[--accion] font-normal">No se pudo cargar · reintentar</span>
                      : catalogEstado === 'listo'
                        ? deEstaEtapa.length
                        : null}
              </span>
            </button>

            {!plegado && !deEstaEtapa.length && (
              <p className="px-4 py-2 text-etiqueta text-gray-400 border-b border-border">
                {id !== 'catalogo' ? 'Ninguna acá'
                  : catalogEstado === 'cargando' ? 'Cargando…'
                  : catalogEstado === 'error'    ? 'No se pudo cargar el catálogo. Vuelve a desplegar el grupo para reintentar.'
                  : 'Ninguna acá'}
              </p>
            )}

            {!plegado && deEstaEtapa.map(r => (
              <FilaEmpresa key={r.entity_id} row={r} />
            ))}
          </section>
        )
      })}
    </div>
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
  const alDia = row.total_count > 0 && row.pending_count === 0
  const gestion = etiquetaGestion(row.management_types)

  return (
    <Link
      href={`/dashboard/compliance/${row.entity_id}`}
      className="flex items-center gap-2.5 px-4 py-2 border-b border-border transition-colors hover:bg-gray-50"
    >
      <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
      {/* El sujeto es lo más fuerte de la fila: es lo que se escanea (§9). */}
      <span className="flex-1 min-w-0 truncate text-[13.5px] font-semibold text-text-primary">
        {row.entity_name}
      </span>

      {gestion && (
        <span className="hidden sm:inline text-etiqueta text-gray-500 shrink-0">
          {gestion}
        </span>
      )}

      {/* Marca de actividad. Va NEUTRA a propósito: el mockup la pintaba en
          rojo, pero el §9 reserva el rojo #b00020 para un solo significado
          —hay archivos esperando—. Si todo tiene color, el color deja de
          avisar. Y no ordena: hoy hay 0 viajes futuros vinculados, así que
          priorizar por actividad prometería una anticipación que los datos
          no tienen. */}
      {(row.trips_30d ?? 0) > 0 && (
        <span className="hidden md:inline text-etiqueta text-gray-500 shrink-0 tabular-nums">
          {row.trips_30d} viajes · 30 días
        </span>
      )}

      {/* La barra mide 96px: con "1 de 382" el relleno daba 0,25px y se
          veia IGUAL que cero. "Empezado" y "no empezado" son cosas
          distintas y tienen que verse distinto, asi que cualquier avance
          mayor a cero ocupa al menos 3px. La barra deja de ser proporcional
          en el extremo bajo a proposito: ahi lo que importa es si arranco. */}
      <span className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden shrink-0">
        <span
          className={`block h-full rounded-full ${alDia ? 'bg-resuelto' : 'bg-accion'}`}
          style={{ width: pct > 0 ? `max(3px, ${pct}%)` : 0 }}
        />
      </span>
      <span className="text-etiqueta text-gray-500 tabular-nums whitespace-nowrap shrink-0 w-16 text-right">
        {row.satisfied_count} de {row.total_count}
      </span>

      {row.unclassified_count > 0 && (
        <span
          data-testid={`espera-${row.entity_id}`}
          title={`${row.unclassified_count} archivos esperando que los ubiques`}
          className="inline-flex items-center rounded-full bg-espera px-2 py-0.5 text-etiqueta font-bold tabular-nums text-white shrink-0"
        >
          {row.unclassified_count}
        </span>
      )}
    </Link>
  )
}
