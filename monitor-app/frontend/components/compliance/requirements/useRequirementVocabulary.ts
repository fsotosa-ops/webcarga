'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { taxonomiesApi } from '@/lib/api/config'
import { taxonomyKey } from '@/lib/queries/taxonomies'
import type { Vocabulario } from './frase-de-la-regla'

/** Los subtipos y tipos de gestión con que se enuncia y se edita la condición
 *  de un documento, y el vocabulario de la frase "Se exige a". Salen del
 *  catálogo, no de una lista escrita al lado (estaban copiados en tres lugares
 *  del frontend más la función de Postgres). */
export function useRequirementVocabulary() {
  const tax = useQuery({
    queryKey: taxonomyKey('FLEET_SERVICE_TYPE'),
    queryFn: () => taxonomiesApi.list('FLEET_SERVICE_TYPE'),
  })
  const gestionesTax = useQuery({
    queryKey: taxonomyKey('WEBCARGA_OPERATION_TYPE'),
    queryFn: () => taxonomiesApi.list('WEBCARGA_OPERATION_TYPE'),
  })

  // Su cantidad es el TOTAL contra el que se enuncia una regla de varios
  // subtipos: "9 de 10", no "sólo 9".
  const subtipos = useMemo(
    () => (tax.data ?? []).map(t => ({ id: t.id, label: t.label })),
    [tax.data],
  )
  // Por CÓDIGO, no por nombre visible: es lo que guardan las reglas y
  // `carriers`, y permite renombrar la etiqueta sin cambiar a quién alcanza.
  const gestiones = useMemo(
    () => (gestionesTax.data ?? [])
      .filter(g => g.code)
      .map(g => ({ id: g.code as string, label: g.label })),
    [gestionesTax.data],
  )

  const vocabulario = useMemo<Vocabulario>(() => {
    const subtipo = new Map(subtipos.map(s => [s.id, s.label]))
    const gestion = new Map(gestiones.map(g => [g.id, g.label]))
    return {
      // Un subtipo desactivado desaparece del catálogo pero su id sigue en la
      // regla: sin este respaldo la frase diría "Sólo undefined".
      subtipo: (id: string) => subtipo.get(id) ?? 'un subtipo dado de baja',
      totalSubtipos: subtipos.length,
      gestion: (code: string) => gestion.get(code) ?? 'un tipo de gestión que ya no existe',
      totalGestiones: gestiones.length,
    }
  }, [subtipos, gestiones])

  // Las consultas, para quien muestre su carga o su error.
  return { subtipos, gestiones, vocabulario, tax, gestionesTax }
}
