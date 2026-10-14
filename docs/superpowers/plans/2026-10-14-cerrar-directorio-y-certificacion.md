# Cerrar Directorio y Certificación: pendientes "D" + bloques de Certificación, en 3 entregas

## Contexto

D1 ("Una sola respuesta") tomó más de 9 horas: tenía 16 tareas, subagentes en dos carriles con revisión por tarea, rondas de
mutación, guardas con trinquete, 3 despliegues y la suite completa (~35 min) corrida más de una vez. El usuario necesita
estabilizar **Directorio y Certificación** en menos tiempo y sin bugs torpes al salir a producción. Lo que falta de la hoja de
ruta (informe `docs/superpowers/plans/2026-10-12-directory-audit-findings.md` §5) son **D2, D3, D4 y D5** del Directorio y los
**bloques 2a, 2b, 3 y 4** de Certificación. Quedaron agrupados en tres entregas que acordamos el 12/10:

- **A** = D2 (asignaciones con vigencia) + Cert 2a (Sin clasificar, opción B)
- **B** = Cert 3 (panel único de documentos + "Pedir a Certificación") + D3 (maestro protegido + trabajos que faltan)
- **C** = D4 (una ficha por entidad) + Cert 2b (retirar la segunda ficha) + Cert 4 (Configuración › Certificación) + D5 (limpieza)

El usuario eligió **A, B y C completas**. Las decisiones abiertas ya quedaron resueltas en esta sesión (abajo), así que la
ejecución no debería detenerse a preguntar.

## Cambios de método (lo que recupera el tiempo)

| Antes (D1) | Ahora |
|---|---|
| Subagentes en carriles + revisión por tarea | **Ejecución inline** (yo mismo, en serie) y **una sola revisión** al cerrar cada entrega |
| Spec y plan aparte, con código en el plan | **Un documento por entrega**: HU + criterios de aceptación + contratos (endpoints, columnas) + lista de tareas. Sin código |
| Tests de mutación, guardas, renders | **Un test por criterio de aceptación**, al nivel más bajo que lo prueba (ver Tests) |
| Suite completa varias veces | Por tarea, solo los tests del área. Suite completa **una vez por entrega**, en segundo plano, y solo si se tocó base compartida |
| 3 despliegues por bloque | **Un despliegue por entrega** (expand y migración de lectores juntos; contract al final de la misma entrega si la verificación en dev pasa) |
| Tangentes resueltas en el camino | Las tangentes van a una lista en el AGENTLOG y no se tocan |

### Tests: el estándar, proporcionado (decisión de esta sesión)

Combina testing basado en riesgo, la pirámide de tests y criterios de aceptación convertidos en tests (ATDD):
1. **Unidad/integración:** un test por criterio de aceptación de la HU. Las reglas de datos (vigencia, fechas de Chile,
   atribución, permisos de la API) se prueban contra la base real con transacción revertida, que es el patrón actual de
   `monitor-app/backend/api/tests`. La lógica de pantalla va en vitest. No se testean renders ni textos.
2. **Humo E2E (nuevo, lo que evita "bugs torpes"):** 6 a 8 recorridos críticos en Playwright (`@playwright/test` ya está
   instalado, `monitor-app/frontend/playwright.config.ts`, `testDir: ./scripts`). Corren contra la copia local
   `.superpowers/local-sim/`, con datos ficticios y sin escribir en la base real, una vez antes de cada despliegue. Recorridos:
   iniciar sesión con cada rol (cert/ops/owner) · asignar y transferir un conductor con fecha · dar de baja una empresa con
   vista previa · clasificar en lote en Sin clasificar · subir un documento desde Pendientes · "Pedir a Certificación" y
   resolverlo · abrir la ficha de un conductor/equipo · firmar un día del Cierre.
3. **Barrera en CI (hoy no existe):** agregar `npx tsc --noEmit` + `npm test` (vitest) como paso previo al build en
   `.github/workflows/deploy-frontend.yml`. Si fallan, no se despliega. El backend no se agrega a CI porque sus tests
   escriben en la base compartida (Disk IO).

## Decisiones tomadas (sesión 14/10)

**Generales:** alcance A+B+C completo · ejecución inline · política de tests de arriba.

**D2:** el historial parte **el día del despliegue** (las asignaciones vigentes quedan como períodos abiertos desde su fecha
de inicio actual; no se reconstruye desde `audit_log`) · se permite la transferencia **retroactiva, pero nunca sobre un día
firmado del Cierre** · la baja de empresa muestra **vista previa del impacto** (N conductores, N equipos, viajes de hoy, días
abiertos del Cierre) · ya resueltas antes: P3 (al reactivar se elige qué flota vuelve), P6, P10 (clientes declarados, con
vigencia, en D2), P14 (solo aviso).

**Cert 2a (Sin clasificar B):** "Confirmar N" en lote para lo seguro (≥ 0,90, RUT/patente + tipo) · la renovación
anticipada **reemplaza al vigente** si vence después, y el anterior queda en el historial · **duplicado exacto por hash
(SHA-256):** la subida es idempotente, el duplicado no entra a la cola y se informa "N duplicados omitidos" con enlace al
original · **descartar = borrado lógico** (`discarded_at/by`, motivo, auditoría, filtro "Descartados" para restaurar), de
acuerdo con "nada se borra en silencio" · **el menú lo decide el permiso:** Sin clasificar y su contador solo se muestran con
`documents.review`, así que Operaciones no los ve · fecha de vencimiento escrita por la persona con vista previa grande, sin OCR.

**D3:** **la empresa que informa el TMS se ignora** (p. ej. "WebCarga SpA"): la empresa siempre sale del Directorio a
partir del conductor y la patente. No existe una "propuesta de empresa" desde el TMS · corregir RUT/patente: Certificación,
con permiso dedicado y motivo obligatorio, registrado en `audit_log`; **un cambio de patente conserva el mismo equipo (mismo
id)** y la patente anterior queda como alias, así los viajes viejos del TMS siguen resolviendo · el override por campo cubre
nombre, clientes y tipo de operación.

**Cert 3:** "Pedir a Certificación", versión mínima: un botón en el panel de documentos (solo lectura para Operaciones) que
crea una solicitud en la cola de Certificación con el contexto del viaje o del Cierre; Certificación la marca como resuelta.
Pablo lo valida en dev durante B.

**D4:** la ficha de conductor/equipo del Directorio **no replica el Monitor** (patrón Samsara/Fleetio: el perfil resume y
enlaza). Muestra una tarjeta "Actividad": último viaje (fecha · cliente) y la cantidad de viajes de los últimos 30 días, con
el botón **"Ver viajes en el Monitor"**, que lo abre filtrado por ese conductor o esa patente. Es útil para las dos áreas sin
mezclar mundos. Listas propias de Conductores y de Equipos: sí (alcance completo).

## Entrega A — D2 + Sin clasificar

**D2 (base → API → pantalla):**
- Base: `app.fleet_assignment_periods` alimentada por trigger desde `driver_assignments`, `asset_assignments` y
  `carrier_shippers`; siembra = asignaciones vigentes; `app.carrier_of(entity, on_date)` lee el historial (hoy existe solo
  la versión del día, migración `20261013090000_directory_one_answer.sql`); bloqueo de fecha efectiva ≤ último día firmado.
- API: **un servicio único de relaciones** (`services/fleet_assignments.py`, nuevo): asignar, transferir con fecha, terminar,
  reincorporar (traer el existente), y lo mismo para empresa–cliente. Reemplaza las cuatro orquestaciones actuales. Reusar
  `services/assignment_guard.py` y `utils/identity.py`.
- Cierre: `daily_closures.py` adopta `carrier_of(…, día)`: MISMATCH con la empresa del día y equipos atribuidos "al término"
  (F19); `in_scope_sql` sobre `app.active_fleet` (M4); `ultima_empresa_sql` e "Ingresó hace N días" pasan al historial.
- Baja de empresa: endpoint de vista previa del impacto + reactivar eligiendo la flota (P3).
- Monitor: marca en la tabla la flota que no es de la empresa del viaje (conductor y tracto).
- Frontend: diálogo de transferir con fecha, editar clientes en la ficha del Directorio, vista previa de la baja,
  reactivación con selección. Invalidar con `invalidateDirectory` (`lib/queries/directorio.ts`).

**Cert 2a (Sin clasificar B):** lista y detalle con el esqueleto de Pendientes, grupos por "qué falta", "Confirmar N";
`classify-batch` por pares (ítem → registro); `carrier_id` derivado del titular sugerido (corrige H1); subida con hash
idempotente; borrado lógico; la fila de revisión es `BulkUploadReview` con una prop de origen; "Enviar a Sin clasificar"
desde Pendientes viaja con su tipo (`_from_manifest`, `document_matcher.py:115`); el menú se filtra por permiso.

**Deuda de D1 que entra por tocar lo mismo:** fechas del navegador en UTC en `vigenciaDeLaFila`/`expiryRelative` (M5);
orden del Directorio sin desempate por id.

## Entrega B — Cert 3 + D3

- **Cert 3:** un solo panel de documentos por entidad (lo usan la ficha del Directorio, la vista rápida y el Cierre), en
  solo lectura para Operaciones con "Pedir a Certificación" → solicitud en la cola de Certificación (tabla nueva de
  solicitudes con estado abierta/resuelta y el contexto `trip_id`/`closure_date`).
- **D3:** override por campo (nombre, clientes, tipo de operación) en lugar del override por fila; el pre-cierre lee la marca
  por campo y ya no escribe la empresa del tracto desde el TMS; corregir RUT/patente con permiso + motivo + `audit_log`;
  alias de patente para el equipo; quitar el tipo de operación. PATCH normaliza patentes (M6, deuda de D1).
- Deuda que entra: chip "Tractoreo" doble en la ficha de Certificación.

## Entrega C — D4 + Cert 2b + Cert 4 + D5

- **D4:** listas de Conductores y Equipos (filtros: sin empresa, de baja, sin origen); fichas propias de conductor y equipo
  con la tarjeta "Actividad"; **una** ficha de empresa que absorbe `GestionDeclarada` y las acciones por sujeto; la vista
  rápida también en el Monitor; el origen del tracto mostrado como heredado.
- **Cert 2b:** retirar `compliance/[carrierId]`, con redirección desde la ruta vieja, una vez que la ficha única tenga todo lo
  que hoy solo vive ahí.
- **Cert 4:** Configuración › Certificación adopta `in_scope_sql`/`is_operating` ("Alcanzaría a N de N", L6) y una
  taxonomía vacía muestra una lista vacía (L7).
- **D5:** retirar huérfanos (`fleet-daily-overview`, `listContacts`, `invalidate_trips_meta_cache`), `/buscar` y
  `/directorio` en inglés con alias, `REFRESH` selectivo (F-18), unificar `taxonomias`/`taxonomies`, un solo alta de
  conductor (F-23). Partir `carriers.py` solo donde D4 ya lo toque.

## Secuencia de trabajo

1. **Entrega 0 (corta, ~1 h):** barrera de CI (tsc + vitest) y los 8 recorridos de humo en `monitor-app/frontend/scripts/`
   contra la copia local. Sirve para las tres entregas.
2. Por entrega: documento (HU + criterios + contratos + tareas) → aprobación del usuario → ejecución inline (base → API →
   pantalla), con tests del área → humo E2E → un despliegue a dev → mirar en dev con sesión → una revisión → AGENTLOG.
3. Validaciones con Pablo, en paralelo y sin bloquear: "Pedir a Certificación" (B) y el tracto GPRZ30 sin tipo ni empresa
   (28 viajes fuera del Cierre). Este último es un dato que se carga, no código.

## Verificación

- Por criterio de aceptación: su test en verde (backend `monitor-app/backend/api/venv/bin/pytest tests/<área>`, frontend
  `npm test -- <área>`), visto en rojo antes de implementar.
- Antes de desplegar: `npx tsc --noEmit`, vitest del área, `npx playwright test scripts/smoke` contra la copia local en verde.
- Después de desplegar: workflows en verde, las migraciones aplicadas verificadas con `psql` (SELECT), y un recorrido en dev con
  sesión para cada rol, sin guardar datos reales salvo que el criterio lo pida. Las cifras del Directorio, Pendientes y
  Certificación tienen que coincidir para 2 empresas.
- Al cerrar cada entrega: actualizar `AGENTLOG.md` (y archivar el checkpoint de D1 cuando A cierre).
