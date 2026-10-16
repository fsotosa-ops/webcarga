'use client'

import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Info } from 'lucide-react'
import { Estado } from '@/components/ui/Estado'
import { TripCodeLinks, tripCodes } from '@/components/dashboard/TripCodeLinks'
import type { DataColumn } from '@/components/ui/tabla/data/columns'
import { useDataTable } from '@/components/ui/tabla/data/useDataTable'
import { useUrlView } from '@/components/ui/tabla/data/useUrlView'
import { useTablePreferences } from '@/components/ui/tabla/data/useTablePreferences'
import { DataTable } from '@/components/ui/tabla/data/DataTable'
import { TableToolbar } from '@/components/ui/tabla/data/TableToolbar'
import { useClosureNotices } from '@/hooks/useClosureNotices'
import type { Notice } from '@/lib/cierre/closureNotices'
import { NOTICE_TYPE_LABEL } from '@/lib/states'
import type { ClosureScope } from '@/lib/types'
import { invalidateDirectory, type DirectoryChange } from '@/lib/queries/directorio'
import { NoticeAction } from './pending/NoticeAction'

const TABLE_KEY = 'closure.pending'

interface Props {
  fecha: string
  /** Qué se cierra (D6): sus avisos y los de empresa. */
  alcance: ClosureScope
  /** El detalle de un viaje, con la vuelta a este Cierre. */
  tripHref: (tripId: string) => string
}

/** Pestaña "Pendientes" del Cierre (HU-02, pre-cierre), con el patrón del Cierre
 *  (spec D3 y §4.6): una tabla con la barra del kit, una fila por aviso, "Tipo de
 *  aviso" filtrable y la acción de cada uno en su fila. El desbalance de dotación es
 *  un tipo más. Los avisos salen de `useClosureNotices`, lo mismo que cuenta la pestaña. */
export function PreCierrePendingSection({ fecha, alcance, tripHref }: Props) {
  const queryClient = useQueryClient()
  const [view, setView] = useUrlView()
  const preferencias = useTablePreferences(TABLE_KEY)
  const { notices, autoResolved, closed } = useClosureNotices(fecha, alcance)

  async function afterChange(change: DirectoryChange) {
    await invalidateDirectory(queryClient, change)
    // Esta pantalla ES el Cierre: se relee ya, para traer `pendiente_desde` y que el
    // aviso y la relectura de 15 s arranquen (0.6). Desde otras pantallas el Cierre
    // solo queda marcado viejo (R9).
    await queryClient.invalidateQueries({ queryKey: ['daily-closure', fecha] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-closures', fecha] })
  }

  const columnas = useMemo<DataColumn<Notice>[]>(() => [
    { id: 'type', header: 'Tipo de aviso', value: n => NOTICE_TYPE_LABEL[n.type] },
    { id: 'subject', header: 'Sobre', hideable: false, value: n => n.subject,
      render: n => <span className="font-semibold text-text-primary">{n.subject}</span> },
    { id: 'carrier', header: 'Empresa', value: n => n.carrier },
    { id: 'trip', header: 'Nº viaje', value: n => tripCodes(n.trips).join(', ') || null, values: n => tripCodes(n.trips),
      render: n => <TripCodeLinks trips={n.trips} href={tripHref} /> },
    { id: 'detail', header: 'Detalle', filter: false, sortable: false, value: n => n.detail,
      render: n => <span className="text-text-primary">{n.detail}</span> },
    { id: 'action', header: 'Acción', filter: false, sortable: false, hideable: false, value: () => null,
      render: n => <NoticeAction notice={n} onChanged={afterChange} /> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tripHref, fecha])

  const model = useDataTable({
    rows: notices ?? [], columns: columnas, getRowId: n => n.key, view, onViewChange: setView, pageSize: 50,
    columnPrefs: preferencias.columns,
    search: (n, q) => [n.subject, n.carrier, n.detail, NOTICE_TYPE_LABEL[n.type], ...tripCodes(n.trips)]
      .some(x => (x ?? '').toLowerCase().includes(q)),
  })

  // Un día firmado no vuelve a correr el pre-cierre (escribe en el directorio como
  // efecto): no hay pendientes que mostrar.
  if (closed) {
    return (
      <Estado tipo="vacio" titulo="El día está cerrado"
        detalle="Los pendientes se revisan antes de firmar. Para cambiar algo hay que reabrir el día." />
    )
  }
  if (!notices) return <Estado tipo="cargando" />

  return (
    <div className="space-y-4">
      {autoResolved.length > 0 && (
        <div className="rounded-xl border border-border bg-white">
          <p className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-etiqueta font-semibold text-text-primary">
            <CheckCircle2 size={14} className="shrink-0 text-resuelto" aria-hidden="true" />
            {autoResolved.length} resuelta{autoResolved.length > 1 ? 's' : ''} automáticamente
          </p>
          <ul className="divide-y divide-border/60">
            {autoResolved.map((r, i) => <li key={i} className="px-4 py-2.5 text-etiqueta text-informativo">{r.message}</li>)}
          </ul>
        </div>
      )}

      <TableToolbar model={model} searchPlaceholder="Buscar patente, conductor, empresa o Nº de viaje…" preferences={preferencias} />
      <DataTable model={model} label="Avisos del cierre"
        empty={notices.length === 0 ? 'Nada pendiente para el cierre' : 'Ningún aviso coincide'} />

      {/* Decía "Puedes avanzar al cierre aunque queden pendientes" y era FALSO desde el
          23/08: `close_day` devuelve 409 con `_ESCALACIONES_QUE_BLOQUEAN`. Un aviso que
          promete lo contrario de lo que hace la API enseña a no leer los avisos. */}
      {notices.length > 0 && (
        <p className="flex items-start gap-1 text-etiqueta text-informativo">
          <Info size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Estos pendientes bloquean el cierre del día, salvo la falta de tipo de operación, las patentes sin empresa y
            el desbalance de dotación. Resuélvelos aquí, o pide a un administrador que fuerce el cierre dejando una nota.
          </span>
        </p>
      )}
    </div>
  )
}
