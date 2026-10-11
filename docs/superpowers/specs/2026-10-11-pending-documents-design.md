# Certificación › Pendientes: los documentos que se deben, por documento o por empresa

**Estado:** diseño aprobado por secciones el 11/10. La spec escrita espera la revisión del usuario. Después viene el plan, que se ejecuta en otra sesión.

**Bloque 1 de 4 del rediseño de Certificación.** Los otros tres van por separado:
- **Bloque 2:** Certificación como tres tareas (crear empresa, Sin clasificar, Pendientes). La ficha del Directorio queda solo para consultar y se retira la segunda ficha de empresa.
- **Bloque 3:** un panel de documentos de solo consulta, el mismo en el Directorio, la vista rápida y el detalle del viaje, con "Pedir a Certificación" para Operaciones.
- **Bloque 4:** Configuración › Certificación, con un solo flujo para activar reglas, variantes por cliente (Pronexo) y L7.

**Fuentes.** La auditoría `docs/superpowers/plans/2026-10-11-certification-audit.md` (simulaciones en dev y en la copia local), las transcripciones de las reuniones del 02/10 y del 09/10, y las minutas.

---

## 1. Por qué

### Lo que dijo el cliente

**Pablo, 09/10:**
> "voy a los F30-1, los pincho y me van a aparecer todas las empresas que me deben el F30-1. Y si quiero voy llenando, tengo acá mi torre de F30-1"

> "debería ser como un cubo… lo puedo mirar o por empresa o por tipo de documento"

> "conductor Felipe Soto tiene la licencia de conducir vencida y corresponde a la empresa Sumadots. Y si yo quiero, voy y subo al tiro el documento"

> "es más fácil de llevar… mirarlo por tipo de documento más que por empresa"

Lo quiere *"aquí dentro, abajo de Sin clasificar"*.

**Pablo, 02/10:**
> "si yo voy a ver los documentos vencidos me tira toda la empresa, entonces tengo que entrar a la empresa… entrar al conductor… no te muestra al tiro que es la licencia de conducir"

> "que el gallo pueda o lo arrastra y lo completa o va uno por uno"

Cómo trabajan hoy: le piden el F30-1 a todas las empresas, los archivos llegan a una carpeta y se cargan por tipo de documento.

### Lo que encontró la auditoría

- **No existe una vista de "quién debe el documento X".** "Por requisito" muestra cifras, pero las filas no se pueden abrir.
- **El estado de un documento se calcula en seis o más lugares**, y las pantallas no coinciden entre sí.
- **"Por vencer" se cuenta como "falta"**, y la portada solo muestra los vencidos.
- **L6:** las vistas por conductor y por vehículo y los conteos de Configuración incluyen entidades inactivas.

## 2. Decisiones tomadas (11/10)

| # | Decisión | Quién |
|---|---|---|
| D1 | La sección se llama **"Pendientes"** y es un ítem de Certificación, junto a Empresas y Sin clasificar. | Usuario |
| D2 | Usa el diseño **lista y detalle** (opción A): a la izquierda los documentos o las empresas, a la derecha quién debe el documento elegido. | Usuario |
| D3 | **Tres estados en lugar de "vencido" a secas:** Vencido, Por vencer y Falta, visibles en cada fila y como filtros. "Pendiente" es la suma de los tres. | Usuario: "cubre de mejor manera lo que dicen ellos" |
| D4 | **Ver por documento** (por defecto) **o por empresa**. | Pedido de Pablo |
| D5 | **Carga en lote** con asignación automática y revisión en el mismo panel. Nada se guarda hasta confirmar. | Usuario (opción 1) |
| D6 | **Enfoque técnico:** extender lo que ya existe (`/pending`, `vencimientos.py`, `document_matcher`). Sin una API paralela ni tablas precalculadas. | Usuario (enfoque 1) |
| D7 | **Operaciones ve, pero no sube.** "Pedir a Certificación" funciona como notificación a la cola de Certificación y llega en el **bloque 3**. | Usuario |
| D8 | **Alcance:** solo empresas, conductores y equipos activos. La siembra no cambia, y el alcance se aplica al leer. | Diseño, sección 1 |

## 3. Estado y alcance: una sola definición

### 3.1 Estado de un documento

El `CASE` que hoy vive dentro de `GET /compliance-records/pending` (`app/routers/compliance.py`, alrededor de la línea 594) pasa a `app/services/vencimientos.py` como `document_state_sql(alias)`. Es la única definición. Los valores son excluyentes y se evalúan en este orden:

| Valor | Condición |
|---|---|
| `NOT_REQUIRED` | No es exigible todavía (`exigible_sql` es falso), por ejemplo "desde el mes siguiente al ingreso". |
| `UP_TO_DATE` | No está pendiente (`pendiente_predicate` es falso). |
| `OVERDUE` | `status = 'EXPIRED'` o `vencido_predicate`. Incluye un archivo sin la fecha que pide su regla (`vence_calculado = -infinity`); en ese caso la fila dice "Falta la fecha…". |
| `EXPIRING` | `por_vencer_predicate`: la ventana de aviso del documento o, si no tiene, la general (`app.alert_thresholds.documento_por_vencer`). |
| `MISSING` | Cualquier otro caso. |

**Pendiente = `OVERDUE` ∪ `EXPIRING` ∪ `MISSING`.** "Hoy" es siempre `public.hoy_chile()`.

Los demás lugares que calculan el estado (`entity_summary.py`, el lateral de `trips.py`/`daily_closures.py`, `_CARRIER_LIST_AGG` de `carriers.py` y los seis cálculos del frontend) se migran en el **bloque 3**. Este bloque no los toca.

### 3.2 Alcance

En el mismo módulo se agrega `in_scope_sql(alias)`. Un registro está en alcance si:
- es un documento de **empresa** y la empresa está `ACTIVE`;
- es un documento de **conductor o equipo**, la entidad está `ACTIVE`, tiene una asignación `ACTIVE` y su empresa está `ACTIVE`;
- es un documento **a pedido**, que entra solo si existe el registro (es decir, si alguien lo pidió).

Pendientes y el resumen lo aplican siempre. La consulta acotada a una empresa (`carrier_id`, la ficha de la empresa) conserva el comportamiento de hoy, para poder ver una empresa dada de baja.

**La siembra no cambia.** Se siguen creando registros para todos, incluidos los inactivos, para que quien se reactiva vuelva con sus pendientes, porque la siembra de una entidad solo corre al crearla. Los conteos de Configuración ("Alcanzaría a N de N") adoptan `in_scope_sql` en el bloque 4.

## 4. API

Todo bajo `/api/v1/compliance-records`. Los nombres nuevos van en inglés.

### 4.1 `GET /pending` (se extiende sin romper)

- **Parámetro nuevo `state`:** `overdue` | `expiring` | `missing` | `pending` (los tres juntos) | `all`. Cuando viene, manda sobre el `estado` viejo.
  - El parámetro `estado` (`falta`/`por_vencer`/`al_dia`/`todos`) sigue funcionando para las pantallas actuales. Su valor por defecto `falta`, que en realidad significa "todo lo pendiente", no cambia.
  - Se retira (contract) cuando migren los últimos llamadores, en los bloques 2 y 3.
- **Alcance:** las consultas sin `carrier_id` aplican `in_scope_sql`.
- **Fila:** agrega `document_state` (el valor de 3.1). `urgencia` sigue mientras haya llamadores y se retira con `estado`. Agrega también:
  - `due_on`, el vencimiento calculado, que ya existe como `vence_el`;
  - `missing_validity_data`, que ya existe como `falta_dato_de_vigencia`.
- **Orden** cuando viene `state`: primero `OVERDUE` (el más antiguo arriba), después `EXPIRING` (el más próximo arriba), después `MISSING` (por empresa y sujeto).
- **Paginación** como hoy (`limit` ≤ 500, `offset`, `total`).

### 4.2 `GET /pending/summary` (nuevo)

- **Parámetros:** `group_by=requirement|carrier` (obligatorio).
- **Respuesta:** `{ rows: [{ key, label, target_entity?, rule_label?, suggested_period_start?, overdue, expiring, missing }] }`.
  - `rule_label` es la regla en una frase, por ejemplo "Mensual, día 18" o "3 meses desde la emisión".
  - `suggested_period_start` solo viene en los documentos de período.
- Una sola consulta con `GROUP BY`, la misma función de estado (3.1) y el mismo alcance (3.2). Solo trae las filas con algo pendiente, ordenadas por `overdue` y después por `label`.
- **Permiso:** `certification.read`.

### 4.3 `POST /pending/match` (nuevo; no escribe)

- **Cuerpo:** `{ requirement_id, file_names: string[] }`, con un máximo de 200 nombres (con más, responde 422 con un mensaje en español).
- **Universo:** los registros **pendientes y en alcance** de ese requisito, de modo que un archivo nunca se propone para alguien que ya está al día.
- **Motor:** `app/services/document_matcher.py`, la función pura de la Bandeja, con el universo acotado.
- **Respuesta:** por cada archivo, `{ file_name, status: matched|ambiguous|unmatched, record_id?, subject_label?, carrier_name?, reason: rut|name, confidence?, candidates: [{record_id, subject_label, carrier_name, confidence}] }`. Dos archivos que caen en el mismo registro se marcan `ambiguous`.
- **Permiso:** `documents.upload`.
- **La subida** se hace después, archivo por archivo, con el endpoint que ya existe: `POST /{record_id}/file`, con su fecha o período.

## 5. Pantalla

**Maquetas:** `.superpowers/brainstorm/84727-1791741985/content/pendientes-estados.html` y `pendientes-carga-en-lote.html`, aprobadas.

### 5.1 Navegación

- **Ruta:** `/dashboard/compliance/pending` (inglés), con la etiqueta "Pendientes".
- **Menú:** Certificación › Empresas / Sin clasificar / **Pendientes**.
- **Estado en la URL:** `?by=requirement|carrier&doc=<requirement_code>&carrier=<id>&state=overdue|expiring|missing|all`. El valor por defecto es `by=requirement`, `state=overdue` y el primer documento de la lista.

### 5.2 Componentes

Los nombres van en inglés y la interfaz en español neutral. Se usan las primitivas y los tokens del sistema visual.

| Componente | Qué hace |
|---|---|
| `PendingDocumentsPage` | La ruta y el estado de la URL. |
| `PendingSummaryList` | La columna izquierda: documentos o empresas con tres `StatusChip` (urgent / warning / neutral) y la regla en una línea. Es una lista navegable con ↑ ↓. |
| `PendingHoldersPanel` | El encabezado (documento, período, vencimiento), los filtros con `SegmentedControl` (Vencidos / Por vencer / Faltan / Todos), la zona para arrastrar archivos y las filas. Por empresa, agrupa en la empresa, los conductores y los equipos. |
| `PendingHolderRow` | Quién, de qué empresa, el estado en palabras y la acción. |
| `BulkUploadReview` | La sección 6. |

**Textos del estado de cada fila:**
- "Venció el 29/09" → Subir
- "Falta la fecha de vencimiento", si el archivo ya está → Completar
- "Vence en 10 días · 21/10" → Subir la nueva
- "Falta · Ingresó hace 10 días" → Subir

**Código que se reutiliza o se mueve:**
- `SegmentedControl` sube desde `TripNotesFeed.tsx` a `components/ui/` y se reutiliza.
- La carga en la fila reutiliza `useGestoDeCarga` + `useSubirDocumento`, que ya piden la fecha o el período según la regla.

**Al guardar** se refrescan, con claves de `lib/queries/certificacion`:
- el resumen;
- la lista;
- la ficha de la empresa (`clavesCertificacion`);
- `['entity-summary', kind, id]`.

Aparece un aviso: "F30-1 de Transportes Cordillera guardado · quedan 8 vencidos".

### 5.3 Estados

| Estado | Comportamiento |
|---|---|
| Cargando | Esqueletos, **sin cifras**. |
| Nada pendiente | "Todo al día. Ninguna empresa, conductor ni equipo activo debe documentos." |
| Filtro vacío | "No hay F30-1 vencidos. Hay 4 por vencer y 21 que faltan", con enlaces a esos filtros. |
| Error | `Estado tipo="error"`: "No se pudo cargar lo pendiente. Lo que ya estaba cargado no se perdió." y Reintentar. **Nunca** se muestra como vacío. |
| Sin `documents.upload` | Todo visible, sin "Subir" ni zona de arrastre. |
| Falla una subida | El error queda en su fila y las demás siguen. |

**Teléfono (390 px):** una columna. Primero la lista; al tocar un documento aparecen quienes lo deben, con "← F30-1".

## 6. Carga en lote

1. **Soltar** archivos sobre el panel, o usar "Elegir archivos". Solo los nombres van a `POST /pending/match`; todavía no se sube nada.
2. **Revisar.** Arriba van los grupos que necesitan atención:
   - **Por elegir:** hay más de un candidato.
   - **Sin asignar:** se busca a mano entre quienes deben el documento, o se quita el archivo.
   - **Asignados:** con su razón ("por RUT" o "por nombre · 94 %") y "Cambiar".

   Dos archivos para el mismo registro se marcan "Por elegir".
3. **Completar los datos que pide la regla:**
   - **Período:** uno para todo el lote, propuesto por `suggested_period_start` y editable.
   - **Fecha impresa o de emisión:** una por fila, obligatoria para guardar esa fila.
4. **Guardar los listos.**
   - Se suben de a tres a la vez con `POST /{record_id}/file`.
   - El progreso se muestra como "Guardando 7 de 12…" y cada fila dice ✓ o su error.
   - Si se cierra la pestaña a mitad, lo guardado queda guardado (aviso `beforeunload`).
   - Al terminar aparece el resumen ("11 guardados · 1 con error · 3 por resolver") y se refresca como en 5.2.

**Reglas que se mantienen:** PDF o imagen, de hasta 7 MB; la auditoría igual que una carga individual; el permiso `documents.upload`.

**Fuera de alcance:** leer el contenido de los archivos (OCR) y subir un archivo sin saber de quién es. Ese archivo se quita y va a Sin clasificar.

## 7. Pruebas y criterio de aceptación

### Backend

Tests de integración en una transacción revertida, con los sujetos creados por el propio test.

- **Estado:** un caso por cada estado y cada política:
  - fecha impresa vencida;
  - por vencer con aviso propio y con el general;
  - plazo desde la emisión vencido;
  - período antes y después del corte;
  - archivo sin la fecha que pide su regla, que queda `OVERDUE`;
  - `MONTH_AFTER_START`, que queda `NOT_REQUIRED`;
  - documento a pedido.
- **Alcance:** un conductor inactivo, un equipo sin asignación vigente y una empresa de baja **no** aparecen en Pendientes. En la ficha de esa empresa (`carrier_id`) sí aparecen.
- **Coherencia:** las cifras del resumen (por documento y por empresa) son iguales a lo que trae la lista con cada `state`.
- **Match:** propone solo entre quienes deben el documento, marca los ambiguos y los que no se pudieron asignar, **no escribe** (lo verifica un conteo antes y después) y responde 422 con más de 200 archivos.
- **Permisos:** 403 sin `certification.read` (summary, pending) y sin `documents.upload` (match). Se mantiene `test_toda_ruta_declara_permiso.py`.
- **Compatibilidad:** `/pending` con `estado` sigue respondiendo lo mismo para los llamadores actuales.
- **Rendimiento:** el resumen y la lista se miden con el volumen real, solo con lectura. El objetivo es **< 300 ms**. Si no se cumple, se informa con la cifra.

Cada test nuevo se ve fallar antes de implementar. Los de alcance y coherencia se verifican además con una mutación.

### Frontend

vitest y tsc:
- las tres cifras y la navegación con teclado;
- la URL;
- los seis estados de 5.3;
- subir en la fila (la fila sale y se refrescan el resumen, la ficha y la vista rápida);
- la revisión del lote (grupos, Elegir, Cambiar, período del lote, fecha por fila, guardar los listos, un error aislado).

Además, los trinquetes `lib/ui` (ningún color crudo nuevo ni texto bajo 11 px) y `lib/copy` (español neutral).

### Recorrido en la copia local

La copia local está en `.superpowers/local-sim/`, con Playwright.

- Carla (`cert@sim.local`):
  1. abre Pendientes;
  2. elige el F30-1;
  3. arrastra un lote ficticio con RUT y nombres mezclados;
  4. resuelve uno ambiguo y uno sin asignar;
  5. guarda;
  6. se adelanta `hoy_chile()` para ver el paso de por vencer a vencido.
- Óscar (`ops@sim.local`) ve todo, pero sin "Subir".
- Capturas a 1440 px y 390 px.

### En dev

- Mirar con datos reales, en escritorio y en teléfono, sin subir nada.
- Comprobar que la portada, la ficha de la empresa y el cajón actual siguen iguales.

### Aceptación

- Desde Pendientes, elegir un documento y cargarlo para una entidad toma **≤ 4 acciones**, sin salir de la pantalla.
- Las tres cifras de cada documento coinciden con su lista.
- En Pendientes no aparece ninguna entidad inactiva.

## 8. Reglas transversales

- Las rutas y el código nuevo van en inglés; la interfaz, en español neutral, sin voseo y sin emojis (solo lucide-react).
- No se toca Mage.
- Sin parches: una sola definición de estado y de alcance, y nada duplicado.
- Suite completa y build solo si se toca código compartido. Este bloque sí lo toca (`vencimientos.py`, `SegmentedControl`, `/pending`), así que al cierre corren la suite del área afectada y el build.
- Despliegue a dev cuando todo esté en verde. Sin merge a main.

## 9. Riesgos

- **`/pending` tiene varios llamadores** (CarrierDrawer, la ficha de empresa, TriageWorkbench). La compatibilidad del parámetro `estado` se cubre con un test, no con revisión a ojo.
- **El universo del match es más chico que el de la Bandeja.** Un archivo de alguien que ya está al día sale "Sin asignar". Es intencional, y el texto lo explica.
- **El rendimiento del resumen con reglas activas no está medido** (la última medición fue con 0 reglas: 0,26 s para `/status`). El plan lo mide primero y, si hace falta, se agrega un índice.
- **"Pedir a Certificación" (D7) no se conversó con Pablo.** Hay que validarlo antes del bloque 3.
