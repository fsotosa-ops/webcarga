# Cierre del día: un solo patrón para elegir, filtrar y ver — diseño

**Fecha:** 2026-10-16 · **Estado:** aprobado en conversación (maquetas + respuestas a la revisión), por aprobar como documento
**Maquetas (visual companion, fuera de git):** `.superpowers/brainstorm/49122-1792178898/content/`
`flota-del-dia.html` (Flota del día) y `cierre-alcance-unico.html` (las cuatro pestañas).

## 1. Por qué

El usuario (16/10): "el módulo del Cierre no está alineado al resto… los filtros no están conversando con las
tarjetas de filtro/vista". Pide columnas que se oculten, se muevan y se filtren todas, con búsqueda tipeable en el
filtro. Regla explícita: **sin parches, sin código duplicado, sin Frankenstein; robusto, mantenible, legible,
alineado a la arquitectura del frontend y del backend.**

Recorrido en dev (16/10, Propietario, solo lectura) — lo que hoy está mal:

1. **Tres vocabularios para lo mismo.** La tarjeta de Tractoreo dice "16 sin asignar"; los recuadros, "1 No
   asignados" + "15 No trabajando"; el filtro de la columna Estado solo tiene Asignado / No asignado y "No asignado"
   trae 16 filas. Causa: los recuadros leen `category` (backend, `services/cierre_lineas.py` `_CATEGORIA`) y la
   columna lee `status` (`STATUS_LABEL`, `FlotaDelDiaSection.tsx` L61-63).
2. **La relación va en una dirección.** El filtro de columna recalcula los recuadros (y "Total" marcado dice 16);
   tocar un recuadro no marca nada en la columna y los embudos de casi todas las columnas desaparecen (se ocultan
   con ≤ 1 valor distinto, `CabeceraDeColumna.tsx` L88).
3. **Cambiar de tarjeta borra todos los filtros en silencio** (`FlotaDelDiaSection.tsx` L153-159) y cambia el juego de
   recuadros (5 en Tractoreo, 4 en Equipo Completo).
4. **Columnas:** Generador de carga, Acción y Comentario no filtran; ningún filtro deja tipear; nada se oculta ni se
   mueve; a 1440 px la tabla se corta a la derecha; el popover no usa portal y se recorta.
5. **Cuatro formas distintas de filtrar en un mismo módulo:** Flota del día (tarjetas + recuadros + embudos), Viajes
   (pestañas hechas a mano + `ChipsDeFiltro` + buscador), Pendientes (lista sin filtros), Reporte (otro selector
   Tractoreo/Equipo Completo con otro estilo, desplegable "Todos los clientes").
6. **Estado local:** los filtros de la Flota del día viven en `useState`; no se comparten ni vuelven con "Volver".
7. **Fuera del kit:** encabezado en tarjeta propia con la fecha al lado, migas escritas a mano, pestañas hechas a mano
   (no `Tabs`), segmentado de Viajes hecho a mano (no `SegmentedControl`), mayúsculas en encabezados, tarjetas y
   recuadros sin nombre accesible.

## 2. Estándar que se adopta (Linear, Notion, Airtable, Stripe, Samsara, AG Grid)

- **Una sola verdad para filtrar:** un conjunto de filtros `{campo → valores}`. Recuadros, embudos y "+ Filtro" son
  puertas al mismo conjunto; lo activo se ve siempre como chip con "✕" y hay un "Limpiar".
- **Un solo vocabulario:** la columna, el recuadro y el chip dicen lo mismo porque leen el mismo campo.
- **Cifras facetadas:** cada recuadro y cada valor de un filtro dicen cuántas filas quedarían, contando con todos los
  demás filtros menos el suyo.
- **Alcance ≠ filtro:** "qué estoy mirando" (Tractoreo / Equipo Completo) se elige aparte de "cómo lo miro".
- **Columnas a gusto de cada persona**, con "Restablecer"; la columna que identifica la fila no se oculta.
- **La vista vive en la URL** (alcance, filtros, orden, búsqueda): se comparte, recarga igual y "Volver" la restituye.

## 3. Decisiones del usuario (16/10, sobre las maquetas)

- **D1 — Un solo alcance para todo el Cierre.** "Qué se cierra: Tractoreo | Equipo Completo" se elige una vez, arriba
  de las pestañas, con el resumen del día en una línea, y vale para las cuatro pestañas (opción A).
- **D2 — Flota del día como en `flota-del-dia.html`:** recuadros-atajo con las palabras de la columna Estado; barra
  única (buscador, chips, "+ Filtro", "Limpiar", "Columnas"); todas las columnas filtran con búsqueda tipeable y
  cifra por valor; columnas que se ocultan y se reordenan.
- **D3 — Viajes, Pendientes y Reporte siguen el mismo patrón** (`cierre-alcance-unico.html`):
  - Viajes: "Por resolver / En seguimiento / Resueltos" son recuadros-atajo (con "Todos"); los grupos de hoy (chips)
    pasan a ser un filtro más.
  - Reporte: sus subpestañas se quedan (son secciones del informe); "Todos los clientes" pasa a ser un filtro (chip);
    las descargas van a la derecha de la barra.
  - Pendientes: misma barra (buscador, "+ Filtro"), sin recuadros porque no tiene estados.
- **D4 — Pestañas con su número:** "Viajes 3", "Pendientes 3".
- **D5 — Recuadros de la Flota del día:** Todos · Asignados · **Sin motivo** · No trabajando · Por regularizar. "Sin
  motivo" reemplaza a "No asignados" (que hoy cuenta solo los que no tienen motivo).
- **D6 — El alcance filtra también los viajes** (respuesta a la revisión, 16/10): el tipo de operación de un viaje sale
  de su **tracto resuelto**; un viaje **sin tracto** se ve en los dos alcances, marcado "Sin tracto" (es justo el que
  hay que resolver). Exige el campo en el backend (§4.5).
- **D7 — Descargas del Reporte:** estándar "se exporta lo que ves, y se dice": un solo "Descargar" con "Lo que estás
  viendo (alcance · filtros · N filas)" por defecto u "Todo el día". "Copiar estatus" copia siempre lo que se ve (con
  "Cliente: Walmart", el estatus de Walmart). Cada archivo lleva escrito arriba qué recorte es. **El PDF no es
  prioridad: queda como hoy, fuera de esta entrega** (el usuario, 16/10); aplica al Excel y a "Copiar estatus".

## 4. Diseño

### 4.1 Una pieza de tabla de datos en el kit

Todo lo de la sección 2 existe **una vez**, en `components/ui/tabla/`, y lo usan las tablas del Cierre (Flota del día,
Viajes, secciones del Reporte, Pendientes). `CabeceraDeColumna.tsx` se borra en la misma entrega, con su guarda.

- **Motor: TanStack Table** (`@tanstack/react-table`, headless; la app ya usa `@tanstack/react-query`). Da el modelo de
  filtros por columna, filas facetadas (valores únicos y cifras), orden, visibilidad y orden de columnas. El kit pone
  solo el dibujo. *Decisión de diseño: escribir ese motor a mano es lo que produjo `CabeceraDeColumna` y su `Orden`
  incompatible con `useOrden`.*
- **Columnas declarativas:** cada tabla declara sus columnas una vez (id, título, cómo se lee el valor para filtrar y
  ordenar, cómo se dibuja, si se puede ocultar). Filtro, chip, orden y "Columnas" salen de esa declaración: no hay
  una segunda lista de columnas en ningún lado.
- **Filtro por columna:** popover en portal (no se recorta), con campo de búsqueda, valores con su cifra facetada,
  selección múltiple, "Seleccionar todo" y "Limpiar". Se puede abrir siempre: una columna con un solo valor también
  filtra. Columnas de acción o texto libre (Acción, Comentario) filtran por "tiene / no tiene".
- **Barra:** buscador + chips de lo activo + "+ Filtro" (elige columna y abre su filtro) + "Limpiar" + "Columnas". Las
  acciones propias de la pestaña (descargas del Reporte) van al final.
- **"Columnas":** casillas para mostrar u ocultar y arrastre para reordenar con `@dnd-kit` (ya está en la app);
  "Restablecer" vuelve al orden y la visibilidad por defecto de la tabla.
- **Recuadros-atajo:** un recuadro **es** un valor de un filtro. Tocarlo escribe ese valor en el filtro de su columna
  (y "Todos" lo quita); el recuadro marcado es el que coincide con el filtro. Su cifra es la facetada de ese valor.
  Reemplaza a `AlertStatTiles` en el Cierre; los otros usuarios de `AlertStatTiles` (`FleetCenterDialog`) se migran o
  se dejan fuera de alcance con su razón escrita en el plan.
- **Accesibilidad:** recuadros, tarjetas y filtros con nombre accesible; el chip se quita con teclado; `aria-sort` en el
  orden (como `EncabezadoOrdenable`).

### 4.2 Estado en la URL

- Alcance, pestaña, fecha, filtros, orden y búsqueda viven en la URL, con los helpers que ya existen
  (`lib/navegacion/cierre.ts`: `leerUrlDelCierre` / `urlDelCierre`). Un solo formato para los filtros de todas las
  tablas (p. ej. `f.estado=sin_motivo,no_trabajando`).
- **Cambiar de alcance conserva los filtros que siguen aplicando** y quita los que no, con un aviso ("Se quitó
  Patente: BDLC92, no está en Equipo Completo").

### 4.3 Preferencia de columnas por persona

- Visibilidad y orden de columnas se guardan **por persona y por tabla en el backend**, como ya se guardan los grupos
  del Monitor (`app.filter_groups`): tabla nueva `app.table_preferences (user_id, table_key, columns jsonb,
  updated_at)` y `GET/PUT /me/table-preferences/{table_key}`. *Decisión de diseño: `localStorage` quedaría por equipo
  y no por persona, y la app ya tiene el precedente en base.* Sin preferencia guardada, el orden por defecto.

### 4.4 Un solo vocabulario (Flota del día)

- La columna Estado y los recuadros leen **`category`** (backend). Etiquetas en el glosario (`lib/states.ts`), no en el
  componente: Asignado · Sin motivo · Trabajando sin asignación · No trabajando · Por regularizar.
  *Pregunta abierta al constructor: si `TRABAJANDO_SIN_ASIGNACION` merece recuadro propio o se queda solo como valor de
  filtro; hoy los recuadros lo suman a "No asignados".*
- El selector de motivo de la columna Acción deja de depender de la etiqueta (`statusLabel === 'No asignado'`) y pasa a
  depender de la categoría.
- El resumen del alcance ("32 asignados · 16 sin asignar · 66,7 % · 1 sin motivo bloquea la firma") se calcula con las
  mismas categorías; "sin asignar" = suma de las categorías no asignadas, dicho igual en todas partes.

### 4.5 El alcance en Viajes y Pendientes (D6)

- `GET /trips/cierre-viajes` agrega a cada viaje su tipo de operación, derivado del tracto resuelto con la misma
  definición que ya usa la Flota del día (`operation_type` del tracto, catálogo `public.asset_types` /
  `is_power_unit()`; nunca un literal), y `null` cuando no tiene tracto. El frontend filtra por alcance con la tabla de
  datos del kit: un viaje con tipo `null` pasa en los dos alcances y muestra "Sin tracto".
- Pendientes: cada aviso que se refiere a un tracto o a un conductor con tracto habitual toma el tipo de ese tracto; los
  de empresa (onboarding, desbalance de dotación) se ven en los dos alcances. Mismo campo, misma regla.
- Sin migración de esquema: es lectura derivada en la consulta.

### 4.6 Decisiones de diseño (las tomó quien escribe, se pueden revisar)

- **Pendientes no cambia de contenido**, solo de forma: conserva sus avisos (conductor sin empresa, patente no
  registrada, empresa en onboarding, sin tipo de operación…) con su acción por fila y el desbalance de dotación; se
  dibujan con la tabla y la barra del kit, con una columna "Tipo de aviso" filtrable.
- **El número de cada pestaña es lo que falta hacer:** Viajes = "Por resolver" del alcance; Pendientes = avisos. Con el
  día firmado gana, como hoy, el número de ajustes posteriores a la firma. Viajes y Pendientes se piden al abrir la
  página (son consultas chicas) para poder mostrar el número.
- **Las cifras del resumen no cambian de fórmula:** "asignados", "sin asignar", utilización y "Por regularizar" se
  calculan como hoy; solo sus palabras pasan al glosario. En Equipo Completo el resumen no dice "sin motivo bloquea la
  firma" (ahí no se exige motivo).
- `TRABAJANDO_SIN_ASIGNACION` es un valor del filtro Estado, sin recuadro propio (hoy no lo tiene).
- Se agrega `@dnd-kit/sortable` junto a `@dnd-kit/core`, que ya está.

### 4.7 El Cierre con el kit

- `EncabezadoDePagina` con la fecha como acción (children), sin tarjeta propia; migas con el patrón del kit.
- Alcance arriba de las pestañas con `SegmentedControl`; pestañas con `Tabs` del kit y su número (D4).
- Encabezados de tabla con `CABECERA` (sin mayúsculas); tokens del sistema visual; los trinquetes bajan.
- El bloque "Confirmar cierre" no cambia de comportamiento.

## 5. Fuera de alcance

- La descarga de datos de viajes para cuadrar con las fuentes (es el siguiente diseño, aparte).
- El PDF del Reporte (queda como hoy).
- El buscador compartido (`SearchInput`) de las 12 listas: va después, pero la barra de esta entrega ya usa la pieza
  nueva y no agrega una copia más.
- Llevar la tabla de datos al Monitor y a otras listas (queda posible; no se hace aquí).
- Cambiar cómo el backend calcula `status` o `category`.

## 6. Anti-objetivos (fracaso aunque "funcione")

- Que quede `CabeceraDeColumna` o un segundo modelo de filtro conviviendo con el nuevo.
- Que un recuadro y una columna puedan volver a decir cosas distintas.
- Que alguna lista de columnas se escriba dos veces (declaración, filtro, chip, "Columnas").
- Cifras que se muestran mientras cargan o que no son las del filtro activo.

## 7. Criterios de aceptación (un test por criterio)

- C1 Tocar un recuadro escribe el filtro de su columna, se ve como chip y queda marcado; quitar el chip desmarca el
  recuadro.
- C2 La columna Estado, el recuadro y el chip usan las mismas palabras (glosario) para la misma categoría.
- C3 Cada valor de un filtro y cada recuadro muestran la cifra facetada.
- C4 Todas las columnas con datos filtran; el filtro busca al tipear; Acción y Comentario filtran por tiene / no tiene.
- C5 "Columnas" oculta, muestra y reordena; la columna que identifica la fila no se oculta; "Restablecer" vuelve al
  defecto; la preferencia se guarda por persona y vuelve en otra sesión.
- C6 Alcance, filtros, orden y búsqueda viven en la URL; recargar y "Volver" restituyen la vista.
- C7 Cambiar de alcance conserva los filtros que aplican y avisa los que quita.
- C8 El alcance se elige una vez y vale en las cuatro pestañas.
- C9 Viajes, Reporte y Pendientes usan la misma barra y la misma tabla; "Todos los clientes" del Reporte es un filtro.
- C12 En Equipo Completo, Viajes muestra solo los viajes de tractos de Equipo Completo y los "Sin tracto"; en Tractoreo,
  los de Tractoreo y los "Sin tracto".
- C13 "Descargar" del Reporte ofrece "Lo que estás viendo" (marcado) y "Todo el día"; el Excel bajado coincide con la
  tabla en pantalla y dice arriba qué recorte es; "Copiar estatus" copia lo que se ve.
- C10 No queda `CabeceraDeColumna` ni pestañas o segmentados hechos a mano en el Cierre (guarda).
- C11 Humo E2E: Flota del día → recuadro → chip → filtro de Empresa tipeando → ocultar y mover una columna → recargar
  → todo sigue igual.

## 8. Verificación

Un test por criterio visto en rojo; `tsc`; vitest completo (se toca el kit compartido); `npm run build`; backend del
área (preferencias) en la copia local; humo E2E; capturas a 1440 y 390 lado a lado con las maquetas; revisión final
opus; despliegue a dev y recorrido con sesión. La migración de `app.table_preferences` se ensaya con `BEGIN…ROLLBACK`
y se aplica en la base real con autorización explícita.

## 9. Lo que queda al constructor

- La forma exacta del parámetro de filtros en la URL y su lectura en `lib/navegacion/cierre.ts`.
- Cómo partir la entrega en tareas (sugerido: tabla de datos del kit → Flota del día → Viajes → Reporte y Pendientes
  → encabezado y pestañas → retiro de lo viejo).
- Qué hacer con `AlertStatTiles` en `FleetCenterDialog` (migrar o dejarlo con su razón).
