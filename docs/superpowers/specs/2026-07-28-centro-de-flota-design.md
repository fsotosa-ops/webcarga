# Centro de Flota — diseño

**Fecha**: 2026-07-28
**Contexto**: el usuario pidió entender "cerrar el día" y los estados de conductor/equipo (disponible/asignado/no asignado), señalando que el botón "conductores disponibles" del Diario está mal configurado y debería formar parte del User Journey de cierre. Investigación completa contra `monitor-app/docs/user-stories/20260720/` (backlog HU-01..17, refinamiento v2, transcript de la reunión con Pablo, y los 3 reportes reales que el equipo ya envía por correo).

## Por qué y qué se encontró

El pill "N conductores disponibles" en la barra del Diario cuenta conductores del roster activo sin viaje abierto hoy (`GET /trips/available-drivers`), pero su único click abre "Agregar viaje" — no tiene ninguna conexión visible con "Cerrar el día", y usa el sustantivo equivocado.

**Evidencia de que el ancla correcta es el EQUIPO, no el conductor** (refinamiento v2, ítem 5, y confirmado con el usuario en brainstorming):
- Transcript 20/07, Pablo: *"¿Tu llave puede ser la patente del tracto? Lo normal es que sea el conductor, el problema es que el conductor, de repente, hoy se montó a un camión, [mañana] se monta a otro."*
- Los 3 reportes reales que Sumadots ya envía a Pablo por correo (Sodimac, Walmart, Sider/Iansa) usan **"equipos disponibles/asignados"** como métrica principal — el reporte de Walmart titula literalmente "033 equipos disponibles", con "Equipo Completo" (tracto+rampla+conductor) como estado.
- El backend ya tiene el endpoint correcto (`GET /trips/available-assets`, mismo diseño que `available-drivers`) pero **no lo consume ningún componente frontend** — toda la búsqueda de flota para crear un viaje (`FleetAssignSection`/`DriverSearchPicker`) es 100% conductor-primero.

**Decisión de alcance confirmada con el usuario** (2 preguntas de brainstorming): "Cerrar el día" (`app.driver_day_status`, ASSIGNED/UNASSIGNED/MISMATCH) **se mantiene 100% ancorado al conductor** — coincide con el fraseo literal de HU-01 ("conductores activos") y con cómo Pablo cuenta cabezas en el transcript ("sesenta conductores"). Se agrega un concepto **nuevo y separado** de disponibilidad de equipo que no reemplaza ni toca `driver_day_status`.

## Alcance

**Adentro:**
- Nuevo modal "Centro de Flota": disponibilidad de equipo (tracto) hoy, con cross-link hacia/desde "Cerrar el día".
- Fusión de "Agregar viaje" (individual) + "Carga masiva CSV" dentro de Centro de Flota como split-button — hoy son 2 botones sueltos en la barra del Diario que crean el mismo objeto (un viaje), solo cambia la cardinalidad.
- Separación visual crítica dentro de "disponibles": equipos que **nunca tuvieron ningún viaje hoy** (señal de alerta operativa — nadie los usó) vs. equipos que **ya completaron 1+ viaje y quedaron libres** (reasignables, operación normal). Pedido explícito del usuario: *"cuando un conductor aparece disponible es porque no está asignado y ahí se debe hacer la separación entre los que ya llevan más de un viaje y los que no tienen ninguna asignación — eso es lo relevante y crítico"*.
- Interactividad real en las filas MISMATCH de `CloseDayDialog` (refinamiento v2, ítem 4: *"no permite interactuar con los viajes que aparecen ahí... Estado Por regularizar, qué es eso, cómo voy a Revisar en Empresas"*) — pasan de linkear genéricamente a la ficha de empresa a abrir el viaje real que causó el mismatch.

**Afuera (confirmado explícitamente durante el brainstorming):**
- Nomenclatura MISMATCH: se evaluó cambiar "Por regularizar" por "En el aire" (frase textual de Pablo en el transcript) — el usuario prefirió **dejar "Por regularizar"** tal cual está en producción.
- Promover "Centro de Flota" a módulo de navegación de primer nivel (como Empresas/Seguros/Tarifario), con espacio propio para alertas de póliza/documentación de equipo — el usuario lo consideró y explícitamente lo dejó **fuera de este alcance**, para un checkpoint separado.
- Cualquier cambio a `app.driver_day_status`, a la lógica de bloqueo/override de `POST /daily-closures/close`, o al resto del Diario (tabla ancha, mapa, alertas de temperatura) — nada de eso se toca.
- Rediseño de Alertas/Reportería según mockups de Figma (refinamiento v2, ítem 6) — ya estaba fuera de alcance (Ronda 49), sigue así.

## Estructura del User Journey (Approach A, confirmado vía visual companion)

Dos modales con propósito distinto, cruzados por link, no fusionados en uno:

```
Diario (barra de acciones)
  └─ Botón "🚛 Flota — N disponibles"  (reemplaza el pill + el botón "Agregar viaje" de hoy)
       └─ abre → Centro de Flota (nuevo modal)
              ├─ tiles: "Nunca asignados hoy" / "Liberados tras viaje" / "En viaje hoy" (clickeables, filtran la tabla — mismo patrón que AlertStatTiles de Cerrar el día)
              ├─ búsqueda por patente/conductor/empresa
              ├─ tabla de equipos disponibles, 1 acción por fila: "Asignar viaje →"
              │      └─ abre TripAssignDialog con el equipo (y su conductor habitual) ya precargados
              ├─ split-button "+ Nuevo viaje ▾" → "Viaje individual" (TripAssignDialog en blanco) | "Importar CSV" (TripBulkUpload)
              └─ link "← Ver cuadratura de conductores" → cierra este modal, abre CloseDayDialog

  └─ Botón "Cerrar día"  (sin cambios de posición ni de lógica)
       └─ abre → CloseDayDialog (sin cambios en su lógica de cuadratura)
              ├─ [nuevo] link "Ver equipos disponibles →" → cierra este modal, abre Centro de Flota
              └─ [cambiado] fila MISMATCH: el link deja de ir a /dashboard/transportistas/empresa/{id}
                             y pasa a abrir TripSlideOver del viaje real que causó el descuadre
```

Por qué separado y no fusionado en un solo modal (Approach B, descartado): `CloseDayDialog` tiene lógica de bloqueo/override con consecuencias reales (no se puede cerrar el día con pendientes, el override requiere admin + justificación) — mezclar ahí una acción operativa de "quiero asignar un viaje ahora mismo" diluye el propósito de cada pantalla. Separadas pero cruzadas, cada una se entiende sola.

## Por qué "Agregar viaje" + "Carga masiva CSV" se agrupan (split-button)

Patrón estándar en SaaS operacional (Onfleet, Samsara Dispatch, y en general cualquier herramienta con creación individual + bulk del mismo objeto): la acción bulk nunca es un botón propio en la barra principal, va como opción secundaria del mismo control "+ Nuevo X". Acá aplica literal: `TripAssignDialog` crea 1 viaje, `TripBulkUpload` (vía `tripsApi.bulkCreate`) crea N viajes con el mismo payload — mismo objeto, distinta cardinalidad. Tener 2 botones sueltos para "crear lo mismo" obliga a decidir *dónde ir* antes de decidir *qué hacer*, exactamente la carga cognitiva que se está sacando.

## Modelo de datos — separación "nunca asignado" vs "liberado"

El dato ya existe en el backend: `available-assets`/`available-drivers` ya devuelven `trips_total` (0 si nunca tuvo viaje hoy, >0 si tuvo alguno y ya se cerraron todos). No hace falta ninguna columna ni migración nueva — es una clasificación derivada, calculada en el cliente al recibir la lista:

- `trips_total === 0` → tile "Nunca asignados hoy" (tono ámbar, alerta operativa)
- `trips_total > 0` → tile "Liberados tras viaje" (tono verde, operación normal)
- (no viene en la lista, porque `available-assets` ya excluye equipo con viaje abierto) → tile "En viaje hoy", requiere que el backend informe el tamaño total del roster activo para poder restar

## Backend — 2 cambios reales, ninguno rompe el contrato actual

`GET /trips/available-assets` **no lo consume nadie hoy** (verificado: no existe en `lib/api/trips.ts` ni en ningún componente) — se puede enriquecer sin riesgo de romper un consumidor existente:

1. **Response shape**: pasa de `list[dict]` a `{ total_active: int, items: list[dict] }`. `total_active` = tamaño del roster activo completo (mismo criterio que hoy usa `active_roster`, sin el filtro de disponibilidad) — es lo que permite calcular "En viaje hoy" = `total_active - len(items)` en el cliente, sin duplicar esa cuenta en 2 lugares.
2. **Conductor habitual para equipo con 0 viajes hoy**: hoy `driver_name` solo se llena si el equipo tuvo un viaje hoy (`tt.driver_name`, viene de `trip_fleet_links`/`fleet` del viaje). Un equipo con 0 viajes queda con `driver_name = NULL` — rompe la columna "Conductor habitual" del diseño para la mitad de los casos. Se agrega el mismo patrón que `available-drivers` ya usa con `standing_vehicle` (vía `public.vehicle_driver_assignments`), pero en la dirección inversa: un CTE `standing_driver` que, para cada `asset_id`, resuelve el conductor habitualmente asignado a ese equipo (`vehicle_driver_assignments.status = 'ACTIVE'`) cuando no hay dato del día. También se agregan `carrier_id`, `driver_id`, `driver_rut`, `driver_phone` (mismo patrón de subquery por `trip_fleet_links` que ya usa `available-drivers` para el teléfono) — son los campos que le faltan a la fila para poder prellenar `FleetAssignValue` completo al hacer "Asignar viaje".

`daily_closures.py` — `_DETAIL_SQL` suma una columna `trip_id`: el viaje (más reciente si hay más de uno) que causó el estado MISMATCH para ese conductor ese día. Solo se usa cuando `status = 'MISMATCH'`; no afecta ASSIGNED/UNASSIGNED. No cambia la lógica de cómputo de `_RECOMPUTE_SQL` ni el criterio de bloqueo de `close_day`.

## Frontend — piezas nuevas/modificadas

- **`FleetCenterDialog.tsx`** (nuevo, mismo patrón visual/estructural que `CloseDayDialog.tsx`): tiles clickeables (filtran client-side por `trips_total`), buscador, tabla (Patente/Empresa/Conductor habitual/Última actividad/Asignar), split-button de creación, link cruzado a `CloseDayDialog`.
- **`CloseDayDialog.tsx`**: nuevo prop `onOpenFleetCenter: () => void` (botón/link en el header). La celda de acción de una fila MISMATCH cambia de `<a href="/dashboard/transportistas/empresa/...">` a un botón que llama a un nuevo prop `onSelectTrip: (tripId: string) => void` cuando `d.trip_id` está presente (siempre debería estarlo si `status === 'MISMATCH'`); mantiene el link a Empresas como fallback si por algún motivo no viene.
- **`TripAssignDialog.tsx`**: nuevo prop opcional `initialFleet?: FleetAssignValue` — el `useEffect` de apertura usa `initialFleet ?? EMPTY_FLEET_ASSIGN_VALUE` en vez de siempre limpiar. Sin este prop, el diálogo se comporta exactamente igual que hoy (compatibilidad total con el flujo de "+ Nuevo viaje" en blanco).
- **`app/dashboard/diario/page.tsx`**:
  - Se retiran el pill "conductores disponibles" y el botón "Agregar viaje" de la barra de acciones; se retira también el botón suelto "Carga masiva (CSV)" (se muda dentro de `FleetCenterDialog`).
  - Nuevo botón único "🚛 Flota — N disponibles" (badge = `total_active - en_viaje` o directamente `items.length` de `available-assets`).
  - Nuevo estado `showFleetCenter`; orquestación entre `showCloseDay`/`showFleetCenter`/`showCreate`/`showBulkUpload` de forma que abrir uno cierra el anterior cuando la navegación es cruzada (ej. click en "Ver equipos disponibles" desde Cerrar el día cierra ese modal y abre Centro de Flota).
  - `onSelectTrip` de `CloseDayDialog` implementado con `tripsApi.get(tripId)` (ya existe, no se usa hoy en `page.tsx`) para poblar `selected` y abrir `TripSlideOver` — mismo patrón que ya usa `handleCreated`/`handleSaved`.
- **`lib/api/trips.ts`**: nuevo método `availableAssets(fecha)` apuntando a `/api/v1/trips/available-assets` con el response shape nuevo.
- **`lib/types.ts`**: nuevo tipo `AvailableAsset` (mismo espíritu que `AvailableDriver`, con los campos que suma el backend) y `AvailableAssetsResponse = { total_active: number; items: AvailableAsset[] }`; `DriverDayStatusRow` suma `trip_id: string | null`.

## Testing

- Backend: `available-assets` devuelve `total_active` correcto; un equipo con 0 viajes hoy trae `driver_id`/`driver_name` desde `vehicle_driver_assignments` cuando existe asignación activa, y `null` cuando no; `carrier_id`/`driver_phone` se completan igual que en `available-drivers`. `daily_closures` `_DETAIL_SQL` trae `trip_id` solo para filas MISMATCH, `null` para ASSIGNED/UNASSIGNED.
- Frontend: `FleetCenterDialog` — las 3 tiles filtran correctamente por `trips_total`, "Asignar viaje" pasa el `FleetAssignValue` completo a `TripAssignDialog`, split-button abre el diálogo correcto según la opción. `CloseDayDialog` — el link "Ver equipos disponibles" llama `onOpenFleetCenter`, una fila MISMATCH con `trip_id` llama `onSelectTrip` en vez de renderizar el link a Empresas. `TripAssignDialog` — con `initialFleet` el formulario abre con el equipo ya cargado (mismo estado visual que elegir un conductor a mano); sin el prop, se comporta igual que hoy (regresión).

## Riesgos aceptados

- Un equipo puede tener más de un viaje MISMATCH el mismo día (dos viajes distintos, ambos sin empresa resuelta) — `trip_id` en `_DETAIL_SQL` toma el más reciente. El operador ve y resuelve ese; si queda otro pendiente, la cuadratura lo va a seguir marcando MISMATCH y el link volverá a apuntar al viaje más reciente en el siguiente refresh. Aceptado — mismo criterio pragmático que ya usa el resto del proyecto (ej. clasificación de Tarifario por región más frecuente).
- La separación "nunca asignado" vs "liberado" es puramente por conteo de viajes de hoy — un equipo que salió y volvió muy rápido (falso "liberado") no se distingue de uno que trabajó todo el día. Aceptado, no se pidió esa granularidad.
