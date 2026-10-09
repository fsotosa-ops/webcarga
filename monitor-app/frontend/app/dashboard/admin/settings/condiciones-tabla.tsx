'use client'

import { useCallback, useMemo, useState } from 'react'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import { complianceApi } from '@/lib/api/compliance'
import { taxonomiesApi } from '@/lib/api/config'
import { CABECERA, EncabezadoOrdenable } from '@/components/ui/tabla/EncabezadoOrdenable'
import { useOrden } from '@/components/ui/tabla/useOrden'
import { ChipsDeFiltro } from '@/components/ui/ChipsDeFiltro'
import { CondicionPanel } from './CondicionPanel'
import { NuevoDocumentoPanel } from './NuevoDocumentoPanel'
import { CeldaAlias, CeldaNombre } from './celdas-editables'
import {
  CAMBIADA, CeldaAviso, CeldaExigible, CeldaNivel, CeldaRenovacion, CeldaVigente,
} from './celdas-del-borrador'
import { BarraDelBorrador } from './BarraDelBorrador'
import { camposCambiados, editar, valorDe, type Borrador, type Edicion } from './borrador'
import { MarcaDeRevision, SIN_REVISAR, useChipDeRevision, useRevisiones } from './revision'
import { celdaSeExigeA } from './frase-de-la-regla'
import { INPUT, LoadState } from './shared'
import type { RequirementOption } from '@/lib/types'

const ENTIDAD: Record<string, { texto: string; clase: string }> = {
  ASSET:   { texto: 'VEHÍCULO',  clase: 'bg-blue-50 text-blue-700' },
  CARRIER: { texto: 'EMPRESA',   clase: 'bg-purple-50 text-purple-700' },
  DRIVER:  { texto: 'CONDUCTOR', clase: 'bg-emerald-50 text-emerald-700' },
}


function esMensual(r: RequirementOption): boolean {
  return r.expiration_policy === 'CALENDAR_PERIOD'
}

function tieneCondicion(r: RequirementOption): boolean {
  return Boolean(r.applies_to_fleet_service_type_ids?.length || r.applies_to_management_types?.length)
}

/** El catálogo de documentos exigidos, como tabla que se edita en el lugar.
 *
 *  Antes eran 37 formularios abiertos, uno debajo del otro: 5.849 px y 167
 *  casillas. Después, una lista que solo enunciaba la regla y la editaba en un
 *  panel: con los 96 tipos de la planilla de WebCarga eran demasiados clics
 *  (HU-C1, entrega 2c). Ahora cada celda es un control, varias filas se editan
 *  juntas, y lo que cambia el estado de alguien se publica en lote después de
 *  ver su efecto (BarraDelBorrador). La condición por subtipo, que es un
 *  multiselector, sigue en el panel. */
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
  // El filtro llega puesto cuando se entra desde la portada por "N sin
  // revisar": el número es el camino corto a resolverlo, no un adorno.
  const [filtro, setFiltro] = useChipDeRevision()
  const [busqueda, setBusqueda] = useState('')
  const revisiones = useRevisiones('certification', 'conditions')

  // El documento abierto VIAJA EN LA URL, como un viaje del Monitor: editar
  // una regla se puede enlazar y recargar no devuelve a la lista. Cerrar quita
  // el parametro, y el resto de la URL (la seccion) se conserva.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const abierto = searchParams.get('doc')
  const canAdmin = useCanAdmin()
  const [creando, setCreando] = useState(false)
  const [borrador, setBorrador] = useState<Borrador>({})
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const cambiar = useCallback((r: RequirementOption, e: Edicion) =>
    setBorrador(b => editar(b, r, e)), [])
  const alternar = useCallback((id: string) => setSeleccion(prev => {
    const s = new Set(prev)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    return s
  }), [])

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
    { id: SIN_REVISAR,     etiqueta: 'Sin revisar',   n: buscados.filter(r => revisiones.sinRevisar(r.id)).length },
    { id: 'con-condicion', etiqueta: 'Con condición', n: buscados.filter(tieneCondicion).length },
    { id: 'sin-vigencia',  etiqueta: 'Sin vigencia',  n: buscados.filter(r => !r.is_active).length },
    { id: 'mensuales',     etiqueta: 'Mensuales',     n: buscados.filter(esMensual).length },
    { id: 'con-cambios',   etiqueta: 'Con cambios',   n: buscados.filter(r => borrador[r.id]).length },
    // `revisiones.sinRevisar` se recrea en cada render; lo que cambia el
    // resultado son los datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [buscados, revisiones.datos, borrador])

  const filas = useMemo(() => {
    let f = buscados
    if (filtro === SIN_REVISAR) f = f.filter(r => revisiones.sinRevisar(r.id))
    if (filtro === 'con-condicion') f = f.filter(tieneCondicion)
    if (filtro === 'sin-vigencia') f = f.filter(r => !r.is_active)
    if (filtro === 'mensuales') f = f.filter(esMensual)
    if (filtro === 'con-cambios') f = f.filter(r => borrador[r.id])
    return comparar(f, r => (orden?.columna === 'documento' ? r.name : r.target_entity))
    // `comparar` y `revisiones.sinRevisar` se recrean en cada render y no
    // aportan identidad estable; lo que cambia el resultado ya está acá.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscados, filtro, orden, revisiones.datos, borrador])

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

        {/* Crear un documento es administrar el catálogo: la misma altura de
            permiso que cambiarle las reglas a uno que ya existe. */}
        {canAdmin && (
          <button
            type="button"
            onClick={() => setCreando(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border
                       bg-white px-3 py-1.5 text-xs font-semibold text-text-primary
                       hover:bg-bg-main focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-accent/40"
          >
            <Plus size={13} aria-hidden="true" />
            Nuevo documento
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
      {/* 56rem cabe en el contenedor de Configuración a 1.440 px (943 px útiles)
          y en teléfono se desplaza en vez de aplastarse. */}
      <table className="w-full min-w-[56rem] border-collapse">
        <thead>
          <tr className="bg-bg-main/60 border-y border-border">
            {canAdmin && (
              <th scope="col" className="w-8 pl-3">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todos los visibles"
                  checked={filas.length > 0 && filas.every(r => seleccion.has(r.id))}
                  onChange={e => setSeleccion(e.target.checked ? new Set(filas.map(r => r.id)) : new Set())}
                  className="accent-accent"
                />
              </th>
            )}
            <EncabezadoOrdenable columna="entidad" orden={orden} onOrdenar={ordenarPor}>Entidad</EncabezadoOrdenable>
            <EncabezadoOrdenable columna="documento" orden={orden} onOrdenar={ordenarPor}>Documento</EncabezadoOrdenable>
            <th scope="col" className={CABECERA}>Se exige a</th>
            <th scope="col" className={CABECERA}>Se renueva</th>
            <th scope="col" className={CABECERA} title="Días antes del vencimiento. Vacío: el aviso general">Aviso</th>
            <th scope="col" className={CABECERA}>Cuándo se exige</th>
            <th scope="col" className={CABECERA}>Vigente</th>
            {/* Cómo lo encuentra el clasificador en el nombre del archivo.
                Pedido de Fabián (21/08): que el nombre del archivo coincida con
                el del documento para que el match funcione. Sin esta columna,
                que un documento sea invisible para el motor no se veía en
                ningún lado. */}
            <th scope="col" className={CABECERA}>Se reconoce como</th>
            <th scope="col" className="w-9" aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {filas.map(r => {
            const e = ENTIDAD[r.target_entity]
            const valor = valorDe(r, borrador)
            const cambiados = camposCambiados(borrador, r.id)
            const marca = (campo: keyof Edicion) => (cambiados.has(campo) ? CAMBIADA : '')
            // La frase se dice con el borrador puesto: activar en la celda
            // tiene que verse en "Se exige a" antes de publicar. El total sale
            // del catálogo de subtipos, no de un número escrito a mano.
            const celda = celdaSeExigeA({ ...r, is_active: valor.is_active }, vocabulario)
            return (
              <tr
                key={r.id}
                className={`border-b border-border/70 ${seleccion.has(r.id) ? 'bg-accent/5' : 'hover:bg-bg-main/60'}`}
              >
                {canAdmin && (
                  <td className="pl-3">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${r.name}`}
                      checked={seleccion.has(r.id)}
                      onChange={() => alternar(r.id)}
                      className="accent-accent"
                    />
                  </td>
                )}
                <td className="px-1.5 py-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${e?.clase ?? 'bg-bg-main text-informativo'}`}>
                    {e?.texto ?? r.target_entity}
                  </span>
                </td>
                <td className="px-1.5 py-2 max-w-[20rem]">
                  <CeldaNombre requisito={r} puedeEditar={canAdmin} />
                  <div className={`mt-1 flex flex-wrap items-center gap-2 rounded ${marca('requirement_level')}`}>
                    <CeldaNivel
                      requisito={r} valor={valor.requirement_level} puedeEditar={canAdmin}
                      onCambiar={v => cambiar(r, { requirement_level: v })}
                    />
                    {/* La marca se MUESTRA en la fila y el gesto de confirmar
                        vive en el panel. */}
                    <MarcaDeRevision revision={revisiones.revisionDe(r.id)} />
                  </div>
                </td>
                <td className="px-1.5 py-2">
                  <div className={`text-xs ${valor.is_active ? 'text-text-primary' : 'text-informativo'}`}>{celda.regla}</div>
                  <div className="text-etiqueta text-informativo tabular-nums">{celda.alcance}</div>
                </td>
                <td className={`px-1.5 py-2 ${marca('vigencia')}`}>
                  <CeldaRenovacion
                    requisito={r} vigencia={valor.vigencia} puedeEditar={canAdmin}
                    onCambiar={v => cambiar(r, { vigencia: v })}
                  />
                </td>
                <td className={`px-1.5 py-2 ${marca('vigencia')}`}>
                  <CeldaAviso
                    requisito={r} vigencia={valor.vigencia} puedeEditar={canAdmin}
                    onCambiar={v => cambiar(r, { vigencia: v })}
                  />
                </td>
                <td className={`px-1.5 py-2 ${marca('exigible_on')}`}>
                  <CeldaExigible
                    requisito={r} valor={valor.exigible_on} puedeEditar={canAdmin}
                    onCambiar={v => cambiar(r, { exigible_on: v })}
                  />
                </td>
                <td className={`px-1.5 py-2 ${marca('is_active')}`}>
                  <CeldaVigente
                    requisito={r} valor={valor.is_active} puedeEditar={canAdmin}
                    onCambiar={v => cambiar(r, { is_active: v })}
                  />
                </td>
                <td className="px-1.5 py-2">
                  <CeldaAlias requisito={r} puedeEditar={canAdmin} maximo={1} />
                </td>
                <td className="pr-2">
                  <button
                    type="button"
                    onClick={() => abrir(r.requirement_code)}
                    aria-label={`Editar ${r.name}`}
                    title="Condición por subtipo, ventanas por cliente e historial"
                    className="rounded text-informativo hover:text-text-primary focus-visible:outline-none
                               focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            )
          })}
          {!filas.length && (
            <tr>
              <td colSpan={10} className="px-3 py-6 text-center text-xs text-informativo">
                Ningún documento coincide con el filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {canAdmin && (
        <BarraDelBorrador
          borrador={borrador}
          onBorrador={setBorrador}
          seleccion={todos.filter(r => seleccion.has(r.id))}
          onLimpiarSeleccion={() => setSeleccion(new Set())}
          onPublicado={revisiones.invalidar}
        />
      )}

      {requisitoAbierto && (
        <CondicionPanel
          key={requisitoAbierto.id}
          requisito={requisitoAbierto}
          subtipos={subtipos}
          gestiones={gestiones}
          revision={revisiones.revisionDe(requisitoAbierto.id)}
          onConfirmar={() => revisiones.confirmar.mutate(requisitoAbierto.id)}
          confirmando={revisiones.confirmar.isPending}
          onGuardado={revisiones.invalidar}
          onCerrar={() => abrir(null)}
        />
      )}

      {creando && <NuevoDocumentoPanel onCerrar={() => setCreando(false)} />}
    </div>
  )
}
