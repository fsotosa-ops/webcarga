# Taxonomía unificada de Estados y Motivos — diseño

**Fecha**: 2026-07-22
**Ronda**: 43 (auditoría post-Ronda 42, ítem 6 del feedback "Reportería según Figma")
**Relacionado**: HU-01/02/03 (cuadratura diaria), `EstadosOperacionalesTab` existente

## Contexto y cómo se llegó a este alcance

El ítem 6 del feedback (`monitor-app/docs/user-stories/20260720/refinamiento-weekly-20260720-v2.md`) pedía rehacer "Reportería" según 4 mockups de Figma. Al traerlos (`mockup-1..4.png`, capturas locales de un WebCarga legado — el MCP de Figma dio rate-limit) se encontró que en realidad describen un sistema de monitoreo en tiempo real con tiles clickeables + acciones rápidas por fila, y el usuario confirmó: *"lo principal es monitorear el estado del equipo pues es en base a eso es como gestionan los viajes del diario"*.

Se investigó el estado real de los datos: `app.driver_day_status` (Ronda 42, Fase 1) ya resuelve esto para **conductores**, pero no existe el equivalente para **equipos/tractos** — solo un `/available-assets` binario (disponible/no), sin motivo. El mockup 1 muestra exactamente ese motivo faltante (columna "Estado Equipo": En Pana/En Mantención/Trabajando/Sin Conducir).

El usuario pidió además que este vocabulario sea **configurable por operaciones** (crear/editar/eliminar), citando el patrón ya probado de `EstadosOperacionalesTab` en Configuración, y usando valores estándar de industria como semilla.

Durante el brainstorming se evaluó primero mantener 2 dominios nuevos separados (`EQUIPMENT_STATE`, `ALERT_TYPE`) además de los 2 existentes (`Estados TMS`, `Estados Operacionales`) — 4 pantallas de Configuración casi idénticas. El usuario señaló correctamente que eso repite el desorden que ya le molesta hoy entre "Estados TMS" y "Estados Operacionales", y preguntó por qué no aplicar acá el mismo criterio de estructura/escalabilidad que terminó funcionando bien en Empresas/Seguros (nota: la desconfianza registrada en rondas anteriores era hacia complejidad **especulativa** — modelar para casos hipotéticos —, no hacia estructura relacional en sí; acá hay 3-4 dominios reales y confirmados, no hipotéticos).

Se descartó además un dominio `ALERT_TYPE` separado: "Documentación vencida"/"Póliza vencida" ya son datos **calculados** (`compliance_records`, `insurance_alert`), no vocabulario manual — proponerlos como texto configurable habría duplicado un dato que el sistema ya sabe. La conexión real es que el vocabulario de motivos (`DRIVER_REASON`/`EQUIPMENT_STATE`) debe incluir opciones que reflejen esas causas (ej. "Documentación vencida" como motivo elegible), para que cuando aparece la alerta el coordinador tenga qué elegir — sin duplicar el dato ni crear un dominio nuevo.

## Alcance

**Adentro:**
- Tabla unificada `app.status_taxonomies` con 3 dominios: `OPERATIONAL_STATE` (existente, viaje — migra `app.operational_states`), `DRIVER_REASON` (existente, conductor sin asignar — migra `app.unassigned_reasons`), `EQUIPMENT_STATE` (nuevo, equipo/tracto sin asignar).
- Backend genérico: un router de CRUD parametrizado por `domain`, reemplaza los endpoints específicos de `operational_states`.
- Frontend genérico: un componente `TaxonomyTab({ domain, title, hint })` reemplaza el cuerpo de `EstadosOperacionalesTab`, reusado tal cual para el tab nuevo "Estados de Equipo". `Estados Operacionales` pasa a ser `<TaxonomyTab domain="OPERATIONAL_STATE" .../>` sin cambio visible para el usuario.
- Migración de datos: `operational_states` y `unassigned_reasons` se vuelcan a `status_taxonomies` preservando todas las filas reales, con las FK existentes (`driver_day_status.unassigned_reason_id`, y las que referencien `operational_states`) actualizadas al nuevo `id`.
- Semillas nuevas de `EQUIPMENT_STATE` (estándar de industria fleet/TMS, editable después): Disponible, En Mantención, En Pana / Fuera de Servicio, Prestado a otra empresa, Sin Conductor Asignado, Descanso Programado.
- Semillas ampliadas de `DRIVER_REASON`: se agregan las variantes documentales (ej. "Documentación vencida", "Licencia vencida") a las 6 ya existentes (Pana, Mantención, Sin conductor, No se presentó, Médico, En abstención) — nota: "Pana"/"Mantención" hoy viven en `unassigned_reasons` (motivo de **conductor**) aunque describen causas de **equipo**; quedan tal cual en `DRIVER_REASON` para no romper datos históricos, y las nuevas semillas equivalentes de `EQUIPMENT_STATE` son las que se usarán de acá en adelante para el caso de equipo.
- **Sugerencia de motivo a partir de una alerta ya calculada** (sumado durante la revisión del spec) — cuando un conductor tiene documentación vencida (`driver_pending_docs_critical`), `CloseDayDialog.tsx` sugiere el motivo "Documentación vencida" en vez de dejarlo en blanco. Es una **sugerencia de UI, no un trigger de base de datos** — no le pisa la decisión al operador, la pre-carga y él confirma o cambia. Detalle:
  - `status_taxonomies` gana una columna `suggested_alert_source text` nullable (ej. `'compliance_expired'`) — solo se puebla en la fila "Documentación vencida" de `DRIVER_REASON`/`EQUIPMENT_STATE`, `NULL` en el resto. Es una correlación fija sobre un seed conocido, no un mapeo de texto libre.
  - `_DETAIL_SQL` (`daily_closures.py`) suma `driver_pending_docs_critical` — mismo criterio que ya usa `trips.py` (`_compliance_alert_lateral`), no hay que inventar la consulta, solo reusarla acá.
  - En `CloseDayDialog.tsx`, la fila de un conductor con `unassigned_reason_id IS NULL` y `driver_pending_docs_critical = true` muestra un hint clickeable ("Sugerido: Documentación vencida") junto al `<select>` — al clickear, llama a `handleSetReason` con el id correspondiente (mismo flujo de guardado que ya existe, ninguna escritura nueva).

**Afuera (explícitamente, para otro spec):**
- **Estado diario del equipo** — la tabla `app.equipment_day_status` (equivalente de `driver_day_status` pero para tractos) que efectivamente *usa* el dominio `EQUIPMENT_STATE` para registrar por qué un equipo activo no tiene viaje hoy. Este spec solo deja lista la taxonomía; asignarla a un equipo específico un día específico es el siguiente spec. La sugerencia de motivo por alerta (arriba) se implementa primero solo para conductor (`driver_day_status`, ya existe) — para equipo aplica el mismo criterio en el spec de `equipment_day_status`, reusando `suggested_alert_source`.
- Cualquier UI de monitoreo con tiles/shortcuts (Diario, Reportería, RECURSOS-style). Depende de que exista `equipment_day_status` primero.
- Que el estado de equipo bloquee "Cerrar el día" — decisión ya tomada: no, por ahora es informativo (ver conversación de esta ronda, razonamiento de industria + lo que dijo Pablo en el transcript sobre que el conductor es "el que manda").
- Los 3 formatos fijos de Reportería por cliente (Sider Botelleros/Sodimac/Walmart-Spot) — dependen de que exista `equipment_day_status`, quedan para specs posteriores.

## Modelo de datos

```sql
CREATE TABLE app.status_taxonomies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text NOT NULL CHECK (domain IN ('OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE')),
  label       text NOT NULL,
  bg_color    text NOT NULL,
  text_color  text NOT NULL,
  -- Solo tiene sentido para OPERATIONAL_STATE (a qué columna del tablero
  -- pertenece un viaje con este estado) — NULL en los otros 2 dominios.
  group_id    text,
  -- Correlación fija con una alerta ya calculada (compliance_records,
  -- insurance_alert) para sugerir este motivo en la UI de cuadratura —
  -- NULL en casi todas las filas, solo poblado en semillas conocidas como
  -- "Documentación vencida". No es un mapeo de texto libre ni un trigger.
  suggested_alert_source text,
  sort_order  integer NOT NULL DEFAULT 99,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_taxonomies_domain ON app.status_taxonomies (domain, sort_order) WHERE active;
```

**Por qué una tabla y no 3**: los 3 dominios comparten exactamente la misma forma (label/color/orden/activo) y el mismo ciclo de vida (CRUD manual por operaciones) — es la definición de un caso ya probado 2 veces (`operational_states` hoy, `unassigned_reasons` hoy) que se repite una 3ra vez de forma idéntica. `group_id` es el único campo específico de un dominio; se deja nullable en vez de crear una tabla de extensión aparte porque es un solo campo, no una familia de atributos específicos por dominio que vaya a crecer.

**Por qué NO se incluye `Estados TMS`** (`app.trip_statuses`): su ciclo de vida es fundamentalmente distinto — las filas las crea el TMS al reportar un estado nuevo, no un operador con un botón "+ Nuevo"; el editable ahí es solo color/columna, nunca el label ni si existe la fila. Mezclarlo sería repetir el mismo error de dominios que el usuario señaló entre Estados TMS/Operacionales hoy.

### Migración de datos existentes

```sql
-- 1. Vuelca operational_states (uuid → uuid, mismo id, no rompe nada que lo referencie)
INSERT INTO app.status_taxonomies (id, domain, label, bg_color, text_color, group_id, sort_order, active, created_at, updated_at)
SELECT id, 'OPERATIONAL_STATE', label, bg_color, text_color, group_id, sort_order, active, created_at, updated_at
FROM app.operational_states;

-- 2. Vuelca unassigned_reasons (id text → nuevo id uuid; requiere mapeo)
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active)
SELECT 'DRIVER_REASON', label, '#f3f4f6', '#374151', sort_order, active
FROM app.unassigned_reasons
RETURNING id, label;
-- (el mapeo label→nuevo id se usa para reescribir driver_day_status.unassigned_reason_id)

-- 3. driver_day_status.unassigned_reason_id cambia de text a uuid, con FK a status_taxonomies
-- 4. app.trips.unassigned_reason_id / app.trips_manual.unassigned_reason_id — mismo tratamiento
-- 5. Tablas viejas (operational_states, unassigned_reasons) se retiran DESPUÉS de confirmar
--    que todo consumidor real (daily_closures.py, trips.py, config.py, frontend) quedó
--    apuntando a status_taxonomies — no en el mismo commit que la creación.
```

Esta migración toca datos reales de producción (motivos ya asignados a conductores en cuadraturas pasadas) — se ejecuta con confirmación explícita del usuario antes de aplicar, verificando conteos antes/después (mismo criterio que otras migraciones de este proyecto).

**Inventario verificado de todo lo que referencia las 2 tablas viejas** (grep real contra `monitor-app/backend/api/app` y `monitor-app/backend/supabase/migrations/*.sql`, no una lista supuesta — esto es lo que el plan de implementación debe migrar/reapuntar, sin nada más suelto):

FK reales (las 3 son `unassigned_reason_id text REFERENCES app.unassigned_reasons(id)` — ninguna tabla tiene FK real contra `operational_states`, solo se lee):
- `app.trips.unassigned_reason_id` (migración `20260717211500`)
- `app.trips_manual.unassigned_reason_id` (misma migración)
- `app.driver_day_status.unassigned_reason_id` (migración `20260721020000`)

Lectura sin FK (hay que reapuntar el `SELECT`, no una constraint):
- `trips.py::GET /trips/meta` — expone `operational_states` y `unassigned_reasons` activos al frontend (línea ~713 y ~733).
- `daily_closures.py` — `LEFT JOIN app.unassigned_reasons` para el label (`_DETAIL_SQL`/`_REPORT_SQL`).
- `config.py` — el router CRUD viejo de `operational_states` (se retira, ver sección Backend).

**Buena noticia encontrada al verificar**: `app.trips.manual_status`/`app.trips_manual.manual_status` (el estado manual que un operador setea sobre un viaje) **no es una FK** — es una columna de texto libre que guarda el label directamente (`ALTER TABLE ... RENAME COLUMN estado_manual TO manual_status`, migración `20260717220000`), no un `id` de `operational_states`. Mientras los labels no cambien de texto durante la migración, `manual_status` no necesita ningún remapeo — un riesgo menos del que había que cuidarse.

## Backend

Un router `app/routers/status_taxonomies.py`:

```
GET    /config/taxonomies?domain=EQUIPMENT_STATE       → lista, ordenada por sort_order
POST   /config/taxonomies                              → crea (domain + label + colores)
PATCH  /config/taxonomies/{id}                          → edita label/color/sort_order/group_id
DELETE /config/taxonomies/{id}                          → desactiva (active=false), no DELETE real
```

Reemplaza `list_operational_states`/`create_operational_state`/`patch_operational_state`/`deactivate_operational_state` en `config.py` (que quedan como thin wrappers o se retiran, a decidir en el plan de implementación). `GET /trips/meta` (que hoy expone `unassigned_reasons` para el frontend) pasa a leer de `status_taxonomies WHERE domain='DRIVER_REASON'`.

## Frontend

`app/dashboard/admin/configuracion/estados-tabs.tsx`: `EstadosOperacionalesTab` se reescribe como:

```tsx
export function TaxonomyTab({ domain, title, hint }: { domain: TaxonomyDomain; title: string; hint: string }) {
  // mismo cuerpo que EstadosOperacionalesTab hoy, parametrizado por domain
}

export const EstadosOperacionalesTab = () =>
  <TaxonomyTab domain="OPERATIONAL_STATE" title="Estados Operacionales" hint="..." />
```

Nuevo tab en Configuración: **"Estados de Equipo"** → `<TaxonomyTab domain="EQUIPMENT_STATE" .../>`. Sin UI nueva que diseñar — reusa `SwatchPicker`/`SortArrows`/`SaveRowButton`/`useConfigList` de `shared.tsx` tal cual.

`DRIVER_REASON` no gana un tab de Configuración en este spec (el flujo de motivo de conductor ya vive dentro de la cuadratura, no en Configuración) — solo cambia de dónde lee sus valores (`status_taxonomies` en vez de `unassigned_reasons`), sin cambio de UX salvo el hint de sugerencia descrito abajo.

**`CloseDayDialog.tsx`** — sugerencia de motivo: la fila de un conductor con `unassigned_reason_id` vacío y `driver_pending_docs_critical = true` (dato nuevo en `_DETAIL_SQL`) muestra, junto al `<select>` de motivo (línea ~173), un hint clickeable con el label de la fila `status_taxonomies` cuyo `suggested_alert_source = 'compliance_expired'`. Clickear el hint llama a `handleSetReason(driver_id, suggestedId)` — mismo flujo de guardado ya existente, sin escritura nueva ni trigger de base de datos. El operador puede ignorar el hint y elegir otro motivo del `<select>` normalmente.

## Verificación

- Backend: tests nuevos para el router genérico (CRUD por dominio, filtro `?domain=`) + tests de migración (conteos antes/después, ninguna fila de `operational_states`/`unassigned_reasons` se pierde).
- Frontend: `TaxonomyTab.test.tsx` reemplaza `estados-tabs.test.tsx` para el caso `OPERATIONAL_STATE` (mismo comportamiento, ya cubierto) + casos nuevos para `EQUIPMENT_STATE`.
- Manual: confirmar en `/dashboard/admin/configuracion` que "Estados Operacionales" se ve y funciona idéntico a antes (regresión visual), y que "Estados de Equipo" es un tab nuevo funcional con las 6 semillas.
- `CloseDayDialog.test.tsx`: caso nuevo — conductor con `driver_pending_docs_critical=true` y sin motivo muestra el hint sugerido; clickearlo llama a `handleSetReason` con el id correcto; un conductor sin esa alerta no muestra ningún hint.
- Confirmar con el usuario, antes de aplicar la migración a producción, que los conteos de `unassigned_reason_id` ya asignados en `driver_day_status`/`trips` histórico coinciden 1:1 después del remapeo de ids.
