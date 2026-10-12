/**
 * RUT y patente en su forma canónica, espejo exacto de `public.canonical_rut` y
 * `public.canonical_plate` (migración 20260817120000_identidad_canonica.sql).
 * La base guarda drivers/assets canónicos, pero `carriers.tax_id` no (D3), y lo
 * que una persona escribe trae puntos, guiones y espacios: comparar el texto
 * crudo hacía que "12.345.678" no encontrara a "12345678-5" (D1 §7.2).
 */

/** Dígito verificador, módulo 11 (`public.rut_check_digit`). */
function rutCheckDigit(body: string): string {
  let total = 0
  body.split('').reverse().forEach((c, i) => { total += Number(c) * ((i % 6) + 2) })
  const r = 11 - (total % 11)
  return r === 11 ? '0' : r === 10 ? 'K' : String(r)
}

/** `NNNNNNNN-D`, o `null` si no es un RUT válido. No inventa un DV. */
export function canonicalRut(input: string | null | undefined): string | null {
  if (input == null) return null
  const stripped = input.replace(/[^0-9kK]/g, '').toUpperCase()
  if (stripped.length < 8 || stripped.length > 9) return null
  const body = stripped.slice(0, -1)
  const dv = stripped.slice(-1)
  if (!/^[0-9]+$/.test(body)) return null
  return rutCheckDigit(body) === dv ? `${body}-${dv}` : null
}

/** `AAAA99`, o `null`. */
export function canonicalPlate(input: string | null | undefined): string | null {
  const s = (input ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return /^[A-Z0-9]{6}$/.test(s) ? s : null
}

/** Dígitos y K en mayúscula, sin validar: la forma de un RUT guardado para comparar. */
export const rutDigits = (input: string | null | undefined): string => (input ?? '').replace(/[^0-9kK]/g, '').toUpperCase()

/** Para buscar un pedazo de RUT, igual que la búsqueda del backend: dígitos y K
 *  en mayúscula, de 4 caracteres o más, y solo si el texto no trae otras letras
 *  (si no, "Kevin" buscaría la K de un DV). Vacío = no es una búsqueda por RUT. */
export function rutSearchKey(input: string): string {
  if (/[A-JL-Za-jl-z]/.test(input)) return ''
  const key = rutDigits(input)
  return key.length >= 4 ? key : ''
}
/** Para buscar un pedazo de patente: alfanumérico en mayúscula. */
export const plateSearchKey = (input: string): string => input.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
