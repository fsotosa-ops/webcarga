'use client'

import { useCallback, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { locationsApi, shippersApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'
import { INPUT, LoadState, useConfigList, useRowFeedback } from './shared'

/** Los lugares de ORIGEN (HU-28).
 *
 *  NO es una taxonomía: un origen es una ubicación real que cuelga de un generador
 *  de carga —"cada Cliente tiene sus CD de carga"—, así que vive en
 *  public.locations con el resto del maestro de lugares y no en
 *  app.status_taxonomies. Por eso este panel no usa TaxonomyTab.
 *
 *  Ser lugar de origen NO es excluyente con ser local de entrega: medido el
 *  2026-09-17, 14 de los 24 orígenes observados eran las dos cosas. Por eso lo
 *  que se marca es un rol, no un tipo. */
export function OrigenesTab() {
  // `useConfigList` mete el fetcher en un useCallback: un arrow inline cambia
  // en cada render y lo haría recargar en bucle.
  const traerCds = useCallback(
    () => locationsApi.list({ origin: true, limit: 200 }).then(r => r.data), [],
  )
  const traerGeneradores = useCallback(() => shippersApi.list(), [])
  const { items: cds, loading, error, reload } = useConfigList<Location>(traerCds)
  const { items: generadores } = useConfigList(traerGeneradores)
  const { errors, saving, run } = useRowFeedback()

  const [agregando, setAgregando] = useState(false)
  const [generadorId, setGeneradorId] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [candidatos, setCandidatos] = useState<Location[] | null>(null)
  const [buscando, setBuscando] = useState(false)

  const nombreDeGenerador = (id: string) =>
    generadores.find(g => g.id === id)?.name ?? '—'

  async function buscar() {
    if (!generadorId) return
    setBuscando(true)
    try {
      const r = await locationsApi.list({
        entity_type: 'SHIPPER', entity_id: generadorId, q: busqueda.trim(),
        operational_status: 'ACTIVE', limit: 50,
      })
      setCandidatos(r.data.filter(l => !l.is_origin))
    } finally {
      setBuscando(false)
    }
  }

  async function marcar(l: Location, esCd: boolean) {
    await run(l.id, async () => {
      await locationsApi.patch(l.id, { is_origin: esCd })
      setCandidatos(c => (c ?? []).filter(x => x.id !== l.id))
      reload()
    })
  }

  if (loading || error) return <LoadState loading={loading} error={error} onRetry={reload} />

  return (
    <div className="space-y-4">
      <p className="text-xs text-informativo">
        Los lugares desde los que sale carga. Son la dimensión con la que se mide
        la asistencia del cierre y con la que se filtra Flota del día. Un lugar
        puede ser lugar de origen y local de entrega a la vez.
      </p>

      {cds.length === 0 ? (
        <p className="text-xs text-informativo">
          Todavía no hay ningún centro de distribución. Agrega el primero desde un
          lugar que ya exista en el catálogo de locales.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-semibold">Centro de distribución</th>
              <th className="text-left px-3 py-2 font-semibold">Generador de carga</th>
              <th className="px-3 py-2 w-24" />
            </tr>
          </thead>
          <tbody>
            {cds.map(cd => (
              <tr key={cd.id} className="border-b border-border/60">
                <td className="px-3 py-2 font-medium text-text-primary">{cd.name}</td>
                <td className="px-3 py-2 text-informativo">{nombreDeGenerador(cd.entity_id)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => marcar(cd, false)}
                    disabled={saving === cd.id}
                    className="inline-flex items-center gap-1 text-[11px] text-informativo hover:text-status-incidente disabled:opacity-50"
                  >
                    <X size={12} /> Quitar
                  </button>
                  {errors[cd.id] && (
                    <span className="ml-2 text-[11px] text-status-incidente">{errors[cd.id]}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!agregando ? (
        <button
          type="button"
          onClick={() => setAgregando(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-accion hover:underline"
        >
          <Plus size={13} /> Agregar un centro de distribución
        </button>
      ) : (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <p className="text-[11px] text-informativo">
            Elige el generador de carga y busca el lugar. Sólo aparecen los que
            todavía no están marcados como CD.
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Generador de carga"
              value={generadorId}
              onChange={e => { setGeneradorId(e.target.value); setCandidatos(null) }}
              className={`${INPUT} w-48`}
            >
              <option value="">Elige un generador de carga</option>
              {generadores.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <input
              aria-label="Buscar lugar"
              placeholder="Buscar por nombre"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscar() }}
              className={`${INPUT} flex-1 min-w-40`}
            />
            <button
              type="button"
              onClick={buscar}
              disabled={!generadorId || buscando}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50"
            >
              Buscar
            </button>
          </div>

          {candidatos !== null && (
            candidatos.length === 0 ? (
              <p className="text-[11px] text-informativo">
                Ningún lugar sin marcar calza con esa búsqueda.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {candidatos.map(l => (
                  <li key={l.id} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-text-primary">{l.name}</span>
                    <button
                      type="button"
                      onClick={() => marcar(l, true)}
                      className="text-[11px] font-semibold text-accion hover:underline"
                    >
                      Marcar como CD
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  )
}
