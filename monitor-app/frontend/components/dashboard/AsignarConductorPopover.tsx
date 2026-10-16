'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { UserPlus, AlertCircle, Loader2 } from 'lucide-react'
import type { AssignmentWarning, CandidatoConductor } from '@/lib/types'
import { ApiError } from '@/lib/api/client'
import { invalidateDirectory } from '@/lib/queries/directorio'
import { TEXTO_APOYO, TEXTO_CUERPO } from '@/lib/ui/texto'
import { nombreLegible } from '@/lib/utils/nombres'
import { AltaDeFlota } from './AltaDeFlota'

type Props = {
  nombreTms: string
  candidatos: CandidatoConductor[]
  /** Cuántos viajes sin identificar trae ese mismo nombre (los da el backend). */
  viajesDeLaPersona: number
  cargando?: boolean
  /** Puede rechazar: el popover muestra el error y NO se cierra. Si devuelve
   *  avisos (empresa no habilitada, D1 §7.1), se muestran antes de cerrar: el
   *  que llama no cierra y el popover ofrece "Continuar". */
  onAsignar: (driverId: string, aTodosSusViajes: boolean) => void | AssignmentWarning[] | Promise<void | AssignmentWarning[]>
  /** Sin él no se ofrece el alta: crear al conductor y vincularlo a su empresa
   *  pide `directory.edit`, además de `trips.edit_sensitive`. El alta es la
   *  común (`AltaDeFlota`); después de crear, se asigna con `onAsignar`. */
  puedeDarDeAlta?: boolean
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
  puedeDarDeAlta = false,
  onCancelar,
}: Props) {
  const queryClient = useQueryClient()
  const [elegido, setElegido] = useState<string | null>(null)
  const [aTodos, setATodos] = useState(true)
  const [verParecidos, setVerParecidos] = useState(false)
  const [dandoDeAlta, setDandoDeAlta] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<AssignmentWarning[]>([])

  // Asignar es una sola cosa, venga de un candidato o del alta: llama a la
  // API y guarda los avisos (empresa no habilitada, D1 §7.1). Si falla,
  // rechaza; quién muestra el error depende de quién tiene el botón.
  async function asignar(driverId: string) {
    setAvisos([])
    const resultado = await onAsignar(driverId, aTodos)
    if (Array.isArray(resultado) && resultado.length > 0) setAvisos(resultado)
  }

  // El botón del candidato: espera, muestra el error acá y se apaga. Antes cada
  // `onClick` disparaba una promesa flotante: si rechazaba, la excepción moría
  // sin dueño y la pantalla no se enteraba. Desde el alta, el error lo muestra
  // el alta, que queda abierta (y el reintento cae en el 409 que ofrece al
  // existente).
  async function asignarElegido(driverId: string) {
    setError(null)
    setGuardando(true)
    try {
      await asignar(driverId)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  const contenidos = candidatos.filter(c => c.contiene)
  const parecidos = candidatos.filter(c => !c.contiene)
  // Con un solo viaje no hay alcance que elegir: "a 1 viajes" no se dice.
  const variosViajes = viajesDeLaPersona > 1
  const etiquetaAlcance = !variosViajes
    ? 'Asignar a este viaje'
    : aTodos ? `Asignar a ${viajesDeLaPersona} viajes` : 'Asignar solo a este viaje'

  const claseCandidato = (id: string) =>
    `w-full text-left rounded-md border px-2.5 py-2 transition-colors ${
      elegido === id ? 'border-accent bg-accent/5' : 'border-border hover:bg-bg-main'
    }`

  return (
    <div className="w-[400px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-white p-3 shadow-lg">
      <p className={`text-etiqueta uppercase tracking-wide ${TEXTO_APOYO}`}>El TMS reportó</p>
      <p className="font-identificador text-dato text-text-primary mt-0.5 break-words">
        {nombreTms}
      </p>

      {/* Con avisos ya está asignado: se muestran solos, hasta "Continuar". */}
      {avisos.length === 0 && (<>
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
            {puedeDarDeAlta && (
              <button
                type="button"
                onClick={() => setDandoDeAlta(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-accent bg-accent/5 px-2.5 py-2 text-dato text-accent font-medium hover:bg-accent/10"
              >
                <UserPlus size={14} /> Ninguno — dar de alta a esta persona
              </button>
            )}

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

        {/* Alta: la misma de toda la app (D5, Entrega C). El RUT es
            obligatorio y no es burocracia: es la clave con la que el resolvedor
            identifica por RUT. La empresa se pregunta porque sin ella la
            persona no aparece en el cierre del día. */}
        <AltaDeFlota
          tipo="conductor"
          carrierId={null}
          prefill={nombreLegible(nombreTms)}
          etiquetaGuardar="Crear y asignar"
          abierto={dandoDeAlta}
          onAbiertoChange={setDandoDeAlta}
          onCreado={async (carrierId, creado) => {
            await invalidateDirectory(queryClient, { entity: 'driver', id: creado.id, type: 'create', carrierIds: [carrierId] })
            await asignar(creado.id)
          }}
          yaExiste={{ accion: nombre => `Asignar a ${nombre}`, usar: existente => asignar(existente.driver_id) }}
        />
      </div>
      </>)}

      {error && (
        <div className="mt-2.5 rounded-md border border-status-incidente/25 bg-status-incidente/5 px-2.5 py-2 space-y-1.5">
          <p className="flex items-start gap-1.5 text-etiqueta text-status-incidente">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        </div>
      )}

      {avisos.length > 0 && (
        <div role="status" className="mt-2.5 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 space-y-1.5">
          <p className="text-etiqueta font-medium text-text-primary">Asignado.</p>
          {avisos.map(a => (
            <p key={`${a.code}-${a.row ?? ''}-${a.message}`} className="text-etiqueta text-warning">{a.message}</p>
          ))}
          <button type="button" onClick={onCancelar}
                  className="w-full rounded-md bg-accent px-2.5 py-1.5 text-dato text-white font-medium">
            Continuar
          </button>
        </div>
      )}

      {avisos.length === 0 && (
      <div className="mt-3 pt-2.5 border-t border-border space-y-2.5">
        {variosViajes && (
          <label className={`flex items-start gap-2 text-etiqueta cursor-pointer ${TEXTO_CUERPO}`}>
            <input type="checkbox" checked={aTodos}
                   onChange={e => setATodos(e.target.checked)} className="mt-0.5" />
            <span>Aplicar a los {viajesDeLaPersona} viajes de esta persona</span>
          </label>
        )}
        <div className="flex gap-2">
          {!dandoDeAlta && (
            <button
              type="button"
              disabled={cargando || guardando || !elegido}
              onClick={() => elegido && asignarElegido(elegido)}
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
      )}
    </div>
  )
}
