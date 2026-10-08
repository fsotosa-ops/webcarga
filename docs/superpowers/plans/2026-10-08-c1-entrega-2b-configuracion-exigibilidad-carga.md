# HU-C1 entrega 2b: configuración de la vigencia, exigibilidad, carga y catálogo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (elegido por el usuario: inline,
> "encadenado") task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que WebCarga configure desde Configuración cómo vence y cuándo se exige cada tipo de documento. La app
respeta esa configuración al crear pendientes, al cargar y al mostrar, y quedan cargados apagados los ~76 tipos
nuevos de la planilla de WebCarga.

**Architecture:** Se extiende lo que ya existe; no se crean caminos paralelos.
- La **regla** se guarda por el mismo `PATCH /conditions`, auditado y con revisión, a través del servicio nuevo
  `services/vigencia.py`. La coherencia la hace cumplir la base, con el trigger diferido.
- La **siembra** pasa por las mismas 5 funciones `reconcile_*` y por `SQL_ENTIDADES_QUE_APLICAN`.
- El **estado** sale de `services/vencimientos.py`, que es la única definición.
- **Qué pedir al cargar** lo decide `campos_que_pide`, también una sola definición.
- La **carga del catálogo** usa el mismo servicio que "Nuevo documento".

**Tech Stack:** FastAPI + asyncpg (pytest, `monitor-app/backend/api/venv`), Next.js + React Query (vitest), Postgres
en Supabase (`viclzoftiudkepqnhekv`).

**Spec:** `docs/superpowers/specs/2026-10-08-c1-entrega-2b-configuracion-exigibilidad-carga-design.md`. La
pantalla está en la HU-C1, sección "Diseño de interfaz"
(`monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md`).

## Global Constraints

- **Nada de parches.** Una regla vive en un lugar. Sin columnas espejo, sin casos por código y sin `try/except` que
  oculte errores.
- **Español neutral** en la UI, sin voseo. **Cero emojis**; íconos solo de `lucide-react`. **Trinquetes visuales**:
  - los topes de `lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` no pueden subir;
  - se usan tokens (`text-etiqueta`, `text-informativo`, `text-dato`, `text-status-incidente`…);
  - nada de `text-gray-*` ni `text-[Npx]` en código nuevo.
- **Migraciones:**
  - en `monitor-app/backend/supabase/migrations/`;
  - aplicadas con `mcp__claude_ai_Supabase__execute_sql`: primero ensayo `BEGIN … ROLLBACK`, después `BEGIN … COMMIT`;
  - el usuario autorizó escribir en producción esta entrega (08/10). Antes de cada `COMMIT` se verifica que no haya
    ingesta en vuelo.
- **Tests:**
  - backend: `cd monitor-app/backend/api && venv/bin/python -m pytest …`. Los de integración usan
    `conexion_revertida` y crean sus sujetos; las funciones nuevas se cargan desde su migración, como en
    `tests/test_matcher_ficha_activa.py`;
  - frontend: `cd monitor-app/frontend && npx vitest run <ruta>`, más `npx tsc --noEmit`, y `npm run build` antes
    del push.
- **La suite completa del backend dura ~20 min y satura la base:** se corre una sola vez, antes del push. Durante el
  trabajo se corren los archivos afectados.
- **La API de `main` se ignora** (decisión del usuario).

## Review Focus

1. **Cambiar el tipo de un documento en uso.** De NONE a ISSUE_PLUS_MONTHS reinicia la regla, y los aprobados sin
   emisión pasan a vencidos. La vista previa tiene que anunciarlo con la cifra exacta antes de guardar. Task 2.
2. **Guardar dos veces el mismo día.** Mover el corte del 18 al 15 y después al 12, en el mismo día, debe dejar una
   sola versión de hoy (12), no violar la unicidad. Task 1.
3. **Solicitar dos veces el mismo documento, o solicitar uno apagado.** Debe ser idempotente y rechazar el apagado.
   Task 3.
4. **Un período más antiguo que el cargado.** Debe rechazarse con un 409 legible y sin borrar el archivo ya
   subido. Task 4.
5. **El script contra la planilla real:**
   - ninguna fila sin tipo;
   - ningún código duplicado;
   - los ~20 existentes saltados;
   - los cortes mensuales exactos.

   Task 7.

---

### Task 1: La vigencia en el contrato del catálogo (backend F5)

**Files:**
- Create: `backend/supabase/migrations/20261009100000_vigencia_mensual_exige_aviso.sql` (M6: `validar_vigencia_de_requisito`
  exige `warning_days` en las reglas `CALENDAR_PERIOD`).
- Create: `backend/api/app/services/vigencia.py`.
- Modify: `backend/api/app/schemas/requirement.py`:
  - `VigenciaBody`;
  - `vigencia` y `exigible_on` en `RequirementConditionsPatchBody` y en `RequirementCreateBody`;
  - el `Literal` de la política con los 5 tipos, solo dentro de `VigenciaBody`.
- Modify: `backend/api/app/routers/requirements.py`:
  - PATCH: `vigencia` va a `guardar_vigencia` y `exigible_on` va al mapa editable;
  - create: misma ruta;
  - `SQL_CATALOGO`: regla base vigente, `exigible_on`, `tiene_versiones`.
- Test: `backend/api/tests/test_vigencia_configuracion.py` (integración) y `tests/test_requirements*.py` (contrato).

**Interfaces:**
- Produces:
  - `VigenciaBody(politica: Literal[5], validity_months: int|None, frequency_months: int|None, cutoff_day: int|None,
    period_offset_months: int|None, warning_days: int|None, grace_days: int = 0)`;
  - `async guardar_vigencia(conn, requirement_id: str, vigencia: VigenciaBody) -> dict`, que devuelve la regla base
    vigente como dict;
  - en `SQL_CATALOGO`, cada fila suma `vigencia` (objeto con la regla base vigente o `null`), `exigible_on` y
    `tiene_versiones`.
- Versionado en `guardar_vigencia`:
  - **NONE / REQUIRED / OPTIONAL, sin aviso ni gracia distintos del default:** sin reglas (se borran las base si
    las hay);
  - **si cambió el tipo:** `DELETE` de todas las reglas base e `INSERT` de una desde `-infinity`;
  - **mismo tipo con parámetros distintos:**
    - si la única versión es `-infinity` y el requisito no tiene registros con archivo, se actualiza en el lugar;
    - si no, se hace `INSERT … ON CONFLICT (requirement_id, shipper_id, vigente_desde) DO UPDATE` con
      `vigente_desde = public.hoy_chile()`;
  - **sin cambios:** no hace nada.

**Tests (escribirlos primero y verlos fallar):**
- PATCH con `vigencia` CALENDAR (corte 18, mes anterior, aviso 5): el catálogo la devuelve; `audit_log` tiene el
  cambio y la revisión queda registrada.
- Cambiar el corte el mismo día dos veces deja una sola versión de hoy (Review Focus 2).
- Cambiar parámetros con registros con archivo crea una versión de hoy y conserva la `-infinity`.
- Cambiar de tipo reinicia la regla: queda una sola base desde `-infinity`.
- CALENDAR sin `warning_days` responde 422 con el mensaje de la base (M6).
- POST create con `vigencia` y `exigible_on` nace apagado y con su regla.
- `exigible_on` inválido para CARRIER (MONTH_AFTER_START) responde 422 legible, no 500.

- [ ] Write tests → RED → migración M6 + schema + servicio + router → GREEN → archivos afectados en verde.
- [ ] Aplicar la migración M6 (ensayo y COMMIT).
- [ ] Commit `feat(certificacion): la vigencia y la exigibilidad se configuran por el catalogo (HU-C1 F5)`.

### Task 2: Vista previa del efecto de una vigencia en borrador

**Files:**
- Modify: `backend/api/app/routers/requirements.py`: `POST /{id}/vigencia/preview`, con el cuerpo `VigenciaBody`.
- Test: `tests/test_vigencia_configuracion.py`.

**Interfaces:**
- Produces: `POST /compliance-requirements/{id}/vigencia/preview` → `{antes: {vencidos, por_vencer, al_dia, falta},
  despues: {...}, rige_desde_hoy: bool}`.
- Implementación: en una transacción se cuenta con `vencido_predicate`, `por_vencer_predicate` y
  `pendiente_predicate` sobre los registros `is_current` del requisito; después `guardar_vigencia`; se vuelve a
  contar, y se hace **ROLLBACK** siempre (transacción con savepoint que se revierte). Es la misma definición, y no
  escribe nada.

**Tests:**
- NONE → ISSUE_PLUS_MONTHS sobre un requisito con 2 registros aprobados sin emisión: `despues.vencidos == 2` y la
  base queda sin cambios (Review Focus 1).
- Mismo tipo con otros parámetros: `rige_desde_hoy == true`.

- [ ] RED → GREEN → commit `feat(certificacion): vista previa del efecto de una vigencia antes de guardar`.

### Task 3: Cuándo se exige (backend F3)

**Files:**
- Create: `backend/supabase/migrations/20261009110000_siembra_respeta_exigible_on.sql`:
  - `CREATE OR REPLACE` de `reconcile_new_carrier`, `reconcile_new_driver`, `reconcile_new_asset`,
    `reconcile_new_requirement` y `reconcile_carrier_shipper_link`, partiendo de `pg_get_functiondef` en prod;
  - el único cambio en cada una es agregar `AND req.exigible_on <> 'ON_REQUEST'` junto a `req.is_active`.
- Modify: `app/services/requirement_conditions.py`: en `SQL_ENTIDADES_QUE_APLICAN`, la puerta es
  `req.is_active AND req.exigible_on <> 'ON_REQUEST'`.
- Modify: `app/services/vencimientos.py`:
  - `exigible_desde_sql(alias)`, la fecha desde la que se exige;
  - la etiqueta `NO_EXIGIBLE` y `cubierto_predicate(alias)` = exigible AND NOT pendiente, que usan el embudo y el
    filtro "al día".
- Modify: `app/routers/compliance.py`:
  - urgencia `NO_EXIGIBLE` en el CASE; `cubierto` usa el predicado nuevo; el filtro `al_dia` también;
  - atribución de `ON_ENTITY_END` a la última asignación en `resolved`/`attributed`;
  - `exigible_desde` expuesto en las filas.
- Create: `app/services/solicitudes.py`: `encender_registro(conn, requirement_id, entity_type, entity_id, *, manual: bool)`,
  extraído del INSERT de `recalc` (requirements.py:409-440), que lo reusa.
- Modify: `app/routers/compliance.py`: `POST /compliance-records/requests` y `DELETE /compliance-records/requests/{record_id}`
  (`require_editor`), y la lista de solicitables por sujeto, `GET /compliance-records/requestable?entity_type=&entity_id=`.
- Modify: `app/schemas/compliance.py`: `urgencia` con `NO_EXIGIBLE`; `exigible_desde`.
- Test: `tests/test_exigibilidad_integracion.py`.

**Tests:**
- Activar un requisito ON_REQUEST (insertarlo activo) no siembra: 0 registros. Debe coincidir con
  `SQL_ENTIDADES_QUE_APLICAN` y con la vista previa de recalc.
- Una entidad nueva (carrier/driver/asset) no recibe los ON_REQUEST.
- `POST /requests` crea el registro MISSING con `is_manual_override`; repetirlo es idempotente; con un requisito
  apagado o que no es ON_REQUEST responde 409; `recalc` no lo apaga.
- `DELETE /requests` apaga solo si no tiene archivo; con archivo responde 409.
- MONTH_AFTER_START con ingreso este mes: urgencia `NO_EXIGIBLE` y `exigible_desde = 01` del mes siguiente; no está
  en `falta` ni en `al_dia` ni en `cubierto`.
- ON_ENTITY_END de un conductor desvinculado: aparece en la cola de la empresa que dejó.

- [ ] RED → migración + código → GREEN → aplicar la migración → commit
  `feat(certificacion): la siembra y el estado respetan cuando se exige cada documento (HU-C1 F3)`.

### Task 4: Qué se pide al cargar y qué se muestra (backend F4)

**Files:**
- Modify: `app/services/vencimientos.py`: `campos_que_pide(politica) -> CamposQuePide(fecha: Literal['obligatoria','opcional','no'], emision: bool, periodo: bool)`;
  `lleva_fecha` y `exige_fecha` se retiran (sus llamadores migran a esta función). También
  `periodo_que_se_exige_sql(alias)`, que propone el período.
- Modify: `app/routers/compliance.py`:
  - carga directa y `/file` (`:1025`, `:1041`, `:1373`) y planilla (`:940`): aceptan `issue_date` y `period_start`
    según `campos_que_pide`; validan día 1 y rechazan un período anterior al cargado con 409;
  - filas con `vence_el` (`vence_el_sql`).
- Modify: `app/routers/document_ingest.py:450` (classify y classify-batch).
- Modify: `app/services/plantilla_certificacion.py`: columnas "Emisión" y "Período" (MM-AAAA), con parser.
- Modify: `app/utils/document_storage.py`: `log_document_replacement` suma `period_start` / `issue_date`.
- Modify: `routers/carriers.py`, `drivers.py`, `assets.py`: las listas de documentos exponen `vence_el`, `issue_date`
  y `period_start`.
- Test: `tests/test_carga_por_tipo_integracion.py` y la actualización de `tests/test_document_ingest.py`.

**Tests:**
- Por política: qué exige la carga directa, la clasificación y la planilla.
- Un período que no es día 1 responde 422; un período anterior al cargado, 409 (Review Focus 4).
- `vence_el` en la ficha: un F30-1 de septiembre muestra el 18/11.
- La planilla hace ida y vuelta con "Período" sin tocar ningún dato.

- [ ] RED → GREEN → commit `feat(certificacion): la carga pide emision o periodo segun el tipo (HU-C1 F4)`.

### Task 5: Configuración en el frontend (F5)

**Files:**
- Create: `frontend/app/dashboard/admin/settings/EditorVigencia.tsx` y `EditorVigencia.test.tsx`:
  - tarjetas por tipo, la frase con sus campos y el ejemplo de fechas calculado en el cliente con una función pura
    `ejemploDeVigencia(vigencia, hoy)` en `lib/vigencia.ts`, con su test;
  - el aviso "Rige desde hoy" si `tiene_versiones` o hay registros.
- Create: `SelectorExigibilidad.tsx` y su test.
- Modify:
  - `CondicionPanel.tsx`: reemplazar `SelectorPoliticaVencimiento`; borrador de vigencia y exigibilidad; vista previa
    del efecto (Task 2) antes de guardar cuando cambia la vigencia; el error de la base visible;
  - `NuevoDocumentoPanel.tsx`: los mismos componentes;
  - `celdas-editables.tsx`: `CeldaVigencia` muestra el resumen y abre el panel;
  - `lib/types.ts`: `PoliticaVencimiento` con los 5 tipos, más `Vigencia` y `ExigibleOn`;
  - `lib/api/requirements.ts`.
- Delete: `SelectorPoliticaVencimiento.tsx`, que queda reemplazado.

**Tests:**
- Cada tipo muestra solo sus campos; el ejemplo del F30-1 dice "sirve hasta el 18/11".
- El cuerpo del PATCH solo trae lo cambiado.
- Sin permiso: sin controles.
- El error de la base se muestra y conserva el borrador.
- La vista previa aparece antes de guardar un cambio de tipo.

- [ ] RED → GREEN; `npx tsc --noEmit`; trinquetes; commit
  `feat(configuracion): editor de vigencia y exigibilidad por documento (HU-C1 F5)`.

### Task 6: Ficha, carga y clasificación en el frontend (F3/F4)

**Files:**
- Modify:
  - `lib/compliance.ts`: `camposQuePide` reemplaza `llevaFecha`/`exigeFecha`; la etiqueta de urgencia
    `NO_EXIGIBLE`; la línea "Septiembre 2026 · sirve hasta el 18/11" desde `vence_el`;
  - `components/compliance/RenglonPendiente.tsx`, `components/dashboard/DocumentChecklist.tsx` y
    `components/compliance/TriageClassifyForm.tsx`: campos de emisión y período (`SelectorDePeriodo`, input
    `type=month` con valor propuesto);
  - la ficha (`app/dashboard/compliance/[carrierId]/page.tsx`) y el componente del sujeto: la acción "Solicitar
    documento" y "Quitar solicitud".
- Tests junto a cada componente.

- [ ] RED → GREEN; tsc; trinquetes; commit
  `feat(certificacion): la ficha muestra el vencimiento calculado, pide periodo o emision y permite solicitar (HU-C1 F3/F4)`.

### Task 7: Cargar el catálogo de WebCarga (F6)

**Files:**
- Create: `backend/api/scripts/cargar_catalogo_webcarga.py`:
  - lee la planilla con openpyxl;
  - traduce cada fila con `traducir_fila(fila) -> TipoPropuesto | None`, que devuelve `None` si coincide con uno
    existente de `COINCIDENCIAS`;
  - en simulación por defecto imprime la tabla y las dudas;
  - con `--aplicar` crea cada tipo por el mismo servicio que `POST /compliance-requirements`, extraído si hace falta
    a `services/catalogo.py`.
- Test: `tests/test_cargar_catalogo_webcarga.py`:
  - la traducción de cada combinación;
  - las 96 filas reales con 0 sin tipo y 0 códigos duplicados;
  - los cortes mensuales exactos: TGR 10, F30 5, F30-1 18, Nómina 5, Liquidación 10, Cotizaciones 15
    (Review Focus 5).

- [ ] RED → GREEN → simulación → **mostrar el resultado al usuario y pedir el sí** → `--aplicar` → commit.

### Task 8: Suite, despliegue y verificación

- [ ] Suite completa del backend, una sola vez; frontend `npx vitest run`, `tsc` y `npm run build`.
- [ ] Revisión final de la rama (revisor independiente, modelo más capaz). Una pasada de arreglos con TDD.
- [ ] Push a `dev` sin ingesta en vuelo; Deploy Monitor API y Deploy Frontend en verde.
- [ ] Playwright en dev:
  - configurar en Configuración un tipo de prueba mensual y ver el ejemplo;
  - clasificar un documento con su período;
  - ver "sirve hasta…";
  - solicitar un documento ON_REQUEST y quitarlo.

  Usar entidades sin datos y revertir lo que se cree.
- [ ] Volver a medir `/status` y la cola (M4).
- [ ] AGENTLOG y memoria.
