import { createClient } from '@/lib/supabase/server'
import UsersTable from '@/components/admin/UsersTable'
import type { Profile, UserRole } from '@/lib/types'
import { Users, Shield, UserCheck } from 'lucide-react'

export default async function AdminUsuariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: users }, { data: actorProfile }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('role').eq('id', user?.id ?? '').single(),
  ])

  const profiles = (users ?? []) as Profile[]
  const actorRole = ((actorProfile?.role ?? 'admin') as UserRole)

  const total = profiles.length
  const admins = profiles.filter(u => u.role === 'admin' || u.role === 'owner').length
  const activos = profiles.filter(u => u.active !== false).length

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-mulish font-bold text-xl text-text-primary">Gestión de usuarios</h1>
        <p className="text-sm text-gray-400 mt-0.5">Administra roles y accesos del equipo WebCarga</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Users size={18} className="text-gray-500" />
          </div>
          <div>
            <p className="font-mulish font-bold text-2xl text-text-primary">{total}</p>
            <p className="text-xs text-gray-400">Usuarios totales</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
            <Shield size={18} className="text-purple-500" />
          </div>
          <div>
            <p className="font-mulish font-bold text-2xl text-text-primary">{admins}</p>
            <p className="text-xs text-gray-400">Admins / Owners</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <UserCheck size={18} className="text-green-500" />
          </div>
          <div>
            <p className="font-mulish font-bold text-2xl text-text-primary">{activos}</p>
            <p className="text-xs text-gray-400">Activos</p>
          </div>
        </div>
      </div>

      {/* Role legend */}
      <div className="bg-white rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Jerarquía de roles</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {([
            { role: 'viewer', color: 'bg-gray-100 text-gray-600',   desc: 'Solo lectura' },
            { role: 'writer', color: 'bg-blue-100 text-blue-700',   desc: 'Edita campos básicos' },
            { role: 'editor', color: 'bg-cyan-100 text-cyan-700',   desc: 'Edita todos los campos' },
            { role: 'admin',  color: 'bg-purple-100 text-purple-700', desc: 'Editor + usuarios' },
            { role: 'owner',  color: 'bg-amber-100 text-amber-700', desc: 'Acceso total, protegido' },
          ] as const).map(({ role, color, desc }) => (
            <div key={role} className="flex flex-col items-center gap-1 text-center">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${color}`}>{role}</span>
              <span className="text-[11px] text-gray-400">{desc}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
          <span className="text-gray-300">●──────────────────────────────────────→</span>
          <span>Permisos crecientes</span>
        </div>
      </div>

      <UsersTable users={profiles} currentUserId={user?.id ?? ''} actorRole={actorRole} />
    </div>
  )
}
