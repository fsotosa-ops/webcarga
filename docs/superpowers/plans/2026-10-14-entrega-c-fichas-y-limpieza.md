# Entrega C: D4 "Una ficha por entidad" + Cert 2b "Retirar la segunda ficha" + Cert 4 "Configuración" + D5 "Limpieza"

Plan madre: `2026-10-14-cerrar-directorio-y-certificacion.md`. Mismo método que A y B: ejecución inline, un test por criterio
de aceptación (CA), humo E2E, un despliegue y una revisión.

## Verificado el 14/10 (código y base real, solo lectura)

- **Conductor y equipo no tienen pantalla propia:** `/dashboard/drivers/[id]` y `/dashboard/assets/[id]` solo redirigen a
  la ficha de su empresa con el panel abierto. Si no tienen empresa, muestran "no asignado". **Tampoco hay lista de
  conductores ni de equipos en el Directorio.** Las únicas listas que cruzan empresas son las vistas `?vista=conductores` y
  `?vista=vehiculos` de Certificación, con su cajón.
  - Base real: 102 conductores (93 activos, 9 de baja, 10 sin empresa, 62 sin origen habitual) y 139 equipos (136 activos,
    3 de baja, 6 sin empresa, 4 tractos sin tipo).
  - `GET /drivers` es un buscador (exige 2 letras, devuelve como máximo 50, solo activos). No existe `GET /assets`.
- **Hay dos fichas de empresa.** Lo que solo existe en la de Certificación (`compliance/[carrierId]`, 1.091 líneas):
  - `GestionDeclarada` (el tipo declarado),
  - `AccionesDeSujeto` (dar de baja o reactivar a un conductor o equipo desde la lista de documentos),
  - `SolicitarDocumento`,
  - la lista de documentos por sujeto (`RenglonPendiente`) y su filtro de estado,
  - el puente a Sin clasificar.
  La ficha del Directorio tiene el resto: pestañas, alta de flota, seguros, contactos, la exportación .zip y los paneles.
  Llegan a la de Certificación 3 enlaces: la lista de Empresas del embudo, la creación de una empresa y `irAEmpresa`.
- **`TransporterDocumentsPanel`** (pestaña Documentos de la empresa) agrega a `DocumentChecklist` dos cosas: el historial de
  versiones y la edición del vencimiento. Esta última requiere `puedeCorregirVencimiento`.
- **La vista rápida no está en el Monitor:** solo la usa el Cierre. La tabla del Monitor no tiene enlaces a entidades, y su
  búsqueda no vive en la URL (para filtrar desde otra pantalla hay que agregar `?q=`).
- **Configuración › Certificación:** "Alcanzaría a N" (`routers/requirements.py`, `_lateral`) y la vista previa del
  recálculo (`requirement_conditions.SQL_ENTIDADES_QUE_APLICAN`) cuentan **todas** las entidades, también las dadas de baja y
  las que no son flota activa (L6). L7 no es lo que decía el plan: un dominio de taxonomía sin filas responde **422** en vez
  de una lista vacía (`status_taxonomies._exigir_dominio_conocido`).
- **D5, según lo medido:**
  - Huérfanos confirmados: `GET /trips/fleet-daily-overview` (más su cliente y su tipo) y `carriersApi.listContacts`.
  - `invalidate_trips_meta_cache` sí se llama, pero no hace nada: la caché que borra nunca se escribe
    (`_STATIC_ROUTES = {}`).
  - Las rutas `/buscar` y `/directorio` **no existen**: ese ítem se cae.
  - Hay dos prefijos de clave de caché: `taxonomias` (5 lugares) y `taxonomies` (4).
  - Hay **tres** altas de conductor: `AltaDeFlota`, `AltaConductorDesdeCierre` y la del popover del Monitor.

## Parte 1: D4, una ficha por entidad

- **Menú:** "Directorio" pasa a ser un grupo con **Empresas · Conductores · Equipos** (rutas `/dashboard/carriers`,
  `/dashboard/drivers`, `/dashboard/assets`; las etiquetas en español y las rutas en inglés).
- **Listas de conductores y equipos (una sola lista por objeto):** son tablas con búsqueda (nombre, RUT, patente,
  canónicos), filtros (ciclo de vida, habilitación, estado documental, sin empresa, de baja, sin origen o sin tipo) y
  paginación.
  - Backend: `GET /drivers` y `GET /assets` son las listas (simétricas), con los mismos campos de resumen que el roster
    (`entity_summary_columns_sql`). El buscador de conductores pasa a `GET /drivers/search`.
  - **Las vistas `?vista=conductores|vehiculos` de Certificación redirigen a estas listas**, con el filtro documental
    puesto. Son el mismo objeto, así que van en una sola vista ("fusionar vistas, no agregar pantallas"). El cajón de
    Certificación se retira con ellas (Cert 2b).
- **Ficha propia de conductor y de equipo** (`/dashboard/drivers/[id]`, `/dashboard/assets/[id]`). El contenido sale de
  los paneles actuales: se extrae su cuerpo a `DriverProfile` / `AssetProfile`, que usan el panel y la página por igual.
  Agrega:
  - **"Dónde trabaja" con historial:** la empresa de hoy y los períodos anteriores (`app.fleet_assignment_periods`),
    `GET /drivers|assets/{id}/assignments`.
  - **Tarjeta "Actividad":** último viaje (fecha y cliente), cuántos viajes hizo en los últimos 30 días y el botón
    **"Ver viajes en el Monitor"**, que abre el Monitor con `?q=<RUT o patente>`. Es un conteo agregado; no repite la tabla.
  - Documentos con el panel único (`…/documents`), con el pedido y la corrección de RUT o patente de la Entrega B.
  - Sin empresa, la ficha igual existe (hoy es un callejón sin salida).
- **Una sola ficha de empresa:** la del Directorio absorbe lo que solo vive en Certificación:
  - `GestionDeclarada`, con el chip único de B;
  - en la pestaña Documentos, la lista de documentos de la empresa y de su flota por sujeto, con filtro de estado, las
    acciones por sujeto y "Solicitar documento";
  - el historial de versiones y la edición del vencimiento, que pasan a `DocumentChecklist` como props, para que haya un
    solo componente.
- **La vista rápida también en el Monitor:** el conductor, la empresa y la patente de cada fila abren `EntityQuickView`,
  igual que en el Cierre.

## Parte 2: Cert 2b, retirar la segunda ficha

- `/dashboard/compliance/[carrierId]` redirige a `/dashboard/carriers/[id]?tab=documentos`, y los 3 enlaces que llegan
  ahí pasan a apuntar a la ficha del Directorio.
- Se borran `CarrierDrawer`, `TransporterDocumentsPanel` y la página vieja (con sus tests, migrando los criterios que
  sigan vigentes a la ficha única).
- La lista de Empresas de Certificación (el embudo) se queda: es la vista de trabajo de Certificación sobre la misma
  empresa, y cada fila lleva a la ficha única.

## Parte 3: Cert 4, Configuración › Certificación

- **L6:** "Alcanzaría a N de M" y la vista previa del recálculo cuentan solo a quienes están en alcance: empresa activa,
  conductor o equipo de la flota activa de una empresa activa (`in_scope_sql` / `app.active_fleet`, la misma regla que
  Pendientes). El texto dice "de M activos".
- **L7:** un dominio de taxonomía conocido y sin filas devuelve `[]`, y la pantalla muestra su estado vacío. Un dominio
  desconocido sigue dando 422. La lista de dominios conocidos sale del código, no de que tengan filas.

## Parte 4: D5, limpieza

- Se borran `fleet-daily-overview` (endpoint, cliente y tipo), `carriersApi.listContacts`, e
  `invalidate_trips_meta_cache` con sus 10 llamadas y la caché vacía (`_STATIC_ROUTES`).
- Un solo prefijo de caché, `taxonomies`, con una fábrica de claves.
- **Una sola alta de conductor:** `AltaConductorDesdeCierre` pasa a ser `AltaDeFlota` con una prop de origen, igual que el
  alta del popover del Monitor. Una variante es una prop.
- `REFRESH` selectivo de las vistas materializadas (F-18) solo si sigue apareciendo al medir el tiempo de las escrituras;
  si no, queda anotado.
- `carriers.py` se parte solo donde C lo toque (documentos de la empresa).
- **Tipos de equipo en catálogo (pedido del usuario, 14/10: "no puede haber hardcode"):** `public.asset_types` (código,
  etiqueta, `is_power_unit`, orden) con FK desde `assets.asset_type`, que reemplaza al CHECK. "¿Es tracto?" se pregunta
  con `public.is_power_unit()` (el atributo, como el *power unit* de la industria), nunca por el nombre: 6 consultas del
  backend y `public.carrier_management_types`. La pantalla lee el catálogo con `useAssetTypes` (`GET /assets/types`); un
  tipo desconocido lo rechaza la FK con 422. También `AltaDeFlota` dejó de buscar la gestión por etiqueta.
  Anotado y fuera de alcance: `FLEET_SERVICE_TYPE` tiene una fila "Tractocamión" sin `code` mezclada con las carrocerías.

## Criterios de aceptación

| # | Criterio | Nivel |
|---|---|---|
| C1 | La lista de conductores filtra por "sin empresa", "de baja", "sin origen" y estado documental, y pagina | API |
| C2 | La lista de equipos filtra por "sin empresa", "de baja", "sin tipo" y estado documental | API |
| C3 | `GET …/assignments` devuelve los períodos de empresa del conductor, ordenados, con el vigente primero | base real |
| C4 | La tarjeta "Actividad" cuenta los viajes de 30 días con la misma resolución de flota que el Monitor | base real |
| C5 | Un conductor sin empresa tiene ficha propia (no el "no asignado") | vitest |
| C6 | `/dashboard/compliance/[id]` redirige a la ficha del Directorio en la pestaña Documentos | vitest |
| C7 | La pestaña Documentos de la empresa muestra los documentos por sujeto con filtro de estado, versiones y edición del vencimiento | vitest |
| C8 | "Alcanzaría a N de M" no cuenta a dados de baja ni a flota fuera de la flota activa | base real |
| C9 | Un dominio de taxonomía conocido y vacío devuelve `[]`; uno desconocido, 422 | API |
| C10 | El Monitor abre la vista rápida desde el conductor y la patente de una fila | vitest |
| C11 | "Ver viajes en el Monitor" abre el Monitor filtrado por el RUT o la patente | vitest |

## Humo E2E que se agrega

- Directorio › Conductores: filtrar "sin empresa" y abrir una ficha.
- La ficha de un equipo: "Actividad" → "Ver viajes en el Monitor".
- La URL vieja de Certificación cae en la ficha única.
- El Monitor: vista rápida desde una fila.

## Orden de trabajo

1. Backend de las listas, los períodos y la actividad (C1-C4); Cert 4 (C8, C9).
2. Frontend de D4: menú, listas, `DriverProfile`/`AssetProfile` y sus páginas, la tarjeta Actividad, `?q=` en el Monitor y
   la vista rápida en el Monitor (C5, C10, C11).
3. Ficha única de empresa y Cert 2b (C6, C7), y después borrar lo viejo.
4. D5.
5. Humo, una revisión, suite completa del backend contra la base real, despliegue y recorrido en dev.

## Decisiones del usuario (14/10)

- **Menú:** Directorio es un grupo con Empresas · Conductores · Equipos.
- **Una lista por objeto:** se aprobó tras ver las maquetas
  (`docs/superpowers/mockups/2026-10-14-entrega-c-directorio-vs-certificacion.html`):
  - **El Directorio es el registro.** Tiene las listas, una ficha por entidad (Resumen · Documentos · Dónde trabaja ·
    Actividad · Contactos) y todas las acciones sobre el maestro.
  - **Certificación son las colas de trabajo.** Empresas (el embudo), Pendientes (con los pedidos de Operaciones) y Sin
    clasificar. Cada fila abre la ficha del Directorio en la pestaña Documentos.
  - En Certificación, "Agrupar por Conductor / Vehículo" abre las listas del Directorio con el filtro de documentos
    pendientes ya puesto. Salen la ficha de empresa propia de Certificación, el cajón y el despliegue por conductor.
- **Alcance de C aprobado completo** (D4 + Cert 2b + Cert 4 + D5).
