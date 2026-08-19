'use client'

import { useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, Check, Loader2, Upload } from 'lucide-react'
import type { PendingComplianceRow, PoliticaVencimiento } from '@/lib/types'

/** En qué punto está este renglón. Es UN valor con la forma del estado, no
 *  cuatro booleanos sueltos: `subiendo` + `error` + `listo` + `archivo` daban
 *  dieciséis combinaciones para seis situaciones reales, y la mitad no
 *  significan nada ("subiendo y listo a la vez"). */
type Estado =
  | { tipo: 'reposo' }
  | { tipo: 'recibiendo' }
  | { tipo: 'pidiendo-fecha'; archivo: File }
  | { tipo: 'subiendo' }
  | { tipo: 'listo' }
  | { tipo: 'error'; motivo: string; archivo: File | null; vencimiento?: string }

interface Props {
  fila:        PendingComplianceRow
  puedeEditar: boolean
  /** Sube el documento. Recibe la fecha sólo si el requisito la contempla. */
  onSubir:     (fila: PendingComplianceRow, archivo: File, vencimiento?: string) => Promise<void>
  /** Si no llega, el renglón NO ofrece deshacer: prometer una vuelta atrás
   *  que no existe es peor que no ofrecerla. */
  onDeshacer?: () => void
}

/** Qué hacer con la fecha, cuando el catálogo todavía no lo dice.
 *
 *  El backend empieza a mandar `expiration_policy` en la Tarea 3 del plan.
 *  Hasta entonces la ausencia significa **"no sé"**, y "no sé" no puede
 *  resolverse en ninguno de los dos extremos: como `NONE` perdería una fecha
 *  que hacía falta, y como `REQUIRED` bloquearía documentos que no vencen.
 *  Se pregunta sin exigir, que es lo único honesto con un dato ausente. */
function politicaDe(fila: PendingComplianceRow): PoliticaVencimiento {
  return fila.expiration_policy ?? 'OPTIONAL'
}

/** Un requisito que falta, y el gesto de cubrirlo.
 *
 *  Reemplaza al botón "Subir" de 42 × 17 px que vivía debajo de una zona de
 *  arrastre de 1183 × 211 px. Las dos hacían cosas distintas —una clasificaba
 *  al requisito, la otra mandaba a la bandeja sin clasificar— y no se
 *  distinguían: quien le erraba al botón chico mandaba el archivo a la
 *  bandeja y veía que "no pasaba nada".
 *
 *  Acá el renglón entero es el blanco, y pide en el mismo lugar lo que su
 *  requisito exige. **Nada se sube hasta estar completo**: el camino viejo
 *  subía primero y clasificaba después, así que cada rechazo dejaba el
 *  archivo huérfano en la bandeja. */
export function RenglonPendiente({ fila, puedeEditar, onSubir, onDeshacer }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'reposo' })
  const [vencimiento, setVencimiento] = useState('')
  const inputId = `archivo-${fila.id}`
  const fechaId = `vence-${fila.id}`
  const politica = politicaDe(fila)
  const ocupado = estado.tipo === 'subiendo'

  const inputRef = useRef<HTMLInputElement>(null)

  async function subir(archivo: File, fecha?: string) {
    setEstado({ tipo: 'subiendo' })
    try {
      await onSubir(fila, archivo, fecha)
      setEstado({ tipo: 'listo' })
    } catch (e) {
      setEstado({
        tipo: 'error',
        motivo: e instanceof Error && e.message ? e.message : 'No se pudo subir el documento',
        archivo,
        vencimiento: fecha,
      })
    }
  }

  /** El archivo recién llegó, por clic o soltándolo. Si el requisito no pide
   *  fecha, no hay nada más que preguntar y sale de una. */
  function recibir(archivo: File | undefined) {
    if (!archivo || ocupado) return
    if (politica === 'NONE') {
      void subir(archivo)
      return
    }
    setVencimiento('')
    setEstado({ tipo: 'pidiendo-fecha', archivo })
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!puedeEditar) return
    recibir(e.dataTransfer?.files?.[0])
  }

  function alArrastrarEncima(e: DragEvent<HTMLDivElement>) {
    if (!puedeEditar || ocupado) return
    e.preventDefault()
    if (estado.tipo === 'reposo') setEstado({ tipo: 'recibiendo' })
  }

  function alSalir() {
    if (estado.tipo === 'recibiendo') setEstado({ tipo: 'reposo' })
  }

  function guardar() {
    if (estado.tipo !== 'pidiendo-fecha') return
    // Con la fecha obligatoria, guardar sin ella no hace nada: el requisito
    // no queda cubierto por un documento del que no se sabe hasta cuándo vale.
    if (politica === 'REQUIRED' && !vencimiento) return
    void subir(estado.archivo, vencimiento || undefined)
  }

  const fondo =
    estado.tipo === 'recibiendo'     ? 'bg-accent/10 outline outline-2 -outline-offset-2 outline-accent'
    : estado.tipo === 'pidiendo-fecha' ? 'bg-espera/5'
    : estado.tipo === 'listo'          ? 'bg-resuelto/5'
    : estado.tipo === 'error'          ? 'bg-espera/5'
    : 'hover:bg-accent/5'

  return (
    <div
      data-testid={`renglon-${fila.id}`}
      onDrop={alSoltar}
      onDragOver={alArrastrarEncima}
      onDragLeave={alSalir}
      className={`border-b border-border last:border-b-0 px-3 py-2 min-h-10 transition-colors ${fondo}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0 truncate text-dato text-text-primary">
          {fila.document_name}
        </span>

        {fila.status === 'EXPIRED' && estado.tipo === 'reposo' && (
          <span className="shrink-0 text-etiqueta text-espera">
            vencido{fila.expiration_date ? ` · ${fila.expiration_date}` : ''}
          </span>
        )}

        {estado.tipo === 'subiendo' && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-etiqueta text-informativo">
            <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />
            Subiendo…
          </span>
        )}

        {estado.tipo === 'listo' && (
          <>
            <span className="shrink-0 inline-flex items-center gap-1.5 text-etiqueta text-resuelto">
              <Check size={12} aria-hidden="true" />
              Listo
            </span>
            {onDeshacer && (
              <button
                type="button"
                onClick={onDeshacer}
                className="shrink-0 text-etiqueta text-accion font-semibold cursor-pointer transition-opacity hover:opacity-70"
              >
                Deshacer
              </button>
            )}
          </>
        )}

        {puedeEditar && (estado.tipo === 'reposo' || estado.tipo === 'recibiendo') && (
          <label
            htmlFor={inputId}
            className="shrink-0 inline-flex items-center gap-1.5 text-etiqueta text-accion font-semibold cursor-pointer transition-opacity hover:opacity-70"
          >
            <Upload size={12} aria-hidden="true" />
            {estado.tipo === 'recibiendo' ? 'Suelta para cargar aquí' : 'Arrastra aquí o elige un archivo'}
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              className="sr-only"
              data-testid={inputId}
              onChange={e => {
                recibir(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>

      {estado.tipo === 'pidiendo-fecha' && (
        <div className="flex items-center gap-2 flex-wrap mt-2 pl-1">
          <label htmlFor={fechaId} className="text-etiqueta text-informativo">
            Vence el
          </label>
          <input
            id={fechaId}
            type="date"
            value={vencimiento}
            onChange={e => setVencimiento(e.target.value)}
            className="text-dato border border-border rounded-lg px-2 py-1"
          />
          <button
            type="button"
            onClick={guardar}
            className="text-etiqueta font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70"
          >
            Guardar
          </button>
          <span className="text-etiqueta text-informativo truncate">
            {estado.archivo.name}
            {politica === 'REQUIRED'
              ? ' · este documento no vale sin su vencimiento'
              : ' · puedes guardarlo sin la fecha'}
          </span>
        </div>
      )}

      {estado.tipo === 'error' && (
        <div role="alert" className="flex items-center gap-2 flex-wrap mt-2 pl-1">
          <AlertTriangle size={12} className="text-espera shrink-0" aria-hidden="true" />
          <span className="text-etiqueta text-espera">{estado.motivo}</span>
          {estado.archivo && (
            <>
              <span className="text-etiqueta text-informativo truncate">{estado.archivo.name}</span>
              <button
                type="button"
                onClick={() => estado.archivo && subir(estado.archivo, estado.vencimiento)}
                className="text-etiqueta font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70"
              >
                Reintentar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
