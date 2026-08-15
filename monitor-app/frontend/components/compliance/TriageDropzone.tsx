'use client'

import { useState } from 'react'
import { Loader2, UploadCloud } from 'lucide-react'

interface Props {
  /** Sin nombre = la bandeja global. Con nombre = la de esa empresa. */
  carrierName?: string
  /** No hay archivos esperando. La zona pasa a ocupar la pantalla. */
  vacia:      boolean
  subiendo:   boolean
  /** Cuántos archivos tiene la tanda en vuelo. No hay avance parcial: es un
   *  solo request con N archivos y el navegador no informa cuántos van. */
  enVuelo?:   number
  errores:    { file_name: string; error: string }[]
  onArchivos: (files: FileList | File[]) => void
}

/** La puerta de carga, con sus cuatro estados.
 *
 *  Vacía la zona ES la pantalla: la bandeja global es el lugar donde se
 *  vuelcan los 2.000 documentos, así que esconder la carga tras un botón
 *  chico es esconder el trabajo principal. Con archivos ya cargados se
 *  encoge a una barra y le deja el espacio a la lista — pero no desaparece.
 */
export function TriageDropzone({
  carrierName, vacia, subiendo, enVuelo, errores, onArchivos,
}: Props) {
  const [encima, setEncima] = useState(false)

  const deQuien = carrierName ? `los documentos de ${carrierName}` : 'los documentos'

  if (subiendo) {
    const cuantos = enVuelo ?? 0
    return (
      <div className="border border-border rounded-xl bg-white p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Loader2 size={14} className="motion-safe:animate-spin text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            Subiendo {cuantos.toLocaleString('es-CL')}{' '}
            {cuantos === 1 ? 'archivo' : 'archivos'}
          </span>
        </div>
        {/* Barra indeterminada: es un solo request con N archivos y el
            navegador no informa cuantos van. Una barra que se llena seria un
            dato inventado. */}
        <div
          role="progressbar"
          aria-label="Subiendo archivos"
          className="h-1.5 rounded-full bg-gray-200 overflow-hidden"
        >
          <span className="block h-full w-1/3 bg-accent rounded-full motion-safe:animate-pulse" />
        </div>
        <p className="mt-2.5 text-[11px] text-gray-500 leading-relaxed">
          Puedes cerrar esta pestaña. El proceso sigue y al volver vas a encontrar
          los archivos en la bandeja.
        </p>
      </div>
    )
  }

  const zona = (
    <label
      data-testid="triage-dropzone"
      onDragOver={e => { e.preventDefault(); setEncima(true) }}
      onDragLeave={() => setEncima(false)}
      onDrop={e => { e.preventDefault(); setEncima(false); onArchivos(e.dataTransfer.files) }}
      className={`block border-[1.5px] border-dashed rounded-xl bg-white cursor-pointer transition-colors ${
        encima ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
      } ${vacia ? 'px-5 py-10 text-center' : 'px-4 py-2.5 flex items-center gap-2.5'}`}
    >
      <UploadCloud size={vacia ? 26 : 14} className={vacia ? 'text-gray-400 mx-auto' : 'text-gray-400'} />
      {vacia ? (
        <>
          <p className="mt-2.5 text-sm font-semibold text-text-primary">
            Arrastra aquí {deQuien}
          </p>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
            Puedes soltar carpetas enteras. Se agrupan por empresa o por tipo y tú
            confirmas: nada queda certificado hasta que lo confirmes.
          </p>
          <p className="mt-3 text-[11px] text-accent font-semibold">
            o elige archivos desde tu computador
          </p>
        </>
      ) : (
        <span className="text-[11px] text-gray-500">
          Suelta archivos en cualquier parte de esta pantalla para agregarlos a la bandeja
        </span>
      )}
      <input
        type="file" multiple className="hidden"
        aria-label={`Arrastra aquí ${deQuien}`}
        onChange={e => onArchivos(e.target.files ?? [])}
      />
    </label>
  )

  if (!errores.length) return zona

  return (
    <div className="space-y-1.5">
      {zona}
      <ul className="space-y-0.5">
        {errores.map(e => (
          <li key={e.file_name} className="text-[11px] text-red-600">
            {e.file_name}: {e.error}
          </li>
        ))}
      </ul>
    </div>
  )
}
