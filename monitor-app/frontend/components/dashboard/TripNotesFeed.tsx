'use client'

import { useRef, useState } from 'react'
import {
  Loader2, Send, Paperclip, X, Pin, PinOff,
  Phone, MessageCircle, AlertTriangle, StickyNote, Activity,
  FileText, ImageIcon, FolderOpen, ListOrdered,
} from 'lucide-react'
import type { Trip, TripNote, TripNoteAttachment, TripNoteType } from '@/lib/types'
import { useTripNotes, useAddTripNote, usePinTripNote, useResolveTripNote } from '@/hooks/useTripNotes'
import { formatRelativeTime, fmtDT } from '@/lib/utils/datetime'

const NOTE_TYPES: { id: Exclude<TripNoteType, 'sistema'>; label: string; Icon: typeof Phone; cls: string }[] = [
  { id: 'observacion', label: 'Observación', Icon: StickyNote,    cls: 'text-slate-600 bg-slate-100'  },
  { id: 'llamada',     label: 'Llamada',     Icon: Phone,         cls: 'text-blue-600 bg-blue-50'     },
  { id: 'whatsapp',    label: 'WhatsApp',    Icon: MessageCircle, cls: 'text-green-600 bg-green-50'   },
  { id: 'incidente',   label: 'Incidente',   Icon: AlertTriangle, cls: 'text-red-600 bg-red-50'       },
]

// Espejo de ALLOWED_ATTACHMENT_MIMES del backend (routers/trips.py)
const ACCEPTED_FILES = '.pdf,image/png,image/jpeg,image/webp,image/heic,image/heif,.doc,.docx,.xls,.xlsx'
const MAX_FILE_BYTES = 10 * 1024 * 1024

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function typeMeta(t: TripNoteType) {
  return NOTE_TYPES.find(x => x.id === t) ?? NOTE_TYPES[0]
}

function AttachmentCard({ att }: { att: TripNoteAttachment }) {
  // HEIC/HEIF no renderizan en <img> fuera de Safari — se muestran como archivo
  const isImage = att.mime_type.startsWith('image/') && !/hei[cf]/.test(att.mime_type)
  const inner = isImage && att.url ? (
    <img src={att.url} alt={att.file_name} className="w-full h-20 object-cover rounded-t-md" />
  ) : null
  return (
    <a
      href={att.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={`block border border-border/70 rounded-md overflow-hidden bg-white hover:border-accent/40 hover:shadow-sm transition-all ${att.url ? '' : 'opacity-50 pointer-events-none'}`}
      title={att.file_name}
    >
      {inner}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {isImage
          ? <ImageIcon size={11} className="text-gray-400 shrink-0" />
          : <FileText size={11} className="text-red-400 shrink-0" />}
        <span className="text-[10px] text-slate-600 truncate">{att.file_name}</span>
        <span className="text-[9px] text-gray-300 shrink-0 ml-auto">{fmtBytes(att.size_bytes)}</span>
      </span>
    </a>
  )
}

function NoteCard({
  note, onPin, pinPending, onResolve, resolvePending,
}: {
  note: TripNote
  onPin: (n: TripNote) => void
  pinPending: boolean
  onResolve: (n: TripNote) => void
  resolvePending: boolean
}) {
  const meta = typeMeta(note.note_type)
  const isIncident = note.note_type === 'incidente'
  const resolved = !!note.resolved_at
  return (
    <div className={`group bg-white border rounded-lg px-3 py-2 shadow-sm ${note.pinned ? 'border-amber-300 bg-amber-50/40' : 'border-border/60'}`}>
      <p className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded ${meta.cls}`}>
          <meta.Icon size={9} />
          {meta.label}
        </span>
        {isIncident && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
            resolved ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
          }`}>
            {resolved ? 'Resuelto' : 'Abierto'}
          </span>
        )}
        <span className="text-[10px] font-semibold text-slate-600 truncate">
          {note.author_name ?? 'Usuario'}
        </span>
        <span className="text-[9px] text-gray-300 whitespace-nowrap" title={fmtDT(note.created_at)}>
          {formatRelativeTime(note.created_at)}
        </span>
        {isIncident && (
          <button
            type="button"
            onClick={() => onResolve(note)}
            disabled={resolvePending}
            className="text-[9px] font-semibold text-accent hover:text-accent/80 disabled:opacity-50"
          >
            {resolved ? 'Reabrir' : 'Marcar resuelto'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onPin(note)}
          disabled={pinPending}
          title={note.pinned ? 'Quitar destacado' : 'Destacar nota'}
          className={`ml-auto shrink-0 transition-all disabled:opacity-40 ${
            note.pinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-200 opacity-0 group-hover:opacity-100 hover:text-amber-500'
          }`}
        >
          {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </p>
      {note.body && <p className="text-xs text-slate-700 whitespace-pre-wrap">{note.body}</p>}
      {note.attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mt-1.5">
          {note.attachments.map(att => <AttachmentCard key={att.id} att={att} />)}
        </div>
      )}
    </div>
  )
}

interface Props {
  trip: Trip
}

export function TripNotesFeed({ trip }: Props) {
  const [draft, setDraft]           = useState('')
  const [draftType, setDraftType]   = useState<Exclude<TripNoteType, 'sistema'>>('observacion')
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  const [fileErr, setFileErr]       = useState<string | null>(null)
  const [filter, setFilter]         = useState<TripNoteType | null>(null)
  const [view, setView]             = useState<'feed' | 'documentos'>('feed')
  const fileInputRef                = useRef<HTMLInputElement>(null)

  const notesQuery  = useTripNotes(trip.id)
  const addNote     = useAddTripNote(trip.id)
  const pinNote     = usePinTripNote(trip.id)
  const resolveNote = useResolveTripNote(trip.id)

  const notes    = notesQuery.data ?? []
  const pinned   = notes.filter(n => n.pinned)
  const unpinned = notes.filter(n => !n.pinned)
  const visible  = filter ? unpinned.filter(n => n.note_type === filter) : unpinned
  const allAttachments = notes.flatMap(n =>
    n.attachments.map(att => ({ att, author: n.author_name, created_at: n.created_at })))

  function handlePickFiles(list: FileList | null) {
    if (!list) return
    setFileErr(null)
    const incoming = Array.from(list)
    const tooBig = incoming.find(f => f.size > MAX_FILE_BYTES)
    if (tooBig) { setFileErr(`${tooBig.name} supera 10MB`); return }
    setDraftFiles(prev => [...prev, ...incoming])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSubmit() {
    const body = draft.trim()
    if ((!body && draftFiles.length === 0) || addNote.isPending) return
    addNote.mutate(
      { body, note_type: draftType, files: draftFiles },
      { onSuccess: () => { setDraft(''); setDraftFiles([]); setDraftType('observacion') } },
    )
  }

  function handlePin(note: TripNote) {
    pinNote.mutate({ noteId: note.id, pinned: !note.pinned })
  }

  function handleResolve(note: TripNote) {
    resolveNote.mutate({ noteId: note.id, resolved: !note.resolved_at })
  }

  return (
    <div className="space-y-3">
      {/* Toggle Feed | Documentos — solo cuando hay adjuntos (si no, es ruido) */}
      {allAttachments.length > 0 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
          {([
            { id: 'feed',       label: 'Feed',       Icon: ListOrdered },
            { id: 'documentos', label: 'Documentos', Icon: FolderOpen  },
          ] as const).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${
                view === t.id ? 'bg-white text-slate-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <t.Icon size={10} />
              {t.label}
              {t.id === 'documentos' && (
                <span className="text-[9px] text-gray-400">({allAttachments.length})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {view === 'documentos' ? (
        /* ── Vista Documentos: todos los adjuntos del viaje ── */
        <div className="space-y-1.5">
          {allAttachments.length === 0 && (
            <p className="text-[10px] text-gray-300 italic">Sin documentos adjuntos</p>
          )}
          {allAttachments.map(({ att, author, created_at }) => (
            <a
              key={att.id}
              href={att.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 border border-border/70 rounded-lg bg-white px-3 py-2 hover:border-accent/40 hover:shadow-sm transition-all ${att.url ? '' : 'opacity-50 pointer-events-none'}`}
            >
              {att.mime_type.startsWith('image/')
                ? <ImageIcon size={14} className="text-gray-400 shrink-0" />
                : <FileText size={14} className="text-red-400 shrink-0" />}
              <span className="min-w-0">
                <span className="block text-xs text-slate-700 truncate">{att.file_name}</span>
                <span className="block text-[9px] text-gray-400">
                  {author ?? 'Usuario'} · {formatRelativeTime(created_at)} · {fmtBytes(att.size_bytes)}
                </span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <>
          {/* Filtro por tipo */}
          {notes.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {NOTE_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(prev => (prev === t.id ? null : t.id))}
                  className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border transition-all ${
                    filter === t.id ? `${t.cls} border-current` : 'text-gray-400 border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <t.Icon size={9} />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Feed — ya no vive en un sidebar angosto (Fase 2, Plan 4), sin
              tope de altura interno (Plan 5: se quitó max-h-80/overflow-y-auto). */}
          <div className="space-y-2">
            {/* Destacadas arriba */}
            {pinned.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1 text-[9px] font-bold text-amber-600 uppercase tracking-wide">
                  <Pin size={9} /> Destacadas
                </p>
                {pinned.map(n => (
                  <NoteCard key={n.id} note={n} onPin={handlePin} pinPending={pinNote.isPending} onResolve={handleResolve} resolvePending={resolveNote.isPending} />
                ))}
              </div>
            )}

            {notesQuery.isPending && (
              /* Skeleton pulsante en vez de texto de carga */
              <div className="space-y-2" aria-label="Cargando bitácora">
                {[0, 1].map(i => (
                  <div key={i} className="bg-white border border-border/60 rounded-lg px-3 py-2 animate-pulse">
                    <div className="h-2.5 w-28 bg-gray-100 rounded mb-2" />
                    <div className="h-2.5 w-full bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            )}
            {notesQuery.error && (
              <p className="text-[10px] text-red-500">
                {notesQuery.error instanceof Error ? notesQuery.error.message : 'Error cargando la bitácora'}
              </p>
            )}
            {!notesQuery.isPending && notes.length === 0 && (
              <p className="text-[10px] text-gray-300 italic">Sin novedades registradas</p>
            )}

            {visible.map(note =>
              note.note_type === 'sistema' ? (
                /* Evento del sistema: línea compacta, sin card */
                <p key={note.id} className="flex items-center gap-1.5 text-[10px] text-gray-400 px-1">
                  <Activity size={9} className="shrink-0" />
                  <span className="truncate">
                    <span className="font-medium text-gray-500">{note.author_name ?? 'Sistema'}</span>{' '}
                    {note.body.charAt(0).toLowerCase() + note.body.slice(1)}
                  </span>
                  <span className="text-gray-300 whitespace-nowrap shrink-0 ml-auto" title={fmtDT(note.created_at)}>
                    {formatRelativeTime(note.created_at)}
                  </span>
                </p>
              ) : (
                <NoteCard key={note.id} note={note} onPin={handlePin} pinPending={pinNote.isPending} onResolve={handleResolve} resolvePending={resolveNote.isPending} />
              ),
            )}
            {pinNote.error && (
              <p className="text-[10px] text-red-500">
                {pinNote.error instanceof Error ? pinNote.error.message : 'Error al destacar'}
              </p>
            )}
            {resolveNote.error && (
              <p className="text-[10px] text-red-500">
                {resolveNote.error instanceof Error ? resolveNote.error.message : 'Error al actualizar el incidente'}
              </p>
            )}
          </div>

          {/* Composer */}
          <div className="space-y-1.5">
            {/* Selector de tipo — solo el activo muestra su label (menos ruido) */}
            <div className="flex items-center gap-1">
              {NOTE_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDraftType(t.id)}
                  title={t.label}
                  aria-pressed={draftType === t.id}
                  className={`flex items-center gap-1 text-[9px] font-semibold px-1.5 py-1 rounded-md border transition-all ${
                    draftType === t.id ? `${t.cls} border-current` : 'text-gray-400 border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <t.Icon size={10} />
                  {draftType === t.id && <span>{t.label}</span>}
                </button>
              ))}
            </div>

            <div className="relative">
              <textarea
                rows={2}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
                }}
                placeholder="Registrar novedad… (⌘↵ para enviar)"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 pr-9 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Adjuntar archivo (PDF, imagen, Word o Excel, máx 10MB)"
                className="absolute right-2 top-2 text-gray-300 hover:text-accent transition-colors"
              >
                <Paperclip size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                onChange={e => handlePickFiles(e.target.files)}
                className="hidden"
                aria-label="Adjuntar archivos"
              />
            </div>

            {/* Archivos seleccionados */}
            {draftFiles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {draftFiles.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="flex items-center gap-1 text-[9px] bg-gray-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                    {f.type.startsWith('image/') ? <ImageIcon size={9} /> : <FileText size={9} />}
                    <span className="max-w-[120px] truncate">{f.name}</span>
                    <span className="text-gray-400">{fmtBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setDraftFiles(prev => prev.filter((_, j) => j !== i))}
                      className="hover:text-red-500"
                      aria-label={`Quitar ${f.name}`}
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {fileErr && <p className="text-[10px] text-red-500">{fileErr}</p>}
            {addNote.error && (
              <p className="text-[10px] text-red-500">
                {addNote.error instanceof Error ? addNote.error.message : 'Error al guardar la nota'}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={addNote.isPending || (!draft.trim() && draftFiles.length === 0)}
              className="w-full flex items-center justify-center gap-1.5 bg-accent text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {addNote.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Agregar nota
            </button>
          </div>
        </>
      )}
    </div>
  )
}
