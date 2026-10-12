# Directorio · D1 "Una sola respuesta" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ¿está activa?, ¿de qué empresa es?, ¿en qué estado está este documento?, ¿cómo está esta empresa con sus documentos? y ¿puede operar? tengan una sola respuesta, calculada en un solo lugar y con un solo nombre, que leen Directorio, Certificación (portada, ficha, Pendientes, Sin clasificar, Configuración), Monitor y vista rápida sin recalcularla.

**Architecture:** Tres despliegues con el patrón expandir/contraer (§9 de la spec).
- **Despliegue 1: base y API.**
  - Una migración re-ejecutable crea los hechos de la flota: `app.active_fleet`, `app.carrier_of`, `carrier_management_types` corregida y CHECK en `operational_status`.
  - Un módulo nuevo, `app/services/fleet_compliance.py`, recibe la base de Pendientes y calcula el resumen por entidad y por empresa, la habilitación y el aviso.
  - Los lectores agregan los campos nuevos **al lado** de los viejos.
  - Entran la guarda 409 de asignación y la identidad canónica de RUT y patente.
- **Despliegue 2: frontend.** Un glosario en código (`lib/states.ts`). Los componentes solo pintan lo que manda la API.
- **Despliegue 3: contraer.** Se retiran los campos y predicados viejos, y los tests de guarda impiden que vuelvan.

**Tech Stack:** FastAPI + asyncpg (Postgres 17 en Supabase), pytest (integración con `conexion_revertida`), Next.js 16 app router + React Query + Tailwind con tokens propios, vitest + Testing Library, Playwright MCP (copia local y dev).

**Spec:** `docs/superpowers/specs/2026-10-12-directory-d1-one-answer-design.md` (aprobada el 12/10). Insumos:
- `docs/superpowers/plans/2026-10-12-states-audit.md` (conflictos 1-14);
- `docs/superpowers/plans/2026-10-12-directory-audit-findings.md` (F-02, F-03, F-06, F-07, F-08; §7 decisiones);
- el ledger del bloque 0, `docs/superpowers/plans/2026-10-12-directory-block-0-rulings.md`.

## Global Constraints

- **Tests vistos fallar antes de implementar.** Cada paso "Run test to verify it fails" tiene que fallar por el motivo que dice el paso. Si falla por otro (import roto, fixture inexistente), se corrige el test y se reporta.
- **El código de test de este plan nunca corrió.** Es un punto de partida verificable, no una transcripción. Si falla por un motivo distinto al esperado, el implementador corrige el test y lo reporta en su informe. **Nunca se afloja una aserción** para que pase.
- **Mutación en los tests de datos, reglas y guardas.** Esos tests llevan un paso "Verificar que la mutación mata el test": revertir la línea que nombra el paso, correr, ver FAIL y restaurar. Un test que sigue verde con la implementación revertida no protege nada.
- **Integración contra la base real** con `conexion_revertida` (transacción que siempre se revierte; `tests/conftest.py`).
  - Los sujetos los crea el test, con prefijo `ZZ-TEST-D1`.
  - Los requisitos de test se insertan con `is_active = false`, salvo que el test necesite que la siembra los vea; en ese caso lo dice.
  - Ningún test elige ni depende de datos de producción, salvo el test de equivalencia (Task 1), que compara dos lecturas sobre los mismos datos y no fija cifras.
- **SQL verificado con parámetros** (`$1`), nunca sustituyendo literales.
- **Venv del backend y primer plano:** `cd monitor-app/backend/api && venv/bin/python -m pytest …`. **Siempre en primer plano**, nunca en segundo plano: cortar una corrida a mitad deja conexiones del pooler tomadas.
- **Nunca** correr `tests/test_padron_conductor.py` con `--padron-completo`.
- **Migración:**
  - Archivo único `monitor-app/backend/supabase/migrations/20261013090000_directory_one_answer.sql`, re-ejecutable (`CREATE OR REPLACE`, `DROP … IF EXISTS`, CHECK agregados solo si no existen).
  - **Sin triggers ni `REFRESH` nuevos.**
  - Se ensaya en la base real con `BEGIN; \i …; verificaciones; ROLLBACK` y se aplica con `mcp__claude_ai_Supabase__apply_migration` solo en la Task 10, en un momento tranquilo y **sin un job de Mage o de extracción en vuelo** (memoria "desplegar con un job en vuelo deja el lock huérfano").
- **Mage no se toca.** `main` no se toca. Todo a `dev`.
- **Interfaz en español neutral:** nunca voseo ("Elige", "Revisa"), cero emojis (solo íconos de `lucide-react`).
- **Nombres en inglés** (funciones, componentes, archivos, claves JSON, parámetros); etiquetas en español.
- **Sistema visual:**
  - Solo tokens y primitivas de `components/ui` (`StatusChip`, `DocumentStatusBar`, `Estado`, `text-etiqueta/dato/lectura/titulo`, `text-informativo`, `text-status-incidente`, `text-warning`, `text-espera`).
  - Los trinquetes de `lib/ui/sistema.test.ts` (colores crudos) y `lib/ui/escala.test.ts` (tamaños bajo 11 px) **no pueden subir**. Cuando se borra un color crudo, se baja el tope en el mismo commit.
  - Una variante es una prop, no un componente hermano.
- **Glosario de la spec (§3):** los únicos textos de estado permitidos.
  - Ciclo de vida: Activa / Activo · En onboarding · Dada de baja / Dado de baja.
  - Documento: Al día · Por vencer · Vencido · Falta · Aún no se exige.
  - Habilitación: Habilitada · No habilitada.
  - Módulos: "Directorio", "Sin clasificar".
- **Suites:** por tarea, solo los tests que la tarea toca. La suite completa del backend, la del frontend, `npx tsc --noEmit` y `npm run build` corren **una vez por despliegue** (Tasks 10, 15 y 16), porque se toca código compartido.
- **Commits** terminan con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Contrato compartido entre tareas (nombres e interfaces)

Cada implementador ve solo su tarea. Estos nombres y tipos son **fijos**: ninguna tarea los renombra.

### Base (Task 2: migración `20261013090000_directory_one_answer.sql`)
- `app.active_fleet` (vista):
  - columnas `carrier_id uuid`, `entity_type text` (`'DRIVER'|'ASSET'`), `entity_id uuid`;
  - contenido: conductores y equipos con `operational_status = 'ACTIVE'` y asignación `status = 'ACTIVE'`;
  - no filtra el estado de la empresa.
- `app.carrier_of(p_entity_type text, p_entity_id uuid) RETURNS uuid`:
  - `'CARRIER'` devuelve `p_entity_id`; `'DRIVER'` y `'ASSET'` devuelven la empresa de su asignación `ACTIVE` (cualquier estado); otro valor devuelve NULL;
  - `LANGUAGE sql STABLE`, `SET search_path TO 'public','app','pg_catalog'`.
- `public.carrier_management_types(uuid) RETURNS text[]`: misma firma; cuenta solo los tractos (`TRACTOCAMION`) de `app.active_fleet` (A-R1: cambia 1 empresa INACTIVE).
- Los CHECK van al final del archivo, después de una línea exacta `-- d1:checks`. El archivo no lleva `BEGIN`/`COMMIT`.
- Helper de tests `apply_fleet_facts(conn)` en `monitor-app/backend/api/tests/d1_subjects.py` (lo crea la Task 2): ejecuta la migración hasta `-- d1:checks`, sin tomar los locks de los CHECK. Las Tasks 4-10 lo usan hasta que la Task 10 aplica la migración; las fábricas de sujetos de prueba viven en el mismo módulo.
- CHECK:
  - `carriers_operational_status_check`: `('ACTIVE','ONBOARDING','INACTIVE','LEGACY_INACTIVE')`;
  - `drivers_operational_status_check` y `assets_operational_status_check`: `('ACTIVE','INACTIVE')`.

### Backend: glosario (Task 3: `app/schemas/states.py`)
```python
CarrierLifecycle = Literal["ACTIVE", "ONBOARDING", "INACTIVE", "LEGACY_INACTIVE"]
FleetLifecycle = Literal["ACTIVE", "INACTIVE"]
DocumentState = Literal["UP_TO_DATE", "EXPIRING", "OVERDUE", "MISSING", "NOT_REQUIRED"]
AlertSeverity = Literal["warning", "critical"]
SEVERITY_ORDER: tuple[str, ...] = ("OVERDUE", "MISSING", "EXPIRING", "UP_TO_DATE")  # peor primero
BLOCKING_STATES: tuple[str, ...] = ("OVERDUE", "MISSING")

class StateCounts(BaseModel):
    overdue: int = 0
    expiring: int = 0
    missing: int = 0

class ComplianceSummary(BaseModel):
    worst_state: DocumentState          # el peor entre los OBLIGATORIOS pendientes (A-R5); UP_TO_DATE si no hay
    own: StateCounts                    # documentos de la propia entidad
    fleet: StateCounts | None = None    # solo empresas: lo de su flota activa
    can_operate: bool                   # ver §5 de la spec y la regla de abajo
```
`vencimientos.PENDING_STATES` sigue existiendo y queda igual a `("OVERDUE", "EXPIRING", "MISSING")`.

### Backend: módulo (Task 4: `app/services/fleet_compliance.py`)
- `pending_base_ctes(estado_param: str) -> str`: es `_pending_ctes` de `compliance.py:466`, **movido sin cambios** (mismas CTE `pending` y `resolved`, mismas columnas, incluida `resolved_carrier_id`). `compliance.py` la importa.
- `entity_compliance_cte() -> str`:
  - devuelve el texto de una CTE llamada `entity_compliance` (sin `WITH`), lista para componer como `WITH {entity_compliance_cte()} SELECT …`;
  - columnas: `entity_type text, entity_id uuid, worst_state text, overdue int, expiring int, missing int, blocking_mandatory int`;
  - `blocking_mandatory` cuenta los `LEGAL_MANDATORY` en `OVERDUE` o `MISSING`.
- `carrier_compliance_cte() -> str`:
  - CTE `carrier_compliance` (incluye internamente lo que necesite de `pending_base_ctes("'falta'")`);
  - columnas: `carrier_id uuid, worst_state text, own_overdue int, own_expiring int, own_missing int, fleet_overdue int, fleet_expiring int, fleet_missing int, can_operate boolean`.
- `summary_from_row(row, *, with_fleet: bool) -> ComplianceSummary`: arma el modelo desde una fila con las columnas de arriba. Un `NULL` en las cifras vale 0; un `worst_state` NULL vale `UP_TO_DATE`.
- `days_to_expiry_sql(alias: str = "cr") -> str`: entero (días de Chile hasta el vencimiento) o NULL si no vence.
- `alert_severity_sql(alias: str = "cr") -> str`:
  - `'critical'` si es exigible, no vencido y le faltan ≤ `error_days` del umbral global;
  - `'warning'` si está por vencer (mismo predicado que `por_vencer_predicate`, que ya respeta la excepción por regla);
  - NULL en otro caso.
  - El umbral global es la fila `doc_type = 'documento_por_vencer'` de `app.alert_thresholds`.
- **Regla de habilitación:** `can_operate = carrier.operational_status = 'ACTIVE' AND NOT EXISTS (pendiente LEGAL_MANDATORY en OVERDUE o MISSING, propio o de app.active_fleet, en alcance)`. Por vencer no bloquea. Los opcionales no bloquean, pero cuentan en las cifras.
- **Alcance de las cifras:**
  - Empresa `ACTIVE`: exactamente el de Pendientes (`in_scope`, empresa atribuida = `resolved_carrier_id`). Así las cifras de una empresa activa son iguales a su fila en `/pending/summary?group_by=carrier`.
  - Empresa no activa (ruling D1-R1): sus propios registros más los de su `app.active_fleet`, sin exigir que la empresa esté activa. `can_operate` es siempre `false`.

### API (campos nuevos, aditivos en el despliegue 1)
- `GET /carriers` (lista del Directorio), cada fila: `compliance_summary: ComplianceSummary` (con `fleet`).
- `GET /carriers/{id}`: `compliance_summary` (con `fleet`). Cada elemento de `compliance_records` suma `document_state: DocumentState`, `days_to_expiry: int | None`, `alert_severity: AlertSeverity | None`.
- `GET /carriers/{id}/drivers` y `/assets` (roster): cada fila suma `compliance_summary` (sin `fleet`).
- Vista rápida (`entity_summary`): `compliance_summary` (con `fleet` si es empresa).
- `GET /carriers` admite además `enablement: "enabled" | "not_enabled" | ""` y suma las facetas `enabled` y `not_enabled` (R-B14). Las no activas nunca cuentan como `not_enabled`.
- `GET /drivers/{id}/compliance-records` y `GET /assets/{id}/compliance-records`: los mismos tres campos por registro (R-B7).
- Embudo `GET /compliance-records/status`, cada empresa: `compliance_summary` y `funnel_bucket: "up_to_date" | "expiring" | "not_enabled" | null` (NULL si la empresa no está `ACTIVE`, también ONBOARDING), al lado de `funnel_group`. ONBOARDING sigue en `FUNNEL_ACTIVE_STATUSES` para siempre (decisión del usuario).
- `GET /trips`, por entidad: `driver_has_critical_alert`, `tractor_has_critical_alert`, `carrier_has_critical_alert` (`bool | None`, NULL sin entidad resuelta) y `carrier_can_operate` (`bool | None`), al lado de lo actual. Crítico = aviso `critical` o licencia o cédula pendientes (conserva el rojo de hoy).
- Guarda de asignación: **409** con `detail = {"code": "<CODE>", "message": "<texto>"}` (el lote suma `errors: [{row, code, error}]`, C-R10). Los códigos son `CARRIER_NOT_ACTIVE` (incluye ONBOARDING), `DRIVER_INACTIVE` y `ASSET_INACTIVE` (tracto o rampla). Las respuestas exitosas traen siempre `warnings` (lista, vacía si nada); si la empresa no está habilitada, `[{"code": "CARRIER_NOT_ENABLED", "message": …}]`.
- Ledger de rulings y mutaciones de la ejecución: `docs/superpowers/plans/2026-10-12-directory-d1-rulings.md`.

### Frontend (Task 11: `lib/states.ts`)
```ts
export type DocumentState = 'UP_TO_DATE' | 'EXPIRING' | 'OVERDUE' | 'MISSING' | 'NOT_REQUIRED'
export type AlertSeverity = 'warning' | 'critical'
export type EntityKind = 'carrier' | 'driver' | 'asset'   // alias de lib/api/entitySummary.ts (ya existe)
export interface StateCounts { overdue: number; expiring: number; missing: number }
export interface ComplianceSummary { worst_state: DocumentState; own: StateCounts; fleet: StateCounts | null; can_operate: boolean }
export interface StateStyle { label: string; tone: StatusTone; icon: LucideIcon }   // StatusTone = el de components/ui/StatusChip
export function lifecycleStyle(kind: EntityKind, status: string): StateStyle
export function documentStateStyle(state: DocumentState): StateStyle
export function enablementStyle(summary: ComplianceSummary, lifecycleActive: boolean): StateStyle   // gris si no activa
export function alertSeverityStyle(severity: AlertSeverity): StateStyle
```

## Review Focus

1. **Empresa activa sin ningún registro de cumplimiento** (recién creada, la siembra no corrió). Se espera "Habilitada", `UP_TO_DATE` y cifras en 0, sin error, y que no desaparezca de la lista. Test en la Task 4 (`test_empresa_activa_sin_registros_queda_habilitada`).
2. **Conductor con dos tractos activos** (`vehicle_driver_assignments` permite uno por tracto). Se espera una sola fila en `/drivers`, `/fuzzy-match` y la flota de su empresa, y que sus documentos se cuenten una vez en el resumen. Tests en la Task 4 (`test_conductor_con_dos_tractos_cuenta_una_vez`) y la Task 7 (`test_drivers_no_duplica_conductor_con_dos_tractos`).
3. **Documento que vence hoy (0 días) o que venció ayer**, con `error_days` mayor que los días de aviso de su regla. Se espera que hoy sea `critical` (no vencido) y que ayer sea `OVERDUE` sin severidad de aviso. Tests en la Task 4 (`test_aviso_en_el_borde_del_dia_de_chile`).
4. **Asignación en lote donde un solo viaje toca a un conductor dado de baja.** Se espera 409 para el lote entero, sin ninguna escritura, con el código y la patente o el nombre de quien bloquea (la persona no puede creer que guardó la mitad). Test en la Task 8 (`test_bulk_con_un_conductor_de_baja_no_escribe_nada`).
5. **RUT de empresa guardado con puntos** (`carriers.tax_id` no es canónico) **y buscado sin puntos, o al revés**, incluida una patente con guion en Sin clasificar. Se espera el mismo resultado en `/carriers?q`, `/buscar`, `match_document` y `match_owner`. Tests en la Task 9 (`test_rut_con_y_sin_puntos_encuentra_la_misma_empresa`, `test_paridad_normalizador_python_y_base`).

## Rulings tomados al escribir el plan (desvíos o precisiones de la spec)

- **D1-R1: resumen de una empresa no activa.** La spec dice que "se calcula igual (historial)". `in_scope_sql` exige empresa activa, así que con el alcance de Pendientes daría siempre 0. Por eso, para una empresa no activa las cifras usan sus propios registros más los de su `app.active_fleet`, sin exigir empresa activa, y `can_operate = false`. Costo si estuviera mal: una rama del CTE.
- **D1-R2: el embudo cambia de baldes con un campo nuevo, no reemplazando `funnel_group`.** El frontend mapea los valores de `funnel_group`; cambiarlos en el despliegue 1 rompería la pantalla hasta el 2. Se agrega `funnel_bucket` y `funnel_group` se retira en la Task 16. Costo: un campo duplicado durante dos despliegues.
- **D1-R3: las cifras que hoy existen y estaban mal se corrigen en su lugar, sin campo nuevo.** Los conteos de conductores y equipos de la empresa (84 → 78) y el `pending_count` del embudo (2.306 → 2.226) son la misma pregunta con la respuesta equivocada. Costo: ninguno; el frontend ya los pinta.
- **D1-R4: las filas de umbral por documento de `app.alert_thresholds`.** El despliegue 2 deja de mostrarlas en Configuración (la pantalla y `GET /config/alert-thresholds` filtran a la fila global). Solo el despliegue 3 las borra, con una migración que guarda antes una copia en el `audit_log`, después de verificar con grep que ningún lector las usa. Costo si estuviera mal: restaurar filas desde el `audit_log`.
- **D1-R5: `GestionDeclarada` y la ficha de Certificación** no se mueven (D4), pero leen `compliance_summary` igual que la del Directorio.

## Rulings de las partes (resueltos en el ensamblado, 12/10)

Cada parte del plan se redactó leyendo el código. Sus rulings quedan aquí con su resolución; los nombres llevan el prefijo de la parte (A-R, R-B, C-R, D-R, R-E).

### Rulings de la parte A (Tasks 1-4)

Ninguno cambia un nombre ni un tipo del contrato. Son precisiones o desvíos medidos que el revisor tiene que aceptar o corregir.

- **A-R1. `carrier_management_types` y la palabra "tractos": el contrato y la medición de la spec no coinciden.**
  - El contrato (y la spec §4.3) dicen "cuenta solo los tractos de `app.active_fleet`". La spec agrega "medido: no altera ninguna de las 251 empresas".
  - Medido hoy en una transacción revertida:
    - **flota activa con todos los equipos:** 0 cambios;
    - **flota activa con solo `TRACTOCAMION`:** cambia **1 empresa `INACTIVE`**. Pierde `EQUIPO_COMPLETO`, que venía de una rampla activa, y queda en `['TRACTOREO']`.
  - Ningún requisito usa hoy `applies_to_management_types`, así que la siembra no cambia.
  - El plan sigue el contrato al pie de la letra (`AND a.asset_type = 'TRACTOCAMION'`, coherente con E-g: "el tipo de operación sale del tracto"). El ensayo de la Task 2 espera `cambian = 1` (INACTIVE).
  - Si se prefiere "0 cambios": borrar esa condición y el test `test_el_tipo_de_operacion_sale_del_tracto_no_de_la_rampla`.
- **A-R2. B-8 hoy es inalcanzable por una CHECK.**
  - `compliance_requirements_exigible_on_entity_check` solo admite `MONTH_AFTER_START` y `ON_ENTITY_END` en requisitos `target_entity = 'DRIVER'`.
  - El arreglo de `exigible_sql` por tipo entra igual, como la regla para cuando Configuración lo permita.
  - El test no toca la CHECK: inserta un registro `entity_type = 'ASSET'` que apunta a un requisito de conductor. Los predicados leen `cr.entity_type` y no `target_entity`. Un `ALTER TABLE … DROP CONSTRAINT` tomaría un lock exclusivo sobre `compliance_requirements` durante todo el test.
  - Precisión: con `ingreso_sql` como única fecha de ingreso, `MONTH_AFTER_START` de una **empresa** pasa a contar desde su alta (`created_at`, día de Chile). Hasta hoy se exigía siempre. Afecta a 0 registros, y la CHECK lo impide.
  - `ON_ENTITY_END` de una empresa sigue en `false`, igual que hoy.
- **A-R3. `_empresa_que_dejo_sql` se muda con la base.**
  - `_pending_ctes` la llama, y vive en `compliance.py`: si se quedara allí, `fleet_compliance` tendría que importar del router (import circular).
  - Se muda sin cambios ni renombre, y `compliance.py` la importa para la CTE `attributed` del embudo hasta la Task 6.
  - **Hueco latente, que no se arregla aquí porque la base se muda sin cambios:** atribuye "al término" solo para `DRIVER`.
    - Con B-8, un equipo que se fue tendría su documento al término `in_scope = true`, pero `resolved_carrier_id = NULL`.
    - Ese documento desaparece de Pendientes y de `carrier_compliance` por igual: son coherentes entre sí, con 0 filas hoy.
    - Propuesta: lo cierra la Task 6, al pasar a `app.carrier_of` / `ultima_empresa_sql('ASSET')`.
- **A-R4. Alcance de `entity_compliance` y `can_operate` de una entidad (el contrato no los fija).**
  - `entity_compliance` no aplica `in_scope`: cuenta lo que la entidad debe, esté activa o no (la ficha de un dado de baja muestra su historial). Para la flota activa de una empresa activa coincide con Pendientes.
  - Una fila de entidad no trae la habilitación hecha. `summary_from_row(…, with_fleet=False)` la arma así: `operational_status == 'ACTIVE' and blocking_mandatory == 0`.
  - Por eso el lector tiene que seleccionar el `operational_status` de la entidad. Si falta, la función tira `KeyError`, en vez de suponer "activa" (memoria "un null con dos significados").
  - El estado de la empresa del conductor no entra.
- **A-R5 (resuelto): sigue la spec.** `worst_state` es el peor estado entre los pendientes `LEGAL_MANDATORY` (exigibles, en alcance). Las cifras siguen contando también los opcionales.
  - Un opcional vencido da `worst_state = UP_TO_DATE`, `can_operate = true` y `own_overdue = 1`. Lo fija `test_un_opcional_vencido_no_inhabilita_ni_empeora_pero_cuenta`.
- **A-R6 (resuelto por la Task 14).** Con `error_days` mayor que los días de aviso de la regla, un documento "Al día" podría salir `critical`.
  - La Task 14 lo impide: el `PATCH` de umbrales valida `error_days < warning_days`.
  - `alert_severity_sql` queda como está. Hoy, además, la fila global tiene `error_days = 0`.
- **A-R7. Las dos CTE de resumen son autocontenidas (WITH anidado).**
  - Llevan `pending`/`resolved` adentro de su propio `WITH`. Si no, la Task 7 no podría componer `entity_compliance` y `carrier_compliance` en una consulta: Postgres responde `WITH query name "pending" specified more than once`.
  - No usan `$n`.
  - Costo: la base se calcula dos veces cuando se usan juntas. `carrier_compliance` sola, sobre las 251 empresas, mide **84-90 ms de ejecución** (meta: < 300).
- **A-R8. "No vencido" en el aviso es lo mismo que en `document_state_sql`: ni marcado `EXPIRED` ni pasado de fecha.**
  - Se aplica también a `warning`. Así, un registro marcado `EXPIRED` con fecha futura no lleva aviso: su estado ya es `OVERDUE`.
- **A-R9. Un solo helper de tests: `apply_fleet_facts(conn)` en `tests/d1_subjects.py` (Task 2).**
  - Ejecuta el texto de la migración hasta la línea `-- d1:checks` (sin incluirla). Así existen la vista, `app.carrier_of` y `carrier_management_types`, sin los CHECK.
  - Los CHECK toman `ACCESS EXCLUSIVE` sobre carriers, drivers y assets hasta el ROLLBACK, y la app no podría leer esas tablas mientras dure cada test.
  - La migración pone el bloque de CHECK después de una línea que dice exactamente `-- d1:checks`, y no lleva `BEGIN`/`COMMIT`.
  - Los tests de CHECK de la Task 2 corren el archivo entero.
  - Lo usan la Task 4 y, hasta que la Task 10 aplique la migración, las Tasks 5-9 y el test de equivalencia cuando le quiten sus xfail. Las Tasks 5-9 agregan sus fábricas de sujetos en el mismo módulo.
- **ONBOARDING (decisión del usuario).** Para la regla de la Task 4, una empresa en onboarding no está activa: se resume por D1-R1 y su `can_operate` es siempre `false`. Que siga en el embudo y en Sin clasificar es asunto de las Tasks 6 y 14, no de este módulo.
- **Re-verificado tras las decisiones de ensamblado (12/10):** 13 tests de migración, 11 de integración y 8 unitarios de `fleet_compliance` en verde. La mutación 5 (`_peor_estado` sin el filtro de obligatorios) mata `test_un_opcional_vencido_no_inhabilita_ni_empeora_pero_cuenta`.
- **Medido al escribir (para el revisor):**
  - **El test de equivalencia, hoy:**
    - Directorio: 36 de 36 empresas activas difieren;
    - vista rápida: 36 de 36;
    - embudo: 6 de 36 (coincide con D10).
  - **`carrier_compliance` contra `/pending/summary` sobre datos reales:** 0 diferencias en 36 activas; total 2.226 (spec §1).
  - **Habilitadas hoy:** **0 de 36**. Todas tienen algún obligatorio vencido o faltante. La pantalla va a decir "No habilitada" en las 36: conviene avisarlo antes del despliegue 2.

### Rulings de la parte B (Tasks 5-7)

Ninguno cambia un nombre ni un tipo del contrato. Los que agregan algo lo agregan al lado.

Estado tras el ensamblado (orquestador, 12/10):
- Aceptados: R-B4 (decisión del usuario), R-B7 y R-B10.
- Resueltos: R-B9 y R-B13, por decisión de ensamblado.
- Cambiado: R-B5, con los nombres de campo por entidad.
- Nuevo: R-B14, filtro de habilitación en el Directorio (D-R6).

- **R-B1. `summary_from_row` lee `own_*` para los dos tipos de fila.** El contrato da a `entity_compliance` las columnas `overdue/expiring/missing` y a `carrier_compliance` las columnas `own_*`/`fleet_*`, pero `summary_from_row` es una sola función. Supuesto de las Tasks 5-7: lee `worst_state`, `own_overdue`, `own_expiring`, `own_missing`, `can_operate` y, con `with_fleet=True`, también `fleet_*`. Para que ningún lector escriba el alias a mano, la Task 5 agrega a `fleet_compliance.py` dos proyecciones: `entity_summary_columns_sql(lifecycle_expr, alias="ec")` y `carrier_summary_columns_sql(alias="cc")`. También agrega `take_summary(row, *, with_fleet)`, que arma el modelo y saca las columnas sueltas de la fila. **Si la Task 4 dejó `summary_from_row` leyendo `overdue` sin prefijo para las entidades**, se ajusta solo `entity_summary_columns_sql`. Decisión de ensamblado: `worst_state` es el peor estado entre los `LEGAL_MANDATORY` exigibles pendientes, como dice la spec. Las cifras incluyen los opcionales. Ningún test de las Tasks 5-7 afirma `worst_state` en un caso que mezcle opcionales con obligatorios.
- **R-B2. Resumen y habilitación de un conductor o equipo.** El contrato define `can_operate` solo para empresas, y `entity_compliance` no trae esa columna. Regla de las Tasks 5-7: `can_operate = operational_status = 'ACTIVE' AND blocking_mandatory = 0`. Vive en `entity_summary_columns_sql`, no en cada lector. Supuesto sobre el alcance de `entity_compliance`: cuenta los pendientes de la propia entidad **sin** exigir `in_scope`. Una entidad dada de baja muestra sus documentos (historial, como D1-R1), en gris, con `can_operate = false`. Para un conductor activo de una empresa activa coincide con `in_scope`, salvo los documentos "al término". Si la Task 4 lo filtró por `in_scope`, cambia solo el test `test_el_roster_trae_el_resumen_de_cada_conductor` en su caso "dado de baja". Esa diferencia tiene que quedar escrita en el ledger.
- **R-B3. `carrier_compliance` tiene una fila por empresa de `public.carriers`, también sin registros.** Los lectores hacen `LEFT JOIN carrier_compliance cc ON cc.carrier_id = c.id` y le pasan la fila a `summary_from_row`. Un `can_operate` NULL rompería el modelo (`bool`). Es lo que exige `test_empresa_activa_sin_registros_queda_habilitada` (Task 4). Si la Task 4 no lo garantiza, falla el test de la ficha de la Task 5 con `ValidationError` en `can_operate`.
- **R-B4 (aceptado, decisión del usuario). ONBOARDING se queda en `FUNNEL_ACTIVE_STATUSES` para siempre; `funnel_bucket` es NULL para toda empresa no `ACTIVE`, incluida ONBOARDING.** La spec §5.2 lo sacaba del alcance. Choca con dos cosas:
  - §9: el despliegue 1 solo cambia lo visible en la guarda y los buscadores;
  - el flujo que fija `test_status_active_scope_includes_newly_created_companies`: una empresa creada sin RUT aparece arriba, en "Recién creadas".

  Por eso ONBOARDING sale del **conteo** y no de la **visibilidad**. El conteo viene de `carrier_compliance`, que la trata como no activa (D1-R1): cifras propias más su flota y `can_operate = false`. Como una empresa no activa no cuenta como "No habilitada" en las colas, su `funnel_bucket` es `None`. El tipo queda `FunnelBucket | None`. `test_carrier_status_filters_by_active_but_not_only` no cambia.
- **R-B5 (cambiado al ensamblar; resuelve R-E1). Monitor: campos por entidad, no del viaje.**
  - Cada fila de `GET /trips` y `GET /trips/{id}` trae:
    - `driver_has_critical_alert`, `tractor_has_critical_alert` y `carrier_has_critical_alert`: booleanos, NULL si esa entidad no está resuelta, igual que `*_pending_docs`;
    - `carrier_can_operate`: booleano o NULL.
  - **No** se exponen `has_critical_alert` ni `can_operate` a nivel de viaje.
  - Cada flag por entidad es `bool_or` sobre los `LEGAL_MANDATORY` de esa entidad, con dos ramas: `alert_severity = 'critical'`, o código en la lista crítica (`LICENCIA_CONDUCIR`, `COPIA_CI_CONDUCTOR`, solo conductor) y pendiente. La segunda rama conserva el badge rojo de hoy cuando falta la licencia o la cédula.
  - `carrier_can_operate` es `carrier_compliance.can_operate` de `vfr.resolved_carrier_id`, o NULL sin empresa resuelta. No mezcla el ciclo de vida del conductor ni del tracto: esos los rechaza la guarda de la Task 8.
  - `carrier_can_operate` se calcula en **una consulta por página** (`WHERE carrier_id = ANY($1)`, `_attach_carrier_can_operate`), después del `fetch` principal. Componer el CTE en `_TRIP_FROM` obligaría a anteponer un `WITH` a los tres `SELECT COUNT(*) {_TRIP_FROM}` y a la faceta de clientes, y cada conteo pagaría la base de Pendientes (~150 ms).
  - `entity_compliance` no se usa en el Monitor.
  - Los campos `*_pending_docs*` siguen iguales hasta la Task 16.
- **R-B6. "Conductor habitual" y `/driver-candidates`.**
  - El selector de "Conductor habitual" de `VehicleDetailPanel` se llena con `GET /carriers/{id}/drivers` (el roster, que incluye a los dados de baja marcados). La Task 7 pone la guarda en la API: `POST /assets/{id}/driver-assignment` responde 409 `DRIVER_INACTIVE`. **Traspaso al frontend (despliegue 2):** `VehicleDetailPanel` filtra la prop `drivers` a `operational_status === 'ACTIVE'`.
  - `/driver-candidates` **ya** excluye a los conductores dados de baja (`d.operational_status = 'ACTIVE'`, `trips.py:2250`). No se excluye a los conductores de una empresa no activa: el TMS nombra a una persona que maneja, y esconderla empuja a darla de alta otra vez (duplicado). La Task 7 suma `carrier_operational_status` a cada candidato, para que la interfaz lo marque. La guarda de la Task 8 rechaza la asignación con `CARRIER_NOT_ACTIVE` y un mensaje claro.
- **R-B7 (aceptado). Estado, días y aviso también en los paneles de conductor y equipo.** `GET /drivers/{id}/compliance-records` y `GET /assets/{id}/compliance-records` son "el mismo shape que el anidado en GET /carriers/{id}". El checklist del frontend los lee y la spec §6.2 le quita su `nodeState`. La Task 5 les agrega los mismos tres campos con una sola proyección, `compliance_record_columns_sql(alias)`, aditiva en `fleet_compliance.py`.
- **R-B8. El roster de equipos se lee en vivo.** `list_carrier_assets` lee `app.carrier_asset_roster` (vista materializada, sin refresco en `public.assets`): el `operational_status` queda viejo hasta el próximo REFRESH. Con un ciclo de vida viejo, `can_operate` saldría mal. Se aplica el mismo arreglo que el bloque 0 hizo para conductores (Task 3), sin trigger ni REFRESH nuevos.
- **R-B9 (resuelto: va a D2). "¿De qué empresa es?" en el Cierre.** La spec §4.2 también nombra `daily_closures.py:79,:177`. Pasa a D2, cuando `app.carrier_of` reciba una fecha; no tiene tarea en D1. `compliance.py:517-523` (`resolved`) lo muda la Task 4 "sin cambios" y tampoco se toca aquí. `matcher_io` no se toca.
- **R-B10 (aceptado). El embudo vive en `GET /compliance-records/status`** (prefijo del router), no en `/compliance/status`.
- **R-B11. Agregados aditivos.**
  - En `app/services/fleet_compliance.py`: `compliance_record_columns_sql`, `entity_summary_columns_sql`, `carrier_summary_columns_sql`, `CARRIER_SUMMARY_COLUMNS`, `ENTITY_SUMMARY_COLUMNS`, `take_summary`, `ENABLEMENT_FILTERS` (Task 5); `carrier_pending_total_sql`, `funnel_bucket_for` (Task 6).
  - En `app/schemas/states.py`: `FunnelBucket` (Task 6).
  - En `app/services/entity_summary.py`: `usual_tractor_lateral` (Task 7).
- **R-B12. Supuesto sobre la Task 1.** Los tres tests de equivalencia comparan la suma `own + fleet` de `compliance_summary` de cada lector con `overdue/expiring/missing` de `/pending/summary?group_by=carrier`, para cada empresa activa. Hoy fallan por `KeyError: 'compliance_summary'`, lo que basta para el `xfail(strict=True)`. Si la Task 1 compara otros campos, las Tasks 5 y 6 igual dejan pasar el test, porque `compliance_summary` sale de `carrier_compliance` y su alcance es el de Pendientes. El paso de quitar el `xfail` lo verifica.
- **R-B13 (resuelto en el ensamblado).** La Task 2 crea `tests/d1_subjects.py` con `apply_fleet_facts(conn)`. La función ejecuta la migración solo hasta la línea `-- d1:checks`, así que los tests no toman el lock de los CHECK. La Task 5 **extiende** ese módulo con las fábricas de sujetos.
- **R-B14 (nuevo, D-R6 del frontend, aceptado). Filtro de habilitación en el Directorio.** `GET /carriers` recibe `enablement: Literal["enabled", "not_enabled", ""]` y suma dos facetas, al lado de `pending`/`ok`:
  - `enabled`: `can_operate`;
  - `not_enabled`: `operational_status = 'ACTIVE' AND NOT can_operate`.

  Una empresa no activa no entra en ninguna de las dos. El filtro corre en el servidor y respeta la paginación. Los dos predicados viven en `fleet_compliance.ENABLEMENT_FILTERS`, no en el router. Para no pagar la base de Pendientes tres veces, el conteo y las facetas salen en **una** consulta (`count` como `FILTER` con el mismo filtro que la página). La lista queda en dos consultas.

### Rulings de la parte C (Tasks 8-10)

**C-R6: qué empresa evalúa la guarda.** La elegida (`carrier_id`) o, si no se eligió, la del conductor (`app.carrier_of('DRIVER', driver_id)`). Es la que `app.resolve_trip_fleet()` le pone al vínculo manual cuando falta (`test_el_padron_llena_la_empresa_que_no_se_pidio`). `POST /trips/assign-driver` **no** evalúa la empresa que el vínculo ya traía del TMS: la persona decide el conductor, no esa empresa. Costo si estuviera mal: una línea en `check_assignments`.
- **C-R7: `POST /trips` sin `carrier_id` no escribe vínculo manual** (comportamiento actual: lo resuelve el trigger). Por eso la guarda no aplica ahí, aunque venga un `driver_id`. El buscador del formulario (`GET /drivers`) ya ofrece solo conductores activos.
- **C-R8: `ONBOARDING` bloquea con `CARRIER_NOT_ACTIVE` (confirmado por el usuario).** En onboarding se le piden documentos, pero no recibe viajes. El mensaje dice que la empresa está en onboarding y que hay que activarla en el Directorio. Una empresa recién creada (pre-cierre, alta desde el Monitor) no recibe viajes hasta que alguien la active.
- **C-R9: `ASSET_INACTIVE` cubre el tracto y la rampla** (la spec dice "tracto"). Una rampla de baja en un viaje es el mismo error.
- **C-R10: el 409 del lote suma `errors`** al `detail`: `{"code", "message", "errors": [{"row", "code", "error"}]}`. Es aditivo al contrato `{code, message}`. `TripBulkUpload.tsx` ya lee `detail.message` y `detail.errors[].row/error`, así que muestra la fila culpable sin cambiar el frontend. En el lote, cada aviso lleva además su `row`.
- **C-R11: `warnings` va siempre en las respuestas de las cinco rutas** (lista vacía si no hay aviso), no solo cuando hay aviso. La forma queda estable para T13/T14.
- **C-R12: búsqueda parcial de RUT y patente por clave.** Además de la igualdad canónica (`canonical_rut(col) = canonical_rut($q)`), se busca por la clave del texto: dígitos y K para el RUT, alfanuméricos para la patente. La clave de RUT exige al menos 4 caracteres y que el texto no traiga letras distintas de K; así "Transportes 2000" no busca RUT. La expresión SQL de la clave vive una sola vez, en `app/utils/identity.py` (`rut_matches_sql`, `plate_matches_sql`), y no como función nueva de la base: la migración de la T2 es solo de hechos de la flota.
- **C-R13: fuera de la T9, con trinquete.**
  - El buscador del Monitor (`GET /trips?q`, `trips.py:795`): no está en §7.2 y las patentes del viaje son texto crudo del TMS.
  - Los `upper(trim(license_plate))` de `services/pre_cierre.py` (`:211`, `:346`, `:356`): el Cierre no se toca (§6.3).
  - Los dos quedan para D3. El test de la T10 les pone un trinquete para que no crezcan.
- **C-R14: las guardas de la T10 son trinquetes durante los despliegues 1 y 2.** Cada regla tiene un tope por archivo, medido al cerrar la T7, que solo puede bajar. La T16 los lleva a 0, salvo los dueños (`vencimientos.py`, `fleet_compliance.py`). Un "cero estricto" hoy rompería con los lectores que la T16 contrae.
- **C-R15 (RESUELTO): `matcher_io.cargar_universo` usa `FUNNEL_ACTIVE_STATUSES`** (`matcher_io.py:9`, `:98`) para el universo de Sin clasificar. Decisión del orquestador: `ONBOARDING` se queda en esa tupla en forma permanente. Sin clasificar no cambia.
- **C-R16: "conductor habitual" en la guarda (§7.1).**
  - `POST /assets/{id}/driver-assignment` rechaza con 409 un conductor o un equipo de baja (`DRIVER_INACTIVE`, `ASSET_INACTIVE`). No evalúa la empresa: no es un viaje.
  - El tracto que `/drivers` y `/fuzzy-match` autocompletan sale solo si está activo.
  - `/driver-candidates` ya filtra (`trips.py:2253`).
  - Si la T7 ya filtró el tracto al deduplicar `/drivers`, ese paso de la T8 se salta.
- **C-R17 (aceptado): el ledger de rulings y mutaciones de D1** es `docs/superpowers/plans/2026-10-12-directory-d1-rulings.md`.
- **C-R18 (aceptado): la migración no trae `BEGIN;`/`COMMIT;`.** El ensayo la envuelve en su propio `BEGIN … ROLLBACK`, y `apply_migration` la aplica en una transacción. Antes de ensayar se verifica con `grep -nE '^\s*(BEGIN|COMMIT)\s*;' <archivo>` (debe dar vacío): un `COMMIT` adentro confirmaría el ensayo.

### Rulings de la parte D (Tasks 11-13)

Los marcados **[backend]** piden algo que el contrato de hoy no trae. Sin ellos, la tarea de frontend no se puede cerrar como
está escrita. Que el orquestador los asigne a la tarea del despliegue 1 que toca ese lector, o que los rechace. Para cada uno
dejo el costo si se rechaza.

- **D-R6 [backend]: filtro por habilitación en la lista del Directorio.** Las pestañas Todas / Pendientes / Al día filtran
  en el servidor por `compliance_health`, que hoy marca a las 251 empresas como PENDING. Además el backend pagina (100 por
  página), así que el frontend no puede filtrar por `compliance_summary.can_operate` sobre una sola página. Propuesta, aditiva
  en el despliegue 1 y en la tarea que agrega `compliance_summary` a `GET /carriers`:
  - parámetro `enablement: "enabled" | "not_enabled" | ""`;
  - facets `enabled` y `not_enabled` al lado de `pending` y `ok`;
  - `enabled` ⇔ `can_operate`; `not_enabled` ⇔ `operational_status = 'ACTIVE' AND NOT can_operate`. Las no activas nunca
    cuentan como "No habilitada" en una cola (spec §3).
  - Si se rechaza: la Task 13 deja las pestañas de documentación con el criterio viejo y solo cambia las etiquetas. Eso sería
    la palabra nueva sobre el dato equivocado, así que **no lo recomiendo**.
- **D-R7 [backend]: los registros del panel de conductor y del de equipo traen el estado.** `DocumentChecklist` es el mismo
  componente para la ficha de conductor (`GET /drivers/{id}/compliance-records`, `drivers.py:397`) y la de equipo (`GET
  /assets/{id}/compliance-records`, `assets.py:262`). El contrato solo agrega `document_state`, `days_to_expiry` y
  `alert_severity` a `GET /carriers/{id}`. Sin los otros dos endpoints, `nodeState` no se puede retirar (§6.2). Propuesta:
  los dos `SELECT` suman las mismas tres columnas con las mismas funciones (`document_state_sql`, `days_to_expiry_sql`,
  `alert_severity_sql`). Son tres líneas por endpoint.
  - Si se rechaza: `ChecklistItem` queda con dos fuentes de estado hasta el despliegue 3.
- **D-R8: el par de chips de conductor y equipo es ciclo de vida + resumen documental, no "Habilitado".** En el §3, la
  habilitación se define para la empresa. Además, `enablementStyle` no recibe el tipo de entidad, así que diría "Habilitada"
  a un conductor. Por eso el segundo chip de conductor y equipo es `summaryStyle(compliance_summary, activo)`: el peor estado
  (Vencido · Falta · Por vencer · Al día), en gris si no está activo. Costo si estuviera mal: agregar un parámetro `kind` a
  `enablementStyle`, con sus etiquetas en masculino.
- **D-R9: la vista rápida pinta las cifras con `compliance_summary`.** `documents.{expired,expiring,missing}` sale del cálculo
  viejo de `entity_summary.py:24-37`, y el contrato no dice que se corrija. La barra toma `overdue`, `expiring` y `missing` de
  `compliance_summary.own` (la cifra única), y `ok` y `attention` de `documents`, que no tienen equivalente nuevo. Para una
  empresa, una línea aparte muestra `compliance_summary.fleet`. Costo si el backend corrige `documents` en su lugar (como
  D1-R3): ninguno, las dos fuentes coinciden.
- **D-R10: `FleetAssignSection` deja de descartar en silencio la empresa no activa.** Hoy `pick` (`:51-53`) pone
  `carrier_id: null` si la empresa no está ACTIVE (bloque 0, R10). Con la guarda 409, eso es una segunda regla en el cliente:
  deja crear el viaje sin empresa para el conductor de una empresa de baja, que es justo lo que el §7.1 quiere impedir.
  - Lo nuevo: la empresa se autocompleta tal cual y el formulario muestra su ciclo de vida con el chip del glosario. La API
    responde 409 `CARRIER_NOT_ACTIVE` y el diálogo muestra su mensaje.
  - El test del bloque 0 `no autocompleta una empresa dada de baja (R10)` **fija la regla vieja** y se reemplaza.
  - Costo: quien hoy crea un viaje así recibe el 409 y tiene que regularizar el Directorio. Es lo que pide la spec.
- **D-R11: exportaciones de `lib/states.ts` además de las del contrato.** Son aditivas y no renombran nada:
  - estilos y predicados: `summaryStyle`, `fleetMemberStyle`, `documentEvidenceStyle`, `isCarrierDeactivated`,
    `CARRIER_DEACTIVATED_LABEL`, `isBlocking`;
  - conteos y texto: `documentStateCount`, `stateCountsLine`, `documentStateCounts`;
  - constantes: `SEVERITY_ORDER`, `BLOCKING_STATES`, y las etiquetas de grupo `CARRIER_LIFECYCLE_GROUP_LABELS` ("Activas",
    "Dadas de baja", "En onboarding"), `ENABLEMENT_GROUP_LABELS` ("Habilitadas", "No habilitadas") y
    `DOCUMENT_STATE_GROUP_LABELS` ("Vencidos", "Por vencer", "Faltan").

  Sin ellas, las pestañas y los plurales quedarían escritos a mano en los componentes, y el test de guarda no podría llegar
  a 0.
- **D-R12: el balde "falta" de `FiltroDeEstado` se rotula "Vencido o falta".** El resumen de Certificación
  (`complianceApi.summary`) parte en `al_dia / por_vencer / falta`, y `falta` junta OVERDUE con MISSING. El despliegue 1 no
  cambia esa partición. El glosario no tiene una palabra para los dos juntos, así que la etiqueta se arma con las dos del
  glosario. Separarlos exige que el resumen traiga `vencido`. Queda fuera de D1, o es una línea si el orquestador lo suma a
  la tarea backend del resumen.
- **D-R13: `StatusChip` recibe `icon?: LucideIcon`.** Una variante es una prop. Desaparecen `ChipDeBaja.tsx` y
  `ComplianceBadge.tsx`: el primero es el chip de ciclo de vida, y el segundo solo lo usaba `TransporterDocumentsPanel`.
- **D-R14: el test de guarda tolera la misma palabra en otro dominio, con motivo escrito.** Quedan fuera:
  - usuario activo (`components/admin/UsersTable.tsx`);
  - lugar activo (`components/dashboard/LocationsTable.tsx`);
  - indicadores del viaje (`IndicatorSwitches.tsx`, `lib/utils/alertSignals.ts`);
  - vigencia de póliza: `app/dashboard/insurance/page.tsx` ("Por vencer", "Al día") y `lib/insurance.tsx`. Seguros no es
    Certificación (memoria "Seguro de Certificación ≠ Seguros").

  Un test aparte falla si un archivo de la lista deja de contener la palabra, para que la lista no se pudra.
- **D-R15: `vigenciaDeLaFila`, `RenglonPendiente` y la ficha de Certificación leen `document_state`, no `urgencia`.**
  `urgencia` ya es un `CASE` sobre `document_state` (`compliance.py:599-607`), así que cambiar de campo no cambia ninguna
  fila. Lo único visible: "Todavía no se exige" pasa a "Aún no se exige", la palabra del glosario.
- **D-R16: el select manual de `DocumentChecklist` ofrece solo lo que se guarda.** Esos valores son `MISSING` y
  `APPROVED_MANUAL` (auditoría B). Se rotulan como historial del archivo ("Sin cargar", "Aprobado a mano"), nunca como
  estado. Hoy ningún panel pasa `onStatusChange`, así que nadie ve el cambio.

### Rulings de la parte E (Tasks 14-16)

Estado tras el ensamblado (orquestador, 12/10): R-E1 confirmada; R-E2, R-E3, R-E4, R-E6 y R-E10 a R-E13 aceptadas; R-E5
resuelta sin acción del usuario; R-E7 resuelta por la Task 5; R-E8 reemplazada por la lista de etiquetas de la Task 11.

- **R-E1 (confirmada): nombres de los campos del Monitor.** `GET /trips` expone por entidad, con el patrón de
  `trips.py:581-586` (la Task 7 implementa exactamente estos nombres):
  - `driver_has_critical_alert`, `tractor_has_critical_alert`, `carrier_has_critical_alert` (`boolean`, NULL si la entidad no
    está resuelta, igual que `*_pending_docs`);
  - `carrier_can_operate` (`boolean | null`).
- **R-E2 (aceptada): `funnel_bucket` de una empresa no activa.** La API manda `funnel_bucket = NULL` cuando
  `operational_status <> 'ACTIVE'`, incluida ONBOARDING (la spec, §3, dice que una no activa no se cuenta como "No
  habilitada" en las colas). El frontend de la Task 14 tampoco balda ninguna fila no activa aunque llegue un valor.
  - **Decisión del usuario:** ONBOARDING se queda **para siempre** en `FUNNEL_ACTIVE_STATUSES` (`compliance.py:35`) y en Sin
    clasificar. No puede recibir viajes manuales. La Task 16 **no** la saca de esa tupla.
  - Consecuencia: el alcance `active` trae a las ONBOARDING y a las no activas con archivos sin clasificar
    (`compliance.py:221`). Las ONBOARDING se ven en la pestaña "En onboarding" sin pedir el catálogo; las dadas de baja con
    archivos, en "Dadas de baja". Ninguna entra a un balde, y sus archivos siguen en Sin clasificar.
- **R-E3: Configuración › Alertas de vencimiento.** D1-R4 filtra solo el GET. Desde el despliegue 2 se propone también:
  - `PATCH /config/alert-thresholds/{doc_type}` responde 404 si `doc_type` no es la fila global;
  - y valida que `error_days < warning_days`, porque si el crítico fuera mayor o igual que el aviso, un documento estaría en
    aviso crítico antes de estar Por vencer, y el texto de la pantalla mentiría;
  - la enumeración revisable `expiry-alerts` (`revisiones.py:78`) se filtra a la fila global. Si no, la portada de
    Configuración cuenta 9 elementos "sin revisar" que nadie puede ver.
- **R-E4: la meta de trips (`trips.py:1167`).** No se toca en la Task 14 y se retira en la Task 16. Motivos:
  - el grep muestra cero lectores en el frontend;
  - retirarla en el despliegue 2 sería un cambio de API sin beneficio;
  - después del borrado del despliegue 3 llevaría una sola fila que nadie lee.

  En la Task 16 sale junto con `AlertThresholdMeta`, el campo de `TripsMeta`, los 7 fixtures y la invalidación de la caché
  de meta en el PATCH (`config.py:265`).
- **R-E5 (resuelta, sin acción del usuario): el rojo del Monitor.** Cada `*_has_critical_alert` vale `true` si la entidad
  tiene un registro con `alert_severity = 'critical'` **o**, solo para el conductor, un pendiente de los códigos críticos
  (`LICENCIA_CONDUCIR`, `COPIA_CI_CONDUCTOR`; `_DRIVER_CRITICAL_DOC_CODES`). Así se conserva lo que pidió el usuario el 22/07:
  una licencia o una cédula que falta o venció sigue poniendo rojo el badge, aunque el crítico global sea `error_days = 0`.
  - Lo calcula la Task 7; el frontend solo lee el booleano.
  - El Cierre conserva su sugerencia propia con los mismos códigos (§6.3; `daily_closures.py:33,56,93` no se toca).
  - Por eso el texto del banner del panel y de Configuración no dice "vence dentro del plazo crítico", sino que nombra las
    dos causas.
- **R-E6: `pending_mandatory` de `/compliance-records/status`** (`compliance.py:422`). Lo leen las agrupaciones por conductor,
  vehículo y requisito (`CertificationStatusTable.tsx:179`), y el contrato no les da un `compliance_summary`. La Task 16
  retira solo el de `carriers.py` (Directorio y roster). Si la guarda de la Task 10 prohíbe la palabra en todo el backend, se
  acota a `carriers.py`.
- **R-E7 (resuelta): el filtro `health` y los `facets` de `GET /carriers`** (`carriers.py:103-170`). La Task 5 agrega el
  parámetro `enablement` (`"enabled" | "not_enabled" | ""`) y los facets `enabled` y `not_enabled`, y la Task 13 pasa las
  pestañas del Directorio a ellos. La Task 16 retira el parámetro `health`, `_CARRIER_HEALTH_VALUES`, los facets `pending` y
  `ok` y `compliance_health`.
- **R-E8 (reemplazada): las etiquetas de ciclo de vida.** La Task 13 no exporta las pestañas. La Task 11 exporta
  `CARRIER_LIFECYCLE_GROUP_LABELS` ("Activas", "Dadas de baja", "En onboarding"), y la Task 14 arma sus pestañas desde esas
  etiquetas en vez de escribir una segunda lista (memoria "una lista escrita tres veces"). Lo único local del embudo es qué
  códigos agrupa cada pestaña. `DirectorioResumen` usa las mismas etiquetas.
- **R-E9: exportaciones aditivas.** No se renombra nada del contrato. Se agregan:
  - en `lib/states.ts` (complementa D-R11 de la Parte D): `FUNNEL_BUCKET_ORDER`, `funnelBucketStyle` (el tipo `FunnelBucket`
    ya vive en `lib/types.ts`, Task 11) y, si la Task 11 no dio acceso por
    booleano, `enablementStyleFromFlag(canOperate, lifecycleActive)`, que `enablementStyle` pasa a llamar (una sola tabla);
  - en `components/ui/StatusChip.tsx`: `STATUS_TONE_CLASS`, el mismo mapa `TONE` exportado, para el badge compacto.
- **R-E10: alcance del cambio de nombres.**
  - `PuenteALaBandeja`, `refrescarBandeja` y la ruta `/dashboard/compliance/inbox` se quedan: renombrarlos es churn y la
    regla es "rutas en inglés, etiqueta en español". Cambian solo los textos visibles.
  - "Revisar en Empresas" de `FlotaDelDiaSection.tsx:818` está en el Cierre (§6.3): cambia solo la etiqueta, a
    "Revisar en Directorio", sin tocar la lógica.
  - Las migas "Empresas" de `compliance/[carrierId]/page.tsx:770` apuntan a la portada de Certificación, que en el menú se
    llama "Empresas" (`Sidebar.tsx:65`), así que se quedan.
- **R-E11: copia de las filas por documento en `audit_log`.** `entity_id` es `uuid NOT NULL` y `alert_thresholds` tiene PK
  de texto. Se propone:
  - `entity_id = md5('app.alert_thresholds:' || doc_type)::uuid`, determinístico, para encontrar la fila desde la clave;
  - `entity_type = 'ALERT_THRESHOLD'`, `action = 'delete'`, `doc_code = doc_type`, `old_value = to_jsonb(fila)`,
    `source = 'migration'`.

  La fila `compliance_min_pct` ("Cumplimiento mínimo para habilitar empresa (%)") también se borra. No es un documento, no
  la lee nadie, y la regla de habilitación de D1 no usa porcentajes.
- **R-E12: `expired_count` del embudo** (`compliance.py:372`) se retira en la Task 16 junto con `funnel_group`:
  - tras la Task 14 no tiene lector;
  - es la cuarta definición de "vencido" (suma `status = 'EXPIRED'`, conflicto 7).
- **R-E13: `{driver,tractor,carrier}_pending_docs_critical` de `GET /trips`** se retiran en la Task 16. El frontend deja de
  leerlos en la Task 14. `driver_pending_docs_critical` del Cierre (`daily_closures.py:56`, `lib/types.ts:1375`) se queda.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `../supabase/migrations/20261013090000_directory_one_answer.sql` (crear) | `app.active_fleet`, `app.carrier_of`, `carrier_management_types` sobre los tractos de la flota activa, CHECK de `operational_status` (Task 2; se aplica en la Task 10). |
| `tests/d1_subjects.py` (crear) | `MIGRATION_D1`, `CHECKS_MARKER`, `fleet_facts_sql()` y `apply_fleet_facts(conn)`: hechos de la flota sin los CHECK. Las Tasks 5-9 suman aquí sus fábricas de sujetos (Task 2). |
| `tests/test_d1_equivalence_integration.py` (crear) | Equivalencia de Directorio, vista rápida y embudo contra Pendientes, con un xfail estricto por lector (Task 1; lo quitan las Tasks 5 y 6). |
| `tests/test_directory_one_answer_migration_integration.py` (crear) | Vista, función y CHECK de la migración, en transacción revertida (Task 2). |
| `app/schemas/states.py` (crear) | Glosario del backend: `Literal` por capa, `SEVERITY_ORDER`, `BLOCKING_STATES`, `StateCounts`, `ComplianceSummary` (Task 3). |
| `app/schemas/carrier.py`, `driver.py`, `asset.py` (modificar) | `OperationalStatus` pasa a ser el alias del glosario (Task 3). |
| `app/services/vencimientos.py` (modificar) | `_ASIGNACIONES` sube; `ingreso_sql`, `exigible_sql` y `exigible_desde_sql` por tipo de entidad (Task 3, B-8). |
| `tests/test_states.py` (crear) | El glosario no se desalinea de `vencimientos` ni de los schemas (Task 3). |
| `tests/test_exigible_by_entity_type_integration.py` (crear) | B-8 contra la base (Task 3). |
| `app/services/fleet_compliance.py` (crear) | Base de Pendientes mudada (`pending_base_ctes`, `_empresa_que_dejo_sql`), `entity_compliance_cte`, `carrier_compliance_cte`, `summary_from_row`, `days_to_expiry_sql`, `alert_severity_sql` (Task 4). |
| `app/routers/compliance.py` (modificar) | Importa `pending_base_ctes` y `_empresa_que_dejo_sql`; sin cambios de salida (Task 4). |
| `tests/test_fleet_compliance.py` (crear) | Piezas sin base: `summary_from_row`, CTE sin parámetros, Pendientes compone la misma base (Task 4). |
| `tests/test_fleet_compliance_integration.py` (crear) | Review Focus 1-3, regla de habilitación, D1-R1 y cifras iguales a Pendientes (Task 4). |
| `app/services/fleet_compliance.py` (modificar) | Proyecciones aditivas para los lectores: `compliance_record_columns_sql`, `entity_summary_columns_sql`, `carrier_summary_columns_sql`, `take_summary`, `ENABLEMENT_FILTERS` (Task 5); `carrier_pending_total_sql`, `funnel_bucket_for` (Task 6). |
| `app/schemas/states.py` (modificar) | `FunnelBucket` (Task 6). |
| `app/schemas/carrier.py` (modificar) | `CarrierListItem` con `compliance_summary`; `CarrierListResponse.data: list[CarrierListItem]`; facetas `enabled`/`not_enabled` (Task 5). |
| `app/routers/carriers.py` (modificar) | `_SQL_DIRECTORIO` sobre `app.active_fleet`; filtro `enablement` y sus facetas (R-B14); `compliance_summary` en la lista, la ficha y los dos rosters; estado, días y aviso por documento en la ficha; roster de equipos en vivo (Task 5). |
| `app/routers/drivers.py` (modificar) | Estado, días y aviso en `/{id}/compliance-records` (Task 5); `/drivers` y `/fuzzy-match` con una fila por conductor y `app.carrier_of` (Task 7). |
| `app/routers/assets.py` (modificar) | Estado, días y aviso en `/{id}/compliance-records` (Task 5); 409 `DRIVER_INACTIVE` en el conductor habitual (Task 7). |
| `app/services/entity_summary.py` (modificar) | `compliance_summary`, flota desde `app.active_fleet` y empresa desde `app.carrier_of` (Task 6); `usual_tractor_lateral` (Task 7). |
| `app/routers/compliance.py` (modificar) | Embudo: `compliance_summary`, `funnel_bucket`, `pending_count` corregido, `attributed` con `app.carrier_of`. `carrier_operation_types` sobre `public.carrier_management_types`. Dueño del lote de archivos con `app.carrier_of` (Task 6). |
| `app/routers/trips.py` (modificar) | `driver_/tractor_/carrier_has_critical_alert` desde el lateral, `carrier_can_operate` por página, `/available-drivers` sin duplicar, `carrier_operational_status` en `/driver-candidates` (Task 7). |
| `tests/d1_subjects.py` (extender; lo crea la Task 2 con `apply_fleet_facts`) | Fábricas de sujetos `ZZ-TEST-D1` y umbrales fijados por el test (Tasks 5-7). |
| `tests/test_d1_directory_integration.py` (crear) | Task 5. |
| `tests/test_fleet_compliance_readers.py` (crear) | Unidad de `take_summary` y `funnel_bucket_for` (Tasks 5-6). |
| `tests/test_d1_quick_view_and_funnel_integration.py` (crear) | Task 6. |
| `tests/test_d1_monitor_integration.py` (crear) | Task 7. |
| `tests/test_d1_equivalence_integration.py` (modificar) | Se quitan los `xfail` del Directorio (Task 5), la vista rápida y el embudo (Task 6). |
| `tests/test_carriers.py` (modificar) | Mocks con las columnas del resumen y las facetas nuevas; el roster de equipos ya no lee la vista materializada; `enablement` inválido da 422 (Task 5). |
| `tests/test_compliance_pending_docs.py` (modificar) | Conteos del lateral con la columna `has_critical_alert` y los tres campos por entidad en `_TRIP_SELECT` (Task 7). |
| `tests/test_compliance.py` (modificar, solo si hace falta) | Mocks del embudo agrupado por empresa con las columnas del resumen (Task 6). |
| `app/services/assignment_guard.py` (crear) | Guarda de asignación compartida: `AssignmentSubjects`, `AssignmentCheck`, `check_assignments`, `enforce_assignment` y los códigos `CARRIER_NOT_ACTIVE`, `DRIVER_INACTIVE`, `ASSET_INACTIVE`, `CARRIER_NOT_ENABLED` (T8). |
| `app/routers/trips.py` (modificar) | `create_trip`, `bulk_create_trips`, `assign_fleet_link` y `assign_driver_bulk` pasan por la guarda; `_assignment_subjects`; `warnings` en las respuestas (T8). `_activo_de_la_patente` con `canonical_plate` (T9). |
| `app/routers/assets.py` (modificar) | El conductor habitual pasa por la guarda (T8). |
| `app/routers/drivers.py` (modificar) | Tracto habitual solo si está activo (T8, si la T7 no lo hizo). RUT canónico en `/drivers?q` y en `/fuzzy-match` (T9). |
| `app/utils/identity.py` (crear) | `rut_check_digit`, `canonical_rut`, `canonical_plate`, `plate_in_tokens`, `rut_matches_sql`, `plate_matches_sql` (T9). |
| `app/services/document_matcher.py` (modificar) | `extract_ruts`, `match_document`, `_from_manifest` y `match_owner` con `identity` (T9); sale `rut_dv` y `_plate_in_tokens`. |
| `app/routers/carriers.py` (modificar) | `q` de `GET /carriers`, `GET /carriers/insurance-overview` y `/buscar` con `rut_matches_sql`/`plate_matches_sql` (T9). |
| `app/routers/compliance.py` (modificar) | `q` de `GET /pending` con RUT de empresa y patente canónicos (T9). |
| `tests/d1_subjects.py` (modificar; lo crea la T2) | `make_test_fleet(...)` (T8), al lado de `apply_fleet_facts(conn)`. |
| `tests/test_assignment_guard_integration.py` (crear) | T8, incluido `test_bulk_con_un_conductor_de_baja_no_escribe_nada`. |
| `tests/test_assignment_guard_wiring.py` (crear) | T8: toda escritura de vínculo pasa por la guarda. |
| `tests/test_asignar_conductor.py`, `tests/test_crear_viaje_manual_integracion.py`, `tests/test_trip_assignment_integration.py` (modificar) | Sujetos creados por el test en vez de elegidos de producción (T8). |
| `tests/test_identity.py` (crear) | T9, puro: normalizador, `match_document`, `match_owner`. |
| `tests/test_identity_integration.py` (crear) | T9: `test_paridad_normalizador_python_y_base`, `test_rut_con_y_sin_puntos_encuentra_la_misma_empresa` y los buscadores. |
| `tests/test_d1_single_definition_guards.py` (crear) | T10: guardas de definición única (trinquetes). |
| `monitor-app/backend/supabase/migrations/20261013090000_directory_one_answer.sql` (aplicar) | Ensayo con ROLLBACK y aplicación (T10; el archivo es de la T2). |
| `docs/superpowers/plans/2026-10-12-directory-d1-rulings.md` (modificar) | Ronda de mutación del despliegue 1 (T10). |
| `AGENTLOG.md` (modificar) | Entrada del despliegue 1 (T10). |
| `monitor-app/frontend/lib/states.ts` (crear) | El glosario en código: tipos (`DocumentState`, `AlertSeverity`, `EntityKind`, `StateCounts`, `ComplianceSummary`, `StateStyle`) y los cuatro diccionarios valor → etiqueta, tono e ícono, más las extras de D-R11 (T11). |
| `monitor-app/frontend/lib/states.test.ts` (crear) | Etiquetas, tonos, género, gris si no está activa, plurales (T11). |
| `monitor-app/frontend/lib/states.guard.test.ts` (crear) | Trinquetes: etiquetas de estado escritas a mano fuera de `lib/states.ts` y lecturas de campos de recálculo (T11; T12-T14 los bajan, T16 los deja en 0). |
| `monitor-app/frontend/lib/states.fixtures.ts` (crear) | `complianceSummary()` y `recordStateFields()` para los fixtures de test (T11). |
| `monitor-app/frontend/lib/status.test.ts` (borrar) | Lo absorben `states.test.ts` y el test de guarda (T11). |
| `monitor-app/frontend/lib/types.ts` (modificar) | Sin diccionarios de estado: re-exporta los tipos de `lib/states.ts`; campos nuevos de la API; `OperationalStatus` sin `LEGACY_INACTIVE` (§4.4) (T11). |
| `monitor-app/frontend/lib/compliance.ts` (modificar) | `vigenciaDeLaFila` sobre `document_state`, `dueRelative(days)` y `fileHistoryLabel` (T11). Sin `COMPLIANCE_STATUS_CONFIG`, `evidenciaDeDocumento` ni `complianceAlertStatus` (T12). |
| `monitor-app/frontend/lib/pending.ts` (modificar) | Etiquetas y tonos de `documentStateStyle` (T11). |
| `monitor-app/frontend/lib/identity.ts` (crear) | `canonicalRut`, `canonicalPlate`, `rutSearchKey`, `plateSearchKey`, espejo de `public.canonical_rut` / `canonical_plate` (T13). |
| `monitor-app/frontend/components/ui/StatusChip.tsx` (modificar) | Prop `icon` (T11). |
| `monitor-app/frontend/components/ui/DocumentStatusBar.tsx` (modificar) | Etiquetas del glosario, cifras de `compliance_summary`, prop `fleet` (T13). |
| `monitor-app/frontend/components/compliance/pending/PendingHoldersPanel.tsx` (modificar) | Pestañas con `DOCUMENT_STATE_GROUP_LABELS` (T11). |
| `monitor-app/frontend/components/compliance/RenglonPendiente.tsx` (modificar) | Tono según `document_state` (T11). |
| `monitor-app/frontend/components/dashboard/TransporterCard.tsx` (modificar) | Sin `STATUS_CLS`; chip de ciclo de vida (T11); chip de habilitación (T13). |
| `monitor-app/frontend/components/dashboard/TransporterSlideOver.tsx` (modificar) | Ciclo de vida (T11); documentos y habilitación desde la API (T12). |
| `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx` (modificar) | Estado de la API; sin `nodeState` ni `checklistCompletion`; el select solo con lo que se guarda (T12). |
| `monitor-app/frontend/lib/utils/complianceChecklist.ts` (modificar) | Mapea `document_state`, `days_to_expiry` y `alert_severity` (T11 los suma; T12 quita `is_expired`/`is_expiring_soon`). |
| `monitor-app/frontend/components/dashboard/TransporterAlertBanner.tsx` (modificar) | Lista lo que bloquea según la API (T12). |
| `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx` (modificar) | `StatusChip` con `document_state`; historial con `fileHistoryLabel` (T12). |
| `monitor-app/frontend/components/dashboard/ComplianceBadge.tsx` (borrar) | Su único lector pasa a `StatusChip` (T12). |
| `monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx`, `VehicleDetailPanel.tsx` (modificar) | Anillo con `documentStateCounts` (T12). |
| `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx` (modificar) | Dos chips en la cabecera, resumen y pestaña Documentos con `compliance_summary` (T12); roster por `worst_state` y filtro canónico de RUT y patente (T13). |
| `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx` (modificar) | Chip de habilitación; `FilaDocumento` con `document_state`; partición por `document_state` (T12, D1-R5). |
| `monitor-app/frontend/app/dashboard/carriers/page.tsx` (modificar) | Pestañas del glosario; habilitación con `enablement` (D-R6) (T13). |
| `monitor-app/frontend/app/dashboard/insurance/page.tsx` (modificar) | "Dadas de baja" (T13). |
| `monitor-app/frontend/components/compliance/FiltroDeEstado.tsx` (modificar) | Escala del glosario (T13, D-R12). |
| `monitor-app/frontend/components/dashboard/DriverRosterCard.tsx`, `VehicleRosterCard.tsx` (modificar) | El par ciclo de vida + resumen (T13, D-R8). |
| `monitor-app/frontend/components/dashboard/ChipDeBaja.tsx` (borrar) | Lo reemplaza `StatusChip` con `fleetMemberStyle` (T13). |
| `monitor-app/frontend/components/dashboard/ResultadosDelDirectorio.tsx` (modificar) | `StatusChip` con `fleetMemberStyle` (T13). |
| `monitor-app/frontend/components/dashboard/EntityQuickView.tsx` (modificar) | Los dos chips y la línea de flota (T13). |
| `monitor-app/frontend/components/dashboard/FleetAssignSection.tsx` (modificar) | Sin la regla del cliente; muestra el ciclo de vida de la empresa (T13, D-R10). |
| `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx` (modificar) | Mensaje del 409 y aviso `CARRIER_NOT_ENABLED` (T13). |
| `monitor-app/frontend/lib/api/carriers.ts`, `lib/api/trips.ts` (modificar) | `enablement`; tipos de respuesta con `warnings` (T13). |
| `app/routers/config.py` (modificar) | GET de alertas filtrado a la fila global; PATCH solo de la global, con `error_days < warning_days` (T14); sin invalidar la meta (T16). |
| `app/services/revisiones.py` (modificar) | La enumeración `expiry-alerts` cuenta solo la fila global (T14). |
| `app/services/vencimientos.py` (modificar) | `GLOBAL_ALERT_THRESHOLD = "documento_por_vencer"`, salvo que T4 ya haya dejado la constante (T14). |
| `tests/test_alert_thresholds_global_only.py` (crear) | T14: GET, PATCH y revisión solo de la fila global. |
| `tests/test_revisiones.py` (modificar) | El PATCH de ejemplo pasa de `LICENCIA` a la fila global (T14). |
| `app/routers/carriers.py` (modificar) | Se retiran `_pending_mandatory_join`, `_CARRIER_LIST_AGG`, el parámetro `health`, `_CARRIER_HEALTH_VALUES`, los facets `pending`/`ok`, `compliance_health` y `pending_mandatory` (T16). |
| `app/routers/compliance.py`, `app/schemas/compliance.py` (modificar) | Se retiran `urgencia` (CASE, clave de fila, campo del schema), `funnel_group` con `'catalogo'` y `expired_count`; `_SUMMARY_SQL` agrupa sobre `document_state` (T16). |
| `app/routers/trips.py` (modificar) | Se retiran `alert_thresholds` y `AlertThresholdMeta` de la meta, y `*_pending_docs_critical` de la lista (T16). |
| `app/schemas/carrier.py` (modificar) | `CarrierListFacets` sin `pending`/`ok` (quedan los de la Task 5, R-E7) (T16). |
| `app/cache.py` (modificar) | Comentario de la meta sin `alert_thresholds` (T16). |
| `../supabase/migrations/20261015090000_retire_per_document_alert_thresholds.sql` (crear) | Copia las 9 filas por documento en `audit_log` y las borra, re-ejecutable (T16). |
| `tests/test_retire_alert_thresholds_migration_integration.py` (crear) | T16: la migración deja solo la global, guarda la copia y se puede correr dos veces. |
| La guarda de la Task 10 (modificar) | Lista de excepciones vacía (T16). |
| `lib/states.ts` (+ test) (modificar) | `FUNNEL_BUCKET_ORDER`, `funnelBucketStyle` y `enablementStyleFromFlag` (R-E9) (T14). Trinquete de etiquetas: lista que baja (T14) y en 0 (T16). |
| `components/ui/StatusChip.tsx` (modificar) | Exporta `STATUS_TONE_CLASS` (T14). |
| `components/ui/ComplianceCounts.tsx` (+ test) (crear, si la Task 13 no dejó uno) | Cifras vencidos, por vencer y faltan desde `ComplianceSummary` (T14). |
| `components/compliance/CertificationFunnel.tsx` (+ test) | Baldes de `funnel_bucket`; ciclo de vida como filtro; cifras del resumen (T14). |
| `app/dashboard/compliance/page.test.tsx` | Fixture con `funnel_bucket` y `compliance_summary` (T14); sin `funnel_group` (T16). |
| `components/compliance/DirectorioResumen.tsx` (+ test) | "dadas de baja" en vez de "inactivas", desde `CARRIER_LIFECYCLE_GROUP_LABELS` (T14). |
| `components/ui/PendingDocsBadge.tsx` (+ test) | Tono e ícono del aviso desde `alertSeverityStyle`, sin colores crudos (T14). |
| `components/dashboard/TripTable.tsx`, `GestionPanel.tsx` (+ `TripDetailView.test.tsx`, `TripTable.test.tsx`) | `*_has_critical_alert` y `carrier_can_operate`; "revisar en Directorio" (T14). |
| `app/dashboard/admin/settings/umbrales-tabs.tsx` (+ test) | Alertas de vencimiento: un aviso y un crítico globales con su texto (T14). |
| `lib/api/config.ts` | `GLOBAL_ALERT_THRESHOLD` (T14). |
| `components/compliance/PuenteALaBandeja.tsx`, `TriageWorkbench.tsx`, `TriageDropzone.tsx` (+ tests) | "Sin clasificar" en los textos (T14). |
| `components/dashboard/TripAssignDialog.tsx`, `sections/FlotaDelDiaSection.tsx`, `app/dashboard/carriers/[id]/page.tsx` (+ tests) | "Directorio" en los enlaces al Directorio (T14). |
| `lib/copy/module-names.test.ts` (crear) | Guarda: ni "la bandeja" ni "Empresas" como nombre del Directorio en textos de interfaz (T14). |
| `lib/ui/sistema.test.ts` | Tope de colores crudos bajado (T14). |
| `lib/types.ts` | T14: sin cambios (los campos nuevos los agregó la Task 11). T16: sin `ComplianceHealth`, `compliance_health`, `pending_mandatory` del Directorio, `FunnelGroup`, `funnel_group`, `expired_count`, `urgencia`, `*_pending_docs_critical` del viaje y `alert_thresholds` de `TripsMeta`. |
| `components/compliance/RenglonPendiente.tsx`, `app/dashboard/compliance/[carrierId]/page.tsx` | `urgencia` → `document_state`, si la Task 12 no lo hizo (T16). |
| Fixtures `alert_thresholds: []` (7 tests) | Se retiran (T16). |
| `AGENTLOG.md` | Registro de D1 (T15, T16). |

---

### Task 1: Test de equivalencia (se escribe primero y falla hoy)

**Files:**
- Create: `monitor-app/backend/api/tests/test_d1_equivalence_integration.py`

**Interfaces:**
- Consumes (código de hoy):
  - `pending_summary` (`app/routers/compliance.py:695`);
  - `list_carriers` (`app/routers/carriers.py:95`);
  - `carrier_summary` (`app/services/entity_summary.py:166`);
  - `get_certification_status` (`app/routers/compliance.py:167`).
- Produces: tres tests con `@pytest.mark.xfail(strict=True)`, uno por lector, y un test de control sin marca.
  - **Task 5** quita la marca de `test_directorio_cuenta_lo_mismo_que_pendientes`.
  - **Task 6** quita la de `test_vista_rapida_…` y la de `test_embudo_…`.
  - Al quitarla, si el lector ya lee `app.active_fleet` y la Task 10 todavía no aplicó la migración, la tarea agrega `await apply_fleet_facts(conn)` (de `tests/d1_subjects.py`, Task 2) al inicio del test.
  - **Task 16** puede borrar la rama de "legado" del comparador cuando se retiren los campos viejos.

- [ ] **Step 1: Write the test**

Patrón copiado de `tests/test_pending_documents_integration.py`: los handlers se llaman con todos sus parámetros explícitos (los defaults son `Query()`) y `pool=PoolDeUnaConexion(conn)`, como en `_listar` (`:509`) y en las llamadas a `pending_summary` (`:558`). Crear `tests/test_d1_equivalence_integration.py`:

```python
"""D1 "Una sola respuesta" (spec 2026-10-12-directory-d1-one-answer-design.md §8.1):
para toda empresa ACTIVA, Vencidos / Por vencer / Faltan valen lo mismo en el
Directorio, la vista rápida y el embudo de Certificación que en
GET /compliance-records/pending/summary?group_by=carrier.

Es el único test del plan que lee datos de producción: compara dos lecturas de
los mismos datos, dentro de la misma transacción revertida, y no fija cifras.
Hoy falla (F-02): cada lector cuenta otro universo. Cada comparación lleva su
propio xfail(strict=True); la tarea que arregla ese lector lo quita (Task 5:
Directorio; Task 6: vista rápida y embudo). Con strict, si un lector se
arregla sin quitar la marca, la corrida falla (XPASS) y obliga a quitarla."""
from __future__ import annotations

from typing import Callable
from uuid import UUID

import pytest

from app.routers.carriers import list_carriers
from app.routers.compliance import get_certification_status, pending_summary
from app.services.entity_summary import carrier_summary
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

Triple = tuple[int, int, int]  # (overdue, expiring, missing)


async def _activas(conn) -> list[str]:
    return [str(f["id"]) for f in await conn.fetch(
        "SELECT id FROM public.carriers WHERE operational_status = $1 ORDER BY id", "ACTIVE")]


async def _esperado(conn) -> dict[str, Triple]:
    """La respuesta de Pendientes. Una empresa sin fila no debe nada: (0, 0, 0)."""
    resumen = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    return {f["key"]: (f["overdue"], f["expiring"], f["missing"]) for f in resumen["rows"]}


def _desde_resumen(resumen) -> Triple:
    """`compliance_summary` del contrato (Task 4): lo propio más lo de la flota."""
    if hasattr(resumen, "model_dump"):
        resumen = resumen.model_dump()
    own = resumen["own"]
    fleet = resumen.get("fleet") or {"overdue": 0, "expiring": 0, "missing": 0}
    return (own["overdue"] + fleet["overdue"], own["expiring"] + fleet["expiring"],
            own["missing"] + fleet["missing"])


def _diferencias(activas: list[str], esperado: dict[str, Triple], filas: dict[str, dict],
                 legado: Callable[[dict], tuple[str, object]]) -> list[str]:
    """Las empresas cuyo lector no dice lo mismo que Pendientes.

    Con `compliance_summary` (desde la Task 5/6) se compara la terna. Sin él (hoy)
    se compara lo que la pantalla muestra hoy: una terna si el lector ya la
    tiene, o el total si solo trae un número. Así el test falla hoy por la cifra,
    no por un KeyError."""
    malas = []
    for cid in activas:
        fila = filas.get(cid)
        if fila is None:
            malas.append(f"{cid}: el lector no la trae")
            continue
        quiere = esperado.get(cid, (0, 0, 0))
        if fila.get("compliance_summary") is not None:
            dice, compara = _desde_resumen(fila["compliance_summary"]), quiere
        else:
            tipo, valor = legado(fila)
            dice, compara = valor, (quiere if tipo == "triple" else sum(quiere))
        if dice != compara:
            malas.append(f"{cid}: dice {dice}, Pendientes {compara}")
    return malas


def _informe(malas: list[str], activas: list[str], lector: str) -> str:
    # Solo ids: el informe no copia nombres de empresas (memoria "redactar PII").
    return (f"{lector}: {len(malas)} de {len(activas)} empresas activas difieren de Pendientes:\n"
            + "\n".join(malas[:10]))


async def test_el_comparador_dice_igual_cuando_es_igual(conexion_revertida):
    """Control. Pendientes contra sí mismo no difiere: sin esto, un comparador
    roto (siempre rojo) haría pasar por medido un xfail que no mide nada."""
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    filas = {cid: {"compliance_summary": {
        "own": dict(zip(("overdue", "expiring", "missing"), esperado.get(cid, (0, 0, 0)))),
        "fleet": None}} for cid in activas}

    assert _diferencias(activas, esperado, filas, lambda f: ("total", None)) == []


@pytest.mark.xfail(strict=True, reason="F-02: el Directorio cuenta solo los obligatorios propios; lo arregla la Task 5")
async def test_directorio_cuenta_lo_mismo_que_pendientes(conexion_revertida):
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    respuesta = await list_carriers(q="", operational_status="ACTIVE", health="", page=1, limit=100,
                                    pool=PoolDeUnaConexion(conn), _=None)
    assert respuesta["count"] == len(activas) <= 100, "la página no trae a todas las activas"
    filas = {str(f["id"]): f for f in respuesta["data"]}

    malas = _diferencias(activas, esperado, filas, lambda f: ("total", f["pending_mandatory"]))

    assert malas == [], _informe(malas, activas, "Directorio")


@pytest.mark.xfail(strict=True, reason="F-02: la vista rápida cuenta solo lo propio de la empresa; lo arregla la Task 6")
async def test_vista_rapida_cuenta_lo_mismo_que_pendientes(conexion_revertida):
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    filas = {cid: await carrier_summary(conn, UUID(cid)) for cid in activas}

    malas = _diferencias(activas, esperado, filas, lambda f: (
        "triple", (f["documents"]["expired"], f["documents"]["expiring"], f["documents"]["missing"])))

    assert malas == [], _informe(malas, activas, "Vista rápida")


@pytest.mark.xfail(strict=True, reason="F-02: el embudo cuenta la flota de baja (2.306 frente a 2.226); lo arregla la Task 6")
async def test_embudo_cuenta_lo_mismo_que_pendientes(conexion_revertida):
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    respuesta = await get_certification_status(group="carrier", scope="active", carrier_id=None, q="",
                                               limit=500, pool=PoolDeUnaConexion(conn), _=None)
    filas = {f["carrier_id"]: f for f in respuesta["rows"]}

    malas = _diferencias(activas, esperado, filas, lambda f: ("total", f["pending_count"]))

    assert malas == [], _informe(malas, activas, "Embudo")
```

- [ ] **Step 2: Run it without the xfail marks to see it fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_equivalence_integration.py -q --runxfail`

Expected: 3 FAIL y 1 PASS (el control).
- Los tres fallan con `AssertionError: <lector>: N de 36 empresas activas difieren de Pendientes`. Medido el 12/10:
  - Directorio: 36 de 36 (por ejemplo, `dice 8, Pendientes 15`);
  - vista rápida: 36 de 36 (`dice (4, 0, 4), Pendientes (9, 0, 6)`);
  - embudo: 6 de 36 (`dice 63, Pendientes 27`).
- Las cifras pueden moverse con los datos. Lo que tiene que pasar es que cada uno falle **por la cifra**. Si alguno falla por `KeyError`, `TypeError` o un `assert` de la página, se corrige el test y se reporta.

- [ ] **Step 3: Run it with the marks**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_equivalence_integration.py -q`
Expected: `1 passed, 3 xfailed`.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/tests/test_d1_equivalence_integration.py
git commit -m "test(d1): equivalencia de cifras por empresa contra Pendientes

Directorio, vista rápida y embudo cuentan otro universo que Pendientes (F-02):
36, 36 y 6 de 36 empresas activas difieren hoy. Un xfail estricto por lector;
lo quita la tarea que lo arregla (D1, Tasks 5 y 6).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hechos de la flota en la base (migración, sin aplicar)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261013090000_directory_one_answer.sql`
- Create: `monitor-app/backend/api/tests/test_directory_one_answer_migration_integration.py`
- Create: `monitor-app/backend/api/tests/d1_subjects.py`

**Interfaces:**
- Produces (contrato):
  - `app.active_fleet(carrier_id uuid, entity_type text, entity_id uuid)`;
  - `app.carrier_of(p_entity_type text, p_entity_id uuid) RETURNS uuid`;
  - `public.carrier_management_types(uuid)`, sobre los tractos de `app.active_fleet`;
  - `carriers_operational_status_check`, `drivers_operational_status_check` y `assets_operational_status_check`.
- Produces (tests): `tests.d1_subjects.apply_fleet_facts(conn)`, que ejecuta la migración hasta `-- d1:checks` (vista, `carrier_of`, `carrier_management_types`) dentro de la transacción del test, sin los CHECK (ruling A-R9). Las Tasks 5-9 agregan sus fábricas de sujetos en ese módulo.
- No se aplica en esta tarea: se aplica en la Task 10.

- [ ] **Step 1: Create the migration with its header and a placeholder**

El placeholder `SELECT 1;` hace falta. asyncpg no ejecuta un texto que solo trae comentarios: da `AttributeError: 'NoneType' object has no attribute …` (medido), y el test fallaría por otro motivo.

```sql
-- Directorio · D1 "Una sola respuesta" (spec docs/superpowers/specs/2026-10-12-directory-d1-one-answer-design.md §4):
-- los hechos de la flota viven en la base, con una sola definición cada uno.
--
--   app.active_fleet                     qué es la flota activa de una empresa
--   app.carrier_of(tipo, id)             de qué empresa es una entidad
--   public.carrier_management_types(id)  tipos de operación, solo desde los tractos de la flota activa
--   CHECK en operational_status          los ciclos de vida del glosario (§3)
--
-- Sin triggers ni REFRESH nuevos. Re-ejecutable: CREATE OR REPLACE, y los CHECK
-- se agregan solo si no existen. Los tests la corren dentro de su transacción
-- revertida; se aplica en la Task 10 del plan, sin un job de Mage en vuelo.
SELECT 1;  -- placeholder: lo reemplaza el cuerpo en el Step 4
```

- [ ] **Step 2: Write the failing tests**

Patrón copiado de `tests/test_trip_assignment_integration.py` (`MIGRATION`, `apply_migration` dentro de la transacción revertida) y de `tests/test_assignment_start_date_integration.py` (`SET LOCAL lock_timeout = '3s'` antes de un `ALTER TABLE`). Crear `tests/test_directory_one_answer_migration_integration.py`:

```python
"""D1 "Una sola respuesta", hechos de la flota en la base (spec §4): app.active_fleet,
app.carrier_of, public.carrier_management_types y los CHECK de operational_status.

La migración se ejecuta dentro de la transacción revertida de cada test (patrón
de test_trip_assignment_integration.py): se prueba el archivo antes de
aplicarlo. Los sujetos los crea el test, con prefijo ZZ-TEST-D1."""
from __future__ import annotations

import uuid
from pathlib import Path

import asyncpg
import pytest

from tests.d1_subjects import CHECKS_MARKER, apply_fleet_facts, fleet_facts_sql

pytestmark = pytest.mark.integracion

MIGRATION = (Path(__file__).resolve().parents[2]
             / "supabase/migrations/20261013090000_directory_one_answer.sql")
PREFIJO = "ZZ-TEST-D1"


async def apply_migration(conn) -> None:
    # Los CHECK toman un lock exclusivo sobre carriers, drivers y assets hasta el
    # ROLLBACK. Si alguien los tiene tomados, el test falla en 3 s en vez de
    # quedarse esperando (y de hacer esperar a la app detrás suyo).
    await conn.execute("SET LOCAL lock_timeout = '3s'")
    await conn.execute(MIGRATION.read_text())


def _suf() -> str:
    return uuid.uuid4().hex[:6].upper()


async def _tipo(conn, code: str) -> uuid.UUID:
    return await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND code = $1", code)


async def _empresa(conn, estado: str = "ACTIVE", declarado: list[str] | None = None) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status, management_types) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} Empresa {_suf()}", estado, declarado)


async def _conductor(conn, empresa, *, estado: str = "ACTIVE", asignacion: str = "ACTIVE") -> uuid.UUID:
    d = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Conductor {_suf()}", estado)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, $3)",
        d, empresa, asignacion)
    return d


async def _equipo(conn, empresa, *, estado: str = "ACTIVE", asignacion: str = "ACTIVE",
                  tipo: str = "TRACTOCAMION", operacion: str | None = None) -> uuid.UUID:
    a = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, $2, $3, $4) RETURNING id",
        f"ZZ{_suf()[:4]}", tipo, estado, await _tipo(conn, operacion) if operacion else None)
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, $3)",
        a, empresa, asignacion)
    return a


async def _flota(conn, empresa) -> set[tuple[str, uuid.UUID]]:
    return {(f["entity_type"], f["entity_id"]) for f in await conn.fetch(
        "SELECT entity_type, entity_id FROM app.active_fleet WHERE carrier_id = $1", empresa)}


# ── app.active_fleet ─────────────────────────────────────────────────────────

async def test_la_flota_activa_deja_fuera_lo_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    activo = await _conductor(conn, empresa)
    await _conductor(conn, empresa, estado="INACTIVE")          # de baja, con asignación ACTIVE
    await _conductor(conn, empresa, asignacion="INACTIVE")      # activo, ya no asignado
    tracto = await _equipo(conn, empresa)
    await _equipo(conn, empresa, estado="INACTIVE")             # de baja, con asignación ACTIVE

    assert await _flota(conn, empresa) == {("DRIVER", activo), ("ASSET", tracto)}


async def test_la_flota_activa_no_mira_el_estado_de_la_empresa(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    conductor = await _conductor(conn, de_baja)

    assert await _flota(conn, de_baja) == {("DRIVER", conductor)}


async def test_un_conductor_con_dos_tractos_esta_una_vez_en_la_flota(conexion_revertida):
    """Review Focus 2: vehicle_driver_assignments permite un conductor por tracto,
    no un tracto por conductor."""
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    for _ in range(2):
        tracto = await _equipo(conn, empresa)
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
            "VALUES ($1, $2, 'ACTIVE', 'manual', true)", tracto, conductor)

    filas = await conn.fetchval(
        "SELECT count(*) FROM app.active_fleet WHERE entity_type = 'DRIVER' AND entity_id = $1", conductor)
    assert filas == 1


async def test_los_hechos_de_la_flota_se_cargan_sin_los_check(conexion_revertida):
    """El helper de las Tasks 4-9 (A-R9) corta en la marca: crea la vista y las
    funciones, y deja afuera los ALTER TABLE que toman locks exclusivos."""
    conn = conexion_revertida
    assert "ADD CONSTRAINT" not in fleet_facts_sql()
    assert "ADD CONSTRAINT" in MIGRATION.read_text().split(CHECKS_MARKER, 1)[1]
    for linea in MIGRATION.read_text().splitlines():
        assert linea.strip().upper() not in ("BEGIN;", "COMMIT;"), "la migración no maneja su transacción"
    await apply_fleet_facts(conn)
    assert await conn.fetchval("SELECT to_regclass('app.active_fleet')") is not None
    assert await conn.fetchval("SELECT to_regprocedure('app.carrier_of(text, uuid)')") is not None


# ── app.carrier_of ───────────────────────────────────────────────────────────

async def test_carrier_of(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    activa = await _empresa(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    conductor_de_baja = await _conductor(conn, de_baja, estado="INACTIVE")
    sin_empresa = await _conductor(conn, activa, asignacion="INACTIVE")
    tracto = await _equipo(conn, activa, estado="INACTIVE")

    async def de(tipo, entidad):
        return await conn.fetchval("SELECT app.carrier_of($1, $2)", tipo, entidad)

    assert await de("CARRIER", activa) == activa
    # Cualquier estado: la entidad de baja y la empresa de baja siguen diciendo de quién es.
    assert await de("DRIVER", conductor_de_baja) == de_baja
    assert await de("ASSET", tracto) == activa
    assert await de("DRIVER", sin_empresa) is None
    assert await de("SHIPPER", activa) is None


# ── public.carrier_management_types ──────────────────────────────────────────

async def test_el_tipo_de_operacion_ignora_el_tracto_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    await _equipo(conn, empresa, operacion="TRACTOREO")
    await _equipo(conn, empresa, estado="INACTIVE", operacion="EQUIPO_COMPLETO")

    assert await conn.fetchval("SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_el_tipo_de_operacion_sale_del_tracto_no_de_la_rampla(conexion_revertida):
    """E-g de la spec y ruling A-R1 (cambia 1 empresa INACTIVE)."""
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    await _equipo(conn, empresa, operacion="TRACTOREO")
    await _equipo(conn, empresa, tipo="RAMPLA", operacion="EQUIPO_COMPLETO")

    assert await conn.fetchval("SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_sin_tractos_activos_cae_a_lo_declarado(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn, declarado=["TRACTOREO"])
    await _equipo(conn, empresa, estado="INACTIVE", operacion="EQUIPO_COMPLETO")

    assert await conn.fetchval("SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_el_comentario_sigue_nombrando_a_quienes_la_llaman(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    comentario = await conn.fetchval(
        "SELECT obj_description('public.carrier_management_types(uuid)'::regprocedure, 'pg_proc')")
    for llamador in ("reconcile_new_carrier", "reconcile_carrier_shipper_link", "SQL_ENTIDADES_QUE_APLICAN",
                     "app/routers/compliance.py", "app.active_fleet"):
        assert llamador in comentario


# ── CHECK de operational_status ──────────────────────────────────────────────

async def _sujeto(conn, tabla: str) -> uuid.UUID:
    empresa = await _empresa(conn)
    if tabla == "carriers":
        return empresa
    return await (_conductor(conn, empresa) if tabla == "drivers" else _equipo(conn, empresa))


@pytest.mark.parametrize("tabla, valor", [
    ("drivers", "LEGACY_INACTIVE"), ("assets", "LEGACY_INACTIVE"), ("carriers", "PAUSED"),
])
async def test_el_ciclo_de_vida_fuera_del_glosario_se_rechaza(conexion_revertida, tabla, valor):
    conn = conexion_revertida
    await apply_migration(conn)
    fila = await _sujeto(conn, tabla)
    # Un SAVEPOINT: el error no aborta la transacción del fixture.
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await conn.execute(f"UPDATE public.{tabla} SET operational_status = $1 WHERE id = $2", valor, fila)


async def test_la_migracion_se_puede_correr_dos_veces(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    await apply_migration(conn)
    nombres = {f["conname"] for f in await conn.fetch(
        "SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])",
        ["carriers_operational_status_check", "drivers_operational_status_check",
         "assets_operational_status_check"])}
    assert len(nombres) == 3
```

Y crear `tests/d1_subjects.py`, el módulo de apoyo de los tests de D1 (las Tasks 5-9 suman aquí sus fábricas de sujetos):

```python
"""Apoyo de los tests de D1 "Una sola respuesta" (spec
2026-10-12-directory-d1-one-answer-design.md): los hechos de la flota de la
migración, y (desde la Task 5) las fábricas de sujetos ZZ-TEST-D1 que comparten
las tareas. No es un archivo de tests: pytest no lo colecta (no empieza con test_)."""
from __future__ import annotations

from pathlib import Path

MIGRATION_D1 = (Path(__file__).resolve().parents[2]
                / "supabase/migrations/20261013090000_directory_one_answer.sql")
# Todo lo que viene después de esta línea son los CHECK de operational_status.
CHECKS_MARKER = "-- d1:checks"


def fleet_facts_sql() -> str:
    """La migración hasta la marca, sin incluirla: vista, carrier_of y
    carrier_management_types."""
    texto = MIGRATION_D1.read_text()
    corte = texto.find("\n" + CHECKS_MARKER + "\n")
    assert corte != -1, f"no encontré la línea {CHECKS_MARKER!r} en {MIGRATION_D1.name}"
    return texto[:corte]


async def apply_fleet_facts(conn) -> None:
    """Crea los hechos de la flota dentro de la transacción revertida del test.
    Sin los CHECK: un ADD CONSTRAINT toma un lock exclusivo sobre carriers,
    drivers y assets hasta el ROLLBACK, y la app no podría leerlas mientras dure
    el test. Una vez aplicada la migración (Task 10), esto recrea lo mismo y no
    cambia nada."""
    await conn.execute(fleet_facts_sql())
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_directory_one_answer_migration_integration.py -q`

Expected: 13 FAIL (medido con el archivo del Step 1). Los motivos esperados son:

| Test | Falla con |
|---|---|
| `test_la_flota_activa_…`, `test_un_conductor_con_dos_tractos_…` | `asyncpg.exceptions.UndefinedTableError: relation "app.active_fleet" does not exist` |
| `test_los_hechos_de_la_flota_se_cargan_sin_los_check` | `AssertionError: no encontré la línea '-- d1:checks'` |
| `test_carrier_of` | `UndefinedFunctionError: function app.carrier_of(…) does not exist` |
| Los tres de `carrier_management_types` | `AssertionError`: la definición vigente devuelve `['EQUIPO_COMPLETO', 'TRACTOREO']` |
| El del comentario | `AssertionError`: le falta `app.active_fleet` |
| Los tres del CHECK | `Failed: DID NOT RAISE <class 'asyncpg.exceptions.CheckViolationError'>` |
| `test_la_migracion_se_puede_correr_dos_veces` | `assert 0 == 3` |

- [ ] **Step 4: Write the migration body**

Reemplazar la línea `SELECT 1;  -- placeholder …` por:

```sql
-- ── 1. La flota activa ──────────────────────────────────────────────────────
-- Conductores y equipos ACTIVE con asignación ACTIVE. NO filtra el estado de la
-- empresa: la ficha de una empresa dada de baja muestra su flota como historial,
-- y quien llama decide si exige empresa activa (in_scope_sql lo exige).
-- Una fila por entidad: los índices únicos idx_driver_assignments_one_active e
-- idx_asset_assignments_one_active permiten una sola asignación ACTIVE. No pasa
-- por vehicle_driver_assignments: un conductor con dos tractos sigue siendo uno.
CREATE OR REPLACE VIEW app.active_fleet AS
SELECT da.carrier_id, 'DRIVER'::text AS entity_type, d.id AS entity_id
FROM public.drivers d
JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
WHERE d.operational_status = 'ACTIVE'
UNION ALL
SELECT aa.carrier_id, 'ASSET'::text AS entity_type, a.id AS entity_id
FROM public.assets a
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
WHERE a.operational_status = 'ACTIVE';

COMMENT ON VIEW app.active_fleet IS
  'Flota activa: conductores y equipos con operational_status = ACTIVE y asignación ACTIVE, por empresa '
  '(sin filtrar el estado de la empresa). UNICA definición de "flota activa". Llamadores: '
  'public.carrier_management_types(), app/services/fleet_compliance.py (carrier_compliance_cte) y, desde D1, '
  'los conteos de flota del Directorio y la vista rápida.';

REVOKE ALL ON app.active_fleet FROM anon, authenticated;

-- ── 2. De qué empresa es ────────────────────────────────────────────────────
-- CARRIER es la misma empresa. DRIVER y ASSET, la empresa de su asignación
-- ACTIVE, sin importar el estado de la entidad ni de la empresa. Cualquier otro
-- tipo: NULL. En D2 recibe una fecha y lee el historial; quien la llama no cambia.
CREATE OR REPLACE FUNCTION app.carrier_of(p_entity_type text, p_entity_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT CASE p_entity_type
        WHEN 'CARRIER' THEN p_entity_id
        WHEN 'DRIVER'  THEN (SELECT da.carrier_id FROM public.driver_assignments da
                             WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE')
        WHEN 'ASSET'   THEN (SELECT aa.carrier_id FROM public.asset_assignments aa
                             WHERE aa.asset_id = p_entity_id AND aa.status = 'ACTIVE')
    END
$$;

COMMENT ON FUNCTION app.carrier_of(text, uuid) IS
  'Empresa de una entidad: CARRIER es ella misma; DRIVER y ASSET, la de su asignación ACTIVE (cualquier estado); '
  'otro tipo, NULL. Reemplaza los LEFT JOIN sueltos de entity_summary.py, del embudo (compliance.py) y de '
  'daily_closures.py. ultima_empresa_sql (documentos al término) sigue aparte hasta D2.';

REVOKE ALL ON FUNCTION app.carrier_of(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Tipos de operación, solo desde los tractos de la flota activa ────────
-- Misma firma, misma regla ("la flota manda cuando existe, lo declarado cubre el
-- hueco", 20260816050000; por código desde 20260816090000). Cambia solo QUÉ
-- vehículos cuentan: los tractos de app.active_fleet, no cualquier asignación
-- ACTIVE (que incluía equipos dados de baja y ramplas; E-g de la spec: el tipo
-- de operación sale del tracto). Medido el 12/10: cambia 1 empresa, INACTIVE, y
-- ningún requisito usa applies_to_management_types.
CREATE OR REPLACE FUNCTION public.carrier_management_types(p_carrier_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT COALESCE(
        (
            SELECT array_agg(DISTINCT t.code) FILTER (WHERE t.code IS NOT NULL)
            FROM app.active_fleet af
            JOIN public.assets a ON a.id = af.entity_id AND a.asset_type = 'TRACTOCAMION'
            JOIN app.status_taxonomies t ON t.id = a.webcarga_operation_type_id
            WHERE af.carrier_id = p_carrier_id AND af.entity_type = 'ASSET'
        ),
        (SELECT c.management_types FROM public.carriers c WHERE c.id = p_carrier_id)
    );
$function$;

-- El COMMENT de 20260816050000, con la fuente nueva: CREATE OR REPLACE lo
-- conserva, pero describe asset_assignments y ya no sería cierto.
COMMENT ON FUNCTION public.carrier_management_types(uuid) IS
    'Tipo de gestion de una empresa, en codigos (TRACTOREO / EQUIPO_COMPLETO). La flota manda cuando existe (los tractos de app.active_fleet -> assets.webcarga_operation_type_id -> status_taxonomies.code), lo declarado (carriers.management_types) cubre el hueco. UNICA definicion del concepto: la llaman las cuatro ramas CARRIER de siembra (reconcile_new_carrier, reconcile_carrier_shipper_link, las dos de reconcile_new_requirement), la vista previa del recalcular (app/services/requirement_conditions.py, SQL_ENTIDADES_QUE_APLICAN["CARRIER"]) y la pantalla de Certificacion (app/routers/compliance.py). Si cambia esta funcion, cambian los tres lados a la vez -- ese es el punto.';

-- d1:checks
-- ── 4. Los ciclos de vida del glosario ──────────────────────────────────────
-- La marca de arriba separa los CHECK: tests/d1_subjects.apply_fleet_facts
-- ejecuta solo lo anterior, para no tomar locks exclusivos en cada test.
-- Esta migración no lleva BEGIN/COMMIT (la envuelve quien la aplica).
-- Verificado el 12/10: todas las filas cumplen. ADD CONSTRAINT toma un lock
-- exclusivo breve sobre tablas chicas (251, 101 y 139 filas). Solo si no existe:
-- la migración se re-ejecuta en cada test.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.carriers'::regclass AND conname = 'carriers_operational_status_check') THEN
        ALTER TABLE public.carriers ADD CONSTRAINT carriers_operational_status_check
            CHECK (operational_status IN ('ACTIVE', 'ONBOARDING', 'INACTIVE', 'LEGACY_INACTIVE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.drivers'::regclass AND conname = 'drivers_operational_status_check') THEN
        ALTER TABLE public.drivers ADD CONSTRAINT drivers_operational_status_check
            CHECK (operational_status IN ('ACTIVE', 'INACTIVE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.assets'::regclass AND conname = 'assets_operational_status_check') THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_operational_status_check
            CHECK (operational_status IN ('ACTIVE', 'INACTIVE'));
    END IF;
END $$;
```

- [ ] **Step 5: Run them to verify they pass**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_directory_one_answer_migration_integration.py -q`
Expected: `13 passed`.

- [ ] **Step 6: Verificar que la mutación mata el test**

Cada mutación por separado; se corre, se ve el FAIL y se restaura:
1. Borrar `WHERE d.operational_status = 'ACTIVE'` de la vista. Debe fallar `test_la_flota_activa_deja_fuera_lo_dado_de_baja`.
2. Borrar `AND a.asset_type = 'TRACTOCAMION'`. Debe fallar `test_el_tipo_de_operacion_sale_del_tracto_no_de_la_rampla`.
3. En `carrier_management_types`, volver la fuente a `public.asset_assignments aa … WHERE aa.carrier_id = p_carrier_id AND aa.status = 'ACTIVE'`. Debe fallar `test_el_tipo_de_operacion_ignora_el_tracto_dado_de_baja`.
4. Mover la línea `-- d1:checks` debajo del bloque `DO $$ … END $$;`. Debe fallar `test_los_hechos_de_la_flota_se_cargan_sin_los_check`.

Al terminar, `git diff` del `.sql` contra el Step 4 queda vacío.

- [ ] **Step 7: Rehearse against the real database with ROLLBACK**

Mismo método que la Task 1, Step 6 de `docs/superpowers/plans/2026-10-11-trip-assignment-in-the-database.md`. No aplica nada: todo termina en `ROLLBACK`.

```bash
cd monitor-app/backend && set -a && . ./.env >/dev/null 2>&1; set +a; export PGPASSWORD="$SUPABASE_DB_PASSWORD"
psql "postgresql://postgres.viclzoftiudkepqnhekv@aws-1-us-east-1.pooler.supabase.com:5432/postgres" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE TEMP TABLE mt_antes ON COMMIT DROP AS
  SELECT id, public.carrier_management_types(id) AS mt FROM public.carriers;
\i supabase/migrations/20261013090000_directory_one_answer.sql
-- 1. Flota activa de las empresas activas (spec §1: 78 conductores, no 84).
SELECT af.entity_type, count(*) FROM app.active_fleet af
JOIN public.carriers c ON c.id = af.carrier_id AND c.operational_status = 'ACTIVE'
GROUP BY 1 ORDER BY 1;
-- 2. Empresas cuyo tipo de operación cambia (ruling A-R1).
SELECT c.operational_status, count(*) AS cambian
FROM mt_antes m JOIN public.carriers c ON c.id = m.id
WHERE (SELECT array_agg(x ORDER BY x) FROM unnest(m.mt) x)
      IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(public.carrier_management_types(m.id)) x)
GROUP BY 1;
-- 3. carrier_of es la asignación ACTIVE de hoy, para todos.
SELECT (SELECT count(*) FROM public.drivers d
        LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
        WHERE app.carrier_of('DRIVER', d.id) IS DISTINCT FROM da.carrier_id) AS conductores_distintos,
       (SELECT count(*) FROM public.assets a
        LEFT JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
        WHERE app.carrier_of('ASSET', a.id) IS DISTINCT FROM aa.carrier_id) AS equipos_distintos;
ROLLBACK;
SQL
```

Expected (medido el 12/10):
- sin errores (los tres CHECK se agregan: ninguna fila los viola);
- `DRIVER 78`, `ASSET 122`;
- `INACTIVE | 1`, y ninguna fila `ACTIVE`;
- `conductores_distintos = 0`, `equipos_distintos = 0`.

Si aparece una empresa `ACTIVE` en el punto 2, parar y reportar: cambiaría la siembra de una empresa que opera.

- [ ] **Step 8: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261013090000_directory_one_answer.sql \
  monitor-app/backend/api/tests/test_directory_one_answer_migration_integration.py \
  monitor-app/backend/api/tests/d1_subjects.py
git commit -m "feat(db): flota activa, carrier_of y ciclos de vida con una sola definición

app.active_fleet y app.carrier_of; carrier_management_types cuenta solo los
tractos de la flota activa; CHECK de operational_status según el glosario.
Ensayada con ROLLBACK; se aplica en la Task 10 (D1).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: El glosario del backend y `exigible_sql` por tipo de entidad (B-8)

**Files:**
- Create: `monitor-app/backend/api/app/schemas/states.py`
- Modify: `monitor-app/backend/api/app/schemas/carrier.py:23`, `driver.py:8`, `asset.py:10` (`OperationalStatus`)
- Modify: `monitor-app/backend/api/app/services/vencimientos.py:144-197` (`_ingreso` … `exigible_desde_sql`) y `:396-397` (`_ASIGNACIONES` sube)
- Create: `monitor-app/backend/api/tests/test_states.py`
- Create: `monitor-app/backend/api/tests/test_exigible_by_entity_type_integration.py`

**Interfaces:**
- Produces: `app/schemas/states.py` exactamente como el contrato. `vencimientos.PENDING_STATES` queda igual a `("OVERDUE", "EXPIRING", "MISSING")`.
- `carrier.OperationalStatus is CarrierLifecycle`, y `driver.OperationalStatus` / `asset.OperationalStatus is FleetLifecycle`. Los importadores no cambian.
- `exigible_sql` / `exigible_desde_sql` mantienen la firma. Para `DRIVER`, el SQL que generan es equivalente al de hoy.

- [ ] **Step 1: Write the failing glossary test**

Crear `tests/test_states.py`:

```python
"""D1: el glosario de estados del backend (app/schemas/states.py) no se desalinea
de la definición de cada estado (services/vencimientos.py) ni de los schemas."""
from typing import get_args

import pytest
from pydantic import ValidationError

from app.schemas import asset, carrier, driver
from app.schemas.states import (
    BLOCKING_STATES, SEVERITY_ORDER, CarrierLifecycle, ComplianceSummary, DocumentState, FleetLifecycle,
    StateCounts,
)
from app.services.vencimientos import DOCUMENT_STATES, PENDING_STATES


def test_los_estados_del_glosario_son_los_que_calcula_document_state_sql():
    assert set(get_args(DocumentState)) == set(DOCUMENT_STATES)


def test_el_orden_de_severidad_cubre_todo_menos_lo_que_aun_no_se_exige():
    assert set(SEVERITY_ORDER) == set(DOCUMENT_STATES) - {"NOT_REQUIRED"}
    assert SEVERITY_ORDER[0] == "OVERDUE" and SEVERITY_ORDER[-1] == "UP_TO_DATE"


def test_por_vencer_no_bloquea_y_pendientes_sigue_igual():
    assert BLOCKING_STATES == ("OVERDUE", "MISSING")
    assert PENDING_STATES == ("OVERDUE", "EXPIRING", "MISSING")
    assert set(BLOCKING_STATES) < set(PENDING_STATES)


def test_los_schemas_usan_el_ciclo_de_vida_del_glosario():
    assert carrier.OperationalStatus is CarrierLifecycle
    assert driver.OperationalStatus is FleetLifecycle
    assert asset.OperationalStatus is FleetLifecycle


def test_el_resumen_rechaza_un_estado_fuera_del_glosario():
    with pytest.raises(ValidationError):
        ComplianceSummary(worst_state="CRITICAL", own=StateCounts(), can_operate=True)


def test_el_resumen_sin_flota_es_de_conductor_o_equipo():
    resumen = ComplianceSummary(worst_state="UP_TO_DATE", own=StateCounts(), can_operate=True)
    assert resumen.fleet is None
    assert resumen.own.model_dump() == {"overdue": 0, "expiring": 0, "missing": 0}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_states.py -q`
Expected: FAIL en la colección con `ModuleNotFoundError: No module named 'app.schemas.states'`. Es el motivo correcto: el módulo no existe.

- [ ] **Step 3: Create the glossary and point the schemas to it**

Crear `app/schemas/states.py`:

```python
"""El glosario de estados, en código (spec 2026-10-12-directory-d1-one-answer-design.md §3 y §6.4).

Tres capas que no se mezclan:
  - ciclo de vida de la entidad (dato: operational_status);
  - estado de un documento (lo calcula services/vencimientos.document_state_sql);
  - resumen de quien debe los documentos y su habilitación (lo calcula
    services/fleet_compliance.py).

Ningún otro módulo escribe estos valores a mano. El espejo del frontend es
lib/states.ts."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

CarrierLifecycle = Literal["ACTIVE", "ONBOARDING", "INACTIVE", "LEGACY_INACTIVE"]
FleetLifecycle = Literal["ACTIVE", "INACTIVE"]
DocumentState = Literal["UP_TO_DATE", "EXPIRING", "OVERDUE", "MISSING", "NOT_REQUIRED"]
AlertSeverity = Literal["warning", "critical"]

# Peor primero. NOT_REQUIRED no participa del resumen (§3).
SEVERITY_ORDER: tuple[str, ...] = ("OVERDUE", "MISSING", "EXPIRING", "UP_TO_DATE")
# Lo que quita la habilitación cuando es LEGAL_MANDATORY. Por vencer no bloquea (E-c).
BLOCKING_STATES: tuple[str, ...] = ("OVERDUE", "MISSING")


class StateCounts(BaseModel):
    overdue: int = 0
    expiring: int = 0
    missing: int = 0


class ComplianceSummary(BaseModel):
    worst_state: DocumentState          # el peor entre los OBLIGATORIOS pendientes (A-R5); UP_TO_DATE si no hay
    own: StateCounts                    # documentos de la propia entidad
    fleet: StateCounts | None = None    # solo empresas: lo de su flota activa
    can_operate: bool                   # §5 de la spec; regla en services/fleet_compliance.py
```

En `app/schemas/carrier.py`:
- Agregar `from .states import CarrierLifecycle` junto a `from .common import …` (línea 11).
- Reemplazar la línea 23 (`OperationalStatus = Literal[…]`) por:

```python
# Los valores viven en el glosario (D1, app/schemas/states.py); el comentario de
# arriba cuenta de dónde sale cada uno.
OperationalStatus = CarrierLifecycle
```

En `app/schemas/driver.py:8` y en `app/schemas/asset.py:10`:
- Agregar `from .states import FleetLifecycle` después de `from ..authz.permissions import Permission`.
- Reemplazar `OperationalStatus = Literal["ACTIVE", "INACTIVE"]` por `OperationalStatus = FleetLifecycle  # glosario (D1)`.
- En `driver.py`, `Literal` queda sin uso (medido: solo lo usaba esa línea). La importación pasa a `from typing import Optional`. En `asset.py` y `carrier.py` sigue en uso.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_states.py tests/test_carriers.py tests/test_drivers.py tests/test_assets.py -q`
Expected: PASS (medido: `104 passed, 6 skipped`).

- [ ] **Step 5: Write the failing exigibility tests**

Patrón copiado de `tests/test_pending_documents_integration.py`: `_requisito` con `is_active = false`, `_registro`, y `_estado` con `document_state_sql('cr')`. Crear `tests/test_exigible_by_entity_type_integration.py`:

```python
"""D1, B-8 (spec §5.2): cuándo se exige un documento depende del tipo de quien
lo debe. `exigible_sql` y `exigible_desde_sql` miraban driver_assignments para
cualquier entidad: el documento al término de un equipo nunca se exigía, y el
"mes siguiente al ingreso" de un equipo se exigía desde el primer día.

Hoy la CHECK compliance_requirements_exigible_on_entity_check solo admite
MONTH_AFTER_START y ON_ENTITY_END en requisitos de conductor, así que ningún
registro real cae en estas ramas (ruling A-R2). El registro del test es de tipo
ASSET y apunta a un requisito de conductor: los predicados leen `cr.entity_type`,
no el `target_entity` del requisito, y así se prueba la rama sin tocar la CHECK
(un ALTER TABLE tomaría un lock exclusivo sobre compliance_requirements durante
todo el test). Contra la base real, en una transacción revertida; requisitos
apagados (is_active = false) y sujetos ZZ-TEST-D1."""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.vencimientos import document_state_sql, exigible_desde_sql

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-D1"


def _suf() -> str:
    return uuid4().hex[:6].upper()


async def _empresa(conn) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {_suf()}"))


async def _equipo(conn, empresa: str, *, asignacion: str, desde: str = "public.hoy_chile() - 400") -> str:
    a = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id",
        f"ZZ{_suf()[:4]}"))
    # `desde` es SQL fijo de este archivo (nunca entrada de usuario).
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status, start_date) "
        f"VALUES ($1, $2, $3, {desde})", a, empresa, asignacion)
    return a


async def _requisito(conn, exigible_on: str) -> str:
    # target_entity DRIVER: la CHECK no admite otro con estos exigible_on (ver docstring).
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ('DRIVER', $1, $2, 'LEGAL_MANDATORY', 'NONE', $3, false, true)
        RETURNING id
        """,
        f"ZZ_D1_{_suf()}", f"{PREFIJO} documento", exigible_on))


async def _registro_del_equipo(conn, requisito: str, equipo: str) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current) "
        "VALUES ($1, 'ASSET', $2, 'MISSING', true) RETURNING id", equipo, requisito))


async def _estado_y_desde(conn, registro: str):
    return await conn.fetchrow(
        f"SELECT {document_state_sql('cr')} AS estado, {exigible_desde_sql('cr')} AS desde "
        "FROM public.compliance_records cr WHERE cr.id = $1", registro)


async def test_el_documento_al_termino_de_un_equipo_que_se_fue_se_exige(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="INACTIVE")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "ON_ENTITY_END"), equipo)

    assert (await _estado_y_desde(conn, registro))["estado"] == "MISSING"


async def test_el_documento_al_termino_de_un_equipo_asignado_aun_no_se_exige(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="ACTIVE")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "ON_ENTITY_END"), equipo)

    assert (await _estado_y_desde(conn, registro))["estado"] == "NOT_REQUIRED"


async def test_un_equipo_que_ingreso_este_mes_aun_no_debe_lo_del_mes_siguiente(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="ACTIVE", desde="public.hoy_chile()")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "MONTH_AFTER_START"), equipo)
    primero_del_mes_siguiente = await conn.fetchval(
        "SELECT (date_trunc('month', public.hoy_chile()) + interval '1 month')::date")

    fila = await _estado_y_desde(conn, registro)

    assert fila["estado"] == "NOT_REQUIRED"
    assert fila["desde"] == primero_del_mes_siguiente


async def test_un_equipo_que_ingreso_hace_mas_de_un_mes_ya_lo_debe(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="ACTIVE", desde="public.hoy_chile() - 400")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "MONTH_AFTER_START"), equipo)

    assert (await _estado_y_desde(conn, registro))["estado"] == "MISSING"
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_exigible_by_entity_type_integration.py -q`

Expected: `2 failed, 2 passed` (medido):
- `test_el_documento_al_termino_de_un_equipo_que_se_fue_se_exige` falla con `assert 'NOT_REQUIRED' == 'MISSING'`;
- `test_un_equipo_que_ingreso_este_mes_…` falla con `assert 'MISSING' == 'NOT_REQUIRED'`.

Los otros dos pasan hoy y quedan como guardas.

- [ ] **Step 7: Implement in `vencimientos.py`**

1. Borrar `_ASIGNACIONES` de su lugar actual (`:396-397`, antes de `ultima_empresa_sql`).
2. Reemplazar todo el tramo desde `def _ingreso(tabla: str, col: str, alias: str) -> str:` (`:144`) hasta el final de `exigible_desde_sql` (`:197`, justo antes de `def cubierto_predicate`) por:

```python
# Dónde está la asignación de cada tipo de entidad. Una empresa no tiene
# asignación: cada predicado dice qué significa para ella. La usan ingreso_sql,
# _se_fue y ultima_empresa_sql.
_ASIGNACIONES = {"DRIVER": ("driver_assignments", "driver_id"),
                 "ASSET": ("asset_assignments", "asset_id")}


def _ingreso(tabla: str, col: str, alias: str) -> str:
    """Cuándo ingresó un conductor o un equipo: el `start_date` de su
    asignación ACTIVE (NULL sin una)."""
    return (f"(SELECT vg_da.start_date FROM public.{tabla} vg_da "
            f"WHERE vg_da.{col} = {alias}.entity_id AND vg_da.status = 'ACTIVE')")


def ingreso_sql(alias: str = "cr") -> str:
    """Desde cuándo está quien debe el documento (Pendientes: "Falta · Ingresó
    hace N días", y el mes de MONTH_AFTER_START). Conductor y equipo: el inicio
    de su asignación vigente. Empresa: su alta (`created_at`), como día de
    Chile — la base corre en UTC."""
    ramas = " ".join(f"WHEN '{tipo}' THEN {_ingreso(tabla, col, alias)}"
                     for tipo, (tabla, col) in _ASIGNACIONES.items())
    return (
        f"(CASE {alias}.entity_type {ramas} "
        f"WHEN 'CARRIER' THEN (SELECT (vg_ic.created_at AT TIME ZONE 'America/Santiago')::date "
        f"FROM public.carriers vg_ic WHERE vg_ic.id = {alias}.entity_id) END)"
    )


def _se_fue(alias: str) -> str:
    """ON_ENTITY_END: el conductor o el equipo ya no tiene asignación ACTIVE y
    tuvo alguna, cada uno en SU tabla (B-8: antes miraba driver_assignments para
    cualquier tipo, y un equipo nunca llegaba a deber su documento al término).
    Una empresa no se "va" de nadie: false, como hasta ahora."""
    def _rama(tabla: str, col: str) -> str:
        return (f"(NOT EXISTS (SELECT 1 FROM public.{tabla} vg_da "
                f"WHERE vg_da.{col} = {alias}.entity_id AND vg_da.status = 'ACTIVE') "
                f"AND EXISTS (SELECT 1 FROM public.{tabla} vg_da WHERE vg_da.{col} = {alias}.entity_id))")
    ramas = " ".join(f"WHEN '{tipo}' THEN {_rama(tabla, col)}" for tipo, (tabla, col) in _ASIGNACIONES.items())
    return f"(CASE {alias}.entity_type {ramas} ELSE false END)"


def _mes_siguiente_al_ingreso(alias: str) -> str:
    return f"(date_trunc('month', {ingreso_sql(alias)}) + interval '1 month')::date"


def exigible_sql(alias: str = "cr") -> str:
    """Si ya se le exige (exigible_on).
      ON_ENTITY_START / ON_REQUEST  siempre (a ON_REQUEST lo filtra la siembra)
      MONTH_AFTER_START  desde el día 1 del mes siguiente al ingreso (ingreso_sql:
                         asignación ACTIVE de conductor o equipo, alta de la
                         empresa; sin fecha, se exige)
      ON_ENTITY_END      el conductor o el equipo ya no tiene asignación ACTIVE
                         y tuvo alguna (_se_fue)

    Hoy la CHECK compliance_requirements_exigible_on_entity_check limita
    MONTH_AFTER_START y ON_ENTITY_END a requisitos de conductor: las ramas de
    equipo y empresa son la regla para cuando Configuración lo permita."""
    return (
        f"(CASE WHEN {_es(alias, 'exigible_on', 'MONTH_AFTER_START')} THEN COALESCE("
        f"{hoy_sql()} >= {_mes_siguiente_al_ingreso(alias)}, true) "
        f"WHEN {_es(alias, 'exigible_on', 'ON_ENTITY_END')} THEN {_se_fue(alias)} "
        f"ELSE true END)"
    )


def exigible_desde_sql(alias: str = "cr") -> str:
    """Desde qué fecha se exige, cuando todavía no: el día 1 del mes siguiente
    al ingreso (MONTH_AFTER_START). NULL en los demás casos: "al ingreso" y "a
    pedido" se exigen siempre, y "al término" no tiene una fecha que anunciar
    (depende de que la persona o el equipo se vaya)."""
    return (
        f"(CASE WHEN {_es(alias, 'exigible_on', 'MONTH_AFTER_START')} THEN "
        f"{_mes_siguiente_al_ingreso(alias)} END)"
    )
```

`_ingreso_del_conductor` desaparece: solo la usaban las tres funciones reemplazadas. Verificar con `grep -rn _ingreso_del_conductor app tests`, que tiene que quedar vacío.

- [ ] **Step 8: Run the new tests and the readers of the rule**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_exigible_by_entity_type_integration.py tests/test_states.py tests/test_pending_documents_integration.py tests/test_exigibilidad_integracion.py tests/test_vencimientos.py tests/test_compliance.py tests/test_entity_summary_integration.py tests/test_predicados_vigencia_integracion.py -q`
Expected: PASS. Las suites de Pendientes y exigibilidad cubren la rama de conductor, que no cambia.

- [ ] **Step 9: Verificar que la mutación mata el test**

Cada una por separado; se corre `tests/test_exigible_by_entity_type_integration.py`, se ve el FAIL y se restaura:
1. En `_se_fue`, cambiar `_ASIGNACIONES.items()` por `[("DRIVER", _ASIGNACIONES["DRIVER"])]`. Debe fallar `test_el_documento_al_termino_de_un_equipo_que_se_fue_se_exige`.
2. En `_mes_siguiente_al_ingreso`, cambiar `ingreso_sql(alias)` por `_ingreso("driver_assignments", "driver_id", alias)`. Debe fallar `test_un_equipo_que_ingreso_este_mes_…`.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/backend/api/app/schemas/states.py \
  monitor-app/backend/api/app/schemas/carrier.py monitor-app/backend/api/app/schemas/driver.py \
  monitor-app/backend/api/app/schemas/asset.py \
  monitor-app/backend/api/app/services/vencimientos.py \
  monitor-app/backend/api/tests/test_states.py \
  monitor-app/backend/api/tests/test_exigible_by_entity_type_integration.py
git commit -m "feat(d1): glosario de estados del backend y exigibilidad por tipo de entidad

app/schemas/states.py con los Literal de cada capa, el orden de severidad y el
resumen; los schemas lo usan. exigible_sql y exigible_desde_sql se ramifican con
_ASIGNACIONES (B-8): un equipo ya no se mide con driver_assignments. Hoy no
cambia ningún registro (la CHECK limita esos exigible_on a conductores).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `fleet_compliance.py`: la base de Pendientes, los resúmenes, la habilitación y el aviso

**Files:**
- Create: `monitor-app/backend/api/app/services/fleet_compliance.py`
- Modify: `monitor-app/backend/api/app/routers/compliance.py`:
  - borrar `:95-106` (`_empresa_que_dejo_sql`) y `:466-554` (`_pending_ctes`);
  - nuevo import;
  - `pending_base_ctes` en `:572`, `:664`, `:682` y `:722`;
  - comentario de `:718`.
- Create: `monitor-app/backend/api/tests/test_fleet_compliance.py`
- Create: `monitor-app/backend/api/tests/test_fleet_compliance_integration.py`

**Interfaces:**
- Consumes:
  - `app.active_fleet` (Task 2, en los tests vía `tests.d1_subjects.apply_fleet_facts`);
  - `app/schemas/states.py` (Task 3);
  - `vencimientos.*` (Task 3).
- Produces (contrato):
  - `pending_base_ctes(estado_param)`;
  - `entity_compliance_cte()`;
  - `carrier_compliance_cte()`;
  - `summary_from_row(row, *, with_fleet)`;
  - `days_to_expiry_sql(alias)`;
  - `alert_severity_sql(alias)`.
- Además, `_empresa_que_dejo_sql(alias)` (privada; `compliance.py` la importa para el embudo hasta la Task 6; ruling A-R3).
- Las CTE de resumen son autocontenidas y sin `$n` (ruling A-R7).
- Para una fila de entidad, `summary_from_row` necesita el `operational_status` de la entidad (ruling A-R4).

**Por qué "Pendientes no cambia" se verifica con la huella del SQL y no con un test que compare salidas:**
- La mudanza es de código puro: si el texto SQL de las cinco consultas de Pendientes es idéntico byte a byte, la salida es idéntica para **cualquier** dato.
- Comparar salidas dentro de una transacción solo prueba los datos de hoy, que no ejercitan todas las ramas (por ejemplo, 0 registros `ON_ENTITY_END`).
- Además exigiría guardar en el test una copia congelada de 100 líneas de SQL, que habría que actualizar con cada cambio legítimo de Pendientes.
- Por eso la huella es un paso de verificación de esta tarea, no un test que quede. Lo que queda protegiendo Pendientes son sus suites actuales, que se corren en el Step 3.

- [ ] **Step 1: Take the fingerprint of Pendientes before the move**

Después del commit de la Task 3 (la huella incluye su cambio en `vencimientos`):

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import hashlib, json, os
from app.routers import compliance as c
nombres = ("_PENDING_ROWS_SQL", "_PENDING_SUMMARY_BY_REQUIREMENT_SQL", "_PENDING_SUMMARY_BY_CARRIER_SQL",
           "_PENDING_OWNERS_SQL", "_SUMMARY_SQL")
huella = {n: hashlib.sha256(getattr(c, n).encode()).hexdigest() for n in nombres}
json.dump(huella, open(os.path.join(os.environ.get("TMPDIR", "/tmp"), "d1_pendientes_antes.json"), "w"), indent=1)
print(huella)
EOF
```

- [ ] **Step 2: Move the base, unchanged**

Crear `app/services/fleet_compliance.py` con este encabezado:

```python
"""La regla documental de quien debe documentos, en un solo lugar (spec
2026-10-12-directory-d1-one-answer-design.md §5).

`vencimientos.py` es el dueño del vocabulario por registro (estado, alcance,
exigibilidad). Este módulo es el dueño de los agregados: el resumen por entidad
y por empresa, la habilitación (`can_operate`) y el aviso por documento. Lo
leen Directorio, vista rápida, embudo de Certificación y Monitor; ninguno lo
recalcula.

La base es la de Pendientes (`pending_base_ctes`, mudada sin cambios desde
routers/compliance.py): así las cifras de una empresa activa son, por
construcción, las de su fila en /pending/summary?group_by=carrier.

Las dos CTE de resumen son autocontenidas (llevan su propio WITH adentro): se
pueden componer juntas, o con `pending_base_ctes`, en una misma consulta sin
chocar por el nombre `pending`. No usan parámetros ($n): quien las compone no
renumera nada."""
from __future__ import annotations

from typing import Any, Mapping

from ..schemas.states import BLOCKING_STATES, SEVERITY_ORDER, ComplianceSummary, StateCounts
from .vencimientos import (
    PENDING_STATES,
    cubierto_predicate,
    document_state_sql,
    exigible_sql,
    hoy_sql,
    in_scope_sql,
    ingreso_sql,
    pendiente_predicate,
    por_vencer_predicate,
    ultima_empresa_sql,
    vence_el_sql,
    vencido_predicate,
)
```

Debajo, **cortar y pegar sin tocar una letra** desde `compliance.py`:
1. `def _empresa_que_dejo_sql(alias: str) -> str:` completa (`:95-106`).
2. `def _pending_ctes(estado_param: str) -> str:` completa (`:466-554`, hasta el `)"""` que cierra la CTE `resolved`). Solo se renombra a `def pending_base_ctes(estado_param: str) -> str:`. El docstring y el cuerpo quedan iguales.

En `compliance.py`:
- después de `from ..services.vigencia import regla_base_json_sql` (`:52`), agregar `from ..services.fleet_compliance import _empresa_que_dejo_sql, pending_base_ctes`;
- reemplazar las cuatro llamadas `_pending_ctes(` por `pending_base_ctes(`;
- en el comentario de `:718`, cambiar `` (`_pending_ctes`, `` por `` (`pending_base_ctes`, ``.
- **No** quitar los imports de `vencimientos` que quedan sin uso en el router: `tests/test_compliance.py:749` importa `pendiente_predicate` desde `app.routers.compliance`.

Comprobar que el cuerpo pegado es idéntico al original:

```bash
cd monitor-app/backend/api && diff <(git show HEAD:monitor-app/backend/api/app/routers/compliance.py | sed -n '/^def _pending_ctes/,/^)"""/p' | sed 1d) \
     <(sed -n '/^def pending_base_ctes/,/^)"""/p' app/services/fleet_compliance.py | sed 1d) && echo IDENTICO
```

- [ ] **Step 3: Verify Pendientes did not change**

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import hashlib, json, os
from app.routers import compliance as c
antes = json.load(open(os.path.join(os.environ.get("TMPDIR", "/tmp"), "d1_pendientes_antes.json")))
ahora = {n: hashlib.sha256(getattr(c, n).encode()).hexdigest() for n in antes}
print("IGUALES" if ahora == antes else f"DISTINTOS: {[n for n in antes if antes[n] != ahora[n]]}")
EOF
venv/bin/python -m pytest tests/test_pending_documents_integration.py tests/test_compliance.py tests/test_exigibilidad_integracion.py tests/test_integracion_certificacion.py -q
```

Expected:
- `IGUALES` (medido el 12/10 en la copia del scratchpad);
- las suites en PASS.

Si dice `DISTINTOS`, la mudanza tocó algo: se rehace el Step 2, sin seguir.

- [ ] **Step 4: Commit the move alone**

La mudanza va en su propio commit, para que se pueda revisar como "sin cambios":

```bash
git add monitor-app/backend/api/app/services/fleet_compliance.py monitor-app/backend/api/app/routers/compliance.py
git commit -m "refactor(d1): la base de Pendientes se muda a services/fleet_compliance.py

_pending_ctes pasa a pending_base_ctes y _empresa_que_dejo_sql la acompaña,
sin tocar una letra: el SQL de las cinco consultas de Pendientes queda
idéntico (huella sha256 antes y después).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Write the failing tests**

`tests/test_fleet_compliance.py` (sin base; patrón de `tests/test_vencimientos.py`):

```python
"""D1: las piezas de app/services/fleet_compliance.py que no necesitan la base."""
import pytest

from app.routers import compliance
from app.services.fleet_compliance import (
    carrier_compliance_cte, entity_compliance_cte, pending_base_ctes, summary_from_row,
)

_SIN_NADA_EMPRESA = {"worst_state": None, "own_overdue": None, "own_expiring": None, "own_missing": None,
                     "fleet_overdue": None, "fleet_expiring": None, "fleet_missing": None, "can_operate": True}


def test_pendientes_lee_la_base_desde_fleet_compliance():
    """La base se mudó sin cambios: Pendientes compone la MISMA función."""
    assert pending_base_ctes("$10") in compliance._PENDING_ROWS_SQL
    assert pending_base_ctes("$1") in compliance._PENDING_SUMMARY_BY_CARRIER_SQL
    assert not hasattr(compliance, "_pending_ctes")


def test_las_cte_de_resumen_no_usan_parametros():
    """Quien las compone no renumera nada: no traen ningún $n."""
    assert "$" not in carrier_compliance_cte()
    assert "$" not in entity_compliance_cte()


def test_una_empresa_sin_pendientes_es_up_to_date_con_ceros():
    resumen = summary_from_row(_SIN_NADA_EMPRESA, with_fleet=True)
    assert resumen.model_dump() == {"worst_state": "UP_TO_DATE",
                                    "own": {"overdue": 0, "expiring": 0, "missing": 0},
                                    "fleet": {"overdue": 0, "expiring": 0, "missing": 0},
                                    "can_operate": True}


def test_una_entidad_sin_fila_de_resumen_esta_al_dia_si_esta_activa():
    fila = {"worst_state": None, "overdue": None, "expiring": None, "missing": None,
            "blocking_mandatory": None, "operational_status": "ACTIVE"}
    resumen = summary_from_row(fila, with_fleet=False)
    assert (resumen.worst_state, resumen.fleet, resumen.can_operate) == ("UP_TO_DATE", None, True)


@pytest.mark.parametrize("estado, bloqueantes, puede", [("ACTIVE", 1, False), ("INACTIVE", 0, False),
                                                        ("ACTIVE", 0, True)])
def test_la_habilitacion_de_una_entidad(estado, bloqueantes, puede):
    fila = {"worst_state": "MISSING", "overdue": 0, "expiring": 0, "missing": 1,
            "blocking_mandatory": bloqueantes, "operational_status": estado}
    assert summary_from_row(fila, with_fleet=False).can_operate is puede


def test_una_fila_de_entidad_sin_su_ciclo_de_vida_no_se_inventa():
    """Ruling A-R4: sin operational_status, KeyError; nunca "activa" por defecto."""
    fila = {"worst_state": None, "overdue": 0, "expiring": 0, "missing": 0, "blocking_mandatory": 0}
    with pytest.raises(KeyError):
        summary_from_row(fila, with_fleet=False)
```

`tests/test_fleet_compliance_integration.py`. El patrón viene de tres tests:
- `tests/test_pending_documents_integration.py`: helpers, requisitos apagados, `pending_summary` con `PoolDeUnaConexion`, y la regla con `warning_days` de `:162`;
- `tests/test_assignment_start_date_integration.py`: `hoy_chile()` reemplazada dentro de la transacción;
- `tests/test_trip_assignment_integration.py`: `vehicle_driver_assignments`.

```python
"""D1 "Una sola respuesta": el resumen de quien debe documentos, la habilitación y
el aviso (spec §5; app/services/fleet_compliance.py).

Contra la base real, en una transacción revertida. Los sujetos los crea cada
test (prefijo ZZ-TEST-D1). Al crearlos, los triggers de siembra les cargan los
requisitos activos de hoy: `_sin_registros` los borra, para que cada test parta
de cero y cuente solo lo que inserta. Los requisitos del test nacen apagados
(is_active = false). app.active_fleet se crea en la transacción con
`apply_fleet_facts` (la migración se aplica recién en la Task 10)."""
from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest

from app.routers.compliance import pending_summary
from app.services.fleet_compliance import (
    alert_severity_sql,
    carrier_compliance_cte,
    days_to_expiry_sql,
    entity_compliance_cte,
    summary_from_row,
)
from app.services.vencimientos import document_state_sql
from tests.conftest import PoolDeUnaConexion
from tests.d1_subjects import apply_fleet_facts

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-D1"


def _suf() -> str:
    return uuid4().hex[:6].upper()


async def _empresa(conn, estado: str = "ACTIVE") -> UUID:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Empresa {_suf()}", estado)


async def _conductor(conn, empresa: UUID, *, estado: str = "ACTIVE") -> UUID:
    d = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Conductor {_suf()}", estado)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
        "VALUES ($1, $2, 'ACTIVE', public.hoy_chile() - 400)", d, empresa)
    return d


async def _tracto(conn, empresa: UUID) -> UUID:
    a = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id",
        f"ZZ{_suf()[:4]}")
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", a, empresa)
    return a


async def _sin_registros(conn, *entidades: UUID) -> None:
    await conn.execute("DELETE FROM public.compliance_records WHERE entity_id = ANY($1::uuid[])", list(entidades))


async def _requisito(conn, entidad: str, *, nivel: str = "LEGAL_MANDATORY") -> UUID:
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ($1, $2, $3, $4, 'REQUIRED', 'ON_ENTITY_START', false, true)
        RETURNING id
        """,
        entidad, f"ZZ_D1_{_suf()}", f"{PREFIJO} documento", nivel)


async def _registro(conn, requisito: UUID, tipo: str, entidad: UUID, *,
                    status: str = "MISSING", vence: date | None = None) -> UUID:
    return await conn.fetchval(
        "INSERT INTO public.compliance_records "
        "(entity_id, entity_type, requirement_id, status, is_current, expiration_date, file_url) "
        "VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING id",
        entidad, tipo, requisito, status, vence, None if status == "MISSING" else "zz/test.pdf")


async def _hoy(conn) -> date:
    return await conn.fetchval("SELECT public.hoy_chile()")


async def _de_la_empresa(conn, empresa: UUID):
    await apply_fleet_facts(conn)
    filas = await conn.fetch(
        f"WITH {carrier_compliance_cte()} SELECT * FROM carrier_compliance WHERE carrier_id = $1", empresa)
    assert len(filas) == 1, "una fila por empresa, siempre"
    return filas[0]


async def _de_la_entidad(conn, tipo: str, entidad: UUID):
    return await conn.fetch(
        f"WITH {entity_compliance_cte()} SELECT * FROM entity_compliance "
        "WHERE entity_type = $1 AND entity_id = $2", tipo, entidad)


# ── Review Focus ─────────────────────────────────────────────────────────────

async def test_empresa_activa_sin_registros_queda_habilitada(conexion_revertida):
    """Review Focus 1: recién creada, la siembra no corrió."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    await _sin_registros(conn, empresa)

    resumen = summary_from_row(await _de_la_empresa(conn, empresa), with_fleet=True)

    assert resumen.model_dump() == {
        "worst_state": "UP_TO_DATE",
        "own": {"overdue": 0, "expiring": 0, "missing": 0},
        "fleet": {"overdue": 0, "expiring": 0, "missing": 0},
        "can_operate": True,
    }


async def test_conductor_con_dos_tractos_cuenta_una_vez(conexion_revertida):
    """Review Focus 2: vehicle_driver_assignments permite un conductor en dos
    tractos; sus documentos se cuentan una vez."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    tractos = [await _tracto(conn, empresa) for _ in range(2)]
    for tracto in tractos:
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
            "VALUES ($1, $2, 'ACTIVE', 'manual', true)", tracto, conductor)
    await _sin_registros(conn, empresa, conductor, *tractos)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor)

    fila = await _de_la_empresa(conn, empresa)
    entidad = await _de_la_entidad(conn, "DRIVER", conductor)
    pendientes = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)

    assert (fila["fleet_missing"], fila["own_missing"]) == (1, 0)
    assert [(e["missing"], e["blocking_mandatory"]) for e in entidad] == [(1, 1)]
    assert [(r["overdue"], r["expiring"], r["missing"]) for r in pendientes["rows"]
            if r["key"] == str(empresa)] == [(0, 0, 1)]


async def test_aviso_en_el_borde_del_dia_de_chile(conexion_revertida):
    """Review Focus 3. A las 22:30 de Chile el día UTC ya es el siguiente: se
    simula dejando hoy_chile() en la víspera de CURRENT_DATE (patrón de
    test_assignment_start_date_integration.py). Con error_days (10) mayor que
    los días de aviso de la regla (3): vence hoy es 'critical' y no vencido;
    venció ayer es OVERDUE y sin aviso."""
    conn = conexion_revertida
    vispera = await conn.fetchval("SELECT CURRENT_DATE - 1")
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{vispera.isoformat()}' $$")
    await conn.execute("UPDATE app.alert_thresholds SET error_days = 10 WHERE doc_type = 'documento_por_vencer'")
    empresa = await _empresa(conn)
    requisito = await _requisito(conn, "CARRIER")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, shipper_id, warning_days) "
        "VALUES ($1, NULL, 3)", requisito)
    otra = await _empresa(conn)
    vence_hoy = await _registro(conn, requisito, "CARRIER", empresa, status="APPROVED_MANUAL", vence=vispera)
    vencio_ayer = await _registro(conn, requisito, "CARRIER", otra, status="APPROVED_MANUAL",
                                  vence=vispera - timedelta(days=1))

    async def aviso(registro):
        return tuple(await conn.fetchrow(
            f"SELECT {document_state_sql('cr')}, {days_to_expiry_sql('cr')}, {alert_severity_sql('cr')} "
            "FROM public.compliance_records cr WHERE cr.id = $1", registro))

    assert await aviso(vence_hoy) == ("EXPIRING", 0, "critical")
    assert await aviso(vencio_ayer) == ("OVERDUE", -1, None)


# ── Habilitación ─────────────────────────────────────────────────────────────

async def _empresa_con_un_documento(conn, *, nivel="LEGAL_MANDATORY", status="MISSING", vence=None,
                                    estado="ACTIVE"):
    empresa = await _empresa(conn, estado)
    await _sin_registros(conn, empresa)
    await _registro(conn, await _requisito(conn, "CARRIER", nivel=nivel), "CARRIER", empresa,
                    status=status, vence=vence)
    return empresa


async def test_un_obligatorio_que_falta_inhabilita(conexion_revertida):
    conn = conexion_revertida
    fila = await _de_la_empresa(conn, await _empresa_con_un_documento(conn))
    assert (fila["worst_state"], fila["own_missing"], fila["can_operate"]) == ("MISSING", 1, False)


async def test_por_vencer_no_inhabilita(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa_con_un_documento(conn, status="APPROVED_MANUAL",
                                              vence=await _hoy(conn) + timedelta(days=5))
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["worst_state"], fila["own_expiring"], fila["can_operate"]) == ("EXPIRING", 1, True)


async def test_un_opcional_vencido_no_inhabilita_ni_empeora_pero_cuenta(conexion_revertida):
    """Ruling A-R5 (resuelto, sigue la spec): el peor estado sale de los
    obligatorios; las cifras cuentan también los opcionales."""
    conn = conexion_revertida
    empresa = await _empresa_con_un_documento(conn, nivel="CONDITIONAL_OPTIONAL", status="APPROVED_MANUAL",
                                              vence=await _hoy(conn) - timedelta(days=5))
    fila = await _de_la_empresa(conn, empresa)
    entidad = await _de_la_entidad(conn, "CARRIER", empresa)
    assert (fila["worst_state"], fila["own_overdue"], fila["can_operate"]) == ("UP_TO_DATE", 1, True)
    assert [(e["worst_state"], e["overdue"]) for e in entidad] == [("UP_TO_DATE", 1)]


async def test_un_obligatorio_vencido_de_la_flota_activa_inhabilita(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    await _sin_registros(conn, empresa, conductor)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor,
                    status="APPROVED_MANUAL", vence=await _hoy(conn) - timedelta(days=1))
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["fleet_overdue"], fila["can_operate"]) == (1, False)


async def test_un_conductor_de_baja_no_cuenta_ni_inhabilita(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa, estado="INACTIVE")
    await _sin_registros(conn, empresa, conductor)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor)
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["fleet_missing"], fila["can_operate"]) == (0, True)


async def test_empresa_no_activa_nunca_habilitada_y_resume_lo_suyo_y_su_flota(conexion_revertida):
    """Ruling D1-R1: in_scope exige empresa activa; la no activa se resume con
    sus registros y los de su app.active_fleet, y nunca queda habilitada."""
    conn = conexion_revertida
    empresa = await _empresa(conn, "INACTIVE")
    conductor = await _conductor(conn, empresa)
    await _sin_registros(conn, empresa, conductor)
    await _registro(conn, await _requisito(conn, "CARRIER"), "CARRIER", empresa)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor,
                    status="APPROVED_MANUAL", vence=await _hoy(conn) - timedelta(days=1))

    fila = await _de_la_empresa(conn, empresa)

    assert (fila["worst_state"], fila["own_missing"], fila["fleet_overdue"], fila["can_operate"]) == \
        ("OVERDUE", 1, 1, False)


async def test_empresa_no_activa_sin_pendientes_tampoco_esta_habilitada(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, "LEGACY_INACTIVE")
    await _sin_registros(conn, empresa)
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["worst_state"], fila["can_operate"]) == ("UP_TO_DATE", False)


# ── Las cifras de una empresa activa son las de Pendientes ───────────────────

async def test_las_cifras_de_una_empresa_activa_son_las_de_pendientes(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    de_baja = await _conductor(conn, empresa, estado="INACTIVE")
    tracto = await _tracto(conn, empresa)
    await _sin_registros(conn, empresa, conductor, de_baja, tracto)
    await _registro(conn, await _requisito(conn, "CARRIER"), "CARRIER", empresa)
    await _registro(conn, await _requisito(conn, "CARRIER", nivel="CONDITIONAL_OPTIONAL"), "CARRIER", empresa,
                    status="APPROVED_MANUAL", vence=hoy + timedelta(days=3))
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor,
                    status="APPROVED_MANUAL", vence=hoy - timedelta(days=2))
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", de_baja)
    await _registro(conn, await _requisito(conn, "ASSET"), "ASSET", tracto)

    resumen = summary_from_row(await _de_la_empresa(conn, empresa), with_fleet=True)
    pendientes = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in pendientes["rows"] if r["key"] == str(empresa))

    total = (resumen.own.overdue + resumen.fleet.overdue, resumen.own.expiring + resumen.fleet.expiring,
             resumen.own.missing + resumen.fleet.missing)
    assert total == (fila["overdue"], fila["expiring"], fila["missing"]) == (1, 1, 2)
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_fleet_compliance.py tests/test_fleet_compliance_integration.py -q`
Expected: FAIL en la colección de los dos archivos con `ImportError: cannot import name 'carrier_compliance_cte' from 'app.services.fleet_compliance'`. El módulo solo tiene la base mudada (Step 4).

- [ ] **Step 7: Implement the summaries, the rule and the warning**

Agregar al final de `app/services/fleet_compliance.py`, debajo de `pending_base_ctes`. Los imports de `vencimientos` del encabezado ya cubren todo lo que sigue.

```python
# ── El resumen de quien debe documentos ──────────────────────────────────────

def _lista(estados: tuple[str, ...]) -> str:
    return ", ".join(f"'{e}'" for e in estados)


_PENDIENTES = _lista(PENDING_STATES)
_BLOQUEAN = _lista(BLOCKING_STATES)


def _peor_estado(alias: str) -> str:
    """El peor estado de los OBLIGATORIOS del grupo (spec §3; ruling A-R5), en
    el orden de SEVERITY_ORDER. Un opcional pendiente cuenta en las cifras pero
    no empeora el resumen. Sin filas (una empresa sin pendientes, unida con LEFT
    JOIN) o solo con opcionales, cae a UP_TO_DATE."""
    ramas = " ".join(
        f"WHEN bool_or({alias}.document_state = '{e}' AND {alias}.requirement_level = 'LEGAL_MANDATORY') "
        f"THEN '{e}'"
        for e in SEVERITY_ORDER if e != "UP_TO_DATE")
    return f"(CASE {ramas} ELSE 'UP_TO_DATE' END)"


def _cifra(estado: str, condicion: str = "true") -> str:
    return f"(count(*) FILTER (WHERE o.document_state = '{estado}' AND {condicion}))::int"


def entity_compliance_cte() -> str:
    """CTE `entity_compliance`: por entidad (empresa, conductor o equipo), lo
    suyo que está pendiente. Una fila solo por entidad con algo pendiente: quien
    la lee hace LEFT JOIN y `summary_from_row` vuelve los NULL a 0.

    Sin alcance a propósito: es lo que la entidad debe, esté activa o no (la
    ficha de una entidad de baja muestra su historial). Para la flota activa de
    una empresa activa coincide con el alcance de Pendientes."""
    return f"""entity_compliance AS (
    WITH {pending_base_ctes("'falta'")}
    SELECT o.entity_type::text AS entity_type, o.entity_id,
           {_peor_estado('o')} AS worst_state,
           {_cifra('OVERDUE')} AS overdue,
           {_cifra('EXPIRING')} AS expiring,
           {_cifra('MISSING')} AS missing,
           (count(*) FILTER (WHERE o.requirement_level = 'LEGAL_MANDATORY'
                               AND o.document_state IN ({_BLOQUEAN})))::int AS blocking_mandatory
    FROM pending o
    WHERE o.document_state IN ({_PENDIENTES})
    GROUP BY o.entity_type, o.entity_id
)"""


def carrier_compliance_cte() -> str:
    """CTE `carrier_compliance`: una fila por CADA empresa (también las que no
    deben nada), con lo propio, lo de su flota y la habilitación.

    Alcance de las cifras:
      - empresa ACTIVE: el de Pendientes (in_scope, empresa atribuida =
        resolved_carrier_id). Por eso sus cifras son las de su fila en
        /pending/summary?group_by=carrier;
      - empresa no activa (ruling D1-R1): sus registros más los de su
        app.active_fleet, sin exigir empresa activa (in_scope la exige y daría 0).

    worst_state: el peor de los obligatorios (A-R5); las cifras cuentan todo.

    Habilitación: ACTIVE y sin ningún LEGAL_MANDATORY vencido o faltante, propio
    o de app.active_fleet. Por vencer no bloquea; los opcionales no bloquean pero
    cuentan en las cifras. Un documento al término de quien ya se fue cuenta en
    la flota (Pendientes lo muestra) pero no bloquea: no es flota activa."""
    return f"""carrier_compliance AS (
    WITH {pending_base_ctes("'falta'")},
    owed AS (
        SELECT r.resolved_carrier_id AS carrier_id, r.entity_type, r.document_state, r.requirement_level,
               (r.requirement_level = 'LEGAL_MANDATORY' AND r.document_state IN ({_BLOQUEAN})
                AND (r.entity_type = 'CARRIER' OR af.entity_id IS NOT NULL)) AS blocks
        FROM resolved r
        JOIN public.carriers c ON c.id = r.resolved_carrier_id AND c.operational_status = 'ACTIVE'
        LEFT JOIN app.active_fleet af
               ON af.carrier_id = r.resolved_carrier_id AND af.entity_type = r.entity_type
              AND af.entity_id = r.entity_id
        WHERE r.in_scope AND r.document_state IN ({_PENDIENTES})
        UNION ALL
        SELECT c.id, r.entity_type, r.document_state, r.requirement_level, false
        FROM resolved r
        JOIN public.carriers c
          ON r.entity_type = 'CARRIER' AND c.id = r.entity_id AND c.operational_status <> 'ACTIVE'
        WHERE r.document_state IN ({_PENDIENTES})
        UNION ALL
        SELECT af.carrier_id, r.entity_type, r.document_state, r.requirement_level, false
        FROM resolved r
        JOIN app.active_fleet af ON af.entity_type = r.entity_type AND af.entity_id = r.entity_id
        JOIN public.carriers c ON c.id = af.carrier_id AND c.operational_status <> 'ACTIVE'
        WHERE r.document_state IN ({_PENDIENTES})
    )
    SELECT c.id AS carrier_id,
           {_peor_estado('o')} AS worst_state,
           {_cifra('OVERDUE', "o.entity_type = 'CARRIER'")} AS own_overdue,
           {_cifra('EXPIRING', "o.entity_type = 'CARRIER'")} AS own_expiring,
           {_cifra('MISSING', "o.entity_type = 'CARRIER'")} AS own_missing,
           {_cifra('OVERDUE', "o.entity_type <> 'CARRIER'")} AS fleet_overdue,
           {_cifra('EXPIRING', "o.entity_type <> 'CARRIER'")} AS fleet_expiring,
           {_cifra('MISSING', "o.entity_type <> 'CARRIER'")} AS fleet_missing,
           (c.operational_status = 'ACTIVE' AND NOT COALESCE(bool_or(o.blocks), false)) AS can_operate
    FROM public.carriers c
    LEFT JOIN owed o ON o.carrier_id = c.id
    GROUP BY c.id, c.operational_status
)"""


def _n(row: Mapping[str, Any], clave: str) -> int:
    valor = row[clave]
    return 0 if valor is None else int(valor)


def summary_from_row(row: Mapping[str, Any], *, with_fleet: bool) -> ComplianceSummary:
    """El modelo del contrato desde una fila de `carrier_compliance`
    (with_fleet=True) o de `entity_compliance` (with_fleet=False). Un NULL en las
    cifras vale 0 y un worst_state NULL vale UP_TO_DATE: es la fila de quien no
    debe nada, unida con LEFT JOIN.

    Una fila de entidad no trae la habilitación hecha: la arma con
    `blocking_mandatory` y el `operational_status` de la entidad, que el lector
    tiene que seleccionar (si falta, KeyError: mejor que inventar "activa")."""
    worst = row["worst_state"] or "UP_TO_DATE"
    if with_fleet:
        return ComplianceSummary(
            worst_state=worst,
            own=StateCounts(overdue=_n(row, "own_overdue"), expiring=_n(row, "own_expiring"),
                            missing=_n(row, "own_missing")),
            fleet=StateCounts(overdue=_n(row, "fleet_overdue"), expiring=_n(row, "fleet_expiring"),
                              missing=_n(row, "fleet_missing")),
            can_operate=bool(row["can_operate"]),
        )
    return ComplianceSummary(
        worst_state=worst,
        own=StateCounts(overdue=_n(row, "overdue"), expiring=_n(row, "expiring"), missing=_n(row, "missing")),
        fleet=None,
        can_operate=row["operational_status"] == "ACTIVE" and _n(row, "blocking_mandatory") == 0,
    )


# ── El aviso de un documento ─────────────────────────────────────────────────
#
# "Crítico" no es un estado (E-e): es un aviso calculado con los días que faltan
# y el umbral global de Configuración › Alertas. Las filas por documento de
# app.alert_thresholds no se leen (D1-R4).

_ERROR_DAYS = (
    "(SELECT vg_ae.error_days FROM app.alert_thresholds vg_ae "
    "WHERE vg_ae.doc_type = 'documento_por_vencer')"
)


def days_to_expiry_sql(alias: str = "cr") -> str:
    """Días de Chile hasta el vencimiento calculado (negativo si ya venció), o
    NULL si no vence, falta, o le falta el dato de vigencia (-infinity)."""
    return f"(NULLIF({vence_el_sql(alias)}, '-infinity'::date) - {hoy_sql()})"


def alert_severity_sql(alias: str = "cr") -> str:
    """'critical' si se exige, no está vencido y le faltan como mucho los
    `error_days` del umbral global; 'warning' si está por vencer
    (`por_vencer_predicate`, que ya respeta los días de aviso de cada regla);
    NULL en otro caso. "No vencido" es lo mismo que en document_state_sql: ni
    marcado EXPIRED ni pasado de su fecha. Un documento vencido no lleva aviso:
    su estado ya lo dice."""
    vigente = f"({exigible_sql(alias)} AND NOT ({alias}.status = 'EXPIRED' OR {vencido_predicate(alias)}))"
    return (
        f"(CASE WHEN {vigente} AND {days_to_expiry_sql(alias)} <= {_ERROR_DAYS} THEN 'critical' "
        f"WHEN {vigente} AND {por_vencer_predicate(alias)} THEN 'warning' END)"
    )
```

- [ ] **Step 8: Run them to verify they pass**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_fleet_compliance.py tests/test_fleet_compliance_integration.py tests/test_pending_documents_integration.py tests/test_compliance.py -q`
Expected: PASS. Medido el 12/10: `8 passed` en el unitario y `11 passed` en el de integración.

- [ ] **Step 9: Verificar que la mutación mata el test**

Cada una por separado, en `fleet_compliance.py`; se corre `tests/test_fleet_compliance_integration.py`, se ve el FAIL y se restaura. Las cinco se midieron el 12/10:

| # | Mutación | Falla |
|---|---|---|
| 1 | En `owed`, `r.document_state IN ({_BLOQUEAN})` → `IN ({_PENDIENTES})` (por vencer bloquea) | `test_por_vencer_no_inhabilita` |
| 2 | Quitar `c.operational_status = 'ACTIVE' AND` de `can_operate` | `test_empresa_no_activa_nunca_habilitada_…` y `test_empresa_no_activa_sin_pendientes_…` |
| 3 | Quitar `r.requirement_level = 'LEGAL_MANDATORY' AND` de `blocks` (los opcionales bloquean) | `test_un_opcional_vencido_no_inhabilita_ni_empeora_pero_cuenta` |
| 4 | En `days_to_expiry_sql`, `{hoy_sql()}` → `CURRENT_DATE` | `test_aviso_en_el_borde_del_dia_de_chile` |
| 5 | En `_peor_estado`, quitar `AND {alias}.requirement_level = 'LEGAL_MANDATORY'` (los opcionales empeoran el resumen) | `test_un_opcional_vencido_no_inhabilita_ni_empeora_pero_cuenta` |

Registrar las cinco en el ledger (spec §8.4).

- [ ] **Step 10: Measure `carrier_compliance` over every carrier (meta < 300 ms)**

Solo lectura sobre los datos. Crea los hechos de la flota (`apply_fleet_facts`, sin los CHECK) dentro de una transacción que se revierte, porque la migración se aplica en la Task 10. No toma locks sobre tablas de la app.

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
import asyncpg
from tests.conftest import credenciales_integracion
from tests.d1_subjects import apply_fleet_facts
from app.services.fleet_compliance import carrier_compliance_cte

async def main():
    conn = await asyncpg.connect(**credenciales_integracion())
    tx = conn.transaction(); await tx.start()
    try:
        await apply_fleet_facts(conn)
        sql = f"WITH {carrier_compliance_cte()} SELECT * FROM carrier_compliance"
        for _ in range(3):
            plan = await conn.fetch(f"EXPLAIN (ANALYZE, BUFFERS) {sql}")
            print([r[0] for r in plan if r[0].startswith(("Planning Time", "Execution Time"))])
    finally:
        await tx.rollback(); await conn.close()

asyncio.run(main())
EOF
```

Expected:
- `Execution Time` bajo 300 ms. Medido el 12/10: 84-90 ms de ejecución y 24-29 ms de planificación, sobre las 251 empresas.
- Si pasa de 300 ms, parar y reportar con el plan (`EXPLAIN` completo). No optimizar a ciegas.

- [ ] **Step 11: Commit**

```bash
git add monitor-app/backend/api/app/services/fleet_compliance.py \
  monitor-app/backend/api/tests/test_fleet_compliance.py \
  monitor-app/backend/api/tests/test_fleet_compliance_integration.py
git commit -m "feat(d1): resumen por entidad y por empresa, habilitación y aviso en un módulo

entity_compliance_cte y carrier_compliance_cte sobre la base de Pendientes: las
cifras de una empresa activa son las de su fila en /pending/summary. Habilitada
= activa y sin obligatorios vencidos o faltantes, propios o de su flota activa.
Aviso crítico por días y umbral global, con el día de Chile. 85-90 ms sobre las
251 empresas (D1).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: El Directorio lee una sola respuesta

**Files:**
- Modify: `monitor-app/backend/api/app/services/fleet_compliance.py` (agregar al final)
- Modify: `monitor-app/backend/api/app/schemas/carrier.py:130-150` (`CarrierListFacets`, `CarrierListResponse`)
- Modify: `monitor-app/backend/api/app/routers/carriers.py`:
  - `:94-170` (`list_carriers`, con `enablement`, R-B14)
  - `:279-331` (`_assemble_carrier_detail`)
  - `:359-378` (`_SQL_DIRECTORIO`)
  - `:736-762` (`list_carrier_drivers`)
  - `:874-904` (`list_carrier_assets`)
- Modify: `monitor-app/backend/api/app/routers/drivers.py:384-411` y `monitor-app/backend/api/app/routers/assets.py:250-277` (`compliance-records`, R-B7)
- Modify: `monitor-app/backend/api/tests/d1_subjects.py` (lo crea la Task 2 con `apply_fleet_facts`; aquí se le agregan las fábricas de sujetos)
- Create: `monitor-app/backend/api/tests/test_d1_directory_integration.py`
- Create: `monitor-app/backend/api/tests/test_fleet_compliance_readers.py`
- Modify: `monitor-app/backend/api/tests/test_carriers.py`:
  - `:29-49`, `:240-263`, `:394-412`, `:442-468`, `:486-512` (mocks con las columnas del resumen);
  - `:530-568` (rosters).
- Modify: `monitor-app/backend/api/tests/test_d1_equivalence_integration.py` (quitar el `xfail` de `test_directorio_cuenta_lo_mismo_que_pendientes`)

**Interfaces:**
- Consumes:
  - `carrier_compliance_cte()`, `entity_compliance_cte()`, `summary_from_row(row, *, with_fleet)`, `days_to_expiry_sql(alias)` y `alert_severity_sql(alias)` (Task 4);
  - `document_state_sql(alias)` (`vencimientos.py`);
  - `app.active_fleet` (Task 2);
  - `ComplianceSummary` y `CarrierLifecycle` (Task 3).
- Produces (aditivo, R-B11), en `fleet_compliance.py`:
  - `CARRIER_SUMMARY_COLUMNS: tuple[str, ...] = ("worst_state", "own_overdue", "own_expiring", "own_missing", "fleet_overdue", "fleet_expiring", "fleet_missing", "can_operate")`
  - `ENTITY_SUMMARY_COLUMNS: tuple[str, ...] = ("worst_state", "own_overdue", "own_expiring", "own_missing", "can_operate")`
  - `compliance_record_columns_sql(alias: str = "cr") -> str` (`document_state`, `days_to_expiry`, `alert_severity`)
  - `entity_summary_columns_sql(lifecycle_expr: str, alias: str = "ec") -> str`
  - `carrier_summary_columns_sql(alias: str = "cc") -> str`
  - `take_summary(row: dict, *, with_fleet: bool) -> dict`
  - `ENABLEMENT_FILTERS: dict[str, str] = {"enabled": "can_operate", "not_enabled": "operational_status = 'ACTIVE' AND NOT can_operate"}`
- Produces (API):
  - `GET /carriers`:
    - cada fila suma `compliance_summary` (con `fleet`);
    - acepta `enablement: Literal["enabled", "not_enabled", ""]`, un filtro del servidor compatible con la paginación y con `health`;
    - `facets` suma `enabled` y `not_enabled`, sobre el mismo universo que `pending`/`ok` (`q` + `operational_status`, sin los filtros `health` ni `enablement`) (R-B14).
  - `GET /carriers/{id}`: suma `compliance_summary` (con `fleet`); cada `compliance_records[i]` suma `document_state`, `days_to_expiry` y `alert_severity`.
  - `GET /carriers/{id}/drivers` y `/assets`: cada fila suma `compliance_summary` (`fleet: null`).
  - `GET /drivers/{id}/compliance-records` y `GET /assets/{id}/compliance-records`: cada registro suma los tres campos.
  - `GET /carriers/directorio`: `flota.conductores`, `flota.tractos` y `flota.ramplas` cuentan `app.active_fleet` (D1-R3, 84 → 78 y 86 → 84).
  - `compliance_health` y `pending_mandatory` siguen presentes (los retira la Task 16).

- [ ] **Step 1: Extend the shared test subjects**

La Task 2 crea `tests/d1_subjects.py` con `apply_fleet_facts(conn)`: ejecuta la migración solo hasta `-- d1:checks`, sin tomar el lock de los CHECK. Esta tarea **agrega** las fábricas de sujetos debajo, sin tocar `apply_fleet_facts`.

Patrón copiado de `tests/test_pending_documents_integration.py`: `_empresa`, `_conductor`, `_requisito` (requisitos apagados) y `_registro`.

Agregar al docstring del módulo:

```python
"""…

Los sujetos los crea cada test, con el prefijo ZZ-TEST-D1, dentro de
`conexion_revertida`. Los requisitos nacen apagados (is_active = false): la
siembra no los ve. Lo que la siembra SÍ crea para los requisitos activos del
catálogo al dar de alta una empresa, un conductor o un equipo se borra con
`without_seeding`, para que el sujeto tenga exactamente lo que el test le da y
ninguna cifra dependa de producción."""
```

Y debajo de `apply_fleet_facts`, con los imports que falten (`from datetime import date`, `from uuid import uuid4`):

```python
PREFIX = "ZZ-TEST-D1"


def suffix() -> str:
    return uuid4().hex[:8]


async def today(conn) -> date:
    return await conn.fetchval("SELECT public.hoy_chile()")


async def thresholds(conn, *, warning: int = 30, critical: int = 0) -> None:
    """Fija el umbral global de Configuración › Alertas para el test: ningún
    caso de aviso depende del valor que tenga producción."""
    await conn.execute(
        "UPDATE app.alert_thresholds SET warning_days = $1, error_days = $2 "
        "WHERE doc_type = 'documento_por_vencer'", warning, critical)


async def carrier(conn, *, status: str = "ACTIVE", management_types: list[str] | None = None) -> str:
    s = suffix()
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status, management_types) "
        "VALUES ($1, $2, $3, $4) RETURNING id",
        f"{PREFIX} Empresa {s}", f"{PREFIX}-{s}", status, management_types))


async def driver(conn, carrier_id: str | None, *, status: str = "ACTIVE", name: str | None = None) -> str:
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        name or f"{PREFIX} Conductor {suffix()}", status))
    if carrier_id:
        # La asignación queda ACTIVE aunque el conductor esté de baja: dar de
        # baja (PATCH operational_status) no la toca (F-03).
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, 'ACTIVE', public.hoy_chile() - 400)", d, carrier_id)
    return d


async def asset(conn, carrier_id: str | None, *, status: str = "ACTIVE",
                asset_type: str = "TRACTOCAMION") -> str:
    a = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"ZZ{uuid4().hex[:4].upper()}", asset_type, status))
    if carrier_id:
        await conn.execute(
            "INSERT INTO public.asset_assignments (asset_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, 'ACTIVE', public.hoy_chile() - 400)", a, carrier_id)
    return a


async def usual_driver(conn, asset_id: str, driver_id: str, start: date) -> None:
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, status, source, is_manual_override, start_date) "
        "VALUES ($1, $2, 'ACTIVE', 'manual', true, $3)", asset_id, driver_id, start)


async def requirement(conn, *, entity: str, level: str = "LEGAL_MANDATORY",
                      policy: str = "REQUIRED", exigible_on: str = "ON_ENTITY_START") -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ($1, $2, $3, $4, $5, $6, false, true)
        RETURNING id
        """,
        entity, f"ZZ_D1_{suffix().upper()}", f"{PREFIX} documento", level, policy, exigible_on))


async def record(conn, requirement_id: str, entity_type: str, entity_id: str, *,
                 status: str = "MISSING", expires: date | None = None) -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_records
            (entity_id, entity_type, requirement_id, status, is_current, expiration_date, file_url)
        VALUES ($1, $2, $3, $4, true, $5, $6)
        RETURNING id
        """,
        entity_id, entity_type, requirement_id, status, expires,
        None if status == "MISSING" else "zz/test.pdf"))


async def without_seeding(conn, *entity_ids: str) -> None:
    await conn.execute(
        "DELETE FROM public.compliance_records WHERE entity_id = ANY($1::uuid[])", list(entity_ids))
```

- [ ] **Step 2: Write the failing integration tests**

Patrón copiado de `tests/test_directorio.py` (antes y después de `get_directorio` sobre `PoolDeUnaConexion`) y de `tests/test_live_driver_roster_integration.py` (llamar el endpoint directo). Crear `tests/test_d1_directory_integration.py`:

```python
"""D1 "Una sola respuesta", Task 5: el Directorio lee una sola respuesta
(spec 2026-10-12-directory-d1-one-answer-design.md §6.1).

La tira de cifras contaba conductores y equipos dados de baja (84 frente a 78,
F-03). La lista decía "pendiente" a las 251 empresas, con un criterio propio
que no era el de Pendientes (F-02). Contra Postgres de verdad, en una
transacción revertida."""
from __future__ import annotations

from datetime import timedelta

import pytest

from app.routers.carriers import (
    get_carrier, get_directorio, list_carrier_assets, list_carrier_drivers, list_carriers,
)
from tests import d1_subjects as s
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def _flota_mixta(conn) -> dict:
    """Empresa activa con un conductor y un tracto activos, y otro de cada uno
    dado de baja que conserva su asignación ACTIVE."""
    c = await s.carrier(conn)
    f = {
        "carrier": c,
        "driver": await s.driver(conn, c),
        "inactive_driver": await s.driver(conn, c, status="INACTIVE"),
        "tractor": await s.asset(conn, c),
        "inactive_tractor": await s.asset(conn, c, status="INACTIVE"),
    }
    await s.without_seeding(conn, *f.values())
    return f


async def _lista(conn) -> dict:
    return await list_carriers(q=s.PREFIX, operational_status="", health="", enablement="",
                               page=1, limit=100, pool=PoolDeUnaConexion(conn), _=None)


async def test_la_tira_del_directorio_cuenta_solo_la_flota_activa(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    pool = PoolDeUnaConexion(conn)
    antes = await get_directorio(pool=pool, _=None)

    await _flota_mixta(conn)
    despues = await get_directorio(pool=pool, _=None)

    assert despues["flota"]["conductores"] == antes["flota"]["conductores"] + 1, (
        "se contó a un conductor dado de baja")
    assert despues["flota"]["tractos"] == antes["flota"]["tractos"] + 1, (
        "se contó a un tracto dado de baja")


async def test_la_lista_trae_el_resumen_con_la_flota_activa(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_mixta(conn)
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", f["driver"])
    # El de baja está fuera de alcance: no cuenta ni bloquea.
    await s.record(conn, req, "DRIVER", f["inactive_driver"])

    fila = next(r for r in (await _lista(conn))["data"] if str(r["id"]) == f["carrier"])

    assert fila["compliance_summary"] == {
        "worst_state": "MISSING",
        "own": {"overdue": 0, "expiring": 0, "missing": 0},
        "fleet": {"overdue": 0, "expiring": 0, "missing": 1},
        "can_operate": False,
    }
    # Lo viejo sigue al lado hasta la Task 16.
    assert {"compliance_health", "pending_mandatory"} <= set(fila)
    # Las columnas sueltas no viajan: la respuesta trae el resumen, no ocho campos planos.
    assert "own_missing" not in fila and "can_operate" not in fila


async def test_por_vencer_y_opcionales_no_quitan_la_habilitacion(conexion_revertida):
    """E-c: "por vencer" cuenta como al día. Los opcionales cuentan en las
    cifras pero no bloquean."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    await s.without_seeding(conn, c)
    obligatorio = await s.requirement(conn, entity="CARRIER")
    # CONDITIONAL_OPTIONAL: el nivel opcional que admite el CHECK.
    opcional = await s.requirement(conn, entity="CARRIER", level="CONDITIONAL_OPTIONAL")
    await s.record(conn, obligatorio, "CARRIER", c, status="APPROVED_MANUAL", expires=hoy + timedelta(days=10))
    await s.record(conn, opcional, "CARRIER", c)

    resumen = next(r for r in (await _lista(conn))["data"] if str(r["id"]) == c)["compliance_summary"]

    assert resumen["can_operate"] is True
    assert resumen["own"] == {"overdue": 0, "expiring": 1, "missing": 1}


async def test_una_empresa_dada_de_baja_nunca_esta_habilitada(conexion_revertida):
    """D1-R1: sus cifras se calculan (historial) y can_operate es false."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    c = await s.carrier(conn, status="LEGACY_INACTIVE")
    await s.without_seeding(conn, c)

    resumen = next(r for r in (await _lista(conn))["data"] if str(r["id"]) == c)["compliance_summary"]

    assert resumen["can_operate"] is False


async def test_el_filtro_de_habilitacion_corre_en_el_servidor(conexion_revertida):
    """R-B14 (D-R6): Habilitada / No habilitada como filtro y faceta, con la
    misma regla que el resumen. Una empresa dada de baja no es ninguna de las dos."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    habilitada = await s.carrier(conn)
    no_habilitada = await s.carrier(conn)
    de_baja = await s.carrier(conn, status="INACTIVE")
    await s.without_seeding(conn, habilitada, no_habilitada, de_baja)
    await s.record(conn, await s.requirement(conn, entity="CARRIER"), "CARRIER", no_habilitada)
    pool = PoolDeUnaConexion(conn)

    async def pedir(enablement: str) -> dict:
        return await list_carriers(q=s.PREFIX, operational_status="", health="", enablement=enablement,
                                   page=1, limit=100, pool=pool, _=None)

    assert [str(r["id"]) for r in (await pedir("enabled"))["data"]] == [habilitada]
    solo_no = await pedir("not_enabled")
    assert [str(r["id"]) for r in solo_no["data"]] == [no_habilitada]
    assert solo_no["count"] == 1
    # Las facetas no dependen del filtro activo.
    assert (solo_no["facets"]["enabled"], solo_no["facets"]["not_enabled"], solo_no["facets"]["total"]) == (1, 1, 3)


async def test_la_ficha_trae_estado_dias_y_aviso_por_documento(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    f = await _flota_mixta(conn)
    propio = await s.requirement(conn, entity="CARRIER")
    await s.record(conn, propio, "CARRIER", f["carrier"], status="APPROVED_MANUAL",
                   expires=hoy + timedelta(days=5))
    de_flota = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, de_flota, "DRIVER", f["driver"])
    await s.record(conn, de_flota, "DRIVER", f["inactive_driver"])

    ficha = await get_carrier(f["carrier"], pool=PoolDeUnaConexion(conn), supabase=None, _=None)

    reg = next(r for r in ficha["compliance_records"] if str(r["requirement_id"]) == propio)
    assert (reg["document_state"], reg["days_to_expiry"], reg["alert_severity"]) == ("EXPIRING", 5, "warning")
    # `status` es el historial del archivo, no su vigencia (spec §3).
    assert reg["status"] == "APPROVED_MANUAL"
    assert ficha["compliance_summary"]["own"] == {"overdue": 0, "expiring": 1, "missing": 0}
    assert ficha["compliance_summary"]["fleet"] == {"overdue": 0, "expiring": 0, "missing": 1}
    assert ficha["compliance_summary"]["can_operate"] is False


async def test_el_roster_trae_el_resumen_de_cada_conductor(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_mixta(conn)
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", f["driver"])

    filas = {str(r["id"]): r for r in await list_carrier_drivers(
        f["carrier"], pool=PoolDeUnaConexion(conn), _=None)}

    assert filas[f["driver"]]["compliance_summary"] == {
        "worst_state": "MISSING",
        "own": {"overdue": 0, "expiring": 0, "missing": 1},
        "fleet": None,
        "can_operate": False,
    }
    # Dado de baja y sin pendientes: nada que deba, y aun así no habilitado (R-B2).
    de_baja = filas[f["inactive_driver"]]["compliance_summary"]
    assert (de_baja["worst_state"], de_baja["can_operate"]) == ("UP_TO_DATE", False)


async def test_el_roster_de_equipos_se_lee_en_vivo_y_trae_su_resumen(conexion_revertida):
    """R-B8: app.carrier_asset_roster no se refresca con public.assets. Dar de
    baja un tracto dejaba ACTIVE en la ficha, y can_operate saldría mal."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    c = await s.carrier(conn)
    a = await s.asset(conn, c)
    await s.without_seeding(conn, c, a)
    await conn.execute("UPDATE public.assets SET operational_status = 'INACTIVE' WHERE id = $1", a)

    filas = await list_carrier_assets(c, pool=PoolDeUnaConexion(conn), _=None)

    assert [(str(r["id"]), r["operational_status"]) for r in filas] == [(a, "INACTIVE")]
    assert filas[0]["compliance_summary"]["can_operate"] is False
    assert {"compliance_health", "pending_mandatory", "webcarga_operation_type_code"} <= set(filas[0])
```

Crear `tests/test_fleet_compliance_readers.py` (unidad, sin base):

```python
"""Proyecciones de fleet_compliance para los lectores (D1, Task 5)."""
from app.services.fleet_compliance import take_summary


def _fila(**extra):
    return {"id": "c1", "worst_state": "OVERDUE", "own_overdue": 1, "own_expiring": 0, "own_missing": 2,
            "fleet_overdue": 0, "fleet_expiring": 3, "fleet_missing": 0, "can_operate": False, **extra}


def test_take_summary_arma_el_resumen_y_saca_las_columnas_sueltas():
    fila = _fila()
    resumen = take_summary(fila, with_fleet=True)
    assert resumen == {"worst_state": "OVERDUE", "own": {"overdue": 1, "expiring": 0, "missing": 2},
                       "fleet": {"overdue": 0, "expiring": 3, "missing": 0}, "can_operate": False}
    assert fila == {"id": "c1"}


def test_take_summary_sin_flota_no_inventa_una():
    fila = {"id": "d1", "worst_state": None, "own_overdue": None, "own_expiring": 0, "own_missing": 0,
            "can_operate": True}
    resumen = take_summary(fila, with_fleet=False)
    assert resumen["fleet"] is None
    assert resumen["worst_state"] == "UP_TO_DATE"   # NULL = nada pendiente (contrato Task 4)
    assert resumen["own"]["overdue"] == 0
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_directory_integration.py tests/test_fleet_compliance_readers.py -q`

Expected: FAIL.
- `test_la_tira_…`: `AssertionError: se contó a un conductor dado de baja` (+2 en vez de +1).
- Los de la lista, la ficha y el roster de conductores: `KeyError: 'compliance_summary'` o `KeyError: 'document_state'`.
- `test_el_filtro_de_habilitacion_…`: `TypeError: … unexpected keyword argument 'enablement'`.
- En `test_carriers.py`, los dos tests nuevos de `enablement`: hoy el parámetro se ignora, así que el primero responde 200 en vez de 422.
- El roster de equipos: `[(a, 'ACTIVE')]` o `[]`, según si el trigger de sentencia de `asset_assignments` refrescó la vista.
- La unidad: `ImportError: cannot import name 'take_summary'`.

Si falla antes por `relation "app.active_fleet" does not exist`, `apply_fleet_facts` (Task 2) no está ejecutando la migración: se corrige el helper, no el código.

- [ ] **Step 4: Add the projections to `fleet_compliance.py`**

Al final de `app/services/fleet_compliance.py`:

```python
# ── Proyecciones para los lectores (D1, Task 5) ──────────────────────────────
#
# Los lectores no escriben los alias del resumen a mano: si cada uno proyectara
# `own_missing` a su manera, el día que el resumen sume una cifra habría cinco
# lugares que tocar. `summary_from_row` lee estas columnas (ruling R-B1).

CARRIER_SUMMARY_COLUMNS: tuple[str, ...] = (
    "worst_state", "own_overdue", "own_expiring", "own_missing",
    "fleet_overdue", "fleet_expiring", "fleet_missing", "can_operate",
)
ENTITY_SUMMARY_COLUMNS: tuple[str, ...] = (
    "worst_state", "own_overdue", "own_expiring", "own_missing", "can_operate",
)


def compliance_record_columns_sql(alias: str = "cr") -> str:
    """Estado, días que faltan y aviso de un registro, para un SELECT. Lo leen
    la ficha del Directorio y los paneles de conductor y equipo (R-B7); el
    `status` guardado sigue al lado como historial del archivo."""
    return (
        f"{document_state_sql(alias)} AS document_state, "
        f"{days_to_expiry_sql(alias)} AS days_to_expiry, "
        f"{alert_severity_sql(alias)} AS alert_severity"
    )


def entity_summary_columns_sql(lifecycle_expr: str, alias: str = "ec") -> str:
    """El resumen de un conductor o un equipo desde un LEFT JOIN a
    `entity_compliance` (sin fila = nada pendiente). Habilitado = activo y sin
    obligatorios vencidos ni faltantes (R-B2). `lifecycle_expr` es la columna
    `operational_status` de la consulta que llama."""
    return (
        f"{alias}.worst_state AS worst_state, "
        f"COALESCE({alias}.overdue, 0) AS own_overdue, "
        f"COALESCE({alias}.expiring, 0) AS own_expiring, "
        f"COALESCE({alias}.missing, 0) AS own_missing, "
        f"({lifecycle_expr} = 'ACTIVE' AND COALESCE({alias}.blocking_mandatory, 0) = 0) AS can_operate"
    )


def carrier_summary_columns_sql(alias: str = "cc") -> str:
    """El resumen de una empresa desde un JOIN a `carrier_compliance` (una fila
    por empresa, R-B3)."""
    return ", ".join(f"{alias}.{col} AS {col}" for col in CARRIER_SUMMARY_COLUMNS)


# Filtros de habilitación del Directorio (R-B14) sobre una fila que ya trae
# las columnas de `carrier_summary_columns_sql`. Una empresa no activa no es
# ni Habilitada ni No habilitada: la pantalla la muestra en gris.
ENABLEMENT_FILTERS: dict[str, str] = {
    "enabled": "can_operate",
    "not_enabled": "operational_status = 'ACTIVE' AND NOT can_operate",
}


def take_summary(row: dict, *, with_fleet: bool) -> dict:
    """Arma `compliance_summary` desde una fila ya convertida a dict y le saca
    las columnas sueltas: la respuesta lleva el resumen, no ocho campos planos
    que alguien termine leyendo por separado."""
    summary = summary_from_row(row, with_fleet=with_fleet).model_dump()
    for col in CARRIER_SUMMARY_COLUMNS if with_fleet else ENTITY_SUMMARY_COLUMNS:
        row.pop(col, None)
    return summary
```

Si `document_state_sql` no está importado en el módulo, importarlo de `.vencimientos`.

- [ ] **Step 5: Implement the Directorio**

1. `_SQL_DIRECTORIO` (`carriers.py:359`). Reemplazar las tres subconsultas de flota y el comentario que las precede:

```python
# La flota se cuenta SOLO en empresas activas y sobre app.active_fleet: lo
# activo con asignación vigente (D1, spec §4.1). Hasta el 12/10 contaba por
# asignación sola, y dar de baja no la toca: decía 84 conductores donde el
# Cierre ve 78 (F-03). Es la misma pregunta con la respuesta corregida
# (D1-R3), no un campo nuevo.
_SQL_DIRECTORIO = """
SELECT
  (SELECT count(*) FROM public.carriers)                                          AS empresas_total,
  (SELECT count(*) FROM public.carriers WHERE operational_status = 'ACTIVE')      AS activas,
  (SELECT count(*) FROM public.carriers
    WHERE operational_status IN ('LEGACY_INACTIVE', 'INACTIVE'))                  AS inactivas,
  (SELECT count(*) FROM public.carriers WHERE operational_status = 'ONBOARDING')  AS onboarding,
  (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
     JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
     JOIN public.assets a ON a.id = f.entity_id
    WHERE f.entity_type = 'ASSET' AND a.asset_type = 'TRACTOCAMION')              AS tractos,
  (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
     JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
     JOIN public.assets a ON a.id = f.entity_id
    WHERE f.entity_type = 'ASSET' AND a.asset_type = 'RAMPLA')                    AS ramplas,
  (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
     JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
    WHERE f.entity_type = 'DRIVER')                                               AS conductores
"""
```

2. `list_carriers`. El resumen, el filtro `enablement` y sus facetas salen de **una** CTE, `listed`. Las filas son una consulta; el conteo y las facetas, otra. Así la base de Pendientes se paga dos veces y no tres (R-B14).
   - Importar `from ..services.fleet_compliance import CARRIER_SUMMARY_COLUMNS, ENABLEMENT_FILTERS, carrier_compliance_cte, carrier_summary_columns_sql, take_summary`, y `Literal` de `typing`.
   - Nuevo parámetro, después de `health`:

```python
    enablement: Literal["enabled", "not_enabled", ""] = Query(
        "",
        description=(
            "enabled|not_enabled. Habilitada = puede operar (D1); No habilitada = activa "
            "con algún obligatorio vencido o faltante. Una empresa no activa no es ninguna "
            "de las dos: su ciclo de vida ya lo dice."
        ),
    ),
```

   - Reemplazar todo lo que va desde `agg_cte = …` hasta el `return`:

```python
    agg_cte = f"WITH agg AS ({_CARRIER_LIST_AGG.format(where=where, pendiente=pendiente)})"
    # D1: la misma respuesta que Pendientes (spec §5), una vez por consulta.
    # compliance_health y pending_mandatory siguen al lado hasta la Task 16.
    base = (
        f"{agg_cte},\n{carrier_compliance_cte()},\n"
        f"listed AS (SELECT agg.*, {carrier_summary_columns_sql('cc')} FROM agg "
        f"LEFT JOIN carrier_compliance cc ON cc.carrier_id = agg.carrier_id)"
    )

    filter_params = list(params)
    filters: list[str] = []
    if health:
        filter_params.append(health)
        filters.append(f"compliance_health = ${len(filter_params)}")
    if enablement:
        filters.append(f"({ENABLEMENT_FILTERS[enablement]})")
    filter_where = ("WHERE " + " AND ".join(filters)) if filters else ""

    offset = (page - 1) * limit
    lp, op = len(filter_params) + 1, len(filter_params) + 2
    summary_cols = ", ".join(CARRIER_SUMMARY_COLUMNS)

    rows = await pool.fetch(
        f"""
        {base}
        SELECT carrier_id AS id, tax_id, country_code, business_name, operational_status,
               total_requirements, last_document_update, pending_mandatory, compliance_health,
               {summary_cols}
        FROM listed
        {filter_where}
        ORDER BY
            CASE compliance_health WHEN 'PENDING' THEN 1 ELSE 2 END,
            pending_mandatory DESC,
            business_name ASC
        LIMIT ${lp} OFFSET ${op}
        """,
        *filter_params, limit, offset,
    )
    # El conteo de la página y las facetas en una sola pasada. Las facetas son
    # del universo `q` + `operational_status`, sin `health` ni `enablement`:
    # cambiar de pestaña no reordena los otros conteos (CarrierListFacets).
    counts = await pool.fetchrow(
        f"""
        {base}
        SELECT
            COUNT(*) FILTER (WHERE {" AND ".join(filters) or "true"})          AS count,
            COUNT(*) FILTER (WHERE compliance_health = 'PENDING')               AS pending,
            COUNT(*) FILTER (WHERE compliance_health = 'OK')                    AS ok,
            COUNT(*) FILTER (WHERE {ENABLEMENT_FILTERS["enabled"]})             AS enabled,
            COUNT(*) FILTER (WHERE {ENABLEMENT_FILTERS["not_enabled"]})         AS not_enabled,
            COUNT(*)                                                            AS total
        FROM listed
        """,
        *filter_params,
    )
    data = []
    for r in rows:
        fila = dict(r)
        fila["compliance_summary"] = take_summary(fila, with_fleet=True)
        data.append(fila)
    facets = dict(counts)
    count = facets.pop("count")
    return {"data": data, "count": count, "page": page, "limit": limit, "facets": facets}
```

   La variable `health_params` y los dos `pool.fetchval`/`pool.fetchrow` de hoy desaparecen. `filter_params` numera los placeholders igual que antes: con solo `health`, el SQL sigue diciendo `WHERE compliance_health = $1`.

3. `_assemble_carrier_detail`. El resumen viaja en la misma consulta de la empresa; los registros suman los tres campos:

```python
    carrier = await pool.fetchrow(
        f"""
        WITH {carrier_compliance_cte()}
        SELECT c.id, c.tax_id, c.country_code, c.business_name, c.operational_status,
               c.legacy_admin_id, c.erp_id, c.is_manual_override, c.overridden_by, c.overridden_at,
               c.created_at, c.updated_at, c.management_types,
               {carrier_summary_columns_sql('cc')}
        FROM public.carriers c
        LEFT JOIN carrier_compliance cc ON cc.carrier_id = c.id
        WHERE c.id = $1
        """,
        carrier_id,
    )
```

En la consulta de `compliance`, después de `NULLIF({vence_el_sql('cr')}, '-infinity') AS vence_el,`:

```sql
               -- D1: el estado lo calcula la regla de Configuración, no el
               -- `status` guardado (historial del archivo, spec §3).
               {compliance_record_columns_sql('cr')},
```

Y el `return`:

```python
    detail = dict(carrier)
    summary = take_summary(detail, with_fleet=True)
    return {
        **detail,
        "compliance_summary": summary,
        "contacts": [dict(c) for c in contacts],
        "compliance_records": compliance_records,
    }
```

4. `list_carrier_drivers`. Anteponer el CTE y proyectar el resumen. Las columnas de hoy no cambian:

```python
    rows = await pool.fetch(
        f"""
        WITH {entity_compliance_cte()}
        SELECT r.driver_id AS id, r.tax_id, r.full_name, r.operational_status,
               dcs.total_requirements, dcs.last_document_update,
               COALESCE(sev.pending_mandatory, 0) AS pending_mandatory,
               CASE WHEN COALESCE(sev.pending_mandatory, 0) > 0 THEN 'PENDING' ELSE 'OK' END AS compliance_health,
               {entity_summary_columns_sql('r.operational_status', 'ec')}
        FROM (
            SELECT d.id AS driver_id, d.tax_id, d.full_name, d.operational_status
            FROM public.driver_assignments da
            JOIN public.drivers d ON d.id = da.driver_id
            WHERE da.carrier_id = $1 AND da.status = 'ACTIVE'
        ) r
        LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = r.driver_id
        {_pending_mandatory_join('DRIVER', 'driver_id')}
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'DRIVER' AND ec.entity_id = r.driver_id
        ORDER BY r.full_name
        """,
        carrier_id,
    )
    filas = []
    for r in rows:
        fila = dict(r)
        fila["compliance_summary"] = take_summary(fila, with_fleet=False)
        filas.append(fila)
    return filas
```

5. `list_carrier_assets`, en vivo (R-B8). Mismo shape de hoy, más el resumen:

```python
@router.get("/{carrier_id}/assets")
async def list_carrier_assets(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    # En vivo desde public.assets, igual que el roster de conductores (bloque 0,
    # 0.2): app.carrier_asset_roster es materializada y no se refresca cuando
    # se da de baja un equipo. Con el ciclo de vida viejo, la habilitación del
    # equipo saldría mal (D1, R-B8). Los conteos de documentos siguen en
    # app.asset_compliance_status, que sí se refresca con los documentos.
    rows = await pool.fetch(
        f"""
        WITH {entity_compliance_cte()}
        SELECT r.asset_id AS id, r.license_plate, r.asset_type, r.operational_status,
               r.fleet_service_type_id, st.label AS fleet_service_type_label,
               st.bg_color AS fleet_service_type_bg_color, st.text_color AS fleet_service_type_text_color,
               -- Tipo de Operacion WebCarga: decide si el tracto bloquea el cierre del dia.
               r.webcarga_operation_type_id,
               wot.label AS webcarga_operation_type_label,
               wot.code  AS webcarga_operation_type_code,
               acs.total_requirements, acs.last_document_update,
               COALESCE(sev.pending_mandatory, 0) AS pending_mandatory,
               CASE WHEN COALESCE(sev.pending_mandatory, 0) > 0 THEN 'PENDING' ELSE 'OK' END AS compliance_health,
               {entity_summary_columns_sql('r.operational_status', 'ec')}
        FROM (
            SELECT a.id AS asset_id, a.license_plate, a.asset_type, a.operational_status,
                   a.fleet_service_type_id, a.webcarga_operation_type_id
            FROM public.asset_assignments aa
            JOIN public.assets a ON a.id = aa.asset_id
            WHERE aa.carrier_id = $1 AND aa.status = 'ACTIVE'
        ) r
        LEFT JOIN app.status_taxonomies st ON st.id = r.fleet_service_type_id
        LEFT JOIN app.status_taxonomies wot ON wot.id = r.webcarga_operation_type_id
        LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = r.asset_id
        {_pending_mandatory_join('ASSET', 'asset_id')}
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'ASSET' AND ec.entity_id = r.asset_id
        ORDER BY r.license_plate
        """,
        carrier_id,
    )
    filas = []
    for r in rows:
        fila = dict(r)
        fila["compliance_summary"] = take_summary(fila, with_fleet=False)
        filas.append(fila)
    return filas
```

6. R-B7. En `drivers.py:list_driver_compliance_records` y `assets.py:list_asset_compliance_records`, agregar `{compliance_record_columns_sql('cr')},` después de la línea de `vence_el`, igual que en la ficha. Cada uno importa `from ..services.fleet_compliance import compliance_record_columns_sql`.

- [ ] **Step 6: Update the response schema**

En `app/schemas/carrier.py`, antes de `CarrierListResponse`:

```python
from uuid import UUID

from .states import CarrierLifecycle, ComplianceSummary


class CarrierListItem(BaseModel):
    """Una fila del Directorio. `compliance_summary` es la respuesta única
    (D1); `pending_mandatory` y `compliance_health` siguen al lado hasta la
    Task 16, porque el frontend del despliegue 1 todavía los pinta."""
    id: UUID | str
    tax_id: Optional[str] = None
    country_code: Optional[str] = None
    business_name: str
    operational_status: CarrierLifecycle
    total_requirements: int
    last_document_update: Optional[datetime] = None
    pending_mandatory: int
    compliance_health: Literal["PENDING", "OK"]
    compliance_summary: ComplianceSummary
```

En `CarrierListFacets`, agregar `enabled: int` y `not_enabled: int`, y sumar al docstring: "`enabled`/`not_enabled`: habilitación calculada (D1, R-B14); una empresa no activa no cuenta en ninguna". En `CarrierListResponse`, `data: list[CarrierListItem]`.

- [ ] **Step 7: Update the mocked tests that fixed the old shape**

En `tests/test_carriers.py`, `_carrier_facets_row` pasa a traer el conteo y las dos facetas nuevas, porque ahora salen de la misma fila:

```python
def _carrier_facets_row(**overrides):
    base = {"count": 0, "pending": 0, "ok": 0, "enabled": 0, "not_enabled": 0, "total": 0}
    base.update(overrides)
    return base
```

En `test_list_carriers_aggregates_pending_mandatory_docs`:
- el conteo ya no viene de `pool.fetchval`: `pool.fetchrow.return_value = _carrier_facets_row(count=1, pending=1, total=1)`;
- la aserción de facetas pasa a `{"pending": 1, "ok": 0, "enabled": 0, "not_enabled": 0, "total": 1}`.

Debajo de la función:

```python
# Las columnas que lee take_summary (D1, Task 5): una empresa sin pendientes.
RESUMEN_VACIO = {"worst_state": None, "own_overdue": 0, "own_expiring": 0, "own_missing": 0,
                 "fleet_overdue": 0, "fleet_expiring": 0, "fleet_missing": 0, "can_operate": True}
RESUMEN_VACIO_ENTIDAD = {k: v for k, v in RESUMEN_VACIO.items() if not k.startswith("fleet_")}


def test_list_carriers_rejects_invalid_enablement():
    pool = AsyncMock()
    assert make_client(pool).get("/api/v1/carriers?enablement=BOGUS").status_code == 422


def test_list_carriers_enablement_binds_every_placeholder():
    """Mismo guardarraíl que test_status_binds_exactly_the_parameters_it_references:
    un filtro nuevo no puede dejar un $n sin su argumento (los AsyncMock no lo ven)."""
    import re

    for query in ("enablement=enabled", "enablement=not_enabled&health=PENDING&q=Acme"):
        pool = AsyncMock()
        pool.fetch.return_value = []
        pool.fetchrow.return_value = _carrier_facets_row()
        make_client(pool).get(f"/api/v1/carriers?{query}")
        for call in (pool.fetch.call_args, pool.fetchrow.call_args):
            sql, *args = call.args
            assert {int(n) for n in re.findall(r"\$(\d+)", sql)} == set(range(1, len(args) + 1)), query
```

- Sumar `**RESUMEN_VACIO` a la fila de `test_list_carriers_aggregates_pending_mandatory_docs` (`:31`), y agregar:

```python
    assert body["data"][0]["compliance_summary"]["can_operate"] is True
```

- Sumar `**RESUMEN_VACIO` al `pool.fetchrow.return_value` de la empresa en:
  - `test_get_carrier_assembles_nested_contacts_and_compliance` (`:242`);
  - `test_patch_carrier_sets_manual_override_and_returns_detail` (`:399`);
  - `test_patch_carrier_management_types_audits_without_keyerror` (`:453`);
  - `test_patch_carrier_sets_tax_id_and_activates` (`:494`).
- Sumar `**RESUMEN_VACIO_ENTIDAD` a las filas de `test_list_carrier_drivers_includes_pending_mandatory` (`:532`) y de `test_list_carrier_assets_includes_pending_mandatory` (`:554`).
- En el segundo, `assert "FROM app.carrier_asset_roster r" in fetch_query` (`:567`) fija exactamente el defecto de R-B8. Reemplazarlo por:

```python
    # En vivo (D1, R-B8): nunca desde la vista materializada sin refresco.
    assert "carrier_asset_roster" not in fetch_query
    assert "JOIN public.assets a" in fetch_query
```

`tests/test_directorio.py` no cambia: sus tres tests se mantienen con la definición nueva (`_tracto_de` crea el tracto con el default `operational_status = 'ACTIVE'`, verificado el 12/10).

- [ ] **Step 8: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_directory_integration.py tests/test_fleet_compliance_readers.py tests/test_carriers.py tests/test_directorio.py tests/test_live_driver_roster_integration.py tests/test_drivers.py tests/test_assets.py tests/test_directory_permissions.py -q`

Expected: PASS.

- [ ] **Step 9: Remove the Directorio xfail from the equivalence test**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_equivalence_integration.py -q`

Expected: `test_directorio_cuenta_lo_mismo_que_pendientes` FAIL con `XPASS(strict)`. Los otros dos siguen `xfail`. Si el del Directorio sigue `xfail`, la lista no cuenta lo mismo que Pendientes: es un defecto de esta tarea, no del test. Se investiga antes de seguir (R-B12).

Quitar el decorador `@pytest.mark.xfail(strict=True, …)` de `test_directorio_cuenta_lo_mismo_que_pendientes` y volver a correr. Expected: ese test PASS y los otros dos `xfail`.

- [ ] **Step 10: Verificar que la mutación mata el test**

1. En `_SQL_DIRECTORIO`, cambiar `FROM app.active_fleet f` del conteo de conductores por el `JOIN public.driver_assignments` de antes (sin el filtro del conductor). Correr `tests/test_d1_directory_integration.py::test_la_tira_del_directorio_cuenta_solo_la_flota_activa`. Expected: FAIL. Restaurar.
2. En `entity_summary_columns_sql`, quitar `{lifecycle_expr} = 'ACTIVE' AND`. Correr `tests/test_d1_directory_integration.py`. Expected: FAIL en `test_el_roster_trae_el_resumen_de_cada_conductor` (dado de baja con `can_operate True`) y en el roster de equipos. Restaurar.
3. En `ENABLEMENT_FILTERS["not_enabled"]`, quitar `operational_status = 'ACTIVE' AND`. Correr `test_el_filtro_de_habilitacion_corre_en_el_servidor`. Expected: FAIL (la dada de baja aparece como No habilitada). Restaurar.

- [ ] **Step 11: Medir la lista completa (spec §5.3)**

Dentro de una transacción revertida, con `apply_fleet_facts`, `EXPLAIN (ANALYZE)` de la consulta de filas de `list_carriers`, sin filtros y con `limit=100`. La de conteo y facetas recorre la misma CTE y se mide igual:

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio, asyncpg
from tests.conftest import credenciales_integracion
from tests.d1_subjects import apply_fleet_facts
from app.routers.carriers import _CARRIER_LIST_AGG, pendiente
from app.services.fleet_compliance import carrier_compliance_cte, carrier_summary_columns_sql

SQL = f"""EXPLAIN (ANALYZE, FORMAT TEXT)
WITH agg AS ({_CARRIER_LIST_AGG.format(where='', pendiente=pendiente)}), {carrier_compliance_cte()}
SELECT agg.carrier_id, {carrier_summary_columns_sql('cc')}
FROM agg LEFT JOIN carrier_compliance cc ON cc.carrier_id = agg.carrier_id
ORDER BY agg.business_name LIMIT $1 OFFSET $2"""

async def main():
    conn = await asyncpg.connect(**credenciales_integracion())
    tx = conn.transaction(); await tx.start()
    try:
        await apply_fleet_facts(conn)
        plan = [r[0] for r in await conn.fetch(SQL, 100, 0)]
        print("\n".join(plan[-2:]))
    finally:
        await tx.rollback(); await conn.close()
asyncio.run(main())
EOF
```

Expected: `Execution Time` bajo 300 ms en cada una de las dos consultas. Si alguna lo supera, no se sigue a la Task 6: se reporta con el plan, porque la decisión E-a (pasar a una proyección materializada sin cambiar a quien llama) es del usuario.

- [ ] **Step 12: Commit**

```bash
git add monitor-app/backend/api/app/services/fleet_compliance.py \
  monitor-app/backend/api/app/schemas/carrier.py \
  monitor-app/backend/api/app/routers/carriers.py \
  monitor-app/backend/api/app/routers/drivers.py \
  monitor-app/backend/api/app/routers/assets.py \
  monitor-app/backend/api/tests/d1_subjects.py \
  monitor-app/backend/api/tests/test_d1_directory_integration.py \
  monitor-app/backend/api/tests/test_fleet_compliance_readers.py \
  monitor-app/backend/api/tests/test_carriers.py \
  monitor-app/backend/api/tests/test_d1_equivalence_integration.py
git commit -m "feat(directorio): la lista, la ficha y el roster leen una sola respuesta

compliance_summary sale de fleet_compliance, con el alcance de Pendientes,
al lado de compliance_health y pending_mandatory. La flota cuenta solo lo
activo (84 -> 78 conductores). Filtro y facetas de habilitación en el
servidor. Cada documento trae su estado, los días que faltan y el aviso.
El roster de equipos se lee en vivo (D1, Task 5).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Vista rápida y embudo

**Files:**
- Modify: `monitor-app/backend/api/app/services/fleet_compliance.py` (agregar `carrier_pending_total_sql`, `funnel_bucket_for`)
- Modify: `monitor-app/backend/api/app/schemas/states.py` (agregar `FunnelBucket`)
- Modify: `monitor-app/backend/api/app/services/entity_summary.py`:
  - `:66-73` (`_carrier_ref`, sin cambios);
  - `driver_summary` `:84-128`, `asset_summary` `:131-160`, `carrier_summary` `:163-211`.
- Modify: `monitor-app/backend/api/app/routers/compliance.py`:
  - `:31-35` (`FUNNEL_ACTIVE_STATUSES`: comentario, R-B4);
  - `:197-280` (rama `carrier` de `/status`);
  - `:340-424` (`funnel_cols`, `attributed`, SELECT y armado de la respuesta);
  - `:572-587` (`carrier_operation_types` de `_PENDING_ROWS_SQL`);
  - `:1978-1994` (dueño del lote en `bulk-file`).
- Create: `monitor-app/backend/api/tests/test_d1_quick_view_and_funnel_integration.py`
- Modify: `monitor-app/backend/api/tests/test_fleet_compliance_readers.py` (casos de `funnel_bucket_for`)
- Modify: `monitor-app/backend/api/tests/test_d1_equivalence_integration.py` (quitar `xfail` de `test_vista_rapida_cuenta_lo_mismo_que_pendientes` y `test_embudo_cuenta_lo_mismo_que_pendientes`)
- Modify (solo si una corrida lo pide): `monitor-app/backend/api/tests/test_compliance.py`, mocks de `/status` agrupado por empresa que devuelvan filas

**Interfaces:**
- Consumes: lo de la Task 5 (`take_summary`, `carrier_summary_columns_sql`, `entity_summary_columns_sql`), `app.carrier_of` y `public.carrier_management_types` (Task 2).
- Produces:
  - `FunnelBucket = Literal["up_to_date", "expiring", "not_enabled"]` en `states.py`.
  - `carrier_pending_total_sql(alias: str = "cc") -> str`: la suma de las seis cifras, como entero.
  - `funnel_bucket_for(summary: ComplianceSummary | dict, lifecycle: str) -> FunnelBucket | None`. Reglas:
    - `None` si la empresa no está `ACTIVE` (R-B4);
    - `not_enabled` si no puede operar;
    - `expiring` si puede operar pero tiene algo vencido o por vencer, propio o de la flota ("Con vencimientos" incluye por vencer, conflicto 8);
    - si no, `up_to_date`.
  - Vista rápida:
    - `GET /carriers/{id}/summary`, `/drivers/{id}/summary` y `/assets/{id}/summary` suman `compliance_summary` (`fleet` solo en la empresa);
    - `active_drivers` y `active_assets` cuentan `app.active_fleet` (D1-R3);
    - `carrier` sale de `app.carrier_of`;
    - `documents` sigue igual.
  - `GET /compliance-records/status?group=carrier` (R-B10), cada fila:
    - suma `compliance_summary` (con `fleet`) y `funnel_bucket: FunnelBucket | None`;
    - `pending_count` pasa a ser la suma del resumen (D1-R3, 2.306 → 2.226), y `total_pending` lo suma;
    - `funnel_group`, `pending_mandatory`, `total_count`, `satisfied_count` y `expired_count` siguen con su definición de hoy (los retira la Task 16).
  - `GET /compliance-records/pending` y `/summary`: `carrier_operation_types` sale de `public.carrier_management_types` con las etiquetas de `app.status_taxonomies`. Medido: cambia solo la empresa ONBOARDING, de `[]` a `['Equipo Completo']`.
  - `urgencia` sigue presente (la retira la Task 16).

- [ ] **Step 1: Write the failing tests**

Patrón copiado de `tests/test_entity_summary_integration.py` (llamar `get_*_summary` con `PoolDeUnaConexion`) y de `tests/test_exigibilidad_integracion.py:236` (llamar `get_certification_status` directo). Crear `tests/test_d1_quick_view_and_funnel_integration.py`:

```python
"""D1 "Una sola respuesta", Task 6: la vista rápida y el embudo leen la misma
respuesta que Pendientes (spec §6.1). La vista rápida contaba la flota dada de
baja (F-03) y el embudo sumaba 80 documentos de conductores y equipos de baja
(2.306 frente a 2.226, F-02). Contra Postgres de verdad, en una transacción
revertida."""
from __future__ import annotations

from datetime import timedelta
from uuid import UUID

import pytest

from app.routers.carriers import get_carrier_summary
from app.routers.compliance import _PENDING_ROWS_SQL, SUMMARY_LIMIT, get_certification_status
from app.routers.drivers import get_driver_summary
from tests import d1_subjects as s
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def _flota_con_un_pendiente(conn) -> dict:
    """Empresa activa con un conductor y un equipo activos y otro de cada uno
    dado de baja. Cada conductor debe un documento obligatorio; solo cuenta el
    del activo."""
    c = await s.carrier(conn)
    f = {
        "carrier": c,
        "driver": await s.driver(conn, c),
        "inactive_driver": await s.driver(conn, c, status="INACTIVE"),
        "asset": await s.asset(conn, c),
        "inactive_asset": await s.asset(conn, c, status="INACTIVE"),
    }
    await s.without_seeding(conn, *f.values())
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", f["driver"])
    await s.record(conn, req, "DRIVER", f["inactive_driver"])
    return f


async def _embudo(conn, carrier_id: str) -> dict:
    res = await get_certification_status(group="carrier", scope="active", carrier_id=carrier_id, q="",
                                         limit=200, pool=PoolDeUnaConexion(conn), _=None)
    [fila] = res["rows"]
    return fila


async def test_la_vista_rapida_cuenta_solo_la_flota_activa(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_con_un_pendiente(conn)

    resumen = await get_carrier_summary(UUID(f["carrier"]), pool=PoolDeUnaConexion(conn), _=None)

    assert (resumen["active_drivers"], resumen["active_assets"]) == (1, 1)
    assert resumen["compliance_summary"]["fleet"] == {"overdue": 0, "expiring": 0, "missing": 1}
    assert resumen["compliance_summary"]["can_operate"] is False
    assert "documents" in resumen   # lo viejo sigue al lado


async def test_la_vista_rapida_del_conductor_trae_su_resumen_y_su_empresa(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_con_un_pendiente(conn)

    resumen = await get_driver_summary(UUID(f["driver"]), pool=PoolDeUnaConexion(conn), _=None)

    assert resumen["carrier"]["id"] == f["carrier"]
    assert resumen["compliance_summary"] == {
        "worst_state": "MISSING", "own": {"overdue": 0, "expiring": 0, "missing": 1},
        "fleet": None, "can_operate": False,
    }


async def test_el_embudo_no_cuenta_la_flota_de_baja(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_con_un_pendiente(conn)

    fila = await _embudo(conn, f["carrier"])

    assert fila["pending_count"] == 1, "contó el documento del conductor dado de baja"
    assert fila["compliance_summary"]["fleet"]["missing"] == 1
    assert fila["funnel_bucket"] == "not_enabled"
    assert "funnel_group" in fila   # D1-R2: sigue al lado hasta la Task 16


async def test_los_baldes_del_embudo_salen_del_resumen(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    con_por_vencer = await s.carrier(conn)
    al_dia = await s.carrier(conn)
    recien_creada = await s.carrier(conn, status="ONBOARDING")
    await s.without_seeding(conn, con_por_vencer, al_dia, recien_creada)
    req = await s.requirement(conn, entity="CARRIER")
    await s.record(conn, req, "CARRIER", con_por_vencer, status="APPROVED_MANUAL",
                   expires=hoy + timedelta(days=10))

    assert (await _embudo(conn, con_por_vencer))["funnel_bucket"] == "expiring"
    assert (await _embudo(conn, al_dia))["funnel_bucket"] == "up_to_date"
    # R-B4: una empresa no activa no está "No habilitada" en las colas.
    assert (await _embudo(conn, recien_creada))["funnel_bucket"] is None


async def test_el_tipo_de_operacion_de_pendientes_sale_de_la_funcion(conexion_revertida):
    """spec §4.3: lo observado en los tractos manda y lo declarado cubre el
    hueco. La CTE propia de Pendientes solo miraba los vehículos."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    c = await s.carrier(conn, management_types=["EQUIPO_COMPLETO"])
    await s.without_seeding(conn, c)
    req = await s.requirement(conn, entity="CARRIER")
    await s.record(conn, req, "CARRIER", c)

    filas = await conn.fetch(
        _PENDING_ROWS_SQL,
        c, None, None, None, None, SUMMARY_LIMIT, 0, None, None, "todos", None, False)

    assert {tuple(f["carrier_operation_types"]) for f in filas} == {("Equipo Completo",)}
```

En `tests/test_fleet_compliance_readers.py`, agregar:

```python
from app.services.fleet_compliance import funnel_bucket_for


def _resumen(*, can_operate=True, own=(0, 0, 0), fleet=(0, 0, 0)):
    a = dict(zip(("overdue", "expiring", "missing"), own))
    b = dict(zip(("overdue", "expiring", "missing"), fleet))
    return {"worst_state": "UP_TO_DATE", "own": a, "fleet": b, "can_operate": can_operate}


def test_el_balde_de_una_empresa_no_activa_es_ninguno():
    assert funnel_bucket_for(_resumen(can_operate=False), "ONBOARDING") is None
    assert funnel_bucket_for(_resumen(can_operate=False), "LEGACY_INACTIVE") is None


def test_no_habilitada_gana_a_todo():
    assert funnel_bucket_for(_resumen(can_operate=False, fleet=(0, 2, 0)), "ACTIVE") == "not_enabled"


def test_con_vencimientos_incluye_por_vencer_y_vencidos_opcionales():
    assert funnel_bucket_for(_resumen(fleet=(0, 1, 0)), "ACTIVE") == "expiring"
    assert funnel_bucket_for(_resumen(own=(1, 0, 0)), "ACTIVE") == "expiring"


def test_un_opcional_que_falta_no_saca_del_al_dia():
    assert funnel_bucket_for(_resumen(own=(0, 0, 3)), "ACTIVE") == "up_to_date"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_quick_view_and_funnel_integration.py tests/test_fleet_compliance_readers.py -q`

Expected: FAIL.
- `test_la_vista_rapida_cuenta_solo_la_flota_activa`: `(2, 2) == (1, 1)`.
- Los del conductor y de los baldes: `KeyError: 'compliance_summary'` o `KeyError: 'funnel_bucket'`.
- `test_el_embudo_no_cuenta_la_flota_de_baja`: `assert 2 == 1` ("contó el documento del conductor dado de baja").
- El del tipo de operación: `{()} == {('Equipo Completo',)}`.
- La unidad: `ImportError: cannot import name 'funnel_bucket_for'`.

- [ ] **Step 3: Add `FunnelBucket` and the funnel helpers**

En `app/schemas/states.py`:

```python
# Los baldes del embudo de Certificación (D1-R2). Salen de la escala del
# resumen, no del ciclo de vida: una empresa no activa no tiene balde (R-B4).
FunnelBucket = Literal["up_to_date", "expiring", "not_enabled"]
```

En `app/services/fleet_compliance.py`, después de `take_summary`:

```python
def carrier_pending_total_sql(alias: str = "cc") -> str:
    """Cuánto debe una empresa, propio y de su flota: lo mismo que su fila en
    /pending/summary?group_by=carrier si está activa (spec §5)."""
    return "(" + " + ".join(
        f"COALESCE({alias}.{col}, 0)"
        for col in CARRIER_SUMMARY_COLUMNS if col.startswith(("own_", "fleet_"))
    ) + ")::int"


def funnel_bucket_for(summary: ComplianceSummary | dict, lifecycle: str) -> FunnelBucket | None:
    """El balde del embudo, de la escala del resumen (spec §6.1, conflicto 8):
    no habilitada, con vencimientos (incluye por vencer) o al día. Una empresa
    no activa no está "No habilitada" en las colas: no tiene balde (R-B4). Un
    opcional que falta no saca del "al día": no bloquea, y sus cifras ya están
    en el resumen."""
    s = summary if isinstance(summary, ComplianceSummary) else ComplianceSummary.model_validate(summary)
    if lifecycle != "ACTIVE":
        return None
    if not s.can_operate:
        return "not_enabled"
    fleet = s.fleet or StateCounts()
    if s.own.overdue + s.own.expiring + fleet.overdue + fleet.expiring > 0:
        return "expiring"
    return "up_to_date"
```

Importar `FunnelBucket`, `StateCounts` y `ComplianceSummary` de `..schemas.states`, si el módulo aún no los importa.

- [ ] **Step 4: Implement the quick view**

En `entity_summary.py`, importar:

```python
from .fleet_compliance import (
    carrier_compliance_cte, carrier_summary_columns_sql, entity_compliance_cte,
    entity_summary_columns_sql, take_summary,
)
```

1. `driver_summary`:
   - Anteponer `WITH {entity_compliance_cte()}` a la consulta (pasa a f-string).
   - Agregar `{entity_summary_columns_sql('d.operational_status', 'ec')}` al SELECT.
   - Reemplazar las dos líneas de la empresa:

```sql
        -- "¿De qué empresa es?" tiene una sola respuesta (D1, spec §4.2).
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('DRIVER', d.id)
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'DRIVER' AND ec.entity_id = d.id
```

   (se borra `LEFT JOIN public.driver_assignments da …`). Después del `if row is None`:

```python
    fila = dict(row)
    compliance_summary = take_summary(fila, with_fleet=False)
```

   y en el `return` agregar `"compliance_summary": compliance_summary,` (el resto sigue leyendo de `row`).

2. `asset_summary`: igual. Usa `entity_summary_columns_sql('a.operational_status', 'ec')`, `LEFT JOIN public.carriers c ON c.id = app.carrier_of('ASSET', a.id)` y `LEFT JOIN entity_compliance ec ON ec.entity_type = 'ASSET' AND ec.entity_id = a.id`. Se borra `LEFT JOIN public.asset_assignments aa …`.

3. `carrier_summary`:

```python
    row = await conn.fetchrow(
        f"""
        WITH {carrier_compliance_cte()}
        SELECT c.id, c.business_name, c.tax_id, c.operational_status,
               -- La flota activa: una sola definición (app.active_fleet, D1).
               -- Contar por asignación sola incluía a los dados de baja (F-03).
               (SELECT count(*) FROM app.active_fleet f
                WHERE f.carrier_id = c.id AND f.entity_type = 'DRIVER') AS active_drivers,
               (SELECT count(*) FROM app.active_fleet f
                WHERE f.carrier_id = c.id AND f.entity_type = 'ASSET') AS active_assets,
               pc.name AS contact_name, pc.phone AS contact_phone,
               {carrier_summary_columns_sql('cc')}
        FROM public.carriers c
        LEFT JOIN carrier_compliance cc ON cc.carrier_id = c.id
        LEFT JOIN LATERAL ( … sin cambios … ) pc ON true
        WHERE c.id = $1
        """,
        carrier_id,
    )
    if row is None:
        return None
    compliance_summary = take_summary(dict(row), with_fleet=True)
```

   y en el `return` agregar `"compliance_summary": compliance_summary,`.

- [ ] **Step 5: Implement the funnel**

En `compliance.py`:

1. Importar `from ..services.fleet_compliance import carrier_compliance_cte, carrier_pending_total_sql, carrier_summary_columns_sql, funnel_bucket_for, take_summary`.

2. Comentario de `FUNNEL_ACTIVE_STATUSES` (`:31-34`). Agregar al final:

```python
# D1 (R-B4, decisión del usuario 12/10): ONBOARDING se queda en esta mitad
# visible, a propósito y para siempre. Sale del CONTEO: carrier_compliance la
# trata como no activa y su funnel_bucket es NULL. Sacarla de aquí mandaría las
# empresas recién creadas al fondo del catálogo.
```

3. Rama `group == "carrier"`:
   - Al final de `extra_cte`, después de `viajes AS (…)`, agregar `,\n        {carrier_compliance_cte()}`. El string pasa a ser f-string; las llaves literales que haya se duplican.
   - En `entity_join`, agregar `LEFT JOIN carrier_compliance cc ON cc.carrier_id = e.id`.
   - En `group_by`, agregar `", " + ", ".join(f"cc.{c}" for c in CARRIER_SUMMARY_COLUMNS)` (importar `CARRIER_SUMMARY_COLUMNS`).
   - En las otras tres ramas, definir `pending_count_sql = f"count(*) FILTER (WHERE {pendiente})"`. En esta, `pending_count_sql = carrier_pending_total_sql('cc')`. Como `pendiente` se define después de las ramas, `pending_count_sql` se arma justo después de `pendiente = pendiente_predicate(fuente)`:

```python
    # D1-R3: agrupando por empresa, "cuánto debe" es la suma del resumen (mismo
    # alcance que Pendientes): sin la flota de baja que `attributed` arrastra.
    pending_count_sql = (carrier_pending_total_sql("cc") if group == "carrier"
                         else f"count(*) FILTER (WHERE {pendiente})")
```

4. `funnel_cols`, al final, después de `AS funnel_group,`:

```python
               {carrier_summary_columns_sql('cc')},"""
```

5. En el SELECT principal, `count(*) FILTER (WHERE {pendiente}) AS pending_count,` pasa a `{pending_count_sql} AS pending_count,`. El `ORDER BY … pending_count DESC` no cambia: ordena por el alias.

6. `attributed` usa `app.carrier_of` (spec §4.2). El universo de `funnel_group` y sus conteos no cambia: el índice único parcial da la misma empresa.

```sql
        attributed AS (
            SELECT r.status, r.requirement_level, r.expiration_date, r.requirement_id,
                   r.entity_type, r.entity_id, r.issue_date, r.period_start,
                   -- "¿De qué empresa es?": app.carrier_of (D1, spec §4.2). El
                   -- finiquito de quien ya se fue sigue en la última empresa.
                   CASE WHEN r.entity_type = 'DRIVER'
                        THEN COALESCE(app.carrier_of('DRIVER', r.entity_id), {_empresa_que_dejo_sql('r')})
                        ELSE app.carrier_of(r.entity_type, r.entity_id)
                   END AS carrier_id
            FROM records r
        )
```

7. Armado de la respuesta, en reemplazo de `result = [dict(r) for r in rows]`:

```python
    result = []
    for r in rows:
        fila = dict(r)
        if group == "carrier":
            summary = take_summary(fila, with_fleet=True)
            fila["compliance_summary"] = summary
            fila["funnel_bucket"] = funnel_bucket_for(summary, fila["operational_status"])
        result.append(fila)
```

8. `_PENDING_ROWS_SQL`: reemplazar el CTE `carrier_operation_types` y su comentario:

```sql
-- Tipo de Operación de la EMPRESA: una sola definición,
-- public.carrier_management_types() (spec §4.3). Lo observado en sus tractos
-- activos manda y lo declarado cubre el hueco. Devuelve códigos; la etiqueta
-- sale del catálogo, ordenada como el array_agg(DISTINCT label) de antes.
carrier_operation_types AS (
    SELECT c.id AS carrier_id,
           ARRAY(SELECT wot.label
                 FROM unnest(public.carrier_management_types(c.id)) AS mt(code)
                 JOIN app.status_taxonomies wot
                   ON wot.domain = 'WEBCARGA_OPERATION_TYPE' AND wot.code = mt.code
                 ORDER BY wot.label) AS operation_types
    FROM public.carriers c
)
```

9. `bulk-file` (`:1980-1994`): el dueño de cada registro es "su empresa de hoy":

```python
    owner_rows = await pool.fetch(
        """
        SELECT cr.id::text AS record_id,
               -- "¿De qué empresa es?" (D1, spec §4.2): la misma respuesta que el resto.
               app.carrier_of(cr.entity_type, cr.entity_id) AS resolved_carrier_id
        FROM public.compliance_records cr
        WHERE cr.id = ANY($1::uuid[])
        """,
        record_ids,
    )
```

- [ ] **Step 6: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_quick_view_and_funnel_integration.py tests/test_fleet_compliance_readers.py tests/test_entity_summary_integration.py tests/test_entity_summary_routes.py tests/test_carrier_status_in_fleet_reads_integration.py tests/test_compliance.py tests/test_exigibilidad_integracion.py tests/test_pending_documents_integration.py tests/test_integracion_certificacion.py -q`

Expected: PASS.

Puntos a revisar si algo falla:
- `test_status_catalog_scope_is_the_complement_of_the_active_one` aísla el WHERE partiendo el SQL en la primera aparición de `"FROM public.carriers e"`. Si el texto de `carrier_compliance_cte()` contiene esa cadena, el test mira el CTE en vez del WHERE. Se corrige el test para partir en la **última** aparición (`rsplit`), sin aflojar la aserción.
- Un mock de `/status` agrupado por empresa que devuelva filas necesita las columnas de `RESUMEN_VACIO` (mismo diccionario que la Task 5).

- [ ] **Step 7: Remove the quick view and funnel xfails**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_equivalence_integration.py -q`

Expected: `test_vista_rapida_cuenta_lo_mismo_que_pendientes` y `test_embudo_cuenta_lo_mismo_que_pendientes` FAIL con `XPASS(strict)`. Quitar sus dos decoradores `xfail` y volver a correr. Expected: los tres PASS.

- [ ] **Step 8: Verificar que la mutación mata el test**

1. Volver `pending_count_sql` a `count(*) FILTER (WHERE {pendiente})` también para `carrier`. Correr `tests/test_d1_quick_view_and_funnel_integration.py::test_el_embudo_no_cuenta_la_flota_de_baja` y `tests/test_d1_equivalence_integration.py::test_embudo_cuenta_lo_mismo_que_pendientes`. Expected: FAIL en los dos. Restaurar.
2. En `funnel_bucket_for`, borrar `if lifecycle != "ACTIVE": return None`. Correr `tests/test_fleet_compliance_readers.py` y `test_los_baldes_del_embudo_salen_del_resumen`. Expected: FAIL. Restaurar.
3. En `carrier_summary`, volver `active_drivers` a `public.driver_assignments … status = 'ACTIVE'`. Correr `test_la_vista_rapida_cuenta_solo_la_flota_activa`. Expected: FAIL. Restaurar.

- [ ] **Step 9: Medir el embudo y Pendientes**

Con el mismo esqueleto del Step 11 de la Task 5 (transacción revertida y migración ensayada), `EXPLAIN (ANALYZE)` del SQL que arma `get_certification_status(group="carrier", scope="active")`. Para obtener el texto exacto, llamar al endpoint con un pool falso que capture la consulta, como hacen los tests de `test_compliance.py`. Medir también `_PENDING_ROWS_SQL` con los parámetros de la cola global.

Comparar con el código anterior (`git stash` del router), en la misma sesión.

Expected:
- el embudo, bajo +150 ms respecto de antes (paga una evaluación de la base de Pendientes, ~150 ms medidos);
- `_PENDING_ROWS_SQL`, bajo +50 ms.

Si `attributed` con `app.carrier_of` suma más de 50 ms por sí solo (la función tiene `SET search_path` y no se inlinea), volver `attributed` a los dos LEFT JOIN, con un comentario que lo explique, y registrarlo en el ledger. Su resultado es idéntico por el índice único parcial.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/backend/api/app/services/fleet_compliance.py \
  monitor-app/backend/api/app/schemas/states.py \
  monitor-app/backend/api/app/services/entity_summary.py \
  monitor-app/backend/api/app/routers/compliance.py \
  monitor-app/backend/api/tests/test_d1_quick_view_and_funnel_integration.py \
  monitor-app/backend/api/tests/test_fleet_compliance_readers.py \
  monitor-app/backend/api/tests/test_d1_equivalence_integration.py
git commit -m "feat(certificacion): vista rápida y embudo leen la misma respuesta que Pendientes

compliance_summary en la vista rápida y en cada empresa del embudo, con
funnel_bucket al lado de funnel_group. pending_count ya no suma la flota de baja
(2.306 -> 2.226) y la flota de la vista rápida cuenta solo lo activo. La empresa
de una entidad sale de app.carrier_of y el tipo de operación de Pendientes, de
carrier_management_types (D1, Task 6).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Monitor

**Files:**
- Modify: `monitor-app/backend/api/app/routers/trips.py`:
  - `:580-586` (`_TRIP_SELECT`, columnas `driver_has_critical_alert`, `tractor_has_critical_alert` y `carrier_has_critical_alert`);
  - `:620-668` (`_compliance_alert_lateral`);
  - `:935-962` (`list_trips`) y `:2425-2445` (`get_trip`), para `_attach_carrier_can_operate`;
  - `:1225-1305` (`/available-drivers`, `standing_vehicle`);
  - `:2238-2290` (`/driver-candidates`).
- Modify: `monitor-app/backend/api/app/routers/drivers.py:28-71` (`/drivers`) y `:96-136` (`/fuzzy-match`)
- Modify: `monitor-app/backend/api/app/routers/assets.py:167-219` (`assign_driver_to_asset`)
- Modify: `monitor-app/backend/api/app/services/entity_summary.py` (agregar `usual_tractor_lateral` y usarlo en `driver_summary`)
- Create: `monitor-app/backend/api/tests/test_d1_monitor_integration.py`
- Modify: `monitor-app/backend/api/tests/test_compliance_pending_docs.py:38-42` (conteo del CASE)

**Interfaces:**
- Consumes:
  - `carrier_compliance_cte()` y `alert_severity_sql(alias)` (Task 4);
  - `document_state_sql` y `PENDING_STATES` (`vencimientos.py`);
  - `app.carrier_of` (Task 2).
- Produces:
  - `GET /trips` y `GET /trips/{id}`:
    - cada viaje suma, **por entidad** (R-B5):
      - `driver_has_critical_alert`, `tractor_has_critical_alert` y `carrier_has_critical_alert`: `bool | None`, `None` cuando esa entidad no está resuelta, igual que `*_pending_docs`;
      - `carrier_can_operate: bool | None`: la habilitación de la empresa resuelta; `None` sin empresa.
    - **No** se exponen `has_critical_alert` ni `can_operate` del viaje;
    - `driver_pending_docs*`, `tractor_pending_docs*` y `carrier_pending_docs*` siguen iguales.
  - `GET /drivers`, `/drivers/fuzzy-match` y `/trips/available-drivers` dan una fila por conductor. El tracto que traen es el habitual: el de la asignación `ACTIVE` más reciente, la misma regla que la vista rápida.
  - `GET /trips/driver-candidates`: cada candidato suma `carrier_operational_status` (R-B6).
  - `POST /assets/{id}/driver-assignment`: 409 con `detail = {"code": "DRIVER_INACTIVE", "message": …}` si el conductor está dado de baja.
  - `entity_summary.usual_tractor_lateral(driver_expr: str, alias: str = "a") -> str`: un `LEFT JOIN LATERAL` con las columnas `id` y `license_plate`.

- [ ] **Step 1: Write the failing tests**

Patrones copiados:
- `tests/test_trip_assignment_integration.py`: `insert_tms_trip`, `open_status` y el viaje del TMS insertado a mano;
- `tests/test_anular_viajes_integracion.py`: `get_trip` directo con `PoolDeUnaConexion`;
- `tests/test_cliente_del_viaje_integracion.py:204`: `list_trips` con `view="historial"` y fechas;
- `tests/test_asignar_conductor.py:208`: `driver_candidates` directo.

Crear `tests/test_d1_monitor_integration.py`:

```python
"""D1 "Una sola respuesta", Task 7: el Monitor.

Cada viaje dice si su empresa puede operar y si hay un aviso crítico. Un
conductor con dos tractos ya no sale dos veces al asignar (F-07, Review Focus
2), y el conductor habitual no admite a quien está dado de baja (spec §7.1).
Contra Postgres de verdad, en una transacción revertida."""
from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.routers.assets import assign_driver_to_asset
from app.routers.drivers import fuzzy_match_drivers, list_drivers
from app.routers.trips import available_drivers, driver_candidates, get_trip, list_trips
from tests import d1_subjects as s
from tests.conftest import USER, PoolDeUnaConexion, cliente_de_prueba

pytestmark = pytest.mark.integracion

# Un día que Operaciones nunca firma ni planifica.
DIA = date(2099, 1, 15)


async def _viaje(conn, *, carrier: str | None = None, driver: str | None = None) -> str:
    trip_id = str(uuid.uuid4())
    estado = await conn.fetchval(
        "SELECT id FROM app.trip_statuses WHERE active AND group_id = 'en_ruta' ORDER BY id LIMIT 1")
    await conn.execute(
        """
        INSERT INTO app.trips (id, source_system, source_system_trip_id, client_name, planning_date,
                               trip_status, fleet, is_active, is_working, is_assigned, is_first_leg,
                               manually_edited_fields)
        VALUES ($1::uuid, 'qanalytics', $2, $3, $4, $5, $6::jsonb, true, false, false, false, '{}')
        """,
        trip_id, f"{s.PREFIX}-{trip_id[:8]}", await cliente_de_prueba(conn), DIA, estado, json.dumps({}))
    if carrier or driver:
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, carrier_id, driver_id, link_source) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, 'manual')", trip_id, carrier, driver)
    return trip_id


async def test_el_monitor_dice_si_la_empresa_puede_operar_y_si_hay_aviso_critico(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    d = await s.driver(conn, c)
    await s.without_seeding(conn, c, d)
    req = await s.requirement(conn, entity="DRIVER")
    # Vence hoy: crítico (0 días ≤ error_days 0), todavía no vencido, y por
    # vencer no quita la habilitación (E-c).
    await s.record(conn, req, "DRIVER", d, status="APPROVED_MANUAL", expires=hoy)
    tid = await _viaje(conn, carrier=c, driver=d)

    viaje = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=USER)

    assert viaje["carrier_can_operate"] is True
    assert viaje["driver_has_critical_alert"] is True
    # La empresa está resuelta y no tiene nada crítico: false. El tracto no
    # está resuelto: None, igual que tractor_pending_docs.
    assert viaje["carrier_has_critical_alert"] is False
    assert viaje["tractor_has_critical_alert"] is None
    assert "has_critical_alert" not in viaje and "can_operate" not in viaje
    assert viaje["driver_pending_docs"] == 1   # lo de hoy sigue al lado (Task 16)


async def test_una_empresa_con_un_obligatorio_faltante_no_puede_operar(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    d = await s.driver(conn, c)
    await s.without_seeding(conn, c, d)
    await s.record(conn, await s.requirement(conn, entity="CARRIER"), "CARRIER", c)
    # Por vencer en 20 días: aviso, no crítico.
    await s.record(conn, await s.requirement(conn, entity="DRIVER"), "DRIVER", d,
                   status="APPROVED_MANUAL", expires=hoy + timedelta(days=20))
    con_empresa = await _viaje(conn, carrier=c, driver=d)
    sin_nada = await _viaje(conn)

    res = await list_trips(q=s.PREFIX, view="historial", fecha_desde=DIA.isoformat(),
                           fecha_hasta=DIA.isoformat(), pool=PoolDeUnaConexion(conn), user=USER)
    por_id = {str(v["id"]): v for v in res["data"]}

    campos = ("carrier_can_operate", "driver_has_critical_alert", "carrier_has_critical_alert")
    # Un obligatorio que falta no es un aviso crítico: quita la habilitación.
    assert tuple(por_id[con_empresa][k] for k in campos) == (False, False, False)
    # Sin nada resuelto no hay a quién preguntar: None, no "habilitada" ni "sin aviso".
    assert tuple(por_id[sin_nada][k] for k in campos) == (None, None, None)


async def test_drivers_no_duplica_conductor_con_dos_tractos(conexion_revertida):
    """Review Focus 2. vehicle_driver_assignments permite un conductor por
    tracto, no un tracto por conductor: el LEFT JOIN plano lo devolvía dos
    veces al asignar un viaje."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    nombre = f"{s.PREFIX} Dostractos {s.suffix()}"
    d = await s.driver(conn, c, name=nombre)
    viejo, nuevo = await s.asset(conn, c), await s.asset(conn, c)
    await s.usual_driver(conn, viejo, d, hoy - timedelta(days=90))
    await s.usual_driver(conn, nuevo, d, hoy - timedelta(days=3))
    pool = PoolDeUnaConexion(conn)

    busqueda = await list_drivers(q=nombre, limit=10, pool=pool, _=None)
    assert [(str(f["driver_id"]), str(f["tractor_asset_id"])) for f in busqueda] == [(d, nuevo)]

    parecidos = await fuzzy_match_drivers(name=nombre, limit=20, pool=pool, _=None)
    assert [str(f["tractor_asset_id"]) for f in parecidos if str(f["driver_id"]) == d] == [nuevo]

    disponibles = await available_drivers(fecha=DIA.isoformat(), pool=pool, _=None)
    assert [str(f["tractor_asset_id"]) for f in disponibles if str(f["driver_id"]) == d] == [nuevo]


async def test_los_candidatos_traen_el_estado_de_su_empresa_y_nunca_a_un_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    marca = s.suffix()
    de_baja = await s.driver(conn, None, status="INACTIVE", name=f"Zzdeuno{marca} Zzpersona{marca}")
    empresa_de_baja = await s.carrier(conn, status="INACTIVE")
    activo = await s.driver(conn, empresa_de_baja, name=f"Zzdeuno{marca} Zzpersona{marca} Segundo")

    resp = await driver_candidates(nombre=f"Zzdeuno{marca} Zzpersona{marca}", limit=25,
                                   pool=PoolDeUnaConexion(conn), _=None)
    por_id = {f["driver_id"]: f for f in resp["candidatos"]}

    # Guarda (ya es cierto hoy): un conductor dado de baja nunca se ofrece.
    assert de_baja not in por_id
    # R-B6: el de una empresa dada de baja se ofrece, marcado; la guarda de la
    # Task 8 rechaza la asignación con un mensaje claro.
    assert por_id[activo]["carrier_operational_status"] == "INACTIVE"


async def test_el_conductor_habitual_no_admite_a_un_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    c = await s.carrier(conn)
    tracto = await s.asset(conn, c)
    de_baja = await s.driver(conn, c, status="INACTIVE")

    with pytest.raises(HTTPException) as e:
        await assign_driver_to_asset(tracto, {"driver_id": de_baja}, pool=PoolDeUnaConexion(conn), user=USER)

    assert e.value.status_code == 409
    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE asset_id = $1", tracto) == 0
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_monitor_integration.py -q`

Expected: FAIL.
- Los dos del Monitor: `KeyError: 'carrier_can_operate'` o `KeyError: 'driver_has_critical_alert'`.
- `test_drivers_no_duplica…`: la lista trae dos tuplas, una por tracto.
- `test_los_candidatos…`: `KeyError: 'carrier_operational_status'` (la guarda de `de_baja` ya pasa).
- `test_el_conductor_habitual…`: `DID NOT RAISE` (hoy se asigna).

Si `list_trips` rechaza los argumentos (`TypeError`), copiar la llamada exacta de `test_cliente_del_viaje_integracion.py:204` y reportarlo.

- [ ] **Step 3: One usual tractor, one definition**

En `entity_summary.py`, junto a `_PRIMARY_PHONE`:

```python
def usual_tractor_lateral(driver_expr: str, alias: str = "a") -> str:
    """El tracto habitual de un conductor: el de su asignación ACTIVE más
    reciente. Un conductor puede tener varios tractos activos (el índice único
    de vehicle_driver_assignments es por tracto, no por conductor): un LEFT
    JOIN plano lo devuelve una vez por tracto (F-07). Una sola regla para la
    vista rápida, la búsqueda del Monitor y los disponibles del día. Columnas:
    `id`, `license_plate`."""
    return f"""
        LEFT JOIN LATERAL (
            SELECT vg_ut.id, vg_ut.license_plate
            FROM public.vehicle_driver_assignments vg_vda
            JOIN public.assets vg_ut ON vg_ut.id = vg_vda.asset_id
            WHERE vg_vda.driver_id = {driver_expr} AND vg_vda.status = 'ACTIVE'
            ORDER BY vg_vda.start_date DESC NULLS LAST, vg_vda.created_at DESC, vg_ut.id
            LIMIT 1
        ) {alias} ON true"""
```

En `driver_summary`, reemplazar el `LEFT JOIN LATERAL (…) a ON true` por `{usual_tractor_lateral('d.id', 'a')}`. El comentario pasa a la función.

- [ ] **Step 4: Implement `/drivers`, `/fuzzy-match` and `/available-drivers`**

En `drivers.py`, importar `from ..services.entity_summary import driver_summary, usual_tractor_lateral`.

1. En el `FROM` de `list_drivers`:

```sql
        FROM public.drivers d
        -- "¿De qué empresa es?" (D1, spec §4.2) y UN tracto: el habitual (F-07).
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('DRIVER', d.id)
        {usual_tractor_lateral('d.id', 'a')}
        WHERE d.operational_status = 'ACTIVE'
```

   La consulta pasa a f-string; los `'%'||$1||'%'` no llevan llaves y no cambian.

2. En `fuzzy_match_drivers`:

```sql
        FROM public.drivers d
        LEFT JOIN public.carriers c
               ON c.id = app.carrier_of('DRIVER', d.id) AND c.operational_status = 'ACTIVE'
        {usual_tractor_lateral('d.id', 'a')}
        WHERE d.operational_status = 'ACTIVE'
```

3. En `trips.py:available_drivers`:
   - borrar el CTE `standing_vehicle` y su `LEFT JOIN standing_vehicle sv ON sv.driver_id = ar.id`;
   - agregar `{usual_tractor_lateral('ar.id', 'sv')}` en su lugar (la consulta pasa a f-string);
   - en el SELECT, `sv.id AS tractor_asset_id` y `COALESCE(tt.tractor_plate, sv.license_plate) AS tractor_plate`.
   - El comentario del vehículo habitual se conserva junto al lateral.

`tests/test_drivers.py::test_list_drivers_searches_active_roster_with_resolved_carrier_and_vehicle` sigue pasando: el lateral contiene `public.vehicle_driver_assignments`.

- [ ] **Step 5: Implement the Monitor fields**

1. `_compliance_alert_lateral`: agregar una tercera columna después de `has_critical_pending` e importar `alert_severity_sql` de `..services.fleet_compliance`:

```python
            -- D1 (R-B5): aviso crítico = un obligatorio dentro de los días
            -- críticos de Configuración › Alertas (severidad calculada en
            -- fleet_compliance), o uno de los documentos críticos pendiente:
            -- el significado de has_critical_pending, que se conserva.
            CASE WHEN {id_expr} IS NULL THEN NULL ELSE COALESCE(bool_or(
                req.requirement_level = 'LEGAL_MANDATORY' AND (
                    {alert_severity_sql('cr')} = 'critical'
                    OR (req.requirement_code = ANY({codes_sql}) AND ({pendiente}))
                )
            ), false) END AS has_critical_alert
```

   (la coma va después de `AS has_critical_pending`).

2. `_TRIP_SELECT`: después de `ccomp.has_critical_pending AS carrier_pending_docs_critical,`:

```sql
    -- D1 (R-B5): el aviso crítico por entidad, NULL si no está resuelta
    -- (igual que *_pending_docs). No hay un campo del viaje: cada badge dice
    -- de quién es el problema.
    dcomp.has_critical_alert AS driver_has_critical_alert,
    tcomp.has_critical_alert AS tractor_has_critical_alert,
    ccomp.has_critical_alert AS carrier_has_critical_alert,
```

3. Habilitación por página, junto a `_load_trip_stops`. Importar `carrier_compliance_cte` de `..services.fleet_compliance`.

```python
_CAN_OPERATE_SQL = f"""
WITH {carrier_compliance_cte()}
SELECT carrier_id::text AS carrier_id, can_operate AS carrier_can_operate
FROM carrier_compliance
WHERE carrier_id = ANY($1::uuid[])
"""


async def _attach_carrier_can_operate(pool, trips: list[dict]) -> None:
    """¿Puede operar la empresa del viaje? (D1, R-B5). Una consulta por página
    y no un JOIN en _TRIP_FROM: ese FROM también arma los COUNT(*) y la faceta
    de clientes, que no necesitan la base de Pendientes (~150 ms). Sin empresa
    resuelta no hay a quién preguntar: None, no "habilitada"."""
    ids = sorted({str(t["carrier_id"]) for t in trips if t.get("carrier_id")})
    habilitacion: dict[str, bool] = {}
    if ids:
        habilitacion = {f["carrier_id"]: f["carrier_can_operate"]
                        for f in await pool.fetch(_CAN_OPERATE_SQL, ids)}
    for t in trips:
        t["carrier_can_operate"] = habilitacion.get(str(t["carrier_id"])) if t.get("carrier_id") else None
```

En `list_trips`, después del bucle que arma `data` y antes de `stops_by_trip = …`, agregar `await _attach_carrier_can_operate(pool, data)`. En `get_trip`, después de `d = dict(row)`, agregar `await _attach_carrier_can_operate(pool, [d])`.

4. `driver_candidates`. En el SQL, `LEFT JOIN public.carriers c ON c.id = app.carrier_of('DRIVER', d.id)` (se borra el join a `driver_assignments`) y `c.operational_status AS carrier_operational_status,` en el SELECT. En cada candidato del `return`, `"carrier_operational_status": r["carrier_operational_status"],`.

5. `assets.py:assign_driver_to_asset`. Reemplazar la verificación de existencia del conductor:

```python
            estado = await conn.fetchval("SELECT operational_status FROM public.drivers WHERE id = $1", driver_id)
            if estado is None:
                raise HTTPException(404, "Conductor no encontrado")
            # spec §7.1: "Conductor habitual" deja de admitir dados de baja. Si la
            # Task 8 deja una guarda compartida, esta línea pasa a llamarla.
            if estado != "ACTIVE":
                raise HTTPException(409, {
                    "code": "DRIVER_INACTIVE",
                    "message": "Ese conductor está dado de baja: no puede ser el conductor habitual "
                               "de un equipo. Reactívalo en el Directorio antes de asignarlo.",
                })
```

- [ ] **Step 6: Update the static test of the lateral**

En `tests/test_compliance_pending_docs.py`:
- `test_pending_docs_null_when_entity_not_resolved` cuenta `IS NULL THEN NULL ELSE` == 6 ("2 columnas x 3 dominios"). Pasa a `== 9` ("3 columnas x 3 dominios"), con el comentario actualizado.
- Agregar:

```python
def test_trip_select_exposes_the_d1_alert_per_entity():
    """D1 (R-B5): el aviso crítico va por entidad, nunca como un campo del
    viaje. La habilitación de la empresa se agrega por página
    (_attach_carrier_can_operate)."""
    for campo in ("driver_has_critical_alert", "tractor_has_critical_alert", "carrier_has_critical_alert"):
        assert campo in _TRIP_SELECT
    assert "AS has_critical_alert," not in _TRIP_SELECT
```

Si `alert_severity_sql` nombra `public.compliance_records`, `test_trip_from_joins_compliance_records_per_domain` deja de contar 3. En ese caso se cambia el test para contar `FROM public.compliance_records cr`, sin aflojar el "una por dominio".

- [ ] **Step 7: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_monitor_integration.py tests/test_compliance_pending_docs.py tests/test_drivers.py tests/test_asignar_conductor.py tests/test_entity_summary_integration.py tests/test_carrier_status_in_fleet_reads_integration.py tests/test_insurance_alert.py tests/test_trip_fleet_links.py tests/test_trip_notes.py tests/test_config_monitor.py tests/test_cliente_del_viaje.py tests/test_cliente_del_viaje_integracion.py tests/test_anular_viajes_integracion.py tests/test_ventana_en_curso_integracion.py tests/test_directory_permissions.py -q`

Expected: PASS. Un test con mock que devuelva filas de viaje con `carrier_id` no nulo recibe en `_attach_carrier_can_operate` esas mismas filas como respuesta del `pool.fetch`, y falla con `KeyError: 'carrier_can_operate'`. Se corrige el mock con un `side_effect` que devuelva `[]` para `_CAN_OPERATE_SQL`, y se reporta.

- [ ] **Step 8: Verificar que la mutación mata el test**

1. En `_attach_carrier_can_operate`, reemplazar el valor por `True`. Correr `tests/test_d1_monitor_integration.py`. Expected: FAIL en `test_una_empresa_con_un_obligatorio_faltante_no_puede_operar`. Restaurar.
2. En `_compliance_alert_lateral`, borrar la rama `{alert_severity_sql('cr')} = 'critical' OR`. Expected: FAIL en `test_el_monitor_dice_si_la_empresa_puede_operar_y_si_hay_aviso_critico`. Restaurar.
3. En `usual_tractor_lateral`, quitar `LIMIT 1`. Expected: FAIL en `test_drivers_no_duplica_conductor_con_dos_tractos`. Restaurar.

- [ ] **Step 9: Medir el Monitor**

`EXPLAIN (ANALYZE)` de `_CAN_OPERATE_SQL` con los `carrier_id` de una página real del Monitor (los de los viajes activos de hoy). Va en una transacción revertida con la migración ensayada, mismo esqueleto que el Step 11 de la Task 5.

Expected: bajo 250 ms. Es la base de Pendientes (~150 ms medidos) más el agregado. Si lo supera, se reporta con el plan antes de seguir, porque se paga en cada recarga del Monitor.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/backend/api/app/routers/trips.py \
  monitor-app/backend/api/app/routers/drivers.py \
  monitor-app/backend/api/app/routers/assets.py \
  monitor-app/backend/api/app/services/entity_summary.py \
  monitor-app/backend/api/tests/test_d1_monitor_integration.py \
  monitor-app/backend/api/tests/test_compliance_pending_docs.py
git commit -m "feat(monitor): habilitación de la empresa y aviso crítico por entidad; un conductor, una fila

Cada viaje trae carrier_can_operate y driver_/tractor_/carrier_has_critical_alert
(severidad del aviso o documento crítico pendiente), al lado de lo de hoy.
/drivers, /fuzzy-match y /available-drivers devuelven una fila por conductor con
su tracto habitual. El conductor habitual rechaza a un dado de baja con 409
DRIVER_INACTIVE (D1, Task 7).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Guarda de asignación en la API

**Files:**
- Create: `monitor-app/backend/api/app/services/assignment_guard.py`
- Modify: `monitor-app/backend/api/app/routers/trips.py`:
  - `create_trip` `:2009-2023`;
  - `bulk_create_trips` `:2026-2083`;
  - `assign_driver_bulk` `:2118-2191`;
  - `assign_fleet_link` `:2931-2993`;
  - nuevo `_assignment_subjects` junto a `_activo_de_la_patente` `:1784`.
- Modify: `monitor-app/backend/api/app/routers/assets.py:168-221` (`assign_driver_to_asset`)
- Modify: `monitor-app/backend/api/app/routers/drivers.py` (join del tracto habitual en `list_drivers` y `fuzzy_match_drivers`; se salta si la T7 ya lo hizo)
- Modify: `monitor-app/backend/api/tests/d1_subjects.py` (`make_test_fleet`; el archivo y `apply_fleet_facts` son de la T2)
- Create: `monitor-app/backend/api/tests/test_assignment_guard_integration.py`, `monitor-app/backend/api/tests/test_assignment_guard_wiring.py`
- Modify: `monitor-app/backend/api/tests/test_asignar_conductor.py`, `tests/test_crear_viaje_manual_integracion.py`, `tests/test_trip_assignment_integration.py`

**Interfaces:**
- Consumes:
  - `app.services.fleet_compliance.carrier_compliance_cte()` (T4; columnas `carrier_id`, `can_operate`);
  - `app.carrier_of` (T2);
  - `tests.d1_subjects.apply_fleet_facts(conn)` (T2). Corre la migración hasta la línea `-- d1:checks`, sin los locks de los CHECK. Hasta la Task 10 la migración no está aplicada: todo test que llegue a la guarda la llama primero dentro de su transacción revertida.
- Produces:
  ```python
  @dataclass(frozen=True)
  class AssignmentSubjects:
      carrier_id: str | None = None
      driver_id: str | None = None
      asset_ids: tuple[str, ...] = ()
      check_carrier: bool = True
  @dataclass(frozen=True)
  class AssignmentCheck:
      blocking: dict | None = None          # {"code", "message"}
      warnings: tuple[dict, ...] = ()       # [{"code": "CARRIER_NOT_ENABLED", "message"}]
  async def check_assignments(conn, items: Sequence[AssignmentSubjects]) -> list[AssignmentCheck]
  async def enforce_assignment(conn, subjects: AssignmentSubjects | None) -> list[dict]  # 409 o los avisos
  ```
- Respuestas:
  - `POST /trips` y `POST /trips/{id}/fleet-link`: el viaje, con `warnings`.
  - `POST /trips/assign-driver`: `{"asignados", "warnings"}`.
  - `POST /trips/bulk`: `{"created", "ids", "errors", "warnings": [{"row", "code", "message"}]}`.
  - Errores: 409 con `detail = {"code", "message"}`; en el lote, además `errors` (C-R10).

- [ ] **Step 1: Helper de sujetos en `tests/d1_subjects.py`**

Va en el archivo que creó la T2, al lado de `apply_fleet_facts`. Mismo patrón que `cliente_de_prueba` (`conftest.py:359`) y `_flota_de_empresa_de_baja` (`tests/test_carrier_status_in_fleet_reads_integration.py:20`). Si la T2 o la T4 ya dejaron ahí un helper equivalente, se usa ese y este paso solo agrega lo que falte (`enabled`). El nombre no empieza con `test_`: importado en un módulo de tests, pytest lo recogería como test.

```python
async def make_test_fleet(conn, *, carrier_status: str = "ACTIVE", driver_status: str = "ACTIVE",
                          asset_status: str = "ACTIVE", enabled: bool | None = None) -> dict:
    """Una empresa, un conductor y un tracto creados por el test (prefijo
    ZZ-TEST-D1), con asignaciones ACTIVE, dentro de la transacción revertida.

    `enabled` fija la habilitación sin depender del catálogo real:
      None  deja lo que sembraron los triggers;
      True  borra esa siembra: empresa activa sin pendientes, Habilitada
            (Review Focus 1 de D1);
      False además le deja un obligatorio que falta, con un requisito propio
            del test (is_active = false: la siembra no lo ve, la base de
            Pendientes sí, porque no filtra is_active)."""
    import uuid
    s = uuid.uuid4().hex[:6].upper()
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, $2) RETURNING id::text",
        f"ZZ-TEST-D1 Empresa {s}", carrier_status)
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id::text",
        f"ZZ-TEST-D1 Conductor {s}", driver_status)
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, 'TRACTOCAMION', $2) RETURNING id::text", plate, asset_status)
    await conn.execute("INSERT INTO public.driver_assignments (driver_id, carrier_id, status) "
                       "VALUES ($1::uuid, $2::uuid, 'ACTIVE')", driver, carrier)
    await conn.execute("INSERT INTO public.asset_assignments (asset_id, carrier_id, status) "
                       "VALUES ($1::uuid, $2::uuid, 'ACTIVE')", asset, carrier)
    if enabled is not None:
        await conn.execute("DELETE FROM public.compliance_records WHERE entity_id = ANY($1::uuid[])",
                           [carrier, driver, asset])
    if enabled is False:
        req = await conn.fetchval(
            "INSERT INTO public.compliance_requirements (target_entity, requirement_code, name, "
            "requirement_level, expiration_policy, exigible_on, is_active) "
            "VALUES ('CARRIER', $1, $2, 'LEGAL_MANDATORY', 'NONE', 'ON_ENTITY_START', false) RETURNING id",
            f"ZZ_TEST_D1_{s}", f"ZZ-TEST-D1 obligatorio {s}")
        await conn.execute(
            "INSERT INTO public.compliance_records (entity_type, entity_id, requirement_id, status, is_current) "
            "VALUES ('CARRIER', $1::uuid, $2, 'MISSING', true)", carrier, req)
    return {"carrier": carrier, "driver": driver, "asset": asset, "plate": plate, "suffix": s}
```

Si la T4 filtrara `is_active` en la base de Pendientes (el contrato dice "movido sin cambios", así que no debería), el requisito va con `is_active = true` y el docstring lo dice.

- [ ] **Step 2: Write the failing tests**

Patrón de `tests/test_asignar_conductor.py`: los endpoints reales con `PoolDeUnaConexion` y `_usuario_real`, dentro de `conexion_revertida`. Para el viaje, `_viaje_manual` de `tests/test_anulacion_en_la_base_integracion.py:18`: el viaje lo crea el test, sin empresa, así que el alta no escribe vínculo. Crear `tests/test_assignment_guard_integration.py`:

```python
"""Guarda de asignación (D1 §7.1): una sola validación para las rutas que
vinculan flota a un viaje. Rechaza (409) lo que no puede operar por su ciclo de
vida y avisa, sin bloquear, a la empresa No habilitada (P14 abierta).

Los sujetos los crea el test (make_test_fleet, prefijo ZZ-TEST-D1). Antes de la
guarda, todas estas asignaciones se guardaban sin decir nada."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.assets import assign_driver_to_asset
from app.routers.trips import (
    TripCreateBody, TripStopCreate, assign_driver_bulk, assign_fleet_link, bulk_create_trips, create_trip,
)
from app.schemas.trip import AsignarConductorBody
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba
from tests.d1_subjects import apply_fleet_facts, make_test_fleet

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 5)


@pytest.fixture(autouse=True)
async def _hechos_de_la_flota(conexion_revertida):
    """app.carrier_of, app.active_fleet y la base de fleet_compliance, dentro de
    la transacción revertida: la migración se aplica recién en la Task 10."""
    await apply_fleet_facts(conexion_revertida)
STOPS = [TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")]


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(planning_date=DIA.isoformat(), client_name=await cliente_de_prueba(conn), stops=STOPS),
        pool=PoolDeUnaConexion(conn), user=usuario)
    return str(viaje["id"])


async def _vinculo_manual(conn, trip_id: str):
    return await conn.fetchrow(
        "SELECT carrier_id::text, driver_id::text, tractor_asset_id::text FROM app.trip_fleet_links "
        "WHERE trip_id = $1::uuid AND link_source = 'manual'", trip_id)


# ── POST /trips/{id}/fleet-link ──────────────────────────────────────────────

@pytest.mark.parametrize("estado", ["INACTIVE", "LEGACY_INACTIVE", "ONBOARDING"])
async def test_empresa_no_activa_es_409_y_no_escribe(conexion_revertida, estado):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, carrier_status=estado, enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"]}, PoolDeUnaConexion(conn), usuario)

    assert e.value.status_code == 409
    assert e.value.detail["code"] == "CARRIER_NOT_ACTIVE"
    assert f"Empresa {flota['suffix']}" in e.value.detail["message"]
    if estado == "ONBOARDING":   # C-R8: dice qué hacer
        assert "onboarding" in e.value.detail["message"] and "Directorio" in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_conductor_de_baja_es_409_y_no_escribe(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "driver_id": flota["driver"]},
                                PoolDeUnaConexion(conn), usuario)

    assert (e.value.status_code, e.value.detail["code"]) == (409, "DRIVER_INACTIVE")
    assert f"Conductor {flota['suffix']}" in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_tracto_de_baja_por_su_patente_es_409(conexion_revertida):
    """La patente escrita manda sobre el id (16/09): la guarda mira el equipo
    que sale de la patente, el mismo que se escribiría."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, asset_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "tractor_plate": flota["plate"]},
                                PoolDeUnaConexion(conn), usuario)

    assert (e.value.status_code, e.value.detail["code"]) == (409, "ASSET_INACTIVE")
    assert flota["plate"] in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_sin_empresa_elegida_se_evalua_la_del_conductor(conexion_revertida):
    """C-R6: el resolvedor le pondría al vínculo la empresa de baja del
    conductor; la guarda la evalúa antes."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, carrier_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"driver_id": flota["driver"]}, PoolDeUnaConexion(conn), usuario)

    assert e.value.detail["code"] == "CARRIER_NOT_ACTIVE"


async def test_empresa_no_habilitada_asigna_con_aviso(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, enabled=False)
    trip_id = await _viaje_manual(conn, usuario)

    viaje = await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "driver_id": flota["driver"]},
                                    PoolDeUnaConexion(conn), usuario)

    assert [w["code"] for w in viaje["warnings"]] == ["CARRIER_NOT_ENABLED"]
    assert f"Empresa {flota['suffix']}" in viaje["warnings"][0]["message"]
    assert (await _vinculo_manual(conn, trip_id))["driver_id"] == flota["driver"]


async def test_empresa_habilitada_asigna_sin_aviso(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    viaje = await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "driver_id": flota["driver"],
                                              "tractor_plate": flota["plate"]},
                                    PoolDeUnaConexion(conn), usuario)

    assert viaje["warnings"] == []
    assert (await _vinculo_manual(conn, trip_id))["tractor_asset_id"] == flota["asset"]


# ── POST /trips ──────────────────────────────────────────────────────────────

async def test_alta_con_conductor_de_baja_es_409_y_no_crea_el_viaje(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    cliente = await cliente_de_prueba(conn)

    with pytest.raises(HTTPException) as e:
        await create_trip(
            TripCreateBody(planning_date=DIA.isoformat(), client_name=cliente, stops=STOPS,
                           carrier_id=flota["carrier"], driver_id=flota["driver"]),
            pool=PoolDeUnaConexion(conn), user=usuario)

    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert await conn.fetchval("SELECT count(*) FROM app.trips_manual WHERE client_name = $1", cliente) == 0


# ── POST /trips/assign-driver ────────────────────────────────────────────────

async def test_asignar_un_conductor_de_baja_a_varios_viajes_es_409_y_no_escribe(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    viajes = [await _viaje_manual(conn, usuario) for _ in range(2)]

    with pytest.raises(HTTPException) as e:
        await assign_driver_bulk(AsignarConductorBody(driver_id=flota["driver"], trip_ids=viajes),
                                 PoolDeUnaConexion(conn), usuario)

    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM app.trip_fleet_links WHERE trip_id = ANY($1::uuid[]) AND driver_id = $2::uuid",
        viajes, flota["driver"]) == 0


# ── POST /trips/bulk (Review Focus 4) ────────────────────────────────────────

async def test_bulk_con_un_conductor_de_baja_no_escribe_nada(conexion_revertida):
    """Un solo viaje del lote toca a un conductor dado de baja: 409 para el
    lote entero, con la fila y el nombre de quien bloquea, y ninguna escritura.
    La persona no puede creer que guardó la mitad."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    buena = await make_test_fleet(conn, enabled=True)
    mala = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    cliente = await cliente_de_prueba(conn)

    def fila(f):
        return TripCreateBody(planning_date=DIA.isoformat(), client_name=cliente, stops=STOPS,
                              carrier_id=f["carrier"], driver_id=f["driver"])

    with pytest.raises(HTTPException) as e:
        await bulk_create_trips([fila(buena), fila(mala), fila(buena)], pool=PoolDeUnaConexion(conn), user=usuario)

    assert e.value.status_code == 409
    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert [(x["row"], x["code"]) for x in e.value.detail["errors"]] == [(2, "DRIVER_INACTIVE")]
    assert f"Conductor {mala['suffix']}" in e.value.detail["errors"][0]["error"]
    assert await conn.fetchval("SELECT count(*) FROM app.trips_manual WHERE client_name = $1", cliente) == 0
    assert await conn.fetchval("SELECT count(*) FROM app.trips WHERE client_name = $1", cliente) == 0


async def test_bulk_con_empresa_no_habilitada_importa_con_aviso_por_fila(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    habilitada = await make_test_fleet(conn, enabled=True)
    no_habilitada = await make_test_fleet(conn, enabled=False)
    cliente = await cliente_de_prueba(conn)
    filas = [TripCreateBody(planning_date=DIA.isoformat(), client_name=cliente, stops=STOPS,
                            carrier_id=f["carrier"], driver_id=f["driver"]) for f in (habilitada, no_habilitada)]

    res = await bulk_create_trips(filas, pool=PoolDeUnaConexion(conn), user=usuario)

    assert res["created"] == 2
    assert [(w["row"], w["code"]) for w in res["warnings"]] == [(2, "CARRIER_NOT_ENABLED")]


# ── Conductor habitual (C-R16) ──────────────────────────────────────────────

@pytest.mark.parametrize("de_baja, codigo", [("driver", "DRIVER_INACTIVE"), ("asset", "ASSET_INACTIVE")])
async def test_conductor_habitual_de_baja_es_409(conexion_revertida, de_baja, codigo):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, **{f"{de_baja}_status": "INACTIVE"})

    with pytest.raises(HTTPException) as e:
        await assign_driver_to_asset(flota["asset"], {"driver_id": flota["driver"]},
                                     pool=PoolDeUnaConexion(conn), user=usuario)

    assert e.value.detail["code"] == codigo
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE asset_id = $1::uuid AND status = 'ACTIVE'",
        flota["asset"]) == 0
```

Y `tests/test_assignment_guard_wiring.py`, modelado en `tests/test_trip_flags_single_definition.py` (guarda que mira el código, sin base):

```python
"""Una sola validación de asignación (D1 §7.1). Toda ruta que escribe un
vínculo de flota pasa por app/services/assignment_guard.py antes de escribir.
Un endpoint nuevo que inserte en app.trip_fleet_links sin la guarda hace
fallar este test."""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
GUARD_CALLS = {"enforce_assignment", "check_assignments"}
# Escriben el vínculo pero no son rutas: las llaman rutas que ya pasaron la guarda.
WRITERS = {"_escribir_link_manual", "_insert_trip"}


def _funcs(path: Path) -> dict[str, ast.AsyncFunctionDef]:
    tree = ast.parse(path.read_text())
    return {n.name: n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)}


def _calls(func) -> list[tuple[int, str]]:
    out = []
    for node in ast.walk(func):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            if name:
                out.append((node.lineno, name))
    return sorted(out)


def _source(func, path: Path) -> str:
    return ast.get_source_segment(path.read_text(), func) or ""


def test_toda_ruta_que_escribe_un_vinculo_pasa_por_la_guarda_antes():
    trips = APP / "routers" / "trips.py"
    funcs = _funcs(trips)
    rutas = set()
    for name, func in funcs.items():
        if name in WRITERS:
            continue
        calls = _calls(func)
        escribe = (any(n in WRITERS for _, n in calls)
                   or "INSERT INTO app.trip_fleet_links" in _source(func, trips))
        if not escribe:
            continue
        rutas.add(name)
        primera_guarda = min((l for l, n in calls if n in GUARD_CALLS), default=None)
        primera_escritura = min((l for l, n in calls if n in WRITERS), default=None)
        assert primera_guarda is not None, f"{name} escribe un vínculo sin pasar por la guarda"
        if primera_escritura is not None:
            assert primera_guarda < primera_escritura, f"{name}: la guarda corre después de escribir"
    # Si la expresión deja de encontrarlas, el test no protege nada.
    assert {"create_trip", "bulk_create_trips", "assign_fleet_link", "assign_driver_bulk"} <= rutas


def test_el_conductor_habitual_pasa_por_la_guarda():
    funcs = _funcs(APP / "routers" / "assets.py")
    assert any(n in GUARD_CALLS for _, n in _calls(funcs["assign_driver_to_asset"]))
```

En `assign_driver_bulk` el `INSERT INTO app.trip_fleet_links` está en el texto SQL, no en una llamada a un escritor. Por eso la segunda aserción no aplica ahí, pero la primera sí: la guarda tiene que existir en la función.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_assignment_guard_integration.py tests/test_assignment_guard_wiring.py -q`

Expected:
- FAIL en la colección del archivo de integración con `ModuleNotFoundError`/`ImportError` si `app.services.assignment_guard` aún no existe. Este archivo no lo importa directamente; si la colección pasa, cada test de 409 falla con `Failed: DID NOT RAISE <class 'fastapi.exceptions.HTTPException'>`, porque hoy se guarda todo.
- Los de aviso fallan con `KeyError: 'warnings'`.
- El de cableado falla con `AssertionError: create_trip escribe un vínculo sin pasar por la guarda`.

Si `make_test_fleet` falla por un NOT NULL o un CHECK de las tablas base, se corrige el helper y se reporta. Nunca se toca la aserción.

- [ ] **Step 4: Implement `app/services/assignment_guard.py`**

```python
"""Guarda de asignación: a quién se le puede asignar un viaje (D1 §7.1).

Una sola validación para POST /trips, /trips/bulk, /trips/{id}/fleet-link,
/trips/assign-driver y el conductor habitual de un equipo
(POST /assets/{id}/driver-assignment). La prueba de que todas pasan por acá es
tests/test_assignment_guard_wiring.py.

  · Rechaza (409) lo que no puede operar por su CICLO DE VIDA: empresa no
    activa (CARRIER_NOT_ACTIVE: dada de baja o en onboarding, C-R8),
    conductor dado de baja (DRIVER_INACTIVE), tracto o rampla dados de baja
    (ASSET_INACTIVE, C-R9).
  · Avisa, sin bloquear, a la empresa activa que NO ESTÁ HABILITADA por sus
    documentos (CARRIER_NOT_ENABLED). Bloquearla es la pregunta abierta P14:
    el día que se decida, es mover ese caso de `warnings` a `blocking`.

La empresa que se evalúa es la elegida o, si no se eligió, la del conductor
(app.carrier_of): es la que app.resolve_trip_fleet() le pone al vínculo manual
cuando falta (C-R6).

Un id que no existe no se rechaza acá: lo rechaza la foreign key al escribir,
con el error de siempre. La guarda solo dice que no a lo que existe y no puede
operar. Por eso una fila ausente en la consulta no es un error.

Todo es de lectura y va por la conexión que se le pasa: dentro de la
transacción de la ruta, nunca por el pool (test_no_pool_call_inside_a_transaction_block)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fastapi import HTTPException

from .fleet_compliance import carrier_compliance_cte

CARRIER_NOT_ACTIVE = "CARRIER_NOT_ACTIVE"
DRIVER_INACTIVE = "DRIVER_INACTIVE"
ASSET_INACTIVE = "ASSET_INACTIVE"
CARRIER_NOT_ENABLED = "CARRIER_NOT_ENABLED"

# Las palabras del glosario (spec D1 §3): INACTIVE y LEGACY_INACTIVE se dicen igual ("dada de baja").


@dataclass(frozen=True)
class AssignmentSubjects:
    """Lo que una escritura va a vincular. `check_carrier=False` para lo que no
    es un viaje (el conductor habitual de un equipo)."""
    carrier_id: str | None = None
    driver_id: str | None = None
    asset_ids: tuple[str, ...] = ()
    check_carrier: bool = True


@dataclass(frozen=True)
class AssignmentCheck:
    blocking: dict | None = None
    warnings: tuple[dict, ...] = ()


# Una fila por ítem, en una sola consulta: el lote llega a 500 filas.
_SUBJECTS_SQL = """
SELECT s.idx,
       c.id::text AS carrier_id, c.business_name, c.operational_status AS carrier_status,
       d.full_name AS driver_name, d.operational_status AS driver_status,
       (SELECT array_agg(a.license_plate ORDER BY a.license_plate)
          FROM public.assets a
         WHERE a.id = ANY(string_to_array(NULLIF(s.asset_ids, ''), ',')::uuid[])
           AND a.operational_status <> 'ACTIVE') AS inactive_plates
FROM unnest($1::int[], $2::uuid[], $3::uuid[], $4::text[], $5::bool[])
     AS s(idx, carrier_id, driver_id, asset_ids, check_carrier)
LEFT JOIN public.carriers c
       ON s.check_carrier AND c.id = COALESCE(s.carrier_id, app.carrier_of('DRIVER', s.driver_id))
LEFT JOIN public.drivers d ON d.id = s.driver_id
"""

# La habilitación sale del único lugar que la calcula (fleet_compliance, T4).
# Solo se pide para las empresas activas del lote: a las demás ya las rechaza
# el ciclo de vida.
_CAN_OPERATE_SQL = f"""
WITH {carrier_compliance_cte()}
SELECT carrier_id::text, can_operate FROM carrier_compliance WHERE carrier_id = ANY($1::uuid[])
"""


def _verdict(row, can_operate: dict[str, bool]) -> AssignmentCheck:
    if row is None:
        return AssignmentCheck()
    if row["carrier_id"] and row["carrier_status"] == "ONBOARDING":
        # C-R8 (confirmado por el usuario): en onboarding se le piden documentos, pero no recibe viajes.
        return AssignmentCheck(blocking={
            "code": CARRIER_NOT_ACTIVE,
            "message": (f"La empresa {row['business_name']} está en onboarding: actívala en el "
                        "Directorio para asignarle viajes.")})
    if row["carrier_id"] and row["carrier_status"] != "ACTIVE":
        return AssignmentCheck(blocking={
            "code": CARRIER_NOT_ACTIVE,
            "message": f"La empresa {row['business_name']} está dada de baja: no se le pueden asignar viajes."})
    if row["driver_status"] is not None and row["driver_status"] != "ACTIVE":
        return AssignmentCheck(blocking={
            "code": DRIVER_INACTIVE,
            "message": f"El conductor {row['driver_name']} está dado de baja: no se le pueden asignar viajes."})
    if row["inactive_plates"]:
        return AssignmentCheck(blocking={
            "code": ASSET_INACTIVE,
            "message": f"El equipo {row['inactive_plates'][0]} está dado de baja: no se le pueden asignar viajes."})
    # `is False`, no `not`: una empresa sin fila en carrier_compliance no tiene
    # nada pendiente (contrato de la T4, Review Focus 1) y no se avisa.
    if row["carrier_id"] and can_operate.get(row["carrier_id"]) is False:
        return AssignmentCheck(warnings=({
            "code": CARRIER_NOT_ENABLED,
            "message": (f"La empresa {row['business_name']} no está habilitada: tiene documentos "
                        "obligatorios vencidos o faltantes. El viaje quedó asignado igual."),
        },))
    return AssignmentCheck()


async def check_assignments(conn, items: Sequence[AssignmentSubjects]) -> list[AssignmentCheck]:
    """Un veredicto por ítem, en el mismo orden. Dos consultas por lote, no por ítem."""
    if not items:
        return []
    rows = {r["idx"]: r for r in await conn.fetch(
        _SUBJECTS_SQL,
        list(range(len(items))),
        [i.carrier_id for i in items],
        [i.driver_id for i in items],
        [",".join(i.asset_ids) for i in items],
        [i.check_carrier for i in items],
    )}
    activas = sorted({r["carrier_id"] for r in rows.values()
                      if r["carrier_id"] and r["carrier_status"] == "ACTIVE"})
    can_operate = ({r["carrier_id"]: r["can_operate"] for r in await conn.fetch(_CAN_OPERATE_SQL, activas)}
                   if activas else {})
    return [_verdict(rows.get(i), can_operate) for i in range(len(items))]


async def enforce_assignment(conn, subjects: AssignmentSubjects | None) -> list[dict]:
    """409 si algo no puede operar; si no, los avisos (lista vacía si no hay)."""
    if subjects is None:
        return []
    (check,) = await check_assignments(conn, [subjects])
    if check.blocking:
        raise HTTPException(409, check.blocking)
    return list(check.warnings)
```

La guarda usa `conn.fetch` y nunca `fetchval`/`fetchrow`, por dos motivos:
- `tests/test_trip_fleet_links.py` arma `pool.fetchval.side_effect` como una lista ordenada (`:51`). Una llamada nueva a `fetchval` corre esa lista y rompe el mock sin que cambie nada real.
- Con `fetch`, un mock devuelve `[]` o un `MagicMock` que itera vacío, y la guarda no dice nada.

- [ ] **Step 5: Wire the routes (`trips.py`)**

Import: `from ..services.assignment_guard import AssignmentSubjects, check_assignments, enforce_assignment`.

Debajo de `_activo_de_la_patente`:

```python
async def _assignment_subjects(conn, body: TripCreateBody) -> AssignmentSubjects | None:
    """Lo que el alta va a vincular, para la guarda (D1 §7.1). Nada si no hay
    empresa: sin empresa el alta no escribe vínculo manual y lo resuelve el
    trigger (C-R7). El equipo sale de la patente, igual que en _insert_trip."""
    if not body.carrier_id:
        return None
    tractor_id, _ = await _activo_de_la_patente(conn, body.tractor_plate, body.tractor_asset_id)
    trailer_id, _ = await _activo_de_la_patente(conn, body.trailer_plate, body.trailer_asset_id)
    return AssignmentSubjects(carrier_id=body.carrier_id, driver_id=body.driver_id,
                              asset_ids=tuple(a for a in (tractor_id, trailer_id) if a))
```

`create_trip`:

```python
    async with pool.acquire() as conn:
        async with conn.transaction():
            # La guarda antes de cualquier INSERT: un 409 no deja nada.
            warnings = await enforce_assignment(conn, await _assignment_subjects(conn, body))
            trip_id = await _insert_trip(conn, body, user, valid_statuses)
    await _log_system_note(pool, trip_id, user, "Creó el viaje manualmente")
    trip = await get_trip(trip_id, pool, user)
    trip["warnings"] = warnings
    return trip
```

`bulk_create_trips`: dentro del `async with pool.acquire() as conn:` de validación, después del `for` que llena `preparadas`:

```python
        # La guarda, para todo el lote y antes de abrir la transacción. Dos
        # consultas en total, no dos por fila (Review Focus 4 de D1).
        con_vinculo = [(fila, s) for fila, trip in preparadas
                       if (s := await _assignment_subjects(conn, trip)) is not None]
        checks = await check_assignments(conn, [s for _, s in con_vinculo])
```

Después del `if errors: raise HTTPException(422, …)` existente:

```python
    bloqueadas = [{"row": fila, "code": c.blocking["code"], "error": c.blocking["message"]}
                  for (fila, _), c in zip(con_vinculo, checks) if c.blocking]
    if bloqueadas:
        n = len(bloqueadas)
        # `errors` con la forma que TripBulkUpload ya lee (C-R10).
        raise HTTPException(409, {
            "code": bloqueadas[0]["code"],
            "message": f"No se importó nada: {n} fila{'s' if n != 1 else ''} asigna{'n' if n != 1 else ''} "
                       "flota que no puede operar",
            "errors": bloqueadas,
        })
    warnings = [{"row": fila, **w} for (fila, _), c in zip(con_vinculo, checks) for w in c.warnings]
```

y `return {"created": len(ids), "ids": ids, "errors": [], "warnings": warnings}`.

`assign_fleet_link`: dentro de la transacción, después de resolver `tractor_asset_id` y `trailer_asset_id` y **antes** de `_escribir_link_manual`:

```python
            warnings = await enforce_assignment(conn, AssignmentSubjects(
                carrier_id=carrier_id, driver_id=driver_id,
                asset_ids=tuple(a for a in (tractor_asset_id, trailer_asset_id) if a)))
```

y al final `trip = await get_trip(trip_id, pool, user); trip["warnings"] = warnings; return trip`.

`assign_driver_bulk`: primera sentencia dentro de `async with conn.transaction():`

```python
            # La empresa del conductor, no la que el vínculo ya traía (C-R6).
            warnings = await enforce_assignment(conn, AssignmentSubjects(driver_id=body.driver_id))
```

y `return {"asignados": len(filas), "warnings": warnings}`.

- [ ] **Step 6: Conductor habitual (`assets.py`) y tracto habitual activo (`drivers.py`)**

En `assign_driver_to_asset`, dentro de la transacción, después de los dos `404` y antes del `UPDATE`:

```python
            # Un conductor o un equipo de baja no se asigna (D1 §7.1, C-R16).
            # No es un viaje: la empresa no se evalúa.
            await enforce_assignment(conn, AssignmentSubjects(
                driver_id=driver_id, asset_ids=(asset_id,), check_carrier=False))
```

(import `from ..services.assignment_guard import AssignmentSubjects, enforce_assignment`).

En `drivers.py` (`list_drivers` y `fuzzy_match_drivers`), si la T7 no lo hizo: `LEFT JOIN public.assets a ON a.id = vda.asset_id AND a.operational_status = 'ACTIVE'`. Lleva un comentario: el formulario autocompleta ese tracto, y uno de baja terminaría en un 409.

- [ ] **Step 7: Los tests existentes que eligen sujetos de producción**

Run antes de tocarlos: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_asignar_conductor.py tests/test_crear_viaje_manual_integracion.py tests/test_trip_assignment_integration.py tests/test_trip_fleet_links.py tests/test_trip_create.py tests/test_trip_flags_single_definition.py -q`

Expected: algunos rojos con 409. 215 de 251 empresas no están activas, así que estos helpers ahora caen en sujetos que la guarda rechaza:
- `SELECT id FROM public.carriers LIMIT 1` (`test_asignar_conductor.py:137`, `:449`, `:478`);
- `_un_conductor`, `_conductor_sin_empresa`, `_conductor_con_empresa` (`test_asignar_conductor.py`);
- `_conductor_con_empresa` (`test_crear_viaje_manual_integracion.py:27`);
- `any_driver_id` (`test_trip_assignment_integration.py:55`).

Se reemplazan por `make_test_fleet(conn, enabled=True)` (de `tests/d1_subjects.py`). Cada archivo suma el mismo fixture autouse `_hechos_de_la_flota` del Step 2 (`await apply_fleet_facts(conexion_revertida)`): ahora pasan por la guarda, y la guarda lee `app.carrier_of` y `fleet_compliance`. Cuando la migración ya esté aplicada (Task 10), el fixture sigue sirviendo: la migración es re-ejecutable.
- el conductor sin empresa es un `INSERT` de un conductor `ACTIVE` sin asignación;
- `test_una_empresa_elegida_a_mano_NO_se_pisa` necesita dos empresas: dos llamadas.

Las aserciones no cambian. Esa es la regla de "un test que elige datos de producción cambia de color" (memoria). Los mockeados (`test_trip_fleet_links.py`, `test_trip_create.py`) tienen que seguir verdes sin tocarlos. Si alguno se pone rojo por la guarda, el motivo es un `fetchval` nuevo, y se corrige la guarda, no el mock.

- [ ] **Step 8: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_assignment_guard_integration.py tests/test_assignment_guard_wiring.py tests/test_asignar_conductor.py tests/test_crear_viaje_manual_integracion.py tests/test_trip_assignment_integration.py tests/test_trip_fleet_links.py tests/test_trip_create.py tests/test_trip_flags_single_definition.py tests/test_drivers.py tests/test_assets.py tests/test_toda_ruta_declara_permiso.py -q`
Expected: PASS. `test_no_pool_call_inside_a_transaction_block` confirma que la guarda va por `conn` dentro de las transacciones.

- [ ] **Step 9: Verificar que la mutación mata el test**

Restaurar cada mutación después de verla fallar:
- (a) En `bulk_create_trips`, cambiar `if bloqueadas:` por `if False:`. Tiene que fallar `test_bulk_con_un_conductor_de_baja_no_escribe_nada`: `DID NOT RAISE`, o el conteo de `trips_manual` en 1 si una escritura dentro de `_insert_trip` lo dejara a medias.
- (b) En `_verdict`, cambiar `row["driver_status"] != "ACTIVE"` por `row["driver_status"] == "NUNCA"`. Tienen que fallar los cuatro tests de `DRIVER_INACTIVE`.
- (c) Borrar la línea `warnings = await enforce_assignment(...)` de `assign_fleet_link` y dejar `warnings = []`. Tienen que fallar `test_toda_ruta_que_escribe_un_vinculo_pasa_por_la_guarda_antes` y los cuatro tests de 409 de fleet-link.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/backend/api/app/services/assignment_guard.py monitor-app/backend/api/app/routers/trips.py \
  monitor-app/backend/api/app/routers/assets.py monitor-app/backend/api/app/routers/drivers.py \
  monitor-app/backend/api/tests/d1_subjects.py monitor-app/backend/api/tests/test_assignment_guard_integration.py \
  monitor-app/backend/api/tests/test_assignment_guard_wiring.py monitor-app/backend/api/tests/test_asignar_conductor.py \
  monitor-app/backend/api/tests/test_crear_viaje_manual_integracion.py \
  monitor-app/backend/api/tests/test_trip_assignment_integration.py
git commit -m "feat(trips): guarda de asignación con 409 y aviso de empresa no habilitada

Una sola validación para POST /trips, /trips/bulk, /trips/{id}/fleet-link,
/trips/assign-driver y el conductor habitual: rechaza empresa no activa,
conductor o equipo de baja (CARRIER_NOT_ACTIVE, DRIVER_INACTIVE,
ASSET_INACTIVE) antes de escribir; el lote es todo o nada. La empresa activa
no habilitada se asigna con warnings CARRIER_NOT_ENABLED (P14 abierta).
D1 §7.1, rulings C-R6 a C-R11 y C-R16.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Identidad de RUT y patente

**Files:**
- Create: `monitor-app/backend/api/app/utils/identity.py`
- Modify: `monitor-app/backend/api/app/services/document_matcher.py`:
  - `rut_dv` `:40-52` se va;
  - `extract_ruts` `:55-66`;
  - `_from_manifest` `:113-149`;
  - `match_document` `:262-337`;
  - `_plate_in_tokens` `:396-413` se va;
  - `match_owner` `:416-446`.
- Modify: `monitor-app/backend/api/app/routers/carriers.py:120` (`list_carriers`; editar sobre la versión de la T5, solo la cláusula de `q`), `:217` (`insurance-overview`), `:397-432` (`/buscar`)
- Modify: `monitor-app/backend/api/app/routers/drivers.py:67` (`list_drivers`; sobre la versión de la T7), `:96-140` (`fuzzy_match_drivers`)
- Modify: `monitor-app/backend/api/app/routers/compliance.py:631` (`q` de `/pending`)
- Modify: `monitor-app/backend/api/app/routers/trips.py:1784-1804` (`_activo_de_la_patente`)
- Create: `monitor-app/backend/api/tests/test_identity.py`, `monitor-app/backend/api/tests/test_identity_integration.py`

**Interfaces:**
- Produces (`app/utils/identity.py`):
  ```python
  def rut_check_digit(body: str) -> str                    # módulo 11; = public.rut_check_digit
  def canonical_rut(value: str | None) -> str | None       # = public.canonical_rut
  def canonical_plate(value: str | None) -> str | None     # = public.canonical_plate
  def plate_in_tokens(plate: str | None, tokens: list[str]) -> bool
  def rut_matches_sql(column: str, param: str) -> str      # predicado SQL de búsqueda de RUT
  def plate_matches_sql(column: str, param: str) -> str    # predicado SQL de búsqueda de patente
  ```
- Frontend, para la T13: el filtro de registros de la ficha de empresa (`carriers/[id]/page.tsx`) filtra en el cliente. Tiene que comparar por la misma clave que `identity`: dígitos más K para el RUT y alfanuméricos para la patente. Ningún endpoint de esta tarea lo cubre.

- [ ] **Step 1: Write the failing tests (puros)**

Patrón de `tests/test_match_owner.py` y `tests/test_document_matcher.py`: funciones puras con datos armados a mano. Los RUT de prueba tienen DV válido calculado, no son de personas reales del directorio:
- `10000013-K` y `1000005-K` (DV K);
- `10000004-0` (DV 0);
- `12345678-5`;
- `7654321-6`.

Crear `tests/test_identity.py`:

```python
"""Identidad de RUT y patente (D1 §7.2): una sola forma en Python, igual a la
de la base (20260817120000_identidad_canonica.sql). La paridad caso por caso
contra Postgres está en test_identity_integration.py."""
import pytest

from app.services.document_matcher import (
    Catalog, EntityUniverse, PendingOwner, RequirementAlias, extract_ruts, match_document, match_owner,
)
from app.utils.identity import canonical_plate, canonical_rut, plate_in_tokens

# (entrada, esperado): los mismos casos los resuelve Postgres en el test de paridad.
RUT_CASES = [
    ("12.345.678-5", "12345678-5"), ("12345678-5", "12345678-5"), ("12345678 5", "12345678-5"),
    (" 12.345.678 - 5 ", "12345678-5"), ("RUT: 12.345.678-5", "12345678-5"), ("12345678--5", "12345678-5"),
    ("10.000.013-k", "10000013-K"), ("10000013K", "10000013-K"), ("1.000.005-k", "1000005-K"),
    ("10.000.004-0", "10000004-0"), ("7.654.321-6", "7654321-6"), ("01000005K", "01000005-K"),
    ("12345678-0", None),      # DV inválido
    ("12345678-K", None),      # DV inválido con K
    ("K2345678-5", None),      # la K solo puede ser DV
    ("1234567k", None), ("123", None), ("", None), (None, None), ("0012345678-5", None),
]
PLATE_CASES = [
    ("ab-cd12", "ABCD12"), ("AB CD 12", "ABCD12"), ("abcd12", "ABCD12"), ("GBVC90\t", "GBVC90"),
    ("DT·BY52", "DTBY52"), ("ABC12", None), ("ABCD123", None), ("ñbcd12", None), ("", None), (None, None),
]


@pytest.mark.parametrize("raw, esperado", RUT_CASES)
def test_canonical_rut(raw, esperado):
    assert canonical_rut(raw) == esperado


@pytest.mark.parametrize("raw, esperado", PLATE_CASES)
def test_canonical_plate(raw, esperado):
    assert canonical_plate(raw) == esperado


def test_extract_ruts_devuelve_la_forma_canonica():
    assert extract_ruts("F30 10.000.013-k septiembre.pdf") == ["10000013-K"]
    # Con puntos y 5 dígitos de cuerpo no es un RUT para la base: tampoco aquí.
    assert extract_ruts("acta 12.345-6.pdf") == []


def test_plate_in_tokens_con_guion_o_espacio():
    assert plate_in_tokens("GLCD14", "REVISION TECNICA GLCD 14".split())
    assert plate_in_tokens("GLCD-14", ["RT", "GLCD14"])
    assert not plate_in_tokens("GLCD14", ["XGLCD145"])


def _catalog(*aliases):
    return Catalog(aliases=[RequirementAlias(*a) for a in aliases])


def test_match_document_encuentra_la_empresa_con_rut_guardado_con_puntos():
    """Review Focus 5: carriers.tax_id no es canónico por construcción (no tiene
    CHECK ni trigger, a diferencia de drivers)."""
    cands = match_document(
        file_name="Carpeta_Tributaria 10000013-K.pdf",
        catalog=_catalog(("r-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100)),
        universe=EntityUniverse(carriers=[("c1", "10.000.013-K", "ZZ Empresa")]))
    assert [(c.entity_id, c.evidence["entity"]["via"]) for c in cands] == [("c1", "RUT")]


def test_match_document_reconoce_la_patente_con_guion():
    cands = match_document(
        file_name="REVISION TECNICA GLCD-14.pdf",
        catalog=_catalog(("r-rt", "ASSET", "REVISION TECNICA", 100)),
        universe=EntityUniverse(assets=[("a1", "GLCD14")]))
    assert [c.entity_id for c in cands] == ["a1"]


def test_el_manifiesto_compara_el_rut_en_forma_canonica():
    cands = match_document(
        file_name="sin_senal.pdf",
        catalog=_catalog(("r-f30", "CARRIER", "F30", 100)),
        universe=EntityUniverse(carriers=[("c1", "10.000.013-K", "ZZ Empresa")]),
        manifest_row={"identificador": "10000013k", "requirement_code": ""})
    assert [c.entity_id for c in cands] == ["c1"]


def test_match_owner_con_rut_del_dueno_no_canonico():
    dueno = PendingOwner("r1", "CARRIER", "ZZ Empresa", "10.000.013-K", "ZZ Empresa")
    c = match_owner("f30 10000013k.pdf", [dueno])
    assert (c[0].record_id, c[0].reason) == ("r1", "rut")
```

- [ ] **Step 2: Write the failing integration tests**

Patrón de `tests/test_carrier_status_in_fleet_reads_integration.py`: los endpoints reales con `PoolDeUnaConexion`, y los sujetos creados por el test. Crear `tests/test_identity_integration.py`:

```python
"""Identidad de RUT y patente contra la base real (D1 §7.2, Review Focus 5).

La paridad compara el normalizador de Python con public.canonical_rut y
public.canonical_plate sobre la tabla de casos y 400 cadenas generadas con
semilla fija. Los buscadores se prueban con una empresa guardada con puntos y
otra sin puntos, buscadas al revés."""
from __future__ import annotations

import random
import uuid

import pytest

from app.routers.carriers import buscar_en_el_directorio, list_carriers
from app.routers.drivers import list_drivers
from app.services.document_matcher import EntityUniverse, PendingOwner, match_document, match_owner, Catalog, RequirementAlias
from app.utils.identity import canonical_plate, canonical_rut
from tests.conftest import PoolDeUnaConexion
from tests.d1_subjects import apply_fleet_facts
from tests.test_identity import PLATE_CASES, RUT_CASES

pytestmark = pytest.mark.integracion


@pytest.fixture(autouse=True)
async def _hechos_de_la_flota(conexion_revertida):
    """list_carriers (T5) y /drivers (T7) leen app.active_fleet y fleet_compliance:
    hasta la Task 10 la migración no está aplicada."""
    await apply_fleet_facts(conexion_revertida)


def _generadas(n: int = 400) -> list[str]:
    rnd = random.Random(20261012)
    alfabeto = "0123456789" * 3 + "kK.- " + "ABRTZñ·\t"
    return ["".join(rnd.choice(alfabeto) for _ in range(rnd.randint(0, 14))) for _ in range(n)]


async def test_paridad_normalizador_python_y_base(conexion_revertida):
    entradas = [r for r, _ in RUT_CASES] + [p for p, _ in PLATE_CASES] + _generadas()
    filas = await conexion_revertida.fetch(
        "SELECT x.v, public.canonical_rut(x.v) AS rut, public.canonical_plate(x.v) AS plate "
        "FROM unnest($1::text[]) WITH ORDINALITY AS x(v, n) ORDER BY x.n", entradas)
    distintos = [(f["v"], f["rut"], canonical_rut(f["v"]), f["plate"], canonical_plate(f["v"]))
                 for f in filas if (f["rut"], f["plate"]) != (canonical_rut(f["v"]), canonical_plate(f["v"]))]
    assert len(filas) == len(entradas)
    assert distintos == []
    # Sin casos válidos la paridad pasaría por vacío.
    assert sum(f["rut"] is not None for f in filas) >= 10 and sum(f["plate"] is not None for f in filas) >= 5


async def _empresa(conn, tax_id: str) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) VALUES ($1, $2, 'ACTIVE') RETURNING id",
        f"ZZ-TEST-D1 Identidad {uuid.uuid4().hex[:6]}", tax_id))


async def _ids_de_carriers(pool, q: str) -> set[str]:
    # Si la T5 cambió la firma de list_carriers, se adapta la llamada, no la aserción.
    res = await list_carriers(q=q, operational_status="", health="", page=1, limit=100, pool=pool, _=None)
    return {str(r["id"]) for r in res["data"]}


async def test_rut_con_y_sin_puntos_encuentra_la_misma_empresa(conexion_revertida):
    """Review Focus 5: mismo resultado en /carriers?q, /buscar, match_document y
    match_owner, con el RUT guardado con puntos y buscado sin puntos, y al revés."""
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    con_puntos = await _empresa(conn, "10.000.013-K")      # guardado no canónico
    canonica = await _empresa(conn, "10000027-K")           # guardado canónico

    for q, esperada in [("10000013-K", con_puntos), ("10000013k", con_puntos),
                        ("10.000.027-k", canonica), ("10000027", canonica)]:
        assert esperada in await _ids_de_carriers(pool, q), f"/carriers?q={q}"
        buscar = await buscar_en_el_directorio(q=q, limit=50, pool=pool, _=None)
        assert esperada in {str(e["id"]) for e in buscar["empresas"]}, f"/buscar?q={q}"

    catalogo = Catalog(aliases=[RequirementAlias("r-f30", "CARRIER", "F30", 100)])
    for tax_id, archivo, esperada in [("10.000.013-K", "F30 10000013k.pdf", con_puntos),
                                      ("10000027-K", "F30 10.000.027-K.pdf", canonica)]:
        universo = EntityUniverse(carriers=[(esperada, tax_id, "ZZ")])
        assert [c.entity_id for c in match_document(file_name=archivo, catalog=catalogo, universe=universo)] == [esperada]
        assert [c.record_id for c in match_owner(archivo, [PendingOwner("r", "CARRIER", "ZZ", tax_id, "ZZ")])] == ["r"]


async def test_rut_de_conductor_con_puntos_en_drivers(conexion_revertida):
    conn = conexion_revertida
    driver = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ($1, '10000004-0', 'ACTIVE') RETURNING id",
        f"ZZ-TEST-D1 Conductor {uuid.uuid4().hex[:6]}"))
    filas = await list_drivers(q="10.000.004-0", limit=50, pool=PoolDeUnaConexion(conn), _=None)
    assert driver in {str(r["driver_id"]) for r in filas}


async def test_patente_con_guion_en_buscar(conexion_revertida):
    conn = conexion_revertida
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id", plate))
    q = f"{plate[:4]}-{plate[4:]}".lower()
    r = await buscar_en_el_directorio(q=q, limit=50, pool=PoolDeUnaConexion(conn), _=None)
    assert asset in {str(v["id"]) for v in r["vehiculos"]}


async def test_un_texto_con_letras_no_busca_por_rut(conexion_revertida):
    """C-R12: "Transportes 2000" no puede traer a cada empresa cuyo RUT contenga 2000."""
    conn = conexion_revertida
    cid = await _empresa(conn, "12000000-4")   # DV válido (rut_check_digit("12000000") == "4")
    pool = PoolDeUnaConexion(conn)
    assert cid not in await _ids_de_carriers(pool, "ZZQQ 2000")
    # Sin letras, la clave sí busca: si esto falla, la exclusión de arriba pasaba por vacío.
    assert cid in await _ids_de_carriers(pool, "2000000")
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_identity.py tests/test_identity_integration.py -q`
Expected: FAIL en la colección con `ModuleNotFoundError: No module named 'app.utils.identity'`. Es el RED correcto: el normalizador es nuevo.

Para ver el RED de los buscadores con el código de hoy, crear un `identity.py` mínimo con solo `canonical_rut` y `canonical_plate` (Step 4, primera parte) y volver a correr. Tienen que fallar:
- `test_rut_con_y_sin_puntos_encuentra_la_misma_empresa`, en `/carriers?q=10.000.027-k`: el `ILIKE` literal no encuentra la forma canónica;
- `test_match_document_encuentra_la_empresa_con_rut_guardado_con_puntos`: `tax_id != rut`;
- `test_match_document_reconoce_la_patente_con_guion`: la patente se busca como un solo token;
- `test_rut_de_conductor_con_puntos_en_drivers`;
- `test_patente_con_guion_en_buscar`.

`test_paridad_normalizador_python_y_base` tiene que pasar desde ese momento. Si no pasa, el normalizador está mal y se corrige antes de seguir.

- [ ] **Step 4: Implement `app/utils/identity.py`**

```python
"""Identidad de RUT y patente: una sola forma, igual en Python y en la base.

La definición son las funciones de Postgres public.canonical_rut y
public.canonical_plate (migración 20260817120000_identidad_canonica.sql). Este
módulo las espeja para el motor de match, que es puro y no toca la base. La
paridad caso por caso la prueba test_identity_integration.py: si alguien
cambia una de las dos mitades, ese test se pone rojo.

  RUT      NNNNNNNN-D  cuerpo de 7 u 8 dígitos (8 o 9 caracteres con DV), DV por
                       módulo 11; uno inválido es None, nunca se le inventa el DV.
  Patente  AAAA99      exactamente 6 alfanuméricos; fuera guiones, espacios y adornos.

Los buscadores comparan en SQL con rut_matches_sql/plate_matches_sql: la
igualdad canónica y, para buscar con un pedazo, la clave del texto (C-R12).
carriers.tax_id NO es canónico por construcción (no tiene CHECK): por eso
siempre se compara con canonical_rut(columna). Normalizar lo guardado es D3."""
from __future__ import annotations

import re

_NOT_RUT_CHAR = re.compile(r"[^0-9kK]")
_NOT_PLATE_CHAR = re.compile(r"[^A-Za-z0-9]")
_ASCII_DIGITS = re.compile(r"[0-9]+")
_PLATE = re.compile(r"[A-Z0-9]{6}")

RUT_SEARCH_MIN = 4
PLATE_SEARCH_MIN = 2


def rut_check_digit(body: str) -> str:
    """Dígito verificador chileno (módulo 11) del cuerpo, sin puntos ni guion."""
    total, multiplier = 0, 2
    for digit in reversed(body):
        total += int(digit) * multiplier
        multiplier = 2 if multiplier == 7 else multiplier + 1
    remainder = 11 - (total % 11)
    return "0" if remainder == 11 else "K" if remainder == 10 else str(remainder)


def canonical_rut(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = _NOT_RUT_CHAR.sub("", value).upper()
    if not 8 <= len(stripped) <= 9:
        return None
    body, dv = stripped[:-1], stripped[-1]
    if not _ASCII_DIGITS.fullmatch(body):   # la K solo puede ser DV
        return None
    if rut_check_digit(body) != dv:
        return None
    return f"{body}-{dv}"


def canonical_plate(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = _NOT_PLATE_CHAR.sub("", value).upper()
    return stripped if _PLATE.fullmatch(stripped) else None


def plate_in_tokens(plate: str | None, tokens: list[str]) -> bool:
    """La patente aparece como tokens CONTIGUOS completos: 'BBCL-23', 'BBCL 23'
    y 'bbcl23' son BBCL23. Unir solo tokens enteros evita encontrarla dentro
    de una secuencia más larga ('XBBCL234')."""
    canon = canonical_plate(plate)
    if canon is None:
        return False
    for i in range(len(tokens)):
        joined = ""
        for token in tokens[i:]:
            joined += token.upper()
            if len(joined) >= len(canon):
                break
        if joined == canon:
            return True
    return False


def _rut_key_sql(expr: str) -> str:
    return f"upper(regexp_replace({expr}, '[^0-9kK]', '', 'g'))"


def _plate_key_sql(expr: str) -> str:
    return f"upper(regexp_replace({expr}, '[^A-Za-z0-9]', '', 'g'))"


def rut_matches_sql(column: str, param: str) -> str:
    """El RUT de `column` calza con el texto buscado `param` (placeholder $n):
    igual en forma canónica, o contiene la clave buscada (búsqueda con un
    pedazo). La clave solo aplica si el texto no trae letras distintas de K y
    tiene al menos RUT_SEARCH_MIN caracteres: 'Transportes 2000' no busca RUT."""
    p = f"{param}::text"
    key = _rut_key_sql(p)
    return (f"(public.canonical_rut({column}) = public.canonical_rut({p}) "
            f"OR ({p} !~ '[A-JL-Za-jl-z]' AND length({key}) >= {RUT_SEARCH_MIN} "
            f"AND {_rut_key_sql(column)} LIKE '%' || {key} || '%'))")


def plate_matches_sql(column: str, param: str) -> str:
    """La patente de `column` calza con el texto buscado: igual en forma
    canónica, o contiene la clave alfanumérica (mínimo PLATE_SEARCH_MIN)."""
    p = f"{param}::text"
    key = _plate_key_sql(p)
    return (f"(public.canonical_plate({column}) = public.canonical_plate({p}) "
            f"OR (length({key}) >= {PLATE_SEARCH_MIN} AND {_plate_key_sql(column)} LIKE '%' || {key} || '%'))")
```

- [ ] **Step 5: El motor de match (`document_matcher.py`)**

- Import: `from ..utils.identity import canonical_plate, canonical_rut, plate_in_tokens`. Borrar `rut_dv` y `_plate_in_tokens`; ningún otro módulo los importa (verificado con grep el 12/10).
- `extract_ruts`:
  ```python
      found = []
      for raw_digits, raw_dv in _RUT_RE.findall(file_name):
          canon = canonical_rut(f"{raw_digits}-{raw_dv}")
          if canon:
              found.append(canon)
      return found
  ```
  Se mantiene el docstring: el DV inválido se descarta, y ahora también lo que la base no acepta como RUT.
- `_from_manifest`: comparar con una función local en lugar de `normalize_text(...) != identifier`:
  ```python
  def _same_identifier(entity_type: str, stored, declared: str) -> bool:
      """RUT o patente en forma canónica cuando las dos lo son; si no, el texto normalizado de siempre."""
      canon = canonical_plate if entity_type == "ASSET" else canonical_rut
      a, b = canon(str(stored or "")), canon(declared)
      if a is not None and b is not None:
          return a == b
      return normalize_text(str(stored or "")) == normalize_text(declared)
  ```
  Llamarla con el `identificador` crudo (`str(row.get("identificador") or "")`). El corte por identificador vacío queda igual.
- `match_document`:
  - en las dos ramas de RUT, `if tax_id != rut:` pasa a `if canonical_rut(tax_id) != rut:`;
  - en la rama difusa, `if tax_id and tax_id in ruts:` pasa a `if canonical_rut(tax_id) in ruts:`;
  - en la rama de patente, `name_tokens = set(normalized.split())` y `plate not in name_tokens` pasan a `token_list = normalized.split()` y `if not plate_in_tokens(license_plate, token_list): continue`.
- `match_owner`: `if o.tax_id and o.tax_id in ruts:` pasa a `if canonical_rut(o.tax_id) in ruts:`, y `_plate_in_tokens(o.label, token_list)` pasa a `plate_in_tokens(o.label, token_list)`.

- [ ] **Step 6: Los buscadores**

Import en cada router: `from ..utils.identity import plate_matches_sql, rut_matches_sql`.
- `carriers.py`, `list_carriers` (sobre la versión de la T5): `clauses.append(f"(c.business_name ILIKE '%' || ${n} || '%' OR {rut_matches_sql('c.tax_id', f'${n}')})")`, con `n = len(params)`.
- `carriers.py:217` (`insurance-overview`): lo mismo con `q_params`.
- `/buscar`:
  ```python
  _SQL_BUSCAR_EMPRESAS = f"""
  SELECT c.id, c.business_name, c.tax_id, c.operational_status
  FROM public.carriers c
  WHERE c.business_name ILIKE '%' || $1 || '%'
     OR {rut_matches_sql('c.tax_id', '$1')}
  ORDER BY (c.operational_status = 'ACTIVE') DESC, c.business_name
  LIMIT $2
  """
  ```
  Igual para conductores (`d.tax_id`). Vehículos: `WHERE {plate_matches_sql('a.license_plate', '$1')}`.
  Se actualiza el comentario de `:393-395`: la comparación ahora es `canonical_rut(c.tax_id) = canonical_rut($1)`. Antes era `c.tax_id = canonical_rut($1)`, que no encontraba un `tax_id` guardado con puntos.
- `drivers.py`, `list_drivers` (sobre la versión de la T7): `AND (d.full_name ILIKE '%'||$1||'%' OR {rut_matches_sql('d.tax_id', '$1')})`. El SQL pasa a f-string; los `%` literales no cambian en una f-string.
- `drivers.py`, `fuzzy_match_drivers`: el RUT que el TMS adjunta ("NOMBRE / 12345678-9") hoy se descarta al limpiar. Ahora se conserva con `rut = canonical_rut(re.search(r"/\s*([\w.-]+)$", name.strip()).group(1)) if "/" in name else None` (o equivalente) y se pasa como `$4`. El `WHERE` queda `AND (similarity(upper(d.full_name), upper($1)) >= $2 OR d.tax_id = $4::text)`, y el `ORDER BY` queda `(d.tax_id = $4::text) DESC NULLS LAST, similarity DESC`. Un RUT exacto va primero: es un identificador fuerte, el mismo criterio de `match_owner`.
- `compliance.py:631` (`q` de `/pending`):
  ```
  AND ($4::text IS NULL OR c.business_name ILIKE '%' || $4 || '%' OR r.subject_name ILIKE '%' || $4 || '%'
       OR {rut_matches_sql('c.tax_id', '$4')}
       OR (r.entity_type = 'ASSET' AND {plate_matches_sql('r.subject_name', '$4')}))
  ```
  Si `_PENDING_ROWS_SQL` no es f-string en ese tramo, se interpola con la misma técnica que ya usa para `_pending_ctes`.
- `trips.py`, `_activo_de_la_patente`:
  ```python
      patente = (patente or "").strip().upper() or None
      if patente:
          encontrado = await conn.fetchval(
              "SELECT id::text FROM public.assets WHERE license_plate = public.canonical_plate($1) LIMIT 1", patente)
          # 'AB-CD12' encuentra ABCD12 y se guarda canónica; una patente fuera del
          # directorio se guarda como se escribió (test_una_patente_fuera_del_directorio…).
          return encontrado, canonical_plate(patente) or patente
  ```
  (import de `canonical_plate`).

Agregar a `tests/test_identity_integration.py`:

```python
async def test_la_patente_con_guion_vincula_el_equipo(conexion_revertida):
    from app.routers.trips import _activo_de_la_patente
    conn = conexion_revertida
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id", plate))
    assert await _activo_de_la_patente(conn, f"{plate[:4]}-{plate[4:]}", None) == (asset, plate)
```

- [ ] **Step 7: Run the tests**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_identity.py tests/test_identity_integration.py tests/test_document_matcher.py tests/test_match_owner.py tests/test_matcher_io.py tests/test_document_ingest.py tests/test_document_ingest_integracion.py tests/test_integracion_certificacion.py tests/test_carriers.py tests/test_drivers.py tests/test_carrier_status_in_fleet_reads_integration.py tests/test_asignar_conductor.py tests/test_pending_compliance.py -q`

(Si `tests/test_pending_compliance.py` no existe con ese nombre, se usan los tests de `/pending` que encuentre `grep -l "pending_rows\|/pending" tests/`.)

Expected: PASS. Los tests viejos del matcher pasan sin cambios: con RUT y patente canónicos, el resultado es el mismo.

- [ ] **Step 8: Verificar que la mutación mata el test**

Restaurar cada una:
- (a) En `match_document`, volver la rama de empresa a `if tax_id != rut:`. Tiene que fallar `test_match_document_encuentra_la_empresa_con_rut_guardado_con_puntos` y la parte de `match_document` de `test_rut_con_y_sin_puntos_encuentra_la_misma_empresa`.
- (b) En `canonical_rut`, cambiar `if not 8 <= len(stripped) <= 9` por `if not 7 <= len(stripped) <= 9`. Tiene que fallar `test_paridad_normalizador_python_y_base`: las cadenas generadas de 7 caracteres difieren de la base.
- (c) En `/buscar`, volver `_SQL_BUSCAR_VEHICULOS` a `a.license_plate ILIKE '%' || $1 || '%'`. Tiene que fallar `test_patente_con_guion_en_buscar`.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/backend/api/app/utils/identity.py monitor-app/backend/api/app/services/document_matcher.py \
  monitor-app/backend/api/app/routers/carriers.py monitor-app/backend/api/app/routers/drivers.py \
  monitor-app/backend/api/app/routers/compliance.py monitor-app/backend/api/app/routers/trips.py \
  monitor-app/backend/api/tests/test_identity.py monitor-app/backend/api/tests/test_identity_integration.py
git commit -m "feat(identidad): RUT y patente canónicos en buscadores y en el motor de match

Un normalizador en Python (app/utils/identity.py) con paridad probada contra
public.canonical_rut y public.canonical_plate. /carriers?q, /buscar, /drivers?q,
/fuzzy-match, /pending?q, insurance-overview, match_document y match_owner
comparan en forma canónica; un RUT con puntos o una patente con guion
encuentran lo mismo (D1 §7.2, Review Focus 5, C-R12).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Guardas, rendimiento, suite completa y despliegue 1

**Files:**
- Create: `monitor-app/backend/api/tests/test_d1_single_definition_guards.py`
- Apply: `monitor-app/backend/supabase/migrations/20261013090000_directory_one_answer.sql` (de la T2)
- Modify: `docs/superpowers/plans/2026-10-12-directory-d1-rulings.md` (C-R17), `AGENTLOG.md`

En el despliegue 1 no se toca el frontend.

- [ ] **Step 1: Write the guard tests**

Patrón de `tests/test_trip_flags_single_definition.py`: mira el código, sin base. Recorre las cadenas SQL de `app/` con `ast`, incluidas las f-strings, cada una contada una sola vez. Crear `tests/test_d1_single_definition_guards.py`:

```python
"""Una sola definición para las preguntas de D1 (spec §8.5): flota activa,
estado del documento, habilitación, resumen e identidad. Fuera de los dueños
(services/vencimientos.py, services/fleet_compliance.py, utils/identity.py y la
migración 20261013090000), nadie las escribe a mano.

Mientras duren los despliegues 1 y 2, los lectores viejos conviven con los
nuevos (expandir/contraer, §9). Por eso cada regla tiene un TOPE por archivo
que solo puede bajar (C-R14), igual que los trinquetes visuales. La Task 16
los lleva a 0. Si un número de acá sube, alguien volvió a escribir la regla."""
from __future__ import annotations

import ast
import re
from collections import Counter
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
OWNERS = {"services/vencimientos.py", "services/fleet_compliance.py", "utils/identity.py"}


def _sql_strings(path: Path):
    """Cada literal de texto del archivo una sola vez: una f-string cuenta
    entera (sus huecos como {}), no además cada pedazo."""
    tree = ast.parse(path.read_text())
    inner = {id(v) for n in ast.walk(tree) if isinstance(n, ast.JoinedStr) for v in n.values}
    for node in ast.walk(tree):
        if id(node) in inner:
            continue
        if isinstance(node, ast.JoinedStr):
            yield "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value


def _count(rule) -> Counter:
    out = Counter()
    for path in APP.rglob("*.py"):
        rel = str(path.relative_to(APP))
        for s in _sql_strings(path):
            out[rel] += rule(s)
    return Counter({k: v for k, v in out.items() if v})


# ── Las reglas ────────────────────────────────────────────────────────────────
# Flota activa escrita a mano: una misma consulta que mira conductores o
# equipos activos Y su asignación ACTIVE. La definición es app.active_fleet.
_FLEET_TABLE = re.compile(r"public\.(drivers|assets)\b")
_FLEET_ROW = re.compile(r"\b\w+\.operational_status\s*=\s*'ACTIVE'")
_ASSIGN_ACTIVE = re.compile(r"(driver|asset)_assignments\b.*?\bstatus\s*=\s*'ACTIVE'", re.S)


def active_fleet(s: str) -> int:
    return int(bool(_FLEET_TABLE.search(s) and _FLEET_ROW.search(s) and _ASSIGN_ACTIVE.search(s)))


def document_state(s: str) -> int:      # clasificar un registro en un estado
    return len(re.findall(r"THEN\s+'(OVERDUE|EXPIRING|MISSING|UP_TO_DATE)'", s))


def compliance_health(s: str) -> int:   # el resumen viejo, que se retira en la T16
    return len(re.findall(r"\bAS\s+compliance_health\b", s))


def mandatory_blocking(s: str) -> int:  # "qué obligatorio bloquea" escrito fuera del módulo
    return len(re.findall(r"requirement_level\s*=\s*'LEGAL_MANDATORY'", s))


# Empresa de un conductor o equipo atribuida a mano: un JOIN a su asignación
# ACTIVE y a carriers. La definición es app.carrier_of.
_ATTR_JOIN = re.compile(r"JOIN\s+public\.(driver|asset)_assignments\s+\w+\s+ON[^;]*?status\s*=\s*'ACTIVE'", re.S | re.I)


def carrier_attribution(s: str) -> int:
    return int(bool(_ATTR_JOIN.search(s) and re.search(r"JOIN\s+public\.carriers\b", s, re.I)))


def can_operate_computed(s: str) -> int:
    return len(re.findall(r"\bAS\s+can_operate\b", s))


def plate_trim(s: str) -> int:          # patente comparada sin canonical_plate
    return len(re.findall(r"upper\(\s*trim\(\s*(\w+\.)?license_plate", s, re.I))


def tax_id_like(s: str) -> int:         # RUT buscado sin canonical_rut
    return len(re.findall(r"\btax_id\s+I?LIKE\b", s, re.I))


# ── Los topes ─────────────────────────────────────────────────────────────────
# Medidos al cerrar la Task 9 (ver Step 2). Solo pueden bajar. La columna
# "T16" dice a cuánto los lleva la contracción.
CEILINGS: dict[str, dict[str, int]] = {
    "active_fleet": {
        # COMPLETAR en el Step 2 con el conteo real. Referencia del 12/10, antes de las T5-T7:
        # routers/carriers.py 3, routers/drivers.py 2, routers/status_report.py 1, routers/trips.py 6,
        # services/driver_roster.py 1, services/cierre_lineas.py 1, services/fleet_driver_gap.py 1,
        # services/pre_cierre.py 2, services/plantilla_certificacion.py 1, services/vencimientos.py 1.
    },
    "compliance_health": {"routers/carriers.py": 3},              # T16 → 0
    "mandatory_blocking": {"routers/carriers.py": 3, "routers/compliance.py": 1, "routers/trips.py": 2},  # T16 → 0
    "plate_trim": {"services/pre_cierre.py": 3},                  # D3 (C-R13); el Cierre no se toca
    "carrier_attribution": {
        # COMPLETAR en el Step 2. Referencia del 12/10, antes de las T5-T7:
        # routers/carriers.py 3, routers/drivers.py 3, routers/status_report.py 1, routers/assets.py 1,
        # routers/equipment_closures.py 1, routers/trips.py 6, services/driver_roster.py 1,
        # services/cierre_lineas.py 2, services/pre_cierre.py 2, services/plantilla_certificacion.py 1,
        # services/vencimientos.py 1 (dueño), services/entity_summary.py 2 (la T6 lo baja a 0).
        "routers/daily_closures.py": 2,   # diferido a D2: carrier_of recibe la fecha y lee el historial
    },
}
# La tupla FUNNEL_ACTIVE_STATUSES = ("ACTIVE", "ONBOARDING") se queda (C-R15): no es un predicado
# duplicado y ninguna regla de acá la cuenta.
ZERO_OUTSIDE_OWNERS = {"document_state": document_state, "can_operate_computed": can_operate_computed,
                       "tax_id_like": tax_id_like}
RATCHETED = {"active_fleet": active_fleet, "compliance_health": compliance_health,
             "mandatory_blocking": mandatory_blocking, "plate_trim": plate_trim,
             "carrier_attribution": carrier_attribution}


def test_las_reglas_con_tope_no_crecen():
    for name, rule in RATCHETED.items():
        got = {k: v for k, v in _count(rule).items() if k not in OWNERS}
        tope = CEILINGS[name]
        sobran = {k: (v, tope.get(k, 0)) for k, v in got.items() if v > tope.get(k, 0)}
        assert not sobran, f"{name}: (encontrado, tope) {sobran}. La regla vive en su dueño; no se reescribe."


def test_los_topes_bajan_cuando_se_contrae():
    """Un tope más alto que lo que hay deja espacio para que la regla vuelva sin
    que nadie lo note: cuando un lector se migra, su tope baja en el mismo commit."""
    for name, rule in RATCHETED.items():
        got = _count(rule)
        holgura = {k: (t, got.get(k, 0)) for k, t in CEILINGS[name].items() if t > got.get(k, 0)}
        assert not holgura, f"{name}: bajar el tope (tope, real) {holgura}"


def test_estado_habilitacion_e_identidad_solo_en_sus_duenos():
    for name, rule in ZERO_OUTSIDE_OWNERS.items():
        fuera = {k: v for k, v in _count(rule).items() if k not in OWNERS}
        assert not fuera, f"{name} escrito fuera de su dueño: {fuera}"


def test_la_guarda_ve_lo_que_dice_ver():
    """Sin esto, una expresión regular rota dejaría pasar todo en verde."""
    assert document_state(Path(APP / "services" / "vencimientos.py").read_text()) >= 3
    assert active_fleet("JOIN public.drivers d JOIN public.driver_assignments da ON da.status = 'ACTIVE' "
                        "WHERE d.operational_status = 'ACTIVE'") == 1
    assert tax_id_like("WHERE c.tax_id ILIKE '%' || $1") == 1
    assert _count(can_operate_computed).get("services/fleet_compliance.py", 0) >= 1
```

El último `assert` supone que `fleet_compliance.py` calcula `... AS can_operate`, como dice el contrato de la T4. Si la T4 lo nombra distinto, se ajusta la expresión de la regla, no la aserción.

La lista de lo que la T16 contrae, para el implementador de esa tarea:
- `compliance_health` (`carriers.py`);
- `mandatory_blocking` (`_CARRIER_LIST_AGG`, `_pending_mandatory_join`, `compliance.py` y la lateral vieja de `trips.py:620`, reemplazada por los campos por entidad del Monitor: `driver_has_critical_alert`, `tractor_has_critical_alert`, `carrier_has_critical_alert`, `carrier_can_operate`);
- el tope de `active_fleet` de cada lector que quedó en el Directorio, la vista rápida, el roster y el Monitor.

Se quedan con tope y fuera de D1:
- `plate_trim` de `pre_cierre.py` (D3);
- `carrier_attribution` de `daily_closures.py` (D2: `carrier_of` con fecha);
- `active_fleet` y `carrier_attribution` de `pre_cierre.py`, `cierre_lineas.py` y `driver_roster.py` si la T5/T7 no los migró (el Cierre no se toca).

- [ ] **Step 2: Medir los topes y correr las guardas**

Run (scratchpad, no se commitea):

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
from tests.test_d1_single_definition_guards import RATCHETED, ZERO_OUTSIDE_OWNERS, _count
for name, rule in {**RATCHETED, **ZERO_OUTSIDE_OWNERS}.items():
    print(name, dict(_count(rule)))
EOF
```

Copiar los conteos de `active_fleet`, `compliance_health`, `mandatory_blocking`, `plate_trim` y `carrier_attribution` a `CEILINGS`, sin los dueños. `routers/daily_closures.py` queda en `carrier_attribution` con el motivo "D2". Cada número tiene que ser **menor o igual** a la referencia del 12/10 que está en el comentario: las T5-T9 solo migran lectores, no agregan.
- Si un número sube, es una regresión de alguna tarea anterior y se reporta. No se sube el tope.
- `tax_id_like` tiene que dar 0 después de la T9.
- `routers/trips.py` sale de `plate_trim` por la T9.

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_d1_single_definition_guards.py -q`
Expected: PASS.

Verificar que la guarda mata: agregar temporalmente a `carriers.py` un `_X = "SELECT 1 WHERE c.tax_id ILIKE '%'"` → `test_estado_habilitacion_e_identidad_solo_en_sus_duenos` FAIL; quitarlo.

- [ ] **Step 3: Rendimiento con `EXPLAIN ANALYZE` sobre la base real (solo lectura)**

Las consultas se capturan llamando a los endpoints reales con un pool que, para cada consulta, corre antes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` con los mismos parámetros. Así se mide el SQL que de verdad arma el código, con parámetros (`$n`) y no con literales. Script en el scratchpad:

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio, json
import asyncpg
from tests.conftest import credenciales_integracion, PoolDeUnaConexion
from app.routers.carriers import list_carriers
from app.routers.compliance import get_certification_status
from app.services.assignment_guard import AssignmentSubjects, check_assignments
from tests.d1_subjects import apply_fleet_facts

class ExplainingPool(PoolDeUnaConexion):
    def __init__(self, conn):
        super().__init__(conn)
        self.plans = []
    async def _explain(self, sql, args):
        plan = json.loads(await self._conn.fetchval(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}", *args))[0]
        self.plans.append((" ".join(sql.split())[:70], round(plan["Execution Time"], 1)))
    async def fetch(self, sql, *a):    await self._explain(sql, a); return await self._conn.fetch(sql, *a)
    async def fetchrow(self, sql, *a): await self._explain(sql, a); return await self._conn.fetchrow(sql, *a)
    async def fetchval(self, sql, *a): await self._explain(sql, a); return await self._conn.fetchval(sql, *a)

async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        # La migración se aplica recién en el Step 8: los hechos de la flota se
        # crean dentro de esta transacción, que termina siempre en ROLLBACK (no
        # puede ser READ ONLY porque crea la vista y las funciones).
        await c.execute("BEGIN")
        await apply_fleet_facts(c)
        for etiqueta, llamada in [
            ("directorio", lambda p: list_carriers(q="", operational_status="", health="", page=1, limit=100, pool=p, _=None)),
            ("embudo", lambda p: get_certification_status(group="carrier", scope="active", carrier_id=None, q="",
                                                          limit=500, pool=p, _=None)),
        ]:
            for _ in range(2):          # la primera calienta la caché; se reporta la segunda
                p = ExplainingPool(c)
                await llamada(p)
            for sql, ms in p.plans:
                print(etiqueta, ms, "ms ·", sql)
        activa = await c.fetchval("SELECT id::text FROM public.carriers WHERE operational_status = 'ACTIVE' ORDER BY id LIMIT 1")
        p = ExplainingPool(c)
        await check_assignments(p, [AssignmentSubjects(carrier_id=activa)])
        for sql, ms in p.plans:
            print("guarda", ms, "ms ·", sql)
    finally:
        await c.execute("ROLLBACK")
        await c.close()
asyncio.run(main())
EOF
```

`check_assignments` llama a `conn.fetch`, y `ExplainingPool.fetch` lo intercepta. Por eso se le pasa el pool como si fuera la conexión.

Expected (spec §5.3):
- la consulta principal de filas del Directorio y la del embudo, **< 300 ms** de `Execution Time` cada una (referencia: el resumen de Pendientes, ~210 ms);
- el conteo y las facetas del Directorio se reportan, también bajo 300;
- la segunda consulta de la guarda (`carrier_compliance` filtrada por id) se reporta: es una escritura rara, pero si pasa de 300 ms se anota en el ledger.

Si el Directorio o el embudo pasan de 300 ms, no se despliega. Se vuelve a la T4/T5 con el plan (nodo más caro, `Buffers`). La salida de §5.1 ya prevista es leer una proyección sin cambiar a quien llama. Se anotan las cifras en el ledger.

- [ ] **Step 4: Ronda de mutación registrada (spec §8.4)**

Tres mutaciones, una a la vez. Cada una se corre, se ve en rojo, se restaura y se anota en el ledger (`docs/superpowers/plans/2026-10-12-directory-d1-rulings.md`, sección "Mutación del despliegue 1"):
1. **Por vencer bloquea la habilitación.** En `fleet_compliance.py`, en el predicado de `can_operate`, el conjunto de estados que bloquean pasa de `('OVERDUE','MISSING')` a `('OVERDUE','MISSING','EXPIRING')`. Si el SQL lo arma desde `BLOCKING_STATES` de `app/schemas/states.py`, se muta ese uso en `fleet_compliance.py`, nunca la constante compartida.
   Run: `venv/bin/python -m pytest tests/test_fleet_compliance_integration.py tests/test_d1_equivalence_integration.py tests/test_assignment_guard_integration.py -q` (si el archivo de la T4 tiene otro nombre, el que creó la T4).
   Expected: rojo al menos el test de la T4 que fija que por vencer no bloquea. Se anota cuáles fallaron.
2. **El lote escribe a medias.** La mutación (a) del Step 9 de la Task 8. Expected: `test_bulk_con_un_conductor_de_baja_no_escribe_nada` en rojo.
3. **RUT sin canonizar.** La mutación (a) del Step 8 de la Task 9. Expected: `test_rut_con_y_sin_puntos_encuentra_la_misma_empresa` en rojo.

Si una mutación deja todo verde, el test no protege. Se corrige el test en su tarea, se reporta y se repite.

- [ ] **Step 5: Suite completa del backend (una vez, primer plano)**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/ -q`

Siempre en primer plano: cortar una corrida a mitad deja conexiones del pooler tomadas. Nunca con `--padron-completo`. Dura unos 35 minutos.

Expected: verde. La roja conocida `test_cargar_catalogo_webcarga::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar` no es de este cambio: se anota y no se toca. Cualquier otra roja se diagnostica antes de seguir. Si es un test que elige un sujeto de producción que ahora la guarda rechaza (Task 8, Step 7), se convierte a `make_test_fleet` sin aflojar la aserción.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/tests/test_d1_single_definition_guards.py docs/superpowers/plans/2026-10-12-directory-d1-rulings.md
git commit -m "test(d1): guardas de definición única con topes y ronda de mutación

Flota activa, estado del documento, habilitación, resumen e identidad solo en
vencimientos.py, fleet_compliance.py e identity.py; los lectores viejos con un
tope que solo baja hasta la contracción (C-R14). EXPLAIN ANALYZE y mutaciones
registrados en el ledger.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Ensayar la migración con ROLLBACK (MCP de Supabase)**

Con `mcp__claude_ai_Supabase__execute_sql(project_id="viclzoftiudkepqnhekv", query=…)`, como en el bloque 0. No con `psql`: el clasificador bloquea escrituras a producción por `psql`, y con razón.

Primero `grep -nE '^\s*(BEGIN|COMMIT)\s*;' monitor-app/backend/supabase/migrations/20261013090000_directory_one_answer.sql` tiene que dar vacío (C-R18). El archivo se pega **dos veces** para probar que es re-ejecutable. Las verificaciones van en un `DO` que levanta excepción si algo no cumple: el ensayo pasa si la llamada termina sin error, aunque la herramienta solo devuelva el último resultado.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE d1_cmt_before ON COMMIT DROP AS
    SELECT id, public.carrier_management_types(id) AS t FROM public.carriers;
-- contenido completo de 20261013090000_directory_one_answer.sql
-- contenido completo de 20261013090000_directory_one_answer.sql (otra vez: re-ejecutable)
DO $$
DECLARE r record; v_driver uuid; v_carrier uuid;
BEGIN
  -- CHECK presentes y validados
  IF (SELECT count(*) FROM pg_constraint WHERE convalidated AND conname IN
        ('carriers_operational_status_check','drivers_operational_status_check','assets_operational_status_check')) <> 3
  THEN RAISE EXCEPTION 'faltan CHECK de operational_status o no están validados'; END IF;
  -- el CHECK rechaza lo que debe
  BEGIN
    UPDATE public.drivers SET operational_status = 'LEGACY_INACTIVE'
     WHERE id = (SELECT id FROM public.drivers ORDER BY id LIMIT 1);
    RAISE EXCEPTION 'drivers aceptó LEGACY_INACTIVE';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- carrier_management_types no cambia para ninguna empresa (spec §4.3)
  IF EXISTS (SELECT 1 FROM d1_cmt_before b
             WHERE b.t IS DISTINCT FROM public.carrier_management_types(b.id))
  THEN RAISE EXCEPTION 'carrier_management_types cambió para alguna empresa'; END IF;
  -- carrier_of
  SELECT id INTO v_carrier FROM public.carriers ORDER BY id LIMIT 1;
  IF app.carrier_of('CARRIER', v_carrier) IS DISTINCT FROM v_carrier THEN RAISE EXCEPTION 'carrier_of CARRIER'; END IF;
  SELECT da.driver_id, da.carrier_id INTO v_driver, v_carrier
    FROM public.driver_assignments da WHERE da.status = 'ACTIVE' ORDER BY da.driver_id LIMIT 1;
  IF app.carrier_of('DRIVER', v_driver) IS DISTINCT FROM v_carrier THEN RAISE EXCEPTION 'carrier_of DRIVER'; END IF;
  IF app.carrier_of('OTRO', v_driver) IS NOT NULL THEN RAISE EXCEPTION 'carrier_of con tipo desconocido'; END IF;
  -- active_fleet: 78 conductores de empresas activas (D1-R3; medido el 12/10)
  RAISE NOTICE 'active_fleet: % conductores, % equipos, % conductores de empresas activas',
    (SELECT count(*) FROM app.active_fleet WHERE entity_type = 'DRIVER'),
    (SELECT count(*) FROM app.active_fleet WHERE entity_type = 'ASSET'),
    (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
       JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
      WHERE f.entity_type = 'DRIVER');
END $$;
SELECT (SELECT count(*) FROM app.active_fleet WHERE entity_type = 'DRIVER') AS af_drivers,
       (SELECT count(*) FROM app.active_fleet WHERE entity_type = 'ASSET') AS af_assets,
       (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
          JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
         WHERE f.entity_type = 'DRIVER') AS drivers_of_active_carriers;
ROLLBACK;
```

Expected:
- sin error;
- `af_drivers` del orden de 85, `af_assets` del orden de 130 y `drivers_of_active_carriers` = **78** (medidos el 12/10; pueden variar si alguien dio de baja o de alta flota entretanto: se anota la cifra del día).

Después, fuera de una transacción, confirmar que nada quedó: `SELECT to_regclass('app.active_fleet')` es NULL, y lo mismo con `to_regprocedure('app.carrier_of(text,uuid)')`.

- [ ] **Step 8: Elegir el momento y aplicar la migración**

Un momento tranquilo (memoria "desplegar con un job en vuelo deja el lock huérfano"):
- fuera de las ventanas de arranque de Mage: no entre :58–:02, :13–:17, :28–:32 ni :43–:47;
- sin un job de extracción en vuelo;
- sin transacciones largas.

Comprobar, con `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT (SELECT count(*) FROM ops.extraction_jobs WHERE status = 'running')                     AS extraction_running,
       (SELECT count(*) FROM pg_stat_activity
         WHERE backend_type = 'client backend' AND state <> 'idle' AND pid <> pg_backend_pid()
           AND xact_start < now() - interval '30 seconds')                                    AS long_transactions,
       (SELECT now() - max(updated_at) FROM app.trips)                                        AS since_last_trips_write;
```

y con `mcp__mage-agent__run_logs` (leer antes el recurso `skill://executions`) que la última corrida de `batch_tms_monitor_trips` terminó y no hay una en curso.

Expected:
- `extraction_running = 0`;
- `long_transactions = 0`;
- `since_last_trips_write` de más de un par de minutos, señal de que la corrida terminó;
- en Mage, ninguna corrida en curso ni en "0/0".

Si algo no cumple, esperar a la siguiente ventana.

Aplicar: `mcp__claude_ai_Supabase__apply_migration(project_id="viclzoftiudkepqnhekv", name="20261013090000_directory_one_answer", query="SET lock_timeout = '5s';\n" + <contenido del archivo>)`.

Si falla por `lock_timeout`, no se reintenta en caliente: se espera a la próxima ventana. La migración es re-ejecutable.

Verificar fuera de la transacción, con la consulta final del Step 7 sin `BEGIN`/`ROLLBACK`: las mismas cifras.

**La migración va antes del push:** la API nueva lee `app.active_fleet` y `app.carrier_of`.

- [ ] **Step 9: Push y workflow**

```bash
git push origin dev
gh run list --branch dev --limit 4
```

Esperar en primer plano a `Deploy Monitor API` (`gh run watch <id> --exit-status`). Expected: `success`.

`Deploy Frontend` no se dispara: no hay cambios en `monitor-app/frontend/**`. Si apareciera, es por otro commit, y se revisa qué entró.

Confirmar la revisión servida: `gcloud run services describe webcarga-monitor-api-dev --region us-central1 --project webcarga-dev-493220 --format='value(status.latestReadyRevisionName)'`. Tiene que ser una revisión creada después del push.

- [ ] **Step 10: Verificación en dev (solo lectura, sin PII)**

Se llama a los endpoints del código desplegado (el mismo commit) contra la base real, en una transacción de solo lectura. Se imprimen solo conteos y booleanos, nunca nombres ni RUT:

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
import asyncpg
from tests.conftest import credenciales_integracion, PoolDeUnaConexion
from app.routers.carriers import buscar_en_el_directorio, get_directorio, list_carriers
from app.routers.compliance import get_certification_status, pending_summary
from app.services.assignment_guard import AssignmentSubjects, check_assignments

async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        await c.execute("SET default_transaction_read_only = on")
        await c.execute("BEGIN READ ONLY")
        pool = PoolDeUnaConexion(c)
        filas, page = [], 1
        while True:
            r = await list_carriers(q="", operational_status="", health="", page=page, limit=100, pool=pool, _=None)
            filas += r["data"]
            if len(filas) >= r["count"]:
                break
            page += 1
        no_activas = [f for f in filas if f["operational_status"] != "ACTIVE"]
        activas = [f for f in filas if f["operational_status"] == "ACTIVE"]
        print("con compliance_summary:", sum("compliance_summary" in f for f in filas), "de", len(filas))
        print("no activas:", len(no_activas), "· ninguna habilitada:",
              all(not f["compliance_summary"]["can_operate"] for f in no_activas))
        print("activas:", len(activas), "· habilitadas:", sum(f["compliance_summary"]["can_operate"] for f in activas))
        print("conductores de la flota:", (await get_directorio(pool=pool, _=None))["flota"]["conductores"])
        emb = await get_certification_status(group="carrier", scope="active", carrier_id=None, q="", limit=500,
                                             pool=pool, _=None)
        pend = await pending_summary(group_by="carrier", pool=pool, _=None)
        print("embudo activas:", sum(x["pending_count"] for x in emb["rows"] if x["operational_status"] == "ACTIVE"),
              "· pendientes:", sum(x["overdue"] + x["expiring"] + x["missing"] for x in pend["rows"]),
              "· filas con funnel_bucket:", sum("funnel_bucket" in x for x in emb["rows"]), "de", len(emb["rows"]))
        baja = await c.fetchval("SELECT id::text FROM public.carriers WHERE operational_status <> 'ACTIVE' ORDER BY id LIMIT 1")
        (chk,) = await check_assignments(c, [AssignmentSubjects(carrier_id=baja)])
        print("guarda sobre una empresa no activa:", chk.blocking and chk.blocking["code"])
        tax = await c.fetchval("SELECT tax_id FROM public.carriers WHERE operational_status = 'ACTIVE' "
                               "AND public.canonical_rut(tax_id) IS NOT NULL ORDER BY id LIMIT 1")
        body, dv = tax.split("-")
        con_puntos = f"{int(body):,}".replace(",", ".") + "-" + dv.lower()
        r = await buscar_en_el_directorio(q=con_puntos, limit=10, pool=pool, _=None)
        print("RUT con puntos encuentra su empresa:", any(e["tax_id"] == tax for e in r["empresas"]))
    finally:
        await c.close()
asyncio.run(main())
EOF
```

Expected (spec §1; cifras del 12/10, se anota la del día):
- `con compliance_summary`: 251 de 251;
- no activas: **215**, ninguna habilitada: `True`. El gris en pantalla es del despliegue 2; la API ya manda `can_operate = false`;
- activas: 36, con el número de habilitadas que salga, que se anota: es la cifra de "Habilitada / No habilitada" que verá el usuario;
- conductores de la flota: **78** (D1-R3);
- embudo de las activas = pendientes = **2.226** (D1-R3, igual a Pendientes), y todas las filas con `funnel_bucket`;
- guarda: `CARRIER_NOT_ACTIVE`;
- RUT con puntos: `True`.

Para ver la forma real de la respuesta de la API desplegada, sin escribir nada: Playwright MCP (nunca claude-in-chrome) con sesión en el frontend de dev. Abrir el Directorio y leer en `browser_network_requests` la respuesta de `GET /api/v1/carriers`: trae `compliance_summary` por fila. El frontend todavía no lo pinta: es el despliegue 2. No se prueba la guarda en dev, porque exigiría escribir un vínculo.

- [ ] **Step 11: AGENTLOG y commit**

En `AGENTLOG.md`, en la sección del Directorio · D1:
- qué se desplegó: commits de las Tasks 1-10, la migración aplicada con su hora, y las cifras de los Steps 3, 7 y 10;
- las rulings D1-R1 a D1-R5 y C-R6 a C-R18. C-R8 confirmada por el usuario, C-R15 resuelta (ONBOARDING se queda en `FUNNEL_ACTIVE_STATUSES`);
- la ronda de mutación (Step 4) y la roja conocida, si apareció;
- siguiente paso exacto: Task 11 (despliegue 2, `lib/states.ts`). La T13/T14 tiene que mostrar el aviso `CARRIER_NOT_ENABLED` y el 409 en estos componentes:
  - `TripAssignDialog`;
  - `GestionPanel`/`FleetAssignSection`;
  - `TripBulkUpload` (ya muestra `errors`);
  - `AsignarConductorPopover` (`operations/monitor/page.tsx`);
  - `VehicleDetailPanel`.

  El filtro de la ficha de empresa compara RUT y patente por clave (§7.2).

```bash
git add AGENTLOG.md
git commit -m "docs(agentlog): Directorio D1, despliegue 1 en dev (base y API)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin dev
```

Este push solo toca `AGENTLOG.md`: no dispara `Deploy Monitor API` (filtro de rutas).

---

### Task 11: Glosario en código (`lib/states.ts`)

**Files:**
- Create: `monitor-app/frontend/lib/states.ts`, `lib/states.test.ts`, `lib/states.guard.test.ts`, `lib/states.fixtures.ts`
- Delete: `monitor-app/frontend/lib/status.test.ts`
- Modify: `monitor-app/frontend/lib/types.ts:654-661`, `:672-695`, `:801-811`, `:950-990`, `:1052-1066`, `:1069-1076`, `:1079-1100`, `:1111-1145`, `:1958-1973`, Trip (`:558-565`)
- Modify: `monitor-app/frontend/lib/api/entitySummary.ts:11` (`Base`)
- Modify: `monitor-app/frontend/lib/compliance.ts:1`, `:169-210` (+ `lib/compliance.test.ts`)
- Modify: `monitor-app/frontend/lib/pending.ts:31-56`
- Modify: `monitor-app/frontend/lib/utils/complianceChecklist.ts` (+ test)
- Modify: `monitor-app/frontend/components/ui/StatusChip.tsx` (+ test)
- Modify: `monitor-app/frontend/components/compliance/pending/PendingHoldersPanel.tsx:146-150`, `components/compliance/RenglonPendiente.tsx:133-134`
- Modify (ciclo de vida, importadores de `statusLabel`, `STATUS_CLS`, `isCarrierDeactivated`, `CARRIER_DEACTIVATED_LABEL`):
  - `components/dashboard/TransporterCard.tsx:5-15`, `:61-64` (+ test);
  - `TransporterSlideOver.tsx:7`, `:13`, `:118-120`;
  - `app/dashboard/carriers/page.tsx:13-14`, `:305-308`;
  - `app/dashboard/carriers/[id]/page.tsx:15`, `:43`, `:451-453`;
  - `app/dashboard/compliance/[carrierId]/page.tsx:30`, `:35`, `:780-782`;
  - `EntityQuickView.tsx:17`, `:155-163`;
  - `ChipDeBaja.tsx:4`, `DriverSearchPicker.tsx:7`, `ResultadosDelDirectorio.tsx:5`, `DriverRosterCard.tsx:5`,
    `VehicleRosterCard.tsx:5`.
- Modify (fixtures, solo tipos): los 12 tests que arman `ComplianceRecord`, `CarrierListItem`, `Carrier` o filas de roster:
  - `app/dashboard/carriers/[id]/page.test.tsx`;
  - en `components/dashboard/`: `DriverDetailPanel.test.tsx`, `TransporterCard.test.tsx`,
    `TransporterDocumentsPanel.test.tsx`, `VehicleRosterCard.test.tsx`, `VehicleDetailPanel.test.tsx`,
    `DocumentChecklist.test.tsx`, `TransporterAlertBanner.test.tsx`, `InsurancePolicyModal.test.tsx`,
    `DriverRosterCard.test.tsx`, `TransporterSlideOver.test.tsx`;
  - `lib/utils/complianceChecklist.test.ts`.

**Interfaces:**
- Consumes: los campos de la API del despliegue 1 (contrato compartido): `compliance_summary`, `document_state`,
  `days_to_expiry`, `alert_severity`, `funnel_bucket` (NULL si la empresa no está activa), `*_has_critical_alert` y `carrier_can_operate` del Monitor, y `warnings`.
- Produces (fijo por contrato): `lib/states.ts` con `DocumentState`, `AlertSeverity`, `EntityKind`, `StateCounts`,
  `ComplianceSummary`, `StateStyle`, `lifecycleStyle`, `documentStateStyle`, `enablementStyle` y `alertSeverityStyle`.
- Produces (D-R11): `summaryStyle`, `fleetMemberStyle`, `documentEvidenceStyle`, `isBlocking`, `documentStateCount`,
  `stateCountsLine`, `documentStateCounts`, `isCarrierDeactivated`, `CARRIER_DEACTIVATED_LABEL`, `SEVERITY_ORDER`,
  `BLOCKING_STATES` y las etiquetas de grupo.
- Produces (otros archivos): `StatusChip({ tone, icon?, children })`; en `lib/compliance.ts`, `dueRelative(days)` y
  `fileHistoryLabel(status)`; en `lib/types.ts`, `AssignmentWarning`, `AssignmentConflictCode` y `FunnelBucket`.

- [ ] **Step 1: Write the failing tests**

`lib/states.test.ts` (forma de `lib/pending.test.ts`; entorno node):

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  alertSeverityStyle, documentEvidenceStyle, documentStateCount, documentStateCounts, documentStateStyle,
  enablementStyle, fleetMemberStyle, isBlocking, lifecycleStyle, stateCountsLine, summaryStyle,
  type ComplianceSummary,
} from './states'

const summary = (over: Partial<ComplianceSummary> = {}): ComplianceSummary => ({
  worst_state: 'UP_TO_DATE', own: { overdue: 0, expiring: 0, missing: 0 }, fleet: null, can_operate: true, ...over,
})

describe('glosario de estados (spec D1 §3)', () => {
  it('ciclo de vida: concuerda en género y dice igual INACTIVE y LEGACY_INACTIVE', () => {
    expect(lifecycleStyle('carrier', 'ACTIVE').label).toBe('Activa')
    expect(lifecycleStyle('carrier', 'ONBOARDING').label).toBe('En onboarding')
    expect(lifecycleStyle('carrier', 'INACTIVE').label).toBe('Dada de baja')
    expect(lifecycleStyle('carrier', 'LEGACY_INACTIVE').label).toBe('Dada de baja')
    expect(lifecycleStyle('driver', 'ACTIVE').label).toBe('Activo')
    expect(lifecycleStyle('asset', 'INACTIVE').label).toBe('Dado de baja')
    expect(lifecycleStyle('carrier', 'ACTIVE').tone).toBe('resolved')
    expect(lifecycleStyle('carrier', 'LEGACY_INACTIVE').tone).toBe('neutral')
  })

  it('estado del documento: las cinco palabras y sus señales', () => {
    expect(documentStateStyle('UP_TO_DATE')).toMatchObject({ label: 'Al día', tone: 'resolved' })
    expect(documentStateStyle('EXPIRING')).toMatchObject({ label: 'Por vencer', tone: 'warning' })
    expect(documentStateStyle('OVERDUE')).toMatchObject({ label: 'Vencido', tone: 'urgent' })
    expect(documentStateStyle('MISSING')).toMatchObject({ label: 'Falta', tone: 'neutral' })
    expect(documentStateStyle('NOT_REQUIRED')).toMatchObject({ label: 'Aún no se exige', tone: 'neutral' })
  })

  it('habilitación: se calcula en la API y se pinta en gris si la empresa no está activa', () => {
    expect(enablementStyle(summary(), true)).toMatchObject({ label: 'Habilitada', tone: 'resolved' })
    expect(enablementStyle(summary({ can_operate: false, worst_state: 'OVERDUE' }), true))
      .toMatchObject({ label: 'No habilitada', tone: 'urgent' })
    // Las 205 LEGACY dejan de verse en rojo (§1): mismo texto, gris.
    expect(enablementStyle(summary({ can_operate: false, worst_state: 'MISSING' }), false))
      .toMatchObject({ label: 'No habilitada', tone: 'neutral' })
  })

  it('aviso: no es un estado, es énfasis', () => {
    expect(alertSeverityStyle('warning')).toMatchObject({ label: 'Aviso', tone: 'warning' })
    expect(alertSeverityStyle('critical')).toMatchObject({ label: 'Crítico', tone: 'urgent' })
  })

  it('resumen de conductor y equipo: el peor estado, gris si está de baja (D-R8)', () => {
    expect(summaryStyle(summary({ worst_state: 'OVERDUE', can_operate: false }), true))
      .toMatchObject({ label: 'Vencido', tone: 'urgent' })
    expect(summaryStyle(summary({ worst_state: 'OVERDUE', can_operate: false }), false))
      .toMatchObject({ label: 'Vencido', tone: 'neutral' })
  })

  it('miembro de flota: la empresa dada de baja reemplaza "Activo", no la baja propia', () => {
    expect(fleetMemberStyle('driver', 'ACTIVE', 'LEGACY_INACTIVE').label).toBe('Empresa dada de baja')
    expect(fleetMemberStyle('driver', 'INACTIVE', 'LEGACY_INACTIVE').label).toBe('Dado de baja')
    expect(fleetMemberStyle('asset', 'ACTIVE', 'ONBOARDING').label).toBe('Activo')
  })

  it('evidencia: "Falta el archivo" cuando hay fecha y no hay papel; nunca cuenta como al día', () => {
    expect(documentEvidenceStyle('MISSING', '2026-09-12', false)).toMatchObject({ label: 'Falta el archivo', tone: 'neutral' })
    expect(documentEvidenceStyle('MISSING', null, false).label).toBe('Falta')
    expect(documentEvidenceStyle('OVERDUE', '2026-09-12', false).label).toBe('Vencido')
  })

  it('cifras: plural, singular y sin los ceros', () => {
    expect(documentStateCount('OVERDUE', 1)).toBe('1 vencido')
    expect(documentStateCount('OVERDUE', 3)).toBe('3 vencidos')
    expect(documentStateCount('MISSING', 1)).toBe('1 falta')
    expect(documentStateCount('MISSING', 2)).toBe('2 faltan')
    expect(documentStateCount('EXPIRING', 2)).toBe('2 por vencer')
    expect(documentStateCount('UP_TO_DATE', 12)).toBe('12 al día')
    expect(stateCountsLine({ overdue: 2, expiring: 0, missing: 1 })).toBe('2 vencidos · 1 falta')
    expect(stateCountsLine({ overdue: 0, expiring: 0, missing: 0 })).toBeNull()
  })

  it('bloquea solo lo obligatorio vencido o faltante; por vencer no bloquea', () => {
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'OVERDUE' })).toBe(true)
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'MISSING' })).toBe(true)
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'EXPIRING' })).toBe(false)
    expect(isBlocking({ requirement_level: 'CONDITIONAL_OPTIONAL', document_state: 'MISSING' })).toBe(false)
    expect(isBlocking({ requirement_level: 'LEGAL_MANDATORY', document_state: 'NOT_REQUIRED' })).toBe(false)
  })

  it('cuenta registros por el estado que mandó la API', () => {
    const c = documentStateCounts([{ document_state: 'UP_TO_DATE' }, { document_state: 'UP_TO_DATE' }, { document_state: 'MISSING' }])
    expect(c).toEqual({ UP_TO_DATE: 2, EXPIRING: 0, OVERDUE: 0, MISSING: 1, NOT_REQUIRED: 0 })
  })
})
```

`lib/states.guard.test.ts` (patrón de recorrido y de tope de `lib/ui/sistema.test.ts`):

```ts
// @vitest-environment node
/**
 * Spec D1 §8.5: ninguna etiqueta de estado escrita a mano fuera de
 * `lib/states.ts`, y ningún componente recalculando un estado documental.
 *
 * Los dos topes SOLO bajan. La Task 12 los baja al migrar la ficha, la Task 13
 * el Directorio, la Task 14 el embudo; la Task 16 los cambia por `toEqual([])`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..')
const GLOSARIO = 'lib/states.ts'

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && !e.name.includes('.fixtures.')) {
      acc.push(ruta)
    }
  }
  return acc
}
const archivos = () => ['app', 'components', 'lib', 'hooks'].flatMap(d => recorrer(join(RAIZ, d)))
const relativa = (ruta: string) => ruta.slice(RAIZ.length + 1)

/** Un comentario puede citar la palabra ("decía 'Inactiva'"); el código no. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** Las palabras del glosario (§3), sus plurales de pestaña y los sinónimos que
 *  la spec retira ("Inactiva", "Onboarding", "De baja", "Aprobado (manual)"…). */
const ETIQUETAS = [
  'Al día', 'Por vencer', 'Vencido', 'Vencidos', 'Falta', 'Faltan', 'Aún no se exige', 'Todavía no se exige',
  'Activa', 'Activas', 'Activo', 'En onboarding', 'Onboarding', 'Dada de baja', 'Dado de baja', 'Dadas de baja',
  'De baja', 'Inactiva', 'Inactivas', 'Inactivo', 'Habilitada', 'No habilitada', 'Habilitadas', 'No habilitadas',
  'Aprobado (manual)', 'Vence pronto',
]
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ALT = ETIQUETAS.map(escapar).join('|')
// Un literal que ES la etiqueta ('Falta', "Al día", `Vencido`), o el texto de
// JSX que la empieza (<span>Vencido{fecha}</span>). 'Falta el archivo' no es
// una etiqueta de estado y no coincide.
const ETIQUETA = new RegExp(`(['"\`])(${ALT})\\1|>\\s*(${ALT})\\s*(?=[<{])`, 'g')

export function etiquetasEn(src: string): string[] {
  return [...sinComentarios(src).matchAll(ETIQUETA)].map(m => m[2] ?? m[3])
}

/** La misma palabra, otro dominio. Cada entrada dice por qué. */
const OTROS_DOMINIOS: Record<string, { etiquetas: string[]; motivo: string }> = {
  'components/admin/UsersTable.tsx':        { etiquetas: ['Activo', 'Inactivo'], motivo: 'cuenta de usuario, no ciclo de vida del Directorio' },
  'components/dashboard/LocationsTable.tsx': { etiquetas: ['Activo', 'Inactivo'], motivo: 'lugar de carga o entrega' },
  'components/dashboard/IndicatorSwitches.tsx': { etiquetas: ['Activo'], motivo: 'indicador is_active del viaje' },
  'lib/utils/alertSignals.ts':              { etiquetas: ['Activo'], motivo: 'indicador is_active del viaje' },
  'app/dashboard/insurance/page.tsx':       { etiquetas: ['Por vencer', 'Al día'], motivo: 'vigencia de póliza (Seguros ≠ Certificación)' },
  'lib/insurance.tsx':                      { etiquetas: ['Al día', 'Vence pronto'], motivo: 'vigencia de póliza (Seguros ≠ Certificación)' },
}

export function etiquetasEscritasAMano(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    const rel = relativa(ruta)
    if (rel === GLOSARIO) continue
    const permitidas = OTROS_DOMINIOS[rel]?.etiquetas ?? []
    sinComentarios(readFileSync(ruta, 'utf8')).split('\n').forEach((linea, i) => {
      for (const e of etiquetasEn(linea)) if (!permitidas.includes(e)) hallazgos.push(`${rel}:${i + 1} → ${e}`)
    })
  }
  return hallazgos
}

/** Campos con los que un componente recalcula un estado que ya manda la API. */
const RECALCULO = /\.(is_expired|is_expiring_soon|compliance_health|pending_mandatory|urgencia)\b/g

export function lecturasDeRecalculo(): string[] {
  const hallazgos: string[] = []
  for (const ruta of archivos()) {
    const rel = relativa(ruta)
    if (rel === GLOSARIO || rel === 'lib/types.ts') continue
    sinComentarios(readFileSync(ruta, 'utf8')).split('\n').forEach((linea, i) => {
      for (const m of linea.matchAll(RECALCULO)) hallazgos.push(`${rel}:${i + 1} → ${m[0]}`)
    })
  }
  return hallazgos
}

describe('el glosario manda (spec D1 §8.5)', () => {
  it('encuentra archivos que revisar', () => {
    expect(archivos().length).toBeGreaterThan(50)
  })

  it('reconoce una etiqueta en un literal y en texto de JSX, y no una frase que la contiene', () => {
    expect(etiquetasEn(`const a = 'Falta'`)).toEqual(['Falta'])
    expect(etiquetasEn(`<span className="x">Vencido{fecha}</span>`)).toEqual(['Vencido'])
    expect(etiquetasEn(`label: 'Falta el archivo'`)).toEqual([])
    expect(etiquetasEn(`// decía 'Inactiva'`)).toEqual([])
  })

  it('la lista de otros dominios no se pudre', () => {
    for (const [rel, { etiquetas }] of Object.entries(OTROS_DOMINIOS)) {
      expect(existsSync(join(RAIZ, rel)), `${rel} ya no existe: sácalo de OTROS_DOMINIOS`).toBe(true)
      const halladas = etiquetasEn(readFileSync(join(RAIZ, rel), 'utf8'))
      expect(etiquetas.some(e => halladas.includes(e)), `${rel} ya no dice ${etiquetas.join('/')}: sácalo`).toBe(true)
    }
  })

  it('no crecen las etiquetas de estado escritas a mano', () => {
    // 45 medidas el 12/10 (comentarios fuera). 45 -> 19 en la Task 11: lib/types,
    // lib/pending, vigenciaDeLaFila y Pendientes leen el glosario, y 13 son de
    // otro dominio (OTROS_DOMINIOS). Quedan: ficha (2), Directorio (4), Seguros
    // (2), FiltroDeEstado (3), DocumentStatusBar (2), ComplianceBadge (2),
    // lib/compliance (3, Task 12) y el embudo (1, Task 14).
    const DEUDA = 19
    const h = etiquetasEscritasAMano()
    expect(h.length, `Etiquetas de estado fuera de lib/states.ts: ${h.length} (tope ${DEUDA}).\n${h.join('\n')}`)
      .toBeLessThanOrEqual(DEUDA)
  })

  it('no crecen las lecturas que recalculan un estado', () => {
    // 48 medidas el 12/10. 48 -> 42 en la Task 11: vigenciaDeLaFila y
    // RenglonPendiente leen document_state en vez de urgencia.
    const DEUDA = 42
    const h = lecturasDeRecalculo()
    expect(h.length, `Lecturas de recálculo: ${h.length} (tope ${DEUDA}).\n${h.join('\n')}`).toBeLessThanOrEqual(DEUDA)
  })
})
```

`components/ui/StatusChip.test.tsx`, agregar:

```tsx
import { CircleCheck } from 'lucide-react'

  it('con icono lo dibuja antes del texto, oculto para el lector de pantalla', () => {
    const { container } = render(<StatusChip tone="resolved" icon={CircleCheck}>Activa</StatusChip>)
    expect(screen.getByText('Activa')).toHaveClass('text-resuelto')
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
```

`lib/compliance.test.ts`, en `describe('vigenciaDeLaFila')` (`:127-180`): el fixture `base` y cada caso pasan de `urgencia` a
`document_state`, con el mismo mapa que hace el backend (`compliance.py:601-607`): `NO_EXIGIBLE` pasa a `NOT_REQUIRED`,
`AL_DIA` a `UP_TO_DATE`, `VENCIDO` a `OVERDUE`, `POR_VENCER` a `EXPIRING` y `FALTA` a `MISSING`. El caso de `:138` cambia la
palabra:

```ts
    expect(vigenciaDeLaFila({ ...base, document_state: 'NOT_REQUIRED' }, HOY)).toBe('Aún no se exige')
```

y agregar:

```ts
import { dueRelative, fileHistoryLabel } from './compliance'

describe('dueRelative: los días los cuenta la API (days_to_expiry)', () => {
  it('dice cuánto falta o hace cuánto venció', () => {
    expect(dueRelative(0)).toBe('vence hoy')
    expect(dueRelative(1)).toBe('vence en 1 día')
    expect(dueRelative(5)).toBe('vence en 5 días')
    expect(dueRelative(-12)).toBe('vencido hace 12 días')
    expect(dueRelative(null)).toBeNull()
  })
})

describe('fileHistoryLabel: lo que pasó con el archivo, nunca su vigencia', () => {
  it('no usa ninguna palabra del glosario de estados', () => {
    expect(fileHistoryLabel('APPROVED_MANUAL')).toBe('Aprobado a mano')
    expect(fileHistoryLabel('MISSING')).toBe('Sin cargar')
  })
})
```

`lib/utils/complianceChecklist.test.ts` (`:22-38`): el `RECORD` suma
`document_state: 'UP_TO_DATE', days_to_expiry: null, alert_severity: null`, y lo esperado suma esas tres claves.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run lib/states.test.ts lib/states.guard.test.ts components/ui/StatusChip.test.tsx lib/compliance.test.ts lib/utils/complianceChecklist.test.ts`
Expected: FAIL:
- `lib/states.ts` no existe (import);
- `etiquetasEscritasAMano` da 45 (más que 19) y `lecturasDeRecalculo` 48 (más que 42);
- `StatusChip` no dibuja `svg`;
- `vigenciaDeLaFila` lee `urgencia` y devuelve "Todavía no se exige";
- `dueRelative` y `fileHistoryLabel` no existen;
- el mapeo no trae `document_state`.

- [ ] **Step 3: Implement `lib/states.ts`**

```ts
import type { LucideIcon } from 'lucide-react'
import {
  Ban, Building2, CalendarClock, CircleCheck, CircleDashed, Clock, Hourglass,
  OctagonAlert, ShieldAlert, ShieldCheck, ShieldOff, TriangleAlert,
} from 'lucide-react'
import type { StatusTone } from '@/components/ui/StatusChip'
import type { DirectoryEntity } from './types'

/**
 * El glosario de estados en código (spec D1 §3 y §6.4): el ÚNICO lugar del
 * frontend donde un valor de estado se vuelve palabra, tono e ícono. Espejo de
 * `app/schemas/states.py`. Los componentes no calculan estados: piden el
 * estilo del valor que mandó la API y lo pintan con `StatusChip`.
 *
 * Tres capas que no se mezclan (E-b): ciclo de vida (dato), estado del
 * documento (lo calculan las reglas de Configuración) y resumen de quien debe
 * los documentos. Habilitación y aviso se derivan, no se guardan.
 *
 * `lib/states.guard.test.ts` falla si una de estas palabras aparece escrita a
 * mano en otro archivo.
 */

export type DocumentState = 'UP_TO_DATE' | 'EXPIRING' | 'OVERDUE' | 'MISSING' | 'NOT_REQUIRED'
export type AlertSeverity = 'warning' | 'critical'
/** Alias de `DirectoryEntity` (el mismo que `lib/api/entitySummary.ts`). */
export type EntityKind = DirectoryEntity
export interface StateCounts { overdue: number; expiring: number; missing: number }
export interface ComplianceSummary {
  worst_state: DocumentState
  own: StateCounts
  /** Solo empresas: lo de su flota activa. */
  fleet: StateCounts | null
  can_operate: boolean
}
export interface StateStyle { label: string; tone: StatusTone; icon: LucideIcon }

/** Peor primero; `NOT_REQUIRED` no participa. Espejo de `SEVERITY_ORDER`. */
export const SEVERITY_ORDER: readonly DocumentState[] = ['OVERDUE', 'MISSING', 'EXPIRING', 'UP_TO_DATE']
/** Lo que bloquea la habilitación si el requisito es LEGAL_MANDATORY. Espejo de `BLOCKING_STATES`. */
export const BLOCKING_STATES: readonly DocumentState[] = ['OVERDUE', 'MISSING']

// ── Ciclo de vida (lo decide una persona) ─────────────────────────────────────
// INACTIVE y LEGACY_INACTIVE se dicen igual a propósito: de dónde vino la baja
// no cambia nada para quien mira (Pablo, 04/09).
const CARRIER_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:          { label: 'Activa',        tone: 'resolved', icon: CircleCheck },
  ONBOARDING:      { label: 'En onboarding', tone: 'warning',  icon: Hourglass },
  INACTIVE:        { label: 'Dada de baja',  tone: 'neutral',  icon: Ban },
  LEGACY_INACTIVE: { label: 'Dada de baja',  tone: 'neutral',  icon: Ban },
}
const FLEET_LIFECYCLE: Record<string, StateStyle> = {
  ACTIVE:   { label: 'Activo',       tone: 'resolved', icon: CircleCheck },
  INACTIVE: { label: 'Dado de baja', tone: 'neutral',  icon: Ban },
}

export function lifecycleStyle(kind: EntityKind, status: string): StateStyle {
  const table = kind === 'carrier' ? CARRIER_LIFECYCLE : FLEET_LIFECYCLE
  return table[status] ?? { label: status, tone: 'neutral', icon: CircleDashed }
}

/** La empresa está dada de baja (no "en onboarding"). Su flota queda vinculada
 *  como historial (P1) y se marca (bloque 0, 0.9). */
export function isCarrierDeactivated(status: string | null | undefined): boolean {
  return status === 'INACTIVE' || status === 'LEGACY_INACTIVE'
}
export const CARRIER_DEACTIVATED_LABEL = 'Empresa dada de baja'

/** Conductor o equipo activo de una empresa dada de baja: dice eso en vez de
 *  "Activo". La baja propia manda sobre la de la empresa. */
export function fleetMemberStyle(kind: EntityKind, status: string, carrierStatus?: string | null): StateStyle {
  if (status === 'ACTIVE' && isCarrierDeactivated(carrierStatus)) {
    return { label: CARRIER_DEACTIVATED_LABEL, tone: 'neutral', icon: Building2 }
  }
  return lifecycleStyle(kind, status)
}

/** Las pestañas que agrupan estados de empresa. */
export const CARRIER_LIFECYCLE_GROUP_LABELS = {
  active: 'Activas', inactive: 'Dadas de baja', onboarding: 'En onboarding',
} as const

// ── Estado del documento (document_state_sql) ─────────────────────────────────
const DOCUMENT: Record<DocumentState, StateStyle> = {
  UP_TO_DATE:   { label: 'Al día',          tone: 'resolved', icon: CircleCheck },
  EXPIRING:     { label: 'Por vencer',      tone: 'warning',  icon: Clock },
  OVERDUE:      { label: 'Vencido',         tone: 'urgent',   icon: TriangleAlert },
  MISSING:      { label: 'Falta',           tone: 'neutral',  icon: CircleDashed },
  NOT_REQUIRED: { label: 'Aún no se exige', tone: 'neutral',  icon: CalendarClock },
}

export function documentStateStyle(state: DocumentState): StateStyle {
  return DOCUMENT[state]
}

/** "Falta" significaba dos cosas: no saber nada del documento, y saber cuándo
 *  vence sin tener el papel. Se precisa la palabra; el tono no cambia, porque
 *  una fecha sin evidencia nunca cuenta como cumplido. */
export function documentEvidenceStyle(state: DocumentState, expirationDate: string | null | undefined, hasFile: boolean): StateStyle {
  const base = DOCUMENT[state]
  return state === 'MISSING' && expirationDate && !hasFile ? { ...base, label: 'Falta el archivo' } : base
}

/** Las pestañas de Pendientes: un grupo de documentos, en plural. */
export const DOCUMENT_STATE_GROUP_LABELS: Record<'OVERDUE' | 'EXPIRING' | 'MISSING', string> = {
  OVERDUE: 'Vencidos', EXPIRING: 'Por vencer', MISSING: 'Faltan',
}

const COUNT: Record<DocumentState, [string, string]> = {
  UP_TO_DATE:   ['al día', 'al día'],
  EXPIRING:     ['por vencer', 'por vencer'],
  OVERDUE:      ['vencido', 'vencidos'],
  MISSING:      ['falta', 'faltan'],
  NOT_REQUIRED: ['aún no se exige', 'aún no se exigen'],
}

/** "3 vencidos", "1 falta". */
export function documentStateCount(state: DocumentState, n: number): string {
  return `${n} ${COUNT[state][n === 1 ? 0 : 1]}`
}

/** "2 vencidos · 1 falta": las cifras de un resumen, sin los ceros. `null` si no hay nada. */
export function stateCountsLine(c: StateCounts): string | null {
  const parts = ([['OVERDUE', c.overdue], ['EXPIRING', c.expiring], ['MISSING', c.missing]] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => documentStateCount(s, n))
  return parts.length ? parts.join(' · ') : null
}

/** Cuántos registros hay en cada estado, según la API. Contar no es calcular. */
export function documentStateCounts(records: { document_state: DocumentState }[]): Record<DocumentState, number> {
  const out: Record<DocumentState, number> = { UP_TO_DATE: 0, EXPIRING: 0, OVERDUE: 0, MISSING: 0, NOT_REQUIRED: 0 }
  for (const r of records) out[r.document_state] += 1
  return out
}

/** Un registro que impide la habilitación. La cifra de la empresa sale de
 *  `compliance_summary`; esto solo elige QUÉ filas listar. */
export function isBlocking(r: { requirement_level: string; document_state: DocumentState }): boolean {
  return r.requirement_level === 'LEGAL_MANDATORY' && BLOCKING_STATES.includes(r.document_state)
}

// ── Resumen y habilitación (fleet_compliance.py) ──────────────────────────────

/** El segundo chip de conductor y equipo (D-R8): el peor estado de lo suyo, en
 *  gris si está de baja. */
export function summaryStyle(summary: ComplianceSummary, lifecycleActive: boolean): StateStyle {
  const s = DOCUMENT[summary.worst_state]
  return lifecycleActive ? s : { ...s, tone: 'neutral' }
}

/** Habilitada / No habilitada. Lo calcula la API (`can_operate`); en gris si la
 *  empresa no está activa, que no es lo mismo que estar en falta (spec §3). */
export function enablementStyle(summary: ComplianceSummary, lifecycleActive: boolean): StateStyle {
  const label = summary.can_operate ? 'Habilitada' : 'No habilitada'
  if (!lifecycleActive) return { label, tone: 'neutral', icon: ShieldOff }
  return summary.can_operate
    ? { label, tone: 'resolved', icon: ShieldCheck }
    : { label, tone: 'urgent', icon: ShieldAlert }
}

export const ENABLEMENT_GROUP_LABELS = { enabled: 'Habilitadas', not_enabled: 'No habilitadas' } as const

// ── Aviso del documento (no es un estado: énfasis y orden) ────────────────────
const ALERT: Record<AlertSeverity, StateStyle> = {
  warning:  { label: 'Aviso',   tone: 'warning', icon: Clock },
  critical: { label: 'Crítico', tone: 'urgent',  icon: OctagonAlert },
}

export function alertSeverityStyle(severity: AlertSeverity): StateStyle {
  return ALERT[severity]
}
```

- [ ] **Step 4: Types**

En `lib/types.ts`:

1. `:654-661`: la flota pierde `LEGACY_INACTIVE` (§4.4; el CHECK de la Task 2 no lo admite):

```ts
/** Conductor y equipo: el CHECK de la base admite solo estos dos (D1, §4.4). */
export type OperationalStatus = 'ACTIVE' | 'INACTIVE'
/** Empresa: los cuatro de `carriers_operational_status_check`. */
export type CarrierOperationalStatus = 'ACTIVE' | 'INACTIVE' | 'LEGACY_INACTIVE' | 'ONBOARDING'
```

   `OPERATIONAL_STATUS_OPTIONS` (`carriers/[id]/page.tsx:43`) no lo lee nadie y deja de compilar: borrarlo.
2. Al principio del archivo:

```ts
export type { AlertSeverity, ComplianceSummary, DocumentState, StateCounts } from './states'
import type { AlertSeverity, ComplianceSummary, DocumentState } from './states'
```

   y borrar la definición local de `DocumentState` (`:809-811`).
3. `ComplianceRecord` (`:672-695`), debajo de `is_expiring_soon`:

```ts
  /** El estado según la definición única del backend (D1, despliegue 1). */
  document_state:     DocumentState
  /** Días de Chile hasta el vencimiento; negativo si venció; null si no vence. */
  days_to_expiry:     number | null
  /** Aviso calculado (no es un estado): null si no corresponde. */
  alert_severity:     AlertSeverity | null
```

4. Agregar `compliance_summary: ComplianceSummary` a `CarrierListItem`, `Carrier`, `CarrierDriverRosterItem` y
   `CarrierAssetRosterItem`. Agregar `enabled: number; not_enabled: number` a `CarrierListFacets` (D-R6).
5. Borrar `OPERATIONAL_STATUS_LABELS`, `FLEET_STATUS_LABELS`, `statusLabel`, `isCarrierDeactivated` y
   `CARRIER_DEACTIVATED_LABEL` (`:956-990`). Dejar `DirectoryEntity` con su comentario.
6. Guarda de asignación y embudo:

```ts
/** La guarda de asignación (D1 §7.1): 409 con `detail = {code, message}`. */
export type AssignmentConflictCode = 'CARRIER_NOT_ACTIVE' | 'DRIVER_INACTIVE' | 'ASSET_INACTIVE'
/** Se asignó igual, con aviso: la empresa no está habilitada (P14 abierta). */
export type AssignmentWarning = { code: 'CARRIER_NOT_ENABLED'; message: string }
/** Los baldes del embudo por el resumen (D1-R2): conviven con `funnel_group` hasta la Task 16. */
export type FunnelBucket = 'up_to_date' | 'expiring' | 'not_enabled'   // NULL en la fila si la empresa no está activa
```

   En `CertificationStatusRow` (`:1958-1973`) agregar `funnel_bucket?: FunnelBucket | null` y
   `compliance_summary?: ComplianceSummary`. Son opcionales porque viajan solo al agrupar por empresa, como `funnel_group`.
   En `Trip`, debajo de `carrier_pending_docs_critical` (`:565`), agregar `driver_has_critical_alert?: boolean | null`,
   `tractor_has_critical_alert?: boolean | null`, `carrier_has_critical_alert?: boolean | null` y
   `carrier_can_operate?: boolean | null` (nombres por entidad fijados en el ensamblado; los pinta la Task 14).

En `lib/api/entitySummary.ts:11`:
`type Base = { id: string; operational_status: string; documents: DocumentSummary; compliance_summary: ComplianceSummary }`
(con `import type { ComplianceSummary } from '@/lib/states'`).

`lib/states.fixtures.ts`:

```ts
import type { ComplianceSummary, DocumentState } from './states'

/** Fixtures de test: un resumen al día y los tres campos de estado de un
 *  registro. Cada test pisa lo que necesita. */
export function complianceSummary(over: Partial<ComplianceSummary> = {}): ComplianceSummary {
  return { worst_state: 'UP_TO_DATE', own: { overdue: 0, expiring: 0, missing: 0 }, fleet: null, can_operate: true, ...over }
}
export function recordStateFields(document_state: DocumentState = 'UP_TO_DATE') {
  return { document_state, days_to_expiry: null, alert_severity: null } as const
}
```

En los 12 tests de la lista de Files, agregar `compliance_summary: complianceSummary()` a cada empresa o fila de roster y
`...recordStateFields(...)` a cada registro. Usar `'MISSING'` donde el fixture dice `status: 'MISSING'`, `'OVERDUE'` donde
dice `is_expired: true` y `'UP_TO_DATE'` en el resto. Es solo tipado: con estos valores ningún test cambia de color hoy.

- [ ] **Step 5: Implement `lib/compliance.ts`, `lib/pending.ts` and the checklist mapping**

`lib/compliance.ts`:
- el import de `:1` pasa a `import type { ComplianceStatus, PoliticaVencimiento } from './types'` y
  `import { documentStateStyle, type DocumentState } from './states'`.
- `vigenciaDeLaFila` (`:173-210`) recibe `document_state: DocumentState` en lugar de `urgencia: Urgencia`. En el cuerpo,
  `NO_EXIGIBLE` pasa a `NOT_REQUIRED`, `FALTA` a `MISSING`, `VENCIDO` a `OVERDUE` y `AL_DIA` a `UP_TO_DATE`. La línea de
  `:184` queda:

```ts
    return fila.exigible_desde ? `Se exige desde el ${formatExpiry(fila.exigible_desde)}` : documentStateStyle('NOT_REQUIRED').label
```

- agregar:

```ts
/** "vence en 5 días" / "vencido hace 12 días" / "vence hoy", desde los días
 *  que contó la API (`days_to_expiry`, día de Chile). Reemplaza la resta de
 *  fechas en el navegador, que con el huso UTC cruzaba de día desde las 21:00. */
export function dueRelative(days: number | null | undefined): string | null {
  if (days == null) return null
  if (days === 0) return 'vence hoy'
  if (days > 0) return `vence en ${days} día${days === 1 ? '' : 's'}`
  const n = Math.abs(days)
  return `vencido hace ${n} día${n === 1 ? '' : 's'}`
}

/** Lo que pasó con el archivo (`compliance_records.status`), para el
 *  historial. NUNCA como estado del documento (spec D1 §3, conflicto 10): el
 *  estado es `document_state`. */
const FILE_HISTORY: Record<ComplianceStatus, string> = {
  MISSING: 'Sin cargar', PENDING_REVIEW: 'En revisión', APPROVED_MANUAL: 'Aprobado a mano',
  APPROVED: 'Aprobado', REJECTED: 'Rechazado', EXPIRED: 'Marcado como vencido', ARCHIVED: 'Archivado',
}
export const fileHistoryLabel = (s: ComplianceStatus): string => FILE_HISTORY[s] ?? s
```

  `COMPLIANCE_STATUS_CONFIG`, `evidenciaDeDocumento` y `complianceAlertStatus` **se quedan hasta la Task 12**, que migra a
  sus lectores (la ficha). Por eso el tope de etiquetas queda en 19 y no en 16.

`lib/pending.ts` (`:41-56`): las cuatro etiquetas y tonos salen del glosario:

```ts
import { documentStateStyle } from './states'
…
  if (fila.document_state === 'OVERDUE') {
    const s = documentStateStyle('OVERDUE')
    return { label: vence ? `Venció el ${diaMes(vence)}` : s.label, tone: s.tone, action: 'Subir' }
  }

  if (fila.document_state === 'EXPIRING') {
    const s = documentStateStyle('EXPIRING')
    const relativo = vence ? expiryRelative(vence, false, hoy) : null
    const label = relativo && vence
      ? `${relativo.replace(/^./, c => c.toUpperCase())} · ${diaMes(vence)}`
      : s.label
    return { label, tone: s.tone, action: 'Subir la nueva' }
  }

  const falta = documentStateStyle('MISSING')
  return fila.entered_on
    ? { label: falta.label, tone: falta.tone, action: 'Subir', detail: haceDias(fila.entered_on, hoy) }
    : { label: falta.label, tone: falta.tone, action: 'Subir' }
```

`lib/utils/complianceChecklist.ts`: agregar al mapeo `document_state: r.document_state`, `days_to_expiry: r.days_to_expiry`
y `alert_severity: r.alert_severity`. En `ChecklistItem` (`DocumentChecklist.tsx:15-33`), agregar los tres campos con los
tipos de `@/lib/states`. `is_expired` e `is_expiring_soon` se quedan hasta la Task 12.

- [ ] **Step 6: `StatusChip`, Pendientes and the lifecycle readers**

`components/ui/StatusChip.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
…
/** Una variante es una prop: el ícono del glosario (`lib/states.ts`) viaja con
 *  el tono, no en un componente hermano. */
export function StatusChip({ tone, icon: Icon, children }: { tone: StatusTone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-etiqueta font-semibold ${TONE[tone]}`}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  )
}
```

`PendingHoldersPanel.tsx:147-149`: `label: DOCUMENT_STATE_GROUP_LABELS.OVERDUE` (y `.EXPIRING`, `.MISSING`).

`RenglonPendiente.tsx:134`: `fila.document_state === 'UP_TO_DATE' || fila.document_state === 'NOT_REQUIRED' ? …`.

Lectores del ciclo de vida. Todos pasan a `StatusChip` con el estilo del glosario, con este patrón:

```tsx
const s = lifecycleStyle('carrier', item.operational_status)
<StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
```

- `TransporterCard.tsx`: se borran `STATUS_CLS` y su comentario (`:8-15`), y el `<span>` de `:62-64` pasa al patrón.
- `app/dashboard/carriers/page.tsx:305-308`, `TransporterSlideOver.tsx:118-120` (con `<div className="mb-5">` alrededor),
  `app/dashboard/compliance/[carrierId]/page.tsx:780-782` y `app/dashboard/carriers/[id]/page.tsx:451-453`: el mismo
  patrón. Se borran los imports de `STATUS_CLS` y de `statusLabel`.
- `EntityQuickView.tsx:155-163`, sin cambiar todavía la estructura (la Task 13 la rehace):
  `const s = fleetMemberStyle(target.kind, data.operational_status, (data as DriverSummary | AssetSummary).carrier?.operational_status)`
  más el patrón. Para `carrier`, `fleetMemberStyle` devuelve el `lifecycleStyle` de la empresa.
- `ChipDeBaja.tsx`, `DriverSearchPicker.tsx`, `ResultadosDelDirectorio.tsx`, `DriverRosterCard.tsx` y
  `VehicleRosterCard.tsx`: `isCarrierDeactivated`, `CARRIER_DEACTIVATED_LABEL` y la etiqueta salen de `@/lib/states`. En
  `ChipDeBaja`, `statusLabel('driver', estado)` pasa a `lifecycleStyle('driver', estado).label`.

`TransporterCard.test.tsx:55-61` (`shows an amber Onboarding badge…`) fija las clases crudas `bg-amber-50`/`text-amber-700`.
Pasa a `expect(badge).toHaveClass('text-warning')`, que es el token del tono `warning`.

Borrar `lib/status.test.ts`: `lib/states.test.ts` cubre sus casos y la guarda reemplaza a su recorrido.

- [ ] **Step 7: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run lib components/ui components/compliance/pending components/compliance/RenglonPendiente.test.tsx components/dashboard/TransporterCard.test.tsx components/dashboard/TransporterSlideOver.test.tsx components/dashboard/EntityQuickView.test.tsx components/dashboard/DriverRosterCard.test.tsx components/dashboard/VehicleRosterCard.test.tsx "app/dashboard/carriers" "app/dashboard/compliance/[carrierId]"`
Expected: PASS.
- Etiquetas: 19. Recálculo: 42.
- `lib/ui/sistema.test.ts`: baja. Se van `STATUS_CLS` (10 usos crudos) y el chip gris de la ficha (2). Bajar `DEUDA` al
  número que reporte el test, esperado cerca de 1.393, con una línea de comentario
  `1.405 -> N el 2026-10-1x: STATUS_CLS y los chips de ciclo de vida pasaron a StatusChip (D1, Task 11).`
- `lib/ui/escala.test.ts`: baja por los cuatro `text-[10px]` de los chips. Bajar `DEUDA` al número real, esperado cerca de
  209, con su línea de comentario.

- [ ] **Step 8: Verificar que la mutación mata el test**

1. En `lib/states.ts`, cambiar la etiqueta de `LEGACY_INACTIVE` de `CARRIER_LIFECYCLE` a `'Inactiva'`. Tiene que fallar
   `ciclo de vida: concuerda en género…` de `states.test.ts`. Restaurar.
2. En `states.guard.test.ts`, borrar la rama `|>\\s*(${ALT})\\s*(?=[<{])` de `ETIQUETA`. Tiene que fallar `reconoce una
   etiqueta en un literal y en texto de JSX…`. Restaurar.
3. En `enablementStyle`, devolver el tono `'urgent'` también cuando la empresa no está activa. Tiene que fallar
   `habilitación: … gris si la empresa no está activa`. Restaurar.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/app
git commit -m "feat(glosario): un solo diccionario de estados en lib/states.ts

Ciclo de vida, estado del documento, habilitación y aviso se dicen en un
solo lugar; types.ts, pending.ts, Pendientes y los chips de ciclo de vida lo
leen. Un test de guarda impide escribir una etiqueta de estado a mano y
otro impide recalcular un estado que manda la API (D1, Task 11).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Ficha de empresa: documentos con el estado de la API

**Files:**
- Modify: `monitor-app/frontend/components/dashboard/DocumentChecklist.tsx:15-33`, `:58-79`, `:96-158`, `:224-232`, `:256-262` (+ test)
- Modify: `monitor-app/frontend/lib/utils/complianceChecklist.ts` (+ test)
- Modify: `monitor-app/frontend/components/dashboard/TransporterAlertBanner.tsx` (+ test)
- Modify: `monitor-app/frontend/components/dashboard/TransporterDocumentsPanel.tsx:7-9`, `:50-64`, `:72-77`, `:114`, `:154-160` (+ test)
- Delete: `monitor-app/frontend/components/dashboard/ComplianceBadge.tsx`
- Modify: `monitor-app/frontend/components/dashboard/TransporterSlideOver.tsx:81-83`, `:117-127`, `:150-160` (+ test)
- Modify: `monitor-app/frontend/components/dashboard/DriverDetailPanel.tsx:13`, `:169-170`; `VehicleDetailPanel.tsx:12`, `:203-204`
- Modify: `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx:31-34`, `:385-393`, `:445-455`, `:501-527`, `:530-560` (+ test)
- Modify: `monitor-app/frontend/app/dashboard/compliance/[carrierId]/page.tsx:31`, `:62-71`, `:263-295`, `:310-312`, `:413-423`, `:776-783` (+ test)
- Modify: `monitor-app/frontend/lib/compliance.ts:3-50`, `:52-60` (+ `lib/compliance.test.ts`)

**Interfaces:**
- Consumes (Task 11): `documentStateStyle`, `documentEvidenceStyle`, `enablementStyle`, `lifecycleStyle`, `isBlocking`,
  `documentStateCounts`, `stateCountsLine`, `dueRelative`, `fileHistoryLabel`, `StatusChip({ icon })`.
- Consumes (API, despliegue 1, más D-R7): `Carrier.compliance_summary`, `CarrierListItem.compliance_summary`, y
  `document_state`, `days_to_expiry` y `alert_severity` en cada registro de empresa, conductor y equipo.
- Produces: `ChecklistItem` sin `is_expired` ni `is_expiring_soon`. Se retiran `checklistCompletion`, `nodeState`,
  `COMPLIANCE_STATUS_CONFIG`, `evidenciaDeDocumento`, `complianceAlertStatus` y `ComplianceBadge`.

- [ ] **Step 1: Write the failing tests**

`TransporterAlertBanner.test.tsx`. `makeRecord` (`:6-14`) ya trae `...recordStateFields()` desde la Task 11. Los tests
`lists mandatory MISSING, EXPIRED and REJECTED…` y `includes an approved-but-expired record…` (`:29-54`) **fijan el
defecto**: deciden por `status`. Se reemplazan por:

```tsx
  it('lista lo obligatorio que la API dice vencido o faltante, con la palabra del glosario', () => {
    render(<TransporterAlertBanner records={[
      makeRecord({ id: 'a', name: 'F30', status: 'APPROVED_MANUAL', ...recordStateFields('OVERDUE') }),
      makeRecord({ id: 'b', name: 'Escritura', status: 'MISSING', ...recordStateFields('MISSING') }),
    ]} />)
    expect(screen.getByText('F30')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(screen.getByText('Escritura')).toBeInTheDocument()
    expect(screen.getByText('Falta')).toBeInTheDocument()
    // El estado guardado es historial, no estado (conflicto 10).
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  it('no lista lo que todavía no se exige ni lo que solo está por vencer', () => {
    const { container } = render(<TransporterAlertBanner records={[
      makeRecord({ status: 'MISSING', ...recordStateFields('NOT_REQUIRED') }),
      makeRecord({ id: 'c', status: 'APPROVED_MANUAL', ...recordStateFields('EXPIRING') }),
    ]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dice cuánto falta con los días de la API', () => {
    render(<TransporterAlertBanner records={[
      makeRecord({ status: 'APPROVED_MANUAL', expiration_date: '2026-10-01', ...recordStateFields('OVERDUE'), days_to_expiry: -11 }),
    ]} />)
    expect(screen.getByText('vencido hace 11 días')).toBeInTheDocument()
  })
```

En los tests de `:56-82` (cuenta en la cabecera, vencimiento relativo, "sin actualizar hace"), cambiar el `status` que
provoca el problema por el `document_state` equivalente (`'MISSING'` u `'OVERDUE'`). Donde el test pasaba
`expiration_date` + `is_expired`, ahora pasa `days_to_expiry`.

`TransporterDocumentsPanel.test.tsx` (copiar la forma de montar del propio archivo):

```tsx
  it('pinta el estado de la API, no el guardado', () => {
    renderPanel([makeRecord({ name: 'F30', status: 'APPROVED_MANUAL', expiration_date: '2025-09-01', ...recordStateFields('OVERDUE') })])
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  it('cuenta al día lo que la API dice al día, no lo aprobado', () => {
    renderPanel([
      makeRecord({ id: 'a', status: 'APPROVED_MANUAL', ...recordStateFields('OVERDUE') }),
      makeRecord({ id: 'b', status: 'APPROVED_MANUAL', ...recordStateFields('UP_TO_DATE') }),
    ])
    expect(screen.getByText('1 de 2 al día')).toBeInTheDocument()
  })
```

(si el archivo no tiene `renderPanel` ni `makeRecord`, usar los que tenga con esos nombres de prop).

`DocumentChecklist.test.tsx`. `ITEMS` (`:5-18`) pasa a declarar el estado de la API en vez de `is_expired` e
`is_expiring_soon`: `cr1` `UP_TO_DATE`, `cr2` `OVERDUE` con `days_to_expiry: -284`, `cr3` `MISSING`. Estos tests **fijan
`nodeState`** (minúsculas propias y "pendiente") y se reescriben:

```tsx
  it('cada fila dice el estado que mandó la API', () => {
    render(<DocumentChecklist items={ITEMS} canUpload={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Póliza firmada — Al día')).toBeInTheDocument()
    expect(screen.getByTitle('Certificado de vigencia — Vencido')).toBeInTheDocument()
    expect(screen.getByTitle('Endoso — Falta')).toBeInTheDocument()
  })

  it('aprobado pero por vencer dice Por vencer: el estado guardado no manda', () => {
    const items = [{ ...ITEMS[0], status: 'APPROVED_MANUAL' as const, document_state: 'EXPIRING' as const, days_to_expiry: 5 }]
    render(<DocumentChecklist items={items} canUpload={false} onUpload={vi.fn()} />)
    expect(screen.getByTitle('Póliza firmada — Por vencer')).toBeInTheDocument()
    expect(screen.getByText('(vence en 5 días)')).toBeInTheDocument()
  })

  it('el select manual ofrece solo lo que se guarda, con palabras de historial (D-R16)', () => {
    const noFileItems = [{ ...ITEMS[2], requires_file: false }]
    render(<DocumentChecklist items={noFileItems} canUpload={true} onStatusChange={vi.fn()} />)
    const select = screen.getByLabelText('Estado de Endoso') as HTMLSelectElement
    expect(Array.from(select.options).map(o => [o.value, o.text]))
      .toEqual([['MISSING', 'Sin cargar'], ['APPROVED_MANUAL', 'Aprobado a mano']])
  })
```

Se reemplazan estos tests:
- `marks approved-and-not-expired documents with a check and MISSING ones as pending` y `marks an approved-but-expired
  document as vencido` (`:38-47`): los cubre el primero de arriba.
- `does not offer PENDING_REVIEW…`: lo cubre el del select.
- `checklistCompletion counts ok documents…` (`:185-187`): se borra junto con la función.

Además, `1 de 3 completos` (`:150-153` y `:181-183`) pasa a `1 de 3 al día`, y `calls onStatusChange…` usa
`'APPROVED_MANUAL'`.

`app/dashboard/carriers/[id]/page.test.tsx`. El fixture `CARRIER` suma
`compliance_summary: complianceSummary({ worst_state: 'MISSING', own: { overdue: 0, expiring: 0, missing: 1 }, fleet: { overdue: 2, expiring: 0, missing: 0 }, can_operate: false })`,
y su registro `cr1` lleva `recordStateFields('MISSING')`. Agregar:

```tsx
  it('la cabecera separa el ciclo de vida de la habilitación: dos chips', async () => {
    renderPage()
    expect(await screen.findByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('No habilitada')).toHaveClass('text-status-incidente')
  })

  it('una empresa dada de baja no se ve en rojo: "No habilitada" en gris', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, operational_status: 'LEGACY_INACTIVE' })
    renderPage()
    expect(await screen.findByText('Dada de baja')).toBeInTheDocument()
    expect(screen.getByText('No habilitada')).toHaveClass('text-informativo')
  })

  it('el resumen cuenta lo que manda la API, propio y de la flota activa', async () => {
    renderPage()
    expect(await screen.findByText('1 falta')).toBeInTheDocument()
    expect(screen.getByText('Flota activa: 2 vencidos')).toBeInTheDocument()
    expect(screen.getByText('0 de 1 al día')).toBeInTheDocument()
  })
```

`app/dashboard/compliance/[carrierId]/page.test.tsx`:
- El helper `fila()` (`:60-70`) suma `document_state`, derivado de su `urgencia` con el mapa de la Task 11. Así los tests
  existentes conservan su sentido. `resumenDesdeFilas` y `filasParaEstado` siguen leyendo `urgencia`, porque simulan al
  servidor.
- El `CARRIER` (`:42`) suma `compliance_summary: complianceSummary()`.
- Agregar (copiar la forma de montar del test vecino que despliega un sujeto):

```tsx
  it('la ficha de Certificación lee la misma habilitación que el Directorio (D1-R5)', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, compliance_summary: complianceSummary({ can_operate: true }) })
    // … montar como el test vecino
    expect(await screen.findByText('Habilitada')).toBeInTheDocument()
  })

  it('un documento al día aprobado a mano dice Al día, no el estado guardado', async () => {
    // … una fila con urgencia 'AL_DIA' (document_state 'UP_TO_DATE') y status 'APPROVED_MANUAL', sujeto desplegado
    expect(await screen.findByText('Al día')).toBeInTheDocument()
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })
```

`TransporterSlideOver.test.tsx`: el registro que hoy es `APPROVED` con `is_expired: true` pasa a
`recordStateFields('OVERDUE')`, y se espera `'Vencido'` en vez de la etiqueta guardada. El ítem suma
`compliance_summary: complianceSummary({ can_operate: false })`, y se agrega
`expect(screen.getByText('No habilitada')).toBeInTheDocument()`.

`lib/compliance.test.ts`: se borran los `describe('evidenciaDeDocumento…')` (`:45-90`). Fijaban "Aprobado (manual)" como
etiqueta. Su regla (fecha sin papel = "Falta el archivo") la cubre `documentEvidenceStyle` en `states.test.ts`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/TransporterAlertBanner.test.tsx components/dashboard/TransporterDocumentsPanel.test.tsx components/dashboard/DocumentChecklist.test.tsx components/dashboard/TransporterSlideOver.test.tsx "app/dashboard/carriers/[id]/page.test.tsx" "app/dashboard/compliance/[carrierId]/page.test.tsx"`
Expected: FAIL:
- el banner decide por `status` (lista el NOT_REQUIRED y no lista el APPROVED_MANUAL vencido);
- el panel muestra "Aprobado (manual)";
- el checklist titula "al día / vencido / pendiente" con `nodeState`, y el select ofrece 6 valores;
- la cabecera no tiene "No habilitada" y el resumen no tiene "1 falta";
- Certificación no muestra "Habilitada".

- [ ] **Step 3: Implement `DocumentChecklist` and the mapping**

`ChecklistItem`: se borran `is_expired` e `is_expiring_soon` (quedan `document_state`, `days_to_expiry` y
`alert_severity`). En `complianceRecordsToChecklistItems`, se borran las dos líneas, y su test deja de esperarlas.

`DocumentChecklist.tsx`:
- se borran `nodeState`, `stateLabel` y `checklistCompletion` (`:70-85`);
- `STATUS_OPTIONS` (`:58-68`):

```ts
/** Lo único que se guarda a mano en un requisito sin archivo (auditoría B: en
 *  uso solo MISSING y APPROVED_MANUAL). Se dice como historial del archivo, no
 *  como estado: el estado lo calcula la API (D-R16). */
const STATUS_OPTIONS: { value: ComplianceStatus; label: string }[] =
  (['MISSING', 'APPROVED_MANUAL'] as const).map(value => ({ value, label: fileHistoryLabel(value) }))
```

- en `ChecklistRow`:

```tsx
  const state = documentStateStyle(item.document_state)
  …
  const relative = dueRelative(item.days_to_expiry)
```

  `title={`${item.label} — ${state.label}`}`. El círculo de `:136-138` y su `iconCls` (`:120-124`) pasan a
  `<StatusChip tone={state.tone} icon={state.icon}>{state.label}</StatusChip>`, al final de la fila antes de "Ver". El
  `({relative})` de `:150-154` queda `<span className="text-etiqueta text-informativo">({relative})</span>`: el estado ya
  lo dice el chip.
- en `DocumentChecklist` (`:224-232`):

```tsx
  const upToDate = documentStateCounts(items).UP_TO_DATE
  …
        <p className="text-xs text-gray-400 mb-2">{upToDate} de {items.length} {documentStateStyle('UP_TO_DATE').label.toLowerCase()}</p>
```

`DriverDetailPanel.tsx:169-170` y `VehicleDetailPanel.tsx:203-204`:
`const ok = documentStateCounts(items).UP_TO_DATE; const total = items.length`. El import de `checklistCompletion` sale y
entra `documentStateCounts` de `@/lib/states`.

- [ ] **Step 4: Implement the banner, the panel and the slide-over**

`TransporterAlertBanner.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react'
import type { ComplianceRecord } from '@/lib/types'
import { dueRelative, updatedRelative } from '@/lib/compliance'
import { documentEvidenceStyle, isBlocking } from '@/lib/states'
import { StatusChip } from '@/components/ui/StatusChip'

/** Los obligatorios que impiden la habilitación, según la API (D1 §6.2): el
 *  filtro por `status` que vivía acá contaba REJECTED, ignoraba lo que todavía
 *  no se exige y mostraba "Aprobado (manual)" sobre un vencido. */
export function TransporterAlertBanner({ records }: Props) {
  const problems = records.filter(isBlocking)
  …
          const relative = dueRelative(r.days_to_expiry) ?? updatedRelative(r.updated_at)
          const s = documentEvidenceStyle(r.document_state, r.expiration_date, r.file_url !== null)
          …
                {relative && <span className="text-etiqueta text-informativo">{relative}</span>}
                <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
```

(`relativeLabel` se borra, y `AlertTriangle` pasa a `text-status-incidente`).

`TransporterDocumentsPanel.tsx`:
- imports: fuera `ComplianceBadge` y `complianceAlertStatus`; entran `StatusChip`, `documentStateStyle` y
  `documentStateCounts`, más `fileHistoryLabel` de `@/lib/compliance`.
- `DocumentRow`: se borran `alert`, `approved` e `iconCls` (`:50-55`). El círculo de `:61-63` pasa a
  `<StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>` (con `const s = documentStateStyle(record.document_state)`),
  y se borra `{record.expiration_date && <ComplianceBadge … />}` (`:76`).
- en el historial (`:114`), `{v.status ?? '—'}` pasa a `{v.status ? fileHistoryLabel(v.status) : '—'}`.
- en el contador (`:155-160`):

```tsx
  const upToDate = documentStateCounts(records).UP_TO_DATE
  …
          {records.length === 0 ? 'Sin datos' : `${upToDate} de ${records.length} ${documentStateStyle('UP_TO_DATE').label.toLowerCase()}`}
```

Borrar `components/dashboard/ComplianceBadge.tsx`. Su comentario cita `TripTable.tsx`, pero el grep no le encuentra otro
lector.

`TransporterSlideOver.tsx`:
- `:82-83`:

```tsx
  const okCount = documentStateCounts(records).UP_TO_DATE
  const issues = records.filter(r => r.document_state !== 'UP_TO_DATE' && r.document_state !== 'NOT_REQUIRED')
```

- debajo del chip de ciclo de vida (Task 11), el de habilitación:

```tsx
  const life = lifecycleStyle('carrier', item.operational_status)
  const enabled = enablementStyle(item.compliance_summary, item.operational_status === 'ACTIVE')
  …
  <div className="mb-5 flex flex-wrap gap-1.5">
    <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
    <StatusChip tone={enabled.tone} icon={enabled.icon}>{enabled.label}</StatusChip>
  </div>
```

- en la lista de `issues` (`:153-158`): `const s = documentEvidenceStyle(r.document_state, r.expiration_date, r.file_url !== null)`
  y `<StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>`.
- el texto `Todos los documentos al día` se queda (es una frase, no una etiqueta de estado).

`lib/compliance.ts`: borrar `COMPLIANCE_STATUS_CONFIG`, `evidenciaDeDocumento`, `AlertStatus` y `complianceAlertStatus`
(`:3-60`).

- [ ] **Step 5: Implement the carrier page (Directorio)**

`carriers/[id]/page.tsx`:
- imports: fuera `checklistCompletion` y `complianceRecordsToChecklistItems` (`:32-33`), y `expiryRelative`; entran
  `StatusChip`, `dueRelative` y, de `@/lib/states`, `documentStateCounts`, `documentStateStyle`, `enablementStyle`,
  `isBlocking`, `lifecycleStyle` y `stateCountsLine`.
- `:385-393`:

```tsx
  // La ficha pinta lo que manda la API (D1 §6.2): la cifra de la empresa es
  // `compliance_summary`, y la lista de abajo son las filas que la bloquean.
  const complianceRecords = carrier?.compliance_records ?? []
  const docCounts = useMemo(() => documentStateCounts(complianceRecords), [complianceRecords])
  const blocking = useMemo(() => complianceRecords.filter(isBlocking), [complianceRecords])
  const summary = carrier?.compliance_summary
```

- la cabecera (`:451-453`, ya con el chip de ciclo de vida de la Task 11) suma el de habilitación, separado:

```tsx
                {(() => {
                  const life = lifecycleStyle('carrier', carrier.operational_status)
                  const enabled = enablementStyle(carrier.compliance_summary, carrier.operational_status === 'ACTIVE')
                  return (<>
                    <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
                    <StatusChip tone={enabled.tone} icon={enabled.icon}>{enabled.label}</StatusChip>
                  </>)
                })()}
```

  (si se lee mejor, sacar `life` y `enabled` como `const` antes del `return`, junto a `canChangeCarrierStatus`).
- la pestaña Documentos (`:504`) toma su cifra del resumen:
  `count: (summary.own.overdue + summary.own.missing) || null`. El `text-red-500 font-bold` de `:520` pasa a
  `text-status-incidente font-bold`.
- la tarjeta Documentación del Resumen (`:533-560`):

```tsx
            <div className="flex items-center gap-3">
              <CompletionRing ok={docCounts.UP_TO_DATE} total={complianceRecords.length} />
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {docCounts.UP_TO_DATE} de {complianceRecords.length} {documentStateStyle('UP_TO_DATE').label.toLowerCase()}
                </p>
                <p className="text-dato text-informativo">{stateCountsLine(summary.own) ?? 'Sin pendientes'}</p>
                {summary.fleet && (
                  <p className="text-dato text-informativo">Flota activa: {stateCountsLine(summary.fleet) ?? 'sin pendientes'}</p>
                )}
              </div>
            </div>
            {blocking.length > 0 && (
              <ul className="mt-3 space-y-1">
                {blocking.slice(0, 3).map(r => {
                  const relative = dueRelative(r.days_to_expiry) ?? updatedRelative(r.updated_at)
                  return (
                    <li key={r.id} className="text-xs text-informativo truncate">
                      • {r.name}{relative && <span> · {relative}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
```

  Salen `mandoryProblems` y los `text-red-500`/`text-green-600` de `:540-543`: menos color crudo.

- [ ] **Step 6: Implement the Certificación ficha (D1-R5)**

`compliance/[carrierId]/page.tsx`:
- `filasDelEstado` (`:62-71`) parte por `document_state`. El servidor ya define `urgencia` con ese mapa
  (`compliance.py:601-607`), así que ninguna fila cambia de balde:

```ts
    case 'al_dia':     return filas.filter(f => f.document_state === 'UP_TO_DATE')
    case 'por_vencer': return filas.filter(f => f.document_state === 'EXPIRING')
    case 'falta':      return filas.filter(f => f.document_state === 'MISSING' || f.document_state === 'OVERDUE')
```

  y `f.urgencia === 'AL_DIA'` (`:423`) pasa a `f.document_state === 'UP_TO_DATE'`. Los comentarios de `:269-273` y
  `:413-421` que nombran `urgencia` se actualizan a `document_state`.
- `FilaDocumento` (`:295`, `:310-312`):

```tsx
  const s = documentEvidenceStyle(fila.document_state, fila.expiration_date, fila.tiene_archivo)
  …
        <span className="shrink-0"><StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip></span>
```

  Se reescribe el comentario de `:263-273`: ya no "el badge sale de `status`". El estado guardado es historial.
- cabecera (`:776-783`): junto al chip de ciclo de vida de la Task 11 va el de habilitación, igual que en la ficha del
  Directorio:
  `enablementStyle(carrier.compliance_summary, carrier.operational_status === 'ACTIVE')`.
- import: `evidenciaDeDocumento` sale; entran `StatusChip`, `documentEvidenceStyle`, `enablementStyle` y `lifecycleStyle`.

- [ ] **Step 7: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run lib components/dashboard components/compliance components/ui "app/dashboard/carriers" "app/dashboard/compliance"`
Expected: PASS.
- Etiquetas: 19 → **14**: salen `ComplianceBadge` (2) y `lib/compliance.ts` (3). Bajar `DEUDA` con su comentario.
- Recálculo: 42 → **21**: ficha (2), Certificación (5), `DocumentChecklist` (4), banner (2), panel (5), slide-over (1),
  mapeo (2). Bajar `DEUDA`.
- `sistema` y `escala` bajan (círculos de color, `text-[10px]` de las filas del panel, `red/green` de la tarjeta): bajar
  los dos topes al número real, con su línea de comentario.

- [ ] **Step 8: Verificar que la mutación mata el test**

1. En `TransporterAlertBanner`, volver al filtro de antes:
   `records.filter(r => r.requirement_level === 'LEGAL_MANDATORY' && (r.status === 'MISSING' || r.status === 'EXPIRED'))`.
   Tiene que fallar `lista lo obligatorio que la API dice vencido o faltante…` (el APPROVED_MANUAL vencido desaparece).
   Restaurar.
2. En `enablementStyle` de la cabecera de la ficha, pasar `true` en vez de `carrier.operational_status === 'ACTIVE'`.
   Tiene que fallar `una empresa dada de baja no se ve en rojo…`. Restaurar.

- [ ] **Step 9: Commit**

```bash
git add monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/app
git commit -m "feat(ficha): los documentos dicen el estado que manda la API

La ficha del Directorio y la de Certificación muestran ciclo de vida y
habilitación en dos chips, y el resumen con las cifras de compliance_summary.
Cada documento pinta su document_state; el estado guardado queda como
historial. Se retiran nodeState, checklistCompletion, mandatoryProblems,
complianceAlertStatus y ComplianceBadge (D1, Task 12).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Directorio, roster y vista rápida

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/carriers/page.tsx:8`, `:25-26`, `:31-60`, `:72`, `:115-117`, `:202-230`, `:285`, `:310-319` (+ test)
- Modify: `monitor-app/frontend/lib/api/carriers.ts:20-31`, `:119-130`
- Modify: `monitor-app/frontend/components/dashboard/TransporterCard.tsx:61-74` (+ test)
- Modify: `monitor-app/frontend/app/dashboard/carriers/[id]/page.tsx:16`, `:172-176`, `:353-380`, `:638-650`, `:720-732` (+ test)
- Create: `monitor-app/frontend/lib/identity.ts`, `lib/identity.test.ts`
- Modify: `monitor-app/frontend/components/dashboard/DriverRosterCard.tsx`, `VehicleRosterCard.tsx:68-79` (+ tests)
- Delete: `monitor-app/frontend/components/dashboard/ChipDeBaja.tsx`
- Modify: `monitor-app/frontend/components/dashboard/ResultadosDelDirectorio.tsx:5-6`, `:86-102`
- Modify: `monitor-app/frontend/components/dashboard/EntityQuickView.tsx:140-166`, `:250`, `:269`, `:301` (+ test)
- Modify: `monitor-app/frontend/components/ui/DocumentStatusBar.tsx` (+ test), `lib/api/entitySummary.ts:1`
- Modify: `monitor-app/frontend/app/dashboard/insurance/page.tsx:38-45`
- Modify: `monitor-app/frontend/components/compliance/FiltroDeEstado.tsx:12-17` (+ test)
- Modify: `monitor-app/frontend/components/dashboard/FleetAssignSection.tsx:8-24`, `:47-63`, `:90-96` (+ test)
- Modify: `monitor-app/frontend/components/dashboard/TripAssignDialog.tsx:65`, `:157-163` (+ test), `lib/api/trips.ts:112-122`, `:191-215`

**Interfaces:**
- Consumes (Task 11): el glosario y sus extras, `StatusChip({ icon })` y los tipos de API.
- Consumes (API): `compliance_summary` en la lista, el roster y la vista rápida; `enablement` y sus facets (D-R6); 409
  `{code, message}` y `warnings` en la asignación.
- Produces:
  - `lib/identity.ts`: `canonicalRut(input)`, `canonicalPlate(input)`, `rutSearchKey(input)` y `plateSearchKey(input)`;
  - `DocumentStatusBar({ documents, counts?, fleet? })`;
  - `FleetAssignValue.carrier_operational_status?`;
  - `tripsApi.create`/`assignFleetLink` devuelven `Trip & { warnings?: AssignmentWarning[] }`, y `assignDriver` devuelve
    `{ asignados: number; warnings?: AssignmentWarning[] }`.

- [ ] **Step 1: Write the failing tests**

`lib/identity.test.ts` (los vectores mismos que `public.canonical_rut` / `canonical_plate`,
`20260817120000_identidad_canonica.sql`; si la Task 9 usa otros en `test_paridad_normalizador_python_y_base`, sumar los
suyos):

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canonicalPlate, canonicalRut, plateSearchKey, rutSearchKey } from './identity'

describe('identidad canónica, espejo de la base (D1 §7.2)', () => {
  it('RUT: con o sin puntos y guion es el mismo; un DV que no cierra no es un RUT', () => {
    expect(canonicalRut('12.345.678-5')).toBe('12345678-5')
    expect(canonicalRut('123456785')).toBe('12345678-5')
    expect(canonicalRut('1.234.567-4')).toBe('1234567-4')
    expect(canonicalRut('10.000.013-k')).toBe('10000013-K')
    expect(canonicalRut('10000004-0')).toBe('10000004-0')
    expect(canonicalRut('12.345.678-9')).toBeNull()
    expect(canonicalRut('1234567')).toBeNull()
    expect(canonicalRut('K2345678')).toBeNull()
    expect(canonicalRut(null)).toBeNull()
  })

  it('patente: con guion, espacio o tabulador es la misma', () => {
    expect(canonicalPlate('ab-cd 12')).toBe('ABCD12')
    expect(canonicalPlate('GBVC90\t')).toBe('GBVC90')
    expect(canonicalPlate('ABC12')).toBeNull()
  })

  it('claves de búsqueda parcial: sin adornos, para comparar un pedazo', () => {
    expect(rutSearchKey('22.222.222')).toBe('22222222')
    expect(plateSearchKey('ab-cd')).toBe('ABCD')
  })
})
```

`app/dashboard/carriers/[id]/page.test.tsx`. Los fixtures `DRIVERS` y `ASSETS` suman `compliance_summary` (la Task 11 ya
puso `complianceSummary()`). Agregar un segundo conductor en `OVERDUE`:

```tsx
const DRIVERS: CarrierDriverRosterItem[] = [
  { id: 'd1', tax_id: '22222222-2', full_name: 'Juan Pérez', operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null, pending_mandatory: 0, compliance_health: 'OK', compliance_summary: complianceSummary() },
  { id: 'd2', tax_id: '12345678-5', full_name: 'Ana Rojas', operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null, pending_mandatory: 1, compliance_health: 'PENDING',
    compliance_summary: complianceSummary({ worst_state: 'OVERDUE', own: { overdue: 1, expiring: 0, missing: 0 }, can_operate: false }) },
]
```

y los tests:

```tsx
  it('el roster filtra por el peor estado que manda la API', async () => {
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByRole('button', { name: /^Vencido/ }))
    expect(screen.getByText('Ana Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('un RUT con puntos encuentra al conductor guardado sin puntos (D1 §7.2)', async () => {
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.change(await screen.findByPlaceholderText(/Filtrar por nombre o RUT/), { target: { value: '12.345.678' } })
    expect(screen.getByText('Ana Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('una patente con guion encuentra al equipo', async () => {
    renderPage()
    await clickTab(/Equipos/)
    fireEvent.change(await screen.findByPlaceholderText(/Filtrar por patente/), { target: { value: 'AB-CD' } })
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })
```

`app/dashboard/carriers/page.test.tsx`:
- `emptyResponse()` (`:18-20`) suma `enabled: 0, not_enabled: 0` a `facets`.
- Los tres tests de pestañas (`:49-83`) fijan "Inactivas" y "Onboarding": pasan a `/^Dadas de baja/` y `/^En onboarding/`.
- Agregar:

```tsx
  it('las empresas activas se filtran por habilitación, no por compliance_health (D-R6)', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /No habilitadas/ }))
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ operational_status: ['ACTIVE'], enablement: 'not_enabled' }),
    ))
  })

  it('una empresa dada de baja no cuenta como "No habilitada": la pestaña no ofrece el filtro', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /^Dadas de baja/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /No habilitadas/ })).not.toBeInTheDocument())
  })
```

(si `AlertStatTiles` no expone botones con ese nombre, usar el selector que ya usa el componente en su propio test).

`TransporterCard.test.tsx`. `ITEM` lleva `complianceSummary()` (Task 11). Los tests `renders … an "Al día" pill…` y
`shows a red pending pill…` (`:13-25`) **fijan el pill de `compliance_health`**. Se reemplazan por:

```tsx
  it('dos chips: ciclo de vida y habilitación', () => {
    render(<TransporterCard item={ITEM} onOpen={vi.fn()} />)
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Habilitada')).toHaveClass('text-resuelto')
  })

  it('una activa con obligatorios vencidos dice No habilitada, en rojo', () => {
    render(<TransporterCard item={{ ...ITEM, compliance_summary: complianceSummary({ worst_state: 'OVERDUE', can_operate: false }) }} onOpen={vi.fn()} />)
    expect(screen.getByText('No habilitada')).toHaveClass('text-status-incidente')
  })

  it('una dada de baja no se ve en rojo (las 205 LEGACY, §1)', () => {
    render(<TransporterCard item={{ ...ITEM, operational_status: 'LEGACY_INACTIVE', compliance_summary: complianceSummary({ worst_state: 'MISSING', can_operate: false }) }} onOpen={vi.fn()} />)
    expect(screen.getByText('No habilitada')).toHaveClass('text-informativo')
  })
```

`DriverRosterCard.test.tsx`:
- los tests que fijan el pill viejo y la regla de "una fila, un estado": `renders … "Al día" pill` (cambia de fuente),
  `shows a red pending pill…`, `uses singular wording…`, `la baja reemplaza al pill de documentación…` y
  `marca al conductor de una empresa dada de baja` (su `queryByText('Al día')` choca con el par). La spec §6.2 decide lo
  contrario: "el mismo par, sin reemplazar uno por otro".
- se reemplazan por:

```tsx
  it('el par: ciclo de vida y el peor estado de sus documentos (D-R8)', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, compliance_summary: complianceSummary({ worst_state: 'OVERDUE', can_operate: false }) }} onOpen={vi.fn()} />)
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toHaveClass('text-status-incidente')
  })

  it('dado de baja: el par completo, el documental en gris', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, operational_status: 'INACTIVE' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Dado de baja')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toHaveClass('text-informativo')
  })

  it('de una empresa dada de baja lo dice en lugar de "Activo" (0.9)', () => {
    render(<DriverRosterCard driver={DRIVER} carrierStatus="INACTIVE" onOpen={vi.fn()} />)
    expect(screen.getByText('Empresa dada de baja')).toBeInTheDocument()
    expect(screen.queryByText('Activo')).not.toBeInTheDocument()
  })
```

  Lo mismo en `VehicleRosterCard.test.tsx` con su fixture.

`components/ui/DocumentStatusBar.test.tsx`. Agregar:

```tsx
  it('las cifras de atención salen del resumen de la API y la flota va en su línea (D-R9)', () => {
    render(<DocumentStatusBar documents={docs({ expired: 9, expiring: 9 })}
                              counts={{ overdue: 2, expiring: 1, missing: 0 }}
                              fleet={{ overdue: 3, expiring: 0, missing: 4 }} />)
    expect(screen.getByText('2 vencidos')).toBeInTheDocument()
    expect(screen.queryByText('9 vencidos')).toBeNull()
    expect(screen.getByText('Flota activa: 3 vencidos · 4 faltan')).toBeInTheDocument()
  })
```

`EntityQuickView.test.tsx`. `DRIVER` (`:17-21`) suma `compliance_summary: complianceSummary()`. Agregar:

```tsx
const CARRIER = {
  id: 'c1', business_name: 'Hueraman', tax_id: '76111111-1', operational_status: 'ACTIVE',
  shippers: [], active_drivers: 3, active_assets: 2, primary_contact: null, documents: DOCS,
  compliance_summary: complianceSummary({ worst_state: 'MISSING', own: { overdue: 0, expiring: 0, missing: 2 },
    fleet: { overdue: 1, expiring: 0, missing: 0 }, can_operate: false }),
}

  it('empresa: ciclo de vida y habilitación, con la línea de su flota activa', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(CARRIER as never)
    renderView({ kind: 'carrier', id: 'c1', label: 'Hueraman' })
    expect(await screen.findByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('No habilitada')).toBeInTheDocument()
    expect(screen.getByText('2 faltan')).toBeInTheDocument()
    expect(screen.getByText('Flota activa: 1 vencido')).toBeInTheDocument()
  })

  it('conductor: el par ciclo de vida + resumen documental', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue(
      { ...DRIVER, compliance_summary: complianceSummary({ worst_state: 'EXPIRING', own: { overdue: 0, expiring: 1, missing: 0 } }) } as never)
    renderView({ kind: 'driver', id: 'd1', label: 'Vidal' })
    expect(await screen.findByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Por vencer')).toBeInTheDocument()
  })
```

El test `conductor: dónde trabaja…` espera `'12 al día'`, que sigue saliendo de `documents.ok`.

`components/compliance/FiltroDeEstado.test.tsx` (patrón del propio archivo):

```tsx
  it('usa la escala del glosario; el balde que junta dos estados los nombra a los dos (D-R12)', () => {
    render(<FiltroDeEstado valor="todos" onCambiar={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Vencido o falta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Por vencer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Al día' })).toBeInTheDocument()
  })
```

Si un test del archivo hacía clic en `'Falta'`, pasa a `'Vencido o falta'`.

`FleetAssignSection.test.tsx`. El test del bloque 0 `no autocompleta una empresa dada de baja (R10)` **fija la regla del
cliente que la guarda 409 reemplaza** (D-R10). Se reemplaza por:

```tsx
  it('autocompleta la empresa aunque no esté activa y avisa: decide la API (D-R10)', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} suggested={[{ ...CANDIDATE, carrier_operational_status: 'INACTIVE' }]} />)
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ carrier_id: 'c1', carrier_operational_status: 'INACTIVE' }))
    expect(screen.getByText('Dada de baja')).toBeInTheDocument()
  })
```

En `picking a suggested driver fills every field…` (`:43-51`), lo esperado suma `carrier_operational_status: null`.

`TripAssignDialog.test.tsx` (helpers `renderCreate`, `pickDriver`, `pickCliente`):

```tsx
import { ApiError } from '@/lib/api/client'

  it('si la API rechaza la asignación (409) muestra su mensaje y no cierra', async () => {
    const onClose = vi.fn()
    vi.mocked(tripsApi.create).mockRejectedValue(new ApiError(
      'Transportes Sur Spa está dada de baja: no se le asignan viajes.', 409,
      { code: 'CARRIER_NOT_ACTIVE', message: 'Transportes Sur Spa está dada de baja: no se le asignan viajes.' }))
    renderCreate({ onClose })
    await pickCliente(); await pickDriver()
    fireEvent.click(screen.getByText('Crear viaje'))
    expect(await screen.findByText('Transportes Sur Spa está dada de baja: no se le asignan viajes.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('creado con aviso de empresa no habilitada: lo muestra antes de seguir', async () => {
    const onCreated = vi.fn()
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new',
      warnings: [{ code: 'CARRIER_NOT_ENABLED', message: 'Transportes Sur Spa no está habilitada: tiene obligatorios vencidos.' }] } as never)
    renderCreate({ onCreated })
    await pickCliente(); await pickDriver()
    fireEvent.click(screen.getByText('Crear viaje'))
    expect(await screen.findByText('Transportes Sur Spa no está habilitada: tiene obligatorios vencidos.')).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 't-new' }))
  })
```

(El primero documenta que `apiFetch` ya convierte `detail.message` en el mensaje del error, `client.ts:43-47`. Si pasa
antes de implementar, se queda como test de regresión y se reporta. El segundo tiene que fallar).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run lib/identity.test.ts "app/dashboard/carriers" components/dashboard/TransporterCard.test.tsx components/dashboard/DriverRosterCard.test.tsx components/dashboard/VehicleRosterCard.test.tsx components/ui/DocumentStatusBar.test.tsx components/dashboard/EntityQuickView.test.tsx components/compliance/FiltroDeEstado.test.tsx components/dashboard/FleetAssignSection.test.tsx components/dashboard/TripAssignDialog.test.tsx`
Expected: FAIL:
- `lib/identity.ts` no existe;
- el roster filtra por `compliance_health` y compara el RUT con `includes` literal;
- las pestañas dicen "Inactivas"/"Onboarding" y no hay "No habilitadas";
- las tarjetas muestran "N pendientes"/"Al día" de `compliance_health`;
- la barra no recibe `counts` ni `fleet`;
- la vista rápida no tiene "No habilitada";
- el filtro dice "Falta";
- `pick` pone `carrier_id: null`;
- el diálogo cierra sin mostrar el aviso.

- [ ] **Step 3: Implement `lib/identity.ts`**

```ts
/**
 * RUT y patente en su forma canónica, espejo exacto de `public.canonical_rut` y
 * `public.canonical_plate` (migración 20260817120000_identidad_canonica.sql).
 * La base guarda drivers/assets canónicos, pero `carriers.tax_id` no (D3), y lo
 * que una persona escribe trae puntos, guiones y espacios: comparar el texto
 * crudo hacía que "12.345.678" no encontrara a "12345678-5" (D1 §7.2).
 */

/** Dígito verificador, módulo 11 (`public.rut_check_digit`). */
function rutCheckDigit(body: string): string {
  let total = 0
  body.split('').reverse().forEach((c, i) => { total += Number(c) * ((i % 6) + 2) })
  const r = 11 - (total % 11)
  return r === 11 ? '0' : r === 10 ? 'K' : String(r)
}

/** `NNNNNNNN-D`, o `null` si no es un RUT válido. No inventa un DV. */
export function canonicalRut(input: string | null | undefined): string | null {
  if (input == null) return null
  const stripped = input.replace(/[^0-9kK]/g, '').toUpperCase()
  if (stripped.length < 8 || stripped.length > 9) return null
  const body = stripped.slice(0, -1)
  const dv = stripped.slice(-1)
  if (!/^[0-9]+$/.test(body)) return null
  return rutCheckDigit(body) === dv ? `${body}-${dv}` : null
}

/** `AAAA99`, o `null`. */
export function canonicalPlate(input: string | null | undefined): string | null {
  const s = (input ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return /^[A-Z0-9]{6}$/.test(s) ? s : null
}

/** Para buscar un pedazo de RUT: sin adornos, sin validar. */
export const rutSearchKey = (input: string): string => input.replace(/[^0-9kK]/g, '').toUpperCase()
/** Para buscar un pedazo de patente. */
export const plateSearchKey = (input: string): string => input.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
```

- [ ] **Step 4: Implement the Directorio list**

`lib/api/carriers.ts`: en `CarrierListParams`, `enablement?: 'enabled' | 'not_enabled' | ''` (comentario: "D-R6:
habilitación calculada por la API; `health` queda hasta la Task 16"), y en `list`,
`if (params?.enablement) qs.set('enablement', params.enablement)`.

`app/dashboard/carriers/page.tsx`:
- pestañas (`:46-48`) y su comentario (`:31-45`, que cita "Inactivas"; reescribirlo diciendo que la pestaña es "Dadas de
  baja" y manda los dos estados):

```tsx
const TABS: { id: TransporterTab; label: string; status: CarrierOperationalStatus[] }[] = [
  { id: 'active',     label: CARRIER_LIFECYCLE_GROUP_LABELS.active,     status: ['ACTIVE'] },
  { id: 'legacy',     label: CARRIER_LIFECYCLE_GROUP_LABELS.inactive,   status: ['LEGACY_INACTIVE', 'INACTIVE'] },
  { id: 'onboarding', label: CARRIER_LIFECYCLE_GROUP_LABELS.onboarding, status: ['ONBOARDING'] },
]
```

- `HealthTab` pasa a `type EnablementTab = '' | 'enabled' | 'not_enabled'`, y `HEALTH_TABS` (`:56-60`) a:

```tsx
/** Segundo eje, solo para las activas: Habilitada / No habilitada lo calcula la
 *  API (`compliance_summary.can_operate`, D-R6). Una empresa dada de baja o en
 *  onboarding no cuenta como "No habilitada" en una cola (spec §3). */
const ENABLEMENT_TABS: { id: EnablementTab; label: string; facetKey: keyof CarrierListFacets }[] = [
  { id: '',            label: 'Todas',                                facetKey: 'total' },
  { id: 'not_enabled', label: ENABLEMENT_GROUP_LABELS.not_enabled,    facetKey: 'not_enabled' },
  { id: 'enabled',     label: ENABLEMENT_GROUP_LABELS.enabled,        facetKey: 'enabled' },
]
```

  `EMPTY_FACETS` suma `enabled: 0, not_enabled: 0`. El estado `healthTab` pasa a
  `enablementTab: EnablementTab`, que vuelve a `''` al cambiar de pestaña. La consulta
  (`:117`) queda
  `useTransporters({ q: qDebounced, operational_status: currentStatus, enablement: tab === 'active' ? enablementTab : '', page, limit: LIMIT })`.
  El bloque `<AlertStatTiles …>` (`:222-230`) se dibuja solo con `tab === 'active'`, con tonos `'danger'` para
  `not_enabled`, `'success'` para `enabled` y `'neutral'` para el resto.
- la celda Documentación de la tabla (`:310-319`):

```tsx
                    <td className="px-3 py-3">
                      {(() => {
                        const s = enablementStyle(item.compliance_summary, item.operational_status === 'ACTIVE')
                        return <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
                      })()}
                    </td>
```

  La cabecera de la columna (`:285`) pasa de "Documentación" a "Habilitación". Salen del import `ShieldAlert`,
  `ShieldCheck` y `ComplianceHealth`.

`TransporterCard.tsx` (`:65-73`): el pill de `compliance_health` pasa al chip de habilitación, con el mismo patrón. Se
reescribe el comentario de `:22-28`, que cita `compliance_health` y `mandatoryProblems`.

`insurance/page.tsx` (`:38-45`): `label: CARRIER_LIFECYCLE_GROUP_LABELS.active` y `CARRIER_LIFECYCLE_GROUP_LABELS.inactive`.
El comentario de `:38-41` pasa a decir "Dadas de baja".

- [ ] **Step 5: Implement the roster (carrier page)**

`carriers/[id]/page.tsx`:
- `driverHealthFilter` y `assetHealthFilter` (`:172`, `:176`) pasan a `useState<DocumentState | ''>('')`.
- facets y filtros (`:353-375`):

```tsx
  // El roster se reparte por el peor estado que manda la API (D1 §6.1): una
  // sola respuesta para "cómo está con sus documentos".
  const facetsOf = (rows: { compliance_summary: ComplianceSummary }[]) => ({
    '': rows.length,
    ...Object.fromEntries(SEVERITY_ORDER.map(s => [s, rows.filter(r => r.compliance_summary.worst_state === s).length])),
  }) as Record<'' | DocumentState, number>
  const driverFacets = useMemo(() => facetsOf(drivers), [drivers])
  const assetFacets  = useMemo(() => facetsOf(assets), [assets])

  const filteredDrivers = useMemo(() => drivers.filter(d => {
    const q = driverQ.trim()
    // RUT con o sin puntos (D1 §7.2): se compara sin adornos, y solo si el texto
    // trae un dígito, para que "Kevin" no busque la K de un DV.
    const rut = /\d/.test(q) ? rutSearchKey(q) : ''
    const matchesQ = !q || d.full_name.toLowerCase().includes(q.toLowerCase())
      || (rut !== '' && rutSearchKey(d.tax_id).includes(rut))
    const matchesState = !driverHealthFilter || d.compliance_summary.worst_state === driverHealthFilter
    return matchesQ && matchesState
  }), [drivers, driverQ, driverHealthFilter])

  const filteredAssets = useMemo(() => assets.filter(a => {
    const matchesQ = !assetQ || plateSearchKey(a.license_plate).includes(plateSearchKey(assetQ))
    const matchesType = assetTypeFilter === 'todos' || a.asset_type === assetTypeFilter
    const matchesState = !assetHealthFilter || a.compliance_summary.worst_state === assetHealthFilter
    return matchesQ && matchesType && matchesState
  }), [assets, assetQ, assetTypeFilter, assetHealthFilter])
```

- las dos tiras de tiles (`:640-649`, `:722-731`):

```tsx
          <AlertStatTiles
            tiles={[
              { id: '', label: 'Todos', value: driverFacets[''], tone: 'neutral' },
              ...SEVERITY_ORDER.map(s => ({
                id: s, label: documentStateStyle(s).label, value: driverFacets[s],
                tone: s === 'OVERDUE' ? 'danger' as const : s === 'UP_TO_DATE' ? 'success' as const : 'neutral' as const,
              })),
            ]}
            active={driverHealthFilter}
            onSelect={id => setDriverHealthFilter(id as DocumentState | '')}
          />
```

  (igual para equipos). El contenedor `max-w-md` pasa a `max-w-xl`, porque son cinco tiles.
- el placeholder del filtro (`:658`) pasa de `Filtrar por nombre o tax_id…` a `Filtrar por nombre o RUT…`.
- imports: sale `ComplianceHealth`; entran `ComplianceSummary`, `DocumentState`, `SEVERITY_ORDER` y `documentStateStyle`
  de `@/lib/states`, y `rutSearchKey` y `plateSearchKey` de `@/lib/identity`.

- [ ] **Step 6: Implement the roster cards, the search results and the quick view**

`DriverRosterCard.tsx` (`:42-53`, y su comentario de `:16-25`, que defiende "una fila, un estado": reescribirlo citando la
§6.2):

```tsx
        <div className="mt-0.5 flex flex-wrap gap-1">
          {(() => {
            const life = fleetMemberStyle('driver', driver.operational_status, carrierStatus)
            const docs = summaryStyle(driver.compliance_summary,
              driver.operational_status === 'ACTIVE' && !isCarrierDeactivated(carrierStatus))
            return (<>
              <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
              <StatusChip tone={docs.tone} icon={docs.icon}>{docs.label}</StatusChip>
            </>)
          })()}
        </div>
```

`VehicleRosterCard.tsx` (`:68-79`): lo mismo con `'asset'` y `vehicle`. Salen `ShieldAlert`, `ShieldCheck` y
`ChipDeBaja`.

`ResultadosDelDirectorio.tsx:102`: el chip se dibuja solo con `deBaja || empresaDeBaja`, como hoy:

```tsx
      {(deBaja || empresaDeBaja) && (() => {
        const s = fleetMemberStyle('driver', deBaja ? 'INACTIVE' : 'ACTIVE', empresaDeBaja ? 'INACTIVE' : null)
        return <span className="shrink-0"><StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip></span>
      })()}
```

Borrar `components/dashboard/ChipDeBaja.tsx`. `grep -rn ChipDeBaja` tiene que quedar vacío.

`components/ui/DocumentStatusBar.tsx`:
- el tipo local `DocumentState` pasa a `AttentionState` (choca con el del glosario). Actualizar su uso en `DocumentSummary`
  y en `lib/api/entitySummary.ts` si lo nombra.
- `SEGMENTS` toma las palabras de `documentStateCount`:

```tsx
const SEGMENTS = (d: DocumentSummary, c: StateCounts): Segment[] => [
  { key: 'ok',       count: d.ok,       bar: 'bg-resuelto',         label: n => documentStateCount('UP_TO_DATE', n) },
  { key: 'expiring', count: c.expiring, bar: 'bg-warning',          label: n => documentStateCount('EXPIRING', n) },
  { key: 'expired',  count: c.overdue,  bar: 'bg-status-incidente', label: n => documentStateCount('OVERDUE', n) },
  { key: 'missing',  count: c.missing,  bar: 'bg-informativo',      label: n => documentStateCount('MISSING', n) },
]
```

- la firma es
  `DocumentStatusBar({ documents, counts, fleet }: { documents: DocumentSummary; counts?: StateCounts; fleet?: StateCounts | null })`.
  Sin `counts`, usa `{ overdue: documents.expired, expiring: documents.expiring, missing: documents.missing }`, para que su
  test siga probando la forma vieja.
- `dueLabel` toma las palabras del glosario: `documentStateStyle('MISSING').label` y `documentStateStyle('OVERDUE').label`
  más la fecha. `Vence` se queda (es el verbo de la fecha, no un estado).
- debajo de la leyenda:

```tsx
      {fleet && (
        <p className="mt-2 text-dato text-informativo">Flota activa: {stateCountsLine(fleet) ?? 'sin pendientes'}</p>
      )}
```

`EntityQuickView.tsx`:
- `Identity` (`:152-164`): el chip único pasa al par.

```tsx
        {data && (() => {
          const carrierStatus = target.kind === 'carrier' ? null : (data as DriverSummary | AssetSummary).carrier?.operational_status
          const life = fleetMemberStyle(target.kind, data.operational_status, carrierStatus)
          const active = isActive(data.operational_status) && !isCarrierDeactivated(carrierStatus)
          const second = target.kind === 'carrier'
            ? enablementStyle(data.compliance_summary, active)
            : summaryStyle(data.compliance_summary, active)
          return (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {target.kind === 'asset' && (data as AssetSummary).operation_type && (
                <StatusChip tone="action">{(data as AssetSummary).operation_type}</StatusChip>
              )}
              <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
              <StatusChip tone={second.tone} icon={second.icon}>{second.label}</StatusChip>
            </div>
          )
        })()}
```

- en las tres secciones Documentación (`:250`, `:269`, `:301`), las cifras salen del resumen (D-R9):

```tsx
<DocumentStatusBar documents={data.documents} counts={data.compliance_summary.own} />
```

  y en `CarrierSections`, además, `fleet={data.compliance_summary.fleet}`.

- [ ] **Step 7: `FiltroDeEstado`, `FleetAssignSection` and `TripAssignDialog`**

`FiltroDeEstado.tsx` (`:12-17`):

```tsx
/** La escala del glosario (D1 §6.2). `falta` es el balde del resumen de
 *  Certificación, que junta vencidos y faltantes: se nombra con las dos
 *  palabras en vez de inventar una tercera (D-R12). */
const OPCIONES: { id: EstadoDocumental; etiqueta: string }[] = [
  { id: 'todos',      etiqueta: 'Todo' },
  { id: 'falta',      etiqueta: `${documentStateStyle('OVERDUE').label} o ${documentStateStyle('MISSING').label.toLowerCase()}` },
  { id: 'por_vencer', etiqueta: documentStateStyle('EXPIRING').label },
  { id: 'al_dia',     etiqueta: documentStateStyle('UP_TO_DATE').label },
]
```

`FleetAssignSection.tsx`:
- `FleetAssignValue` suma `carrier_operational_status?: CarrierOperationalStatus | null` (y
  `EMPTY_FLEET_ASSIGN_VALUE` lo pone en `null`).
- `pick` (`:47-63`):

```tsx
  function pick(d: DriverPickCandidate) {
    setQuery('')
    // La empresa se autocompleta tal cual: si no puede recibir viajes, lo dice
    // la API con un 409 (D1 §7.1, D-R10). Antes se descartaba acá en silencio y
    // el viaje se creaba sin empresa, que es lo que la guarda viene a impedir.
    onChange({
      driver_id:        d.driver_id,
      driver_name:      d.driver_name,
      driver_rut:       d.driver_rut,
      driver_phone:     d.driver_phone,
      carrier_id:       d.carrier_id,
      carrier_name:     d.carrier_name,
      carrier_operational_status: d.carrier_operational_status ?? null,
      tractor_asset_id: d.tractor_asset_id,
      tractor_plate:    d.tractor_plate,
      trailer_plate:    value.trailer_plate,
    })
  }
```

- debajo del input "Empresa de transporte" (`:92`):

```tsx
          {value.carrier_operational_status && value.carrier_operational_status !== 'ACTIVE' && (() => {
            const s = lifecycleStyle('carrier', value.carrier_operational_status)
            return <div className="mt-1"><StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip></div>
          })()}
```

`lib/api/trips.ts`:

```ts
/** La respuesta de una asignación que salió bien, con el aviso si la empresa no
 *  está habilitada (D1 §7.1). Un rechazo llega como ApiError 409 con
 *  `detail = {code, message}`. */
export type WithWarnings<T> = T & { warnings?: AssignmentWarning[] }
```

`create` y `assignFleetLink` pasan a `apiFetch<WithWarnings<Trip>>`, y `assignDriver` y `bulkCreate` a
`WithWarnings<…>` de su forma actual.

`TripAssignDialog.tsx`:
- estado: `const [createdWithWarnings, setCreatedWithWarnings] = useState<WithWarnings<Trip> | null>(null)`, que vuelve a
  `null` en el efecto de apertura (`:75-84`).
- en `handleCreate` (`:158-160`):

```tsx
      const created = await tripsApi.create(payload)
      // Se asignó, pero la empresa no está habilitada: decirlo ANTES de seguir,
      // no en un toast que se pierde al navegar (P14 abierta: bloquear después
      // es una línea en la API).
      if (created.warnings?.length) { setCreatedWithWarnings(created); return }
      onCreated(created)
      onClose()
```

- en el cuerpo del diálogo, cuando `createdWithWarnings` no es `null`, en lugar del formulario:

```tsx
          <div role="status" className="p-6 space-y-3">
            <p className="text-lectura font-semibold text-text-primary">Viaje creado.</p>
            {createdWithWarnings.warnings!.map(w => (
              <p key={w.code} className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-dato text-warning">{w.message}</p>
            ))}
            <button type="button" onClick={() => { onCreated(createdWithWarnings); onClose() }}
                    className="rounded-md bg-accent px-3.5 py-2 text-dato font-semibold text-white hover:bg-accent/90">
              Continuar
            </button>
          </div>
```

- el 409 ya llega como `e.message` (`client.ts:43-47`) y se muestra en `err`. No hace falta código nuevo: el test lo fija.

- [ ] **Step 8: Run the tests and the ratchets**

Run: `cd monitor-app/frontend && npx vitest run lib components/dashboard components/compliance components/ui "app/dashboard/carriers" "app/dashboard/compliance" && grep -rn "ChipDeBaja\|compliance_health ===" app components`
Expected: PASS. El grep no encuentra nada.
- Etiquetas: 14 → **1**: queda el embudo (`CertificationFunnel.tsx:52`, Task 14). Bajar `DEUDA`.
- Recálculo: 21 → **3**: queda `CertificationStatusTable.tsx`, de la Task 14. Bajar `DEUDA`.
- `sistema` y `escala` bajan (pills `red/green` y `text-[10px]` de tarjetas y tabla): bajar los dos topes al número real,
  con su línea de comentario.

- [ ] **Step 9: Verificar que la mutación mata el test**

1. En `filteredDrivers`, volver a `d.tax_id.includes(driverQ)`. Tiene que fallar `un RUT con puntos encuentra al
   conductor…`. Restaurar.
2. En `canonicalRut`, quitar la comparación del DV (devolver siempre `${body}-${dv}`). Tiene que fallar `RUT: con o sin
   puntos…` (`12.345.678-9`). Restaurar.
3. En `FleetAssignSection.pick`, volver a `carrier_id: (d.carrier_operational_status ?? 'ACTIVE') === 'ACTIVE' ? d.carrier_id : null`.
   Tiene que fallar `autocompleta la empresa aunque no esté activa…`. Restaurar.
4. En `carriers/page.tsx`, dibujar los tiles también con `tab !== 'active'`. Tiene que fallar `una empresa dada de baja no
   cuenta como "No habilitada"…`. Restaurar.

- [ ] **Step 10: Commit**

```bash
git add monitor-app/frontend/lib monitor-app/frontend/components monitor-app/frontend/app
git commit -m "feat(directorio): lista, roster y vista rápida con una sola respuesta

Las empresas activas se filtran por Habilitada / No habilitada (API); las
dadas de baja no se ven en rojo. Conductores y equipos muestran el par ciclo
de vida + resumen documental. La vista rápida suma la flota activa. RUT y
patente se comparan sin adornos. La asignación deja decidir a la API y
muestra su rechazo o su aviso (D1, Task 13).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

#### Notas para el orquestador

- **Orden:** T11 → T12 → T13, sin paralelismo: tocan los mismos archivos (`carriers/[id]/page.tsx`, `lib/types.ts`,
  `TransporterCard.tsx`).
- **D-R6 y D-R7 tienen que estar en el despliegue 1**, o T12 y T13 no cierran como están escritas. Sin D-R7 falla
  `DocumentChecklist` en los paneles de conductor y equipo. Sin D-R6 fallan las pestañas del Directorio.
- **Para la Task 14:**
  - quedan 1 etiqueta (`CertificationFunnel.tsx:52`) y 3 lecturas (`CertificationStatusTable.tsx:179-184`, que lee
    `pending_mandatory`); su tarea las lleva a 0;
  - `alertSeverityStyle` existe y está probada, pero ninguna pantalla de la Parte D la pinta. Su primer lector natural es
    `PendingDocsBadge` (Monitor).
- **Para la Task 16:** cambiar los dos `toBeLessThanOrEqual(DEUDA)` de `lib/states.guard.test.ts` por `toEqual([])`, y
  borrar de `lib/types.ts` los tipos que el backend retira (`compliance_health`, `pending_mandatory`, `urgencia`,
  `is_expired` e `is_expiring_soon`), junto con `health` en `CarrierListParams`.

---

### Task 14: Embudo, Monitor, Configuración y Sin clasificar

**Files:**
- Modify: `monitor-app/frontend/lib/states.ts` (+ `lib/states.test.ts`), `components/ui/StatusChip.tsx`
- Create (si no existe uno de la Task 13): `monitor-app/frontend/components/ui/ComplianceCounts.tsx` (+ test)
- Modify: `components/compliance/CertificationFunnel.tsx:1-261` (+ test), `app/dashboard/compliance/page.test.tsx:50-61`,
  `components/compliance/DirectorioResumen.tsx:37-42`
- Modify: `components/ui/PendingDocsBadge.tsx:13-61` (+ test), `components/dashboard/TripTable.tsx:250,284,293,507,524,554`,
  `components/dashboard/GestionPanel.tsx:330-372,419` (+ `TripDetailView.test.tsx:315-365`)
- Modify: `app/dashboard/admin/settings/umbrales-tabs.tsx:11-92` (+ test), `lib/api/config.ts:32-36`
- Modify (backend): `monitor-app/backend/api/app/routers/config.py:224-266`, `app/services/revisiones.py:78-81`,
  `app/services/vencimientos.py:50-53`, `tests/test_revisiones.py:186-194`
- Create (backend): `monitor-app/backend/api/tests/test_alert_thresholds_global_only.py`
- Modify: `components/compliance/PuenteALaBandeja.tsx:40`, `TriageWorkbench.tsx:244-245`, `TriageDropzone.tsx:63,99,107`,
  `components/dashboard/TripAssignDialog.tsx:335`, `sections/FlotaDelDiaSection.tsx:818`,
  `app/dashboard/carriers/[id]/page.tsx:423` (+ los tests que afirman esos textos)
- Create: `monitor-app/frontend/lib/copy/module-names.test.ts`
- Modify: `lib/ui/sistema.test.ts` (tope)

**Interfaces:**
- Consumes:
  - `ComplianceSummary`, `documentStateStyle`, `enablementStyle`, `lifecycleStyle`, `alertSeverityStyle` y
    `CARRIER_LIFECYCLE_GROUP_LABELS` de `lib/states.ts` (Task 11);
  - `funnel_bucket` y `compliance_summary` en las filas de `GET /compliance-records/status?group=carrier`;
  - `*_has_critical_alert` y `carrier_can_operate` en `GET /trips` (R-E1; la Task 7 incluye los códigos críticos del
    conductor, R-E5);
  - la constante de la fila global de `fleet_compliance.alert_severity_sql` (Task 4), si existe.
- Produces:
  - En `lib/states.ts`:
    ```ts
    export const FUNNEL_BUCKET_ORDER: FunnelBucket[]   // FunnelBucket viene de lib/types.ts (Task 11)
    export function funnelBucketStyle(b: FunnelBucket): StateStyle
    export function enablementStyleFromFlag(canOperate: boolean, lifecycleActive: boolean): StateStyle
    ```
  - `STATUS_TONE_CLASS: Record<StatusTone, string>` en `StatusChip.tsx`.
  - `ComplianceCounts({ summary, muted? })`.
  - `GLOBAL_ALERT_THRESHOLD`, en Python (`app/services/vencimientos.py`) y en TS (`lib/api/config.ts`).

Antes de empezar:
- `grep -rn "documento_por_vencer" monitor-app/backend/api/app`: si la Task 4 ya creó una constante para la fila global, se
  usa esa y no se crea `GLOBAL_ALERT_THRESHOLD`.
- `grep -rln "compliance_summary" monitor-app/frontend/components`: si la Task 13 ya tiene un componente de cifras
  exportable, se usa ese en lugar de crear `ComplianceCounts` (una variante es una prop).
- `grep -n "CARRIER_LIFECYCLE_GROUP_LABELS" monitor-app/frontend/lib/states.ts` para ver la forma exacta que dejó la
  Task 11 (R-E8). Abajo se asume un `Record` por grupo (`ACTIVE`, `INACTIVE`, `ONBOARDING`); si la forma es otra, se
  adaptan solo las tres lecturas.

#### Parte A: el embudo de Certificación

- [ ] **Step 1: Write the failing tests**

En `components/compliance/CertificationFunnel.test.tsx`:
- el fixture `fila()` suma `compliance_summary` y `funnel_bucket`;
- se reemplazan los tests de grupos y de catálogo ("agrupa por etapa…", "nombra los grupos…", "respeta el orden…", "un grupo
  vacio…", los siete del catálogo y "sin coincidencias activas…") por los de abajo;
- los de la fila se quedan (avance, actividad, rojo reservado, gestión, mixta, enlace).

```tsx
import type { CertificationStatusRow } from '@/lib/types'   // funnel_bucket y compliance_summary: Task 11
import type { ComplianceSummary } from '@/lib/states'

const RESUMEN: ComplianceSummary = {
  worst_state: 'MISSING', can_operate: false,
  own: { overdue: 0, expiring: 0, missing: 2 }, fleet: { overdue: 1, expiring: 0, missing: 3 },
}

function fila(over: Partial<CertificationStatusRow> = {}): CertificationStatusRow {
  return {
    entity_id: 'c1', entity_name: 'Transportes Charlotte Spa',
    carrier_id: 'c1', carrier_name: 'Transportes Charlotte Spa',
    operational_status: 'ACTIVE',
    total_count: 93, satisfied_count: 3, pending_count: 90,
    pending_mandatory: 88, unclassified_count: 0,
    management_types: ['TRACTOREO'], trips_30d: 0,
    funnel_bucket: 'not_enabled', compliance_summary: RESUMEN,
    ...over,
  }
}

  it('agrupa las empresas activas por su balde y nombra la cantidad', () => {
    setup({ rows: [
      fila({ entity_id: 'a', entity_name: 'Nogales', funnel_bucket: 'not_enabled' }),
      fila({ entity_id: 'b', entity_name: 'Charlotte', funnel_bucket: 'expiring' }),
      fila({ entity_id: 'c', entity_name: 'Parras', funnel_bucket: 'expiring' }),
    ] })
    expect(within(screen.getByTestId('grupo-expiring')).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByTestId('grupo-not_enabled')).getByText('1')).toBeInTheDocument()
  })

  // Spec §3: los baldes hablan el glosario. Ninguno nombra el ciclo de vida.
  it('los grupos usan las palabras del glosario y ninguno es "No activas"', () => {
    setup({ rows: [] })
    for (const titulo of ['No habilitada', 'Por vencer', 'Al día']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(titulo) })).toBeInTheDocument()
    }
    for (const viejo of ['No activas', 'Sin documentos', 'Incompletas', 'Con vencimientos']) {
      expect(screen.queryByText(viejo)).not.toBeInTheDocument()
    }
  })

  it('primero lo que no deja operar, después lo que vence, al final lo que está al día', () => {
    setup({ rows: [fila({ funnel_bucket: 'up_to_date' })] })
    expect(screen.getAllByTestId(/^grupo-/).map(e => e.dataset.testid)).toEqual([
      'grupo-not_enabled', 'grupo-expiring', 'grupo-up_to_date',
    ])
  })

  // Conflicto 1 de la auditoría: el ciclo de vida es un filtro, no un balde.
  it('el ciclo de vida es un filtro con las pestañas del Directorio, y arranca en Activas', () => {
    setup()
    const filtro = screen.getByRole('group', { name: 'Ciclo de vida' })
    expect(within(filtro).getByRole('button', { name: /Activas/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(filtro).getByRole('button', { name: /En onboarding/ })).toBeInTheDocument()
    expect(within(filtro).getByRole('button', { name: /Dadas de baja/ })).toBeInTheDocument()
    expect(screen.queryByTestId('grupo-catalogo')).not.toBeInTheDocument()
  })

  // R-E2: una no activa con archivos sin clasificar llega en el alcance activo,
  // pero nunca cae en "No habilitada".
  it('una empresa no activa nunca cae en un balde, aunque llegue en el alcance activo', () => {
    setup({ rows: [
      fila({ entity_id: 'x', entity_name: 'Baja Con Archivos', operational_status: 'INACTIVE',
             funnel_bucket: 'not_enabled', unclassified_count: 3 }),
    ] })
    expect(screen.queryByText('Baja Con Archivos')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('grupo-not_enabled')).getByText('0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dadas de baja/ }))
    expect(screen.getByText('Baja Con Archivos')).toBeInTheDocument()
  })

  // R-E2: ONBOARDING sigue en el alcance activo (decisión del usuario), sin balde.
  it('una empresa en onboarding se ve en su pestaña sin pedir el catálogo, y nunca en un balde', () => {
    const p = setup({ rows: [
      fila({ entity_id: 'o', entity_name: 'Recién Creada', operational_status: 'ONBOARDING', funnel_bucket: null }),
    ] })
    expect(screen.queryByText('Recién Creada')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /En onboarding/ })).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: /En onboarding/ }))
    expect(screen.getByText('Recién Creada')).toBeInTheDocument()
    expect(p.onExpandCatalog).not.toHaveBeenCalled()
  })

  it('elegir Dadas de baja pide el catálogo, y si falla lo dice y deja reintentar', () => {
    const p = setup({ catalogEstado: 'error' })
    fireEvent.click(screen.getByRole('button', { name: /Dadas de baja/ }))
    expect(p.onExpandCatalog).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo cargar/)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(p.onExpandCatalog).toHaveBeenCalledTimes(2)
  })

  it('el catálogo sin pedir no inventa un cero en su pestaña', () => {
    setup()
    expect(screen.getByRole('button', { name: /Dadas de baja/ })).not.toHaveTextContent(/\d/)
  })

  // Spec §3: la empresa no activa se muestra en gris y con su ciclo de vida.
  it('en Dadas de baja la fila dice su ciclo de vida y la habilitación va en gris', () => {
    setup({ catalogEstado: 'listo', catalogRows: [
      fila({ entity_id: 'v', entity_name: 'Vieja Ltda', operational_status: 'LEGACY_INACTIVE', funnel_bucket: null }),
    ] })
    fireEvent.click(screen.getByRole('button', { name: /Dadas de baja/ }))
    const enlace = screen.getByRole('link', { name: /Vieja Ltda/ })
    expect(within(enlace).getByText('Dada de baja')).toBeInTheDocument()
    expect(enlace.innerHTML).not.toMatch(/status-incidente/)
  })

  // Spec §1: las cifras de la empresa son las de Pendientes, lo propio más la flota.
  it('las cifras de la fila salen de compliance_summary, propias más flota', () => {
    setup({ rows: [fila()] })
    const enlace = screen.getByRole('link', { name: /Transportes Charlotte Spa/ })
    expect(within(enlace).getByTestId('counts-overdue')).toHaveTextContent('1')
    expect(within(enlace).getByTestId('counts-expiring')).toHaveTextContent('0')
    expect(within(enlace).getByTestId('counts-missing')).toHaveTextContent('5')
  })

  it('"Al día" arranca plegado y los otros dos abiertos', () => {
    setup()
    expect(screen.getByTestId('grupo-up_to_date')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('grupo-not_enabled')).toHaveAttribute('aria-expanded', 'true')
  })
```

En `app/dashboard/compliance/page.test.tsx` (`:50-61`), `FILA`: se reemplaza `funnel_group: 'en_proceso'` por
`funnel_bucket: 'not_enabled'` y
`compliance_summary: { worst_state: 'MISSING', can_operate: false, own: { overdue: 0, expiring: 0, missing: 1 }, fleet: { overdue: 0, expiring: 0, missing: 0 } }`.
Se quita `expired_count`. El comentario `:55-57` pasa a decir `funnel_bucket`.

En `components/compliance/DirectorioResumen.test.tsx` (o el test que hoy afirma "inactivas"; crearlo si no existe, con el
mock de `carriersApi.directorio` del test vecino):

```tsx
  it('nombra el ciclo de vida con el glosario: "dadas de baja", nunca "inactivas"', async () => {
    vi.mocked(carriersApi.directorio).mockResolvedValue({
      empresas: { total: 251, activas: 36, inactivas: 214, onboarding: 1 },
      flota: { tractos: 1, ramplas: 1, conductores: 78 },
    } as never)
    renderConQuery(<DirectorioResumen />)
    expect(await screen.findByText(/214 dadas de baja/)).toBeInTheDocument()
    expect(screen.queryByText(/inactivas/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/compliance/CertificationFunnel.test.tsx components/compliance/DirectorioResumen.test.tsx app/dashboard/compliance/page.test.tsx`

Expected: FAIL por estos motivos:
- no existen los grupos `not_enabled`, `expiring` ni `up_to_date`;
- no existe el filtro "Ciclo de vida";
- `grupo-catalogo` sigue presente;
- la fila no tiene `counts-*`;
- el resumen dice "inactivas".

`tsc` marca `FUNNEL_BUCKET_ORDER` y `funnelBucketStyle` como inexistentes en `lib/states.ts`. Ese error es esperado; uno
sobre `funnel_bucket` o `compliance_summary` en `CertificationStatusRow` no lo es (la Task 11 ya los agregó) y se reporta.

- [ ] **Step 3: Implement**

`lib/types.ts` no se toca aquí: la Task 11 ya definió `FunnelBucket` (`'up_to_date' | 'expiring' | 'not_enabled'`),
`funnel_bucket?: FunnelBucket | null` y `compliance_summary?` en `CertificationStatusRow`. Esta tarea los importa de
`@/lib/types`.

`lib/states.ts` (aditivo, R-E9):

```ts
/** Los baldes del embudo de Certificación, en el orden en que se trabajan.
 *  No tienen palabras propias: son las del glosario (§3). (El import va arriba del archivo.) */
import type { FunnelBucket } from '@/lib/types'   // definido por la Task 11; no se redefine
export const FUNNEL_BUCKET_ORDER: FunnelBucket[] = ['not_enabled', 'expiring', 'up_to_date']

export function funnelBucketStyle(bucket: FunnelBucket): StateStyle {
  if (bucket === 'not_enabled') return enablementStyleFromFlag(false, true)
  return documentStateStyle(bucket === 'expiring' ? 'EXPIRING' : 'UP_TO_DATE')
}

```

Notas:
- `enablementStyleFromFlag(canOperate, lifecycleActive)` lee la misma tabla que `enablementStyle`. Si la Task 11 no lo tiene,
  `enablementStyle(summary, active)` pasa a ser `enablementStyleFromFlag(summary.can_operate, active)`.
- Las etiquetas plurales de las pestañas son las de `CARRIER_LIFECYCLE_GROUP_LABELS` (Task 11): el embudo no escribe
  ninguna.

`components/ui/ComplianceCounts.tsx` (crear solo si la Task 13 no dejó uno equivalente):

```tsx
import type { ComplianceSummary, DocumentState, StateCounts } from '@/lib/states'
import { documentStateStyle } from '@/lib/states'

const ORDEN: { key: keyof StateCounts; state: DocumentState }[] = [
  { key: 'overdue', state: 'OVERDUE' },
  { key: 'expiring', state: 'EXPIRING' },
  { key: 'missing', state: 'MISSING' },
]

/** Las cifras de quien debe los documentos: lo propio más su flota activa.
 *  Son las mismas que la fila de la empresa en Pendientes (spec §1); acá solo
 *  se suman las dos mitades, no se decide ningún estado. */
export function ComplianceCounts({ summary, muted = false }: { summary: ComplianceSummary; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-etiqueta tabular-nums ${muted ? 'text-informativo' : 'text-text-primary'}`}>
      {ORDEN.map(({ key, state }) => {
        const { label, icon: Icon } = documentStateStyle(state)
        const n = summary.own[key] + (summary.fleet?.[key] ?? 0)
        return (
          <span key={key} data-testid={`counts-${key}`} title={label} className="inline-flex items-center gap-1">
            <Icon size={12} aria-hidden="true" />
            <span className="sr-only">{label}: </span>{n}
          </span>
        )
      })}
    </span>
  )
}
```

Con su test (`ComplianceCounts.test.tsx`): suma propio más flota, `fleet: null` cuenta solo lo propio y el `title` es la
etiqueta del glosario.

`components/compliance/CertificationFunnel.tsx`: se reescribe. Los props son los mismos, así que la página no cambia.

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { CertificationStatusRow, ManagementType } from '@/lib/types'
import type { CarrierOperationalStatus, FunnelBucket } from '@/lib/types'
import {
  CARRIER_LIFECYCLE_GROUP_LABELS, FUNNEL_BUCKET_ORDER,
  funnelBucketStyle, lifecycleStyle, enablementStyleFromFlag,
} from '@/lib/states'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { Estado } from '@/components/ui/Estado'
import { ComplianceCounts } from '@/components/ui/ComplianceCounts'

interface Props {
  /** El alcance `active`: empresas activas más cualquiera con archivos esperando. */
  rows:            CertificationStatusRow[]
  /** El complemento (`scope=catalog`), que se pide recién al elegir un ciclo de vida no activo. */
  catalogRows:     CertificationStatusRow[]
  catalogEstado:   'sin-pedir' | 'cargando' | 'listo' | 'error'
  onExpandCatalog: () => void
}

/** Qué códigos agrupa cada pestaña. Las etiquetas son las de la Task 11
 *  (R-E8): acá solo se agrupan códigos. INACTIVE y LEGACY_INACTIVE se muestran
 *  igual (§3). `fromCatalog`: la pestaña necesita el catálogo; ONBOARDING no,
 *  porque sigue en el alcance activo (R-E2, decisión del usuario). */
const LIFECYCLE_TABS: { id: 'active' | 'onboarding' | 'inactive'; label: string;
                        status: CarrierOperationalStatus[]; fromCatalog: boolean }[] = [
  { id: 'active',     label: CARRIER_LIFECYCLE_GROUP_LABELS.ACTIVE,     status: ['ACTIVE'],                      fromCatalog: false },
  { id: 'onboarding', label: CARRIER_LIFECYCLE_GROUP_LABELS.ONBOARDING, status: ['ONBOARDING'],                  fromCatalog: false },
  { id: 'inactive',   label: CARRIER_LIFECYCLE_GROUP_LABELS.INACTIVE,   status: ['INACTIVE', 'LEGACY_INACTIVE'], fromCatalog: true },
]

type LifecycleTab = (typeof LIFECYCLE_TABS)[number]

/** El embudo de certificación (D1).
 *
 *  Dos ejes que no se mezclan (spec §2, E-b):
 *  - el CICLO DE VIDA es un filtro arriba — Activas, En onboarding, Dadas de
 *    baja —, con las mismas pestañas que el Directorio;
 *  - entre las activas, el BALDE sale de `funnel_bucket`, que calcula la API
 *    con la misma regla que Pendientes. Este componente no decide ningún estado.
 *
 *  Antes "No activas" era un quinto balde y mezclaba el ciclo de vida con los
 *  documentos (conflicto 1 de la auditoría de estados). */
export function CertificationFunnel({ rows, catalogRows, catalogEstado, onExpandCatalog }: Props) {
  const [tab, setTab] = useState<LifecycleTab>(LIFECYCLE_TABS[0])
  const [plegados, setPlegados] = useState<Set<FunnelBucket>>(() => new Set<FunnelBucket>(['up_to_date']))

  const esActiva = (r: CertificationStatusRow) => r.operational_status === 'ACTIVE'
  const activas = rows.filter(esActiva)
  // Las no activas llegan por dos caminos: el alcance activo (ONBOARDING, y
  // las dadas de baja con archivos esperando) y el catálogo. Son disjuntos por
  // construcción del backend.
  const noActivas = [...rows.filter(r => !esActiva(r)), ...catalogRows]
  const deLaPestaña = (t: LifecycleTab) =>
    noActivas.filter(r => (t.status as string[]).includes(r.operational_status ?? ''))

  function elegir(id: string) {
    const t = LIFECYCLE_TABS.find(x => x.id === id)!
    setTab(t)
    if (t.fromCatalog && catalogEstado !== 'listo' && catalogEstado !== 'cargando') onExpandCatalog()
  }

  const opciones = LIFECYCLE_TABS.map(t => ({
    id: t.id,
    label: t.label,
    // Un cero sin haber preguntado se lee como "no hay ninguna" (regresión ya vista con el catálogo).
    badge: t.id === 'active' ? String(activas.length)
      : !t.fromCatalog || catalogEstado === 'listo' ? String(deLaPestaña(t).length) : undefined,
  }))

  return (
    <div>
      <div className="px-4 py-2.5 border-b border-border">
        <SegmentedControl label="Ciclo de vida" options={opciones} value={tab.id} onChange={elegir} />
      </div>

      {tab.status.includes('ACTIVE') ? (
        FUNNEL_BUCKET_ORDER.map(bucket => {
          const { label, icon: Icono, tone } = funnelBucketStyle(bucket)
          const delBalde = activas.filter(r => r.funnel_bucket === bucket)
          const plegado = plegados.has(bucket)
          return (
            <section key={bucket}>
              <h2>
                <button
                  type="button"
                  data-testid={`grupo-${bucket}`}
                  aria-expanded={!plegado}
                  onClick={() => setPlegados(prev => {
                    const next = new Set(prev)
                    if (next.has(bucket)) next.delete(bucket); else next.add(bucket)
                    return next
                  })}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-border cursor-pointer transition-colors hover:bg-bg-main"
                >
                  <ChevronRight size={15} aria-hidden="true"
                                className={`shrink-0 transition-transform ${plegado ? '' : 'rotate-90'}`} />
                  <Icono size={14} className="shrink-0" aria-hidden="true" />
                  <span className="text-lectura font-bold text-text-primary">{label}</span>
                  <span className="ml-auto">
                    <StatusChip tone={delBalde.length ? tone : 'neutral'}>{delBalde.length}</StatusChip>
                  </span>
                </button>
              </h2>
              {!plegado && (delBalde.length
                ? <div className="pl-6 border-l-2 border-border">{delBalde.map(r => <FilaEmpresa key={r.entity_id} row={r} />)}</div>
                : <p className="px-4 py-2 text-etiqueta text-informativo border-b border-border">Ninguna</p>)}
            </section>
          )
        })
      ) : tab.fromCatalog && (catalogEstado === 'cargando' || catalogEstado === 'sin-pedir') ? (
        <Estado tipo="cargando" />
      ) : tab.fromCatalog && catalogEstado === 'error' ? (
        <Estado tipo="error" titulo="No se pudo cargar esta lista" detalle="Las empresas siguen guardadas.">
          <button type="button" onClick={onExpandCatalog}
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
            Reintentar
          </button>
        </Estado>
      ) : deLaPestaña(tab).length ? (
        <div>{deLaPestaña(tab).map(r => <FilaEmpresa key={r.entity_id} row={r} />)}</div>
      ) : (
        <Estado tipo="vacio" titulo="Ninguna empresa en este ciclo de vida" />
      )}
    </div>
  )
}
```

Notas:
- `FilaEmpresa` conserva el enlace, la gestión, la marca de actividad, la barra, "N de M" y el contador de archivos
  esperando. Cambia esto:
  - la barra pinta `bg-resuelto` con `row.funnel_bucket === 'up_to_date'`, ya no recalcula `pending_count === 0`;
  - suma `{row.compliance_summary && <ComplianceCounts summary={row.compliance_summary} muted={!activa} />}`;
  - cuando la fila no es activa, suma dos chips: `lifecycleStyle('carrier', row.operational_status)` y
    `enablementStyleFromFlag(row.compliance_summary?.can_operate ?? false, false)` (gris), los dos con `StatusChip` y su
    `tone`;
  - los `text-gray-400/500` y `hover:bg-gray-50` de la fila pasan a `text-informativo` y `hover:bg-bg-main`.
- Se borran `GESTION` y `etiquetaGestion` **solo si** la Task 13 dejó las etiquetas de gestión en un lugar compartido. Si no,
  se quedan; no es parte de esta tarea.
- `DirectorioResumen.tsx:37-42`: se reemplaza `{activas} activas · {inactivas} inactivas · {onboarding} en onboarding` por
  los rótulos de `CARRIER_LIFECYCLE_GROUP_LABELS` en minúscula (`${n} ${label.toLowerCase()}`): activas, dadas de baja y,
  si hay, en onboarding. Los campos de la API (`empresas.inactivas`) no cambian de nombre.

- [ ] **Step 4: Run the tests**

Run: `cd monitor-app/frontend && npx vitest run components/compliance app/dashboard/compliance components/ui lib/states.test.ts`

Expected: PASS.

- [ ] **Step 5: Verificar que la mutación mata el test**

Cambiar en `CertificationFunnel.tsx` `const activas = rows.filter(esActiva)` por `const activas = rows`, correr el test y ver
FAIL en "una empresa no activa nunca cae en un balde…". Restaurar. Registrar la mutación en el ledger de D1.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance monitor-app/frontend/components/ui monitor-app/frontend/lib/states.ts \
        monitor-app/frontend/lib/states.test.ts monitor-app/frontend/app/dashboard/compliance
git commit -m "feat(certificacion): el embudo balda por habilitación y filtra por ciclo de vida

Los baldes salen de funnel_bucket (No habilitada, Por vencer, Al día) y el
ciclo de vida pasa a filtro con las pestañas del Directorio: desaparece
\"No activas\". Cada fila muestra las cifras de compliance_summary, las
mismas que Pendientes (D1, despliegue 2).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

#### Parte B: el semáforo del Monitor

- [ ] **Step 7: Write the failing tests**

En `components/ui/PendingDocsBadge.test.tsx`, el test `uses red tone when critical, amber otherwise` se reemplaza por:

```tsx
  // D1: el rojo es el aviso crítico (días que faltan contra el umbral), con
  // el tono y el ícono del glosario; nada de colores escritos a mano.
  it('crítico usa el tono urgente del glosario; si no, el de aviso', () => {
    const { container: critical } = render(<PendingDocsBadge count={2} critical compact />)
    const { container: normal } = render(<PendingDocsBadge count={2} compact />)
    expect(critical.querySelector('span')?.className).toContain('text-status-incidente')
    expect(normal.querySelector('span')?.className).toContain('text-warning')
    expect(critical.innerHTML).not.toMatch(/red-|amber-/)
    expect(normal.innerHTML).not.toMatch(/red-|amber-/)
  })

  it('el título nombra el aviso crítico cuando lo hay', () => {
    render(<PendingDocsBadge count={2} critical label="Conductor" compact />)
    expect(screen.getByTitle(/Conductor: 2 documento\(s\) pendiente\(s\) · Crítico/)).toBeInTheDocument()
  })
```

(La etiqueta "Crítico" es `alertSeverityStyle('critical').label`. Si la Task 11 la escribió distinta, el test usa esa
etiqueta importada, no un texto nuevo.)

En `components/dashboard/TripDetailView.test.tsx` (`:327-365`), se reemplazan los tres tests de la licencia y el del
desajuste:

```tsx
  // R-E5: la Task 7 pone driver_has_critical_alert en true cuando falta o venció
  // la licencia o la cédula (como pidió el usuario el 22/07) o hay un aviso
  // crítico. Es el caso de hoy: licencia faltante.
  it('un conductor sin licencia (driver_has_critical_alert) muestra el banner y lleva al Directorio', () => {
    renderDetailView({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      driver_pending_docs: 2, driver_has_critical_alert: true,
      // El campo viejo ya no decide nada aunque venga.
      driver_pending_docs_critical: false,
    })
    expect(screen.getByText(/licencia o la cédula del conductor falta, venció o vence dentro del plazo crítico/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'revisar en Directorio' })).toHaveAttribute(
      'href', '/dashboard/carriers/c1?tab=conductores',
    )
  })

  it('sin aviso crítico no hay banner, aunque el campo viejo diga lo contrario', () => {
    renderDetailView({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      driver_pending_docs: 2, driver_has_critical_alert: false, driver_pending_docs_critical: true,
    })
    expect(screen.queryByText(/licencia o la cédula del conductor/i)).not.toBeInTheDocument()
  })

  // Spec §7.1: la empresa No habilitada se asigna, pero el Monitor lo avisa.
  it('una empresa no habilitada se avisa en el panel, con la palabra del glosario', () => {
    renderDetailView({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_can_operate: false })
    expect(screen.getByText('No habilitada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'revisar en Directorio' })).toHaveAttribute('href', '/dashboard/carriers/c1')
  })

  it('una empresa habilitada o sin dato no muestra el aviso', () => {
    renderDetailView({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_can_operate: null })
    expect(screen.queryByText('No habilitada')).not.toBeInTheDocument()
  })

  it('links "revisar en Directorio" to the conductores tab on a fleet mismatch', () => {
    renderDetailView({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      fleet_match_status: 'MISMATCH', fleet_match_driver_home_carrier: 'Otra Transportista Spa',
    })
    expect(screen.getByRole('link', { name: 'revisar en Directorio' })).toHaveAttribute(
      'href', '/dashboard/carriers/c1?tab=conductores',
    )
  })
```

En `TripTable.test.tsx`, un caso nuevo junto a los de `:147-160`:

```tsx
  // R-E5: el caso real de hoy es la licencia faltante; la API lo manda como driver_has_critical_alert.
  it('el badge del conductor se pone urgente con driver_has_critical_alert, no con el campo viejo', () => {
    render(<TripTable trips={[makeTrip('t1', { driver_pending_docs: 2, driver_has_critical_alert: true, driver_pending_docs_critical: false })]}
                      selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} sortKey={null} sortDir="asc" onSort={vi.fn()} />)
    expect(screen.getByTitle(/Conductor: 2/).className).toContain('text-status-incidente')
  })
```

- [ ] **Step 8: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run components/ui/PendingDocsBadge.test.tsx components/dashboard/TripDetailView.test.tsx components/dashboard/TripTable.test.tsx`

Expected: FAIL por estos motivos:
- el badge usa `bg-red-100` y `bg-amber-50`;
- el banner sigue leyendo `driver_pending_docs_critical` y dice "revisar en Empresas";
- no hay aviso de "No habilitada";
- (si `tsc` marca `driver_has_critical_alert` o `carrier_can_operate` como desconocidos en `Trip`, falta la Task 11: se
  para y se reporta, no se agregan aquí).

- [ ] **Step 9: Implement**

`lib/types.ts` no se toca: la Task 11 ya agregó a `Trip` `driver_has_critical_alert`, `tractor_has_critical_alert`,
`carrier_has_critical_alert` y `carrier_can_operate` (todos `?: boolean | null`, nombres de R-E1).

`components/ui/StatusChip.tsx`: `const TONE` pasa a `export const STATUS_TONE_CLASS` (mismo contenido) y `StatusChip` lo
lee.

`components/ui/PendingDocsBadge.tsx`:

```tsx
'use client'

import { alertSeverityStyle } from '@/lib/states'
import { STATUS_TONE_CLASS } from './StatusChip'

/** (se conserva el comentario de cabecera; se reemplaza la última frase:)
 *  D1: `critical` lo calcula la API (`*_has_critical_alert`): aviso crítico por
 *  días contra el umbral de Configuración o, en el conductor, licencia o cédula
 *  pendiente (R-E5). Este componente no conoce ningún código.
 *  El tono y el ícono salen del glosario (`alertSeverityStyle`). */
export function PendingDocsBadge({ count, critical, compact = false, label }: Props) {
  if (!count) return null
  const style = alertSeverityStyle(critical ? 'critical' : 'warning')
  const Icon = style.icon
  const tono = STATUS_TONE_CLASS[style.tone]
  const base = label ? `${label}: ${count} documento(s) pendiente(s)` : `${count} documento(s) pendiente(s)`
  const title = critical ? `${base} · ${style.label}` : base

  if (compact) {
    return (
      <span title={title}
            className={`inline-flex items-center gap-0.5 justify-center h-4 px-1 rounded-full text-etiqueta font-bold shrink-0 ${tono}`}>
        <Icon size={8} aria-hidden="true" /> {count}
      </span>
    )
  }
  return (
    <span title={title}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-etiqueta font-semibold whitespace-nowrap ${tono}`}>
      <Icon size={9} aria-hidden="true" /> {label ? `${label}: ` : ''}{count} pendiente{count === 1 ? '' : 's'}
    </span>
  )
}
```

Llamadores:
- `TripTable.tsx:250,284,293,507,524,554` y `GestionPanel.tsx:330-332`: `critical={trip.X_pending_docs_critical}` pasa a
  `critical={trip.X_has_critical_alert}`.

`GestionPanel.tsx:354-362`, el banner:

```tsx
              {trip.driver_has_critical_alert && (
                <Notice tone="urgent" icon={<FileWarning size={13} className="mt-px shrink-0" aria-hidden />}>
                  <p>
                    {alertSeverityStyle('critical').label}: la licencia o la cédula del conductor falta, venció o vence dentro
                    del plazo crítico, o hay otro documento suyo en aviso crítico —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="font-semibold underline">
                      revisar en Directorio
                    </a>.
                  </p>
                </Notice>
              )}
              {trip.carrier_can_operate === false && (
                <Notice tone="warning">
                  <p className="flex items-center gap-1.5 flex-wrap">
                    <StatusChip tone={enablementStyleFromFlag(false, true).tone}>{enablementStyleFromFlag(false, true).label}</StatusChip>
                    La empresa no está habilitada para operar; el viaje se puede asignar igual —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}`} className="font-semibold underline">revisar en Directorio</a>.
                  </p>
                </Notice>
              )}
```

(El test busca `getByText('No habilitada')`. Si el chip y el texto quedan en el mismo nodo, el implementador ajusta el
selector a `within(chip)` y lo reporta.)

`GestionPanel.tsx:369` y `:419`: "revisar en Empresas" y "Empresas" pasan a "revisar en Directorio" y "Directorio" (se
cubre en la Parte D).

- [ ] **Step 10: Run the tests**

Run: `cd monitor-app/frontend && npx vitest run components/ui components/dashboard/TripDetailView.test.tsx components/dashboard/TripTable.test.tsx lib/ui`

Expected:
- los tests de esta parte pasan;
- `lib/ui/sistema.test.ts` falla **a la baja**: hay menos colores crudos que el tope. Se lee el total del mensaje y se baja
  `DEUDA` (`sistema.test.ts:106`) a ese número, con un comentario que nombre esta tarea. Si el total sube, algo agregó
  colores crudos y se corrige el código, no el tope.

- [ ] **Step 11: Verificar que la mutación mata el test**

En `TripTable.tsx:284`, volver a `critical={trip.driver_pending_docs_critical}`, correr `TripTable.test.tsx` y ver FAIL en
"el badge del conductor se pone urgente con driver_has_critical_alert…". Restaurar.

- [ ] **Step 12: Commit**

```bash
git add monitor-app/frontend/components/ui monitor-app/frontend/components/dashboard monitor-app/frontend/lib/ui
git commit -m "feat(monitor): el semáforo lee el aviso crítico y la habilitación de la API

PendingDocsBadge toma tono e ícono de alertSeverityStyle (sin colores
crudos) y se pone rojo con *_has_critical_alert. El panel avisa cuando la
empresa está No habilitada (spec §7.1). Enlaces \"revisar en Directorio\".

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

#### Parte C: Configuración › Alertas de vencimiento (frontend y backend)

- [ ] **Step 13: Write the failing tests (backend)**

Crear `monitor-app/backend/api/tests/test_alert_thresholds_global_only.py`:

```python
"""Configuración › Alertas de vencimiento: solo el aviso general (D1-R4, R-E3).

Las filas por documento no las lee ninguna lógica (auditoría de estados,
"Hallazgo principal"): la pantalla prometía una alerta roja que nadie
calculaba. Desde el despliegue 2 la API ni las muestra ni las deja editar;
el despliegue 3 las borra.
"""
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.config import router as config_router
from app.services.revisiones import POR_SECCION
from app.services.vencimientos import GLOBAL_ALERT_THRESHOLD
from tests.conftest import usuario

CERT = usuario("certification_supervisor", sub="22222222-2222-2222-2222-222222222222")


def cliente(pool):
    app = FastAPI()
    app.include_router(config_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: CERT
    return TestClient(app)


def test_get_pide_solo_la_fila_global_con_parametro():
    pool = AsyncMock()
    pool.fetch.return_value = []
    assert cliente(pool).get("/api/v1/config/alert-thresholds").status_code == 200
    sql, *args = pool.fetch.call_args.args
    assert "WHERE doc_type = $1" in sql
    assert args == [GLOBAL_ALERT_THRESHOLD]


def test_patch_de_una_fila_por_documento_responde_404_y_no_escribe():
    pool = AsyncMock()
    res = cliente(pool).patch("/api/v1/config/alert-thresholds/license_expiry", json={"warning_days": 10})
    assert res.status_code == 404
    pool.execute.assert_not_called()


@pytest.mark.parametrize("cuerpo", [{"error_days": 30}, {"error_days": 31}, {"warning_days": 5, "error_days": 5}])
def test_patch_rechaza_un_critico_que_no_es_menor_que_el_aviso(cuerpo):
    pool = AsyncMock()
    pool.fetchrow.return_value = {"doc_type": GLOBAL_ALERT_THRESHOLD, "label": "x", "warning_days": 30, "error_days": 0}
    res = cliente(pool).patch(f"/api/v1/config/alert-thresholds/{GLOBAL_ALERT_THRESHOLD}", json=cuerpo)
    assert res.status_code == 422
    pool.execute.assert_not_called()


def test_patch_del_aviso_general_con_critico_menor_escribe():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"doc_type": GLOBAL_ALERT_THRESHOLD, "label": "x", "warning_days": 30, "error_days": 0}
    res = cliente(pool).patch(f"/api/v1/config/alert-thresholds/{GLOBAL_ALERT_THRESHOLD}", json={"error_days": 7})
    assert res.status_code == 200
    assert "UPDATE app.alert_thresholds" in " ".join(str(c.args[0]) for c in pool.execute.call_args_list)


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_la_revision_cuenta_solo_el_aviso_general(conexion_revertida):
    """El sujeto lo crea el test: una fila por documento nueva no entra a la
    portada de Configuración como "sin revisar"."""
    conn = conexion_revertida
    await conn.execute(
        "INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days) VALUES ($1, $2, 15, 0)",
        "ZZ-TEST-D1-doc", "ZZ-TEST-D1 documento")
    filas = await conn.fetch(POR_SECCION[("certification", "expiry-alerts")].sql)
    assert [f["id"] for f in filas] == [GLOBAL_ALERT_THRESHOLD]
```

En `tests/test_revisiones.py:186-194`, `test_los_umbrales_de_vencimiento_son_de_certificacion`:
- el `doc_type` del mock y de la URL pasa de `LICENCIA` a `GLOBAL_ALERT_THRESHOLD`;
- `error_days` del mock pasa a 0, para que el 200 no dependa de la validación nueva.

- [ ] **Step 14: Run them to verify they fail**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_alert_thresholds_global_only.py tests/test_revisiones.py -q`

Expected: FAIL por estos motivos:
- `ImportError: GLOBAL_ALERT_THRESHOLD` (este primero; se crea la constante sin cambiar nada más y se corre de nuevo);
- después, el GET sin `WHERE`;
- el PATCH a `license_expiry` responde 200;
- el crítico de 30 pasa;
- la enumeración devuelve también `ZZ-TEST-D1-doc`.

- [ ] **Step 15: Implement (backend)**

`app/services/vencimientos.py:48-53` (o la constante de la Task 4, si existe):

```python
# La fila global de Configuración > Alertas de vencimiento: aviso (warning_days)
# y crítico (error_days). La única que lee la lógica (D1-R4).
GLOBAL_ALERT_THRESHOLD = "documento_por_vencer"

_AVISO_GENERAL = (
    "(SELECT vg_at.warning_days FROM app.alert_thresholds vg_at "
    f"WHERE vg_at.doc_type = '{GLOBAL_ALERT_THRESHOLD}')"
)
```

`app/routers/config.py`:

```python
from ..services.vencimientos import GLOBAL_ALERT_THRESHOLD

@router.get("/alert-thresholds")
async def list_alert_thresholds(pool=Depends(get_pool),
    _permiso=Depends(require(Permission.REFERENCE_READ)),
):
    # Solo el aviso general (D1-R4): las filas por documento no las lee nadie
    # y la pantalla prometía una alerta que no existía. Sigue siendo una lista
    # para no cambiar el contrato del cliente.
    rows = await pool.fetch(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds WHERE doc_type = $1",
        GLOBAL_ALERT_THRESHOLD,
    )
    return [dict(r) for r in rows]


@router.patch("/alert-thresholds/{doc_type}")
async def patch_alert_threshold(doc_type: str, body: AlertThresholdPatch, pool=Depends(get_pool),
    usuario=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
):
    if doc_type != GLOBAL_ALERT_THRESHOLD:
        raise HTTPException(404, "Solo se edita el aviso general de vencimiento")
    existing = await pool.fetchrow(
        "SELECT doc_type, label, warning_days, error_days FROM app.alert_thresholds WHERE doc_type = $1", doc_type)
    if not existing:
        raise HTTPException(404, "Tipo de documento no encontrado")
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")
    # El crítico es un tramo DENTRO del aviso: si no fuera menor, un documento
    # quedaría en aviso crítico antes de estar Por vencer (R-E3).
    aviso = data.get("warning_days", existing["warning_days"])
    critico = data.get("error_days", existing["error_days"])
    if critico >= aviso:
        raise HTTPException(422, "El plazo crítico tiene que ser menor que el aviso")
    # … (UPDATE, SELECT, registrar_revision e invalidate_trips_meta_cache, como hoy)
```

`app/services/revisiones.py:78-81`:

```python
    Revisable("certification", "expiry-alerts",
              # Solo el aviso general (D1-R4): las filas por documento no se
              # muestran, así que no pueden contarse como "sin revisar".
              "SELECT doc_type AS id, label, label || ' ' || doc_type AS buscable, "
              f"doc_type AS abre FROM app.alert_thresholds WHERE doc_type = '{GLOBAL_ALERT_THRESHOLD}'",
              Permission.CERTIFICATION_CONFIGURE),
```

La constante sale del código, no del pedido, así que interpolarla es lo mismo que hace `_AVISO_GENERAL`. Hay que vigilar el
import circular: `revisiones` → `vencimientos` no importa routers.

- [ ] **Step 16: Run the backend tests and verify the mutation**

Run: `cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_alert_thresholds_global_only.py tests/test_revisiones.py tests/test_vigencia_de_documentos.py tests/test_pending_documents_integration.py tests/test_vigencia_esquema.py -q`

Expected: PASS.

Mutación: quitar `WHERE doc_type = '{GLOBAL_ALERT_THRESHOLD}'` de la enumeración revisable, correr y ver FAIL en
`test_integracion_la_revision_cuenta_solo_el_aviso_general`. Restaurar.

- [ ] **Step 17: Write the failing tests (frontend)**

En `app/dashboard/admin/settings/umbrales-tabs.test.tsx`, un `describe` nuevo. El test de solo lectura (`:73-82`) pasa a
la fila global:
- `doc_type: 'documento_por_vencer'`;
- `findByLabelText(/Aviso \(días/)`.

```tsx
const GLOBAL = { doc_type: 'documento_por_vencer', label: 'Aviso general de vencimiento de documentos (días)', warning_days: 30, error_days: 0 }

describe('Alertas de vencimiento: solo el aviso general (D1-R4)', () => {
  // Mientras la API vieja siga en el aire manda las diez filas, ordenadas, y
  // la primera es "circulacion": la pantalla busca la global por su clave.
  it('muestra un solo par de umbrales, el general, aunque lleguen filas por documento', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([
      { doc_type: 'circulacion', label: 'P. Circulación', warning_days: 45, error_days: 0 },
      GLOBAL,
      { doc_type: 'license_expiry', label: 'Licencia de conducir', warning_days: 20, error_days: 0 },
    ])
    render(<AlertasVencimientoTab />)
    expect(await screen.findByLabelText(/Aviso \(días/)).toHaveValue(30)
    expect(screen.getByLabelText(/Crítico \(días/)).toHaveValue(0)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    expect(screen.queryByText('Licencia de conducir')).not.toBeInTheDocument()
    expect(screen.queryByText('P. Circulación')).not.toBeInTheDocument()
  })

  // Conflicto 11: la pantalla prometía una "alerta roja" que nadie calculaba.
  it('describe lo que de verdad pasa con cada umbral', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([GLOBAL])
    render(<AlertasVencimientoTab />)
    expect(await screen.findByText(/se muestra como Por vencer/)).toBeInTheDocument()
    expect(screen.getByText(/no quita la habilitación/)).toBeInTheDocument()
    expect(screen.getByText(/semáforo del Monitor/)).toBeInTheDocument()
    expect(screen.getByText(/licencia o la cédula del conductor/)).toBeInTheDocument()
    expect(screen.queryByText(/alerta roja|alerta amarilla/)).not.toBeInTheDocument()
  })

  it('guarda el crítico del aviso general con su clave', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([GLOBAL])
    vi.mocked(configApi.patchAlertThreshold).mockResolvedValue({ ...GLOBAL, error_days: 7 })
    render(<AlertasVencimientoTab />)
    fireEvent.change(await screen.findByLabelText(/Crítico \(días/), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(configApi.patchAlertThreshold).toHaveBeenCalledWith('documento_por_vencer', { error_days: 7 }))
  })

  it('si la fila global no viene, lo dice como error y no dibuja un formulario vacío', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([])
    render(<AlertasVencimientoTab />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se encontró el aviso general/)
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  })
})
```

(Los rótulos "Aviso" y "Crítico" son las etiquetas de `alertSeverityStyle('warning' | 'critical')`. Si la Task 11 las
escribió distinto, la pantalla y el test usan las de la Task 11.)

- [ ] **Step 18: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run app/dashboard/admin/settings/umbrales-tabs.test.tsx`

Expected: FAIL. Hoy se dibuja una tabla con una fila por documento, sin rótulos "Aviso (días", y el texto promete la alerta
amarilla y la roja.

- [ ] **Step 19: Implement (frontend)**

`lib/api/config.ts`:

```ts
/** La fila global de Configuración › Alertas de vencimiento (D1-R4). La
 *  misma clave que `GLOBAL_ALERT_THRESHOLD` de la API. */
export const GLOBAL_ALERT_THRESHOLD = 'documento_por_vencer'
```

`app/dashboard/admin/settings/umbrales-tabs.tsx`, `AlertasVencimientoTab` (`:13-92`) se reescribe:

```tsx
export function AlertasVencimientoTab() {
  const revisiones = useRevisiones('certification', 'expiry-alerts')
  const puedeEditar = usePuedeEditarSeccion('expiry-alerts')
  const fetcher = useCallback(() => configApi.getAlertThresholds(), [])
  const { items, setItems, loading, error, reload } = useConfigList<AlertThresholdMeta>(fetcher)
  const [draft, setDraft] = useState<Partial<AlertThresholdMeta>>({})
  const fb = useRowFeedback()

  // Por su clave y no "la primera fila" (ver el test): durante el despliegue
  // la API vieja puede mandar las diez.
  const global = items.find(r => r.doc_type === GLOBAL_ALERT_THRESHOLD)
  const m = global ? { ...global, ...draft } : null
  const dirty = Object.keys(draft).length > 0
  const porVencer = documentStateStyle('EXPIRING').label
  const aviso = alertSeverityStyle('warning').label
  const critico = alertSeverityStyle('critical').label

  async function save() {
    if (!global || !dirty) return
    await fb.run(global.doc_type, async () => {
      const updated = await configApi.patchAlertThreshold(global.doc_type, draft)
      setItems(prev => prev.map(r => (r.doc_type === updated.doc_type ? updated : r)))
      setDraft({})
      revisiones.invalidar()   // guardar cuenta como revisar
    })
  }

  return (
    <div className="p-4 md:p-5 space-y-4 max-w-2xl">
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && !error && !m && (
        <Estado tipo="error" titulo="No se encontró el aviso general de vencimiento"
                detalle={`Sin él, ningún documento pasa a ${porVencer}. Avisa al equipo.`} />
      )}
      {m && (
        <fieldset disabled={!puedeEditar} className="min-w-0 border-0 p-0 m-0 space-y-4">
          <div>
            <label htmlFor="umbral-aviso" className="block text-dato font-semibold text-text-primary">
              {aviso} (días antes del vencimiento)
            </label>
            <input id="umbral-aviso" type="number" min={1} value={m.warning_days}
                   onChange={e => setDraft(d => ({ ...d, warning_days: Number(e.target.value) }))}
                   className={INPUT + ' w-20 mt-1'} />
            <p className="mt-1 text-etiqueta text-informativo">
              Desde ese día el documento se muestra como {porVencer} en el Directorio, Certificación y Pendientes.
              {' '}{porVencer} no quita la habilitación de la empresa. Los documentos con días de aviso propios en
              Condiciones de documentos usan los suyos.
            </p>
          </div>
          <div>
            <label htmlFor="umbral-critico" className="block text-dato font-semibold text-text-primary">
              {critico} (días antes del vencimiento)
            </label>
            <input id="umbral-critico" type="number" min={0} value={m.error_days}
                   onChange={e => setDraft(d => ({ ...d, error_days: Number(e.target.value) }))}
                   className={INPUT + ' w-20 mt-1'} />
            <p className="mt-1 text-etiqueta text-informativo">
              Dentro de ese plazo el documento se destaca en la ficha de la empresa y el semáforo del Monitor pasa a
              rojo. Con 0, solo el día en que vence. No cambia su estado ni la habilitación. Tiene que ser menor que
              el {aviso.toLowerCase()}. El semáforo también se pone rojo, con cualquier plazo, si falta o venció la
              licencia o la cédula del conductor.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CeldaDeRevision id={m.doc_type} revisiones={revisiones} />
            {puedeEditar && <SaveRowButton dirty={dirty} saving={fb.saving === m.doc_type}
                                           saved={!!fb.savedAt[m.doc_type]} onClick={save} />}
          </div>
          {fb.errors[m.doc_type] && <p role="alert" className="text-dato text-status-incidente">{fb.errors[m.doc_type]}</p>}
        </fieldset>
      )}
    </div>
  )
}
```

Se importan:
- `Estado` de `@/components/ui/Estado`;
- `documentStateStyle` y `alertSeverityStyle` de `@/lib/states`;
- `GLOBAL_ALERT_THRESHOLD` de `@/lib/api/config`.

El texto "se destaca en la ficha" depende de que la Task 12 pinte `alert_severity = 'critical'` en la ficha. Si no lo hace,
se corrige la ficha, no el texto.

- [ ] **Step 20: Run the tests**

Run: `cd monitor-app/frontend && npx vitest run app/dashboard/admin/settings lib/ui lib/copy`

Expected: PASS. Si `sistema.test.ts` falla a la baja, se baja el tope como en el Step 10.

- [ ] **Step 21: Commit**

```bash
git add monitor-app/backend/api/app/routers/config.py monitor-app/backend/api/app/services/revisiones.py \
        monitor-app/backend/api/app/services/vencimientos.py monitor-app/backend/api/tests/test_alert_thresholds_global_only.py \
        monitor-app/backend/api/tests/test_revisiones.py monitor-app/frontend/app/dashboard/admin/settings \
        monitor-app/frontend/lib/api/config.ts monitor-app/frontend/lib/ui
git commit -m "feat(configuracion): Alertas de vencimiento con un aviso y un crítico globales

La pantalla y GET /config/alert-thresholds muestran solo la fila global;
el PATCH rechaza las filas por documento y un crítico que no sea menor que
el aviso. El texto dice lo que de verdad pasa: aviso = Por vencer, crítico =
énfasis en la ficha y rojo en el Monitor (D1-R4). Las filas se borran en el
despliegue 3.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

#### Parte D: "Sin clasificar" y "Directorio" en los textos

- [ ] **Step 22: Write the failing tests**

Crear `monitor-app/frontend/lib/copy/module-names.test.ts`, con el mismo recorrido del código fuente que
`espanol-neutral.test.ts`. Se lee el código y no se renderiza, porque un texto puede estar en una rama que ningún test
monta.

```ts
// @vitest-environment node
/**
 * Los módulos se llaman "Sin clasificar" y "Directorio" (spec §3, E-h). Las
 * rutas siguen en inglés (`/dashboard/compliance/inbox`, `/dashboard/carriers`)
 * y los identificadores viejos (`PuenteALaBandeja`) se quedan: esto mira solo
 * el texto que ve una persona, con los comentarios quitados.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..')

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      recorrer(ruta, acc)
    } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) acc.push(ruta)
  }
  return acc
}

/** Quita los comentarios conservando los saltos de línea, para que el número
 *  de línea del hallazgo siga siendo el del archivo. */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const PROHIBIDOS: { re: RegExp; motivo: string }[] = [
  { re: /(^|[^A-Za-z])la [Bb]andeja(?![A-Za-z])/, motivo: 'el módulo se llama "Sin clasificar"' },
  { re: /(en|a) Empresas(?![A-Za-z])/,           motivo: 'el enlace lleva al Directorio' },
  { re: />\s*Empresas\s*<\/a>/,                  motivo: 'el enlace lleva al Directorio' },
]

describe('los módulos se nombran como en el glosario', () => {
  it('encuentra archivos que revisar', () => {
    expect(['app', 'components', 'lib'].flatMap(d => recorrer(join(RAIZ, d))).length).toBeGreaterThan(50)
  })

  it('ningún texto dice "la bandeja" ni llama "Empresas" al Directorio', () => {
    const hallazgos: string[] = []
    for (const ruta of ['app', 'components', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))) {
      sinComentarios(readFileSync(ruta, 'utf8')).split('\n').forEach((linea, i) => {
        for (const { re, motivo } of PROHIBIDOS) {
          if (re.test(linea)) hallazgos.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1} → ${motivo}`)
        }
      })
    }
    expect(hallazgos, hallazgos.join('\n')).toEqual([])
  })
})
```

Los tests de componente que afirman los textos viejos se actualizan en el mismo paso, y quedan en rojo hasta el Step 24:
- `TriageWorkbench.test.tsx:119` → `/agrega los documentos de ACME a Sin clasificar/i`;
- `TriageWorkbench.test.tsx:410` y `TriageWorkbench.undo.test.tsx:211` → `/agrega los documentos a Sin clasificar/i`;
- `TriageWorkbench.undo.test.tsx:143` → `/2 archivos volvieron a Sin clasificar/i`;
- `FlotaDelDiaSection.test.tsx:368,379` → "Revisar en Directorio";
- `TripDetailView.test.tsx` ya se cambió en la Parte B.

Un test nuevo para el puente (`components/compliance/PuenteALaBandeja.test.tsx`; mockear `usePermiso` a `true` como en
`CarrierDrawer.test.tsx`):

```tsx
  it('lleva a Sin clasificar con la empresa ya elegida', () => {
    render(<PuenteALaBandeja carrierId="c1" carrierName="ACME" />)
    expect(screen.getByRole('link', { name: 'Llévalos a Sin clasificar' }))
      .toHaveAttribute('href', '/dashboard/compliance/inbox?empresa=c1')
  })
```

- [ ] **Step 23: Run them to verify they fail**

Run: `cd monitor-app/frontend && npx vitest run lib/copy components/compliance/PuenteALaBandeja.test.tsx components/compliance/TriageWorkbench.test.tsx components/compliance/TriageWorkbench.undo.test.tsx components/dashboard/sections/FlotaDelDiaSection.test.tsx`

Expected: FAIL. La guarda debe listar exactamente estos hallazgos (medido el 12/10; las líneas pueden haberse movido):
- `PuenteALaBandeja.tsx:40`;
- `TriageDropzone.tsx:63,99,107`;
- `TriageWorkbench.tsx:244,245`;
- `carriers/[id]/page.tsx:423` (si la Task 12 no lo cambió ya);
- `GestionPanel.tsx:369,419` (si la Parte B no los cambió ya);
- `TripAssignDialog.tsx:335`;
- `FlotaDelDiaSection.tsx:818`.

Si lista otro archivo, se mira antes de agregarlo: puede ser un falso positivo del recorte de comentarios, y en ese caso se
ajusta la expresión y se reporta. Una lista de excepciones no corrige un falso positivo.

- [ ] **Step 24: Implement**

| Archivo | Antes | Después |
|---|---|---|
| `PuenteALaBandeja.tsx:40` | `Llévalos a la Bandeja` | `Llévalos a Sin clasificar` (y el comentario `:12-17`: "el puente a Sin clasificar") |
| `TriageDropzone.tsx:62-63` | `…vas a encontrar los archivos en la bandeja.` | `…vas a encontrar los archivos en Sin clasificar.` |
| `TriageDropzone.tsx:99` | `…para agregarlos a la bandeja` | `…para agregarlos a Sin clasificar` |
| `TriageDropzone.tsx:107` | `` `Agrega ${deQuien} a la bandeja` `` | `` `Agrega ${deQuien} a Sin clasificar` `` |
| `TriageWorkbench.tsx:244-245` | `volvió/volvieron a la bandeja` | `volvió/volvieron a Sin clasificar` |
| `carriers/[id]/page.tsx:423` | `>Empresas</a>` | `>Directorio</a>` |
| `GestionPanel.tsx:369` | `revisar en Empresas` | `revisar en Directorio` |
| `GestionPanel.tsx:419` | `…darlo de alta primero en <a>Empresas</a>` | `…en el <a>Directorio</a>` |
| `TripAssignDialog.tsx:335` | `…primero en <a>Empresas</a> — …` | `…primero en el <a>Directorio</a> — …` |
| `FlotaDelDiaSection.tsx:818` | `Revisar en Empresas` | `Revisar en Directorio` (solo la etiqueta, R-E10) |

Los identificadores (`PuenteALaBandeja`, `refrescarBandeja`) y las rutas no cambian.

- [ ] **Step 25: Run the tests, the label ratchet and tsc**

Run: `cd monitor-app/frontend && npx vitest run lib components/compliance components/dashboard components/ui app/dashboard/compliance app/dashboard/admin/settings app/dashboard/carriers && npx tsc --noEmit`

Expected: PASS.

Trinquete de etiquetas de la Task 11 (`lib/states.test.ts`): se sacan de su lista de infractores los archivos que esta tarea
limpió (`CertificationFunnel.tsx`, `DirectorioResumen.tsx`, `PendingDocsBadge.tsx`, `GestionPanel.tsx`,
`umbrales-tabs.tsx`, los que la corrida ya no marque). Si el test exige que la lista coincida con la realidad, falla
hasta sacarlos. Si solo impide que crezca, se sacan igual: la lista solo baja.

- [ ] **Step 26: Commit**

```bash
git add monitor-app/frontend/lib/copy monitor-app/frontend/lib/states.test.ts monitor-app/frontend/components \
        monitor-app/frontend/app/dashboard/carriers
git commit -m "fix(textos): \"Sin clasificar\" y \"Directorio\" con los nombres del glosario

Ningún texto dice \"la bandeja\" ni llama \"Empresas\" a un enlace al
Directorio; una guarda sobre el código fuente lo impide. Rutas e
identificadores sin cambios (rutas en inglés, etiqueta en español).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Verificación del frontend y despliegue 2

**Files:**
- Modify: `AGENTLOG.md`
- Modify: el ledger de D1 (`docs/superpowers/plans/2026-10-12-directory-d1-rulings.md`, o el que dejaron las tareas
  anteriores)

- [ ] **Step 1: Suites completas (una vez por despliegue)**

El despliegue 2 lleva backend: la Parte C de la Task 14 toca `config.py`, `revisiones.py` y `vencimientos.py`.

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest -q
```

Correr en primer plano (dura ~35 min) y nunca con `--padron-completo`. Expected: verde.

```bash
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Expected: verde. Un timeout aislado por carga se reintenta una vez y se anota. Un fallo repetido no se reintenta: se
investiga.

- [ ] **Step 2: Trinquetes en su meta**

```bash
cd monitor-app/frontend && npx vitest run lib/states.test.ts lib/ui lib/copy
```

Expected:
- **trinquete de etiquetas:** la lista de infractores queda solo con los archivos cuya etiqueta depende de un campo viejo
  que se retira en la Task 16. Cada uno lleva su motivo en un comentario del test. La meta es una lista vacía: si queda
  alguno, se nombra en el informe con la línea de la Task 16 que lo cierra;
- `sistema.test.ts` y `escala.test.ts` en su tope, o más abajo;
- la guarda de nombres de módulos y la de español neutral, en verde.

- [ ] **Step 3: Recorrido en la copia local (Playwright MCP, nunca claude-in-chrome)**

Levantar `.superpowers/local-sim/` como dice el AGENTLOG (§ 2026-10-11, "La copia local"):
1. `supabase start` en esa carpeta.
2. Aplicar a la base local `20261013090000_directory_one_answer.sql`, la migración del despliegue 1, con la URL local de
   `supabase status`. Es una base ficticia, así que `psql` sirve ahí.
3. API en :8100 con `api.env`: `uvicorn app.main:app --port 8100` desde `monitor-app/backend/api` con ese entorno.
4. **Después:** `cd monitor-app/frontend && env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN npx next dev -p 3100`,
   con las `NEXT_PUBLIC_*` y `FASTAPI_URL` locales.
5. **Antes:** un worktree en el commit previo a la Task 11 (`git worktree add <scratchpad>/d1-antes <sha>`), con
   `npm ci` y `next dev -p 3101` contra la misma API. Se compara la misma pantalla con los mismos datos.
6. Para ver el rojo del Monitor y "Por vencer", en la **base local** (nunca en producción):
   - poner la `expiration_date` de un registro ficticio en hoy (crítico con `error_days = 0`);
   - poner la de otro en hoy + 10 días (por vencer);
   - que un viaje ficticio tenga ese conductor.

   Si no hay un usuario con solo `operations_operator`, asignarle ese rol a uno ficticio en la base local.

Usuarios: `cert@sim.local` (Supervisor de Certificación), `ops@sim.local` (Supervisor de Operaciones) y el Operador.
Contraseña en el AGENTLOG.

Pantallas a 1440 px y a 390 px, antes (:3101) y después (:3100):

| Pantalla | Qué se comprueba |
|---|---|
| Directorio, pestañas Activas y Dadas de baja | Las no activas en gris y sin rojo; las activas con "Habilitada" o "No habilitada" (Tasks 12-13). |
| Ficha de una empresa activa y su vista rápida | Mismas cifras vencidos, por vencer y faltan que su fila en Pendientes; el documento crítico se destaca. |
| Certificación, portada | Filtro "Ciclo de vida", baldes No habilitada · Por vencer · Al día, sin "No activas"; cifras por fila; resumen con "dadas de baja". |
| Pendientes | Mismas cifras de esa empresa. |
| Sin clasificar | Textos "Sin clasificar"; el puente desde la ficha dice "Llévalos a Sin clasificar". |
| Configuración › Alertas de vencimiento | Un aviso y un crítico, con su texto; el Operador y Operaciones lo ven deshabilitado. |
| Monitor: tabla y panel de un viaje | Badge rojo con el aviso crítico y con un conductor sin licencia (R-E5); "No habilitada" en el panel si la empresa no lo está; "revisar en Directorio". |

Con cada rol, mirar la red en Playwright (`browser_network_requests`): ningún 403 ni 500. Capturas en
`.playwright-mcp/d1-<pantalla>-<rol>-<1440|390>-<antes|despues>.png`. Se arma una lámina lado a lado por pantalla (memoria
"contrastar toda UI y mostrarla") y se muestran al usuario.

Al terminar: detener `next dev` en los dos puertos y la API, y `git worktree remove` del worktree "antes".

- [ ] **Step 4: Push y workflows**

```bash
git push origin dev
gh run list --branch dev --limit 6
```

Esperar en primer plano a `Deploy Monitor API` y `Deploy Frontend` con `gh run watch <id> --exit-status`. Expected:
`success` en los dos.
- Si `Deploy Frontend` falla bajando Google Fonts (error de `next/font/google`), es la red del runner:
  `gh run rerun <id> --failed`, una vez.
- Si un workflow no se disparó (un push grande apaga el filtro de rutas), se dispara a mano:
  `gh workflow run deploy-frontend.yml --ref dev` o `gh workflow run deploy-monitor-api.yml --ref dev`.

- [ ] **Step 5: Cifras esperadas, vivas (solo lectura)**

Las cifras del §1 son del 12/10; se comparan contra la base de hoy, no contra el número de la spec (memoria "cifras vivas"):

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
import asyncpg
from tests.conftest import credenciales_integracion
async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        await c.execute("SET default_transaction_read_only = on")
        print("no activas", await c.fetchval(
            "SELECT count(*) FROM public.carriers WHERE operational_status <> $1", "ACTIVE"))
        print("activas", await c.fetchval(
            "SELECT count(*) FROM public.carriers WHERE operational_status = $1", "ACTIVE"))
        print("conductores de la flota activa de empresas activas", await c.fetchval(
            """SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
               JOIN public.carriers c ON c.id = f.carrier_id
               WHERE f.entity_type = $1 AND c.operational_status = $2""", "DRIVER", "ACTIVE"))
    finally:
        await c.close()
asyncio.run(main())
EOF
```

El total del embudo ("documentos por cubrir") se compara con el total de Pendientes en la misma sesión. Los dos tienen que
ser iguales, por la equivalencia de la Task 1.

- [ ] **Step 6: Mirar dev con sesión, sin guardar nada**

URL: `gcloud run services describe webcarga-frontend-dev --region us-central1 --format='value(status.url)'`. El acceso es
solo por invitación, con MFA: se pide al usuario que inicie sesión en la ventana de Playwright. Ningún clic en "Guardar",
"Dar de baja", "Confirmar" ni "Está bien así".

Comprobar:
- **Directorio › Dadas de baja:** las no activas (215 el 12/10, o la cifra viva del Step 5) en gris, ninguna en rojo.
- **Directorio › Activas:** cada una dice "Habilitada" o "No habilitada", y la suma es igual a las activas (36 el 12/10).
- **Certificación, portada:**
  - el resumen dice 78 conductores (o la cifra viva) y "dadas de baja";
  - "documentos por cubrir" (2.226 el 12/10) es igual al total de Pendientes;
  - no hay grupo "No activas".
- **Tres empresas activas de muestra:** una No habilitada con flota, una con algo por vencer y la de más cifras. Para cada
  una, las cifras vencidos, por vencer y faltan valen lo mismo en:
  - la fila del Directorio;
  - la ficha;
  - la vista rápida;
  - la fila del embudo de Certificación;
  - su fila en Pendientes (agrupado por empresa).
- **Configuración › Alertas de vencimiento:** un aviso y un crítico, con los valores de la base.
- **Monitor:** abrir un viaje con conductor resuelto. El badge y el panel no fallan, y la red no muestra ni 4xx ni 5xx.

Capturas en `.playwright-mcp/d1-dev-*.png`. En el informe no se copian nombres ni teléfonos de conductores (memoria "PII").
Los nombres de empresa pueden ir, porque las capturas no salen del repo.

- [ ] **Step 7: Registro y commit**

En el ledger de D1:
- las mutaciones de las Tasks 14 (Steps 5, 11 y 16);
- el estado del trinquete de etiquetas;
- la tabla de las cifras vivas contra lo que muestra dev.

En `AGENTLOG.md` (checkpoint vigente de D1):
- despliegue 2 en dev, con commits y hora;
- las rulings R-E1 a R-E13 (y las D-R6 a D-R16 de la Parte D) con su estado de ensamblado (R-E5 resuelta: el rojo de licencia y cédula se conserva);
- siguiente paso exacto: la Task 16.

```bash
git add AGENTLOG.md docs/superpowers/plans/2026-10-12-directory-d1-rulings.md
git commit -m "docs(agentlog): D1 despliegue 2 en dev

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin dev
```

---

# Parte 3 — Despliegue 3: contraer

### Task 16: Contraer y despliegue 3

**Files:**
- Modify (backend): `app/routers/carriers.py:29,37-81,103-170,746-757,891-898`, `app/schemas/carrier.py:135-150`,
  `app/routers/compliance.py:368-385,422,599-607,863,894-916`, `app/schemas/compliance.py:80-96,125-140`,
  `app/routers/trips.py:581-586,1094-1099,1134,1167-1170,1204`, `app/routers/config.py:265`, `app/cache.py:48`, la guarda de
  la Task 10
- Create: `monitor-app/backend/supabase/migrations/20261015090000_retire_per_document_alert_thresholds.sql`
- Create: `monitor-app/backend/api/tests/test_retire_alert_thresholds_migration_integration.py`
- Modify (frontend): `lib/types.ts` (`ComplianceHealth`, campos del Directorio y del roster, `FunnelGroup`,
  `CertificationStatusRow`, `PendingComplianceRow.urgencia`, `Trip.*_pending_docs_critical`, `TripsMeta.alert_thresholds`),
  `components/compliance/RenglonPendiente.tsx:134`, `app/dashboard/compliance/[carrierId]/page.tsx:68-70,423`, fixtures
  (`alert_thresholds: []` en 7 tests; `funnel_group`, `compliance_health`, `pending_mandatory` del Directorio, `expired_count`),
  `lib/states.test.ts` (trinquete en 0)
- Modify: `AGENTLOG.md`; `AGENTLOG_ARCHIVE.md` (fuera de git a propósito)

**Interfaces:**
- Consumes: todo lo nuevo de los despliegues 1 y 2 (`compliance_summary`, `document_state`, `funnel_bucket`,
  `*_has_critical_alert`, `carrier_can_operate`).
- Produces: la API sin `compliance_health`, `pending_mandatory` (del Directorio y del roster, R-E6), `urgencia`,
  `funnel_group`, `expired_count` (R-E12), `*_pending_docs_critical` de `/trips` (R-E13) ni `alert_thresholds` en la meta
  (R-E4). `app.alert_thresholds` queda con una sola fila.

- [ ] **Step 1: Inventario (grep antes de borrar)**

```bash
cd monitor-app && grep -rn "compliance_health\|health_where\|HealthTab\|_pending_mandatory_join\|_CARRIER_LIST_AGG\|_CARRIER_HEALTH_VALUES\|urgencia\|funnel_group\|'catalogo'\|expired_count\|pending_docs_critical\|AlertThresholdMeta\|alert_thresholds" \
  backend/api/app frontend/app frontend/components frontend/lib frontend/hooks | grep -v "\.pyc"
```

Lo que se espera encontrar y qué se hace con cada cosa:
- **Lectores en el frontend:** ninguno del parámetro `health`, de los facets `pending`/`ok` (la Task 13 pasó las pestañas a
  `enablement`), ni de `compliance_health`, `urgencia`, `funnel_group`, `expired_count` ni de
  `*_pending_docs_critical` del viaje (las Tasks 12-14 los migraron). Si queda alguno, se migra en este paso con el mapa:
  - `AL_DIA` → `UP_TO_DATE`;
  - `POR_VENCER` → `EXPIRING`;
  - `FALTA` → `MISSING`;
  - `VENCIDO` → `OVERDUE`;
  - `NO_EXIGIBLE` → `NOT_REQUIRED`.

  Los candidatos conocidos son `RenglonPendiente.tsx:134` y `compliance/[carrierId]/page.tsx:68-70,423`.
- **Se quedan, con motivo:**
  - ONBOARDING en `FUNNEL_ACTIVE_STATUSES` (`compliance.py:35`) y en Sin clasificar (`matcher_io.py:90`): decisión del
    usuario (R-E2);
  - `driver_pending_docs_critical` del Cierre (`daily_closures.py:56`, `lib/types.ts:1375,1574`,
    `FlotaDelDiaSection.tsx:307`): §6.3;
  - `_compliance_alert_lateral` y `_DRIVER_CRITICAL_DOC_CODES` (los usa el Cierre);
  - `pending_mandatory` de `/compliance-records/status` y de `CertificationStatusTable.tsx` (R-E6);
  - `alert_thresholds` en `vencimientos.py`, `config.py` y `revisiones.py` (leen la fila global).
- **Ningún lector de las filas por documento de `app.alert_thresholds`:**
  `grep -rn "alert_thresholds" monitor-app/backend monitor-app/frontend --include=*.py --include=*.ts --include=*.tsx`
  muestra solo:
  - accesos filtrados a la fila global;
  - la meta de trips, que se retira en este paso;
  - el PATCH, que ya responde 404 a las otras filas.

  Si aparece otro lector, **se para** y se reporta: D1-R4 exige probar que no hay lectores antes del borrado.

Se pega la salida del grep en el informe.

- [ ] **Step 2: Write the failing tests**

1. **La guarda de la Task 10:** su lista de excepciones (allowlist por dominio, D-R14 de la Parte D) queda vacía en cada
   dominio. Si la Task 10 prohíbe `pending_mandatory`
   en todo el backend, se acota a `carriers.py` (R-E6) y se anota.
2. **El trinquete de etiquetas de la Task 11:** la lista queda vacía (`[]`).
3. **Contrato de la API sin los campos viejos.** En `tests/test_directorio.py` (o el test de la lista del Directorio que
   tiene la Task 5) y en `tests/test_pending_documents_integration.py`, un caso por lector:

```python
@pytest.mark.integracion
@pytest.mark.asyncio
async def test_los_campos_viejos_ya_no_salen(conexion_revertida):
    """Despliegue 3 (spec §9): lo retirado no vuelve. Mismo armado de empresa
    ficticia ZZ-TEST-D1 que los tests de la Task 5."""
    … # crear empresa ZZ-TEST-D1 con un conductor activo y un requisito, como el test vecino
    lista = await _list_carriers_sobre(conexion_revertida, q="ZZ-TEST-D1")       # helper del test vecino
    fila = lista["data"][0]
    assert "compliance_health" not in fila and "pending_mandatory" not in fila
    assert "compliance_summary" in fila
    assert set(lista["facets"]) >= {"enabled", "not_enabled"} and not {"pending", "ok"} & set(lista["facets"])
    roster = await _roster_drivers_sobre(conexion_revertida, carrier_id)
    assert all("compliance_health" not in r and "pending_mandatory" not in r for r in roster)
```

   (Si los helpers `_list_carriers_sobre` y `_roster_drivers_sobre` no existen con ese nombre, se usa el armado del test de
   integración del Directorio de la Task 5 y se reporta.) Además, sin base:
   - el schema de `/pending` no tiene `urgencia`: `"urgencia" not in PendingComplianceRow.model_fields`;
   - `"alert_thresholds" not in TripsMeta.model_fields`.
4. **La migración**, en `tests/test_retire_alert_thresholds_migration_integration.py`:

```python
"""La migración que retira los umbrales por documento (D1-R4, R-E11).

Corre el archivo real dentro de una transacción revertida: borra todo lo que
no sea la fila global, guarda cada fila borrada en audit_log y se puede
correr dos veces sin duplicar la copia."""
from pathlib import Path

import pytest

from app.services.vencimientos import GLOBAL_ALERT_THRESHOLD

MIGRACION = (Path(__file__).resolve().parents[2]
             / "supabase/migrations/20261015090000_retire_per_document_alert_thresholds.sql")


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_la_migracion_deja_solo_la_global_y_guarda_la_copia(conexion_revertida):
    conn = conexion_revertida
    # El sujeto lo crea el test: una fila por documento con valores reconocibles.
    await conn.execute(
        "INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days) VALUES ($1, $2, 17, 3)",
        "ZZ-TEST-D1-doc", "ZZ-TEST-D1 documento")
    global_antes = await conn.fetchrow(
        "SELECT warning_days, error_days FROM app.alert_thresholds WHERE doc_type = $1", GLOBAL_ALERT_THRESHOLD)

    sql = MIGRACION.read_text()
    await conn.execute(sql)

    quedan = [r["doc_type"] for r in await conn.fetch("SELECT doc_type FROM app.alert_thresholds")]
    assert quedan == [GLOBAL_ALERT_THRESHOLD]
    assert await conn.fetchrow(
        "SELECT warning_days, error_days FROM app.alert_thresholds WHERE doc_type = $1",
        GLOBAL_ALERT_THRESHOLD) == global_antes
    copia = await conn.fetchrow(
        """SELECT entity_id, action, source, old_value FROM public.audit_log
           WHERE entity_type = 'ALERT_THRESHOLD' AND doc_code = $1""", "ZZ-TEST-D1-doc")
    assert copia["action"] == "delete" and copia["source"] == "migration"
    assert copia["entity_id"] == await conn.fetchval(
        "SELECT md5('app.alert_thresholds:' || $1::text)::uuid", "ZZ-TEST-D1-doc")
    import json
    viejo = json.loads(copia["old_value"]) if isinstance(copia["old_value"], str) else copia["old_value"]
    assert (viejo["warning_days"], viejo["error_days"], viejo["label"]) == (17, 3, "ZZ-TEST-D1 documento")

    # Re-ejecutable: la segunda corrida no borra nada ni duplica la copia.
    copias = await conn.fetchval("SELECT count(*) FROM public.audit_log WHERE entity_type = 'ALERT_THRESHOLD'")
    await conn.execute(sql)
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type = 'ALERT_THRESHOLD'") == copias
```

- [ ] **Step 3: Run them to verify they fail**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_retire_alert_thresholds_migration_integration.py \
  tests/test_directorio.py tests/test_pending_documents_integration.py <guarda de la Task 10> -q
cd monitor-app/frontend && npx vitest run lib/states.test.ts
```

Expected: FAIL por estos motivos:
- la migración no existe (`FileNotFoundError`);
- `compliance_health`, `pending_mandatory` y `urgencia` siguen en las respuestas y en el schema;
- la guarda lista las ocurrencias que quedan;
- el trinquete lista los archivos que quedan.

- [ ] **Step 4: La migración**

`monitor-app/backend/supabase/migrations/20261015090000_retire_per_document_alert_thresholds.sql`:

```sql
-- D1 "Una sola respuesta", despliegue 3 (D1-R4, ruling R-E11).
--
-- Configuración › Alertas de vencimiento tenía una fila por documento que no
-- leía ninguna lógica: solo se lee la global `documento_por_vencer`
-- (services/vencimientos.py, fleet_compliance.alert_severity_sql). Desde el
-- despliegue 2 la pantalla y la API ya no las muestran ni las dejan editar.
-- Aquí se borran, guardando antes cada fila en audit_log para poder
-- restaurarla.
--
-- audit_log.entity_id es uuid NOT NULL y la PK de alert_thresholds es texto:
-- el id es md5('app.alert_thresholds:' || doc_type)::uuid (determinístico,
-- se recalcula desde la clave). doc_code guarda la clave legible.
--
-- Re-ejecutable: la copia y el borrado son UNA sentencia; en la segunda
-- corrida no hay filas que borrar y no se copia nada.
-- Sin triggers ni REFRESH.

WITH retiradas AS (
    DELETE FROM app.alert_thresholds
    WHERE doc_type <> 'documento_por_vencer'
    RETURNING *
)
INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source, doc_code)
SELECT NULL,
       'ALERT_THRESHOLD',
       md5('app.alert_thresholds:' || r.doc_type)::uuid,
       'delete',
       NULL,
       to_jsonb(r),
       NULL,
       'migration',
       r.doc_type
FROM retiradas r;

COMMENT ON TABLE app.alert_thresholds IS
  'Una sola fila: documento_por_vencer (aviso = warning_days, crítico = error_days). La leen '
  'services/vencimientos.py y services/fleet_compliance.py. Las filas por documento se retiraron '
  'el despliegue 3 de D1; su copia está en public.audit_log (entity_type = ''ALERT_THRESHOLD'').';
```

`audit_log.id` es `GENERATED ALWAYS AS IDENTITY` (`attidentity = 'a'`, verificado el 12/10), así que no se nombra en el INSERT.

Ensayo en la base real, revertido:

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
from pathlib import Path
import asyncpg
from tests.conftest import credenciales_integracion
SQL = Path("../supabase/migrations/20261015090000_retire_per_document_alert_thresholds.sql").read_text()
async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        tx = c.transaction(); await tx.start()
        try:
            await c.execute(SQL)
            print(await c.fetch("SELECT doc_type, warning_days, error_days FROM app.alert_thresholds"))
            print(await c.fetchval("SELECT count(*) FROM public.audit_log WHERE entity_type = $1", "ALERT_THRESHOLD"))
        finally:
            await tx.rollback()
    finally:
        await c.close()
asyncio.run(main())
EOF
```

Expected: una fila (`documento_por_vencer`) y `9` copias.

- [ ] **Step 5: Backend: retirar lo viejo**

`app/routers/carriers.py`:
- se borran `_pending_mandatory_join` (`:37-58`), `_CARRIER_LIST_AGG` (`:61-81`), `_CARRIER_HEALTH_VALUES` (`:29`) y el
  `pendiente = pendiente_predicate('cr')` de `:32` si queda sin uso;
- `list_carriers`: el CTE `agg` queda con lo que la Task 5 ya compone (`carrier_compliance_cte()` más los datos de la
  empresa), sin `pending_mandatory` ni `compliance_health`. El orden pasa a lo que la Task 5 dejó para
  `compliance_summary`. Si la Task 5 no fijó un orden, se usa `can_operate` (No habilitadas primero) y después
  `business_name`;
- `list_carriers` (R-E7): fuera el parámetro `health`, su validación (`:113-114`), `_CARRIER_HEALTH_VALUES`, `health_where`
  y los facets `pending` y `ok`. Quedan el parámetro `enablement` y los facets `enabled` y `not_enabled` de la Task 5.
  `app/schemas/carrier.py`: `CarrierListFacets` sin `pending` ni `ok` (docstring nombra la habilitación);
- `list_carrier_drivers` (`:746-757`) y `list_carrier_assets` (`:891-898`): fuera `pending_mandatory`, `compliance_health`
  y el `{_pending_mandatory_join(...)}`; queda el `compliance_summary` de la Task 7.

`app/routers/compliance.py`:
- `funnel_cols` (`:368-385`): fuera el CASE `funnel_group` (con `'catalogo'`) y `expired_count`. Queda lo que la Task 6
  agregó (`funnel_bucket`, `compliance_summary`) más `management_types` y `trips_30d`. Se borra el comentario de
  `:209-212` que nombra "Resto del catálogo". `$1` (`FUNNEL_ACTIVE_STATUSES`) sigue porque lo usa el alcance
  (`es_activa`); se confirma que `test_status_binds_exactly_the_parameters_it_references` sigue verde;
- **`FUNNEL_ACTIVE_STATUSES` (`:35`) no se toca: ONBOARDING se queda** en la tupla (decisión del usuario, R-E2), y
  `matcher_io.py:90` (Sin clasificar) la sigue leyendo. Si la guarda de la Task 10 o algún test nuevo intenta sacarla, se
  corrige el test;
- `_PENDING_ROWS_SQL` (`:599-607`): fuera el CASE `urgencia` y su comentario;
- `/pending` (`:863`): fuera la clave `"urgencia"`;
- `_SUMMARY_SQL` (`:894-916`) agrupa sobre `document_state` con la misma partición:

```sql
    count(*) FILTER (WHERE document_state = 'UP_TO_DATE')            AS al_dia,
    count(*) FILTER (WHERE document_state = 'EXPIRING')              AS por_vencer,
    count(*) FILTER (WHERE document_state IN ('MISSING', 'OVERDUE')) AS falta,
    count(*) FILTER (WHERE document_state = 'NOT_REQUIRED')          AS no_exigible
```

  y el comentario de `:894-901` pasa a nombrar `document_state`.

Los nombres de las claves del resumen (`al_dia`, `por_vencer`, `falta`) no cambian: renombrarlos es otro contrato y no
está en D1.

`app/schemas/compliance.py`: fuera `urgencia` (`:80-93`) y la frase de `:94-95`. El docstring de
`ComplianceSummaryCounts` (`:126-133`) nombra `document_state`.

`app/routers/trips.py`:
- fuera `dcomp/tcomp/ccomp.has_critical_pending AS *_pending_docs_critical` de la lista (`:582,584,586`), R-E13. El lateral
  sigue devolviendo `has_critical_pending` para el Cierre;
- meta (R-E4): fuera `AlertThresholdMeta` (`:1094-1099`), `alert_thresholds` de `TripsMeta` (`:1134`), la consulta
  (`:1167-1170`) y el argumento (`:1204`).

`app/routers/config.py:265`: fuera `await invalidate_trips_meta_cache()` del PATCH de alertas, porque la meta ya no las
lleva. Si el import queda sin uso, se borra.

`app/cache.py:48`: se saca `alert_thresholds` del comentario.

- [ ] **Step 6: Frontend: retirar lo viejo**

`lib/types.ts`:
- fuera `ComplianceHealth` (`:1050`) y `pending_mandatory` y `compliance_health` de los tipos del Directorio y el roster
  (`:1062-1063,1119-1120,1143-1144`); `CarrierListFacets` sin `pending` ni `ok`;
- fuera `FunnelGroup` (`:1938-1943`), y `funnel_group` y `expired_count` de `CertificationStatusRow`. `pending_mandatory`
  se queda ahí (R-E6);
- fuera `urgencia` de la fila de Pendientes;
- fuera `driver/tractor/carrier_pending_docs_critical` de `Trip` (`:561-565`; el de la fila del Cierre, `:1375`, se queda);
- fuera `AlertThresholdMeta` de `TripsMeta.alert_thresholds` (`:276`). El tipo `AlertThresholdMeta` sigue: lo usa
  Configuración.

Fixtures: se borra `alert_thresholds: []` de los 7 tests (`TripDetailView`, `TripTable` x2, `TripAssignDialog`,
`TripBulkUpload`, `FilterPopover`, `TripBoard`). También `funnel_group`, `expired_count`, `compliance_health` y
`pending_mandatory` donde el tipo ya no los tenga. `tsc` los marca uno por uno.

Trinquete de etiquetas: la lista queda en `[]`. Si algún archivo sigue infringiendo, se corrige el archivo, no la lista.

- [ ] **Step 7: Run the tests of the task and verify the mutation**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest tests/test_retire_alert_thresholds_migration_integration.py \
  tests/test_directorio.py tests/test_carriers.py tests/test_pending_documents_integration.py tests/test_alert_thresholds_global_only.py \
  tests/test_revisiones.py <guarda de la Task 10> -q
cd monitor-app/frontend && npx vitest run lib && npx tsc --noEmit
```

Expected: PASS.

Mutación: en la migración, cambiar `WHERE doc_type <> 'documento_por_vencer'` por `WHERE true`, correr el test de la
migración y ver FAIL en `quedan == [GLOBAL_ALERT_THRESHOLD]`. Restaurar.

Segunda mutación: volver a agregar `'urgencia': r['urgencia']` en `/pending`, correr la guarda de la Task 10 y ver FAIL.
Restaurar. Las dos van al ledger.

- [ ] **Step 8: Suites completas y build (una vez por despliegue)**

```bash
cd monitor-app/backend/api && venv/bin/python -m pytest -q
cd monitor-app/frontend && npx vitest run && npx tsc --noEmit && npm run build
```

Backend en primer plano y sin `--padron-completo`. Expected: verde.

- [ ] **Step 9: Commit, push y workflows**

```bash
git add monitor-app/backend monitor-app/frontend
git commit -m "refactor(d1): contraer, retirar los campos y los umbrales viejos

Se retiran compliance_health, el filtro health con sus facets, pending_mandatory
del Directorio y del roster,
urgencia, funnel_group con 'catalogo', expired_count, *_pending_docs_critical
de /trips y alert_thresholds de la meta. Pendientes agrupa sobre
document_state. La migración copia las 9 filas por documento de
app.alert_thresholds en audit_log y las borra. Guardas en vacío (D1,
despliegue 3).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin dev
gh run list --branch dev --limit 6
```

Esperar en primer plano a `Deploy Monitor API` y `Deploy Frontend` (`gh run watch <id> --exit-status`), con el mismo manejo
de Google Fonts y del filtro de rutas que en la Task 15. Expected: `success`.

- [ ] **Step 10: Aplicar la migración**

Solo después de que `Deploy Monitor API` esté en `success`, porque el código desplegado ya no lee las filas. Se aplica en un
momento tranquilo y **sin un job de Mage ni de extracción en vuelo**, con la misma comprobación que la Task 10. Herramienta:
`mcp__claude_ai_Supabase__apply_migration`, con `name` `retire_per_document_alert_thresholds` y el contenido del archivo.

Verificación (solo lectura):

```bash
cd monitor-app/backend/api && venv/bin/python - <<'EOF'
import asyncio
import asyncpg
from tests.conftest import credenciales_integracion
async def main():
    c = await asyncpg.connect(**credenciales_integracion())
    try:
        await c.execute("SET default_transaction_read_only = on")
        print(await c.fetch("SELECT doc_type, warning_days, error_days FROM app.alert_thresholds"))
        print(await c.fetchval("SELECT count(*) FROM public.audit_log WHERE entity_type = $1", "ALERT_THRESHOLD"))
    finally:
        await c.close()
asyncio.run(main())
EOF
```

Expected: una fila (`documento_por_vencer`, con los valores que tenía) y `9`.

- [ ] **Step 11: Mirar dev, sin guardar nada**

Con la sesión del usuario en Playwright, en la red del navegador:
- ningún 4xx ni 5xx en Directorio (lista, ficha, roster, vista rápida), Certificación (portada, ficha, Pendientes, Sin
  clasificar), Configuración › Alertas de vencimiento y Monitor (tabla y panel);
- las cifras de las tres empresas de muestra de la Task 15 siguen iguales entre pantallas;
- Configuración muestra el aviso y el crítico con los mismos valores que antes del borrado.

Capturas en `.playwright-mcp/d1-dev-contraido-*.png`.

- [ ] **Step 12: AGENTLOG, archivo y memoria**

`AGENTLOG.md`:
- entrada de D1 cerrada, con los tres despliegues, sus commits, la migración aplicada (hora), las cifras vivas de la Task 15
  y las capturas;
- las rulings D1-R1 a D1-R5 y R-E1 a R-E13 (y las D-R6 a D-R16 de la Parte D), con su estado de ensamblado (ONBOARDING queda en el alcance del embudo y en
  Sin clasificar por decisión del usuario; R-E5 resuelta conservando el rojo de licencia y cédula);
- **siguiente paso exacto:**
  1. D2 (relaciones con vigencia y reactivar eligiendo la flota, P3);
  2. en paralelo, Certificación 2a (Sin clasificar opción B);
  3. preguntas abiertas P14 (bloquear o avisar con flota No habilitada) y las de la auditoría con Pablo;
- decisiones de arquitectura:
  - hechos de la flota en la base (`app.active_fleet`, `app.carrier_of`);
  - la regla documental en `fleet_compliance.py`;
  - el glosario en `app/schemas/states.py` y `lib/states.ts`;
  - las guardas en vacío.

Si con esto el checkpoint "2026-10-12 — Auditoría del Directorio…" queda sin pasos pendientes, su sección se mueve a
`AGENTLOG_ARCHIVE.md`. Ese archivo está fuera de git a propósito; no se usa `git add -f`. En `AGENTLOG.md` queda solo el
checkpoint vigente, y "PARA LA PRÓXIMA SESIÓN" se actualiza con lo que siga abierto. Antes de mover nada, se consolida lo
abierto en el checklist de arriba.

```bash
git add AGENTLOG.md docs/superpowers/plans/2026-10-12-directory-d1-rulings.md
git commit -m "docs(agentlog): D1 \"Una sola respuesta\" desplegado y contraído en dev

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin dev
```

Sugerencia de memoria (la escribe el orquestador, no el ejecutor): una nota `project_d1_una_sola_respuesta.md`:
- "D1 en dev (fecha): estados en tres capas;
- `compliance_summary`, `funnel_bucket` y `document_state` son el canon;
- `compliance_health`, `urgencia` y `funnel_group` no existen;
- `app.alert_thresholds` tiene una fila, y la copia de las otras está en `audit_log` (`ALERT_THRESHOLD`);
- ONBOARDING sigue en el embudo y en Sin clasificar, sin viajes manuales."

Y una línea en `MEMORY.md` que la indexe.


---

## Self-review (ensamblado, 12/10)

**Cobertura de la spec:**

| Sección de la spec | Tareas |
|---|---|
| §4.1-4.4 (vista, `carrier_of`, `carrier_management_types`, CHECK) | Task 2; se aplica en la Task 10 |
| §5.1 (módulo) | Task 4 |
| §5.2 (`exigible_sql` por tipo; ONBOARDING, ahora "se le piden documentos, no recibe viajes") | Tasks 3, 6 y 8 |
| §5.3 (rendimiento) | Tasks 4 y 10: medido 84-90 ms para `carrier_compliance` sobre 251 empresas |
| §6.1 (lectores del backend) | Tasks 5-7; `urgencia` y los campos viejos salen en la Task 16 |
| §6.2 (el frontend solo pinta) | Tasks 11-14 |
| §6.4 (glosario en código) | Tasks 3 y 11; guardas en las Tasks 10, 11 y 16 |
| §7.1 (guarda) | Task 8 (más el conductor habitual en la Task 7); el frontend en la Task 13 |
| §7.2 (identidad) | Task 9; el filtro del cliente en la Task 13 |
| §8 (pruebas) | Equivalencia (Task 1), Pendientes no cambia (Task 4), integración (Tasks 2-9), mutación (en cada tarea y en la Task 10), guardas (Tasks 10, 11 y 16), recorrido (Tasks 10, 15 y 16) |
| §9 (tres despliegues) | Tasks 10, 15 y 16 |
| Avisos (E-e) | Tasks 4 y 14 (Configuración valida crítico < aviso) |

**Coherencia entre partes, resuelta en el ensamblado:**
- **Nombres del Monitor:** por entidad (`*_has_critical_alert`, `carrier_can_operate`).
- **`funnel_bucket`:** NULL si la empresa no está activa.
- **ONBOARDING:** sigue en `FUNNEL_ACTIVE_STATUSES` y la guarda le responde 409.
- **`worst_state`:** solo de los obligatorios.
- **Filtro `enablement` del Directorio:** lo agrega la Task 5 y lo leen las Tasks 13 y 16.
- **Helper `apply_fleet_facts`:** uno solo, con la marca `-- d1:checks`.
- **`FunnelBucket`:** se define una sola vez, en `lib/types.ts`.
- **Numeración de rulings:** con el prefijo de su parte.
- **`daily_closures.py`:** queda para D2, y la spec se actualizó.

**Código que ya corrió y código que no:**
- **Ya corrió:** el código de las Tasks 1-4 se ejecutó al escribirlo, en una copia del backend contra la base real y en transacciones revertidas. Dio 32 tests en verde, y los de equivalencia, migración y exigibilidad se vieron fallar antes.
- **No corrió:** el de las Tasks 5-16 se escribió leyendo el código de `a3a58192`. Vale la regla de las Global Constraints: si un test falla por otro motivo, se corrige el test y se reporta, y nunca se afloja una aserción.

**A saber antes del despliegue 2 (decisión del usuario, 12/10):** las 36 empresas activas van a figurar "No habilitada". Es lo que dicen los datos, y se muestra tal cual.
