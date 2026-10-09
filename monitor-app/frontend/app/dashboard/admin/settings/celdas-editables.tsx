'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import type { RequirementOption } from '@/lib/types'

/** Las celdas que se editan donde se ven.
 *
 *  POR QUÉ ACÁ Y NO EN UN PANEL. Abrir un panel lateral para cambiar una
 *  palabra es un paso de más. Un rediseño anterior sacó los controles de la
 *  fila —"37 formularios abiertos, uno debajo del otro: 5.849 px"— y esa
 *  decisión sigue en pie: lo que vuelve NO son 37 formularios simultáneos,
 *  sino una celda que se convierte en control al hacer clic, de a una.
 *
 *  SOLO LO QUE ES ETIQUETA. El nombre y las formas de reconocerlo en el
 *  archivo se guardan al instante: no cambian el estado de nadie. Lo que sí
 *  lo cambia (cómo vence, cuándo se exige, obligatorio, vigente) va al
 *  borrador de la tabla y se publica junto, después de ver su efecto
 *  (celdas-del-borrador.tsx, HU-C1 entrega 2c). */

type Patch = Parameters<typeof requirementsApi.patchConditions>[1]

/** Guarda un campo del requisito e invalida el catálogo. Uno solo para todas
 *  las celdas: si cada una escribiera su propia mutación, la lista de claves a
 *  invalidar se separaría — que es como este frontend ya perdió una raíz. */
function useGuardarCampo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Patch }) =>
      requirementsApi.patchConditions(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance-requirements'] }),
  })
}

/** El nombre visible. Es la ÚNICA celda que no marca la fila como "sin
 *  aplicar": renombrar no mueve un registro — ninguna tabla guarda copia del
 *  nombre, todas las pantallas hacen JOIN vivo. */
export function CeldaNombre({ requisito, puedeEditar }: {
  requisito: RequirementOption
  puedeEditar: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(requisito.name)
  const guardar = useGuardarCampo()
  const input = useRef<HTMLInputElement>(null)

  // El borrador se resincroniza cuando el prop cambia. Sin esto la celda
  // sigue mostrando lo viejo con datos frescos abajo — la clase de bug que
  // este frontend ya tuvo en ContactCard y TransporterDocumentsPanel.
  useEffect(() => { setValor(requisito.name) }, [requisito.name])
  useEffect(() => { if (editando) input.current?.select() }, [editando])

  function confirmar() {
    const limpio = valor.trim()
    setEditando(false)
    // Vacío no es un nombre: se descarta y vuelve el anterior, en vez de
    // guardar una fila sin forma de identificarla.
    if (!limpio || limpio === requisito.name) { setValor(requisito.name); return }
    guardar.mutate({ id: requisito.id, patch: { name: limpio } })
  }

  if (!puedeEditar) {
    return (
      <>
        <div className="text-xs font-semibold text-text-primary truncate">{requisito.name}</div>
        <div className="text-etiqueta text-gray-400 truncate">{requisito.requirement_code}</div>
      </>
    )
  }

  return (
    <>
      {editando ? (
        <input
          ref={input}
          value={valor}
          onChange={e => setValor(e.target.value)}
          onBlur={confirmar}
          onKeyDown={e => {
            if (e.key === 'Enter') confirmar()
            // Escape descarta: sin él, empezar a editar por accidente no
            // tiene salida que no sea guardar algo.
            if (e.key === 'Escape') { setValor(requisito.name); setEditando(false) }
          }}
          aria-label={`Nombre de ${requisito.requirement_code}`}
          className="w-full rounded border border-accent/40 px-1.5 py-0.5 text-xs font-semibold
                     text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditando(true)}
          aria-label={`Renombrar ${requisito.name}`}
          className="flex w-full items-center gap-1.5 rounded text-left text-xs font-semibold
                     text-text-primary hover:bg-accent/5 focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <span className="truncate">{requisito.name}</span>
          {guardar.isPending && <Loader2 size={11} className="shrink-0 animate-spin text-informativo" />}
        </button>
      )}
      {/* El CÓDIGO se muestra y no se edita: es la llave de los alias de
          nombre de archivo y del motor de match. Cambiarlo dejaría al
          clasificador sin poder resolver este documento. */}
      <div className="text-etiqueta text-gray-400 truncate">{requisito.requirement_code}</div>
      {guardar.isError && (
        <div className="text-etiqueta text-status-incidente">No se pudo renombrar</div>
      )}
    </>
  )
}

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
          className="inline-block max-w-[9rem] truncate rounded bg-bg-main px-1.5 py-0.5 text-etiqueta font-mono text-text-primary"
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
