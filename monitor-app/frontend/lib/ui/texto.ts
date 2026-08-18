/**
 * Los dos grises de texto que el sistema visual todavía no tiene como token.
 *
 * Existen acá y no repetidos por componente porque lo que importa no es
 * cuántas veces se escribe la clase, sino **cuántas decisiones de color se
 * toman fuera del sistema**: son dos, y están nombradas. Es lo mismo que
 * cuenta el trinquete de `lib/ui/sistema.test.ts`.
 *
 * Cuando el spec del sistema visual defina tokens de texto secundario, se
 * cambian acá y no en cada pantalla. Los colores que SÍ son token
 * —`text-text-primary`, `border-border`, `bg-bg-main`, `accent`, `espera`,
 * `accion`, `resuelto`— se usan directo, nunca a través de esto.
 */
export const TEXTO_APOYO = 'text-gray-500'   // RUT, empresa, rótulos: acompaña al dato
export const TEXTO_CUERPO = 'text-gray-600'  // texto que se lee de corrido
