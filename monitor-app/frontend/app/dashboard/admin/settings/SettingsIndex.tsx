'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { inventarioApi } from '@/lib/api/config'
import { areasVisibles, rutaDeSeccion } from './dominios'

/** El índice de Configuración (Parte 1): un solo nivel bajo el menú de la app,
 *  agrupado por área, como Linear, GitHub o Vercel. Muestra solo las áreas que la
 *  persona puede configurar; cada entrada dice cuánto falta revisar. Reemplaza la
 *  portada de tarjetas y las pestañas por dominio. */
export function SettingsIndex() {
  const ruta = usePathname()
  const { permissions } = useAcceso()
  const inventario = useQuery({ queryKey: ['config-inventario'], queryFn: inventarioApi.get })

  return (
    <nav aria-label="Configuración" className="space-y-4">
      {areasVisibles(permissions).map(area => (
        <div key={area.clave}>
          <p className="flex items-center gap-1.5 px-2.5 text-etiqueta font-semibold text-informativo">
            <area.icono size={13} aria-hidden="true" /> {area.titulo}
          </p>
          <ul className="mt-1 space-y-0.5">
            {area.secciones.map(s => {
              const href = rutaDeSeccion(area.clave, s.clave)
              const activa = ruta === href
              // Sin cifra mientras carga ni cuando es cero: un "0" no orienta.
              const pendientes = inventario.data?.[area.clave]?.secciones?.[s.clave] ?? 0
              return (
                <li key={s.clave}>
                  <Link href={href} prefetch={false} aria-current={activa ? 'page' : undefined}
                        className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-dato transition-colors ${
                          activa ? 'bg-accion/10 font-semibold text-accion' : 'text-text-primary hover:bg-bg-main'
                        }`}>
                    <span>{s.titulo}</span>
                    {pendientes > 0 && (
                      <span className="text-etiqueta font-semibold tabular-nums text-warning" title="Sin revisar">{pendientes}</span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
