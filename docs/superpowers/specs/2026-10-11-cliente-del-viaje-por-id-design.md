# El cliente del viaje por ID, no por nombre — diseño

Fecha: 2026-10-11 · Estado: diseño aprobado en conversación (11/10), spec en revisión · Rama: `dev`

## 1. Contexto

El usuario preguntó si "Walmart" y "WALMART" se normalizan en el CRUD o en Mage. Ninguno de los dos lo hace. Lo revisado
en la base el 11/10:

| Dónde se escribe el cliente | Qué guarda | Ejemplo real |
|---|---|---|
| Mage (dbt, `stg_*_trips`) | El texto de la configuración de la extracción, en minúsculas | "walmart" (3.029 viajes), "iansa" (176), "sodimac" (147), "colun" (10) |
| Viaje manual (`app.trips_manual`, API) | El texto que llega en el alta, aunque no esté en el directorio | "Iansa" (11), "HBC" (1), "PRUEBA ANULACIÓN" (1, anulado) |
| Directorio (`public.shippers`) | Nombre único, pero distinguiendo mayúsculas (`shippers_name_key`) | Se podrían crear "Walmart" y "WALMART" |

- **El viaje no apunta al directorio.** `app.trips.source_client_id` existe, pero es la clave del cliente dentro del TMS
  (`md5(tms|source_client)`, en `stg_*_trips`): de 2.362 viajes, ninguno apunta a un `shippers.id`.
- **Hoy funciona por un parche repetido.** 22 lugares del backend cruzan viaje y cliente comparando el texto en
  minúsculas (`lower(trim(sh.name)) = lower(trim(t.client_name))` y variantes), en `daily_closures`,
  `equipment_closures`, `status_report`, `trips`, `cierre_viajes`, `cierre_lineas`, `pre_cierre` y `drivers`.
- **Por qué es frágil:** si alguien renombra un cliente en el directorio, o el TMS cambia cómo lo escribe, sus viajes
  quedan sin cliente en todas esas pantallas, sin aviso.

**Estándar que se sigue:** una referencia por ID a la entidad maestra, resuelta una sola vez al escribir. Así lo hacen
los MDM y los TMS de mercado, como Oracle OTM o MercuryGate: el texto externo se traduce con una tabla de
correspondencia, y lo que no tiene correspondencia queda en una cola visible, nunca adivinado. Las lecturas cruzan por
ID.

**Invariante que no cambia:** `client_name` sigue siendo parte de la identidad del viaje. El ID de un viaje del TMS, y
el de uno manual que reconcilia con el TMS, es `md5(tms|lower(cliente)|nº de viaje)` (`_manual_trip_id`, `stg_*_trips`).
No se renombra ni se reescribe. `shipper_id` es una columna nueva, al lado.

## 2. Modelo

```
public.shippers                 el directorio (maestro)
  unique (lower(btrim(name)))   ← nuevo: "Walmart" y "WALMART" no pueden convivir

app.tms_client_shippers         ← nuevo: la correspondencia cliente del TMS → cliente del directorio
  source_client_id uuid  PK     = app.trips.source_client_id (md5(tms|source_client), el que ya calcula el pipeline)
  source_system    text  not null
  source_client    text  not null   el texto del TMS, para mostrarlo
  shipper_id       uuid  not null  FK → public.shippers(id)
  created_at, created_by

app.trips_manual.shipper_id     ← nuevo: FK → public.shippers(id); lo escribe la API al dar de alta
app.trips.shipper_id            ← nuevo: lo calcula dbt, nunca la API
```

**Cómo calcula dbt `app.trips.shipper_id`:**
- **Rama TMS:** `LEFT JOIN app.tms_client_shippers m ON m.source_client_id = <source_client_id>`, de donde sale
  `m.shipper_id`.
- **Rama manual:** `m.shipper_id` de `app.trips_manual`.
- **Una correspondencia nueva o cambiada actualiza los viajes ya cargados.** Lo hace la misma "escotilla" del modelo
  incremental que ya existe para los flags derivados (memoria "Activo/asignado del viaje: solo en dbt"): un `OR EXISTS`
  que reprocesa la fila cuando `t.shipper_id IS DISTINCT FROM` el valor resuelto. Sin eso, un viaje que no cambió en
  el TMS nunca recibiría su cliente.
- **`shipper_id` no entra en `merge_exclude_columns`:** lo escribe dbt y solo dbt (patrón de `is_active`/`is_assigned`).
- **Un índice `idx_trips_shipper` en el `post_hook`.** La integridad la garantizan las FK de las dos fuentes
  (`tms_client_shippers` y `trips_manual`). No se pone FK en `app.trips`, que es dueño de dbt y se reconstruye con
  `--full-refresh`.

**Datos iniciales:**
- **La migración siembra la correspondencia** con los 4 clientes del TMS de hoy. Cada `source_client_id` se cruza con
  el directorio por `lower(btrim(name))`, una sola vez, al migrar:
  - walmart → Walmart;
  - iansa → Iansa;
  - sodimac → Sodimac;
  - colun → Colun.
- **Los 13 viajes manuales** reciben su `shipper_id` del mismo modo. El anulado "PRUEBA ANULACIÓN" queda sin cliente.
- **La migración falla y no aplica nada** si alguno de los 4 del TMS no encuentra cliente: una correspondencia no se
  adivina.

## 3. Escritura

- **Alta manual** (`POST /trips`, registro único, y carga masiva CSV):
  - El cuerpo trae `shipper_id`, obligatorio. La API lee el nombre del directorio y lo usa como `client_name`, así el
    ID canónico se sigue calculando igual.
  - El texto libre deja de existir. Un `shipper_id` que no está en el directorio, o está inactivo, se rechaza con 422.
  - **En el CSV,** la columna de cliente se resuelve contra el directorio sin distinguir mayúsculas al validar el
    archivo. Una fila con un cliente desconocido queda marcada "El cliente no está en el directorio", como hoy se marcan
    las demás filas inválidas.
- **`ClientPicker`** devuelve `{ id, name }`. "Crear cliente" sigue disponible con `commercial.edit`: crea la entrada en
  el directorio, que es el CRUD del maestro.
- **Directorio:**
  - `POST /shippers` y la edición del nombre devuelven 409 si ya existe uno igual sin distinguir mayúsculas ni espacios
    ("Ya existe un cliente llamado 'Walmart'").
  - El índice único `lower(btrim(name))` es la garantía; la API solo traduce el error.
- **Un cliente del TMS nuevo** (el pipeline trae un `source_client_id` sin correspondencia) carga sus viajes con
  `shipper_id` vacío. No se adivina por nombre.

## 4. La correspondencia en Configuración

Va en **Configuración › Operaciones › Clientes del TMS** (ruta `/dashboard/admin/settings/tms-clients`, slug en
inglés):
- **Una tabla** con TMS, Cliente en el TMS (el texto crudo), Viajes y Cliente del directorio. La última columna es un
  selector que se puede editar con `config.edit`.
- **Arriba, los sin vincular,** con aviso: "3 clientes del TMS sin vincular: sus viajes no aparecen en los filtros por
  cliente".
- **Vincular o cambiar** escribe en `app.tms_client_shippers` (`PUT /api/v1/tms-clients/{source_client_id}`). Los
  viajes se actualizan en la próxima corrida del pipeline. La pantalla lo dice: "Se aplicará a sus viajes en la próxima
  actualización".
- **La lista de pendientes sale de los viajes,** no de una lista escrita a mano: `source_client_id` distintos de
  `app.trips` sin fila en la correspondencia.
- **Estados:**
  - cargando;
  - vacío: "Todos los clientes del TMS están vinculados";
  - error con "Reintentar";
  - sin permiso: solo lectura, sin selector.

## 5. Lectura

Todas las lecturas cruzan por `shipper_id`, y el nombre que se muestra sale del directorio (`shippers.name`):

| Dónde | Hoy | Después |
|---|---|---|
| `status_report`, `daily_closures`, `equipment_closures`, `cierre_viajes`, `cierre_lineas`, `pre_cierre`, `drivers` | `lower(trim(sh.name)) = lower(trim(t.client_name))` | `JOIN public.shippers sh ON sh.id = t.shipper_id` |
| `trips.py`: lista del Monitor, filtro por cliente, detalle | `lower(trim(t.client_name)) = ANY(...)` | Filtro por `t.shipper_id = ANY($ids)`; los chips de cliente mandan ids |
| `_load_operation_type_buckets` (RM/Z0/Región por local del cliente) | Indexado por `lower(s.name)` | Indexado por `shipper_id` |
| Reporte: `clients`, `_clientes_de_la_fila` | Por nombre, sin distinguir mayúsculas | Por `shipper_id` (con carga) y `carrier_shippers.shipper_id` (sin carga); se muestra el nombre |

- **Un viaje sin cliente vinculado** se muestra con el texto del TMS y la marca "sin vincular" (por ejemplo, "colun ·
  sin vincular"). En los filtros cae en la opción "Sin cliente vinculado". No desaparece.
- **El criterio de aceptación es un `grep` vacío.** No queda en el backend ningún cruce de cliente por texto:
  `grep -rnE "lower\((trim\()?(sh|s)\.name|lower\(trim\(t\.client_name" monitor-app/backend/api/app` no devuelve nada.

## 6. Despliegue en orden

`app.trips` usa `on_schema_change='sync_all_columns'`, así que el orden importa: primero se agrega, después se cambia
quién lee, y al final se retira lo viejo.

1. **Agregar:**
   - **Migración:**
     - índice único `lower(btrim(name))` en `public.shippers`;
     - la tabla `app.tms_client_shippers`, sembrada;
     - `app.trips_manual.shipper_id`, rellenado;
     - permisos y RLS como las demás tablas `app.*`.
   - **dbt:** `shipper_id` en las dos ramas, la escotilla y el índice. Se sincroniza a Mage (`sync_local_to_remote`) y
     se corre el pipeline una vez.
   - **Verificación:** después de la corrida, los viajes con `source_client_id` mapeado tienen `shipper_id`, y ningún
     viaje vigente queda sin él, salvo los de clientes sin vincular.
2. **API de escritura:** el alta manual con `shipper_id`, el CSV, `ClientPicker` y el 409 del directorio.
3. **Lecturas:** los 22 cruces pasan a `shipper_id`, los filtros del Monitor y del reporte a ids, y entra la pantalla
   Clientes del TMS.
4. **Retirar:** se borran los helpers de cruce por nombre que quedaron sin uso. `client_name` no se borra: es parte del
   ID del viaje.

Cada paso deja la app funcionando. Entre el 1 y el 3, las lecturas siguen por nombre y dan lo mismo, porque los datos de
hoy calzan.

## 7. Pruebas

- **Migración (ensayo con ROLLBACK antes de aplicar):**
  - siembra 4 correspondencias;
  - 12 viajes manuales con `shipper_id`, y el anulado sin él;
  - insertar "WALMART" falla por el índice;
  - la migración aborta si falta un cliente del TMS.
- **dbt** (la corrida en Mage, verificada por SQL):
  - `shipper_id` lleno en las dos ramas;
  - vincular un cliente nuevo llena los viajes viejos en la corrida siguiente (la escotilla).
- **Backend (pytest):**
  - el alta manual exige un `shipper_id` válido y deriva `client_name` del directorio;
  - el CSV con un cliente desconocido marca la fila;
  - el 409 del directorio sin distinguir mayúsculas;
  - `PUT /tms-clients`;
  - cada lectura migrada cruza por id: un viaje cuyo `client_name` no calza con ningún nombre igual aparece bajo su
    cliente;
  - el `grep` del §5 vacío.
- **Frontend (vitest):**
  - `ClientPicker` devuelve id;
  - la pantalla Clientes del TMS con sus estados;
  - los filtros por id;
  - "sin vincular" visible.
- **Dev:**
  - renombrar "Colun" a "Colun S.A." en el directorio, y sus viajes siguen bajo ese cliente en el Monitor, el Cierre y
    el Reporte (después se deja el nombre como estaba);
  - el reporte del 07/10 da las mismas cifras que antes.

## 8. Fuera de alcance

- Cambiar `client_name` o la fórmula del ID del viaje.
- Los alias por cliente: más de un texto del TMS para el mismo cliente se resuelve con más filas en la correspondencia,
  sin modelo nuevo.
- Fusionar clientes duplicados del directorio (hoy no hay).
- El `?fecha=` de la API (deuda aparte).
