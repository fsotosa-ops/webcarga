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
> (**Rondas 138-146 archivadas al cerrar la Ronda 148**: la pausa del 23/08 y todo lo que la
> precedió — la planilla de Certificación, los desplegables, Sodimac multiorigen, los pendientes
> de Pablo y el arreglo de dbt. Quedaron cerradas: la Ronda 148 audita el estado real y lo que
> siguiera abierto se consolidó abajo antes de mover nada.)

### 2026-08-25 — CIERRE DE SESIÓN. Estado y punto de retomada

`dev` en `20d493b1`. Backend desplegado y verde. **Nada a medio hacer.**

## Lo que se hizo, en una línea cada cosa

| | |
|---|---|
| Backlog y roadmap | Dos `.xlsx` en `entregables-backlog-roadmap/` (sin comitear, es carpeta nueva): 52 ítems en 8 categorías con columna de estado real y evidencia, y un roadmap de 5 olas con Gantt trimestral, 23 hitos de trayectoria e iniciativas que enlazan cada ID |
| Auditoría | Las 49 historias del levantamiento contrastadas contra el código, la base y la app desplegada con Playwright |
| Contrato | Leído y contrastado en pantalla. **Por decisión del usuario NO entró a los entregables** |
| Rol `writer` | Cableado por campo, 19 tests, desplegado (`445a1a83`, Deploy Monitor API success) |
| Test rojo | Diagnosticado y mapeado como deuda en `TECH_DEBT.md` y como PLA-08 |

## Cuatro veces me equivoqué, y las cuatro por lo mismo

Vale más que el resumen de lo hecho, porque es lo que se repite:

1. **Di por muerto el motor de cierre por conductor** leyendo un docstring que lo declaraba sin uso.
   La app llama a `/daily-closures` **y** a `/equipment-closures`.
2. **Dije que no existía portada operacional** mirando `operations/page.tsx` —que es un redirect— y
   la tabla por defecto. Existen la vista **Tablero** y el **Centro de Flota**.
3. **Dije que la comuna no se mostraba** buscando la palabra "comuna". Se imprime sin etiqueta:
   `LA REINA - 95 RM LA REINA, 13`, en el 94,7% de los destinos.
4. **Levanté un ING-12** diciendo que Desc. inicio y Desc. fin "nunca traen dato". Son celdas
   **editables**: las llena el equipo. Premisa falsa, retirado.

Las cuatro son [[feedback_afirmar_ausencia_exige_abrir_la_funcion]]: afirmar una ausencia sin abrir
lo que la implementaría. **Una ausencia en esta app se declara después de tocar la pantalla**, no de
grepear un nombre plausible.

## Lo que el usuario corrigió del contrato

Perfiles de conductores y generadores de carga: **despriorizados, evolutivo post-MVP**. Pagos: fuera
del MVP —es exigencia de arquitectura, y no figura en ningún criterio de aceptación del Anexo B—.
Scrapers en vez de API: **el contrato lo contempla** ("desarrollo interno de componentes críticos").
Repositorio: ya compartido. Documentación: entregada en dos PDF de mayo.

## Checklist — siguiente paso exacto

1. **Subir los dos `.xlsx`** a `dev/docs` de Drive (carpeta `1d63s0_EPR4IkapOWQXByo3FHNPu1ksI6`).
   Arrastrarlos los convierte a Sheets conservando pestañas, colores y fórmulas. El MCP no puede:
   `create_file` falla sobre ~19.000 caracteres en base64, reproducible.
2. **Acta de aceptación del Hito Final.** La marcha blanca se cumplió con creces (2 semanas contra 1
   pactada), así que falta firma, no desarrollo. Si el acta anexa los PDF de mayo, que refleje el
   estado de hoy: frontend en Cloud Run y no Vercel, capa Gold retirada, roles de 4 a 5.
3. **El rezago de Sodimac es el desbloqueo de mayor valor del backlog**: 21 viajes trabados en
   ASIGNADO, hasta 28 días, esperando el criterio de ausencia del issue #3. Es definición de
   negocio, no código.
4. **La ventana de atención del local** (`opens_at`/`closes_at`) sigue sin existir: 474 de 791
   locales sin cargar y sin formulario donde hacerlo. De ahí cuelgan HU-26, HU-27, HU-39 y HU-45.
5. Al retomar, **preguntar antes de auditar**: el equipo lleva dos semanas operando.


### 2026-08-25 — Ronda 148: el click-through de la app desplegada, contra las cinco cosas dadas por listas

El usuario declaró cinco frentes cerrados. Los verifiqué con Playwright sobre
`webcarga-frontend-dev` y contra la base. **Uno estaba cerrado, uno estaba mal planteado por mí, y
tres no aparecen en lo desplegado.** El repo no tiene commits nuevos desde el 23/08.

| Frente declarado listo | Veredicto | Con qué se comprobó |
|---|---|---|
| Frentes de Sodimac | **Cerrado**, salvo el criterio de ausencia | 9 viajes con más de un origen y **22 con más de un destino** en `app.trip_stops` |
| Motor de cierre duplicado | **El ítem estaba mal planteado** | La UI llama a `/daily-closures` **y** a `/equipment-closures`: son Tractoreo y Equipo Completo, dos modos de negocio |
| Horario del local | **No está** | El formulario Nuevo local tiene 5 campos y ninguno es horario; 474 de 791 locales sin cargar |
| Datos maestros confiables | **No está** | 36 nombres de local repetidos y visibles en la lista sin marca; 306 sin dirección, 58 sin región |
| El pipeline se prueba y se versiona | **No está** | 80 archivos de test y **cero bloques de test** en el pipeline; el dbt del TMS sigue bajo `.gitignore` |

**Corrijo un error mío de la Ronda 147**: di por muerto el motor de cierre por conductor leyendo un
docstring que lo declaraba sin uso. La app desplegada lo llama. El docstring está desactualizado, y
yo confié en un comentario en vez de mirar qué pide la pantalla.

## La marcha blanca, que faltaba en el archivo

Dos semanas con el equipo operando. El dato dice dónde se adoptó y dónde no:

- **Cero cierres de día registrados**, ni por conductor ni por equipo, en toda la historia de la base.
- **25 vínculos de flota manuales contra 1.687 automáticos.**
- **29 documentos** subidos por la app en toda su historia; Certificación declara **2.290 por cubrir**.
- 2 viajes editados a mano; 128 entradas de auditoría, casi todas de julio.

O sea: la ingesta y la lectura del Monitor se usan, y los flujos de escritura no. Entra al backlog
como **OPS-13**, y es una pregunta al equipo antes que una tarea de desarrollo.

## Estado de los entregables

`entregables-backlog-roadmap/` regenerado a **v1.1, corte 25/08**: 51 ítems (sale CIE-01 por mal
planteado, sale ING-02 por cerrado, entra OPS-13), Trayectoria con 21 hitos incluida la marcha
blanca y el cierre del multidestino, y las cifras remedidas contra la base.

## Checklist — siguiente paso exacto

1. **Confirmar con el usuario** si el horario del local, los datos maestros y el versionado del dbt
   están en una rama sin desplegar. Si es así, se mueven a Trayectoria; si no, quedan como están.
2. El usuario sube los dos `.xlsx` a la carpeta `dev/docs` de Drive.
3. Revisar Importancia, Urgencia y talla con negocio; la prioridad se recalcula sola.


## Ronda 148 (cont.) — los tres módulos de la marcha blanca, recorridos

`dev` en GitHub está en `8b0839b2`, idéntico al local: **no hay trabajo sin desplegar**. `main` quedó
en el 01/08.

**Monitorear viajes.** Encontré dos superficies que la Ronda 147 no vio, y que corrigen su veredicto
sobre la portada operacional: la vista **Tablero** agrupa por estado operativo (En ruta 34 · En local
1 · Retornando 4 · Cerrados 0 · Problema 0 · Otro 5) y el **Centro de Flota** da la capacidad del día
(93 nunca asignados · 8 liberados · 12 en viaje). Entre las dos cubren la mayor parte de HU-34, HU-35
y HU-36. REP-01 pasa de "No implementado" a **Parcial**: falta reunirlas y cortar por cliente y
región. Mi error fue mirar `operations/page.tsx` —que es un redirect— y la tabla por defecto, sin
tocar el conmutador de vista.

**Cerrar viajes.** El flujo funciona de punta a punta: casilla por viaje, motivo en lote con los
cuatro de negocio, y "No asignado por WebCarga". Lo probé hasta el paso previo a confirmar, sin
ejecutar la escritura. Lo que no funciona es el uso: **22 viajes esperando, 21 de ellos de Sodimac en
ASIGNADO con hasta 28 días sin novedad, y cero con motivo cargado**. Ese rezago es el costo medido
del issue #3: son viajes que el portal dejó de reportar y que nadie puede cerrar sin un criterio.

**Subir archivos.** La bandeja anda: arrastrar y soltar en cualquier parte, tres pasos, sugerencia
por archivo. Hay **1 archivo esperando clasificación desde el 21/08**, con sugerencia vacía.

**El backlog quedó en v1.1 con 51 ítems**: REP-01 a Parcial, OPS-13 reescrito como "la cola de cierre
se llena y no se vacía", ING-03 con el rezago medido como evidencia, ING-11 acotado a HU-32/33/40
porque HU-34 quedó cubierta por el Tablero. Trayectoria suma el hito de las dos vistas del Monitor.



## Ronda 148 (cont. 2) — dos correcciones más, ambas del usuario

**Las fechas del viaje sí aparecen, y la mitad de las columnas son de entrada manual por diseño.**
El detalle muestra ocho columnas de tiempo por parada. Las tres que llena el TMS —Plan., GPS llegada,
GPS salida— son de solo lectura. Las cuatro editables son exactamente **Llegada TR, Salida TR, Desc.
inicio y Desc. fin**: las completa el equipo al operar. Verificado en la app, celda por celda.

Alcancé a levantar un ING-12 diciendo que esas columnas "nunca traen dato" — **premisa falsa, retirado**.
Cero de 5.921 no es un mapeo roto: es que el equipo todavía no las llena. La cifra vale como señal de
adopción, no como defecto, y quedó dentro de OPS-13.

**El horario del local es otra cosa.** Lo que sí falta es `opens_at`/`closes_at` del catálogo —la
ventana de atención— que es lo que HU-27, HU-39 y HU-45 necesitan para validar si una entrega cae
dentro de horario. 474 de 791 locales sin cargar y sin formulario donde hacerlo.

**La comuna sí se muestra.** Llega como `destination_city` en 3.916 de 4.133 destinos (94,7%) y el
detalle la imprime junto a la región: "LA REINA - 95 RM LA REINA, 13". MAE-06 pasa de "No
implementado" a Parcial: lo único que falta es la columna en `public.locations`, para el local que
todavía no tiene viajes.

Backlog en **51 ítems**, Trayectoria en 23 hitos.



## Ronda 148 (cont. 3) — el contrato firmado, revisado en pantalla

Leí el Contrato Marco Suma Dots y WebCarga (vigor 02/02/2026, 3 meses, suma alzada, alcance cerrado
a Fase 1 y Fase 2) y lo contrasté con la app. **Por decisión del usuario el análisis no entra a los
entregables**: se revisó en pantalla. Los archivos quedan en 51 ítems y 4 pestañas, sin cambios por
este frente.

Los puntos que quedaron dichos, por si se retoman: faltan los perfiles de Conductores y Generadores
de Carga (Anexo A 2.1 y criterio B.3.A), la pata de pagos del backend core, el manual de usuario y la
documentación técnica (Anexo A 6.2 y 6.3). El plazo de 3 meses se excedió a cerca de seis y medio, y
seis módulos en producción quedan fuera del Anexo A sin el instrumento nuevo que pide la Cláusula 5.2.


## Ronda 148 (cont. 4) — el rol writer, cableado por campo

El issue #1 quedó **resuelto en su mitad de fondo**, sin la escalada de privilegios que él mismo
advertía. Antes: `writer` existía en el catálogo y en la jerarquía del frontend, y las dos capas que
deciden no lo conocían — 2 usuarios con 403 en cualquier escritura.

**Lo que ya estaba hecho** (y no era esto): la consolidación del frontend. `useCanEdit` dejó de
llevar su conjunto copiado y delega en `useRolMinimo` sobre el único `hasRole`. Nueve enumeraciones
en siete archivos pasaron a una. Real, pero no cambiaba la conducta.

**Lo que se hizo ahora**, tres piezas:

1. `auth.py` — `WRITER_ROLES = EDITOR_ROLES | {"writer"}` y `require_writer`. **Abre la puerta, no da
   la ruta**: el guardia de endpoint da la ruta entera o la niega entera, y `PATCH /trips/{id}`
   recibe en el mismo cuerpo el teléfono —básico— y la patente —sensible—.
2. `schemas/trip.py` — `CAMPOS_BASICOS_DEL_DIARIO`, escrita **una vez y pegada a `TripPatch`**,
   porque son nombres de campos de ese modelo: separadas, un rename deja el permiso apuntando a un
   nombre muerto y el guardia deja de proteger **sin avisar**. Un test cruza las dos listas.
   Adentro: los 4 toggles, `notes`/`comments` y `driver_phone`. Afuera, a propósito: `driver_name`,
   `tractor_plate` y `trailer_plate` (identidad de flota), `unassigned_reason_id` (cruza con
   facturación) y `manual_status` (pisa el estado del TMS).
3. `routers/trips.py` — `_exigir_campos_permitidos` antes de cualquier escritura y antes de los
   `pop`. Un campo prohibido invalida el cuerpo completo: aceptar la parte permitida dejaría al
   cliente creyendo que guardó todo. Y `POST /{trip_id}/notes` pasa a `require_writer`, porque **la
   bitácora ES el campo "observaciones"** que el rol promete — el `notes` de `TripPatch` es legacy y
   la UI no lo usa. Fijar y resolver quedan en editor.

**El frontend no necesitó cambio.** En el Monitor, `useCanEdit` sólo gobierna "asignar conductor",
que es campo sensible y editor está bien. Los toggles y la bitácora ya se renderizaban editables.

**Verificación**: 16 tests nuevos, y **las tres mutaciones rompen la suite** —desactivar el guardia
(4 fallos), volver el endpoint a `require_editor` (5) y colar `driver_name` en los básicos (3)—, así
que los tests prueban de verdad. Suite completa: **962 pasan**. El único fallo,
`test_asignar_conductor::test_se_puede_vincular_un_conductor_sin_empresa`, **falla igual sin estos
cambios** (verificado con stash): es preexistente y probablemente quedó desfasado con la migración
del 23/08 del vínculo manual.

4. `PATCH /{trip_id}/stops/{stop_id}` — **agregado a pedido del usuario**. Los cuatro campos de
   `TripStopPatch` (`desc_inicio`, `desc_fin`, `arrival`, `departure`) son los que el equipo completa
   al operar, y ninguno es sensible: los `gps_*` se sacaron de ese modelo el 2026-07-31 por la minuta
   del 29/07, así que Plan., GPS Llegada y GPS Salida ni siquiera son escribibles. Igual lleva filtro
   con `CAMPOS_BASICOS_DE_PARADA` en vez de abrir el endpoint entero, más un test que fija
   `set(TripStopPatch.model_fields) == CAMPOS_BASICOS_DE_PARADA`: el día que alguien agregue un
   campo, el filtro lo niega por omisión y el test obliga a decidir. El circuito cierra —
   `TripDetailView.tsx` es quien llama a ese endpoint.

**Una nota honesta sobre las mutaciones.** Mutar el filtro de la parada **no movía la suite**, y está
bien: hoy no hay ningún campo que rechazar ahí, el que protege es el test de igualdad. Para no dejar
el mecanismo sin cubrir se agregaron dos tests que llaman directo a `_exigir_campos_permitidos` con
un campo inventado. Ahora sí: mutar el filtro rompe 5.

**Verificación final**: 19 tests nuevos, suite completa en **967 pasan**. Queda dicho que los otros
73 endpoints con `require_editor` no se tocaron — `ROLE_META` sólo le promete a writer el Diario.



## Ronda 148 (cont. 5) — el test rojo: diagnosticado y mapeado como deuda

`test_asignar_conductor::test_se_puede_vincular_un_conductor_sin_empresa` **no encontró un bug: fija
un invariante que venció**. Cadena verificada de punta a punta:

1. El test llama a `assign_fleet_link` sólo con el conductor.
2. El endpoint inserta el link con `carrier_id` nulo y `link_source='manual'` — hasta ahí, lo esperado.
3. Después hace `UPDATE app.trips SET fleet_link_id`, que dispara `trg_trips_resolve_fleet_upd`.
4. Ese trigger llama a `app.resolve_trip_fleet()`, cuyo UPDATE final —agregado el **23/08** por
   `20260823210000_el_link_manual_deja_de_quedarse_sin_empresa.sql`— rellena la empresa desde
   `driver_assignments`.

**El UUID del fallo (`a74501a1…`) es exactamente la empresa del conductor que el test elige**, vía su
asignación activa. No es coincidencia: es el mecanismo.

Y el arreglo del 23/08 funcionó: **de 25 vínculos manuales, hoy 0 están sin empresa** (eran 14 ese
día). El test se escribió el 18/08 para probar que la empresa dejó de ser obligatoria —propósito que
sigue vivo y sigue pasando— y su aserción `carrier_id is None` quedó atrás cuando el 23/08 cambió el
comportamiento a propósito.

Se propuso cambiar la aserción por la regla vigente (`carrier_id in (None, empresa_del_conductor)`,
que fija "la inferencia llena un silencio y nunca contradice"). **Decisión del usuario: dejarlo así y
registrarlo como deuda.** Queda en `TECH_DEBT.md` (prioridad Media) y como **PLA-08** del backlog,
dentro de la iniciativa "El pipeline se prueba y se versiona".

Lo que queda dicho: mientras tanto la suite corre en rojo, 1 de 968, y una suite que siempre falla
enseña a no mirarla.

## Ronda 148 (cont. 6) — el writer, desplegado

`445a1a83` pusheado a `dev`. **Deploy Monitor API → success.** Antes de pushear se verificó que no
hubiera ingestión en vuelo (59 jobs `done`, ninguno corriendo): desplegar con un job en vuelo ya
costó una hora de ingestión caída en este proyecto. Corrió sólo ese workflow, que es el que
corresponde — el cambio toca únicamente `backend/api`.


### 2026-08-24 — Ronda 147: el backlog y el roadmap de webcarga, contra lo que la app hace de verdad

**Pedido**: dos planillas nuevas en Drive con la estructura del backlog y el roadmap de Fundación
Summer, alimentadas por el levantamiento de 49 historias, los issues del repo y la auditoría — pero
**fieles a lo que no está cumplido**. Alcance acordado con el usuario: lo evolutivo y lo pendiente;
lo entregado vive en la pestaña Trayectoria del roadmap. Horizonte trimestral agrupado por semestre.

## La auditoría, y dónde el levantamiento y la app se separan

Tres barridos de código (frontend, backend con migraciones, pipeline) **más consultas contra la base
real**. Lo que cambia el veredicto respecto del levantamiento:

- **HU-20 no se hizo.** `INSURANCE_POLICY` sigue `is_active = true`; `SEGURO_RC_EMPRESA` y
  `SEGURO_EETT` siguen apagados esperando la definición que la reunión del 21/08 ya entregó.
  **HU-24 tampoco**: `CONTROL_MENSUAL_COL_T` sigue activo sin propósito resuelto.
- **HU-18/19/21/22/23 sí están, y se verificaron en la base**: `ROLL_SII`, `SEGURO_CARGA`,
  `REGLAMENTO_INTERNO` único (RIOHS quedó como alias de archivo), y `MANTENCION_FRIO` +
  `RESOLUCION_SANITARIA` con 9 subtipos de flota cada uno.
- **No hay GPS.** Cero `latitude`/`longitude` en repo, base y pipeline. `gps_arrival_date` y
  `gps_departure_date` son marcas de confirmación del TMS por parada (3.300 de 5.908). Eso derriba
  HU-32, HU-33 y HU-40 tal como están escritas, y deja HU-34 como agrupación de estados del TMS.
- **No hay portada operacional**: `operations/page.tsx` es un `redirect` puro. HU-35/36/37 sin superficie.
- **El horario del local no tiene formulario en ninguna parte**, y **473 de 790 locales no lo tienen
  cargado**. De ahí cuelgan HU-26, HU-27, HU-39 y HU-45.
- **Nada bloquea** por documentación ni por póliza: `assign_driver`/`assign_asset` no consultan
  compliance. HU-47 sin cumplir.
- **Las vueltas se calculan y no se ven**: 325 viajes con 2ª vuelta o más en
  `v_driver_daily_trip_legs`; en la UI solo hay filtro agregado y reporte de cierre.
- **Chilexpress no existe** en ninguna capa (grep vacío). Clientes reales: colun, iansa, sodimac,
  walmart y un `HBC(test)`.
- **Calidad de locales, medida**: 790 locales — 305 sin dirección, 473 sin horario, 57 sin región,
  3 `site_number` repetidos, 36 nombres repetidos.
- **Tarifario vacío**: `location_rates` tiene **0 filas**.
- **Certificación**: 95 registros aprobados sobre 5.122; 5.027 en `MISSING`. Cero `REJECTED`, y nadie
  los escribe.

## Los entregables

`entregables-backlog-roadmap/` (no comiteado):

- **`Backlog_WebCarga_v1.xlsx`** — 52 ítems en 8 categorías, 17 columnas. Dos columnas propias sobre
  la estructura de Summer: **Estado en la app** (Parcial 9 · No implementado 21 · Bloqueado por
  definición de negocio 9 · Evolutivo 13) y **Evidencia**, que es la cita que sostiene el veredicto.
  Prioridad por fórmula, desplegables, y hoja Resumen con `COUNTIFS` que se recalculan solos.
  P1 14 · P2 15 · P3 3 · P4 20. Pestañas: Backlog · Resumen · Cómo leer este backlog.
- **`Roadmap_WebCarga_v1.xlsx`** — Gantt trimestral bajo bandas de semestre (2026 Q2 → 2027 Q2), con
  5 olas; Trayectoria con 19 hitos y su evidencia; Lo que viene con 16 iniciativas que enlazan cada
  ID del backlog; Narrativa y leyenda. Pestañas: Roadmap · Trayectoria · Lo que viene · Narrativa.
- `datos.py` y `construir.py` — el contenido y el generador, para regenerar sin rehacer el análisis.

**Verificado antes de entregar**: ningún ítem sin estado ni sin evidencia; ninguna dependencia
apunta a un ID inexistente; **cada uno de los 52 IDs aparece en exactamente una iniciativa** del
roadmap, y ninguna iniciativa quedó sin ítems.

## Lo que no se pudo hacer, y por qué

**Las planillas no se subieron a Drive.** El `create_file` del MCP falla con *"Request contains an
invalid argument"* cuando el contenido pasa cierto tamaño: un xlsx de 7.080 caracteres en base64
sube y convierte bien, y uno de 18.932 falla **de forma reproducible en dos transcripciones
independientes** — o sea, es un tope del argumento, no un error de codificación. `textContent` con
CSV chico también sube bien, así que el límite es de tamaño, no de mecanismo.

Se descartó antes: no hay `rclone`, `gdrive` ni credenciales de aplicación con alcance de Drive en
la máquina. Degradar a CSV de una sola pestaña habría perdido la estructura de pestañas que era
justamente el pedido, así que **el usuario decidió subirlos a mano** (arrastrarlos a Drive los
convierte a Sheets conservando pestañas y formato).

Los tres archivos de prueba que quedaron en la carpeta de Drive durante el diagnóstico se enviaron
a la papelera.

## Checklist — siguiente paso exacto

1. **El usuario sube los dos `.xlsx`** a la carpeta `dev/docs` de Drive
   (`1d63s0_EPR4IkapOWQXByo3FHNPu1ksI6`). Al arrastrarlos, Drive los convierte a Google Sheets.
2. Revisar con negocio los tres campos que son borrador discutible: **Importancia, Urgencia y talla**
   de cada ítem. La prioridad se recalcula sola.
3. Confirmar el supuesto de firma ("Preparado por Felipe — Sumadots") y el horizonte trimestral.
4. Si se retoma desarrollo, los tres habilitadores que ordenan el resto son **SEG-01** (tipo de
   póliza, destraba CER-01), **OPS-02** (horario del local, destraba OPS-03/04/11) e **ING-11**
   (telemetría GPS, destraba HU-32/33/34/40 y es lo único con costo recurrente).
