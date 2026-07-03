# Diario — rediseño del modal de detalle de viaje (TripSlideOver)

**Fecha:** 2026-07-02
**Estado:** Aprobado por el usuario, pendiente revisión final del documento
**Módulo:** Monitor de Viajes / Diario (`monitor-app/frontend`) — Empresas y Configuración excluidos
**Precede a:** plan de implementación (writing-plans)
**Se apoya en:** `specs/2026-07-02-diario-rediseno-completo-design.md` (rediseño de tabla/tablero, ya implementado — este documento NO lo modifica, solo el modal de detalle que ambas vistas abren)

## Contexto y problema

Tras ver en producción el rediseño de tabla/tablero implementado esta sesión, el usuario dio feedback sobre el modal de detalle (`TripSlideOver.tsx`) que ese rediseño no tocó:

1. **"es poco intuitivo el modal del detalle de viaje y como se presenta la información de cada viaje"**
2. **"los indicadores no son útiles, dado que la data viene de app.trips y uno sabe en que están"**
3. **"lo que es la bitacora debe ser mas robusta... adjuntar distintos tipos de archivos, pdf, screenshot, etc"**
4. **"lo de asignado, trabajando activo, eventualmente es aplicable siempre y cuando son viajes manuales"**

Al preguntarle qué priorizar de las 3 áreas, eligió **reordenar el modal completo primero** (los indicadores, al vivir dentro de ese mismo modal, se resuelven en este mismo diseño; los adjuntos de bitácora quedan para una spec aparte — ver "Fuera de alcance").

### Hallazgos concretos de la investigación (antes de diseñar)

Comparando el schema real de `app.trips` contra lo mostrado en el modal:

- **Duplicación confirmada por el usuario**: `planning_date` aparece tanto en la tira de KPIs ("Planificación") como en Resumen ("Fecha planificación"). `status_reported_at` aparece dos veces: dentro de "Planificación" (sub-línea "Rep. …") y como "Último reporte TMS" en Resumen.
- **4 timestamps de sincronización dispersos sin jerarquía clara**: `status_reported_at`, `pipeline_updated_at`, `created_at` (mostrado) y `updated_at` (nunca mostrado) — el usuario los señaló como "campos de sincronización pipeline" que no comunican valor real tal como están presentados (fechas absolutas sueltas, no relativas).
- **Indicadores (`activo`/`trabajando`/`asignado`/`primera_vuelta`) SÍ vienen poblados por el pipeline TMS** (no son solo un toggle manual vacío) — verificado contra datos reales:

  | Fuente | Total | Activo=true | Trabajando=true | Asignado=true | 1ra Vuelta=true | Con edición manual |
  |---|---|---|---|---|---|---|
  | qanalytics | 1964 | 692 (35%) | 631 (32%) | 1963 (**99.9%**) | 0 | 0 |
  | sodimac | 344 | 64 (19%) | 0 | 0 | 0 | 0 |
  | wingsuite | 12 | 7 | 7 | 12 | 0 | 0 |

  `asignado` es casi constante en qanalytics (99.9%, poco informativo), `primera_vuelta` nunca es `true` en ningún viaje real de ninguna fuente, y **cero** viajes tienen `manually_edited_fields` no vacío — nadie ha usado el toggle manual en producción. Hoy no existe ningún viaje con `source_system = 'manual'` en la data real (0 filas), aunque el flujo de creación manual sí existe en el producto.
- **No hay campos crudos escondidos**: se revisaron las keys de `fleet` (jsonb) y `stops` (jsonb) contra lo ya expuesto por `_TRIP_SELECT`/`TripStop` — todo lo que existe en la BD ya se muestra en alguna parte del modal actual. El problema no es "faltan datos", es "los datos que existen están mal organizados y repetidos".

## Exploración visual y decisión

Se compararon 3 estructuras (mockups en `.superpowers/brainstorm/`, sesión 2026-07-02), todas resolviendo sync consolidada + ruta promovida + separación lectura/edición, pero con distinto peso visual:

- **A — Consolidado**: ruta primero, datos operativos en fondo gris, gestión en fondo azul, cero repetición.
- **B — Ruta primero**: la línea de tiempo domina la pantalla, el resto colapsa por defecto.
- **C — Cards independientes**: cada sección es su propia tarjeta tipo Linear/Notion, más aire visual.

**Decisión del usuario: Enfoque A.**

## Diseño aprobado

### Estructura general del modal (de arriba hacia abajo)

1. **Header** (`bg-slate-900`, sin cambios de contenido salvo lo indicado): TMS badge + ID de viaje + botón cerrar · Patente + Estado + Conductor/RUT/Teléfono + Cliente. **Se quita la fila de flags** (Activo/Trab./Asig./1V) — su destino se resuelve en "Indicadores condicionales" más abajo.
2. **Sincronización** (nuevo, reemplaza la tira de KPIs + los timestamps dispersos de Resumen): una sola línea con tiempos relativos — ver fórmula abajo.
3. **Ruta** (promovida — hoy es la sección "Paradas", al final del modal): pasa a ser el primer bloque de contenido tras Sincronización. Reutiliza `StopTimeline` + el acordeón "Ver detalle técnico (GPS, SAP)" sin cambios internos, solo de posición.
4. **Datos operativos** (fondo gris, `readonly`, solo lectura — visualmente distinto de "Gestión"): Fecha planificación, Origen, Tipo carga, EETT TMS, Estado cumplimiento (`milestone_status`, si existe).
5. **Gestión** (fondo azul con borde izquierdo, `editable` — todo lo que el operador puede tocar): Estado operativo manual (control ya existente, se reubica sin cambios de lógica), Indicadores (condicional, ver abajo), Empresa transportista (acordeón ya existente, se reubica sin cambios), Bitácora (se reubica, deja de ser acordeón separado).
6. **Footer secundario** (chico, al final del panel): `created_at` ("Ingresó al sistema") + `trip.id` (el uuid interno, no mostrado en ningún lado hoy) — información de auditoría que no compite por atención arriba.

### Consolidación de sincronización

```
● TMS reportó {formatRelativeTime(status_reported_at)} · Pipeline sincronizó {formatRelativeTime(pipeline_updated_at)}
```

- `status_reported_at` y `pipeline_updated_at` ya existen y ya se usaban (antes como fechas absolutas en dos lugares distintos) — no hay cambio de backend.
- Nueva función pura `formatRelativeTime(iso: string | null): string` en `lib/utils/datetime.ts`: `"hace {N} min"` / `"hace {N} h"` / `"hace {N} d"` / `"—"` si `iso` es `null`. No reemplaza `fmtDT` (que se sigue usando para paradas, atribución de ediciones manuales, etc.) — es una función nueva, de uso acotado a esta línea de sincronización.
- El punto verde es un acento visual estático, no un indicador de conexión en vivo (no hay polling/auto-refresh en este alcance).
- `created_at` se mueve al footer secundario (punto 6 arriba). `updated_at` nunca se mostró en el detalle (solo se usa para ordenar en la tabla) — sigue sin mostrarse, sin cambio.

### Indicadores condicionales por fuente

`IndicatorDots` deja de mostrarse siempre. Nueva regla, aplicada consistentemente en los **3 lugares** donde se usa el componente:

- **`TripSlideOver.tsx`** (dentro de "Gestión"): visible y editable solo si `trip.source_system === 'manual'`.
- **`TripTable.tsx`** (columna "Indicadores", fila de tabla): misma condición.
- **`TripCard.tsx`** (tarjeta del tablero): misma condición.

Para viajes de TMS (el 100% de los viajes reales hoy), el bloque de Indicadores no se renderiza — no hay nada que deshabilitar visualmente, simplemente no ocupa espacio. La fila de flags del header de `TripSlideOver` (Activo/Trab./Asig./1V) se oculta con el mismo criterio.

**Justificación**: en viajes TMS estos campos vienen poblados por el pipeline (no por edición manual — 0 ediciones manuales registradas en toda la tabla), `asignado` es casi constante (99.9% en qanalytics) y `primera_vuelta` nunca es `true` en ningún viaje real — editarlos a mano en un viaje TMS no tiene un efecto claro. Para viajes manuales (`source_system = 'manual'`), en cambio, estos 4 campos SÍ son la única fuente de verdad del estado operativo (no hay TMS reportando nada), así que ahí siguen siendo plenamente relevantes y editables.

### Bitácora (reposicionada, sin adjuntos)

Se mueve tal cual — mismos dos textareas (Observaciones, Comentarios), mismo botón "Guardar notas", misma lógica de guardado (`handleSave`, sin cambios) — a la zona "Gestión", dejando de ser un acordeón independiente al final del modal. Sin cambios de datos ni de comportamiento, solo de posición y de contenedor visual (pasa a ser una tarjeta dentro de "Gestión" en vez de un acordeón propio).

## Componentes

### Nuevos

| Componente/función | Responsabilidad |
|---|---|
| `lib/utils/datetime.ts` → `formatRelativeTime(iso)` | Tiempo relativo en español ("hace 12 min" / "hace 2 h" / "hace 3 d" / "—"), función pura, usada solo por la línea de Sincronización. |

### Modificados

| Componente | Cambio |
|---|---|
| `TripSlideOver.tsx` | Reestructuración completa del cuerpo según el Enfoque A: header sin fila de flags, nueva sección Sincronización, Ruta promovida antes que Datos operativos, secciones agrupadas visualmente en `readonly` (Datos operativos) vs `editable` (Gestión: Estado operativo + Indicadores condicional + Empresa + Bitácora), footer secundario con `created_at`. `IndicatorDots` se renderiza condicionalmente (`trip.source_system === 'manual'`). |
| `TripTable.tsx` | `IndicatorDots` (columna "Indicadores", desktop y mobile) se renderiza condicionalmente (`trip.source_system === 'manual'`). Sin otros cambios — esta tabla ya fue rediseñada en la sesión anterior (fila enriquecida, sin `TripRowExpanded`). |
| `TripCard.tsx` | `IndicatorDots` se renderiza condicionalmente (`trip.source_system === 'manual'`). Sin otros cambios. |

### Sin cambios

- `StopTimeline.tsx`, `IndicatorDots.tsx` (lógica interna), `TripBoard.tsx`, `ViewToggle.tsx`, backend (`trips.py`) — ningún campo nuevo, ningún endpoint nuevo. Este rediseño es 100% frontend, reorganización de datos ya expuestos.
- `lib/types.ts` — no gana ni pierde campos (`source_system` ya existe y ya está tipado).

## Manejo de errores

Sin cambios de estándar: ningún error de `PATCH`/`DELETE` se silencia — ya cumplido por el código actual de `TripSlideOver`/`IndicatorDots` (ambos ya pasaron por esa corrección en la sesión anterior), no se toca esa lógica de guardado/rollback/error visible.

## Testing

- `formatRelativeTime`: tests puros con Vitest cubriendo segundos/minutos/horas/días y el caso `null`.
- `TripSlideOver.test.tsx`: extender para cubrir la nueva línea de Sincronización (texto relativo renderizado), la ausencia de la fila de flags del header, y la visibilidad condicional de Indicadores según `source_system`.
- `TripTable.test.tsx` / `TripCard.test.tsx`: extender para cubrir que `IndicatorDots` no se renderiza cuando `source_system !== 'manual'`, y sí se renderiza (editable) cuando `source_system === 'manual'`.

## Fuera de alcance de esta spec

- **Adjuntos en Bitácora** (PDF, screenshots) — requiere infraestructura nueva (bucket de Supabase Storage, tabla de attachments, endpoints de upload) que no existe hoy en el repo (confirmado: no hay ninguna referencia a Storage en migraciones ni en el código del backend). Se resuelve en una spec aparte, decisión explícita del usuario.
- Rediseño de Configuración — pospuesto en sesiones anteriores, sigue sin retomar.
- Auto-refresh/polling — el punto verde de Sincronización es un acento visual estático en este alcance, no un indicador de conexión en vivo.
- RLS/performance/Fase D — ya resueltos/documentados aparte en sesiones anteriores, sin relación con este documento.

## Preguntas abiertas para el plan de implementación

Ninguna — todas las decisiones de diseño quedaron cerradas durante el brainstorming (estructura, fórmula de sincronización, condición de indicadores y su alcance en los 3 componentes, destino de la bitácora).
