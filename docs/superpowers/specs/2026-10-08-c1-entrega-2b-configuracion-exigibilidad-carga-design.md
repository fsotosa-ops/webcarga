# HU-C1 entrega 2b — Configuración de la vigencia, exigibilidad, carga y catálogo de WebCarga

**Fecha:** 2026-10-08. **Estado:** diseño aprobado por secciones en la conversación; pendiente de revisión del spec escrito.

**Fuentes:**
- HU-C1 en `monitor-app/docs/user-stories/20261006/01-hu-diario-2.0-revision-02oct.md`, que incluye la sección
  "Diseño de interfaz" (la fuente de la pantalla).
- Planilla de WebCarga: `monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx`, con 96 tipos.
- Base ya desplegada (entrega 2, F0-F2): `docs/superpowers/plans/2026-10-07-c1-entrega-2-vigencia-y-exigibilidad.md`,
  migraciones `20261008100000..140000` y `app/services/vencimientos.py`.

## Intención (lo que dijo el usuario)

- La planilla de IANSA es el **estándar WebCarga**. Se cargan **los 96** tipos.
- WebCarga **revisa y corrige los tipos desde Configuración**. No se hace una planilla de correspondencias aparte.
- La primera entrega dejó lista la vigencia. Esta entrega cierra el resto de una vez:
  - Configuración (F5);
  - "¿Cuándo se exige?" respetado al crear pendientes (F3);
  - pedir emisión o período al cargar (F4);
  - la carga de los tipos (F6).
- **Fuera de alcance:**
  - las **ventanas por cliente**: la base ya las soporta, pero la pantalla llega cuando aparezca el primer cliente
    con una ventana distinta;
  - la **API de `main`**: no se usa.
- Restricción dura: **seguir el patrón de la app, sin parches**.

**Éxito:**
- Cualquier fila de la planilla se expresa desde Configuración sin ayuda técnica.
- El F30-1 ("mensual, tope el 18, mes anterior, aviso 5 días") se configura ahí y el ejemplo con fechas lo confirma.
- Al terminar, WebCarga puede activar cualquier documento de la planilla y lo que ve en pantalla es verdad.

## Patrón de referencia

- **Fleetio:** un catálogo de "tipos de renovación" en la configuración de la cuenta, con umbral de "por vencer" por
  tipo, que heredan los vehículos.
- **D4H:** vencimiento y aviso previo por tipo de certificación.
- **Google Calendar:** la regla de repetición escrita como frase.
- **El F30-1 según la Dirección del Trabajo:** acredita el cumplimiento "respecto de … períodos determinados".
  Por eso el modelo es "documento de un período", no "fecha de vencimiento".

No se encontró documentación pública de Pronexo, Avetta ni ISNetworld.

## 1. Configuración (F5)

**Pantalla:** la sección "Diseño de interfaz" de la HU-C1. Es la opción A, elegida en el visual companion:
- tarjetas por tipo;
- la regla escrita como frase;
- un ejemplo de fechas calculado.

**Componentes:**
- `SelectorPoliticaVencimiento` se reemplaza por **`EditorVigencia`**: tipo, parámetros, aviso, gracia y ejemplo.
- Se suma **`SelectorExigibilidad`**.
- Los dos se usan en `CondicionPanel` y en `NuevoDocumentoPanel`: crear y editar comparten el control (regla 7).
- `CeldaVigencia`, en la tabla, muestra el resumen ("Mensual · tope 18") y abre el panel. No edita en la fila,
  porque los parámetros no caben en una celda.

**Contrato:**
- `PATCH /compliance-requirements/{id}/conditions` y `POST /compliance-requirements` aceptan:
  - `vigencia: {politica, validity_months?, frequency_months?, cutoff_day?, period_offset_months?, warning_days?, grace_days?}`;
  - `exigible_on`.
- `SQL_CATALOGO` devuelve:
  - la regla base vigente;
  - `exigible_on`;
  - si la regla tiene versiones.
- Validación en tres capas:
  1. `Literal` y la forma del cuerpo en el schema;
  2. la coherencia en la base (`validar_vigencia_de_requisito`);
  3. el mensaje de la base se muestra en el panel.

**Versionado** (regla 6):
- La primera regla base de un requisito rige desde `-infinity`.
- Cambiar parámetros dentro del mismo tipo inserta una versión con `vigente_desde = hoy_chile()`. Si ya existe una
  de hoy, se actualiza.
- **Cambiar de tipo reinicia la regla**: se borran sus versiones y se crea una base desde `-infinity`.
- Todo ocurre en una transacción. El CONSTRAINT TRIGGER diferido valida al confirmar.

**"Ver qué cambia" con la vigencia:**
- `GET /{id}/recalc-preview` suma el efecto de la regla en borrador: cuántos registros pasan a vencido, por vencer
  o al día.
- Se calcula **aplicando el cambio dentro de una transacción que se revierte** y contando con los mismos predicados
  de `vencimientos.py`. Así hay una sola definición y no una estimación paralela.
- El texto "Rige desde hoy; los períodos anteriores se evalúan con la regla anterior" aparece cuando cambian
  parámetros de un tipo que ya tiene versiones.

**Auditoría:**
- `log_change` por campo, como hoy.
- `registrar_revision` deja el tipo "revisado" por quien lo guarda.

**Regla nueva en la base (M6):** una regla `CALENDAR_PERIOD` exige `warning_days`. Con el aviso general de 30
días, un tipo mensual quedaría siempre "por vencer".

## 2. Cuándo se exige (F3)

| `exigible_on` | Siembra | Lectura |
| :--- | :--- | :--- |
| `ON_ENTITY_START` | igual que hoy | igual que hoy |
| `MONTH_AFTER_START` | se siembra | antes del día 1 del mes siguiente al ingreso: **"Se exige desde dd/mm"** |
| `ON_ENTITY_END` | se siembra | exigible cuando el conductor no tiene asignación ACTIVE y tuvo alguna |
| `ON_REQUEST` | **no se siembra** | solo existe si alguien lo solicitó |

**Siembra:**
- `CREATE OR REPLACE` de las 5 funciones `reconcile_*`, partiendo de `pg_get_functiondef`.
- `SQL_CONDICION_DE_ENTIDAD` (`services/requirement_conditions.py`) excluye `ON_REQUEST`. De ahí la toma la vista
  previa de "Aplicar".

**Estado "aún no se exige"** (resuelve I5):
- `urgencia` gana `NO_EXIGIBLE`, calculada en el mismo `CASE`.
- `NO_EXIGIBLE` no es pendiente ni cubierto:
  - el embudo (`cubierto`) exige `exigible`;
  - el filtro "al día" excluye lo no exigible.
- La ficha lo muestra con la fecha desde la que se exige.

**Atribución del término:**
- Un registro `ON_ENTITY_END` se atribuye a la empresa de la **última** asignación del conductor.
- Es una regla del propio tipo, en `resolved`/`attributed`. No es un caso por código.

**"Solicitar documento":**
- `POST /compliance-records/requests {entity_type, entity_id, requirement_id}` (`require_editor`):
  - reusa el INSERT de encendido de `recalc`, extraído a un servicio;
  - marca `is_manual_override = true`;
  - solo para requisitos `ON_REQUEST` activos.
- `DELETE` de la solicitud: solo si no tiene archivo.
- En la ficha, cada sujeto tiene la acción "Solicitar documento", con la lista de los `ON_REQUEST` que le aplican.
  No es una pantalla nueva.

## 3. Cargar y clasificar (F4)

**`campos_que_pide(politica)`** en `vencimientos.py` reemplaza a `lleva_fecha` / `exige_fecha` (y a sus pares de
`lib/compliance.ts`). Devuelve:
- `fecha`: obligatoria, opcional o no se pide;
- `emision`: si es obligatoria;
- `periodo`: si es obligatorio.

**Lectores que pasan a usarla:**
- `compliance.py`: carga directa, `/file` y planilla;
- `document_ingest.py`: clasificación;
- `TriageClassifyForm`, `RenglonPendiente` y `DocumentChecklist`.

**El período:**
- Se elige con un selector de mes.
- Viene propuesto con **el período que se exige hoy**: `hoy` menos `period_offset_months`, según la regla.
- Se guarda como `period_start`, el día 1 del mes.

**La API expone `vence_el` calculado** (con `vence_el_sql`), y la pantalla lo muestra en vez de la fecha cruda.
Resuelve M3: el frontend deja de calcular su propio "hoy".

**Reemplazos:**
- Subir un período nuevo reemplaza al anterior en el registro, y el anterior queda en `audit_log`
  (`log_document_replacement`, que suma `period_start` / `issue_date`).
- Un período **anterior** al cargado se rechaza con un 409 legible.

**Faltantes:** si falta el período o la emisión, el archivo queda subido y la fila dice "Falta indicar el período",
igual que hoy con la fecha OPTIONAL pendiente.

**Planilla de fechas:** suma las columnas "Emisión" y "Período" (MM-AAAA), con el mismo parser y la misma
validación que la carga directa.

## 4. Cargar el catálogo (F6)

**Script** `backend/api/scripts/cargar_catalogo_webcarga.py`:
- Por defecto simula; carga de verdad con `--aplicar`.
- Lee la planilla y crea cada tipo nuevo **por el mismo servicio que `POST /compliance-requirements`**: código
  derivado del nombre, alias inicial y auditoría.
- Cada tipo nuevo entra apagado y sin marca de revisión.

**Traducción literal de la planilla:**

| Planilla | Se carga como |
| :--- | :--- |
| Anual | `ISSUE_PLUS_MONTHS` de 12 meses |
| Bienal | `ISSUE_PLUS_MONTHS` de 24 meses |
| Mensual · N de cada mes | `CALENDAR_PERIOD`, frecuencia 1, corte N, mes anterior, aviso 5 |
| Definida por documento | `REQUIRED` |
| No aplica | `NONE` |
| Al ingreso de la empresa o del trabajador | `ON_ENTITY_START` |
| Al mes siguiente | `MONTH_AFTER_START` |
| Al término | `ON_ENTITY_END` |
| En cuanto se solicita, y las especialidades | `ON_REQUEST` |

- Las especialidades son: altura, caliente, espacios confinados, eléctricos, sustancias, alimentos, guardias,
  soldador y operador D.
- Las 5 filas "Entrega de EPP específicos" llevan la especialidad en el nombre.

**Los ~20 que ya existen no se tocan.** La lista de coincidencias es explícita en el script y se muestra en la
simulación.

**Dudas:**
- Se cargan con la lectura literal.
- Se entrega una lista corta (~10 filas) al usuario para reenviar a WebCarga.
- La corrección se hace desde Configuración.

## Pruebas

- **Backend, integración** (`conexion_revertida`, sujetos creados por el test):
  - guardar la vigencia y versionarla (mismo tipo = versión de hoy; cambio de tipo = reinicio);
  - vista previa con efecto;
  - siembra `ON_REQUEST`, que no crea pendientes;
  - `NO_EXIGIBLE`;
  - atribución del término;
  - solicitar y quitar la solicitud;
  - `campos_que_pide` en carga, clasificación y planilla;
  - período anterior rechazado;
  - `vence_el` expuesto;
  - el script, en simulación sobre una copia de la planilla.
- **Frontend, vitest:**
  - `EditorVigencia`: cada tipo muestra sus campos y el ejemplo de fechas, y el cuerpo solo trae lo cambiado;
  - `SelectorExigibilidad`;
  - el sin permiso;
  - el error de la base visible;
  - el selector de período con el valor propuesto.
- **Trinquetes visuales** en margen 0, con tokens del sistema. Cero emojis; solo lucide-react.
- **Verificación en dev con Playwright:**
  - configurar el F30-1;
  - clasificar un documento con su período;
  - ver "sirve hasta el 18/11";
  - solicitar un documento de especialidad.

  Se usan entidades sin datos cargados.

## Riesgos

- **Costo de leer con reglas cargadas (M4):** se vuelve a medir `/status` y la cola después de cargar los 76 (aunque
  estén apagados no siembran) y al activar el primer tipo con reglas.
- **Disk IO:** activar un tipo siembra un registro por entidad (hasta ~250). Se activa de a uno, con la vista previa.
- **Despliegue:**
  - las migraciones siguen el patrón expand;
  - no se despliega con ingesta en vuelo;
  - `has_expiration` 7b sigue esperando su compuerta.
