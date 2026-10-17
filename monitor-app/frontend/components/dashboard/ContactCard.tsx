'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { inputClass } from '@/components/ui/Field'

export type ContactLike = {
  id:           string
  contact_role: string
  first_name:   string | null
  last_name:    string | null
  email:        string | null
  phone:        string | null
}

export type ContactSavePatch = { first_name?: string; last_name?: string; email?: string; phone?: string }
export type ContactAddBody = { contact_role: string; first_name?: string; last_name?: string; phone?: string; email?: string }

/** Tarjeta de contacto (public.contacts, polimórfico — entity_type
 *  CARRIER/DRIVER/ASSET) — extraído de la ficha de empresa para reusar en
 *  DriverDetailPanel (el usuario pidió poder registrar teléfono/email de
 *  conductores, aceptando más de uno). Múltiples teléfonos/emails se logran
 *  con varias filas de contacto, no con arrays en un solo contacto. */
/** El nombre de cada rol. `contact_role` es texto abierto en la base (sin CHECK):
 *  uno desconocido se muestra tal cual en vez de perderse. */
const CONTACT_ROLE_LABELS: Record<string, string> = {
  LEGAL_REP: 'Representante legal', OPERATIONS: 'Operacional', FINANCE: 'Finanzas', DOCUMENTS: 'Documentos',
  PERSONAL: 'Personal', EMERGENCIA: 'Emergencia', OTRO: 'Otro',
}
export const contactRoleLabel = (role: string) => CONTACT_ROLE_LABELS[role] ?? role

export function ContactCard({ contact, canEdit, canDelete, onSaved, onDeleted }: {
  contact: ContactLike
  canEdit: boolean
  /** Eliminar un contacto pide `directory.delete`, no `directory.edit`. */
  canDelete: boolean
  onSaved: (patch: ContactSavePatch) => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    phone: contact.phone ?? '', email: contact.email ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function openEdit() {
    setDraft({
      name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
      phone: contact.phone ?? '', email: contact.email ?? '',
    })
    setEditing(true)
  }

  async function save() {
    setBusy(true); setErr(null)
    try {
      const [first_name, ...rest] = draft.name.trim().split(/\s+/)
      await onSaved({ first_name: first_name || undefined, last_name: rest.join(' ') || undefined, phone: draft.phone, email: draft.email })
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setBusy(false) }
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

  if (editing) {
    return (
      <div className="border border-accent/40 rounded-lg p-3 space-y-1.5">
        <p className="text-etiqueta font-semibold text-informativo mb-1">{contactRoleLabel(contact.contact_role)}</p>
        <input value={draft.name} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))} placeholder="Nombre"
          className={`${inputClass({ size: 'xs' })} w-full`} />
        <input value={draft.phone} onChange={e => setDraft(v => ({ ...v, phone: e.target.value }))} placeholder="Teléfono"
          className={`${inputClass({ size: 'xs' })} w-full`} />
        <input value={draft.email} onChange={e => setDraft(v => ({ ...v, email: e.target.value }))} placeholder="Email"
          className={`${inputClass({ size: 'xs' })} w-full`} />
        {err && <p className="text-etiqueta text-status-incidente">{err}</p>}
        <div className="flex gap-1.5 pt-1">
          <button onClick={save} disabled={busy} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-accent rounded px-2 py-1 disabled:opacity-50">
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Guardar
          </button>
          <button onClick={() => setEditing(false)} className="text-[11px] text-informativo hover:text-text-primary px-2 py-1">Cancelar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border/60 rounded-lg p-3 group relative">
      <p className="text-etiqueta font-semibold text-informativo mb-1.5">{contactRoleLabel(contact.contact_role)}</p>
      <p className="text-xs font-semibold text-text-primary truncate">{name || <span className="text-informativo italic">sin nombre</span>}</p>
      {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-[11px] text-informativo hover:text-accent">{contact.phone}</a>}
      {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-[11px] text-informativo hover:text-accent truncate"><span className="truncate">{contact.email}</span></a>}
      {canEdit && (
        <div className="flex gap-2 mt-1">
          <button onClick={openEdit} className="text-etiqueta text-informativo hover:text-accent">Editar</button>
          {canDelete && (
            <button onClick={onDeleted} className="text-etiqueta text-informativo hover:text-status-incidente">Eliminar</button>
          )}
        </div>
      )}
    </div>
  )
}

export function AddContactForm({ roleOptions, onAdd }: {
  roleOptions: string[]
  onAdd: (body: ContactAddBody) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(roleOptions[0])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="border border-dashed border-border rounded-lg p-3 text-xs text-accent hover:bg-accent/5 text-left">
        + Agregar contacto
      </button>
    )
  }

  async function submit() {
    setBusy(true)
    try {
      const [first_name, ...rest] = name.trim().split(/\s+/)
      await onAdd({ contact_role: role, first_name: first_name || undefined, last_name: rest.join(' ') || undefined, phone: phone || undefined, email: email || undefined })
      setOpen(false); setName(''); setPhone(''); setEmail('')
    } finally { setBusy(false) }
  }

  return (
    <div className="border border-accent/40 rounded-lg p-3 space-y-1.5">
      <select value={role} onChange={e => setRole(e.target.value)} className="w-full text-xs border border-border rounded px-2 py-1">
        {roleOptions.map(r => <option key={r} value={r}>{contactRoleLabel(r)}</option>)}
      </select>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre" className="w-full text-xs border border-border rounded px-2 py-1" />
      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Teléfono" className="w-full text-xs border border-border rounded px-2 py-1" />
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full text-xs border border-border rounded px-2 py-1" />
      <div className="flex gap-1.5 pt-1">
        <button onClick={submit} disabled={busy} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-accent rounded px-2 py-1 disabled:opacity-50">
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Guardar
        </button>
        <button onClick={() => setOpen(false)} className="text-[11px] text-informativo hover:text-text-primary px-2 py-1">Cancelar</button>
      </div>
    </div>
  )
}
