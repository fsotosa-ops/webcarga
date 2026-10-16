/** `?next=` hacia la lista de la que se vino: lo usan todas las fichas. */
export function withReturn(url: string, returnTo?: string): string {
  if (!returnTo) return url
  return `${url}${url.includes('?') ? '&' : '?'}next=${encodeURIComponent(returnTo)}`
}
