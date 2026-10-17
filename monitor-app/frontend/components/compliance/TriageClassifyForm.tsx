'use client'

import { EntityCell } from '@/components/dashboard/EntityCell'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { datoQuePide, datosDelDocumento } from '@/lib/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { Estado } from '@/components/ui/Estado'
import { PendingSkeleton } from './pending/PendingStates'
import { PendingSlotPicker, type Slot } from './PendingSlotPicker'
import type { PendingComplianceRow } from '@/lib/types'
import { CarrierSearchPicker, type CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'
import { clavesCertificacion } from '@/lib/queries/certificacion'

const ETIQUETA_DEL_DATO = {
  vencimiento: 'Fecha de vencimiento',
  emision:     'Fecha de emisión',
  periodo:     'Período que cubre',
} as const

type Subject = { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }


interface Props {
  targetIds: string[]
  subjects:  Subject[]
  onApplied: (appliedIds: string[], errores?: { item_id: string; error: string }[]) => void
  /** Empresa de la selección — se muestra en el encabezado para que quede
   *  claro sobre quién se está actuando cuando hay varios marcados. */
  carrierLabel?: string | null
  /** Con él, la empresa del encabezado lleva a su vista rápida (N2, Entrega 1 de fichas). */
  carrierId?: string | null
  /** Lo que le falta a esa empresa. Es el dato que responde "¿qué tengo
   *  pendiente acá?" sin salir de la pantalla, y el atajo para clasificar. */
  pendingRows?: PendingComplianceRow[]
  /** El estado de la consulta de pendientes de la empresa (H4): "sin pendientes"
   *  se dice solo con el dato en mano. */
  pendingState?: 'loading' | 'error' | 'ready'
  onRetryPending?: () => void
  /** Lo que el reconocedor propuso para el archivo (Entrega D): si es un casillero
   *  pendiente, llega ya elegido; si solo se sabe el titular, llega elegido él. */
  suggestion?: { entity_type?: string | null; entity_id?: string | null; requirement_id?: string | null } | null
  /** Sin empresa, se pregunta aquí, en el detalle del archivo: es donde se decide. */
  onPickCarrier?: (c: CarrierSearchResult) => void
  /** El tercer verbo de la bandeja: Asignar · Cambiar · Descartar. */
  onDiscard?: () => void
}

/** Panel derecho: a quién pertenece y qué es.
 *
 *  El mismo formulario sirve para uno o para quince — la selección múltiple no
 *  necesita una pantalla propia. */
export function TriageClassifyForm({
  targetIds, subjects, onApplied, carrierLabel, carrierId = null, pendingRows = [], pendingState = 'ready', onRetryPending,
  suggestion, onPickCarrier, onDiscard,
}: Props) {
  const [subjectKey, setSubjectKey] = useState('')
  const [requirementId, setRequirementId] = useState('')
  const [expiration, setExpiration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [manual, setManual] = useState(false)
  const [busquedaEmpresa, setBusquedaEmpresa] = useState('')

  // La propuesta ya elegida, cuando llegan los pendientes de su empresa. Una vez: lo
  // que la persona cambie después no se pisa (quien aloja el formulario lo vuelve a
  // montar al cambiar de archivo).
  const [propuestaAplicada, setPropuestaAplicada] = useState(false)
  useEffect(() => {
    if (propuestaAplicada || !suggestion?.entity_id) return
    const casillero = pendingRows.find(r => r.entity_id === suggestion.entity_id
      && (!suggestion.requirement_id || r.requirement_id === suggestion.requirement_id))
    if (casillero && suggestion.requirement_id) {
      setSlot({
        entity_type: casillero.entity_type as Slot['entity_type'], entity_id: casillero.entity_id,
        subject_label: casillero.subject_name ?? casillero.carrier_name ?? 'Sin empresa', requirement_id: casillero.requirement_id,
        record_id: casillero.id, document_name: casillero.document_name,
      })
      setSubjectKey(`${casillero.entity_type}:${casillero.entity_id}`)
      setPropuestaAplicada(true)
    } else if (subjects.some(x => x.entity_id === suggestion.entity_id)) {
      setManual(true)
      setSubjectKey(`${suggestion.entity_type}:${suggestion.entity_id}`)
      setPropuestaAplicada(true)
    }
  }, [suggestion, pendingRows, subjects, propuestaAplicada])


  const subject = useMemo(
    () => subjects.find(s => `${s.entity_type}:${s.entity_id}` === subjectKey) ?? null,
    [subjects, subjectKey],
  )

  const requirementsQuery = useQuery({
    queryKey: clavesCertificacion.requisitos(subject?.entity_type),
    queryFn: () => complianceApi.listRequirements(subject!.entity_type),
    enabled: !!subject,
  })

  const requirements = requirementsQuery.data ?? []

  function pickSlot(s: Slot) {
    setSlot(s)
    setError(null)
    setExpiration('')
    setSubjectKey(`${s.entity_type}:${s.entity_id}`)
    setRequirementId('')
  }
  const requisitoElegido = requirementId || slot?.requirement_id || ''
  const selected = requirements.find(r => r.id === requisitoElegido) ?? null
  // Lo que pide el tipo (HU-C1, entrega 2b): vencimiento, emisión o período,
  // con la misma regla que la carga directa y que el backend.
  const pide = selected ? datoQuePide(selected.expiration_policy) : null
  const needsDate = !!pide?.obligatorio
  const loteInvalido = targetIds.length > 1
  const canApply = targetIds.length > 0 && !loteInvalido && !!subject && !!requisitoElegido
    && (!needsDate || !!expiration) && !saving

  async function apply() {
    if (!subject || loteInvalido) return
    setSaving(true)
    setError(null)
    try {
      const res = await documentIngestApi.classifyBatch({
        item_ids: targetIds,
        entity_type: subject.entity_type,
        entity_id: subject.entity_id,
        requirement_id: requisitoElegido,
        ...(pide ? datosDelDocumento(pide.dato, expiration) : {}),
      })
      setRequirementId('')
      setExpiration('')
      setSlot(null)
      // Los errores por ítem viajan hacia arriba: descartarlos hacía que la
      // pantalla dijera "10 clasificados" cuando se habían marcado 12.
      if (res.errors.length) {
        setError(`${res.errors.length === 1 ? '1 documento no se pudo clasificar' : `${res.errors.length} documentos no se pudieron clasificar`}: `
          + Array.from(new Set(res.errors.map(x => x.error))).join(' · '))
      }
      onApplied(res.applied, res.errors)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo clasificar')
    } finally {
      setSaving(false)
    }
  }

  // El vacio es una instruccion, no un cartel de "no hay nada".
  if (!targetIds.length) {
    return (
      <div className="px-3 py-6 text-center">
        <p className="text-dato font-medium text-informativo">
          Selecciona uno o más documentos de la lista
        </p>
        <p className="text-etiqueta text-informativo mt-1.5 leading-relaxed">
          Clasificar es de a un archivo: cada uno va a un requisito distinto.
          Marcar varios sirve para moverlos o descartarlos en lote.
        </p>
      </div>
    )
  }

  const SELECT = 'w-full mt-1 text-dato border border-border rounded-lg px-2 py-1.5 bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all disabled:bg-bg-main disabled:text-informativo'

  return (
    // Enter asigna, como en una bandeja de triage (Gmail, Linear): el gesto más
    // frecuente con una tecla. No dentro de un buscador, donde Enter es elegir.
    <div className="space-y-2.5" onKeyDown={e => {
      if (e.key === 'Enter' && canApply && !(e.target as HTMLElement).closest('[role="combobox"], input[type="search"]')) {
        e.preventDefault(); void apply()
      }
    }}>
      <p className="text-etiqueta text-informativo">
        <span className="font-semibold text-text-primary tabular-nums">
          {targetIds.length === 1 ? '1 documento' : `${targetIds.length} documentos`}
        </span>
        {carrierLabel && <span> · <EntityCell kind="carrier" id={carrierId} label={carrierLabel} /></span>}
      </p>

      {/* Con varios marcados NO se muestra el formulario, y por eso no hay nada
          que advertir. Antes se mostraba entero y deshabilitado, con un cartel
          que explicaba la restriccion en vocabulario del modelo — "sujeto",
          "tipo de documento", "requisito" —, que es justo lo que la regla del
          proyecto prohibe: nombrar por el trabajo, no por el modelo de datos.
          Una pantalla no advierte sobre algo que no ofrece. */}
      {loteInvalido ? (
        <p className="text-etiqueta text-informativo leading-relaxed">
          En lote puedes moverlos a una empresa o descartarlos, con la barra de
          selección. Para decir qué documento es cada uno, deja marcado uno solo.
        </p>
      ) : (
      <>

      {/* Lo que le falta a la empresa, que es la pregunta real: clasificar es
          cubrir un hueco concreto, no describir el archivo en abstracto. */}
      {!manual && pendingRows.length > 0 && (
        <>
          <PendingSlotPicker rows={pendingRows} selected={slot} onPick={pickSlot} />
          <button
            type="button"
            onClick={() => { setManual(true); setSlot(null) }}
            className="text-etiqueta text-informativo hover:text-accent underline cursor-pointer"
          >
            No está en la lista
          </button>
        </>
      )}

      {(manual || !pendingRows.length) && (
        <>
          {/* "¿A quién pertenece?" SÓLO cuando hay a quién ofrecer.
              Sin empresa, sus opciones salen de los requisitos pendientes de
              una empresa que no existe: el desplegable queda con "— Seleccionar
              —" y nada más, o sea un control que no se puede usar. Mostrarlo
              igual, y encima ARRIBA del buscador de empresa, dejaba tres
              superficies para una sola pregunta —este select muerto, el
              buscador de acá abajo y el del lote— y la primera que se ve es la
              que no funciona.
              Sin empresa hay UNA pregunta contestable, y es la de más abajo. */}
          {!!subjects.length && (
          <label className="block">
            <span className="text-etiqueta font-semibold text-text-primary">¿A quién pertenece?</span>
            <select
              aria-label="¿A quién pertenece?"
              value={subjectKey}
              onChange={e => { setSubjectKey(e.target.value); setRequirementId(''); setExpiration('') }}
              className={SELECT}
            >
              <option value="">— Seleccionar —</option>
              {subjects.map(s => (
                <option key={`${s.entity_type}:${s.entity_id}`} value={`${s.entity_type}:${s.entity_id}`}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          )}

          {/* SIN EMPRESA no se pregunta acá. El control de empresa vive
              arriba, uno solo, y es el mismo para la tanda y para un archivo
              suelto — ver `useEmpresaDeTrabajo`. Acá vivió un segundo buscador
              durante unas horas y fue exactamente el problema: dos cajas para
              el mismo gesto, y la primera que se veía era la que no servía.

              Las dos causas de la lista vacía siguen siendo distintas y hay
              que seguir distinguiéndolas. */}
          {!subjects.length && (
            pendingState === 'loading' ? (
              <PendingSkeleton rows={2} label="Cargando lo que le falta a la empresa" />
            ) : pendingState === 'error' ? (
              <Estado tipo="error" titulo="No se pudo cargar lo que le falta a la empresa">
                <button type="button" onClick={onRetryPending}
                        className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
                  Reintentar
                </button>
              </Estado>
            ) : (
              carrierLabel ? (
                <p className="text-etiqueta text-informativo bg-accent/5 border border-border rounded-lg px-2 py-1.5">
                  Esta empresa no tiene requisitos pendientes que se puedan asignar. Suele pasar cuando la empresa no está activa.
                </p>
              ) : onPickCarrier ? (
                <label className="block">
                  <span className="text-etiqueta font-semibold text-text-primary">Este documento todavía no tiene empresa. ¿De qué empresa es?</span>
                  <div className="mt-1">
                    <CarrierSearchPicker query={busquedaEmpresa} onQueryChange={setBusquedaEmpresa} onPick={onPickCarrier}
                                         size="sm" showMinCharsHint placeholder="Buscar empresa…" />
                  </div>
                </label>
              ) : (
                <p className="text-etiqueta text-informativo bg-accent/5 border border-border rounded-lg px-2 py-1.5">
                  Este documento todavía no tiene empresa.
                </p>
              )
            )
          )}

          {subject && (
            <label className="block">
              <span className="text-etiqueta font-semibold text-text-primary">¿Qué documento es?</span>
              <select
                aria-label="¿Qué documento es?"
                value={requirementId}
                onChange={e => { setRequirementId(e.target.value); setExpiration('') }}
                disabled={requirementsQuery.isPending}
                className={SELECT}
              >
                <option value="">— Seleccionar —</option>
                {requirements.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}

          {manual && pendingRows.length > 0 && (
            <button
              type="button"
              onClick={() => { setManual(false); setRequirementId('') }}
              className="text-etiqueta text-informativo hover:text-accent underline cursor-pointer"
            >
              Volver a los pendientes
            </button>
          )}
        </>
      )}

      {pide && (
        <label className="block">
          <span className="text-etiqueta font-semibold text-text-primary">{ETIQUETA_DEL_DATO[pide.dato]}</span>
          <input
            type={pide.dato === 'periodo' ? 'month' : 'date'}
            aria-label={ETIQUETA_DEL_DATO[pide.dato]}
            value={expiration}
            onChange={e => setExpiration(e.target.value)}
            className={SELECT}
          />
        </label>
      )}

      {error && <p className="text-etiqueta text-status-incidente">{error}</p>}

      </>
      )}

      {!loteInvalido && (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className="flex-1 flex items-center justify-center gap-2 text-dato font-semibold px-4 py-2 rounded-lg transition-colors bg-accent text-white hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:bg-bg-main disabled:text-informativo disabled:cursor-not-allowed"
        >
          {saving && <Loader2 size={14} className="motion-safe:animate-spin" />}
          Asignar
        </button>
        {onDiscard && (
          <button type="button" onClick={onDiscard} disabled={saving}
                  className="text-dato font-semibold px-3 py-2 rounded-lg border border-border bg-white text-text-primary hover:bg-bg-main disabled:opacity-50">
            Descartar
          </button>
        )}
      </div>
      )}
    </div>
  )
}
