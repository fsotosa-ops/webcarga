'use client'

import { useState, type DragEvent, type ChangeEvent } from 'react'
import type { PoliticaVencimiento } from '@/lib/types'

/** En qué punto está la carga de UN documento. Es UN valor con la forma del
 *  estado, no cuatro booleanos sueltos: `subiendo` + `error` + `listo` +
 *  `archivo` daban dieciséis combinaciones para seis situaciones reales, y la
 *  mitad no significan nada ("subiendo y listo a la vez"). */
export type EstadoCarga =
  | { tipo: 'reposo' }
  | { tipo: 'recibiendo' }
  | { tipo: 'pidiendo-fecha'; archivo: File }
  | { tipo: 'subiendo' }
  | { tipo: 'listo' }
  | { tipo: 'error'; motivo: string; archivo: File | null; vencimiento?: string }

interface Opciones {
  politica:    PoliticaVencimiento
  puedeEditar: boolean
  /** Sube el documento. Recibe la fecha sólo si el requisito la contempla. */
  onSubir:     (archivo: File, vencimiento?: string) => Promise<void>
}

/** El gesto de cubrir un requisito: recibir un archivo, pedir la fecha si el
 *  catálogo dice que hace falta, y **recién entonces** subir.
 *
 *  Es un hook y no un componente **a propósito**, por la misma razón que
 *  `useFilaAbierta`: lo consumen dos superficies con formas incompatibles —el
 *  renglón ancho de Certificación y el nodo compacto de la ficha, que además
 *  lleva su círculo de estado, su vista previa y su reasignación—. Un
 *  envoltorio común obligaría a una de las dos a deformarse, y envolver una en
 *  la otra dibujaría el nombre del documento dos veces.
 *
 *  Lo que sí es una sola implementación es la REGLA, que es donde estaba el
 *  defecto: las dos superficies subían el archivo primero y dejaban que el
 *  servidor rechazara con 422 por falta de fecha, dejando el documento varado.
 *  **Nada se sube hasta estar completo** se decide una vez, acá. */
export function useGestoDeCarga({ politica, puedeEditar, onSubir }: Opciones) {
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'reposo' })
  const [vencimiento, setVencimiento] = useState('')
  const ocupado = estado.tipo === 'subiendo'

  async function subir(archivo: File, fecha?: string) {
    setEstado({ tipo: 'subiendo' })
    try {
      await onSubir(archivo, fecha)
      setEstado({ tipo: 'listo' })
    } catch (e) {
      setEstado({
        tipo: 'error',
        motivo: e instanceof Error && e.message ? e.message : 'No se pudo subir el documento',
        archivo,
        vencimiento: fecha,
      })
    }
  }

  /** El archivo recién llegó, por clic o soltándolo. Si el requisito no pide
   *  fecha, no hay nada más que preguntar y sale de una. */
  function recibir(archivo: File | undefined) {
    if (!archivo || ocupado) return
    if (politica === 'NONE') {
      void subir(archivo)
      return
    }
    setVencimiento('')
    setEstado({ tipo: 'pidiendo-fecha', archivo })
  }

  function guardar() {
    if (estado.tipo !== 'pidiendo-fecha') return
    // Con la fecha obligatoria, guardar sin ella no hace nada: el requisito
    // no queda cubierto por un documento del que no se sabe hasta cuándo vale.
    if (politica === 'REQUIRED' && !vencimiento) return
    void subir(estado.archivo, vencimiento || undefined)
  }

  function reintentar() {
    if (estado.tipo !== 'error' || !estado.archivo) return
    void subir(estado.archivo, estado.vencimiento)
  }

  /** Lo que convierte un elemento cualquiera en blanco de arrastre. Props
   *  sueltas, para que cada superficie las ponga donde su layout las quiere. */
  const propsDeZona = () => ({
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      if (!puedeEditar) return
      recibir(e.dataTransfer?.files?.[0])
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!puedeEditar || ocupado) return
      e.preventDefault()
      if (estado.tipo === 'reposo') setEstado({ tipo: 'recibiendo' })
    },
    onDragLeave: () => {
      if (estado.tipo === 'recibiendo') setEstado({ tipo: 'reposo' })
    },
  })

  /** El `<input type="file">` siempre se limpia: sin esto, elegir el mismo
   *  archivo dos veces seguidas no dispara `change` y parece que no pasó nada. */
  const propsDeInput = () => ({
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      recibir(e.target.files?.[0])
      e.target.value = ''
    },
  })

  return { estado, vencimiento, setVencimiento, recibir, guardar, reintentar, propsDeZona, propsDeInput }
}
