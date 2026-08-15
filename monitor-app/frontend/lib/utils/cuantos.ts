/** "1 archivo" / "los 38".
 *
 *  Un botón de lote tiene que nombrar la cantidad exacta: con un filtro
 *  puesto, "seleccionados" no dice si son los 40 que se ven o los 2.000 que
 *  calzan, y esa ambigüedad es la causa número uno de asignaciones masivas
 *  erróneas (diseño §7, regla no negociable 1).
 *
 *  Vive acá y no en un componente porque lo usan la barra de lote y la barra
 *  de mover, y una sola de las dos lo aplicaba: "Mover 3 a otra empresa"
 *  junto a "Descartar los 3".
 */
export function cuantos(n: number) {
  return n === 1 ? '1 archivo' : `los ${n}`
}
