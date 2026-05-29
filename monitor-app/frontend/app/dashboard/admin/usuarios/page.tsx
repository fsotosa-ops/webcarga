import { createClient } from '@/lib/supabase/server'
import UsersTable from '@/components/admin/UsersTable'
import type { Profile, UserRole } from '@/lib/types'
import { fetchRolesServer, type RoleInfo } from '@/lib/api/roles'
import { Users, ShieldAlert, CircleCheck, CircleOff } from 'lucide-react'

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  viewer: { bg: 'bg-gray-100',   text: 'text-gray-600'   },
  writer: { bg: 'bg-blue-50',    text: 'text-blue-700'   },
  editor: { bg: 'bg-teal-50',    text: 'text-teal-700'   },
  admin:  { bg: 'bg-purple-50',  text: 'text-purple-700' },
  owner:  { bg: 'bg-amber-50',   text: 'text-amber-700'  },
}

export default async function AdminUsuariosPage() {
  const supabase    = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: users }, { data: actorProfile }, roles] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('role').eq('id', user?.id ?? '').single(),
    fetchRolesServer().catch(() => [] as RoleInfo[]),
  ])

  const profiles   = (users ?? []) as Profile[]
  const actorRole  = ((actorProfile?.role ?? 'admin') as UserRole)

  const total    = profiles.length
  const activos  = profiles.filter(u => u.active !== false).length
  const priv     = profiles.filter(u => u.role === 'admin' || u.role === 'owner').length
  const inactivos = total - activos

  // Role distribution (desc: highest privilege first)
  const byRole = [...roles].reverse()

  return (
    <div className="min-h-full bg-gray-50/40">

      {/* ── Dark header ───────────────────────────────────────────── */}
      <div className="bg-slate-900 px-6 py-6 md:py-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">
                Administración
              </p>
              <h1 className="font-mulish font-bold text-2xl text-white">
                Gestión de Usuarios
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Controla roles y accesos del equipo WebCarga
              </p>
            </div>

            {/* Role distribution pills */}
            <div className="flex flex-wrap gap-1.5">
              {byRole.map(r => {
                const count = profiles.filter(u => u.role === r.id).length
                if (!count) return null
                const badge = ROLE_BADGE[r.id] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
                return (
                  <span key={r.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.bg} ${badge.text}`}>
                    {count} {r.label}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 -mt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Users,       label: 'Usuarios',  value: total,    iconBg: 'bg-slate-100',  iconColor: 'text-slate-500' },
            { icon: ShieldAlert, label: 'Admin+',    value: priv,     iconBg: 'bg-purple-50',  iconColor: 'text-purple-500' },
            { icon: CircleCheck, label: 'Activos',   value: activos,  iconBg: 'bg-green-50',   iconColor: 'text-green-500'  },
            { icon: CircleOff,   label: 'Inactivos', value: inactivos, iconBg: 'bg-red-50',    iconColor: 'text-red-400'    },
          ].map(({ icon: Icon, label, value, iconBg, iconColor }) => (
            <div key={label} className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 shadow-sm">
              <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                <Icon size={17} className={iconColor} />
              </div>
              <div>
                <p className="font-mulish font-bold text-2xl text-text-primary leading-none">{value}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Role legend ───────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 mt-4">
        <div className="bg-white rounded-xl border border-border px-5 py-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            Jerarquía de permisos
          </p>
          <div className="flex items-start gap-2 flex-wrap">
            {roles.map((r, i) => {
              const badge = ROLE_BADGE[r.id] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
              return (
                <div key={r.id} className="flex items-center gap-1.5">
                  <div className="text-center">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>{r.label}</span>
                    <p className="text-[10px] text-gray-400 mt-0.5 max-w-[80px] text-center leading-tight">{r.description}</p>
                  </div>
                  {i < roles.length - 1 && (
                    <span className="text-gray-200 text-sm mb-4">→</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Users table ───────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-4 pb-8">
        <UsersTable
          users={profiles}
          currentUserId={user?.id ?? ''}
          actorRole={actorRole}
          roles={roles}
        />
      </div>
    </div>
  )
}
