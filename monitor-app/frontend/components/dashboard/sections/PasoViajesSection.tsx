'use client'

import { useState } from 'react'
import { Estado } from '@/components/ui/Estado'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { Cifra } from '@/components/ui/Cifra'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import type { CierreViajesResponse, GrupoDelCierre, UnassignedReasonMeta, ViajeDelCierre } from '@/lib/types'

interface Props {
  grupos:    CierreViajesResponse['grupos'] | undefined
  bloquean:  number | undefined
  cargando?: boolean
  motivos:   UnassignedReasonMeta[]
  onCerrar:  (tripIds: string[], motivoId: string) => void | Promise<void>
}

const ORDEN_GRUPOS: GrupoDelCierre[] = ['hoy', 'rezago', 'en_curso', 'abandonado']

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
}

/** Cuenta desde el último reporte del TMS, no desde la planificación — ver
 *  el docstring de `ViajeDelCierre` en lib/types.ts. */
function formatDiasSinNovedad(dias: number): string {
  return `${dias.toFixed(1).replace('.', ',')} días sin novedad`
}

/** Paso "Viajes" del Cierre del Día (Tarea 6) — cuarta pestaña del Centro de
 *  Cierre. Muestra los cuatro grupos que devuelve `GET /trips/cierre-viajes`
 *  y deja declarar en lote, con motivo obligatorio, por qué WebCarga no tomó
 *  una carga (hoy/rezago). en_curso/abandonado son de sólo lectura: se
 *  listan para que no desaparezcan de la vista, no bloquean el cierre.
 *
 *  Puramente presentacional — el fetch de `cierreViajes`/`motivos` y la
 *  llamada a `bulkClose` viven en la página que la aloja, igual que
 *  `unassignedReasons` ya llega como prop a `FlotaDelDiaSection`. */
export function PasoViajesSection({ grupos, bloquean, cargando = false, motivos, onCerrar }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [motivoId, setMotivoId] = useState('')
  const [guardando, setGuardando] = useState(false)

  function toggleSelected(tripId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId)
      return next
    })
  }

  async function handleCerrar() {
    if (selected.size === 0 || !motivoId) return
    setGuardando(true)
    try {
      await onCerrar(Array.from(selected), motivoId)
      setSelected(new Set())
      setMotivoId('')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando || !grupos) {
    return <Estado tipo="cargando" />
  }

  const n = selected.size

  return (
    <div className="space-y-4">
      <EncabezadoDePagina
        titulo="Viajes"
        bajada="Viajes que hay que resolver antes de cerrar el día — dí por qué WebCarga no tomó la carga."
      />

      <Cifra
        valor={bloquean}
        etiqueta="viajes por resolver antes de cerrar"
        tono={bloquean && bloquean > 0 ? 'atencion' : 'resuelto'}
      />

      {ORDEN_GRUPOS.map(grupo => {
        const info = GRUPO_INFO[grupo]
        const viajes = grupos[grupo]
        return (
          <div key={grupo} className="bg-white rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
              <div>
                <p className="text-xs font-bold text-text-primary">{info.titulo}</p>
                <p className={`text-[11px] ${TEXTO_APOYO}`}>{info.bajada}</p>
              </div>
              <span className="text-xs font-semibold text-text-primary tabular-nums">{viajes.length}</span>
            </div>

            {viajes.length === 0 ? (
              <Estado tipo="vacio" titulo={info.vacio} />
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className={`bg-gray-50 text-[10px] font-bold uppercase tracking-wide ${TEXTO_APOYO}`}>
                    {info.seleccionable && <th className="text-left px-3 py-2 w-8" />}
                    <th className="text-left px-3 py-2">Cliente</th>
                    <th className="text-left px-3 py-2">Nº viaje TMS</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Tiempo</th>
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
                      <td className="px-3 py-2 font-medium text-text-primary">{v.client_name ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.source_system_trip_id ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{v.trip_status ?? '—'}</td>
                      <td className={`px-3 py-2 ${TEXTO_CUERPO}`}>{formatDiasSinNovedad(v.dias_sin_novedad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}

      {n > 0 && (
        <div className="flex items-center gap-2 bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
          <span className="text-[11px] font-semibold text-text-primary">{n} seleccionado{n === 1 ? '' : 's'}</span>
          <select
            aria-label="Motivo"
            value={motivoId}
            onChange={e => setMotivoId(e.target.value)}
            className="text-[11px] border border-border rounded-lg px-2 py-1 bg-white"
          >
            <option value="">— Elige un motivo —</option>
            {motivos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!motivoId || guardando}
            onClick={handleCerrar}
            className="text-[11px] font-semibold bg-accent text-white rounded-lg px-3 py-1 disabled:opacity-50"
          >
            {guardando ? 'Cerrando…' : `No asignado por WebCarga · ${n} viaje${n === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  )
}
