'use client'

import { useState, useTransition } from 'react'
import { createUser } from '@/lib/actions/users'
import { X, UserPlus, Eye, EyeOff } from 'lucide-react'
import PasswordStrength, { isPasswordValid } from '@/components/auth/PasswordStrength'
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type UserRole } from '@/lib/types'

const ASSIGNABLE_ROLES: UserRole[] = ['viewer', 'writer', 'editor', 'admin']

interface Props {
  actorRole: UserRole
  onCreated: () => void
  onClose: () => void
}

export default function CreateUserForm({ actorRole, onCreated, onClose }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [selectedRole, setSelectedRole] = useState<UserRole>('writer')
  const [isPending, startTransition] = useTransition()

  // Owners can assign any role including owner; admins cannot assign admin or owner
  const availableRoles = actorRole === 'owner'
    ? [...ASSIGNABLE_ROLES, 'owner' as UserRole]
    : ASSIGNABLE_ROLES.filter(r => r !== 'admin')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isPasswordValid(password)) {
      setError('La contraseña no cumple los requisitos mínimos de seguridad.')
      return
    }
    setError(null)
    const formData = new FormData(e.currentTarget)
    formData.set('password', password)
    formData.set('role', selectedRole)

    startTransition(async () => {
      const result = await createUser(formData)
      if (result.error) setError(result.error)
      else onCreated()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border sticky top-0 bg-white">
          <div className="flex items-center gap-2.5">
            <UserPlus size={18} className="text-accent" />
            <h2 className="font-semibold text-text-primary">Crear usuario</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Nombre completo</label>
            <input
              name="full_name"
              type="text"
              required
              placeholder="Felipe Rodríguez"
              className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Email</label>
            <input
              name="email"
              type="email"
              required
              placeholder="usuario@webcarga.cl"
              className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Contraseña inicial</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Crea una contraseña segura"
                className="w-full px-3 py-2 pr-10 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <PasswordStrength password={password} />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Rol</label>
            <div className="space-y-2">
              {availableRoles.map(role => (
                <label
                  key={role}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedRole === role
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="role_radio"
                    value={role}
                    checked={selectedRole === role}
                    onChange={() => setSelectedRole(role)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <span className="text-sm font-medium text-text-primary">{ROLE_LABELS[role]}</span>
                    <p className="text-xs text-gray-400 mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-border text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending || (password.length > 0 && !isPasswordValid(password))}
              className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-60 transition-colors"
            >
              {isPending ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
