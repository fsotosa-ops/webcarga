# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> **`AGENTLOG_ARCHIVE.md` NO está en git, y es a propósito** (decisión del usuario, 2026-08-15):
> el histórico no ensucia el repo ni los diffs. Consecuencia asumida: archivar mueve contenido
> fuera de control de versiones. El respaldo real son los commits viejos de `AGENTLOG.md`, que sí
> está trackeado — el `.gitignore` lo lista pero no lo afecta, porque ya lo estaba desde antes.
> No "arreglar" esto con `git add -f`.
> (Rondas 51-54, 55-109, 112-120 y 138-146 archivadas en su momento; ver el archivo.)
> (**Rondas 147-148 archivadas al cerrar la Ronda 149**: el backlog y el roadmap, el click-through
> de la app desplegada, el contrato, el rol `writer` y el test rojo. Lo que seguía abierto se
> consolidó ABAJO antes de mover nada.)
> (**Rondas 152-157 archivadas al cerrar la sesión del 2026-09-14**: todo su trabajo está
> desplegado, y lo que seguía abierto se consolidó en el checklist de la Ronda 160.)

### 2026-09-16 — Ronda 161: "Solicitud de Cambios Diario 2.0" — causa raíz, olas 0 a 4

Operaciones mandó `monitor-app/bugs/20260916/Solicitud de Cambios Diario 2.0.docx` (13 temas, 20
capturas). Investigado con systematic-debugging, cada caso con nombre reproducido contra producción.
**Plan aprobado**: `~/.claude/plans/graceful-cuddling-avalanche.md`. Operación/CD queda para un
brainstorming aparte con Operaciones.

## Las cuatro causas raíz (verificadas)

- **R1, la empresa del conductor.** El loader de Mage `load_driver_assignments_06` reimportaba
  desde el Excel Centralizador EETT y pisaba las transferencias de la app, que no marcaban
  `is_manual_override`. Villegas fue reasignado 5 veces.
- **R2, fechas.** El cierre decidía si un viaje ocupa el día D con el `is_active` de AHORA. 83 de
  476 viajes (01-15/09) son multi-día.
- **R3, cancelados.** Un CANCELADO contaba como carga (50 de 51).
- **R4, motivos.** "No trabajando" vs "Trabajando sin asignación" estaba escrito en el frontend; no
  había vigencia; los ejes no se hablaban.
- Lateral: vínculos manuales con la patente contradicha (el formulario autocompleta id + patente del
  tracto habitual y la patente editable no invalidaba el id). Partía las vueltas de Lara.

## Hecho y DESPLEGADO/APLICADO (producción)

| Qué | Dónde |
|---|---|
| Transferir marca las dos filas; reasignar le gana a un desvincular anterior | commit `2737df9c`, desplegado |
| Guardia `NOT EXISTS` en el loader (sin él, un cambio del Excel a una 3ª empresa tumbaba el bloque) | Mage, vivo |
| El tracto del vínculo manual sale de la patente (`_activo_de_la_patente`) | commit `9c30f7a9`, desplegado |
| `trip_statuses.counts_as_load` + 3 estados sin catalogar | migración `20260916210000`, aplicada |
| `app.trips_del_dia(fecha)`: función acotada (la vista tardaba 91 ms y crecía) | `20260916233000`, aplicada |
| Reparación: 4 transferencias revertidas (Villegas, Ulloa, Deiby, Brian Celis) | `20260916220000`, aplicada |
| Reparación: 3 vínculos con patente contradicha → Lara vueltas 1 y 2 | `20260916230000`, aplicada |
| Tablas `closure_periods` + `closure_lines` con RLS, trigger del sujeto polimórfico, `valid_until` | `20260916235000`, aplicada |
| Grupos de `DRIVER_REASON` + `code` SIN_CONDUCTOR | `20260917000000`, aplicada |

Muñoz Godoy quedó fuera de la reparación a propósito: dado de baja el 04/09 y desvinculado el 08/09.

## Olas 2-4: DESPLEGADAS (commits `40488828` backend, `b0290db9` frontend, en `dev`)

- `services/cierre_lineas.py`: recalcular (congela si CLOSED), poner_motivo (vigencia + propagación
  "Sin conductor" al tracto habitual, sólo llenando silencio), cerrar (una transacción, FOR UPDATE),
  reabrir (admin + nota). Tablas viejas = proyección en la misma transacción.
- `POST /closures/{fecha}/close|reopen`; los dos `/close` viejos se retiraron. Los 16 lectores de la
  regla vieja usan `trips_del_dia`. Reporte Sección 4 con columnas del catálogo. Grupos de motivo
  validados por dominio; `/trips/meta` trae `group`.
- Frontend: tiles por `category`, "Hasta", sólo lectura con día cerrado, error visible al guardar,
  una sola llamada para cerrar, pie "Día cerrado por X el dd/mm hh:mm" + "Reabrir día" (admin).
  `CloseDayDialog` retirado. Trinquete visual 1.717 → 1.685.
- Migración de datos `20260917010000` aplicada ANTES del push y RE-CORRIDA después del deploy.
  Estado verificado en producción: 4.782 líneas, 342 motivos, 9 días firmados, **0 diferencias
  fila por fila** entre líneas y tablas viejas.
- Deploy Monitor API y Deploy Frontend en verde (`e799c528`). `/health` 200, la ruta nueva responde
  401 sin credenciales. Sin errores en logs. Sólo existe `webcarga-monitor-api-dev` (no hay otro
  escritor de las tablas viejas).

Medido: backend suite completa en verde (1.011 + las 6 que fijaban la regla vieja, corregidas);
frontend 1.365 en verde, `tsc` limpio, build OK. Mutaciones verificadas: congelamiento, herencia de
vigencia, unicidad/trigger/RLS, guardia de la regla vieja, marcado de transferencia, patente→activo.

## Checklist — siguiente paso exacto

1. **UAT: NO hecha.** No tengo credenciales para entrar a la app; al cierre de la ronda nadie había
   abierto el cierre con el código nuevo. Click-through del usuario sobre el desplegado: tiles
   (Esperando carga en No asignados), "Hasta" y que el día siguiente lo herede, el tracto que recibe
   "Sin conductor", Confirmar cierre con el aviso, Reabrir con nota.
2. **Verificar el congelamiento con tráfico real**: después de que alguien abra un día firmado,
   `max(computed_at)` de sus líneas tiene que seguir en `2026-09-16 12:12` (hora Chile).
   Al cerrar la sesión (17/09 02:38): sigue en 12:12, pero no hay evidencia de que alguien haya
   abierto un día firmado con el código nuevo — no cuenta como verificado. **El 16/09 quedó ABIERTO**
   (Operaciones no lo firmó); será el primer día que se firme con el cierre unificado: revisar que el
   período quede CLOSED con `frozen_totals` y que el pie muestre el aviso.
3. Operaciones valida la matriz de grupos en Configuración › Motivos de conductor (Conductor backup y
   Adelanto de ruta quedaron en "no trabajó"). Efrain 13/09: si lo quieren corregido, reabrir el día.
4. Pendiente del plan: ola 4.4 (líneas TRIP del paso Viajes) y ola 5 (retirar tablas viejas y la
   proyección tras días de paridad — la consulta de paridad está en la ronda).
5. **Operación/CD: esperando la historia de usuario de Operaciones** (el usuario les compartió las
   preguntas el 17/09). Ya decidido por el usuario:
   - El día se cierra UNA vez para todos: Operaciones no se separa por cliente. La operación sirve
     para ver, filtrar y sumar por separado (Walmart, IANSA, Colun…), no para firmas distintas.
     `closure_periods` sigue siendo por día.
   - La operación y el CD de cada camión los ingresa Operaciones directamente en la app (sin Excel).
   - "LOA" = CD LO AGUIRRE; "QL" = CD QUILICURA. Orígenes desde el 01/08: Peñón 653, Lo Aguirre 457,
     Quilicura 222, Noviciado 55, Puerto Santiago 55, La Farfana 74 (tres bodegas), otros menores.
   Preguntas abiertas: ¿un camión trabaja para una sola operación?; ¿el CD es del camión, del
   conductor o de ambos?; ¿los otros orígenes van en "Otros"?; ¿asistencia por CD cuenta conductores
   o camiones?
   Idea de diseño conversada (no aprobada): operación y CD habitual con vigencia en el Directorio,
   catálogo de CD que normalice los nombres del TMS, y la línea del cierre guardando la operación y
   el CD del día.

## Decisiones de arquitectura

- **La app manda sobre la empresa del conductor**; un conductor con una fila marcada es de la app.
- **Qué no es carga lo dice el catálogo** (`counts_as_load`); **qué significa un motivo, también**
  (`group_id`). Ninguna pantalla deriva categorías.
- **Un día de un viaje sale de su evidencia** (paradas en hora de Chile o último reporte), en una
  función acotada a 45 días.
- **La 1.2 del plan (vueltas sin `OR`) NO se hizo**: el `OR` es la regla de la HU §7.3; el caso de
  Lara venía del vínculo con tracto equivocado, ya reparado.
- **Los días firmados se migran tal cual** ("lo que manda es lo que viene haciendo operaciones en la
  app"): corregir uno es reabrirlo con nota.

### 2026-09-14 — Ronda 160: cierre de sesión

Tres cosas más después de la 159, y una lección que vale más que las tres.

## El tile que inventé, y por qué estuvo mal

El usuario reportó que al seleccionar las tarjetas *"no se ve la categoría"*. Medido en el
desplegado: la pantalla abría filtrada por la unión de "No asignados" y "Por regularizar" —una
categoría que era el **string vacío y no tenía tile**—, así que se veía "38 Total" arriba y una sola
fila abajo, con los cinco tiles apagados. Viene del commit `ea00362a`, del **04/08**; no es una
regresión de esta sesión, pero mi arreglo de sincronización puso una fila en esa categoría y lo
destapó.

**Lo resolví agregando un tile "Por resolver" que me inventé**, y el usuario lo marcó: era una
etiqueta nueva de producto decidida por mí, y encima fusionaba dos categorías **excluyentes** —una
fila es una o la otra, nunca las dos—. El mismo patrón que él ya había frenado esa misma noche con
las columnas de comentario: tapar un hueco agregando.

Revertido. **La pantalla abre en "Total"**: el número de arriba es el de las filas de abajo, sin
tile nuevo y sin palabra nueva. El recorte por pendientes no se pierde, se pide con el tile "No
asignados" que ya existía, y queda marcado.

**Hallazgo lateral**: el valor inicial del `useState` de `category` es **código muerto** — el
`useEffect` con `[vista]` corre también al montar y lo pisa. Lo descubrí mutando: cambiar el
`useState` no pone ningún test en rojo; cambiar el efecto pone dos.

## La columna de comentarios en la pestaña "Viajes": NO existe, y es a propósito

El usuario preguntó por qué no la ve en Abandonados / En curso / Rezago. **Nunca se construyó.** Se
frenó al decidir el modelo de cierre: agregarla sobre `app.trips.comments` era el quinto lugar para
guardar un comentario. Nace en la **ola 4** del diseño, con la línea `subject_type='TRIP'`.

## Decisión de proceso del usuario

**Pushear directo cuando esté verde**, sin preguntar. Se sigue esperando la ventana entre lotes de
ingestión para el extraction y el monitor-api, y se sigue confirmando antes de escribir en
producción algo que no sea un despliegue.

## Estado al cerrar

`dev` en `42b390db`, **todo pusheado y desplegado** (Frontend, Monitor API y Extraction Service en
verde). Árbol limpio. **Frontend 1.375, backend 1.015, extraction 51** — todo en verde, `tsc`
limpio, build OK, trinquetes sin moverse.

**Verificado en producción**: los 4 viajes cerrados salieron de "En Curso"; los 3 jobs encolados
hace un mes se recuperaron solos a las 01:00:47; el comentario del cierre se guarda en una fila
asignada y sobrevive al recompute; SVLT43 dice "No asignado".

## Checklist — siguiente paso exacto

1. **Leer `docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md`** y decidir si va. Si va,
   la **ola 1** son las dos tablas sin que nadie las lea — reversible con un `DROP`.
2. **Los 46 abandonados siguen sin poder declararse**, y su columna de comentario tampoco existe.
   Las dos cosas están en la ola 4. Si el cierre de prueba de Pablo es antes, se puede adelantar
   sobre `app.trips.comments` asumiendo la deuda — el usuario ya rechazó eso una vez.
3. **El cierre de prueba de Pablo**, que sigue siendo lo único que cierra el Bloque 1.
4. **De negocio**: 32 viajes de Sodimac trabados (el más viejo del 30/07), la matriz estado→grupo de
   Pablo y Fabián, y el bug que Fabián tiene que reproducir.
5. **Deuda anotada hoy y no tocada**: 6 de 7 días firmados se siguen recalculando (lo arregla el
   modelo nuevo); el historial de migraciones de Supabase está desfasado desde el 23/08 y la fuente
   de verdad es el directorio `migrations/`; el desplegable de filtro puede recortarse con muy pocas
   filas ahora que el contenedor scrollea.

### 2026-09-14 — Ronda 159: los tres jobs que llevaban un mes encolados

Tres filas de `ops.extraction_jobs` en `queued` con `started_at` nulo, entre 7 y 26 días:
`cumplimiento-iansa` desde el **19/08**, y `cumplimiento-iansa` + `sodimac/trips` desde el **07-09**.

## La causa

El job corre en un `asyncio.create_task` **dentro del mismo proceso** que atendió el POST. La fila
vive en Postgres; el trabajador vive en memoria. Si la instancia desaparece entre el `INSERT` y
`try_claim_slot`, la fila queda en `queued` y no la recoge nadie.

El servicio **ya tenía** un recuperador de huérfanos, puesto tras el incidente del 19/08 — pero mira
sólo `status = 'running'`. La **misma caída** del 07-09 produjo los dos tipos a la vez y sólo uno se
recuperó: de cinco jobs encolados a las 20:30, `cumplimiento-sap` alcanzó a estar `running` y salió
marcado *"Slot huérfano recuperado"*, mientras los otros dos seguían en `queued` 26 días después. Y
el de agosto se encoló **17 segundos después de un `deploy.yml` de este mismo servicio**
(02:00:28Z contra 02:00:45Z).

**Descartado en el camino**: la trampa clásica de Cloud Run —CPU no garantizada fuera de una
request— ya estaba cubierta (`--no-cpu-throttling`, `--min-instances=1`). Por eso no está en el
arreglo.

## El arreglo

Un segundo recuperador gemelo, en el mismo advisory lock, para `queued` + `started_at IS NULL` más
viejo que `QUEUE_TIMEOUT_MS + ORPHAN_GRACE_MS`. Mismo invariante que el de `running`.

Se marca `failed` y **no se reintenta**: estos jobs traen una ventana de fechas en el `request`, y
reintentar uno de hace 26 días traería datos de otra época. El planificador los reencola cada 15
minutos — el trabajo no se pierde, queda superado.

**51 en verde**, 2 salteados (integración con `INTEGRATION=1`, verificado que no son fallos de
conexión disfrazados). **Cuatro mutaciones** verificadas.

Las tres filas se limpian solas en la primera reclamación de slot después de desplegar: llevan días
y el umbral son 6 minutos.

## Checklist — siguiente paso exacto

1. **Desplegar el extraction service** (`deploy.yml`) y confirmar que las 3 filas pasan a `failed`.
2. **Sin pushear**: este commit, el del diseño del modelo de cierre y el del AGENTLOG.
3. El resto sigue como lo dejó la Ronda 158.

### 2026-09-14 — Ronda 158: el cierre y el Monitor dejan de contarse cosas distintas

Cinco pedidos del usuario sobre el Cierre, y uno más sobre el Monitor que apareció a mitad de la
sesión. Los dos bugs se **reprodujeron contra la base de producción** antes de tocar una línea.

## Los dos bugs, y qué eran

**1. El motivo puesto en el Monitor no llegaba al Cierre.** `PATCH /trips/{id}` escribe UNA columna,
`app.trips.unassigned_reason_id`. `bulk-close` —el mismo acto desde la pestaña "Viajes"— escribe esa
y además `is_active=false, is_working=false`. Y del lado de la lectura, la CTE que decide si un
tracto trabajó **no consultaba el motivo en ninguna parte**: sólo preguntaba si existía un viaje
resuelto a ese tracto. La Ronda 155 alineó el vocabulario de los dos escritores; no alineó el efecto.

Reproducido: viaje de Walmart del 07-09 con motivo escrito desde el Monitor, y el tracto **SVLT43**
en `ASSIGNED` esa misma fecha. Con el filtro puesto, los tractos con carga del 07-09 bajan de **25 a
24** y el único que sale es SVLT43.

**2. Los viajes cerrados atascados en "En Curso"** (`2048268`, `30159194`, del 07-09). El override
manual no tenía condición de salida: `IndicatorSwitches` marca el campo, `protect_manual_overrides`
lo congela **para siempre**, el TMS cierra el viaje, el pipeline intenta apagarlo y el trigger lo
revierte. Y "En Curso" es literalmente `is_active = true`.

La prueba de que el pin era la causa: de **2.124** viajes de QAnalytics en estado de cierre, **2.120
pasaron al histórico solos** y los **4** que quedaron tenían los cuatro la marca sobre `is_active`.

## Lo que se hizo

| # | Qué |
|---|---|
| 1 | **Columna "Generador de carga"** en las tres tablas. El eje de conductores ya recibía `client_names[]` y **no lo pintaba** (sólo lo usaba el pivot del reporte); el de tractos no lo traía y sale del LATERAL que ya leía `app.trips`, resuelto por `public.shippers`. En "Viajes", "Cliente" pasó a llamarse igual |
| 2 | **Un viaje declarado deja de contar como carga**: filtro en las dos CTE de recompute y en el universo de `SQL_GRUPOS_CIERRE`, cuyo propio comentario ya decía la regla desde el 18/08 pero la aplicaba sólo a la rama "abandonado" |
| 3 | **El comentario se escribe en cualquier fila**, con motivo o sin él, con carga o sin ella. El 422 pasó a gobernar el MOTIVO y no la fila, y el recompute dejó de borrarlo |
| 4 | **Motivo por fila en "Viajes"**, reusando `bulk-close` con un elemento, y la barra de lote **fijada al pie** del área visible |
| 5 | **El override manual vence** cuando el TMS llega a un estado del grupo `cerrado` |

## Decisiones de arquitectura

1. **Los dos catálogos de motivos quedan SEPARADOS.** El usuario frenó la unificación a mitad de
   camino y los datos le dan la razón: `DRIVER_REASON` (21) responde *por qué una persona o un tracto
   no trabajó* y `TRIP_UNASSIGNED_REASON` (12) *por qué WebCarga no tomó esa carga*; 287 filas usan el
   primero, 8 viajes el segundo, **cero solapamiento**. Consecuencia: **la fila del cierre nunca
   hereda el motivo del viaje** — está escrito en otro idioma. Se propaga el hecho, no la etiqueta.
2. **El trigger se arregla en el post_hook de dbt, no en una migración.** `protect_manual_overrides`
   la crea dbt con `CREATE OR REPLACE` en **cada corrida**: una migración habría quedado revertida en
   la siguiente pasada. Se editó `dbt/tms/models/app/trips.sql` en Mage y se sincronizó.
3. **Se liberan sólo `is_active`/`is_working`.** `is_assigned`, `manual_status` e `is_first_leg`
   siguen protegidos aun con el viaje cerrado: responden *"¿tomamos nosotros esta carga?"*, que es una
   corrección humana sobre algo que el TMS no sabe mejor. El grupo `problema` (Cancelado, En Pana,
   Devuelto, Sin Registros) **no** libera.
4. **El comentario cambió de significado**: de pie de página del motivo a nota del día de esa fila.
   Por eso el recompute ya no lo borra.

## Dos cosas que me pasaron y valen más que el código

**`app_trips.sql` del repo era un espejo MENTIROSO**: 399 líneas de diferencia con el modelo real de
Mage, que tiene triggers que el espejo no conocía. Casi edito el archivo equivocado. Quedó
sincronizado con la copia real, y el diff grande es eso: ponerse al día, no un refactor.

**Introduje un bug en el trigger y llegó a producción.** La primera versión hacía
`NEW.manually_edited_fields := array_remove(OLD.manually_edited_fields, ...)`, que **pisa lo que el
propio UPDATE acababa de escribir**: un `bulk_close_trips` sobre un viaje ya cerrado perdía su marca.
Lo pescó `test_el_estado_del_tms_no_se_toca` —justamente el test que este proyecto tiene anotado como
frágil por elegir su sujeto de producción sin `ORDER BY`—. Corregido a `NEW`, verificado con los tres
casos contra la base, y ya está viva la versión buena.

## Lo medido

**Backend 1.015 en verde, cero salteados** (venía de 1.006); **frontend 1.371 en verde**, `tsc`
limpio, `npm run build` OK, trinquetes visuales sin moverse. Las consultas nuevas corridas contra la
base real antes de escribir un mock, el conteo de marcadores contra argumentos hecho a mano en los
seis `UPDATE` (pasaron de 6 a 7), y **siete mutaciones verificadas**: revertir cada conducta pone en
rojo su test.

Ojo con las corridas del frontend: la suite completa da timeouts de 5000 ms si hay otra corrida en
paralelo. En limpio da 1.371/1.371 y cero timeouts.

## El UAT encontró tres defectos que las 1.371 pruebas no podían ver

El usuario preguntó si había hecho regresión **y UAT**. Regresión sí; UAT no, y ahí estaba el hueco.
Se levantó la app local contra la base real y se hizo el click-through sobre el 07-09.

1. **La barra de selección de "Viajes" no se pegaba.** `position: sticky` no puede salirse de la caja
   de su padre, y el lienzo del cierre tenía `overflow-hidden` para redondear esquinas — eso lo
   convierte en el *scrollport* de cualquier sticky de adentro, y como no scrollea, la barra no se
   movía. **2.751 px fuera de lo visible** con la página arriba.
2. **El generador de carga salía en minúsculas** en "Viajes" (`walmart`) mientras "Flota del día"
   mostraba `Walmart` en la columna que se llama **igual**.
3. **En teléfono la tabla quedaba cortada**: 1.030 px dentro de un contenedor con
   `overflow-x: hidden`, sin manera de llegar a Acción ni a Comentario.

**Y mi test de la barra no probaba nada**: afirmaba que el `className` contenía `sticky`, y eso era
cierto con la barra rota. jsdom no tiene layout. Peor: el test de reemplazo, el que fija la causa
raíz, **tampoco servía en su primera versión** — el selector agarraba otra card anterior del DOM y
pasaba con el bug puesto. Lo delató la mutación, no la lectura.

**Lo verificado en pantalla:** SVLT43 dice "No asignado"; la columna nueva muestra Walmart; se
escribió un comentario en una fila **sin motivo** y otro en una fila **asignada**, y los dos
sobrevivieron a un recompute posterior (`computed_at` 22:29:55 contra el comentario de 22:29:39) —
los primeros comentarios guardados en la historia del proyecto, borrados después.

## Checklist — siguiente paso exacto

1. **Las dos migraciones están APLICADAS y verificadas.** El usuario conectó el proyecto
   `webcarga-core-db` al MCP de Supabase y por ahí se aplicaron — `psql` sirve para leer, pero el
   clasificador de permisos bloquea las escrituras a producción. Estado final: **0 filas trabadas,
   0 viajes cerrados marcados como activos o trabajando, el trigger encendido (`tgenabled = 'O'`) y
   los 11 `is_assigned` conservados.**
   - `20260914180000` apaga el trigger dentro de su propia transacción **a propósito**: probado, sin
     eso decía `UPDATE 10` y no cambiaba ningún valor.
   - Los 4 viajes que el usuario reportó se habían destrabado **solos** en la corrida del pipeline
     de las 21:09, antes de la migración: el trigger nuevo hizo su trabajo sobre los que el TMS
     todavía reporta. La migración limpió las 6 restantes, que ya nadie volvía a actualizar.
2. **Nada está comiteado.** 16 archivos modificados y 2 migraciones nuevas.
   **Ojo con el historial de migraciones**: `list_migrations` de Supabase llega hasta
   `20260823200047`; las 4 del repo posteriores a esa fecha se aplicaron a mano y **nunca se
   registraron**. Las 2 de hoy tampoco. No se tocó — pero el historial de Supabase no es fuente de
   verdad de este proyecto, el directorio `migrations/` sí.
3. **Lo de Mage ya está desplegado** y la función corregida está viva — eso va por fuera del repo.
4. **Click-through del usuario** sobre el 07-09: la columna nueva, SVLT43 ya sin "Asignado", comentar
   una fila asignada y que sobreviva al recargar, y el motivo por fila en "Viajes".
5. Sigue de antes: el cierre de prueba de Pablo, y agrupar el cierre por estado esperando la matriz
   estado→grupo de Pablo y Fabián.

### 2026-08-27 — STAND BY. Estado y punto de retomada

`dev` en `c60888d7`, **pusheado**. El último código desplegado es `684ec37a` —Deploy Frontend y
Deploy Monitor API en verde—; lo posterior son sólo AGENTLOG, TECH_DEBT y el borrado de
`logextraction.txt`, que no disparan workflow. Árbol limpio. **Nada a medio hacer.**

## Todo lo de la minuta del 25/08 que era código, está en producción

Once commits en dos rondas, más **tres migraciones aplicadas a la base** (`name_tokens` sin
puntuación, los 10 motivos, y los 3 que faltaban). Suites finales: **frontend 1.327 en verde**,
**backend 987 en verde, cero salteados**.

## Los 19 salteados: cerrado, era un hipo

Tres corridas lo resolvieron: los 190 de integración solos dan `190 passed, 0 skipped`; los 797
mockeados solos dan `797 passed, 0 skipped`; la completa dio una vez `968 passed, 19 skipped` y a la
siguiente **`987 passed, 0 skipped`**. Transitorio, no reproducible.

**Pero el mecanismo quedó anotado en `TECH_DEBT.md`**: `conexion_revertida` convierte un fallo de
conexión en `skip`, no en rojo. Está bien para "no hay credenciales", no para "no pude conectar" —
ahí el test no probó lo que dice probar y la suite igual reporta verde. Me pasó de creerlo, después
de desmentirlo, y al final de confirmarlo con tres corridas: **vale más medir tres veces que
corregirse dos**.

## Lo que queda, y de quién es

**De negocio, esperando a Pablo:**
1. **Issue #12 — rotación.** La métrica no existe en el producto (lo más cercano es
   `v_driver_daily_trip_legs`, vueltas por conductor por día). Y la marca GPS que él propuso **no
   llega**: 0 de 821 en QAnalytics, 0 de 46 en Sodimac. Alternativa medida: llegada GPS al primer
   destino, 707 de 821.
2. **Criterio de ausencia de Sodimac (issue #3).** 22 viajes trabados, hasta 34 días. Ojo: el
   mecanismo de alerta YA existe y ya los marca — falta decidir qué se hace con ellos, no construirlo.
3. **La alerta a finanzas** (sección 5.3): falta el número de días y el destinatario.
4. **Doris Mercedes** y la **reproducción del bug 4**: no existen en la base como para investigarlos.

**De dato maestro, equipo WebCarga:** los 7 casos de la sección 6, Muñoz Godoy a La Fortaleza, los 7
tractocamiones sin tipo de operación, y las 2 patentes fuera del directorio. Las puertas ya están
abiertas.

**De desarrollo, cuando haya definición:** el escalón que falta del mecanismo de alertas (que salga a
buscar a alguien), y el bug de `trips.planning_date` corrido un día en 161 de 1.741 viajes de
QAnalytics, que vive en `stg_qanalytics_trips`, en el dbt de Mage.

## Checklist — siguiente paso exacto

1. **El cierre de prueba de Pablo.** Es la única verificación que cuenta. Tres cosas concretas:
   crear y asignar con un RUT que ya existe (tiene que aparecer el mensaje y el botón para
   asignárselo, no el silencio), con puntos y con dígito verificador malo; cerrar el 25/08; y
   confirmar una de las seis propuestas de vínculo.
2. **Issue #12 necesita respuesta de negocio** antes de que haya nada que programar.
3. **El job muerto de `ops.extraction_jobs`**: un `cumplimiento-iansa` encolado desde el 19/08 que
   nunca arrancó (`started_at` vacío). Ocho días es un producto que el worker no está tomando.
4. **La deuda de `conexion_revertida`** anotada arriba, cuando se toque el conftest.


### 2026-08-27 — Ronda 151: el 2.3 implementado, y la rotación convertida en pregunta

Con la Ronda 150 desplegada, el usuario pidió las dos que quedaban: **implementar 2.3 en el
pre-cierre** y **dejar lo de rotación como issue**. Y aportó las definiciones que faltaban.

## Lo que el usuario definió

| Pregunta abierta | Su respuesta |
|---|---|
| Ausencia de Sodimac | Un mecanismo de alertas estándar de la industria, y el gestor del monitor decide qué hacer |
| Adelanto de ruta | Partir de la fecha-hora GPS de **salida del local de origen** (propuesta de Pablo) |
| Caso Gerson Ferrada | **En el pre-cierre**, y desde ahí sincroniza con Certificación |
| Motivos duplicados | Van los del documento, los trece |

## Dos de esas cuatro cambiaron al ir a mirar el dato

**El mecanismo de alertas YA EXISTE.** Antes de diseñar uno nuevo fui a `app.monitor_alert_rules`:
tiene `stale_report_hours 2h`, `dwell_hours 2h`, **`tms_dropped_hours 3h`** y
`late_arrival_grace_min 60`, configurables desde Configuración. `_tms_dropped` (trips.py:473) compara
el último reporte del viaje contra la última corrida de SU TMS, y hay chip de filtro en el Diario:
**"Ya no está en el TMS"**. Verificado contra la base: **los 25 viajes trabados ya están marcados**, y
los 19 de Sodimac llevan hasta **721 horas —30 días— sin ser reportados**. No falta detección, ni
umbral, ni pantalla, ni el flujo de cierre con motivo. **Falta que alguien los cierre**, que es
exactamente OPS-13. Lo único que no existe es el escalón de arriba: que la alerta salga a buscar a
alguien en vez de esperar a que entren a mirar.

**La marca GPS que propuso Pablo no llega.** Medido sobre agosto: `gps_departure_date` en la parada
ORIGEN existe en **0 de 821** viajes de QAnalytics y **0 de 46** de Sodimac; sólo Wingsuite la trae
(6 de 7), que es el 1% del volumen. Los GPS existen pero **sólo en los destinos** (1.126 salidas
sobre 1.393 paradas de destino en QAnalytics). Alternativa con datos: la **llegada GPS al primer
destino**, 707 de 821 en QAnalytics. Sodimac queda fuera de las dos: 46 de 46 sin ninguna marca.

## 2.3 — la propuesta de vínculo

`run_pre_cierre` suma `CONDUCTOR_SIN_EMPRESA`. **Propone y no escribe**, y las tres condiciones son
el argumento:

1. `NOT EXISTS` sobre `driver_assignments` activas — sólo cuando el padrón está **en silencio**.
   Nunca cuando hay una asignación que diga otra cosa: la inferencia llena un silencio, no contradice.
2. `HAVING count(DISTINCT resolved_carrier_id) = 1` — dos empresas distintas no son una propuesta.
3. El vínculo lo escribe una persona desde el panel. Y **como Certificación LEE
   `driver_assignments`, esa escritura ES la sincronización** entre los dos módulos: no hay
   mecanismo aparte que mantener.

**No bloquea** (fuera de `_ESCALACIONES_QUE_BLOQUEAN`, con test que lo fija). La consulta exacta,
corrida contra la base para el 25/08, devuelve **6 propuestas, con Gerson Ferrada Zapata →
Transportes Juan Ramirez Spa** entre ellas. Para hoy, 4.

## Una corrección mía, medida

Comenté que el guarda de `hasEscalations` protegía a la sección de una clave que el backend todavía
no manda. **Lo muté y no rompió ningún test**: `Object.values` no devuelve las claves ausentes. El
que protege de verdad es el `?? []` del `.map` — sacarlo rompe **cinco** tests, cuatro de ellos
preexistentes. El comentario ahora dice lo medido, no lo que yo suponía.

## Estado

Motivos completos y aplicados: **DRIVER_REASON 21, TRIP_UNASSIGNED_REASON 12**. Los tres que había
frenado por duplicar a otros entraron por decisión del usuario, con el argumento y la salida limpia
(apagar el viejo con `active = false`, nunca borrarlo) escritos en la migración.

**Issue #12** abierto con lo de rotación: la métrica no existe en el producto, la marca GPS no llega,
y el conflicto entre la ventana multi-día del cierre y la estadística. Incluye el bug de
`trips.planning_date` corrido un día en **161 de 1.741 viajes de QAnalytics (9,2%)**, que vive en
`stg_qanalytics_trips`, en el dbt de Mage.

## Checklist — siguiente paso exacto

1. **Desplegar la Ronda 151** cuando no haya job corriendo. Ojo: el único `queued` de
   `ops.extraction_jobs` está **encolado desde el 19/08 y nunca arrancó** (`started_at` vacío, un
   `cumplimiento-iansa`) — es una fila muerta, no ingesta en vuelo. La condición real es que no haya
   nada en `running`.
2. **Ese job muerto merece su propia mirada**: ocho días encolado es un producto que el worker no
   está tomando.
3. **El cierre de prueba de Pablo**: crear y asignar con un RUT que ya existe, con puntos y con
   dígito verificador malo; cerrar el 25/08; y confirmar una de las seis propuestas de vínculo.
4. **Issue #12 necesita respuesta de negocio** antes de que haya nada que programar.
5. **El escalón que falta del mecanismo de alertas**: que la alerta salga a buscar a alguien, y la
   alerta a finanzas de la sección 5.3 (falta el número de días y el destinatario).


### 2026-08-27 — Ronda 150: el plan de la Ronda 149, ejecutado

**Decisión del usuario**: ejecutar el plan. Y a mitad de camino, dos más: **no desplegar ni tocar la
base todavía** —hay un job de ingestión en vuelo (1 running, 5 queued)— y seguir con 2.4, 3.3 y 3.4.

**Estado**: todo comiteado en `dev` local, **sin pushear**. Las dos migraciones están escritas y
verificadas contra producción **dentro de una transacción revertida**, sin aplicar.

## Lo que se hizo, ola por ola

| Ola | Qué |
|---|---|
| 0.1 | El **Directorio volvió al menú** (`Sidebar.tsx`). Se llama "Directorio" y no "Empresas" porque ya hay una entrada con ese nombre en el mismo grupo |
| 0.2 | El pie del pre-cierre decía *"Puedes avanzar al cierre aunque queden pendientes"* — **falso desde el 23/08**. Ahora nombra las cuatro escalaciones que bloquean y la que no |
| 1.1 | `try/catch`, estado de guardado y **salida del 409** en `AsignarConductorPopover` |
| 1.2 | Migración: `public.name_tokens()` descarta la puntuación |
| 1.3 | El RUT se canoniza en las tres capas con `public.canonical_rut()` |
| 1.4 | El alta desde el Diario **pide la empresa** |
| 1.5 | `SinFlotaList`: los viajes que bloquean, con nombre, en los dos diálogos de cierre |
| 1.6 | `AltaConductorDesdeCierre`: el alta dentro del panel de pre-cierre |
| 2.1 | "Asignar empresa" en la fila muerta de Certificación, reusando `TransferModal` |
| 2.2 | `AltaDeFlota`: el alta de conductor y equipo, **extraída y usada en las dos fichas** |
| 2.4 | Aviso al desvincular a alguien con viajes activos (+ endpoint `GET /trips/conteo-activos`) |
| 3.1 | Migración: los 10 motivos que faltaban en los dos catálogos |
| 3.2 | La hora sin etiqueta bajo "Fecha" pasa a ser la **planificada**, con su nombre |
| 3.3 | El estado del portal de Sodimac se marca como suyo |
| 3.4 | `GestionDeclarada`: el tipo de gestión, editable después del alta |

**Queda sin hacer 2.3** —reconciliar padrón y hecho, el caso Gerson Ferrada—: es un mecanismo nuevo
(*proponer* el vínculo, nunca escribirlo) y necesita la regla de negocio de Pablo primero.

## Lo que se midió antes de tocar, y cambió lo que iba a hacer

**`name_tokens` no es cosmética**: la usa `app.resolve_trip_fleet()`. Medido contra producción antes
de escribir la migración: 23 de 94 nombres del TMS cambian de tokens, **15 pasan de 0 a 1
coincidencia exacta** con el directorio, y esos alcanzan **323 viajes**. En los 323 el conductor que
la regla de nombre elegiría **es el mismo que ya está vinculado**: 323 coinciden, 0 discrepan. O sea
no le cambia el conductor a ningún viaje; hace que la regla de nombre esté de acuerdo con lo que el
RUT y la patente ya sabían, y destraba la sugerencia. Sin esa medición habría aplicado a ciegas algo
que toca el resolvedor.

**La patente NO se canonizó, y es una decisión escrita en el código**: tiene la misma forma que el
RUT (compara literal teniendo `canonical_plate` al lado) pero está medida y hoy no falla —817 de 828
viajes de agosto calzan igual literal que canónico—, y su llave se cruza con la de `client_rows` más
abajo, así que canonizar una sola de las dos las desalinea.

**El `pattern` del `Query` no protege a un llamador de Python.** Escribí un test de integración que
esperaba que `entity_type="EMPRESA"` fuera rechazado llamando la función directo, y no lo es: la
validación es de FastAPI, no de la función. El test se movió a nivel HTTP, que es donde la regla
existe de verdad.

**Una columna que no existe**: la primera versión del conteo miraba
`vfr.resolved_trailer_asset_id`. `app.v_trip_fleet_resolution` no la tiene. La consulta contra la
base lo dijo en el primer intento; un AsyncMock la habría dado por buena.

## El trinquete visual hizo su trabajo

La UI nueva nació con **16 usos de color crudo** de Tailwind y rompió `lib/ui/sistema.test.ts`
(1.760 contra un tope de 1.753). Se reescribió con tokens —`status-incidente` para el error,
`informativo` para el gris de apoyo— y quedó en **0**. De paso el tope bajó de 1.753 a **1.744**, que
es el número real: estaba 9 por encima, y ese margen es justo por donde vuelve a crecer.

## Los tests, y las mutaciones que los prueban

- **Backend**: 977 → **983**. Nuevos: 4 de integración del RUT canónico contra Postgres real, 3 de
  `pre_cierre`, 2 mockeados del alta, 3 de integración del conteo y 2 de ruteo HTTP.
- **Frontend**: 1.313 → **1.325**.
- **Mutaciones verificadas**: guardar `body.tax_id` en vez del canónico rompe 1; desactivar la
  validación del RUT rompe 1; volver el popover a la promesa flotante rompe **4**; sacar el
  Directorio del menú rompe 2; volver la hora de la lista a `status_reported_at` rompe 1; apagar el
  aviso de viajes activos rompe 2.

**Un test del Sidebar estaba en verde por la razón equivocada.** Su `usePathname` mockeado devolvía
`/dashboard/carriers`, y al volver esa ruta al grupo Certificación el grupo pasa a abrirse solo:
el clic que el test hacía para abrirlo **lo cerraba**, y las aserciones seguían pasando porque leían
los enlaces del nav **mobile**. La ruta del mock ahora se mueve por test.

**Y `test_asignar_conductor::test_se_puede_vincular_un_conductor_sin_empresa` hoy PASA.** No lo
arreglé: elige un conductor de la base de producción, y el 25 y 26/08 hubo desvinculaciones reales.
Dejó de ser un rojo conocido y pasó a ser un test que **cambia de color solo**. Queda anotado así en
`TECH_DEBT.md`: es peor que antes, no mejor.

## Checklist — siguiente paso exacto

1. **Cuando no haya job de ingestión en vuelo** (`select status, count(*) from ops.extraction_jobs
   group by 1`): aplicar las dos migraciones y recién después pushear a `dev`. Desplegar con un job
   en vuelo ya costó una hora de ingestión caída en este proyecto.
2. **Verificar contra la base después de aplicar**: `CONDUCTOR_NO_REGISTRADO` del 25/08 debe caer de
   1 a 0 —el RUT de Jaime Vidal existe al canonizar— y el cierre de ese día pasa de 3 bloqueos de
   flota a 2, los dos reales (patente `HJPX95` y patente `BKVR51` sin empresa).
3. **Click-through de Pablo** sobre lo desplegado: crear y asignar con un RUT que ya existe, con
   puntos y con dígito verificador malo; y después cerrar el 25/08 de nuevo.
4. **2.3 necesita su regla**: cuando alguien maneja el tracto de una empresa y no tiene asignación,
   ¿se propone el vínculo? ¿quién lo confirma? Es el caso Gerson Ferrada, y son 8 conductores con
   278 viajes.
5. **Las tres definiciones de negocio siguen abiertas**: criterio de ausencia de Sodimac (22 viajes
   trabados), la regla de "adelanto de ruta" —la fila del catálogo ya está, la estadística no— y el
   conflicto entre la ventana multi-día del cierre y la rotación.
6. **A Fabián**: los 7 casos de la sección 6 y los 7 tractocamiones sin tipo de operación. Las dos
   puertas que faltaban ya están abiertas.


### 2026-08-27 — Ronda 149: los bugs de la minuta de Pablo, diagnosticados contra el repo y la base

**Pedido**: analizar los puntos de `monitor-app/bugs/20260827/Minuta_Revision_App_WebCarga_2_0_v3.md`
—la revisión que Pablo hizo el 25/08 intentando un cierre real— **acotado a los bugs, no a los
deseables de UX**, y contra lo que hay en el repo y en la base. **Alcance elegido por el usuario:
diagnóstico y plan, sin tocar código.** Los 10 puntos de datos, separados en código / dato maestro /
definición de negocio.

Plan completo en `~/.claude/plans/necesito-que-analices-los-peaceful-mountain.md`.

## Lo primero que hay que saber: lo que Pablo vio ES lo que hay en `dev`

Frontend desplegado `fa01d65c` (23/08 20:39) y **ningún commit de frontend posterior**; backend
`445a1a83` (25/08 03:12). No hay trabajo sin desplegar que explique nada.

## Los bugs 1, 2 y 5 son UNO, y la cadena está verificada de punta a punta

1. El TMS manda el nombre sucio (`"CARLOS PEREZ /"`, `"SIVA CARRILLO ENRIQUE ALBERTO ."`).
2. `public.name_tokens()` parte por espacios y **no descarta la puntuación**, así que `/` y `.`
   quedan como palabras y la contención falla: el conductor **que sí existe** deja de ofrecerse.
   **135 viajes en 60 días** con nombres así. Con los tokens limpios "CARLOS PEREZ /" pasa de 0 a
   **2** candidatos contenidos (hay dos Carlos Pérez reales; la ambigüedad es legítima).
3. El coordinador hace lo razonable: "Crear y asignar" → el backend responde **409, ya existe**.
4. `monitor/page.tsx:678-686` **no tiene `try/catch` ni estado de error**. No pasa nada en pantalla.
5. Cuando sí funciona, el conductor **nace sin empresa**, y no hay pantalla donde asignársela.
6. El cierre —que bloquea a propósito desde el 23/08, commit `69c9b33b`— los cuenta y no deja firmar.

**La prueba que cierra el caso, del `created_at` de `public.drivers`:** Carlos Perez Santiago y Luis
Elias Recabarren Cortez existen desde la carga inicial del 16/07 → 409 → silencio. **Navarro Armijo
Alfredo Enrique se creó el 26/08 03:33 UTC = 25/08 23:33 Chile, durante la sesión de Pablo** → era
nuevo → funcionó. No es el formato del RUT: es que unos ya estaban.

**Y esto explica también el "algoritmo demasiado permisivo"** de la sección 4: al perderse la
contención, el popover cae a la lista de *parecidos* ordenada por similitud, donde cualquiera que
comparta "ENRIQUE" o "ARMIJO" sube. **Mismo bug, no un deseable.**

## Los tres viajes que bloquean el cierre del 25/08, reproducidos

| Caso | Escalación | Veredicto |
|---|---|---|
| RUT de JAIME VIDAL | `CONDUCTOR_NO_REGISTRADO` | **Falso positivo — bug de código** |
| Patente BKVR51 | `EMPRESA_NO_RECONOCIDA` | Real: el activo existe con **cero** asignaciones |
| Patente HJPX95 | `PATENTE_NO_REGISTRADA` | Real: no existe en `public.assets` |

`pre_cierre.py:198` compara `upper(trim(tax_id))` contra el RUT del TMS **sin canonizar**. Los 7
viajes de agosto que traen RUT lo traen **con puntos**, y los 7 conductores existen al canonizar:
`CONDUCTOR_NO_REGISTRADO` es hoy **100% falso positivo**, y de paso mata la corrección Tipo A del
nombre. Las patentes en cambio matchean bien (817 de 828); ahí no hay bug de comparación.
**`canonical_rut()`/`canonical_plate()` existen en Postgres y no se llaman desde Python en ningún lado.**

## El dato más incómodo: la propia sesión de revisión fabricó la mitad del problema

Hay **8 conductores con viaje real e invisibles para el cierre** (278 viajes en 60 días) y **7
patentes** en la misma situación (82 viajes). El `audit_log` dice que **4 de esos 8 los generó la
sesión de Pablo**: dos altas sin empresa (25/08 19:04 y 26/08 03:33) y dos desvinculaciones —una de
ellas Deiby Adelmo Díaz, con **70 viajes** en 60 días. **La app deja crear el problema y no ofrece
cómo deshacerlo.**

## Las cifras que Pablo reportó, todas explicadas

- **39 conductores**: el roster de Tractoreo da exactamente 39. El embudo cae 74 → 39 en un solo
  filtro, `assets.webcarga_operation_type_id = TRACTOREO`. Hay **7 tractocamiones sin tipo**, y ese
  campo **sólo se edita en la ficha legacy que ya no está en el menú**.
- **11 vs 22 asignados**: son dos unidades. 11 **conductores** ASSIGNED, 22 **viajes** con conductor
  resuelto. De 18 conductores con viaje real, **6 no aparecen en el cierre** (5 sin empresa + 1 de
  Equipo Completo) y un séptimo sale MISMATCH porque lo desvincularon ese mismo día.
- **Gerson Ferrada**: maneja FHVW77 (tracto de Transportes Juan Ramirez Spa) en 25 viajes, el viaje
  resuelve bien la empresa por patente, pero el roster recorre `driver_assignments` —donde figura
  otro conductor— y Gerson no tiene ninguna. **El cierre recorre el padrón; el viaje resuelve el
  hecho; nada los reconcilia.** Ojo: hay **dos empresas de nombre casi igual**, ambas ACTIVE.
- **16:33 vs 19:57**: no es huso horario. La lista imprime, **sin etiqueta**, la hora de
  `status_reported_at` (cuándo el TMS reportó), y el detalle la de `stop.planning_date`. Peor:
  `status_reported_at` **se mueve en cada ingestión**, así que esa hora cambia sola.
- **Colun/Hueraman**: viaje `439974`, el TMS **lo sigue reportando** (snapshot del 26/08 04:03) y
  nunca cambió de estado. El Diario está bien; el que no cerró es Wingsuite. Su conductor es el
  mismo JAIME VIDAL del falso positivo: **un viaje genera dos de los reclamos**.
- **Sodimac "asignados"**: de 71 viajes, **0 traen patente** y 70 tienen `is_assigned=false`. Lo que
  se lee como "asignado" es el estado del portal, que significa "el mandante nos asignó el viaje".
  Arreglo de vocabulario en pantalla, no de dato.
- **Doris Mercedes: NO REPRODUCIBLE.** No existe en `public.drivers` ni como `driver_name_tms` en
  ninguna fecha. Hay que pedirle a Pablo el viaje exacto.
- **Abandonados**: 25 activos con más de 2 días, el más viejo del **24/07** (no de junio); 22 son
  Sodimac y son exactamente el issue #3.
- **Hallazgo lateral**: `trips.planning_date` no coincide con el día chileno de la primera parada en
  **161 de 1.741 viajes de qanalytics (9,2%)**, 132 corridos **+1 día**. Sodimac y Wingsuite, 100%.

## Dos regresiones que la minuta clasificó como "deseables" y no lo son

- **La lista de Empresas no se borró**: `app/dashboard/carriers/page.tsx` sigue completo. El commit
  `e75d7d93` (19/08) le sacó la entrada del menú y no dejó ninguna. Y es **el destino al que apuntan
  los enlaces de escape del pre-cierre**. Devolver ese link destraba el bug 3 y parte del bug 2.
- **`carriers.management_types`** acepta PATCH en el backend, pero `lib/api/carriers.ts` no lo expone
  y sólo se escribe al crear la empresa: **0 de 248 empresas lo tienen cargado**.

## Los catálogos de motivos, medidos

`DRIVER_REASON` tiene 16 (faltan 5, incluido "Adelanto de ruta"); `TRIP_UNASSIGNED_REASON` tiene 4
(faltan 6). Y hay una **tercera** tabla, `app.unassigned_reasons` (6 filas), que parece legacy —
confirmar quién la lee antes de tocarla.

## Decisiones de arquitectura tomadas en esta ronda

1. **La corrección va en `public.name_tokens()`, no en cada consulta.** La usan la sugerencia de
   candidatos y `app.resolve_trip_fleet()`; no hay ningún índice que dependa de ella (verificado).
2. **El RUT se canoniza en las tres capas** (schema, router, pre-cierre) llamando a
   `public.canonical_rut()`, que ya existe. No se duplica la lógica en Python.
3. **La reconciliación padrón↔hecho propone, nunca escribe sola** — coherente con
   [[feedback_source_of_truth_per_field_not_per_source]]: una inferencia llena un silencio y nunca
   contradice.
4. **Ola 0 antes que nada**: devolver el link del menú y borrar la frase falsa del pre-cierre son dos
   líneas que devuelven capacidades ya construidas.

## Checklist — siguiente paso exacto

1. **Reunión con Pablo** sobre el informe. Lo que hay que llevarle decidido: el criterio de ausencia
   de Sodimac (issue #3), la regla de "adelanto de ruta" y el conflicto entre la ventana multi-día
   del cierre y la estadística de rotación.
2. **Pedirle a Pablo dos cosas**: el viaje exacto de Doris Mercedes y la reproducción del bug 4
   (qué archivo, qué empresa) — la bandeja hoy tiene **1 solo** archivo sin clasificar, y con empresa.
3. **Si se aprueba implementar**, arrancar por la Ola 0 (dos líneas) y después la Ola 1.
4. **Confirmar con Pablo las dos empresas Ramírez** antes de tocar el caso Gerson Ferrada.
5. **A Fabián / equipo WebCarga**, y no es desarrollo: los 7 casos de la sección 6, el traspaso de
   Muñoz Godoy a La Fortaleza, los 7 tractocamiones sin tipo de operación y las 2 patentes fuera del
   directorio. **La herramienta ya existe**; lo que falta es la puerta (Olas 0 y 2).
6. Sigue pendiente de antes: subir los dos `.xlsx` de `entregables-backlog-roadmap/` a `dev/docs` de
   Drive, y el acta de aceptación del Hito Final.
