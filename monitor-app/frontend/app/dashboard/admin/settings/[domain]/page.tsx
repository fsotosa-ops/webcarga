'use client'

import { Suspense, use } from 'react'
import Link from 'next/link'
import { notFound, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { NavDominios } from '../NavDominios'
import { dominioPorClave, type Dominio } from '../dominios'

/** `params` es una PROMESA desde Next 15; en un componente de cliente se
 *  desenvuelve con `use()`. Tipado como objeto plano, `params.dominio` daba
 *  `undefined` y esta pagina llamaba a notFound() para TODOS los dominios: el
 *  interior entero del modulo estaba muerto en produccion. Ni los tests (que
 *  montaban el componente con un objeto a mano), ni `tsc` (el tipo mentia), ni
 *  el build lo vieron. Lo encontro entrar a la pantalla. */
export default function DominioPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain: clave } = use(params)
  const dominio = dominioPorClave(clave)
  // Un dominio reservado no es visitable: no tiene nada que mostrar.
  if (!dominio || dominio.proximamente) notFound()

  // useSearchParams exige un limite de Suspense, igual que en /dashboard/compliance.
  return (
    <Suspense fallback={null}>
      <DominioInterior dominio={dominio} />
    </Suspense>
  )
}

function DominioInterior({ dominio }: { dominio: Dominio }) {
  const searchParams = useSearchParams()
  const router = useRouter()

  // La seccion VIAJE EN LA URL, como la vista de /dashboard/compliance
  // ("La vista viaja en la URL: volver del detalle no pierde donde estabas").
  // Con useState era un estado privado de la pantalla: no se podia enlazar una
  // seccion, compartirla, ni volver a ella con el boton de atras del navegador,
  // y recargar te devolvia siempre a la primera.
  const pedida = searchParams.get('section')
  const actual = dominio.secciones.find(s => s.clave === pedida) ?? dominio.secciones[0]
  const Panel  = actual.Panel

  function irA(clave: string) {
    const base = `/dashboard/admin/settings/${dominio.clave}`
    // La primera seccion es la ruta limpia: la URL no se ensucia con el valor
    // por defecto.
    router.replace(clave === dominio.secciones[0].clave ? base : `${base}?section=${clave}`)
  }

  return (
    <div className="p-4 md:p-6 flex-1 overflow-y-auto">
      {/* La vuelta al inventario. Sin esto la unica salida era el navegador o
          la barra lateral, que lleva a OTRO dominio y no a la portada. */}
      <Link
        href="/dashboard/admin/settings"
        prefetch={false}
        className="inline-flex items-center gap-1 text-[11px] text-accion hover:underline"
      >
        <ChevronLeft size={13} aria-hidden="true" />
        Configuración
      </Link>

      <h1 className="font-mulish font-bold text-xl text-text-primary mt-1">{dominio.titulo}</h1>
      <p className="text-xs text-gray-400 mt-0.5">{dominio.proposito}</p>

      <div className="mt-5 flex gap-6">
        <NavDominios activo={dominio.clave} />

        <div className="flex-1 min-w-0">
          {/* Las pestanas SI corresponden aca: son pocas y del mismo tema.
              Lo que no funcionaba era usarlas como unica estructura del modulo. */}
          <div role="tablist" aria-label={`Secciones de ${dominio.titulo}`}
               className="flex gap-4 border-b border-border overflow-x-auto">
            {dominio.secciones.map(s => (
              <button key={s.clave} role="tab" aria-selected={s.clave === actual.clave}
                      onClick={() => irA(s.clave)}
                      className={`pb-2 text-xs whitespace-nowrap border-b-2 transition-colors ${
                        s.clave === actual.clave
                          ? 'border-accent text-accent font-semibold'
                          : 'border-transparent text-gray-600 hover:text-gray-800'
                      }`}>
                {s.titulo}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">{actual.proposito}</p>
          <div role="tabpanel" className="mt-3"><Panel /></div>
        </div>
      </div>
    </div>
  )
}
