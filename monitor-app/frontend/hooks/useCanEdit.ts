'use client'

import { useRolMinimo } from './useRolMinimo'

/** Si puede escribir: editor para arriba.
 *
 *  Se conserva como nombre propio —y no se reemplaza por `useRolMinimo` en
 *  cada llamador— porque "puede editar" es el concepto que usan las pantallas,
 *  y 'editor' es un detalle de la jerarquía. El día que cambie el nivel que
 *  habilita escribir, cambia acá y en ningún otro lado. */
export function useCanEdit(): boolean {
  return useRolMinimo('editor')
}
