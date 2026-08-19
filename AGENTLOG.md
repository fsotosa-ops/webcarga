# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> **`AGENTLOG_ARCHIVE.md` NO está en git, y es a propósito** (decisión del usuario, 2026-08-15):
> el histórico no ensucia el repo ni los diffs. Consecuencia asumida: archivar mueve contenido
> fuera de control de versiones. El respaldo real son los commits viejos de `AGENTLOG.md`, que sí
> está trackeado — el `.gitignore` lo lista pero no lo afecta, porque ya lo estaba desde antes.
> No "arreglar" esto con `git add -f`.
> (Rondas 51-54 — Centro de Flota, feedback post-deploy, auto-clasificación de zona, HU-18/24 — archivadas al cerrar la Ronda 55.)
> (Ronda 66 — casuística de negocio + promoción dev→main — archivada al cerrar la Ronda 67.)
> (Ronda 90 — Centro de Cierre del Día unificado, plan de 16 tareas/4 bloques — archivada al cerrar la Ronda 91.)
> (**Rondas 55-109 archivadas al cerrar la Ronda 119**: Hito 3, el rediseño del Diario, el Cierre
> del Día, la corrección de Tipo de Operación, el origen de Certificación, los bugs de "Revisión
> Diario 2.0", IANSA y la propuesta comercial. Lo que seguía abierto se consolidó ABAJO, en
> PENDIENTES VIGENTES, antes de mover nada.)
> (**Rondas 112-120 archivadas al cerrar la Ronda 122**: Tramos 2 y 3 de Certificación, el rediseño
> de Configuración, el registro de revisión y el buscador, y el diseño del Cierre. Mismo criterio:
> lo abierto ya estaba consolidado en PENDIENTES VIGENTES antes de mover nada.)

### 2026-08-18 (cont.) — Ronda 126: los duplicados de `trip_stops` son historial, no basura

Arrancó como "rediseñar el ítem 4 con los datos de hoy" y terminó **retirando el ítem 4**. El
usuario levantó que Fabián y Pablo habían dicho que Sodimac borra y regenera viajes; se verificó
contra los transcripts de Granola y es cierto.

#### El error que se corrigió a tiempo

Se llegó a proponer una limpieza de 2.869 filas con la regla "conservar la que tiene datos". Estaba
mal por dos razones distintas, encontradas en ese orden:

1. **La medición dependía del predicado.** Contando sólo `arrival_date` daban 26 conflictos; sumando
   las marcas de GPS daban 921. La clave correcta no era la posición sino **el lugar**: fusionando
   por `(trip_id, stop_type, local)`, 1.073 de 1.083 grupos fusionaban sin perder un dato.
2. **Aun así estaba mal de raíz.** Las filas son versiones de un cambio de base real. Pablo, 07/08:
   *"el TMS de Sodimac borra estos viajes después... en el sistema me los quitan, me los borran,
   entonces no tengo esta trazabilidad"*. La limpieza habría borrado exactamente eso.

#### Lo que se entendió del pipeline

- **La historia YA está guardada y bien.** `bronze.tms_trips_snapshot` es un SCD Type 2 sano:
  24.023 versiones sobre 3.563 viajes. Para `830021` tiene las dos versiones, en los mismos dos
  horarios que las dos filas ORIGIN. **Conclusión de diseño: `app.trip_stops` debe tener el estado
  vigente, y la historia se consulta en el snapshot.** Eso vuelve seguro arreglar el `stop_id`.
- **El diagnóstico del origen doble estuvo MAL TRES VECES antes de resolverse.** Se dijo, en orden:
  (1) "es la misma bodega renombrada" — falso, 256 y 257 son códigos de local distintos, lo desarmó
  el usuario; (2) "es un cambio de base real" — falso, un viaje finalizado el 15/07 seguía
  alternando origen en agosto; (3) "el portal devuelve un valor inestable" — falso también.
  **La respuesta salió de bajar el CSV real de GCS**, no de razonar sobre la base. Lección:
  cuando el diagnóstico se cae dos veces, ir al artefacto de origen en vez de hipotetizar la tercera.
- **Precedente para cualquier cambio de fórmula:** el 01/08 cambió la entrada del hash y esa sola
  corrida fabricó 1.042 filas. Las de julio calzan con `md5(trip ‖ local ‖ stop_order-1)`; las del
  01/08 no calzan con ninguna. **Tocar la fórmula del `stop_id` exige, en el mismo cambio, una
  migración que reescriba los ids existentes.**

#### Los tres defectos reales de Sodimac (issues #4, #5, #6)

Del CSV real del portal, verificado en tres archivos consecutivos:

- **#4 · Un viaje con dos estados borra el estado de todo el lote.** El transformador clasifica cada
  columna con `.max()` sobre TODOS los viajes del archivo; un viaje con dos `ESTADO` saca esa
  columna del metadata de los 41. Medido: archivo del 18/08 21:22 → **41 de 41 sin estado**; el de
  las 21:32 → 0. Histórico: `ESTADO` clasificado como columna de parada en 115 versiones, pero
  realmente difiere en 3, sobre 2 viajes. **`trip_status` NO está en `merge_exclude_columns`**, así
  que un nulo pisa el valor bueno. Se auto-sana en la corrida siguiente, por eso nunca se vio.
- **#5 · El scraper duplica 7 a 1.** 320 filas para 46 reales, idéntico en 3 archivos.
  `_scrape_table` hace `querySelectorAll` sobre TODO el documento en cada paginación y `append` sin
  deduplicar. La aritmética cierra exacta: `23×10 + 2×(1+…+9) = 320`.
- **#6 · Los viajes de varias conexiones pierden una pata.** "link 2 conexiónes" son DOS PATAS y el
  portal lista una fila por pata, con orígenes distintos y **códigos de local distintos**. 5 viajes
  hoy; 197 versiones históricas con más de un origen, 40 con más de un destino.

**El arreglo del `stop_id` quedó DESCARTADO**: habría forzado a un solo origen justo donde hay dos
de verdad. El comentario del test se corrigió en Mage para que no siga desinformando.

#### Arreglos aplicados (#5 y #4)

**#5 — scraper, commit `68a17916`, desplegado.** `dedupe_captures` en
`extraction_service/app/tms/sodimac/scraper.py`, función pura con 7 tests unitarios que no piden
navegador. **La clave es la FILA COMPLETA, no el `Nº ID`** — deduplicar por viaje borraría un tramo
real. Verificado contra el CSV de producción: 320 → 46 filas, 41 viajes, los 5 de dos tramos
intactos. Se agregó log por página (nuevas/duplicadas) y warning si más de la mitad es repetido.
**No cierra el issue**: el portal sigue obligando a leer de más y falta mirarlo con el navegador.

**#4 — transformador de Mage, clasificación ESTÁTICA.** `COLS_DE_PARADA = ['ORIGEN', 'DESTINO']`;
todo lo demás es del viaje. Elimina el `.max()` sobre todos los viajes del archivo, que era el
mecanismo común a los tres issues. Verificado simulando el bloque sobre el CSV real: 41 viajes,
**0 sin ESTADO**, y los 5 de dos tramos con ambos. Se agregó `drop_duplicates()` en las paradas
(defensa en profundidad: los archivos viejos de GCS siguen duplicados) y un diagnóstico que avisa si
una columna de viaje varía dentro de un viaje.

**Es compatible hacia atrás**: `stg_sodimac_trips` ya lee
`COALESCE(payload->'stops'->0->>'ORIGEN', payload->'trip_metadata'->>'ORIGEN')`, así que tolera las
dos formas de payload. Sigue tomando sólo el primer tramo — eso es el #6 — pero ahora de forma
determinista en vez de depender del orden de las filas.

**El cambio del transformador NO está en git**: `.mage-agent/` está en `.gitignore` a propósito y el
cluster de Mage es la fuente de verdad. Este registro es el respaldo.

#### CIERRE DE LA NOCHE — #4 y #5 verificados en producción, incidente resuelto

**La causa raíz del incidente NO fue el código: fue un slot de concurrencia huérfano**, y el
disparador fue mi propio despliegue. Ver abajo la cronología, que quedó como registro de un
diagnóstico que se equivocó cuatro veces antes de llegar al fondo.

`ops.extraction_jobs` ocupa el slot poniendo `status='running'` y lo libera al pasar a
done/failed. **Si la instancia de Cloud Run desaparece con el job en vuelo, nadie escribe ese estado
y la fila bloquea el slot para siempre.** Con `MAX_CONCURRENT_JOBS=1` eso detiene TODA la ingestión.
Mi revisión entró a las 02:02:57Z; un job arrancó a las 02:03:00; su instancia se fue; 58 minutos de
bloqueo. Los tres scrapers fallaron con "Timeout esperando un slot libre", no entraron archivos, los
`processor_*` devolvieron vacío, y los transformadores reventaron con un `AttributeError` sobre
`.empty` que **no tenía nada que ver con la causa**. Cada síntoma que perseguí era un eslabón hacia
abajo.

**Arreglado de fondo** (commit `5a29d146`, desplegado y verificado sin dejar huérfanos):
`try_claim_slot` recupera slots vencidos apoyándose en un invariante que el diseño YA asumía — un
job no puede correr más de `JOB_TIMEOUT_MS` porque su propio proceso lo mata. La recuperación va
DENTRO del advisory lock. 5 tests nuevos, uno fijando que un job dentro del plazo sigue ocupando su
slot. Suite: 47 pasan.

**#5 VERIFICADO EN PRODUCCIÓN**: el CSV nuevo trae **47 filas en vez de 320**, 41 viajes, y los
**6 viajes de dos tramos conservan los dos**. Dedupe sin pérdida.

**#4 VERIFICADO EN PRODUCCIÓN** (corrida 9373): payload con **0 de 39 viajes sin `ESTADO`**
(el peor archivo previo tenía 41 de 41 sin estado), **máximo 2 paradas por viaje en vez de 10**, y
6 viajes con sus dos tramos. Toda la cadena completó: transformer → insert → stg → int → app.

**EL TEST DE dbt CORTÓ EL PIPELINE POR DATO CORRECTO — y eso enseñó algo.** Al conservar el segundo
tramo, los viajes con origen doble pasaron de 3 a 4 y el `error_if='>3'` puso el bloque en rojo. Los
4 (`815726`, `830021`, `833795`, `841612`) tienen **dos lugares distintos**: son multi-retiro
legítimo. El test afirmaba un invariante FALSO y encima bloqueaba.

Reescrito para afirmar el que sí es cierto: **dos filas ORIGIN del mismo viaje EN EL MISMO LUGAR**.
Un camión no retira dos veces de la misma bodega. Verificado: 0 violaciones con el criterio nuevo,
así que vuelve a `severity='error'` sin umbral de gracia — no hay pasivo que congelar. Lo que ya NO
cubre, a propósito, es el aplanamiento de tramos (#6): eso es pérdida de información, no
duplicación, y mezclarlo fue el error original.

#### #6 localizado y acotado — queda como issue, NO se tocó

Con los tramos ya llegando completos al payload se pudo medir dónde se pierden: **bronze tiene 18
viajes de Sodimac con 2 tramos, silver tiene 0.** Se aplana en `stg_sodimac_trips`, que arma
`trip_stops` desde `payload->'stops'->0` únicamente — su comentario todavía dice "Sodimac no tiene
arreglo de stops, por lo que su único DESTINO se empaqueta", suposición que quedó obsoleta.

**Se parte en dos y sólo una mitad necesita decisión**: multi-destino es puramente técnico
(`app.trip_stops` ya soporta N destinos, funciona para QAnalytics con 3,3 promedio) y multi-origen
necesita que operaciones defina si dos conexiones son un viaje o dos, y qué muestra el Monitor como
origen. **La pregunta que decide la prioridad: ¿esos 18 viajes afectan facturación?**

Ojo al retomar: los 25 viajes con más de 2 filas en `app.trip_stops` son residuo histórico de los
`stop_id` duplicados, **no** son este problema.

#### Cronología del incidente (ingestión caída ~1 h)

**Al cerrar la sesión la ingestión llevaba ~30 min sin recibir dato en las tres fuentes.** Último
upsert a bronze: 02:04 UTC (21:04 COT).

Cronología, en UTC (COT = −5):

| Hora | Qué pasó |
|---|---|
| 01:20 → 01:30 | corrida 9362 **exitosa**, 35 bloques, `dbt test` avisó con 3 |
| 02:02:22 | último CSV de Sodimac (scraper viejo, 320 filas) |
| 02:02:57 | se activa la revisión `webcarga-extraction-dev-00007` con el fix del scraper |
| **02:04** | **último dato que entró a bronze** |
| 02:10:01 | sync del transformador con la clasificación estática |
| 02:10:25 → 02:16:58 | corrida 9366 **fallida**: 4 transformadores muertos como pods k8s |
| 02:27 | **revertido** el transformador y sincronizado |
| 02:28 → 02:32 | corrida 9368 **cancelada por el usuario**, que dejó la programada |

**Los 4 bloques que fallaron**: `sodimac_payload_transformer` (mío), más
`qanalytics_agg_nro_sap_transformer`, `qanalytics_cumplimiento_sap_transformer` y
`qanalytics_agg_iansa_transformer` — **los tres últimos NO se tocaron**. Todos murieron con
`BackoffLimitExceeded`, exit 1, **sin traceback de Python**. Los scrapers y procesadores sí
completaron. El archivo remoto del transformador se verificó íntegro y válido con `block_get`.

**Qué NO se sabe**: si la causa fue el cambio del transformador o el cluster. La correlación temporal
es incómoda (la corrida buena y la mala sólo se diferencian por mi sync) pero mi archivo no puede
explicar los otros tres — cada bloque carga sólo el suyo.

**RESUELTO — ES EL CLUSTER, NO EL CÓDIGO.** La corrida 9371 (02:46 → 02:52 UTC) se lanzó **con el
transformador ya revertido** y volvió a fallar: murió `qanalytics_agg_iansa_transformer`, un bloque
que nunca se tocó, con la misma firma (`exit_code=1, reason=Error`, sin traceback). El de sodimac ni
siquiera arrancó. **El cambio del transformador queda exonerado.**

Los tres bloques que acompañaron la primera falla llevaban sin tocarse desde el 16 de mayo
(`qanalytics_agg_nro_sap`, `qanalytics_cumplimiento_sap`) y el 7 de agosto (`agg_iansa`).

Patrón en las dos corridas fallidas: **los transformadores arrancan casi simultáneos** (dentro de
2-7 segundos) porque los scrapers terminan juntos. En la corrida exitosa 9362 arrancaron
escalonados por más de un minuto. Hipótesis: el cluster no puede levantar varios pods a la vez.

**NO HAY ACCESO A `kubectl`.** El cluster es **Mage Cloud** (`https://cluster.mage.ai/mageai-20874-
development`), infraestructura administrada por Mage, no el GCP del proyecto — la API de Kubernetes
Engine está deshabilitada en `webcarga-dev-493220`. El error real del pod sólo se ve desde la UI de
Mage o pidiéndolo a su soporte, con los nombres de los jobs
(`mageai-20874-development-job-block-287571` y los de la corrida 9366) y la hora.

**Pendiente al retomar**: reaplicar el transformador desde
`docs/sodimac_payload_transformer_con_fix_pendiente.py` cuando el cluster esté sano, y verificar las
tres cosas de una: CSV de ~46 filas en vez de 320, `ESTADO` presente en los 41 viajes, y los tramos
completos.

**El fix del transformador está guardado íntegro** en
`scratchpad/transformer_con_fix.py` de la sesión. El del scraper (#5) **sigue desplegado y no se
tocó**: los scrapers completaron bien en la corrida fallida, así que no está implicado. Y **no llegó
a verificarse en producción**: la revisión se activó 35 s después del último CSV, así que ningún
archivo se generó todavía con el dedupe.

#### El modelo de la industria, validado contra documentación

Se verificó contra las APIs reales, no de memoria:

- **project44**: array `shipmentStops` con `stopType` (**`ORIGIN`/`DESTINATION`**, el mismo
  vocabulario que ya usa `app.trip_stops`) y `stopNumber`. **El origen y el destino NO son campos
  escalares del envío** — se identifican dentro del array por su `stopType`.
- **Oracle OTM**: acepta órdenes con más de un pickup y más de un delivery; el `stop sequence` es un
  entero que define el orden, con huecos permitidos (10, 20, 30).

Conclusión para el #6: `app.trip_stops` **ya tiene la forma correcta**. No hay que rediseñar el
modelo, hay que dejar de aplanar antes de llegar a él — `int_tms_trips_conformed.origin_location_name`
es un escalar donde la industria deriva "la primera parada de retiro". Los destinos ya sobreviven;
es el origen el que colapsa. Eso baja bastante el costo estimado del #6.

**El test `assert_trip_stops_at_most_one_origin_per_trip` afirma un invariante que NO se cumple**
para viajes de varias patas. Se deja porque marca pérdida real de información, pero hay que
revisarlo al resolver el #6.
- **El borrado no se registra en ninguna parte.** El snapshot declara `invalidate_hard_deletes=True`
  y nunca se disparó: Sodimac tiene 396 viajes y 396 versiones vigentes. La causa es que
  `bronze.tms_trips` es un UPSERT puro que nunca resta. Y no se puede tapar con frescura porque
  `is_live_tracked_source` excluye a Sodimac a propósito.
- **La señal sí existe y no hace falta ir a GCS**: `bronze.tms_trips.file_name` guarda qué corrida
  reportó cada viaje por última vez. Acotado a los últimos 11 días, 11 de 20 viajes de Sodimac están
  ausentes de la última corrida — el orden de magnitud que describe Pablo. Falta el criterio de
  negocio (ausente de cuántas corridas, dentro de qué ventana) → **GitHub issue #3, redactado en
  `scratchpad/issue3.md`, PENDIENTE DE CREAR: `gh issue create` lo bloqueó el clasificador dos veces.**

#### `dbt test`: escrito, sin sincronizar

Se descubrió que **ningún pipeline corre tests**: 7 bloques `run` y 2 `snapshot`, cero `test`. Los
14 tests del proyecto —incluido `assert_trip_stops_at_most_one_origin_per_trip`, que declara
exactamente el invariante que Sodimac viola— están escritos y muertos desde julio.

Evaluados a mano contra producción: **13 verdes, 1 rojo** (el del origen, 3 viajes). Cambios listos
en `.mage-agent/local_sync`, `sync_status` limpio con 0 conflictos, **pero `sync_local_to_remote`
devolvió 503 dos veces — el cluster de Mage está caído, no es el token**:

- `dbt/tms/tests/assert_trip_stops_at_most_one_origin_per_trip.sql` — `severity='error'`,
  `warn_if='>0'`, `error_if='>3'`. Congela el pasivo conocido y **corta el pipeline si aparece un
  cuarto**. Cuando se arregle el `stop_id`, `error_if` baja a `'>0'`.
- `dbts/app_trips_tests.yaml` — `--select trips trip_stops stg_qanalytics_trips`.
- `pipelines/batch_tms_monitor_trips/metadata.yaml` — bloque `app_trips_tests` (`command: test`)
  colgando de `app_trips_update`. YAML validado, DAG verificado: 35 bloques.

**Sincronizado y VERIFICADO CORRIENDO EN PRODUCCIÓN** (pipeline run 9362, 19/08 01:20-01:30):

```
Found 12 models, 2 snapshots, 48 data tests, 6 sources, 550 macros
4 of 19 WARN 3 assert_trip_stops_at_most_one_origin_per_trip ... [WARN 3 in 1.21s]
```

19 tests seleccionados (más que los 14 contados a mano: `stg_qanalytics_trips` tiene sus propios
tests de columna en `silver/schema.yml`), el del origen avisó con 3, **y no cortó**: bloque en
`completed`, 35 bloques, 0 fallidos. El umbral hizo lo suyo — un cuarto viaje pondría el bloque en
rojo. El log se trunca en "5 of 19" (limitación conocida de mage-agent), pero no hubo ERROR: dbt
sale con código distinto de cero ante un test en error y eso habría fallado el bloque.

`run_block` volvió a dar `NoResultFound` (5ª reproducción) — hay que correr el pipeline entero.

Deuda menor detectada: dbt 1.8 avisa que el config `tests` del `schema.yml` se renombró a
`data_tests`. No rompe nada hoy.

Issue **#3 creado**: https://github.com/fsotosa-ops/webcarga/issues/3

#### La señal "El TMS dejó de reportarlo" (alerta nueva del Monitor)

El hallazgo que la hizo barata: **`app.trips.status_reported_at` es el instante del archivo que
reportó ese viaje por última vez** — calza exacto con `file_generated_at` de bronze en 8/8 filas de
Sodimac. Entonces `max(status_reported_at)` por fuente es su última corrida, y un viaje que quedó
atrás es un viaje que esa TMS tuvo oportunidad de traer y no trajo. **Sin tocar el pipeline, sin
leer bronze, sin columna nueva.**

No es la señal `stale` que ya existía: aquélla compara contra `now()` y se enciende igual cuando el
caído es nuestro scraper; ésta compara contra la última corrida de la propia TMS. Y `stale` no
aplica a Sodimac por diseño (`is_live_tracked_source`), que es justo el TMS que borra viajes.

- Migración `20260819100000_monitor_alert_rules_tms_dropped.sql` — `tms_dropped_hours`, **aplicada**.
  Umbral **3 h**, elegido por el usuario. Editable en Configuración → Umbrales: por eso el issue #3
  dejó de bloquear — se despliega el mecanismo, operaciones pone el número sin desplegar.
- Backend: `_tms_dropped` + `_load_tms_dropped_context` en `trips.py`. El booleano viaja resuelto en
  el Trip (mismo patrón que `temp_status`) en vez de arrastrar la última corrida por cinco firmas de
  `kpis.ts`. `/meta` expone `last_run_at` por TMS.
- Frontend: `KpiId` `tms_dropped` + su def en `alertSignals.ts` (10 señales), fila en Umbrales, y
  **fijada de fábrica** en `usePinnedAlertSignals` — dejarla sólo dentro del popover mantendría
  invisible justo la condición que nunca se vio. Sólo afecta a quien nunca tocó el pin.

**La etiqueta se llama "Ya no está en el TMS", SIN el umbral, y es una decisión de diseño, no un
descuido.** Salió primero como "El TMS dejó de reportarlo > 3h" y el usuario la rechazó: un badge
con horas la disfraza de alerta de grado, como "Detenido en local" o "Sin actualización del TMS",
donde el número significa algo y el viaje va cruzando el umbral. Acá **el fenómeno es binario** —lo
dicen los datos: atraso mínimo real 1 día 11 h, y 3 h / 12 h / 24 h marcan los mismos viajes— así
que el umbral es sólo una protección contra el intervalo entre corridas y mostrarlo describe el
mecanismo en vez del evento. Se eligió el texto que afirma sólo lo observado ("ya no está") y no la
causa ("eliminado"), porque quién lo sacó es precisamente lo que falta definir en el issue #3. Hay
un test que fija que `stale` lleva su umbral y `tms_dropped` no, para que nadie los empareje por
simetría.

**Medido en vivo, y corrige lo que estimé antes**: el umbral casi no discrimina. El atraso mínimo
real es **1 día 11 h** y el máximo 101 días — o sea la ausencia es prácticamente binaria (o está en
la corrida vigente o se fue del portal), y 3 h, 12 h o 24 h marcan los mismos 54 viajes. En la
ventana reciente son **2-3 por día**, todos aún activos, en las tres TMS; los 54 son la cola
histórica y sólo aparecen si se mira hacia atrás. 34 de esos 54 ya están inactivos y son la misma
población que "Abandonados" del Cierre.

Los tests de `/meta` de `test_trip_unassigned_reasons.py` **se rompieron** al agregar una consulta:
usaban `side_effect` posicional e índices fijos de `call_args_list`. Se pasaron a despachar por
fragmento del SQL (`meta_fetch`/`consulta_con`), que era la fragilidad real.

### 2026-08-18 (cont.) — Ronda 125: el paso "Viajes" del Cierre, ejecutado con subagentes

**Plan de 9 tareas ejecutado entero** (`docs/superpowers/plans/2026-08-18-cierre-paso-viajes.md`),
16 commits, un implementador y un revisor por tarea, más una revisión final de la rama completa.
**Falta sólo la Task 9**, el click-through, que está bloqueado por credenciales.

#### Qué existe ahora que antes no

- **Dominio `TRIP_UNASSIGNED_REASON`** con los 4 motivos de negocio (No tenemos camión · No tenemos
  proveedor · No da por tarifa · El mandante lo declinó), gestionable desde Configuración.
- **`app/services/cierre_viajes.py`** — los 4 grupos con UNA sola definición, y
  `GET /api/v1/trips/cierre-viajes`.
- **`PATCH /trips/bulk-close` exige motivo**, valida su dominio, escribe a `public.audit_log` en la
  misma transacción que el UPDATE, y **no toca el `trip_status` del TMS**.
- **`app.daily_closures.total_trips`** — el conteo al firmar, y el delta "posterior al cierre".
- **Pestaña "Viajes"** en el Centro de Cierre y **filtro "No asignado por WebCarga"** en el historial.

#### Los dos defectos que sólo vio la revisión de la rama completa

Cada tarea pasó su revisión individual. El conjunto tenía dos fallas críticas, **las dos de diseño
del plan**, y las dos con el mismo síntoma: *se puede desplegar sin romper nada y sin servir para nada*.

1. **La acción principal nunca se veía terminada.** Cerrar un viaje escribe `is_active=false`, y el
   grupo "Abandonados por el TMS" se define como `NOT is_active` + más de 7 días sin novedad. Medido:
   **13 de los 17 viajes de Rezago ya superan los 7 días**. Al declarar "No asignado por WebCarga",
   el viaje desaparecía de Rezago y **reaparecía en el acto** en Abandonados —grupo de sólo lectura—
   etiquetado como abandonado por el TMS cuando lo había cerrado WebCarga. Corregido: `abandonado`
   excluye lo ya declarado.
2. **El botón "Verlos" llevaba a una pantalla donde los viajes anunciados no estaban.** Medido: 47
   viajes del 14/08, **0 visibles** en la pestaña. El conteo (¿la firma sigue cubriendo todo?) y la
   pestaña (¿qué necesita decisión?) son cosas distintas y el plan las confundió. El Monitor **no
   tiene** filtro por URL, así que se quitó el botón en vez de inventar un mecanismo. **Queda como
   deuda declarada**: el aviso informa pero no lleva a ningún lado.

Y un tercero, importante: **`app.trips.unassigned_reason_id` tenía dos escritores con vocabularios
distintos** — `GestionPanel` escribe `DRIVER_REASON` ("Médico", "Vacaciones") y el bulk-close nuevo
escribe `TRIP_UNASSIGNED_REASON`, sin que la FK ni nadie validara el dominio. El filtro le habría
mostrado a Pablo, bajo "los que nos ofrecieron y no asignamos", viajes cuyo motivo es "Vacaciones".
Había 0 filas, así que se validó antes de que naciera el problema.

#### Lo que el proceso encontró de mis propios planes

Los revisores no encontraron casi nada en la implementación; encontraron **defectos en el plan**:
los colores que puse no pertenecían a la paleta cerrada del módulo · dos de los tests que redacté no
probaban nada (uno tautológico por construcción, otro atado a datos de producción) · el número de
abandonados que documenté (46) estaba mal medido: son **34**, porque conté sin el `NOT is_active` y
dupliqué los Sodimac que ya están en rezago · `planning_date.isoformat()` habría reventado con el
viaje sin fecha · el nombre `get_daily_closure` no existía · y afirmé que el Monitor usaba
`bulkClose` cuando no lo usaba nadie.

#### Un patrón de infraestructura, para la próxima

**Tres subagentes se colgaron** lanzando la suite completa en segundo plano y quedándose a esperarla.
El disparador era pedirles que la corrieran. Se resolvió sacándoles esa responsabilidad: corren sólo
los tests acotados y **las suites completas las corre el coordinador entre tareas** — lo que además
atrapó dos fallas que las corridas acotadas no veían.

#### Estado de los trinquetes del sistema visual — importante para quien siga

**Color 1779/1780 · tipografía 279/279 · `<h1>` 9/9.** Dos de los tres en margen cero: el próximo
color crudo o tamaño por debajo de 11px que alguien agregue **en cualquier archivo del repo** rompe
CI, con un fallo que no va a tener nada que ver con lo que esa persona estaba haciendo. La próxima
tarea de frontend debería empezar bajándolos.

#### Verificación

Backend **804 tests** · frontend **1098 tests** · `tsc` y `npm run build` limpios. Las 3 migraciones
aplicadas a producción son aditivas y verificadas. En producción: 4 motivos sembrados, columna
`total_trips` creada, **0 viajes con motivo y 0 días firmados** — la infraestructura está puesta y
sin estrenar, que es lo esperado.

#### Próximo paso exacto

0. [ ] **Task 9: el click-through.** Bloqueado por credenciales — el servidor de dev redirige a
   `/login` y `.env.local` sólo tiene un placeholder. Hay que desplegar a dev y tener un usuario.
   Es lo único que puede verificar que un viaje cerrado conserva su `trip_status` y que
   `resolve_trip_fleet()` no lo pisa.
1. [ ] **Decidir qué hacer con el aviso "posterior al cierre" sin acción** — o se agrega filtro por
   URL al Monitor, o el aviso se queda informando nada más.
2. [ ] **Bajar los tres trinquetes** antes de la próxima tarea de frontend.

---

### 2026-08-18 (cont.) — Ronda 124: identificar al conductor desde la tabla, y un agujero de RLS

**Plan de asignar conductor ejecutado (Tasks 1-6 de 7) + hallazgo de seguridad aplicado.**
Commits `589d42d1` y `deb2401d`.

#### El plan tenía cuatro supuestos falsos, y se verificaron ANTES de ejecutarlo

Están anotados en el propio plan para no rediscutirlos:

1. **No existe NINGUNA foreign key que apunte a `app.trips`** (verificado sobre `pg_constraint`).
   El test de atomicidad dependía de que un `trip_id` inexistente reventara: no revienta. Se
   reescribió contra `trip_fleet_links_driver_id_fkey`, que sí existe — y además es el error
   plausible, un id viejo en la pantalla, no un viaje inventado.
2. **Los tests de las Tasks 1 y 3 no probaban el endpoint**: insertaban por SQL y verificaban la
   fila. Habrían pasado idénticos antes y después del fix.
3. **`@testing-library/user-event` no es dependencia** del proyecto, que usa `fireEvent`.
4. **El alta exige RUT** (`POST /drivers`) y QAnalytics nunca lo reporta. Decisión del usuario:
   **se pide el RUT en el popover**; `tax_id` sigue obligatorio porque es la clave con la que el
   resolvedor identifica por RUT.

#### La corrección que más cambió el diseño: la similitud era la métrica equivocada

Medido sobre los **7 viajes de identidad segura** (`driver_match_rule='tms_rut'`, donde el TMS mandó
el RUT y la identidad no está en discusión):

| tokens roster | tokens TMS | **en común** | similitud | casos |
|---|---|---|---|---|
| 4 | 2 | **2 = todos** | 0,400 | 3 |
| 4 | 3 | **3 = todos** | 0,700 | 2 |
| 4 | 4 | **4 = todos** | 1,000 | 2 |

En los 7, **todas las palabras del TMS están dentro del nombre del roster**. La similitud baja sólo
porque el TMS reporta MENOS palabras, nunca palabras distintas. **Un umbral en 0,5 habría escondido
3 de esos 7.** La similitud castiga igual a un nombre incompleto que a uno ajeno.

Se ordena por **CONTENCIÓN**, bidireccional igual que el CTE `by_partial` de
`app.resolve_trip_fleet()`. El orden invertido y los acentos ya dan **1,000** porque
`public.name_tokens()` normaliza y ordena (fix de la R122) — la pregunta del usuario sobre "apellidos
invertidos o cualquier combinatoria" está resuelta en la capa de abajo, no acá.

Aplicado a las **28 personas** sin identificar: **19 sin candidato** (alta directa), **7 con uno
solo**, **2 ambiguas** — y esas 2 son el conductor duplicado del roster, que sigue pendiente.

Y el viaje que originó todo, el **2032999** («SUAREZ LOPEZ EFRAIN EDUARDO»): esa persona **no existe
en `public.drivers`** y por contención da **0 candidatos**. Se resuelve dando de alta, no eligiendo —
el mejor "parecido" es otra persona, con 0,22.

#### Dos decisiones de diseño que el plan no cubría

- **El lote CONSERVA la empresa y el tracto ya resueltos.** Los vínculos `auto` traen empresa en
  1.457 de 1.521 filas y tracto en las 1.521; como el `manual` es **terminal**, pisarlos con NULL
  los perdería para siempre. Se cambiaría la respuesta a una pregunta contestando otra.
- **Los ids del lote los da el backend, no un conteo del cliente.** El popover ofrece "aplicar a sus
  N viajes" y varios no están en pantalla: contarlos con lo que la tabla tiene cargado sería
  prometer un alcance y aplicar otro.

#### Deuda propia encontrada y corregida en el camino (el usuario preguntó dos veces)

`nombreLegible` salió de `TripTable` a `lib/utils/nombres.ts` — importar una utilidad DESDE un
componente iba a crear un **ciclo** en cuanto la tabla montara la celda · el tipo de la API salió de
un componente a `lib/types.ts` (el mismo error, cometido diez minutos después) · la bitácora del
lote pasó de un INSERT por viaje a **uno solo** · el endpoint de candidatos era **más pobre que el
resolvedor** (una dirección de contención en vez de dos) · `PoolDeUnaConexion` subió a `conftest` en
vez de duplicarse · y **se rompió el trinquete del sistema visual** (1780 → 1811 colores crudos):
no se subió el tope, los dos grises sin token viven ahora en `lib/ui/texto.ts`.

#### El agujero de RLS — real, y no lo abrió esta sesión

La alerta `rls_disabled_in_public` apuntaba a `document_ingest_batches`, `document_ingest_items` y
`requirement_filename_aliases`, creadas el **14-15/08** (Certificación Tramo 1).

**Por qué era real**: Supabase concede a `anon`/`authenticated` **todo el DML** sobre `public`. Lo
que neutraliza esa concesión en el resto del proyecto **no son los permisos** —`drivers` y
`compliance_records` también los tienen— sino **tener RLS activo sin políticas**. Estas tres se
saltaron ese paso, así que con la clave `anon` (que viaja en el bundle por diseño) se podía SELECT,
INSERT, UPDATE, DELETE y **TRUNCATE** vía PostgREST.

Aplicado en producción. No rompe nada: el frontend no las consulta directo y la API entra con
asyncpg como **dueña de la base**, que no está sujeta a RLS. 115 tests de esa ruta pasan y **ya no
queda ningún lint de nivel ERROR**.

#### Verificación

786 tests de backend (14 de integración contra Postgres real, en transacción revertida) · 1090 de
frontend · `tsc` y `npm run build` limpios.

**Falta la Task 7**: desplegar a dev y hacer el click-through con el 2032999 — que ejercita el
camino de **alta**, no el de elegir candidato.

---

### 2026-08-18 — Ronda 123: el Cierre auditado, y las tres pantallas vuelven a contar lo mismo

**Auditoría del Cierre + Bloque 0 cerrado.** Todo verificado contra el código real y contra
producción del día, no contra este archivo — que es historia de incidentes, no estado.

#### El chequeo: qué faltaba de verdad

`app.daily_closures` **sigue en 0 filas**. Y no es por falta de dato: el pipeline corrió a las 13:08,
con 15 viajes de hoy y 32 de ayer. Es la interfaz y la aritmética.

| Bloque del spec del Cierre | Estado real |
|---|---|
| **0 · Resolución de flota** | Aplicado en la R122, pero **los 4 defectos de conteo seguían los 4 vivos** → cerrados en esta ronda |
| **1 · Recorrido de 4 pasos** | No existe: 3 pestañas planas, sin riel ni contador por paso |
| **2 · Paso "Viajes"** | **Nada.** Ni los 4 grupos, ni el motivo sobre el viaje, ni "día reabierto" |
| **3 · Reportería** | Parcial. `app.trip_statuses` **no tiene atributo de facturación** (columnas: id, label, bg_color, text_color, group_id, sort_order, active) |
| **4 · Zona / gestión / tipo de vehículo** | Zona solo en el reporte. Tipo de vehículo en lote: no existe (`TripTable` no tiene selección múltiple) |
| **§8bis · La interfaz** | **Destrabado**: los tokens y `EncabezadoDePagina`/`Cifra`/`Estado` ya existen. El Cierre es el único módulo que no los usa (salvo `Estado` en `FlotaDelDiaSection`) |

Hallazgos sueltos: `CloseDayDialog.tsx` es **código muerto** (317 líneas con tests, nadie lo
importa); el botón del Monitor **no lleva contador**; no hay nav propio en el Sidebar.

Los 4 grupos del paso "Viajes" que aún no existe, medidos hoy: **Hoy 2 · Rezago 17 · En curso 6 ·
Abandonados por el TMS 46** (23 qanalytics, 21 sodimac, 1 wingsuite, 1 manual). Los abandonados
**más que duplicaron** los 21 que midió el spec el 16/08.

#### Los 4 defectos de conteo — cerrados, cada uno medido antes de tocarlo

1. **`pre_cierre.py` miraba un solo día** en sus 5 consultas mientras el resto del Cierre ya era
   multi-día — y corre DENTRO de `_recompute()`, justo antes del cálculo que sí lo es. Delta medido
   sobre el 14/08 antes de aplicar: patentes 33 → 35, RUT 1 → 1, cliente+patente 33 → 35,
   onboarding 0 → 0, sin tipo 1 → 1. Y **0 patentes pierden señal** en `_single_value`: el ensanche
   no vuelve más conservador al Tipo A, le suma 2 señales usables.
2. **`driver_roster.py` no filtraba al conductor** por `operational_status` mientras
   `fleet_driver_gap.py` sí. Corregido. **Hoy no cambia ningún número** — los 87 conductores están
   ACTIVE, el roster sigue en 44. Es defecto latente, no discrepancia viva; se dice así en el código.
3. **Vocabulario por etiqueta visible → por `code`** en 5 sitios (`driver_roster`,
   `fleet_driver_gap`, `equipment_closures`, `trips`, `status_report`). Equivalencia verificada
   antes del cambio: 43/43 Tractoreo y 73/73 Equipo Completo, 0 filas sin código. Renombrar
   "Tractoreo" desde Configuración ya no vacía el roster en silencio.
4. **`daily_closures.py` no excluía Sodimac** mientras las otras tres pantallas sí.
   **El número que abrió el caso**: para el 14/08 su universo era de **63 viajes contra 48** de las
   otras dos. Ahora comparten base de **49**, y la única diferencia que queda es el requisito de
   tracto resuelto, que es intencional. Y **ningún conductor cambia de estado** (27 antes y después):
   alinea la aritmética sin mover el cierre de nadie.

#### La decisión de diseño que se tomó al medir, y va contra la letra del plan

El plan pedía la exclusión de Sodimac en 4 líneas de `daily_closures` y también en `pre_cierre`.
Se aplicó **solo en las 2 que definen el universo de conteo** (`day_trips` y el lateral
`mismatch_trip`), no en los 2 laterales de `clients`: esos agregan **qué clientes atendió el
conductor, para mostrarlos** — excluir ahí escondería un cliente real, que no es el defecto.

Y en `pre_cierre` **no se agregó**, deliberadamente: sería código muerto. Sus 5 consultas exigen
patente o RUT, y de los **54 viajes Sodimac que existen en `app.trips`, 0 traen patente y 0 traen
RUT**. Esa fuente ya está excluida por construcción. Queda un test que explica por qué no hace
falta, para que nadie la agregue "por consistencia".

#### Lo que esta ronda NO arregló, y hay que decirlo

De los 4 fixes, **2 son de causa raíz y 2 no**. El `label` → `code` elimina la clase de bug (el
identificador era la etiqueta editable) y el filtro de conductor de baja era un predicado faltante.

Pero los otros dos —el criterio multi-día y la exclusión de Sodimac— **son correctos y a la vez
replican la duplicación que es la causa raíz real**. Medido después de aplicarlos:

| Predicado escrito a mano | Veces | Archivos |
|---|---|---|
| Criterio multi-día | **14** | daily_closures, equipment_closures, status_report, trips, pre_cierre |
| `source_system != 'sodimac'` | **9** | daily_closures, equipment_closures, status_report, trips |

**"El universo de viajes del día" no tiene una sola definición: se copia y pega.** Por eso derivó,
y esa deriva es exactamente el bug que esta ronda vino a corregir. El repo ya resolvió esta misma
clase dos veces —extrayendo `app.v_trip_fleet_resolution` y `TRACTOREO_ROSTER_CTE`, con el
comentario "la duplicación en 4 lugares fue justo la causa del bug"— y acá se siguió el patrón
viejo en vez del bueno.

**La corrección de fondo**: una sola definición. O una función `app.trips_of_day(p_date date)`
—sirve con `$1` y también en los laterales correlacionados vía `LATERAL`, que es lo que obliga a
tener dos redacciones distintas hoy— o una constante compartida al estilo `TRACTOREO_ROSTER_CTE`.
No se hizo por alcance: toca `trips.py` en 4 puntos más. **Es el ítem que cierra el tema de verdad.**

#### Decisiones de negocio tomadas

1. **Motivos de viaje → dominio nuevo `TRIP_UNASSIGNED_REASON`** (hoy 0 semillas). Los 16 de
   `DRIVER_REASON` responden otra pregunta. Se ejecuta con el Bloque 2.
2. **El mapeo de estados de Sodimac deja de estar bloqueado por un tercero.** Los estados vienen de
   los TMS y el catálogo **debe absorber dinámicamente** los que aparezcan sin mapear.
   **Evidencia de que el mecanismo hace falta**: hay un viaje de Wingsuite con `trip_status =
   'Cancelado'` mientras el catálogo tiene el id `'CANCELADO'` — mismo estado, distinta caja, y el
   viaje **se cae de todo JOIN con `app.trip_statuses` en silencio**. Es 1 viaje, pero el mecanismo
   de pérdida está activo. Vive en el pipeline, no se tocó acá.
3. **Umbral de "abandonado por el TMS" (7 días): sigue sin confirmar** con operaciones.

#### Verificación — qué se corrió y qué no

- **Suite completa del backend: 770 pasan.** Se actualizaron 5 guardarraíles que asertaban el texto
  `wot.label = 'Tractoreo'` (su intención sobrevive, cambió el mecanismo) y se agregaron 6 nuevos:
  criterio multi-día en las 5 consultas de `pre_cierre`, exclusión de Sodimac en las 2 de
  `daily_closures`, filtro de conductor de baja, y lectura por código en `status_report`.
- **El SQL real validado contra Postgres de producción**: las 6 constantes (`_RECOMPUTE_SQL` de
  daily y de equipment, `_DETAIL_SQL`, `_REPORT_SQL`, `_FLEET_DRIVER_GAP_SQL`, `_ROSTER_SQL`)
  parsean, resuelven columnas y **tipan sus parámetros** vía `prepare()` — que no ejecuta, así que
  las de escritura se validaron sin escribir nada. Las de lectura se ejecutaron: `_DETAIL_SQL`
  devuelve las 44 filas de la cuadratura (12 asignados / 32 no), `_ROSTER_SQL` 79 tractos
  (43 TRACTOREO · 35 EQUIPO_COMPLETO · 1 sin código).
  Los mocks no probaban nada de esto: asertan por secuencia de `side_effect`.
- **NO se corrió el click-through en vivo del frontend.** Riesgo bajo y acotado: no cambió ningún
  contrato de API — el único campo renombrado (`webcarga_operation_type_label` →
  `..._code`) se usaba en un solo lugar interno y no aparece en el frontend. Queda pendiente igual.
- **Comiteado** en `c81d0e28` (ver Ronda 124 para lo que siguió).

#### Próximo paso exacto

0. [ ] **Click-through en vivo del Cierre** con el frontend de dev contra la API modificada:
   confirmar que las 3 pestañas muestran cifras coherentes entre sí. Es lo único de la Ronda 123
   que quedó sin hacer.
1. [ ] **Ejecutar el plan de asignar conductor desde el Monitor** (7 tareas). Verificado que el bug
   de origen sigue: `POST /trips/{id}/fleet-link` exige `carrier_id` y recibe `body: dict` **sin
   modelo Pydantic** (`trips.py:2160-2175`), o sea el 422 es un `raise` a mano.
2. [ ] **Plan 3 — el recorrido del Cierre** (Bloques 1, 2, 4 y §8bis). Ahora sí sobre aritmética que
   cuadra. Incluye sembrar `TRIP_UNASSIGNED_REASON` y adoptar los componentes del sistema visual.
2. [ ] **Una sola definición del "universo de viajes del día"** — `app.trips_of_day(date)` o una
   constante compartida. Hoy el criterio multi-día está escrito a mano **14 veces** y la exclusión
   de Sodimac **9**. Es la causa raíz que esta ronda alineó pero no eliminó.
3. [ ] **Absorción dinámica de estados sin mapear** en el catálogo (decisión 2 de arriba).
4. [ ] **Borrar `CloseDayDialog.tsx` y sus tests** — código muerto confirmado.

---

### 2026-08-17 (cont.) — Ronda 122: el modelo de resolución de flota, y el denominador deja de mentir

**Bloque 0 completo, aplicado y verificado en producción.** Spec:
`docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md`.

#### El defecto de raíz, que no era ninguno de los síntomas

`app.v_trip_fleet_resolution` decidía quién manejó cada viaje **en cada lectura**, con un COALESCE de
tres niveles sobre comparación de strings. O sea: corregir mañana la tipografía del nombre de un
conductor **cambia quién aparece en un día que operaciones cerró ayer**. Un cierre es una afirmación
sobre un instante; si se recalcula, no afirma nada. Para un módulo de cierre eso es descalificante.

Todo lo demás —el 34% de cobertura, el padrón que envejece, la patente con tabulador— eran efectos.

#### Las cuatro capas

```
bronze (crudo) → silver (conformado) → public (maestro) → app (operación)

1 · IDENTIDAD   public.canonical_rut / canonical_plate + trigger + CHECK
2 · DIMENSIÓN   public.vehicle_driver_assignments  ← silver.int_habitual_driver_by_tractor
3 · HECHO       app.trip_fleet_links               ← app.resolve_trip_fleet(), por TRIGGER
4 · LECTURA     app.v_trip_fleet_resolution        — lee la 3, no resuelve
```

**No se creó ninguna tabla.** `trip_fleet_links` ya tenía `UNIQUE(trip_id)`, FK a
drivers/carriers/assets y `link_source`; estaba congelada desde el backfill del 18/07. Sólo faltaba
quién la escribiera. La vista pasó de **7 JOIN a 2** con la misma firma, así que los 5 routers y 18
lugares que la consumen no cambiaron una línea.

**Dónde vive cada cosa se deriva de la dirección de dependencias**, no del gusto: las funciones de
identidad restringen tablas de `public`, así que van en `public` (ponerlas en `app` haría que la base
dependa de lo que alimenta); el padrón es conformación de bronze, así que va en `silver`.
Identificadores en inglés, como el resto de la base.

#### El hallazgo que cambió el diseño

El 91% de acierto del padrón **escondía dos poblaciones opuestas**:

| Antigüedad de la evidencia | Casos | Acierto |
|---|---|---|
| Menos de 3 meses | 673 | **94,2%** |
| Entre 3 y 6 meses | 25 | **4,0%** |

Una entrada vieja no es una conjetura peor: es un nombre casi seguro equivocado, y en el Cierre un
nombre plausible se confirma solo. De ahí el corte de frescura de 90 días — **419 entradas
descartadas**. No resolver es una respuesta: la celda vacía hace la pregunta, la mal llenada la
esconde.

#### Cinco defectos propios que encontraron los tests, no la lectura

1. **Un CHECK con `=` sobre una función que devuelve NULL se considera CUMPLIDO.** El candado
   aceptaba exactamente los valores que venía a rechazar. Va `IS NOT DISTINCT FROM`.
2. **`trim()` no saca tabuladores** — sólo espacios. `upper(trim())` no es normalización, y había una
   patente `GBVC90` + TAB invisible para cualquier join.
3. **`pg_trigger_depth()` no sirve de guardia de reentrada acá**: vale 1 tanto cuando dispara el
   merge de dbt como cuando dispara el `UPDATE` del propio resolvedor. Va bandera de transacción.
4. **`source` y `is_manual_override` tenían defaults contradictorios**: cualquier inserción sin
   especificar violaba el CHECK. Se quitó el default — no hay dato sin procedencia.
5. **`assets.py` ponía `is_manual_override=true` sin tocar `source` en el `ON CONFLICT`**: reasignar
   a mano un vehículo del padrón habría reventado.

#### Resultado medido — el número que abrió el caso

| Día | Viajes | Tractos | Conductores | Resuelto |
|---|---|---|---|---|
| 14/08 **antes** | 47 | 29 | **12** | 34% |
| 14/08 **después** | 47 | 32 | **33** | **100%** |

Últimos días al 93-100%. **1.541 filas = 1.541 viajes distintos**: sin duplicación.
Reparto final: `padron` 1.463 · `tms_rut` 7 · `nombre` **0** · sin conductor 62 · `manual` 9 intactas.
El match débil de nombre —el del 34%— dejó de dispararse por completo.

#### Las 13 altas (datos, no esquema — por eso van acá y no en una migración)

**6 tractos y 7 conductores** que ruedan hace 30 días y no estaban en los maestros. Nombres en
`initcap`, que es la convención de las 80 filas existentes.

**Costo declarado: +132 registros de Certificación** (4.990 → 5.122). No es ruido: son vehículos y
personas que efectivamente trabajan y que Certificación no veía. La carga documental es de negocio
(ver [[project_carga_documental_es_de_negocio]]).

Quedan fuera 1 tracto y 3 conductores del padrón fresco que **no ruedan** — no se dan de alta por lo
mismo que no se dieron de alta los ~700 históricos: dispararía requisitos de gente que no trabaja acá.

#### Mage — hecho

Los dos triggers **se perdían con un `dbt --full-refresh`**. Ya están en el `post_hook` de
`dbt/tms/models/app/trips.sql`, verificado bajando copia limpia del remoto. Se agregó una tercera
línea que resuelve los viajes sin vínculo: en un full-refresh el `CTAS` inserta las filas **antes**
de que el post_hook recree el trigger, así que esas filas nunca lo disparan.

**Corrección de una memoria propia**: lo que el clasificador bloquea es `block_update`, no el flujo
de sync. `sync_local_to_remote` pasó a la primera. No volver a decir "está bloqueado" sin intentarlo.

#### Auditoría: cuántas definiciones de identidad quedan

2 vivas —`public.canonical_rut` y `document_matcher.py:rut_dv()`— y **coinciden** en los 4 casos de
prueba (son runtimes distintos, no copias). 1 borrada (`app.normalize_rut`, código muerto con nombre
que mentía). 4 muertas en `dbt/transporters/macros/`, cuyo proyecto apunta a tablas que no existen:
se borran **con el proyecto**, no sueltas.

#### La corrección que encontró el usuario mirando el Monitor (viajes 2032999 y 2031752)

**La precedencia estaba invertida.** El padrón quedaba ENCIMA del nombre del TMS, o sea la
inferencia sobre la evidencia. El TMS dice quién manejó ESE viaje; el padrón dice quién maneja
habitualmente ese tracto. Medido: de 1.002 viajes resueltos por padrón, **46 mostraban una persona
sin nada en común con la reportada**, y el padrón **nunca** estaba llenando un hueco — siempre pisaba
al TMS.

**La causa raíz de que el nombre fallara no era suciedad: era el ORDEN.** El roster guarda
"Nombre Apellido" y el TMS reporta "APELLIDO NOMBRE". Por eso la igualdad exacta cubría 34%.
Comparando el **conjunto** de palabras sube a 59%; aceptando subconjuntos de ≥3 palabras llega a
**79%, con cero ambigüedad medida**.

Precedencia corregida: `manual > tms_rut > nombre > nombre_parcial > padron`, y el padrón **sólo si
el TMS calló**. La identificación baja de ~100% a 60-88% por día, y **esa caída es la corrección**:
el 100% incluía respuestas que contradecían al TMS.

**El padrón resultó casi innecesario** — pasó a resolver 1 viaje. Todo ese aparato estaba
compensando un bug de orden de nombres. Sigue sirviendo como respaldo cuando el TMS calla y como
fuente de la sugerencia, pero no es lo que sostiene la resolución.

**Y la asimetría con la empresa es correcta, no una inconsistencia:** el TMS informa «WEBCARGA SPA»
en **933 de ~1.050 viajes**, en cinco grafías — no sabe qué EETT operó, porque nos ve a nosotros
como el transportista. La regla no es "el TMS siempre manda", es **manda la fuente que realmente
sabe**.

#### Diseño cerrado, implementación diferida: asignar conductor desde el Monitor

**El bug de origen**: `POST /trips/{id}/fleet-link` exige `carrier_id` (422 sin él), así que **no se
puede asignar un conductor sin asignar también una empresa**. Por eso forzar el conductor en el
detalle no guardaba nada. Es también lo que obliga a que la asignación viva en el detalle.

Plan escrito y **sin ejecutar** por decisión del usuario:
`docs/superpowers/plans/2026-08-17-asignar-conductor-desde-el-monitor.md`, 7 tareas.
Los mockups aprobados quedaron en `docs/superpowers/mockups/` — **fuera de `.superpowers/`, que está
en `.gitignore`**.

Las cuatro decisiones ya tomadas (no volver a discutirlas, están argumentadas en el plan): la celda
es el control · el valor crudo siempre se ve · sin chip de color por fila, con el contador-filtro
arriba como condición dura · la casilla de alcance marcada por defecto y el número en el botón.

El dato que ordena el diseño: **27 personas explican 208 viajes** (7,7 cada una, máximo 33). La
unidad de trabajo es la persona, no el viaje.

Y por qué **no** hay emparejamiento automático por similitud: los viajes identificados por RUT
—donde la identidad es *segura*— tienen similitud de nombre de **0,40**. Un umbral alto para ser
seguro descarta personas que sí son la misma.

#### Próximo paso exacto

0. [ ] **Ejecutar el plan de asignar conductor desde el Monitor** (7 tareas). Empieza por quitar la
   exigencia de `carrier_id`, que es el bug reportado.
1. [ ] **Plan 3 — el recorrido del Cierre** (Bloques 1, 2, 4, 5). Todo diseñado en §8bis del spec del
   Cierre; falta escribir el plan y ejecutar. **Ya no hay nada bloqueado por terceros.**
1b. [ ] **Fusionar el conductor duplicado del roster** — dos filas con el mismo nombre. El resolvedor
   se niega a elegir entre las dos (correcto), pero deja esos viajes sin identificar.
2. [ ] `silver.int_habitual_driver_by_tractor` a modelo dbt. **No urgente**: sobrevive al
   full-refresh porque dbt no es su dueño. Exige agregar un bloque al DAG de la ingesta.
3. [ ] **Registro de corridas de extracción** — sigue siendo la única pieza diferible del Cierre.

---

### 2026-08-17 — Ronda 121: la decisión bloqueante, resuelta — el legacy está vivo como registro, muerto como feed

**Auditoría, sin código.** Se revisó el pipeline `legacy_drivers_transporters` en Mage y se midió la
cuadratura de los RUT contra producción. La pregunta que bloqueaba el Plan 4 **queda respondida**, y
la respuesta no era ninguna de las dos que estaban planteadas.

#### La "plataforma legacy" no es una plataforma

`raw_bd_ot_master.py` no consulta ningún sistema: descarga por Microsoft Graph el archivo
**`Teamwebcarga/Documentos compartidos/Finanzas/BD OT 2026.xlsx`**, hoja `BD OT`. Vive en
**Finanzas**, y eso explica todo lo demás.

**Está vivo**: última modificación **2026-08-12** (metadato de SharePoint, que coincide exactamente
con el `max(f_h_modificacion)` de la tabla). 165 OT creadas y 685 modificadas en agosto.

**Pero cambió de oficio**: **cero despachos en agosto**; el último `f_despacho` es **2026-07-31**, y
todas las filas de julio en adelante están en `Pendiente de pago` / `Feedback`. Dejó de ser registro
de operación y es hoy un **libro de liquidación**. Por eso la evidencia parecía contradictoria: el
archivo se edita todos los días, y aun así no sabe nada de lo que pasó ayer en ruta.

#### La cuadratura de los RUT: el dato es bueno

| Medición | Resultado |
|---|---|
| Filas con `rut_chofer` | 107.325 de 107.325 (100%) |
| Normalizan a RUT plausible (8-9 caracteres) | 105.620 (98,4%) |
| **Pasan el dígito verificador (módulo 11)** | **103.097 — 97,6%** |
| Formatos conviviendo | 55.519 con guión · 35.032 con puntos · 13.779 sin nada |

Los RUT inválidos son cola larga: por valor distinto sólo 565 de 763 son válidos, o sea la basura es
de bajo volumen y los RUT que se repiten mucho son los correctos. Firma típica de un registro real.

#### El match funciona… en julio, que es la única ventana donde ambas fuentes se solapan

`app.trips` va del 01/07 al 18/08; los despachos del legacy cortan el 31/07. Cruzando por **patente
de tracto + fecha de despacho** sobre los 985 viajes de julio:

| | Viajes |
|---|---|
| Con patente | 960 de 985 (97,5%) |
| **Resueltos a un único RUT** | **825 — 86% de los que tienen patente, 84% del total** |
| Ambiguos (más de un RUT) | **6 (0,6%)** |
| Sin match | 129 |

Contra el **34%** que logra hoy la igualdad exacta de nombre. La ambigüedad, que era el riesgo
teórico del cruce por patente, resultó ser el 0,6%.

#### Y no sirve para agosto — de ahí sale el diseño correcto

De los **528 viajes de agosto con patente, 0 cruzan por el mismo día**. Obvio: el archivo no tiene
despachos de agosto. **Pero las 528 patentes son conocidas por el legacy históricamente.**

O sea: el legacy no sirve como *feed diario*, sirve como **padrón**. En vez de cruzar por día, se
deriva una vez un registro **patente → conductor** y se resuelve contra él.

**Backtest honesto** (padrón construido SÓLO con datos anteriores al 01/07, evaluado contra la
verdad de julio): **91,0% de acierto** donde hay entrada previa, 88,9% sobre todos los casos.

**Aplicado a agosto: 528 de 528 viajes con patente resuelven — 47 patentes, 46 conductores.** La
flota real de agosto son 47 tractos, no cientos.

**Y la brecha para cerrarlo son 8 filas**: 38 de esos 46 conductores **ya están** en `public.drivers`
(que tiene 79 con `tax_id`). El legacy conoce 763 RUT distintos; el padrón operativo son decenas.

#### Bug real en el dedup de Mage

`bd_ot_master.sql` inserta filtrando con
`WHERE NOT EXISTS (select 1 from bronze.raw_bd_ot target where target.hash_id = md5(t::text))`.
Eso compara **sólo contra el destino, nunca dentro del propio lote**: si el Excel trae dos filas
idénticas en la misma carga, las dos pasan el filtro y las dos entran.

**Medido: 107.325 filas contra 103.848 `hash_id` distintos → 3.477 filas duplicadas.** No es fatal
—río abajo se deduplica por `id_envio`— pero significa que **el conteo de filas no es conteo de OT**
(98.960 OT distintas, 1,08 versiones cada una) y que recargar el archivo infla la tabla.

#### Lo que esto define para el Bloque 0

El padrón **envejece**: es exacto hoy porque se alimentó hasta el 31/07, y va a derivar a medida que
cambien los conductores. El diseño entonces no es "leer el legacy", es **sembrar con el legacy y
dejar que operaciones corrija** — que es exactamente lo que ya hace `trip_fleet_links` con
`link_source='manual'` (9 filas hoy) contra `'auto'` (423, todas del backfill del 18/07, congeladas).
La corrección humana gana, y el legacy puede morir sin llevarse el sistema.

**No hace falta que el archivo siga vivo.** Eso desbloquea el Plan 4 sin depender de Finanzas.

---

### PENDIENTES VIGENTES (revisado al cerrar la Ronda 119, 2026-08-16)

Consolidado de todo lo que queda abierto — es la lista a mirar al retomar, no hace falta rastrear
entre rondas ni abrir el archivo histórico. Ninguno bloquea el funcionamiento actual.

**El estado de `main` NO es un pendiente** (decisión del usuario, 2026-08-19): el trabajo es a nivel `dev`. No volver a listarlo como deuda.

**SIGUIENTE PASO EXACTO AL RETOMAR (Ronda 126, 2026-08-19 04:15Z)**

- [ ] **Confirmar que `app_trips_tests` quedó verde.** Es lo único sin verificar de la noche: el
   test se reescribió y se sincronizó, su consulta devuelve **0 filas** contra producción (así que
   debería pasar), pero **no se lo vio correr**. Si sigue rojo, el problema está en el archivo
   sincronizado, no en el dato. Mirar el bloque en la última corrida programada.

**Issues de GitHub abiertos** (levantados o refinados esta noche, todos con evidencia medida):
- **#3** — criterio de ausencia para detectar borrados de Sodimac. **No bloquea**: la alerta ya opera
  con 3 h configurables desde Configuración → Umbrales. Falta que Fabián y Pablo elijan el número.
- **#5** — el scraper ya deduplica y está verificado en producción (320 → 47 filas), pero **sigue
  sin saberse por qué el portal agrega filas en vez de reemplazarlas al paginar**. Necesita abrir el
  DOM con Playwright. También queda sin descartar el `_set_page_size(20)` que falla en silencio.
- **#6** — pérdida de tramos, localizada en `stg_sodimac_trips` (bronze: 18 viajes con 2 tramos;
  silver: 0). Partido en dos: multi-destino es técnico y sin bloqueos; multi-origen necesita
  definición de operaciones. **La prioridad la decide si esos 18 viajes afectan facturación.**
- **#1** (modelo de permisos/`writer`) y **#2** (contraseñas filtradas, requiere plan Pro), de antes.

**Deuda declarada de esta noche, sin issue propio:**
- [ ] Los bloques de scraper de Mage devuelven `_NO_DATA` cuando el job de extracción falla — es
  deliberado y está bien fundado (una excepción cancela en cascada a las otras TMS, incidente
  07/08), y el bloque **sí imprime** el error. Lo que falta es **distinguir "no había datos nuevos"
  de "el job falló" en algún lugar visible sin abrir logs**. Es diseño, no un arreglo rápido.
- [x] ~~Mirar en pantalla la tile "Ya no está en el TMS"~~ — **CONFIRMADA por el usuario el
  2026-08-19**: aparece en el Monitor. Conteo esperado al momento de confirmarlo: 3 viajes hoy
  (todos Sodimac) sobre 8 abiertos; 11 marcados sobre 23 abiertos en los últimos 7 días.

**Deuda técnica comprometida**
1. [ ] (hardening post-MVP/Hito 4, pedido explícito del usuario) Migrar `qanalytics_agg_nro_sap_transformer.py` (Walmart) a `TENANT_COLUMN_MAPS`, y evaluar consolidar las 5 cadenas de bloques Mage duplicadas por tenant (scraper→loader→transformer→tabla temp→insert repetidas íntegras entre Walmart e IANSA). La mitad del camino ya está hecha: la URL de extracción y el POST/polling salieron a `utils/extraction_client.py`, y el mapeo de columnas a `utils/qanalytics_tenant_column_maps.py`.

**Riesgos conocidos, aceptados y documentados**
2. [ ] Un `--full-refresh` de `app.trip_stops` reintroduciría el huso horario viejo (11:00) en los 18 viajes Sodimac congelados — su valor correcto ya no existe en ninguna fuente viva (ni portal ni bronze) y la tabla de respaldo se dropeó. El proyecto ya evita el full-refresh por una razón peor (borra ediciones manuales de Operaciones), así que el riesgo es teórico, pero si ocurre hay que rehacer la corrección a mano.

**Heredado de la Ronda 93, sin resolver**
3. [~] **RETIRADO como "borrado de huérfanas" en la Ronda 126 — no ejecutar la versión vieja de este ítem.** Las filas no son basura: son **versiones legítimas** (cambios de base reportados por el TMS). Borrarlas destruye justo la trazabilidad que Pablo dice que no tiene. Medición al 18/08: 2.869 filas sobre 620 viajes, 0 con edición manual, 1 viaje activo. **CORREGIDO 2026-08-19: el arreglo del `stop_id` que este ítem proponía quedó DESCARTADO** — habría forzado un solo origen justo donde hay dos legítimos (multi-retiro, ver issue #6). Lo que sí corresponde: la historia se consulta en `bronze.tms_trips_snapshot`, que ya la tiene bien (24.023 versiones sobre 3.563 viajes, verificado para `830021`), y la pérdida de tramos se trabaja en el issue #6. Detalle completo en la Ronda 126.
4. [~] Filas DESTINATION duplicadas en `app.trip_stops` — mismo origen que el ítem 4, mismo cambio de criterio. No se resuelven con un DELETE.
5. [ ] Revisar `cargo_type` del viaje `2003266` (probable error de clasificación FRIO/CONGELADO).
6. [ ] Evaluar si `qanalytics/scraper.py` y `wingsuite/scraper.py` necesitan el mismo `timezone_id` que se le puso a Sodimac — ninguno lo especifica; no hay evidencia de que sus portales rendericen del lado del cliente, pero si aparece un desfase de horas, revisar esto primero.

**Heredado de rondas ya archivadas** — se escribe completo acá porque esos checklists salieron del
archivo activo al cerrar la Ronda 119, y una lista que apunta a una sección que ya no está no es
una lista:

7. [ ] **HU-20** — validar con negocio si "Póliza de Seguro Vigente" (RC) se rediseña como se
   propuso en la Ronda 54 (ocultar `INSURANCE_POLICY`, activar `SEGURO_RC_EMPRESA`). Bloqueado
   hasta esa confirmación: no tocar `compliance_requirements`/Mage para ese campo mientras tanto.
8. [ ] **HU-24** — decisión de negocio sobre "Control Documental Mensual" (`CONTROL_MENSUAL_COL_T`):
   mantener, reformular o eliminar (0% completado en 118 registros desde su creación).
9. [ ] **Rol sin permiso de subir documentación** — pendiente de que el usuario confirme cuál es.
10. [ ] **Centro de Flota como módulo de navegación de primer nivel** (con espacio para alertas de
    póliza/documentación de equipo) — quedó explícitamente fuera de la Ronda 51.
11. [ ] **`vehicle_driver_assignments`** — "Conductor habitual" del Centro de Flota va a seguir casi
    siempre vacío hasta que operaciones cargue la asignación equipo por equipo desde la ficha de
    empresa. No es tarea de desarrollo.
12. [ ] **Mage**: borrar a mano el bloque `wingsuite_has_new_data` (desconectado) y revisar por qué
    `centralizer_eett_sharepoint`/`load_compliance_records_08` siguen en `failed` (no bloqueante,
    los datos fluyen igual).
13. [ ] **Tarea 9 de `status_taxonomies`** (DROP de las tablas legacy) — diferida por diseño, gated
    por tiempo en producción + confirmación explícita.
14. [ ] **Versionar el proyecto dbt real en git** — sigue sin decisión.
15. [ ] **Retirar del pipeline `legacy_drivers_transporters`** los bloques
    `snapshot_transporters_data`/`webapp_transporter_porfiles`.
16. [ ] **`ops.pipeline_rejects` / `ops.pipeline_runs`** — sin auditar (515 y 5 filas).
17. [ ] **Reescribir `/deploy` y `/check-env`** (`monitor-app/.claude/commands/`): describen el flujo
    viejo de Vercel y el deploy real es Cloud Run.
18. [ ] **Normalizar a inglés los valores de `?tab=seguros/conductores/equipos/…`** y el `type Tab`
    de `carriers/[id]/page.tsx` — deferido por el mismo blast radius de ~32 archivos que ya se
    evitó una vez.
19. [x] **Seguridad, de la Ronda 95 — CERRADO el 2026-08-18.** Las 5 matviews expuestas y 2 de las
    3 funciones `SECURITY DEFINER` se cerraron por migración
    (`20260818200000_seguridad_matviews_y_funciones.sql`), verificado con el linter. Las otras dos
    partes salieron a issues de GitHub porque no son trabajo de código:
    · **`is_admin()` NO se revoca y es deliberado** — la usan 3 políticas de RLS vivas sobre
      `profiles` y `admin_whitelist`; quitarle `EXECUTE` rompería el acceso a perfiles para todo
      usuario autenticado. El linter va a seguir reportándola: es un falso positivo para este caso.
    · **[issue #1](https://github.com/fsotosa-ops/webcarga/issues/1)** — el rol `writer`: es diseño
      del modelo de permisos sobre 74 endpoints, no un arreglo.
    · **[issue #2](https://github.com/fsotosa-ops/webcarga/issues/2)** — protección de contraseñas
      filtradas: no es SQL sino configuración de Auth, y **requiere plan Pro**. Si el proyecto no
      está en Pro, es una decisión de costo, no una tarea.

**Agregado al cerrar la Ronda 125 (2026-08-18)** — lo que salió de las Rondas 123-125:

20. [ ] **El aviso "posterior al cierre" no lleva a ningún lado.** Informa el número y el botón se
    quitó, porque el Monitor no soporta filtro por fecha en la URL (verificado: no usa
    `useSearchParams` ni lee parámetros). O se le agrega, o el aviso queda informativo a propósito.
21. [ ] **Los tres trinquetes del sistema visual, dos en margen cero**: color 1779/1780,
    tipografía sub-11px **279/279**, `<h1>` **9/9**. El próximo color crudo o tamaño chico que
    alguien agregue **en cualquier archivo del repo** rompe CI con un fallo ajeno a lo que estaba
    haciendo. La próxima tarea de frontend debería empezar bajándolos.
22. [ ] **Una sola definición del "universo de viajes del día".** El criterio multi-día sigue escrito
    a mano **14 veces** y la exclusión de Sodimac **9**. La R123 lo alineó pero no lo eliminó, y la
    R125 tuvo que sacar una quinta copia nacida dentro del propio plan. Es la causa raíz de los
    cuatro defectos de conteo que corrigió la R123.
23. [ ] **Absorción dinámica de estados sin mapear** en `app.trip_statuses`. Evidencia: Wingsuite
    manda `Cancelado` y el catálogo tiene `CANCELADO`, así que ese viaje cae fuera de todo JOIN en
    silencio. Decisión del usuario del 18/08: los estados vienen de los TMS y el catálogo debe
    absorberlos. Vive en el pipeline.
24. [ ] **Confirmar con operaciones el umbral de 7 días** para "abandonado por el TMS".
25. [ ] **Fusionar el conductor duplicado del roster** — dos filas con el mismo nombre; son las 2
    personas ambiguas que la R124 midió. El resolvedor se niega a elegir (correcto) y esos viajes
    quedan sin identificar.
26. [ ] **Borrar `CloseDayDialog.tsx` y sus tests** — 317 líneas, código muerto confirmado: ningún
    archivo de `app/` lo importa.
27. [ ] **UX: el viaje que el TMS cierra y sigue sin conductor** se cae del Monitor "en curso" justo
    cuando todavía hay trabajo. Mismo patrón que resolvió "Abandonados por el TMS" en el Cierre: el
    trabajo no debe desaparecer porque el TMS cambió de estado.
28. [ ] **UX: el alta de conductor no declara lo que cuesta.** Crear una persona dispara sus
    requisitos de Certificación (13 altas costaron 132 registros) y el popover no lo dice. Se
    resuelve en el copy y la fricción del paso de alta, antes de confirmar — no con un modal.
29. [ ] **Medir la densidad del Monitor** antes de opinar sobre su UX. Lo único observado hasta hoy
    es un límite de herramienta leyendo el árbol de accesibilidad (65k caracteres), que **no** es
    evidencia de un defecto de pantalla. Si se aborda, medir columnas, contenido por fila y cuántas
    decisiones caben sin scroll, con benchmark contra SaaS del rubro.

**Corregido al archivar**: el checklist viejo pedía "diseñar (spec nuevo) `app.equipment_day_status`".
**Esa tabla ya existe y tiene datos** — verificado hoy contra producción: 802 filas del 2026-08-01
al 08-14. Lo que falta no es el modelo, es el rediseño de la pantalla que lo usa (ver abajo).

---

## Próxima sesión (actualizado al cerrar la Ronda 125, 2026-08-18)

1. **El click-through del paso "Viajes"** (Task 9 del plan) — **bloqueado por credenciales**. Hay que
   desplegar a dev y tener un usuario real: el servidor redirige a `/login` y `.env.local` sólo trae
   un placeholder. Es lo único que verifica de punta a punta que cerrar un viaje conserva su
   `trip_status` del TMS y que `resolve_trip_fleet()` no pisa la declaración.
2. **El click-through de asignar conductor** (Task 7 del plan anterior) con el viaje **2032999** —
   mismo bloqueo. Ese caso resuelve por **dar de alta** (0 candidatos por contención), no eligiendo.
3. **Decidir el destino del aviso "posterior al cierre"**: hoy informa el número y no lleva a ningún
   lado, porque el Monitor no soporta filtro por URL. O se le agrega, o el aviso queda informativo.
4. **Bajar los tres trinquetes del sistema visual** antes de tocar frontend: color 1779/1780,
   tipografía **279/279**, `<h1>` **9/9**. Dos en margen cero.
5. **Una sola definición del "universo de viajes del día"** — sigue escrito a mano 14 veces (el
   criterio multi-día) y 9 (la exclusión de Sodimac). La Ronda 123 lo alineó pero no lo eliminó, y
   la Ronda 125 tuvo que sacar una quinta copia que había nacido dentro del propio plan.
6. **Absorción dinámica de estados sin mapear** en el catálogo (evidencia: `Cancelado` de Wingsuite
   cae fuera del JOIN porque el catálogo tiene `CANCELADO`).
7. **Fusionar el conductor duplicado del roster** — son las 2 personas ambiguas de la R124.
8. **Borrar `CloseDayDialog.tsx`** y sus tests: código muerto confirmado.

**El estado del Cierre**, verificado el 2026-08-18:

| | |
|---|---|
| Las 3 pantallas viejas | cuentan sobre el mismo universo (R123) |
| Identificar conductor | es un gesto de la tabla del Monitor, en lote (R124) |
| **El paso "Viajes"** | **existe**: 4 grupos, motivo obligatorio, delta posterior al cierre, filtro en el historial (R125) |
| `app.daily_closures` | sigue en **0** — nadie firmó un día todavía |

Lo que falta para que `daily_closures` deje de estar vacío ya no es el paso "Viajes": es el
**recorrido de 4 pasos** (Bloque 1 + §8bis del spec) y que alguien lo use.

Dónde vive el Cierre: `monitor-app/frontend/app/dashboard/operations/closures/` (con `history/`).
Backend: `daily_closures.py`, `equipment_closures.py`, `pre_cierre.py`, `driver_roster.py`,
`fleet_driver_gap.py`, `status_report.py`, y ahora `services/cierre_viajes.py`.

Pendiente de producto que sigue vigente: el **rediseño de Cierres con los 3 formatos fijos por
cliente** (mockups de Figma, refinamiento v2 ítem 6).
