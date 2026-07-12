> **DEPRECADO 2026-07-12** — reemplazado por upload directo a `app` con preview/diff y aprobación (ver `docs/superpowers/plans/2026-07-12-empresas-seguros-checkpoint-a-schema.md`). Este pipeline queda congelado (`sync_config.sync_enabled=false`), no se borra — es la referencia de la lógica de parseo que se portó a `centralizer_parser.py`.

# Pipeline `centralizer_to_app` (HÍBRIDO: dbt staging + bloques SQL)

Bronze (`bronze.raw_centralizer_*`, `bronze.raw_info_contacto`, `bronze.raw_insurance_vehicles`)
→ silver (`silver.stg_*`, **vistas materializadas por dbt** dentro de Mage Pro)
→ `app.*` (upsert idempotente en bloques SQL, gobernado por `app.sync_config`).

Ver plan completo: `monitor-app/docs/plan-modulo-empresas-seguros.md` §2.

## Por qué híbrido

- **Staging en dbt** (directorio `dbt/`): la capa staging es declarativa (un
  SELECT por modelo), y en dbt gana tests (`schema.yml`), lineage
  (source/ref) y el mismo formato que los `stg_*` de trips que ya viven en
  el proyecto dbt de Mage Pro.
- **Gate / rejects / upserts / finalize fuera de dbt** (bloques `00`, `15`,
  `20`-`23`, `30`): son imperativos (INSERT a ops, transacciones con
  advisory lock, ON CONFLICT con protección de `manually_edited_fields`).
  Meterlos a dbt obligaría a modelar las tablas OLTP de `app` como modelos
  dbt, exponiéndolas a `--full-refresh` (drop + recreate) — exactamente la
  clase de incidente recurrente que ya se vivió con `app.trips` (tabla
  operacional pisada por tooling de pipeline; de ahí salen el refactor de
  `app.trips` y el congelamiento del workstream de ingesta). Las tablas de
  `app` guardan ediciones manuales de usuarios: nunca deben poder ser
  recreadas por una herramienta de transformación.

## Estructura

```
centralizer_to_app/
  00_gate.sql              # bloque SQL: batch + schema drift gate + funciones silver.*
  dbt/                     # 7 modelos staging (materialized='view', schema='silver')
    stg_centralizer_transporters.sql
    stg_centralizer_transporter_docs.sql
    stg_centralizer_drivers.sql
    stg_centralizer_driver_docs.sql
    stg_centralizer_vehicles.sql
    stg_centralizer_vehicle_docs.sql
    stg_insurance_vehicles.sql
    sources.yml            # source bronze (5 tablas)
    schema.yml             # tests: unique/not_null/accepted_values
  15_rejects.sql           # bloque SQL: re-detecta y loguea ops.pipeline_rejects
  20_upsert_transporters.sql
  21_upsert_drivers.sql
  22_upsert_vehicles.sql
  23_upsert_insurance.sql
  30_finalize.sql
  local_apply_views.sql    # helper SOLO validación local (no se porta)
```

## DAG (orden de ejecución)

```
00_gate  (bloque SQL: abre ops.pipeline_runs 'running' + drift gate + funciones)
   ↓
dbt run + dbt test  (7 modelos → vistas silver.stg_*)
   orden interno resuelto por ref():
     stg_centralizer_transporters
       → stg_centralizer_transporter_docs
       → stg_centralizer_drivers → stg_centralizer_driver_docs
       → stg_centralizer_vehicles → stg_centralizer_vehicle_docs
     stg_insurance_vehicles          (rama independiente, solo source)
   ↓
15_rejects  (bloque SQL: puebla ops.pipeline_rejects re-evaluando exclusiones)
   ↓
20_upsert_transporters → 21_upsert_drivers
                       → 22_upsert_vehicles
                       → 23_upsert_insurance
   ↓
30_finalize  (cierra la corrida con conteos)
```

- `00_gate.sql` debe correr ANTES del primer `dbt run`: crea las funciones
  `silver.parse_centralizer_date` / `silver.parse_insurance_date` /
  `silver.map_doc_status` que los modelos invocan, y si detecta schema
  drift hace `RAISE EXCEPTION` → Mage debe abortar el run completo sin
  disparar dbt ni los bloques siguientes.
- `15_rejects.sql` corre DESPUÉS de `dbt test` (así los rejects reflejan
  las vistas ya validadas) y ANTES de los upserts.
- Los bloques `20`-`23` son cada uno UNA transacción con
  `pg_advisory_xact_lock`; no dividirlos en bloques Mage más chicos
  (romperia la atomicidad). `21`/`22`/`23` dependen de `20` (resuelven
  `rut_empresa`/`rut` → `transporter_id` contra `app.transporters` ya
  actualizado).
- Si algo entre dbt y `23` falla a mitad de camino, la corrida queda
  `running` en `ops.pipeline_runs` — revisar a mano (no hay timeout
  automático). Cada bloque `20`-`23` hace rollback completo de sí mismo si
  falla (BEGIN/COMMIT explícito).

## Dónde van los archivos dbt en el proyecto de Mage Pro

Los 7 modelos + `sources.yml` + `schema.yml` se copian al proyecto dbt que ya
existe en Mage Pro (el mismo de los `stg_*` de trips — SQL de referencia en
`monitor-app/docs/`), en un subdirectorio propio de modelos, p. ej.
`models/staging/centralizer/`. `sources.yml` y `schema.yml` viven junto a los
modelos en ese subdirectorio (convención dbt: los .yml aplican a cualquier
nivel bajo `models/`). Los nombres de modelo == nombres de vista que los
upserts ya referencian (`silver.stg_centralizer_transporters`, etc.), así que
los bloques 15-30 no cambian al portar.

Nota: los modelos usan `{{ config(schema='silver') }}` igual que los stg_* de
trips — asume que el proyecto dbt ya resuelve el nombre de schema literal
(sin prefijo `<target>_`), como se materializan los stg de trips hoy.

## Cómo ejecutar para validación local (sin Mage/dbt)

```bash
psql "$DATABASE_URL" \
  -f 00_gate.sql \
  -f local_apply_views.sql \
  -f 15_rejects.sql \
  -f 20_upsert_transporters.sql \
  -f 21_upsert_drivers.sql \
  -f 22_upsert_vehicles.sql \
  -f 23_upsert_insurance.sql \
  -f 30_finalize.sql
```

`local_apply_views.sql` crea las 7 vistas con SQL puro (mismos SELECT que los
modelos dbt, con nombres de tabla reales en vez de `source()`/`ref()`, más un
DO inicial que limpia tablas físicas homónimas del formato anterior). Es
SOLO para validación local del orquestador — en producción las vistas las
materializa dbt y ese archivo NO se porta. Si editas un modelo dbt, replica
el cambio en `local_apply_views.sql` (y viceversa).

Re-correr todo el pipeline con los mismos datos bronze es **idempotente** en
`app.*`: mismos conteos, sin duplicados, sin transferencias espurias, sin
nuevas filas de `audit_log`. `ops.pipeline_rejects` sí acumula filas por
corrida (cada batch loguea sus propios rejects — diseño, no bug).

## Vistas vs tablas físicas (cambio de semántica respecto del formato anterior)

Las `silver.stg_*` ahora son **vistas**: se evalúan contra bronze en el
momento de cada lectura, no son un snapshot congelado al inicio de la
corrida. Implicación: si bronze cambiara ENTRE el `dbt test` y los upserts
(20-23), los upserts verían datos distintos de los testeados. Mitigación
operativa: el loader de bronze no debe correr mientras el pipeline está en
curso (misma ventana que ya asumía el gate). Cuando bronze tenga
`batch_id`/`loaded_at` (ver siguiente sección), los modelos pueden filtrar
por el último batch y esta ventana desaparece.

## Duplicación deliberada dbt ↔ 15_rejects.sql

Los modelos dbt no pueden escribir en `ops.pipeline_rejects` (son un SELECT).
`15_rejects.sql` re-declara los mismos predicados (ranking de dedupe por
ctid, normalización de rut/patente, parse de fechas, map de status) para
loguear lo que los modelos excluyen o marcan:

| Reason | Qué re-detecta | Efecto en el stg |
|---|---|---|
| `rut_dv_invalido` | transporters y drivers con `app.rut_dv(rut) <> dv` (leído de las vistas) | la fila SIGUE en el stg |
| `duplicado` | perdedores del dedupe de drivers (rut) y vehicles (patente) — re-ranking de bronze | fuera del stg |
| `huerfano` | drivers/vehicles cuyo `rut_empresa` no está en `stg_centralizer_transporters` | fuera del stg |
| `fecha_invalida` | columnas de fecha de bronze no vacías/no `'-'` cuyo parse da NULL (drivers ×2, vehicles ×4, insurance ×3, enumeradas una a una) | el campo queda NULL, la fila sigue |
| `valor_no_mapeado` | columnas de status no vacías que `map_doc_status` deja NULL (transporter ×14, driver ×12, vehicle ×6 — **EXCEPTO** `creación_en_gc` de vehicles, que se salta silenciosa), `tipo_de_equipo` no reconocido, y filas de seguros sin póliza o sin nº de cuota numérico | doc/campo NULL o fila fuera |

Costo aceptado del híbrido: si se cambia un predicado en un modelo dbt hay
que cambiarlo también en `15_rejects.sql` (las secciones están rotuladas con
el modelo al que espejan). Verificación cruzada rápida: los conteos de
rejects `duplicado`+`huerfano` deben cuadrar con
`count(bronze) - count(vista)` por tabla.

## Contrato de ingesta bronze pendiente (batch_id / loaded_at)

Bronze **todavía no tiene** columnas `batch_id`/`loaded_at`. El `batch_id`
que usa este pipeline es el contador propio de `ops.pipeline_runs`
(`pipeline = 'centralizer_to_app'`), no una columna de bronze. Cuando el
loader de Pablo/Fabián empiece a setearlas (carga = full snapshot con batch
nuevo, nunca append sin batch — plan §2.1), los modelos dbt pueden filtrar
por el último `batch_id` de bronze. Hasta entonces, las vistas leen **toda**
la tabla bronze (asumen snapshot completo, no incremental).

## Funciones compartidas (creadas en `00_gate.sql`)

| Función | Uso |
|---|---|
| `silver.parse_centralizer_date(text)` | Fechas mixtas de `raw_centralizer_*` (ISO y M/D/YYYY gringo con heurística: si el primer número es >12, se reinterpreta como D/M/YYYY). |
| `silver.parse_insurance_date(text)` | Fechas de `raw_insurance_vehicles`: siempre D/M/YYYY (formato confirmado en los datos, sin heurística de ambigüedad). |
| `silver.map_doc_status(text)` | `ok/pendiente/factible/actualizar/n_a` case-insensitive + trim. NULL para vacío o valor no reconocido — `15_rejects.sql` distingue ambos casos comparando contra el crudo. |
| `app.normalize_rut(text)` | Ya existía (migración `20260709100001`). |
| `app.rut_dv(text)` | Ya existía (migración `20260709100001`). |

## Tabla de mapeo columna → destino (completa)

### `bronze.raw_centralizer_transporter` → `silver.stg_centralizer_transporters` (+ `_transporter_docs`)

Grano: 1 fila por rut (dedupe: gana la fila `gc = 'Walmart'` primero;
`clients` = unión de todas las GC vistas para ese rut).

| Columna bronze | Destino | Nota |
|---|---|---|
| `nombre___razón_social` | `business_name` | |
| `rut` | `rut` | ya viene normalizado sin DV; se re-normaliza con `app.normalize_rut` por higiene |
| `dv` | `dv` | + `rut_dv_valid` vía `app.rut_dv(rut)` |
| `gc` | `clients[]` | `array_agg(distinct gc)` por rut |
| `avance_80_20` | `avance_80_20` | `"86%"` → `86` |
| `avance_total` | `avance_total` | ídem |
| `link_de_pago` | `payment_url` | |
| `link_de_sharepoint` | `sharepoint_url` | |
| `seguro_eett__rc__en_uf`, `cobertura_rc`, `cuotas`, `vencimiento_cuota`, `estado` | **excluidos** | referenciales; canónico = `raw_insurance_vehicles` |
| `rol_sii` | doc `rol_sii` | |
| `copia_c_i_rep__legal` | doc `copia_ci_rep_legal` | |
| `anexo_repleg__gc_` | doc `anexo_2_gc` | renombrado desde `anexo_2_walmart` (naming genérico, no atado a cliente) |
| `validado_por_gc` | doc `validado_gc` | doc_code **nuevo** (migración `20260709100008`) |
| `contrato_webcarga` | doc `contrato_webcarga` | |
| `f30__multas_` | doc `f30_multas` | |
| `f43` | doc `f43` | |
| `política_de_seguridad` | doc `politica_seguridad` | |
| `cert__afiliación_mutual` | doc `cert_mutual` | |
| `riohs_timbrado` | doc `riohs_timbrado` | |
| `carpeta_tributaria` | doc `carpeta_tributaria` | |
| `cuenta_banco_empresa` | doc `cuenta_empresa` | |
| `procedimiento_de_trabajo_seguro_del_contratista` | doc `pts_contratista` | |
| `creación__en_gc` | doc `creacion_gc` | renombrado desde `creacion_walmart` |

Modelo llega hasta `rep_legal_email` — los contactos de las columnas de más
abajo (operacional/finanzas/documentos) los emite el modelo separado
`silver.stg_centralizer_transporter_contacts` (unpivot, grano `rut + role`,
mismo patrón que los docs), no columnas anchas de `stg_centralizer_transporters`.

Cruce con `bronze.raw_info_contacto` (por `app.normalize_rut(rut)`, dedupe 1
fila por rut, primera por orden físico):

| Columna `raw_info_contacto` | Destino |
|---|---|
| — (match encontrado) | `in_admin = true` |
| `id_interno_admin` | `admin_internal_id` (cast `::text::numeric::int`, tolera `"12345.0"`) |
| `id_cuenta_eett` | `admin_account_id` (ídem) |
| `representante_legal`, `teléfono_rl`, `correo_rl` | contacto rol `rep_legal` (single-sourced en `stg_centralizer_transporters`) |
| `contacto_operacional`, `tel__contacto_ops`, `correo_contacto_operacional` | contacto rol `operacional` (vía `stg_centralizer_transporter_contacts`) |
| `contacto_finanzas`, `tel_finanzas`, `correo_finanzas` | contacto rol `finanzas` (ídem) |
| `contacto_documentos`, `telefono_documentos`, `correo_documentos` | contacto rol `documentos` (ídem) |

Resto de columnas de `raw_info_contacto` (`validador`, `nombre_empresa`,
`razon_social`, flota, destinos, tipos de camión, `unnamed__31`) — **no
usadas** en este pipeline (fuera del alcance del plan Fase 3; quedan
disponibles en bronze para un futuro módulo de flota potencial).

### `bronze.raw_centralizer_drivers` → `silver.stg_centralizer_drivers` (+ `_driver_docs`)

Grano: 1 fila por `rut_conductor` normalizado. Duplicados (mismo conductor,
±empresa) → reject `duplicado`, gana el primero por orden físico. Huérfanos
(`rut_empresa` sin match en `stg_centralizer_transporters`) → reject
`huerfano`, quedan fuera.

| Columna bronze | Destino | Nota |
|---|---|---|
| `rut_conductor` | `rut` | normalizado |
| `dv_conductor` | `dv` | + `rut_dv_valid` (columna renombrada desde `dv_conductor`, consistente con `transporters.dv`/`vehicles`) |
| `nombre_completo` | `full_name` | |
| `rut_empresa` | `transporter_rut` | normalizado; ancla de asignación (columna renombrada desde `rut_empresa`) |
| `copia_c_i__vencimiento_` | `id_expiry` + doc `copia_ci` | doc: `ok` si fecha ≥ hoy, `actualizar` si <, NULL si no parsea |
| `licencia__vencimiento_` | `license_expiry` + doc `licencia` | ídem |
| `avance_total` | `avance_total` | |
| `dv_empresa` | — | no usado (DV de la empresa se valida en el bloque de transporters) |
| `gc` | — | nombre de cliente (Iansa/Walmart), NO es doc, se ignora |
| `anexo_gc_para_conductor` | doc `anexo_3_gc` | renombrado desde `anexo_3_walmart` |
| `epp` | doc `epp` | |
| `das___odi` | doc `das_odi` | |
| `hoja_de_vida` | doc `hoja_de_vida` | |
| `cert__antecedentes` | doc `cert_antecedentes` | |
| `validado_por_gc` | doc `validado_gc_driver` | renombrado desde `validado_walmart`; conceptualmente igual al `validado_gc` de transporter pero con sufijo `_driver` (doc_code es PK global, no puede repetirse) |
| `contrato_de_trabajo` | doc `contrato_trabajo` | |
| `toma_conoc__trab__plan_de_emergencia_del_mandante` | doc `toma_conoc_plan_emergencia` | |
| `toma_conoc__trab__procedimiento_de_trabajo_seguro` | doc `toma_conoc_pts` | |
| `capacitación_uso_y_mantención_de_epp` | doc `capacitacion_epp` | |
| `creación_en_gc` | doc `creacion_gc_driver` | renombrado desde `creacion_walmart_driver` |
| `f30_1` | doc `f30_1` | |

**Catálogo-sin-fuente (RESUELTO)**: el doc_code `gc_driver` ("Gran cuenta
(conductor)") no tenía columna origen en bronze y solapaba conceptualmente
con `validado_gc_driver` (que sí tiene fuente: `validado_por_gc`) — se
eliminó del catálogo en la migración de rename (§ Fase 1 de la auditoría
2026-07-10), en vez de mantener un doc_code huérfano permanente.

### `bronze.raw_centralizer_vehicles` → `silver.stg_centralizer_vehicles` (+ `_vehicle_docs`)

Grano: 1 fila por patente normalizada (`upper(replace(patente,' ',''))`).
Duplicados → reject `duplicado`. Huérfanos → reject `huerfano`, quedan fuera.

| Columna bronze | Destino | Nota |
|---|---|---|
| `patente` | `plate` | normalizada |
| `tipo_de_equipo` | `kind` + `type_label` | `TRACTOCAMION→tracto`, `RAMPLA→rampla`, otro valor → `kind='otro'` + reject `valor_no_mapeado`; `type_label` conserva el crudo |
| `año` | `year` | `split_part(...,'.',1)::int` (tolera `"2019.0"`) |
| `rut_empresa` | `transporter_rut` | normalizado; ancla de asignación (columna renombrada desde `rut_empresa`) |
| `p__circulación` | `circ_permit_expiry` + doc `permiso_circulacion` | doc: `ok`/`actualizar` por fecha |
| `re__técnica` | `tech_inspection_expiry` + doc `revision_tecnica` | ídem |
| `gases_contaminantes` | `gas_emissions_expiry` + doc `gases` | ídem |
| `seguro__soap_` | `soap_insurance_expiry` + doc `soap` | ídem |
| `padrón` | doc `padron` | vía `map_doc_status` |
| `gps` | doc `gps` | |
| `mantención_cámara_frío` | doc `mantencion_camara_frio` | |
| `resolucion_sanitaria` | doc `resolucion_sanitaria` | |
| `póliza_vehicular_con_rc` | doc `poliza_rc` | |
| `seguro_de_carga` | doc `seguro_carga` | |
| `creación_en_gc` | doc `creacion_gc_vehicle` | renombrado desde `creacion_walmart_vehicle`. **excepción**: en datos reales trae `'Sodimac'` (nombre de cliente); si `map_doc_status` no matchea, NO se emite fila de doc y NO se genera reject (única excepción a la regla general) |
| `dv_empresa` | — | no usado |
| `cobertura_rc`, `cuotas`, `vencimiento_cuota`, `estado`, `link_de_pago_rc_vehicular`, `cobertura_sc`, `cuotas_1`, `vencimiento_cuota_1`, `estado_1`, `link_de_pago_seguro_de_carga` | **excluidos** | referenciales; canónico = `raw_insurance_vehicles` |

### `bronze.raw_insurance_vehicles` → `silver.stg_insurance_vehicles`

Grano: 1 fila por cuota (grano nativo de bronze). Filas sin `póliza` o sin
`cuota__número_` numérico → reject `valor_no_mapeado`, fuera del stg.

| Columna bronze | Destino | Nota |
|---|---|---|
| `rut` | `rut_norm` | `app.normalize_rut()` — tolera `77.737.756-6` |
| `contratante` | `contractor_name` | |
| `grupo` | `client_group` | |
| `compañía` | `company` | |
| `póliza` | `policy_number` | requerido |
| `endoso` | `endorsement` | `::numeric::int::text`, NULL si vacío |
| `vigencia__desde_` | `valid_from` | `silver.parse_insurance_date` (D/M/YYYY) |
| `vigencia__hasta_` | `valid_to` | ídem |
| `cobertura` | `coverage` | |
| `cobertura` | `plate` | regex `Patente:\s*([A-Za-z0-9]+)`, NULL si no matchea |
| `cobertura` | `policy_type` | `Patente:%` o `%VEHIC%` → `rc_vehicular`; `%carga%` → `carga`; si no → `otro` |
| `cuota__número_` | `installment_number` / `total_installments` | split por `' de '`; requerido numérico |
| `valor_cuota_uf` | `amount_uf` | |
| `vencimiento` | `due_date` | `silver.parse_insurance_date` |
| `estado` | `status` | `PAGADA/PAGADO/PAGO` → `pagada`; si no y `due_date < hoy` → `vencida`; si no → `pendiente` |

## Decisiones de upsert (`20`–`23`) que requieren OK del orquestador antes de ejecutar

1. **Advisory lock**: se toma como `SELECT pg_advisory_xact_lock(...)` a nivel
   top-level de la transacción (no dentro de cada `DO $$`), una sola vez por
   archivo, antes de los bloques de guard. Cubre toda la transacción hasta
   el `COMMIT`. Interpretación elegida sobre el enunciado del plan —
   funcionalmente equivalente, más simple de leer.
2. **Caso Lumiliz (`20`, paso a1)**: el UPDATE por `admin_internal_id` solo
   corrige `rut`/`dv`/`rut_dv_valid` del registro existente; el resto de
   columnas las aplica el upsert normal por `rut` inmediatamente después (ya
   matcheando). No se protegen `dv`/`rut_dv_valid` fuera de
   `manually_edited_fields`.
3. **`clients[]`** nunca se protege por `manually_edited_fields` (unión
   incondicional), tal como especifica el plan.
4. **`account_stage`/`is_active`** se fuerzan siempre (`'Operational'`/
   `true`) en cada corrida mientras el transporter siga apareciendo en
   bronze — no hay protección manual para estos dos campos vía el mecanismo
   de upsert (la única forma de desactivar es la regla N=2 o una acción
   directa desde la app/API, fuera de este pipeline).
5. **Idempotencia de `app.insurance_installments`**: el UNIQUE
   `(policy_id, installment_number, due_date)` (definido en la migración
   `20260709100004`, no modificable desde acá) trata dos filas con
   `due_date IS NULL` como NO conflictivas entre sí (semántica estándar de
   NULL en UNIQUE constraints de Postgres). Si una cuota llega sin
   `vencimiento` parseable en dos corridas distintas, el `ON CONFLICT` no la
   deduplicará — quedarán dos filas. Riesgo conocido, no mitigado en este
   pipeline (requeriría cambiar el UNIQUE de la tabla, fuera de alcance de
   Fase 3). Señalar a Fabián si en la práctica hay cuotas sin `vencimiento`.
6. **`app.v_sync_divergence`** (migración `20260709100008`) generaliza el
   esquema de salida del plan (`transporter_id, rut, field, app_value,
   source_value`) a `(entity_type, entity_id, entity_label, field,
   app_value, source_value)` para poder unir divergencias de driver/vehicle
   docs junto con las de transporter. Ver nota completa en el header de esa
   migración. Se aplica DESPUÉS de la primera materialización de las vistas
   silver (dbt run o `local_apply_views.sql`).
7. **`23_upsert_insurance.sql` (a)** usa `DISTINCT ON` para colapsar
   `silver.stg_insurance_vehicles` (grano cuota) a grano póliza antes del
   `INSERT ... ON CONFLICT`, evitando el error de Postgres "ON CONFLICT DO
   UPDATE command cannot affect row a second time" si dos cuotas de la
   misma póliza trajeran algún campo no-clave distinto. El mismo riesgo
   existe, sin mitigar, en el `INSERT` de cuotas (paso c): si bronze trae
   dos filas con exactamente el mismo `(policy_id, installment_number,
   due_date)`, la corrida fallará con ese error de Postgres — señal clara
   de un problema de datos, no un fallo silencioso.

## Verificación sugerida post-corrida (manual, no forma parte de estos archivos)

```sql
select * from ops.pipeline_runs where pipeline='centralizer_to_app' order by id desc limit 1;
select reason, count(*) from ops.pipeline_rejects where batch_id = (select max(batch_id) from ops.pipeline_runs where pipeline='centralizer_to_app') group by reason;
select count(*) from app.transporters where is_active;               -- ~38
select count(*) filter (where in_admin) from app.transporters;        -- ~37 (CRIBAS false)
select count(*) from app.drivers;                                     -- ~80 (menos duplicados/huérfanos)
select kind, count(*) from app.vehicles group by kind;                -- tracto ~81, rampla ~38
select count(*) from app.insurance_installments;                      -- ~286 (menos rejects)
-- cuadratura vistas vs rejects (duplicado + huerfano):
select (select count(*) from bronze.raw_centralizer_drivers where nullif(trim(rut_conductor),'') is not null)
     - (select count(*) from silver.stg_centralizer_drivers) as drivers_excluidos;
```
