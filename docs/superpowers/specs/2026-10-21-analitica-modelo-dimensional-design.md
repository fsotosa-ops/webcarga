# Analítica: la BDOT reconstruida desde la app (modelo dimensional)

**Fecha:** 2026-10-21
**Estado:** aprobado por el usuario (21/10)
**Plan del que sale:** `~/.claude/plans/zany-wishing-cloud.md` (Fase 1, redefinida el 21/10)

## 1. Qué se construye y por qué

La BD OT (Excel de Finanzas: 110.945 filas, una por OT) se reconstruye a partir de cómo opera la app. Tres
reglas:

- No se copia el Excel.
- Cada columna sale del módulo de la app que es dueño de ese dato.
- La reconstrucción crece por etapas: cada módulo nuevo (Tarifario, Facturación…) suma sus columnas sin rehacer
  lo anterior.

Decisiones tomadas con el usuario (21/10):

| Tema | Decisión |
|---|---|
| Modelo | Dimensional (Kimball), no vistas anchas sobre la operación: esas reescriben la historia y no tienen grano declarado |
| Construcción | dbt, schema `gold` |
| Consumo | Schema `analytics`: vistas delgadas, sin lógica propia. Lo leen la API y, más adelante, la herramienta de BI |
| Crecimiento | Por matriz de procesos (bus matrix): un hecho por proceso de negocio, dimensiones compartidas |
| Carga | Incremental desde el comienzo |
| BI | Fase posterior. Gold y `analytics` lo dejan listo |

## 2. Capas

```
bronze/silver (TMS)  ──dbt──►  app.trips / app.trip_stops  ◄── la app escribe (Monitor, Cierre, Directorio…)
                                        │
                                        ▼  dbt (gold): hechos + dimensiones, incremental, con tests
                                     gold.fct_* / gold.dim_*
                                        │
                                        ▼  vistas delgadas, permisos propios
                                     analytics.bdot / analytics.rpt_*  ──►  API /analytics  ──►  módulo Analítica
                                                                       └──►  BI (después)
```

- **Fuente de gold, por dato (la fuente de verdad se decide por campo):**
  - Lo que decide la app (Directorio, vínculos de flota, tipo de operación declarado, motivos, anulaciones y
    cierres firmados) sale de `app` y `public`.
  - La historia de estados que reporta el TMS sale de `bronze.tms_trips_snapshot`. Es el snapshot SCD2 de dbt que
    ya corre en la ingesta, y es la única historia de estados que existe: `app.trips` guarda solo el estado
    vigente.
- **`app.trips` y `app.trip_stops` ya son modelos de dbt** del proyecto `dbt/tms`. Gold los lee con `ref()`; las
  tablas que escribe la app (`public.*`, `app.closure_*`, `app.fleet_assignment_periods`) se declaran como
  `source()`.
- **`gold` está vacío.** Hoy está expuesto por PostgREST (`supabase/config.toml`); se retira de ahí. Gold no se
  lee desde afuera.

## 3. Matriz de procesos (bus matrix)

Filas: procesos (un hecho cada uno). Columnas: dimensiones compartidas. ✔ = el hecho usa esa dimensión.

| Proceso (hecho) | Etapa | Fecha | Cliente | Empresa | Conductor | Equipo | Lugar | Tipo de operación | Motivo |
|---|---|---|---|---|---|---|---|---|---|
| Cambio de estado del viaje (`fct_trip_status_events`) | Ahora | ✔ | ✔ | | | | | | |
| Viaje (`fct_trips`) | Ahora | ✔ (varios roles) | ✔ | ✔ | ✔ | ✔ (tracto, rampla) | ✔ (origen, destino) | ✔ | ✔ (no asignación, anulación) |
| Parada (`fct_trip_stops`) | Ahora | ✔ | ✔ | ✔ | | | ✔ | | |
| Estado diario de la flota (`fct_fleet_daily_status`) | Ahora | ✔ | | ✔ | ✔ | ✔ | ✔ (origen habitual) | ✔ | ✔ |
| Habilitación diaria (`fct_compliance_daily`) | Etapa siguiente | ✔ | | ✔ | ✔ | ✔ | | | |
| Tarifa del viaje (`fct_trip_rates`) | Con Tarifario | ✔ | ✔ | ✔ | | | ✔ | ✔ | |
| Cobro y pago (`fct_trip_billing`) | Con Facturación | ✔ | ✔ | ✔ | | | | | |

Regla: un módulo nuevo de la app entra a la analítica como una fila nueva de esta matriz. Si necesita una
dimensión que no existe, se crea compartida, no dentro del hecho.

## 4. Hechos de la primera etapa

### 4.1 `gold.fct_trips`: *accumulating snapshot*

- **Grano:** una fila por viaje de `app.trips`, incluidos los anulados (con su marca).
- **Clave:** `trip_id` (el uuid de `app.trips`; la continuidad del id es invariante del proyecto).
- **Carga:** incremental (`merge` por `trip_id`). Se reprocesan los viajes cuyo `updated_at` o el de sus
  paradas, vínculos de flota o tipo declarado cambió desde la última corrida.
- **Hitos:** una columna por hito, en `timestamptz` y con su fecha de Chile para unir con `dim_date`. La tabla de
  la sección 4.4 dice de dónde sale cada uno y qué tan lleno viene. Un hito sin fuente confiable queda nulo y
  documentado, no se inventa.
- **Dimensiones (claves sustitutas de gold):** cliente, empresa (la de la fecha de planificación, por la historia
  de asignaciones), conductor, tracto, rampla, CD de origen, último destino, tipo de operación con su origen
  (declarado, cliente o tracto), estado y motivo de no asignación.
- **Medidas y marcas:** asignado sí o no, activo, anulado, días en curso, número de paradas, vuelta del día.
- **Reglas que se reutilizan, no se reescriben:**
  - flota y tipo de operación: `app.v_trip_fleet_resolution`;
  - abierto y asignado: `app.is_trip_open` y `app.is_trip_assigned`;
  - cliente del viaje: `services/cliente_del_viaje.py`;
  - origen del viaje: `services/origen_del_viaje.py`.

  Las dos últimas pasan a SQL como función de la base, y el Python las llama.
- **Zona del destino:** hoy vive solo en Python (`services/destination_zone.py`, con desempate por nombre). Pasa a
  una función SQL de la base y el Python la llama. Así hay una sola regla para el Monitor, el Cierre y gold.

### 4.1b `gold.fct_trip_status_events`: hecho transaccional

- **Grano:** un cambio de estado de un viaje (estado anterior → estado nuevo, con su marca de hora).
- **Fuentes:**
  - TMS: las versiones de `bronze.tms_trips_snapshot`. La marca de hora es `dbt_valid_from`, la hora de la
    lectura. La precisión es la frecuencia de la ingesta (unos 15 minutos), y la columna `precision` lo dice.
    En Sodimac y Wingsuite el estado está en `payload->'trip_metadata'`.
  - App: los eventos de `audit_log` del viaje (no asignado por WebCarga, deshacer, anular). Más adelante, los que
    dejen los módulos nuevos (sección 8).
- **Uso:** de aquí salen los hitos que el TMS no fecha. Por ejemplo, "publicado" es la primera versión en
  `Publicada`, y "asignado" la primera versión con patente. `fct_trips` los toma de este hecho.

### 4.2 `gold.fct_trip_stops`: hecho transaccional

> Construido (21/10): guarda todas las filas de `trip_stops` con `is_current`. Las versiones viejas quedan como
> historia marcada y la BDOT usa solo las vigentes.

- **Grano:** una parada vigente de un viaje (`app.trip_stops` por `stop_id`).
- **Paradas vigentes:** `trip_stops` nunca borra. Cuando el TMS renombra o reordena, la fila vieja queda. Hoy, el
  19 % de los destinos de QAnalytics ya no está en el `stops` vigente del viaje, y hay 1.375 grupos con el mismo
  `stop_order`.
  - El grano son las paradas cuyo `stop_id` está en `trips.stops`, más los orígenes (Sodimac tiene varios) y las
    paradas manuales.
  - Las demás son historia y no entran al hecho.
  - La misma regla debe usarse en la zona del destino y el origen del viaje. Hoy los dos toman "el último por
    `stop_order`" y pueden caer en una fila vieja.
- **Contenido:** tipo de parada, orden, lugar, comuna y región, hitos de la parada (llegada, salida, descarga,
  con su fuente: GPS, TMS o manual).

### 4.3 `gold.fct_fleet_daily_status`: *periodic snapshot*

- **Grano:** sujeto (conductor o equipo) por día de negocio.
- **Fuente:**
  - Días firmados: la última versión de `app.closure_signature_lines`, que es inmutable.
  - Días abiertos: `app.closure_lines`, con `is_provisional = true`.

  Así un día firmado no cambia en la analítica aunque se reabra. Mismo criterio que "no reabrir un día firmado
  para corregir".
- **Contenido:** estado, motivo, origen habitual congelado, empresa del día y tipo de operación.
- **De aquí salen:** el reporte de estatus histórico, la asistencia, la utilización y el F30-1 (empresa ×
  conductores × mes).

### 4.4 Hitos del viaje: fuente y cobertura

Revisión de la base real, sobre los viajes desde el 2026-07-01: QAnalytics 3.555, Sodimac 165, Wingsuite 17,
manuales 18. Las horas del TMS se leen como hora de Chile y se guardan en UTC.

| Hito | Fuente | Cobertura | Decisión |
|---|---|---|---|
| Planificado | `trips.planning_date` y la hora del origen | 100 % | **Defecto: ver sección 4.5** |
| Publicado (ofertado) | Primera versión en `Publicada` del snapshot | Solo Sodimac (114 de 456 vistos así) | Entra, con su precisión. Los demás TMS no publican |
| Asignado | Primera versión con patente del snapshot; para un vínculo manual, el evento de la app | Walmart y Wingsuite: la patente llega con el viaje (asignado = visto por primera vez). Sodimac: 70 viajes la recibieron después | Entra. La "hora de asignación" real de Walmart no existe en la fuente (sección 4.6) |
| Salida del origen | Origen: GPS, TMS o manual | QAnalytics 0, Sodimac 0, Wingsuite 14 de 17 | Entra; casi vacío hoy |
| Llegada al destino | Destino: GPS > TMS > manual | QAnalytics 3.178 de 3.555 | Entra |
| Salida del destino | Destino: GPS o TMS | QAnalytics 2.938 | Entra |
| Inicio y fin de descarga | `unload_*` y los manuales | Prácticamente 0 | No entra hasta que haya fuente |
| Entregado | Derivado: última salida o llegada al último destino | | Entra, con la regla documentada |
| Cerrado | `closure_signature_trips` → `signed_at` y día firmado | 1.200 viajes firmados | Entra. El estado `CERRADO*` no trae hora |
| Anulado | `voided_at` y motivo | 9 (manuales) | Entra |
| Ausente del TMS | `tms_missing_since` y `tms_absence_kind` | QAnalytics 24, Sodimac 75 | Entra como marca |

### 4.5 Defecto encontrado: la fecha de planificación se tomaba en UTC (CORREGIDO 21/10)

> **Resuelto el 21/10.** El usuario decidió el día de Chile, también hacia atrás.
> - Macro corregido y sincronizado a Mage; la corrida de las 23:11 UTC ya compila con él, también
>   `stg_tms_presence`.
> - Migración `20261031090000_planning_date_chile_day` aplicada: 212 viajes, un día atrás, auditados en
>   `audit_log` (`fix_planning_date_timezone`). Las 1.237 firmas no cambiaron.
> - Queda por revisar: `trips_del_dia` usa `status_reported_at::date`, que es una marca sin huso guardada en UTC.
>   Es la misma clase de defecto.

- **Qué pasa:** `macros/trip_planning_date.sql` hace `planned_departure_at::date` en una sesión UTC. Un viaje
  planificado entre las 20:00 y las 23:59 de Chile queda con la fecha del día siguiente.
- **Cuántos:** verificado en la base real el 21/10. Son 208 de 3.554 viajes de QAnalytics (5,9 %) y 3 de 17 de
  Wingsuite. Sodimac no está afectado.
- **Por qué importa:**
  - La fecha de planificación es el día del viaje en todo el sistema: el Monitor, el Cierre, "Asignados del
    día", la sábana y la cuadratura contra el Excel.
  - Es candidata directa a parte de lo que no cuadraba con Operaciones.
- **El id del viaje no depende de esa fecha** (`trips.sql`), así que corregirla no rompe la trazabilidad. Sí
  mueve viajes de día, incluidos días ya firmados.
- **Antes de construir gold** hay que decidir con Operaciones:
  1. ¿Un despacho de las 22:00 es del día en que sale? Debería ser la fecha de Chile, pero puede que Operaciones
     lo cuente como del día siguiente.
  2. Cómo se tratan los días ya firmados. La regla es no reabrir: el cambio aplica desde una fecha, y lo firmado
     queda como estaba (la analítica de esos días sale de las firmas).

### 4.6 Lo que el modelo no puede dar hoy (y qué falta para tenerlo)

- **Hora de asignación por CD (pedido del 16/10):**
  - En Walmart y Wingsuite la asignación llega con el viaje: la hora disponible es cuándo el TMS lo publicó, no
    cuándo se asignó.
  - Para Sodimac sale del snapshot, con la precisión de 15 minutos.
  - Decisión del usuario (22/10): se construye con lo que hay, sin preguntar a Operaciones. El reporte dice de dónde
    sale cada hora (`assigned_at_source`: TMS con patente, o publicación del viaje cuando la patente llega con él).
    Si algún día se quiere la hora en que WebCarga consigue camión, es un dato nuevo que registra la app; no es
    prerrequisito.
- **Reasignaciones:** `trip_fleet_links` se actualiza en el mismo lugar y no guarda historia. Si importa saber
  cuántas veces cambió el camión de un viaje, la app debe registrar cada cambio (sección 8).
- **Descarga:** sin fuente.
- **Defectos menores detectados**, que se corrigen aparte y no bloquean:
  - `app.is_trip_open` cuenta `Cancelado` (Wingsuite, con mayúscula inicial) como abierto.
  - `trips.unassigned_reason_id` no valida el dominio: un viaje apunta a un motivo de conductor.

## 5. Dimensiones compartidas

| Dimensión | Fuente | Tipo | Notas |
|---|---|---|---|
| `dim_date` | generada | — | Calendario de Chile, feriados después |
| `dim_client` | `public.shippers` (13) | SCD1 | Tipos de operación del cliente |
| `dim_carrier` | `public.carriers` (251) | SCD2 en estado del ciclo de vida | Historia confiable desde el 2026-07-17 por `audit_log`; las 204 filas de la migración del 21/10 son una reclasificación masiva, no eventos |
| `dim_driver` | `public.drivers` (106) | SCD1 | Datos personales: nombre y RUT **solo en esta dimensión**, y `analytics` no los expone salvo con permiso |
| `dim_asset` | `public.assets` (140) + `public.asset_types` | SCD1 (SCD2 en tipo de operación más adelante) | Patente como dato casi personal |
| `dim_location` | `public.locations` (828; 32 orígenes) | SCD1 | Zona (RM, Z0, Región) calculada en la dimensión |
| `dim_operation_type`, `dim_reason`, `dim_trip_status` | `app.status_taxonomies`, `app.trip_statuses` | SCD1 | Por código estable, nunca por etiqueta |
| `bridge_fleet_membership` | `app.fleet_assignment_periods` | Tipo 2 nativo | Empresa de un conductor o equipo en una fecha. Historia real desde el 2026-10-16; antes, "desde el comienzo de los registros" (`lower_inf`) |

- **Empresa del viaje en su fecha:** la del vínculo de flota del viaje. Si no hay, la de la membresía del tracto
  o conductor en la fecha de planificación (equivalente a `app.carrier_of`, hecho como unión por rango en dbt).
- **Lo que no se puede reconstruir hacia atrás** (estado de una empresa antes del 2026-07-17, asignaciones antes
  del 2026-10-16) queda con la versión vigente y marcado. No se inventa historia.

## 6. Presentación: `analytics`

- **`analytics.bdot`:** la sábana. Una fila por viaje, con las columnas de la BDOT que la app ya cubre y los
  nombres de negocio del Excel donde corresponda. Sin datos personales.
- **`analytics.bdot_people`:** nombre y RUT del conductor por viaje. Solo con el permiso
  `analytics.export_personal_data`.
- **Reportes estándar:**
  - `analytics.rpt_unassigned_by_offer_day`: no asignados por día de oferta y motivo.
  - `analytics.rpt_assignment_hour_by_cd`: hora de asignación por CD, solo si el hito existe con confianza.
  - `analytics.rpt_monthly_reconciliation_tms`: cuadratura mensual contra el TMS.
  - `analytics.rpt_f30_1`: empresas y conductores por mes.
- **Regla:** si una vista de `analytics` necesita un cálculo, ese cálculo va en gold. En `analytics` solo hay
  uniones, renombres y filtros.

### Permisos en la base

- `analytics`: rol de grupo `analytics_reader` (NOLOGIN) con USAGE y SELECT, sin acceso a `bdot_people`. Para
  los datos personales, un rol aparte `analytics_personal_reader`.
- Revocado a `PUBLIC`, `anon` y `authenticated`; privilegios por defecto para las vistas nuevas.
- `gold` sin acceso desde PostgREST.
- La API sigue conectando como hoy. El control de datos personales en la API es por permiso de la app; el rol de
  base es para la herramienta de BI.

## 7. Carga y pruebas

- **Proyecto:** `dbt/tms`, carpeta `models/gold/` con `+schema: gold` (el macro `generate_schema_name` usa el
  nombre tal cual).
- **Convenciones del proyecto:** encabezado `Fuente / Granularidad / unique_key / Watermark` y `schema.yml` con
  tests por columna.
- **Cuándo corre:** un pipeline de Mage nuevo, `analytics_gold`, separado del ciclo de ingesta de 15 minutos.
  - Así un test rojo no corta la ingesta, que es la razón por la que `tms_daily_tests` está aparte (24/09).
  - Frecuencia: cada hora, en el minuto 20 (`triggers.yaml` del pipeline).
  - El test singular de gold lleva `tags=['analytics']`, y `tms_daily_tests` lo excluye (`--exclude
    tag:analytics`). Si no, la selección indirecta de dbt lo arrastraba al seleccionar `trips`.
  - Corre `dbt build --select gold`: modelos y tests juntos. El test que falla detiene solo la analítica.
- **Tests mínimos:**
  - grano único por hecho;
  - claves de dimensión que existen (`relationships`);
  - `fct_trips` tiene los mismos viajes que `app.trips`;
  - un día firmado no cambia entre corridas;
  - las cifras de `fct_fleet_daily_status` cuadran con `frozen_totals` de la firma.
- **Presentación de `analytics`: modelos de dbt materializados como TABLAS** (`models/analytics`), con sus permisos
  en el `grants` de dbt.
  - Una vista no sirve: el `CASCADE` la borra al reconstruir gold, y entre ese momento y su recreación el módulo
    quedaría sin datos (probado en la copia local el 22/10). Una tabla se reemplaza de una vez.
  - Corrección del 22/10: dbt reconstruye cada tabla de gold borrando la anterior con `CASCADE`, así que una vista
    creada por migración desaparecería cada hora.
  - La migración de Supabase crea solo el schema `analytics` y los roles (`analytics_reader`,
    `analytics_personal_reader`).
  - Que `gold` siga expuesto en PostgREST (`pgrst.db_schemas`) es inocuo: anon y authenticated no tienen USAGE en
    `gold`. Retirarlo se hace en la configuración de API de Supabase, no por migración.

## 8. Lo que cada módulo nuevo debe dejar (contrato con el desarrollo)

Para que la BDOT crezca sin parches, todo módulo nuevo de la app cumple:

1. **Ids estables** y `updated_at` en sus tablas: es lo que permite la carga incremental.
2. **Marca de hora de cada cambio de estado** que importe al negocio (una tabla de historia o `audit_log`
   normalizado). Sin eso, su hecho no puede reconstruir el pasado.
3. **Catálogos por código estable** (`status_taxonomies`), nunca texto libre.
4. **Su fila en la matriz de procesos**, y el diseño de su hecho como parte del diseño del módulo.

## 9. Cobertura de la BD OT

| Columnas de la BD OT | Hoy | Fuente en el modelo |
|---|---|---|
| `gc`, `eett`, `chofer`, `rut_chofer`, `patente_camion`, `patente_rampla` | Sí | `dim_client`, `dim_carrier`, `dim_driver` (personal), `dim_asset` |
| `f_despacho`, `f_h_creacion`, `f_h_asignar_camion`, `f_h_retiro`, `f_h_cierre_envio`, `f_h_envio_cancelado` | Según sección 4.4 | Hitos de `fct_trips` |
| `region_despacho`, `comuna_despacho`, `entrega_1..4_region/_comuna` | Parcial (región de destino nula en 35 %) | `dim_location` + `fct_trip_stops` |
| `estado_envio`, `entregado` | Sí | Estado del viaje |
| `tipo_camion_gc/_eett` | Sí, como tipo de operación | `dim_operation_type` |
| `kg_carga`, `m3_carga`, `cantidad_articulos` | No (el TMS no los trae hoy) | Pendiente de la fuente |
| `ppto_gc`, `ppto_eett`, `tasa_gc/_eett`, ofertas | No | `fct_trip_rates` (Tarifario) |
| `oc_eett`, `estado_ot`, `f_h_pendiente_de_pago`, `f_h_pagado` | No | `fct_trip_billing` (Facturación) |

- **Grano distinto:** la BD OT es por OT o tramo; la app, por viaje. La cuadratura se hace por viaje y por mes.
- **Historia:** la app tiene datos desde el 2026-07-01. Lo anterior queda en el Excel y no se migra.

## 10. Orden de construcción

0. HECHO (21/10): fecha de planificación en día de Chile (4.5).
1. Funciones SQL de zona del destino, cliente del viaje y origen del viaje en la base, con la regla de paradas
   vigentes (4.2). El Python las llama, y sus
   tests existentes deben seguir verdes.
2. `models/gold/`: `dim_date`, `dim_client`, `dim_carrier`, `dim_driver`, `dim_asset`, `dim_location`, catálogos
   y `bridge_fleet_membership`.
3. `fct_trip_status_events` (desde el snapshot y `audit_log`), y encima `fct_trips` y `fct_trip_stops`,
   incrementales, con tests.
4. `fct_fleet_daily_status`, desde las firmas y las líneas.
5. Pipeline de Mage `analytics_gold` con `dbt build --select gold`.
6. Migración del schema `analytics` (vistas, roles y permisos), con ensayo con ROLLBACK y autorización.
7. La Fase 2 del plan (módulo `/dashboard/analytics`) lee `analytics`.

## 11. Riesgos

- **Sincronizar con Mage:** el cluster ha dado 503 y `run_block` está roto para `batch_tms_monitor_trips` (ver
  memorias). Los modelos se prueban primero contra la copia local o con dbt local antes de sincronizarlos.
- **Disco de Supabase:** la saturación de Disk IO del 11/10 obliga a cargas incrementales y frecuencia
  moderada. No se hace `--full-refresh` periódico.
- **`--full-refresh` en `slv_milestone_trips`:** el pipeline de ingesta lo corre cada vez. Gold no depende de ese
  modelo, pero conviene revisarlo aparte.
