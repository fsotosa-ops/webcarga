'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { busquedaConfigApi } from '@/lib/api/config'
import { DOMINIOS, PARAM_DE_SECCION } from './dominios'
import { INPUT } from './shared'

/** Dónde vive un resultado, en el idioma de la pantalla. Sale del registro de
 *  dominios: si mañana entra Facturación, sus resultados se rotulan solos. */
function ubicacion(dominio: string, seccion: string): string {
  const d = DOMINIOS.find(x => x.clave === dominio)
  const s = d?.secciones.find(x => x.clave === seccion)
  return d && s ? `${d.titulo} · ${s.titulo}` : `${dominio} · ${seccion}`
}

function enlace(dominio: string, seccion: string, abre: string): string {
  const base = `/dashboard/admin/settings/${dominio}?section=${seccion}`
  // Dos secciones abren el elemento directo porque su panel viaja en la URL;
  // el resto lleva a la sección, que es lo más cerca que se puede llegar sin
  // inventarle un panel a una tabla que no lo tiene.
  //
  // Se usa `abre` y NO el id: Condiciones abre por CÓDIGO. Enlazar con el uuid
  // dejaba un enlace que llevaba a la lista correcta y no abría nada — el
  // click-through lo encontró.
  const param = PARAM_DE_SECCION[seccion]
  return param ? `${base}&${param}=${encodeURIComponent(abre)}` : base
}

/** El buscador del módulo, presente en las dos pantallas.
 *
 *  Busca sobre el CONTENIDO, no sobre los títulos de sección: escribir "frío"
 *  encuentra la condición de Certificación y el rango de temperatura de
 *  Operaciones. Es lo que hace que el módulo escale a 20 o 200 ajustes — con
 *  siete pestañas alcanzaba con mirar; con cinco dominios y once secciones, no.
 *
 *  El backend exige dos caracteres: con uno el resultado son casi todos los
 *  ajustes de la app, o sea lo mismo que no buscar. */
export function BuscadorConfig() {
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')

  // Se espera a que la escritura pare. Sin esto, "temperatura" son once
  // consultas de las que sólo la última importa.
  useEffect(() => {
    const t = setTimeout(() => setConsulta(texto.trim()), 250)
    return () => clearTimeout(t)
  }, [texto])

  const busca = consulta.length >= 2
  const q = useQuery({
    queryKey: ['config-busqueda', consulta],
    queryFn: () => busquedaConfigApi.buscar(consulta),
    enabled: busca,
  })

  return (
    <div className="relative max-w-md">
      <Search
        size={13}
        aria-hidden="true"
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
      />
      <input
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder="Buscar un ajuste…"
        aria-label="Buscar un ajuste"
        className={`${INPUT} w-full pl-7`}
      />

      {busca && (
        <div
          role="listbox"
          aria-label="Resultados"
          className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-white shadow-lg
                     max-h-80 overflow-y-auto"
        >
          {q.isPending && <p className="px-3 py-2 text-[11px] text-gray-400">Buscando…</p>}
          {q.isError && (
            <p className="px-3 py-2 text-[11px] text-gray-500">No se pudo buscar. Intenta de nuevo.</p>
          )}
          {q.data?.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-gray-400">
              {`Ningún ajuste coincide con "${consulta}".`}
            </p>
          )}
          {q.data?.map(r => (
            <Link
              key={`${r.domain}/${r.section}/${r.id}`}
              href={enlace(r.domain, r.section, r.abre)}
              prefetch={false}
              role="option"
              aria-selected={false}
              onClick={() => setTexto('')}
              className="block px-3 py-2 hover:bg-gray-50 focus-visible:outline-none
                         focus-visible:bg-accent/5"
            >
              <span className="block text-xs font-semibold text-text-primary truncate">{r.label}</span>
              <span className="block text-[10.5px] text-gray-400 truncate">
                {ubicacion(r.domain, r.section)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
