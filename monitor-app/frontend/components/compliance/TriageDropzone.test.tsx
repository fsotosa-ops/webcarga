import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TriageDropzone } from './TriageDropzone'

const base = {
  vacia: false, subiendo: false, errores: [], onArchivos: vi.fn(),
}

describe('TriageDropzone', () => {
  // Es el estado real de hoy: 0 archivos en la bandeja.
  it('vacía, la zona es la pantalla y explica qué pasa al soltar', () => {
    render(<TriageDropzone {...base} vacia />)
    expect(screen.getByText(/arrastra aquí los documentos/i)).toBeInTheDocument()
    expect(screen.getByText(/nada queda certificado hasta que lo confirmes/i)).toBeInTheDocument()
  })

  it('con archivos ya cargados se encoge, pero sigue existiendo', () => {
    render(<TriageDropzone {...base} />)
    expect(screen.getByText(/suelta archivos en cualquier parte/i)).toBeInTheDocument()
    expect(screen.queryByText(/nada queda certificado/i)).not.toBeInTheDocument()
  })

  // 2.000 archivos tardan. Sin señal de que algo pasa, la gente se queda mirando.
  it('subiendo dice cuántos van en la tanda y avisa que puede cerrar la pestaña', () => {
    render(<TriageDropzone {...base} subiendo enVuelo={2000} />)
    expect(screen.getByText(/2\.000 archivos/)).toBeInTheDocument()
    expect(screen.getByText(/puedes cerrar esta pestaña/i)).toBeInTheDocument()
  })

  // El navegador no informa cuantos archivos van dentro de un solo request:
  // una barra que se llena seria un dato inventado.
  it('la barra es indeterminada, no finge un avance que no existe', () => {
    render(<TriageDropzone {...base} subiendo enVuelo={2000} />)
    const barra = screen.getByRole('progressbar')
    expect(barra).not.toHaveAttribute('aria-valuenow')
    expect(barra).toHaveAttribute('aria-label', expect.stringMatching(/subiendo/i))
  })

  // Un archivo que falla no puede tumbar la tanda ni desaparecer sin aviso.
  it('lista los archivos que fallaron con su motivo', () => {
    render(<TriageDropzone {...base} errores={[{ file_name: 'raro.exe', error: 'Tipo no permitido' }]} />)
    expect(screen.getByText(/raro\.exe/)).toBeInTheDocument()
    expect(screen.getByText(/tipo no permitido/i)).toBeInTheDocument()
  })

  it('en la bandeja de una empresa dice de quién son los archivos', () => {
    render(<TriageDropzone {...base} vacia carrierName="Transportes Charlotte Spa" />)
    expect(screen.getByText(/transportes charlotte spa/i)).toBeInTheDocument()
  })

  it('soltar archivos los entrega al padre', () => {
    const onArchivos = vi.fn()
    render(<TriageDropzone {...base} vacia onArchivos={onArchivos} />)
    const file = new File(['x'], 'doc1.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('triage-dropzone'), { dataTransfer: { files: [file] } })
    expect(onArchivos).toHaveBeenCalled()
  })
})
