// lib/utils/avatar.ts
const INITIAL_COLORS = [
  '#0A66C2', '#10b981', '#8b5cf6', '#f59e0b',
  '#ef4444', '#06b6d4', '#64748b', '#e11d48',
]

export function getInitialColor(name: string | null): string {
  if (!name) return '#64748b'
  return INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length]
}

export function getInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}
