'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Loader2, Upload } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useCanEdit } from '@/hooks/useCanEdit'
import { TriageWorkbench, CLAVES_DE_LA_BANDEJA } from './TriageWorkbench'
import type { PendingComplianceRow } from '@/lib/types'

interface Props {
  carrierId:   string
  carrierName: string
}

/** Un sujeto del cajón: la empresa misma, uno de sus conductores o uno de sus
 *  vehículos, con lo que le falta. */
type Sujeto = {
  clave:       string
  titulo:      string
  entityType:  PendingComplianceRow['entity_type']
  entityId:    string
  pendientes:  PendingComplianceRow[]
}

/** El cajón de una empresa: la fila se abre HACIA ABAJO.
 *
 *  **No hay panel lateral, no hay modal, no hay página nueva.** El panel del
 *  intento anterior apretaba la lista a media pantalla y obligaba a elegir
 *  entre ver el contexto o ver el detalle; se revirtió entero en la Ronda 109
 *  (`addb278`) justamente por eso. El cajón no achica nada y nunca saca al
 *  usuario de donde estaba.
 *
 *  Dos secciones, en este orden (§5): lo que llegó y espera que lo ubiquen, y
 *  lo que falta — con la flota en renglones plegables. */
export function CarrierDrawer({ carrierId, carrierName }: Props) {
  const canEdit = useCanEdit()
  const queryClient = useQueryClient()
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
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [errorSubida, setErrorSubida] = useState<string | null>(null)

  /** Una sola consulta para todo "lo que falta": `/pending` ya trae la
   *  categoría, el sujeto, el requisito y el estado de cada fila, así que no
   *  hacen falta las consultas de roster de conductores y de vehículos. */
  const pendingQuery = useQuery({
    queryKey: ['compliance-pending-drawer', carrierId],
    queryFn: () => complianceApi.listPending({ carrierId, limit: 200 }),
  })

  const rows = useMemo(() => pendingQuery.data?.rows ?? [], [pendingQuery.data])

  /** La empresa primero, después sus conductores y sus vehículos. Fijada la
   *  empresa los candidatos son 2 conductores y 3 vehículos en promedio, no 80
   *  y 118: por eso elegir sujeto acá es un clic. */
  const sujetos = useMemo<Sujeto[]>(() => {
    const porClave = new Map<string, Sujeto>()
    for (const r of rows) {
      const clave = `${r.entity_type}:${r.entity_id}`
      if (!porClave.has(clave)) {
        porClave.set(clave, {
          clave,
          titulo: r.entity_type === 'CARRIER' ? 'De la empresa' : (r.subject_name ?? 'Sin nombre'),
          entityType: r.entity_type,
          entityId: r.entity_id,
          pendientes: [],
        })
      }
      porClave.get(clave)!.pendientes.push(r)
    }
    const orden = { CARRIER: 0, DRIVER: 1, ASSET: 2 } as const
    return [...porClave.values()].sort((a, b) =>
      orden[a.entityType] - orden[b.entityType] || a.titulo.localeCompare(b.titulo))
  }, [rows])

  function alternar(clave: string) {
    setAbiertos(prev => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })
  }

  /** Todo lo que queda obsoleto al aplicar un documento. Las claves salen de
   *  CLAVES_DE_LA_BANDEJA —la lista compartida— más la del propio cajón, que
   *  NO está cubierta por el prefijo `compliance-pending`: React Query compara
   *  elemento por elemento y 'compliance-pending' ≠ 'compliance-pending-drawer'.
   *  Antes acá había un `['document-ingest-items']` que no existe en ninguna
   *  parte del repo, así que la bandeja de arriba del cajón no se refrescaba. */
  async function invalidarTodo() {
    await Promise.all([
      ...CLAVES_DE_LA_BANDEJA.map(queryKey => queryClient.invalidateQueries({ queryKey })),
      queryClient.invalidateQueries({ queryKey: ['compliance-pending-drawer', carrierId] }),
      queryClient.invalidateQueries({ queryKey: ['certification-status-catalog'] }),
    ])
  }

  async function subir(fila: PendingComplianceRow, file: File) {
    setSubiendo(fila.id)
    setErrorSubida(null)
    try {
      // La MISMA puerta que la bandeja (`upload` + `classify-batch`), no un
      // camino aparte: dos implementaciones de lo mismo terminan divergiendo,
      // y en este módulo ya pasó una vez.
      await documentIngestApi.uploadAndClassify({
        carrierId,
        entityType:    fila.entity_type,
        entityId:      fila.entity_id,
        requirementId: fila.requirement_id,
        file,
      })
      // Lo que queda obsoleto al aplicar un documento: lo que falta acá, el
      // avance de la fila en el embudo y el conteo de la bandeja.
      await invalidarTodo()
    } catch (e) {
      // Sin esto el spinner se apagaba, no cambiaba nada en pantalla y el
      // archivo podia quedar huerfano en la bandeja sin que nadie se entere.
      setErrorSubida(e instanceof Error ? e.message : 'No se pudo subir el documento')
      await invalidarTodo()
    } finally {
      setSubiendo(null)
    }
  }

  return (
    <div className="bg-sky-50/40 border-b border-border px-4 py-3 pl-8 space-y-3">
      {/* 1 · Lo que llegó y espera. Es la MISMA bandeja que la global, sólo
          que acotada a esta empresa: un solo componente que recibe o no un
          carrier_id (§6). No se escribe una bandeja paralela. */}
      <TriageWorkbench carrierId={carrierId} carrierName={carrierName} />

      {/* 2 · Lo que falta */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.11em] text-gray-500 pb-1.5">
          Lo que falta{rows.length > 0 && <> · {rows.length} documentos</>}
        </p>

        {errorSubida && (
          <p role="alert" className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5 mb-1.5">
            {errorSubida}
          </p>
        )}

        {pendingQuery.isPending && (
          <p className="text-[11px] text-gray-500 flex items-center gap-1.5 py-1">
            <Loader2 size={11} className="motion-safe:animate-spin" /> Cargando…
          </p>
        )}

        {!pendingQuery.isPending && !rows.length && (
          <p className="text-[11.5px] text-resuelto flex items-center gap-1.5 py-1">
            <Check size={12} /> No le falta ningún documento
          </p>
        )}

        {sujetos.map(s => {
          const abierto = abiertos.has(s.clave)
          return (
            <div key={s.clave} className="border-t border-sky-100 first:border-t-0">
              <button
                type="button"
                onClick={() => alternar(s.clave)}
                aria-expanded={abierto}
                className="w-full flex items-center gap-1.5 py-1.5 text-left cursor-pointer group"
              >
                {abierto
                  ? <ChevronDown size={11} className="text-gray-400" aria-hidden="true" />
                  : <ChevronRight size={11} className="text-gray-400" aria-hidden="true" />}
                {/* El sujeto es lo que se escanea: va en tinta y en semibold. */}
                <span className="text-[12.5px] font-semibold text-text-primary group-hover:text-accent transition-colors">
                  {s.titulo}
                </span>
                <span className="text-[10.5px] text-gray-500 tabular-nums">
                  faltan {s.pendientes.length}
                </span>
              </button>

              {abierto && s.pendientes.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 py-1 pl-5 border-b border-sky-100/70 last:border-b-0"
                >
                  {/* El nombre del documento, en gris: es el objeto, no el
                      sujeto. El peso separa qué es cada cosa (§9). */}
                  <span className="flex-1 min-w-0 truncate text-[11.5px] text-gray-600">
                    {p.document_name}
                  </span>

                  {p.status === 'EXPIRED' && (
                    <span className="text-[10px] text-amber-700 shrink-0">
                      vencido{p.expiration_date ? ` · ${p.expiration_date}` : ''}
                    </span>
                  )}

                  {canEdit && (
                    <label
                      className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accion cursor-pointer transition-opacity hover:opacity-70"
                    >
                      {subiendo === p.id
                        ? <Loader2 size={11} className="motion-safe:animate-spin" />
                        : <Upload size={11} />}
                      Subir
                      <input
                        type="file"
                        className="hidden"
                        data-testid={`subir-${p.id}`}
                        disabled={subiendo === p.id}
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) subir(p, f)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
