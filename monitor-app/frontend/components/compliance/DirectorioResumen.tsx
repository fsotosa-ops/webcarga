'use client'

import { useQuery } from '@tanstack/react-query'
import { carriersApi } from '@/lib/api/carriers'
import { Cifra } from '@/components/ui/Cifra'
import { TEXTO_APOYO } from '@/lib/ui/texto'

/** El directorio que existía en el módulo de Empresas y se perdió al mover la
 *  carga documental a Certificación.
 *
 *  Pablo, reunión del 21/08: *"me falta ese directorio que tenía yo antes,
 *  porque en ese directorio me aparecían, no sé, trescientas empresas, y de las
 *  trescientas eran cincuenta están activas, doscientas cincuenta inactivas"*,
 *  y enseguida pidió, abajo de eso, el conteo de tractos, equipos y
 *  conductores.
 *
 *  Va arriba del embudo y no adentro: el embudo contesta *qué hay que hacer*,
 *  esto contesta *con qué contamos*. Son dos preguntas y mezclarlas convertiría
 *  la portada en una sola lista de números sin jerarquía.
 *
 *  La flota es la que OPERA: sólo empresas activas y asignaciones vigentes. El
 *  catálogo entero incluiría vehículos de empresas dadas de baja hace un año.
 */
export function DirectorioResumen() {
  const { data, isPending, error } = useQuery({
    queryKey: ['carriers-directorio'],
    queryFn:  () => carriersApi.directorio(),
  })

  // Si el dato no está, se omite esa mitad. Inventar el número es peor que no
  // tenerlo, y un error acá no puede tapar el embudo, que es el trabajo real.
  if (error) return null

  return (
    <div className="border border-border rounded-xl bg-white px-4 py-3 flex items-baseline gap-x-5 gap-y-2 flex-wrap">
      <Cifra valor={data?.empresas.total} etiqueta="empresas" cargando={isPending} />
      {data && (
        <span className={`text-etiqueta ${TEXTO_APOYO}`}>
          {data.empresas.activas} activas · {data.empresas.inactivas} inactivas
          {data.empresas.onboarding > 0 && <> · {data.empresas.onboarding} en onboarding</>}
        </span>
      )}
      {data && (
        <span className="ml-auto flex items-baseline gap-x-4 gap-y-1 flex-wrap">
          <Cifra valor={data.flota.tractos} etiqueta="tractos" />
          <Cifra valor={data.flota.ramplas} etiqueta="ramplas" />
          <Cifra valor={data.flota.conductores} etiqueta="conductores" />
        </span>
      )}
    </div>
  )
}
