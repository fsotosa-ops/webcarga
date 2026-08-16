# Listas de configuración: tabla que se lee, panel que edita — diseño

**Fecha**: 2026-08-16
**Estado**: aprobado en brainstorming, pendiente de plan de implementación
**Spec hermano**: `2026-08-16-configuracion-por-dominios-design.md` define **el marco**
(dominios, portada, registro de revisión, buscador). Este documento define **cómo se ve y
se opera una sección** dentro de ese marco.

---

## 1. El problema, medido

Dos secciones del módulo son inusables por densidad. No es una impresión: se midió en
staging el 2026-08-16.

| Sección | Alto | Controles interactivos |
|---|---|---|
| Condiciones de documentos | **5.849 px** | **167 casillas** |
| Estados del tablero | 1.306 px | **300** (25 campos, 25 desplegables, **250 botones**) |
| Rangos de temperatura | 243 px | 9 |

La tercera funciona y las otras no, y la diferencia **no es el tamaño**: es que todo está
en modo edición, siempre. Los 250 botones de Estados son las ocho pastillas de color
repetidas en cada una de las 25 filas. Nadie cambia 25 colores; se dibujan los 200 igual,
todos los días.

En Condiciones el desperdicio es aún más claro: se dibujan **10 casillas por requisito**
aunque **35 de los 37 no tengan ninguna marcada**.

**La causa raíz es un supuesto equivocado: que configurar es llenar un formulario.** No lo
es — es *revisar* un estado y cambiar una cosa puntual cada tanto. Cuando la pantalla asume
edición permanente, el costo lo paga el 99% de las veces en que sólo se viene a mirar.

Feedback textual del usuario: *"muy denso y con mucho scroll y mucho checkbox, eso no se me
hace estándar"*, *"esos botones de colores, agrupamientos"*.

## 2. El estándar, y de dónde se toma

**Leer primero, editar a pedido.** Es lo que hacen los ajustes de Linear, Stripe y Notion, y
—lo que más pesa— **es lo que ya hace esta app en su pantalla más usada**.

El Monitor de viajes (`/dashboard/operations/monitor`) es el lenguaje de referencia,
verificado leyendo `components/dashboard/TripTable.tsx`:

- **Tabla semántica** con `<th>` ordenables y su ícono de orden.
- Primera columna con la **pastilla de estado**; debajo del dato principal, un dato
  secundario en gris (bajo la patente, el otro identificador; bajo el estado, "42 min desde
  despacho").
- **Chips de filtro** arriba (Colun, Iansa, Sodimac, Walmart), buscador cuyo marcador de
  posición enumera qué se puede buscar, y un botón "Filtros" para lo avanzado.
- **Chevron por fila** que abre el detalle.
- El detalle **abre en su propia URL** (`/trips/[id]`, interceptada como panel). Ya existe
  una familia de paneles: `TransporterSlideOver`, `CarrierDrawer`, `VehicleDetailPanel`,
  `DriverDetailPanel`.

Este spec **no inventa una forma nueva**: aplica la que la app ya tiene a las secciones de
configuración.

## 3. La lista

Una tabla por sección, con el contrato del Monitor:

- Encabezados ordenables.
- Fila de **lectura**: muestra el valor renderizado, no un control de formulario.
- Dato secundario en gris debajo del principal.
- Chevron que abre el panel.
- Barra superior: buscador + chips de filtro.

### Condiciones de documentos

| Columna | Contenido |
|---|---|
| Entidad | `EMPRESA` / `CONDUCTOR` / `VEHÍCULO`, como pastilla |
| Documento | nombre visible, y debajo el código en gris (`MANTENCION_FRIO`) |
| Se exige a | **la regla en una frase**: "Todos los vehículos" · "Sólo Furgón Congelado", y debajo el alcance: "20 de 118 vehículos" |
| Vigencia | "Vigente" / "Sin vigencia" |
| Revisado | quién y cuándo, o "—" (viene del registro de revisión, spec 1) |

**"Entidad" es columna, no encabezado de grupo.** Siendo columna se ordena y se filtra, y no
parte la tabla en tres. Los agrupamientos actuales se conservan como **filtro**, no como
corte visual.

**La columna de alcance es nueva y hace falta**: "Sólo Furgón Congelado" no dice si son
veinte vehículos o dos.

### Estados del tablero

| Columna | Contenido |
|---|---|
| Cómo se ve | la pastilla ya renderizada — **es** la vista previa |
| Nombre en el TMS | el valor crudo, en monoespaciada |
| Columna | la columna del tablero a la que pertenece |
| Orden | el número de orden |

**El nombre crudo del TMS se conserva visible**, en su propia columna. Es el mismo recurso
que usa el Monitor bajo la patente, y resuelve un problema concreto: si alguien renombra el
nombre visible, sin el crudo no hay forma de reconocer de qué estado se trata.

Chips de filtro por **columna del tablero** (En Ruta · 7, En Local · 5, Cerrado · 6,
Problema · 7): 25 filas planas no se leen, cuatro grupos sí. Es la misma decisión que ya se
tomó en el embudo de Certificación.

## 4. El panel

El detalle abre en un panel **con URL propia**, igual que un viaje:

```
/dashboard/admin/settings/certification?section=conditions&doc=MANTENCION_FRIO
```

Editar una regla queda enlazable y compartible, y el botón de atrás del navegador funciona
sin código extra.

### La pregunta primero, las casillas después

Éste es el cambio que elimina las 167 casillas. El panel **no** abre con diez casillas: abre
con la pregunta real.

```
¿A qué vehículos se les exige?
  ○ A todos los vehículos · 118
  ◉ Sólo a algunos subtipos
      [Furgón Congelado / Refrigerado ×]  + Agregar
```

El selector de subtipos aparece **únicamente** si se elige "algunos". Con eso, el caso de 35
de 37 —"a todos"— se resuelve sin ver un solo subtipo.

El panel incluye la vista previa del recálculo que ya existe ("Se agregan 0 · dejan de
exigirse 17", con su aclaración de que no se borra nada) y las dos acciones del spec 1:
**Guardar** y **Confirmar sin cambios**.

### Estados: un color, no ocho

El panel muestra nombre visible, **una** muestra de color que abre la paleta en un popover,
y la columna del tablero. Los 250 botones de la lista pasan a cero.

## 5. Qué se comparte, y qué no

Éste es el punto donde el diseño se arruina si se exagera.

**Sube a compartido** lo que necesita verse y comportarse igual:

- El **ícono y el comportamiento de orden**, hoy encerrado dentro de `TripTable.tsx`.
- La **barra de filtros con chips**, ya repetida en el Monitor y en Certificación.
- La **cáscara del panel**: encabezado, cuerpo, acciones al pie.
- El **contrato**: la fila se lee, el detalle abre en su propia URL.

**No sube: las columnas.** Un viaje y un requisito no tienen nada en común. Forzar una tabla
genérica que sirva para los dos termina en un componente con veinte props que nadie
entiende — exactamente el frankenstein que el usuario pidió evitar, y el mismo error que ya
se rechazó en este proyecto con el modelo de Empresas/Seguros.

**El criterio, para que la próxima sección no lo re-litigue:** si dos listas *necesitan*
verse y comportarse igual, sube; si sólo se parecen, no.

Esto importa porque el módulo ya tiene **cinco secciones con estructura de lista**. Sin
piezas compartidas, la quinta es la quinta copia; con ellas, es barata.

## 6. Qué cambia, en números

| | Antes | Después |
|---|---|---|
| Condiciones, alto | 5.849 px | ~1.900 px |
| Condiciones, casillas en la lista | 167 | **0** (aparecen al editar, y sólo si se elige "algunos") |
| Estados, controles | 300 | 25 filas de lectura |
| Estados, botones de color | 250 | **0** |

Las dos ganan además orden por columna, filtros y enlace directo a un elemento, que hoy no
existen en ninguna.

## 7. Fuera de alcance

- **El marco del módulo** (dominios, portada, registro de revisión, buscador) — spec 1.
- **Migrar las otras tres secciones** (Alertas de vencimiento, Umbrales, Rangos de
  temperatura) a este patrón. Rangos de temperatura mide 243 px y funciona; migrarla sería
  trabajo sin problema que resolver. Se migran cuando duelan o cuando se las toque por otro
  motivo.
- **La excepción por caso** ("no le corresponde a este vehículo"), diferida en el Tramo 3
  con su razón: el único caso real es un dato que falta, no una regla equivocada.
- **Editar la regla desde un caso** en Certificación. El estándar —Stripe Radar, Salesforce,
  LaunchDarkly, Vanta— es separar "este caso está mal" de "la regla está mal": el caso
  explica y deriva, la regla se edita en un solo lugar. Este spec construye ese lugar.
