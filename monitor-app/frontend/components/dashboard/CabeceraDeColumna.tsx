'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter } from 'lucide-react'

export type Direccion = 'asc' | 'desc'
export type Orden = { columna: string; dir: Direccion } | null

/**
 * Una columna que se ordena y se filtra, como en una planilla.
 *
 * POR QUÉ EXISTE. La tabla del cierre llegaba ordenada por nombre y sin más:
 * con 81 tractos y 38 conductores, encontrar "los de CD Lo Aguirre" o "los que
 * están Por regularizar" era leer la lista entera. Pedido del usuario (07/09):
 * *"tiene que permitir que las columnas funcionen como un excel, ordenar
 * alfabéticamente (asc/desc) y filtrar por los valores que tiene la columna...
 * tiene que permitir un filtro múltiple"*.
 *
 * Los valores del filtro NO son un catálogo fijo: salen de las filas que hay,
 * así que el desplegable nunca ofrece algo que no existe en la tabla. Es la
 * misma lección del click-through de agosto — un desplegable que lista todo el
 * padrón hace elegir a ojo.
 *
 * El orden cicla en tres pasos —asc, desc, sin orden— y no en dos: volver al
 * orden natural sin recargar la página es parte de poder explorar.
 */
export function CabeceraDeColumna({
  id, titulo, valores, orden, onOrden, seleccionados, onFiltro, alineacion = 'left',
}: {
  id:            string
  titulo:        string
  /** Los valores distintos presentes en esta columna, ya ordenados. */
  valores:       string[]
  orden:         Orden
  onOrden:       (o: Orden) => void
  /** Vacío = sin filtro, que no es lo mismo que "ninguno seleccionado": con
   *  cero seleccionados la tabla quedaría en blanco y nadie quiere eso. */
  seleccionados: Set<string>
  onFiltro:      (s: Set<string>) => void
  alineacion?:   'left' | 'right'
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const activo = orden?.columna === id ? orden.dir : null
  const filtrando = seleccionados.size > 0
  const Icono = activo === 'asc' ? ArrowUp : activo === 'desc' ? ArrowDown : ChevronsUpDown

  function ciclarOrden() {
    if (activo === 'asc') onOrden({ columna: id, dir: 'desc' })
    else if (activo === 'desc') onOrden(null)
    else onOrden({ columna: id, dir: 'asc' })
  }

  function alternar(v: string) {
    const next = new Set(seleccionados)
    if (next.has(v)) next.delete(v); else next.add(v)
    onFiltro(next)
  }

  return (
    <th className={`px-3 py-2 ${alineacion === 'right' ? 'text-right' : 'text-left'}`}>
      <div className={`flex items-center gap-1 ${alineacion === 'right' ? 'justify-end' : ''}`}>
        <button
          type="button"
          onClick={ciclarOrden}
          aria-label={`Ordenar por ${titulo}`}
          className="flex items-center gap-1 hover:text-text-primary transition-colors"
        >
          {titulo}
          <Icono size={11} className={activo ? 'text-accent' : 'opacity-40'} />
        </button>

        {valores.length > 1 && (
          <div className="relative" ref={caja}>
            <button
              type="button"
              onClick={() => setAbierto(a => !a)}
              aria-label={`Filtrar por ${titulo}`}
              aria-expanded={abierto}
              className={`p-0.5 rounded transition-colors ${filtrando ? 'text-accent' : 'opacity-40 hover:opacity-100'}`}
            >
              <Filter size={11} />
            </button>

            {abierto && (
              <div className="absolute z-20 mt-1 left-0 w-56 bg-white border border-border rounded-xl shadow-lg p-2 normal-case">
                <div className="flex items-center justify-between gap-2 pb-1.5 mb-1 border-b border-border/60">
                  <button
                    type="button"
                    onClick={() => onFiltro(new Set())}
                    className="text-etiqueta font-semibold text-accent hover:underline"
                  >
                    Ver todos
                  </button>
                  <span className="text-etiqueta text-informativo font-normal">
                    {filtrando ? `${seleccionados.size} de ${valores.length}` : `${valores.length} valores`}
                  </span>
                </div>
                <ul className="max-h-60 overflow-y-auto space-y-0.5">
                  {valores.map(v => (
                    <li key={v}>
                      <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-bg-main cursor-pointer">
                        <input
                          type="checkbox"
                          checked={seleccionados.has(v)}
                          onChange={() => alternar(v)}
                        />
                        <span className="text-etiqueta text-text-primary font-normal truncate">{v}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  )
}

/** Compara como lo haría una planilla: los números como números —"30179083"
 *  antes que "9"— y el resto alfabéticamente y sin distinguir tildes ni
 *  mayúsculas. Los vacíos van siempre al final, en las dos direcciones: un
 *  hueco no es "lo primero" ni "lo último", es la ausencia de dato. */
export function compararValores(a: string | null, b: string | null, dir: Direccion): number {
  const vacioA = !a, vacioB = !b
  if (vacioA && vacioB) return 0
  if (vacioA) return 1
  if (vacioB) return -1
  const signo = dir === 'asc' ? 1 : -1
  const na = Number(a), nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a!.trim() !== '' && b!.trim() !== '') {
    return (na - nb) * signo
  }
  return a!.localeCompare(b!, 'es', { sensitivity: 'base', numeric: true }) * signo
}
