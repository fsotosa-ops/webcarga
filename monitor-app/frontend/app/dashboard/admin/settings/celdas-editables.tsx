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
 *  LO QUE NO SE PIERDE AL MOVERLAS. Guardar la regla y aplicarla son dos
 *  actos: editar acá guarda, y la fila queda marcada "sin aplicar" con su
 *  "Ver qué cambia". Sin esa separación, tocar un interruptor en una tabla
 *  sembraría hasta 124 registros sin que nadie viera el número. */

type Patch = Parameters<typeof requirementsApi.patchConditions>[1]

/** Guarda un campo del requisito e invalida el catálogo. Uno solo para todas
 *  las celdas: si cada una escribiera su propia mutación, la lista de claves a
 *  invalidar se separaría — que es como este frontend ya perdió una raíz. */
function useGuardarCampo(onGuardado?: (id: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Patch }) =>
      requirementsApi.patchConditions(id, patch),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
      onGuardado?.(id)
    },
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

/** La vigencia. SÍ marca la fila: activar un requisito le empieza a exigir el
 *  documento a todos los que califiquen. */
export function CeldaVigencia({ requisito, puedeEditar, onReglaCambiada }: {
  requisito: RequirementOption
  puedeEditar: boolean
  onReglaCambiada: (id: string) => void
}) {
  const guardar = useGuardarCampo(onReglaCambiada)
  const texto = requisito.is_active ? 'Vigente' : 'Sin vigencia'
  const clase = requisito.is_active ? 'text-resuelto' : 'text-gray-400'

  if (!puedeEditar) return <span className={`text-xs ${clase}`}>{texto}</span>

  return (
    <button
      type="button"
      onClick={() => guardar.mutate({
        id: requisito.id, patch: { is_active: !requisito.is_active },
      })}
      disabled={guardar.isPending}
      aria-label={`${requisito.is_active ? 'Quitar vigencia a' : 'Dar vigencia a'} ${requisito.name}`}
      className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs ${clase}
                  hover:bg-accent/5 disabled:opacity-50 focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-accent/40`}
    >
      {guardar.isPending && <Loader2 size={11} className="animate-spin" />}
      {texto}
    </button>
  )
}

/** El nivel: a quién se le exige. NO es una etiqueta — los disparadores de
 *  siembra sólo siembran los obligatorios, así que cambiarlo agrega o quita
 *  registros. Por eso marca la fila. */
export function CeldaNivel({ requisito, puedeEditar, onReglaCambiada }: {
  requisito: RequirementOption
  puedeEditar: boolean
  onReglaCambiada: (id: string) => void
}) {
  const guardar = useGuardarCampo(onReglaCambiada)
  const obligatorio = requisito.requirement_level === 'LEGAL_MANDATORY'
  const texto = obligatorio ? 'Obligatorio' : 'Opcional'
  const clase = obligatorio
    ? 'bg-accent/10 text-accent'
    : 'bg-gray-100 text-gray-600'

  // UN TERCER VALOR NO SE COLAPSA EN SILENCIO. El tipo admite
  // `SHIPPER_REQUIRED` —cero filas en la base, un placeholder anterior a la
  // taxonomía real, misma familia que los cinco `AssetType` de los que sólo
  // existían dos—. Un interruptor de dos estados lo convertiría en
  // "Obligatorio" sin que nadie lo pidiera, así que acá se muestra tal cual y
  // no se toca. Si algún día vuelve a haber filas, esto lo hace visible en vez
  // de perderlo.
  const conocido = requisito.requirement_level === 'LEGAL_MANDATORY'
    || requisito.requirement_level === 'CONDITIONAL_OPTIONAL'

  if (!puedeEditar || !conocido) {
    return (
      <span className={`rounded px-2 py-0.5 text-etiqueta font-semibold ${clase}`}>
        {conocido ? texto : requisito.requirement_level}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => guardar.mutate({
        id: requisito.id,
        patch: { requirement_level: obligatorio ? 'CONDITIONAL_OPTIONAL' : 'LEGAL_MANDATORY' },
      })}
      disabled={guardar.isPending}
      aria-label={`Cambiar ${requisito.name} a ${obligatorio ? 'opcional' : 'obligatorio'}`}
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-etiqueta font-semibold
                  ${clase} hover:opacity-80 disabled:opacity-50 focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-accent/40`}
    >
      {guardar.isPending && <Loader2 size={10} className="animate-spin" />}
      {texto}
    </button>
  )
}
