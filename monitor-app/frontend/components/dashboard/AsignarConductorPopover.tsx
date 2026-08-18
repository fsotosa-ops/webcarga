'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import type { CandidatoConductor } from '@/lib/types'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import { nombreLegible } from '@/lib/utils/nombres'

type Props = {
  nombreTms: string
  candidatos: CandidatoConductor[]
  /** Cuántos viajes sin identificar trae ese mismo nombre (los da el backend). */
  viajesDeLaPersona: number
  cargando?: boolean
  onAsignar: (driverId: string, aTodosSusViajes: boolean) => void
  onDarDeAlta: (nombre: string, rut: string, aTodosSusViajes: boolean) => void
  onCancelar: () => void
}

/**
 * Elegir quién es la persona que el TMS nombra así.
 *
 * **Manda la contención, no el parecido.** Está medido: sobre los 7 viajes de
 * identidad segura (el TMS mandó el RUT), en los 7 todas las palabras del TMS
 * están dentro del nombre del roster; la similitud cae a 0,40 sólo porque el
 * TMS reporta menos palabras. Un umbral de similitud en 0,5 habría escondido
 * 3 de esos 7. Por eso los "parecidos" no contenidos NO se ofrecen de entrada:
 * para el viaje 2032999 el mejor parecido da 0,22 y es otra persona.
 *
 * **La casilla de alcance viene marcada.** 27 personas explican 208 viajes,
 * 7,7 cada una. Desmarcada por defecto, la persona resuelve 27 problemas ocho
 * veces cada uno. Es el patrón de Gmail al crear un filtro — y es una casilla,
 * no algo automático, porque quien decide tiene que poder ver el alcance y
 * bajarlo cuando ese viaje es la excepción.
 *
 * **El botón dice el número.** El control y su consecuencia dicen lo mismo, así
 * no hay que acordarse de lo que se marcó dos renglones más arriba.
 */
export function AsignarConductorPopover({
  nombreTms,
  candidatos,
  viajesDeLaPersona,
  cargando = false,
  onAsignar,
  onDarDeAlta,
  onCancelar,
}: Props) {
  const [elegido, setElegido] = useState<string | null>(null)
  const [aTodos, setATodos] = useState(true)
  const [verParecidos, setVerParecidos] = useState(false)
  const [dandoDeAlta, setDandoDeAlta] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState(nombreLegible(nombreTms))
  const [rutNuevo, setRutNuevo] = useState('')

  const contenidos = candidatos.filter(c => c.contiene)
  const parecidos = candidatos.filter(c => !c.contiene)
  const etiquetaAlcance = aTodos
    ? `Asignar a ${viajesDeLaPersona} viajes`
    : 'Asignar solo a este viaje'

  const claseCandidato = (id: string) =>
    `w-full text-left rounded-md border px-2.5 py-2 transition-colors ${
      elegido === id ? 'border-accent bg-accent/5' : 'border-border hover:bg-bg-main'
    }`

  return (
    <div className="w-[340px] rounded-lg border border-border bg-white p-3 shadow-lg">
      <p className={`text-etiqueta uppercase tracking-wide ${TEXTO_APOYO}`}>El TMS reportó</p>
      <p className="font-identificador text-dato text-text-primary mt-0.5 break-words">
        {nombreTms}
      </p>

      <div className="mt-3 space-y-1.5">
        {cargando && (
          <p className={`text-etiqueta py-2 ${TEXTO_APOYO}`}>Buscando candidatos…</p>
        )}

        {!cargando && !dandoDeAlta && contenidos.length > 0 && contenidos.map(c => (
          <button key={c.driver_id} type="button"
                  onClick={() => setElegido(c.driver_id)}
                  className={claseCandidato(c.driver_id)}>
            <span className="block text-dato text-text-primary font-medium">
              {nombreLegible(c.full_name)}
            </span>
            <span className={`block font-identificador text-etiqueta ${TEXTO_APOYO}`}>
              {c.tax_id ?? 'sin RUT'}{c.carrier_name ? ` · ${c.carrier_name}` : ''}
            </span>
          </button>
        ))}

        {/* Ningún contenido: la persona no está en el roster. El camino
            principal es darla de alta — ofrecer "el más parecido" acá es
            ofrecer a otra persona. Medido: 19 de 28 caen en este caso. */}
        {!cargando && !dandoDeAlta && contenidos.length === 0 && (
          <>
            <p className={`text-etiqueta py-1 ${TEXTO_CUERPO}`}>
              No encontramos a esta persona en el registro.
            </p>
            <button
              type="button"
              onClick={() => setDandoDeAlta(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-md border border-accent bg-accent/5 px-2.5 py-2 text-dato text-accent font-medium hover:bg-accent/10"
            >
              <UserPlus size={14} /> Ninguno — dar de alta a esta persona
            </button>

            {parecidos.length > 0 && !verParecidos && (
              <button type="button" onClick={() => setVerParecidos(true)}
                      className={`w-full text-etiqueta py-1 ${TEXTO_APOYO}`}>
                Ver parecidos ({parecidos.length})
              </button>
            )}
            {verParecidos && parecidos.map(c => (
              <button key={c.driver_id} type="button"
                      onClick={() => setElegido(c.driver_id)}
                      className={claseCandidato(c.driver_id)}>
                <span className={`block text-dato ${TEXTO_CUERPO}`}>{nombreLegible(c.full_name)}</span>
                <span className={`block font-identificador text-etiqueta ${TEXTO_APOYO}`}>
                  {c.tax_id ?? 'sin RUT'} · se parece {Math.round(c.similitud * 100)}%
                </span>
              </button>
            ))}
          </>
        )}

        {/* Alta. El RUT es obligatorio y no es burocracia: es la clave con la
            que el resolvedor identifica por RUT, la única regla que no depende
            de cómo se escriba el nombre. Un conductor sin RUT no vuelve a
            identificarse solo nunca. */}
        {dandoDeAlta && (
          <div className="space-y-2 pt-1">
            <label className={`block text-etiqueta ${TEXTO_CUERPO}`}>
              Nombre
              <input value={nombreNuevo} onChange={e => setNombreNuevo(e.target.value)}
                     className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-dato" />
            </label>
            <label className={`block text-etiqueta ${TEXTO_CUERPO}`}>
              RUT
              <input value={rutNuevo} onChange={e => setRutNuevo(e.target.value)}
                     placeholder="16.428.339-1"
                     className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-dato font-identificador" />
            </label>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2.5 border-t border-border space-y-2.5">
        <label className={`flex items-start gap-2 text-etiqueta cursor-pointer ${TEXTO_CUERPO}`}>
          <input type="checkbox" checked={aTodos}
                 onChange={e => setATodos(e.target.checked)} className="mt-0.5" />
          <span>Aplicar a los {viajesDeLaPersona} viajes de esta persona</span>
        </label>
        <div className="flex gap-2">
          {dandoDeAlta ? (
            <button
              type="button"
              disabled={!rutNuevo.trim() || !nombreNuevo.trim()}
              onClick={() => onDarDeAlta(nombreNuevo.trim(), rutNuevo.trim(), aTodos)}
              className="flex-1 rounded-md bg-accent px-2.5 py-1.5 text-dato text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Crear y asignar
            </button>
          ) : (
            <button
              type="button"
              disabled={cargando || !elegido}
              onClick={() => elegido && onAsignar(elegido, aTodos)}
              className="flex-1 rounded-md bg-accent px-2.5 py-1.5 text-dato text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {etiquetaAlcance}
            </button>
          )}
          <button type="button" onClick={onCancelar}
                  className={`rounded-md border border-border px-2.5 py-1.5 text-dato hover:bg-bg-main ${TEXTO_CUERPO}`}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
