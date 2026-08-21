'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { documentIngestApi } from '@/lib/api/documentIngest'
import { useCanEdit } from '@/hooks/useCanEdit'
import type { IngestUploadResult } from '@/lib/types'
import { CarrierSearchPicker, type CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'
import { TriageBulkBar } from './TriageBulkBar'
import { TriageClassifyForm } from './TriageClassifyForm'
import { TriageDropzone } from './TriageDropzone'
import { TriageFileTable } from './TriageFileTable'
import { TriagePreview } from './TriagePreview'
import { TriageUndoNotice } from './TriageUndoNotice'
import { Cifra } from '@/components/ui/Cifra'
import { clavesCertificacion, invalidarCertificacion } from '@/lib/queries/certificacion'

interface Props {
  /** Sin empresa = la cola global (la bandeja). Con empresa = acotada a esa
   *  empresa (la ficha). Es una sola prop opcional, no dos modos. */
  carrierId?:   string
  carrierName?: string
  /** Acota el panel a un conductor o vehículo concreto: entrando desde su
   *  ficha, lo único que interesa es lo que le falta a él. */
  subject?: { entity_type: 'CARRIER' | 'DRIVER' | 'ASSET'; entity_id: string }
  /** La empresa con la que llega el lote, cuando se entró desde la ficha de
   *  una. No es lo mismo que `carrierId`: acá la cola SIGUE siendo global —se
   *  ve todo lo que espera— y esto sólo dice de quién es lo que se va a subir,
   *  que es exactamente lo que el selector pregunta. Se puede cambiar. */
  empresaInicial?: CarrierSearchResult | null
}

const QUEUE_PAGE = 200

/** El backend corta en 50 archivos por request (`_MAX_FILES_PER_UPLOAD`) y
 *  devuelve 422. Soltar la carpeta de 120 documentos —el caso de uso que
 *  justifica toda la bandeja— mandaba los 120 en una sola tanda y no subía
 *  nada. Se parte acá, del lado del cliente, y los lotes van encadenados. */
const LOTE_DE_SUBIDA = 50


function mensajeDe(e: unknown, porDefecto: string) {
  return e instanceof Error && e.message ? e.message : porDefecto
}

/** Los motivos distintos que devolvió el backend, sin repetirlos: 30 errores
 *  iguales son un motivo, no treinta líneas. */
function motivosDe(errores: { error: string }[]) {
  return Array.from(new Set(errores.map(e => e.error))).join(' · ')
}

/** La bandeja de trabajo: tabla, barra contextual y panel de detalle. Cero
 *  modales.
 *
 *  Reemplaza al par panel + modal de clasificación, que costaba ~5 clics por
 *  documento. Acá el formulario aplica a todo lo marcado: con un archivo
 *  clasifica ese, con quince aplica a los quince. */
export function TriageWorkbench({ carrierId, carrierName, subject, empresaInicial }: Props) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<{ file_name: string; error: string }[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  // Cuántos archivos de la tanda ya se subieron. El avance es por lote, no
  // dentro del lote: fingir un porcentaje dentro de un request sería inventarlo.
  const [subidos, setSubidos] = useState(0)
  // El ultimo lote aplicado, para poder revertirlo. No hace falta un registro
  // de operaciones: quien deshace es quien acaba de aplicar.
  const [ultimoLote, setUltimoLote] = useState<{ ids: string[]; mensaje: string } | null>(null)
  // Sólo tiene sentido en la bandeja global (`carrierId` ya trae la empresa):
  // deja acotar el universo del clasificador ANTES de soltar los archivos.
  // Es opcional a propósito — la tanda mezclada que llega por correo es un
  // caso legítimo, y exigirla convertiría la bandeja en un buscador.
  const [busqueda, setBusqueda] = useState('')
  /** La empresa que se ELIGIÓ acá. `null` significa "todavía nadie eligió", no
   *  "ninguna": la que llega por el enlace se resuelve abajo con un COALESCE y
   *  no sembrando este estado, que es como este frontend ya tuvo tres veces el
   *  mismo bug (un estado inicial que no se resincroniza cuando el prop del
   *  que salió cambia). Elegir acá gana; sin elección, manda la del enlace. */
  const [empresaElegida, setEmpresaElegida] = useState<CarrierSearchResult | null>(null)
  const empresaDelLote = empresaElegida ?? empresaInicial ?? null

  /** Sin nada marcado, la pantalla está en modo "subir"; con algo marcado,
   *  en modo "mover". Un solo nombre para la condición porque gobierna las
   *  dos mitades de la zona de carga y el camino de soltar-en-cualquier-parte:
   *  escribirla tres veces es como se separaron la primera vez. */
  const sinSeleccion = selectedIds.size === 0

  const queueKey = clavesCertificacion.cola(carrierId)
  const queueQuery = useQuery({
    queryKey: queueKey,
    queryFn: () => documentIngestApi.listQueue({ carrierId, limit: QUEUE_PAGE }),
  })

  const rows = queueQuery.data?.rows ?? []
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

  const subjectCarrierId = selectedCarrierId
    ?? (focusedId ? rows.find(r => r.id === focusedId)?.carrier_id ?? null : null)

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
          label: r.subject_name ?? r.carrier_name,
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

  const grupos = new Set(rows.map(r => r.carrier_id)).size

  const carrierLabel = rows.find(r => r.carrier_id === (selectedCarrierId ?? subjectCarrierId))?.carrier_name ?? null

  const previewItems = rows
    .filter(r => targetIds.includes(r.id))
    .map(r => ({
      id: r.id, file_name: r.file_name, mime_type: r.mime_type,
      size_bytes: r.size_bytes, storage_path: r.storage_path,
      match_status: r.match_status,
      preview_url: r.id === focusedId ? previewQuery.data?.preview_url ?? null : null,
    }))

  /** Lo que toda operación de la bandeja deja obsoleto: una sola función,
   *  compartida con el cajón. Ver lib/queries/certificacion.ts. */
  function refrescarBandeja() {
    void invalidarCertificacion(qc)
  }

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const items: IngestUploadResult['items'] = []
      const errores: IngestUploadResult['errors'] = []
      setSubidos(0)
      for (let i = 0; i < files.length; i += LOTE_DE_SUBIDA) {
        const lote = files.slice(i, i + LOTE_DE_SUBIDA)
        // Encadenados, no en paralelo: cada lote sube sus archivos a Storage y
        // lanzar tres tandas de 50 a la vez es pelearle ancho de banda a las
        // otras dos.
        const res = await documentIngestApi.upload(carrierId ?? empresaDelLote?.id, lote)
        items.push(...res.items)
        errores.push(...res.errors)
        // Se publican mientras avanza: si un lote posterior falla, lo que ya
        // se sabe no se pierde con el throw.
        setErrors([...errores])
        setSubidos(i + lote.length)
      }
      return { items, errors: errores }
    },
    onSuccess: res => { setErrors(res.errors); refrescarBandeja() },
    onError: e => {
      // Sin esto la zona volvía al estado vacío, sin un solo mensaje, y quien
      // soltó 120 archivos se quedaba creyendo que se subieron.
      setNotice(`No se pudieron subir todos los archivos. ${mensajeDe(e, 'Intenta de nuevo.')}`)
      refrescarBandeja()
    },
  })
  const undoMutation = useMutation({
    mutationFn: (ids: string[]) => documentIngestApi.undoClassify(ids),
    onSuccess: (res, ids) => {
      // Deshacer es la operación inversa de aplicar: invalida el mismo
      // conjunto, para que el contador del sidebar no quede contradiciendo a
      // la lista hasta que venza su staleTime.
      refrescarBandeja()
      if (!res.errors.length) {
        setUltimoLote(null)
        setNotice(res.reverted.length === 1
          ? '1 archivo volvió a la bandeja'
          : `${res.reverted.length} archivos volvieron a la bandeja`)
        return
      }
      // Con errores el aviso NO se cierra: cerrarlo pierde los ids y con ellos
      // el segundo intento. Se queda con los que siguen pendientes y con el
      // motivo real, que no siempre es "ya tenía un documento anterior".
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
          : ok === 1 ? '1 descartado' : `${ok} descartados`,
      )
      clearSelection()
      refrescarBandeja()
    },
  })

  const { mutate: subirArchivos } = uploadMutation

  function clearSelection() {
    setSelectedIds(new Set())
    setFocusedId(null)
  }

  function handleFiles(list: FileList | File[]) {
    const files = Array.from(list)
    if (files.length) subirArchivos(files)
  }

  // Soltar un archivo FUERA del recuadro hacía que el navegador navegara al
  // archivo y sacara a la persona de la aplicación. Con esto, soltar en
  // cualquier parte de la pantalla lo encamina a la bandeja.
  useEffect(() => {
    if (!canEdit) return
    const prevenir = (e: DragEvent) => e.preventDefault()
    const soltar = (e: DragEvent) => {
      // NO BORRAR. Este listener está en `window`, así que también recibe el
      // drop que ya atendió la zona de carga cuando burbujea hasta acá: sin
      // esta guarda, soltar SOBRE el recuadro —el gesto más probable de
      // todos— corría los dos caminos y subía cada archivo DOS VECES, a la
      // bandeja global y a la ficha de empresa por igual.
      //
      // Se mira `defaultPrevented` en vez de cortar la burbuja desde la zona
      // (`stopPropagation`) porque acá protege a cualquier superficie de drop
      // que exista hoy o se agregue después: le basta con hacer
      // `preventDefault`, que igual está obligada a hacer para que el
      // navegador no navegue al archivo.
      if (e.defaultPrevented) return
      // `preventDefault` PRIMERO y siempre: es lo único que impide que el
      // navegador abra el archivo y saque a la persona de la aplicación.
      e.preventDefault()
      // Con selección activa la zona de carga no está en pantalla, y con ella
      // se fue el único indicador de a qué empresa se atribuiría el lote.
      // Subir por este camino sería hacerlo en silencio y en nombre de una
      // empresa invisible.
      if (!sinSeleccion) {
        setNotice('Termina con los archivos seleccionados antes de subir otros.')
        return
      }
      const files = e.dataTransfer?.files
      if (files?.length) subirArchivos(Array.from(files))
    }
    window.addEventListener('dragover', prevenir)
    window.addEventListener('drop', soltar)
    return () => {
      window.removeEventListener('dragover', prevenir)
      window.removeEventListener('drop', soltar)
    }
  }, [canEdit, subirArchivos, sinSeleccion])

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

  function handleApplied(appliedIds: string[], errores: { item_id: string; error: string }[] = []) {
    const quedan = Math.max(total - appliedIds.length, 0)
    clearSelection()
    refrescarBandeja()

    // Sin nada aplicado no hay nada que deshacer: el aviso de abajo, que es el
    // que se reserva para lo que no tiene vuelta atrás.
    if (!appliedIds.length) {
      setNotice(errores.length
        ? `No se clasificó ningún documento: ${motivosDe(errores)}`
        : 'No se clasificó ningún documento')
      return
    }

    // Un solo aviso para un solo evento. El conteo restante se pliega acá
    // dentro en vez de abrir un segundo cartel abajo que dice lo mismo.
    const partes = [
      appliedIds.length === 1 ? '1 archivo clasificado' : `${appliedIds.length} archivos clasificados`,
      quedan === 1 ? 'queda 1 sin clasificar' : `quedan ${quedan} sin clasificar`,
    ]
    if (errores.length) {
      partes.push(
        `${errores.length === 1 ? '1 no se pudo' : `${errores.length} no se pudieron`}`
        + `: ${motivosDe(errores)}`,
      )
    }
    setUltimoLote({ ids: appliedIds, mensaje: partes.join(' · ') })
  }

  return (
    <div className="space-y-3">
      {/* La ZONA DE CARGA entera —el selector del lote y la zona de arrastre—
          se retira mientras hay selección: la barra contextual es la dueña de
          ese modo, y subir y mover son dos gestos distintos que no se pisan.

          Dos cajas de "Buscar empresa" a la vez —ésta y la de
          MoveToCarrierBar— significan cosas distintas ("¿de quién es lo que
          voy a subir?" vs. "¿a qué empresa muevo lo seleccionado?") sin que
          elegir en la equivocada avise nada. Y esconder sólo el selector era
          peor: `empresaDelLote` seguía gobernando la zona de arrastre, así que
          una segunda tanda se subía atribuida a una empresa QUE YA NO SE VE.
          El estado no se pierde, sólo deja de mostrarse: vuelve con lo ya
          elegido en cuanto la selección se vacía. */}
      {canEdit && !carrierId && sinSeleccion && (
        <div>
          <p className="text-etiqueta text-informativo pb-1">
            ¿De quién son estos documentos? Elegir la empresa hace que el sistema
            reconozca mejor a quién pertenece cada archivo.
          </p>
          {/* La empresa elegida, DICHA. Sin esto, el estado gobierna a qué
              empresa se atribuye la tanda sin estar en pantalla — el mismo
              defecto que tenía esconder el selector con la selección activa.
              Y es lo que hace visible la preselección que trae el enlace. */}
          {empresaDelLote && (
            <p className="text-etiqueta text-text-primary font-semibold pb-1">
              Este lote es de {empresaDelLote.business_name}
            </p>
          )}
          <CarrierSearchPicker
            query={busqueda}
            onQueryChange={setBusqueda}
            onPick={c => setEmpresaElegida(c)}
            selectedId={empresaDelLote?.id ?? null}
            size="sm"
            placeholder="Buscar empresa (opcional)…"
          />
        </div>
      )}

      {canEdit && sinSeleccion && (
        <TriageDropzone
          carrierName={carrierName}
          vacia={!queueQuery.isPending && total === 0}
          subiendo={uploadMutation.isPending}
          // React Query conserva las variables de la mutación en vuelo: es de
          // donde sale cuántos archivos tiene la tanda que se está subiendo.
          enVuelo={uploadMutation.variables?.length}
          subidos={subidos}
          errores={errors}
          onArchivos={handleFiles}
        />
      )}

      {ultimoLote && (
        <TriageUndoNotice
          mensaje={ultimoLote.mensaje}
          deshaciendo={undoMutation.isPending}
          onDeshacer={() => undoMutation.mutate(ultimoLote.ids)}
          onCerrar={() => setUltimoLote(null)}
        />
      )}

      {/* Un solo lienzo con dos regiones rotuladas, no dos tarjetas sueltas: la
          pantalla tiene que decir sola que el orden es elegir y despues
          clasificar. */}
      <div className="border border-border rounded-xl bg-white overflow-hidden">
        <div className="flex items-baseline gap-2 px-4 py-3 border-b border-border">
          <Cifra valor={total} etiqueta="sin clasificar" />
          {grupos > 0 && (
            <span className="text-xs text-gray-500">
              · {grupos === 1 ? '1 empresa' : `${grupos} empresas`}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
          <section aria-label="Elige los documentos" className="min-w-0 lg:border-r border-border">
            <h2 className="px-3 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <span className="text-accent">1</span> · Elige los documentos
            </h2>

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

            <div className="overflow-y-auto max-h-[54vh]">
              {queueQuery.isPending ? (
                <p className="text-[11px] text-gray-500 p-3 flex items-center gap-1.5">
                  <Loader2 size={11} className="motion-safe:animate-spin" /> Cargando…
                </p>
              ) : (
                <TriageFileTable
                  rows={rows}
                  focusedId={focusedId}
                  selectedIds={selectedIds}
                  onFocus={setFocusedId}
                  onToggle={handleToggle}
                  // "Marcar todo" respeta la MISMA regla que `handleToggle`:
                  // una selección no cruza empresas. Sin esto era la única
                  // puerta por la que se colaba una selección heterogénea, y
                  // aguas abajo `selectedCarrierId` y `carrierLabel` caen a
                  // null — o sea que la pantalla deja de saber de quién es lo
                  // que está marcado, justo antes de ofrecer moverlo.
                  //
                  // "Todo" pasa a ser "todo lo de la empresa que ya está en
                  // foco"; sin foco ni selección, la primera empresa de la
                  // lista. En la bandeja de UNA empresa (`carrierId`) no
                  // cambia nada: ahí todas las filas comparten empresa.
                  onToggleAll={() => setSelectedIds(prev => {
                    if (prev.size > 0) return new Set()
                    const empresa = subjectCarrierId ?? rows[0]?.carrier_id ?? null
                    return new Set(
                      rows.filter(r => r.carrier_id === empresa).map(r => r.id),
                    )
                  })}
                />
              )}
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-t border-border bg-gray-50/60">
              <p className="text-[10px] text-gray-500">
                <kbd className="font-sans">↑↓</kbd> mover ·{' '}
                <kbd className="font-sans">space</kbd> marcar ·{' '}
                <kbd className="font-sans">⇧+click</kbd> rango
              </p>
              {rows.length < total && (
                <p className="text-[10px] text-gray-500 tabular-nums">
                  Mostrando {rows.length} de {total}
                </p>
              )}
            </div>
          </section>

          <section aria-label="Indica qué son" className="min-w-0 border-t lg:border-t-0 border-border">
            <h2 className="px-3 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <span className="text-accent">2</span> · Indica qué son
            </h2>
            <div className="p-3 pt-1 space-y-3">
              <TriageClassifyForm
                targetIds={canEdit ? targetIds : []}
                subjects={subjects}
                carrierLabel={carrierLabel}
                pendingRows={(pendingQuery.data?.rows ?? []).filter(
                  r => !subject || (r.entity_type === subject.entity_type && r.entity_id === subject.entity_id),
                )}
                onApplied={handleApplied}
                onMovedToCarrier={() => {
                  setNotice('Empresa asignada')
                  refrescarBandeja()
                }}
              />
              {targetIds.length > 0 && <TriagePreview items={previewItems} />}
            </div>
          </section>
        </div>
      </div>

      {/* El aviso sin deshacer. El tono oscuro es el mismo token que el aviso
          de deshacer (`bg-text-primary`): eran dos negros distintos para dos
          carteles que la persona ve juntos. */}
      {notice && (
        <div
          data-testid="triage-notice"
          className="inline-flex items-center gap-3 bg-text-primary text-white text-[11px] rounded-lg pl-3 pr-2 py-1.5 shadow-sm"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="p-0.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
