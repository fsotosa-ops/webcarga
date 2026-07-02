# Diario — rediseño de fila y detalle de viaje

**Fecha:** 2026-07-02
**Estado:** Aprobado por el usuario, pendiente revisión final del documento
**Módulo:** Monitor de Viajes / Diario (`monitor-app/frontend`) — Empresas excluido
**Precede a:** plan de implementación (writing-plans)

## Contexto y problema

Auditoría de la sesión anterior (ver `AGENTLOG.md`, entrada 2026-07-02) identificó que el módulo Diario, aunque funcionalmente correcto, exige demasiados clics para tareas frecuentes y usa terminología poco clara para conceptos operativos. El usuario, al revisar el módulo, confirmó y amplió estos puntos:

1. Ver el detalle completo de un viaje requiere abrir un modal full-screen y navegar entre 3 tabs (Viaje / Empresa / Bitácora).
2. Los indicadores operativos (Activo / Trabajando / Asignado / 1ra Vuelta) solo se pueden editar dentro de ese modal — no hay forma de tocarlos desde la tabla.
3. La tabla de paradas dentro del detalle (12 columnas: Local, Plan., Llegada, Salida, GPS Arr., GPS Sal., Desc. inicio, Desc. fin, S2S, Temp, On Time, Estado SAP) no comunica de forma rápida y clara el estado de avance del viaje.
4. El concepto "Override manual" en la tab Bitácora no es intuitivo: no queda claro qué significa, cuándo se activa, ni cómo revertirlo.
5. Armar un grupo de filtro personalizado requiere reconstruir la selección de estados desde cero en un modal aparte (`GroupBuilder`), aunque ya se hayan seleccionado esos mismos estados como filtro activo.
6. Agregar un viaje pasa siempre por un menú intermedio (manual vs. carga masiva) antes de llegar al formulario, aun cuando el caso manual es el más frecuente.

**Objetivo:** que las acciones más frecuentes (ver estado de un viaje, tildar un indicador) cuesten cero o un clic, y que lo que se usa poco (empresa, bitácora, carga masiva) quede accesible pero no en el camino principal.

**Alcance:** exclusivamente Diario (`TripTable.tsx`, `TripSlideOver.tsx`, `TripCreateSlideOver.tsx`, `GroupBuilder.tsx`, `app/dashboard/diario/page.tsx`). Configuración queda para una segunda ronda de diseño (decisión explícita del usuario: "Diario primero"). No incluye trabajo de performance backend (eso ya está documentado aparte como "Fase D" en `AGENTLOG.md`) ni cambios al módulo Empresas.

## Diseño de interacción: tres niveles de profundidad

Explorado visualmente con el usuario (mockups en `.superpowers/brainstorm/`, sesión de brainstorming 2026-07-02) comparando cinco enfoques — panel fijo estilo email, preview por hover, edición 100% inline, fila expandible, y vista de detalle sin tabs. Se descartó el panel fijo persistente (obliga a angostar una tabla ya densa de 12+ columnas y no funciona en la vista mobile que `TripTable.tsx` ya tiene) y el preview por hover (no existe gesto equivalente en tablet/mobile). La combinación aprobada usa lo mejor de "edición inline" + "fila expandible" + "vista sin tabs":

**Nivel 1 — Fila de la tabla (clic directo, sin navegar a ningún lado):** los indicadores (Activo/Trabajando/Asignado/1ra Vuelta) se muestran como puntos clickeables directo en la fila; un clic los togglea sin abrir modal ni expandir nada. La temperatura sigue como chip, ya clasificada por color (rojo/azul) desde el trabajo de esta misma sesión.

**Nivel 2 — Fila expandida in-place (1 clic):** un clic en la fila (fuera de los puntos de indicador) la expande mostrando: KPI de temperatura, timeline vertical de paradas (✓ completada / ● activa / ○ pendiente, con horarios), los 4 indicadores completos, y un link "Ver ficha completa". No abre modal ni tapa la tabla — el resto de las filas sigue visible arriba y abajo.

**Nivel 3 — Ficha completa (2 clics, caso raro):** el link de la fila expandida abre lo que hoy es `TripSlideOver`, pero sin tabs — una sola vista scrolleable con Paradas e Indicadores arriba (mismo contenido que el nivel 2, con más detalle) y Empresa / Bitácora como secciones colapsadas (acordeón), un clic las despliega sin cambiar de pantalla.

## Terminología y tratamiento de "override manual"

En vez de un concepto separado escondido en la tab Bitácora, el estado de override se muestra **en el lugar del campo afectado**, con lenguaje operativo en vez de técnico:

> Activo — *confirmado manualmente el 2/7 10:15 · viene del TMS* ⟲

El ícono ⟲ dispara el revert, reusando el endpoint ya existente `DELETE /trips/{id}/overrides/{field}` (`tripsApi.resetField`, implementado en sesiones anteriores) — no requiere backend nuevo. La atribución solo incluye timestamp (`trip.edited_at`), no usuario: **`app.trips` no tiene una columna de "editado por"** hoy. Agregar esa columna es un cambio de backend fuera del alcance visual de esta spec — queda como pregunta abierta para el plan de implementación (ver más abajo), con default: si no se agrega, la copia omite "por {nombre}" y dice solo "confirmado manualmente el {fecha}".

## Filtrado: guardar grupo desde el filtro activo

En vez de que `GroupBuilder` sea el único punto de entrada para armar un grupo (obligando a reseleccionar estados desde cero), se agrega un botón "Guardar como grupo" en la barra de filtros de `diario/page.tsx` que toma los estados ya tildados como filtro activo y abre `GroupBuilder` con esa selección precargada — el modal pasa a pedir solo nombre y color, no la selección completa. `GroupBuilder` se mantiene como componente (edición/borrado de grupos existentes sigue viviendo ahí), solo cambia cómo se llega a él para crear uno nuevo.

## Agregar viaje

El botón "Agregar viaje" deja de abrir un menú intermedio: su acción primaria pasa a ser abrir directo `TripCreateSlideOver` (caso manual, el más frecuente). "Carga masiva" (`TripBulkUpload`) queda como link secundario, más chico, al lado del botón — accesible pero no en el camino principal.

## Componentes afectados

| Componente | Cambio |
|---|---|
| `TripTable.tsx` | Indicadores pasan de `FlagDots` (solo lectura) a botones interactivos con `tripsApi.patch`. Nuevo estado local `expandedTripId` (uno solo a la vez). Click en fila fuera de los puntos → expande; click en "Ver ficha completa" → sigue usando el `onSelect(trip)` que ya sube a `page.tsx`. |
| `StopTimeline` (nuevo, `components/dashboard/`) | Timeline vertical de paradas, componente puro reutilizado tanto en la fila expandida como en la ficha completa — reemplaza la tabla de 12 columnas como forma primaria de mostrar avance (la tabla detallada puede quedar como vista secundaria "ver tabla" para quien la necesite, a decidir en el plan). |
| `TripSlideOver.tsx` | Se elimina el estado de tabs; Paradas + Indicadores quedan siempre visibles arriba, Empresa/Bitácora pasan a secciones colapsables (acordeón). El tratamiento de "override manual" se mueve al lugar del campo, ya no vive solo en Bitácora. |
| `GroupBuilder.tsx` | Acepta una selección inicial de estados (prop nueva), para el flujo de "Guardar como grupo". Sin cambios en su lógica de edición/borrado existente. |
| `app/dashboard/diario/page.tsx` | Botón "Guardar como grupo" en la barra de filtros. Botón "Agregar viaje" deja de abrir menú, abre `TripCreateSlideOver` directo; "Carga masiva" pasa a link secundario. |

## Manejo de errores

Los toggles de indicador, el revert de override, y "guardar como grupo" deben mostrar el error de forma visible si el `PATCH`/`POST` falla — **no silenciarlo** (`catch { /* ignore */ }`, patrón usado hoy en `ConductorCell`/`PhoneTagCell`/`PlateCell` y ya señalado como el hallazgo de mayor riesgo de la auditoría anterior). Al mover la edición de indicadores a la fila —más visible y más frecuente que antes— un error silencioso ahí sería peor todavía. Se sigue el patrón ya correcto de `TripSlideOver.handleSave`, que sí muestra el error.

## Flujo de datos

- **Toggle de indicador:** actualización optimista (cambia el estado local al instante) → `tripsApi.patch` → si falla, rollback al valor anterior + mensaje de error inline.
- **Expandir/colapsar fila:** estado local en `TripTable`, no global — no toca `page.tsx` salvo para abrir la ficha completa (reusa `onSelect` existente).
- **Revert de override:** reusa `tripsApi.resetField`, sin cambios de API.
- **Guardar como grupo:** reusa la API de `filterGroups` (`create`), solo cambia el punto de entrada y el prefill.

## Testing

El módulo no tiene tests hoy (hallazgo #3 de la auditoría anterior). Dado que este rediseño mueve la edición más frecuente del Diario a un lugar más visible, el plan de implementación debe incluir cobertura mínima para: toggle de indicador (optimista + rollback en error), invocación de `resetField`, expandir/colapsar fila, y prefill de `GroupBuilder` desde el filtro activo. No hay cambios de schema/backend más allá de lo ya existente, así que el suite de backend (12/12 hoy) no debería verse afectado.

## Fuera de alcance de esta spec

- Rediseño de Configuración (segunda ronda, ya decidida por el usuario).
- Fase D (performance de `GET /trips`, `COUNT(*)` duplicado, `OFFSET` vs. keyset) — ya documentada aparte, no se toca acá.
- Vista de tabla detallada de paradas (12 columnas): se mantiene la posibilidad de acceder a ella para casos que necesiten el detalle SAP/GPS completo — el plan de implementación decide si es un link "ver tabla completa" o se elimina directamente a favor del timeline.

## Preguntas abiertas para el plan de implementación

1. ¿Vale la pena agregar una columna `edited_by` a `app.trips` para atribuir el override manual a una persona, o alcanza con el timestamp? (fuera del alcance visual de esta spec, es una decisión de backend)
2. ¿Un solo viaje expandido a la vez en la tabla (recomendado, evita saturar visualmente) o múltiples simultáneos?
3. ¿La tabla detallada de paradas (12 columnas, con datos GPS/SAP) desaparece del todo a favor del timeline, o queda accesible como vista secundaria para quien la necesite?
