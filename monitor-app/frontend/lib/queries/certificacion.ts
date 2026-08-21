import type { QueryClient } from '@tanstack/react-query'

/**
 * Las claves de caché de Certificación, en un solo lugar.
 *
 * Antes vivían escritas a mano en siete archivos, y la lista de qué invalidar
 * era un arreglo que cada componente ampliaba con las suyas. Eso falló dos
 * veces, de la misma manera y sin que nada lo detectara: una clave que no
 * existe en ninguna consulta no rompe nada, simplemente no invalida, y el
 * síntoma es una pantalla desactualizada que sólo se nota mirándola.
 *
 *   · `['document-ingest-items']` — no existía en el repo. Encontrada y
 *     corregida cuando la bandeja de arriba del cajón no se refrescaba.
 *   · `['compliance-pending']` — estaba en la lista de invalidación y ninguna
 *     consulta la usaba. React Query compara elemento por elemento, así que
 *     no alcanzaba a `['compliance-pending-carrier-panel']` ni a
 *     `['compliance-pending-drawer']`: invalidaba exactamente nada.
 *
 * La segunda dejó de ser posible: `pendientes()` ES `['compliance-pending',
 * carrierId]`, así que la raíz que invalida y la clave que consulta salen de
 * la misma función. Una clave inventada ya no compila.
 *
 * De paso desaparece una duplicación real: `-carrier-panel` y `-drawer` eran
 * DOS entradas de caché para la misma consulta —`listPending({ carrierId })`—
 * pedida por dos componentes que se dibujan juntos. La misma respuesta se
 * guardaba dos veces y había que acordarse de invalidar las dos.
 */
export const clavesCertificacion = {
  /** El estado agrupado que alimenta el embudo y las tablas. */
  estado:   (group: string, q?: string) => ['certification-status', group, q ?? ''] as const,
  /** El resto del catálogo: las empresas sin actividad, que se piden aparte. */
  catalogo: (q?: string) => ['certification-status-catalog', q ?? ''] as const,
  /** La cola de sin clasificar. Sin empresa es la global. */
  cola:     (carrierId?: string) => ['ingest-queue', carrierId ?? 'all'] as const,
  /** Cuántos esperan. La comparte el Sidebar, por eso no lleva parámetros. */
  colaTotal: () => ['ingest-queue-count'] as const,
  /** La URL firmada de un archivo, que se pide de a uno al enfocarlo. */
  vistaPrevia: (itemId: string | null) => ['ingest-preview', itemId] as const,
  /** El resumen de la ficha de empresa: cuántos requisitos tiene cada
   *  sujeto y cómo vienen, sin el detalle. Clave propia y no comparte raíz
   *  con `pendientes`: son dos endpoints distintos (`/summary` contra
   *  `/pending`), y una escritura que invalida uno tiene que invalidar el
   *  otro también —por eso las dos viven en `RAICES_DE_CERTIFICACION`, no
   *  sólo una. */
  resumen: (carrierId?: string) => ['compliance-summary', carrierId ?? null] as const,
  /** Lo que le falta a una empresa y a su gente, o a un sujeto suyo.
   *
   *  El sujeto va EN la clave: el cajón de una persona y el de su empresa
   *  piden respuestas distintas del mismo endpoint, y compartir clave haría
   *  que uno sirviera la respuesta cacheada del otro.
   *
   *  `estado` también va en la clave: el cajón pide `falta` (no lo pasa,
   *  viaja `null`) y la ficha de empresa pide `todos` — sin este segmento
   *  las dos comparten UNA sola entrada de caché y una pisa a la otra según
   *  quién haya montado primero. Ronda de arreglo 1 (Task 4): la ficha dejó
   *  de pedir las cuatro variantes en paralelo —pedía `todos` una vez y las
   *  otras tres sólo para contarlas, cuando `urgencia` ya trae esa cuenta
   *  en la misma fila— y ahora pide sólo `todos`; el resto se filtra en el
   *  cliente sobre esas filas, sin volver a la red. */
  pendientes: (carrierId?: string, entityId?: string, estado?: string) =>
    ['compliance-pending', carrierId ?? null, entityId ?? null, estado ?? null] as const,
  /** El catálogo de requisitos de un tipo de entidad. */
  requisitos: (entityType?: string) => ['compliance-requirements', entityType ?? null] as const,
}

/**
 * Todo lo que cualquier mutación de Certificación deja obsoleto.
 *
 * Es UNA función y no una lista que cada componente amplía: subir desde la
 * bandeja y subir desde el cajón dejan obsoleto exactamente lo mismo, y
 * cuando cada uno invalidaba su propio conjunto, el contador del Sidebar
 * (`staleTime: 60_000`) contradecía a la lista durante un minuto.
 *
 * Son RAÍCES: React Query invalida por prefijo, así que `['compliance-pending']`
 * alcanza a todas las empresas sin enumerarlas.
 *
 * `['compliance-summary']` se sumó con el resumen de la ficha (perf/compresion-y-resumen):
 * sin ella, dar de baja o transferir a alguien deja las nueve cabeceras
 * plegadas con un conteo viejo — desactualizada sin que nada lo rompa, la
 * misma forma en que esta lista ya perdió una raíz dos veces.
 */
export const RAICES_DE_CERTIFICACION: readonly string[][] = [
  ['ingest-queue'],
  ['ingest-queue-count'],
  ['compliance-pending'],
  ['compliance-summary'],
  ['certification-status'],
  ['certification-status-catalog'],
]

export function invalidarCertificacion(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    RAICES_DE_CERTIFICACION.map((queryKey) => qc.invalidateQueries({ queryKey })),
  )
}
