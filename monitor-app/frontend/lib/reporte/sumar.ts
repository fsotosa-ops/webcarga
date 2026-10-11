/** Suma de una columna numérica: el pie de cada tabla del reporte (minuta 09/10,
 *  ítem 9), para que el número se compare de frente con el Excel de operaciones.
 *  Una sola definición para la pantalla, el árbol y el Excel. */
export function sumar<T>(filas: T[], valor: (fila: T) => number | undefined): number {
  return filas.reduce((acc, f) => acc + (valor(f) ?? 0), 0)
}
