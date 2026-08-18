/**
 * Nombres de persona en mayúsculas del TMS, presentados legibles.
 *
 * Vivía exportada desde `TripTable.tsx`. Se movió acá en 2026-08-18 cuando
 * `CeldaConductor` la necesitó: importar una utilidad DESDE un componente
 * crea un ciclo en cuanto ese componente importa al otro — que es
 * exactamente lo que pasa cuando la tabla monta la celda.
 *
 * Sólo corrige mayúsculas y espacios. NO agrega tildes: "SUAREZ" sale
 * "Suarez", porque inventar acentuación sobre un dato de origen sería
 * cambiarlo.
 */
export function nombreLegible(nombre: string): string {
  return nombre
    .trim()
    .replace(/\s+/g, ' ')
    // El punto final llega pegado o separado: "NOLASCO ." es un valor real.
    .replace(/\s*\.\s*$/, '')
    .toLocaleLowerCase('es-CL')
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-CL'))
}
