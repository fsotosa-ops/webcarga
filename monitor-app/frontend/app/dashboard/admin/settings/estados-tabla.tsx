'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { configApi, type TripStatusRow } from '@/lib/api/config'
import { CABECERA, EncabezadoOrdenable } from '@/components/ui/tabla/EncabezadoOrdenable'
import { useOrden } from '@/components/ui/tabla/useOrden'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { EstadoPanel } from './EstadoPanel'
import { MarcaDeRevision, SIN_REVISAR, useChipDeRevision, useRevisiones } from './revision'
import { GROUP_OPTIONS, LoadState } from './shared'


// Las columnas del tablero salen del propio dato, no de una lista escrita a
// mano: si mañana se agrega una columna nueva, el chip aparece solo. Sólo se
// usa GROUP_OPTIONS para traducir el id a una etiqueta legible — no para
// decidir qué chips existen.
function columnasDe(filas: TripStatusRow[]) {
  const cuenta = new Map<string, number>()
  for (const f of filas) {
    if (!f.group) continue
    cuenta.set(f.group, (cuenta.get(f.group) ?? 0) + 1)
  }
  return [...cuenta].map(([id, n]) => ({
    id, etiqueta: GROUP_OPTIONS.find(g => g.id === id)?.label ?? id, n,
  }))
}

/** Los 25 estados del tablero, como lista.
 *
 *  Antes eran 25 filas con ocho pastillas de color cada una: 300 controles,
 *  de los cuales 250 eran la misma paleta repetida. La pastilla renderizada
 *  YA es la vista previa, así que la lista no dibuja ni una sola pastilla de
 *  color — el color se elige en el panel. */
export function EstadosTabla() {
  const q = useQuery({ queryKey: ['tms-statuses'], queryFn: () => configApi.getStatuses() })
  const { orden, ordenarPor, comparar } = useOrden({ columna: 'orden', direccion: 'asc' })
  // Dos filtros que no compiten: el de columna del tablero y el de revisión.
  // Se resuelven con la misma barra de chips porque son la misma pregunta
  // ("qué parte de la lista quiero ver"), y sólo uno puede estar activo.
  const [columna, setColumna] = useChipDeRevision()
  const revisiones = useRevisiones('operations', 'tms-statuses')

  // El estado abierto VIAJA EN LA URL, igual que un documento de Condiciones:
  // editar un estado se puede enlazar y recargar no devuelve a la lista.
  // Cerrar quita el parámetro, y el resto de la URL (la sección) se conserva.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const abierto = searchParams.get('estado')

  const abrir = useCallback((id: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('estado', id)
    else params.delete('estado')
    const qs = params.toString()
    const destino = qs ? `${pathname}?${qs}` : pathname
    // Mismo patrón que Condiciones: ABRIR el panel es `push` y cerrarlo es
    // `replace`. Así el botón de atrás del navegador cierra el panel en vez
    // de sacar de la pantalla entera, y cerrar no ensucia el historial.
    if (id) router.push(destino)
    else router.replace(destino)
  }, [router, pathname, searchParams])

  const todos = useMemo(() => q.data ?? [], [q.data])

  const chips = useMemo(() => [
    { id: SIN_REVISAR, etiqueta: 'Sin revisar', n: todos.filter(s => revisiones.sinRevisar(s.id)).length },
    ...columnasDe(todos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [todos, revisiones.datos])

  // El orden del tablero, siempre completo y siempre por sort_order: es contra
  // esta lista —no contra la filtrada ni contra la que el usuario reordenó por
  // otra columna— que el panel intercambia posiciones.
  const porOrden = useMemo(() => [...todos].sort((a, b) => a.sort_order - b.sort_order), [todos])

  const filas = useMemo(() => {
    const f = columna === SIN_REVISAR
      ? todos.filter(s => revisiones.sinRevisar(s.id))
      : columna ? todos.filter(s => s.group === columna) : todos
    return comparar(f, s => (orden?.columna === 'visible' ? s.label : s.sort_order))
    // `comparar` y `revisiones.sinRevisar` se recrean en cada render; lo que
    // cambia el resultado ya está acá.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, columna, orden, revisiones.datos])

  // El panel se dibuja desde el dato del catálogo, no desde la fila clicada:
  // así recargar con `?estado=` en la URL lo abre igual, sin haber pasado por
  // la lista. Un id que no existe simplemente no abre nada.
  const estadoAbierto = todos.find(s => s.id === abierto)

  if (q.isPending || q.isError) {
    return (
      <div className="p-1">
        <LoadState
          loading={q.isPending}
          error={q.isError ? 'No se pudieron cargar los estados' : null}
          onRetry={() => q.refetch()}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="pb-3">
        <ChipsDeFiltro opciones={chips} activo={columna} onElegir={setColumna} />
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50/60 border-y border-border">
            <EncabezadoOrdenable columna="visible" orden={orden} onOrdenar={ordenarPor}>Cómo se ve</EncabezadoOrdenable>
            <th scope="col" className={CABECERA}>Nombre en el TMS</th>
            <th scope="col" className={CABECERA}>Columna</th>
            <EncabezadoOrdenable columna="orden" orden={orden} onOrdenar={ordenarPor}>Orden</EncabezadoOrdenable>
            <th scope="col" className={CABECERA}>Revisión</th>
            <th scope="col" className="w-9" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {filas.map(s => (
            <tr key={s.id} className="border-b border-border/70 hover:bg-gray-50/60">
              <td className="px-3 py-2.5">
                {/* La pastilla renderizada YA es la vista previa: por eso la
                    lista no necesita ni una sola pastilla de color. */}
                <span
                  className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                  style={{ backgroundColor: s.bg_color, color: s.text_color }}
                >
                  {s.label || '—'}
                </span>
              </td>
              {/* El nombre crudo se conserva visible: si alguien cambia el
                  nombre visible, es lo único que permite reconocer de qué
                  estado se trata. */}
              <td className="px-3 py-2.5 text-[11px] text-gray-400 font-mono">{s.id}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700">
                {GROUP_OPTIONS.find(g => g.id === s.group)?.label ?? s.group ?? '—'}
              </td>
              <td className="px-3 py-2.5 text-xs text-gray-400 tabular-nums">{s.sort_order}</td>
              {/* La marca en la fila, el gesto en el panel: 25 botones de
                  confirmar serían los mismos controles por fila que este
                  rediseño vino a sacar. */}
              <td className="px-3 py-2.5"><MarcaDeRevision revision={revisiones.revisionDe(s.id)} /></td>
              <td className="pr-2">
                <button
                  type="button"
                  onClick={() => abrir(s.id)}
                  aria-label={`Editar ${s.label}`}
                  className="text-gray-300 hover:text-gray-500 focus-visible:outline-none
                             focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">
                Ningún estado coincide con el filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {estadoAbierto && (
        <EstadoPanel
          key={estadoAbierto.id}
          estado={estadoAbierto}
          hermanos={porOrden}
          revision={revisiones.revisionDe(estadoAbierto.id)}
          onConfirmar={() => revisiones.confirmar.mutate(estadoAbierto.id)}
          confirmando={revisiones.confirmar.isPending}
          onCerrar={() => abrir(null)}
        />
      )}
    </div>
  )
}
