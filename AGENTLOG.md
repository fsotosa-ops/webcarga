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
