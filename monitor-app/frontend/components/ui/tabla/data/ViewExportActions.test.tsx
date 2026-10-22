import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { ViewExportActions } from './ViewExportActions'

vi.mock('@/lib/reporte/exportarReporte', async orig => ({
  ...(await orig<typeof import('@/lib/reporte/exportarReporte')>()),
  descargarExcel: vi.fn().mockResolvedValue(undefined),
}))

type Fila = { id: string; conductor: string; estado: string }
const FILAS: Fila[] = [
  { id: '1', conductor: 'Ana Soto', estado: 'No asignado' },
  { id: '2', conductor: 'Juan Pérez', estado: 'Asignado' },
]
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'conductor', header: 'Conductor', value: r => r.conductor },
  { id: 'estado', header: 'Estado', value: r => r.estado },
]

function Tabla({ view }: { view: TableView }) {
  const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: () => {}, pageSize: 1 })
  return <ViewExportActions model={model} title="Flota del día 04/08 · Tractoreo" fileName="flota_del_dia_2026-08-04_tractoreo.xlsx" />
}

const write = vi.fn()
beforeEach(() => {
  write.mockReset().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { write } })
  vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} })
})

describe('ViewExportActions', () => {
  it('Copiar pone en el portapapeles lo que pasa la vista, en tabla y en texto, aunque esté en otra página', async () => {
    render(<Tabla view={{ ...EMPTY_VIEW, filters: { estado: ['Asignado', 'No asignado'] } }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    await waitFor(() => expect(write).toHaveBeenCalled())
    const item = write.mock.calls[0][0][0] as { items: Record<string, Blob> }
    const texto = await item.items['text/plain'].text()
    expect(texto).toContain('Ana Soto · No asignado')
    expect(texto).toContain('Juan Pérez · Asignado')
    expect(await item.items['text/html'].text()).toContain('<th>Conductor</th>')
    expect(await screen.findByText('Copiado')).toBeInTheDocument()
  })

  it('Copiar respeta los filtros', async () => {
    render(<Tabla view={{ ...EMPTY_VIEW, filters: { estado: ['No asignado'] } }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    await waitFor(() => expect(write).toHaveBeenCalled())
    const texto = await (write.mock.calls[0][0][0] as { items: Record<string, Blob> }).items['text/plain'].text()
    expect(texto).toContain('Estado: No asignado · 1 fila')
    expect(texto).not.toContain('Juan Pérez')
  })

  it('si el navegador no deja copiar, lo dice', async () => {
    write.mockRejectedValue(new Error('denied'))
    render(<Tabla view={EMPTY_VIEW} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo copiar')
  })

  it('Descargar Excel baja la vista con su recorte arriba', async () => {
    const { descargarExcel } = await import('@/lib/reporte/exportarReporte')
    render(<Tabla view={{ ...EMPTY_VIEW, filters: { estado: ['No asignado'] } }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }))

    await waitFor(() => expect(descargarExcel).toHaveBeenCalled())
    const [hojas, archivo] = vi.mocked(descargarExcel).mock.calls[0]
    expect(archivo).toBe('flota_del_dia_2026-08-04_tractoreo.xlsx')
    expect(hojas[0].data[0]).toEqual(['Flota del día 04/08 · Tractoreo · Estado: No asignado · 1 fila'])
    expect(hojas[0].data.at(-1)).toEqual(['Ana Soto', 'No asignado'])
  })
})
