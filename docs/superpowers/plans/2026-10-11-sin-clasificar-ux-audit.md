# Auditoría UX/UI de Certificación › Sin clasificar

> Fecha: 11/10. Solo auditoría: no se cambió código de la app y no se tocó ninguna base remota.
> El recorrido se hizo en la copia local (`.superpowers/local-sim/`, datos 100 % ficticios), como
> `cert@sim.local` (Carla, Supervisor de Certificación) y `ops@sim.local` (Óscar, Supervisor de
> Operaciones). Capturas en `.playwright-mcp/sinclasificar-*.png` (fuera de git).
>
> Insumo para el **bloque 2** del rediseño de Certificación: tres tareas (crear empresa, Sin
> clasificar, Pendientes) y el Directorio "solo para mirar".

## 0. De dónde viene "denso"

Se buscó la palabra en `AGENTLOG.md`, `AGENTLOG_ARCHIVE.md`, `docs/`, `monitor-app/docs/`,
`entregables-backlog-roadmap/`, la minuta del 02/10 (`Minuta_Revision_01_02oct2026.docx`) y las
notas de Granola.

- **Ningún documento escrito califica de "denso" a Sin clasificar.** La minuta del 02/10 solo dice
  que el flujo básico "crear empresa → agregar conductor/equipo → subir documentos → clasificar.
  Funciona sin problemas".
- Lo más cercano está en las transcripciones de Granola:
  - Pablo, 02/10, sobre Certificación y los documentos sin clasificar: *"navegar dentro de aquí es enredado"*.
  - Pablo, 21/08, durante la revisión de Sin clasificar: *"No entiendo. Espérame, que estoy medio
    enredado, porque cambiaste a estas cosas"*.
  - Felipe, 21/08: *"puede que se te vuelva muy denso ese módulo"*. Lo dijo sobre meter Seguros
    dentro de Certificación, no sobre esta pantalla.
- **Si el "denso" vino por chat o en persona, conviene anotarlo con fecha y autor.** Hoy no está
  registrado en ningún lado.

Sea cual sea la fuente, la sección 2 muestra que la queja se sostiene con cifras.

## 1. Propósito y trabajo por hacer

**Para qué existe (HU-01, `document_ingest.py:1-12`):** los documentos llegan en bloque y con nombres
que no dicen nada (`IMG_4905.PNG`, `3.jpeg`). Quien carga todavía no sabe a qué requisito va cada uno.
El archivo entra sin declarar nada, queda en staging, y nada toca `compliance_records` hasta que una
persona lo confirma.

**El trabajo de Carla en cada pantalla:**

| | Pendientes | Sin clasificar |
|---|---|---|
| Pregunta que responde | "¿Qué se debe?" | "¿De quién es este archivo y qué es?" |
| Parte de | Un requisito conocido (F30-1 vencido) | Un archivo de origen desconocido |
| Lo que ya se sabe | El tipo de documento, y quiénes lo deben | Nada, o solo lo que dice el nombre |
| Lo que falta | El archivo | La empresa, el titular (empresa, conductor o equipo), el tipo y la fecha |
| Cómo se ve "terminado" | El contador de vencidos baja | La cola queda en cero |

**El borde entre las dos.** Un archivo pertenece a Sin clasificar **solo si, al llegar, no se sabe
su tipo o su titular**. Los casos legítimos son cuatro:
1. **La tanda mezclada que llega por correo o WhatsApp**: varias empresas y varios tipos, con nombres
   tipo `IMG_xxxx`. Es el caso que justifica la pantalla (`_ingest_files`, docstring).
2. **El archivo cuyo titular está al día.** En la carga en lote de Pendientes, si nadie que lo deba
   coincide, el archivo no tiene destino (`BulkUploadReview.tsx:83,252`). Puede ser una renovación
   anticipada o un documento para alguien que hoy no lo debe.
3. **El documento de un tipo que no está activo en la taxonomía** o que no es exigible todavía
   (`contrato.pdf`).
4. **Duplicados y basura**: el mismo archivo dos veces, una foto movida. Se descartan.

Un archivo que trae RUT o patente y tipo reconocible **no debería vivir aquí**. Pendientes ya lo
resuelve, y el motor de match también, porque lo deja en estado AUTO (≥ 0,90). Hoy ese archivo igual
cae en esta cola y espera la misma revisión manual que un `IMG_4905.PNG` (ver H1).

## 2. Diagnóstico de densidad (cifras contadas)

Las capturas son de 1440 × 772 px, con 13 a 16 archivos en la cola.

**Lo que hay en una sola pantalla:**
- **Antes de la primera fila de archivo hay 11 franjas horizontales:**
  1. título;
  2. bajada;
  3. fila EMPRESA con su ayuda;
  4. buscador;
  5. una caja muerta de 65 px que dice "Escribe al menos 2 caracteres…";
  6. zona de carga;
  7. error de subida;
  8. cifra;
  9. paso "1 · Elige";
  10. barra de selección;
  11. cabecera de tabla, y además el encabezado de grupo.
  
  La primera fila empieza en y = 521 px: **el 67 % del alto visible se va antes del primer archivo**
  (`sinclasificar-02-llegada-1440.png`).
- **Hay 10 textos de instrucción visibles a la vez.** Son la bajada, "Lo que subas ahora será…",
  "Escribe al menos 2 caracteres…", "Suelta archivos en cualquier parte…", el error de `notas.txt`,
  "marca con la casilla…", "elige una empresa arriba…", "Selecciona uno o más…", "Clasificar es de a
  un archivo…" y los atajos de teclado (`sinclasificar-02`).
- **Hay 5 tamaños de letra:** 28, 13, 12, 11 y 10 px. **69 de los 75 textos visibles miden 11 px o
  menos.** Usan 11 colores de texto y 4 pesos. Medido con `getComputedStyle` sobre `main`.
- **La empresa se elige en 3 controles distintos, y cuál aparece depende del estado:**
  - el buscador de arriba (`TriageWorkbench.tsx:426-484`);
  - "Mover N a otra empresa" en la barra oscura (`MoveToCarrierBar.tsx`);
  - la pista del encabezado de grupo "elige una empresa arriba" (`TriageFileTable.tsx:114-118`), que
    remite a un control que a veces no está.
- **Hay 4 modos que cambian la pantalla.** Sin selección (sube), foco en un archivo (clasifica),
  varios marcados (mueve o descarta) y confirmando un descarte. Además, "empresa elegida o no" cambia
  el panel derecho. La zona de carga aparece y desaparece según haya selección, y la página salta unos
  55 px (`sinclasificar-06` frente a `-05`).
- **Hay 8 llamados a la acción en competencia:** zona de carga, buscador de empresa, Mover,
  Descartar, la lista de casilleros, "No está en la lista", Clasificar y Deshacer. Ninguno está
  marcado como la acción principal de la pantalla; el único botón lleno es "Clasificar", y está
  deshabilitado en el 100 % de los estados iniciales.
- **Cada fila trae** una casilla, el nombre en monoespaciada, la fecha y la sugerencia, más hasta 3
  filas de aviso a ancho completo. En `sinclasificar-19` hay 3 avisos para 8 archivos: la lista crece
  un 38 % por los avisos.
- **La vista previa mide 160 px de alto** (`TriagePreview.tsx:40`, `h-40`). En la práctica es el
  único dato para decidir con un `IMG_9001.png`, y para leer la fecha de vencimiento. Queda debajo
  del formulario, y al elegir casillero baja del pliegue (`sinclasificar-11`).

**La tarea común: "clasificar una tanda de 12 archivos mezclados".** Supuesto: 7 archivos son de
Transportes Cordillera y 5 de Transportes Andes, entraron por la puerta global y están intercalados
por nombre.

| Paso | Hoy | Interacciones |
|---|---|---|
| Asignar empresa a los 7 de Cordillera | 7 casillas (sin rango, porque están intercalados) + buscar + elegir | 9 |
| Asignar empresa a los 5 de Andes | El buscador de arriba ya no está (H6): 5 casillas + "Mover…" + buscar + elegir | 8 |
| Clasificar cada archivo | Elegir casillero (con scroll, en una lista de 224 px), fecha, "Clasificar"; el foco avanza solo | 3-4 × 12 = 36-48 |
| Ver el documento para leer la fecha | Desplazarse hasta la vista previa, que queda bajo el pliegue | ~12 |
| **Total** | | **≈ 65-77 interacciones y 12 envíos** |

- **No hay forma de clasificar en lote**, ni siquiera 12 archivos con sugerencia al 95 %. La interfaz
  lo bloquea (`TriageClassifyForm.tsx:76`, `loteInvalido`) y el backend también, porque acepta un
  solo archivo por llamada (`document_ingest.py:395-396`).
- **Con un modelo tipo Ramp** se necesitan unas 15 interacciones: soltar, revisar los grupos,
  "Confirmar 9 sugeridos", y luego unas 2 por cada uno de los 3 restantes.

## 3. Hallazgos

Severidad: **bloqueante** (impide la tarea o muestra algo falso), **alta** (la tarea se completa solo
con un desvío), **media** (fricción o confusión) y **baja** (pulido).

| id | sev. | Qué pasa | Evidencia | Dirección sugerida |
|---|---|---|---|---|
| H1 | bloqueante | **La sugerencia es decorativa.** `revision tecnica AAAA11.pdf` llega AUTO al 95 %: el motor ya sabe el equipo y el tipo. Aun así la fila cae en "Sin empresa" y el panel dice "Este documento todavía no tiene empresa. Elígela arriba", con "Clasificar" deshabilitado. El ítem guarda `entity_id`/`requirement_id`, pero `carrier_id` queda nulo, y el formulario nunca lee la sugerencia. | `sinclasificar-04`; `document_ingest.py:194-217` (no escribe `carrier_id`); `TriageClassifyForm.tsx` no usa `suggested_*` (grep) | Derivar la empresa del titular sugerido. Preseleccionar el casillero. Confirmar con un clic, o en lote, lo que llega AUTO. |
| H2 | bloqueante | **Un error se muestra como vacío.** Con `/document-ingest/items` respondiendo 500, la pantalla dice "0 sin clasificar · No hay documentos sin clasificar", y el contador del sidebar desaparece. Contradice la regla de `AGENTS.md` y la tabla de estados de Pendientes. | `sinclasificar-22-error-1440.png`; `TriageWorkbench.tsx:544-574` (solo mira `isPending`) | Usar el estado de error compartido (`Estado tipo="error"` + Reintentar), como en spec Pendientes §5.3. |
| H3 | alta | **Callejón sin salida al elegir empresa con un archivo enfocado (sin marcar).** La empresa queda fijada, pero el archivo sigue sin empresa y el panel sigue diciendo "Elígela arriba". Si después se marca el archivo, el buscador de arriba ya no aparece, porque hay una empresa "elegida". La única salida es "Mover 1 archivo **a otra** empresa", un texto falso porque el archivo no tenía ninguna. | `sinclasificar-05`, `-06`, `-07`; `TriageWorkbench.tsx:166-187` (`marcadosSinEmpresa` ignora el foco) y `:426-459` | Un solo gesto: "¿De quién es?" en el detalle del archivo enfocado, que aplica a ese archivo o a los marcados. |
| H4 | alta | **El panel afirma "no tiene requisitos pendientes" mientras carga.** Con Cordillera elegida y 6 pendientes reales, durante la carga dice "Esta empresa no tiene requisitos pendientes… Suele pasar cuando la empresa no está activa". Un segundo después aparecen los 6. | `sinclasificar-09` frente a `-10`; `TriageClassifyForm.tsx:202-208` (no distingue "cargando" de "vacío") | Esqueleto mientras carga. "Sin pendientes" solo con el dato en mano. |
| H5 | alta | **No hay clasificación en lote**, aunque el resto de la pantalla la promete. La zona de carga dice "Se agrupan por empresa o por tipo y tú confirmas". La tarjeta con varios marcados dice "Lo que elijas arriba se aplica a todos", y justo arriba el panel dice "deja marcado uno solo". El docstring dice "con quince aplica a los quince". | `sinclasificar-15`; `TriageDropzone.tsx:89-92`; `TriagePreview.tsx:21-31`; `TriageClassifyForm.tsx:141-145`; `TriageWorkbench.tsx:58-60`; `document_ingest.py:395-396` | Lote real, **un archivo por casillero**: confirmar N filas, cada una con su sugerencia. Es lo que ya hace `BulkUploadReview` en Pendientes. |
| H6 | alta | **La empresa elegida queda pegada y gobierna las subidas siguientes en silencio.** Se eligió Cordillera para clasificar un archivo; la siguiente tanda entró entera como de Cordillera. Con una tanda mezclada, eso atribuye mal todo lo que no es de Cordillera. | `sinclasificar-18` (3 archivos nuevos directo al grupo Cordillera); `TriageWorkbench.tsx:215` (`upload(empresa?.id, …)`) | La empresa de una subida se declara en el gesto de subir, no como un estado de la pantalla. |
| H7 | media | **"N empresas" cuenta "Sin empresa" como una empresa más.** Con todo sin empresa dice "· 1 empresa"; con un grupo real más "Sin empresa" dice "· 2 empresas". | `sinclasificar-02`, `-08`, `-12`; `TriageWorkbench.tsx:144` | Contar solo los `carrier_id` no nulos, o decir "11 sin empresa". |
| H8 | media | **Deshacer pierde la sugerencia.** Después de deshacer, `revision tecnica AAAA11.pdf` vuelve como UNMATCHED con "—", y deja de contar para "mismo casillero" (`-19` muestra 2 archivos y no 3). Para volver a calcular el match hay que mover el archivo a otra empresa y traerlo de vuelta. | `sinclasificar-14`, `-19`; `document_ingest.py:655-666` | Al revertir, volver a calcular el match con el mismo motor que la subida y el movimiento. |
| H9 | media | **Avisos de colisión sin acción.** "2 archivos reclaman el mismo casillero" no dice cuál casillero ni cuál es el otro archivo, y no ofrece comparar. "Este archivo ya está en la cola" aparece en **los dos** duplicados, sin decir cuál conservar. "Casillero" es jerga del modelo. | `sinclasificar-03`, `-19`; `TriageFileTable.tsx:183-205` | Agrupar las colisiones como un conflicto con "Conservar este" / "Descartar los otros", nombrando el documento y su titular. |
| H10 | media | **Sin permiso de carga, la pantalla ofrece igual el trabajo.** Óscar (Operaciones) ve las casillas, los atajos "space marcar", "1 · Elige / 2 · Indica qué son", "elige una empresa arriba" (sin buscador) y "Selecciona uno o más documentos" aunque tenga uno enfocado. El sidebar le muestra un contador rojo de 16. | `sinclasificar-20`, `-21`; `TriageClassifyForm` recibe `targetIds=[]` (`TriageWorkbench.tsx:597`) | Modo consulta: lista y vista previa, sin pasos ni casillas. Decidir si Operaciones debe ver esta cola (P5). |
| H11 | media | **En el teléfono (390 px) no se puede trabajar.** Los nombres se cortan en "revision…" (los tres RT son indistinguibles). El panel queda 737 px más abajo que la fila tocada. Hay 3 contenedores con scroll anidados. Los atajos de teclado y "Suelta archivos en cualquier parte" aparecen en un teléfono. | `sinclasificar-24`, `-25`; métricas de scroll en el recorrido | Lista y detalle en dos pantallas ("← Sin clasificar"), como en Pendientes §5.3. |
| H12 | media | **El texto del buscador de "Mover" no se ve**: el nombre de la empresa sale blanco sobre blanco dentro de la barra oscura. Solo se lee el RUT. | `sinclasificar-07`; `MoveToCarrierBar.tsx:69-77` dentro de `BarraDeSeleccion` (`bg-text-primary`) | Abrir el selector como popover sobre fondo claro. |
| H13 | media | **Vista previa chica y en mal lugar.** Mide 160 px, va debajo del formulario y baja del pliegue al elegir casillero. Es lo único que permite leer la fecha impresa. Mientras carga dice "Sin vista previa" (`-12`), que es otra vez la carga contada como ausencia. | `TriagePreview.tsx:40,47`; `sinclasificar-11`, `-12` | Patrón Ramp/Dext: el documento grande a la izquierda del detalle y el formulario al lado. |
| H14 | media | **Avisos viejos que no se van.** El error de `notas.txt` sigue en pantalla a lo largo de todo el recorrido. "1 archivo volvió a la bandeja" queda bajo el pliegue (y = 783 en un alto visible de 772) y sigue ahí después de un descarte. Hay 3 superficies de aviso: error de subida, aviso oscuro con Deshacer y aviso oscuro chico. | `sinclasificar-12` a `-17`; `TriageWorkbench.tsx:500-507,611-629` | Un solo canal de avisos (toast con su ciclo de vida), arriba o anclado. |
| H15 | baja | **Dos nombres para lo mismo:** la pantalla dice "Sin clasificar" y los avisos y enlaces dicen "bandeja" ("volvió a la bandeja", "Llévalos a la Bandeja", "agregarlos a la bandeja"). | `TriageWorkbench.tsx:243`; `PuenteALaBandeja.tsx`; `TriageDropzone.tsx:99` | Un solo nombre. |
| H16 | baja | **La sugerencia sin tipo se muestra como "—"** con el tooltip "el clasificador no encontró ninguna señal", aunque sí encontró al titular (por ejemplo `padron BBBB11.pdf` → equipo BBBB11 al 0,60, o `licencia Rojas…` → conductor por nombre al 1,0). | `TriageFileTable.tsx:210-229`; consulta a `document_ingest_items` | Mostrar lo que se sabe: "BBBB11 · ¿qué documento?". |
| H17 | baja | **En la tabla vacía** se ven igual la barra "Ninguno seleccionado · marca con la casilla…", los atajos de teclado y el paso 2 con sus instrucciones. Es una mesa de trabajo vacía en vez de un estado vacío. | `sinclasificar-01` | Estado vacío de una sola pieza: "Nada por clasificar" + "Subir archivos". |
| H18 | baja | **"AUTO" no significa automático.** El umbral dice "Desde acá se aplica sin intervención humana" (`document_matcher.py:18-19`), pero nada se aplica solo. Es correcto según HU-01 ("nada toca `compliance_records` hasta que una persona lo clasifica"), pero el nombre engaña a quien lea el código o las métricas (`matched_auto`). | `document_matcher.py:18-19`; `document_ingest.py:224-235` | Renombrar el estado a "listo para confirmar" en la interfaz, o decidir P2. |

**Nota de la simulación:** los RUT que inventé para los nombres de archivo tenían el dígito
verificador malo, y el motor los descarta, como corresponde (`extract_ruts`). Por eso, en la puerta
global, solo hubo match por patente y por nombre. No es un defecto. Con empresa fijada, los tres
archivos nuevos sí trajeron sugerencia al 95 % (`-18`).

## 4. Comparación con productos enterprise

| Producto | Qué hace para bajar la densidad | Qué se toma |
|---|---|---|
| **Ramp / Expensify / Brex** (recibos contra transacciones; es el análogo más cercano) | El recibo entra por correo o por foto. El sistema lo empareja solo y, si confía, lo **adjunta sin preguntar**. La persona solo ve las **excepciones** ("Missing receipt", "Needs review"). La revisión es lista + detalle con la **imagen grande** y la propuesta al lado, y se aprueba con un botón. | Cola de excepciones, no de todo; confirmar en lote lo seguro; imagen grande. |
| **Dext / Hubdoc** (documentos contables) | El "Inbox" agrupa por estado: "Ready to publish", "Needs attention" y "Duplicates", cada uno con **una** acción en lote ("Publish 23"). Los duplicados son un grupo propio, con comparación lado a lado. | Grupos por estado de la sugerencia; duplicados como conflicto con resolución. |
| **Gmail / Front** (triage) | Una sola acción principal por ítem (archivar/asignar), atajos `j/k/e`, y después de actuar **avanza al siguiente**. La barra de selección solo aparece al marcar. | El avance automático ya existe; faltan el atajo de confirmación (`Enter`) y quitar los avisos permanentes. |
| **Linear Triage** | Cada ítem entrante se resuelve con *Accept / Duplicate / Decline*, que son 3 verbos fijos. El detalle se abre al costado y no hay modos. | Verbos fijos por ítem: Confirmar · Cambiar · Descartar. |
| **DocuSign / Box / Dropbox** (bandeja de archivos) | Divulgación progresiva: la fila muestra nombre, origen y estado, y la metadata se edita en el detalle. La subida es un **botón** en la cabecera; la zona de arrastre aparece solo al arrastrar, como overlay. | La zona de carga sale del flujo permanente y pasa a ser un botón con overlay de arrastre. |

**Lo que comparten:**
1. Se muestran las **excepciones**, no el volumen.
2. Hay **una acción principal** por estado y por grupo.
3. La propuesta del sistema **viene preseleccionada**.
4. El documento se ve **grande**.
5. El ítem se resuelve **en lote** cuando la propuesta es segura.
6. **Cero instrucciones permanentes**: la pantalla se explica sola.

## 5. Opciones para el rediseño

### Opción A — Ordenar lo que hay (corregir y aligerar)
Se corrigen H1-H4, H7, H8, H12 y H14. Se preselecciona la sugerencia. La zona de carga pasa a ser un
botón y se quitan las instrucciones permanentes.
- **Pros:** es lo más barato y no cambia el modelo mental.
- **Contras:** sigue habiendo 4 modos y la clasificación de a uno (H5): la tanda de 12 sigue en unas
  40 interacciones. Pendientes y Sin clasificar quedan con **dos** revisiones de lote distintas para
  el mismo gesto, el antipatrón de "una variante es una prop, no un hermano".
- **Unión con Pendientes:** "Enviar a Sin clasificar" sería subir el archivo a la cola global (con
  `POST /document-ingest/files`) y perder lo que Pendientes ya sabía: el tipo.

### Opción B — Sin clasificar como cola de excepciones con revisión agrupada (modelo Ramp/Dext)
- **Pantalla de lista y detalle**, el mismo esqueleto que Pendientes. Los archivos se agrupan por
  **qué falta**:
  - **Listos para confirmar:** titular y tipo conocidos. Acción: "Confirmar N".
  - **Falta el tipo:** el titular es conocido.
  - **Falta el titular:** el tipo es conocido. Aquí llega lo que viene de Pendientes.
  - **Sin pista.**
  - **Duplicados y conflictos.**
- **El detalle muestra el documento grande**, con la propuesta preseleccionada y 3 verbos:
  Confirmar · Cambiar · Descartar. Se maneja con teclado: `j/k`, `Enter` y `#`.
- **La subida es un botón** en la cabecera, con overlay de arrastre. La empresa de la subida se
  pregunta en ese gesto, y es opcional.
- **El lote es real**, con un archivo por casillero: el backend acepta N pares (ítem → registro), no
  N ítems → un registro.
- **La fila de revisión es el mismo componente que `BulkUploadReview`**, con una prop de origen
  (archivo nuevo o ítem en staging).
- **Pros:**
  - Ataca la densidad de raíz: un modo, una acción principal por grupo.
  - La tanda de 12 baja a unas 15 interacciones.
  - Pendientes y Sin clasificar hablan el mismo idioma ("Asignados / Por elegir / Sin asignar").
- **Contras:**
  - Toca el backend: classify-batch por pares, `carrier_id` derivado del titular sugerido y nuevo
    cálculo del match al deshacer.
  - Requiere maqueta y spec.
- **Unión con Pendientes:** "Quitar" pasa a ser **"Enviar a Sin clasificar"**, y el archivo **viaja
  con el tipo ya conocido** (el requisito de la página de Pendientes). Cae en el grupo "Falta el
  titular", nunca en "Sin pista". Hace falta que la subida a staging acepte un tipo declarado.
  `_from_manifest` ya modela "tipo declarado" (`document_matcher.py:115`).

### Opción C — Una sola puerta de carga; Sin clasificar solo resuelve
- **Toda carga pasa por un único flujo** "Subir documentos": desde Pendientes con el tipo fijado, o
  global sin nada fijado.
- **El paso de revisión es el mismo.** Lo que queda sin resolver al guardar **va solo** a Sin
  clasificar.
- **Sin clasificar no tiene zona de carga.** Es una lista de excepciones con detalle, como en B.
- **Pros:**
  - Es la menor cantidad de superficies: una puerta y una cola.
  - El botón de unión desaparece porque todo es automático.
  - Es el modelo de Ramp, donde todo entra por el mismo sitio.
- **Contras:**
  - Reabre el flujo de carga en lote de Pendientes, que se acaba de construir.
  - Quien hoy suelta 120 archivos en Sin clasificar tendría que ir a otra pantalla para subirlos.
  - Exige decidir dónde vive el botón global (P1).
- **Unión con Pendientes:** el botón no existe. Lo no asignado se manda a staging al guardar, con su
  tipo.

### Recomendación
**Opción B.** Corrige los dos bloqueantes y la falta de lote real sin desarmar Pendientes. Además
deja la revisión de lote escrita una sola vez y compartida por las dos tareas. C es el destino natural
si Pablo confirma que la tanda mezclada es rara (P1). B no cierra ese camino: retirar después la zona
de carga de Sin clasificar es quitar un botón.

**Orden sugerido:**
1. **Ahora, sin esperar el rediseño:** H2 (error como vacío) y H4 (cargando como vacío). Son
   defectos, no diseño.
2. **Con el rediseño:** el resto, empezando por H1 y H5.
3. **El botón "Enviar a Sin clasificar" de Pendientes conviene cablearlo junto con B**, para que el
   archivo llegue con su tipo. Cablearlo antes, con la cola actual, lo dejaría en el grupo "Sin
   empresa" sin el tipo que ya se conocía.

## 6. Preguntas abiertas (para el usuario y para Pablo)

1. **¿Cuán frecuente es la tanda mezclada** (varias empresas en un mismo correo), comparada con
   "todo de una empresa"? Define si la empresa es el primer paso de la subida y si conviene la
   opción C.
2. **¿Se puede confirmar en lote, con un clic, lo que el motor da por seguro** (RUT o patente + tipo,
   ≥ 0,90)? ¿O Certificación quiere abrir cada uno? HU-01 exige que una persona confirme; un
   "Confirmar 9" lo cumple.
3. **La fecha de vencimiento se lee del papel.** ¿Basta con una vista previa grande, o se espera que
   el sistema la proponga (OCR, fuera de alcance hoy)?
4. **¿Qué se hace con el archivo de alguien que está al día** (renovación anticipada)? ¿Reemplaza el
   vigente, queda como "próximo", o se descarta?
5. **¿Operaciones debe ver Sin clasificar?** Hoy lo ve, con contador rojo, sin poder hacer nada
   (H10).
6. **Descartar borra el archivo para siempre.** ¿Hace falta una papelera de 30 días?
7. **Un solo nombre:** ¿"Sin clasificar" o "Bandeja"?
8. **Duplicados exactos (mismo contenido):** ¿se descartan solos y se avisa, o se pregunta?

## Capturas

`/Users/usuario/Desktop/projects/webcarga/.playwright-mcp/`:

| Archivo | Muestra |
|---|---|
| `sinclasificar-01-inicial-1440` | Vacío |
| `-02-llegada` | Llegada de 13 archivos y el error de `notas.txt` |
| `-03-sugerencias` | La sugerencia AUTO |
| `-04-foco-sin-empresa` | H1 |
| `-05`, `-06`, `-07` | H3 y H12 |
| `-08-tras-mover` | H7 |
| `-09`, `-10` | H4 |
| `-11-casillero-elegido` | H13 |
| `-12-clasificado-deshacer` | Clasificado, con Deshacer |
| `-13-preview-imagen` | Vista previa de una imagen |
| `-14-deshecho` | H8 |
| `-15-lote-marcado` | H5 |
| `-16`, `-17` | Descartar |
| `-18-colisiones` | H6, casillero ocupado |
| `-19-mismo-casillero` | H9 |
| `-20`, `-21` | Sin permiso, H10 |
| `-22-error` | H2 |
| `-23`, `-24`, `-25` | Teléfono a 390 px, H11 |

**La copia local quedó con los archivos subidos en este recorrido.** Son ficticios y siguen en el
volumen de Docker `webcarga-sim`. Supabase se detuvo al terminar, como estaba al empezar.
