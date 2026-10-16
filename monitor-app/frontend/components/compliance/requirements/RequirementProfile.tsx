'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Ban, Building2, CircleCheck, CircleDashed, Pencil, ShieldCheck, Truck, UserRound } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import { ApiError } from '@/lib/api/client'
import { GLOBAL_ALERT_THRESHOLD } from '@/lib/api/config'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { REQUIREMENTS, pendingDocumentHref } from '@/lib/navegacion/compliance'
import { returnLink } from '@/lib/navegacion/directory'
import { lifecycleStyle } from '@/lib/states'
import { resumenDeAviso, resumenDeVigencia, vigenciaDe, type Vigencia } from '@/lib/vigencia'
import { formatCount } from '@/lib/clients'
import type { RequirementDetail, VersionDeRegla } from '@/lib/types'
import { Estado } from '@/components/ui/Estado'
import type { ActionsMenuItem } from '@/components/ui/ActionsMenu'
import { ProfileHeader } from '@/components/directory/ProfileHeader'
import { ProfileBreadcrumb } from '@/components/directory/ProfileBreadcrumb'
import { AsidePanel, ProfileLayout } from '@/components/directory/ProfileLayout'
import { DetailsBlock } from '@/components/directory/DetailsBlock'
import { thresholdSource } from '@/app/dashboard/admin/settings/settings-sources'
import { MarcaDeRevision, useRevisiones } from '@/app/dashboard/admin/settings/revision'
import { CondicionPanel, type RequirementSection } from './CondicionPanel'
import { CeldaAlias } from './CeldaAlias'
import { celdaSeExigeA, nivelDe } from './frase-de-la-regla'
import { OPCIONES_DE_EXIGIBILIDAD } from './SelectorExigibilidad'
import { useRequirementVocabulary } from './useRequirementVocabulary'

const ENTIDAD: Record<RequirementDetail['target_entity'], string> = {
  CARRIER: 'Empresa', DRIVER: 'Conductor', ASSET: 'Equipo',
}
const ICONO_DE_ENTIDAD = { CARRIER: Building2, DRIVER: UserRound, ASSET: Truck } as const
const PLURAL: Record<RequirementDetail['target_entity'], string> = {
  CARRIER: 'empresas', DRIVER: 'conductores', ASSET: 'equipos',
}
const FECHA = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const umbralGeneral = thresholdSource(GLOBAL_ALERT_THRESHOLD)

/**
 * La ficha de un documento exigido (Configuración, Parte 2): las preguntas que
 * definen el documento, cada una con su respuesta en una frase y su "Editar",
 * que abre el mismo `CondicionPanel` enfocado en esa pregunta. Es la única
 * forma de cambiar una regla: el borrador en lote se retiró (16/10).
 */
export function RequirementProfile({ id }: { id: string }) {
  const searchParams = useSearchParams()
  const canEdit = usePermiso('certification.configure')
  const [section, setSection] = useState<RequirementSection | null>(null)
  const back = returnLink(searchParams.get('next'))

  const doc = useQuery({ queryKey: ['compliance-requirements', 'detail', id], queryFn: () => requirementsApi.get(id), retry: false })
  const revisiones = useRevisiones('certification', 'conditions')
  const catalogo = useRequirementVocabulary()
  const { subtipos, gestiones, vocabulario } = catalogo
  const general = useQuery({ queryKey: umbralGeneral.queryKey, queryFn: umbralGeneral.list })

  if (doc.isError || catalogo.isError) {
    const notFound = doc.error instanceof ApiError && doc.error.status === 404
    return (
      <div className="p-4 md:p-6">
        {notFound
          ? <Estado tipo="vacio" titulo="Este documento no existe">
              <Link href={REQUIREMENTS} className="text-dato font-medium text-accion hover:underline">Volver a Documentos exigidos</Link>
            </Estado>
          : <Estado tipo="error" titulo="No se pudo cargar el documento" />}
      </div>
    )
  }
  if (doc.isPending || catalogo.isPending) return <Estado tipo="cargando" />

  const r = doc.data
  const vigencia = vigenciaDe(r)
  const celda = celdaSeExigeA(r, vocabulario)
  const aviso = resumenDeAviso(vigencia)
  const avisoGeneral = general.data?.[0]?.warning_days
  const noCumplen = r.exigidos !== undefined && r.cumplen !== undefined ? r.exigidos - r.cumplen : undefined
  const editar = (s: RequirementSection) => (canEdit
    ? <button type="button" onClick={() => setSection(s)} className="text-dato font-medium text-accion hover:underline">Editar</button>
    : undefined)
  const menuItems: ActionsMenuItem[] = canEdit ? [
    { id: 'name', label: 'Cambiar nombre', icon: Pencil, onSelect: () => setSection('nombre') },
    r.is_active
      ? { id: 'deactivate', label: 'Quitar vigencia', icon: Ban, destructive: true, onSelect: () => setSection('vigencia') }
      : { id: 'activate', label: 'Poner en vigencia', icon: CircleCheck, onSelect: () => setSection('vigencia') },
  ] : []

  return (
    <div className="space-y-4 p-4 md:p-6">
      <ProfileBreadcrumb module="Certificación" list={{ href: REQUIREMENTS, label: 'Documentos exigidos' }} title={r.name} back={back} />
      <ProfileHeader
        title={r.name}
        chips={[
          { label: ENTIDAD[r.target_entity], tone: 'neutral', icon: ICONO_DE_ENTIDAD[r.target_entity] },
          { label: nivelDe(r.requirement_level), tone: 'neutral',
            icon: r.requirement_level === 'LEGAL_MANDATORY' ? ShieldCheck : CircleDashed },
          lifecycleStyle('requirement', r.is_active ? 'ACTIVE' : 'INACTIVE'),
        ]}
        menuItems={menuItems}
      />

      <ProfileLayout aside={<>
        <DetailsBlock canEdit={false} rows={[
          { label: 'Código', value: r.requirement_code },
          { label: 'Para', value: ENTIDAD[r.target_entity] },
          { label: 'Revisión', value: <MarcaDeRevision revision={revisiones.revisionDe(r.id)} /> },
        ]} />
        <AsidePanel title="Se reconoce como">
          <CeldaAlias requisito={r} puedeEditar={canEdit} />
        </AsidePanel>
        <AsidePanel title="Quiénes no cumplen">
          {noCumplen === undefined ? <p className="text-dato text-informativo">—</p> : (
            <Link href={pendingDocumentHref(r.requirement_code)} prefetch={false}
              className="inline-flex items-center gap-1 text-dato font-medium text-accion hover:underline">
              {formatCount(noCumplen)} no cumplen · ver en Pendientes <ArrowRight size={13} aria-hidden />
            </Link>
          )}
        </AsidePanel>
      </>}>
        <div className="space-y-3">
          <AsidePanel title="¿A quién se le exige?" action={editar('quien')}>
            <p className="text-dato text-text-primary">{celda.regla}</p>
            <p className="text-etiqueta text-informativo tabular-nums">{celda.alcance}</p>
          </AsidePanel>
          <AsidePanel title="¿Cuándo vence?" action={editar('vence')}>
            <p className="text-dato text-text-primary">{resumenDeVigencia(vigencia)}</p>
            <RuleHistory rules={r.reglas} politica={r.expiration_policy} />
          </AsidePanel>
          <AsidePanel title="¿Cuándo se exige?" action={editar('cuando')}>
            <p className="text-dato text-text-primary">
              {OPCIONES_DE_EXIGIBILIDAD.find(o => o.valor === r.exigible_on)?.corto ?? '—'}
            </p>
          </AsidePanel>
          <AsidePanel title="¿Con cuánta anticipación se avisa?" action={aviso ? editar('vence') : undefined}>
            <p className="text-dato text-text-primary">
              {aviso === null ? 'No vence: no hay aviso.'
                : aviso !== 'General' ? aviso
                : avisoGeneral === undefined ? 'La alerta general'
                : `La alerta general: ${avisoGeneral} días`}
            </p>
          </AsidePanel>
          <AsidePanel title="¿Qué cambia si edito la regla?">
            <p className="text-dato text-informativo">
              Antes de guardar se muestra a cuántos {PLURAL[r.target_entity]} les cambia el estado, y aplicar la
              regla pide confirmar cuántos registros se agregan o dejan de exigirse.
            </p>
          </AsidePanel>
        </div>
      </ProfileLayout>

      {section && (
        <CondicionPanel
          section={section}
          requisito={r}
          subtipos={subtipos}
          gestiones={gestiones}
          revision={revisiones.revisionDe(r.id)}
          onConfirmar={() => revisiones.confirmar.mutate(r.id)}
          confirmando={revisiones.confirmar.isPending}
          onGuardado={revisiones.invalidar}
          onCerrar={() => setSection(null)}
        />
      )}
    </div>
  )
}

/** "Historial: N cambios de regla", desplegable: cada versión de la regla base
 *  con desde cuándo rige. La original es "desde siempre". */
function RuleHistory({ rules, politica }: { rules: VersionDeRegla[]; politica: Vigencia['politica'] }) {
  const [open, setOpen] = useState(false)
  if (rules.length < 2) return null
  const cambios = rules.length - 1
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="text-etiqueta font-medium text-accion hover:underline">
        Historial: {cambios} {cambios === 1 ? 'cambio de regla' : 'cambios de regla'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 text-etiqueta text-informativo">
          {rules.map(v => (
            <li key={v.vigente_desde ?? 'siempre'}>
              {v.vigente_desde ? `Desde el ${FECHA.format(new Date(v.vigente_desde))}` : 'Desde siempre'}: {resumenDeVigencia({ ...v, politica })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
