/** A dónde volver después de un paso de autenticación (`?next=`), solo si es
 *  una ruta interna de la app. Una URL absoluta o `//otro-sitio` convertiría el
 *  enlace de un correo en una redirección abierta hacia un sitio de phishing. */
export function destinoSeguro(next: string | null | undefined, porDefecto: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return porDefecto
  // El navegador descarta tabulaciones y saltos de línea al resolver una URL, y trata
  // la barra invertida como "/": "/\t/evil.com" o "/\\evil.com" terminan en otro sitio
  // (revisión final de la vista rápida, 11/10). Se rechazan en cualquier lugar.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return porDefecto
  return next
}
