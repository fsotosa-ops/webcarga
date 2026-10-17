'use client'

import { useId, useState, useTransition } from 'react'
import { usersApi } from '@/lib/api/users'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'
import PasswordStrength, { isPasswordValid } from '@/components/auth/PasswordStrength'
import type { PermisoInfo, RoleInfo } from '@/lib/api/access'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { puedeOtorgar } from '@/lib/authz/acceso'
import SelectorDeRoles from './SelectorDeRoles'
import { FIELD_LABEL, inputClass } from '@/components/ui/Field'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Button } from '@/components/ui/Button'

interface Props {
  roles:     RoleInfo[]
  catalogo:  PermisoInfo[]
  onCreated: () => void
  onClose:   () => void
}

/** El mensaje que el admin le envía a la persona (pedido de Pablo, 09/10: "el
 *  administrador crea la cuenta... con credenciales se la manda"). Va además
 *  del correo de invitación, por si el correo no llega. */
export function mensajeDeAcceso(p: {
  nombre: string; email: string; roles: string[]; url: string; password?: string
}): string {
  const lista = p.roles.length > 1
    ? `los roles ${p.roles.slice(0, -1).join(', ')} y ${p.roles[p.roles.length - 1]}`
    : `el rol ${p.roles[0] ?? ''}`
  const saludo = `Hola ${p.nombre}: te di acceso a WebCarga con ${lista}.`
  return p.password
    ? `${saludo}\nEntra en ${p.url} con tu email ${p.email} y esta contraseña: ${p.password}`
    : `${saludo}\nEntra en ${p.url} con el botón de Google o Microsoft, usando la cuenta ${p.email}.`
}

export default function CreateUserForm({ roles, catalogo, onCreated, onClose }: Props) {
  const acceso = useAcceso()
  const formId = useId()
  // Parte con Lectura (ver todo sin editar) cuando quien invita puede darla.
  const lectura = roles.find(r => r.code === 'reader')
  const [creado, setCreado] = useState<{ mensaje: string; invitationSent: boolean } | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [elegidos, setElegidos] = useState<string[]>(lectura && puedeOtorgar(acceso, lectura) ? ['reader'] : [])
  const [oauthOnly, setOauthOnly] = useState(true)
  const [isPending, startTransition] = useTransition()

  const canSubmit = elegidos.length > 0 && (oauthOnly || isPasswordValid(password))

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
          roles:     elegidos,
          ...(oauthOnly ? {} : { password }),
        })
        setCreado({
          invitationSent: res.invitation_sent,
          mensaje: mensajeDeAcceso({
            nombre, email,
            roles: elegidos.map(c => roles.find(r => r.code === c)?.name ?? c),
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
    <PanelLateral
      placement="center"
      titulo="Crear usuario"
      onCerrar={onClose}
      dismissible={!isPending}
      pie={creado ? (
        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => { void navigator.clipboard.writeText(creado.mensaje).then(() => setCopiado(true)) }}>
            {copiado ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            {copiado ? 'Copiado' : 'Copiar mensaje'}
          </Button>
          <Button variant="primary" className="flex-1" onClick={onCreated}>Listo</Button>
        </div>
      ) : (
        <div className="flex gap-3">
          <Button className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form={formId} className="flex-1" disabled={isPending || !canSubmit}>
            {isPending ? 'Creando…' : 'Crear usuario'}
          </Button>
        </div>
      )}
    >

        {creado ? (
          <div className="space-y-4">
            <p className="text-dato text-text-primary">
              {creado.invitationSent
                ? 'Cuenta creada. Le enviamos un correo de invitación. Si no le llega, envíale este mensaje:'
                : 'Cuenta creada. Envíale este mensaje por WhatsApp o correo:'}
            </p>
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-main px-3 py-2.5 font-sans text-dato text-text-primary">
              {creado.mensaje}
            </pre>
          </div>
        ) : (
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`${FIELD_LABEL} mb-1.5`}>Nombre completo</label>
            <input
              name="full_name"
              type="text"
              required
              placeholder="Felipe Rodríguez"
              className={`${inputClass()} w-full`}
            />
          </div>

          <div>
            <label className={`${FIELD_LABEL} mb-1.5`}>Email</label>
            <input
              name="email"
              type="email"
              required
              placeholder="usuario@empresa.cl"
              className={`${inputClass()} w-full`}
            />
          </div>

          {/* Auth method toggle */}
          <div className="overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setOauthOnly(true)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                oauthOnly ? 'bg-accent/5 border-b border-accent/20' : 'hover:bg-bg-main border-b border-border'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                oauthOnly ? 'border-accent' : 'border-border'
              }`}>
                {oauthOnly && <div className="w-2 h-2 rounded-full bg-accent" />}
              </div>
              <div>
                <p className="text-dato font-medium text-text-primary">Solo Google / Microsoft</p>
                <p className="text-etiqueta text-informativo">El usuario entra con su cuenta corporativa. Sin contraseña.</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setOauthOnly(false)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                !oauthOnly ? 'bg-accent/5' : 'hover:bg-bg-main'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                !oauthOnly ? 'border-accent' : 'border-border'
              }`}>
                {!oauthOnly && <div className="w-2 h-2 rounded-full bg-accent" />}
              </div>
              <div>
                <p className="text-dato font-medium text-text-primary">Con contraseña</p>
                <p className="text-etiqueta text-informativo">El usuario puede entrar con email y contraseña.</p>
              </div>
            </button>
          </div>

          {!oauthOnly && (
            <div>
              <label className={`${FIELD_LABEL} mb-1.5`}>Contraseña inicial</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Crea una contraseña segura"
                  className={`${inputClass()} w-full pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-informativo hover:text-text-primary"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <PasswordStrength password={password} />
            </div>
          )}

          <div>
            <p className={`${FIELD_LABEL} mb-2`}>Roles</p>
            <SelectorDeRoles roles={roles} catalogo={catalogo} value={elegidos} onChange={setElegidos} />
          </div>

          {oauthOnly && (
            <p className="rounded-md bg-bg-main px-3 py-2.5 text-etiqueta text-informativo">
              Le llegará un correo de invitación. Entrará con su Google o Microsoft del mismo email.
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">{error}</p>
          )}

        </form>
        )}
    </PanelLateral>
  )
}
