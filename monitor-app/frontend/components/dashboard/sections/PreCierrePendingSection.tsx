'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { dailyClosuresApi } from '@/lib/api/dailyClosures'
import { carriersApi } from '@/lib/api/carriers'
import { NewCarrierPanel } from '../NewCarrierPanel'
import { FleetDriverGapCard } from '../FleetDriverGapCard'
import { AltaConductorDesdeCierre } from './AltaConductorDesdeCierre'
import type { CarrierCreateResult } from '@/lib/api/carriers'

interface Props {
  fecha: string
}

/** Sección "Pendientes" del Centro de Cierre (Tarea 12, plan 1.3) — HU-02,
 *  primera UI real del pre-cierre (corre desde HU-02/Fase 3, pero sin
 *  pantalla propia hasta esta tarea). Consume `pre_cierre` del payload de
 *  GET /daily-closures (mismo query key ['daily-closure', fecha] que ya
 *  usa FlotaDelDiaSection en esta misma página — React Query cachea, no
 *  duplica el fetch). Equipment_closures.py devuelve el mismo
 *  pre_cierre (misma corrida de run_pre_cierre) — no hace falta leerlo dos
 *  veces. */
export function PreCierrePendingSection({ fecha }: Props) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['daily-closure', fecha],
    queryFn: () => dailyClosuresApi.get(fecha),
  })

  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const [activating, setActivating] = useState<string | null>(null)
  const [activateError, setActivateError] = useState<Record<string, string>>({})
  const [taxIdDraft, setTaxIdDraft] = useState<Record<string, string>>({})

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
  }

  async function handleActivate(carrierId: string) {
    setActivating(carrierId)
    setActivateError(prev => ({ ...prev, [carrierId]: '' }))
    try {
      await carriersApi.patch(carrierId, { operational_status: 'ACTIVE' })
      await invalidate()
    } catch (e) {
      // El 422 de "falta RUT" puede venir en 2 formas distintas según el
      // endpoint que lo dispare (ver AGENTLOG) — en vez de parsear la forma
      // exacta, siempre ofrecemos completar el RUT ahí mismo, que es la
      // única causa realista de un 422 en esta acción.
      setActivateError(prev => ({
        ...prev,
        [carrierId]: e instanceof Error ? e.message : 'No se pudo activar la empresa',
      }))
    } finally {
      setActivating(null)
    }
  }

  async function handleSaveTaxId(carrierId: string) {
    const taxId = taxIdDraft[carrierId]?.trim()
    if (!taxId) return
    setActivating(carrierId)
    try {
      await carriersApi.patch(carrierId, { tax_id: taxId, operational_status: 'ACTIVE' })
      await invalidate()
    } catch (e) {
      setActivateError(prev => ({
        ...prev,
        [carrierId]: e instanceof Error ? e.message : 'No se pudo activar la empresa',
      }))
    } finally {
      setActivating(null)
    }
  }

  if (!data) return null

  const { auto_resolved, escalations } = data.pre_cierre
  const hasEscalations = Object.values(escalations).some(list => list.length > 0)

  return (
    <div className="space-y-4">
      {auto_resolved.length > 0 && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            <p className="text-xs font-bold text-text-primary">
              {auto_resolved.length} resuelta{auto_resolved.length > 1 ? 's' : ''} automáticamente
            </p>
          </div>
          <div className="divide-y divide-border/60">
            {auto_resolved.map((r, i) => (
              <p key={i} className="text-[11px] text-gray-500 px-4 py-2.5">{r.message}</p>
            ))}
          </div>
        </div>
      )}

      {hasEscalations && (
        <div className="space-y-3">
          <p className="text-xs font-bold text-text-primary flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-500" /> Requieren tu atención
          </p>

          {escalations.PATENTE_NO_REGISTRADA.map(esc => (
            <div key={esc.tractor_plate} className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 space-y-2">
              <p className="text-xs text-red-700">
                Patente no registrada: <span className="font-semibold">{esc.tractor_plate}</span> — {esc.reason}. ¿A qué empresa pertenece?
              </p>
              {creatingFor === esc.tractor_plate ? (
                <NewCarrierPanel
                  open
                  onClose={() => setCreatingFor(null)}
                  onCreated={(carrier: CarrierCreateResult) => {
                    setCreatingFor(null)
                    void invalidate()
                    // La empresa queda creada; asignarle esta patente requiere
                    // que el activo exista en public.assets (a veces no,
                    // ver "reason" arriba) — se completa desde la ficha.
                    window.open(`/dashboard/carriers/${carrier.id}?tab=equipos`, '_blank')
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingFor(esc.tractor_plate)}
                  className="text-[11px] font-semibold text-accent hover:underline"
                >
                  Crear empresa nueva
                </button>
              )}
            </div>
          ))}

          {escalations.EMPRESA_ONBOARDING.map(esc => (
            <div key={esc.carrier_id} className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 space-y-2">
              <p className="text-xs text-amber-800">
                <span className="font-semibold">{esc.carrier_name}</span> está en onboarding. ¿Activarla para incluirla en el cierre?
              </p>
              {activateError[esc.carrier_id] && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-red-600">{activateError[esc.carrier_id]}</p>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={taxIdDraft[esc.carrier_id] ?? ''}
                      onChange={e => setTaxIdDraft(prev => ({ ...prev, [esc.carrier_id]: e.target.value }))}
                      placeholder="RUT / Tax ID"
                      aria-label={`RUT de ${esc.carrier_name}`}
                      className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
                    />
                    <button
                      type="button"
                      disabled={activating === esc.carrier_id || !taxIdDraft[esc.carrier_id]?.trim()}
                      onClick={() => handleSaveTaxId(esc.carrier_id)}
                      className="text-[11px] font-semibold bg-accent text-white rounded-lg px-2 py-1 disabled:opacity-50"
                    >
                      Guardar RUT y activar
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={activating === esc.carrier_id}
                onClick={() => handleActivate(esc.carrier_id)}
                className="text-[11px] font-semibold text-amber-700 hover:underline disabled:opacity-50"
              >
                Activar empresa
              </button>
            </div>
          ))}

          {escalations.SIN_TIPO_OPERACION.map(esc => (
            <div key={esc.carrier_id} className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-800">
                <span className="font-semibold">{esc.carrier_name}</span> — falta tipo de operación. El equipo no puede clasificarse en el cierre.
              </p>
              <a
                href={`/dashboard/carriers/${esc.carrier_id}?tab=equipos`}
                target="_blank"
                className="text-[11px] font-semibold text-accent hover:underline"
              >
                Ir a la ficha de la empresa
              </a>
            </div>
          ))}

          {escalations.EMPRESA_NO_RECONOCIDA.map((esc, i) => (
            <div key={i} className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-800">
                Patente <span className="font-semibold">{esc.tractor_plate}</span>: el TMS reporta &quot;{esc.tms_carrier_name}&quot;, el directorio tiene &quot;{esc.directory_carrier_name}&quot; — sin match único.
              </p>
              {/* Derecho a la ficha de la empresa que el directorio tiene para
                  esa patente, pestaña Equipos: es donde se corrige. Mandar al
                  índice pelado deja a la persona buscando a mano lo que la
                  pantalla ya sabe — y el buscador de empresas ni siquiera
                  busca por patente. */}
              <a href={`/dashboard/carriers/${esc.directory_carrier_id}?tab=equipos`} target="_blank"
                 className="text-[11px] font-semibold text-accent hover:underline">
                Revisar {esc.tractor_plate} en {esc.directory_carrier_name}
              </a>
            </div>
          ))}

          {/* Esta escalación BLOQUEA el cierre y era la única bloqueante sin
              acción propia: sólo tenía un enlace a otro módulo, y encima a uno
              que estaba fuera del menú. Es, textual, el "círculo bloqueante"
              de la minuta del 25/08. Ahora el alta se hace acá.

              Cuando el RUT ni siquiera es un RUT (`reason`), no hay a quién dar
              de alta: eso se reclama aguas arriba, al TMS. */}
          {escalations.CONDUCTOR_NO_REGISTRADO.map(esc => (
            <div key={esc.driver_rut} className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-xs text-amber-800">
                {esc.reason
                  ? <>El TMS informó un RUT que no es válido: <span className="font-semibold">{esc.driver_rut}</span>. Hay que corregirlo en el TMS.</>
                  : <>Conductor no registrado: RUT <span className="font-semibold">{esc.driver_rut}</span>
                      {esc.driver_name_tms ? <> — el TMS lo llama &quot;{esc.driver_name_tms}&quot;</> : null}.</>}
              </p>
              {!esc.reason && (
                <AltaConductorDesdeCierre
                  rut={esc.driver_rut}
                  nombreTms={esc.driver_name_tms ?? null}
                  onListo={invalidate}
                />
              )}
            </div>
          ))}

          {/* Este pie decía "Puedes avanzar al cierre aunque queden pendientes
              sin resolver" y era FALSO desde el 2026-08-23: `close_day`
              devuelve 409 con `_ESCALACIONES_QUE_BLOQUEAN`, que son cuatro de
              las cinco de acá arriba. Falta de tipo de operación es la única
              que no bloquea, y por eso se nombra aparte: un aviso que promete
              lo contrario de lo que hace la API enseña a no leer los avisos. */}
          <p className="text-[11px] text-informativo flex items-start gap-1">
            <Info size={11} className="mt-0.5 shrink-0" />
            <span>
              Estos pendientes bloquean el cierre del día, salvo la falta de tipo
              de operación. Resuélvelos aquí, o pide a un administrador que fuerce
              el cierre dejando una nota.
            </span>
          </p>
        </div>
      )}

      <FleetDriverGapCard />
    </div>
  )
}
