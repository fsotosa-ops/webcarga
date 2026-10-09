'use client'

import { useState, useTransition } from 'react'
import { usersApi } from '@/lib/api/users'
import { X, UserPlus, Eye, EyeOff, Copy, Check } from 'lucide-react'
import PasswordStrength, { isPasswordValid } from '@/components/auth/PasswordStrength'
import type { UserRole } from '@/lib/types'
import type { RoleInfo } from '@/lib/api/roles'

interface Props {
  actorRole: UserRole
  roles:     RoleInfo[]
  onCreated: () => void
  onClose:   () => void
}

/** El mensaje que el admin le envía a la persona (pedido de Pablo, 09/10: "el
 *  administrador crea la cuenta... con credenciales se la manda"). Va además
 *  del correo de invitación, por si el correo no llega. */
export function mensajeDeAcceso(p: {
  nombre: string; email: string; rol: string; url: string; password?: string
}): string {
  const saludo = `Hola ${p.nombre}: te di acceso a WebCarga con el rol ${p.rol}.`
  return p.password
    ? `${saludo}\nEntra en ${p.url} con tu email ${p.email} y esta contraseña: ${p.password}`
    : `${saludo}\nEntra en ${p.url} con el botón de Google o Microsoft, usando la cuenta ${p.email}.`
}

export default function CreateUserForm({ actorRole, roles, onCreated, onClose }: Props) {
  const [creado, setCreado] = useState<{ mensaje: string; invitationSent: boolean } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [selectedRole, setSelectedRole] = useState<string>(roles[0]?.id ?? 'viewer')
  const [oauthOnly, setOauthOnly] = useState(true)
  const [isPending, startTransition] = useTransition()

  const actorLevel = roles.find(r => r.id === actorRole)?.level ?? 0
  const availableRoles = roles.filter(r => r.level < actorLevel)

  const canSubmit = oauthOnly || isPasswordValid(password)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!oauthOnly && !isPasswordValid(password)) {
      setError('La contraseña no cumple los requisitos mínimos.')
      return
    }
    setError(null)
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      const email = String(formData.get('email') ?? '')
      const nombre = String(formData.get('full_name') ?? '')
      try {
        const res = await usersApi.create({
          email,
          full_name: nombre,
          role:      selectedRole as UserRole,
          ...(oauthOnly ? {} : { password }),
        })
        setCreado({
          invitationSent: res.invitation_sent,
          mensaje: mensajeDeAcceso({
            nombre, email,
            rol: roles.find(r => r.id === selectedRole)?.label ?? selectedRole,
            url: `${window.location.origin}/login`,
            ...(oauthOnly ? {} : { password }),
          }),
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo crear el usuario')
      }
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

        {creado ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-text-primary">
              {creado.invitationSent
                ? 'Cuenta creada. Le enviamos un correo de invitación. Si no le llega, envíale este mensaje:'
                : 'Cuenta creada. Envíale este mensaje por WhatsApp o correo:'}
            </p>
            <pre className="whitespace-pre-wrap text-sm text-text-primary bg-bg-main rounded-lg px-3 py-2.5 border border-border">
              {creado.mensaje}
            </pre>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(creado.mensaje).then(() => setCopiado(true))
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg border border-border text-sm text-text-primary hover:bg-bg-main transition-colors"
              >
                {copiado ? <Check size={15} /> : <Copy size={15} />}
                {copiado ? 'Copiado' : 'Copiar mensaje'}
              </button>
              <button
                type="button"
                onClick={onCreated}
                className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
              >
                Listo
              </button>
            </div>
          </div>
        ) : (
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
              placeholder="usuario@empresa.cl"
              className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Auth method toggle */}
          <div className="rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setOauthOnly(true)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                oauthOnly ? 'bg-accent/5 border-b border-accent/20' : 'hover:bg-gray-50 border-b border-border'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                oauthOnly ? 'border-accent' : 'border-gray-300'
              }`}>
                {oauthOnly && <div className="w-2 h-2 rounded-full bg-accent" />}
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">Solo Google / Microsoft</p>
                <p className="text-xs text-gray-400">El usuario entra con su cuenta corporativa. Sin contraseña.</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setOauthOnly(false)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                !oauthOnly ? 'bg-accent/5' : 'hover:bg-gray-50'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                !oauthOnly ? 'border-accent' : 'border-gray-300'
              }`}>
                {!oauthOnly && <div className="w-2 h-2 rounded-full bg-accent" />}
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">Con contraseña</p>
                <p className="text-xs text-gray-400">El usuario puede entrar con email y contraseña.</p>
              </div>
            </button>
          </div>

          {!oauthOnly && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">Contraseña inicial</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
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
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">Rol</label>
            <div className="space-y-2">
              {availableRoles.map(r => (
                <label
                  key={r.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedRole === r.id
                      ? 'border-accent bg-accent/5'
                      : 'border-border hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="role_radio"
                    value={r.id}
                    checked={selectedRole === r.id}
                    onChange={() => setSelectedRole(r.id)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <span className="text-sm font-medium text-text-primary">{r.label}</span>
                    <p className="text-xs text-gray-400 mt-0.5">{r.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {oauthOnly && (
            <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2.5">
              Le llegará un correo de invitación. Entrará con su Google o Microsoft del mismo email.
            </p>
          )}

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
              disabled={isPending || !canSubmit}
              className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-60 transition-colors"
            >
              {isPending ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
