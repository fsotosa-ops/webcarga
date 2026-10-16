'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { SettingsIndex } from './SettingsIndex'
import { BuscadorConfig } from './BuscadorConfig'
import { areasVisibles, primeraEditable, rutaDeSeccion } from './dominios'

/** `/settings`: en el teléfono, el índice a pantalla completa; en escritorio el
 *  índice ya está al costado (layout), así que se abre la primera sección que la
 *  persona puede ver (Configuración, Parte 1). */
export default function ConfiguracionPage() {
  const router = useRouter()
  const { permissions } = useAcceso()
  useEffect(() => {
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const area = areasVisibles(permissions)[0]
    const seccion = area && primeraEditable(area, permissions)
    if (seccion) router.replace(rutaDeSeccion(area.clave, seccion.clave))
  }, [router, permissions])
  return (
    <div className="space-y-4 md:hidden">
      <EncabezadoDePagina titulo="Configuración" bajada="Elige qué quieres ajustar. Los cambios no requieren un despliegue." />
      <BuscadorConfig />
      <SettingsIndex />
    </div>
  )
}
