'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type FilterFn,
} from '@tanstack/react-table'
import Link from 'next/link'
import type { DiarioTrip, DiarioManualFields, UserRole } from '@/lib/types'
import { hasRole } from '@/lib/types'
import { ToggleCell, TextCell } from './ManualFieldCell'
import { ChevronLeft, ChevronRight, Search, Lock } from 'lucide-react'

function ReadonlyToggle({ value }: { value: boolean }) {
  return (
    <div className={`w-8 h-5 rounded-full relative pointer-events-none ${value ? 'bg-accent/40' : 'bg-gray-200'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'left-3.5' : 'left-0.5'}`} />
    </div>
  )
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  'ASIGNADO':           { bg: '#e8eeff', text: '#053bfa' },
  'ORIGEN':             { bg: '#f3e8ff', text: '#8a00dd' },
  'RUTA':               { bg: '#eef6e6', text: '#62a420' },
  'EN LOCAL':           { bg: '#fef0e6', text: '#ea6b25' },
  'RETORNANDO':         { bg: '#e6f8fd', text: '#0e8db5' },
  'RETORNADO CD':       { bg: '#f3f4f6', text: '#6b7280' },
  'VIAJE EN PREDIO':    { bg: '#f3f4f6', text: '#6b7280' },
  'CANCELADO':          { bg: '#fee2e2', text: '#b00020' },
  'CERRADO FINALIZADO': { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO INCOMPLETO': { bg: '#fef3c7', text: '#d97706' },
  'CERRADO MANUAL':     { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO SIN GPS':    { bg: '#f3f4f6', text: '#9ca3af' },
}

type Row = DiarioTrip & { manual: DiarioManualFields | null }

const globalFilterFn: FilterFn<Row> = (row, _colId, value: string) => {
  const q = value.toLowerCase()
  return [
    row.original.conductor,
    row.original.rut_conductor,
    row.original.eett,
    row.original.patente_tracto,
    row.original.cd_planta_origen,
    row.original.normalized_status,
  ].some(v => v?.toLowerCase().includes(q))
}

interface DiarioTableProps {
  rows: Row[]
  userId: string
  fecha: string
  userRole?: UserRole
}

export default function DiarioTable({ rows, userId, fecha, userRole = 'viewer' }: DiarioTableProps) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [eettFilter, setEettFilter] = useState('')

  // writer can edit basic fields; editor can edit all
  const canWriteBasic = hasRole(userRole, 'writer')
  const canWriteAll   = hasRole(userRole, 'editor')

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter && r.normalized_status !== statusFilter) return false
      if (eettFilter && r.eett !== eettFilter) return false
      return true
    })
  }, [rows, statusFilter, eettFilter])

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'conductor',
      header: 'Conductor',
      size: 155,
      cell: ({ getValue, row }) => {
        const name = getValue<string>()
        const rut = row.original.rut_conductor
        if (!name) return <span className="text-gray-300">—</span>
        return rut
          ? <Link href={`/dashboard/conductores/${encodeURIComponent(rut)}`} className="font-medium text-text-primary hover:text-accent transition-colors">{name}</Link>
          : <span className="font-medium">{name}</span>
      },
    },
    { accessorKey: 'rut_conductor', header: 'RUT', size: 100, cell: i => i.getValue() ?? '—' },
    {
      accessorKey: 'eett',
      header: 'EETT',
      size: 145,
      cell: ({ getValue }) => {
        const name = getValue<string>()
        if (!name) return <span className="text-gray-300">—</span>
        return (
          <Link
            href={`/dashboard/transportistas/${encodeURIComponent(name)}`}
            className="text-text-primary hover:text-accent transition-colors"
          >
            {name}
          </Link>
        )
      },
    },
    {
      accessorKey: 'normalized_status',
      header: 'Estado',
      size: 150,
      cell: ({ getValue }) => {
        const s = getValue<string>() ?? ''
        const colors = STATUS_COLOR[s]
        return (
          <span
            className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
            style={colors ? { backgroundColor: colors.bg, color: colors.text } : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
          >
            {s || '—'}
          </span>
        )
      },
    },
    { accessorKey: 'cd_planta_origen', header: 'CD Origen', size: 125, cell: i => i.getValue() ?? '—' },
    { accessorKey: 'local_asignado',   header: 'Local',     size: 125, cell: i => i.getValue() ?? '—' },
    {
      accessorKey: 'patente_tracto',
      header: 'Tracto',
      size: 90,
      cell: ({ getValue }) => {
        const plate = getValue<string>()
        if (!plate) return <span className="text-gray-300">—</span>
        return <span className="font-mono text-xs">{plate}</span>
      },
    },
    { accessorKey: 'patente_rampla', header: 'Rampla', size: 90, cell: i => <span className="font-mono text-xs">{i.getValue<string>() ?? '—'}</span> },
    // Basic fields — writer+
    {
      id: 'activo',
      header: 'Activo',
      size: 65,
      cell: ({ row }) => canWriteBasic
        ? <ToggleCell fecha={fecha} dniDriver={row.original.rut_conductor ?? ''} field="activo" value={row.original.manual?.activo ?? true} userId={userId} />
        : <ReadonlyToggle value={row.original.manual?.activo ?? true} />,
    },
    {
      id: 'trabajando',
      header: 'Trabaj.',
      size: 65,
      cell: ({ row }) => canWriteBasic
        ? <ToggleCell fecha={fecha} dniDriver={row.original.rut_conductor ?? ''} field="trabajando" value={row.original.manual?.trabajando ?? false} userId={userId} />
        : <ReadonlyToggle value={row.original.manual?.trabajando ?? false} />,
    },
    {
      id: 'vacaciones',
      header: 'Vacac.',
      size: 65,
      cell: ({ row }) => canWriteBasic
        ? <ToggleCell fecha={fecha} dniDriver={row.original.rut_conductor ?? ''} field="vacaciones" value={row.original.manual?.vacaciones ?? false} userId={userId} />
        : <ReadonlyToggle value={row.original.manual?.vacaciones ?? false} />,
    },
    {
      id: 'sosafe',
      header: 'SoSafe',
      size: 65,
      cell: ({ row }) => canWriteBasic
        ? <ToggleCell fecha={fecha} dniDriver={row.original.rut_conductor ?? ''} field="sosafe" value={row.original.manual?.sosafe ?? false} userId={userId} />
        : <ReadonlyToggle value={row.original.manual?.sosafe ?? false} />,
    },
    {
      id: 'telefono',
      header: 'Teléfono',
      size: 115,
      cell: ({ row }) => canWriteBasic
        ? <TextCell fecha={fecha} dniDriver={row.original.rut_conductor ?? ''} field="telefono" value={row.original.manual?.telefono ?? null} userId={userId} />
        : <span className="text-gray-500 text-xs">{row.original.manual?.telefono ?? '—'}</span>,
    },
    {
      id: 'observaciones',
      header: 'Obs.',
      size: 200,
      cell: ({ row }) => canWriteBasic
        ? <TextCell fecha={fecha} dniDriver={row.original.rut_conductor ?? ''} field="observaciones" value={row.original.manual?.observaciones ?? null} userId={userId} />
        : <span className="text-gray-500 text-xs truncate max-w-[180px] block">{row.original.manual?.observaciones ?? '—'}</span>,
    },
  ], [fecha, userId, canWriteBasic, canWriteAll])

  const table = useReactTable({
    data: filteredRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    initialState: { pagination: { pageSize: 25 } },
  })

  const statuses = Array.from(new Set(rows.map(r => r.normalized_status).filter(Boolean))) as string[]
  const eettsUniq = Array.from(new Set(rows.map(r => r.eett).filter(Boolean))).sort() as string[]
  const visibleCount = table.getFilteredRowModel().rows.length

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Conductor, RUT, patente, EETT..."
              value={globalFilter}
              onChange={e => setGlobalFilter(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent w-56"
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent bg-white"
          >
            <option value="">Todos los estados</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {eettsUniq.length > 1 && (
            <select
              value={eettFilter}
              onChange={e => setEettFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent bg-white max-w-[200px]"
            >
              <option value="">Todas las EETT</option>
              {eettsUniq.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!canWriteBasic && (
              <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                <Lock size={10} />
                Solo lectura
              </span>
            )}
            <span className="text-xs text-gray-400">
              {visibleCount} {visibleCount === 1 ? 'conductor' : 'conductores'}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="bg-gray-50/80 border-b border-border">
                {hg.headers.map(h => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() }}
                    className="px-3 py-2.5 text-left font-semibold text-gray-500 whitespace-nowrap text-[11px] uppercase tracking-wide"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-12 text-center text-sm text-gray-400">
                  Sin registros para los filtros aplicados
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-border/60 last:border-0 hover:bg-blue-50/30 transition-colors ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-3 py-2 whitespace-nowrap max-w-[220px] text-gray-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-border flex items-center justify-between bg-gray-50/50">
        <span className="text-xs text-gray-400">
          Pág. {table.getState().pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 transition-colors">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 transition-colors">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
