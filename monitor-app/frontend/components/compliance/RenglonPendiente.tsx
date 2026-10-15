'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, Check, Eye, Loader2, Upload } from 'lucide-react'
import { useGestoDeCarga } from '@/hooks/useGestoDeCarga'
import { AvisoDeFila } from './AvisoDeFila'
import { ExpirationDateCell } from '@/components/dashboard/ExpirationDateCell'
import { vigenciaDeLaFila, type DatosDelDocumento } from '@/lib/compliance'
import type { PendingComplianceRow, PoliticaVencimiento } from '@/lib/types'
import { PedirDatoDelDocumento } from './PedirDatoDelDocumento'

interface Props {
  fila:        PendingComplianceRow
  /** Qué nombra la fila. Por defecto el documento (la ficha de una empresa ya
   *  sabe de quién es); Pendientes ya sabe el documento y nombra a quien lo
   *  debe. Una variante, no un renglón hermano. */
  title?:      ReactNode
  /** El estado dicho en palabras, en lugar del motivo por defecto
   *  (`vigenciaDeLaFila`). Pendientes lo dice como chip ("Venció el 29/09"). */
  status?:     ReactNode
  /** El texto de la acción de carga ("Subir", "Completar", "Subir la nueva").
   *  Por defecto, la invitación a arrastrar o elegir un archivo. */
  actionLabel?: string
  puedeEditar: boolean
  /** Corregir el vencimiento. Por defecto, lo mismo que `puedeEditar`; sobre
   *  un documento ya aprobado exige además revisar (revisión final RBAC). */
  puedeCorregirFecha?: boolean
  /** Sube el documento con lo que su tipo pide: vencimiento, emisión o
   *  período (HU-C1, entrega 2b). */
  onSubir:     (fila: PendingComplianceRow, archivo: File, datos?: DatosDelDocumento) => Promise<void>
  /** Si no llega, el renglón NO ofrece deshacer: prometer una vuelta atrás
   *  que no existe es peor que no ofrecerla. */
  onDeshacer?: () => void
  /** Abre el documento QUE YA ESTÁ cargado. Sólo lo pasa quien sabe que hay
   *  archivo (`fila.tiene_archivo`): un renglón vencido tiene uno —venció
   *  porque alguien lo subió— y renovarlo no es lo mismo que mirarlo. Sin
   *  esta prop el renglón no ofrece "Ver", igual que con `onDeshacer`. */
  onVer?:      () => void
  /** La consulta del archivo está en vuelo. */
  viendo?:     boolean
  /** Por qué "Ver" no abrió nada. Se dibuja EN el renglón, con reintento:
   *  sin esto el spinner se apagaba y no pasaba absolutamente nada. */
  avisoVer?:   string | null
  /** Corregir la fecha de un documento QUE YA ESTÁ cargado (HU-26).
   *
   *  Va acá y no sólo en la fila "al día" porque el caso donde la fecha está
   *  mal es, justamente, el que se ve vencido: si alguien escribió 2025 en vez
   *  de 2026, el documento aparece en este renglón y sin esto la única salida
   *  era volver a subir un archivo que estaba bien.
   *
   *  Sólo lo pasa quien sabe que hay archivo (`fila.tiene_archivo`), igual que
   *  `onVer`. */
  onFechaCorregida?: () => void
  /** Retirar un documento "a pedido" que se solicitó y todavía no tiene
   *  archivo (HU-C1, entrega 2b). Sólo lo pasa quien sabe que es a pedido. */
  onQuitarSolicitud?: () => void
  /** Lo que se hace con el archivo ya cargado: sus versiones y reasignarlo
   *  (ficha única de empresa, Entrega C). Sólo lo pasa quien sabe que hay archivo. */
  acciones?: ReactNode
}

/** Qué hacer con la fecha, cuando el catálogo todavía no lo dice.
 *
 *  `/pending` ya manda `expiration_policy` (Ronda 129), así que el tipo lo
 *  declara obligatorio. El respaldo se queda igual **porque frontend y
 *  backend se despliegan por separado**: durante esa ventana la respuesta
 *  puede no traerlo, y eso no es un caso imposible sino uno de minutos.
 *
 *  La ausencia significa **"no sé"**, y "no sé" no puede resolverse en
 *  ninguno de los dos extremos: como `NONE` perdería una fecha que hacía
 *  falta, y como `REQUIRED` bloquearía documentos que no vencen. Se pregunta
 *  sin exigir, que es lo único honesto con un dato ausente. */
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
/** El ancho de las acciones de la fila. Las cabeceras de las tablas de estas
 *  filas reservan el mismo lugar, así el título "Estado" queda sobre los chips. */
export const ROW_ACTIONS_WIDTH = 'md:min-w-80'

export function RenglonPendiente({
  fila, title, status, actionLabel, puedeEditar, puedeCorregirFecha = puedeEditar, onSubir, onDeshacer, onVer, viendo, avisoVer, onFechaCorregida, onQuitarSolicitud, acciones,
}: Props) {
  const inputId = `archivo-${fila.id}`
  const fechaId = `vence-${fila.id}`
  const politica = politicaDe(fila)
  // Por qué está pendiente, o qué cubre, dicho con la fecha en la mano. Sale de
  // lo que calculó el backend (`document_state`, `vence_el`), no de comparar fechas
  // acá: los vencidos por fecha están en APPROVED_MANUAL, así que leer el
  // status los anunciaba como aprobados.
  const motivo = vigenciaDeLaFila(fila)

  /** La regla —recibir, pedir la fecha si el requisito la exige, y recién
   *  entonces subir— vive en el hook, compartida con la ficha legacy. Acá
   *  queda sólo el layout de este renglón. */
  const carga = useGestoDeCarga({
    politica,
    puedeEditar,
    onSubir: (archivo, datos) => onSubir(fila, archivo, datos),
    periodoCargado: fila.period_start,
  })
  const { estado, reintentar, propsDeZona, propsDeInput } = carga

  const fondo =
    estado.tipo === 'recibiendo'     ? 'bg-accent/10 outline outline-2 -outline-offset-2 outline-accent'
    : estado.tipo === 'pidiendo-fecha' ? 'bg-espera/5'
    : estado.tipo === 'listo'          ? 'bg-resuelto/5'
    : estado.tipo === 'error'          ? 'bg-espera/5'
    : 'hover:bg-accent/5'

  return (
    <div
      data-testid={`renglon-${fila.id}`}
      {...propsDeZona()}
      className={`border-b border-border last:border-b-0 px-3 py-2 min-h-10 transition-colors ${fondo}`}
    >
      <div className="flex items-center gap-3">
        {/* En el teléfono el estado va debajo del nombre (maqueta de
            Pendientes, 390 px); desde md, en la misma línea, como siempre. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-3">
          <span className="min-w-0 truncate text-dato text-text-primary md:flex-1">
            {title ?? fila.document_name}
          </span>

          {status && estado.tipo === 'reposo' && <span className="shrink-0 md:w-52">{status}</span>}

          {!status && motivo && estado.tipo === 'reposo' && (
            <span className={`shrink-0 text-etiqueta ${
              fila.document_state === 'UP_TO_DATE' || fila.document_state === 'NOT_REQUIRED' ? 'text-informativo' : 'text-espera'}`}>
              {motivo}
            </span>
          )}
        </div>

        {/* Todas las acciones en un bloque de ancho mínimo fijo, alineado a la
            derecha: el estado queda en la misma columna en todas las filas, tengan
            "Subir", "Pedir" o "Pedido a Certificación" (15/10). */}
        <div data-testid="acciones-fila" className={`flex shrink-0 items-center justify-end gap-3 ${ROW_ACTIONS_WIDTH}`}>
          {/* Ancho fijo desde md, haya o no "Agregar vencimiento": así el estado
              queda en la misma columna en todas las filas (15/10). */}
          {onFechaCorregida && estado.tipo === 'reposo' && (
            <span data-testid="fecha-slot" className="shrink-0 tabular-nums md:w-44 md:text-right">
              <ExpirationDateCell
                recordId={fila.id}
                value={fila.expiration_date ?? null}
                required={fila.expiration_policy === 'REQUIRED'}
                canEdit={puedeCorregirFecha}
                onSaved={onFechaCorregida}
              />
            </span>
          )}

          {onQuitarSolicitud && puedeEditar && estado.tipo === 'reposo' && (
            <button
              type="button"
              onClick={onQuitarSolicitud}
              className="shrink-0 text-etiqueta font-semibold text-informativo transition-opacity hover:opacity-70"
            >
              Quitar solicitud
            </button>
          )}

          {acciones && estado.tipo === 'reposo' && acciones}

          {onVer && estado.tipo === 'reposo' && (
            <button
              type="button"
              onClick={onVer}
              disabled={viendo}
              className="shrink-0 inline-flex items-center gap-1.5 text-etiqueta font-semibold text-accion transition-opacity hover:opacity-70 disabled:opacity-50"
            >
              {viendo
                ? <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />
                : <Eye size={12} aria-hidden="true" />}
              Ver
            </button>
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
              className={`shrink-0 inline-flex items-center gap-1.5 text-etiqueta text-accion font-semibold cursor-pointer transition-opacity hover:opacity-70 ${
                actionLabel ? 'justify-center rounded-md border border-dashed border-accion/45 px-2 py-0.5 md:min-w-28' : ''}`}
            >
              <Upload size={12} aria-hidden="true" />
              {estado.tipo === 'recibiendo' ? 'Suelta para cargar aquí' : actionLabel ?? 'Arrastra aquí o elige un archivo'}
              <input
                id={inputId}
                type="file"
                className="sr-only"
                data-testid={inputId}
                {...propsDeInput()}
              />
            </label>
          )}
        </div>
      </div>

      <PedirDatoDelDocumento carga={carga} id={fechaId} className="pl-1" />

      {avisoVer && onVer && <AvisoDeFila mensaje={avisoVer} onReintentar={onVer} />}

      {estado.tipo === 'error' && (
        <div role="alert" className="flex items-center gap-2 flex-wrap mt-2 pl-1">
          <AlertTriangle size={12} className="text-espera shrink-0" aria-hidden="true" />
          <span className="text-etiqueta text-espera">{estado.motivo}</span>
          {estado.archivo && (
            <>
              <span className="text-etiqueta text-informativo truncate">{estado.archivo.name}</span>
              <button
                type="button"
                onClick={reintentar}
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
