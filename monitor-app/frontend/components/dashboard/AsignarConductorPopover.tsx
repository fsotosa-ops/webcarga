'use client'

import { useState } from 'react'
import { UserPlus, AlertCircle, Loader2, Building2, X } from 'lucide-react'
import type { CandidatoConductor } from '@/lib/types'
import { ApiError } from '@/lib/api/client'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import { nombreLegible } from '@/lib/utils/nombres'
import { CarrierSearchPicker, type CarrierSearchResult } from './CarrierSearchPicker'

/** Lo que devuelve el backend en un 409 al dar de alta un RUT que ya existe.
 *  Trae el id porque sin él el mensaje sería un callejón sin salida: la persona
 *  que ya existe es exactamente la que se quería asignar. */
type ConductorYaExiste = { code: string; message: string; driver_id: string; full_name: string }

function conductorYaExiste(e: unknown): ConductorYaExiste | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  const d = e.detail as Partial<ConductorYaExiste> | null
  return d && d.code === 'CONDUCTOR_YA_EXISTE' && d.driver_id
    ? (d as ConductorYaExiste)
    : null
}

type Props = {
  nombreTms: string
  candidatos: CandidatoConductor[]
  /** Cuántos viajes sin identificar trae ese mismo nombre (los da el backend). */
  viajesDeLaPersona: number
  cargando?: boolean
  /** Puede rechazar: el popover muestra el error y NO se cierra. */
  onAsignar: (driverId: string, aTodosSusViajes: boolean) => void | Promise<void>
  onDarDeAlta: (
    nombre: string, rut: string, aTodosSusViajes: boolean, carrierId: string | null,
  ) => void | Promise<void>
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
 *
 * **El error se muestra acá, y el popover no se cierra** (2026-08-27). Esto era
 * el bug crítico #1 de la minuta del 25/08: la página llamaba a la API sin
 * `try/catch` y sin estado de error, así que un 409 —"ese RUT ya existe"— se
 * veía igual que un éxito: no pasaba nada. Y no pasaba seguido: de los tres
 * conductores que Pablo intentó dar de alta, dos ya estaban en la base.
 *
 * **Un 409 no es un callejón sin salida**: si el RUT ya existe, el backend
 * devuelve el id de esa persona y acá aparece el botón para asignársela, que es
 * lo que se quería hacer desde el principio.
 *
 * **La empresa se pide en el alta.** Un conductor sin empresa NO APARECE en el
 * cierre del día, y hasta ahora toda alta desde acá nacía así: al 27/08 hay 8
 * conductores con 278 viajes invisibles para la cuadratura, y cuatro los generó
 * la propia sesión de revisión. Es opcional a propósito —a veces no se sabe, y
 * bloquear el alta sería peor— pero se pregunta.
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
  const [empresa, setEmpresa] = useState<CarrierSearchResult | null>(null)
  const [busquedaEmpresa, setBusquedaEmpresa] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [yaExiste, setYaExiste] = useState<ConductorYaExiste | null>(null)

  // Un solo lugar donde se espera a la API, se muestra el error y se apaga el
  // botón. Antes cada `onClick` disparaba una promesa flotante: si rechazaba,
  // la excepción moría sin dueño y la pantalla no se enteraba.
  async function ejecutar(accion: () => void | Promise<void>) {
    setError(null)
    setYaExiste(null)
    setGuardando(true)
    try {
      await accion()
    } catch (e) {
      const existente = conductorYaExiste(e)
      if (existente) {
        setYaExiste(existente)
        setError(existente.message)
      } else {
        setError(e instanceof ApiError ? e.message : 'No se pudo guardar. Vuelve a intentarlo.')
      }
    } finally {
      setGuardando(false)
    }
  }

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
              <span className={`block text-etiqueta mt-0.5 ${TEXTO_APOYO}`}>
                Con puntos o sin puntos, da lo mismo.
              </span>
            </label>

            {/* La empresa NO es opcional por comodidad: un conductor sin empresa
                no aparece en el cierre del día. Se puede omitir porque a veces
                de verdad no se sabe, pero entonces el aviso lo dice. */}
            <div className={`text-etiqueta ${TEXTO_CUERPO}`}>
              Empresa
              {empresa ? (
                <div className="mt-0.5 flex items-center gap-1.5 rounded-md border border-accent bg-accent/5 px-2 py-1.5">
                  <Building2 size={13} className="text-accent shrink-0" />
                  <span className="text-dato text-text-primary truncate">{empresa.business_name}</span>
                  <button type="button" onClick={() => { setEmpresa(null); setBusquedaEmpresa('') }}
                          aria-label="Quitar la empresa elegida"
                          className={`ml-auto shrink-0 ${TEXTO_APOYO} hover:text-text-primary`}>
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="mt-0.5">
                  <CarrierSearchPicker
                    query={busquedaEmpresa}
                    onQueryChange={setBusquedaEmpresa}
                    onPick={c => setEmpresa(c)}
                    placeholder="Buscar empresa…"
                    size="sm"
                    maxHeightClass="max-h-28"
                  />
                  <span className={`block text-etiqueta mt-0.5 ${TEXTO_APOYO}`}>
                    Sin empresa, esta persona no va a aparecer en el cierre del día.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2.5 rounded-md border border-status-incidente/25 bg-status-incidente/5 px-2.5 py-2 space-y-1.5">
          <p className="flex items-start gap-1.5 text-etiqueta text-status-incidente">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
          {/* La salida del callejón: si ya existe, asignárselo es justo lo que
              se venía a hacer. */}
          {yaExiste && (
            <button
              type="button"
              disabled={guardando}
              onClick={() => ejecutar(() => onAsignar(yaExiste.driver_id, aTodos))}
              className="w-full rounded-md border border-status-incidente/35 bg-white px-2.5 py-1.5 text-etiqueta font-medium text-status-incidente hover:bg-status-incidente/10 disabled:opacity-50"
            >
              Asignar a {nombreLegible(yaExiste.full_name)}
            </button>
          )}
        </div>
      )}

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
              disabled={guardando || !rutNuevo.trim() || !nombreNuevo.trim()}
              onClick={() => ejecutar(() => onDarDeAlta(
                nombreNuevo.trim(), rutNuevo.trim(), aTodos, empresa?.id ?? null,
              ))}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-dato text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {guardando && <Loader2 size={13} className="animate-spin" />}
              {guardando ? 'Creando…' : 'Crear y asignar'}
            </button>
          ) : (
            <button
              type="button"
              disabled={cargando || guardando || !elegido}
              onClick={() => elegido && ejecutar(() => onAsignar(elegido, aTodos))}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-dato text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {guardando && <Loader2 size={13} className="animate-spin" />}
              {guardando ? 'Asignando…' : etiquetaAlcance}
            </button>
          )}
          <button type="button" onClick={onCancelar} disabled={guardando}
                  className={`rounded-md border border-border px-2.5 py-1.5 text-dato hover:bg-bg-main disabled:opacity-40 ${TEXTO_CUERPO}`}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
