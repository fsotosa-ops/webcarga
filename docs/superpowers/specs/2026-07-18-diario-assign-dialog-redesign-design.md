# Diario — diálogo de asignación driver-first + escalabilidad de filtros

**Fecha**: 2026-07-18
**Alcance**: continuación de la auditoría/plan de hardening del Diario (`.claude/plans/necesito-que-actues-como-lucky-bentley.md`), como requerimiento adicional a la Fase 2 (antes indefinida).

## Contexto

El plan original de hardening del Diario ya resolvió (Fases 0-1, 3-4): bugs de datos de origen/destino, trazabilidad completa shipper→carrier→driver→vehicle, mecanismo ongoing de asignación vehículo→conductor (`public.vehicle_driver_assignments`), vista de disponibilidad roster-driven, e Indicadores→tabs de filtro.

Al usar esa vista de disponibilidad recién construida, el usuario planteó 3 problemas nuevos:

1. **El flujo de "asignar viaje nuevo" no refleja que el conductor es la llave real de la operación diaria.** `TripCreateSlideOver` obliga a elegir la empresa primero (`EmpresaSelector`) y recién ahí ofrece conductor/vehículo de su roster — invertido respecto a cómo ya piensa el resto del sistema (`available-drivers` parte del conductor y deriva vehículo/empresa vía `vehicle_driver_assignments`/`driver_assignments`). webcarga no opera vehículos como entidad de primer nivel en el uso diario — son una asignación que cuelga del conductor.
2. **El patrón de slide-over lateral con scroll no está a la altura de una experiencia SaaS world-class** para un equipo que mira/asigna viajes constantemente (alta frecuencia, glance-and-act).
3. **Las tabs de filtro se van a saturar.** Hoy hay hasta 10 señales repartidas en 2 filas (6 KPI de alerta + 4 flags operativos) más una fila de "Estado" (6 grupos + custom groups, que puede crecer sin límite).

## Decisiones de alcance (confirmadas por el usuario)

- **Un solo spec integral** para los 3 problemas — conviven en las mismas pantallas y el patrón de interacción que salga del punto 2 tiene que ser compatible con el flujo driver-first del punto 1.
- **Dentro de este spec**: fusión de `AvailabilityPanel` + `TripCreateSlideOver` en un diálogo único, driver-first; escalabilidad de filtros en `page.tsx`; cálculo de "vuelta N" por conductor/día (surgió durante el diseño, ver sección dedicada).
- **Fuera de este spec** (quedan para otra ronda, reutilizando el patrón de diálogo que salga de acá): `TripSlideOver` (detalle/edición de viaje en curso — la profesionalización de la bitácora original de la Fase 2 sigue sin alcance definido), `TripBulkUpload` (carga CSV), `CarrierAssignSection` (reasignar empresa a un viaje ya existente).
- **Estado (pills en_ruta/en_local/retornando/cerrado/problema/otro + grupos personalizados)** queda fuera de la unificación de alertas — es la dimensión de navegación primaria (etapa operativa del viaje), conceptualmente distinta de una alerta, y el patrón single-select ya es el estándar logtech para eso.

## 1. Diálogo de asignación fusionado (`TripAssignDialog`)

### Componentes que reemplaza

- `AvailabilityPanel.tsx` (slide-over lateral, tabs Conductores/Equipos) — se elimina.
- `TripCreateSlideOver.tsx` (slide-over lateral, formulario de alta) — se elimina.
- Un componente nuevo, `TripAssignDialog.tsx`, cubre ambos casos de uso.

### Patrón visual

Diálogo centrado (mismo lenguaje que `TransferModal`/`DriverDetailPanel`/`InsurancePolicyModal`: `bg-black/30` backdrop + card `rounded-xl shadow-2xl`), ancho medio (`max-w-xl` aprox. — más ancho que `TransferModal` por tener más campos, pero sin el alto de pantalla completa de un slide-over). Scroll interno solo si la lista de paradas crece, no como comportamiento por defecto.

### Entradas

- Botón **"+ Nuevo viaje"** (ya existe en la toolbar) → abre el diálogo en el paso de búsqueda de conductor, sin filtro previo.
- Tile **"N disponibles"** (ya existe, ver `AvailabilityPanel` actual) → abre el mismo diálogo con la lista de conductores disponibles hoy (`GET /trips/available-drivers`) precargada como resultado sugerido en vez de arrancar vacío.

### Flujo, paso a paso

1. **Búsqueda de conductor** — autocomplete sobre `public.drivers` (mismo patrón que `CarrierSearchPicker`, adaptado a conductor: nombre + RUT). Único punto de entrada — no hay una tab/entrada alternativa por vehículo. Ver conductores libres hoy (`available-drivers`) sin necesidad de tipear nada, si vino desde el tile.
2. **Elegir un conductor** → en la misma pantalla (sin cerrar/abrir otra ventana) aparecen, autocompletados desde las asignaciones activas del conductor y **editables**:
   - Empresa (`driver_assignments` activa)
   - Vehículo/patente (`vehicle_driver_assignments` activa) — si no hay vehículo vinculado, queda vacío y editable a mano, no bloquea
   - Teléfono (si hay uno capturado en un viaje anterior de ese conductor)
   - El vehículo se muestra con patente + `asset_type` (TRACTOCAMION/RAMPLA) — **no hay dato de capacidad de carga por vehículo** (confirmado contra `public.assets`: solo `license_plate`, `asset_type`, `operational_status`, `manufacture_year`, `is_manual_override`, `created_at`). `cargo_type` (SECO/FRIO/CONGELADO) sigue siendo un campo del viaje, tipeado por operaciones — no se infiere del vehículo.
3. **Conductor no encontrado en el directorio** → mensaje explícito ("Este conductor no está en el directorio de Empresas") con link a Empresas para darlo de alta. **El formulario no avanza sin un `driver_id` real vinculado.** Esto es un cambio de comportamiento respecto a hoy (hoy siempre se puede tipear conductor/patente en texto libre) — es la mayor fuente de fricción operativa nueva de este spec, aceptada explícitamente por el usuario a cambio de trazabilidad completa desde el alta.
4. **Resto del formulario** (fecha, cliente, origen, paradas, `cargo_type`) aparece debajo una vez elegido el conductor — mismos campos que `TripCreateSlideOver` hoy, sin cambios de contrato con el backend (`POST /trips` ya acepta `driver_id`/`carrier_id`/`tractor_asset_id`).

### Fuera de alcance explícito de este componente

Buscar/filtrar equipos libres **sin** conductor asignado (ej: "¿qué camiones están en el patio hoy, sin importar quién los maneja?") es un trabajo distinto — más cercano a un reporte/vista de flota que a "voy a crear un viaje". No se resuelve en este spec; si hace falta, es una vista nueva y separada a definir cuando haya evidencia de que se necesita.

## 2. "Vuelta N" calculada por conductor/día

Hoy `is_first_leg` es un booleano manual/reportado por TMS, sin relación con cuántos viajes reales lleva un conductor en el día. Con `trip_fleet_links.driver_id` poblado al 92% (Ronda 18) y el origen normalizado como parada 0 (Ronda 21), ya hay suficiente dato para calcularlo en vez de depender de un flag.

**Cálculo**: `ROW_NUMBER() OVER (PARTITION BY driver_id, planning_date ORDER BY COALESCE(origin_stop.departure_date, origin_stop.gps_departure_date, origin_stop.desc_inicio_manual, origin_stop.departure_date_prog, origin_stop.planning_date))`, agregado al `SELECT` existente de `trips.py` (`_TRIP_SELECT`/`_TRIP_FROM`) — mismo patrón "resolución en vivo" ya usado para conductor/vehículo/empresa esta sesión. Nombres de columna verificados contra el schema real de `app.trip_stops` en Supabase (no existen `actual_departure_at`/`planned_departure_at` — son `departure_date`/`gps_departure_date`/`desc_inicio_manual`/`departure_date_prog`). **Sin migración, sin tocar dbt/Mage** (evita el riesgo ya materializado 2 veces esta sesión con el watermark incremental).

**Resultado**: campo nuevo `driver_leg_number: number | null` en `Trip`. La columna/tile "1ra Vuelta" pasa de leer `is_first_leg` a filtrar por este número (ej. "2ª+ vuelta" = `driver_leg_number >= 2`). `is_first_leg` **no se borra** de la base — solo deja de ser la fuente de este filtro específico; viajes sin `driver_id` resuelto (sin conductor vinculado) tienen `driver_leg_number = NULL` y no participan del filtro.

## 3. Escalabilidad de filtros

### Estado actual (a resolver)

- **KPI de alerta** (6, single-select): OFF TIME, Atraso de llegada, Detenido en local, Sin reporte, Temp fuera de rango, Sin asignación.
- **Flags operativos** (4, multi-independiente): Activo, Trabajando, Asignado, 1ra Vuelta.
- 10 señales en 2 filas separadas, ambas crecientes (cualquier alerta nueva agrega una tile más).

### Diseño

- Las 10 señales se consolidan en **un solo control "Alertas (N)"** que abre un popover con checkbox + contador por señal. Filtros activos se muestran como chips removibles debajo del control (mismo patrón Linear/Attio).
- **3 señales quedan pineadas por default, fuera del popover, siempre visibles**: OFF TIME, Sin asignación, Sin reporte (stale) — elegidas por el usuario como las de mayor revisión constante. "1ra Vuelta" se retira del set fijo (pasa a ser un filtro por `driver_leg_number` dentro del popover, ya no una de las 3 pineadas).
- **Personalización**: cada usuario puede fijar/quitar señales del set visible siempre, vía un control "Fijar"/⭐ en cada fila del popover. Se persiste en `localStorage` (mismo mecanismo ya usado por `VIEW_MODE_STORAGE_KEY` para recordar tabla/tablero) — sin backend ni tabla de preferencias nueva. El preset de 3 señales de arriba es el default de fábrica; el usuario que nunca lo toca ve exactamente ese default.
- **Semántica de combinación — cambio de comportamiento respecto a hoy**: dentro del popover, cualquier cantidad de checkboxes se puede marcar a la vez. Las alertas de condición (OFF TIME, Atraso, Detenido, Sin reporte, Temp fuera de rango, Sin asignación) pasan de selección única a **OR entre ellas** (ej: "OFF TIME o Sin reporte" simultáneamente — hoy es imposible, fuerza a elegir una). Los flags operativos (Activo, Trabajando, Asignado, vuelta N) siguen combinándose en **AND** con lo anterior, igual que hoy. Justificación: es el patrón estándar de cualquier popover de filtros faceted (Linear/Jira/Attio/Zendesk) y, más allá del estándar, refleja mejor los datos reales — un viaje puede estar OFF TIME **y** sin reporte al mismo tiempo, no son condiciones excluyentes; la restricción de hoy a una sola KPI activa es una limitación de la implementación actual (`f.kpiFilter` como string único), no una regla de negocio.
  - Implica reescribir `deriveKpis`/`matchesKpi` (`lib/utils/kpis.ts`) para aceptar un array de alertas activas en vez de un único `kpiFilter`, evaluando cada trip contra el conjunto con OR.
- "Estado" (pills + grupos personalizados) no se toca — sigue como fila separada, single-select, porque es la dimensión de navegación primaria (etapa operativa del viaje) y esa sí es genuinamente excluyente — un viaje está en una sola etapa a la vez.

### Estilo BI/KPI en las tiles fijas

El usuario pidió que las tiles pineadas (y potencialmente las del popover) funcionen como widgets tipo BI real — reducir carga cognitiva e impulsar accionables rápido, no solo ser un botón de filtro con un número al lado.

- **Jerarquía visual por severidad** (incluido en este spec, sin datos nuevos): hoy cada KPI tiene un color fijo por categoría sin importar el conteo. Pasa a una banda simple aplicada al conteo actual — 0 = neutro, 1-2 = elevado, 3+ = crítico (valores de corte a definir en el plan de implementación, no configurables por ahora) — reflejada en intensidad de color/tamaño del número. Se calcula con los mismos datos que ya trae `deriveKpis`, sin tabla ni endpoint nuevo.
- **Contexto de tendencia (vs. hace 1h/ayer)** — **fuera de alcance de este spec, fast-follow documentado**. No es gratis: hoy no existe ningún historial de estos conteos (`deriveKpis` los calcula en vivo al cargar los viajes; ni siquiera `public.audit_log` sirve, porque solo audita ediciones manuales de campos, no estados de alerta computados como off_time/stale). Requiere diseñar antes un mecanismo de snapshot (tabla nueva, cada cuánto capturar, cuánto retener, si vive en el pipeline de Mage — que ya corre cada ~15 min — o en el backend) — es un diseño en sí mismo, no una extensión menor de este spec.

## Testing

- **Backend**: tests nuevos/actualizados para `driver_leg_number` en `trips.py` (verificar partición correcta por conductor+día, NULL cuando no hay `driver_id`, orden por salida de origen). Tests de `POST /trips` para el caso "conductor no encontrado" si el bloqueo se aplica también server-side (ver nota abajo).
- **Frontend**: `TripAssignDialog.test.tsx` nuevo (reemplaza cobertura de `AvailabilityPanel.test.tsx` + partes de `TripCreateSlideOver.test.tsx` relevantes al flujo de selección de conductor) — cubre: búsqueda, autocompletado de empresa/vehículo editable, bloqueo cuando el conductor no está en el directorio, flujo completo desde ambas entradas (tile y botón). Tests para el popover "Alertas" (pinear/despinear, persistencia en localStorage, filtros por chip).
- Verificación completa de rigor: `tsc --noEmit`, `vitest run`, `npm run build`, `pytest` — mismo estándar que el resto de la sesión.

**Nota abierta para el plan de implementación**: el bloqueo de "conductor no encontrado" descrito en la sección 1 es una decisión de UX confirmada, pero falta decidir si se aplica *solo* en el frontend (el diálogo no deja avanzar sin `driver_id`) o también se refuerza en `POST /trips` (rechazar server-side si no viene `driver_id`) — importa porque `TripBulkUpload` (fuera de alcance de este spec) sigue creando viajes vía el mismo endpoint sin pasar por este diálogo, y hoy sí permite conductor en texto libre. Definir esto es un ítem para `writing-plans`, no bloquea la aprobación de este diseño.

## Migración / componentes a retirar

- `AvailableDriversPanel.tsx` ya no existe (renombrado a `AvailabilityPanel.tsx` en la Ronda 24) — ahora `AvailabilityPanel.tsx` también se retira, reemplazado por `TripAssignDialog.tsx`.
- `TripCreateSlideOver.tsx` se retira.
- `EmpresaSelector` (función interna de `TripCreateSlideOver.tsx`) se retira — el nuevo diálogo no busca por empresa como entrada, solo por conductor.
- `CarrierSearchPicker.tsx` (Ronda 25) sigue en uso por `CarrierAssignSection` (dentro de `TripSlideOver`, fuera de alcance) y `TransferModal` — no se toca.
- `hooks/useDiarioFilters.ts` gana el estado de señales pineadas (o vive en un hook nuevo dedicado, a decidir en el plan de implementación).
