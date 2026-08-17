import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * El estado de un bloque cuando no hay contenido que mostrar: cargando, vacio
 * o error.
 *
 * La auditoria del 2026-08-16 encontro 48 estados vacios escritos a mano y
 * 138 `Loader2` sueltos. Los tres estados ocupan EL MISMO lugar y se excluyen
 * entre si — tenerlos como tres cosas separadas es justamente lo que hizo que
 * en 48 lugares se escribiera solo uno de los tres, casi siempre el vacio, y
 * el error quedara sin diseñar.
 *
 * NO cubre el spinner dentro de un boton: ese es legitimo y se queda donde
 * esta. Este es el estado que ocupa el area donde iria el contenido.
 *
 * Tres reglas que valen mas que el aspecto:
 *  - `cargando` se anuncia (role=status) y NO muestra ninguna cifra. Una
 *    pantalla que dice "0" mientras carga afirma algo falso.
 *  - `vacio` dice QUE PASA, no "no hay datos". "Tomamos todas las cargas del
 *    dia" informa; "sin resultados" hace dudar de si algo se rompio.
 *  - `error` se anuncia como alerta y NO se disfraza de vacio: un fallo de red
 *    mostrado como "no hay nada" hace creer que el dato no existe.
 */
export function Estado({
  tipo,
  titulo,
  detalle,
  children,
}: {
  tipo: 'cargando' | 'vacio' | 'error'
  /** Obligatorio en vacio y error. En cargando no se muestra. */
  titulo?: string
  detalle?: string
  /** La accion que ofrece el vacio, si hay una que ofrecer. */
  children?: ReactNode
}) {
  if (tipo === 'cargando') {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-10 text-gray-500">
        <Loader2 size={16} className="motion-safe:animate-spin" />
        <span className="text-dato">Cargando…</span>
      </div>
    )
  }

  if (tipo === 'error') {
    return (
      <div
        role="alert"
        className="mx-4 my-3 rounded-lg border border-status-incidente/20 bg-status-incidente/5 px-4 py-3"
      >
        <p className="text-lectura font-semibold text-status-incidente">{titulo}</p>
        {detalle && <p className="text-dato text-gray-600 mt-1">{detalle}</p>}
        {children && <div className="mt-3 flex gap-2">{children}</div>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center text-center gap-1.5 py-12 px-6">
      <p className="text-lectura font-semibold text-text-primary text-balance">{titulo}</p>
      {detalle && <p className="text-dato text-gray-500 max-w-[46ch]">{detalle}</p>}
      {children && <div className="mt-3 flex gap-2">{children}</div>}
    </div>
  )
}
