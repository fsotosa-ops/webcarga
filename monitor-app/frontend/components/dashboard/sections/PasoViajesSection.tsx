'use client'

import { useState } from 'react'
import { Estado } from '@/components/ui/Estado'
import { Cifra } from '@/components/ui/Cifra'
import { TmsChip } from '@/components/dashboard/TripTable'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import type { CierreViajesResponse, GrupoDelCierre, TripsMeta, UnassignedReasonMeta, ViajeDelCierre } from '@/lib/types'

interface Props {
  grupos:    CierreViajesResponse['grupos'] | undefined
  bloquean:  number | undefined
  cargando?: boolean
  /** Motivos de NO ASIGNACIÓN de viaje: sólo id y etiqueta. El grupo de un
   *  motivo de conductor no aplica acá. */
  motivos:   Pick<UnassignedReasonMeta, 'id' | 'label'>[]
  onCerrar:  (tripIds: string[], motivoId: string) => void | Promise<void>
  /** Quita el motivo y devuelve el viaje a su grupo (HU-D3). */
  onDeshacer?: (tripIds: string[]) => void | Promise<void>
  /** Para los colores del TMS, los mismos del Monitor. */
  meta?:      TripsMeta | null
  /** Día firmado: nada se deshace (el backend también lo rechaza). */
  soloLectura?: boolean
}

const ORDEN_GRUPOS: GrupoDelCierre[] = ['hoy', 'rezago', 'oferta_sin_declarar', 'en_curso', 'abandonado', 'con_motivo']

// Sólo hoy/rezago bloquean el cierre — son los que se pueden resolver acá.
// en_curso/abandonado se muestran para que no desaparezcan de la vista (Regla
// 5 de Pablo: "si no me cerraron el viaje no me lo van a pagar"), pero no
// llevan casilla: en_curso porque todavía puede reportar, abandonado porque
// ya está fuera del alcance de "hoy" — se resuelve, no se cierra en lote acá.
const GRUPO_INFO: Record<GrupoDelCierre, { titulo: string; bajada: string; seleccionable: boolean; vacio: string }> = {
  hoy: {
    titulo: 'Hoy', bajada: 'Planificados para hoy, todavía sin resolver.',
    seleccionable: true, vacio: 'Ya se resolvieron los planificados de hoy.',
  },
  rezago: {
    titulo: 'Rezago', bajada: 'De días anteriores, todavía sin resolver.',
    seleccionable: true, vacio: 'No queda rezago sin resolver.',
  },
  en_curso: {
    titulo: 'En curso', bajada: 'Viajes en curso ahora mismo — puede que reporten antes del cierre.',
    seleccionable: false, vacio: 'Nada en curso ahora mismo.',
  },
  abandonado: {
    titulo: 'Abandonados por el TMS', bajada: 'Sin novedad hace semanas — igual hay que cerrarlos.',
    seleccionable: false, vacio: 'Nada abandonado por el TMS.',
  },
  // HU-D3 (minuta 02/10): poner el motivo sacaba el viaje de los cuatro
  // grupos y no aparecía en ninguna parte — "no sé dónde queda". Acá se ve, y
  // se deshace si fue un error.
  // Ofertas que el TMS retiró porque WebCarga no las tomó (Publicada de
  // Sodimac, 07/10). Se declaran con motivo —el "acusete" de Pablo— pero no
  // bloquean la firma: ya no hay carga que responder.
  oferta_sin_declarar: {
    titulo: 'Ofertas sin declarar', bajada: 'El TMS las retiró porque no se tomaron. Declara el motivo.',
    seleccionable: true, vacio: 'No hay ofertas retiradas sin declarar.',
  },
  con_motivo: {
    titulo: 'Con motivo', bajada: 'Declarados como no asignados por WebCarga. Se pueden deshacer.',
    seleccionable: false, vacio: 'Todavía no se declaró ningún viaje.',
  },
}

/** Fecha de planificación corta, como la lee el coordinador: 02/10. */
function formatFecha(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** Cuenta desde el último reporte del TMS, no desde la planificación — ver
 *  el docstring de `ViajeDelCierre` en lib/types.ts. */
function formatDiasSinNovedad(dias: number): string {
  return `${dias.toFixed(1).replace('.', ',')} días sin novedad`
}

/** Paso "Viajes" del Cierre del Día (Tarea 6) — cuarta pestaña del Centro de
 *  Cierre. Muestra los grupos que devuelve `GET /trips/cierre-viajes`, más
 *  "Con motivo" (HU-D3), donde lo declarado se ve y se deshace,
 *  y deja declarar en lote, con motivo obligatorio, por qué WebCarga no tomó
 *  una carga (hoy/rezago). en_curso/abandonado son de sólo lectura: se
 *  listan para que no desaparezcan de la vista, no bloquean el cierre.
 *
 *  Puramente presentacional — el fetch de `cierreViajes`/`motivos` y la
 *  llamada a `bulkClose` viven en la página que la aloja, igual que
 *  `unassignedReasons` ya llega como prop a `FlotaDelDiaSection`.
 *
 *  Sin encabezado propio (Importante 5, revisión de rama 2026-08-18): esta
 *  sección vive DENTRO de una pestaña de `ClosuresCenterPageInner`, que ya
 *  tiene su propio encabezado de nivel 1 ("Centro de Cierre del Día"). Sus
 *  tres pestañas hermanas (`FlotaDelDiaSection`, `PreCierrePendingSection`,
 *  `StatusReportSection`) tampoco llevan uno — se mantiene consistente. */
export function PasoViajesSection({
  grupos, bloquean, cargando = false, motivos, onCerrar, onDeshacer, meta, soloLectura = false,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [motivoId, setMotivoId] = useState('')
  // El motivo elegido en una fila, todavía sin guardar (HU-D3): elegir no
  // cierra el viaje; "Guardar" sí. Antes el cambio del desplegable lo cerraba
  // al instante y el viaje desaparecía.
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [guardandoFila, setGuardandoFila] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toggleSelected(tripId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId)
      return next
    })
  }

  // Es un camino de escritura: si `onCerrar` (bulk-close) revienta, el
  // usuario no puede creer que cerró N viajes cuando no cerró ninguno. La
  // selección y el motivo elegido NO se limpian en el catch — vuelve a
  // intentar sin tener que re-elegir todo de nuevo.
  async function handleCerrar() {
    if (selected.size === 0 || !motivoId) return
    setGuardando(true)
    setError(null)
    try {
      await onCerrar(Array.from(selected), motivoId)
      setSelected(new Set())
      setMotivoId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cerrar los viajes seleccionados.')
    } finally {
      setGuardando(false)
    }
  }

  // Una fila sola se cierra con el MISMO escritor que el lote, con un solo
  // elemento. No hay endpoint nuevo ni semantica nueva: declarar un viaje es
  // un unico acto, y tenerlo escrito dos veces es como empiezan a decir cosas
  // distintas.
  async function handleCerrarFila(tripId: string) {
    const motivo = borrador[tripId]
    if (!motivo) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onCerrar([tripId], motivo)
      setBorrador(prev => {
        const { [tripId]: _, ...resto } = prev
        return resto
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el viaje.')
    } finally {
      setGuardandoFila(null)
    }
  }

  async function handleDeshacer(tripId: string) {
    if (!onDeshacer) return
    setGuardandoFila(tripId)
    setError(null)
    try {
      await onDeshacer([tripId])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo deshacer.')
    } finally {
      setGuardandoFila(null)
    }
  }

  if (cargando || !grupos) {
    return <Estado tipo="cargando" />
  }

  const n = selected.size

  return (
    <div className="space-y-4">
      <Cifra
        valor={bloquean}
        etiqueta="viajes por resolver antes de cerrar"
        tono={bloquean && bloquean > 0 ? 'atencion' : 'resuelto'}
      />

      {n > 0 && (
        // Pegada al TECHO del area de scroll, no al pie. `position: sticky` no
        // puede salirse de la caja de su padre, y como ultimo hijo de una
        // seccion de 3.500 px la barra solo se "pegaba" cuando ya estabas
        // abajo del todo — medido en el navegador: con la pagina arriba
        // quedaba 2.751 px por debajo de lo visible, o sea no servia para
        // nada. Arriba el padre la sostiene durante todo el recorrido.
        //
        // Ojo: esto NO lo puede verificar un test de jsdom, que no tiene
        // layout. Afirmar la clase CSS no es afirmar que se ve.
        <div className="sticky top-0 z-20 flex items-center gap-2 bg-white border border-accent/20 shadow-sm rounded-lg px-3 py-2">
          <span className="text-etiqueta font-semibold text-text-primary">{n} seleccionado{n === 1 ? '' : 's'}</span>
          <select
            aria-label="Motivo"
            value={motivoId}
            onChange={e => setMotivoId(e.target.value)}
            className="text-etiqueta border border-border rounded-lg px-2 py-1 bg-white"
          >
            <option value="">— Elige un motivo —</option>
            {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!motivoId || guardando}
            onClick={handleCerrar}
            className="text-etiqueta font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
          >
            {guardando ? 'Cerrando…' : `No asignado por WebCarga · ${n} viaje${n === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {ORDEN_GRUPOS.map(grupo => {
        const info = GRUPO_INFO[grupo]
        const viajes = grupos[grupo]
        return (
          <div key={grupo} className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
              <div>
                <p className="text-xs font-bold text-text-primary">{info.titulo}</p>
                <p className={`text-etiqueta ${TEXTO_APOYO}`}>{info.bajada}</p>
              </div>
              <span className="text-xs font-semibold text-text-primary tabular-nums">{viajes.length}</span>
            </div>

            {viajes.length === 0 ? (
              <Estado tipo="vacio" titulo={info.vacio} />
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className={`bg-bg-main text-etiqueta font-bold uppercase tracking-wide ${TEXTO_APOYO}`}>
                    {info.seleccionable && <th className="text-left px-3 py-2 w-8" />}
                    {/* Las mismas columnas que el Monitor (HU-D2, minuta 02/10):
                        con el número solo, el coordinador lo copiaba y salía a
                        buscarlo. Sin filas desplegables: "lo más simple
                        posible". */}
                    <th className="text-left px-3 py-2">TMS · Cliente</th>
                    <th className="text-left px-3 py-2">Nº viaje</th>
                    <th className="text-left px-3 py-2">Fecha</th>
                    <th className="text-left px-3 py-2">Patente</th>
                    <th className="text-left px-3 py-2">Conductor</th>
                    <th className="text-left px-3 py-2">Empresa</th>
                    <th className="text-left px-3 py-2">Origen · Destinos</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Tiempo</th>
                    {/* El motivo, por fila. Antes solo se podia elegir en la
                        barra de lote del pie, despues de las CUATRO tablas:
                        para declarar una fila que se ve arriba habia que
                        recorrer toda la pagina y volver. */}
                    <th className="text-left px-3 py-2">Motivo de no asignación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {viajes.map((v: ViajeDelCierre) => (
                    <tr key={v.trip_id}>
                      {info.seleccionable && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar viaje ${v.source_system_trip_id ?? v.trip_id}`}
                            checked={selected.has(v.trip_id)}
                            onChange={() => toggleSelected(v.trip_id)}
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <TmsChip tms={v.source_system ?? ''} meta={meta} sourceTripId={v.source_system_trip_id} />
                        <span className={`block mt-1 text-etiqueta ${TEXTO_APOYO}`}>{v.client_name ?? '—'}</span>
                      </td>
                      <td className={`px-3 py-2 font-identificador ${TEXTO_CUERPO}`}>{v.source_system_trip_id ?? '—'}</td>
                      <td className={`px-3 py-2 tabular-nums ${TEXTO_CUERPO}`}>{formatFecha(v.planning_date)}</td>
                      <td className="px-3 py-2 font-identificador font-semibold text-text-primary">{v.tractor_plate ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.driver_name ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.carrier_name ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>
                        <span className="font-medium text-text-primary">{v.origin ?? '—'}</span>
                        {v.destinations.length > 0 && (
                          <span className={`block text-etiqueta ${TEXTO_APOYO}`}>{v.destinations.join(' · ')}</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.trip_status ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{formatDiasSinNovedad(v.dias_sin_novedad)}</td>
                      <td className="px-3 py-2">
                        {info.seleccionable ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Motivo del viaje ${v.source_system_trip_id ?? v.trip_id}`}
                              value={borrador[v.trip_id] ?? ''}
                              disabled={guardandoFila === v.trip_id}
                              onChange={e => setBorrador(prev => ({ ...prev, [v.trip_id]: e.target.value }))}
                              className="text-etiqueta border border-border rounded-lg px-2 py-1 bg-white"
                            >
                              <option value="">— Elige un motivo —</option>
                              {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                            <button
                              type="button"
                              disabled={!borrador[v.trip_id] || guardandoFila === v.trip_id}
                              onClick={() => handleCerrarFila(v.trip_id)}
                              className="text-etiqueta font-semibold bg-accent text-white rounded-lg px-2.5 py-1 disabled:opacity-50"
                            >
                              {guardandoFila === v.trip_id ? 'Guardando…' : 'Guardar'}
                            </button>
                          </div>
                        ) : grupo === 'con_motivo' ? (
                          <div className="flex items-center gap-1.5">
                            <span className={TEXTO_CUERPO}>{v.unassigned_reason_label ?? '—'}</span>
                            {onDeshacer && !soloLectura && (
                              <button
                                type="button"
                                aria-label={`Deshacer el motivo del viaje ${v.source_system_trip_id ?? v.trip_id}`}
                                disabled={guardandoFila === v.trip_id}
                                onClick={() => handleDeshacer(v.trip_id)}
                                className="text-etiqueta font-semibold border border-border rounded-lg px-2.5 py-1 bg-white text-text-primary hover:bg-bg-main disabled:opacity-50"
                              >
                                {guardandoFila === v.trip_id ? 'Deshaciendo…' : 'Deshacer'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className={TEXTO_APOYO}>{v.unassigned_reason_label ?? '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {error && <Estado tipo="error" titulo={error} />}
    </div>
  )
}
