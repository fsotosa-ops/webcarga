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

### 2026-09-07 — Ronda 156: la baja bloquea de verdad, un botón de menos, y el CD de origen

## La empresa dada de baja: la pantalla lo prometía, la API no lo cumplía

El frontend **ya estaba completo**: el banner *"no se le puede cargar nada nueva"* y
`canEdit = canEditRol && empresaActiva`, que apaga los controles en todo el árbol. Lo que faltaba
era que la API lo hiciera cumplir — un POST directo, la carga masiva o la Bandeja escribían igual.

Se cerraron **los dos** caminos de escritura (`_apply_compliance_upload` y el de la Bandeja) con
409. Guardar uno solo deja la puerta de atrás abierta.

Tres decisiones que valen:
- **Bloquea la escritura, no la lectura.** Dar de baja archiva, no oculta: al reactivar lo primero
  que se necesita ver es qué se venció durante la baja. Eso ya estaba escrito en el docstring de
  `_estado_de_empresa_a_mostrar` y se respetó.
- **Va en la consulta que ya traía el record**, no en una segunda: una vuelta más por cada archivo
  de una carga masiva de 30 no se paga sola.
- **`entity_id` es polimórfico** — carrier, conductor o vehículo según `entity_type`—, así que el
  CASE resuelve al dueño por los tres caminos. Verificado contra la base: activa → None, empresa de
  baja → su nombre, conductor de empresa de baja → su nombre.

Los conteos globales ya excluían a las no activas desde antes (`_estado_de_empresa_a_mostrar`).

## El botón "Editar Empresa", retirado sin perder nada

El cajón ofrecía dos cosas: renombrar y cambiar el estado operativo. Lo segundo lo hacían ya los
botones "Dar de baja"/"Reactivar" de al lado — **dos caminos para el mismo acto, con nombres
distintos**, que es exactamente cómo dos superficies terminan diciendo cosas distintas del mismo
dato. Lo único que no se duplicaba era el renombre, así que quedó sobre el nombre, con un lápiz.

## El CD de origen: el argumento era cierto, pero de los destinos

El filtro de Origen era un autocomplete, con este comentario: *"no chips estáticas: cientos de
locales reales"*. Medido el 07/09: **23 orígenes distintos contra 279 destinos**, y cinco
concentran el 98% del volumen. El argumento vale para los destinos y no para los orígenes. Ahora
son chips dinámicas desde la base, ordenadas **por volumen y no alfabéticamente** —los CD que mueven
la operación van arriba—, igual que Fuente y Cliente.

## Lo medido

**Frontend 1.365 en verde, backend 1.006** (con los 190 de integración), build limpio. Trinquete de
color **1.719 → 1.717**. Las tres consultas nuevas corridas contra la base real antes de escribir un
mock. Click-through local: las chips de CD ordenadas por volumen, la ficha sin "Editar Empresa" y
con el lápiz sobre el nombre, y la certificación de una empresa de baja mostrando su historial
completo bajo el cartel que ahora la API respalda.

## Checklist — siguiente paso exacto

1. **El cierre de prueba de Pablo**, que sigue siendo lo único que cierra el Bloque 1.
2. **Agrupar el cierre de viajes por estado**, esperando la matriz estado→grupo de Pablo y Fabián.
   Facturación quedó fuera de alcance.
3. Que Fabián reproduzca el bug de "crear conductor desde Empresas no lo asigna".

### 2026-09-07 — Ronda 155: siete pedidos del usuario sobre el cierre

## Los siete, y qué era cada uno

1. **`writer` puede cerrar.** Los endpoints del cierre exigían `require_editor`,
   que deja fuera justamente al rol de quien opera el Diario todos los días. Pasaron a
   `require_writer`. El **override no se movió**: forzar con pendientes sigue siendo de admin —
   abrir la puerta no es dar la llave del cuarto de atrás.
2. **Comentario de texto libre por fila** (migración `20260907200000`). El motivo dice la
   categoría —"Panne"— y no dice el caso. Va donde está la decisión que justifica, y sólo cuando
   hay motivo elegido: un texto sin categoría no se agrupa ni se cuenta.
3. **Card "No trabajando".** "No asignados" mezclaba a los que nadie miró con los ya resueltos, así
   que el número de lo pendiente no bajaba nunca aunque el trabajo avanzara. Medido en vivo sobre
   el 03-09: pasó de decir **10** a decir **1 sin resolver y 9 no trabajando**.
4. **El motivo del viaje es del catálogo del viaje.** El detalle del viaje en el Monitor ofrecía
   `DRIVER_REASON` —"Vacaciones", "Panne"— y escribía el id en
   `app.trips.unassigned_reason_id`, que significa "por qué WebCarga no tomó este viaje". El propio
   backend ya lo tenía anotado como *un campo con dos escritores y dos catálogos*: bulk-close
   validaba el dominio desde agosto y este camino no. Ahora ofrece los doce de
   `TRIP_UNASSIGNED_REASON` y el `PATCH` rechaza el otro dominio con 422. **Medido antes de
   tocarlo: 0 viajes tenían motivo escrito**, así que el arreglo llegó antes que el dato sucio.
5. **Dos columnas nuevas**: Nº de viaje del TMS y local de origen. El origen sale de
   `app.trip_stops`, no de `trips.origin_tms` — esa columna está **vacía en las 2.204 filas**.
6. **La tabla funciona como una planilla**: orden asc/desc/sin orden por columna y filtro múltiple
   por los valores presentes. Los valores del filtro salen de las filas que hay, no de un catálogo:
   verificado en vivo, la columna Empresa ofrece las 8 que están en pantalla y no las 250 del
   padrón.
7. **20/50/100 filas por página.** Eran 10 fijas; con 81 tractos, revisar el día eran nueve saltos.

## Un bug que me hice y me pesqué el guardia

Al sumar el comentario, cambiar el motivo lo habría **borrado en silencio**: el frontend no manda
el campo y el UPDATE lo ponía en NULL. Se arregló en el backend, que es la capa correcta —
`model_fields_set` distingue "no mandé la clave" de "quiero que quede vacía"—, con test que lo fija.

Y el test de español neutral me pescó cuatro *"ponelo"* en mis propios comentarios. Ese guardia
existe porque llegaron ocho casos a producción sin que nada los detectara; esta vez detectó.

## Lo medido

**Frontend 1.363 en verde, backend 1.004** (con los 190 de integración), build limpio. Trinquetes
bajados: color crudo **1.721 → 1.719**, tamaños <11px **262 → 260**. Las consultas nuevas corridas
contra la base real antes de confiar en mocks, y el conteo de placeholders contra argumentos hecho a
mano en los cuatro UPDATE. Tres mutaciones sobre la tabla —quitar el corte de "No trabajando", el
orden y el filtro— ponen en rojo cinco tests distintos.

Click-through local sobre el 03-09: las cinco cards, las siete columnas con su botón de orden y de
filtro, el selector de filas, y el campo de comentario apareciendo sólo en las filas con motivo.

## Checklist — siguiente paso exacto

1. **El cierre de prueba de Pablo**, que sigue siendo lo único que cierra el Bloque 1.
2. Lo que resta del Bloque 3: **agrupar el cierre de viajes por estado**, esperando la matriz
   estado→grupo de Pablo y Fabián. **Facturación quedó fuera de alcance.**
3. Que Fabián reproduzca sobre el build de hoy el bug de "crear conductor desde Empresas no lo
   asigna": no se puede verificar sin crear registros reales.

### 2026-09-07 — Ronda 154: el Directorio sale de Certificación, y busca las tres cosas

Auditoría pedida por el usuario: *"¿por qué no están separados? La UX de empresas tiene muchos
clics"*. Medido en la app desplegada, no leído.

## Estaban cruzados al revés

El menú tenía `Certificación → { Empresas, Sin clasificar, Directorio }`. Y cada módulo tenía el
trabajo del otro:

- **Certificación** —el módulo documental— era el que sabía buscar por Conductor, Vehículo y
  Requisito, y el que mostraba el resumen del padrón (250 empresas, 80 tractos, 80 conductores).
- **El Directorio** —donde se da de baja, se transfiere y se activa— buscaba **sólo** por nombre o
  RUT de empresa. Medido: "Pardo" → *Sin resultados, 0 empresas*, sobre un conductor que existe.
  "DTBY52" → *Sin resultados*, sobre un tracto que existe.

El caso de Pablo —*"necesito el RUT para saber qué conductor dejar"*— costaba **6 clics y saber la
empresa de antemano**, porque el RUT vivía en un solo lugar de toda la app: dentro del panel de
detalle. Por Certificación eran 3 clics a un callejón sin salida: esa tabla no muestra RUT.

Y el resto de la app ya le daba la razón a Pablo: de los diez enlaces con que el Monitor y el Cierre
mandan a arreglar algo, **nueve apuntan a `/dashboard/carriers`** y uno solo a
`/dashboard/compliance`. Las pantallas operativas ya trataban al Directorio como el lugar donde se
gestiona; el menú lo escondía adentro del módulo documental.

## Lo que se hizo

1. **El Directorio salió del grupo** y quedó como módulo propio, entre Operaciones y Certificación.
   El render pasó a una sola lista ordenada: antes grupos y hojas iban en dos bloques, así que una
   hoja no podía ir *entre* dos grupos.
2. **Un solo buscador, tres tipos de resultado** (`GET /carriers/buscar`). RUT y patente se comparan
   por su forma canónica, así que "18.659.820-2" y "dt by52" encuentran lo mismo que el texto
   exacto — `canonical_rut` y `canonical_plate` estaban en Postgres desde el 17/08 sin que las
   llamara nadie.
3. **Cada resultado abre su panel directo**, con `?driver=` / `?asset=`. Esos dos parámetros **ya
   los leía la ficha** desde antes y no apuntaba nadie: otra capacidad sin puerta. De 6 clics a 1, y
   la vista pasa a ser direccionable.
4. Un conductor **sin empresa** se muestra igual, con la marca, y sin link: no tiene ficha donde
   abrirse. Son 10 personas, y su vínculo lo propone el pre-cierre.

## Lo que NO se hizo, y por qué

- **Facturación queda fuera de alcance** (definición del usuario). Eso cierra P1 de la reunión del
  04/09 sin discutirla.
- **El bug de Fabián** —"crear el conductor desde Empresas no lo asigna"— no se pudo verificar sin
  crear registros reales en producción. El alta se unificó en un componente compartido el 27/08 y
  las dos pantallas le pasan el `carrierId`; Felipe ya le había dicho en la reunión que *"está
  marcando bien en la asignación"*. Lo tiene que reproducir Fabián sobre el build de hoy.
- La búsqueda de Certificación **sigue sin ser direccionable** (`?group=driver` se ignora, siempre
  arranca en "Empresa"). Anotado, no tocado.

## Lo medido

**Frontend 1.353 en verde, backend 997** (con los 190 de integración). Los dos trinquetes visuales
sin moverse: 1.721 y 262. Las tres consultas del buscador corridas contra la base real —"Pardo",
"DTBY52", "dt by52" y un RUT con puntos— antes de escribir un solo mock, y los cuatro tests nuevos
de la UI verificados por mutación. Click-through local: buscar el apellido devuelve al conductor con
su RUT y su empresa, y el clic abre el panel con Transferir / Dar de baja / Quitar del roster.

### 2026-09-07 — Ronda 153: el eje de bajas, y una alarma que yo mismo había inflado

Bloque 2 del plan. Tres arreglos y **una corrección a lo que había escrito en la Ronda 152**.

## Las empresas dadas de baja no estaban en ninguna pestaña

`_SQL_DIRECTORIO` cuenta `LEGACY_INACTIVE + INACTIVE` como "inactivas" —**214**— y la pestaña del
Directorio filtraba sólo el primero —**206**—. La cifra del encabezado y la lista de abajo, en la
misma pantalla, no podían coincidir. Las **8** que faltaban son justo las dadas de baja **desde la
app**, y entre ellas está *Transportes Cristian González E.i.r.l.*: la que Pablo dijo el 04/09
—*"yo di de baja esa empresa y no aparece"*— y también *Transporte Cribas*, de la minuta del 25/08.

`operational_status` acepta ahora varios estados separados por coma (`= ANY($n::text[])`); un solo
valor se comporta igual que antes. La pestaña se llama **"Inactivas"** y manda los dos. Lo mismo en
Seguros, que tenía el mismo corte. Verificado en pantalla: la pestaña dice **214** y la empresa de
Pablo aparece al buscarla.

## La baja, dicha en la lista

`DriverRosterCard` y `VehicleRosterCard` recibían `operational_status` en el payload y no lo
dibujaban: había que abrir cada ficha para ver que el botón decía "Reactivar". Ahora hay un
`ChipDeBaja`, y va **en lugar** del pill de documentación, no al lado — un conductor de baja con los
papeles al día se veía con un "Al día" verde, la lectura exactamente contraria. Verificado en
pantalla con los 3 conductores de *Inversiones Casilla Spa*, que es la captura de Pablo.

Y el chip de estado de la ficha de empresa **imprimía el enum crudo**: decía `ACTIVE` en una
interfaz en español. Eso alimentaba su pregunta de la reunión —*"¿lo da de baja o le pone
inactivo?"*—: son el mismo eje escrito de dos maneras. Ahora hay `OPERATIONAL_STATUS_LABELS`, y
`LEGACY_INACTIVE` e `INACTIVE` se dicen igual a propósito.

## La corrección: "53 de 90 conductores fuera del cierre" era alarmista

En la Ronda 152 escribí que 53 de 90 conductores activos no pueden aparecer nunca en el cierre. La
aritmética era correcta y la lectura no. Desglosado:

| | conductores | ¿es un defecto? |
|---|---|---|
| entran al roster | 37 | — |
| empresa **100% Equipo Completo** | **34** | **no** — correcto que no estén en el cierre de Tractoreo |
| sin empresa asignada | 10 | ya lo cubre `CONDUCTOR_SIN_EMPRESA` en el pre-cierre |
| empresa dada de baja | 8 | correcto, si la baja lo es |
| empresa con tractos sin clasificar | **1** | sí, y se arregla con el selector de la Ronda 152 |

O sea el criterio del roster **está bien** y no se tocó. El ítem 11 del plan queda cerrado sin
código. Escribir "53 de 90" sin abrir el porqué era exactamente el error que este proyecto ya tiene
anotado: un número sin sus filas no dice qué pasa.

## Lo medido

**Backend 993 en verde** (incluidos los 190 de integración), **frontend 1.347**, `tsc` limpio,
build OK. Dos trinquetes bajados: color crudo **1.744 → 1.721** y tamaños por debajo de 11px
**268 → 262**. Este segundo apareció en rojo: el `ChipDeBaja` nació a 10px. Pasa que la suite lo
habría dejado pasar por compensación —había quitado tantos como agregué—, así que la tira de chips
de `VehicleRosterCard` subió entera al mínimo de la escala en vez de aprovechar el margen.

## Checklist — siguiente paso exacto

1. **Sigue sin comitear.** Rondas 152 y 153 juntas en el árbol.
2. **El cierre de prueba de Pablo**, que es lo único que cierra el Bloque 1.
3. **Bloque 3**: **Facturación queda FUERA** (definición del usuario, 07/09) — la pregunta P1 de la
   reunión del 04/09 se cierra sola y no hay que dividir el cierre por área. Lo que sigue vivo del
   bloque es agrupar el cierre de viajes **por estado** y sacar el Directorio de Certificación;
   ambos siguen esperando la matriz estado→grupo de Pablo y Fabián.
4. Deuda anotada y no tocada: abrir el cierre de un día ya firmado le recalcula las cifras.

### 2026-09-07 — Ronda 152: los 43 tractos que ninguna pantalla mostraba

Pablo entregó `monitor-app/bugs/20260907/Bugs Cierre de viaje.docx` —12 capturas del **segundo
cierre de prueba**, sobre el día **03-09**— y el 04/09 las revisamos en vivo con él y Fabián. Cuatro
de esos comentarios eran **un solo bug**.

## La causa raíz

`GET /equipment-closures` devuelve DOS listas, `tractoreo` y `equipos_completos`. El frontend leía
sólo la segunda (`FlotaDelDiaSection.tsx:131`), y la pestaña rotulada **"Tractoreo" mostraba
CONDUCTORES**, traídos de `GET /daily-closures`. Los **43 tractos** de `tractoreo.equipment` del
03-09 no los pintaba nadie. Por eso el badge decía "18 sin asignar" (conductores) al lado de un
error que decía "15 sin resolver" (tractos): dos números que no podían cuadrar porque no contaban
lo mismo.

| Comentario de Pablo | Patente | Qué era en realidad |
|---|---|---|
| "este viaje no aparece en el cierre" | HKXW55 | `ASSIGNED` en el bucket invisible |
| "faltaban 4 casos, ni asignados ni no asignados" | FCCP42, BSYF60, CZZG66, SVLT42 | los cuatro `ASSIGNED` en el bucket invisible |
| "este equipo no aparece como tractoreo" | DTBY52 | `UNASSIGNED`: **uno de los 15 que bloqueaban** |
| "cuál es el listado de estos 15, ni hay un detalle" | — | esos mismos 15 |

Y el detalle **sí venía**: el 409 trae `pending[{asset_id, tractor_plate}]` desde siempre;
`page.tsx` guardaba `detail.message` y tiraba el resto. Es la misma lección que `SinFlotaList` ya
tenía escrita en su docstring desde agosto — *"un número sin sus filas no dice qué hacer"*—, sin
aplicar a las otras dos listas.

## Lo que se hizo

1. **Tres vistas, una tabla.** El cabezal pasó de dos tarjetas a tres —Conductores / Tractos ·
   Tractoreo / Tractos · Equipo Completo—, y son la misma tarjeta con props. La de Tractoreo
   anuncia *"N sin motivo — bloquean el cierre"*.
2. **El 409 se despliega**, en los dos pasos: patente + empresa con link a la ficha para tractos,
   nombre y estado para conductores (`PendientesDelCierre.tsx`, nuevo).
3. **El override llega a equipos.** `page.tsx:164` llamaba `close(fecha)` sin override, así que con
   tractos pendientes el día no se podía firmar **ni forzando**. Eso explica que
   `app.equipment_closures` esté **vacía desde que existe**.
4. **El tipo de operación se edita.** El `PATCH` lo aceptaba desde el 03/08 y no había pantalla: el
   `GET` no lo devolvía, el cliente TS no lo tipaba y la vista materializada no lo exponía. Ahora
   se ve como chip en el roster y se elige en el panel del equipo. Se lee **en vivo** de
   `public.assets`, no del roster materializado, porque es un campo que ahora se edita ahí mismo.
5. **El conductor del tracto es el del VIAJE**, no sólo el habitual de `vehicle_driver_assignments`
   (cobertura baja). Campos separados: `driver_name` / `trip_driver_name`. Medido: 3 filas del
   03-09 traen conductor sólo por el viaje.
6. **"Ver viaje" en un conductor asignado.** `trip_id` sale del LATERAL de mismatch, así que en un
   ASSIGNED sano es NULL por diseño: de 25 asignados del 03-09, **1** tenía link. Con
   `today_trip_id`, los 25.
7. **`SIN_TIPO_OPERACION` dice la verdad**: nombra la patente y dice que bloquea. No es una
   contradicción con `_ESCALACIONES_QUE_BLOQUEAN` —esa lista gobierna el cierre de CONDUCTORES—,
   era la copia la que se quedaba corta.
8. **El botón "Crear viaje manual" ya no miente**: su handler era un `TODO` vacío. La prop pasó a
   opcional y la página dejó de pasarla.

## Un test rojo que no era mío

`test_se_puede_vincular_un_conductor_sin_empresa` fallaba **también en HEAD** (verificado en un
worktree limpio). Elegía su sujeto con `SELECT id FROM public.drivers ... LIMIT 1` sin ORDER BY:
hoy 87 de 96 conductores con RUT tienen empresa, así que el test cruzaba por accidente la rama
contraria a la que dice probar. La causa real está en `app.resolve_trip_fleet()`:

```sql
UPDATE app.trip_fleet_links SET carrier_id = da.carrier_id
WHERE fl.link_source = 'manual' AND fl.carrier_id IS NULL ...
```

O sea la inferencia **llena un silencio y nunca contradice** — la regla del modelo de resolución de
flota, funcionando. El test elige ahora su sujeto a propósito, y se escribió el que faltaba para la
otra rama.

## Lo medido, y una advertencia

Suites: **backend 991 en verde** (incluidos los 190 de integración contra la base real), **frontend
1.343 en verde**, `tsc` limpio, `npm run build` OK. El trinquete de color crudo **bajó de 1.744 a
1.721**. Las cuatro consultas SQL nuevas se corrieron contra la base de producción antes de
confiar en ningún mock, y los tests de regresión se verificaron por mutación: revertir la conducta
vieja los pone en rojo.

**Click-through hecho en local** (uvicorn + next contra la base real): las tres tarjetas cargan,
Tractoreo lista los tractos con patente y motivo —DTBY52 entre ellos—, los asignados muestran el
conductor del viaje, y la ficha de Comercializadora De Los Rios marca HKXW55 como *"Sin tipo de
operación"* con su selector.

**Ojo con el número: no es estable.** El `GET` recalcula. El 03-09 tenía 15 tractos bloqueando
cuando lo medí a las 12:50, y 17 después de abrir la pantalla a las 13:43 —`computed_at` lo
confirma—, sobre un día que **ya estaba firmado** en `app.daily_closures`. Abrir el cierre de un día
cerrado le cambia las cifras. Está anotado como deuda, no se tocó.

## Checklist — siguiente paso exacto

1. **Nada está comiteado ni desplegado.** Revisar el diff y decidir el commit.
2. **El cierre de prueba de Pablo, otra vez**, ahora que hay listas: poner motivo a los 17 tractos y
   ver que `app.equipment_closures` deje de estar vacía. Es la única verificación que cuenta.
3. **Bloque 2 del plan** (un solo eje de bajas): hoy hay cinco definiciones de "dado de baja", 53 de
   90 conductores activos no pueden aparecer en el cierre, y el listado de empresas **no tiene
   pestaña `INACTIVE`** — que es justo lo que escribe el botón "Dar de baja".
4. **Bloque 3** (Directorio fuera de Certificación; cierre de viajes agrupado por estado):
   **Facturación queda fuera** por definición del usuario (07/09), así que el corte por área no va y
   P1 deja de ser una pregunta abierta. Sigue esperando la matriz estado→grupo de Pablo y Fabián.
5. **Los 31 viajes trabados son todos de Sodimac** (24/07 al 07/09, hasta 42 días). El mecanismo ya
   los detecta; falta cerrarlos, que es negocio. Lo que sí es desarrollo: `SQL_GRUPOS_CIERRE` es el
   único SQL del cierre sin filtro anti-Sodimac.

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
