# Entrega A: D2 "Asignaciones con vigencia" + Certificación 2a "Sin clasificar" (mínima)

Plan madre: `2026-10-14-cerrar-directorio-y-certificacion.md`. Las decisiones salen de la sesión del 14/10 y aquí no se
reabren. Un despliegue, ejecución inline y **un test por criterio de aceptación** (CA), que se ve en rojo antes de
implementar. Las tangentes van a la lista del final.

---

## Verificado el 14/10 (base real en solo lectura, código y frontend)

- **Asignaciones:** conductores 92 activas y 14 inactivas, equipos 133 y 4, clientes 48. **Ninguna tiene `end_date`.**
  `start_date` está siempre lleno, desde el 15/07 (fecha de la migración, no de la realidad).
  - 13 conductores y 14 equipos activos tienen `start_date` posterior al 03/09 (primer día del Cierre). Si se sembrara
    desde `start_date`, esos días quedarían sin empresa y aparecerían MISMATCH falsos. **Por eso la siembra usa
    `-infinity`.**
- **Ninguna función de la base escribe asignaciones.** Los escritores son solo la API: `_transferir`, los `unassign_*` y
  `pre_cierre`.
  - En el frontend, todos pasan por `carriersApi.assignDriver/assignAsset/unassign*` (`lib/api/carriers.ts:164-180`),
    llamados desde `TransferModal`, `AltaDeFlota`, `VincularConductorPropuesto`, `AltaConductorDesdeCierre`, la ficha y el
    Monitor. Cambiar el servicio los cubre a todos.
- **`btree_gist` no está instalada:** la migración la crea (Supabase la permite).
- **Cierre:** hay 29 días firmados y el último es el **13/10, ayer**. Como se firma a diario, la transferencia "retroactiva
  hasta el último día firmado" en la práctica **solo admite hoy**: el selector de fecha casi no aporta.
- **Historial de documentos:** existe, en `audit_log` (`action = 'document_replace'`, `utils/document_storage.py:179`).
  La renovación anticipada lo usa sin agregar tablas.
- **Sin clasificar casi no se usa:** 152 ítems en total, ninguno pendiente hoy (85 descartados, 67 confirmados). Lo último
  es de la semana del 28/09 (14 ítems). En las mismas 5 semanas se cargaron ~330 documentos por los otros caminos
  (Pendientes y la ficha). Los 85 descartados ya no tienen su archivo.

## Parte 1: D2, asignaciones con vigencia

### Problema medido

`driver_assignments`, `asset_assignments` y `carrier_shippers` tienen `UNIQUE (sujeto, empresa)`: hay **una sola fila por
par, para siempre**. Volver a una empresa reactiva la fila vieja, y la historia se pierde. Medido el 12/10: 0 de 326
asignaciones tienen término. Todo lo que pregunta "de qué empresa era ese día" responde con la de hoy: el Cierre (MISMATCH),
`ultima_empresa_sql` y la atribución de documentos al término.

### Diseño

**Base (una migración, `2026101X_fleet_assignment_periods.sql`):**
- `app.fleet_assignment_periods`: `id`, `relation` (`DRIVER_CARRIER` | `ASSET_CARRIER` | `CARRIER_SHIPPER`),
  `subject_id`, `counterpart_id`, `valid_during daterange` (`[desde, hasta)`; límite inferior abierto = "desde siempre"),
  `created_by`, `ended_by`, `reason`, `created_at`.
  - `EXCLUDE USING gist (relation WITH =, subject_id WITH =, valid_during WITH &&)` para `DRIVER_CARRIER` y
    `ASSET_CARRIER`: una sola empresa por día, garantizado por la base.
  - Para `CARRIER_SHIPPER` el `EXCLUDE` va sobre `(subject_id, counterpart_id)`: una empresa tiene muchos clientes.
- **Quién escribe el historial: un trigger** `AFTER INSERT OR UPDATE OF status, start_date, end_date` en las tres tablas.
  La fecha efectiva viaja en las columnas que la fila ya tiene (`start_date` al activar, `end_date` al terminar; si vienen
  vacías, `hoy_chile()`). Así cualquier escritor queda capturado sin tener que pasar parámetros.
  - Al activar, abre un período desde `start_date`.
  - Al pasar a INACTIVE, cierra el período abierto en `end_date`.
- **Guarda del día firmado (en el trigger):** si la fecha efectiva cae en o antes del último día firmado
  (`app.closure_signatures`), se lanza `RAISE EXCEPTION` con el código `CLOSED_DAY`, y la API lo traduce a un 409 con una
  frase.
- **Siembra:** cada asignación ACTIVE recibe un período `(-infinity, abierto)`. Para los días anteriores al despliegue se
  sigue juzgando con la empresa de hoy, igual que ahora. Las INACTIVE no se siembran (P7: la historia parte hoy).
- `app.carrier_of(type, id, on_date date DEFAULT hoy_chile())` pasa a leer los períodos. La firma de 2 argumentos sigue
  funcionando, así que quien ya la llama no cambia.
- `app.active_fleet` no cambia: "flota activa" se refiere a hoy.

**API: un solo servicio de relaciones**, `app/services/fleet_assignments.py`, que reemplaza a `_transferir` y a los dos
`unassign_*` de `carriers.py`:

| Operación | Endpoint | Contrato |
|---|---|---|
| Asignar o transferir con fecha | `POST /carriers/{id}/drivers` · `/assets` | body `{driver_id \| asset_id, effective_date?}` (por defecto, hoy). Cierra la anterior el mismo día |
| Terminar | `DELETE /carriers/{id}/drivers/{did}?end_date=` · `/assets/{aid}` | `end_date` opcional (por defecto, hoy) |
| Reincorporar (traer el existente) | el mismo POST | Si el sujeto no tiene empresa, abre un período nuevo; la historia anterior se conserva |
| Clientes de la empresa | `GET/POST /carriers/{id}/shippers`, `DELETE /carriers/{id}/shippers/{sid}?end_date=` | P10: se declaran. Requieren `directory.edit` |
| Impacto de la baja | `GET /carriers/{id}/deactivation-impact` | `{drivers, assets, trips_today, open_closure_days}` |
| Reactivar eligiendo la flota | `POST /carriers/{id}/reactivate` | `{driver_ids[], asset_ids[]}`. Cada uno vuelve recalificado (P3) |

- Se reusan `services/assignment_guard.py` (409 de empresa no activa) y `record_manual_edit` (auditoría).
- `CLOSED_DAY` se responde como 409: "Ese día ya está firmado en el Cierre; elige una fecha posterior al DD/MM."

**Escritores que se retiran (P10 y P11, 14/10):** `pre_cierre.aplicar_correcciones` deja de escribir `asset_assignments`
(la empresa del tracto ya no sale del TMS) y `carrier_shippers` (los clientes se declaran). La clasificación de esas
señales queda solo como lectura, si algo la muestra; si nada la muestra, se borra.

**Lectores que pasan al historial:**
- `daily_closures.py` (roster del día, líneas 78 y 180) y `cierre_lineas.py` (MISMATCH, 123 y 620): la empresa del
  conductor o del tracto **ese día**, con `carrier_of(…, día)` o con un JOIN sobre `valid_during @> día`.
- `equipment_closures.py:108`: lo mismo para los equipos.
- `vencimientos.ultima_empresa_sql`: el último período del sujeto, y de ahí "Ingresó hace N días" y la atribución al término.
- `in_scope_sql` sobre `app.active_fleet` (M4).
- Monitor: `GET /trips` agrega `driver_carrier_mismatch` y `tractor_carrier_mismatch` (la empresa del día de esa flota
  distinta de la empresa del viaje), y la tabla los marca.

**Frontend:**
- **Sin selector de fecha (decisión 14/10):** transferir y quitar son siempre de hoy. La API acepta `effective_date` y
  rechaza los días firmados, pero la pantalla no la pide. Si llega un 409 `CLOSED_DAY`, se muestra la frase.
- Sección "Clientes" en la ficha de empresa del Directorio, con agregar y terminar.
- Vista previa del impacto antes de dar de baja una empresa.
- Reactivar con la lista de la flota para marcar.
- Marca en la tabla del Monitor.
- Todo invalida con `invalidateDirectory` (`lib/queries/directorio.ts`).

### Criterios de aceptación (un test cada uno)

| # | Criterio | Nivel |
|---|---|---|
| A1 | Transferir un conductor con fecha D cierra su período anterior en D y abre el nuevo en D: `carrier_of(D-1)` es la vieja y `carrier_of(D)` la nueva | base real |
| A2 | Una fecha efectiva en o antes del último día firmado se rechaza con 409 `CLOSED_DAY` y no cambia nada | API |
| A3 | No pueden existir dos períodos de empresa para el mismo conductor o equipo el mismo día (el EXCLUDE lo impide) | base real |
| A4 | Reincorporar a quien fue quitado abre un período nuevo y conserva el anterior | base real |
| A5 | El Cierre de un día anterior a la transferencia juzga con la empresa de ese día: no hay MISMATCH por la transferencia | base real |
| A6 | El pre-cierre ya no cambia la empresa de un tracto ni agrega clientes | base real |
| A7 | Agregar y terminar un cliente de la empresa con fecha; `carrier_shippers` y el período coinciden | API |
| A8 | El impacto de la baja cuenta bien los conductores, equipos, viajes de hoy y días abiertos de una empresa de prueba | API |
| A9 | Reactivar con 1 de 2 conductores marcados devuelve solo ese, y la empresa queda No habilitada hasta regularizar | API |
| A10 | `GET /trips` marca `driver_carrier_mismatch` cuando el conductor es de otra empresa ese día | API |
| A11 | Un 409 `CLOSED_DAY` al transferir se muestra con su frase, no como error genérico | vitest |

---

## Parte 2: Certificación 2a, Sin clasificar en versión mínima (decisión 14/10, por el bajo uso medido)

Solo lo que evita errores y pérdida de datos. Los grupos, "Confirmar N", el lote por pares y la vista de detalle quedan
**diferidos hasta que haya volumen**: se reabren si la cola supera unos 50 ítems por semana.

- **Menú por permiso:** el ítem "Sin clasificar" y su contador solo se muestran (y la consulta del contador solo se hace)
  con `documents.review`.
- **Descartar = borrado lógico:** se agregan `discarded_at`, `discarded_by` y `discard_reason`, y `delete_item` deja de
  borrar el blob. Se agrega `POST /items/{id}/restore` y un filtro "Descartados".
- **H1:** el `carrier_id` del ítem se deriva del titular sugerido (`carrier_of`), así el formulario lo trae lleno.
- **Duplicado exacto:** la subida compara el SHA-256 (`content_sha256` ya existe) con la cola viva y con los registros
  vigentes. Si coincide, no crea el ítem y la respuesta trae `duplicates[]` con un enlace al original. La pantalla dice
  "N duplicados omitidos".
- **Renovación anticipada:** si el casillero tiene un documento vigente, el nuevo lo reemplaza solo si vence después. El
  anterior queda en el historial (`audit_log` `document_replace`). Si vence antes o igual, la API responde 409 con una
  frase.
- **"Enviar a Sin clasificar" desde Pendientes:** la subida a staging acepta un `requirement_id` declarado, y el ítem
  llega con el tipo ya puesto.

### Criterios de aceptación

| # | Criterio | Nivel |
|---|---|---|
| S1 | Descartar conserva el blob y la fila; restaurar lo devuelve a la cola | API |
| S2 | Subir un archivo idéntico a uno de la cola o a un registro vigente no crea un ítem y lo devuelve en `duplicates` | API |
| S3 | Un documento que vence después reemplaza al vigente y el anterior queda en el historial; uno que vence antes responde 409 | API |
| S4 | El ítem de un conductor sugerido trae el `carrier_id` de su empresa (H1) | API |
| S5 | "Enviar a Sin clasificar" desde Pendientes deja el ítem con el `requirement_id` declarado | API |
| S6 | Sin `documents.review`, el menú no muestra Sin clasificar ni pide su conteo | vitest |

## Deuda de D1 que entra porque se toca lo mismo

- M5: las fechas del navegador en UTC en `vigenciaDeLaFila` y `expiryRelative` pasan a `hoyEnChile()`.
- El orden del Directorio desempata por id.

## Humo E2E que se agrega (`scripts/smoke/`)

- Transferir un conductor con fecha y verlo en la otra empresa.
- Dar de baja una empresa viendo la vista previa.
- Descartar y restaurar en Sin clasificar.

## Orden de trabajo

1. Migración + trigger + siembra, ensayada en la copia local y después con `BEGIN … ROLLBACK` contra la base real (A1, A3,
   A4).
2. Servicio de relaciones y endpoints (A2, A7-A9). Retirar los escritores del pre-cierre (A6).
3. Lectores del Cierre, vencimientos y Monitor (A5, A10).
4. Backend de Sin clasificar (S1-S5).
5. Frontend de D2 (A11) y de Sin clasificar (S6).
6. Humo E2E, una sola revisión, despliegue (migración aplicada sin extracción en vuelo) y un recorrido en dev.

## Tangentes (no se tocan en A)

- Purga programada de los blobs descartados con más de 30 días.
- Sin clasificar opción B completa (grupos, "Confirmar N", lote por pares), si el volumen lo justifica.
