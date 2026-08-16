'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { configApi, type Direccion, type TripStatusRow } from '@/lib/api/config'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { GROUP_OPTIONS, INPUT, SwatchPicker } from './shared'

const BOTON_ORDEN = 'inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 '
  + 'text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 '
  + 'disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-accent/40'

/** El editor de un estado del tablero: nombre visible, color, columna y orden.
 *
 *  El nombre del TMS se MUESTRA pero no se edita: lo define el TMS, no
 *  Configuración. Es el mismo dato que la lista conserva en su propia
 *  columna, para que renombrar el visible no pierda de qué estado se trata.
 *
 *  La paleta de color no se dibuja de entrada: aparece sólo al abrir el
 *  selector. Es el reemplazo de las 8 pastillas por fila que tenía la lista
 *  vieja — acá hay una sola, y sólo cuando se está editando.
 *
 *  EL ORDEN SE EDITA ACÁ Y NO EN LA LISTA. La lista es de lectura: devolverle
 *  un par de flechas a cada una de las 25 filas sería volver a los 300
 *  controles que este rediseño vino a sacar. `hermanos` es el catálogo
 *  completo en orden del tablero —no lo que la lista está mostrando— porque
 *  reordenar es relativo al tablero, y filtrar por columna no puede cambiar
 *  con quién se intercambia un estado. */
export function EstadoPanel({
  estado, hermanos, onCerrar,
}: {
  estado:   TripStatusRow
  hermanos: TripStatusRow[]
  onCerrar: () => void
}) {
  // La puerta REAL es la ruta: app/dashboard/admin/layout.tsx redirige a quien
  // no sea admin u owner, y el backend exige require_admin en las escrituras.
  // Este gate existe para no quedar asimetrico con CondicionPanel y para que el
  // componente siga siendo correcto si algun dia se monta fuera de /admin.
  // NO se le escribe test a la rama falsa: hoy es inalcanzable, y un test sobre
  // un estado que no puede ocurrir es cobertura que no cubre.
  const puedeEditar = useCanAdmin()
  const qc = useQueryClient()

  const [label, setLabel] = useState(estado.label)
  const [bgColor, setBgColor] = useState(estado.bg_color)
  const [textColor, setTextColor] = useState(estado.text_color)
  const [group, setGroup] = useState(estado.group)
  const [colorAbierto, setColorAbierto] = useState(false)

  // Si el prop cambia —porque se abrió un estado distinto, o porque el
  // guardado propagó la fila nueva— el borrador tiene que resincronizarse.
  // Sin esto la pantalla sigue mostrando lo viejo con datos frescos abajo: la
  // misma clase de bug que ya apareció en ContactCard y
  // TransporterDocumentsPanel.
  useEffect(() => {
    setLabel(estado.label)
    setBgColor(estado.bg_color)
    setTextColor(estado.text_color)
    setGroup(estado.group)
    setColorAbierto(false)
  }, [estado.id, estado.label, estado.bg_color, estado.text_color, estado.group])

  const sucio = label !== estado.label || bgColor !== estado.bg_color
    || textColor !== estado.text_color || group !== estado.group

  const guardar = useMutation({
    mutationFn: () => configApi.patchStatus(estado.id, {
      label, bg_color: bgColor, text_color: textColor, group,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-statuses'] })
    },
  })

  // Reordenar lo resuelve el SERVIDOR, en una sola transacción. Acá había dos
  // PATCH seguidos —uno con el número del vecino, otro con el propio— y si el
  // segundo no llegaba los dos quedaban con el mismo número, un empate que
  // esta pantalla no sabía deshacer. Ahora se manda la dirección y el destino
  // lo decide la lista. Ver backend services/reordenamiento.py.
  const posicion = hermanos.findIndex(s => s.id === estado.id)

  const mover = useMutation({
    mutationFn: (direccion: Direccion) => configApi.moveStatus(estado.id, direccion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tms-statuses'] })
    },
  })

  const errorGuardar = guardar.isError
    ? (guardar.error instanceof Error ? guardar.error.message : 'Error al guardar el estado')
    : null
  const errorMover = mover.isError
    ? (mover.error instanceof Error ? mover.error.message : 'Error al cambiar el orden')
    : null

  return (
    <PanelLateral
      titulo={estado.label}
      onCerrar={onCerrar}
      pie={sucio && puedeEditar ? (
        <button
          type="button"
          onClick={() => guardar.mutate()}
          disabled={guardar.isPending || !puedeEditar}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs
                     font-semibold text-white hover:bg-accent/90 disabled:opacity-50
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {guardar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Guardar
        </button>
      ) : null}
    >
      <p className="text-[11px] text-gray-400 font-mono">{estado.id}</p>
      {/* La lista vieja lo decía arriba de todo y se perdió al rediseñarla.
          Va acá y no en la lista porque es la respuesta a la pregunta que se
          hace parado frente a un estado: por qué no hay dónde crear ni
          borrar. */}
      <p className="mt-1 text-[10.5px] text-gray-500">
        Este nombre lo define el TMS. Acá se ajusta cómo se ve y dónde aparece;
        los estados no se crean ni se borran desde la app.
      </p>

      <label className="mt-3 block text-xs text-gray-700">
        Nombre visible
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          aria-label="Nombre visible"
          className={`${INPUT} mt-1 w-full`}
        />
      </label>

      <div className="mt-3">
        <span className="block text-xs text-gray-700 mb-1">Color</span>
        <button
          type="button"
          onClick={() => setColorAbierto(a => !a)}
          aria-label="Cambiar color"
          aria-expanded={colorAbierto}
          className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ backgroundColor: bgColor, color: textColor }}
        >
          {label || '—'}
        </button>
        {colorAbierto && (
          <div className="mt-2">
            <SwatchPicker
              name={label}
              bg={bgColor}
              text={textColor}
              onPick={c => { setBgColor(c.bg); setTextColor(c.text) }}
            />
          </div>
        )}
      </div>

      <label className="mt-3 block text-xs text-gray-700">
        Columna del tablero
        <select
          value={group}
          onChange={e => setGroup(e.target.value)}
          aria-label="Columna del tablero"
          className={`${INPUT} mt-1 w-full`}
        >
          {GROUP_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </label>
      {/* Era un `title` sobre el encabezado de la lista vieja: invisible para
          quien no pasa el mouse por encima, y perdido al sacar la columna. */}
      <p className="mt-1 text-[10.5px] text-gray-500">
        Define en qué columna del tablero aparecen los viajes con este estado.
      </p>

      <div className="mt-4">
        <span className="block text-xs text-gray-700 mb-1">Orden en el tablero</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 tabular-nums">
            {`${posicion + 1} de ${hermanos.length}`}
          </span>
          <button
            type="button"
            onClick={() => mover.mutate('up')}
            disabled={!puedeEditar || posicion <= 0 || mover.isPending}
            className={BOTON_ORDEN}
          >
            <ChevronUp size={12} aria-hidden="true" /> Subir
          </button>
          <button
            type="button"
            onClick={() => mover.mutate('down')}
            disabled={!puedeEditar || posicion < 0 || posicion >= hermanos.length - 1 || mover.isPending}
            className={BOTON_ORDEN}
          >
            <ChevronDown size={12} aria-hidden="true" /> Bajar
          </button>
          {mover.isPending && <Loader2 size={12} className="animate-spin text-gray-400" />}
        </div>
        <p className="mt-1 text-[10.5px] text-gray-500">
          Define en qué orden aparece este estado en las listas y filtros del Monitor.
          Se aplica al instante, sin apretar Guardar.
        </p>
      </div>

      {errorGuardar && <p className="mt-2 text-[10.5px] text-red-600">{errorGuardar}</p>}
      {errorMover && <p className="mt-2 text-[10.5px] text-red-600">{errorMover}</p>}
    </PanelLateral>
  )
}
