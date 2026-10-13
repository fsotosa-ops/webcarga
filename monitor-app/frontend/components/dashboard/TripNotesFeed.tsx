'use client'

import { useRef, useState } from 'react'
import {
  Loader2, Paperclip, X, Pin, PinOff,
  Phone, MessageCircle, AlertTriangle, StickyNote, Activity,
  FileText, ImageIcon, FolderOpen, ListOrdered, Bot,
} from 'lucide-react'
import type { Trip, TripNote, TripNoteAttachment, TripNoteType } from '@/lib/types'
import { useTripNotes, useAddTripNote, usePinTripNote, useResolveTripNote } from '@/hooks/useTripNotes'
import { formatRelativeTime, fmtDT } from '@/lib/utils/datetime'
import { StatusChip, type StatusTone } from '@/components/ui/StatusChip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

const NOTE_TYPES: { id: Exclude<TripNoteType, 'sistema'>; label: string; Icon: typeof Phone; tone: StatusTone }[] = [
  { id: 'observacion', label: 'Observación', Icon: StickyNote,    tone: 'neutral'  },
  { id: 'llamada',     label: 'Llamada',     Icon: Phone,         tone: 'action'   },
  { id: 'whatsapp',    label: 'WhatsApp',    Icon: MessageCircle, tone: 'resolved' },
  { id: 'incidente',   label: 'Incidente',   Icon: AlertTriangle, tone: 'urgent'   },
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
      className={`block overflow-hidden rounded-md border border-border bg-white transition-colors hover:border-accion/40 ${att.url ? '' : 'pointer-events-none opacity-50'}`}
      title={att.file_name}
    >
      {inner}
      <span className="flex items-center gap-1.5 px-2 py-1.5">
        {isImage
          ? <ImageIcon size={12} className="shrink-0 text-informativo" aria-hidden />
          : <FileText size={12} className="shrink-0 text-informativo" aria-hidden />}
        <span className="truncate text-etiqueta text-text-primary">{att.file_name}</span>
        <span className="ml-auto shrink-0 text-etiqueta tabular-nums text-informativo">{fmtBytes(att.size_bytes)}</span>
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
    <div className={`group rounded-md border px-3 py-2 ${note.pinned ? 'border-warning/30 bg-warning/5' : 'border-border bg-white'}`}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <StatusChip tone={meta.tone}>
          <meta.Icon size={11} className="mr-1" aria-hidden />
          {meta.label}
        </StatusChip>
        {isIncident && (
          <StatusChip tone={resolved ? 'resolved' : 'urgent'}>{resolved ? 'Resuelto' : 'Abierto'}</StatusChip>
        )}
        <span className="truncate text-etiqueta font-semibold text-text-primary">
          {note.author_name ?? 'Usuario'}
        </span>
        <span className="whitespace-nowrap text-etiqueta text-informativo" title={fmtDT(note.created_at)}>
          {formatRelativeTime(note.created_at)}
        </span>
        {isIncident && (
          <button
            type="button"
            onClick={() => onResolve(note)}
            disabled={resolvePending}
            className="text-etiqueta font-semibold text-accion hover:underline disabled:opacity-50"
          >
            {resolved ? 'Reabrir' : 'Marcar resuelto'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onPin(note)}
          disabled={pinPending}
          title={note.pinned ? 'Quitar destacado' : 'Destacar nota'}
          aria-label={note.pinned ? 'Quitar destacado' : 'Destacar nota'}
          className={`ml-auto shrink-0 rounded transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 ${
            note.pinned ? 'text-warning' : 'text-informativo opacity-0 group-hover:opacity-100 hover:text-warning'
          }`}
        >
          {note.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
      </div>
      {note.body && <p className="whitespace-pre-wrap text-dato text-text-primary">{note.body}</p>}
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
        <SegmentedControl
          label="Vista de la bitácora"
          value={view}
          onChange={setView}
          options={[
            { id: 'feed',       label: 'Feed',       Icon: ListOrdered },
            { id: 'documentos', label: 'Documentos', Icon: FolderOpen, badge: `(${allAttachments.length})` },
          ]}
        />
      )}

      {view === 'documentos' ? (
        /* ── Vista Documentos: todos los adjuntos del viaje ── */
        <div className="space-y-1.5">
          {allAttachments.length === 0 && (
            <p className="text-dato text-informativo">Sin documentos adjuntos.</p>
          )}
          {allAttachments.map(({ att, author, created_at }) => (
            <a
              key={att.id}
              href={att.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 transition-colors hover:border-accion/40 ${att.url ? '' : 'pointer-events-none opacity-50'}`}
            >
              {att.mime_type.startsWith('image/')
                ? <ImageIcon size={14} className="shrink-0 text-informativo" aria-hidden />
                : <FileText size={14} className="shrink-0 text-informativo" aria-hidden />}
              <span className="min-w-0">
                <span className="block truncate text-dato text-text-primary">{att.file_name}</span>
                <span className="block text-etiqueta text-informativo">
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
            <SegmentedControl
              label="Filtrar por tipo"
              value={filter}
              onChange={id => setFilter(prev => (prev === id ? null : id))}
              options={NOTE_TYPES}
            />
          )}

          {/* Feed — ya no vive en un sidebar angosto (Fase 2, Plan 4), sin
              tope de altura interno (Plan 5: se quitó max-h-80/overflow-y-auto). */}
          <div className="space-y-2">
            {/* Destacadas arriba */}
            {pinned.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1 text-etiqueta font-semibold text-warning">
                  <Pin size={11} aria-hidden /> Destacadas
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
                  <div key={i} className="animate-pulse rounded-md border border-border bg-white px-3 py-2">
                    <div className="mb-2 h-2.5 w-28 rounded bg-bg-main" />
                    <div className="h-2.5 w-full rounded bg-bg-main" />
                  </div>
                ))}
              </div>
            )}
            {notesQuery.error && (
              <p role="alert" className="text-etiqueta text-status-incidente">
                {notesQuery.error instanceof Error ? notesQuery.error.message : 'Error cargando la bitácora'}
              </p>
            )}
            {!notesQuery.isPending && notes.length === 0 && (
              <p className="text-dato text-informativo">Sin novedades registradas.</p>
            )}

            {visible.map(note =>
              note.note_type === 'sistema' ? (
                /* Evento del sistema: línea compacta, sin card */
                <p key={note.id} className="flex items-center gap-1.5 px-1 text-etiqueta text-informativo">
                  {/* Sin autor = nota automática (p. ej. Divergencia TMS). Se decide por
                      author_id: un author_name nulo con autor es un perfil sin nombre. */}
                  {note.author_id === null
                    ? <Bot size={11} className="shrink-0" role="img" aria-label="Nota automática del sistema" />
                    : <Activity size={11} className="shrink-0" aria-hidden />}
                  <span className="truncate">
                    <span className="font-semibold">
                      {note.author_id === null ? 'Sistema' : (note.author_name ?? 'Usuario')}
                    </span>{' '}
                    {note.body.charAt(0).toLowerCase() + note.body.slice(1)}
                  </span>
                  <span className="ml-auto shrink-0 whitespace-nowrap" title={fmtDT(note.created_at)}>
                    {formatRelativeTime(note.created_at)}
                  </span>
                </p>
              ) : (
                <NoteCard key={note.id} note={note} onPin={handlePin} pinPending={pinNote.isPending} onResolve={handleResolve} resolvePending={resolveNote.isPending} />
              ),
            )}
            {pinNote.error && (
              <p role="alert" className="text-etiqueta text-status-incidente">
                {pinNote.error instanceof Error ? pinNote.error.message : 'Error al destacar'}
              </p>
            )}
            {resolveNote.error && (
              <p role="alert" className="text-etiqueta text-status-incidente">
                {resolveNote.error instanceof Error ? resolveNote.error.message : 'Error al actualizar el incidente'}
              </p>
            )}
          </div>

          {/* Composer */}
          <div className="space-y-2">
            <SegmentedControl label="Tipo de nota" value={draftType} onChange={setDraftType} options={NOTE_TYPES} />

            <div className="relative">
              <textarea
                rows={2}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit() }
                }}
                placeholder="Registrar novedad… (⌘↵ para enviar)"
                className="w-full resize-none rounded-md border border-border bg-white px-3 py-2 pr-9 text-dato text-text-primary placeholder:text-informativo focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Adjuntar archivo (PDF, imagen, Word o Excel, máx 10MB)"
                aria-label="Adjuntar archivo"
                className="absolute right-2 top-2 rounded text-informativo transition-colors hover:text-accion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Paperclip size={14} aria-hidden />
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
                  <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-informativo/10 px-2 py-0.5 text-etiqueta text-text-primary">
                    {f.type.startsWith('image/') ? <ImageIcon size={11} aria-hidden /> : <FileText size={11} aria-hidden />}
                    <span className="max-w-[120px] truncate">{f.name}</span>
                    <span className="tabular-nums text-informativo">{fmtBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setDraftFiles(prev => prev.filter((_, j) => j !== i))}
                      className="text-informativo hover:text-status-incidente"
                      aria-label={`Quitar ${f.name}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {fileErr && <p role="alert" className="text-etiqueta text-status-incidente">{fileErr}</p>}
            {addNote.error && (
              <p role="alert" className="text-etiqueta text-status-incidente">
                {addNote.error instanceof Error ? addNote.error.message : 'Error al guardar la nota'}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={addNote.isPending || (!draft.trim() && draftFiles.length === 0)}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-dato font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {addNote.isPending && <Loader2 size={13} className="animate-spin" aria-hidden />}
                Agregar nota
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
