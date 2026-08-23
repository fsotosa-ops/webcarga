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

### 2026-08-23 (cont.) — Ronda 144: los pendientes de Pablo, repartidos en issues y PRs

El criterio para repartirlos: **si la decisión ya está tomada y sólo falta construir, es un PR;
si falta una definición de negocio o de operaciones, es un issue** — porque un issue es donde una
pregunta espera sin bloquear una rama.

## Issues abiertos, cada uno con su medición

- **#8 · Seguros son tres pólizas.** RC de la empresa, vehicular del tracto (500-1.000 UF) y de
  carga de la rampla (2.000-3.000 UF, una cubre N patentes). La reunión destrabó HU-20 y HU-06 y
  de paso amplió el alcance de una póliza a tres. El modelo YA tiene `policy_assets` (póliza ↔ N
  patentes) y `insurance_installments.payment_status`; le FALTA tipo de póliza —`coverage_types`
  es un catálogo **sin seed versionado**— y monto en UF, que hoy sólo existe por cuota.
- **#9 · Forzar la asignación en el Cierre.** Lo cierra el PR de abajo.
- **#10 · Gobernanza de datos sensibles.** Se abrió cuando Pablo pidió banco y cuenta como campos.
  Se difirió de común acuerdo: no es un campo más. Se cruza con el issue #1 (el rol `writer`).
- **#11 · Dos definiciones chicas que faltan de negocio.** (a) ~~El límite de peso por archivo no
  existe~~ — **ERROR MÍO, corregido el mismo día**: existe, son 7 MB en
  `STORED_FILE_MAX_BYTES`, aplicado en las tres rutas de subida, y se bajó de 10 a 7 **a pedido de
  Pablo** el 20/07 por las fotos de celular sin comprimir. Lo que se le respondió a Fabián era
  correcto. El error salió de mirar `_check_upload_size` —que sólo cuenta archivos— y concluir de
  ahí, sin abrir la función que sí valida bytes. Queda sólo verificar la capacidad del bucket.
  (b) ¿Existe "rechazar un documento"? De eso depende si `REJECTED` entra en la definición de
  pendiente o se retira de las capas. Sigue abierto e inerte (0 filas, ningún escritor).

Y los de Sodimac (#5, #6) actualizados **sin cerrarlos**, con el motivo escrito: #6 porque el
multidestino sigue igual, y #5 porque después del 20/08 hay 6 viajes en 17 versiones — muy poca
muestra para declarar resuelto el dedupe.

## PR 1 · Un solo criterio de "pendiente" (y un trinquete)

La Ronda 129 unificó las TRES lecturas de Certificación. Afuera quedaban **cinco copias a mano** en
`carriers.py` (×3) y `trips.py` (×2), y nadie lo notó porque una copia no rompe nada: contesta
distinto. Diferían en **dos direcciones**: `REJECTED` (las copias sí, el predicado no) y "por
vencer" (el predicado sí, las copias no).

Medido: 0 registros `REJECTED` y ningún código los escribe, así que esa mitad era latente. **La viva
era la otra**: el vehículo HKXW55 pasa de 3 a 5 obligatorios pendientes — dos documentos que vencen
en 25 días que ya aparecían en Certificación y no en la ficha ni en el Diario.

La definición se mudó a `services/vencimientos.py`, que ya era dueño de las otras dos mitades de la
regla y porque **un router no debe importar de otro router**. El ÁMBITO no se unificó a propósito:
que la ficha cuente sólo `LEGAL_MANDATORY` y Certificación cuente todos los niveles son dos
preguntas distintas. El trinquete impide la sexta copia y **descarta comentarios** — un comentario
que EXPLICA el criterio no es una copia, y sin eso daba falso positivo.

## PR 2 · Un documento nuevo no puede nacer invisible

`create_requirement` no sembraba alias, así que desde la Ronda 140 **cada alta nacía invisible para
el clasificador, en silencio**. Ahora se siembra en la misma transacción, con el **nombre**
normalizado y no el código: el nombre es lo que la gente escribe en el archivo.

**Un test afirmaba el defecto como un hecho** (`== []`, "por eso nace invisible") — documentaba el
bug en vez de proteger algo. Se reescribió para fijar el arreglo.

Los alias viajan **dentro del catálogo** con un LEFT JOIN, no por fila: 37 documentos serían 37
consultas para dibujar una tabla. La celda distingue **tres** estados: "—" (el dato no llegó
todavía), "No se reconoce en ningún archivo" y los chips.

## PR 3 · El vínculo manual deja de quedarse sin empresa

El reclamo sobre Edgar, y **la causa no era la que parecía**. Nada se revertía: `resolve_trip_fleet()`
excluye los vínculos manuales en dos lugares para proteger la elección humana, y eso está bien. El
efecto colateral es que al vincular SOLO al conductor, el `carrier_id` nacía NULL y **ese NULL
quedaba congelado**: ninguna corrida vuelve a mirar un vínculo manual.

Medido: 25 vínculos manuales, 14 sin empresa, **los 14 con un conductor que sí la tiene**, y cero
casos con empresa distinta. El arreglo no relaja las guardas — sólo toca filas con `carrier_id IS
NULL`. **Una inferencia llena un silencio, nunca contradice.**

Verificado en producción: **14 → 0**, y los 11 con empresa elegida a mano **intactos**, probado con
la marca de tiempo (14 con `updated_at` reciente, 11 con la suya vieja, la más antigua del 18/07).
El arreglo actúa **de inmediato**: el UPDATE de `app.trips` del propio endpoint dispara el trigger.

## PR 4 · El Cierre obliga a resolver la flota fuera del directorio

El pre-cierre detectaba los cinco casos desde el 18/08 **y no bloqueaba nada**. Detectar sin
bloquear no cambia ninguna conducta.

**Se midió antes de decidir qué bloquea**, porque bloquear sobre 50 pendientes congela la operación:
sobre 5 días reales, **entre 2 y 4 casos por día**. `EMPRESA_NO_RECONOCIDA` da 0 todos los días — lo
que dispara es patente y conductor sin registrar, la escena exacta que describió Pablo.
`SIN_TIPO_OPERACION` queda AFUERA: ahí el vehículo sí está en el directorio.

La válvula es **la que ya existía** (admin + comentario + auditado), la que el propio refinamiento
diseñó contra el "deadlock operativo". `override_count` ahora cuenta todo lo forzado.

Dos decisiones: los dos motivos van **separados** en la respuesta —fundirlos daría un número que no
dice qué hacer—, y la auditoría del forzado de flota va **contra el usuario**, porque lo que falta
es justamente la entidad (`audit_log.entity_id` es NOT NULL y no hay uuid al que atribuirlo).

**El frontend no necesitó cambios**: el guard del 409 sólo mira el código. Es la tercera vez en esta
tanda que la UI ya estaba lista.

---

### 2026-08-23 (cont.) — Ronda 142: Sodimac multiorigen, y la premisa del plan que era falsa

El segundo compromiso del 21/08. **Escrito y sincronizado a Mage; falta que alguien corra la
cadena** — `run_block` sigue roto para `batch_tms_monitor_trips`.

## LA PREMISA DEL PLAN ERA FALSA

El plan decía: *"reusar la estructura que Wingsuite ya usa: su `trip_stops` mezcla PICKUP y
DELIVERY"*. **Es al revés.** El modelo de Wingsuite **excluye** `accion='Carga'` de su arreglo, y
`app/trips.sql` documenta que el filtro por `action_type` *"NUNCA existió"* porque esa clave se
descarta en el remapeo. El backend lo dice todavía más claro en `trips.py`: *"`app.trips.stops`
(jsonb legacy) sigue siendo **solo-destinos** — el origen unificado vive en `app.trip_stops`"*.

O sea que no había canal para N orígenes, y meterlos en el arreglo de destinos los habría convertido
en destinos aguas abajo.

## LA CAUSA RAÍZ TAMPOCO ERA LA QUE DECÍA EL PLAN

No es "el modelo lee `stops->0`". Es que **el arreglo `stops` no tiene orden estable entre
corridas**. Medido sobre el viaje 833795 —el que citó Pablo— a lo largo de 33 versiones del
snapshot: el primer elemento **alterna** entre sus dos orígenes, y el largo oscila 1 → 10 → 2. Con
eso, cualquier lectura posicional devuelve algo distinto cada vez.

**Y eso explica los "duplicados" que la migración del 2026-08-07 vino a colapsar.** Hay **4 viajes
de Sodimac con dos filas ORIGIN, las cuatro con el mismo `stop_order`**, y Sodimac es la **única**
fuente con el fenómeno: QAnalytics tiene exactamente 1 fila en sus 1.676 viajes. No eran paradas
renombradas — eran los dos orígenes reales, llegando uno por corrida. El dedupe hizo bien en
colapsarlos porque eran indistinguibles; el arreglo iba aguas arriba.

## El estándar, y por qué la salida no fue agregar estructura

En modelado de transporte el origen **no es un atributo del viaje**: es el rol de una parada. EDI 204
define N segmentos `S5` con código de motivo (`CL`/`PL` carga, `CU`/`PU` descarga) y multi-pickup es
caso base; EDI 214 reporta estado por parada; project44 y FourKites exponen `stops[{type, sequence,
location}]`. **`app.trip_stops` ya es esa forma** —tiene `stop_type` y `stop_order`—, así que el
modelo correcto ya estaba en la base. Lo que fallaba era el pipeline, que seguía sintetizando UNA
fila desde un escalar.

De paso: el test `assert_trip_stops_at_most_one_origin_per_trip` **ya había llegado a esta misma
conclusión el 2026-08-19**, citando project44 y Oracle OTM y nombrando los mismos 4 viajes. Y dejaba
anotado lo que faltaba: *"que el modelo aplane los tramos a uno solo… necesita su propia
verificación cuando se defina cómo se modelan los tramos"*. Esta ronda la definió y la escribió.

## Lo que se cambió

- **`stg_sodimac_trips`** — `origin_locations`: todos los orígenes distintos, ordenados por nombre.
  El escalar `origin_location_name` se conserva y pasa a ser **derivado** (el primero), con lo que
  deja de cambiar entre corridas.
- **`int_tms_trips_conformed`** — las otras tres fuentes derivan `origin_locations` de su escalar
  **sin tocar esos modelos congelados**: el conformado ya sabía completar columnas por fuente. Va al
  final del contrato porque el UNION ALL alinea por posición (las 4 quedan en 51 columnas).
- **`app/trip_stops`** — `origin_stops` explota el arreglo: una fila por origen, `stop_order`
  0..k-1. **Con un solo origen es un no-op exacto.**
- **`assert_trip_stops_no_aplana_los_origenes`** (test nuevo) — conservación entre capas contiguas:
  tantas filas ORIGIN como orígenes declara el conformado. Compara con `<` y no con `!=` porque las
  filas de MÁS son el pasivo histórico que el proyecto decidió no borrar.
- **`app.v_driver_daily_trip_legs`** (migración, YA APLICADA) — el LATERAL desempataba por
  `updated_at DESC`, que ante dos orígenes reales elige al azar. Ahora ordena por `stop_order`
  primero: la salida es el primer origen.

## Lo que NO hubo que tocar, y es la mitad de la noticia

- **El frontend, nada.** `TripDetailView` ya mapea TODAS las paradas con insignia ORIGEN por fila.
  Y el riesgo que el plan anotaba —*"editar la ruta a mano borraría el segundo origen"*— **no
  existe**: `RouteEditor` sólo vive en `TripAssignDialog`, que es un diálogo de CREACIÓN.
- **El backend, nada.** El dedupe es por `(trip_id, stop_type, stop_order)` —con el tipo adentro— y
  `_stop_display_key` ya pone los orígenes primero con `stop_order` de desempate.
- **El `post_hook`**, nada: su match ya estaba expresado por `stop_order = 0`. Sólo se corrigió el
  comentario que lo justificaba con "siempre existe un solo origen".

## Verificado contra la base, simulando el modelo nuevo desde bronze

Sobre los 68 orígenes de Sodimac: **67 `stop_id` se conservan**, 4 filas nuevas (los segundos
orígenes que faltaban), 6 cambian de `stop_order` de 0 a 1, y 1 queda huérfana. Ningún `stop_id`
cambia — la continuidad del id es invariante dura del proyecto.

La migración aplicada se verificó en caliente: **1.681 filas sobre 1.681 viajes**, o sea una fila
por viaje; el fan-out que la migración de agosto vino a evitar no vuelve.

**La huérfana (viaje 830021) NO se borra**: la decisión del proyecto es que esas filas son historial,
no basura. El cambio corta que se sigan generando.

## CORRIDO EN MAGE, Y LOS 7 VIAJES QUEDARON

Verificado contra la base después de la corrida del usuario:

| Viaje | Orígenes materializados |
|---|---|
| **833795** (el que citó Pablo) | Bod La Farfana 4 (257) `[0]` + LA FARFANA CDMC (256) `[1]` |
| 804151, 815726, 841612 | Farfana 4 (257) `[0]` + La Farfana 256 `[1]` |
| 807366, 841584, 843964 | BOD-209 Lo Ruiz `[0]` + La Farfana 256 `[1]` |

Los siete con dos filas ORIGIN y `stop_order` 0 y 1.

**Hizo falta una escotilla más, y el modelo ya tenía el patrón.** La primera
corrida dejó el silver bien (`origin_locations` existe en el conformado) pero
**no reprocesó ningún viaje**: el watermark de `app/trips.sql` es
`status_reported_at > MAX(...)`, así que un viaje de julio no vuelve a entrar
nunca, su `updated_at` no avanza y `app/trip_stops` no lo revisita. El modelo ya
tenía tres escotillas (OR 1, 2 y 3) para exactamente esta clase de hueco — una
dice literal *"qanalytics sin origen aún resuelto"*—, así que se agregó la
cuarta: el viaje reentra cuando declara más orígenes de los que tiene
materializados, **y se apaga sola** en cuanto se materializan.

**La medida es `count(DISTINCT stop_order)`, no `count(*)`,** y esa decisión
tiene dos razones medidas: cubre los dos síntomas con una condición —"falta el
segundo origen" (1 fila) y "los dos comparten `stop_order`" (2 filas que el
dedupe del backend colapsa, así que la pantalla igual muestra uno)— y **no
engancha al huérfano del viaje 830021**, que con `count(*)` habría reentrado en
cada corrida para siempre, porque esa fila no se borra a propósito.

## El test propio puso el bloque en rojo, dos veces, por razones distintas

**Primera vez, y tenía razón**: marcaba los 4 viajes aplanados. Pero señalaba una
condición que **ninguna corrida podía destrabar** —el watermark—, así que era
rojo permanente. Lo arregló la escotilla OR 4: ahora el pipeline sana exactamente
lo que el test marca, que es la propiedad que hace que un test valga.

**Segunda vez, Compilation Error.** El artefacto compilado de la primera versión
existe en el remoto, así que el `ref` y el Jinja siempre estuvieron bien: se
rompió con la segunda edición. Se volvió a la versión que demostradamente
compila, en ASCII plano (era el único test del proyecto con `→` y mayúsculas
acentuadas). Verificado: devuelve 0 filas contra la base. Lo que esa versión deja
de cubrir lo previene aguas arriba la escotilla, que sí usa la medida fina.

**No se siguió adivinando por API**: el `mage-agent` trunca logs a ~8.000
caracteres y este proyecto ya perdió tiempo iterando a ciegas por eso.

---

### 2026-08-23 (cont.) — Ronda 143: los desplegables de Certificación

Pedido mirando la pantalla: *"ajustaría los nombres de los desplegables… la
UX/UI creo que no maneja la jerarquía visual y así se pierde un poco cómo
funcionan"*.

**Los nombres mezclaban tres formas gramaticales** — estado ("Recién creadas",
"Certificadas y al día"), acción ("Hay que renovar") y sobrante ("Resto del
catálogo") — y esa inconsistencia es parte de por qué la lista no se leía como
una secuencia. Ahora son todos del mismo tipo, el estado de la empresa, que es
el patrón de ISNetworld y Avetta: **Sin documentos · Incompletas · Con
vencimientos · Al día · No activas**. "Resto del catálogo" ya lo había
descartado el usuario en la reunión del 21/08.

**La jerarquía tenía una causa concreta y contraintuitiva**: el título del grupo
iba en un `span` de 10px versalitas, puesto a propósito como "andamiaje" para no
competir con el sujeto, y el efecto era el contrario — quedaba **más débil que
las empresas que contiene**, así que se leía como una franja de color y no como
algo que se abre. Ahora es un `<h2>` real, y de paso se puede saltar de grupo en
grupo con lector de pantalla (la base de UX marca "Keyboard Navigation" y
"Heading Hierarchy" como los dos ítems de un acordeón).

**El tinte quedó en un solo grupo.** Cinco franjas de color competían entre sí y
con las insignias de las filas; cuando todo tiene color, el color deja de avisar
(§9). Se retiraron 7 clases de color crudo, así que **el trinquete visual bajó**.

## Y el click-through encontró que el arreglo estaba a medias

Los dos defectos salieron de **medir el DOM desplegado**, no de mirar a ojo, y
ningún test los veía:

- **Escalón tipográfico de 1,5px.** Grupo 15px y empresa 13,5px, **los dos en
  peso 600**. A la vista eso no es jerarquía. Subió el grupo a `font-bold`; el
  nombre de la empresa no se debilita porque es lo que se escanea.
- **Sangría de −9px.** El nombre de la empresa arrancaba **a la izquierda** del
  título de su grupo: el contenedor sangraba 16px pero la fila trae su propio
  `px-4` más chevron, y el encabezado suma chevron + icono. El hijo caía fuera
  del padre y la sangría se leía al revés. Con `pl-6` queda alineado.

**Medido después del arreglo, en dev**: grupo 15px/700 en x=150, empresa
13,5px/600 en x=149 — 1px de desalineación. A 390px no desborda, el nombre mide
96px y ningún elemento mide 0px.

1.299 tests de frontend, `tsc` limpio, `npm run build` OK. La mutación que
devuelve el encabezado a un `div` mata su test, y cae en el render del grupo.

## SIGUIENTE PASO EXACTO

1. **Correr `app_trips_tests` en Mage** para confirmar que compila. Si vuelve a
   fallar, hace falta la SEGUNDA línea del error —la que nombra el nodo—; sin
   eso no se sigue.
2. **Los 2 viajes de qanalytics con CERO filas ORIGIN** (uno con
   `source_system_trip_id = 'nan'`). Es otro hueco —"este viaje no tiene origen",
   no "se aplanaron los tramos"— que en teoría cubre la escotilla OR 1 y sigue
   sin resolverse. No se mezcló acá a propósito.
3. **La regla de cámara de frío**: `MANTENCION_FRIO` se exige a los 9 subtipos
   que no son Tractocamión. Se corrige **desde la UI, sin código**.
4. **Seguros de tres pólizas**: la reunión destrabó HU-20/HU-06 y las amplió.

---

### 2026-08-23 — Ronda 141: la planilla de certificación, y los dos ejes que no se colapsan

Rama `feat/certificacion-fechas-por-planilla`, mergeada a `dev`. Nace de cruzar la reunión
**Webcarga 2.0** (21/08) contra el AGENTLOG: de los dos compromisos que se tomaron para ese mismo
día, **ninguno había salido**. Los commits posteriores a la reunión (14:20–23:29) fueron los huecos
de Certificación, la Bandeja y la configuración de documentos; el 22/08 no tiene commits. Los dos
pendientes son los que tenían a Webcarga esperando: la carga de fechas sin archivo (Fabián y Karen
no podían simular una empresa) y el reproceso multiorigen de Sodimac (Pablo no podía probar el
cierre). **Esta ronda cierra el primero. El segundo sigue abierto.**

## LO QUE CORRIGIÓ EL USUARIO, Y POR QUÉ TENÍA RAZÓN

La primera versión traía **sólo los documentos que vencen**. El usuario lo cortó: *"¿por qué sólo
pusiste los que hay fechas? Hay casos que no tienen fecha pero son obligatorios, entonces ahí hay
una regla de tenencia o no tenencia y eso es relevante."*

Medido en las 39 empresas activas, sobre 2.370 pendientes: **1.326 llevan vencimiento y 1.044 no lo
llevan — y esos 1.044 son TODOS `LEGAL_MANDATORY`**. Sin esa columna, la mitad del trabajo pendiente
no tenía ninguna vía de carga. Y el reparto por nivel desmiente que esto sea cosa de empresas: de
las 1.326 filas con vencimiento, **sólo 168 son de empresa — 767 son de vehículo y 391 de
conductor**.

**Los dos ejes, una columna cada uno.** Es el modelo que usan ISNetworld, Avetta, Veriforce,
Fleetio y Samsara: **evidencia** (¿tenemos el papel?) y **vigencia** (¿está al día?) son estados
independientes, y una fecha sin evidencia **nunca** cuenta como cumplido. Fleetio es el precedente
literal: sus recordatorios de renovación existen sin documento adjunto.

## Decisiones de arquitectura de esta ronda

- **La llave es `id_registro`, no el RUT.** El identificador natural cambia por nivel —el vehículo
  va por patente, no tiene RUT—, así que un match por identificador necesitaría tres reglas y
  fallaría en los dos bordes medidos: los 5 registros del único conductor sin `tax_id` de los 87, y
  las 88 filas que no resuelven a ninguna empresa. Baja **bloqueada** en el XLSX.
- **Los nombres de columna son los del rubro** (`Record ID`, `Entity Type`, `Document Type`,
  `Status`, `Expiration Date`), en español por la convención del proyecto. La tenencia NO se llamó
  "en archivo": chocaría con el estado `ARCHIVED`, que significa lo contrario.
- **LA ESCRITURA ES UNA SOLA SENTENCIA, y no es una optimización.**
  `trg_refresh_view_on_compliance` refresca una vista materializada **por statement** sobre
  `compliance_records`, y `record_manual_edit()` hace un SEGUNDO update sobre la misma tabla. De a
  una, 2.370 filas son 4.740 refrescos. El marcado de `is_manual_override` viaja dentro del mismo
  `UPDATE`; la auditoría va aparte, y es **por campo**: una fila que mueve los dos ejes son dos
  hechos distintos.
- **La ruta va declarada ANTES de `GET /{record_id}`.** Declarada después queda eclipsada y
  `/date-template` contesta "registro no encontrado" — un 404 que no dice nada de la ruta que falta.
  Tiene test.
- **Se retiró la exportación anterior** en vez de dejar dos botones: pedía 200 filas sobre 5.026
  pendientes (el 4%, sin decirlo) y sus columnas no identificaban la fila, así que lo que bajaba no
  se podía volver a subir. Fabián lo vio en vivo: *"aquí no te bajó todo. Te bajó poquito."*

## Un defecto que encontré antes de comitear, y hoy son 0 filas

La planilla baja con las dos columnas **pre-llenadas**. La primera versión mapeaba el estado a sí/no
con `status IN ('MISSING','REJECTED') → No, resto → Sí`. Con eso, **bajar la planilla y volver a
subirla sin tocarla** convertía un `REJECTED` en faltante y un `EXPIRED` en recibido, en silencio.
Hoy la base sólo tiene `MISSING` (5.027) y `APPROVED_MANUAL` (95), así que el impacto real es cero —
se arregló igual, y con test, para que sigan siendo 0 problemas cuando aparezca la primera.

Ahora sólo se pre-llena lo que la columna PUEDE expresar; el resto baja en blanco, que significa "no
se toca" y es la verdad.

**De paso quedó a la vista**: el predicado compartido de "pendiente" **no incluye `REJECTED`**, así
que un documento rechazado sin fecha es invisible para toda la cola del módulo. Es preexistente y
cambiarlo movería el embudo, el cajón y `/pending` a la vez — no se tocó.

## La insignia: los dos ejes YA estaban dibujados

El pedido era una insignia de "pendiente de cargar la documentación". Al mirar el código, el pill de
estado y la celda de vencimiento **ya son dos elementos separados de la misma fila** — el modelo de
dos ejes ya estaba en pantalla. Lo único que faltaba era que "Falta" dejara de significar dos cosas
("no sé nada de este documento" y "sé cuándo vence, me falta el papel"), que es la **sexta** vez que
un mensaje con dos causas aparece en este módulo. Ahora dice **"Falta el archivo"**, con el mismo
gris: la urgencia la lleva la fecha, al lado. Inventar un color nuevo habría sido escribir una
versión peor de algo ya resuelto.

## El directorio que Pablo echaba de menos

*"Me falta ese directorio que tenía yo antes […] de las trescientas, cincuenta activas y doscientas
cincuenta inactivas."* Existía en el módulo de Empresas como tabs Activas/Inactivo/Onboarding con
sus conteos, y se perdió al mover la carga documental a Certificación. Se repuso arriba del embudo:
**248 empresas · 39 activas · 209 inactivas**, y **79 tractos · 37 ramplas · 79 conductores**.

Va arriba del embudo y no adentro: el embudo contesta *qué hay que hacer*, esto *con qué contamos*.
La flota cuenta **sólo empresas activas y asignaciones vigentes** — el catálogo entero diría "124
tractos" incluyendo los de empresas dadas de baja hace un año, y ese número no describe ninguna
operación. Una sola consulta con ocho subconsultas: ocho viajes a la base para dibujar una tira de
cifras es lo que vuelve lenta una portada.

## La descarga no funcionaba fuera de Chrome

El usuario reportó que no le bajaba ni XLSX ni CSV. El enlace se creaba y se clickeaba **sin
insertarlo en el DOM**, y la URL del blob se revocaba en el mismo instante. Chrome tolera las dos
cosas; Firefox y Safari no hacen nada y la descarga se pierde **sin ningún error**. La exportación
vieja tenía el mismo patrón.

## Verificación

Backend **926 tests** (18 nuevos, todos contra Postgres real con rollback y guardia de huella),
frontend **1.296**, `tsc` limpio, `npm run build` OK.

**Siete mutaciones, las siete detectadas**, verificando en cada una dónde había caído antes de leer
el resultado: quitar `is_manual_override` del UPDATE masivo, volver a filtrar la planilla por
`has_expiration` (rompe 8 tests de una), hacer que `dry_run` escriba, que una fila vacía borre la
fecha, quitar la guarda de "recibido sin fecha", sacarle a la flota el filtro de empresa activa, y
devolver el mapeo sí/no que convertía estados en silencio.

## EL CLICK-THROUGH, HECHO — y encontró que la insignia estaba donde no podía dibujarse

Con Playwright contra dev, sobre el código desplegado (`3d47c1f5`).

**Lo que salió bien, medido en pantalla.** El XLSX baja con 2.370 filas y 9 columnas, la hoja
protegida, panel fijo en A2 y **sólo las dos columnas editables desbloqueadas**. El modal dice
*"2.370 documentos pendientes · 39 empresas"* y *"1.326 llevan vencimiento · 1.044 sólo piden
confirmar si los tienes · 433 de empresa · 939 de conductor · 998 de vehículo"* — cuadra con el SQL
hasta el último número. El directorio dice **248 empresas · 39 activas · 209 inactivas · 79 tractos
· 37 ramplas · 79 conductores**.

Se llenaron **3 filas de 2.370**, una inválida a propósito. La vista previa: *"2 se marcan como
recibidos · 1 declara su vencimiento · 2.367 ya estaban así"* más *"1 fila con problema · no se
aplica nada hasta resolverlas"*, con el motivo exacto (*"Carpeta Tributaria necesita su fecha de
vencimiento para darse por recibido"*) y **Aplicar deshabilitado**. La aritmética cierra:
2 + 2.367 + 1 = 2.370. **La guarda operó en vivo, no sólo en el test.**

Tras corregir la fila: F43 quedó `APPROVED_MANUAL` con fecha y override; Reglamento Interno —que NO
vence— quedó `APPROVED_MANUAL` sin fecha, que es el caso de los 1.044; y Certificado Mutual quedó
`MISSING` con fecha y la ficha ya dice **"vence en 28 días"**. Auditoría: 2 hechos de `status` + 1 de
`expiration_date`. **Es la primera vez que las alertas de vencimiento tienen con qué dispararse.**

**EL DEFECTO QUE ENCONTRÓ, Y LO HABÍA PUESTO YO.** La ficha de empresa parte sus filas por
`urgencia`: las `AL_DIA` llevan pill de estado y las pendientes llevan zona de arrastre, **sin
pill**. O sea que "Falta el archivo" —que por definición es un `MISSING`— **no podía renderizarse
nunca ahí**. Una capacidad sin puerta, la cuarta de este módulo, y esta vez la agregué yo. Donde sí
se dibuja pill para una fila pendiente es en `TransporterSlideOver` y `TransporterAlertBanner`, que
listan documentos sin zona de arrastre y por lo tanto sin nada que aclare si falta el papel o falta
todo. Ahí quedó cableada, con test que fija la combinación.

También apareció concordancia de número: *"1 declaran su vencimiento"*, *"1 filas quedaron en
blanco"*.

**En teléfono (390 px)**: la página no desborda, el diálogo mide 358 y cabe, y **ningún elemento
mide 0 px** — que fue exactamente el defecto del click-through anterior.

**Los datos de prueba se revirtieron**, y la base quedó idéntica al estado previo: 31 con fecha, 95
aprobados, 5.027 faltantes, 0 rastro en `audit_log`. Las planillas descargadas se borraron del disco
porque traían nombres y RUT reales.

De paso, dos cosas que le dijimos a Fabián y no se sostienen: el límite de "siete, diez megas" por
archivo **no existe** (`_check_upload_size` sólo cuenta archivos, nunca bytes), y la capacidad del
bucket quedó sin verificar.

## PENDIENTE ANOTADO: hay DOS definiciones de "pendiente", y difieren en dos direcciones

Salió al escribir la planilla y **no se tocó a propósito** — cruza el Diario y la ficha de empresa,
y no se mezclan refactors de módulos distintos en una rama de Certificación.

Corrige una afirmación de esta misma ronda: *"el criterio ya estaba unificado desde la Ronda 129"*
es **falso**. La R129 unificó las TRES lecturas de dentro de Certificación (`/pending`, el embudo y
el cajón) en `pendiente_predicate()`. Afuera quedaron **5 copias escritas a mano**: `carriers.py`
(×3, el `pending_mandatory` de la ficha) y `trips.py` (×2, el semáforo del Diario).

| | `pendiente_predicate` (Certificación) | Las 5 copias (ficha, Diario) |
|---|---|---|
| `MISSING`, `EXPIRED`, vencido por fecha | sí | sí |
| `REJECTED` | **no** | **sí** |
| Por vencer (30 días) | **sí** | **no** |
| Ámbito | todos los niveles | sólo `LEGAL_MANDATORY` |

**Medido el 2026-08-23**: **0 registros `REJECTED`** y **ningún código lo escribe** (el único hit del
grep es un CASE de presentación) → esa mitad es latente. Pero **2 documentos obligatorios están "por
vencer"** → ésos aparecen pendientes en Certificación y **no** en la ficha ni en el Diario. La
divergencia viva es la de "por vencer", no la de REJECTED.

**Cómo abordarlo, en este orden:**

1. **Separar el ámbito de la regla.** El filtro `LEGAL_MANDATORY` es una diferencia LEGÍTIMA —la
   ficha pregunta "cuántos obligatorios están en problemas" y Certificación "qué entra a la cola"—
   y no hay que unificarlo. Lo que sí es una sola regla es el vocabulario de estados y fechas.
   `pendiente_predicate(alias)` ya tiene la forma correcta (fragmento parametrizado por alias), así
   que las 5 copias pasan a llamarlo y agregan su propio `AND req.requirement_level =
   'LEGAL_MANDATORY'`. **Esto solo arregla los 2 documentos.**
2. **Recién después decidir `REJECTED`**, que con una sola definición es un cambio de una línea.
   Es decisión de negocio: *¿existe "rechazar un documento" como gesto?* Hoy no, y hay una decisión
   explícita del 2026-07-18 de que no hay revisión separada del negocio ("quien sube el archivo ya
   lo revisó") — la misma que dejó muerto a `PENDING_REVIEW`. Si no existe, `REJECTED` es un
   placeholder anterior a la taxonomía —mismo caso que los 5 valores de `AssetType` de los que sólo
   existían 2— y corresponde RETIRARLO de las capas, no ampliarlo. Si Karen sí necesita rechazar
   (documento ilegible, o que llega vencido), es un estado vivo, necesita su botón, y entra.
3. **Un trinquete que impida la sexta copia**, con el idioma que el repo ya usa para el sistema
   visual: un test que cuente las apariciones a mano de `IN ('MISSING'…)` fuera del predicado.

**Lo que NO hay que hacer**: meter `REJECTED` en el predicado compartido ahora. Sería alinear seis
lugares alrededor de un estado que nadie produce, sin haber decidido si existe, y dejaría los dos
documentos "por vencer" divergiendo igual.

---

## SIGUIENTE PASO EXACTO

1. **Sodimac multiorigen** — el otro compromiso del 21/08, sin empezar. El dato llega intacto hasta
   el modelo dbt silver (`stg_sodimac_trips.sql` lee `stops->0`); el riesgo es que hay **tres capas
   aguas abajo que fuerzan un solo origen**, una de ellas un dedupe escrito en agosto para colapsar
   filas ORIGIN duplicadas que sí eran duplicados. Un segundo origen legítimo entra por esa misma
   puerta. Plan completo en `~/.claude/plans/enumerated-brewing-shell.md`.
2. **La regla de cámara de frío**: `MANTENCION_FRIO` se exige hoy a los 9 subtipos que no son
   Tractocamión —rampla seca, sider, plano, botellero incluidos—. Se corrige **desde la UI, sin
   código**, en Configuración → Certificación → condiciones.
3. **Seguros de tres pólizas**: la reunión destrabó HU-20/HU-06 y las amplió. Sin empezar.

---

### 2026-08-21 — Ronda 138: tres huecos de Certificación y la investigación de Sodimac

Rama `feat/certificacion-baja-y-tipo-vehiculo`, **sin comitear todavía**. Backend 897 tests verde,
frontend 1.255 en 130 archivos, `tsc` limpio, `npm run build` OK. Los tres cambios se verificaron
con mutación, no sólo con la suite en verde.

**Los tres eran la misma forma de defecto: la capacidad existía y faltaba la puerta.**

**A · La empresa no se podía dar de baja desde Certificación.** No era permiso —el perfil que lo
reportó es `owner`— sino que nunca se construyó: `page.tsx:110` limitaba el menú `⋮` a `DRIVER` y
`ASSET`. El comentario que lo acompañaba tenía razón en descartar *ese menú* para la empresa
(rotularía "dar de baja a Transportes X de Transportes X"), pero de ahí se concluyó que la empresa
no tiene baja en el módulo, que es otra cosa. Ahora vive en la cabecera de la ficha, con
`useCanAdmin`, reusando `BajaReasonModal` y el `PATCH` de `carriersApi` — el mismo que usa Empresas.

**B · La patente no decía qué es el vehículo.** El dato estaba (`assets.asset_type` en los 124;
`fleet_service_type_id` → `app.status_taxonomies`, **con `bg_color`/`text_color` ya cargados**) y el
badge también (`VehicleRosterCard`), pero no se cruzaban: `ComplianceSummarySubject` no llevaba los
campos. El `LEFT JOIN public.assets` ya estaba en `_PENDING_ROWS_SQL` para sacar la patente, así que
fue agregarle columnas y un join al catálogo, no una consulta nueva.

**C · "¿A quién pertenece?" siempre vacío en la Bandeja.** Medido: **65 de los 66 archivos de la
cola tienen `carrier_id` NULL**, o sea que la lista vacía era el estado normal, no un borde. Sin
empresa, `pendingQuery` queda `enabled: false` y no hay sujetos que ofrecer. El aviso mandaba a "el
botón de la barra de selección", que sólo aparece con la casilla marcada y abre un buscador en
blanco hasta la segunda letra: cuatro pasos para contestar lo primero que uno quiere decir de un
archivo. Ahora la pregunta se hace donde estaba el hueco, con `minChars={0}` y el mismo
`moveItems` de la barra de lote.

---

## Decisiones de arquitectura de esta ronda

- **`AssetType` y sus etiquetas se mudaron a `lib/types.ts`.** `lib/api/assets.ts` ya importaba de
  ahí, así que al revés era un ciclo; re-exporta para no tocar llamadores. La tabla de etiquetas
  estaba copiada en tres componentes — una etiqueta corregida en uno y no en los otros no rompe
  nada, sólo hace que la misma flota se llame distinto según la pantalla.
- **Un error se muestra en un solo lugar.** El primer intento del selector de empresa atrapaba el
  error para mostrarlo, y `CarrierSearchPicker` ya lo hacía: salía **pintado dos veces**. Ahora el
  handler relanza y el picker es el dueño de mostrarlo — tragárselo apagaría su spinner anunciando
  un éxito que no pasó.
- **`minChars={0}` en vez de `showMinCharsHint`.** La prop de la pista no aportaba nada una vez
  que el mínimo es cero; dejarla puesta sería una prop que miente.
- **El trinquete visual es un conteo global con tope 1755 que sólo baja.** Copiar el
  `bg-slate-100 text-slate-500` de `VehicleRosterCard` habría roto CI, así que la insignia del
  chasis usa tokens; la de carrocería va en `style` porque su color **es dato del catálogo**, no
  decisión de diseño.

## Lo que la mutación encontró (y la suite en verde no)

Cinco mutaciones, las cinco detectadas: quitar el campo del dict del resumen, hardcodear el color
del catálogo, ensanchar el permiso de la baja a `editor`, volver `minChars` al default de 2, y
tragarse el error de `moveItems`. Además `tsc` marcó que el mock de `GET /carriers` tenía la forma
inventada (`total` en vez de `count`/`facets`) — un test verde que no decía nada del contrato.

---

### 2026-08-21 (cont.) — Ronda 139: la reunión con Webcarga, y cerrar bien lo de la 138

Se revisó la reunión **Webcarga 2.0** (21/08, Pablo Abumohor y Fabián Méndez) contra el código y
contra la base. Tres pedidos de la reunión ya estaban hechos en la Ronda 138; una revisión encontró
que dos tenían huecos que los volvían peligrosos. **Todo lo de abajo está medido.**

**El defecto que ordenó la prioridad.** `_PENDING_ROWS_SQL` filtraba `c.operational_status = $8` con
`ACTIVE` **fijo**, así que dar de baja una empresa dejaba su ficha vacía y la pantalla leía ese cero
como *"todavía no tiene requisitos asignados"* — falso, y **un mensaje con dos causas** por sexta vez
en este módulo. No era hipotético: **2 empresas `INACTIVE` con 24 registros y 207 `LEGACY_INACTIVE`
con 2.484** ya eran invisibles. Es el mismo hueco que Pablo describió como *"me falta ese directorio
que tenía yo antes… de las trescientas, cincuenta activas y doscientas cincuenta inactivas"*.

**El criterio, ahora en un solo lugar** (`_estado_de_empresa_a_mostrar`): sin `carrier_id` es la
sábana global —"qué hay que hacer hoy"— y ahí el filtro por ACTIVE se queda, porque existe por un bug
medido (5.4: más de la mitad del volumen eran inactivas). Con `carrier_id` es el expediente de UNA
empresa, y ahí el filtro sobraba. **La cola de trabajo no es el expediente.**

Los otros cuatro arreglos: la baja no invalidaba las raíces de Certificación (60 s con la cabecera
diciendo "Inactivo" y el cuerpo mostrando 457 requisitos); el selector de empresa de la Bandeja
operaba sobre **todos** los `targetIds` con copia en singular; `onToggleAll` no aplicaba la regla de
homogeneidad por empresa que `handleToggle` sí aplica —la única puerta por la que se colaba una
selección heterogénea—; y `reactivarEmpresa()` era una promesa rechazada sin manejar.

---

## Decisiones de arquitectura de esta ronda

- **Dar de baja archiva, no oculta.** Es el estándar de gestión de proveedores (Avetta, ISNetworld,
  Ariba SLP) y hay tres razones, en orden de peso: el historial de cumplimiento es material de
  auditoría; la baja sirve para sacar a la empresa de las **colas de trabajo**, no del registro; y al
  reactivar lo primero que se necesita ver es **qué se venció durante la baja**.
- **`minChars={0}` fue un error mío de la Ronda 138, revertido.** Descarté `showMinCharsHint` como
  "una prop que miente" y era al revés: sin mínimo, `GET /carriers` sin `q` ordena por
  `compliance_health PENDING` y `pending_mandatory DESC` y **sin filtrar por estado**, o sea que
  precargaba las diez empresas peor certificadas, incluidas las dadas de baja.
- **El sistema visual no tiene token de "acción destructiva".** `espera` y `status-incidente`
  comparten el valor `#b00020` y no el significado. El botón de baja toma prestado el de alerta;
  cuando el token exista, es uno de sus llamadores. El trinquete **bajó de 1.755 a 1.753**.

## Lo que la mutación encontró

Seis mutaciones. Cinco detectadas, y **una reveló un test falso**: al quitar
`invalidarCertificacion` el test de invalidación seguía verde. La mutación había caído en
`ejecutarBaja` (línea 478) y no en `cambiarEstadoEmpresa` (507) — o sea que el test estaba bien y la
mutación estaba mal. Es exactamente el modo de falla que la memoria del proyecto ya registra:
**verificar dónde quedó la mutación antes de leer el resultado.** De paso quedó a la vista que la
baja de un conductor tampoco tiene test de refresco.

## Higiene: el repo era 89% virtualenv (RESUELTO, commit `e7c53d24`)

De **10.639 archivos trackeados, 9.498 eran un virtualenv**. Había **TRES entornos trackeados a la
vez** —`monitor-app/backend/api/.venv`, `monitor-app/backend/api/venv` y `monitor-app/backend/venv`—
más 202 `.pyc` del propio proyecto y 2 `.DS_Store`. El costo no era el tamaño: **cada corrida de
pytest reescribía cientos de `.pyc`** y dejaba el `git status` ilegible, que es como un diff deja de
poder revisarse.

`extraction_service/.gitignore` ya tenía las reglas —por eso ese servicio estaba limpio— y
`monitor-app/.gitignore` sólo cubría `.env`. Ahora están en la raíz.

**Trackeados: 10.639 → 937.** Se usó `git rm --cached`, así que los archivos siguen en disco:
verificado que los tres entornos quedaron completos (2.715 / 5.043 / 1.729 archivos) y que el que
usan los tests corre. La prueba de que sirvió: después de correr pytest, el `git status` ya no
muestra ningún `.pyc`.

Los tres `.env` trackeados se revisaron y son `.example` — plantillas, sin secretos.

**Queda uno del mismo tipo, sin tocar**: `logextraction.txt` está en `.gitignore` pero sigue
trackeado (el ignore no destrackea) y ya está borrado del disco.

---

## Desplegado en dev, y dos incidentes del camino

Merge `196df76c` a `dev`. **Deploy Monitor API y Deploy Frontend, los dos en verde**, verificado
contra los servicios vivos y no contra el `success` del workflow: frontend HTTP 200,
API `/health` 200, y `/compliance-records/summary` responde **401 y no 500** — el SQL nuevo no lo
rompió.

**Incidente 1 · `git rm --cached` NO conserva los archivos al cruzar de rama.** Los conserva en la
rama donde se ejecuta. Al hacer `checkout dev` —donde los venv seguían trackeados— git los
restauró, y el merge aplicó las bajas: **los tres entornos desaparecieron del disco.** Se
recuperaron con `git archive d8da54cf -- <ruta> | tar -x`, que escribe a disco sin tocar el índice,
y se verificó que corren (89 tests en verde), no sólo que los archivos estén.

**Incidente 2 · un push grande apaga el filtro de rutas de GitHub Actions.** El push llevaba ~9.700
borrados y **Deploy Frontend NO se disparó**, pese a que el merge toca `monitor-app/frontend/**`.
Deploy Monitor API sí, pero **por el motivo equivocado**: el venv borrado cae bajo
`monitor-app/backend/api/**`. Se lanzó a mano con `workflow_dispatch`. Es la SEGUNDA vez que un
deploy se da por hecho sin mirarlo (la primera, Ronda 136). Con un cambio masivo de archivos, hay
que **verificar qué workflows corrieron**, no asumir.

---

## El click-through, HECHO — y encontró cuatro defectos que la suite no vio

Con Playwright contra dev, sobre el código ya desplegado. Los cuatro sobrevivieron a **1.257 tests
en verde, `tsc` limpio y `npm run build` OK**. Commits `c26a6d0a` y `a3f6e269`.

1. **La patente desaparecía en teléfono.** En 390px, un vehículo con DOS insignias mostraba
   `Rampla · Furgón Congelado / Refrigerado` y **ninguna patente**: medido, el elemento del nombre
   daba **0px** de ancho contra 51px en los de una sola insignia. Tenía `truncate` y todo lo demás
   de la fila `shrink-0`, así que era lo primero que el flexbox sacrificaba — **las insignias
   empujaban fuera justo lo que venían a anotar**. Ahora la patente es `shrink-0`.
2. **Un desplegable muerto arriba del que sirve** (lo reportó el usuario). Sin empresa, "¿A quién
   pertenece?" no tiene opciones y quedaba con "— Seleccionar —", **encima** del buscador que sí
   funciona: lo primero que se ve es lo que no anda.
3. **Tres cajas de "Buscar empresa" a la vez.** El selector del lote se retiraba con la selección
   activa pero no al ENFOCAR un archivo, que es justo cuando aparece el del panel.
4. **El banner mentía.** La ficha de una empresa dada de baja decía "no se le puede cargar nada
   nueva" con **SEIS controles de carga habilitados** debajo: se guardó el puente a la Bandeja y no
   los controles por renglón. `canEdit` pasa a derivarse de rol **Y** estado de la empresa.

**Y el arreglo de (1) destapó otro**: al dejar de sacrificar la patente, la carrocería pasó a
truncarse en **"F"**. Una letra suelta no es un dato, es ruido con forma de dato — se oculta bajo
`sm` en vez de mostrarse partida (`a3f6e269`).

**Verificado después, en el mismo ambiente**: patentes de 0px → 46-52px; controles de carga de 6 →
0 con los documentos igual visibles; cajas de "Buscar empresa" de 3 → 1; 12 carrocerías completas
en escritorio; **0 errores de consola**.

**La lección, que ya es la tercera vez**: ningún test unitario ve un renglón que se parte mal. La
regla del `AGENTS.md` —"mirar la pantalla, en escritorio y en teléfono"— no es ceremonia.

### Y tres más, de la misma sesión de click-through

**5 · La acción de mover en lote se leía como deshabilitada.** El usuario preguntó por qué no podía
seleccionar varios archivos para asignarlos a una empresa — **y sí se puede**: `MoveToCarrierBar` da
"Mover los N a otra empresa". Usaba `text-gray-600` viviendo DENTRO de la barra de selección, que es
`bg-text-primary` (oscura). Medido: `disabled: false`, `opacity: 1` — funcionaba perfecto y se leía
apagado, al lado de "Descartar los N" que sí es blanco. **La pregunta la generó el contraste.**

**6 · "Hay 2archivos marcados"**, y al arreglarlo, "marcados.Deja". Es JSX comiéndose el espacio de
fin de línea entre nodos de texto. **El test afirmaba `/Hay 3 archivos marcados/` y PASABA**:
Testing Library compara contra `textContent`, que concatena los nodos, mientras el navegador colapsa
el borde. Un test de copia no puede afirmar espacios así. Se arregla poniendo la frase entera en un
literal, en vez de perseguir borde por borde.

**El límite real de la selección múltiple, que NO es un bug.** `classify-batch` es, por contrato,
*"aplica el MISMO requisito a N archivos"* (`item_ids` + UN `entity_id` + UN `requirement_id`).
Clasificar es llenar un casillero concreto, y dos archivos no pueden llenar el mismo: el segundo
pisa al primero y **de forma irreversible** —una vez escrito `replaced_storage_path`, el deshacer lo
rechaza—. El guardia nació de un incidente real: *"marcar 31 licencias y mandarlas al mismo conductor
destruía 30"*. Así que en lote se puede **mover a una empresa** y **descartar**; clasificar es de a
uno a propósito.

**7 · Y una regresión mía, que el propio código había advertido.** Al esconder el selector del lote
para evitar las tres cajas, envolví el **bloque entero** — y adentro estaba la línea *"Este lote es
de X"*. Dos líneas más abajo, el comentario decía textual: *"La empresa elegida, DICHA. Sin esto, el
estado gobierna a qué empresa se atribuye la tanda sin estar en pantalla"*. Reproducido en dev:
elegir empresa, enfocar un archivo, y el indicador desaparece mientras `empresaDelLote` sigue activo
y la zona de arrastre sigue aceptando archivos. **Lo que colisiona son las dos CAJAS DE BÚSQUEDA; el
indicador no es una caja.** Es la SEGUNDA vez que esta pantalla pierde ese invariante, así que ahora
tiene test propio, verificado con mutación.

**Lo que sí falta**, y es el pedido de fondo: asignar N archivos a N casilleros DISTINTOS en una
pasada. No existe endpoint para eso —`classify-batch` colapsa a un requisito— y es donde el
clasificador automático tendría su mayor rendimiento: proponer por archivo y confirmar todo junto.

### La Bandeja: de siete parches a una causa (commits `de99f2e1` → `fa4d1f54`)

El usuario cortó una cadena de arreglos con *"estás puro parchando y no mostrándome una solución
congruente, mantenible y basada en el patrón de desarrollo de la app"*. Tenía razón, y el análisis
que faltaba explicó los siete defectos de una vez.

**Diez representaciones de "empresa"** en `TriageWorkbench` —`carrierId`, `carrierName`,
`empresaInicial`, `empresaElegida`, `empresaDelLote`, `selectedCarrierId`, `subjectCarrierId`,
`carrierLabel` y dos cajas de búsqueda en dos componentes— más una tercera precedencia escrita
inline en la subida. **Cada defecto fue un choque entre un par de esas diez**, así que arreglar un
par generaba el siguiente. Ahora hay una: `useEmpresaDeTrabajo() → { empresa, origen,
sePuedeQuitar, fijar, quitar }`. Mismo movimiento que `canEdit` en la ficha.

`origen` (`'ruta' | 'archivos' | 'elegida' | 'ninguna'`) es el dato que faltaba: decide si ofrecer
la ✕. **Un hecho gana sobre una elección**, porque una elección que contradice al dato no se puede
aplicar.

---

## EL CLASIFICADOR NUNCA PRODUJO UN MATCH, y ésta era la causa

**67 archivos pasaron por la cola y ninguno generó un solo candidato.** No era el motor fallando:
corría sin error y no encontraba nada.

La cascada tiene cuatro ramas y **las cuatro exigen una señal EN EL NOMBRE** del archivo: RUT de
empresa, patente, RUT de conductor, o nombre de conductor difuso. El scope de empresa **sólo
limitaba el universo y nunca aportaba evidencia**, así que un documento de empresa
—`Carpeta_Tributaria_Regular.pdf`— no resolvía ni sabiendo de quién es.

Faltaba la rama más fuerte, la única que no deduce nada: **la empresa DECLARADA por una persona**.
Va primero en la cascada por eso. Se limita a requisitos de empresa a propósito — saber la empresa
no dice cuál de sus 12 conductores es.

Y la otra mitad: **el match corría UNA sola vez, al subir**, cuando todavía no había empresa. Ahora
`move_items` re-clasifica, reusando el MISMO motor y las mismas cargas que la subida. Sólo lo que
sigue sin clasificar: recalcular uno confirmado pisaría una decisión humana con una propuesta.

**Verificado en producción**: `Carpeta_Tributaria_Regular.pdf` → `AUTO`, empresa Inversiones Huemul,
requisito "Carpeta Tributaria", confianza 0.95, vía `EMPRESA_DECLARADA`. El otro archivo de la cola
quedó intacto y sin empresa — la asignación es sobre lo marcado, no sobre todo lo que no tiene,
porque barrer metería los de la empresa B dentro de la A.

## Decisiones de estas rondas

- **`EntityUniverse.scope_carrier_id` lo declara quien acota**, no se deduce de `len(carriers) == 1`:
  una base con una sola empresa activa daría el mismo valor sin que nadie haya acotado nada.
- **Una pantalla no advierte sobre algo que no ofrece.** El mensaje del lote se eliminó en vez de
  reescribirse: con varios marcados no se muestra el formulario. Con él se fue el vocabulario del
  modelo ("sujeto", "requisito"), que la regla del proyecto prohíbe.
- **Lo que va a escribir se dice ANTES de elegir.** Elegir empresa con archivos marcados los asigna;
  la ayuda lo anuncia, porque una escritura que se descubre después no es aceptable.

## Lo que el click-through encontró y ningún test veía

Siete defectos, todos con la suite en verde. Los más caros: **la patente medía 0px en teléfono**
cuando había dos insignias —las insignias empujaban fuera lo que venían a anotar—; el banner de
empresa dada de baja prometía que no se podía cargar con **seis controles habilitados** debajo; y
**un test de copia afirmaba un espacio que la pantalla no tenía**, porque Testing Library compara
contra `textContent` y el navegador colapsa el borde.

## Diseño

`monitor-app/docs/user-stories/20260821/02-hu-empresa-de-trabajo-en-la-bandeja.md`, con la tabla de
las diez representaciones y qué par produjo cada defecto. **Ojo: 19 HU en disco, 0 trackeadas** —
`/monitor-app/docs/` está en `.gitignore` por una regla escrita para PII de SharePoint, y las
historias cayeron de arrastre.

---

### 2026-08-21 (cont.) — Ronda 140: el documento se edita donde se ve, y un 500 que sólo apareció mirándolo

Commits `b6b198a5` (nuevo documento), `e5141dea` (celdas editables), `8cad098c` (el arreglo).
Frontend 1.292 tests en 133 archivos, backend 916, `tsc` limpio, `npm run build` OK, desplegado en
dev y verificado en vivo con Playwright.

**El usuario descartó el panel**: *"ese tab que aparece en certificaciones para configurar ese
documento, se me hace que es un paso innecesario y que basta que cada 'celda'/'item' de la variable
se pueda editar ahí mismo donde lo visualizo"*, y después *"las reglas se pueden ajustar ahí
mismo"*. Un rediseño anterior había sacado los controles de la fila por una razón buena —37
formularios abiertos, uno debajo del otro, 5.849 px— y esa razón sigue en pie: **lo que vuelve no
son 37 formularios simultáneos, sino una celda que se convierte en control al hacer clic, de a
una.**

**Lo que NO se perdió al mover las reglas a la tabla.** Guardar la regla y aplicarla siguen siendo
dos actos. La fila que cambió su regla ofrece "Ver qué cambia" con el número exacto antes de sembrar
—verificado en vivo: `Seguro EETT` de Opcional a Obligatorio mostró *"Se agregan 0 · se quitan 1"*
con su botón Aplicar, y no se aplicó—. Sin esa separación, un interruptor en una tabla sembraría
hasta 124 registros sin que nadie viera el número.

**Tres decisiones que quedaron escritas en el código, no en un documento aparte:**

- **El `requirement_code` se muestra y no se edita.** Es la llave de `requirement_filename_aliases`
  y del motor de match; renombrarlo dejaría al clasificador sin poder resolver ese documento.
- **Renombrar NO marca la fila como pendiente.** Ninguna tabla guarda copia del nombre —
  `compliance_records` referencia por id y todas las pantallas hacen JOIN vivo—, así que el cambio
  se ve al instante en todo el módulo. Se verificó en vivo: al renombrar `F43`, las etiquetas de
  las otras cuatro celdas de la fila lo siguieron solas.
- **Un tercer `requirement_level` no se colapsa en silencio.** `SHIPPER_REQUIRED` tiene cero filas
  y es un placeholder anterior a la taxonomía; un interruptor de dos estados lo volvería
  "Obligatorio" sin que nadie lo pidiera. Se muestra tal cual y no se toca — misma familia que los
  cinco `AssetType` de los que sólo existían dos.

**La condición ("Se exige a") sigue en el panel**, y es a propósito: es un multiselector de diez
subtipos, y meterlo en una celda sería volver a ser el formulario que este rediseño vino a sacar.

## EL 500 QUE LA SUITE NO PODÍA VER

Renombrar desde la pantalla devolvía **500**, con las 1.292 y las 916 en verde y `tsc` limpio. Lo
encontró el click-through, no un test.

`patch_requirement_conditions` maneja **tres** listas de columnas: la que LEE antes (para la
auditoría), la que ESCRIBE y la que DEVUELVE. Sólo la del medio se derivaba de
`_CONDITION_COLUMN_CASTS`; las otras dos estaban escritas a mano. Habilitar `name` y
`requirement_level` sin agregarlos al `SELECT` dejó a `log_change` pidiendo `current[field]` sobre
una clave que la fila nunca trajo: `KeyError: 'name'`.

**Por qué ningún test lo vio**: los que cubren ese endpoint usan `AsyncMock`, y un mock devuelve las
claves que se le dicen que devuelva. Es el mismo motivo de
`feedback_verify_new_sql_against_real_db`, por tercera vez.

**El arreglo no fue agregar las dos columnas que faltaban** — eso deja el problema intacto para el
próximo campo. Las tres listas pasaron a ser una, derivada de la whitelist. El test recorre
`_CONDITION_COLUMN_CASTS` con `parametrize` contra Postgres real, así que un campo nuevo queda
cubierto sin que nadie se acuerde de venir a agregarlo, **y falla en seco si entra sin valor de
prueba**. Verificado devolviendo el `SELECT` a la lista escrita a mano: reproduce el `KeyError`
exacto en los dos campos.

## Lo que la mutación y el click-through confirmaron

- Dos mutaciones sobre las guardas que importan: quitar `onGuardado?.(id)` mata los dos tests que
  sostienen la separación guardar/aplicar; quitar `|| !conocido` mata el del tercer valor.
- **Teléfono medido, no mirado a ojo**: a 390 px la página no desborda —la tabla scrollea dentro de
  su propio contenedor— y ninguna celda mide 0 px, que fue el defecto del click-through anterior.
- **Guardar cuenta como revisar**, y se ve: las dos filas que toqué quedaron marcadas
  "Felipe Sumadots · 21-08-2026" en la columna Revisión. Es el comportamiento declarado en el
  backend, no un efecto colateral.
- Ambos cambios de prueba se revirtieron: `F43` volvió a llamarse `F43` y `Seguro EETT` volvió a
  Opcional.

---

## SIGUIENTE PASO EXACTO

1. **Aprobación manual de a una y carga masiva de fechas.** Es lo que Pablo espera para poder
   trabajar: *"sería bueno poder subir de alguna forma las fechas nomás. La información que yo tengo
   en un Excel. Sin el documento"* — explícitamente NO quiere subir el histórico de 50 empresas.
   `PATCH /compliance-records/{id}` ya acepta `status`; el único llamador del frontend es
   `ExpirationDateCell` y sólo manda `expiration_date`. La exportación actual **no sirve de
   plantilla**: `limit: 200` sobre **5.026 pendientes**, y sus columnas no identifican la fila.
   **La patente no tiene RUT** (empresa y conductor por `tax_id`, vehículo por patente), y **1
   conductor de 87 no tiene `tax_id`**.
2. **La sincronización Monitor ↔ Certificación** (diseñada en el plan, sin ejecutar). Son dos
   poblaciones con fuentes distintas por diseño: el Monitor se resuelve **por trigger**, Certificación
   es **deliberada** (Excel de Mage + alta manual). El alta desde el Monitor vincula al conductor con
   los VIAJES y nunca con una EMPRESA. Medido: **68 viajes sin empresa**, de los cuales **47 tienen
   conductor que sí la tiene**; **0** tienen patente con empresa activa (la vía del vehículo está
   muerta); y **56 tienen empresa distinta a la del conductor — esas no se tocan**.
   - **Por qué el match manual "se revierte"** (el reclamo de Pablo sobre Edgar): de 25 links
     `manual`, **14 no tienen empresa y los 14 tienen conductor que sí la tiene**.
     `resolve_trip_fleet()` excluye los manuales para proteger la elección humana y de paso
     **congela el `carrier_id` nulo para siempre**.
   - Acordado: **las dos vías**. Automática en la resolución (llena el silencio, nunca contradice) y
     forzada en el Cierre (los 85 viajes sin conductor ni empresa, como pidió Pablo).
2. **La regla de cámara de frío**: el motor funciona, **el dato está mal**. `MANTENCION_FRIO` tiene
   como condición "los 9 subtipos que no son Tractocamión" = toda rampla, furgón seco y sider
   incluidos. Es un backfill de compatibilidad. **Se arregla desde la UI, sin código.**
4. ~~**Renombrar documentos a F30 / F30-1 / PTS**~~ — **HECHO** en la Ronda 140, y sin migración:
   la columna `name` ya existía, faltaba la puerta. También se puede crear documentos nuevos (nacen
   sin vigencia) y cambiar obligatorio/opcional desde la misma celda. `requirement_code` sigue
   deliberadamente fuera de la whitelist.
5. **Sodimac multiorigen** (#5/#6): la reunión cerró la definición que faltaba — el cierre se evalúa
   **a nivel del ID del viaje**, no del origen. Pablo: *"Es que está finalizado o no, nada más… se
   trata igual"*. Y pidió no hacer cierres de Sodimac hasta reprocesar.

---

### Ronda 138 — el detalle

**Click-through en vivo, que todavía NO se hizo.** El `AGENTS.md` del frontend lo pide explícito
("mirar la pantalla, en escritorio y en teléfono") y ningún test ve un renglón que se parte mal.
Tres cosas concretas: las insignias en una empresa con ramplas (elegir una verificando antes en la
base cuál tiene subtipo cargado), el contraste de los colores del catálogo —son fijos, no responden
al tema— y el selector de empresa en la Bandeja sobre el único item `UNMATCHED` que hay.

Después, por valor de negocio:

1. **Aprobación manual de a una.** `PATCH /compliance-records/{id}` acepta `status` y su docstring
   dice literalmente *"un admin aprueba a mano sin archivo"*. El único llamador en el frontend es
   `ExpirationDateCell`, y sólo manda `expiration_date`. **Misma forma que los tres de arriba: la
   API ya lo hace y falta el botón.**
2. **Carga masiva por planilla** (pedida por el usuario, 2026-08-21). Diseño acordado: **un solo
   archivo** con columna "¿De quién?" e "Identificador" —RUT para empresa y conductor, **patente
   para vehículo, que no tiene RUT**— más una llave opaca del registro para que el match sea exacto
   al volver. Dos columnas se completan: vencimiento y tipo de aprobación. Fila en blanco no se
   toca. Vista previa antes de aplicar, como el resto del módulo.
   - **Ojo con lo que hay hoy**: `exportarPendientes()` pide `limit: 200` sobre **5.026 registros
     pendientes** (2.931 empresa, 1.060 vehículo, 1.035 conductor). Exporta el 4% y no lo dice. Y
     sus columnas no identifican la fila, así que no sirve como template de ida y vuelta.
   - **1 conductor de 87 no tiene `tax_id`**: con match por RUT no entra nunca, y hay que decirlo.

---

### 2026-08-20/21 — Rondas 134-137: la ficha de empresa terminada, baja y transferencia, y el tráfico contra la API

Cuatro ramas, todas mergeadas a `dev` y desplegadas. **Todo lo de abajo está medido, no estimado.**

**R134 · La ficha de empresa** (`feat/ficha-empresa`, merge `a39eef9e`). Certificación mostraba sólo
lo que a una empresa le FALTA; los documentos cargados eran invisibles en todo el módulo.
`/pending` gana el parámetro `estado`, la ficha `/dashboard/compliance/[carrierId]` muestra empresa,
conductores y vehículos juntos, y el módulo se parte en dos entradas del sidebar — Empresas y Sin
clasificar — con la Bandeja en ruta propia. La cola avisa colisiones: `mismo_contenido`,
`mismo_casillero` y `casillero_ocupado`, tres señales distintas y ninguna reemplaza a otra.

**R135 · Dar de baja y transferir desde la ficha** (`feat/baja-y-transferencia`, merge `a0066619`).
Casi no hubo backend: asignar al destino ya desactivaba la asignación previa —eso ES la
transferencia— y el `DELETE` ya era la baja. Lo que sí se corrigió: transferir una asignación
protegida por `is_manual_override` dejaba dos filas `ACTIVE` y salía como un **23505 crudo**; ahora
es un 409. Permisos: `editor` para transferir y dar de baja **de la empresa**; la baja del SISTEMA
(`operational_status`) se queda en `admin` — nunca tuvo otro valor que `ACTIVE` en 87 conductores y
124 vehículos, y esa línea se corrió sola dos veces durante la rama.

**R136 · El tráfico frontend↔API** (`perf/compresion-y-resumen`, merge `11fe04fa`). Medido en dev:

| | Antes | Después |
|---|---|---|
| Bytes al abrir la ficha | **57.183** | **2.299** (−96%) |
| Compresión al navegador | 0% | 72% |

Nadie comprimía en el salto que ve el usuario: el `fetch` de Node descomprime solo, así que lo que
comprimía FastAPI se perdía en el proxy, y Next comprime su HTML pero **no las respuestas de los
Route Handlers**. De paso se cerró una corrupción viva: `res.text()` sobre toda respuesta hacía que
la descarga de documentos en zip llegara con el **68,8%** del archivo convertido en U+FFFD.

**R137 · Corregir la fecha de vencimiento** (HU-26, commits `18cf8f9a` + `65a76105`). Era lo único
que todavía obligaba a salir al módulo Empresas viejo. **No se construyó nada**: `ExpirationDateCell`
ya existía y estaba probada, vivía en el lugar equivocado.

---

## Decisiones de arquitectura de estas rondas

- **Un valor no puede cargar dos significados.** Aparecieron SEIS en estas rondas y ninguno lo halló
  un test: `urgencia='FALTA'` que también decía "no entró en ninguna rama"; `mismo_casillero=1` que
  decía "sin colisión" y "sin colisión que yo pueda ver"; `mismo_contenido=1` que agregaba "sin hash,
  no lo sé"; `tiene_archivo` deducido del status; una guarda de NULL que no guardaba nada; y
  **`falta` como dos conjuntos distintos en la misma pantalla** —el chip decía 1 y la lista mostraba
  2, con 3 registros `POR_VENCER` reales—. Los seis los encontró **una revisión leyendo código**.
- **La política del requisito manda, no el archivo.** Declarar un vencimiento sin tener el escaneo es
  deliberado: así se sigue qué vence antes de subir los ~2.000 documentos.
- **Comprimir en el proxy y no en el backend.** Lo estándar es que el proxy no toque la codificación,
  pero eso exige dejar `fetch` —que descomprime solo— por una dependencia nueva. Se eligió el proxy
  a sabiendas: pone la CPU en el frontend, que es el servicio que escala con usuarios. **Revisar el
  día que haya un balanceador con CDN delante.**
- **NO apuntar la API al pooler de transacciones.** Medido: la API sostiene 3-5 conexiones ociosas,
  no 25, y el modo transacción obliga a apagar el caché de sentencias preparadas — 25-30 ms por
  consulta, documentado en `db.py`. Cambiaría un techo que no estamos tocando por latencia real.

---

## Cómo se trabaja desde acá (acordado con el usuario, 2026-08-21)

El usuario planteó que nos demoramos más en verificar que en desarrollar, siendo esto un MVP.
**Medido: la relación tests/código es 1,0-1,4x**, o sea normal. El tiempo no se iba en escribir
tests: se iba en la ceremonia alrededor.

- **Una sola revisión por rama**, sobre el diff completo. La cadena pesada —revisión por tarea +
  re-revisión + revisión final + ola + re-revisión— sólo para lo que toca datos, dinero o permisos.
- **Tests sólo donde el código puede mentir en silencio**: conteos, predicados, permisos. No para
  verificar que un componente renderiza.
- **Mutación sólo sobre esos.** Y verificando que el archivo cambió antes de leer el resultado: una
  mutación que no se aplica se ve idéntica a un test que sobrevive (pasó).
- **Nada de subagentes para cambios chicos y bien especificados.** Ocho ejecutores se colgaron
  esperando corridas en segundo plano y hubo que rematarlos; hacerlo inline es más rápido.
- **Medir en dev después de desplegar.** Eso destapó el 0% de compresión, confirmó el −96%, y
  destapó que yo daba por desplegado un commit leyendo el `success` del anterior.

---

## Lo que quedaba abierto al cerrar las Rondas 134-137

(El siguiente paso vigente es el de la Ronda 138, más arriba. Esto sigue pendiente y no se hizo.)

**Verificar `Certificado de Antecedentes`**: tiene política `REQUIRED` y su registro cargado **no
tiene fecha**. O se cargó antes de que la política existiera, o hay un camino que deja pasar sin
fecha. Hay que mirarlo **antes** de construir nada encima, porque si ese camino existe, la HU-26 lo
tapa en vez de cerrarlo.

Después, por valor de negocio y en este orden:

1. **La ficha vieja de Empresas dispara 7 peticiones al abrirse** contra un límite de **60 cada 10 s
   por IP compartido con toda la app** (`proxy.ts`). Abrir tres empresas seguidas son 21. El usuario
   vio un 429 real en dev. Agregar esas 7 en un endpoint de vista es el trabajo.
2. **HU-26, límite conocido**: se puede corregir una fecha pero **no borrarla** — el `PATCH` usa
   `COALESCE(expiration_date)`, así que vaciar el campo responde *"Ningún campo enviado"*. La celda
   ofrece vaciarlo y el resultado es un error confuso.
3. **Issue [#7](https://github.com/fsotosa-ops/webcarga/issues/7)**: 12 puntos, 10 abiertos. El más
   caro es PostgREST recargando su caché por DDL en `bronze` —~12 min de CPU al día— pero **es el que
   menos se siente**; el que se siente es `sync_habitual_drivers()` a 23 s de promedio.

**Nada de esto bloquea.** La ficha, la baja, la transferencia, la compresión y la corrección de
fechas están desplegadas y verificadas en dev.

---

### 2026-08-19 (cont.) — Ronda 133: dos colisiones de carga masiva, APARCADAS con su evidencia

Encontradas al revisar qué faltaba después de conectar el clasificador. **No se ejecutaron** — el
usuario redirigió a cerrar la ficha de empresa primero. Quedan acá con todo lo necesario para
retomarlas sin volver a investigar.

**A · Dos archivos pueden reclamar el mismo casillero, y nada lo señala.** `classify-batch` ya se
protege de un caso parecido —`if len(set(body.item_ids)) > 1: raise 422`— y su docstring cuenta por
qué: *"Marcar 31 licencias y asignarlas al mismo conductor destruía 30"*, y los N-1 quedaban
invisibles **e irreversibles**, porque desde el segundo `_apply_stored_document` escribe
`replaced_storage_path` y el deshacer los rechaza.

Pero ese guardia cubre *un lote a un casillero en una sola operación*. **El clasificador que se
conectó en la Ronda 131 propone el mismo `(entity_id, requirement_id)` a dos archivos distintos**, y
el operador los confirma uno por uno — que es exactamente lo que el guardia permite. Antes esto
pasaba sólo si alguien se equivocaba; ahora el sistema lo invita, porque los dos llegan
pre-etiquetados al mismo destino.

**B · `content_sha256` existe en la tabla y no lo escribe nadie** (verificado: 0 valores distintos
sobre 65 filas). Ni los duplicados exactos se detectan.

**La forma que corresponde, y sigue el patrón que el módulo ya tiene**: la consulta de la cola
deriva señales en una sola pasada —`jsonb_array_length(i.candidates) AS candidate_count`—, así que
las dos van igual, con `count(*) OVER (PARTITION BY …)` y guarda de NULL (sin ella, los 60 items
`UNMATCHED` con `entity_id` nulo se agrupan como si reclamaran todos el mismo casillero). El hash se
calcula en `upload_document_version`, donde `data` ya está leído.

Y hay que mantenerlas **separadas aunque compartan forma**, porque piden acciones distintas: mismo
contenido → "este archivo ya está en la cola, borrá uno"; mismo destino → "dos archivos distintos
reclaman el mismo casillero, elegí cuál".

### 2026-08-19 (cont.) — Ronda 132: la revisión final de `feat/clasificador-bandeja`, los 10 hallazgos arreglados en una pasada

La rama conectó el motor de clasificación de documentos (Tareas 1-2 del plan
`2026-08-19-conectar-el-clasificador`) y pasó sus revisiones por tarea, pero la revisión final de
la rama encontró 1 crítico y 9 importantes/menores. Se arreglaron todos, cada uno con test nuevo
mutado antes de darlo por bueno. Reporte completo:
`.superpowers/sdd/2026-08-19-conectar-el-clasificador/task-fix-report.md`.

**El crítico**: `document_matcher.py` sacaba al conductor del match difuso cuando su RUT aparecía en
el nombre del archivo (`LICENCIA_<nombre>_<rut>.pdf` daba UNMATCHED), y el comentario declaraba un
rescate ("ya resuelto por identificador fuerte más abajo") que no existía. Se agregó la rama de RUT
para conductores, simétrica a la de empresas — único cambio autorizado al motor esta ronda.

**Decisiones de arquitectura**:
- La bandeja global (sin `carrier_id`) ahora filtra `matcher_io.py` por `FUNNEL_ACTIVE_STATUSES`
  (la misma constante de `compliance.py`, no una lista nueva): 207 de 248 empresas eran
  `LEGACY_INACTIVE` y se proponían igual al 0,95. Con `carrier_id` fijo (el operador ya eligió la
  empresa desde su ficha) no se filtra — esa empresa es el destino querido aunque esté de baja.
- El dedup de candidatos duplicados (mismo RUT dos veces en el nombre, ej. `F30_<rut>_ANEXO_<rut>`)
  se implementó en `document_ingest.py` (el llamador), no en el motor — la restricción de esta
  ronda era "sólo el arreglo del punto 1 en `document_matcher.py`". Como el motor ya devuelve la
  lista ordenada por confianza, deduplicar quedándose con la primera aparición después de ese sort
  da el mismo resultado que ordenar después de deduplicar.
- `AMBIGUOUS` ya no escribe un ganador arbitrario: `entity_type`/`entity_id`/`requirement_id`/
  `confidence` quedan NULL; `candidates` conserva la lista completa para que `classify-batch` la
  preseleccione en el futuro.
- El invariante "el catálogo cubre el 100% de los requisitos" (`test_matcher_io.py`) se invirtió a
  un piso ("no baja de los 37 que hoy tienen alias") — el original ponía la suite roja el día que
  Operaciones agregara un requisito legítimamente sin alias todavía.
- `asyncpg` devuelve columnas `JSONB` como `str`, no como `dict` — confirmado con una consulta
  directa antes de escribir el test de integración del punto 5, no asumido.

**Verificación**: suite rápida 724 passed (antes 720), suite de integración 133 passed en 6:51
(antes 128) — corrida completa, sin matar a mitad. Frontend: 153 passed en `components/compliance/`,
7 passed en los trinquetes visuales (`sistema.test.ts`/`escala.test.ts`/`espanol-neutral.test.ts`,
ningún margen se movió), `tsc --noEmit` limpio. 9 mutaciones aplicadas y restauradas, las 9
mataron su test correspondiente sin necesidad de reescribir ningún assert.

**Commits**: `a03bbc40` (RUT conductor), `b4d43605` (empresas de baja + invariante + simetría
assets), `ade6d243` (dedup + AMBIGUOUS null + error + contador del lote), `d06b165b` (integración
real de las 6 columnas), `4418e0c2` (copy del guion en `TriageFileTable.tsx`).

**Siguiente paso exacto**: ninguno pendiente de este brief — los 10 hallazgos están cerrados y
verificados. Lo que sigue es responsabilidad del coordinador: decidir si la rama se integra a `dev`
(ver skill `finishing-a-development-branch`) y, fuera de esta rama, retomar el click-through
bloqueado por credenciales que ya estaba anotado en "Próxima sesión" más abajo.

### 2026-08-19 (cont.) — Ronda 131: código muerto borrado, y la jerarquía de roles deja de estar escrita diez veces

Salió de dos instrucciones del usuario: *"todo código muerto/huérfano y frankenstein se borran o
refactorizan y se apalancan a la arquitectura y patrones de la app"* y *"nada de duplicación de
código; si algo se usa para más de un componente debería ser capaz de adaptarse eficientemente"*.

#### El caso que las ilustra a las dos a la vez

**`hasRole` en `lib/types.ts` estaba escrita y no la llamaba nadie.** Mientras tanto, la jerarquía
que esa función define estaba copiada **diez veces en siete archivos**, con dos formas distintas:

| Forma | Dónde |
|---|---|
| `new Set(['editor','admin','owner'])` y su gemela de admin | 8 lugares, en `hooks/` y en 4 páginas |
| `role !== 'admin' && role !== 'owner'` | `admin/layout.tsx` |
| `u.role === 'admin' \|\| u.role === 'owner'` | `usuarios-tab.tsx`, `UsersTable.tsx` (×2), `Sidebar.tsx` |

Y no era sólo la constante: **cuatro páginas reimplementaban el hook entero adentro de un
`useEffect`** — sesión, consulta del perfil y comparación, copiado a mano.

**Por qué importa, y es la parte que no se ve**: agregar un rol obligaba a acordarse de siete
lugares, y olvidarse de uno **no rompe nada**. Simplemente esa pantalla le niega permiso a alguien
que sí lo tiene, sin error y sin aviso. Es la misma familia que
[[feedback_null_sentinel_double_duty]]: el fallo es silencioso y sólo se ve mirando.

#### Qué quedó

- **`hooks/useRolMinimo.ts`** — UNA implementación parametrizada por el nivel mínimo, no dos hooks
  parecidos. `useCanEdit` y `useCanAdmin` **conservan su nombre** y pasan a ser una línea: "puede
  editar" es el concepto que usan las pantallas y `'editor'` es un detalle de la jerarquía.
- **`hasRole` dejó de estar muerta**: es la única definición del orden, y la consumen el hook, el
  `layout.tsx` del servidor —que no puede usar un hook y comparte la **regla**, no el mecanismo— y
  las cuatro comparaciones de las tablas de usuarios.
- **Un `vigente` que las copias no tenían**: el hook cancela la escritura de estado si el componente
  se desmontó antes de que vuelva la consulta.
- **`lib/permisos.test.ts`**, 5 tests, que es lo que impide que vuelva: prohíbe el `Set` de roles,
  prohíbe la comparación a mano *incluso en el servidor* (la décima copia tenía otra forma y no se
  veía buscando "Set"), y prohíbe reimplementar la consulta del perfil **en el cliente** — los
  server components quedan fuera a propósito, porque gatear una ruta antes de renderizar es otra
  cosa y es legítima.

**`canManage` se dejó como está**, y es una decisión: "quién puede gestionar a quién" no es un
umbral de jerarquía (un admin no puede gestionar a otro admin). Forzarla al mismo molde sería el
frankenstein al revés.

#### La función muerta que yo mismo había dejado viva

Ayer dejé `documentIngestApi.uploadAndClassify` con cero llamadores y un comentario que decía "no la
uses". **Con la regla nueva eso es una trampa cargada**: la encuentra el próximo por búsqueda, la
usa, y reintroduce el defecto. **Borrada, 42 líneas.**

Y al borrarla apareció algo peor: dos tests la mockeaban y afirmaban
`expect(uploadAndClassify).not.toHaveBeenCalled()`. Sobre un mock de una función inexistente, **ese
test no puede fallar nunca**. Reemplazados por uno que fija el invariante que ahora sí es cierto —
que el módulo no la exporta— y que deja escrito por qué, para que no vuelva.

`upload` y `classifyBatch` **siguen existiendo por separado**: es lo que usa la Bandeja, donde el
archivo llega sin destino y clasificarlo después es el flujo correcto.

#### Verificación

`tsc` limpio · trinquetes visuales en margen cero otra vez (color **1.755/1.755**, sub-11px
**268/268**) · los 5 tests nuevos de permisos fallan si se revierte cualquiera de las diez copias.

### 2026-08-19 (cont.) — Ronda 130: la conexión a Supabase, auditada contra fsummer-platform

Salió de una pregunta del usuario —"¿estamos bien conectados?"— y terminó encontrando que **la API
sola podía dejar la base sin conexiones**. Nada de esto lo causó Certificación; se descubrió porque
la verificación de la Ronda 129 saturó el pooler.

#### El dato que ordena todo

```
max_connections = 60          ← medido, es una instancia chica
--max-instances = 5           ← deploy-monitor-api.yml
max_size = 10 por instancia   ← app/db.py, valor anterior
```

**5 × 10 = 50 de 60.** Y lo primero que se cae al llegar ahí no es la API: son los servicios
internos de Supabase (postgrest, el exporter, la mgmt-api), que ya ocupan ~9. Bajado a 5 → techo 25,
con un test que falla si alguien lo sube y que lleva el porqué escrito.

#### Dos cosas que afirmé mal y hay que dejar corregidas

1. **"El host `db.<ref>.supabase.co` no existe."** Falso: tiene registro **AAAA**, es **IPv6 puro**.
   Mi máquina no tiene IPv6, y `getaddrinfo` devolvía `gaierror` — que se lee como "no existe" y no
   lo es. Verificado contra 8.8.8.8, 1.1.1.1 y 9.9.9.9.
2. **"Producción está mal conectada."** También falso. `init_pool` corre en el `lifespan` sin
   `try/except`, así que si el DSN no conectara la API no arrancaría; y en `pg_stat_activity` están
   los **4 grupos de 2 conexiones desde `2600:1900:...`, el rango IPv6 de Google Cloud**. El secreto
   de Secret Manager está bien.

**Lo que sí está roto**: ese mismo DSN en `.env` y `.env.example` **no sirve desde un escritorio sin
IPv6**. Por eso `conftest.py` tuvo que armarse su propia conexión por el pooler en vez de leer
`DATABASE_URL`. Ahora `.env.example` documenta las dos URLs y cuál va dónde.

#### El bug que habría tumbado la API al desplegar

Escribí `statement_cache_size=0 if pooler else None`, dando por hecho que `None` era el default.
**Es falso**: asyncpg lo valida con `>= 0` y devuelve `ValueError`. **El test no lo detectó porque
mockeaba `create_pool`** — un mock nunca contradice a la librería. Apareció probando contra la base
real. Ahora el kwarg se **omite**, con un test que fija por qué para que nadie lo "simplifique".

Es la misma clase que [[feedback_verify_new_sql_against_real_db]], aplicada a la firma de una
librería en vez de a SQL.

#### El A/B que cambió la decisión

La intención era mover el `conftest` al pooler en **modo transacción** (6543), como
`fsummer-platform`. Medido con una sola variable:

| | |
|---|---|
| 5432 (sesión) | 3 tests en 56 s |
| 6543 (transacción) | **1 test en 3 minutos**, después `connection was closed in the middle of operation` |

El motivo es la forma de `conexion_revertida`: envuelve **cada test** en una transacción que dura
todo el test. En modo transacción el pooler fija el backend igual, pero contra un pool mucho más
chico — todo el costo y ninguna ventaja. **Se queda en sesión.**

Pero `app/db.py` **sí** sabe hablar los dos modos: detecta el 6543 por el DSN y apaga el caché sólo
ahí. Medido: 60 consultas concurrentes por el 6543 con el caché encendido → **44 fallan**
(`prepared statement "__asyncpg_stmt_3__" does not exist`); apagado → 0. Y no se apaga siempre
porque cuesta **una vuelta de red por consulta** (~25-30 ms desde Cloud Run).

#### Lo que hice mal, y la regla que queda

**Maté cuatro corridas de la suite a mitad.** En modo sesión cada conexión retiene un backend hasta
que expira, así que dejé la base sin cupo **~40 minutos** — no conectaba ni pytest, ni mis scripts,
ni el MCP de Supabase. La regla no es cambiar de puerto: **es dejar que la suite termine.** Y la
suite completa de integración hace la base inutilizable para el resto mientras corre, así que se
corre cuando nadie más la necesita.

#### Lo que consume la base de verdad (124 días de `pg_stat_statements`)

| Consulta | Llamadas | Total | Media |
|---|---|---|---|
| `SELECT name FROM pg_timezone_names` | 112.375 | **19,6 h** | 628 ms |
| Introspección de esquema (3 consultas) | ~113.000 c/u | **5,5 h** | 48-75 ms |
| Ingesta de Mage (`bronze.*`, `COPY`) | ~26.000 | 4,9 h | 200-1.200 ms |
| **`sync_habitual_drivers()`** | 142 | 58 min | **24,5 s** (máx **103 s**) |
| Resolución de flota · Certificación | — | **no aparecen** | — |

**Las 25 horas de arriba no las gasta nuestra aplicación**: son las 4 consultas que PostgREST corre
al recargar su caché de esquema, y lo hace ante cualquier DDL. Quien hace DDL constantemente acá es
dbt, en cada corrida de Mage. **Hipótesis a verificar, no confirmada.**

**Y Redis no resuelve esto**: el caché de la API no toca ni una de esas consultas. `app/cache.py`
está bien hecho —falla abierta, y sólo rutas públicas *porque el middleware corre antes de
`Depends(get_current_user)`*, lo cual impide un agujero real— pero cubre **2 de 55 endpoints GET**,
y su clave se arma a mano en dos lugares (el middleware y `invalidate_trips_meta_cache`). Es la
misma fragilidad que se corrigió en el frontend con `lib/queries/certificacion.ts`.

**Un aviso sobre el trigger de flota**: vi un `UPDATE app.trips SET fleet_link_id` corriendo 92
segundos, y lo reporté como problema en vivo. **No aparece entre los consumidores acumulados**, así
que casi seguro fue efecto de la saturación que yo causé. No hay evidencia de que sea rutinario.

#### Próximo paso exacto

1. [ ] **`sync_habitual_drivers()`** — 24,5 s de media, hasta 103. Es lo más lento de la base por
   llamada, y es código nuestro.
2. [ ] **Confirmar la hipótesis del DDL de dbt** contra la recarga de PostgREST. Si se confirma, se
   arregla en Mage.
3. [ ] **El plan de Supabase**: `max_connections=60` y agregar `pg_stat_statements` tarda *minutos*.
   Los arreglos de esta ronda compran margen, no lo quitan.
4. [ ] **Si se quiere que Redis rinda**: cachear DENTRO del endpoint (después de autenticar, con la
   clave incluyendo rol/usuario) y unificar la construcción de claves en una sola función.

### 2026-08-19 (cont.) — Ronda 129: la carga documental terminada, y el gesto es uno solo

Continuación directa de la Ronda 128. Se ejecutaron las **Tareas 3, 6, 7 y 4** del plan
`docs/superpowers/plans/2026-08-19-certificacion-carga-documental.md`. Queda la 9 (verificación en
vivo). El orden se cambió a propósito: **3 → 6 → 7 → 4**, porque 6 y 7 son las que vuelven visible
todo lo construido y la 4 no bloquea nada.

#### Tarea 3 · "Por vencer" deja de ser invisible, y la ventana tiene una sola definición

`app/services/vencimientos.py` — `DIAS_POR_VENCER = 30`, `por_vencer_predicate()` y
`vencido_predicate()`. Reemplaza **cuatro** copias escritas a mano, no tres: además de
`carriers.py:282`, `drivers.py:224` y `assets.py:233`, el embudo tenía la suya en
`get_certification_status`.

**Medido contra producción ANTES de tocar el predicado**, que es la parte que el plan marcaba como
"la que puede explotar": pendientes **5.035 → 5.038**. Los 3 que entran son una póliza de seguro que
vence en 3 días y dos revisiones de vehículo de "Comercializadora De Los Rios Ltda", las tres en
`APPROVED_MANUAL` con fecha futura — o sea, invisibles hasta el día en que fuera tarde.

**El embudo NO se movió, y se verificó fila por fila**: de las 2 empresas con algo por vencer,
ninguna cambia de etapa. Sólo se mueven los "N de M" (22→20 y 3→2). La razón es que la etapa
`renovar` la decide `vencido`, no `pendiente` — **queda anotado en el código**: ampliar `renovar` a
lo próximo a vencer cambiaría el significado de una etiqueta que operaciones ya usa, así que es
decisión de negocio.

**Un defecto propio, encontrado revisando mi propio diff**: la `urgencia` nueva no contaba
`status = 'EXPIRED'` como vencido, pero el embudo sí. Un registro marcado a mano y sin fecha habría
salido 'FALTA' en el cajón mientras el embudo lo contaba vencido — exactamente el desfase de dos
lecturas que este módulo ya tuvo. Hoy son **0 filas** (medido); se alineó igual, con un test que lo
fija y muere al revertirlo.

#### Tarea 6 · El cajón carga por el camino directo

`CarrierDrawer` soltó `TriageWorkbench` y el "Subir" de 42 × 17 px. La lista de lo que falta **es**
la superficie de carga, con `RenglonPendiente` por renglón. La Bandeja sigue existiendo como
**destino** —un enlace debajo de la lista—, que es lo que hacen 4 de los 5 productos del benchmark.

`complianceApi.uploadFile` **hubo que escribirlo**: el tipo `ComplianceFileUploadResult` estaba
declarado y ninguna función lo usaba, tal como la Ronda 128 ya había corregido en el plan.

#### Tarea 7 · La ficha legacy usa el mismo gesto — y acá el plan se corrigió

El plan decía "la fila de `DocumentChecklist` se reemplaza por `<RenglonPendiente>`". **Al leer el
componente, eso resultaba ser una regresión**: la ficha tiene círculo de estado, vista previa,
reasignación y edición de vencimiento, y `RenglonPendiente` no modela nada de eso. Reemplazar la
fila entera habría borrado funcionalidad viva; envolver una en la otra habría dibujado el nombre del
documento dos veces.

**Lo que se comparte es el GESTO, no el layout**: `hooks/useGestoDeCarga.ts` — recibir el archivo,
pedir la fecha si el requisito la exige, y no subir nada hasta estar completo. Es un hook y no un
componente por la misma razón que `useFilaAbierta`, que este repo ya escribió: *"devuelve props
sueltas y no un componente a propósito"*, porque las dos superficies tienen formas incompatibles.

**La prueba de que es uno solo**: mutar el hook mata tests **en los dos archivos** a la vez.

`DriverDetailPanel` y `VehicleDetailPanel` eran el segundo camino de carga —llamaban
`uploadAndClassify` a mano— y ahora consumen `useSubirDocumento`. **`uploadAndClassify` quedó con
cero llamadores en producción.** No se borró (retirar superficie de API es un cambio aparte), pero
su comentario ahora dice que no se use y por qué: subía antes de clasificar, y el comentario viejo
describía el archivo varado como una virtud.

**Un defecto que introduje y corregí antes de comitear**: al hacer la fila entera zona de arrastre,
soltar un archivo sobre un documento **ya cargado** lo reemplazaba en silencio. Se acotó la zona a
lo que falta; reemplazar sigue siendo un clic explícito. Con su test, que muere al ampliarla.

#### Tarea 4 · La política se edita desde Configuración

Cambio chico porque el patrón ya estaba: `patch_requirement_conditions` arma un UPDATE de ancho
variable desde una lista blanca. Se sumó `expiration_policy` ahí, al `sent_fields()`, al `RETURNING`
y al `SQL_CATALOGO`. El `Literal` del schema corta un valor inventado con **422 legible** en vez de
dejarlo llegar al CHECK y volver como 500.

En el panel: mismo criterio de dirty que `is_active` —**viaja sólo si cambió**, porque mandarla
siempre dejaría una fila de auditoría diciendo que alguien decidió algo que no decidió— y
resincronización del borrador, con test propio: el bug de draft sin resincronizar ya apareció tres
veces en este frontend.

#### Verificación

- **SQL nuevo contra Postgres real, con binding de verdad**: 9 placeholders contra 9 argumentos;
  `/pending` devuelve `total_count` 2.371 y el reparto de urgencia FALTA 197 / POR_VENCER 2 /
  VENCIDO 1 en la primera página. El checklist de un conductor real: **5 de 12** requisitos con
  política `REQUIRED` — el mismo número que el diagnóstico de la Ronda 128 predijo.
- **Cada test nuevo se mutó.** Nueve mutaciones distintas, todas matan su test. Una no mató nada la
  primera vez —la mutación no había aplicado por indentación— y se repitió hasta que sí.
- **Trinquetes visuales en margen cero otra vez**: color **1.755/1.755** (bajado de 1.765 en el
  mismo commit que migró `CarrierDrawer` a tokens) y sub-11px **268/268**. El código nuevo no agregó
  ni un color crudo ni un tamaño fuera de escala.
- El diff de los dos componentes de Certificación: **74 líneas agregadas contra 179 borradas**.

#### Próximo paso exacto

1. [ ] **Tarea 9 · El click-through en vivo.** Es lo único del plan que falta y lo único que no se
   puede probar sin pantalla. Contra `webcarga-frontend-dev`, con **Playwright** (la extensión de
   Chrome está apagada): abrir el cajón de **un sujeto sin documentos cargados** —los desplegables
   listan todo el catálogo, y ya se pisó un documento real por elegir a ojo—, subir uno con política
   `NONE` (baja el pendiente sin cambiar de pantalla), uno con `REQUIRED` (pide la fecha y no sube
   hasta ponerla), provocar un error y ver el motivo **en ese renglón**. Consola: cero errores.
   Después, confirmar que `document_ingest_items` de la última hora viene **vacío**: el camino
   directo no pasa por la bandeja.
2. [ ] **Desplegar.** La migración de `expiration_policy` **ya está aplicada** desde la Ronda 128,
   así que este despliegue no la necesita — pero `deploy-monitor-api.yml` sigue sin correr
   migraciones, así que confirmar la columna en dev antes de desplegar la API.
3. [ ] **Conectar el clasificador (P2)** — `document_matcher.py` son 307 líneas puras con 12 tests
   que **no llama nadie**: `document_ingest.py:70` inserta `match_status` literal `'UNMATCHED'`.
   Los 79 alias están sembrados y cubren los 37 requisitos, y la columna "Sugerencia" está
   construida y vacía. Es cableado, no diseño.
4. [ ] **La resolución polimórfica de `entity_id` está escrita 4 veces** (`CASE WHEN 'CARRIER' …
   WHEN 'DRIVER' THEN da.carrier_id`), sobre 12 archivos. Es el ítem P5 y sigue siendo el de mayor
   retorno estructural del módulo.
5. [ ] **Borrar `uploadAndClassify`** si nadie la reclama: quedó con cero llamadores. `upload` y
   `classifyBatch`, que sí usa la Bandeja, son independientes de ella.
6. [x] ~~Decisión sobre "deshacer"~~ — **RESUELTA por el usuario: no se ofrece.** Verificado que
   `DELETE /compliance-records/{id}/file` llama a `delete_document_version()`, que **borra el blob
   del storage**; no hay archivado intermedio. `RenglonPendiente` ya está escrito para no ofrecerlo
   si no llega `onDeshacer`, así que simplemente no se pasa. Corregir un error es subir el documento
   correcto encima, que es una corrección sin pérdida.

**Anotado para quien siga, y no es menor**: la suite completa del backend **no se puede correr de
un tirón mientras se consulta la base a mano**. Los tests de integración toman conexiones del pooler
en modo sesión, y matar corridas a mitad deja slots ocupados hasta que expiran — llegó a dar timeout
hasta el MCP de Supabase. Correrlas separadas funciona y es rápido:
`pytest -q -m "not integracion"` (25 s) y después `pytest -q -m integracion`.

### 2026-08-19 — Ronda 127: Certificación auditada, y los cimientos antes que la pantalla

Arrancó como "analizá lo pendiente y prioritario de Certificación" y terminó **corrigiendo tres
defectos estructurales del módulo**, uno de ellos vivo en producción. No se tocó todavía el
recorrido, que era la prioridad declarada: primero había que dejar de construir sobre lo que estaba
mal.

#### El dato que ordenó la prioridad

La respuesta salió de medir producción, no de leer el backlog:

| Medición (2026-08-19) | Valor |
|---|---|
| Registros de cumplimiento vivos | **5.122** |
| De esos, con un archivo cargado | **24** (0,5 %) |
| Última actividad sobre un registro | 2026-08-17 |
| Archivos que pasaron por la Bandeja | **65**, todos `DISCARDED`, todos del 2026-08-15 |

**El módulo está construido y no se usa para cargar documentos.** La Bandeja no recibió un archivo
real desde el día en que se construyó. Cargar los ~2.000 documentos es trabajo de negocio, pero ese
es el criterio de prioridad: lo prioritario es lo que le quita fricción a esa carga.

#### La causa de la fuga NO son los enlaces

Los cuatro puntos de fuga siguen donde estaban, verificado línea por línea. Pero redirigirlos no
arregla nada: **el enlace de salida es el único gesto que la fila ofrece.** De las cinco vistas del
módulo, sólo `empresas` y `documentos` tienen cajón; `conductores`, `vehiculos` y `requisitos` se
dibujan con `CertificationStatusTable`, que no abre nada.

Y un dato que corrige el encuadre: **la ficha legacy SÍ permite cargar hoy** — `CarrierDocumentsTab`
monta el mismo `TriageWorkbench`, y `DriverDetailPanel`/`VehicleDetailPanel` llaman
`uploadAndClassify` en vivo (HU-04 Task 10 revirtió la Ronda 88). Sus comentarios de cabecera dicen
*"Solo lectura desde Ronda 88"* y están obsoletos. El problema real es que **se pierde la cola de
trabajo**, no que afuera no se pueda cargar.

#### El usuario preguntó dos veces, y las dos cambiaron el plan

1. *"¿está basado en patrones robustos de diseño de sistemas?"* → auditar el propio plan mostró que
   "reusar `CarrierDrawer`" **propagaba tres defectos** en vez de arreglarlos. De ahí salieron R1,
   R2 y R3, y el orden cambió: **primero los cimientos, después la pantalla.**
2. *"¿no estás duplicando código y construyendo un frankenstein?"* → el plan decía "un cajón de
   sujeto **construido sobre el patrón de** `CarrierDrawer`", que es exactamente hacer un segundo
   que se parece al primero. **Corregido: `CarrierDrawer` gana una prop `subject?` opcional, no hay
   componente nuevo.** Es el criterio que este repo ya tomó para `TriageWorkbench` y que está
   escrito en su código: *"Es una sola prop opcional, no dos modos."*

#### R1 · Un bug vivo en producción: el cajón afirmaba un número que no era

`CarrierDrawer` pedía `listPending({ limit: 200 })` —el tope duro del endpoint—, ignoraba el `total`
que la respuesta **sí trae**, y escribía "Lo que falta · N documentos" con el largo del arreglo.

**Medido: "Inversiones Huemul Spa" tiene 381 pendientes.** Su cajón mostraba 200 y afirmaba que eran
200. Sin error y sin aviso. Otras cuatro empresas activas pasan de 90.

Arreglado en dos mitades:
- **Frontend**: usa `total` y declara el corte ("se listan los primeros N"). 3 tests, **verificados
  mutando el código**: al volver a `rows.length` mueren 2 de 3.
- **Backend**: `/compliance-records/pending` gana filtro `entity_id`. `entity_type` ya existía como
  `category`, así que el cambio es un solo predicado. **Verificado contra Postgres real con
  `PREPARE`/`EXECUTE`** —binding de verdad, no literales sustituidos—: 12 filas y `total_count` 12
  para un conductor real. Más un test que cuenta placeholders contra argumentos, igual que
  `/status`.

Esto es lo que hace innecesario filtrar en el cliente: la página que se filtraría viene truncada.

#### R2 · Un mecanismo de fila expandible, no tres

`CertificationFunnel` ya tenía `openRowId`/`onToggleRow`/`renderDrawer`. Copiarlo a la tabla daba
dos implementaciones y la vista Requisitos daría tres — la misma clase que el "universo de viajes
del día" escrito 14 veces.

Extraído a `hooks/useFilaAbierta.ts`: el hook con la regla de una fila abierta a la vez (y su razón
medida: 3.159px de cajón contra 633px de lista), más `propsDeFilaExpandible()`, que es el contrato
de teclado y ARIA. **Devuelve props sueltas y no un componente a propósito**: la fila del embudo es
un `<div>` y la de la tabla será un `<tr>`; un envoltorio obligaría a una a deformarse.

Se revisó antes si `AccordionSection` servía: no — tiene estado propio por sección y su markup
(`<section>`/`<button>`) es inválido dentro de una `<table>`.

#### R3 · Una sola fábrica de claves de caché, y dos claves muertas

`CLAVES_DE_LA_BANDEJA` era un arreglo mantenido a mano que cada componente ampliaba. Ya había
fallado una vez con `['document-ingest-items']`, que no existe en el repo. **Se encontró la
segunda**: `['compliance-pending']` estaba en la lista de invalidación y **ninguna consulta la
usaba** — React Query compara elemento por elemento, así que no alcanzaba a
`['compliance-pending-carrier-panel']` ni a `['compliance-pending-drawer']`. Invalidaba exactamente
nada.

Y esos dos nombres eran **dos entradas de caché para la misma consulta**, pedida por dos componentes
que se dibujan juntos.

`lib/queries/certificacion.ts` resuelve las tres cosas: `pendientes()` ES `['compliance-pending',
carrierId]`, así que la raíz que invalida y la clave que consulta salen de la misma función — una
clave inventada ya no compila. Una sola `invalidarCertificacion()`, sin agregados por componente.

**Efecto colateral verificado**: desapareció un error suelto de vitest que salía de importar la
constante desde `TriageWorkbench.tsx`, un módulo que los tests mockean.

#### Paso 0 · Los trinquetes visuales, que eran precondición

Medido antes de tocar nada: color **1.778/1.780** (margen 2), tipografía **279/279** (margen 0),
`<h1>` **9/9** (margen 0). Un cajón nuevo en el estilo de `CarrierDrawer` (~20 colores crudos, ~8
tamaños sub-11px) **rompía CI en el primer commit**, con un fallo ajeno a lo que se estaba haciendo.

Migrados a tokens y a la escala los tres archivos que igual se van a tocar. Color **1.778 → 1.765**,
sub-11px **279 → 268**, topes bajados. El diff fue **exclusivamente `className`**, verificado.

**Hallazgo que queda abierto**: el spec del sistema visual define cinco señales de color pero
**nunca resolvió la rampa de grises**. El trinquete cuenta `text-gray-500` como deuda y el sistema
no ofrece destino, así que el gris de texto secundario —el uso más común— no se puede migrar. La
tabla del §3.2 lista "informativo · dato de contexto · —" sin token: ése es el hueco.

#### Verificación

- Frontend: **1.113 tests** en 118 archivos, `tsc --noEmit` limpio, `npm run build` verde.
- Backend: **821 tests**.
- SQL nuevo ejercitado contra producción con parámetros reales.
- Los 3 tests de R1 **mueren si se muta el código** (comprobado, no supuesto).
- El diff de la consolidación: **64 líneas agregadas contra 85 borradas**, neto negativo.

**NADA ESTÁ COMITEADO**: los cambios están en el árbol de trabajo de `dev`.

#### Próximo paso exacto

1. [x] ~~Decidir el token de gris~~ — **HECHO**: `--informativo` agregado, y el código nuevo entró
   con margen cero sin sumar deuda.
2. [ ] **Click-through en vivo del recorrido nuevo** — es lo único sin verificar, y necesita
   credenciales reales. Entrar por Conductores, abrir el cajón de una persona **sin documentos
   cargados** (los desplegables listan todo el catálogo; ya se pisó un documento real por elegir a
   ojo), subir uno y ver bajar el pendiente sin cambiar de pantalla. Después, la columna Empresa.
3. [ ] **Paso 1 · Diseñar el recorrido** — `superpowers:brainstorming` + `frontend-design` +
   `ui-ux-pro-max`, contra Highway, RMIS (DAT), MyCarrierPackets, Fleetio y Samsara. **Tres
   preguntas que el diseño tiene que resolver**: (a) la vista Requisitos no tiene sujeto —su cajón
   sería "a quiénes les falta este documento", una superficie de carga en lote distinta; (b) el
   salto a la empresa necesita que la fila abierta viaje en la URL, y hoy `openRowId` es estado de
   página; (c) conductores y vehículos sin empresa activa no tienen `carrier_id` que los alcance.
   — sólo si al verlo en vivo el recorrido no convence. La mecánica ya está.
4. [x] ~~Paso 2 · `CarrierDrawer` gana `subject?`~~ — **HECHO**, commit `edbf1cc3`.
5. [ ] **Conectar el clasificador (P2)** — `document_matcher.py` son 307 líneas puras con 12 tests
   que **no llama nadie**: `document_ingest.py:70` inserta `match_status` literal `'UNMATCHED'`. Los
   79 alias están sembrados y cubren los 37 requisitos, y la columna "Sugerencia" está construida y
   vacía. Es cableado, no diseño, y es lo que cambia el orden de magnitud de cargar 2.000 documentos.
6. [ ] **Llevar a negocio las 7 decisiones de P3** (ver PENDIENTES VIGENTES), ninguna se destraba
   programando.

#### CIERRE DE LA NOCHE — la fuga cerrada, y el sistema visual completo

Se siguió y se terminó el Paso 2. Commit `edbf1cc3`.

- **`CarrierDrawer` ganó `subject?`** — una prop, no un componente hermano. Sin sujeto es el cajón
  de la empresa; con sujeto, el de esa persona o ese vehículo. Con un solo sujeto su lista va
  abierta: plegarla escondería lo único que el cajón muestra. Se acota **en el servidor** con el
  `entity_id` agregado antes.
- **`CertificationStatusTable` dejó de decidir a dónde se va.** Los tres enlaces al legacy ya no
  existen; el nombre abre el cajón y la columna Empresa navega dentro del módulo.
- **La fila abierta vive en la URL** (`?abierta=<id>`), no en `useState`. Con estado local había
  que sembrarlo desde un prop y resincronizarlo — el bug de draft que este frontend ya tuvo tres
  veces. En la URL no hay nada que resincronizar. `replace` y no `push`: abrir filas no es navegar.
- **La quinta señal del sistema visual, `--informativo`.** El spec §3.2 la declaraba sin token y
  ése era el gris del texto secundario: el trinquete lo contaba y no había a dónde migrarlo.
  Agregada al valor que ya usan sus 226 apariciones. **Los otros seis niveles de gris NO se migran
  en masa** — sería un cambio visual grande a ciegas; bajan cuando alguien toque esa pantalla.

**El número que prueba que el token era el bloqueo**: después de escribir todo el código nuevo,
color **1.765/1.765** y sub-11px **268/268**. El código nuevo no agregó ni un color crudo ni un
tamaño fuera de escala.

**Un bug propio que encontró un test**: la columna Empresa dibujaba "sin empresa" cuando había
empresa pero no handler — el aviso afirmaba algo falso. Séptima aparición de
[[feedback_null_sentinel_double_duty]] en este módulo.

**Los tests viejos afirmaban el comportamiento que esta ronda elimina.** Se reescribieron a lo que
ahora es cierto. El de "ningún `<Link>` prefetchea" —nacido de un 429 real, 104 llamadas a `/user`
en un minuto— se reemplazó por uno **más fuerte que lo cubre**: la tabla no enlaza fuera del
módulo. Sin enlaces no hay prefetch. Los 4 tests nuevos mueren al mutar el código: comprobado con
dos mutaciones distintas, no supuesto.

**Verificación final**: frontend **1.120 tests** / 118 archivos, `tsc` limpio, build verde;
backend **821 tests**. Comiteado en `dev`, **sin pushear**.

**Lo que NO se hizo, y hay que decirlo**: el click-through en vivo sigue **bloqueado por
credenciales** (el servidor redirige a `/login`, `.env.local` sólo trae un placeholder). Nada de
esto se vio funcionando en pantalla contra datos reales. Y la sesión de diseño visual
(`brainstorming` + `frontend-design` + `ui-ux-pro-max`) **no se hizo**: la superficie que la
necesitaba se achicó porque la respuesta resultó ser extender lo que existe, pero si al mirarlo en
vivo el recorrido no convence, esa sesión sigue disponible y es el lugar donde corresponde.

Tres decisiones tomadas por defecto, para objetar: la vista **Requisitos quedó fuera** del alcance
(su cajón es "a quiénes les falta este documento", otra superficie); la fila abierta viaja como
`?abierta=`; y conductores o vehículos **sin empresa activa siguen sin cajón** — el backend
resuelve la empresa por `driver_assignments` y no tiene ninguna, así que darles cajón prometería
una acción que no se puede completar.

Plan completo en `~/.claude/plans/necesito-que-analices-lo-shiny-puffin.md`.

### 2026-08-19 (cont.) — Ronda 128: la carga documental rediseñada, y dos tareas ejecutadas

Siguió a la Ronda 127. El click-through en vivo contra dev destapó **dos defectos**, y de ahí salió
un rediseño completo con spec y plan. Se ejecutaron las Tareas 1 y 5; el resto queda para mañana.

#### Lo que encontró mirar la pantalla, que los tests no podían ver

1. **`<tr role="button">` destruía la tabla.** El helper `propsDeFilaExpandible` imponía
   `role="button"`, y sobre un `<tr>` eso pisa el `role="row"` implícito: el árbol de accesibilidad
   quedaba como `button > cell`, celdas sin fila. **jsdom no computa roles**, así que la suite pasaba
   igual. Corregido: el rol lo decide el elemento (`null` para quien ya tiene uno), con un test
   `getByRole('row')` que sí lo detecta — Testing Library sí computa roles.
2. **La subida por requisito falla con 422 y deja el archivo varado.** `classify-batch` exige fecha
   de vencimiento y el botón "Subir" nunca la pedía: **5 de 12** requisitos de conductor, **8 de 10**
   de vehículo, 6 de 13 de empresa. Y `uploadAndClassify` **sube antes de clasificar**, así que cada
   rechazo dejaba el documento en la bandeja y el requisito vacío. Preexistente; el cajón de empresa
   ya lo tenía.

**Lo que NO se pudo reproducir**: el usuario reportó "no pasó nada" al hacer clic en Subir, y en
Chromium el selector **sí se abre**. La hipótesis viva es la ambigüedad de las dos superficies —el
dropzone de 1183×211 px manda a la bandeja, el "Subir" de 42×17 px clasifica directo—: pegarle al
grande y no ver cambiar el requisito se percibe como "no pasó nada".

#### El rediseño — spec `2026-08-19-certificacion-carga-documental-design.md`

Sesión de brainstorming completa con el visual-companion. **El hallazgo del benchmark cambió mi
propia recomendación**: de Highway, RMIS (DAT), MyCarrierPackets, Fleetio y Samsara, **ninguno tiene
una bandeja de triaje como camino principal**. Cuatro de cinco hacen que el casillero pida lo que
necesita; el triaje aparece sólo donde los documentos llegan sin pedirlos, y siempre como destino
aparte, nunca encima del casillero.

Elegido el **modelo A**: la lista de lo que falta *es* la superficie de carga. Decisiones del
usuario: las tres situaciones (onboarding, renovación, recepción) conviven; la fecha **depende del
requisito**; la ficha legacy entra al alcance.

**Hueco encontrado al medir**: "renovación" no tiene superficie en ninguna parte. El predicado de
pendiente es `expiration_date < CURRENT_DATE` — **ya vencido**. Un documento que vence en diez días
no aparece ni en el cajón ni en el embudo. Hoy: 9 vencidos, 3 en 30 días, 6 en 90. Y la ventana de
30 días está escrita a mano **tres veces** (`carriers.py:282`, `drivers.py:224`, `assets.py:233`).

#### La pregunta del usuario sobre normalizar, y por qué la respuesta es "no acá"

Preguntó si lo configurable no debería normalizarse en las tablas polimórficas. **Para las
condiciones: no** — son 37 requisitos y 4 dimensiones, y una tabla genérica de reglas cambia columnas
tipadas con `CHECK` por un `jsonb` que no es consultable ni validable. Es la forma que ya se rechazó
como "frankenstein". **El umbral quedó escrito**: cuando aparezca la tercera dimensión que exige
migración — la del anexo Walmart, "por cliente" — ahí sí conviene, con tres casos reales en mano.

**Pero la pregunta apunta a algo real, en otra tabla**: la resolución polimórfica de `entity_id`
está escrita **4 veces** (`CASE WHEN 'CARRIER' THEN … WHEN 'DRIVER' THEN da.carrier_id`), sobre
**12 archivos** que tocan las tablas de asignación. Es el ítem P5 del backlog y sigue siendo el de
mayor retorno estructural del módulo.

#### Ejecutado: Tareas 1 y 5 (commit `d833d835`)

- **Tarea 1 — migración aplicada y verificada.** `expiration_policy` con CHECK
  REQUIRED/OPTIONAL/NONE. Backfill conservador (`true → REQUIRED`) para que nadie quede más ni menos
  exigente que ayer. Medido después: REQUIRED 21, NONE 16, OPTIONAL 0; cero inconsistencias; cero
  nulos. `has_expiration` **no se borra**: tiene lectores vivos en cuatro routers.
  **El número esperado que yo mismo escribí en el plan estaba mal** (19/18 contra 21/16 real) — se
  corrigió el plan para que no mande a detenerse por un dato correcto.
- **Tarea 5 — `RenglonPendiente`.** El renglón entero es el blanco, recibe drop o clic, y pide la
  fecha ahí mismo. **Nada se sube hasta estar completo.** El estado es UN valor con seis formas, no
  cuatro booleanos (que darían dieciséis combinaciones para seis situaciones). 13 tests, **tres
  mutaciones mueren**. Entró con **cero** color crudo y **cero** tamaños fuera de escala.

**Dos decisiones de diseño que valen más que su tamaño**: la ausencia de política significa "no sé"
y se resuelve **preguntando sin exigir** (como `NONE` perdería una fecha necesaria; como `REQUIRED`
bloquearía documentos que no vencen); y sin `onDeshacer` el renglón **no ofrece deshacer**, porque
prometer una vuelta atrás que no existe es peor que no ofrecerla.

#### CIERRE — Tareas 8 y 2 también hechas

**Tarea 8** (`7785961a`): crear una empresa deja de empujar a `/dashboard/carriers`. Verificado:
`grep -rn "dashboard/carriers"` sobre `components/compliance/` y `app/dashboard/compliance/` no
devuelve **nada**. Los cuatro puntos de fuga están cerrados.

**Tarea 2** (`3741de31`): `/file` valida contra la política. **Valida ANTES de tocar storage**, y hay
un test que lo fija (`upload.assert_not_called()`); mover la validación después de la subida lo
rompe, comprobado. La política es del requisito, así que la consulta que ya existía se extendió con
el JOIN en vez de agregar una segunda vuelta. Verificado contra Postgres real con `PREPARE`/`EXECUTE`.

**Dos correcciones a documentos ya comiteados**: el spec y el plan afirmaban que el cliente del
frontend ya tenía el método de subida directa, citando `lib/api/compliance.ts:71`. **Es falso** —
esa línea es `deleteFile`; el tipo `ComplianceFileUploadResult` está declarado y ninguna función lo
usa. El método hay que escribirlo en la Tarea 6. Lo que sí es cierto: `apiFetch` ya maneja
`FormData` sin pisar el `Content-Type` y propaga el `detail` del backend como mensaje, así que el
422 llega al renglón como texto legible.

**Lo que destaparon los 16 tests de integración contra Postgres real**: la migración dejó la columna
`NOT NULL` **sin `DEFAULT`**, así que todo `INSERT` que no la nombre revienta. Se verificó que **no
existe camino de producción que inserte requisitos** (el catálogo se siembra por migraciones;
`requirements.py` sólo tiene GET, PATCH de condiciones y recálculo), así que **se deja sin `DEFAULT`
a propósito**: un default silencioso convertiría "nadie decidió" en "no vence", que es el defecto
que esta columna vino a corregir. El fixture de integración lo declara.

**Instrucción del usuario registrada, y es la que ordena lo que viene**: *"no repliques ni dupliques
código, que esto no se vuelva un frankenstein"* + *"necesito código robusto y mantenible"*. Ya está
escrito en el plan de la Tarea 6: la subida **no se implementa dos veces** — el cajón y la ficha
legacy consumen **un** hook `useSubirDocumento`, y **un** método de cliente. Dos implementaciones de
"subir un documento a un requisito" es exactamente cómo este módulo terminó con dos caminos de carga
que se estorbaban.

**Estado**: backend 825 tests, frontend 1.134, todo comiteado y pusheado a `dev`.
**`RenglonPendiente` está comiteado y en `origin/dev`, pero todavía no lo importa nadie** — la
Tarea 6 es la que lo vuelve visible.

#### Próximo paso exacto

1. [x] ~~Tarea 2~~ — **HECHA**. Y la Tarea 8 también.
2. [ ] **Tarea 3** — una sola definición de "por vencer". **Es la que puede explotar**:
   `pendiente_predicate()` alimenta `/pending`, el embudo y el cajón, y hay bug precedente
   documentado en `compliance.py:78-79`. Si los conteos del embudo se mueven, entender por qué antes
   de tocar nada.
3. [ ] **Tarea 6** — el cajón usa el renglón y suelta el dropzone. **Es la que vuelve visible todo
   lo construido.** Necesita escribir `complianceApi.uploadFile` (no existe) y el hook
   `useSubirDocumento`, **uno solo**, que la Tarea 7 reusa sin reimplementar.
4. [ ] **Tareas 4 y 7** — Configuración edita la política; la ficha legacy usa el mismo renglón.
5. [ ] **Tarea 9** — verificación e2e, incluido el click-through subiendo un documento real.
6. [ ] **Decisión abierta**: si "deshacer" una subida directa es posible sin borrar evidencia.
   `undo-classify` revierte una clasificación *de la bandeja*, y el camino directo no pasa por ahí.

Estimación restante: **~3 horas**, de las cuales cerca de una es esperar suites y deploys
(`pytest` completo tarda 8 minutos).

Plan en `docs/superpowers/plans/2026-08-19-certificacion-carga-documental.md`.

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

**PRIORIDAD PARA MAÑANA (pedido explícito del usuario, 2026-08-19)**

> **ACTUALIZADO en la Ronda 127**: los cimientos ya están hechos (R1/R2/R3 + los trinquetes) y la
> causa raíz quedó identificada — no son los enlaces, son las tres vistas sin cajón. Lo que sigue
> abierto de este ítem es el **diseño del recorrido** y el cajón por sujeto. La pregunta de alcance
> que estaba abajo **ya la respondió el usuario: todo queda dentro del módulo, incluida la columna
> "Empresa"**; `page.tsx:130` (crear empresa) queda afuera a propósito.

- [ ] **Certificación devuelve al usuario al Empresas legacy, y eso contradice la decisión ya
  tomada.** Al hacer clic en un conductor o un vehículo desde Certificación, se sale del módulo y se
  cae en la UX vieja de Empresas, que exige múltiples clics para cargar un archivo — justo lo que
  Certificación existe para reemplazar. **La dirección está invertida**: Empresas debía quedar
  solo-lectura con un link *hacia* Certificación (`?carrier_id=`), no Certificación empujando hacia
  Empresas.

  Los cuatro puntos de fuga, ya ubicados:
  - `components/compliance/CertificationStatusTable.tsx:73` → `/dashboard/carriers/{id}?tab=documentos`
  - `components/compliance/CertificationStatusTable.tsx:85` → `...?tab=conductores&driver={entity_id}`
    (o `equipos&asset=`) — **este es el que describió el usuario**
  - `components/compliance/CertificationStatusTable.tsx:105` → `...?tab=documentos`
  - `app/dashboard/compliance/page.tsx:130` → `router.push` al módulo viejo tras crear una empresa

  El módulo **ya tiene** la superficie correcta: `CarrierDrawer` (Ronda 89, panel por empresa dentro
  de Certificación, que reusa `TransporterSlideOver`/`BulkDocumentUploadModal`). Estos enlaces la
  saltean. Antes de tocar nada, leer lo que ya existe — la trampa acá es reescribir una versión peor
  de un panel que ya está resuelto al lado.

  **CÓMO ABORDARLO (pedido del usuario): no es redirigir enlaces, es diseñar el recorrido.** El
  requisito declarado es una experiencia **interactiva, inmersiva, autoexplicativa y de muy baja
  carga cognitiva**, validada contra el estándar de la industria antes de proponer nada. Corresponde
  `superpowers:brainstorming` (ofrecer el visual-companion cuando aparezca la primera pregunta que
  se entienda mejor mostrándola) más `frontend-design` + `ui-ux-pro-max` juntas.

  **Comparables ya elegidos** — no son TMS sino productos de certificación/gestión documental de
  flota, que hacen el mismo trabajo: **Highway** y **RMIS** (DAT) para verificación y onboarding de
  transportistas; **MyCarrierPackets** para la carga documental; **Fleetio** y **Samsara** para
  documentos por conductor y por vehículo con vencimientos.

  **El patrón que comparten y que ataca el problema**: maestro-detalle sin perder el lugar — la lista
  queda visible, el detalle abre en panel lateral SOBRE ella, y la carga del archivo ocurre ahí mismo
  (arrastrar sobre el requisito), sin navegar a otra pantalla. Nunca se sale de la cola de trabajo.

  **Pregunta abierta que define el alcance**: los tres enlaces no son iguales. Dos van al documental
  de la EMPRESA (`?tab=documentos`) y uno al conductor o vehículo específico — ese último es el que
  el usuario describió. Hay que definir si el documental de la empresa también debe quedar dentro de
  Certificación o si ese sí tiene sentido que lleve a Empresas.

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
