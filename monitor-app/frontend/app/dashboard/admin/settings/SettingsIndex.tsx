'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { areasVisibles, rutaDeSeccion, seccionesVisibles } from './dominios'

/** El índice de Configuración (Parte 1): un solo nivel bajo el menú de la app,
 *  agrupado por área, como Linear, GitHub o Vercel. Muestra solo las áreas que la
 *  persona puede configurar. Sin números: "Sin revisar" salió de Configuración
 *  (spec 2026-10-22 §3.2). Reemplaza la portada de tarjetas y las pestañas por dominio.
 *
 *  Dos variantes del mismo índice (16/10, "no se entiende lo que hace"): en el
 *  `menu` de escritorio se titula y cada ajuste dice qué hace al pasar el mouse;
 *  en la `portada` del teléfono lo dice debajo de su nombre. El aviso de cambios
 *  sin guardar cubre sus enlaces como los de toda la app (unsavedChanges.ts). */
export function SettingsIndex({ variante = 'menu' }: { variante?: 'menu' | 'portada' }) {
  const ruta = usePathname()
  const { permissions } = useAcceso()
  const areas = areasVisibles(permissions)
  const portada = variante === 'portada'

  return (
    <nav aria-label="Configuración" className="space-y-4">
      {!portada && (
        <div className="px-2.5">
          <h2 className="text-lectura font-bold text-text-primary">Configuración</h2>
        </div>
      )}
      {areas.map(area => (
        <div key={area.clave}>
          <p className="flex items-center gap-1.5 px-2.5 text-dato font-semibold text-text-primary">
            <area.icono size={14} className="text-informativo" aria-hidden="true" /> {area.titulo}
          </p>
          <ul className="mt-1 space-y-0.5">
            {seccionesVisibles(area, permissions).map(s => {
              const href = rutaDeSeccion(area.clave, s.clave)
              const activa = ruta === href
              return (
                <li key={s.clave}>
                  <Link href={href} prefetch={false} aria-current={activa ? 'page' : undefined}
                        title={portada ? undefined : s.proposito}
                        className={`flex items-center justify-between gap-2 rounded-md px-2.5 ${portada ? 'py-2' : 'py-1.5'} text-dato transition-colors ${
                          activa ? 'bg-accion/10 font-semibold text-accion' : 'text-text-primary hover:bg-bg-main'
                        }`}>
                    <span className="min-w-0">
                      {s.titulo}
                      {portada && <span className="block text-etiqueta font-normal text-informativo">{s.proposito}</span>}
                    </span>
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
