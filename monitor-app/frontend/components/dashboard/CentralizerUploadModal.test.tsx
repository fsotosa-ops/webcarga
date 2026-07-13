import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CentralizerUploadModal } from './CentralizerUploadModal'
import { centralizerUploadsApi } from '@/lib/api/centralizerUploads'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('@/lib/api/centralizerUploads', () => ({
  centralizerUploadsApi: { upload: vi.fn() },
}))

function uploadFile(name = 'centralizador.xlsx') {
  const file = new File(['contenido'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fireEvent.change(screen.getByLabelText('Archivo Excel'), { target: { files: [file] } })
}

beforeEach(() => {
  vi.mocked(centralizerUploadsApi.upload).mockReset()
  pushMock.mockReset()
})

describe('CentralizerUploadModal', () => {
  it('rejects non-.xlsx files before calling the API', () => {
    render(<CentralizerUploadModal open onClose={vi.fn()} />)
    const file = new File(['x'], 'centralizador.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Archivo Excel'), { target: { files: [file] } })
    expect(screen.getByText(/no es un Excel/)).toBeInTheDocument()
    expect(centralizerUploadsApi.upload).not.toHaveBeenCalled()
  })

  it('shows sheet summary and parse error count after a successful upload', async () => {
    vi.mocked(centralizerUploadsApi.upload).mockResolvedValue({
      upload_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      sheet_summary: { Empresas: 2, Conductores: 3, Vehiculos_Equipos: 3 },
      parse_errors: [{ sheet: 'Conductores', row: 5, reason: 'RUT vacío' }],
      diff: { transporters: [], drivers: [], vehicles: [], parse_errors: [] },
    })
    render(<CentralizerUploadModal open onClose={vi.fn()} />)
    uploadFile()
    await waitFor(() => expect(screen.getByText('Empresas: 2')).toBeInTheDocument())
    expect(screen.getByText(/1 fila con error de parseo/)).toBeInTheDocument()
  })

  it('navigates to the upload detail page and closes on "Ver diff completo"', async () => {
    const onClose = vi.fn()
    vi.mocked(centralizerUploadsApi.upload).mockResolvedValue({
      upload_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      sheet_summary: { Empresas: 1, Conductores: 0, Vehiculos_Equipos: 0 },
      parse_errors: [],
      diff: { transporters: [], drivers: [], vehicles: [], parse_errors: [] },
    })
    render(<CentralizerUploadModal open onClose={onClose} />)
    uploadFile()
    await waitFor(() => expect(screen.getByText('Ver diff completo')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Ver diff completo'))
    expect(pushMock).toHaveBeenCalledWith('/dashboard/uploads/aaaaaaaa-0000-0000-0000-000000000001')
    expect(onClose).toHaveBeenCalled()
  })
})
