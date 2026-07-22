# Ajustes post weekly 20260720 (v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver los 7 ítems del feedback post-weekly que tienen alcance cerrado (ver spec `docs/superpowers/specs/2026-07-22-post-weekly-refinamiento-v2-design.md`) — bugs confirmados, gaps de UX, y la consolidación del flujo de conductores disponibles.

**Architecture:** Sin cambios de infraestructura. Fase A son fixes puntuales de manejo de errores/UX (frontend). Fase B es la consolidación de la cadena de resolución driver/tracto/carrier en una vista SQL compartida, usada por 4 lugares que hoy la duplican. Fase C es el rediseño de `TarifarioPage` para absorber Locales.

**Tech Stack:** FastAPI + asyncpg (backend), Next.js 16 / React + Vitest + Testing Library (frontend), Supabase Postgres.

## Global Constraints

- El Ítem 1b (subida de documentos) NO está en este plan — bloqueado en una pregunta al usuario (rol de los afectados). No adivinar la respuesta.
- El Ítem 6 (Reportería según Figma) NO está en este plan — es su propio brainstorming, tamaño de cambio distinto.
- `cd monitor-app/backend/api && venv/bin/python -m pytest -q` y `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run` limpios al final de cada tarea.
- Supabase project ID: `viclzoftiudkepqnhekv`.
- El enum interno `DriverDayStatusValue.MISMATCH` no cambia en la Tarea 5 — solo el label visible ("Equipo OVNI"), mismo criterio ya aplicado al rename anterior de "Mismatch" → "Por regularizar" (Ronda 38).

---

## Fase A — Fixes puntuales (bugs + UX, sin dependencias entre sí)

### Tarea 1: Ítem 1a — manejo de errores en crear póliza

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/InsurancePolicyModal.tsx`
- Test: `monitor-app/frontend/components/dashboard/InsurancePolicyModal.test.tsx`

**Root cause**: `handleAddPolicy` (línea ~322) no tiene `try/catch` — a diferencia de `handleGenerateSchedule` (línea ~303, mismo archivo), que sí lo tiene con `scheduleErr`/`setScheduleErr`.

- [ ] **Paso 1**: agregar test que falle primero — mockear `carriersApi.createPolicy` para que rechace, confirmar que aparece un mensaje de error visible y que el modal no se cierra:
```tsx
it('shows an error and keeps the form open when creating a policy fails', async () => {
  vi.mocked(carriersApi.createPolicy).mockRejectedValue(new Error('Ya existe una póliza con ese número'))
  render(<InsurancePolicyModal carrierId="c1" displayName="Test" onClose={vi.fn()} canAdmin canEdit />)
  fireEvent.click(screen.getByText(/Agregar póliza|Nueva póliza/))
  fireEvent.change(screen.getByLabelText(/Compañía/i), { target: { value: 'HDI' } })
  fireEvent.click(screen.getByText(/Guardar|Crear/))
  expect(await screen.findByText('Ya existe una póliza con ese número')).toBeInTheDocument()
})
```
(Ajustar los selectores exactos de texto/label al leer el archivo real — el componente no se leyó línea por línea en esta sesión, solo la función `handleAddPolicy`.)
- [ ] **Paso 2**: correr el test, confirmar que falla.
- [ ] **Paso 3**: agregar `const [addPolicyErr, setAddPolicyErr] = useState<string | null>(null)` junto a `addingPolicy`, envolver el cuerpo de `handleAddPolicy` en `try { ... } catch (e) { setAddPolicyErr(e instanceof Error ? e.message : 'Error al crear la póliza') } finally { setAddingPolicy(false) }`, limpiar `addPolicyErr` al abrir el form de nuevo (mismo punto donde se limpia `policyForm`), y renderizar `{addPolicyErr && <p className="text-xs text-red-500">{addPolicyErr}</p>}` cerca del botón de submit (mismo lugar que `scheduleErr` en la sección de cuotas).
- [ ] **Paso 4**: correr el test, confirmar que pasa. Correr toda la suite de frontend.
- [ ] **Paso 5**: commit — `fix(seguros): crear póliza falla silenciosamente sin mostrar error`.

### Tarea 2: Ítem 2 — etiquetar badges de compliance por entidad

**Files:**
- Modify: `monitor-app/frontend/components/ui/PendingDocsBadge.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TripSlideOver.tsx`
- Test: los tests existentes de estos 3 archivos ya cubren la presencia del badge — agregar aserciones de que el label de entidad es visible.

**Root cause**: `PendingDocsBadge` ya recibe una prop `label` (`"Empresa"`/`"Conductor"`/`"Tracto"`, ver `title={label ? ... : ...}`) pero solo se usa en el `title` (tooltip on-hover, no visible sin interacción) — no en el texto renderizado. En `TripTable.tsx` el badge compacto (solo el número) no lleva `label` en absoluto.

- [ ] **Paso 1**: en `PendingDocsBadge.tsx`, cuando `label` está presente y `compact` es `false`, incluir el label en el texto visible (ej. `"{label}: {count} pendiente(s)"` en vez de solo `"{count} pendiente(s)"`). Para la variante `compact` (usada en `TripTable.tsx`), agregar el `label` como prefijo corto o como texto adyacente visible (no solo `title`) — un badge de 1-2 caracteres (ej. "C"/"T"/"E" para Conductor/Tracto/Empresa) al lado del número es suficiente para no perder la compacidad de la fila.
- [ ] **Paso 2**: en `TripTable.tsx`, pasar `label="Conductor"`/`label="Tracto"`/`label="Empresa"` a cada `<PendingDocsBadge>` (hoy no se pasa `label` en las 3 invocaciones de la tabla — verificado, ver Ronda 40).
- [ ] **Paso 3**: actualizar los tests existentes (`TripTable.test.tsx`, `TripSlideOver.test.tsx`) para verificar que el texto visible (no solo el `title`) identifica la entidad.
- [ ] **Paso 4**: `tsc`/`vitest` limpios.
- [ ] **Paso 5**: commit — `fix(diario): badges de documentación identifican a qué entidad corresponden`.

### Tarea 3: Ítem 3 — indicador de scroll en columnas fijas del Diario

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/TripTable.tsx`

- [ ] **Paso 1**: agregar una sombra/gradiente sutil en los bordes de la tabla con scroll horizontal (`overflow-x-auto`) que indique visualmente que hay más columnas — patrón estándar: dos `<div>` absolutos con `bg-gradient-to-r`/`bg-gradient-to-l` en los bordes izquierdo/derecho del contenedor scrolleable, visibles solo cuando `scrollLeft > 0` / `scrollLeft < scrollWidth - clientWidth` (requiere un listener de scroll con `useState`/`useEffect` sobre el contenedor, o una librería CSS-only con `background-attachment: local` si se prefiere sin JS).
- [ ] **Paso 2**: verificar visualmente (no hay test automatizado sensato para un efecto de scroll — dejar sin test, consistente con que esto no es lógica de negocio).
- [ ] **Paso 3**: `tsc` limpio.
- [ ] **Paso 4**: commit — `fix(diario): indicador de scroll para columnas fijas`.

### Tarea 4: Ítem 4 — "Revisar en Empresas" como link real

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/CloseDayDialog.tsx`
- Test: `monitor-app/frontend/components/dashboard/CloseDayDialog.test.tsx`

**Root cause**: línea con `<span>...Revisar en Empresas</span>` (texto estático) en la fila con `status === 'MISMATCH'`.

- [ ] **Paso 1**: verificar si `DriverDayStatusRow` (tipo en `lib/types.ts`) expone `carrier_id` — si no, es necesario agregarlo al backend (`_DETAIL_SQL` en `daily_closures.py`) y al tipo frontend antes de poder armar el link. Confirmar contra el archivo real antes de asumir.
- [ ] **Paso 2**: reemplazar el `<span>` por `<a href={`/dashboard/transportistas/empresa/${d.carrier_id}`} className="text-[11px] text-red-500 flex items-center gap-1 hover:underline"><AlertTriangle size={11} /> Revisar en Empresas</a>` — si `carrier_id` no está disponible para ese conductor (caso MISMATCH sin empresa resuelta), fallback a un link genérico a `/dashboard/transportistas`.
- [ ] **Paso 3**: test — confirmar que el link tiene el `href` correcto para una fila MISMATCH con `carrier_id` conocido.
- [ ] **Paso 4**: `tsc`/`vitest` limpios.
- [ ] **Paso 5**: commit — `fix(diario): "Revisar en Empresas" en Cerrar el día es un link real`.

---

## Fase B — Ítem 5: flujo de conductores disponibles (alcance aprobado)

### Tarea 5: consolidar la cadena de resolución en una vista compartida

**Files:**
- Create: migración `monitor-app/backend/supabase/migrations/20260722030000_fleet_resolution_view.sql`
- Modify: `monitor-app/backend/api/app/routers/trips.py` (`_TRIP_FROM`, `available_drivers`, `available_assets`)
- Modify: `monitor-app/backend/api/app/routers/daily_closures.py` (`_RECOMPUTE_SQL`)
- Test: `monitor-app/backend/api/tests/test_trip_fleet_links.py`, `test_daily_closures.py`, nuevo `test_fleet_resolution.py`

**Diseño de la vista**: `app.v_trip_fleet_resolution` — una fila por `trip_id`, con `resolved_carrier_id`, `resolved_driver_id`, `resolved_tractor_asset_id`, replicando exactamente la cadena hoy duplicada en 4 lugares (stored `trip_fleet_links` → auto por patente contra `asset_assignments` → auto por `vehicle_driver_assignments` → match exacto de nombre contra `public.drivers.full_name`, este último nivel es el que agregó Ronda 38 a `daily_closures.py` pero `available_drivers`/`_TRIP_FROM` no tienen).

- [ ] **Paso 1**: escribir la vista SQL, dry-run contra Supabase (`BEGIN; ...; ROLLBACK;`) comparando su resultado fila por fila contra lo que hoy calcula `daily_closures.py`'s `day_trips` para `planning_date = '2026-07-21'` (17 ASIGNADOS ya confirmados en Ronda 38) — deben coincidir exactamente antes de aplicar.
- [ ] **Paso 2**: aplicar la migración.
- [ ] **Paso 3**: reemplazar la cadena inline en `_TRIP_FROM` (trips.py) por un `LEFT JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id` + ajustar todas las referencias a `COALESCE(fl.driver_id, d_auto.id)` etc. por `vfr.resolved_driver_id` (y análogos para carrier/tractor) — cuidado: varios `LEFT JOIN LATERAL` (insurance_alert, compliance) referencian estos `COALESCE(...)` directamente, deben actualizarse todos.
- [ ] **Paso 4**: reemplazar `today_trips` en `available_drivers`/`available_assets` para usar la vista en vez de `fl.driver_id IS NOT NULL` a secas.
- [ ] **Paso 5**: reemplazar `day_trips` en `daily_closures.py`'s `_RECOMPUTE_SQL` para usar la vista (elimina la duplicación que causó el bug de Ronda 38).
- [ ] **Paso 6**: correr toda la suite de tests backend — los tests existentes que buscan strings SQL específicos (`test_recompute_sql_uses_full_live_resolution_chain`, `test_trip_from_joins_driver_home_carrier_for_mismatch_detection`, etc.) van a necesitar reescribirse para verificar contra la vista en vez del SQL inline — mantener la intención de cada test (qué garantiza), no solo el string literal.
- [ ] **Paso 7**: verificar contra datos reales — `available_drivers?fecha=2026-07-21` antes/después del cambio, confirmar que el conductor con viaje resuelto en vivo (confirmado en la investigación de esta sesión) ya no aparece como disponible.
- [ ] **Paso 8**: commit — `refactor(trips): consolida la cadena de resolución driver/tracto/carrier en app.v_trip_fleet_resolution`.

### Tarea 6: adoptar "Equipo OVNI" como término visible

**Files:**
- Modify: donde viva el label de `UNMATCHED` visible al usuario (buscar `fleet_match_status`/`UNMATCHED` en el frontend — no confundir con `MISMATCH`/"Por regularizar", que es un caso distinto: UNMATCHED es sin ningún cruce, MISMATCH es conductor y tracto cruzando cada uno por su lado pero bajo empresas distintas).
- Test: los que ya cubren el label actual.

- [ ] **Paso 1**: ubicar todos los puntos donde `UNMATCHED` se muestra al usuario (filtro `?fleet_match=unmatched` en el Diario, cualquier badge/banner asociado).
- [ ] **Paso 2**: cambiar el label visible a "Equipo OVNI" donde corresponda al caso específico que describe Pablo (tracto o conductor sin ningún cruce contra empresa) — el enum interno `UNMATCHED` no cambia.
- [ ] **Paso 3**: actualizar tests de label.
- [ ] **Paso 4**: commit — `feat(diario): adopta "Equipo OVNI" (nomenclatura real de Pablo) para fleet_match_status=UNMATCHED`.

---

## Fase C — Ítems 7 y 8: Tarifario tipo SaaS + retiro de Locales

### Tarea 7: rediseñar TarifarioPage

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/tarifario/page.tsx`
- Test: `monitor-app/frontend/app/dashboard/tarifario/page.test.tsx`

- [ ] **Paso 1**: antes de decidir paginación de servidor vs. solo mejora visual, verificar contra Supabase cuántos locales tiene el generador de carga con más volumen (`SELECT entity_id, count(*) FROM public.locations GROUP BY entity_id ORDER BY count(*) DESC LIMIT 5`) — si el máximo real es de decenas, no cientos, no se justifica paginación de servidor nueva en `GET /locations`.
- [ ] **Paso 2**: mover el botón de creación (`<LocationCreateForm>`) al header de la página, junto al selector de generador de carga — mismo patrón que el header de acciones del Diario.
- [ ] **Paso 3**: agregar un input de búsqueda (usa el `?q=` que `GET /locations` ya soporta) conectado al `fetcher` existente.
- [ ] **Paso 4**: pulir la tabla (densidad, header sticky, hover en filas) para acercarla visualmente a `TripTable.tsx` — sin necesidad de replicar el layout mobile-card de Diario, dado que Tarifario es una herramienta interna de facturación, no operativa en terreno.
- [ ] **Paso 5**: tests de que la búsqueda filtra y que el botón de creación está en el header, no al final.
- [ ] **Paso 6**: `tsc`/`vitest`/`build` limpios.
- [ ] **Paso 7**: commit — `feat(tarifario): rediseño de UI — filtro, paginación si corresponde, acción primaria en el header`.

### Tarea 8: absorber campos de Locales en Tarifario, retirar la pestaña de Configuración

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/tarifario/page.tsx` (agregar columnas format/address/region/operation_type/activo, editables — mismo patrón que `locales-tab.tsx`)
- Modify: `monitor-app/frontend/app/dashboard/admin/configuracion/*.tsx` (retirar el tab "Locales" del listado de tabs de Configuración)
- Delete: `monitor-app/frontend/app/dashboard/admin/configuracion/locales-tab.tsx`
- Test: mover cualquier test relevante de `locales-tab` (no existe hoy, confirmado en Fase 4/5) — no hay que migrar tests, solo confirmar que `TarifarioPage` cubre el comportamiento.

**Depende de la Tarea 7** (no tiene sentido agregar más columnas antes del rediseño de layout).

- [ ] **Paso 1**: agregar a `TarifarioPage` los campos editables que hoy solo están en `locales-tab.tsx`: Formato, Dirección, Región, Clasificación (`OPERATION_TYPE_OPTIONS`, ya duplicado en `LocationCreateForm.tsx` — reusar la misma constante o el mismo patrón de duplicación deliberada documentado en Fase 5), Activo/Inactivo (`toggleActive`, mismo patrón que `locales-tab.tsx`).
- [ ] **Paso 2**: verificar que la funcionalidad de `?incomplete=true` (banner + filtro "Solo sin clasificar", HU-16) también se traslada — hoy vive en `locales-tab.tsx`, no en `TarifarioPage`.
- [ ] **Paso 3**: retirar el tab "Locales" de la navegación de Configuración y borrar `locales-tab.tsx`.
- [ ] **Paso 4**: `tsc`/`vitest`/`build` limpios — confirmar que no queda ningún import roto a `locales-tab.tsx`.
- [ ] **Paso 5**: commit — `refactor(tarifario): absorbe la gestión completa de locales, retira la pestaña de Configuración`.

---

## Verificación final

- [ ] Suite completa backend (`pytest -q`) y frontend (`tsc --noEmit && vitest run`) limpias.
- [ ] `npm run build` limpio.
- [ ] Actualizar `AGENTLOG.md` (archivar el checkpoint anterior, dejar activo el de este plan) — por regla de `CLAUDE.md`.
