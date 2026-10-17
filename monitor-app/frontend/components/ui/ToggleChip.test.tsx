import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToggleChip } from './ToggleChip'

describe('ToggleChip', () => {
  it('es un interruptor: anuncia si está encendido y avisa al tocarlo', () => {
    const onClick = vi.fn()
    render(<ToggleChip pressed onClick={onClick}>Colun</ToggleChip>)
    const chip = screen.getByRole('button', { name: 'Colun' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('apagado no se ve igual que encendido', () => {
    render(<><ToggleChip pressed={false} onClick={() => {}}>Apagado</ToggleChip><ToggleChip pressed onClick={() => {}}>Encendido</ToggleChip></>)
    expect(screen.getByRole('button', { name: 'Apagado' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Apagado' }).className)
      .not.toBe(screen.getByRole('button', { name: 'Encendido' }).className)
  })

  it('un tono propio (el color que eligió quien armó el grupo) reemplaza al del sistema', () => {
    render(<ToggleChip pressed onClick={() => {}} tone={{ on: 'bg-teal-500', off: 'bg-teal-50' }}>Mi grupo</ToggleChip>)
    const chip = screen.getByRole('button', { name: 'Mi grupo' })
    expect(chip).toHaveClass('bg-teal-500')
    expect(chip.className).not.toMatch(/text-accion/)
  })
})
