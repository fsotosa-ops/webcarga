'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { requirementsApi } from '@/lib/api/requirements'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { INPUT } from './shared'

type Entidad = 'CARRIER' | 'DRIVER' | 'ASSET'
type Nivel = 'LEGAL_MANDATORY' | 'CONDITIONAL_OPTIONAL'

const ENTIDADES: [Entidad, string, string][] = [
  ['CARRIER', 'Empresa',   'Lo presenta la empresa de transporte'],
  ['DRIVER',  'Conductor', 'Lo presenta cada conductor'],
  ['ASSET',   'Vehículo',  'Lo presenta cada vehículo'],
]

const NIVELES: [Nivel, string, string][] = [
  ['LEGAL_MANDATORY',      'Obligatorio', 'Se le va a exigir a todos los que califiquen.'],
  ['CONDITIONAL_OPTIONAL', 'Opcional',    'No se le pide a nadie por defecto; se carga si aplica.'],
]

/** Alta de un tipo de documento del catálogo.
 *
 *  NACE APAGADO, y eso es lo que hace que un formulario no dispare una
 *  escritura masiva: el trigger de siembra crea un registro por cada entidad
 *  que califique —87 por uno de conductor, hasta 124 por uno de vehículo,
 *  sobre 5.121 existentes—. Apagado no le aplica a nadie, así que se le
 *  terminan de definir las reglas con calma y la siembra ocurre al activarlo,
 *  por el MISMO camino que ya usa cambiar una condición.
 *
 *  El CÓDIGO no se pide: lo deriva el backend del nombre. Es la llave de los
 *  alias de nombre de archivo y del motor de match, y dejarla escribir invita
 *  a que dos documentos la compartan. */
export function NuevoDocumentoPanel({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient()
  const [nombre, setNombre] = useState('')
  const [entidad, setEntidad] = useState<Entidad>('CARRIER')
  const [nivel, setNivel] = useState<Nivel>('LEGAL_MANDATORY')

  const crear = useMutation({
    mutationFn: () => requirementsApi.create({
      name: nombre.trim(), target_entity: entidad, requirement_level: nivel,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
      onCerrar()
    },
  })

  const listo = nombre.trim().length > 0 && !crear.isPending
  const error = crear.isError
    ? (crear.error instanceof Error ? crear.error.message : 'No se pudo crear el documento')
    : null

  return (
    <PanelLateral
      titulo="Nuevo documento"
      onCerrar={onCerrar}
      pie={
        <button
          type="button"
          onClick={() => crear.mutate()}
          disabled={!listo}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs
                     font-semibold text-white hover:bg-accent/90 disabled:opacity-50
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {crear.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Crear
        </button>
      }
    >
      <label className="block">
        <span className="text-xs font-semibold text-text-primary">Cómo se llama</span>
        <input
          type="text"
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          aria-label="Nombre del documento"
          placeholder="Certificado de Antecedentes"
          className={`${INPUT} mt-2 w-full`}
        />
        {/* El código se DERIVA. Mostrarlo antes de crear evita la sorpresa de
            descubrir después con qué llave quedó, que es la que usan los
            alias y el motor de match. */}
        {nombre.trim() && (
          <span className="mt-1 block text-etiqueta text-informativo">
            Código: {nombre.trim().normalize('NFKD').replace(/[̀-ͯ]/g, '')
              .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase().slice(0, 60)}
          </span>
        )}
      </label>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-text-primary">¿Quién lo presenta?</legend>
        {ENTIDADES.map(([valor, etiqueta, ayuda]) => (
          <label key={valor} className="mt-2 flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="radio" name="entidad-del-documento" aria-label={etiqueta}
              checked={entidad === valor} onChange={() => setEntidad(valor)}
              className="mt-0.5 accent-accent"
            />
            <span>{etiqueta}<span className="block text-etiqueta text-informativo">{ayuda}</span></span>
          </label>
        ))}
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-text-primary">¿Es obligatorio?</legend>
        {NIVELES.map(([valor, etiqueta, ayuda]) => (
          <label key={valor} className="mt-2 flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="radio" name="nivel-del-documento" aria-label={etiqueta}
              checked={nivel === valor} onChange={() => setNivel(valor)}
              className="mt-0.5 accent-accent"
            />
            <span>{etiqueta}<span className="block text-etiqueta text-informativo">{ayuda}</span></span>
          </label>
        ))}
      </fieldset>

      {/* Que nace apagado se DICE, no se descubre: si no, alguien crea el
          documento, no lo ve en ninguna empresa y cree que falló. */}
      <p className="mt-4 rounded-lg border border-border bg-accent/5 px-2 py-2 text-etiqueta text-informativo">
        Se va a crear <strong className="text-text-primary">sin vigencia</strong>, así que
        todavía no se le va a pedir a nadie. Termina de definirle las reglas y actívalo
        cuando esté listo — ahí vas a poder ver a cuántos alcanza antes de aplicarlo.
      </p>

      {error && <p className="mt-2 text-etiqueta text-status-incidente">{error}</p>}
    </PanelLateral>
  )
}
