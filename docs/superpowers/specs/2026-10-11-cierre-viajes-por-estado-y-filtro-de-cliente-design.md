# Cierre › Viajes en tres pestañas, y filtro de cliente dinámico y coherente — diseño

Fecha: 2026-10-11 · Estado: diseño aprobado en conversación (11/10), spec en revisión · Rama: `dev`

## 1. Contexto

Son dos ruidos que el usuario vio en el Cierre el 11/10.

**Viajes.** El 10/10 la pestaña mostraba 7 tablas apiladas: Hoy, Rezago, Ofertas sin declarar, En curso, Abandonados
por el TMS, Con motivo y Asignados pendientes de cierre del TMS. Cuatro estaban vacías. Lo único que había que resolver
era 1 viaje, y quedaba mezclado con 8 informativos. Además daba la impresión de que había duplicados. En la base no hay
ninguno: en un mes, ningún número de viaje se repite. La impresión venía de dos cosas:
- **Viajes que se arrastran.** Los informativos de días anteriores aparecen en el cierre de cada día. El 878052 de
  Sodimac, del 29/09, sale en todos los cierres desde entonces.
- **La misma patente o conductor en dos viajes distintos.** PYST91 tiene el 885613 y el 881496.

**Filtro de cliente del reporte.** La lista ofrece los 13 clientes del directorio, aunque el 07/10 solo operaron
Walmart, Iansa y Sodimac. Además el filtro solo saca los viajes de otros clientes y deja a todos los equipos sin carga:
con "Sodimac" elegido, "Equipos activos" en Tractoreo sigue sumando los tractos de Walmart que no cargaron.

**Estándar que se sigue:**
- **Colas de trabajo** (Linear, Zendesk, torres de control de transporte): una sola lista con pestañas por lo que la
  persona tiene que hacer, cada una con su cantidad; el camino por el que llegó un ítem es una columna, no una sección.
- **Filtros por facetas** (Power BI, Looker, Samsara): las opciones salen de los datos del período a la vista, con su
  cantidad, y el filtro se aplica a todas las cifras por igual.

## 2. Viajes: tres pestañas

Las siete secciones responden tres preguntas:

| Pestaña | Grupos de hoy (`GET /trips/cierre-viajes`) | Qué hace la persona |
|---|---|---|
| **Por resolver** | `hoy`, `rezago`, `oferta_sin_declarar`, `abandonado` | Declarar el motivo |
| **En seguimiento** | `en_curso`, `pendiente_cierre_tms` | Nada: mirar |
| **Resueltos** | `con_motivo` | Revisar o deshacer |

Así se ve con los datos del 10/10:

```
[ Por resolver (1) ]  [ En seguimiento (8) ]  [ Resueltos (0) ]          [ Buscar… ]

1 bloquea la firma del día
Nº viaje  Cliente  Fecha  Por qué está aquí     Patente  Conductor  Empresa   Motivo
889281    Sodimac  10/10  Del día · sin asignar  —        —          Webcarga  [Elige un motivo] Guardar
```

- **Pestaña inicial:** se abre en "Por resolver", o en "En seguimiento" si "Por resolver" está vacía. La elegida queda en
  la URL (`?trips=to_resolve|tracking|resolved`), como la pestaña del Cierre.
- **"Por qué está aquí"** (en Por resolver) es una columna con un valor por grupo de origen:
  - `hoy`: "Del día";
  - `rezago`: "Rezago · N días", donde N = fecha del cierre − fecha planificada;
  - `oferta_sin_declarar`: "Oferta retirada por el TMS";
  - `abandonado`: "Abandonado por el TMS".

  Un filtro de chips sobre la tabla deja ver uno solo. Las filas de `hoy` y `rezago` llevan la marca "Bloquea la
  firma", y el encabezado dice cuántas bloquean (el `bloquean` que ya devuelve la API).
- **"Situación"** (en En seguimiento) muestra el estado del TMS y lo traduce:
  - `en_curso`: "En ruta · <estado del TMS>";
  - `pendiente_cierre_tms`: "Espera cierre del TMS".

  La nota que hoy acompaña a esa sección ("Los sigue Facturación") va como texto de apoyo de la pestaña.
- **Arrastre:** toda fila con fecha planificada anterior a la del cierre lleva "hace N días" junto a la fecha.
- **Patente repetida:** si una patente aparece en más de una fila de la pestaña, cada fila lleva "N viajes". Al
  posarse sobre la marca (o tocarla en el teléfono) se listan los números de viaje.
- **Orden:** en cada pestaña, de la fecha planificada más antigua a la más nueva; a igual fecha, por Nº de viaje.
- **Acciones, según la pestaña y no según el grupo:**
  - **Por resolver:** todo se declara igual, con selección en lote y motivo por fila.
  - **Resueltos:** se deshace.
  - **En seguimiento:** sin acciones.

  Esto cambia una cosa: los `abandonado` hoy no tienen ninguna acción en el Cierre, aunque la pantalla dice "igual hay
  que cerrarlos". Ahora se declaran como los demás. El backend ya lo permite: `POST /trips/bulk-close` no restringe por
  grupo. En un día firmado todo es de solo lectura, como hoy.
- **Buscador** (minuta 09/10, ítem 22): busca en las tres pestañas a la vez. Cada pestaña muestra "x de y", y si la
  pestaña a la vista queda en 0 con resultados en otra, lo dice ("2 resultados en En seguimiento").

### Estados

| Estado | Qué se ve |
|---|---|
| Cargando | El indicador de siempre; las cantidades de las pestañas no se muestran hasta tener el dato |
| Pestaña vacía | Una línea según la pestaña:<br>- Por resolver: "Nada por resolver: puedes firmar el día"<br>- En seguimiento: "Ningún viaje en seguimiento"<br>- Resueltos: "Todavía no se declaró ningún viaje" |
| Error al cargar | Mensaje con "Reintentar" |
| Sin permiso / día firmado | Lo mismo que se ve, sin acciones (`useCanEdit` y `soloLectura`, como hoy) |

### La URL del Cierre, en inglés

Las rutas y la URL van en inglés; la etiqueta, en español (`lib/rutas.test.ts`). Hoy el Cierre usa `?fecha=` y valores
de `?tab=` en español (`flota`, `viajes`, `pendientes`, `reporte`), y la página arma la URL a mano en tres lugares.
- **Un módulo, `lib/navegacion/cierre.ts`,** junto a `lib/navegacion/viaje.ts`, es el único que lee y escribe la URL del
  Cierre: `?date=2026-10-10&tab=fleet|trips|pending|report&trips=to_resolve|tracking|resolved`.
- **Enlaces viejos.** Un enlace con `?fecha=…&tab=viajes` (marcadores, historial, el `?next=` del detalle del viaje) se
  lee igual y se reescribe a la forma nueva, el mismo criterio que las rutas viejas: no dar 404.
- **Fuera de alcance:** los parámetros `?fecha=` de la API del backend, que son contrato del backend. Quedan como deuda
  aparte.

### Una sola definición de los grupos

La API de Viajes no cambia, y los nombres de los grupos siguen siendo los del backend. Lo que define cómo se presenta
cada grupo vive en un solo módulo, `lib/cierre/gruposDeViajes.ts`: una tabla
`GrupoDelCierre → { pestaña, porQue, bloqueaLaFirma }`, tipada con `satisfies Record<GrupoDelCierre, …>`. Ese tipo
obliga a que un grupo nuevo del backend se clasifique ahí; si falta, el compilador falla.

De ahí salen:
- las pestañas y sus cantidades;
- la columna "Por qué está aquí";
- las acciones de cada fila;
- el orden.

Reemplaza `ORDEN_GRUPOS` y `GRUPO_INFO`, que hoy viven dentro del componente. `PasoViajesSection` queda como armazón
(pestañas, buscador, barra de lote), y la tabla se reutiliza en las tres pestañas con columnas según la pestaña:
una variante es una prop, no un componente hermano.

## 3. Filtro de cliente del reporte

**Opciones dinámicas.**
- La lista sale del día del reporte: solo los clientes con al menos un equipo asignado ese día, con su cantidad
  ("Walmart (32)").
- La opción por defecto se llama "Todos los clientes" (antes, "WebCarga consolidado").
- Si la persona cambia de fecha con un cliente elegido que ese día no operó, la opción se conserva como
  "Sodimac (0)": no se resetea en silencio.

**El filtro se aplica a todas las cifras por igual.** Un equipo pertenece a un cliente así:
- **Con carga:** al cliente de su viaje del día, como hoy.
- **Sin carga:** a cada cliente de su empresa en el directorio (`public.carrier_shippers` activos). Hoy las 37
  empresas con flota activa tienen al menos uno, y 5 de Equipo Completo tienen varios.
- **Conductores que no trabajaron:** igual que un equipo sin carga, por los clientes de su empresa.
- **Faltante de dotación:** también por los clientes de su empresa.

Con "Walmart" elegido, el reporte habla de la flota que trabaja para Walmart, haya cargado o no. Un equipo de una
empresa con varios clientes aparece al filtrar por cualquiera de ellos; con "Todos los clientes" se cuenta una vez.

**API.**
- `GET /api/v1/status-report` agrega `clients: [{ client_name, assigned }]`. Se calcula sobre el día completo, antes
  del filtro, y va ordenado por `assigned` de mayor a menor.
- La pantalla arma la lista con eso y deja de usar el directorio completo (`shippers`).
- **Una sola regla de pertenencia.** Una función, `_clientes_de_la_fila(fila)`, devuelve los clientes de una fila (de
  equipo o de conductor) según la regla de arriba. La usan por igual:
  - el filtro (`_filter_by_client`, que pasa a apoyarse en ella);
  - los conductores que no trabajaron;
  - el faltante de dotación.

  Ninguna sección decide por su cuenta.
- **Los clientes de cada empresa** se leen una vez por pedido, con una consulta sobre `carrier_shippers` (el mismo
  cruce que ya usa `daily_closures.py`), y viajan en las filas como `carrier_clients`.
- La comparación de nombres sigue sin distinguir mayúsculas.

## 4. Pruebas

- **Frontend (vitest), Viajes:**
  - las siete agrupaciones caen en sus tres pestañas;
  - las cantidades;
  - "Por qué está aquí" y la marca "Bloquea la firma";
  - "hace N días";
  - "N viajes" para una patente repetida;
  - el orden;
  - la pestaña inicial;
  - la vacía;
  - el buscador entre pestañas;
  - las acciones por grupo, que no cambian;
  - solo lectura en un día firmado.
- **Backend (pytest):**
  - `clients` trae solo a quienes cargaron, con su cantidad;
  - con un cliente elegido, un equipo sin carga de una empresa de ese cliente cuenta y uno de otra empresa no;
  - un equipo de una empresa con dos clientes cuenta en ambos filtros y una sola vez sin filtro;
  - lo mismo para conductores y faltante de dotación.
- **Integración contra Postgres:** la consulta nueva de clientes por empresa compila y devuelve nombres.
- **Frontend (vitest), filtro:**
  - la lista sale de `clients` con su cantidad;
  - "Todos los clientes";
  - el cliente elegido que ese día no operó se conserva con (0).
- **Dev (Playwright):**
  - el 10/10 en Viajes: 1 en Por resolver y 8 en En seguimiento;
  - el 07/10 en el reporte: la lista ofrece solo Walmart, Iansa y Sodimac, y con "Iansa" elegido "Equipos activos" baja a
    la flota de las empresas de Iansa.

## 5. Fuera de alcance

- **El reporte de un período** (semana, mes, trimestre, año, rango a elección). Va en su propio spec. Falta definir si
  el mes solo se ve y se exporta (suma de días firmados) o si además se firma como período cerrado.
- Cambiar qué viajes entran en cada grupo o cuáles bloquean la firma (`SQL_GRUPOS_CIERRE` y `bloquean` no se tocan).
- El rediseño del detalle del viaje (en pausa).
