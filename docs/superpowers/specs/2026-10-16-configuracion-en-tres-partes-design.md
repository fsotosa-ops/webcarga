# Configuración en tres partes — diseño

**Fecha:** 2026-10-16 · **Estado:** aprobado en conversación (15/10), por revisar como documento
**Maquetas (visual companion, fuera de git):** `.superpowers/brainstorm/56411-1792100703/content/`
`config-tres-partes.html`, `config-colores.html`, `directorio-clientes-lugares.html`

## 1. El problema

El usuario ve Configuración como "Frankenstein, desalineada con la industria". La auditoría en dev
(15/10, 1440 y 390) lo confirma con causas concretas:

1. **Cuatro patrones de edición en un mismo módulo.** Estados del tablero: filas de lectura + panel.
   Condiciones de documentos: tabla densa con selectores, interruptores y alias dentro de la fila.
   Motivos, estados y subtipos: cada fila es un formulario abierto (campo, paleta de 9 colores,
   selector, papelera). Personas: tarjetas de cifras, tarjeta dentro de tarjeta, pestañas subrayadas
   como filtro.
2. **Tres niveles de navegación** (menú de la app, dominios, pestañas). Operaciones tiene 10 pestañas
   que no caben ("Motiv…" cortado); en el teléfono la pestaña activa no se ve.
3. **Cosas que no son ajustes.** "Documentos exigidos" es un catálogo de trabajo de Certificación
   (114 documentos, cada uno con regla, condiciones y alias; 109 sin revisar). Orígenes y Clientes
   del TMS son datos maestros. Al revés, el plazo "póliza por vencer" no tiene pantalla.
4. **Dos sistemas de color.** El glosario (`lib/states.ts` + `StatusChip`, cinco tonos con
   significado) y colores libres por valor (`bg_color`/`text_color` en la base, pintados con
   `style`). "Viaje en Predio" es rojo como "Cancelado" sin ser un problema.
5. **Permisos que no llegan.** Orígenes y Clientes del TMS piden `commercial.edit`, pero ese permiso
   no da acceso a Configuración: hoy solo el Propietario los edita. `insurance.configure` existe y
   ninguna sección lo usa.

## 2. Decisiones (del usuario, 15/10)

- **D1 — Separar ajustes de catálogos de trabajo** (estándar: Linear, GitHub, Salesforce Setup,
  Samsara para ajustes; Avetta/ISNetworld y Samsara Compliance para el catálogo de requisitos).
  Configuración se queda con parámetros y vocabularios; lo que un equipo gestiona como trabajo
  diario va a su módulo con lista y ficha.
- **D2 — Navegación de Configuración:** un solo índice a la izquierda, agrupado por área (Linear,
  GitHub, Vercel). Dos niveles. Sin pestañas. En el teléfono, el índice es la portada.
- **D3 — Un solo patrón de edición** en Configuración: lista de lectura + panel lateral.
- **D4 — El color sale del significado.** Cinco tonos del glosario; nadie elige un color a mano.
  Estados del tablero y operacionales: tono por columna/grupo. Motivos, subtipos y tipos de
  operación: sin color. Incluye el Monitor y `OperationTypeBadge`.
- **D5 — Parte 3 completa:** Directorio › Clientes (con ficha) y Directorio › Lugares.
- **D6 — Tres entregas separadas**, en este orden: Parte 1, Parte 2, Parte 3.

## 3. Reglas que aplican a las tres partes

- Sin parches ni código duplicado: cada pieza existe una vez. Se reusan `PanelLateral`,
  `ProfileLayout`/`AsidePanel`, `tabla/Table` + `CABECERA`, `SegmentedControl`,
  `EncabezadoDePagina`, `Estado`, `StatusChip` y el glosario. Lo que se reemplaza se borra en la
  misma entrega, con su guarda.
- Solo tokens del sistema visual; los trinquetes (`lib/ui/sistema.test.ts`, `escala.test.ts`)
  solo bajan. Español neutral, cero emojis, rutas en inglés y etiquetas en español.
- Cada sección declara su permiso; sin él se ve en solo lectura (`useCanEdit`/`usePermiso`), igual
  que la API (403). El índice muestra solo las áreas que la persona puede ver.
- Los cuatro estados de toda pantalla: vacío, a medias, sin permiso, falló.
- Expandir y contraer para cualquier columna que se retire: primero se deja de leer, después se
  borra con copia en `audit_log`; cada migración en la base real con autorización explícita y
  ensayo `BEGIN…ROLLBACK`. Verificar Mage en vivo antes de contraer.

## 4. Parte 1 — Configuración liviana

### 4.1 Qué queda y con qué permiso

| Área | Sección | Permiso que edita | Hoy |
|---|---|---|---|
| Certificación | Alertas de vencimiento | `certification.configure` | igual |
| Operaciones | Estados del tablero | `operations.configure` | igual |
| Operaciones | Estados operacionales | `operations.configure` | igual |
| Operaciones | Estados de equipo | `operations.configure` | igual |
| Operaciones | Umbrales de alerta | `operations.configure` | igual |
| Operaciones | Rangos de temperatura | `operations.configure` | igual |
| Operaciones | Motivos de conductor | `operations.configure` | igual |
| Operaciones | Motivos de no asignación | `operations.configure` | igual |
| Operaciones | Motivos de anulación | `operations.configure` | igual |
| Flota | Subtipos de vehículo | `operations.configure` | igual |
| Flota | Tipos de operación | `operations.configure` | igual |
| Seguros | Alertas de vencimiento | `insurance.configure` | **nueva** (umbral `poliza_por_vencer` en `app.alert_thresholds`) |
| Personas y accesos | Personas | `users.manage` | igual |
| Personas y accesos | Roles | `roles.manage` | igual |

Salen: Condiciones de documentos (Parte 2), Orígenes y Clientes del TMS (Parte 3).
`PERMISO_DE_SECCION` (frontend) y `services/revisiones.py` (backend) siguen siendo la única fuente
del permiso por sección; `test_revisiones.py` falla si se separan.

### 4.2 Navegación

- Ruta única por sección: `/dashboard/admin/settings/<area>/<section>` (inglés). La raíz
  `/dashboard/admin/settings` lleva a la primera sección visible en escritorio y muestra el índice
  en el teléfono. Las URL viejas (`/settings/<area>?section=…`) redirigen a la nueva.
- El índice (`NavDominios` reescrito como índice agrupado) se arma desde `DOMINIOS`, que sigue
  siendo la fuente de verdad (área → secciones → permiso → panel). Agregar una sección es una
  entrada en ese registro.
- El buscador de ajustes (`BuscadorConfig`, `SQL_BUSQUEDA`) se mantiene arriba del índice.
- La portada de tarjetas (`PortadaDominios`) se retira; sus conteos "sin revisar" pasan a ser el
  contador de cada entrada del índice.

### 4.3 Un solo patrón: lista + panel

- **Vocabularios** (estados operacionales, de equipo, motivos ×3, subtipos, tipos de operación):
  un componente genérico parametrizado por dominio, construido sobre el que hoy usan Estados del
  tablero (`EstadosTabla` + `EstadoPanel`). Lista: valor, qué significa / columna, uso, revisión.
  Panel: nombre, grupo o columna (si el dominio lo tiene), vista previa, uso, desactivar, marcar
  revisado, guardar. Filtros con `SegmentedControl` (Activos · Sin revisar · Desactivados).
- **Parámetros** (alertas de vencimiento, umbrales, rangos de temperatura): la misma lista, con un
  formulario corto en el panel.
- **Personas y Roles:** lista con el kit y panel; fuera las tarjetas de cifras y las pestañas
  subrayadas (filtros con `SegmentedControl`).
- Se retiran: `TaxonomyTab` con sus formularios por fila, `SwatchPicker`, `SaveRowButton`,
  `SortArrows`, `useRowFeedback` y lo de `shared.tsx` que solo ellos usan; las pestañas de dominio.
  El orden se cambia en el panel (subir/bajar), no con flechas en cada fila.

### 4.4 Color (D4)

- Nuevo en el glosario (`lib/states.ts`): `boardColumnStyle(group)` para los 7 grupos cerrados de
  columna (`en_ruta`, `en_local`, `retornando`, `cerrado`, `problema`, `otro`,
  `pendiente_cierre_tms`), validados ya en `schemas/status_taxonomy.py` y `GROUP_OPTIONS`:
  en_ruta y en_local → acción; retornando y otro → neutro; cerrado → resuelto; problema → urgente;
  pendiente_cierre_tms → aviso. Etiqueta de la columna incluida.
- Estados del tablero (`app.trip_statuses`) y operacionales (`OPERATIONAL_STATE`) toman el tono de
  su grupo. Estados de equipo, motivos, subtipos y tipos de operación: texto o chip neutro.
- Consumidores que dejan de leer `bg_color`/`text_color`: `StatusBadge` (y sus usos en
  `TripTable`, `TripBoard`, `TripDetailView`, `FilterPopover`, `GestionPanel`),
  `OperationTypeBadge`, `CarrierDocumentsWorkspace` y los paneles de Configuración.
- **Expandir:** la API deja de aceptar colores en las escrituras (los schemas los rechazan con
  `extra="forbid"`) y el frontend deja de leerlos. **Contraer (migración aparte, con
  autorización):** copia en `audit_log` y `DROP COLUMN bg_color, text_color` en
  `app.trip_statuses` y `app.status_taxonomies`, y las columnas `fleet_service_type_bg_color` /
  `fleet_service_type_text_color` de las vistas materializadas `app.asset_compliance_status` y
  `app.carrier_asset_roster` (verificado en la real, 15/10). Guarda de backend que falle si alguien
  vuelve a leerlos.

### 4.5 Criterios de aceptación (Parte 1)

- P1.1 El índice muestra las áreas y secciones del registro que la persona puede ver; sin
  `users.manage`, no aparece Personas y accesos.
- P1.2 Toda sección es lista + panel; ninguna fila tiene un campo editable.
- P1.3 Sin el permiso de la sección, la lista se ve y el panel no ofrece guardar.
- P1.4 Seguros › Alertas de vencimiento edita `poliza_por_vencer` con `insurance.configure`.
- P1.5 Un estado del tablero se ve con el tono de su columna en Configuración y en el Monitor;
  cambiar la columna cambia el tono.
- P1.6 Ningún componente pinta con `bg_color`/`text_color`; la API rechaza colores en escritura.
- P1.7 Las URL viejas redirigen a la sección equivalente.
- P1.8 En el teléfono, el índice es la portada y cada sección tiene "‹ Configuración".

## 5. Parte 2 — Certificación › Documentos exigidos

- **Menú:** Certificación › Empresas · Por asignar · Pendientes · **Documentos exigidos**.
  Rutas: `/dashboard/compliance/requirements` y `/dashboard/compliance/requirements/[id]`.
- **Lista** (esqueleto de Seguros › Pólizas): buscador por documento o código; filtro por entidad
  (Empresa · Conductor · Equipo) y por estado (Sin revisar · Con condición · Sin vigencia ·
  Mensuales · Desactivados), con `SegmentedControl` y conteos de la API. Columnas: documento y
  código, a quién se exige (+ obligatorio/opcional), vence, aviso, cumplen (n de m), revisión.
  "+ Nuevo documento" con `certification.configure`.
- **Ficha** (`ProfileLayout`): encabezado con nombre, entidad, obligatorio, vigente; ⋯ con
  desactivar. Centro: las preguntas — ¿a quién se le exige?, ¿cuándo vence? (con historial de
  reglas), ¿cuándo se exige?, ¿con cuánta anticipación se avisa?, ¿qué cambia si edito la regla?
  (vista previa del impacto). Cada pregunta se edita en `PanelLateral`. Costado: Detalles (código,
  entidad, revisión), Se reconoce como (alias), Quiénes no cumplen (enlace a la cola de
  Certificación filtrada).
- **Sin reescribir:** las preguntas son las de `CondicionPanel`, `EditorVigencia`,
  `SelectorExigibilidad` y `NuevoDocumentoPanel`; se mueven a `components/compliance/` y se
  borra su copia de Configuración. `condiciones-tabla.tsx` se retira.
- **API:** la existente (`routers/requirements.py`); se agrega lo que la lista necesita y hoy no
  da (conteos por filtro y "cumplen n de m") si no existe. Sin cambios de modelo.
- **Criterios:** P2.1 la lista filtra por entidad y estado con conteos; P2.2 la fila abre la
  ficha y "Volver" conserva los filtros; P2.3 cada pregunta se edita en su panel con
  `certification.configure` y sin él se lee; P2.4 editar la regla muestra el impacto antes de
  guardar; P2.5 ya no existe "Condiciones de documentos" en Configuración (redirige a la lista).

## 6. Parte 3 — Directorio › Clientes (revisado 16/10: una sola lista de lugares)

**Cambio respecto de la primera versión (decisión del usuario, 16/10):** no hay "Directorio › Lugares". El
Tarifario ya es la lista completa de lugares (`public.locations`: alta, zona, tarifa, filtro por cliente); una
segunda lista del mismo objeto sería duplicar ("fusionar vistas, no agregar pantallas"). Orígenes es una marca
(`is_origin`) sobre esos lugares, no otra entidad.

- **Menú:** Directorio › Empresas · Conductores · Equipos · **Clientes**. Rutas `/dashboard/clients` y
  `/dashboard/clients/[id]`.
- **Clientes, lista:** buscador; filtros Activos · Inactivos; vista **"Nombres del TMS sin vincular"** (lo que hoy
  es Configuración › Clientes del TMS, sus pendientes primero). Columnas: cliente, nombres en los TMS, lugares
  (orígenes), empresas que lo atienden, viajes (30 días). "+ Nuevo cliente" con `commercial.edit`.
- **Ficha de cliente** (`ProfileLayout`): nombre, estado, viajes 30 días y "Ver en el Monitor" (Historial buscando
  el cliente). Pestañas: **Lugares** (la misma tabla del Tarifario, `LocationsTable`, filtrada por el cliente, con
  la columna **Origen**) y **Empresas** (la misma tabla de Directorio › Empresas, filtrada por `carrier_shippers`).
  Costado: Detalles (nombre, estado; editar) y **"Cómo lo llaman los TMS"** (la misma pieza que la vista "sin
  vincular", filtrada por el cliente; cambiar un vínculo se confirma y queda auditado).
- **Tarifario:** gana el filtro **Orígenes** (la API ya acepta `origin=true`) y la columna Origen editable: es
  donde se ven todos los orígenes juntos.
- **Una pieza, dos usos (sin copias):** `LocationsTable` (Tarifario + ficha), la tabla de Empresas (lista +
  ficha), los vínculos del TMS (vista "sin vincular" + ficha). Sin permiso de edición, las tres se leen.
- **API:** `GET /shippers` con conteos; `GET /shippers/{id}` y `PATCH /shippers/{id}` (nombre, estado; 409 si el
  nombre ya existe sin importar mayúsculas; auditado); `GET /carriers?shipper_id=`; `GET /tms-clients?shipper_id=`
  y `?unlinked=true`. Escritura `commercial.edit`; lectura como hoy.
- **Configuración** pierde Orígenes y Clientes del TMS; sus URL redirigen (Tarifario con Orígenes; Clientes con la
  vista "sin vincular").
- **Criterios:** P3.1 Clientes aparece en Directorio y su lista filtra con conteos; P3.2 la ficha muestra Lugares
  (con Origen) y Empresas del cliente y sus nombres del TMS; P3.3 el Supervisor Comercial edita nombre, estado,
  vínculos y orígenes, y sin `commercial.edit` todo se lee; P3.4 cambiar un vínculo se confirma, queda auditado y
  mueve sus viajes; P3.5 renombrar un cliente no saca sus viajes del Monitor; P3.6 el Tarifario filtra Orígenes;
  P3.7 Configuración ya no tiene esas secciones y sus URL redirigen.

## 7. Fuera de alcance

- Facturación (sigue reservada, sin entrada en el índice).
- Cambiar qué permisos existen o qué roles los tienen.
- Las tarifas por lugar (Tarifario).
- Búsqueda global (Cmd+K).

## 8. Verificación (por entrega)

Un test por criterio, visto en rojo antes; `tsc`, `vitest` de las áreas tocadas y la suite
completa solo si se toca código compartido (la Parte 1 lo toca: `StatusBadge`, glosario);
`npm run build`; humo E2E en la copia local con un recorrido por criterio de navegación; capturas a
1440 y 390 de cada pantalla nueva, lado a lado con la maqueta; revisión final opus; despliegue a
dev y recorrido con sesión.
