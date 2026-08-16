'use client'

import { use, useState } from 'react'
import { notFound } from 'next/navigation'
import { NavDominios } from '../NavDominios'
import { dominioPorClave } from '../dominios'

/** `params` es una PROMESA desde Next 15; en un componente de cliente se
 *  desenvuelve con `use()`. Tipado como objeto plano, `params.dominio` daba
 *  `undefined` y esta pagina llamaba a notFound() para TODOS los dominios: el
 *  interior entero del modulo estaba muerto en produccion. Ni los tests (que
 *  montaban el componente con un objeto a mano), ni `tsc` (el tipo mentia), ni
 *  el build lo vieron. Lo encontro entrar a la pantalla. */
export default function DominioPage({ params }: { params: Promise<{ dominio: string }> }) {
  const { dominio: clave } = use(params)
  const dominio = dominioPorClave(clave)
  // Un dominio reservado no es visitable: no tiene nada que mostrar.
  if (!dominio || dominio.proximamente) notFound()

  const [seccion, setSeccion] = useState(dominio.secciones[0].clave)
  const actual = dominio.secciones.find(s => s.clave === seccion) ?? dominio.secciones[0]
  const Panel = actual.Panel

  return (
    <div className="p-4 md:p-6 flex-1 overflow-y-auto">
      <h1 className="font-mulish font-bold text-xl text-text-primary">{dominio.titulo}</h1>
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
                      onClick={() => setSeccion(s.clave)}
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
