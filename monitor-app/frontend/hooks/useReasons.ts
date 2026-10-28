import { useQuery } from '@tanstack/react-query'
import { taxonomiesApi, type TaxonomyDomain } from '@/lib/api/config'
import { taxonomyKey } from '@/lib/queries/taxonomies'

/** Un motivo de un catálogo de Configuración (app.status_taxonomies). `pideNota`: el
 *  comentario es obligatorio. Lo decide el código, no la etiqueta, así renombrar
 *  "Otro" en Configuración no rompe la regla — la misma que aplica el backend. */
export type ReasonOption = { id: string; label: string; pideNota: boolean }

export type EleccionDeMotivo = { motivoId: string; nota: string }

interface Options {
  /** El código que exige comentario: `OTRO` en anulación, `OTHER` en baja y reactivación. */
  noteCode: string
  /** A quién aplica (el `group` de la fila): `carrier`, `driver` o `asset`. Una fila
   *  sin grupo o con `all` aplica a todos. Sin `scope` no se filtra. */
  scope?: string
  /** `false` cuando la acción no pide motivo (activar una empresa que cumple). */
  enabled?: boolean
}

/** Los motivos activos de un catálogo, en el orden de Configuración. */
export function useReasons(domain: TaxonomyDomain, { noteCode, scope, enabled = true }: Options): { motivos: ReasonOption[]; cargando: boolean } {
  const q = useQuery({
    queryKey: taxonomyKey(domain),
    queryFn: () => taxonomiesApi.list(domain),
    staleTime: 5 * 60_000,
    enabled,
  })
  return {
    cargando: q.isLoading,
    motivos: (q.data ?? [])
      .filter(r => !scope || !r.group || r.group === 'all' || r.group === scope)
      .map(r => ({ id: r.id, label: r.label, pideNota: r.code === noteCode })),
  }
}

/** Si la elección alcanza para confirmar: hay motivo y, si lo pide, comentario. */
export function eleccionCompleta(motivos: ReasonOption[], e: EleccionDeMotivo): boolean {
  const m = motivos.find(x => x.id === e.motivoId)
  return !!m && (!m.pideNota || e.nota.trim().length > 0)
}
