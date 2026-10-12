# Directorio · D1 "Una sola respuesta": estados, habilitación y flota con una sola definición

**Estado:** diseño aprobado por secciones en el brainstorming del 12/10; spec en revisión del usuario.

**Origen:**
- Auditoría del Directorio, `docs/superpowers/plans/2026-10-12-directory-audit-findings.md`: §5, fila D1; §7, decisiones.
- Auditoría de estados, `docs/superpowers/plans/2026-10-12-states-audit.md`.
- Bloque 0 desplegado en dev (`975f52d0..1990490f`).

Ataca F-02, F-03, F-06, F-07, F-08 y los conflictos 1-14 de la auditoría de estados.

---

## 1. Objetivo y criterio de éxito

Cada pregunta tiene **una** respuesta, calculada en **un** lugar, con **un** nombre:
- ¿está activa?
- ¿de qué empresa es?
- ¿en qué estado está este documento?
- ¿cómo está esta empresa con sus documentos?
- ¿puede operar?

Todas las pantallas la leen; ninguna la recalcula.

Medible en dev al cerrar:
- Las 215 empresas no activas dejan de verse en rojo.
- Las 36 activas dicen **Habilitada** o **No habilitada** según sus obligatorios (hoy las 251 figuran "pendientes").
- La flota de una empresa cuenta solo lo activo: 78 conductores, no 84.
- El embudo de Certificación cuenta 2.226 y no 2.306.
- Para toda empresa, las cifras Vencidos / Por vencer / Faltan valen lo mismo en Directorio, vista rápida, Certificación y
  Pendientes (test de equivalencia).
- Ningún componente del frontend escribe a mano una etiqueta de estado, ni calcula un estado documental (test de guarda).
- La API rechaza asignar un viaje a una empresa no activa, o a un conductor o tracto dado de baja.
- Un RUT con puntos o una patente con guion encuentra lo mismo en todos los buscadores, Sin clasificar y Pendientes.

## 2. Decisiones que lo condicionan (usuario, 12/10)

| # | Decisión |
|---|---|
| E-a | Enfoque: los **hechos de la flota** (pertenencia, flota activa, tipos de operación) viven en la base. La **regla documental** vive en un solo módulo de la API (`services/fleet_compliance.py`), sobre `document_state_sql` e `in_scope_sql`, con una sola interfaz. Si la escala lo pide, la interfaz pasa a leer una proyección materializada sin cambiar a quien la llama. |
| E-b | **Tres capas de estado, sin mezclarlas:** ciclo de vida (dato), estado del documento (calculado por las reglas de Configuración) y resumen de quien debe los documentos (el peor estado de sus obligatorios). |
| E-c | **P13:** una empresa está al día cuando lo están sus documentos y los de su flota activa en alcance. "Por vencer" cuenta como al día. |
| E-d | Tener vencidos **no** da de baja: la empresa sigue activa y queda **No habilitada** hasta regularizar. Habilitada / No habilitada se calcula; no es un estado guardado. |
| E-e | **"Crítico"** es un aviso calculado (días que faltan y umbral), no un estado. Se retiran de Configuración los umbrales por documento que nadie lee. |
| E-f | **Reactivar = recalificar:** quien vuelve, vuelve con sus pendientes. El flujo de elegir la flota al reactivar (P3) es D2. |
| E-g | **P8:** el tipo de operación sale del tracto. Medido: es equivalente a clasificar por empresa, y el cliente × origen no lo decide. La clasificación del Cierre no cambia. |
| E-h | **Nombres (P16, P20):** "Directorio", "Sin clasificar", "Habilitada / No habilitada". Ciclo de vida: Activa · En onboarding · Dada de baja. |
| E-i | **Tipo de operación declarado:** un solo lugar de edición, la ficha del Directorio, con permiso para Certificación. Lo observado (tractos) manda y lo declarado cubre el hueco. Mover el formulario es D4. |
| E-j | **P10:** los clientes de una empresa se declaran y los viajes proponen. Las relaciones con vigencia (asignaciones y clientes) son D2. |

## 3. El glosario (fuente única de la nomenclatura)

Lo usan Directorio, Certificación (portada, ficha, Pendientes, Sin clasificar, Configuración), Monitor y Cierre. En código
vive en un archivo por lado (§6.4). Ninguna otra palabra describe estos conceptos.

| Capa | Valores (código) | En pantalla | Lo define | Dónde se calcula |
|---|---|---|---|---|
| Ciclo de vida de la entidad | Empresa: `ACTIVE`, `ONBOARDING`, `INACTIVE`, `LEGACY_INACTIVE`. Conductor y equipo: `ACTIVE`, `INACTIVE` | Activa / Activo · En onboarding · Dada de baja / Dado de baja (INACTIVE y LEGACY_INACTIVE se muestran igual) | Una persona | Columna `operational_status` (dato) |
| Estado del documento | `UP_TO_DATE`, `EXPIRING`, `OVERDUE`, `MISSING`, `NOT_REQUIRED` | Al día · Por vencer · Vencido · Falta · Aún no se exige | Las reglas de Configuración (exigibilidad, vigencia, días de aviso) | `document_state_sql` (existe) |
| Aviso del documento | `warning`, `critical` (o ninguno) más los días que faltan | Banners, orden y énfasis; no es un chip de estado | Umbrales globales de Configuración › Alertas más la excepción por regla | `fleet_compliance.py` |
| Resumen de quien debe los documentos | El peor `document_state` entre sus obligatorios exigibles en alcance, con las cifras overdue / expiring / missing (propias y de la flota) | Mismas palabras que el documento, más las cifras | Calculado | `fleet_compliance.py` (misma base que Pendientes) |
| Habilitación | `can_operate` (boolean) | Habilitada · No habilitada (en gris si no está activa) | Calculado: `operational_status = 'ACTIVE'` y el resumen de obligatorios no es `OVERDUE` ni `MISSING` | `fleet_compliance.py` |
| Historial del archivo | `compliance_records.status` guardado (hoy solo `MISSING` / `APPROVED_MANUAL`) | "Cargado por X el dd/mm" en el historial; nunca como estado | Quien sube o aprueba | Columna (dato) |
| Tipos de operación de la empresa | `TRACTOREO`, `EQUIPO_COMPLETO` | Tractoreo · Equipo Completo | Lo observado en los tractos activos y, en su defecto, lo declarado | `public.carrier_management_types()` |

Reglas del resumen:
- **Peor estado:** el orden de severidad es `OVERDUE` > `MISSING` > `EXPIRING` > `UP_TO_DATE`. `NOT_REQUIRED` no participa.
- **Qué bloquea la habilitación:** solo los requisitos `LEGAL_MANDATORY`. Las cifras cuentan todo lo que Pendientes
  mostraría para esa empresa, incluidos los 4 opcionales.
- **REJECTED** sigue la decisión abierta de `pendiente_predicate` (issue #11, 0 filas): queda fuera, y se cambia en una línea.
- **Empresa no activa:** su resumen se calcula igual (historial, P1). La pantalla lo muestra en gris y no lo cuenta como
  "No habilitada" en las colas.

## 4. Hechos de la flota, en la base (una migración re-ejecutable)

Siguen el patrón de `app.is_trip_open` / `app.is_trip_assigned` (`20261012090000_trip_assignment_in_the_database.sql`):
`CREATE OR REPLACE`, un `COMMENT ON` que nombra a quienes la llaman, y un test que prohíbe reescribir el predicado a mano.

### 4.1 `app.active_fleet` (vista)
- **Columnas:** `carrier_id`, `entity_type` (`DRIVER`/`ASSET`), `entity_id`.
- **Contenido:** conductores y equipos con `operational_status = 'ACTIVE'` y asignación `ACTIVE`.
- **Lo que NO filtra:** el estado de la empresa. La ficha de una empresa dada de baja muestra su flota como historial.
- **Es la única definición de "flota activa".** La leen las cifras del Directorio, la vista rápida, `TRACTOREO_ROSTER_CTE`
  (sin cambiar su resultado) e `in_scope_sql`, que se recompone sobre ella y da el mismo resultado.

### 4.2 `app.carrier_of(p_entity_type text, p_entity_id uuid) → uuid`
- CARRIER devuelve la misma empresa. DRIVER y ASSET devuelven la empresa de su asignación `ACTIVE`, sin importar estados.
- `STABLE`, con `search_path` fijo.
- Reemplaza los LEFT JOIN sueltos de `entity_summary.py` (:93, :142), del embudo (`compliance.py:517-523`, :1989) y de
  `daily_closures.py` (:79, :177).
- En D2 recibe una fecha y lee el historial; sus llamadores no cambian.
- `ultima_empresa_sql` (para documentos al término) sigue aparte hasta D2.

### 4.3 `public.carrier_management_types(uuid)` corregida
- Cuenta solo los tractos de la flota activa (`app.active_fleet`).
- Medido el 12/10: el cambio no altera el resultado de ninguna de las 251 empresas, y ningún requisito usa hoy
  `applies_to_management_types`.
- La CTE duplicada `carrier_operation_types` de `compliance.py:580-587` pasa a llamarla, y las etiquetas salen de
  `status_taxonomies`.

### 4.4 CHECK en `operational_status`
- `carriers` acepta los cuatro valores; `drivers` y `assets`, `ACTIVE` e `INACTIVE`.
- Verificado el 12/10: todas las filas cumplen.
- El TS deja de admitir `LEGACY_INACTIVE` para la flota.

## 5. La regla documental, en un módulo (`app/services/fleet_compliance.py`)

### 5.1 Contenido
- **Se muda aquí la base de Pendientes:** `_pending_ctes` y `resolved` de `compliance.py:486-560`, con `document_state`,
  `in_scope`, la empresa atribuida y `entered_on`. Pendientes la importa y su salida no cambia (§8.2).
- `entity_compliance_sql(...)`: por entidad (empresa, conductor o equipo), su resumen propio y sus cifras.
- `carrier_compliance_sql(...)`: por empresa, lo propio más lo de su flota activa. Devuelve:
  - el peor estado de los obligatorios;
  - cifras overdue / expiring / missing, propias y de la flota;
  - `can_operate`.

  Es set-based (un GROUP BY sobre la base compartida), no una función por fila.
- **Aviso por documento:** días que faltan y severidad (`warning` si está dentro de los días de aviso; `critical` si está
  dentro de `error_days`). Lee `app.alert_thresholds` (global) y `compliance_requirement_rules.warning_days` (excepción).
- `vencimientos.py` sigue siendo el dueño del vocabulario por registro (`document_state_sql`, `in_scope_sql`, predicados).
  `fleet_compliance.py` es el dueño de los agregados y de la habilitación.

### 5.2 Arreglos de regla
- **`exigible_sql` y `exigible_desde_sql` por tipo de entidad (B-8):** se ramifican con `_ASIGNACIONES`, igual que
  `ingreso_sql`. Hoy no cambia ningún registro, porque todos los requisitos con registros son `ON_ENTITY_START`.
- **ONBOARDING sale del alcance del embudo** (`FUNNEL_ACTIVE_STATUSES`, `compliance.py:35`), igual que en Pendientes.

### 5.3 Rendimiento
La lista completa del Directorio tiene que quedar bajo 300 ms de ejecución en el servidor, medido con `EXPLAIN ANALYZE` sobre
la base real. Es la misma meta que el resumen de Pendientes (~210 ms).

## 6. Lectores

### 6.1 Backend

| Lector | Pasa a |
|---|---|
| Directorio: `_SQL_DIRECTORIO`, `_CARRIER_LIST_AGG`, `_pending_mandatory_join` (`carriers.py`) | `carrier_compliance_sql`, más los conteos de flota desde `app.active_fleet` |
| Roster de la ficha (`list_carrier_drivers`, `list_carrier_assets`) | Cada fila con su ciclo de vida y su `entity_compliance_sql` (`compliance_health` se retira) |
| Ficha `GET /carriers/{id}`: `compliance_records` | Cada registro con `document_state`, días que faltan y severidad del aviso; `status` queda como historial |
| Vista rápida (`entity_summary.py`) | `entity_compliance_sql` / `carrier_compliance_sql` y `carrier_of` |
| Embudo de Certificación (`compliance.py:360-424`) | `carrier_compliance_sql`. El ciclo de vida pasa a filtro, y los baldes salen de la escala del resumen ("Con vencimientos" incluye por vencer, conflicto 8) |
| Alertas del Monitor (`trips.py:620-668`) | `entity_compliance_sql` por conductor, tracto y empresa del viaje, más `can_operate`; los documentos críticos (licencia, cédula) se leen de la severidad del aviso |
| `urgencia` (`compliance.py:603-608`, `schemas/compliance.py:93`) | Se retira; se usa `document_state` |
| `/drivers`, `/fuzzy-match` (`drivers.py`) | Una fila por conductor aunque tenga dos tractos (F-07), y búsqueda canónica (§7.2) |

### 6.2 Frontend: los componentes solo pintan
- Se retiran `mandatoryProblems` (`carriers/[id]/page.tsx:390`), el filtro de `TransporterAlertBanner.tsx:25`,
  `nodeState` y `checklistCompletion` (`DocumentChecklist.tsx:70`), `complianceAlertStatus` (`lib/compliance.ts:54`) y la
  lógica de `ComplianceBadge.tsx`. Leen el estado y el resumen que manda la API.
- `COMPLIANCE_STATUS_CONFIG` deja de mostrarse como estado. El select de `DocumentChecklist` deja de ofrecer valores que
  nunca se guardan.
- `StatusChip` y `DocumentStatusBar` (`components/ui`) son los únicos que pintan estados, y reciben el valor del
  diccionario. Una variante es una prop.
- **Empresa:** dos chips separados, ciclo de vida y Habilitada / No habilitada (en gris si no está activa). Conductor y
  equipo: el mismo par, sin reemplazar uno por otro.
- **Etiquetas:** las pestañas "Inactivas" pasan a "Dadas de baja" (`carriers/page.tsx:47`, `insurance/page.tsx:44`).
  `FiltroDeEstado` y las pestañas del Directorio usan la escala del glosario.
- **Configuración › Alertas de vencimiento:** dos umbrales globales, aviso y crítico, con un texto que describe lo que
  realmente pasa. Se retiran las filas por documento.
- **Sin clasificar:** adopta los nombres del glosario ("Sin clasificar", "Directorio"). No muestra estados de documento.

### 6.3 Lo que no se toca
- El roster y las líneas del Cierre.
- Las dos fichas de empresa (siguen dos hasta D4; la de Certificación lee el mismo resumen).
- `GestionDeclarada` sigue donde está hasta D4.

### 6.4 El glosario en código
- **Backend:** `app/schemas/states.py` (junto a los schemas que lo importan) con los `Literal` de cada capa y el orden de severidad.
  Los schemas lo importan.
- **Frontend:** `lib/states.ts`, con cuatro diccionarios (ciclo de vida, estado del documento, habilitación, aviso):
  valor → etiqueta, tono e ícono. Absorbe `OPERATIONAL_STATUS_LABELS`, `FLEET_STATUS_LABELS`, `statusLabel`,
  `STATUS_CLS`, `CARRIER_DEACTIVATED_LABEL` y las etiquetas de `lib/pending.ts`, con sus importadores migrados.

## 7. Guarda e identidad

### 7.1 Guarda de asignación en la API
- Una sola validación compartida por `POST /trips`, `/trips/{id}/fleet-link`, `/trips/assign-driver` y `/trips/bulk`.
- **Rechaza con 409 y un mensaje claro:** empresa no activa, conductor dado de baja, tracto dado de baja.
- **Empresa No habilitada:** se asigna con aviso en la respuesta y en el Monitor (P14 abierta; bloquear después es una línea).
- **"Conductor habitual"** y `/driver-candidates` dejan de ofrecer dados de baja.

### 7.2 Identidad de RUT y patente
- Todos los buscadores comparan con `public.canonical_rut` / `public.canonical_plate`: `/carriers?q`, `/drivers?q`,
  `/fuzzy-match`, `/buscar` y el filtro de la ficha.
- **Python:** un solo normalizador para `match_document` (Sin clasificar) y `match_owner` (Pendientes). Las patentes se
  reconocen con guion o espacio. Un test de paridad lo compara con las funciones de la base.
- `carriers.tax_id` se compara siempre con `canonical_rut(...)`. Normalizar lo guardado es D3.

## 8. Pruebas y verificación

### 8.1 Equivalencia (se escribe primero y tiene que fallar hoy)
Para cada empresa activa, las cifras del Directorio, la vista rápida y el embudo son iguales a las de
`/pending/summary?group_by=carrier`. Si no falla contra el código de hoy, no mide.

### 8.2 Pendientes no cambia
Dentro de una transacción, la salida de `/pending` y `/pending/summary` (los dos `group_by`) es idéntica antes y después de
mudar la base.

### 8.3 Funciones de la base
- Tests de integración que corren la migración dentro de una transacción revertida.
- Los sujetos los crea el test: una empresa con un conductor de baja, un tracto de baja, un conductor con dos tractos.
- Consultas con parámetros, no literales.

### 8.4 Mutación
Se rompe la regla a propósito (por ejemplo, que "por vencer" bloquee la habilitación), se confirma que hay tests en rojo y
se revierte. Se registra en el ledger.

### 8.5 Guardas
- Ninguna etiqueta de estado escrita a mano fuera de `lib/states.ts`.
- Ningún predicado de estado, alcance o flota activa fuera de `vencimientos.py`, `fleet_compliance.py` o las funciones de la base.
- Paridad del normalizador de RUT y patente entre Python y la base.

### 8.6 Suites
- Las del área en cada tarea.
- La suite completa, `tsc` y el build, **una vez** antes de cada despliegue (el módulo es compartido).

### 8.7 En la app
- **Copia local:** recorrido en escritorio y a 390 px con Certificación, Supervisor de Operaciones y Operador; capturas
  lado a lado antes y después.
- **Dev:** el mismo recorrido con sesión, sin guardar nada, comprobando las cifras del §1.

## 9. Despliegues

1. **Expandir: base y API.**
   - Contenido: migración (§4), `fleet_compliance.py` con la base de Pendientes mudada (§5), campos nuevos en la API **al
     lado** de los viejos, guarda (§7.1), identidad (§7.2) y `exigible_sql` (§5.2).
   - Cómo se aplica la migración: se ensaya con `BEGIN; \i …; verificaciones; ROLLBACK`, y después se aplica en un momento
     tranquilo, sin un job en vuelo.
   - Efecto visible: solo la guarda y los buscadores.
2. **Frontend:** glosario en código, recálculos retirados, chips, etiquetas, embudo y Configuración › Alertas.
3. **Contraer:** se retiran `compliance_health`, `urgencia`, `_pending_mandatory_join`, el balde "No activas" y los
   predicados viejos. Los tests de guarda impiden que vuelvan.

Todo a `dev`. Nada a `main`. Mage no se toca.

## 10. Fuera de alcance (con destino)

| Tema | Destino |
|---|---|
| Relaciones con vigencia: conductor–empresa, equipo–empresa, empresa–cliente (agregar, quitar con fecha, reincorporar, historia), editar clientes (F-30), proponer clientes desde los viajes | D2 |
| Reactivar eligiendo la flota que vuelve (P3) | D2 |
| Tipo de operación de un conductor de empresa mixta según el tracto del día (borde c de P8) y desglose por tipo en la firma | D2 |
| Corregir RUT y patente, normalizar `carriers.tax_id` guardado (F-29) | D3 |
| Una ficha por empresa; mover `GestionDeclarada` al Directorio con permiso para Certificación | D4 |
| P14: bloquear o avisar al asignar flota No habilitada | Pregunta abierta (Pablo) |
| Sin clasificar opción B (cola de excepciones) | Certificación 2a, en paralelo |
| Tracto GPRZ30 sin tipo ni empresa (28 viajes fuera del Cierre) | Carga de datos de Operaciones |
