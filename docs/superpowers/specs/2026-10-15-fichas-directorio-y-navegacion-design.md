# Fichas del Directorio, navegación entre módulos y kit visual de Certificación

Fecha: 15/10. Brainstorming con el visual companion; maquetas aprobadas en
`docs/superpowers/mockups/2026-10-15-fichas-ficha-liviana.html` (estructura),
`…-ficha-alineada.html` (material visual) y `…-navegacion.html` (clic en un nombre).

## Por qué

Levantamiento del 15/10, hecho con mediciones en el código y capturas en dev:

- **Las tres fichas (empresa, conductor y equipo) no siguen el estándar y se ven de la versión anterior.**
  - El panel de conductor tiene 18 colores crudos y 11 textos de menos de 11 px; el de equipo, 20 y 7. La ficha de
    empresa tiene 55 colores crudos.
  - El Resumen de conductor y equipo es un formulario.
  - Las acciones destructivas son botones rojos en el cuerpo.
  - Documentos no muestra fechas.
  - La ficha de empresa dice "Tax ID" e "ID legacy admin".
- **Faltan caminos entre pantallas.**
  - Pendientes, Por asignar, Pedidos de Operaciones, el detalle del viaje y Seguros no tienen ningún enlace a una
    ficha (0 enlaces, confirmado en dev). Llegar a la ficha cuesta "buscar": 3 clics y escribir.
  - El modal de conductor o equipo de la ficha de empresa no abre la ficha propia.
  - Conductor ↔ tracto habitual no están enlazados.
  - "Volver" desde una ficha pierde los filtros de la lista.
- **Certificación no es coherente consigo misma.**
  - "Agrupar por" se elige con dos controles distintos: una barra gris en Empresas y un control segmentado en
    Pendientes.
  - Los mismos tres conteos (vencidos, por vencer, faltan) se dibujan con dos primitivas: `ComplianceCounts`, con
    íconos, y `StatusChip`, con pastillas.
  - La tabla de Por asignar (`TriageFileTable`) no usa ninguna primitiva de `components/ui`: encabezados en
    mayúsculas, letra monoespaciada, un tercer estilo de chip y franjas de aviso propias.

## Decisiones del usuario (15/10, en orden)

1. **Forma de la ficha:** encabezado más contenido, no un panel lateral fijo. La misma forma para las tres entidades.
2. **Documentos:** una tabla con filtro, no grupos por estado.
3. **Clic en un nombre:** abre la vista rápida, que tiene "Abrir ficha completa"; Ctrl/Cmd + clic abre la ficha en otra
   pestaña.
4. **Versión liviana:** cada dato aparece una sola vez. La versión con tarjetas se descartó por saturada: "3
   pendientes" aparecía tres veces y los datos se repetían en el encabezado y en una tarjeta.
5. **Material visual:** las piezas de Certificación (Pendientes), no las pestañas subrayadas que dibujé primero.
6. **Alcance:** opción A, en dos entregas.
   - **Entrega 1:** el kit, las fichas y la navegación.
   - **Entrega 2:** alinear Empresas y Por asignar con el kit.
   - **Fuera:** la búsqueda global (Cmd+K), que queda como mejora para después.

## El kit (sale de Pendientes; vive en `components/ui`)

Cada pieza se usa igual en todas las pantallas. Una variante es una prop, no un componente hermano.

| Pieza | Qué es | Origen |
|---|---|---|
| Barra de secciones | Las secciones de una página: barra gris y la sección elegida en blanco | `components/ui/Tabs` (ya existe, la extraje de la ficha de empresa el 15/10) |
| Filtro o agrupación de una lista | Control segmentado blanco; lo elegido en celeste, con su número | `SegmentedControl` (ya existe) |
| Tabla | Borde y esquinas redondeadas; encabezado gris claro en texto normal de 12 px (sin mayúsculas); filas de 13 px; el orden con `tabla/useOrden` | **Nueva:** `components/ui/tabla/Tabla.tsx`. Hoy cada pantalla arma la suya |
| Chip de estado con fecha | "Venció el 02/10" · "Vence en 13 días · 28/10" · "Falta" · "Falta la fecha de vencimiento" | `pendingRowStatus` (`lib/pending.ts`) + `StatusChip`. La regla es una sola |
| Fila de un documento y su acción | Chip, fecha y el botón con borde punteado celeste ("Subir", "Subir la nueva" o "Completar" según el estado; "Pedir" para quien tiene `certification.request` y no `documents.upload`) | `RenglonPendiente`: **ya es la fila compartida** de Pendientes y de la ficha de empresa. `DocumentChecklist`, la otra forma de dibujar un documento, queda solo en la vista rápida |
| Conteos de una fila | Vencidos · por vencer · faltan como pastillas teñidas (rojo, naranja, gris) | **Uno solo:** `ComplianceCounts` adopta el aspecto de las pastillas de Pendientes y la lista de Pendientes lo usa. Se acaba la segunda forma |
| Acción principal de la página | Botón celeste lleno con ícono, a la derecha del título (`EncabezadoDePagina`, children) | El de Por asignar ("Subir documentos") |
| Subida en lote dentro de una tabla de documentos | Franja gris "Arrastra aquí… · Elegir archivos" sobre la tabla | La de Pendientes; abre `BulkUploadReview` con el contexto puesto |
| Nombre de una entidad | Enlace con la vista rápida | `EntityCell` (ver Navegación) |

**Fechas:** cortas, 02/10, y con año solo si no es el actual. Es la regla de Pendientes (`diaMes`).

## Las fichas (Entrega 1)

Una sola forma para empresa, conductor y equipo.

**Encabezado** (`EncabezadoDePagina`)
- Título: el nombre, o la patente para un equipo.
- Bajo el título, chips de ciclo de vida y de habilitación, y al lado **la razón de la no habilitación** en una línea,
  con "Ver documentos". Por ejemplo: "Licencia vencida y 2 documentos faltan".
- A la derecha, la acción principal ("Subir documentos", o "Pedir a Certificación" para Operaciones) y el menú "⋯".
- Nada más: los pendientes no se repiten como chip, porque su número ya está en la sección Documentos.

**Secciones** (`Tabs`)
- Empresa: Resumen · Documentos · Conductores · Equipos · Seguros · Contactos.
- Conductor: Resumen · Documentos · Contactos.
- Equipo: Resumen · Documentos.
- La sección viva en `?tab=`, como hoy.

**Resumen:** un solo bloque "Detalles", en solo lectura y con "Editar". Por entidad:
- **Conductor:**
  - RUT;
  - empresa, con "desde 20/09 · antes Riquelme Hnos." (el historial de `…/assignments`);
  - tracto habitual, como enlace;
  - origen habitual;
  - debajo, una línea de actividad: último viaje, viajes en 30 días y "Ver en el Monitor".
- **Equipo:** tipo y subtipo, tipo de operación, año, conductor habitual (enlace), empresa con su historial y la
  misma línea de actividad.
- **Empresa:**
  - RUT;
  - tipo de operación, con "(según su flota)" y la gestión declarada;
  - clientes;
  - estado de seguros: un chip si hay algo vencido; "Sin pólizas registradas" si no hay ninguna.
  - Sale del Resumen de la empresa: el anillo de %, las cifras sueltas de conductores y equipos (ya están en las
    secciones) y la tarjeta vacía de seguros. "ID legacy admin" pasa al formulario de "Editar".
- "Editar" convierte el bloque en formulario en el mismo lugar, con Guardar y Cancelar. **El borrador se vuelve a
  cargar desde los datos cada vez que se abre**, por la clase de bug que ya apareció 4 veces.

**Documentos:** en las tres fichas es **la pestaña Documentos de la empresa de hoy (`CarrierDocumentsWorkspace`),
generalizada a `DocumentsWorkspace`**, con una prop para la empresa con su flota o para un conductor o equipo solo.
Ya tiene la vista por sujeto con filtro, las versiones y la corrección del vencimiento (C7), y sus filas son
`RenglonPendiente`. Las filas son las de `GET …/documents` (Entrega B), las mismas para las tres entidades. Se dibuja
sobre la tabla del kit, con columnas Documento · Estado · Actualizado y la acción.
- Arriba, el control segmentado Vencidos · Por vencer · Faltan · Todos, con números. Abre en el primero que tenga algo,
  en ese orden; si no hay nada, en Todos.
- La franja de subida en lote.
- La ficha de empresa agrega la columna "De quién": la empresa, un conductor o un equipo, cada uno con `EntityCell`.
  Es lo que hoy hace `CarrierDocumentsWorkspace`, con la tabla del kit.
- El "⋯" de cada fila lleva lo que hoy existe y el permiso habilita: corregir vencimiento, historial de versiones,
  reasignar y eliminar.

**Menú "⋯" de la ficha.** Lo destructivo siempre pide confirmación, con la vista previa del impacto cuando ya existe.
- Empresa: Editar clientes · Reactivar o Dar de baja · Eliminar.
- Conductor: Transferir a otra empresa · Corregir RUT · Dar de baja o Reactivar · Quitar de la empresa.
- Equipo: lo mismo que el conductor, con "Corregir patente".
- Cada opción aparece solo con su permiso, el mismo de hoy. Si no queda ninguna, el "⋯" no se dibuja.

**De dónde salen los datos (sin endpoints nuevos para conductor y equipo):**
- **Encabezado de conductor y equipo:** `GET /drivers|assets/{id}/summary`, el mismo de la vista rápida. Ya trae
  `can_operate`, conteos, empresa y tracto o conductor habitual. El detalle de edición sigue en `GET /drivers|assets/{id}`.
- **Razón de conductor y equipo:** los registros de `…/compliance-records` filtrados con `isBlocking` (`lib/states`),
  que es la misma regla que `blocking_mandatory`. Un criterio de aceptación verifica que coincidan.
- **Empresa:** su habilitación ya cuenta los obligatorios de la flota activa (`carrier_compliance`). Sus cifras de hoy
  cuentan también los opcionales, así que no sirven para decir la razón. **Cambio de backend chico:**
  `carrier_compliance` agrega `blocking_own` y `blocking_fleet`, y el resumen de la empresa los expone. La razón dice
  "N obligatorios de la empresa y M de su flota".

## Navegación (Entrega 1)

- **`EntityCell` pasa a ser `<a href={ficha}>`.**
  - Un clic sin teclas modificadoras hace `preventDefault` y abre la vista rápida, que tiene "Abrir ficha completa".
  - Ctrl/Cmd + clic, Shift + clic y el clic medio siguen siendo de un enlace.
  - La vista rápida es la que ya existe (`EntityQuickView`); no cambia.
- **Se usa en:**
  - Pendientes (titular y empresa);
  - Pedidos de Operaciones;
  - Por asignar (el titular de la propuesta y la empresa del detalle);
  - el detalle del viaje (conductor, tracto y empresa);
  - Seguros (empresa);
  - la tabla de Documentos de la empresa (De quién).
- **El modal de conductor o equipo de la ficha de empresa** gana "Abrir ficha completa".
- **Las listas del Directorio** (Empresas, Conductores y Equipos) siguen enlazando directo a la ficha y le pasan
  `?next=` con sus filtros. La ruta de la ficha vuelve ahí (`returnLink` ya existe). Desde la lista filtrada por
  documentos, la ficha abre en Documentos, como ya hace.
- **Conductor ↔ tracto habitual:** enlaces con `EntityCell`, en Detalles.

## Entrega 2: Empresas y Por asignar con el kit

- **Empresas:**
  - "Agrupar por" pasa al `SegmentedControl`, como en Pendientes.
  - Los conteos de cada fila usan el `ComplianceCounts` unificado.
  - La lista gana encabezados de columna (Empresa · Tipo · Viajes 30 días · Avance · Pendientes).
  - La acción principal sigue la regla del kit.
  - Las filas plegables se quedan, porque son su forma de trabajo.
- **Por asignar:**
  - `TriageFileTable` sobre `Tabla`: encabezados en texto normal y nombre de archivo en la letra normal.
  - La sugerencia pasa a un chip del kit, sin borde ni dos líneas: el requisito y el titular con `EntityCell`, y el % en
    gris.
  - Los avisos ("3 archivos reclaman el mismo casillero") pasan a ser un ícono con texto en la celda, no una franja
    rosada.
  - El total sale del título y queda en el menú y en los grupos.

## Estados (cada ficha)

- **Cargando:** el encabezado espera al resumen. Mientras no llega, no se dibuja ni un chip ni la razón: un "0" en
  vuelo miente.
- **Vacío:**
  - Sin requisitos exigidos: "No se le exige ningún documento", sin tabla vacía.
  - Sin empresa: el encabezado lo dice y "Asignar a una empresa" queda en el "⋯" (existe sin empresa, C5).
- **Sin permiso:** se ve todo y no se ve "Editar".
  - El "⋯" muestra solo lo permitido.
  - En la fila, Operaciones ve "Pedir" en vez de "Subir".
- **Falló:** un error al guardar Detalles deja el formulario abierto con lo escrito y el mensaje de la API. Si no
  carga el resumen, se usa el `Estado` de error, igual que hoy.
- **Teléfono:** encabezado, secciones (la barra se desplaza hacia el costado) y bloques uno debajo del otro. La tabla
  de Documentos se desplaza hacia el costado dentro de su tarjeta.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Nivel |
|---|---|---|
| F1 | El encabezado de conductor y equipo muestra ciclo de vida, habilitación y la razón; la razón nombra los obligatorios vencidos o faltantes | vitest |
| F2 | La habilitación del encabezado y la razón coinciden: `can_operate = false` si y solo si `isBlocking` encuentra algo (conductor) | base real |
| F3 | La empresa expone `blocking_own` y `blocking_fleet`, y su `can_operate` es falso si y solo si su suma es mayor que 0 | base real |
| F4 | El Resumen no repite los pendientes: ni chip ni tarjeta de documentos | vitest |
| F5 | Documentos abre en el primer filtro con algo (Vencidos → Faltan → Por vencer → Todos) | vitest |
| F6 | La ficha de conductor dibuja sus documentos con `DocumentsWorkspace`/`RenglonPendiente`: mismos chips y acciones que Pendientes (`pendingRowStatus`) | vitest |
| F7 | El "⋯" de cada entidad tiene sus opciones según el permiso, y sin ninguna no se dibuja | vitest |
| F8 | "Editar" vuelve a cargar el borrador al abrirse (abrir, cancelar, cambiar el dato afuera y reabrir muestra el valor nuevo) | vitest |
| F9 | Conductor → tracto habitual y equipo → conductor habitual son enlaces | vitest |
| N1 | `EntityCell` es un enlace a la ficha; el clic abre la vista rápida, y Ctrl/Cmd + clic no la abre | vitest |
| N2 | Pendientes, Pedidos, Por asignar, el detalle del viaje y Seguros enlazan sus nombres con `EntityCell` | vitest (uno por pantalla) |
| N3 | La ruta de una ficha abierta desde una lista filtrada vuelve a la lista con sus filtros | vitest |
| K1 | `Tabla`, `ComplianceCounts` y la acción de fila se usan en la ficha y en Pendientes (prueba de que son las mismas) | vitest |
| E2-1 | Empresas agrupa con `SegmentedControl` y cuenta con `ComplianceCounts` | vitest |
| E2-2 | Por asignar dibuja su tabla con `Tabla`, sin mayúsculas ni monoespaciado en el nombre de archivo | vitest |

**Una sola forma de dibujar un documento en las fichas:** el modal de conductor o equipo (sobre la ficha de empresa)
también usa `DocumentsWorkspace`, y `DocumentChecklist` deja de usarse en los dos paneles.

**Trinquetes:** los colores crudos y el texto de menos de 11 px de los archivos tocados bajan, y los topes de
`lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` se bajan en el mismo commit. Los dos paneles viejos
(`DriverDetailPanel` y `VehicleDetailPanel`) quedan solo como modal, sobre el mismo kit.

## Humo E2E que se agrega

- Ficha de conductor: encabezado con la razón → "Ver documentos" → tabla en Vencidos.
- Pendientes: clic en un titular → vista rápida → "Abrir ficha completa".
- Lista de conductores filtrada → ficha → la ruta vuelve con el filtro.
- Ficha de empresa: modal de un conductor → "Abrir ficha completa".

## Verificación visual

Capturas de Playwright al mismo ancho que `…-ficha-alineada.html`, lado a lado, en escritorio y en teléfono, para las
tres fichas, para Pendientes con un nombre enlazado y (en la Entrega 2) para Empresas y Por asignar. Si no coinciden,
no está lista.

## Fuera de alcance

- La búsqueda global (Cmd+K).
- Rehacer la vista rápida.
- La sección Seguros de la empresa, más allá de usar la tabla del kit si hoy tiene una tabla propia.
- La fila "Tractocamión" sin `code` en `FLEET_SERVICE_TYPE` (tangente anotada).
