'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { revisionesApi, type Revision } from '@/lib/api/config'

/** El id del chip "Sin revisar", compartido por las listas que lo ofrecen. */
export const SIN_REVISAR = 'sin-revisar'

/** El registro de revisión, del lado de la pantalla.
 *
 *  Hoy una condición vacía significa DOS cosas: "lo revisamos y va para todos"
 *  y "nadie lo miró". Es la misma clase de defecto que apareció cinco veces en
 *  el Tramo 3, y tiene consecuencia medible: 16 remolques tienen exigida
 *  Mantención de Cámara de Frío sin poder tenerla, no porque alguien decidiera
 *  mal sino porque nadie decidió.
 *
 *  El mecanismo es común a todas las secciones; lo único propio de cada una es
 *  qué elementos enumera, y eso lo declara el backend. Acá no hay ni un `if`
 *  por dominio: si alguna vez hace falta, el diseño se rompió. */
export function useRevisiones(dominio: string, seccion: string) {
  const qc = useQueryClient()
  const clave = ['config-revisiones', dominio, seccion]

  const q = useQuery({
    queryKey: clave,
    queryFn: () => revisionesApi.list(dominio, seccion),
  })

  const confirmar = useMutation({
    mutationFn: (elementId: string) => revisionesApi.confirm(dominio, seccion, elementId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clave })
      // La portada cuenta lo mismo: si no se invalida, el número de la
      // pantalla anterior sigue diciendo que falta algo que ya se resolvió.
      qc.invalidateQueries({ queryKey: ['config-inventario'] })
    },
  })

  const porElemento = useMemo(() => {
    const mapa = new Map<string, Revision>()
    for (const r of q.data ?? []) mapa.set(r.element_id, r)
    return mapa
  }, [q.data])

  return {
    // `undefined` mientras carga, para que la insignia no diga "sin revisar"
    // durante el viaje de ida: sería la tercera vez que un estado transitorio
    // se dibuja igual que un hecho.
    revisionDe: (id: string): Revision | null | undefined =>
      q.isPending ? undefined : porElemento.get(id) ?? null,
    sinRevisar: (id: string) => !q.isPending && !porElemento.has(id),
    /** Los datos crudos. Existe para que un `useMemo` que filtre por revisión
     *  pueda depender de ELLOS: las funciones de arriba se recrean en cada
     *  render y no sirven como identidad, y depender de un booleano de la
     *  mutación deja de cambiar a partir de la segunda confirmación. */
    datos: q.data,
    cargando: q.isPending,
    confirmar,
  }
}

const FECHA = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })

function cuando(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : FECHA.format(d)
}

/** La insignia de una fila: quién la revisó, o que nadie lo hizo.
 *
 *  Rojo NO: `--espera` tiene un solo significado en esta app —hay archivos
 *  esperando— y gastarlo acá lo desafina. Sin revisar es ámbar: algo que falta
 *  decidir, no algo que está mal. */
export function MarcaDeRevision({ revision }: { revision: Revision | null | undefined }) {
  if (revision === undefined) {
    return <span className="inline-block w-20 h-3 bg-gray-100 rounded animate-pulse align-middle" />
  }
  if (!revision) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5
                       text-[10px] font-semibold text-amber-700">
        Sin revisar
      </span>
    )
  }
  return (
    <span className="text-[11px] text-gray-400">
      {revision.reviewed_by ? `${revision.reviewed_by} · ` : ''}{cuando(revision.reviewed_at)}
    </span>
  )
}

/** "Lo miré y está bien así".
 *
 *  Sólo aparece si NO está revisado: un botón que confirma lo ya confirmado no
 *  ofrece nada y compite por la atención con el que sí importa. */
export function BotonConfirmar({
  revisado, pendiente, onConfirmar, children = 'Está bien así',
}: {
  revisado:    boolean
  pendiente:   boolean
  onConfirmar: () => void
  children?:   React.ReactNode
}) {
  if (revisado) return null
  return (
    <button
      type="button"
      onClick={onConfirmar}
      disabled={pendiente}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5
                 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {pendiente ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      {children}
    </button>
  )
}

/** El chip de filtro, sincronizado con el enlace que trae la portada.
 *
 *  La portada enlaza a `?revision=pendiente`, así que la lista abre con el
 *  filtro puesto. Al cambiarlo se quita el parámetro: si quedara, la URL diría
 *  "estoy viendo lo pendiente" mientras la pantalla muestra otra cosa — el
 *  mismo desajuste que ya hubo con una sección inventada. */
export function useChipDeRevision(): [string | null, (id: string | null) => void] {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [filtro, setFiltro] = useState<string | null>(
    () => (searchParams.get('revision') === 'pendiente' ? SIN_REVISAR : null),
  )

  const elegir = useCallback((id: string | null) => {
    setFiltro(id)
    if (!searchParams.get('revision')) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete('revision')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [router, pathname, searchParams])

  return [filtro, elegir]
}

/** La celda de revisión de una tabla que se edita fila por fila.
 *
 *  Acá el gesto de confirmar VA EN LA FILA porque estas tablas no tienen panel:
 *  su botón de guardar también está en la fila, y mandar sólo la confirmación a
 *  otro lado sería inconsistente. Donde sí hay panel —Condiciones, Estados del
 *  tablero— la fila muestra la marca y el gesto vive en el panel, para no
 *  devolverle un control por fila a una lista que se rediseñó para no tenerlos. */
export function CeldaDeRevision({
  id, revisiones,
}: {
  id: string
  revisiones: ReturnType<typeof useRevisiones>
}) {
  const revision = revisiones.revisionDe(id)
  if (revision === undefined || revision) return <MarcaDeRevision revision={revision} />
  return (
    <button
      type="button"
      onClick={() => revisiones.confirmar.mutate(id)}
      disabled={revisiones.confirmar.isPending}
      title="Lo miré y está bien así"
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5
                 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {revisiones.confirmar.isPending
        ? <Loader2 size={10} className="animate-spin" aria-hidden="true" />
        : <Check size={10} aria-hidden="true" />}
      Sin revisar
    </button>
  )
}
