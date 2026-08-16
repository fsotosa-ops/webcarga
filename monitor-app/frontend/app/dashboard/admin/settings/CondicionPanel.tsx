'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { requirementsApi } from '@/lib/api/requirements'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import type { ManagementType, RequirementOption } from '@/lib/types'
import type { Revision } from '@/lib/api/config'
import { BotonConfirmar, MarcaDeRevision } from './revision'

const UNIVERSO: Record<string, string> = {
  ASSET:   'A todos los vehículos',
  CARRIER: 'A todas las empresas',
  DRIVER:  'A todos los conductores',
}

const ALGUNOS: Record<string, string> = {
  ASSET:   'Sólo a algunos subtipos de vehículo',
  CARRIER: 'Sólo a algunos tipos de gestión',
}

/** Qué es lo que quedó marcado y ya no se ve. Decía "subtipo dado de baja"
 *  también en una regla de empresa, donde lo oculto sería un tipo de gestión:
 *  el aviso nombraba mal justo la cosa que nadie puede ver. */
const OCULTO: Record<string, string> = {
  ASSET:   'un subtipo dado de baja',
  CARRIER: 'un tipo de gestión que ya no existe',
}

/** Separador de la clave de contenido de la condición: el separador de unidad
 *  de ASCII, que ningún id de subtipo ni de tipo de gestión contiene. */
const SEPARADOR = '\u001f'

/** Comparación por conjunto: el orden en que se eligieron las opciones no es
 *  significativo, así que comparar por índice daría falsos "sucio". */
function mismoConjunto(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every(x => setB.has(x))
}

/** El editor de una condición: a quién se le exige un documento.
 *
 *  PRIMERO LA PREGUNTA. El selector de opciones aparece sólo si la respuesta
 *  es "a algunos", y ése es el cambio que elimina las 167 casillas de la
 *  pantalla anterior: 35 de los 37 requisitos se contestan sin ver una sola.
 *
 *  Guardar la regla y aplicarla siguen siendo dos actos distintos, como en el
 *  Tramo 3: cambiar una condición puede crear o dejar de exigir cientos de
 *  registros, y nadie debería descubrirlo después. */
export function CondicionPanel({
  requisito, subtipos, gestiones, revision, onConfirmar, confirmando, onGuardado, onCerrar,
}: {
  requisito: RequirementOption
  subtipos:  { id: string; label: string }[]
  /** Los tipos de gestión del catálogo, identificados por su CÓDIGO estable.
   *  Estaban escritos acá adentro: renombrar "Equipo Completo" en
   *  Configuración dejaba esta casilla con el nombre viejo, justo en la
   *  pantalla desde la que se renombra. */
  gestiones: { id: string; label: string }[]
  /** Quién revisó esta regla, `null` si nadie, `undefined` mientras carga. */
  revision:    Revision | null | undefined
  onConfirmar: () => void
  confirmando: boolean
  /** Guardar cuenta como revisar, y lo registra el servidor: esto es lo que
   *  hace que la pantalla se entere sin recargar. */
  onGuardado:  () => void
  onCerrar:    () => void
}) {
  const canEdit = useCanAdmin()
  const qc = useQueryClient()

  const esAsset   = requisito.target_entity === 'ASSET'
  const esCarrier = requisito.target_entity === 'CARRIER'
  const opciones  = esAsset ? subtipos : esCarrier ? gestiones : []

  // La condición guardada se memoiza por su CONTENIDO, no por la identidad del
  // arreglo que la trae. El catálogo llega de react-query: con
  // refetchOnWindowFocus, un refetch que devuelve exactamente lo mismo trae un
  // arreglo NUEVO, y si `guardadas` cambiara de identidad por eso, el efecto de
  // resincronización de abajo borraría el borrador de quien está editando.
  // Es la clase de bug de borrador que este proyecto ya tuvo tres veces
  // (ContactCard, TransporterDocumentsPanel), invertida: acá el borrador se
  // resincronizaba de más. La clave usa el separador de unidad (U+001F)
  // porque ningún id lo contiene.
  const claveGuardada = (
    esAsset
      ? requisito.applies_to_fleet_service_type_ids ?? []
      : esCarrier
      ? requisito.applies_to_management_types ?? []
      : []
  ).join(SEPARADOR)

  const guardadas = useMemo<string[]>(
    () => (claveGuardada ? claveGuardada.split(SEPARADOR) : []),
    [claveGuardada],
  )

  // El estado es la RESPUESTA a la pregunta, no las diez casillas.
  const [alcance, setAlcance] = useState<'todos' | 'algunos'>(guardadas.length ? 'algunos' : 'todos')
  const [elegidos, setElegidos] = useState<string[]>(guardadas)
  const [marcadoActivo, setMarcadoActivo] = useState(requisito.is_active)
  const [verPreview, setVerPreview] = useState(false)

  // Si el prop cambia —porque el guardado propagó la fila nueva o porque la
  // lista se recargó— el borrador tiene que resincronizarse. Sin esto la
  // pantalla sigue mostrando lo viejo con datos frescos abajo: la misma clase
  // de bug que ya apareció en ContactCard y TransporterDocumentsPanel.
  useEffect(() => {
    setAlcance(guardadas.length ? 'algunos' : 'todos')
    setElegidos(guardadas)
    setMarcadoActivo(requisito.is_active)
    // La vista previa NO se cierra acá. Este efecto corre también después de
    // guardar —el guardado propaga la fila nueva—, y cerrarla ahí obligaba a
    // volver a apretar "Ver qué cambia" justo cuando el número recién pasaba
    // a ser interesante. `guardar` invalida ['recalc-preview', id], así que si
    // está abierta se recalcula sola. Cambiar de documento no necesita
    // limpieza: la lista monta el panel con `key={id}`, o sea uno nuevo.
  }, [requisito.id, requisito.is_active, guardadas])

  const elegidosEfectivos = alcance === 'todos' ? [] : elegidos
  const condicionSucia = (esAsset || esCarrier) && !mismoConjunto(elegidosEfectivos, guardadas)
  const activoSucio = marcadoActivo !== requisito.is_active
  const sucio = condicionSucia || activoSucio

  // GET /config/taxonomies filtra active=true: un subtipo dado de baja que
  // siga en la condición no tiene casilla. El id sigue viajando en `elegidos`
  // —guardar no lo borra en silencio— pero sin este aviso nadie lo vería.
  const ocultos = elegidosEfectivos.filter(id => !opciones.some(o => o.id === id)).length

  const guardar = useMutation({
    mutationFn: () => {
      const body: Partial<Pick<RequirementOption,
        'is_active' | 'applies_to_fleet_service_type_ids' | 'applies_to_management_types'>> = {}
      if (esAsset) body.applies_to_fleet_service_type_ids = elegidosEfectivos
      if (esCarrier) body.applies_to_management_types = elegidosEfectivos as ManagementType[]
      // `is_active` sólo viaja si de verdad cambió: nunca manda `null` (el
      // backend lo rechaza con 422) y evita un UPDATE sin efecto.
      if (activoSucio) body.is_active = marcadoActivo
      return requirementsApi.patchConditions(requisito.id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
      qc.invalidateQueries({ queryKey: ['recalc-preview', requisito.id] })
      onGuardado()
    },
  })

  const preview = useQuery({
    queryKey: ['recalc-preview', requisito.id],
    queryFn: () => requirementsApi.recalcPreview(requisito.id),
    enabled: verPreview,
  })

  const aplicar = useMutation({
    mutationFn: () => requirementsApi.recalc(requisito.id),
    onSuccess: () => {
      setVerPreview(false)
      qc.invalidateQueries({ queryKey: ['recalc-preview', requisito.id] })
      qc.invalidateQueries({ queryKey: ['compliance-requirements'] })
      qc.invalidateQueries({ queryKey: ['certification-status'] })
      qc.invalidateQueries({ queryKey: ['compliance-pending-drawer'] })
    },
  })

  // El recálculo dejó de borrar: los registros que ya no corresponden se
  // marcan como no vigentes y conservan su documento.
  function confirmarAplicar() {
    const crear = preview.data?.crear ?? 0
    const quitar = preview.data?.quitar ?? 0
    const ok = window.confirm(
      `¿Aplicar esta regla? Se van a agregar ${crear} registros de cumplimiento `
      + `y ${quitar} dejan de exigirse. No se borra nada: los que dejan de exigirse `
      + 'conservan su documento y se vuelven a exigir si la regla cambia.',
    )
    if (!ok) return
    aplicar.mutate()
  }

  // La regla ya está aplicada: no hay registros que agregar ni que apagar.
  const sinCambios = !!preview.data && preview.data.crear === 0 && preview.data.quitar === 0

  const errorGuardar = guardar.isError
    ? (guardar.error instanceof Error ? guardar.error.message : 'Error al guardar la regla')
    : null
  const errorAplicar = aplicar.isError
    ? (aplicar.error instanceof Error ? aplicar.error.message : 'Error al aplicar la regla')
    : null

  return (
    <PanelLateral
      titulo={requisito.name}
      onCerrar={onCerrar}
      pie={canEdit ? (
        <div className="flex items-center gap-2 flex-wrap">
          {sucio && (
            <button
              type="button"
              onClick={() => guardar.mutate()}
              disabled={guardar.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs
                         font-semibold text-white hover:bg-accent/90 disabled:opacity-50
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {guardar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Guardar
            </button>
          )}
          <button
            type="button"
            onClick={() => setVerPreview(true)}
            disabled={sucio || guardar.isPending}
            className="text-[11.5px] font-semibold text-accion hover:opacity-70 disabled:opacity-40
                       disabled:cursor-not-allowed focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
          >
            Ver qué cambia
          </button>
          {verPreview && preview.data && (
            <button
              type="button"
              onClick={confirmarAplicar}
              // Con la vista previa en 0 y 0 no hay nada que aplicar: el botón
              // habilitado invitaba a una escritura que no cambia nada y se
              // leía como "queda algo pendiente".
              disabled={sucio || aplicar.isPending || sinCambios}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accion px-3 py-1.5 text-xs
                         font-semibold text-white disabled:opacity-50 focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {aplicar.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Aplicar
            </button>
          )}
          {/* "Lo miré y está bien así" — el único caso que no deja rastro
              solo. Guardar ya cuenta como revisar, y por eso este botón
              desaparece en cuanto hay algo sin guardar: confirmar sin guardar
              diría que se revisó una regla que todavía no es la que está. */}
          {!sucio && (
            <BotonConfirmar
              revisado={!!revision}
              pendiente={confirmando}
              onConfirmar={onConfirmar}
            />
          )}
          {sucio && <span className="text-[10.5px] text-gray-400">Guarda la regla antes de ver qué cambia.</span>}
        </div>
      ) : null}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-gray-400">{requisito.requirement_code}</p>
        <MarcaDeRevision revision={revision} />
      </div>

      {(esAsset || esCarrier) ? (
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold text-text-primary">¿A quién se le exige?</legend>

          <label className="mt-2 flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="radio"
              name={`alcance-${requisito.id}`}
              className="accent-accent"
              disabled={!canEdit}
              checked={alcance === 'todos'}
              onChange={() => setAlcance('todos')}
            />
            {UNIVERSO[requisito.target_entity]}
            <span className="text-gray-400 tabular-nums">· {requisito.alcance.universo}</span>
          </label>

          <label className="mt-1 flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="radio"
              name={`alcance-${requisito.id}`}
              className="accent-accent"
              disabled={!canEdit}
              checked={alcance === 'algunos'}
              onChange={() => setAlcance('algunos')}
            />
            {ALGUNOS[requisito.target_entity]}
          </label>

          {/* El selector aparece SÓLO si hace falta. Dibujarlo siempre es lo que
              hacía que 35 reglas sin condición mostraran diez casillas vacías. */}
          {alcance === 'algunos' && (
            <div className="mt-2 ml-5 rounded-lg border border-border p-2.5">
              {opciones.map(o => (
                <label key={o.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    disabled={!canEdit}
                    checked={elegidos.includes(o.id)}
                    onChange={() => setElegidos(prev =>
                      prev.includes(o.id) ? prev.filter(x => x !== o.id) : [...prev, o.id])}
                  />
                  {o.label}
                </label>
              ))}
              {ocultos > 0 && (
                <p className="text-[10.5px] text-amber-700 pt-1">
                  +{ocultos} marca{ocultos > 1 ? 's' : ''} de {OCULTO[requisito.target_entity]},
                  no visible acá. Se conserva al guardar.
                </p>
              )}
            </div>
          )}
        </fieldset>
      ) : (
        <p className="mt-3 text-xs text-gray-700">Se exige a todos los conductores.</p>
      )}

      <label className="mt-4 flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          className="accent-accent"
          disabled={!canEdit}
          checked={marcadoActivo}
          onChange={() => setMarcadoActivo(a => !a)}
        />
        Vigente
      </label>
      {!marcadoActivo && (
        <p className="mt-1 text-[10.5px] text-gray-500">
          Sin vigencia el documento no se exige a nadie, pero la condición queda guardada.
        </p>
      )}

      {errorGuardar && <p className="mt-2 text-[10.5px] text-red-600">{errorGuardar}</p>}
      {errorAplicar && <p className="mt-2 text-[10.5px] text-red-600">{errorAplicar}</p>}

      {verPreview && preview.isPending && (
        <p className="mt-3 text-[11px] text-gray-500 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" /> Calculando…
        </p>
      )}

      {verPreview && preview.data && (
        <div className="mt-3 rounded-lg border border-border bg-gray-50 px-3 py-2 text-[11.5px] space-y-1">
          {sinCambios ? (
            <p className="text-gray-600">La regla ya está aplicada: no hay nada que agregar ni que dejar de exigir.</p>
          ) : (
            <p>Se agregan {preview.data.crear} · <b>dejan de exigirse {preview.data.quitar}</b></p>
          )}
          {preview.data.bloqueados > 0 && (
            <p className="flex items-start gap-1.5 text-amber-700">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              {preview.data.bloqueados} ya no corresponden según esta regla pero tienen documento
              cargado. No se tocan: hay que resolverlos de a uno.
            </p>
          )}
        </div>
      )}
    </PanelLateral>
  )
}
