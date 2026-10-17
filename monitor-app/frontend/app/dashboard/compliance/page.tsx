'use client'

import { Suspense, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight, FileSpreadsheet, Loader2, Plus } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { CertificationStatusTable } from '@/components/compliance/CertificationStatusTable'
import { CertificationFunnel } from '@/components/compliance/CertificationFunnel'
import { DirectorioResumen } from '@/components/compliance/DirectorioResumen'
import { NewCarrierPanel } from '@/components/dashboard/NewCarrierPanel'
import { ActualizarPorPlanillaModal } from '@/components/compliance/ActualizarPorPlanillaModal'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { CarrierCreateResult } from '@/lib/api/carriers'
import type { CertificationGroup } from '@/lib/types'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { Cifra } from '@/components/ui/Cifra'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { invalidateDirectory } from '@/lib/queries/directorio'
import { carrierHref } from '@/lib/navegacion/directory'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { PageContainer } from '@/components/ui/PageContainer'
import { inputClass } from '@/components/ui/Field'

type Vista = 'empresas' | 'requisitos'

/** Las agrupaciones miran los MISMOS pendientes, agrupados distinto: el control
 *  no crea vistas nuevas y no hay dos listas que sincronizar (§4).
 *
 *  "Conductor" y "Vehículo" no son vistas de este módulo desde la Entrega C
 *  (14/10): abren Directorio › Conductores / Equipos con el filtro de documentos
 *  pendientes puesto. Es el mismo objeto, así que es una sola lista.
 *
 *  La bandeja tampoco es una vista (Task 5): tiene ruta propia en
 *  `/dashboard/compliance/inbox`. `?vista=documentos|conductores|vehiculos`
 *  se siguen reconociendo abajo, sólo para redirigir: un enlace guardado no
 *  queda roto. */
const AGRUPACIONES: { id: Vista; label: string; group: CertificationGroup }[] = [
  { id: 'empresas',    label: 'Empresa',   group: 'carrier' },
  { id: 'requisitos',  label: 'Requisito', group: 'requirement' },
]
const AL_DIRECTORIO: { label: string; href: string; vistaVieja: string }[] = [
  { label: 'Conductor', href: '/dashboard/drivers?documents=pending', vistaVieja: 'conductores' },
  { label: 'Vehículo',  href: '/dashboard/assets?documents=pending',  vistaVieja: 'vehiculos' },
]
const REDIRECCIONES: Record<string, string> = {
  documentos: '/dashboard/compliance/inbox',
  ...Object.fromEntries(AL_DIRECTORIO.map(d => [d.vistaVieja, d.href])),
}

const INPUT = inputClass({ size: 'sm' })

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
  const redireccion = param ? REDIRECCIONES[param] : undefined
  useEffect(() => {
    if (redireccion) router.replace(redireccion)
  }, [redireccion, router])

  const esVistaConocida = AGRUPACIONES.some(v => v.id === param)
  const vista: Vista = esVistaConocida ? (param as Vista) : 'empresas'
  // `vista` sólo puede ser uno de los cuatro `id` de AGRUPACIONES (o el
  // default 'empresas'), así que el `.find()` siempre encuentra: a diferencia
  // de cuando existía `documentos`, ya no hay una vista sin grupo.
  const group = AGRUPACIONES.find(v => v.id === vista)!.group
  const [q, setQ] = useState('')
  const [newCarrierOpen, setNewCarrierOpen] = useState(false)
  const [planillaOpen, setPlanillaOpen] = useState(false)
  const qc = useQueryClient()
  const puedeEditar = usePermiso('directory.edit')
  const qDebounced = useDebouncedValue(q, 300)

  const [catalogoAbierto, setCatalogoAbierto] = useState(false)
  const estaSaliendo = !!redireccion

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

  function cambiarVista(v: Vista) {
    // La vista viaja en la URL: volver del detalle no pierde dónde estabas.
    router.replace(v === 'empresas' ? '/dashboard/compliance' : `/dashboard/compliance?vista=${v}`)
  }

  async function handleCarrierCreated(created: CarrierCreateResult) {
    setNewCarrierOpen(false)
    await invalidateDirectory(qc, { entity: 'carrier', id: created.id, type: 'create' })
    // Cuarto y ultimo punto de fuga al Empresas legacy, y ronda de arreglo 1
    // de la Task 5: cuando la vista Empresas abria el cajon en la misma
    // pantalla, aterrizar en `?abierta=<id>` bastaba. Ahora que la fila
    // navega a la ficha (Task 4) en vez de abrir el cajon, quedarse en la
    // lista con ese parametro no abria nada: la empresa recien creada
    // probablemente ni figura en el embudo, que solo lista las que tienen
    // pendientes. El punto de "no salir del modulo" nunca fue solo eso — era
    // quedar donde se puede seguir trabajando, y eso es la ficha, cargandole
    // los documentos que todavia no tiene.
    router.push(`${carrierHref(created.id)}?tab=documentos`)
  }

  const rows = statusQuery.data?.rows ?? []

  // El efecto de arriba ya disparó el reemplazo: nada que dibujar acá.
  if (estaSaliendo) return null

  return (
    <PageContainer>
      {/* La acción principal a la derecha del título, como "Subir documentos" en
          Por asignar (kit de la Entrega 2 de fichas). Actúan sobre empresas, no
          sobre la agrupación: se ven en las dos. */}
      <EncabezadoDePagina
        titulo="Certificación"
        bajada="Qué le falta a cada empresa para estar en condiciones de operar, y qué documentos llegaron todavía sin asignar."
      >
        <button
          type="button"
          onClick={() => setPlanillaOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main"
        >
          <FileSpreadsheet size={14} aria-hidden="true" />
          Actualizar por planilla
        </button>
        <button
          type="button"
          onClick={() => setNewCarrierOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90"
        >
          <Plus size={14} aria-hidden="true" /> Nueva empresa
        </button>
      </EncabezadoDePagina>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-etiqueta text-informativo">Agrupar por</span>
        <SegmentedControl label="Agrupar por" options={AGRUPACIONES.map(({ id, label }) => ({ id, label }))}
                          value={vista} onChange={cambiarVista} />
        {/* Llevan al Directorio: fuera del control, porque no agrupan aquí; el
            ícono dice que se sale del módulo. */}
        {AL_DIRECTORIO.map(d => (
          <Link key={d.vistaVieja} href={d.href}
                className="inline-flex items-center gap-1 text-etiqueta font-semibold text-informativo hover:text-text-primary">
            {d.label} <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        ))}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={group === 'carrier' ? 'Buscar empresa…' : 'Buscar documento…'}
          aria-label="Buscar"
          className={INPUT + ' w-64'}
        />
      </div>

      <NewCarrierPanel
        open={newCarrierOpen}
        onClose={() => setNewCarrierOpen(false)}
        onCreated={handleCarrierCreated}
      />

      <ActualizarPorPlanillaModal
        open={planillaOpen}
        onClose={() => setPlanillaOpen(false)}
        onAplicado={() => { void invalidarCertificacion(qc) }}
        puedeEditar={puedeEditar}
      />

      {group === 'carrier' && <DirectorioResumen />}

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
              <span className="text-etiqueta text-informativo">
                · {statusQuery.data?.total_unclassified} por asignar
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
              <CertificationStatusTable rows={rows} />
            )}
          </div>
        )}
      </div>

    </PageContainer>
  )
}
