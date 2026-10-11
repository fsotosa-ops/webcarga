# "Activo" y "asignado" del viaje: una sola definición en la base — diseño

Fecha: 2026-10-11 · Estado: diseño aprobado en conversación (4 secciones, 11/10), spec en revisión · Rama: `dev`
Origen: ítem 5 de la minuta 09/10 (Pablo), "sincronización de los viajes manuales con el cierre del día".

## 1. Contexto

**Qué ve el usuario.** Al cargar un viaje manual con tracto y conductor, el viaje aparece hasta 15 min como "activo, no
asignado". En ese lapso cae en Cierre › Viajes › Por resolver ("Hoy" o "Rezago") y bloquea la firma del día. Pasa lo
mismo cada vez que alguien le pone o le cambia patente o conductor desde la app, y no solo a los manuales: también a un
viaje del TMS cuando Operaciones le vincula la flota. Mientras tanto el Cierre se contradice, porque Flota lee el
vínculo en vivo (en menos de 1 min, por la cola de recálculo) y Viajes lee `app.trips.is_assigned`.

**Causa.** La regla de "activo" y "asignado" vive solo en dbt (`macros/viaje_activo_y_asignado.sql`, decisión del
usuario del 09/10). La app escribe en cada momento, pero el valor recién se recalcula en la corrida de ingesta, cada
15 min. Además, el alta manual (`_insert_trip`, `routers/trips.py`) escribe en `app.trips` valores fijos que nadie
calculó: `is_active = true` e `is_assigned = false`. En la práctica es un segundo escritor del dato, y escribe un valor
falso.

**Medido en la base el 11/10 (solo lectura):**
- 13 viajes manuales en 3 semanas. Casi todos se cargan después del hecho, en "CERRADO FINALIZADO" y con flota. Desde
  el arreglo del 09/10, los 12 con flota están `is_assigned = true`.
- La regla, escrita como función SQL, coincide con el `is_assigned` guardado en 3.383 de 3.384 viajes (sin contar los
  28 con override manual). La única diferencia es `add6d7dc`, el viaje huérfano de Sodimac que el pipeline ya no
  produce (anotado el 11/10).
- Costo sobre la tabla completa: 7,5 ms con la regla en línea contra 39,7 ms como función.

**Alternativa descartada: disparar dbt por demanda desde la API.**
- Agrega una integración en 6 pasos y 3 sistemas, con un retraso de 2 a 4 min cuando todo anda.
- Corre el riesgo de chocar con la corrida de 15 min, que dura 7 a 8 min y reconstruye `int_tms_trips_conformed` con
  `DROP CASCADE`. Ya pasó dos veces con `stg_tms_presence`, y el límite de concurrencia de Mage es por pipeline.
- Con operadores editando todo el día serían decenas de corridas por hora, sobre el Disk IO del plan gratis que cayó
  en la Ronda 164.

**Estándar que se sigue.** Una columna derivada mantenida por la base: una sola definición (función) y varios
llamadores (el pipeline y un trigger), en la misma transacción que el dato del que deriva.

**Invariante que no cambia.** La regla de negocio es la del 09/10: *"si tiene patente y/o conductor califica como
asignado"*, del TMS o del vínculo que hace Operaciones, y una "Publicada" de Sodimac nunca. Este diseño la mueve de
lugar; no la cambia.

## 2. La regla en la base

Migración `monitor-app/backend/supabase/migrations/20261012090000_trip_assignment_in_the_database.sql`:

- **`app.is_trip_open(status text) RETURNS boolean`**: `LANGUAGE sql IMMUTABLE PARALLEL SAFE`. Es
  `viaje_abierto_por_estado`: `status NOT LIKE 'CERRADO%' AND status NOT IN ('CANCELADO','Declinada','Removida')`. Con
  NULL devuelve NULL a propósito, y cada llamador decide qué hacer.
- **`app.is_trip_assigned(status text, fleet jsonb, trip_id uuid) RETURNS boolean`**: `LANGUAGE sql STABLE PARALLEL
  SAFE`, porque lee `app.trip_fleet_links`. Es `viaje_asignado`: `status IS DISTINCT FROM 'Publicada'` y además
  tractor, rampla, nombre o RUT del conductor en `fleet`, o un vínculo en `app.trip_fleet_links` con tracto, rampla o
  conductor.
- Las dos llevan `SET search_path` explícito, como las demás funciones de `app`, y un comentario (`COMMENT ON
  FUNCTION`) que nombra a sus llamadores.

**dbt (Mage, `macros/viaje_activo_y_asignado.sql`):**
- `viaje_abierto_por_estado(estado)` queda en `app.is_trip_open({{ estado }})`.
- `viaje_asignado(estado, fleet, trip_id)` queda en `app.is_trip_assigned({{ estado }}, {{ fleet }}, {{ trip_id }})`.
- `viaje_activo_tms(...)` llama a `app.is_trip_open` y conserva en dbt la recencia de las fuentes en vivo, porque la
  lista `live_tracked_sources` es una variable de dbt y nadie fuera del pipeline la usa.
- `trips.sql` no cambia, y la escotilla OR 6 sigue comparando el valor guardado contra la regla.

## 3. Quién la llama y cuándo

1. **dbt, en cada corrida de ingesta**, por las macros de la sección 2.
2. **El alta de un viaje manual** (`_insert_trip`). El `INSERT` en `app.trips` calcula los dos valores en el mismo
   SQL, con la misma expresión que la rama manual de `trips.sql`:
   - `is_active = COALESCE(app.is_trip_open($status), true)`;
   - `is_assigned = app.is_trip_assigned($status, $fleet::jsonb, $id)`.

   El vínculo de flota que el alta escribe después lo cubre el trigger del punto 3.
3. **Los triggers `trg_sync_trip_assignment_ins/_upd/_del` sobre `app.trip_fleet_links`**: AFTER, a nivel de
   sentencia y uno por evento, como los de la cola del Cierre. Las tablas de transición son `NEW TABLE AS changed` en
   INSERT y UPDATE, y `OLD TABLE AS changed` en DELETE. Los tres llaman a la misma función,
   `app.sync_trip_assignment()`:
   ```sql
   UPDATE app.trips t
      SET is_assigned = app.is_trip_assigned(t.trip_status, t.fleet, t.id)
    WHERE t.id IN (SELECT trip_id FROM changed)          -- solo los viajes cuyo vínculo cambió
      AND NOT ('is_assigned' = ANY(COALESCE(t.manually_edited_fields, '{}')))
      AND t.is_assigned IS DISTINCT FROM app.is_trip_assigned(t.trip_status, t.fleet, t.id);
   ```
   - Escribe solo si el valor cambia, así que no genera Disk IO de más.
   - El override manual no se toca: lo filtra el `WHERE` y además lo resguarda `protect_manual_overrides`.
   - No entra en bucle. El `UPDATE` dispara `trg_resolve_trip_fleet`; si este reescribe un vínculo automático, el
     trigger recalcula, ya no hay diferencia y no escribe. Dentro de `resolve_trip_fleet` además manda la marca
     `app.resolving_fleet`.

`is_active` no lleva trigger. En un viaje manual, `trip_status` no se edita después del alta, y lo que la persona marca
a mano va por `manually_edited_fields`, que dbt respeta. Declarar "No asignado por WebCarga" (bulk-close) es otra acción
y no se toca.

## 4. La copia del viaje manual, en una transacción

`_mirror_manual_trip` copia la edición a `app.trips_manual`, que es la fuente de la que dbt reconstruye el viaje. Hoy
corre fuera de la transacción y termina en `except Exception: pass`. Si falla, la siguiente corrida de dbt pisa la
edición en silencio.

- Las cuatro rutas que la llaman escriben todo en una transacción (`async with pool.acquire() as conn,
  conn.transaction():`, el patrón que ya se usa siete veces en el archivo): `PATCH /trips/{id}`,
  `POST /trips/{id}/fleet-link`, `DELETE /trips/{id}/fleet-link` y `DELETE /trips/{id}/overrides/{field}`.
- `_mirror_manual_trip(conn, trip_id)` deja de tener `try/except`. Un error revierte la edición completa: responde 500
  y queda en el log de Cloud Run.
- `get_trip` lee después del commit.
- `_escribir_link_manual`, `_log_system_note` y `_activo_de_la_patente` ya aceptan una conexión.
- **No cambia** que editar un manual actualice `status_reported_at`. En un viaje gestionado a mano la edición es su
  "reporte", con el mismo significado que tiene el dato para un viaje del TMS.

## 5. Despliegue en orden (expand, sin contract)

1. **La migración**, ensayada antes con `ROLLBACK` en la base real. Es inocua sola: dbt sigue con la regla en línea,
   que es la misma.
2. **La API** a dev, con el push.
3. **Mage**: las macros pasan a llamar a las funciones.
   - Se sube **con el OK explícito del usuario y entre dos corridas**, para no dejar un lock huérfano.
   - Después se revisa la corrida siguiente: que termine bien y que la paridad siga en 3.383/3.384.

## 6. Pruebas

Son de integración contra la base real, cada una en una transacción que se revierte, con el helper
`cliente_de_prueba(conn)` y fechas que nadie firma. Cada test nuevo se hace fallar primero (mutación).

- **Funciones:**
  - una "Publicada" con patente no está asignada;
  - el `fleet` del TMS basta, y el vínculo solo basta;
  - sin nada no está asignado;
  - `is_trip_open('CERRADO FINALIZADO')` es falso;
  - `is_trip_open(NULL)` es NULL.
- **Alta manual:**
  - CERRADO con tracto y conductor nace `is_active = false` e `is_assigned = true`, y no aparece en los grupos del
    Cierre;
  - sin flota nace activo y no asignado.
- **Trigger:**
  - vincular conductor a un manual lo deja asignado en la misma transacción;
  - vincular flota a un viaje del TMS sin flota en `fleet` lo deja asignado;
  - quitar el vínculo lo deja no asignado;
  - un override manual de "Asignado" se respeta;
  - un cambio que no altera el valor no reescribe la fila (`xmin` igual).
- **Transacción:** si la copia falla (provocada en el test), la edición no se guarda y la API responde 500.
- **Guarda de grep:** ningún `INSERT INTO app.trips` de la API fija `is_active` o `is_assigned` con un literal.

Los tests son solo los del área (`trips`, `cierre_viajes` y la integración del Cierre). La suite completa no se corre:
no se toca `conftest` y el código no se importa fuera del área. Tampoco `npm run build`, porque no hay cambios en el
frontend.

**En dev**, con un viaje manual de prueba autorizado por el usuario:
- crearlo CERRADO con flota y ver que no aparece en Por resolver;
- crear otro activo sin flota, vincularle un conductor desde el detalle y verlo en En seguimiento al instante;
- anular los dos con el motivo "Cargado por error".

## 7. Fuera de alcance

- La recencia de las fuentes en vivo (`live_tracked_sources`): sigue en dbt.
- Qué hacer con los estados que no cuentan como carga (Cancelado, Declinada, Removida): pendiente del 09/10, la regla
  no cambia su comportamiento.
- El viaje huérfano `add6d7dc`: no se parchea a mano.
- Que la Publicada viva de Sodimac aparezca en Por resolver: decisión D1 del 11/10, se mantiene.
