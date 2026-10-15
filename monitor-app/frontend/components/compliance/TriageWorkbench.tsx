'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, X } from 'lucide-react'
import { Estado } from '@/components/ui/Estado'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import type { CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'
import { TriageBulkBar } from './TriageBulkBar'
import { TriageClassifyForm } from './TriageClassifyForm'
import { TriageFileTable, ordenarPorLoQueFalta } from './TriageFileTable'
import { TriagePreview } from './TriagePreview'
import { TriageUndoNotice } from './TriageUndoNotice'
import { BulkUploadReview } from './pending/BulkUploadReview'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'
import { usePermiso } from '@/lib/authz/PermisosProvider'

const QUEUE_PAGE = 200

function mensajeDe(e: unknown, porDefecto: string) {
  return e instanceof Error && e.message ? e.message : porDefecto
}

/** Los motivos distintos que devolvió el backend, sin repetirlos: 30 errores
 *  iguales son un motivo, no treinta líneas. */
function motivosDe(errores: { error: string }[]) {
  return Array.from(new Set(errores.map(e => e.error))).join(' · ')
}

/**
 * Por asignar (Entrega D, 15/10): la bandeja de lo que no se pudo asignar al subir.
 *
 * Ya no es una forma de subir. Se sube con "Subir documentos" (la MISMA revisión de
 * lote de Pendientes y de la ficha de empresa, sin contexto) y lo que esa revisión no
 * resolvió llega aquí con lo que ya se sabía. La lista se agrupa por lo que falta
 * (titular, tipo o ambos); el detalle muestra el documento grande con la propuesta ya
 * elegida y se resuelve con Asignar · Descartar; al asignar, pasa al siguiente.
 * Patrón de bandeja de excepciones (Ramp, Dext, Vanta).
 */
export function TriageWorkbench() {
  const qc = useQueryClient()
  const canEdit = usePermiso('documents.upload')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  // El ultimo lote aplicado, para poder revertirlo. No hace falta un registro
  // de operaciones: quien deshace es quien acaba de aplicar.
  const [ultimoLote, setUltimoLote] = useState<{ ids: string[]; mensaje: string } | null>(null)

  const queueKey = clavesCertificacion.cola(undefined)
  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => documentIngestApi.listQueue({ limit: QUEUE_PAGE }),
  })

  const rows = useMemo(() => ordenarPorLoQueFalta(queueQuery.data?.rows ?? []), [queueQuery.data])
  const total = queueQuery.data?.total ?? 0

  // La empresa de la selección. El formulario aplica un requisito de UNA
  // entidad, así que una selección que cruza empresas no tiene sentido: al
  // marcar un archivo de otra empresa la selección se reemplaza.
  const selectedCarrierId = useMemo(() => {
    const sel = rows.filter(r => selectedIds.has(r.id))
    if (!sel.length) return null
    const first = sel[0].carrier_id
    return sel.every(r => r.carrier_id === first) ? first : null
  }, [rows, selectedIds])

  const focusedRow = focusedId ? rows.find(r => r.id === focusedId) ?? null : null
  const subjectCarrierId = selectedCarrierId ?? focusedRow?.carrier_id ?? null

  const pendingQuery = useQuery({
    queryKey: clavesCertificacion.pendientes(subjectCarrierId ?? undefined),
    queryFn: () => complianceApi.listPending({ carrierId: subjectCarrierId!, limit: 200 }),
    enabled: !!subjectCarrierId,
  })

  const subjects = useMemo(() => {
    const seen = new Map<string, { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string; label: string }>()
    for (const r of pendingQuery.data?.rows ?? []) {
      const key = `${r.entity_type}:${r.entity_id}`
      if (!seen.has(key)) {
        seen.set(key, {
          entity_type: r.entity_type as 'CARRIER' | 'DRIVER' | 'ASSET',
          entity_id: r.entity_id,
          label: r.subject_name ?? r.carrier_name ?? 'Sin empresa',
        })
      }
    }
    return Array.from(seen.values())
  }, [pendingQuery.data])

  // Con nada marcado, el formulario opera sobre el archivo enfocado.
  const targetIds = selectedIds.size > 0
    ? rows.filter(r => selectedIds.has(r.id)).map(r => r.id)
    : (focusedId ? [focusedId] : [])

  // La vista previa se firma de a una, al enfocar — firmar el listado entero
  // es una llamada HTTP por archivo.
  const previewQuery = useQuery({
    queryKey: clavesCertificacion.vistaPrevia(focusedId),
    queryFn: () => documentIngestApi.previewUrl(focusedId!),
    enabled: !!focusedId && targetIds.length === 1,
  })

  const carrierLabel = rows.find(r => r.carrier_id === subjectCarrierId)?.carrier_name ?? null

  const previewItems = rows
    .filter(r => targetIds.includes(r.id))
    .map(r => ({
      id: r.id, file_name: r.file_name, mime_type: r.mime_type,
      size_bytes: r.size_bytes, storage_path: r.storage_path,
      match_status: r.match_status,
      preview_url: r.id === focusedId ? previewQuery.data?.preview_url ?? null : null,
    }))

  /** Lo que toda operación de la bandeja deja obsoleto: una sola función. Ver
   *  lib/queries/certificacion.ts. */
  function refrescarBandeja() {
    void invalidarCertificacion(qc)
  }

  /** Un archivo sin empresa: se le asigna en su detalle, que es donde se decide.
   *  Antes era un selector arriba de la pantalla, separado del archivo. */
  async function elegirEmpresa(c: CarrierSearchResult) {
    if (!targetIds.length) return
    await documentIngestApi.moveItems(targetIds, c.id)
    setNotice(`${targetIds.length === 1 ? 'El archivo' : `${targetIds.length} archivos`} ahora son de ${c.business_name}`)
    refrescarBandeja()
  }

  const undoMutation = useMutation({
    mutationFn: (ids: string[]) => documentIngestApi.undoClassify(ids),
    onSuccess: (res, ids) => {
      refrescarBandeja()
      if (!res.errors.length) {
        setUltimoLote(null)
        setNotice(res.reverted.length === 1
          ? '1 archivo volvió a Por asignar'
          : `${res.reverted.length} archivos volvieron a Por asignar`)
        return
      }
      // Con errores el aviso NO se cierra: cerrarlo pierde los ids y con ellos
      // el segundo intento.
      const pendientes = res.errors.map(e => e.item_id).filter(id => ids.includes(id))
      setUltimoLote({
        ids: pendientes.length ? pendientes : ids,
        mensaje: `No se pudieron revertir ${res.errors.length} de ${ids.length}: ${motivosDe(res.errors)}`,
      })
    },
    onError: e => setNotice(`No se pudo deshacer. ${mensajeDe(e, 'Intenta de nuevo.')}`),
  })
  const discardMutation = useMutation({
    // allSettled y no all: con `all` una baja que falla rechaza el conjunto,
    // no se invalida nada, no se muestra nada, y los que sí se borraron siguen
    // en pantalla.
    mutationFn: async (ids: string[]) => {
      const res = await Promise.allSettled(ids.map(id => documentIngestApi.remove(id)))
      return { ids, fallidos: ids.filter((_, i) => res[i].status === 'rejected') }
    },
    onSuccess: ({ ids, fallidos }) => {
      const ok = ids.length - fallidos.length
      setNotice(
        fallidos.length
          ? `${ok} de ${ids.length} descartados · `
            + (fallidos.length === 1 ? '1 no se pudo descartar' : `${fallidos.length} no se pudieron descartar`)
          : `${ok === 1 ? '1 descartado' : `${ok} descartados`}. Puedes restaurarlos en Descartados.`,
      )
      avanzarAlSiguiente(ids)
      setSelectedIds(new Set())
      refrescarBandeja()
    },
  })

  function clearSelection() {
    setSelectedIds(new Set())
    setFocusedId(null)
  }

  function handleToggle(id: string, opts?: { range?: boolean }) {
    setSelectedIds(prev => {
      const rowCarrier = rows.find(r => r.id === id)?.carrier_id ?? null
      const current = rows.filter(r => prev.has(r.id))
      const crossesCarrier = current.length > 0 && current.some(r => r.carrier_id !== rowCarrier)

      // Cruzar empresas reemplaza la selección en vez de sumarse.
      if (crossesCarrier) return new Set([id])

      if (opts?.range && focusedId) {
        const a = rows.findIndex(r => r.id === focusedId)
        const b = rows.findIndex(r => r.id === id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          const next = new Set(prev)
          for (const r of rows.slice(lo, hi + 1)) {
            if (r.carrier_id === rowCarrier) next.add(r.id)
          }
          return next
        }
      }

      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setFocusedId(id)
  }

  /** Mueve el foco al archivo que sigue después de sacar `aplicados` de la
   *  lista. Devuelve `null` cuando no queda ninguno — el final de la cola es
   *  un estado legítimo, no un error. */
  function avanzarAlSiguiente(aplicados: string[]) {
    const quedan = rows.filter(r => !aplicados.includes(r.id))
    if (!quedan.length) { setFocusedId(null); return }
    const i = rows.findIndex(r => r.id === (aplicados[0] ?? focusedId))
    // El que ocupa el lugar del que se fue; si era el último, el anterior.
    const siguiente = quedan.find((_, j) => rows.indexOf(quedan[j]) > i) ?? quedan[quedan.length - 1]
    setFocusedId(siguiente.id)
  }

  function handleApplied(appliedIds: string[], errores: { item_id: string; error: string }[] = []) {
    const quedan = Math.max(total - appliedIds.length, 0)
    setSelectedIds(new Set())
    // Esto es una COLA, no un formulario: el foco salta solo al que sigue. Se
    // calcula ANTES del refresco, sobre las filas que están en pantalla.
    avanzarAlSiguiente(appliedIds)
    refrescarBandeja()

    if (!appliedIds.length) {
      setNotice(errores.length
        ? `No se asignó ningún documento: ${motivosDe(errores)}`
        : 'No se asignó ningún documento')
      return
    }

    const partes = [
      appliedIds.length === 1 ? '1 archivo asignado' : `${appliedIds.length} archivos asignados`,
      quedan === 1 ? 'queda 1 por asignar' : `quedan ${quedan} por asignar`,
    ]
    if (errores.length) {
      partes.push(
        `${errores.length === 1 ? '1 no se pudo' : `${errores.length} no se pudieron`}`
        + `: ${motivosDe(errores)}`,
      )
    }
    setUltimoLote({ ids: appliedIds, mensaje: partes.join(' · ') })
  }

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-cifra font-bold text-text-primary leading-tight">
          Por asignar{queueQuery.isSuccess && total > 0 && <span className="ml-2 text-informativo tabular-nums">{total}</span>}
        </h1>
        <p className="text-dato text-informativo">Lo que no se pudo asignar al subir.</p>
      </div>
      {canEdit && <BulkUploadReview trigger="button" />}
    </div>
  )

  if (queueQuery.isSuccess && total === 0) {
    return (
      <div className="space-y-3">
        {header}
        {notice && <Aviso texto={notice} onCerrar={() => setNotice(null)} />}
        <div className="border border-border rounded-xl bg-white px-6 py-16 text-center">
          <CheckCircle2 size={28} className="mx-auto text-resuelto" aria-hidden="true" />
          <p className="mt-2 text-lectura font-semibold text-text-primary">Todo asignado</p>
          <p className="mt-1 text-dato text-informativo">
            Si te llegó una tanda de documentos por correo, súbela: el sistema propone a quién va cada uno.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {header}

      {ultimoLote && (
        <TriageUndoNotice
          mensaje={ultimoLote.mensaje}
          deshaciendo={undoMutation.isPending}
          onDeshacer={() => undoMutation.mutate(ultimoLote.ids)}
          onCerrar={() => setUltimoLote(null)}
        />
      )}

      <div className="border border-border rounded-xl bg-white overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
          <section aria-label="Archivos por asignar" className="min-w-0 lg:border-r border-border">
            {canEdit && (
              <TriageBulkBar
                selectedCount={selectedIds.size}
                targetIds={targetIds}
                currentCarrierId={selectedCarrierId}
                onDiscard={() => discardMutation.mutate(targetIds)}
                onClear={clearSelection}
                onMoved={n => {
                  setNotice(n === 1 ? '1 archivo movido' : `${n} archivos movidos`)
                  clearSelection()
                  refrescarBandeja()
                }}
              />
            )}

            <div className="overflow-y-auto max-h-[64vh]">
              {queueQuery.isPending ? (
                <Estado tipo="cargando" />
              ) : queueQuery.isError ? (
                // H2: un error de la cola NUNCA se muestra como una cola vacía.
                <Estado tipo="error" titulo="No se pudo cargar Por asignar" detalle="Los documentos siguen guardados.">
                  <button type="button" onClick={() => { void queueQuery.refetch() }}
                          className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
                    Reintentar
                  </button>
                </Estado>
              ) : (
                <TriageFileTable
                  rows={rows}
                  focusedId={focusedId}
                  selectedIds={selectedIds}
                  onFocus={setFocusedId}
                  onToggle={handleToggle}
                  // "Marcar todo" respeta la MISMA regla que `handleToggle`: una
                  // selección no cruza empresas.
                  onToggleAll={() => setSelectedIds(prev => {
                    if (prev.size > 0) return new Set()
                    const empresa = subjectCarrierId ?? rows[0]?.carrier_id ?? null
                    return new Set(rows.filter(r => r.carrier_id === empresa).map(r => r.id))
                  })}
                />
              )}
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-t border-border bg-bg-main">
              <p className="text-etiqueta text-informativo">
                <kbd className="font-sans">↑↓</kbd> mover · <kbd className="font-sans">Enter</kbd> asignar ·{' '}
                <kbd className="font-sans">space</kbd> marcar
              </p>
              {rows.length < total && (
                <p className="text-etiqueta text-informativo tabular-nums">Mostrando {rows.length} de {total}</p>
              )}
            </div>
          </section>

          <section aria-label="Detalle del archivo" className="min-w-0 border-t lg:border-t-0 border-border p-3 space-y-3">
            {/* El documento grande primero: se asigna leyendo el papel. */}
            {targetIds.length > 0 && <TriagePreview items={previewItems} />}
            <TriageClassifyForm
              // Otro archivo, otro formulario: la propuesta se elige de nuevo y no
              // queda pegado lo que se eligió para el anterior.
              key={targetIds.join(',')}
              targetIds={canEdit ? targetIds : []}
              subjects={subjects}
              carrierLabel={carrierLabel}
              pendingRows={pendingQuery.data?.rows ?? []}
              pendingState={!subjectCarrierId ? 'ready' : pendingQuery.isPending ? 'loading' : pendingQuery.isError ? 'error' : 'ready'}
              onRetryPending={() => { void pendingQuery.refetch() }}
              onApplied={handleApplied}
              suggestion={targetIds.length === 1 && focusedRow ? {
                entity_type: focusedRow.suggested_entity_type,
                entity_id: focusedRow.suggested_entity_id,
                requirement_id: focusedRow.suggested_requirement_id,
              } : null}
              onPickCarrier={canEdit ? elegirEmpresa : undefined}
              onDiscard={canEdit && targetIds.length === 1 ? () => discardMutation.mutate(targetIds) : undefined}
            />
          </section>
        </div>
      </div>

      {notice && <Aviso texto={notice} onCerrar={() => setNotice(null)} />}
    </div>
  )
}

/** El aviso sin deshacer. El tono oscuro es el mismo token que el aviso de
 *  deshacer (`bg-text-primary`). */
function Aviso({ texto, onCerrar }: { texto: string; onCerrar: () => void }) {
  return (
    <div data-testid="triage-notice"
         className="inline-flex items-center gap-3 bg-text-primary text-white text-etiqueta rounded-lg pl-3 pr-2 py-1.5 shadow-sm">
      <span>{texto}</span>
      <button type="button" onClick={onCerrar} aria-label="Cerrar aviso"
              className="p-0.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors">
        <X size={12} />
      </button>
    </div>
  )
}
