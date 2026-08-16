'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { taxonomiesApi } from '@/lib/api/config'
import { CABECERA, EncabezadoOrdenable } from '@/components/ui/tabla/EncabezadoOrdenable'
import { useOrden } from '@/components/ui/tabla/useOrden'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { CondicionPanel } from './CondicionPanel'
import { celdaSeExigeA } from './frase-de-la-regla'
import { INPUT, LoadState } from './shared'
import type { RequirementOption } from '@/lib/types'

const ENTIDAD: Record<string, { texto: string; clase: string }> = {
  ASSET:   { texto: 'VEHÍCULO',  clase: 'bg-blue-50 text-blue-700' },
  CARRIER: { texto: 'EMPRESA',   clase: 'bg-purple-50 text-purple-700' },
  DRIVER:  { texto: 'CONDUCTOR', clase: 'bg-emerald-50 text-emerald-700' },
}


function tieneCondicion(r: RequirementOption): boolean {
  return Boolean(r.applies_to_fleet_service_type_ids?.length || r.applies_to_management_types?.length)
}

/** El catálogo de documentos exigidos, como lista.
 *
 *  Antes eran 37 formularios abiertos, uno debajo del otro: 5.849 px y 167
 *  casillas, de las cuales 35 requisitos no tenían ninguna marcada. La lista no
 *  dibuja ni una casilla — la regla se ENUNCIA en una frase derivada del dato, y
 *  se edita en el panel. */
export function CondicionesTabla() {
  const req = useQuery({
    queryKey: ['compliance-requirements'],
    queryFn: () => complianceApi.listRequirements(),
  })
  const tax = useQuery({
    queryKey: ['taxonomias', 'FLEET_SERVICE_TYPE'],
    queryFn: () => taxonomiesApi.list('FLEET_SERVICE_TYPE'),
  })
  // Los tipos de gestión salen del MISMO catálogo que los subtipos, no de una
  // lista escrita al lado. Estaban copiados en tres lugares del frontend
  // (acá, el panel y la frase) más la función de Postgres: renombrar uno en
  // Configuración dejaba las cuatro copias diciendo cosas distintas.
  const gestionesTax = useQuery({
    queryKey: ['taxonomias', 'WEBCARGA_OPERATION_TYPE'],
    queryFn: () => taxonomiesApi.list('WEBCARGA_OPERATION_TYPE'),
  })
  const { orden, ordenarPor, comparar } = useOrden({ columna: 'entidad', direccion: 'asc' })
  const [filtro, setFiltro] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // El documento abierto VIAJA EN LA URL, como un viaje del Monitor: editar
  // una regla se puede enlazar y recargar no devuelve a la lista. Cerrar quita
  // el parametro, y el resto de la URL (la seccion) se conserva.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const abierto = searchParams.get('doc')

  const abrir = useCallback((code: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (code) params.set('doc', code)
    else params.delete('doc')
    const qs = params.toString()
    const destino = qs ? `${pathname}?${qs}` : pathname
    // ABRIR el panel es `push` y cerrarlo es `replace`. Asi el boton de atras
    // del navegador CIERRA el panel, que es lo que espera cualquiera frente a
    // algo que se abrio encima; con `replace` en los dos lados, atras sacaba de
    // la pantalla entera.
    //
    // La SECCION sigue usando `replace` (en [domain]/page.tsx) y no es
    // inconsistente: cambiar de seccion es moverse entre vistas hermanas de la
    // misma pantalla, y recorrer seis no deberia costar seis "atras" para salir.
    if (code) router.push(destino)
    else router.replace(destino)
  }, [router, pathname, searchParams])

  // Los subtipos vigentes, en la forma que usan la frase y el panel. Su
  // cantidad es el TOTAL contra el que se enuncia una regla de varios
  // subtipos: "9 de 10", no "sólo 9".
  const subtipos = useMemo(
    () => (tax.data ?? []).map(t => ({ id: t.id, label: t.label })),
    [tax.data],
  )

  const etiquetaSubtipo = useMemo(() => {
    const mapa = new Map((tax.data ?? []).map(s => [s.id, s.label]))
    // Un subtipo desactivado desaparece del catalogo pero su id sigue en la
    // regla: sin este respaldo la frase diria "Solo undefined".
    return (id: string) => mapa.get(id) ?? 'un subtipo dado de baja'
  }, [tax.data])

  // Los tipos de gestión se identifican por su CÓDIGO, no por su nombre
  // visible: es el mismo código que guardan las reglas y `carriers`, y es lo
  // que permite renombrar la etiqueta sin cambiar a quién alcanza nada.
  const gestiones = useMemo(
    () => (gestionesTax.data ?? [])
      .filter(g => g.code)
      .map(g => ({ id: g.code as string, label: g.label })),
    [gestionesTax.data],
  )

  const etiquetaGestion = useMemo(() => {
    const mapa = new Map(gestiones.map(g => [g.id, g.label]))
    return (code: string) => mapa.get(code) ?? 'un tipo de gestión que ya no existe'
  }, [gestiones])

  // Las dos dimensiones de la condición, en una sola forma: la frase no
  // necesita saber cuál de las dos está mirando.
  const vocabulario = useMemo(() => ({
    subtipo: etiquetaSubtipo,
    totalSubtipos: subtipos.length,
    gestion: etiquetaGestion,
    totalGestiones: gestiones.length,
  }), [etiquetaSubtipo, subtipos.length, etiquetaGestion, gestiones.length])

  const todos = useMemo(() => req.data ?? [], [req.data])

  // La búsqueda se aplica ANTES que los chips, y los chips cuentan sobre su
  // resultado. Contando sobre el catálogo entero, el número prometía filas que
  // la búsqueda ya había descartado: con "seguro" escrito, "Con condición 2"
  // llevaba a "Ningún documento coincide". El chip no se desactiva en cero —
  // el activo quedaría atrapado, sin forma de apagarlo.
  const buscados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return todos
    return todos.filter(r => `${r.name} ${r.requirement_code}`.toLowerCase().includes(q))
  }, [todos, busqueda])

  const filtros = useMemo(() => [
    { id: 'con-condicion', etiqueta: 'Con condición', n: buscados.filter(tieneCondicion).length },
    { id: 'sin-vigencia',  etiqueta: 'Sin vigencia',  n: buscados.filter(r => !r.is_active).length },
  ], [buscados])

  const filas = useMemo(() => {
    let f = buscados
    if (filtro === 'con-condicion') f = f.filter(tieneCondicion)
    if (filtro === 'sin-vigencia') f = f.filter(r => !r.is_active)
    return comparar(f, r => (orden?.columna === 'documento' ? r.name : r.target_entity))
    // `comparar` se recrea en cada render y no aporta identidad estable; el
    // orden que importa ya viaja en `orden`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscados, filtro, orden])

  // El panel se dibuja desde el dato del catalogo, no desde la fila clicada:
  // asi recargar con `?doc=` en la URL lo abre igual, sin haber pasado por la
  // lista. Un codigo que no existe simplemente no abre nada.
  const requisitoAbierto = todos.find(r => r.requirement_code === abierto)

  // LAS DOS CONSULTAS, no sólo el catálogo. Los subtipos son la mitad de la
  // frase: si sólo fallan ellos y la tabla se dibuja igual, `etiquetaSubtipo`
  // cae al respaldo para todos los ids y la fila dice "Sólo un subtipo dado de
  // baja" de un subtipo que existe perfectamente — sin error visible y sin
  // forma de reintentar. La pantalla vieja miraba `errorReq ?? errorSub`.
  const errorDeCarga = req.isError
    ? 'No se pudo cargar el catálogo de documentos'
    : tax.isError
    ? 'No se pudieron cargar los subtipos de vehículo'
    : gestionesTax.isError
    ? 'No se pudieron cargar los tipos de gestión'
    : null
  const cargando = !errorDeCarga
    && (req.isPending || tax.isPending || gestionesTax.isPending)

  if (cargando || errorDeCarga) {
    return (
      <div className="p-1">
        <LoadState
          loading={cargando}
          error={errorDeCarga}
          onRetry={() => { req.refetch(); tax.refetch(); gestionesTax.refetch() }}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Documento o código…"
          aria-label="Buscar documento"
          className={`${INPUT} w-56`}
        />
        <ChipsDeFiltro opciones={filtros} activo={filtro} onElegir={setFiltro} />
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50/60 border-y border-border">
            <EncabezadoOrdenable columna="entidad" orden={orden} onOrdenar={ordenarPor}>Entidad</EncabezadoOrdenable>
            <EncabezadoOrdenable columna="documento" orden={orden} onOrdenar={ordenarPor}>Documento</EncabezadoOrdenable>
            <th scope="col" className={CABECERA}>Se exige a</th>
            <th scope="col" className={CABECERA}>Vigencia</th>
            <th scope="col" className="w-9" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {filas.map(r => {
            const e = ENTIDAD[r.target_entity]
            // El total sale del catálogo de subtipos, no de un número escrito
            // a mano: si mañana se da de alta un subtipo, la frase se corrige
            // sola.
            const celda = celdaSeExigeA(r, vocabulario)
            return (
              <tr key={r.id} className="border-b border-border/70 hover:bg-gray-50/60">
                <td className="px-3 py-2.5">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${e?.clase ?? 'bg-gray-100 text-gray-600'}`}>
                    {e?.texto ?? r.target_entity}
                  </span>
                </td>
                <td className="px-3 py-2.5 max-w-[22rem]">
                  <div className="text-xs font-semibold text-text-primary truncate">{r.name}</div>
                  <div className="text-[11px] text-gray-400 truncate">{r.requirement_code}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className={`text-xs ${r.is_active ? 'text-gray-700' : 'text-gray-400'}`}>{celda.regla}</div>
                  <div className="text-[11px] text-gray-400 tabular-nums">{celda.alcance}</div>
                </td>
                <td className={`px-3 py-2.5 text-xs ${r.is_active ? 'text-resuelto' : 'text-gray-400'}`}>
                  {r.is_active ? 'Vigente' : 'Sin vigencia'}
                </td>
                <td className="pr-2">
                  <button
                    type="button"
                    onClick={() => abrir(r.requirement_code)}
                    aria-label={`Editar ${r.name}`}
                    className="text-gray-300 hover:text-gray-500 focus-visible:outline-none
                               focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            )
          })}
          {!filas.length && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-400">
                Ningún documento coincide con el filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {requisitoAbierto && (
        <CondicionPanel
          key={requisitoAbierto.id}
          requisito={requisitoAbierto}
          subtipos={subtipos}
          gestiones={gestiones}
          onCerrar={() => abrir(null)}
        />
      )}
    </div>
  )
}
