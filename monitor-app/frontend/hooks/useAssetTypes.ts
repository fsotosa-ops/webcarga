import { useQuery } from '@tanstack/react-query'
import { assetsApi } from '@/lib/api/assets'
import type { AssetType, AssetTypeRow } from '@/lib/types'

/** El catálogo de tipos de equipo (`public.asset_types`), en su orden. Es la
 *  única fuente de los tipos y sus etiquetas en pantalla. `labelOf` devuelve el
 *  código mientras el catálogo no llega o si no lo conoce. */
export function useAssetTypes(): { types: AssetTypeRow[]; labelOf: (code: AssetType | null | undefined) => string } {
  const q = useQuery({ queryKey: ['asset-types'], queryFn: assetsApi.types, staleTime: Infinity })
  const types = q.data ?? []
  return {
    types,
    labelOf: code => types.find(t => t.code === code)?.label ?? code ?? '',
  }
}
