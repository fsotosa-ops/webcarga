# Cierre: anulación con motivo y firma versionada — diseño

Fecha: 2026-10-10 · Estado: spec aprobada (10/10) · Rama: `dev`

> **Ajuste al planificar (10/10):** "los viajes del día" de la firma y de los ajustes son
> `app.trips` con `planning_date = D` y sin anular, no `trips_del_dia(D)`. Es el universo que ya
> firmaba `frozen_totals.viajes` y que usa el aviso actual (`SQL_TOTAL_TRIPS_DEL_DIA`), y reconstruye
> exacto las 25 firmas existentes (`created_at <= closed_at`: 25 de 25 iguales a `viajes`;
> con `trips_del_dia` cuadraban 4 de 15). La regla de quién anula mira ese mismo día.

## 1. Contexto y objetivo

El 10/10, para borrar 6 viajes manuales duplicados del 23/09 (Carlos Pérez), se reabrió ese día firmado. El
ejecutor de la cola lo recalculó en segundos con los datos y reglas de hoy y reescribió 78 líneas (123 → 127, 0 → 2
pendientes). Se restauró a mano desde las tablas viejas (`driver_day_status`/`equipment_day_status`) y se auditó
como `cierre_restaurado`. Operaciones lo dijo así: *"es como mezclar peras con manzanas"*.

El incidente muestra tres huecos del modelo actual:

1. **Corregir un día firmado obliga a reabrirlo.** `services/eliminar_viajes.py` bloquea con *"reabre ese día
   para eliminarlo"*, y reabrir recalcula.
2. **Eliminar es borrado físico.** El viaje desaparece de `app.trips`, `app.trips_manual`, paradas, vínculos y
   notas; solo queda una fila `delete` en `audit_log`.
3. **Lo firmado no tiene copia propia.** `closure_lines` es la verdad viva del día; al reabrir se reescribe. El
   único respaldo de lo firmado son las 4 tablas viejas, que el contract de la spec del recálculo iba a retirar.

Además, el aviso "N viajes posteriores al cierre" (`daily_closures.py`) es una resta de totales
(`max(0, viajes_hoy − frozen_totals.viajes)`): un viaje agregado y otro quitado dan 0, y no dice cuáles ni por qué.

**Objetivo:** que un día firmado nunca cambie, que las correcciones posteriores se registren como ajustes con
motivo y que cada firma quede como copia inmutable. Es el estándar de cierre de período (contabilidad/ERP): un
período cerrado no se modifica, los errores se corrigen con un ajuste que referencia al original y lo cerrado se
muestra como lo firmado más el delta.

**Decisiones de Operaciones (10/10):**
- Eliminar pasa a **anular con motivo** (borrado lógico auditado).
- Cada firma guarda una **copia inmutable**, versionada.
- Quién anula depende **del día**: abierto, el creador o Administración; firmado, quien puede firmar.

## 2. Anulación con motivo

### 2.1 Datos

Columnas nuevas en `app.trips_manual` y `app.trips`:

| Columna | Tipo | Significado |
|---|---|---|
| `voided_at` | `timestamptz NULL` | Cuándo se anuló. `NULL` = vigente. |
| `voided_by` | `uuid NULL` | Quién anuló. |
| `void_reason` | `text NULL` | Motivo, obligatorio al anular. |

`CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL))`: las tres van
juntas, sin un `NULL` con dos significados.

Mismo patrón que `unassigned_reason_id`:
- La API escribe las dos tablas en la misma transacción.
- La rama manual de `models/app/trips.sql` (Mage) lleva `m.voided_at`, `m.voided_by` y `m.void_reason` desde
  `app.trips_manual`; la rama TMS lleva `NULL`.
- Las tres van en `merge_exclude_columns`, para que el merge no pise lo que escribió la API.

Solo se anulan viajes manuales (`source_system = 'manual'`). Un viaje del TMS vuelve en la próxima ingesta;
anularlo sería mentir. Es la misma regla que hoy tiene eliminar.

### 2.2 Efecto

- El filtro `voided_at IS NULL` va en las definiciones únicas, no en cada consumidor:
  - `app.trips_del_dia(D)`: los viajes que ocupan el día. Cubre las líneas del Cierre, el reporte, los
    disponibles y la vista de flota.
  - `SQL_VIAJES_DEL_DIA` (`services/cierre_viajes.py`, reemplaza a `SQL_TOTAL_TRIPS_DEL_DIA`): los viajes del día
    (`planning_date = D`) para la firma y los ajustes.
  - `SQL_BASE` de `services/cierre_viajes.py`: la pestaña "Viajes" del Cierre.
  - El listado del Monitor (`GET /trips`).
  Las heurísticas sobre historia (último tracto conocido, sugerencia de origen, actividad de 30 días en
  Certificación) no se filtran: miran viajes de cualquier fecha y un duplicado anulado no las cambia.
- Monitor: los anulados no aparecen en el listado. El detalle (`GET /trips/{id}`) sí los abre, con la insignia
  "Anulado", quién, cuándo y el motivo; así llega a ellos el enlace "Ver viaje" de un ajuste.
- Un día abierto se recalcula solo: el `UPDATE` en `app.trips` dispara `trg_enqueue_closure_recompute_upd`.
- En un día firmado no cambia nada de lo firmado: el día no se recalcula (status `CLOSED`) y la anulación
  aparece como ajuste posterior (sección 4).

### 2.3 Servicio y permisos

`services/anular_viajes.py` reemplaza a `services/eliminar_viajes.py`, que se borra junto con el borrado físico.
Conserva lo que ya estaba bien: todo o nada, validar todos antes de escribir, `FOR UPDATE`, una sola regla de
bloqueo que usan el listado (`can_void`) y la escritura, y el máximo de 200 por lote.

| Día del viaje | Puede anular |
|---|---|
| Su día (`planning_date`) abierto | Quien lo creó (`trips.void`), o `trips.void_any` (Administración). |
| Su día (`planning_date`) firmado | `closures.sign`. |

- Motivo obligatorio (texto no vacío, 422 si falta).
- **Revertir la anulación** (`POST /trips/void/revert`) exige los mismos permisos, devuelve el viaje al día y
  queda como ajuste del mismo modo.
- Auditoría en `audit_log` con `auditar_en_lote` (`services/audit.py`): `entity_type='TRIP'`, `action='void'` o
  `'void_revert'`, motivo incluido.
- RBAC: `trips.delete` → `trips.void` y `trips.delete_any` → `trips.void_any` en `authz/permissions.py`, en el
  catálogo de la base y en el test de la matriz de roles. Los roles que hoy tienen el permiso viejo reciben el
  nuevo en la misma migración.
- Endpoints: `POST /trips/void` (lote, `{trip_ids, reason}`) y `POST /trips/void/revert` reemplazan al endpoint de
  eliminación. Rutas en inglés, etiqueta en español ("Anular").

## 3. Firma versionada

### 3.1 Datos

Tres tablas nuevas, solo de inserción:

**`app.closure_signatures`**, una fila por firma:

| Columna | Tipo |
|---|---|
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` |
| `business_date` | `date NOT NULL` |
| `version` | `int NOT NULL`, `UNIQUE (business_date, version)` |
| `signed_by` | `uuid NOT NULL` |
| `signed_at` | `timestamptz NOT NULL` |
| `override_count` | `int NOT NULL` |
| `override_note` | `text NULL` |
| `totals` | `jsonb NOT NULL` (mismas claves que hoy `frozen_totals`) |
| `captured_from` | `text NOT NULL CHECK (captured_from IN ('signing', 'backfill'))` |

**`app.closure_signature_lines`**: copia tipada de cada línea de `closure_lines` al firmar. Lleva
`signature_id` más las columnas de la línea: sujeto, estado, motivo, vigencia, comentario, origen habitual,
quién resolvió y cuándo. Es tabla y no un JSON para poder consultarla y validarla.

**`app.closure_signature_trips`** (`signature_id`, `trip_id`, PK compuesta): los viajes del día al firmar, es
decir, `app.trips` con `planning_date = D` y sin anular. Es el mismo universo que `totals.viajes`. Es lo que permite decir qué viajes llegaron o salieron después (sección 4). No basta con
`created_at > signed_at`, porque un viaje del TMS que llega tarde también es posterior al cierre.

**Inmutabilidad en la base:** el trigger `trg_reject_signature_changes`, con la función
`app.reject_signature_changes()`, rechaza todo `UPDATE` y `DELETE` en las tres tablas. Es el estándar de las
tablas de auditoría: se verifica en la base y no depende de que el código se porte bien.

### 3.2 Flujo

- **Firmar** (`cierre_lineas.cerrar`): en la misma transacción atómica de hoy (bloqueo, recálculo, avisos, firma,
  limpieza de la cola) inserta la firma con versión `max(version) + 1`, copia las líneas y el conjunto de viajes.
- **Reabrir:** el día vuelve a `OPEN`; las firmas quedan intactas. Si se vuelve a firmar, nace la versión 2.
- **Una sola fuente de "quién firmó y qué":** los lectores (`daily_closures`, `equipment_closures`,
  `periodo_del_dia`) leen la firma vigente, es decir, la de mayor versión de un día `CLOSED`.
  `closure_periods` queda con el estado del día y la reapertura. Sus columnas `closed_by`, `closed_at`,
  `override_count`, `override_note` y `frozen_totals` se dejan de escribir y se retiran en el contract
  (sección 5, paso 6).
- **API:** `GET /closures/{business_date}/signatures` devuelve el historial (versión, quién, cuándo, totales),
  con el permiso de lectura del Cierre.

### 3.3 Carga inicial

Cada día `CLOSED` recibe su versión 1 con `captured_from = 'backfill'`:
- Firma: desde `closure_periods`, con `closed_by`, `closed_at`, `override_count`, `override_note` y
  `frozen_totals`.
- Líneas: desde su `closure_lines` actual, que es la firmada (el 23/09 ya está restaurado).
- Viajes: `app.trips` con `planning_date = D` y `created_at <= closed_at` (`created_at` está en
  `merge_exclude_columns`: es la primera vez que el viaje entró).

La migración compara, para cada día, las líneas copiadas con las de `closure_lines` y los viajes con
`frozen_totals->>'viajes'`. Si algo no coincide, aborta (medido el 10/10: los 25 días coinciden).

## 4. Ajustes posteriores al cierre

Reemplazan el conteo "N viajes posteriores al cierre" por una lista. Hay una sola definición en
`services/cierre_lineas.py` (`ajustes_posteriores(conn, fecha)`), que sustituye a `SQL_TOTAL_TRIPS_DEL_DIA`
y a la resta en `daily_closures.py`:

- **Agregado:** está en los viajes del día (`planning_date = D`, sin anular) y no en `closure_signature_trips` de la firma vigente.
- **Quitado:** está en la firma y no en los viajes del día. Si fue por anulación, trae quién, cuándo y el motivo.
  Si no, figura como "Ya no está en el día" (por ejemplo, el TMS lo movió de fecha).

`GET /daily-closures` devuelve `cierre.ajustes` (lista) en lugar de `posteriores_al_cierre`.
`AvisoPosteriorAlCierre` pasa de mostrar un número a mostrar la lista. Los totales firmados no cambian: el día
firmado se muestra como lo firmado más esta lista.

## 5. Despliegue

1. **Migración (expand), en una transacción**, ensayada antes con `ROLLBACK`:
   - columnas de anulación y su `CHECK` en `app.trips_manual` y `app.trips`;
   - las tres tablas de firma con su trigger de inmutabilidad;
   - carga inicial con verificación;
   - `trips_del_dia` sin anulados;
   - permisos `trips.void` y `trips.void_any`, asignados a los roles que tienen los viejos.
2. **Mage**, en la misma ventana entre corridas: la rama manual lleva las columnas de anulación y las tres van en
   `merge_exclude_columns` del modelo `trips`. Se sincroniza con `sync_local_to_remote` y se verifica la corrida
   siguiente.
3. **API:**
   - `anular_viajes.py` y sus endpoints; se borran `eliminar_viajes.py` y el endpoint de eliminación;
   - `cerrar` escribe la firma; los lectores leen la firma vigente;
   - `GET /closures/{business_date}/signatures` y `cierre.ajustes`.
4. **Frontend:**
   - el diálogo "Anular" con motivo obligatorio reemplaza a "Eliminar";
   - la insignia "Anulado" en el detalle y el historial;
   - la lista de ajustes en el día firmado;
   - el historial de firmas.
5. **Uso:** se anulan desde la app los 6 duplicados del 23/09 (038cd817…, 4371e9c1…, 26c2cea0…, 7bb5a2fe…,
   9ec39f27…, 9cfca7b6…) con motivo "Duplicado". Se mantienen 747ebcec… y el del 24/09 (e6151201…). El 23/09
   sigue firmado; los 6 aparecen como ajustes.
6. **Contract, más adelante y por separado:** se retiran las columnas de firma de `closure_periods` y las 4
   tablas viejas, solo con respaldo previo y con cada día firmado verificado con su versión 1.

## 6. Pruebas

Todas de integración con `ROLLBACK` contra la base real, salvo la guarda de dbt y la matriz de roles. Cada una
debe fallar antes del cambio que prueba (mutación verificada).

- `UPDATE` y `DELETE` en las tres tablas de firma son rechazados.
- Firmar crea la versión 1 con líneas y viajes. Reabrir y volver a firmar crea la versión 2; la versión 1 queda
  igual.
- En un día abierto, el viaje anulado sale de `trips_del_dia` y de las líneas al recalcular.
- En un día firmado, anular no toca `closure_lines` ni la firma, y el viaje aparece en `ajustes` como quitado,
  con su motivo.
- Un viaje que entra al día después de la firma aparece en `ajustes` como agregado, aunque otro haya salido: el
  caso que la resta de totales escondía.
- Revertir la anulación devuelve el viaje al día. Anular y revertir quedan en `audit_log`.
- Permisos:
  - en un día abierto, anula el creador, o un usuario con `trips.void_any`;
  - en un día firmado, solo `closures.sign`;
  - falta de motivo → 422; viaje del TMS → 409.
  - Va en la matriz de roles.
- Guarda: las columnas de anulación están en `merge_exclude_columns` y en la rama manual de
  `models/app/trips.sql`.
- Carga inicial: una versión 1 por día firmado, con el mismo número de líneas que `closure_lines`.

## 7. Fuera de alcance

- **Restaurar una firma anterior** como versión nueva. Con la copia guardada es posible, pero hoy no hace falta
  (YAGNI). Queda registrado en el issue de GitHub
  [#13](https://github.com/fsotosa-ops/webcarga/issues/13).
- Anular viajes del TMS.
- El contract (sección 5, paso 6), que va en su propio cambio.
