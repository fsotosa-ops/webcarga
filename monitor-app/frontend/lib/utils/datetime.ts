// Timestamps sin offset (ej. "2026-05-28 20:07:03") vienen del pipeline como UTC — agregar Z.
function normalizeUTC(iso: string): string {
  return /[Z+\-]\d{2}:?\d{2}$/.test(iso) || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z'
}

export function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(normalizeUTC(iso))
  if (isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`
}

export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(normalizeUTC(iso))
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}
