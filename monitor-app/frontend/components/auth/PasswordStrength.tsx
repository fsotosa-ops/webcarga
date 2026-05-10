'use client'

export interface PasswordCheck {
  label: string
  ok: boolean
}

export function getPasswordChecks(password: string): PasswordCheck[] {
  return [
    { label: 'Mínimo 8 caracteres',      ok: password.length >= 8 },
    { label: 'Letra mayúscula',           ok: /[A-Z]/.test(password) },
    { label: 'Letra minúscula',           ok: /[a-z]/.test(password) },
    { label: 'Número',                    ok: /\d/.test(password) },
    { label: 'Carácter especial (!@#$…)', ok: /[^A-Za-z0-9]/.test(password) },
  ]
}

export function getStrength(checks: PasswordCheck[]): { score: number; label: string; color: string } {
  const passed = checks.filter(c => c.ok).length
  if (passed <= 1) return { score: passed, label: 'Muy débil', color: '#b00020' }
  if (passed === 2) return { score: passed, label: 'Débil',     color: '#ea6b25' }
  if (passed === 3) return { score: passed, label: 'Regular',   color: '#d97706' }
  if (passed === 4) return { score: passed, label: 'Fuerte',    color: '#62a420' }
  return               { score: passed, label: 'Muy fuerte', color: '#053bfa' }
}

export function isPasswordValid(password: string): boolean {
  return getPasswordChecks(password).filter(c => c.ok).length >= 4
}

interface Props {
  password: string
}

export default function PasswordStrength({ password }: Props) {
  if (!password) return null

  const checks = getPasswordChecks(password)
  const { score, label, color } = getStrength(checks)
  const total = checks.length

  return (
    <div className="space-y-2 mt-1.5">
      {/* Barra de progreso */}
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className="flex-1 h-1 rounded-full transition-all duration-300"
            style={{ backgroundColor: i < score ? color : '#e5e7eb' }}
          />
        ))}
      </div>

      {/* Label */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
      </div>

      {/* Checklist */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {checks.map(({ label: l, ok }) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className={`text-[10px] ${ok ? 'text-green-600' : 'text-gray-400'}`}>
              {ok ? '✓' : '○'}
            </span>
            <span className={`text-[10px] ${ok ? 'text-gray-600' : 'text-gray-400'}`}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
