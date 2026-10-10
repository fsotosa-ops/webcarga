# Cierre: el recálculo sale de la lectura — diseño

Fecha: 2026-10-10 · Estado: diseño aprobado por secciones (10/10), spec en revisión · Rama: `dev`

## 1. Contexto y objetivo

El Cierre y, a veces, el Monitor tardan en desplegarse. Medido el 10/10 (logs de Cloud Run de 7 días en dev y
perfil contra la base en transacción revertida):

| Pedido | Mediana | p90 | Máximo |
|---|---|---|---|
| `GET /daily-closures`, `GET /equipment-closures` | 5,5 s | 7,6 s | 60 s (corte) |
| `GET /status-report` | 5,2 s | 6,9 s | 11 s |
| `GET /trips` (Monitor) | 3,8 s | 6,1 s | 199 s |

**Causa (Cierre):** cada GET ejecuta `cierre_lineas.recalcular` completo: pre-cierre, 4 escrituras y la
proyección a las tablas viejas, dentro de una transacción que bloquea el período. La pantalla pide
`daily-closures` y `equipment-closures` en paralelo (y el reporte un tercero), así que el mismo día se recalcula
varias veces y cada pedido espera el bloqueo del anterior. El perfil del GET de hoy dio **139 consultas, 124 del
pre-cierre fila por fila** (31 patentes × 4). Cada una es barata; el costo es el viaje de ida y vuelta entre
Cloud Run (us-central1) y Supabase (us-east-1), repetido. Mientras tanto, esos recálculos retienen conexiones del
pool (5 por instancia), y los pedidos del Monitor de esa instancia quedan en cola: el 08/10 a las 17:26 CL
cayeron juntos con 504 el Cierre, el Monitor, los disponibles y los filtros.

**Código muerto y piezas fuera de diseño encontrados (verificados):**
1. La proyección a `app.driver_day_status`, `app.equipment_day_status`, `app.daily_closures` y
   `app.equipment_closures`. No tiene lectores en la API, ni en vistas o funciones de la base, ni en dbt, ni en el
   frontend (sus `idx_scan` salen del propio upsert). Era la "ola 5" del modelo de cierre del 16/09, que nunca se
   ejecutó.
2. El pre-cierre que devuelve `equipment-closures`: el frontend no lo lee (su tipo no tiene el campo).
3. Un GET que escribe: líneas, tablas viejas y, desde el pre-cierre, el directorio.
4. El mismo cálculo tres veces por sesión, con dos envoltorios `_recompute` iguales.
5. Dos estilos en el mismo flujo: `cierre_lineas` por conjuntos y el pre-cierre fila por fila.
6. Comentarios desactualizados ("Sodimac trae 0 patentes", "se recalcula en cada GET").

**Objetivo:** que leer el Cierre sea un `SELECT` puro y que el recálculo corra cuando cambian sus datos de
entrada, de forma robusta, escalable, mantenible y legible, siguiendo el diseño de la app y el estándar de la
industria. Sin código muerto al terminar.

### Lo que se decidió (usuario, 10/10)

- El disparador es un **trigger que marca el día pendiente** cuando dbt escribe (opción 2 de tres). Va en el
  `post_hook` de dbt dentro de Mage, junto a los triggers existentes de `app.trips`: es la única forma de que
  sobreviva a un `--full-refresh` (memoria `reference_dbt_post_hook_owns_db_objects`).
- El ejecutor es **Cloud Scheduler → endpoint interno de la API**.
- Diseño aprobado por secciones (arquitectura, pre-cierre y borrados, concurrencia y errores, pruebas y
  despliegue), con la corrección de la sección 3: la marca va en una cola propia y no en `closure_periods` (§3.2).

## 2. Patrón de la app y estándar de la industria

| Decisión | Precedente en la app | Estándar |
|---|---|---|
| `cierre_lineas` único escritor; un día firmado no se recalcula | Modelo de cierre del 16/09 | Modelo de lectura materializado (CQRS) |
| GET que solo lee | El resto de la API | RFC 9110 §9.2.1: GET seguro e idempotente |
| Trigger por sentencia declarado en el `post_hook` | `trg_trips_resolve_fleet_*` | Captura de cambios con triggers |
| La regla de negocio en Python, no en funciones de la base | Decisión del 09/10 (activo/asignado) | Lógica de dominio en la aplicación |
| SQL por conjuntos | `cierre_lineas` | Sin N+1 ni fila por fila |
| `FOR UPDATE` / `SKIP LOCKED` para serializar | `_bloquear_periodo`; advisory lock en `authz/sync.py` | Concurrencia de Postgres |
| Auditoría en `public.audit_log` | `log_change` | Bitácora de auditoría |
| "Resueltas automáticamente" leídas de `audit_log` desde el día D | `SQL_CON_MOTIVO` | Proyección sobre la bitácora |
| JWT verificado con PyJWT + JWKS | `verificar_token` (Supabase) | OIDC entre servicios |
| Retiro de tablas en dos pasos | RBAC Task 13; `has_expiration` | Expand → contract |
| **Cola `app.closure_recompute_queue`** | **Nuevo** | Cola de trabajo con `SKIP LOCKED` |
| **Cloud Scheduler → endpoint interno** | **Nuevo**: hoy nada corre solo | Patrón documentado de GCP para Cloud Run |
| "Actualizando…" en pantalla | Nuevo como estado de pantalla | Consistencia eventual con indicador de frescura |

## 3. Arquitectura

```
 dbt (Mage) escribe app.trips / app.trip_stops ─┐
 la API escribe flota, directorio y vínculos ───┼─► triggers por sentencia ─► app.marcar_cierre_pendiente()
                                                │        (una sola sentencia: encolar)
                                                ▼
                     app.closure_recompute_queue (id, business_date, requested_at) — solo inserciones
                                                │
 Cloud Scheduler, cada 1 min ─► POST /api/v1/internal/closures/recompute
                                                │   FOR UPDATE SKIP LOCKED sobre el período
                                                ▼
                     cierre_lineas.recalcular(día) por cada día encolado
                     → borra exactamente las marcas que leyó
                                                │
 GET daily-closures / equipment-closures / status-report ─► SELECT puro
                                                └─► calculado_a y pendiente_desde del día
```

### 3.1 La marca

- **Una sola función**, `app.marcar_cierre_pendiente()` (`RETURNS trigger`, `FOR EACH STATEMENT`), usada por
  todos los triggers. Encola los **días abiertos de los últimos 45 días y hoy**:
  `INSERT INTO app.closure_recompute_queue (business_date) SELECT …`, **una fila por marca**, sin `ON CONFLICT`.
  La marca más antigua de un día dice **desde cuándo** está pendiente. Los días firmados nunca entran.
- **Solo inserciones (corrección del 10/10, migración 20261010150000).** La primera versión hacía un upsert por
  día con un contador de versión. Un `INSERT … ON CONFLICT DO UPDATE` sobre la misma fila hace esperar a toda
  transacción que marca hasta que la primera termine: dbt retiene esa fila durante toda su transacción, y dos
  transacciones que toman las filas en distinto orden se bloquean mutuamente (apareció un deadlock en la suite).
  Un `INSERT` sin conflicto no espera a nadie.
- **Por qué todos los días abiertos y no "el día que afectó el cambio":** saber qué días ocupa un viaje es la
  regla de `app.trips_del_dia`. Repetirla en el trigger sería escribirla dos veces. Al 10/10 son 14;
  marcar de más cuesta un recálculo barato, y una línea que no cambia no se reescribe (§3.3).
- **Por sentencia, con tabla de transición**, el patrón de `trg_trips_resolve_fleet_ins/upd`: un trigger por
  evento (`AFTER INSERT … REFERENCING NEW TABLE AS cambiadas`, `AFTER UPDATE … NEW TABLE AS cambiadas`,
  `AFTER DELETE … OLD TABLE AS cambiadas`), todos con el mismo nombre de tabla de transición, para que una sola
  función sirva a todos. La función no mira el contenido de las filas: solo pregunta si hay alguna.
- **Dos reglas para no marcar de más.** Sin ellas, el ejecutor se volvería a encolar solo para siempre:
  1. **Sentencia sin filas cambiadas → no marca.** Un trigger por sentencia se dispara aunque el `UPDATE` no
     toque ninguna fila. La función sale si `cambiadas` está vacía.
  2. **El recálculo converge (revisión final, 10/10).** Las correcciones del pre-cierre escriben en
     `asset_assignments` y `drivers`, que tienen trigger, y SÍ marcan: todos los días abiertos dependen del
     directorio. La pasada siguiente no encuentra nada que corregir, no escribe y no marca. Una primera versión
     exceptuaba al recálculo con una variable de sesión; dejaba desactualizados los otros días y se retiró
     (migración 20261010180000).
- **Dónde vive cada trigger:**
  - `app.trips` y `app.trip_stops`: en el `post_hook` de `models/app/trips.sql` y `models/app/trip_stops.sql`
    (Mage), con `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, igual que los existentes.
  - `app.trip_fleet_links`, `public.assets`, `public.asset_assignments`, `public.drivers`,
    `public.driver_assignments`, `public.vehicle_driver_assignments`, `public.carriers` y `app.trip_statuses`
    (su `counts_as_load` decide qué cuenta en `trips_del_dia`; se edita en Configuración): en una migración de
    `monitor-app/backend/supabase/migrations/`. dbt no reconstruye esas tablas.
  - La función y la cola: en la migración. El `post_hook` solo crea los triggers que la llaman.

### 3.2 Por qué una cola y no una columna en `closure_periods`

`recalcular`, firmar y poner un motivo toman la fila del período con `FOR UPDATE` durante todo su trabajo: es como
se serializan hoy. Si el trigger escribiera la marca en esa fila:
- cada escritura de dbt o de la API esperaría a que termine el cálculo o la firma de ese día;
- quedaría un ciclo de bloqueo posible: el recálculo corrige `asset_assignments` mientras una edición de la API
  retiene esa fila y su trigger espera el período. Postgres lo resolvería abortando una de las dos.

La cola separa la marca del bloqueo del período, y al ser de solo inserciones tampoco hay bloqueos entre quienes
marcan (§3.1).

### 3.3 El ejecutor: `POST /api/v1/internal/closures/recompute`

1. Lee las marcas de cada día (`business_date`, lista de `id`) sin bloquearlas, días más antiguos primero. Suma hoy (fecha de
   Chile) si todavía no tiene ninguna línea, aunque no esté en la cola: así el día arranca calculado sin que
   nadie lo abra. Una vez que tiene líneas, hoy solo se recalcula cuando lo encola un cambio.
2. Por cada día:
   - toma el período con `FOR UPDATE SKIP LOCKED`; si otro proceso lo tiene (una firma, otra corrida), lo
     salta, y queda para la próxima;
   - si el período está `CLOSED`, borra sus marcas sin calcular;
   - si no, ejecuta `recalcular` y al final `DELETE FROM app.closure_recompute_queue WHERE id = ANY($leídas)`.
     Una marca que llegó durante el cálculo no está entre las leídas, así que sobrevive y se procesa en la
     próxima corrida. **Por qué ids y no hora:** una transacción de dbt que empezó antes de la lectura y confirma
     después escribiría una hora anterior a la leída, y una comparación por hora la borraría sin haber visto sus
     cambios. Borrar exactamente lo leído no depende de relojes ni del orden de confirmación.
3. Corta a los 45 s (el servicio tiene `--timeout=60`); lo que queda pasa a la corrida siguiente.
4. Responde 200 con el resumen, o 500 si algún día falló (después de intentar todos), para que el Scheduler lo
   registre como fallo.

`recalcular` queda como hoy, salvo tres cambios: el pre-cierre por conjuntos (§4), que pasa a correr **dentro
de la misma transacción** que toma el período (hoy corre antes, en otra transacción, sin el bloqueo); la toma del
período con `SKIP LOCKED` cuando lo llama el ejecutor; y la declaración de origen de §3.1. Firmar (`cerrar`) sigue recalculando de forma síncrona y, además, borra
la entrada del día en la misma transacción: la firma nunca congela un estado viejo.

**Autenticación:** token OIDC de Google emitido por Cloud Scheduler para su cuenta de servicio. Se verifica con
PyJWT y las llaves públicas de Google (`https://www.googleapis.com/oauth2/v3/certs`), el mismo mecanismo de
`verificar_token`, sin dependencias nuevas (el `Dockerfile` instala las dependencias a mano: no se agrega
ninguna). Se exige `iss = https://accounts.google.com`, `aud` = URL del endpoint y `email` = la cuenta de servicio
configurada (`settings`, desde el workflow de deploy). La ruta entra a `EXCEPCIONES` de
`tests/test_toda_ruta_declara_permiso.py`, con su motivo, como `/health`.

### 3.4 Las lecturas

- `daily-closures`, `equipment-closures` y `status-report` dejan de llamar a `recalcular`. Se borran los dos
  `_recompute`.
- Las respuestas suman `calculado_a` (el `computed_at` más reciente de las líneas del día) y `pendiente_desde`
  (la marca más antigua del día, `min(requested_at)`, o `null`).
- **Día sin líneas todavía.** Hoy siempre las tiene: la función encola hoy en cada escritura, y el ejecutor
  además procesa hoy si todavía no tiene líneas (§3.3), así que cada día recibe su primer cálculo. Un día sin
  líneas ni entrada en la cola solo puede ser anterior a la puesta en marcha: el GET responde con las listas
  vacías, `calculado_a = null` y `pendiente_desde = null`, y la pantalla lo muestra como "Este día no tiene
  cierre". **El GET no escribe nunca.**
- `daily-closures` devuelve los avisos del pre-cierre (§4.2). `equipment-closures` deja de devolver `pre_cierre`.

### 3.5 Lo que ve el usuario

- `pendiente_desde` no nulo y de menos de 5 min: el Cierre muestra "Actualizando…" y vuelve a pedir los datos
  cada 15 s hasta que sea nulo.
- Más de 5 min: muestra "No se pudo actualizar desde HH:MM" y deja de mostrar "Actualizando…".
- Mientras está pendiente se puede seguir trabajando: poner un motivo y firmar son síncronos.
- El estado vive en `FlotaDelDiaSection` y `PasoViajesSection` con un solo componente de aviso, con la variante
  como prop (memoria `feedback_variant_is_a_prop_not_a_sibling`). Español neutral y vocabulario de la pantalla.

## 4. El pre-cierre

Hoy hace dos trabajos mezclados en un bucle fila por fila, dentro de la lectura. Se separan según si escriben o
solo informan. **Las reglas no cambian**: las mismas condiciones, el override manual sigue mandando y se
auditan los mismos datos.

### 4.1 Correcciones automáticas → dentro de `recalcular`, por conjuntos

| Corrección | Hoy | Después |
|---|---|---|
| Patente → la empresa que informa el TMS (un solo candidato, sin override manual) | 4 consultas por patente | `UPDATE` + `INSERT … SELECT … ON CONFLICT` |
| Conductor: nombre distinto para el mismo RUT canónico | 2-3 por conductor | `UPDATE … FROM` |
| Empresa ↔ cliente que aparece en sus viajes | 3-4 por par | `INSERT … SELECT … ON CONFLICT` |
| Auditoría de cada corrección | `log_change` por fila | `INSERT INTO public.audit_log … SELECT`, mismas columnas y `source = 'pre_cierre_auto'` |

Cada corrección es una sentencia con `RETURNING`, y su auditoría se inserta desde ese resultado en la misma
transacción, con CTE de datos modificados. Unas 6 consultas en vez de unas 124.

### 4.2 Avisos → `SELECT` puros en `GET /daily-closures`

Patente no registrada, empresa no reconocida, conductor no registrado, empresa en onboarding, sin tipo de
operación y conductor sin empresa: un `SELECT` por conjuntos cada uno, sobre `app.trips_del_dia(D)`, con la misma
forma de respuesta que hoy (`PreCierreEscalations`). Si el día está firmado, `pre_cierre` es `null`, como hoy.

"Resueltas automáticamente" (`auto_resolved`) se lee de `public.audit_log` (`source = 'pre_cierre_auto'`, fecha de
Chile ≥ D), con el patrón de `SQL_CON_MOTIVO`, y se arma el mismo mensaje que hoy. No se guarda nada nuevo.

## 5. Lo que se borra

1. `_proyectar` y `_SQL_PROYECTAR_*` en `cierre_lineas.py`. Después, en el paso de contract (§7), una migración
   retira las 4 tablas. Es dato derivado de `app.closure_lines`; no requiere respaldo. El stack de `main` las lee,
   pero ya está roto a propósito por RBAC y se resuelve al desplegar `main` (decisión del 09/10).
2. `pre_cierre` en la respuesta de `equipment-closures`.
3. Las llamadas a `recalcular` desde los tres GET y los dos `_recompute`.
4. El bucle fila por fila de `run_pre_cierre` (reemplazado por §4.1 y §4.2).
5. Los comentarios desactualizados: el del pre-cierre sobre Sodimac, el "contrapunto deliberado", y el docstring
   de `daily_closures.py` que dice que se recalcula en cada GET.
6. Los tests que fijan el comportamiento retirado: se reescriben para el comportamiento nuevo, no se dejan
   pasando sobre código borrado (memoria `feedback_un_test_que_fija_el_defecto`).

## 6. Pruebas

Contra la base real en transacción revertida (`conexion_revertida`, `PoolDeUnaConexion`), salvo indicación.

| Qué | Cómo |
|---|---|
| La marca | `marcar_cierre_pendiente()` encola los días abiertos y hoy, y nunca un firmado. Un test parametrizado por cada tabla de §3.1 de la migración: escribir en ella deja la entrada. Un `UPDATE` que no cambia filas no encola. Un recálculo con una corrección real marca los días abiertos y la pasada siguiente deja la cola vacía (converge). Recalcular sin cambios no reescribe líneas. |
| Trigger de dbt | Guarda sobre el espejo de Mage (se salta sin espejo), patrón de `test_dbt_activo_y_asignado_una_definicion.py`: los `post_hook` de `trips.sql` y `trip_stops.sql` crean el trigger con `app.marcar_cierre_pendiente()`. |
| Ejecutor | Una marca que llega durante el cálculo sobrevive. Un día bloqueado por otra conexión se salta (dos conexiones, ambas revertidas). Un día firmado sale de la cola sin calcular. Si un día falla, su entrada queda y el resto se procesa; la respuesta es 500. |
| GET sin escrituras | Contadores de `pg_stat_xact_user_tables` (`n_tup_ins`, `n_tup_upd`, `n_tup_del`) antes y después del GET de un día con líneas: 0 en todas las tablas. |
| Pre-cierre | Un escenario por corrección y por aviso, verificando la fila de auditoría. Mutación verificada en cada uno (memoria `feedback_verificar_que_la_mutacion_se_aplico`). |
| Autenticación interna | Sin token, con otra cuenta y con otra audiencia → 401/403. Tokens firmados en el test con una llave local y JWKS de prueba. |
| Frontend | Vitest: "Actualizando…" con nueva consulta mientras `pendiente_desde` es reciente; "No se pudo actualizar desde HH:MM" pasados 5 min; nada si es `null`. |

**Verificación única al implementar (no queda como test):** con los datos reales de hoy, en transacción revertida,
comparar las líneas y avisos del código viejo con los del nuevo para los días abiertos. Deben coincidir.

## 7. Despliegue (dev; sin jobs en vuelo, memoria `feedback_desplegar_con_job_en_vuelo_deja_lock_huerfano`)

Cada paso es inofensivo sin el siguiente:

1. **Migración expand:** cola, función, triggers de las tablas de la migración y siembra de la cola con los días
   abiertos. La API vieja sigue recalculando al leer; la cola se llena sin consumidor.
2. **`post_hook` de dbt** (Mage: `sync_project_to_local` → editar → `sync_local_to_remote`, entre corridas). Se
   comprueba en `pg_trigger` después de la corrida siguiente.
3. **Infraestructura:** activar la API de Cloud Scheduler, crear la cuenta de servicio y el job (cada 1 min,
   OIDC con audiencia = URL del endpoint). Hasta el paso 4 el endpoint da 404 y el job falla sin efecto.
4. **Deploy de API y frontend:** endpoint, GET puros, pre-cierre por conjuntos, sin proyección, aviso en
   pantalla. Variables nuevas en `deploy-monitor-api.yml`.
5. **Contract, un día después de verificar en dev:** migración que retira las 4 tablas.

## 8. Criterios de éxito (medidos en logs de Cloud Run, no estimados)

- La mediana de `daily-closures` y `equipment-closures` baja de 5,5 s a **menos de 0,5 s**, y el GET escribe 0 filas.
- Una escritura de dbt se refleja en el Cierre en **menos de 2 minutos**.
- Desaparecen los timeouts del Monitor mientras alguien usa el Cierre.
- Las líneas de los días abiertos coinciden con las del cálculo viejo (§6, verificación única).
- No queda código muerto: sin las 4 tablas, sin proyección, sin pre-cierre duplicado ni comentarios falsos.

## 9. Fuera de alcance

Cada uno con su propio cambio: el peso de la respuesta del Monitor (391 KB por 100 viajes), los arranques en frío
(instancias mínimas: decisión de costo) y el plan de Supabase (lo decide WebCarga, dueña de la organización).
