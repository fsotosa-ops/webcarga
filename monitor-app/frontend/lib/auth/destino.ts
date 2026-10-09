/** A dónde volver después de un paso de autenticación (`?next=`), solo si es
 *  una ruta interna de la app. Una URL absoluta o `//otro-sitio` convertiría el
 *  enlace de un correo en una redirección abierta hacia un sitio de phishing. */
export function destinoSeguro(next: string | null | undefined, porDefecto: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return porDefecto
  return next
}
