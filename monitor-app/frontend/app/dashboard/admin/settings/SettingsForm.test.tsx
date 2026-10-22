import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let puede = true
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => puede }))
vi.mock('@/lib/api/config', () => ({ changesApi: { list: vi.fn() } }))

import { changesApi } from '@/lib/api/config'
import { SettingsForm } from './SettingsForm'
import { confirmLeave } from './unsavedChanges'
import type { SettingsSource } from './settings-sources'

type Row = { id: string; label: string; help: string; value: number | null; warning?: number; error?: number }
const REGLAS: Row[] = [
  { id: 'stale_report_hours', label: 'Sin actualización del TMS', help: 'Horas sin noticias del TMS.', value: 2 },
  { id: 'dwell_red_min', label: 'Semáforo del local: rojo', help: 'Minutos para pasar a rojo.', value: 120 },
]

function fuente(over: Partial<SettingsSource<Row>> = {}): SettingsSource<Row> {
  return {
    area: 'operations', section: 'alert-thresholds', kind: 'form',
    queryKey: ['form', Math.random()],
    list: vi.fn().mockResolvedValue(REGLAS),
    title: r => r.label,
    columns: [{ id: 'label', header: 'Regla', value: r => r.label }],
    fields: r => [{ key: 'value', label: `Valor de ${r?.label}`, kind: 'number', min: 0, help: r?.help }],
    values: r => ({ value: r.value }),
    validate: v => (v.value == null ? 'Completa el valor.' : null),
    save: vi.fn().mockResolvedValue({}),
    emptyText: 'No hay reglas.',
    ...over,
  }
}

function renderForm(src: SettingsSource<Row>) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsForm source={src} />
    </QueryClientProvider>,
  )
}

const campo = (label: string) => screen.getByRole('spinbutton', { name: `Valor de ${label}` })

beforeEach(() => {
  puede = true
  vi.mocked(changesApi.list).mockResolvedValue([
    { element_id: 'dwell_red_min', actor_name: 'Pablo', changed_at: '2026-10-14T15:00:00Z' },
  ])
})

describe('SettingsForm: valores sueltos en un formulario (spec 2026-10-22 §3.1)', () => {
  it('muestra cada regla con su campo y su ayuda', async () => {
    renderForm(fuente())
    expect(await screen.findByText('Sin actualización del TMS')).toBeInTheDocument()
    expect(campo('Sin actualización del TMS')).toHaveValue(2)
    expect(screen.getByText('Minutos para pasar a rojo.')).toBeInTheDocument()
    expect(await screen.findByText('Última modificación: Pablo, 14/10/2026')).toBeInTheDocument()
  })

  it('Guardar cambios está deshabilitado sin cambios', async () => {
    renderForm(fuente())
    await screen.findByText('Sin actualización del TMS')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled()
  })

  it('valida por fila: el crítico tiene que ser menor que el aviso', async () => {
    const umbral: Row = { id: 'documento_por_vencer', label: 'Aviso general', help: '', value: null, warning: 30, error: 0 }
    renderForm(fuente({
      list: vi.fn().mockResolvedValue([umbral]),
      fields: () => [
        { key: 'warning', label: 'Aviso (días antes)', kind: 'number', min: 1 },
        { key: 'error', label: 'Crítico (días antes)', kind: 'number', min: 0 },
      ],
      values: r => ({ warning: r.warning, error: r.error }),
      validate: v => (Number(v.error) >= Number(v.warning) ? 'El crítico tiene que ser menor que el aviso.' : null),
    }))
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Crítico (días antes)' }), { target: { value: '40' } })
    expect(screen.getByText('El crítico tiene que ser menor que el aviso.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  // Revisión final (I3): lo guardado se dice guardado, y no vuelve a mostrar el valor viejo.
  it('guarda fila por fila: dice qué se guardó y conserva lo que falló', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Valor fuera de rango'))
    const list = vi.fn()
      .mockResolvedValueOnce(REGLAS)
      .mockResolvedValue([{ ...REGLAS[0], value: 3 }, REGLAS[1]])
    renderForm(fuente({ save, list }))
    await screen.findByText('Sin actualización del TMS')
    fireEvent.change(campo('Sin actualización del TMS'), { target: { value: '3' } })
    fireEvent.change(campo('Semáforo del local: rojo'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenNthCalledWith(1, REGLAS[0], { value: 3 })
    expect(save).toHaveBeenNthCalledWith(2, REGLAS[1], { value: 999 })
    expect(await screen.findByText('Valor fuera de rango')).toBeInTheDocument()
    expect(screen.getByText('Se guardó 1 de 2 cambios; revisa el que falló.')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Sin actualización del TMS' })).getByText('Guardado')).toBeInTheDocument()
    expect(campo('Sin actualización del TMS')).toHaveValue(3)
    expect(campo('Semáforo del local: rojo')).toHaveValue(999)
  })

  it('al guardar todo bien lo dice', async () => {
    renderForm(fuente())
    await screen.findByText('Sin actualización del TMS')
    fireEvent.change(campo('Sin actualización del TMS'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Guardado')).toBeInTheDocument()
  })

  it('Descartar vuelve a los valores guardados', async () => {
    renderForm(fuente())
    await screen.findByText('Sin actualización del TMS')
    fireEvent.change(campo('Sin actualización del TMS'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(campo('Sin actualización del TMS')).toHaveValue(2)
  })

  it('con cambios, salir pide confirmación; sin cambios, no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderForm(fuente())
    await screen.findByText('Sin actualización del TMS')
    expect(confirmLeave()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.change(campo('Sin actualización del TMS'), { target: { value: '9' } })

    expect(confirmLeave()).toBe(false)
    expect(confirm).toHaveBeenCalledWith('Tienes cambios sin guardar. ¿Salir igual?')
    confirm.mockRestore()
  })

  it('sin permiso de edición los campos van deshabilitados', async () => {
    puede = false
    renderForm(fuente())
    await screen.findByText('Sin actualización del TMS')
    expect(campo('Sin actualización del TMS')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull()
  })
})
