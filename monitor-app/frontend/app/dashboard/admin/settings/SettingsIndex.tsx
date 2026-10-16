'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAcceso } from '@/lib/authz/PermisosProvider'
import { inventarioApi } from '@/lib/api/config'
import { areasVisibles, rutaDeSeccion, seccionesVisibles } from './dominios'

/** El índice de Configuración (Parte 1): un solo nivel bajo el menú de la app,
 *  agrupado por área, como Linear, GitHub o Vercel. Muestra solo las áreas que la
 *  persona puede configurar; cada entrada dice cuánto falta revisar. Reemplaza la
 *  portada de tarjetas y las pestañas por dominio.
 *
 *  Dos variantes del mismo índice (16/10, "no se entiende lo que hace"): en el
 *  `menu` de escritorio se titula y cada ajuste dice qué hace al pasar el mouse;
 *  en la `portada` del teléfono lo dice debajo de su nombre. En las dos, el número
 *  se nombra: es lo que falta revisar. */
export function SettingsIndex({ variante = 'menu' }: { variante?: 'menu' | 'portada' }) {
  const ruta = usePathname()
  const { permissions } = useAcceso()
  const inventario = useQuery({ queryKey: ['config-inventario'], queryFn: inventarioApi.get })
  const areas = areasVisibles(permissions)
  // Sin cifra mientras carga ni cuando es cero: un "0" no orienta.
  const pendientesDe = (area: string, seccion: string) => inventario.data?.[area]?.secciones?.[seccion] ?? 0
  const hayPendientes = areas.some(a => seccionesVisibles(a, permissions).some(s => pendientesDe(a.clave, s.clave) > 0))
  const portada = variante === 'portada'

  return (
    <nav aria-label="Configuración" className="space-y-4">
      {!portada && (
        <div className="px-2.5">
          <h2 className="text-lectura font-bold text-text-primary">Configuración</h2>
          {hayPendientes && <p className="mt-0.5 text-etiqueta text-informativo">El número es lo que falta revisar.</p>}
        </div>
      )}
      {portada && hayPendientes && (
        <p className="px-2.5 text-etiqueta text-informativo">El número es lo que falta revisar.</p>
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
              const pendientes = pendientesDe(area.clave, s.clave)
              return (
                <li key={s.clave}>
                  <Link href={href} prefetch={false} aria-current={activa ? 'page' : undefined}
                        title={portada ? undefined : s.proposito}
                        aria-label={pendientes > 0 ? `${s.titulo}, ${pendientes} sin revisar` : s.titulo}
                        className={`flex items-center justify-between gap-2 rounded-md px-2.5 ${portada ? 'py-2' : 'py-1.5'} text-dato transition-colors ${
                          activa ? 'bg-accion/10 font-semibold text-accion' : 'text-text-primary hover:bg-bg-main'
                        }`}>
                    <span className="min-w-0">
                      {s.titulo}
                      {portada && <span className="block text-etiqueta font-normal text-informativo">{s.proposito}</span>}
                    </span>
                    {pendientes > 0 && (
                      <span className="text-etiqueta font-semibold tabular-nums text-warning">
                        {pendientes}
                      </span>
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
