/** El código de 6 dígitos de la app de autenticación, tal como lo escriba o
 *  pegue la persona (09/10). Microsoft Authenticator lo muestra con un espacio
 *  ("123 456"): con `maxLength={6}` y `pattern="[0-9]{6}"` el campo quedaba en
 *  "123 45", el navegador bloqueaba el envío y "Activar" no hacía nada (caso de
 *  un admin el mismo día del despliegue: 0 intentos llegaron a Supabase). */
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, '').slice(0, 6)
}
