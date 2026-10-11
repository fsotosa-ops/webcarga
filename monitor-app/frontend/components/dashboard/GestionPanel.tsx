'use client'

import { useState, useEffect, useId, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2, Check, RotateCcw, ShieldAlert, Search,
  FileWarning, AlertTriangle, PanelRightOpen,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { taxonomiesApi } from '@/lib/api/config'
import { fmtDT, fmtDate } from '@/lib/utils/datetime'
import { IndicatorSwitches } from './IndicatorSwitches'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { InsuranceAlertBadge } from '@/components/ui/InsuranceAlertBadge'
import { PendingDocsBadge } from '@/components/ui/PendingDocsBadge'
import { Section } from '@/components/ui/Section'
import { KeyValueList } from '@/components/ui/KeyValueList'

const NOTICE_TONE = {
  urgent:  'border-status-incidente/20 bg-status-incidente/5 text-status-incidente',
  warning: 'border-warning/25 bg-warning/10 text-warning',
} as const

/** Un aviso dentro del panel: algo que el operador tiene que mirar antes de
 *  seguir (póliza vencida, conductor de otra empresa, dato del TMS distinto). */
function Notice({ tone, icon, children }: { tone: keyof typeof NOTICE_TONE; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-etiqueta font-medium ${NOTICE_TONE[tone]}`}>
      {icon}
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  )
}

interface Props {
  trip:    Trip
  meta?:   TripsMeta | null
  onSaved: (updated: Trip) => void
}

export function GestionPanel({ trip, meta, onSaved }: Props) {
  // EL MOTIVO DE UN VIAJE ES DEL CATALOGO DEL VIAJE.
  //
  // Hasta el 2026-09-07 este select ofrecia `meta.unassigned_reasons`, que es
  // el catalogo de CONDUCTORES (`DRIVER_REASON`: "Vacaciones", "Panne",
  // "Licencia vencida"), y escribia el id elegido en
  // `app.trips.unassigned_reason_id` — un campo que significa "por que WebCarga
  // no tomo este viaje". El propio backend ya lo tenia anotado como un campo
  // con dos escritores y dos catalogos; bulk-close validaba el dominio desde
  // agosto y este camino no.
  //
  // Los doce motivos correctos ya existen en `TRIP_UNASSIGNED_REASON` ("Sin
  // equipo disponible", "Mandante elimina viaje", "Flete falso"...) y son los
  // mismos que usa la pestana Viajes del Cierre: ahora las dos superficies
  // dicen lo mismo del mismo viaje.
  const motivosDeViaje = useQuery({
    queryKey: ['taxonomies', 'TRIP_UNASSIGNED_REASON'],
    queryFn: () => taxonomiesApi.list('TRIP_UNASSIGNED_REASON'),
    staleTime: 5 * 60_000,
  })

  const [collapsed, setCollapsed]               = useState(false)
  const [estadoDraft, setEstadoDraft]           = useState('')
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [reasonSaving, setReasonSaving]         = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)

  const headingId = useId()

  const fuzzyMatchQuery = useQuery({
    queryKey: ['drivers', 'fuzzy-match', trip.id, trip.driver_name_tms],
    queryFn: () => driversApi.fuzzyMatch(trip.driver_name_tms!),
    enabled: !trip.carrier_id && !!trip.driver_name_tms,
  })

  // Mismo criterio que TripSlideOver.tsx: resetear drafts cuando cambia el
  // viaje, no en cada render.
  useEffect(() => {
    setEstadoDraft('')
    setErr(null)
    setShowEstadoSelect(false)
    setUnlinkErr(null)
    setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    setFleetErr(null)
  }, [trip.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // `collapsed` también resetea a expandido en cada viaje nuevo — decisión
  // explícita (brainstorming 2026-07-29): "expandido por defecto con botón
  // para colapsar", sin persistencia entre viajes (sin localStorage).
  useEffect(() => { setCollapsed(false) }, [trip.id])

  async function handleSetOverride() {
    if (!estadoDraft) return
    setSaving(true)
    setErr(null)
    try {
      const updated = await tripsApi.patch(trip.id, { manual_status: estadoDraft } as TripPatch)
      onSaved(updated)
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearOverride() {
    setClearingOverride(true)
    try {
      await tripsApi.resetField(trip.id, 'manual_status')
      onSaved({ ...trip, manual_status: null })
      setEstadoDraft('')
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir')
    } finally {
      setClearingOverride(false)
    }
  }

  async function handleUnlink() {
    setUnlinking(true); setUnlinkErr(null)
    try {
      await tripsApi.removeFleetLink(trip.id)
      onSaved({ ...trip, carrier_id: null, fleet_link_id: null })
      setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    } catch (e) {
      setUnlinkErr(e instanceof Error ? e.message : 'Error al desvincular')
    } finally {
      setUnlinking(false)
    }
  }

  async function handleAssignFleet() {
    if (!fleetDraft.carrier_id) return
    setAssigningFleet(true); setFleetErr(null)
    try {
      const updated = await tripsApi.assignFleetLink(trip.id, {
        carrier_id:       fleetDraft.carrier_id,
        driver_id:        fleetDraft.driver_id ?? undefined,
        tractor_asset_id: fleetDraft.tractor_asset_id ?? undefined,
        driver_name:      fleetDraft.driver_name ?? undefined,
        tractor_plate:    fleetDraft.tractor_plate ?? undefined,
      })
      onSaved(updated)
      setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    } catch (e) {
      setFleetErr(e instanceof Error ? e.message : 'Error al vincular')
    } finally {
      setAssigningFleet(false)
    }
  }

  const driverDiverges  = !!(trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name)
  const tractorDiverges = !!(trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate)
  const carrierDiverges = !!(trip.carrier_name_tms && trip.carrier_name_tms !== trip.carrier_name)
  const hasReconciliationDivergence = !!trip.fleet_link_id && (driverDiverges || tractorDiverges || carrierDiverges)

  const empresasHandoffHref = (() => {
    const params = new URLSearchParams({ create: '1' })
    if (trip.carrier_name_tms)  params.set('business_name', trip.carrier_name_tms)
    if (trip.driver_name_tms)   params.set('driver_name', trip.driver_name_tms)
    const plateTms = trip.tractor_plate_tms ?? trip.tractor_plate
    if (plateTms) params.set('tractor_plate', plateTms)
    return `/dashboard/carriers?${params.toString()}`
  })()

  return (
    <aside
      className={`order-1 md:order-2 shrink-0 md:overflow-y-auto md:border-l border-border bg-white transition-[width] duration-200 ease-out ${collapsed ? 'md:w-[56px]' : 'md:w-[360px]'}`}
    >
      {collapsed ? (
        <div className="flex justify-center pt-3">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Mostrar Gestión"
            title="Mostrar Gestión"
            className="grid h-8 w-8 place-items-center rounded-md border border-border text-informativo transition-colors hover:text-accion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <PanelRightOpen size={16} aria-hidden />
          </button>
        </div>
      ) : (
      <div className="px-4 md:px-5">
        {/* Estado operativo */}
        <section aria-labelledby={headingId} className="py-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 id={headingId} className="text-dato font-semibold text-informativo">Gestión</h3>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Ocultar Gestión"
              className="ml-auto rounded text-dato font-semibold text-accion hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Ocultar
            </button>
          </div>
          <KeyValueList items={[{ label: 'TMS reporta', value: <StatusBadge status={trip.current_status} meta={meta} /> }]} />

          <div className="mt-2">
          {trip.manual_status ? (
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const opState = meta?.operational_states.find(s => s.id === trip.manual_status)
                const label = opState?.label ?? trip.manual_status
                return opState ? (
                  <span
                    className="inline-flex px-2 py-0.5 rounded-full text-etiqueta font-semibold"
                    style={{ backgroundColor: opState.bg_color, color: opState.text_color }}
                  >
                    {label}
                  </span>
                ) : (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-etiqueta font-semibold bg-informativo/10 text-informativo">
                    {label}
                  </span>
                )
              })()}
              <span className="text-etiqueta text-informativo">
                confirmado manualmente {trip.edited_by ? `por ${trip.edited_by} ` : ''}el {fmtDT(trip.edited_at)}
              </span>
              <button
                type="button"
                title="Revertir a valor del TMS"
                aria-label="Revertir a valor del TMS"
                onClick={handleClearOverride}
                disabled={clearingOverride}
                className="text-informativo hover:text-accion transition-colors disabled:opacity-50"
              >
                {clearingOverride ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </button>
            </div>
          ) : showEstadoSelect ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                autoFocus
                value={estadoDraft}
                onChange={e => setEstadoDraft(e.target.value)}
                aria-label="Estado operativo manual"
                className="text-dato border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">— Seleccionar estado…</option>
                {(meta?.operational_states ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <button type="button" onClick={handleSetOverride} disabled={saving || !estadoDraft}
                aria-label="Guardar estado operativo"
                className="p-1.5 text-accion disabled:opacity-40">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button type="button" onClick={() => { setShowEstadoSelect(false); setEstadoDraft('') }}
                className="text-etiqueta text-informativo hover:text-text-primary">
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowEstadoSelect(true)}
                className="text-dato font-semibold text-accion hover:underline"
              >
                + Establecer estado operativo manual
              </button>
              <p className="text-etiqueta text-informativo mt-1">
                Es el mismo estado que se muestra en el encabezado — aquí puedes confirmarlo manualmente si hace falta.
              </p>
            </>
          )}
          </div>

          {err && (
            <p role="alert" className="mt-2 rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">{err}</p>
          )}
        </section>

        <Section title="Indicadores">
          <IndicatorSwitches trip={trip} onSaved={onSaved} />
        </Section>

        {!trip.is_assigned && (motivosDeViaje.data?.length ?? 0) > 0 && (
          <Section title="Motivo de no asignación">
            <select
              value={trip.unassigned_reason_id ?? ''}
              disabled={reasonSaving}
              aria-label="Motivo de no asignación"
              onChange={async e => {
                const value = e.target.value
                setReasonSaving(true)
                try {
                  const updated = await tripsApi.patch(trip.id, { unassigned_reason_id: value } as TripPatch)
                  onSaved(updated)
                } catch {
                  // best-effort — el select vuelve al valor real del trip en el próximo render
                } finally {
                  setReasonSaving(false)
                }
              }}
              className="w-full text-dato border border-border rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="">— Sin especificar —</option>
              {(motivosDeViaje.data ?? []).map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </Section>
        )}

        {/* Conductor y flota — driver-first */}
        <Section title="Conductor y flota">
          {trip.carrier_id ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-border bg-white px-3 py-2.5">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <p className="text-dato font-semibold text-text-primary truncate">{trip.carrier_name ?? '—'}</p>
                  <InsuranceAlertBadge alert={trip.insurance_alert} />
                  <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} label="Empresa" />
                  <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} label="Conductor" />
                  <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} label="Tracto" />
                </div>
                <button
                  type="button"
                  disabled={unlinking}
                  onClick={handleUnlink}
                  className="ml-2 shrink-0 text-etiqueta font-semibold text-informativo transition-colors hover:text-status-incidente disabled:opacity-50"
                >
                  {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                </button>
              </div>
              {unlinkErr && <p role="alert" className="text-dato text-status-incidente">{unlinkErr}</p>}
              {(trip.insurance_alert === 'EXPIRED' || trip.insurance_alert === 'OVERDUE_INSTALLMENTS') && (
                <Notice tone="urgent" icon={<ShieldAlert size={13} className="mt-px shrink-0" aria-hidden />}>
                  <p>
                    {trip.insurance_alert === 'EXPIRED' ? 'Póliza vencida para esta empresa — ' : 'Cuotas críticas impagas para esta empresa — '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=seguros`} className="font-semibold underline">
                      revisar en Seguros
                    </a>.
                  </p>
                </Notice>
              )}
              {trip.driver_pending_docs_critical && (
                <Notice tone="urgent" icon={<FileWarning size={13} className="mt-px shrink-0" aria-hidden />}>
                  <p>
                    Falta Licencia de Conducir o Carnet del conductor —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="font-semibold underline">
                      revisar en Empresas
                    </a>.
                  </p>
                </Notice>
              )}
              {trip.fleet_match_status === 'MISMATCH' && (
                <Notice tone="warning">
                  <p>
                    El conductor pertenece a <span className="font-semibold">{trip.fleet_match_driver_home_carrier}</span>, distinta de la empresa de este viaje —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="font-semibold underline">
                      revisar en Empresas
                    </a>.
                  </p>
                </Notice>
              )}
              {hasReconciliationDivergence && (
                <Notice tone="warning">
                  {carrierDiverges && (
                    <p>TMS reporta empresa: <span className="font-semibold">{trip.carrier_name_tms}</span></p>
                  )}
                  {driverDiverges && (
                    <p>TMS reporta conductor: <span className="font-semibold">{trip.driver_name_tms}</span></p>
                  )}
                  {tractorDiverges && (
                    <p>TMS reporta patente: <span className="font-semibold">{trip.tractor_plate_tms}</span></p>
                  )}
                  <button
                    type="button"
                    disabled={unlinking}
                    onClick={handleUnlink}
                    className="font-semibold underline disabled:opacity-50"
                  >
                    {unlinking ? 'Revirtiendo…' : 'Usar dato del TMS'}
                  </button>
                </Notice>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {trip.fleet_match_status === 'UNMATCHED' && (
                <Notice tone="warning" icon={<AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />}>
                  <p>Sin identificar: no cruza con ninguna empresa todavía.</p>
                </Notice>
              )}
              {trip.driver_name_tms && (
                <p className="text-etiqueta text-informativo">
                  TMS reportó: <span className="font-semibold text-text-primary">{trip.driver_name_tms}</span>
                </p>
              )}
              <FleetAssignSection
                value={fleetDraft}
                onChange={setFleetDraft}
                size="sm"
                suggested={fuzzyMatchQuery.data ?? []}
                suggestedLabel="Posibles coincidencias (nombre TMS)"
                notFoundHint={
                  <div className="mt-2">
                    <Notice tone="warning">
                      <p>
                        Si no aparece en la lista, hay que darlo de alta primero en{' '}
                        <a href={empresasHandoffHref} className="font-semibold underline">Empresas</a>.
                      </p>
                    </Notice>
                  </div>
                }
              />
              {trip.driver_name_tms && !fuzzyMatchQuery.isLoading && (fuzzyMatchQuery.data?.length ?? 0) === 0 && (
                <a
                  href={empresasHandoffHref}
                  className="flex items-center gap-1.5 text-etiqueta font-semibold text-accion hover:underline"
                >
                  <Search size={12} aria-hidden /> Sin coincidencias: dar de alta empresa, conductor o equipo
                </a>
              )}
              {fleetDraft.driver_id && (
                <button
                  type="button"
                  disabled={assigningFleet || !fleetDraft.carrier_id}
                  onClick={handleAssignFleet}
                  className="w-full text-dato font-semibold bg-accent text-white rounded-md py-1.5 hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {assigningFleet ? <Loader2 size={12} className="animate-spin" /> : 'Vincular'}
                </button>
              )}
              {fleetErr && <p role="alert" className="text-etiqueta text-status-incidente">{fleetErr}</p>}
            </div>
          )}
        </Section>

        <Section title="Ubicación de origen">
          {trip.origin_operation_type ? (
            <OperationTypeBadge operationType={trip.origin_operation_type} meta={meta} size="md" />
          ) : (
            <span className="text-dato text-informativo">Sin clasificar</span>
          )}
        </Section>

        <Section title="Datos operativos">
          <KeyValueList items={[
            { label: 'Planificación', value: <span className="font-identificador tabular-nums">{fmtDate(trip.planning_date)}</span> },
            { label: 'Tipo de carga', value: trip.cargo_type ?? <span className="text-informativo">Sin dato</span> },
            ...(trip.milestone_status ? [{ label: 'Cumplimiento', value: trip.milestone_status }] : []),
          ]} />
        </Section>
      </div>
      )}
    </aside>
  )
}
