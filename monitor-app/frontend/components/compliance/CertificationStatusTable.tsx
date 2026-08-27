'use client'

import { Fragment } from 'react'
import { AlertTriangle, Building2, Check, ChevronRight } from 'lucide-react'
import type { CertificationGroup, CertificationStatusRow } from '@/lib/types'
import { propsDeFilaExpandible } from '@/hooks/useFilaAbierta'

interface Props {
  rows:  CertificationStatusRow[]
  group: CertificationGroup
  /** La fila abierta, y cómo alternarla. Vienen de arriba —igual que en el
   *  embudo— para que la tabla no dependa de las consultas del detalle. */
  openRowId?:    string | null
  onToggleRow?:  (entityId: string) => void
  renderDrawer?: (row: CertificationStatusRow) => React.ReactNode
  /** Ir a esta empresa DENTRO de Certificación. Antes cada fila enlazaba a la
   *  ficha de Empresas y eso sacaba al usuario del módulo: se perdía la cola
   *  de trabajo y volver exigía rehacer el filtro. */
  onIrAEmpresa?: (carrierId: string) => void
  /** Vincular a una empresa a un conductor o un vehículo que no tiene ninguna.
   *  Sin esto, esa fila era texto muerto: la columna Empresa decía "sin
   *  empresa" con un `title` explicativo y ninguna acción, y no había ninguna
   *  otra vista de la app donde hacerlo (bug crítico #5 de la minuta del
   *  25/08). Al 27/08 son 8 conductores con 278 viajes y 7 patentes con 82. */
  onAsignarEmpresa?: (row: CertificationStatusRow) => void
}

/** La vista por defecto del módulo: cómo va cada empresa.
 *
 *  Las dos mitades del trabajo viven en la misma fila — lo que falta y lo que
 *  llegó sin clasificar. Tenerlas en dos listas hermanas obligaba a cruzarlas
 *  de memoria, que es exactamente lo que hacía al módulo confuso. */
export function CertificationStatusTable({
  rows, group, openRowId, onToggleRow, renderDrawer, onIrAEmpresa, onAsignarEmpresa,
}: Props) {
  const porEmpresa = group === 'carrier'
  // Agrupando por REQUISITO la fila es un tipo de documento, no una entidad
  // con dueño: no tiene empresa (el backend manda NULL a proposito, porque un
  // requisito cruza todas). Sin esta rama la tabla lo dibujaba como vehiculo,
  // con el encabezado "Vehículo" y el aviso ámbar "sin empresa" en TODAS las
  // filas.
  const porRequisito = group === 'requirement'
  const etiqueta = porEmpresa ? 'empresas'
    : group === 'driver' ? 'conductores'
    : porRequisito ? 'requisitos' : 'vehículos'

  if (!rows.length) {
    return (
      <div className="p-8 text-center">
        <Building2 size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-500">No hay {etiqueta} que coincidan</p>
      </div>
    )
  }

  return (
    <table className="w-full text-left">
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 pl-3 pr-2 text-etiqueta uppercase tracking-wider text-gray-500 font-semibold">
            {porEmpresa ? 'Empresa'
              : group === 'driver' ? 'Conductor'
              : porRequisito ? 'Documento' : 'Vehículo'}
          </th>
          {/* Un conductor o un vehículo sin su empresa no dice nada. */}
          {!porEmpresa && !porRequisito && (
            <th scope="col" className="py-2 px-2 text-etiqueta uppercase tracking-wider text-gray-500 font-semibold w-56">Empresa</th>
          )}
          <th scope="col" className="py-2 px-2 text-etiqueta uppercase tracking-wider text-gray-500 font-semibold w-56">Documentación</th>
          {porEmpresa && (
            <th scope="col" className="py-2 pl-2 pr-3 text-etiqueta uppercase tracking-wider text-gray-500 font-semibold w-32">Sin clasificar</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pct = r.total_count > 0 ? Math.round((r.satisfied_count / r.total_count) * 100) : 0
          const alDia = r.total_count > 0 && r.pending_count === 0
          // Un conductor o un vehiculo sin empresa activa no tiene por donde
          // recibir documentacion: la tabla ya lo dice en su titulo, y darle un
          // cajon prometeria una accion que el backend no puede completar.
          const puedeAbrir = !!renderDrawer && !porEmpresa && !porRequisito && !!r.carrier_id
          const abierta = openRowId === r.entity_id

          return (
            <Fragment key={r.entity_id}>
            {/* El `null` del final: un <tr> YA es role="row", y pisarlo con
                role="button" deja las celdas sin fila en el árbol de
                accesibilidad. Ver propsDeFilaExpandible. */}
            <tr
              {...(puedeAbrir && onToggleRow
                ? propsDeFilaExpandible(r.entity_id, abierta, onToggleRow, null)
                : {})}
              className={`group border-b border-border transition-colors ${
                abierta ? 'bg-sky-50/60' : 'hover:bg-gray-50'
              } ${puedeAbrir ? 'cursor-pointer' : ''}`}
            >
              <td className="py-2 pl-3 pr-2">
                {porEmpresa ? (
                  // Agrupando por empresa la pantalla usa el embudo, no esta
                  // tabla, asi que esta rama hoy no se dibuja. Se deja sin
                  // enlace igual: mientras exista no puede ser la que devuelva
                  // al usuario al modulo que Certificacion vino a reemplazar.
                  <span className="text-xs font-medium text-text-primary">{r.entity_name}</span>
                ) : porRequisito ? (
                  <span className="text-xs font-medium text-text-primary">{r.entity_name}</span>
                ) : r.carrier_id && puedeAbrir ? (
                  // Abre su cajón acá abajo. Antes esto navegaba a la ficha de
                  // Empresas, o sea que el módulo que existe para reemplazar
                  // ese flujo empujaba de vuelta hacia él.
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-text-primary group-hover:text-accent transition-colors">
                    <ChevronRight
                      size={11}
                      className={`text-informativo transition-transform ${abierta ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                    {r.entity_name}
                  </span>
                ) : (
                  <span
                    className="text-xs font-medium text-text-primary"
                    title={onAsignarEmpresa
                      ? 'Sin empresa activa: asígnale una en la columna Empresa para poder cargarle documentación'
                      : 'Sin empresa activa: no se le puede cargar documentación'}
                  >
                    {r.entity_name}
                  </span>
                )}
                {porEmpresa && r.operational_status !== 'ACTIVE' && (
                  <span className="ml-2 text-etiqueta text-gray-500">no activa</span>
                )}
              </td>

              {!porEmpresa && !porRequisito && (
                <td className="py-2 px-2">
                  {/* Con empresa se muestra siempre; que sea accionable
                      depende de si el contenedor sabe adónde llevar. Antes esta
                      condición era `carrier_id && onIrAEmpresa`, y sin handler
                      una empresa que existe se dibujaba como "sin empresa": el
                      aviso decía algo falso. */}
                  {r.carrier_id ? onIrAEmpresa ? (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onIrAEmpresa(r.carrier_id!) }}
                      className="text-etiqueta text-gray-600 hover:text-accent transition-colors cursor-pointer"
                    >
                      {r.carrier_name}
                    </button>
                  ) : (
                    <span className="text-etiqueta text-gray-600">{r.carrier_name}</span>
                  ) : onAsignarEmpresa ? (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onAsignarEmpresa(r) }}
                      className="text-etiqueta text-espera hover:underline cursor-pointer"
                      title="Sin empresa no se le puede cargar documentación ni entra al cierre del día"
                    >
                      Asignar empresa
                    </button>
                  ) : (
                    <span className="text-etiqueta text-espera" title="Sin asignación activa a una empresa">
                      sin empresa
                    </span>
                  )}
                </td>
              )}

              <td className="py-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-24 rounded-full bg-gray-200 overflow-hidden shrink-0">
                    <span
                      className={`block h-full rounded-full ${alDia ? 'bg-resuelto' : 'bg-accent'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="text-etiqueta text-gray-600 tabular-nums whitespace-nowrap">
                    {r.satisfied_count} de {r.total_count}
                  </span>
                  {r.pending_mandatory > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-etiqueta text-status-incidente"
                      title={`${r.pending_mandatory} obligatorios por ley sin cubrir`}
                    >
                      <AlertTriangle size={11} /> {r.pending_mandatory}
                    </span>
                  )}
                </div>
              </td>

              {porEmpresa && (
              <td className="py-2 pl-2 pr-3">
                {r.unclassified_count > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-red-50 text-espera border border-red-200 px-2 py-0.5 text-etiqueta font-bold tabular-nums">
                    {r.unclassified_count}
                  </span>
                ) : alDia ? (
                  <span className="inline-flex items-center gap-1 text-etiqueta text-resuelto">
                    <Check size={11} /> al día
                  </span>
                ) : (
                  <span className="text-etiqueta text-gray-400">—</span>
                )}
              </td>
              )}
            </tr>
            {abierta && (
              <tr>
                <td colSpan={porEmpresa || porRequisito ? 2 : 3} className="p-0">
                  {renderDrawer?.(r)}
                </td>
              </tr>
            )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
