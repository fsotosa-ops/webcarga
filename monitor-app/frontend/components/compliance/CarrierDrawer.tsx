'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { useCanEdit } from '@/hooks/useCanEdit'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { PuenteALaBandeja } from './PuenteALaBandeja'
import { RenglonPendiente } from './RenglonPendiente'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { agruparPorSujeto } from '@/lib/utils/agruparPorSujeto'
import { useQuery } from '@tanstack/react-query'
import type { PendingComplianceRow } from '@/lib/types'

interface Props {
  carrierId:   string
  carrierName: string
  /** Acota el cajón a UN sujeto: entrando por la vista Conductores o
   *  Vehículos, lo único que interesa es lo que le falta a él.
   *
   *  Es una prop opcional y no un componente hermano, igual que `carrierId` en
   *  `TriageWorkbench`: sin sujeto es el cajón de la empresa, con sujeto es el
   *  de esa persona o ese vehículo. Un segundo componente "construido sobre el
   *  patrón de éste" serían dos implementaciones de la misma pantalla, que en
   *  este módulo ya divergieron una vez. */
  subject?: { entity_type: PendingComplianceRow['entity_type']; entity_id: string }
}

/** El cajón de una empresa: la fila se abre HACIA ABAJO.
 *
 *  **No hay panel lateral, no hay modal, no hay página nueva.** El panel del
 *  intento anterior apretaba la lista a media pantalla y obligaba a elegir
 *  entre ver el contexto o ver el detalle; se revirtió entero en la Ronda 109
 *  (`addb278`) justamente por eso. El cajón no achica nada y nunca saca al
 *  usuario de donde estaba.
 *
 *  **La lista de lo que falta ES la superficie de carga** (Ronda 129). Antes
 *  el cajón montaba la bandeja de triaje arriba —una zona de arrastre de
 *  1183 × 211 px— y debajo, por renglón, un "Subir" de 42 × 17 px. Las dos
 *  recibían archivos y hacían cosas distintas: la grande mandaba a la bandeja
 *  sin clasificar, la chica clasificaba al requisito. Quien le pegaba a la
 *  grande no veía cambiar el requisito y leía "no pasó nada".
 *
 *  De los cinco productos del rubro que se miraron (Highway, RMIS, MyCarrier-
 *  Packets, Fleetio, Samsara), **ninguno pone el triaje como camino principal**:
 *  cuatro hacen que el casillero pida lo que necesita, y el triaje aparece sólo
 *  donde los documentos llegan sin pedirlos, siempre como destino aparte. Acá
 *  quedó como eso: un enlace, no una zona encima del casillero. */
export function CarrierDrawer({ carrierId, carrierName, subject }: Props) {
  const canEdit = useCanEdit()
  const subirDocumento = useSubirDocumento()
  /** Se guardan los ABIERTOS, no los plegados, para que el default —conjunto
   *  vacío— sea "todo plegado" sin depender de que lleguen los datos.
   *
   *  Medido en staging: con los sujetos abiertos el cajón de una empresa con
   *  9 sujetos y 91 requisitos medía **3.159px**, contra 633px de lista
   *  visible. Cinco pantallas. Eso contradice la razón de ser del cajón —"no
   *  achica nada y nunca saca al usuario de donde estaba"—: para volver a la
   *  lista había que subir cinco pantallas, peor que el panel lateral que se
   *  revirtió en la Ronda 109. Plegados, el mismo cajón mide ~720px. */
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set())
  /** Con un solo sujeto, plegarlo esconde LO ÚNICO que el cajón vino a
   *  mostrar: el motivo del plegado era una empresa con 9 sujetos y 91
   *  requisitos midiendo 3.159px, y acá son los documentos de una persona. */
  const unSoloSujeto = !!subject

  /** Una sola consulta para todo "lo que falta": `/pending` ya trae la
   *  categoría, el sujeto, el requisito y el estado de cada fila, así que no
   *  hacen falta las consultas de roster de conductores y de vehículos. */
  /** Acotar en el servidor y no filtrar acá: `/pending` corta en 200 y hay
   *  empresas con 381 pendientes, así que filtrar del lado del cliente opera
   *  sobre una muestra truncada sin decirlo. Por eso el endpoint tiene
   *  `entity_id`. */
  const pendingQuery = useQuery({
    queryKey: clavesCertificacion.pendientes(carrierId, subject?.entity_id),
    queryFn: () => complianceApi.listPending({
      carrierId, entityId: subject?.entity_id, category: subject?.entity_type, limit: 200,
    }),
  })

  const rows = useMemo(() => pendingQuery.data?.rows ?? [], [pendingQuery.data])
  /** Lo que la empresa tiene pendiente DE VERDAD, que no es lo que se trajo.
   *
   *  `/pending` corta en 200 —es su tope duro— y esta consulta pide justo esa
   *  cantidad. Medido en producción: "Inversiones Huemul Spa" tiene 381, así
   *  que el cajón mostraba 200 y escribía "200 documentos". Sin error y sin
   *  aviso: la pantalla afirmando un número que no es, que es exactamente lo
   *  que este frontend ya declaró que no se hace. Otras cuatro empresas
   *  activas pasan de 90 y llegarán al tope al crecer su flota. */
  const total = pendingQuery.data?.total ?? rows.length
  const truncado = rows.length < total

  /** La empresa primero, después sus conductores y sus vehículos. Fijada la
   *  empresa los candidatos son 2 conductores y 3 vehículos en promedio, no 80
   *  y 118: por eso elegir sujeto acá es un clic.
   *
   *  El agrupado en sí vive en `lib/utils/agruparPorSujeto`, compartido con la
   *  ficha de empresa: agrupar por sujeto es el mismo problema en los dos,
   *  sólo cambia qué filas llegan (acá siempre `estado='falta'`). */
  const sujetos = useMemo(() => agruparPorSujeto(rows), [rows])

  function alternar(clave: string) {
    setAbiertos(prev => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })
  }

  /** El renglón sabe dónde mostrar su propio error, así que el error se deja
   *  propagar: acá no hay un aviso global. Uno solo, arriba del cajón, no
   *  diría de cuál de los 91 renglones está hablando. */
  const subir = (fila: PendingComplianceRow, archivo: File, vencimiento?: string) =>
    subirDocumento(fila.id, archivo, vencimiento)

  return (
    <div className="bg-accent/5 border-b border-border px-4 py-3 pl-8 space-y-3">
      <div>
        <p className="text-etiqueta font-semibold uppercase tracking-[.11em] text-informativo pb-1.5">
          Lo que falta{total > 0 && <> · {total} documentos</>}
          {truncado && <> · se listan los primeros {rows.length}</>}
        </p>

        {pendingQuery.isPending && (
          <p className="text-etiqueta text-informativo flex items-center gap-1.5 py-1">
            <Loader2 size={11} className="motion-safe:animate-spin" /> Cargando…
          </p>
        )}

        {!pendingQuery.isPending && !rows.length && (
          <p className="text-etiqueta text-resuelto flex items-center gap-1.5 py-1">
            <Check size={12} /> No le falta ningún documento
          </p>
        )}

        {sujetos.map(s => {
          const abierto = unSoloSujeto || abiertos.has(s.clave)
          return (
            <div key={s.clave} className="border-t border-border first:border-t-0">
              <button
                type="button"
                onClick={() => alternar(s.clave)}
                aria-expanded={abierto}
                disabled={unSoloSujeto}
                className="w-full flex items-center gap-1.5 py-1.5 text-left cursor-pointer group disabled:cursor-default"
              >
                {unSoloSujeto ? null : abierto
                  ? <ChevronDown size={11} className="text-informativo" aria-hidden="true" />
                  : <ChevronRight size={11} className="text-informativo" aria-hidden="true" />}
                {/* El sujeto es lo que se escanea: va en tinta y en semibold. */}
                <span className="text-dato font-semibold text-text-primary group-hover:text-accent transition-colors">
                  {s.titulo}
                </span>
                <span className="text-etiqueta text-informativo tabular-nums">
                  faltan {s.filas.length}
                </span>
              </button>

              {abierto && s.filas.map(p => (
                <RenglonPendiente
                  key={p.id}
                  fila={p}
                  puedeEditar={canEdit}
                  onSubir={subir}
                />
              ))}
            </div>
          )
        })}

        <PuenteALaBandeja carrierId={carrierId} carrierName={carrierName} />
      </div>
    </div>
  )
}
