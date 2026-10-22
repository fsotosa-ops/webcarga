# Configuración: orden visual, estándar y deuda (diseño)

Fecha: 2026-10-22. Pedido del usuario al cierre del 22/10: "está saturado, no alineado al layout de la app y
no termina de cerrar con el estándar de la industria". Es el pendiente abierto desde el 11/10 ("después
Configuración, incluye su pasada visual, su propio ciclo"). El usuario pidió saltar las preguntas: auditoría y
propuesta.

Lo que ya existe y NO se rehace (spec `2026-10-16-configuracion-en-tres-partes-design.md`): las 7 áreas con su
índice lateral, las rutas `/dashboard/admin/settings/[area]/[section]`, el registro único `dominios.ts`, el
contrato declarativo `SettingsSource` (cada sección declara columnas, campos y acciones; una sola `SettingsList`
las dibuja), el panel lateral como única forma de editar, y lo mudado a Certificación y Directorio.

## 1. Auditoría (dev, 22/10, 17 secciones a 1440 y 3 a 390)

| # | Hallazgo | Evidencia |
|---|---|---|
| A1 | **"Sin revisar" en todas partes.** Cada fila lleva una insignia ámbar "Sin revisar", cada lista una pestaña "Sin revisar n" y el índice un número ámbar por sección (~115 en total). | Capturas de las 17 secciones. |
| A2 | **La revisión no se usa.** `app.config_reviews`: 27 confirmaciones en dos meses (16/08 a 22/10), de 3 personas, en 6 secciones. Lo pendiente no baja: es ruido permanente. | Consulta a la base real. |
| A3 | **El número no cuadra.** Umbrales de alerta: el índice y la pestaña dicen 1, la tabla muestra las 7 filas con "Sin revisar" (las reglas del Monitor se revisan como un formulario, `revisionId`). | Captura `operations__alert-thresholds`. |
| A4 | **Tres tablas a mano, ninguna del kit.** `SettingsList` (tabla HTML + `SegmentedControl`), `UsersTable` (otra tabla, otro buscador, otras pestañas) y la lista de Roles. El resto de la app (Flota del día, Analítica, Directorio) usa `DataTable` + `TableToolbar`: buscador, "+ Filtro" por columna, Columnas, Descargar/Copiar. | Código. |
| A5 | **Contenedor distinto por sección.** Personas va dentro de una tarjeta con la barra adentro; las demás ponen la tabla suelta; Roles tiene un texto suelto y el botón en otra fila. | Capturas. |
| A6 | **El botón de crear flota en su propia fila** ("+ Nuevo motivo", "+ Crear rol"), en celeste lleno, sobre las pestañas. En el resto de la app la acción principal va en la barra de la tabla o en el encabezado. | Capturas. |
| A7 | **Un valor suelto se dibuja como tabla.** Alertas de vencimiento (Certificación y Seguros) son dos números (aviso y crítico, `warning_days`/`error_days`, crítico < aviso), mostrados como tabla de 1 fila con pestañas "Todos 1 / Sin revisar 1" y un panel para editarlo. Umbrales: 7 números, igual. | Capturas. |
| A8 | **Personas se sale de la pantalla a 390** (los roles quedan cortados; desplazamiento horizontal). | Medido: `scrollWidth > innerWidth`. |
| A9 | **Nadie sabe quién cambió un ajuste.** Los catálogos no registran quién ni cuándo (solo `status_taxonomies.updated_at`); `config.py` no escribe en `app.audit_log`. La "revisión" era lo único parecido. | Base y código. |
| A10 | **Deuda del 11/10 que sigue:** `UsersTable` copia `users` a un estado y no se resincroniza (clase "borrador sin resincronizar"); `FormularioDeRol` sin `key` (pasar de editar un rol a otro conserva el formulario anterior). Ya resueltas: la clave de caché `taxonomies`/`taxonomias` y `useConfigList`. `CondicionPanel` (526 líneas) ya no es de Configuración: se mudó a Certificación › Documentos exigidos y queda fuera. | Código. |

Lo que está bien y se conserva: el índice agrupado a la izquierda (como Linear, GitHub, Stripe, Vercel), el
buscador de ajustes, una página por sección con título y propósito, el panel lateral para editar y el acceso
desde el menú de la cuenta.

## 2. Cómo lo resuelve la industria

| Producto | Listas de vocabulario | Un valor suelto | Quién cambió qué |
|---|---|---|---|
| Linear (Workflow states, Labels) | Lista agrupada por categoría, "+" en el encabezado del grupo, editar en el lugar o en panel | — | Historial del workspace |
| Stripe (Settings) | Tablas con la barra estándar del producto | Formulario: etiqueta, ayuda, campo, "Guardar" | Registro de eventos (audit) |
| GitHub (Organization settings) | Tablas con buscador y filtros | Formulario por sección | Audit log de la organización |
| HubSpot (Properties, Users & Teams) | La misma tabla de datos que el resto del producto | Formulario | "Última modificación por" + historial |

Lo común: **un ajuste no tiene estado "revisado"** (se revisa en el registro de cambios); **las listas usan la
misma tabla que el resto del producto**; **un número se edita en un formulario, no en una tabla**.

## 3. Propuesta

### 3.1 Dos tipos de página, decididos por lo que se configura

Cada sección declara su tipo en `dominios.ts`; el marco dibuja la página. Sin `if` por sección.

**Lista** (catálogos: estados del viaje, estados operacionales, estados de equipo, motivos ×6, subtipos, tipos de
operación, rangos de temperatura): `SettingsList` pasa a dibujar con el kit, `DataTable` + `TableToolbar`, igual
que la Flota del día:

```
Motivos de conductor                                            
Por qué un conductor no está disponible                          
┌──────────────────────────────────────────────────────────────┐
│ [Buscar motivo…]  [+ Filtro]          [Columnas] [+ Nuevo motivo] │
│ Qué significa: No trabajó ×                                   │
├──────────────────────────────────────────────────────────────┤
│ Motivo              Qué significa            Activo         › │
│ Panne               No trabajó               Sí             › │
│ Mantención          No trabajó               Sí             › │
└──────────────────────────────────────────────────────────────┘
```

- Lo que hoy son pestañas (`filters` de la fuente: etapa del viaje, "Qué significa") pasa a filtro de columna
  del kit, con sus recuadros-atajo si la sección los quiere (como la Flota).
- La acción de crear va en la barra, a la derecha, con el botón del kit (no una fila aparte).
- Abrir un elemento sigue siendo el panel lateral con `?item=` en la URL. Mover arriba/abajo y desactivar siguen
  en el panel.

**Formulario** (valores sueltos: Alertas de vencimiento de Certificación y de Seguros, Umbrales de alerta):

```
Umbrales de alerta
Cuándo el monitor considera que algo va mal
┌──────────────────────────────────────────────────────────────┐
│ Sin actualización del TMS      [ 2 ] horas                   │
│   Un viaje en curso sin noticias del TMS por más tiempo…      │
│ Semáforo del local: amarillo   [ 60 ] min                    │
│ …                                                             │
│                     Última modificación: Pablo A., 14/10      │
│                                  [Descartar] [Guardar cambios] │
└──────────────────────────────────────────────────────────────┘
```

- Mismos campos y validaciones que hoy tienen en el panel (`fields`, `validate` de la fuente).
- "Guardar cambios" solo se habilita con cambios; al salir con cambios sin guardar, se avisa.

**Personas y Roles** quedan con su forma (tabla de personas; maestro-detalle de roles, que es el estándar de
GitHub y Linear), pero Personas pasa a la tabla del kit y ambas al mismo contenedor y encabezado.

### 3.2 Retirar "Sin revisar" de Configuración (decisión del usuario, ver §5)

- Fuera de las filas, las pestañas y el índice. El índice queda limpio: nombre de la sección y nada más.
- `app.config_reviews` no se borra (historia); deja de leerse en Configuración. El backend sigue escribiéndola
  como hoy (`registrar_revision` en `config.py` y `status_taxonomies.py`): Documentos exigidos la lee y apagarla
  es otra decisión (decisión mía).
- El motivo original de la revisión ("una condición vacía significa dos cosas") era de Condiciones, que ya se
  mudó a Certificación › Documentos exigidos con su propia regla. En los catálogos no existe esa ambigüedad.

### 3.3 Quién cambió qué (reemplaza la trazabilidad de la revisión)

- Cada guardado de Configuración escribe en `app.audit_log` (quién, sección, elemento, antes y después), en el
  backend, en el mismo lugar donde hoy se guarda (`config.py`, los routers de catálogo, `users.py` y el de roles).
- El panel de un elemento y el formulario muestran "Última modificación: persona, fecha" leído de ahí. Sin
  columna nueva en las listas. Sin cambios registrados todavía, dice "Sin cambios registrados desde el
  <fecha de puesta en marcha>"; no se siembra desde `config_reviews` (confirmar no es cambiar) (decisión mía).
- Tras guardar, el formulario dice "Guardado" y actualiza la línea de última modificación; si falla, conserva lo
  escrito y dice por qué.
- Sin pantalla de historial en este ciclo: el registro queda consultable en `audit_log` (no objetivo).
- `audit_log.entity_id` es uuid y algunos elementos tienen clave de texto: se usa el precedente
  `md5(...)::uuid` con la clave real en el valor (decisión del constructor).

### 3.4 Un solo contenedor y encabezado

- Todas las secciones: `EncabezadoDePagina` (título y propósito, como hoy) y debajo la tarjeta del kit con la
  barra adentro, igual que la Flota del día. La línea suelta de Roles pasa a la bajada.
- A 390: el índice sigue siendo la portada; la tabla del kit maneja su ancho (sin desplazamiento de página).

### 3.5 Deuda que entra

- `UsersTable`: la lista sale de la consulta (React Query), no de una copia en estado; cada cambio invalida.
- `FormularioDeRol`: `key` por rol (o "nuevo"), para que cambiar de rol no herede el formulario.
- Tres tablas → una (la del kit).

## 4. Objetivos, no objetivos y lo que sería fracasar

- **Objetivo:** que Configuración se vea y se use como el resto de la app, con menos ruido, y que cada cambio
  quede registrado.
- **No objetivos:** reagrupar las áreas o mover secciones entre áreas; Facturación; buscar con Cmd+K; tocar
  Documentos exigidos (`CondicionPanel`) o los catálogos mudados.
- **Sería fracasar aunque funcione:** perder un campo, una validación o un permiso de los que hoy tiene cada
  sección; que un formulario guarde sin decir si se guardó; que una sección quede con un diseño distinto a las
  demás.

## 5. Decisiones

- **Del usuario (22/10):** retirar "Sin revisar" de Configuración (§3.2) y reemplazarlo por el registro de cambios
  (§3.3). El registro incluye Personas y Roles: invitar, activar o desactivar, cambiar los roles de una persona,
  crear o editar un rol y sus permisos (`routers/users.py` y el de roles, que hoy no auditan). Los paneles de
  Personas y Roles también muestran "Última modificación".
- **Mías (revisables):** los dos tipos de página y qué sección va en cuál (§3.1); que Rangos de temperatura sea
  lista (son filas que se crean y borran) y Umbrales formulario (son valores fijos); `audit_log` y no una tabla
  nueva; Roles conserva el maestro-detalle.

## 6. Verificación

- Por sección: los mismos campos, validaciones, permisos (`PERMISO_DE_SECCION`) y acciones que hoy. Un test del
  marco recorre `DOMINIOS` y comprueba que cada sección dibuja su tipo de página.
- Un test por criterio: el índice sin números; el formulario no guarda sin cambios y avisa al salir con cambios;
  un guardado escribe en `audit_log` (integración contra la copia local); Personas se resincroniza tras un cambio;
  cambiar de rol en edición no hereda el formulario.
- Humo en dev con Playwright: las 17 secciones a 1440 y 390, sin desplazamiento horizontal, captura lado a lado
  con la Flota del día.
