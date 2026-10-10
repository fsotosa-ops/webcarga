export type EstadoDeAcceso = 'ok' | 'sin-acceso' | 'desactivada' | 'sin-sesion' | 'no-disponible'

/** Qué significa la respuesta de GET /me. Solo un 403 niega el acceso; una
 *  caída de la API (5xx, arranque en frío, red) es "no disponible" y no debe
 *  cerrar la sesión ni mandar a pedir una invitación. */
export function clasificarRespuestaMe(status: number, detail: unknown): EstadoDeAcceso {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401) return 'sin-sesion'
  if (status === 403) return String(detail ?? '').includes('desactivada') ? 'desactivada' : 'sin-acceso'
  return 'no-disponible'
}

/** A dónde va quien no obtuvo su acceso, según el motivo. */
export function destinoSinAcceso(estado: Exclude<EstadoDeAcceso, 'ok'>): string {
  switch (estado) {
    case 'sin-sesion':    return '/login'
    case 'desactivada':   return '/auth/access-denied?reason=deactivated'
    case 'sin-acceso':    return '/auth/access-denied?reason=not-invited'
    case 'no-disponible': return '/auth/no-disponible'
  }
}
