'use client'

import { useMemo, useState } from 'react'
import type { CarrierSearchResult } from '@/components/dashboard/CarrierSearchPicker'

/** De dónde salió la empresa con la que se está trabajando.
 *
 *  Importa porque decide QUÉ SE PUEDE HACER con ella, y ese es justo el dato
 *  que la Bandeja no tenía: sin saber el origen no se puede decidir si ofrecer
 *  quitarla, y ofrecerla siempre —o nunca— es lo que hacía el control
 *  incomprensible. */
export type OrigenDeEmpresa =
  /** La ruta: se entró a la bandeja de una empresa. No es una elección, es
   *  dónde se está parado. */
  | 'ruta'
  /** Los archivos marcados ya la traen. Tampoco es una elección: es un hecho
   *  del dato, y ofrecer quitarla sugeriría que se les puede sacar desde acá. */
  | 'archivos'
  /** Alguien la eligió en esta pantalla. La única que se puede quitar. */
  | 'elegida'
  /** Todavía nadie dijo de quién es esto. */
  | 'ninguna'

export interface EmpresaDeTrabajo {
  empresa: { id: string; business_name: string } | null
  origen: OrigenDeEmpresa
  /** Sólo cuando `origen === 'elegida'`. Verlo escrito evita que cada llamador
   *  vuelva a derivar la misma condición — que es como aparecieron las cuatro
   *  colisiones de la Ronda 139. */
  sePuedeQuitar: boolean
  fijar: (c: CarrierSearchResult) => void
  quitar: () => void
}

/** La ÚNICA respuesta a "¿de qué empresa es lo que estoy trabajando?".
 *
 *  POR QUÉ EXISTE. `TriageWorkbench` sostenía DIEZ representaciones de
 *  "empresa" —`carrierId`, `carrierName`, `empresaInicial`, `empresaElegida`,
 *  `empresaDelLote`, `selectedCarrierId`, `subjectCarrierId`, `carrierLabel`,
 *  y dos cajas de búsqueda en dos componentes— más una tercera regla de
 *  precedencia escrita inline en la subida. Los cuatro defectos del
 *  2026-08-21 fueron choques entre pares de esas diez: dos buscadores a la
 *  vez, el indicador escondido por una condición derivada de otro, "Este lote
 *  es de X" contra filas que decían "Sin empresa", y una elección sin inverso.
 *
 *  Es el mismo movimiento que `canEdit` en la ficha de empresa: derivar una
 *  vez y pasar hacia abajo, en vez de recalcular en cada consumidor.
 *
 *  LA EMPRESA SIGUE SIENDO OPCIONAL, a propósito y por decisión previa: "la
 *  tanda mezclada que llega por correo es un caso legítimo, y exigirla
 *  convertiría la bandeja en un buscador". Este hook no la vuelve obligatoria;
 *  la vuelve UNA.
 *
 *  La precedencia va de lo más fuerte a lo más débil, y no es arbitraria: un
 *  hecho manda sobre una elección, porque una elección que contradice al dato
 *  no puede aplicarse. */
export function useEmpresaDeTrabajo({
  deLaRuta,
  deLosArchivos,
  inicial,
}: {
  /** La empresa de la ruta, si la bandeja está acotada a una. */
  deLaRuta?: { id: string; business_name: string } | null
  /** La empresa que ya tienen los archivos marcados o enfocados, si todos
   *  comparten una. `null` cuando no hay ninguno, cuando no la tienen, o
   *  cuando cruzan empresas. */
  deLosArchivos?: { id: string; business_name: string } | null
  /** La que trae el enlace al entrar desde la ficha de una empresa. Es una
   *  preselección, no un hecho: se puede cambiar y quitar. */
  inicial?: { id: string; business_name: string } | null
}): EmpresaDeTrabajo {
  /** `null` significa "todavía nadie eligió", no "ninguna". La preselección
   *  del enlace NO se siembra acá: se resuelve abajo en la precedencia. Sembrar
   *  un estado desde un prop es el bug que este frontend ya tuvo tres veces —
   *  el draft que no se resincroniza cuando el prop cambia. */
  const [elegida, setElegida] = useState<{ id: string; business_name: string } | null>(null)
  /** Distingue "todavía no eligió" de "eligió quitarla". Sin esto, quitar una
   *  empresa que vino por el enlace la devolvía en el render siguiente: el
   *  botón parecía roto. */
  const [quitadaAMano, setQuitadaAMano] = useState(false)

  return useMemo(() => {
    const resuelta =
      deLaRuta      ? { empresa: deLaRuta,      origen: 'ruta'     as const } :
      deLosArchivos ? { empresa: deLosArchivos, origen: 'archivos' as const } :
      elegida       ? { empresa: elegida,       origen: 'elegida'  as const } :
      (inicial && !quitadaAMano)
                    ? { empresa: inicial,       origen: 'elegida'  as const } :
                      { empresa: null,          origen: 'ninguna'  as const }

    return {
      ...resuelta,
      sePuedeQuitar: resuelta.origen === 'elegida',
      fijar: (c: CarrierSearchResult) => {
        setQuitadaAMano(false)
        setElegida({ id: c.id, business_name: c.business_name })
      },
      quitar: () => {
        setElegida(null)
        setQuitadaAMano(true)
      },
    }
  }, [deLaRuta, deLosArchivos, elegida, inicial, quitadaAMano])
}
