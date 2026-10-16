'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import type { RequirementOption } from '@/lib/types'

/** Cómo se reconoce el documento en el NOMBRE del archivo.
 *
 *  Fabián lo pidió en la reunión del 21/08: *"el nombre del archivo tiene que
 *  coincidir también con el nombre del título de acá, para que te haga bien el
 *  match"*. El motor busca estos alias dentro del nombre normalizado —
 *  mayúsculas, sin tildes, todo separador a espacio— así que "Carpeta
 *  Tributaria" encuentra `Carpeta_Tributaria_Regular_77094744-8.pdf`.
 *
 *  UN DOCUMENTO SIN NINGÚN ALIAS ES INVISIBLE para el clasificador, y eso no
 *  falla: simplemente nunca matchea. Por eso la celda dice "no se reconoce" en
 *  vez de quedar vacía — el vacío se lee como "no hay nada que ver", y acá hay
 *  algo que arreglar. Los documentos nuevos ya nacen con su alias (lo siembra
 *  `create_requirement`), así que este estado debería ser raro. */
export function CeldaAlias({ requisito, puedeEditar, maximo }: {
  requisito: RequirementOption
  puedeEditar: boolean
  /** Cuántos mostrar antes de "+N". En la tabla editable, con hasta 4 alias
   *  por documento, mostrarlos todos sacaba la columna de la tabla. */
  maximo?: number
}) {
  const qc = useQueryClient()
  const [agregando, setAgregando] = useState(false)
  const [desplegado, setDesplegado] = useState(false)
  const [valor, setValor] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (agregando) input.current?.focus() }, [agregando])

  const refrescar = () => qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
  const agregar = useMutation({
    mutationFn: (alias: string) => requirementsApi.addAlias(requisito.id, alias),
    onSuccess: refrescar,
  })
  const quitar = useMutation({
    mutationFn: (aliasId: string) => requirementsApi.removeAlias(requisito.id, aliasId),
    onSuccess: refrescar,
  })

  function confirmar() {
    const limpio = valor.trim()
    setAgregando(false)
    setValor('')
    // El backend normaliza igual que el motor; acá sólo se descarta el vacío.
    if (limpio) agregar.mutate(limpio)
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {/* "No sé" y "no tiene ninguno" son cosas distintas: el primero es la
          ventana de despliegue en que el backend todavía no manda el campo, y
          el segundo es un documento que el clasificador no puede encontrar.
          Dibujarlos igual sería el valor con dos significados de siempre. */}
      {requisito.aliases === undefined && (
        <span className="text-etiqueta text-informativo">—</span>
      )}
      {requisito.aliases?.length === 0 && !agregando && (
        <span className="text-etiqueta text-espera">No se reconoce en ningún archivo</span>
      )}
      {(desplegado || maximo === undefined
        ? requisito.aliases
        : requisito.aliases?.slice(0, maximo))?.map(a => (
        <span
          key={a}
          title={a}
          className={`inline-block truncate rounded bg-bg-main px-1.5 py-0.5 text-etiqueta font-mono
                      text-text-primary ${maximo === undefined ? 'max-w-[9rem]' : 'max-w-[5rem]'}`}
        >
          {a}
        </span>
      ))}
      {!desplegado && maximo !== undefined && (requisito.aliases?.length ?? 0) > maximo && (
        <button
          type="button"
          onClick={() => setDesplegado(true)}
          aria-label={`Ver las ${requisito.aliases!.length - maximo} formas más de escribir ${requisito.name}`}
          className="text-etiqueta font-semibold text-informativo hover:text-text-primary focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
        >
          +{requisito.aliases!.length - maximo}
        </button>
      )}

      {puedeEditar && !agregando && requisito.aliases !== undefined && (
        <button
          type="button"
          onClick={() => setAgregando(true)}
          aria-label={`Agregar otra forma de escribir ${requisito.name}`}
          className="text-etiqueta font-semibold text-accion hover:opacity-70 transition-opacity cursor-pointer"
        >
          {agregar.isPending ? <Loader2 size={11} className="motion-safe:animate-spin" /> : '+ otra forma'}
        </button>
      )}

      {agregando && (
        <input
          ref={input}
          value={valor}
          onChange={e => setValor(e.target.value)}
          onBlur={confirmar}
          onKeyDown={e => {
            if (e.key === 'Enter') confirmar()
            // Escape descarta: escribir a medias y arrepentirse no puede
            // guardar. Mismo gesto que el resto de las celdas.
            if (e.key === 'Escape') { setAgregando(false); setValor('') }
          }}
          placeholder="ej. F30"
          aria-label={`Otra forma de escribir ${requisito.name}`}
          className="w-28 rounded border border-accent/40 px-1.5 py-0.5 text-etiqueta focus:outline-none"
        />
      )}
    </span>
  )
}
