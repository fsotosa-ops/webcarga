'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { configApi, type TripStatusRow } from '@/lib/api/config'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { GROUP_OPTIONS, INPUT, SwatchPicker } from './shared'

/** El editor de un estado del tablero: nombre visible, color y columna.
 *
 *  El nombre del TMS se MUESTRA pero no se edita: lo define el TMS, no
 *  Configuración. Es el mismo dato que la lista conserva en su propia
 *  columna, para que renombrar el visible no pierda de qué estado se trata.
 *
 *  La paleta de color no se dibuja de entrada: aparece sólo al abrir el
 *  selector. Es el reemplazo de las 8 pastillas por fila que tenía la lista
 *  vieja — acá hay una sola, y sólo cuando se está editando. */
export function EstadoPanel({
  estado, onCerrar,
}: {
  estado:   TripStatusRow
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

  const errorGuardar = guardar.isError
    ? (guardar.error instanceof Error ? guardar.error.message : 'Error al guardar el estado')
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

      {errorGuardar && <p className="mt-2 text-[10.5px] text-red-600">{errorGuardar}</p>}
    </PanelLateral>
  )
}
