'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface Props {
  abierto:           boolean
  nombreSujeto:      string
  nombreEmpresa:     string
  /** `undefined` mientras la consulta viaja: 'no sé' no es 'cero'. */
  cuantosDocumentos?: number
  /** Viajes activos que tiene hoy. `undefined` mientras la consulta viaja:
   *  'no sé' no es 'cero', igual que `cuantosDocumentos`. */
  viajesActivos?:    number
  onCancelar:        () => void
  onConfirmar:       () => Promise<void>
}

/** Confirmación de dar de baja a un conductor o vehículo de una empresa —
 *  se abre desde `AccionesDeSujeto`. Sin motivo de baja: la HU lo propone,
 *  pero exige una columna nueva y el vocabulario es decisión del negocio.
 *  La baja ya deja rastro en `audit_log` vía `record_manual_edit`. */
export function ConfirmarBaja({ abierto, nombreSujeto, nombreEmpresa, cuantosDocumentos, viajesActivos, onCancelar, onConfirmar }: Props) {
  const cancelarRef = useRef<HTMLButtonElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs de "último valor": el padre real pasa handlers inline —identidad
  // nueva en cada render—, y el listener de Escape vive adentro de un
  // efecto. Si ese efecto dependiera de `onCancelar`, un re-render del padre
  // a mitad de una baja en vuelo lo reiniciaría, haría `setEnviando(false)` y
  // "Dar de baja" quedaría habilitado de nuevo con el request todavía
  // viajando. Se asignan directo en el cuerpo del render (sin efecto propio):
  // no afectan lo que se pinta, sólo mantienen la caja al día para cuando el
  // handler se dispare.
  const onCancelarRef = useRef(onCancelar)
  onCancelarRef.current = onCancelar
  const enviandoRef = useRef(enviando)
  enviandoRef.current = enviando

  useEffect(() => {
    if (!abierto) return
    setEnviando(false)
    setError(null)
    // El foco va al botón de CANCELAR, no al destructivo: que Enter por
    // reflejo no dé de baja a nadie.
    cancelarRef.current?.focus()
    const alTeclado = (e: KeyboardEvent) => {
      // Mientras viaja, Escape no cancela: cerraría creyendo que se
      // canceló mientras la baja sigue en curso.
      if (e.key === 'Escape' && !enviandoRef.current) onCancelarRef.current()
    }
    window.addEventListener('keydown', alTeclado)
    return () => window.removeEventListener('keydown', alTeclado)
  }, [abierto])

  if (!abierto) return null

  // Mismo motivo: mientras viaja, el clic en el fondo tampoco cancela.
  function handleCancelarFondo() {
    if (!enviando) onCancelar()
  }

  async function handleConfirmar() {
    setEnviando(true)
    setError(null)
    try {
      await onConfirmar()
    } catch (e) {
      // El diálogo NO se cierra: cerrarlo haría creer que la baja ocurrió.
      setError(e instanceof Error ? e.message : 'No se pudo dar de baja')
      setEnviando(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={handleCancelarFondo} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Dar de baja a ${nombreSujeto} de ${nombreEmpresa}`}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-md p-5 space-y-4 animate-modal-in"
        >
          <h2 className="text-titulo font-bold text-text-primary">
            Dar de baja a {nombreSujeto} de {nombreEmpresa}
          </h2>

          <p className="text-lectura text-informativo">
            Deja de figurar en esta empresa.
            {/* Sólo lo que hoy es cierto: los documentos no se tocan
             *  (compliance_records no se toca en ningún camino de esta
             *  ola). NO promete que el regreso vaya a funcionar solo —
             *  is_manual_override deja la asignación sin un camino de
             *  vuelta por la interfaz (issue #7); prometerlo acá sería
             *  mentir. */}
            {cuantosDocumentos != null && cuantosDocumentos > 0 && (
              <> Sus {cuantosDocumentos} documentos cargados se conservan.</>
            )}
          </p>

          {/* El aviso que faltaba. Sacarle la empresa a alguien que está
              manejando lo borra del cierre del día —el roster de Tractoreo se
              arma desde `driver_assignments`— y nada avisaba. El 25/08, en la
              propia revisión de la app, se desvinculó a un conductor con 70
              viajes en 60 días; al 27/08 hay 8 así, con 278 viajes entre todos.
              No bloquea: a veces la baja es justamente lo que corresponde. */}
          {viajesActivos != null && viajesActivos > 0 && (
            <p role="alert" className="text-dato text-espera bg-espera/10 border border-espera/20 rounded-lg px-3 py-2">
              Tiene {viajesActivos} {viajesActivos === 1 ? 'viaje activo' : 'viajes activos'} en
              este momento. Sin empresa deja de aparecer en el cierre del día, aunque
              siga manejando.
            </p>
          )}

          {error && (
            <p role="alert" className="text-dato text-espera bg-espera/10 border border-espera/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              ref={cancelarRef}
              type="button"
              onClick={onCancelar}
              disabled={enviando}
              className="px-4 py-2 rounded-lg text-dato font-bold border border-border bg-white text-text-primary hover:bg-bg-main transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={enviando}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-dato font-bold bg-espera text-white hover:bg-espera/90 transition-colors disabled:opacity-50"
            >
              {enviando && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              Dar de baja
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
