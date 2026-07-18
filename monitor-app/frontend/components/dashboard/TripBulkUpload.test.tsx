import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TripBulkUpload, buildPayload } from './TripBulkUpload'
import { tripsApi } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import type { TripsMeta, CSVColumnDef } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { bulkCreate: vi.fn() },
}))

const columns: CSVColumnDef[] = [
  { field: 'planning_date',  csv_key: 'fecha_planificacion', label: 'Fecha planificación', required: true,  type: 'date',   example: '2026-05-29' },
  { field: 'client_name',    csv_key: 'cliente',             label: 'Cliente',             required: false, type: 'text',   example: 'Walmart' },
  { field: 'current_status', csv_key: 'estado',              label: 'Estado',              required: false, type: 'status', example: 'ASIGNADO' },
  { field: 'stops',          csv_key: 'destinos',            label: 'Destinos',            required: false, type: 'stops',  example: 'Local 1' },
]

const meta: TripsMeta = {
  statuses: [{ id: 'ASIGNADO', label: 'ASIGNADO', bg_color: '#fff', text_color: '#000', group: 'otro' }],
  tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: columns, temperature_ranges: [], unassigned_reasons: [], operation_types: [],
}

function uploadCSV(content: string, name = 'viajes.csv') {
  const file = new File([content], name, { type: 'text/csv' })
  fireEvent.change(screen.getByLabelText('Archivo CSV'), { target: { files: [file] } })
}

beforeEach(() => {
  vi.mocked(tripsApi.bulkCreate).mockReset()
})

describe('buildPayload', () => {
  const validStatuses = new Set(['ASIGNADO'])

  it('rejects unknown statuses', () => {
    const { payload, errors } = buildPayload(
      { fecha_planificacion: '2026-07-06', estado: 'VOLANDO' }, columns, validStatuses)
    expect(payload).toBeNull()
    expect(errors[0]).toContain('VOLANDO')
  })

  it('parses destinos into stops payload', () => {
    const { payload } = buildPayload(
      { fecha_planificacion: '2026-07-06', destinos: 'Local 1@2026-07-06 09:00|Local 2' },
      columns, validStatuses)
    expect(payload?.stops).toHaveLength(2)
    expect(payload?.stops?.[0].local).toBe('Local 1')
  })
})

describe('TripBulkUpload', () => {
  it('rejects a non-CSV file with a visible error', async () => {
    render(<TripBulkUpload open onClose={vi.fn()} onImported={vi.fn()} meta={meta} />)
    uploadCSV('x', 'planilla.xlsx')
    expect(await screen.findByText(/no es un CSV/)).toBeInTheDocument()
  })

  it('parses a semicolon-delimited CSV (Excel es-CL) into the preview', async () => {
    render(<TripBulkUpload open onClose={vi.fn()} onImported={vi.fn()} meta={meta} />)
    uploadCSV('fecha_planificacion;cliente;estado\n2026-07-06;Walmart;ASIGNADO\n')
    expect(await screen.findByText(/1 viaje válido/)).toBeInTheDocument()
    expect(screen.getByText('Walmart')).toBeInTheDocument()
  })

  it('shows per-row validation errors for unknown statuses', async () => {
    render(<TripBulkUpload open onClose={vi.fn()} onImported={vi.fn()} meta={meta} />)
    uploadCSV('fecha_planificacion,estado\n2026-07-06,NO-EXISTE\n')
    expect(await screen.findByText(/1 fila con error/)).toBeInTheDocument()
    expect(screen.getByText(/NO-EXISTE/)).toBeInTheDocument()
  })

  it('shows a red icon and backend row errors when the import fails', async () => {
    vi.mocked(tripsApi.bulkCreate).mockRejectedValue(
      new ApiError('Filas con errores', 422, {
        message: 'Filas con errores — no se importó nada',
        errors: [{ row: 1, error: 'Duplicado dentro del archivo' }],
      }),
    )
    render(<TripBulkUpload open onClose={vi.fn()} onImported={vi.fn()} meta={meta} />)
    uploadCSV('fecha_planificacion,cliente\n2026-07-06,Walmart\n')
    fireEvent.click(await screen.findByText(/Importar 1 viaje/))
    expect(await screen.findByText('No se importó ningún viaje')).toBeInTheDocument()
    expect(screen.getByText(/Duplicado dentro del archivo/)).toBeInTheDocument()
    expect(screen.getByText('Fila 1')).toBeInTheDocument()
  })

  it('reports success honestly when trips are created', async () => {
    vi.mocked(tripsApi.bulkCreate).mockResolvedValue({ created: 2, ids: ['a', 'b'], errors: [] } as never)
    const onImported = vi.fn()
    render(<TripBulkUpload open onClose={vi.fn()} onImported={onImported} meta={meta} />)
    uploadCSV('fecha_planificacion,cliente\n2026-07-06,Walmart\n2026-07-07,Colun\n')
    fireEvent.click(await screen.findByText(/Importar 2 viajes/))
    expect(await screen.findByText('2 viajes importados')).toBeInTheDocument()
    expect(onImported).toHaveBeenCalledWith(2)
  })

  it('closes with Escape', () => {
    const onClose = vi.fn()
    render(<TripBulkUpload open onClose={onClose} onImported={vi.fn()} meta={meta} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
