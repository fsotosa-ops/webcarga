import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RenglonPendiente } from './RenglonPendiente'
import type { PendingComplianceRow } from '@/lib/types'

const fila = (over: Partial<PendingComplianceRow> = {}): PendingComplianceRow => ({
  id: 'p1', carrier_id: 'c1', carrier_name: 'Charlotte', carrier_tax_id: '1-9',
  carrier_operation_types: [], certification_type: 'BASICA', category: 'CHOFER',
  entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan',
  requirement_id: 'r1', requirement_code: 'LICENCIA_CONDUCIR',
  document_name: 'Licencia de Conducir', status: 'MISSING', expiration_date: null,
  expiration_policy: 'REQUIRED',
  ...over,
} as PendingComplianceRow)

const archivo = (nombre = 'licencia.pdf') =>
  new File(['x'], nombre, { type: 'application/pdf' })

function elegir(nombre = 'licencia.pdf') {
  fireEvent.change(screen.getByTestId('archivo-p1'), { target: { files: [archivo(nombre)] } })
}

describe('RenglonPendiente — lo que el requisito exige', () => {
  it('con politica REQUIRED pide la fecha ANTES de subir', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila()} puedeEditar onSubir={onSubir} />)

    elegir()

    expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
    // Lo critico del cambio: NO se subio nada todavia. Subir antes de tener
    // la fecha es lo que dejaba archivos varados en la bandeja con el
    // requisito vacio.
    expect(onSubir).not.toHaveBeenCalled()
  })

  it('sube recien cuando la fecha esta puesta', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila()} puedeEditar onSubir={onSubir} />)

    elegir()
    fireEvent.change(await screen.findByLabelText(/vence el/i), { target: { value: '2027-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSubir).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }), expect.any(File), '2027-01-31',
    ))
  })

  it('no deja guardar con la fecha vacia cuando es obligatoria', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila()} puedeEditar onSubir={onSubir} />)

    elegir()
    fireEvent.click(await screen.findByRole('button', { name: /guardar/i }))

    expect(onSubir).not.toHaveBeenCalled()
  })

  it('con politica NONE sube de una, sin preguntar', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    elegir()

    await waitFor(() => expect(onSubir).toHaveBeenCalled())
    expect(screen.queryByLabelText(/vence el/i)).not.toBeInTheDocument()
  })

  it('con politica OPTIONAL ofrece la fecha pero deja subir sin ella', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'OPTIONAL' })} puedeEditar onSubir={onSubir} />)

    elegir()
    fireEvent.click(await screen.findByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSubir).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }), expect.any(File), undefined,
    ))
  })

  // El backend todavia no manda la politica (llega en la Tarea 3 del plan).
  // Ausencia significa "no se", y "no se" no puede resolverse ni como "no
  // vence" —se perderia una fecha que hacia falta— ni como "es obligatoria"
  // —bloquearia documentos que no vencen—. Se pregunta sin exigir.
  it('sin politica declarada pregunta, pero no bloquea', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    const sinPolitica = fila()
    delete (sinPolitica as Partial<PendingComplianceRow>).expiration_policy
    render(<RenglonPendiente fila={sinPolitica} puedeEditar onSubir={onSubir} />)

    elegir()
    expect(await screen.findByLabelText(/vence el/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSubir).toHaveBeenCalled())
  })
})

describe('RenglonPendiente — el gesto', () => {
  it('soltar un archivo encima equivale a elegirlo', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    fireEvent.drop(screen.getByTestId('renglon-p1'), {
      dataTransfer: { files: [archivo()], types: ['Files'] },
    })

    await waitFor(() => expect(onSubir).toHaveBeenCalled())
  })

  it('sin permiso de edicion no ofrece cargar', () => {
    render(<RenglonPendiente fila={fila()} puedeEditar={false} onSubir={vi.fn()} />)

    expect(screen.queryByTestId('archivo-p1')).not.toBeInTheDocument()
    expect(screen.getByText('Licencia de Conducir')).toBeInTheDocument()
  })

  it('no acepta un segundo archivo mientras sube el primero', async () => {
    let resolver: (() => void) | undefined
    const onSubir = vi.fn().mockImplementation(() => new Promise<void>(r => { resolver = () => r() }))
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    elegir()
    await waitFor(() => expect(onSubir).toHaveBeenCalledTimes(1))
    fireEvent.drop(screen.getByTestId('renglon-p1'), {
      dataTransfer: { files: [archivo('otro.pdf')], types: ['Files'] },
    })

    expect(onSubir).toHaveBeenCalledTimes(1)
    resolver?.()
  })
})

describe('RenglonPendiente — cuando algo sale mal', () => {
  it('el error se muestra en ESTE renglon y conserva el archivo', async () => {
    const onSubir = vi.fn().mockRejectedValue(new Error('El archivo supera 7 MB'))
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    elegir()

    expect(await screen.findByRole('alert')).toHaveTextContent(/7 MB/)
    // Reintentar no puede obligar a buscar el archivo de nuevo.
    expect(screen.getByText(/licencia\.pdf/)).toBeInTheDocument()
  })

  it('deja reintentar despues de un error', async () => {
    const onSubir = vi.fn()
      .mockRejectedValueOnce(new Error('Se cayo la conexion'))
      .mockResolvedValueOnce(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    elegir()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    await waitFor(() => expect(onSubir).toHaveBeenCalledTimes(2))
  })
})

describe('RenglonPendiente — deshacer', () => {
  it('ofrece deshacer lo recien cargado', async () => {
    const onDeshacer = vi.fn()
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar
                             onSubir={onSubir} onDeshacer={onDeshacer} />)

    elegir()

    fireEvent.click(await screen.findByRole('button', { name: /deshacer/i }))
    expect(onDeshacer).toHaveBeenCalled()
  })

  // Sin un camino real para revertir una subida directa, ofrecer "deshacer"
  // seria prometer algo que no se puede cumplir.
  it('sin onDeshacer no promete deshacer', async () => {
    const onSubir = vi.fn().mockResolvedValue(undefined)
    render(<RenglonPendiente fila={fila({ expiration_policy: 'NONE' })} puedeEditar onSubir={onSubir} />)

    elegir()

    await screen.findByText(/listo/i)
    expect(screen.queryByRole('button', { name: /deshacer/i })).not.toBeInTheDocument()
  })
})
