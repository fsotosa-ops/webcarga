'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { REQUIREMENTS, requirementHref } from '@/lib/navegacion/compliance'
import { resumenDeAviso, resumenDeVigencia, vigenciaDe } from '@/lib/vigencia'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import type { RequirementOption } from '@/lib/types'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { NuevoDocumentoPanel } from '@/components/compliance/requirements/NuevoDocumentoPanel'
import { celdaSeExigeA, nivelDe } from '@/components/compliance/requirements/frase-de-la-regla'
import {
  ENTITY_FILTERS, STATE_FILTERS, isEntityFilter, isStateFilter, matchesSearch, matchesState,
  type EntityFilter, type StateFilter,
} from '@/components/compliance/requirements/requirementFilters'
import { useRequirementVocabulary } from '@/components/compliance/requirements/useRequirementVocabulary'
import { MarcaDeRevision, useRevisiones } from '@/app/dashboard/admin/settings/revision'
import { formatCount } from '@/lib/clients'
import { PageContainer } from '@/components/ui/PageContainer'
import { inputClass } from '@/components/ui/Field'

/** Certificación › Documentos exigidos (Configuración, Parte 2): el catálogo de
 *  trabajo de Certificación. La lista filtra y cuenta; cada documento se lee y
 *  se edita en su ficha, una pregunta por panel. Los documentos son pocos: la
 *  lista llega entera y se cuenta aquí, así la cifra de cada filtro es la de lo
 *  que se ve. */
function RequirementsList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const canEdit = usePermiso('certification.configure')
  const [creando, setCreando] = useState(false)
  const entidad: EntityFilter = isEntityFilter(searchParams.get('entity')) ? searchParams.get('entity') as EntityFilter : 'todos'
  const estado: StateFilter = isStateFilter(searchParams.get('state')) ? searchParams.get('state') as StateFilter : 'todos'
  const q = searchParams.get('q') ?? ''
  const returnTo = searchParams.toString() ? `${REQUIREMENTS}?${searchParams.toString()}` : REQUIREMENTS

  const lista = useQuery({ queryKey: clavesCertificacion.requisitos(), queryFn: () => complianceApi.listRequirements() })
  const revisiones = useRevisiones('certification', 'conditions')
  const catalogo = useRequirementVocabulary()
  const { vocabulario } = catalogo

  // La búsqueda va antes que los filtros, y cada control cuenta sobre lo que
  // dejan los demás: un número que promete filas que otro filtro ya descartó
  // lleva a "ningún documento".
  // Un enlace viejo de Configuración trae el documento por código (`?doc=`):
  // abre su ficha; si el código no existe, queda la lista sin el parámetro.
  const doc = searchParams.get('doc')
  useEffect(() => {
    if (!doc || !lista.data) return
    const elegido = lista.data.find(r => r.requirement_code === doc)
    if (elegido) { router.replace(requirementHref(elegido.id)); return }
    const params = new URLSearchParams(searchParams.toString())
    params.delete('doc')
    const s = params.toString()
    router.replace(s ? `${REQUIREMENTS}?${s}` : REQUIREMENTS, { scroll: false })
  }, [doc, lista.data, router, searchParams])

  const buscados = useMemo(() => (lista.data ?? []).filter(r => matchesSearch(r, q)), [lista.data, q])
  const listo = lista.data !== undefined && !revisiones.cargando && !revisiones.error && !catalogo.isPending
  const contar = (f: (r: RequirementOption) => boolean) => (listo ? formatCount(buscados.filter(f).length) : undefined)
  const deEntidad = (r: RequirementOption) => entidad === 'todos' || r.target_entity === entidad
  const filas = buscados.filter(r => deEntidad(r) && matchesState(r, estado, revisiones.sinRevisar))

  function cambiar(next: { entity?: EntityFilter; state?: StateFilter; q?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    const poner = (clave: string, valor: string | undefined, porDefecto: string) => {
      if (valor === undefined) return
      if (!valor || valor === porDefecto) params.delete(clave); else params.set(clave, valor)
    }
    poner('entity', next.entity, 'todos')
    poner('state', next.state, 'todos')
    poner('q', next.q, '')
    const s = params.toString()
    router.replace(s ? `${REQUIREMENTS}?${s}` : REQUIREMENTS, { scroll: false })
  }

  return (
    <PageContainer>
      <EncabezadoDePagina
        titulo="Documentos exigidos"
        bajada={lista.data ? `${formatCount(lista.data.length)} documentos: a quién se le exige cada uno, cuándo vence y quiénes cumplen.`
          : 'A quién se le exige cada documento, cuándo vence y quiénes cumplen.'}
      >
        {canEdit && (
          <button type="button" onClick={() => setCreando(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white hover:bg-accent/90">
            <Plus size={14} aria-hidden /> Nuevo documento
          </button>
        )}
      </EncabezadoDePagina>

      {creando && <NuevoDocumentoPanel onCerrar={() => setCreando(false)} />}

      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo pointer-events-none" aria-hidden />
          <input value={q} onChange={e => cambiar({ q: e.target.value })} placeholder="Documento o código…" aria-label="Buscar documento"
            className={`${inputClass({ size: 'sm' })} pl-8 w-64 max-w-full`} />
        </div>
        <SegmentedControl
          label="Entidad"
          options={ENTITY_FILTERS.map(f => ({
            id: f.id, label: f.label,
            badge: contar(r => (f.id === 'todos' || r.target_entity === f.id) && matchesState(r, estado, revisiones.sinRevisar)),
          }))}
          value={entidad}
          onChange={id => cambiar({ entity: id })}
        />
        <SegmentedControl
          label="Estado"
          options={STATE_FILTERS.map(f => ({
            id: f.id, label: f.label,
            badge: contar(r => deEntidad(r) && matchesState(r, f.id, revisiones.sinRevisar)),
          }))}
          value={estado}
          onChange={id => cambiar({ state: id })}
        />
      </div>

      {lista.isError || catalogo.isError || revisiones.error ? (
        <Estado tipo="error" titulo="No se pudieron cargar los documentos" />
      ) : !listo ? (
        <Estado tipo="cargando" />
      ) : lista.data.length === 0 ? (
        <Estado tipo="vacio" titulo="Todavía no hay documentos exigidos" detalle="Se crean con Nuevo documento." />
      ) : filas.length === 0 ? (
        <Estado tipo="vacio" titulo={q ? `Ningún documento coincide con «${q}»` : 'Ningún documento en este filtro'} />
      ) : (
        <>
        {/* En el teléfono, una tarjeta por documento (como Clientes). */}
        <ul aria-label="Documentos exigidos" className="md:hidden space-y-2">
          {filas.map(r => (
            <li key={r.id}>
              <Link href={requirementHref(r.id, returnTo)} prefetch={false}
                className="block rounded-2xl border border-border bg-white px-3.5 py-3 hover:bg-bg-main">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">{r.name}</span>
                  <StatusChip tone="neutral">{nivelDe(r.requirement_level)}</StatusChip>
                </span>
                <span className="mt-1 block text-etiqueta text-informativo">
                  {celdaSeExigeA(r, vocabulario).regla} · {resumenDeVigencia(vigenciaDe(r))}
                  {r.cumplen !== undefined && r.exigidos !== undefined
                    && ` · cumplen ${formatCount(r.cumplen)} de ${formatCount(r.exigidos)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden md:block bg-white rounded-2xl border border-border overflow-x-auto">
          <table className="w-full text-dato">
            <thead>
              <tr className="border-b border-border bg-bg-main">
                <th scope="col" className={CABECERA}>Documento</th>
                <th scope="col" className={CABECERA}>Se exige a</th>
                <th scope="col" className={`${CABECERA} hidden md:table-cell`}>Vence</th>
                <th scope="col" className={`${CABECERA} hidden md:table-cell`}>Aviso</th>
                <th scope="col" className={`${CABECERA} text-right`}>Cumplen</th>
                <th scope="col" className={`${CABECERA} hidden md:table-cell`}>Revisión</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(r => {
                const href = requirementHref(r.id, returnTo)
                const vigencia = vigenciaDe(r)
                const celda = celdaSeExigeA(r, vocabulario)
                return (
                  // La fila entera abre la ficha; el nombre es el enlace.
                  <tr key={r.id} onClick={() => router.push(href)}
                    className="border-b border-border/60 last:border-0 cursor-pointer transition-colors hover:bg-bg-main">
                    <td className="px-3 py-2.5">
                      <Link href={href} prefetch={false} onClick={e => e.stopPropagation()}
                        className="font-semibold text-text-primary hover:text-accent">{r.name}</Link>
                      <div className="text-etiqueta text-informativo truncate max-w-[16rem]">{r.requirement_code}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span className={r.is_active ? 'text-text-primary' : 'text-informativo'}>{celda.regla}</span>
                        <StatusChip tone="neutral">{nivelDe(r.requirement_level)}</StatusChip>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell">{resumenDeVigencia(vigencia)}</td>
                    <td className="px-3 py-2.5 hidden md:table-cell text-informativo">{resumenDeAviso(vigencia) ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.cumplen === undefined || r.exigidos === undefined
                        ? '—' : `${formatCount(r.cumplen)} de ${formatCount(r.exigidos)}`}
                    </td>
                    <td className="px-3 py-2.5 hidden md:table-cell"><MarcaDeRevision revision={revisiones.revisionDe(r.id)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </PageContainer>
  )
}

export default function RequirementsPage() {
  return <Suspense fallback={<Estado tipo="cargando" />}><RequirementsList /></Suspense>
}
