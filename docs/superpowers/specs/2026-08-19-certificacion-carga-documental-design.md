# Certificación — la carga documental: el renglón pide lo suyo

**Fecha**: 2026-08-19 · **Estado**: diseño aprobado, sin implementar
**Origen**: click-through en vivo contra `webcarga-frontend-dev` que destapó dos defectos, más la
pregunta del usuario: *"si tenemos una sección para subir masivamente y después clasificar, ¿no está
de más subir uno por uno? ¿cuál es el estándar de la industria?"*

---

## 1. El problema, medido

El cajón de Certificación tiene **dos superficies de subida que hacen cosas distintas y no se
distinguen**:

| Superficie | Tamaño | Qué hace |
|---|---|---|
| Dropzone (`TriageDropzone`) | **1183 × 211 px** | manda a la Bandeja, **sin clasificar** |
| "Subir" por requisito | **42 × 17 px** | clasifica **directo** al requisito |

La segunda mide menos que el mínimo accesible de 24 × 24 px, y es **350 veces más chica** que la
primera, que está justo encima.

**Y la chica falla.** `POST /document-ingest/items/classify-batch` responde 422 *"Este documento
requiere fecha de vencimiento"* cuando el requisito la exige, y el botón nunca la pide:

| Entidad | Requisitos que exigen fecha | Total activos |
|---|---|---|
| Conductor | 5 | 12 |
| **Vehículo** | **8** | **10** |
| Empresa | 6 | 13 |

**19 de los 35 requisitos activos.** Peor: `uploadAndClassify` **sube primero y clasifica después**,
así que cada fallo deja el archivo **varado en la Bandeja** y el requisito vacío. Desde la pantalla
se ve como que no pasó nada.

**El resultado en producción**: 5.122 registros de cumplimiento, **24 con archivo** (0,5 %). La
Bandeja no recibió un documento real desde el día que se construyó (65 ítems, todos `DISCARDED`,
todos del 2026-08-15).

---

## 2. Lo que decidió el usuario

| Pregunta | Respuesta |
|---|---|
| ¿Cuál es la situación dominante de quien carga? | **Las tres conviven**: onboarding por carpeta, renovación de un documento, recepción desordenada. La pregunta pasa a ser cómo dejan de estorbarse. |
| ¿De dónde sale la fecha de vencimiento? | **Depende del requisito**. Para algunos la fecha *es* el dato que importa; para otros es formalidad. |
| ¿Qué modelo seguimos? | **A — el hueco pide lo suyo.** |
| ¿La ficha legacy entra? | **Sí.** |

### El benchmark que sostiene la elección

| Producto | Camino primario |
|---|---|
| **Fleetio** | el hueco pide lo suyo — un diálogo pide archivo *y* vencimiento juntos |
| **Samsara** | el tipo de documento declara sus campos; el formulario los pide al subir |
| **MyCarrierPackets** | checklist de casilleros que el transportista llena |
| **Highway** | verificación automática; el humano resuelve excepciones |
| **RMIS (DAT)** | recibe el paquete y vigila vencimientos después |

**Ninguno de los cinco tiene una bandeja de triaje como camino principal.** Cuatro de cinco hacen
que el casillero pida lo que necesita. El triaje aparece sólo donde los documentos llegan sin
pedirlos, y siempre como destino aparte — nunca encima del casillero.

A eso se suma la evidencia propia: la Bandeja lleva días construida con **cero uso real**, mientras
la pantalla que la gente sí mira es la lista de lo que falta.

---

## 3. El renglón es la superficie de carga

La lista de "lo que falta" deja de ser un listado con botones y pasa a ser **la** superficie.

**Estados de un renglón:**

1. **En reposo** — nombre del requisito, y la invitación: *arrastra aquí o haz clic*.
2. **Recibiendo** — al arrastrar un archivo encima, el renglón se marca: *suelta para cargar aquí*.
3. **Pidiendo lo que falta** — si el requisito declara vencimiento obligatorio, el renglón **se abre
   ahí mismo** con el campo de fecha y un botón de guardar. Sin modal, sin navegar, sin perder el
   contexto.
4. **Subiendo** — indicador en el propio renglón.
5. **Listo** — confirmación en el renglón, con **deshacer** mientras sea el último cargado.
6. **Con error** — el motivo **en el renglón que falló**, conservando el archivo elegido para que
   reintentar no obligue a buscarlo de nuevo.

**Reglas de diseño:**

- **El renglón entero es el blanco**: ancho completo, ~40 px de alto. Recibe el archivo soltándolo
  encima y también responde al clic. Se termina el blanco de 42 × 17 px.
- **Nada se sube hasta estar completo.** Se junta archivo + fecha y recién entonces sale **una sola**
  operación. Esto es lo que elimina el 422 y los archivos huérfanos, de raíz.
- **El dropzone de 211 px se va del cajón.** En su lugar, un enlace de una línea a la Bandeja, que
  sigue siendo el destino de lo que llega por correo y del onboarding de 40 archivos. Deja de
  competir con el renglón porque deja de estar encima de él.
- **Se puede deshacer lo recién hecho.** Hoy nada se puede deshacer y por eso todo da miedo.

**Consecuencia aceptada**: el onboarding masivo de una empresa deja de hacerse desde el cajón y pasa
a hacerse en la Bandeja. El cajón queda optimizado para renovación y para rematar lo que falta.

---

## 4. El dato y el contrato

### 4.1 El endpoint correcto ya existe

`POST /compliance-records/{record_id}/file` (`compliance.py:810`) recibe multipart `file` +
`expiration_date`, deja el registro en `APPROVED_MANUAL` y escribe auditoría
(`record_manual_edit`, `action="document_upload"`).

**Corrección (2026-08-19, al implementar)**: este documento afirmaba que el cliente del frontend ya
tenía el método. **Es falso.** `lib/api/compliance.ts` declara el tipo `ComplianceFileUploadResult`
pero **ninguna función lo usa**; la línea que se citó es `deleteFile`. El método hay que escribirlo.
Lo que sí es cierto y sostiene el diseño: `apiFetch` ya maneja `FormData` sin pisar el
`Content-Type` (`lib/api/client.ts:24`) y propaga el `detail` del backend como mensaje de error, así
que el 422 llega al renglón como texto legible sin plomería extra.

El cajón hoy llama a `documentIngestApi.uploadAndClassify`, que es el camino de la pila. **Cambiar a
qué endpoint llama elimina el varado estructuralmente**: no hay estado intermedio donde quedarse.

### 4.2 `has_expiration` pasa a tres estados con nombre

Hoy es un booleano cargando tres significados, y por eso `classify-batch` trata "tiene vencimiento"
como "el vencimiento es obligatorio". Séptima aparición en este módulo de un valor con doble sentido.

Se reemplaza por una política sobre `public.compliance_requirements`, con
`CHECK (... IN ('REQUIRED','OPTIONAL','NONE'))`.

**Migración deliberadamente conservadora**: `has_expiration = true → 'REQUIRED'`,
`false → 'NONE'`. Preserva **exactamente** el comportamiento actual — los 19 que exigen siguen
exigiendo — y deja que negocio mueva a `OPTIONAL` los que decida.

**Dónde lo cambia negocio**: Configuración → Certificación, la pantalla que ya existe y que hoy
muestra 46 elementos sin revisar. No se construye pantalla nueva.

### 4.3 La pregunta va en el frontend, el guardia en el backend

Hoy `/file` acepta sin fecha **siempre**, incluso para una licencia. Pasa a validar contra la
política: `REQUIRED` sin fecha → 422 con motivo claro; `OPTIONAL` y `NONE` → acepta. El renglón
pregunta antes para que nunca llegue incompleto, pero quien decide es el servidor.

### 4.4 Lo que no se toca

`classify-batch` y su 422 quedan igual: siguen siendo correctos para el camino de la pila, donde el
archivo ya está subido y la fecha es lo único que falta.

**Consecuencia declarada**: al subir directo, el documento **no pasa por `document_ingest_items`**,
así que no queda registro de "llegó a la bandeja". No es pérdida de trazabilidad — el versionado
vive en `audit_log` y en un `storage_path` nuevo por versión — pero deja de ser cierto que todo
documento pasó por la Bandeja.

---

## 5. Alcance

### 5.1 El hueco de la renovación anticipada

`pendiente_predicate()` (`compliance.py:81`) es
`status IN ('MISSING','EXPIRED') OR expiration_date < CURRENT_DATE` — o sea **ya vencido**. Un
documento que vence en diez días no aparece: ni en el cajón, ni en la etapa "Hay que renovar" del
embudo, que usa el mismo criterio.

Medido hoy: **9 ya vencidos, 3 vencen dentro de 30 días, 6 dentro de 90**, sobre 31 con fecha. Los
números son chicos porque casi nada tiene fecha todavía; cuando se carguen los ~1.100 documentos con
vencimiento, **ése pasa a ser el trabajo diario**.

**Entra en alcance lo mínimo**: la lista suma **"por vencer"** como estado propio, con la ventana
(en días) como valor de configuración, no hardcodeada. Renovar es reemplazar en el mismo renglón.

**Dónde vive ese valor queda para el plan.** La pestaña "Umbrales" que existe hoy es de las alertas
operacionales del Monitor, no un cajón general — meter ahí un umbral de Certificación mezclaría dos
dominios. Configuración ya está organizada por dominios, así que lo natural es el de Certificación,
pero hay que mirarlo antes de decidir.

### 5.2 Superficies alcanzadas

- El cajón de Certificación para **empresa, conductor y vehículo** — el mismo componente con
  `subject`, ya construido.
- **La ficha legacy** de conductor y vehículo (`DocumentChecklist` en `DriverDetailPanel` /
  `VehicleDetailPanel`), que hoy también carga documentos: **usa el mismo componente**, no una
  segunda versión. "Una sola implementación" fue el criterio explícito de la HU-04, y es exactamente
  donde reaparecería el frankenstein.

### 5.3 Errores

Hoy hay un solo `errorSubida` para todo el cajón, así que con 12 renglones no se sabe cuál falló.
Pasan al renglón que falló, con motivo: archivo mayor a 7 MB (`STORED_FILE_MAX_BYTES`), tipo no
permitido (PDF, PNG, JPEG, WEBP, HEIC, Word, Excel), o falta la fecha.

---

## 6. Verificación

1. Tests de componente **por estado del renglón** (reposo, recibiendo, pidiendo fecha, subiendo,
   error, listo), siguiendo el patrón que ya usa `components/compliance/*.test.tsx`.
2. Test de backend **contra Postgres real**: `/file` rechaza sin fecha cuando la política es
   `REQUIRED` y acepta cuando es `OPTIONAL`. Nada de `AsyncMock` para el SQL nuevo.
3. **Cada test nuevo se muta antes de darlo por bueno.** Un test que no muere no es una red.
4. **Click-through en vivo subiendo un documento de verdad**, eligiendo una entidad sin documentos
   cargados. Es lo único que prueba de punta a punta lo que hasta ahora no se pudo probar.
5. `npx vitest run` · `npx tsc --noEmit` · `npm run build` · `venv/bin/python -m pytest tests/`.
6. Los trinquetes visuales, que están en margen cero: color 1.765/1.765, sub-11px 268/268. El token
   `--informativo` ya existe; cualquier gris nuevo usa ése.

---

## 7. Fuera de alcance, explícito

- **Conectar el clasificador** (`document_matcher.py`): 307 líneas puras con 12 tests que no llama
  nadie. Es el trabajo siguiente y tiene su propio tamaño.
- **Avisos de vencimiento** por correo o notificación.
- **Que el transportista suba su propia documentación** (el modelo Highway / MyCarrierPackets).
- **El modelo de datos de Seguros.**
- **Extracción automática de la fecha desde el PDF** — se evaluó y quedó afuera: es build real y
  depende del clasificador.

---

## 8. Riesgos declarados

1. **El onboarding masivo se muda a la Bandeja**, que hoy tiene cero uso real. Si la Bandeja no
   funciona bien para 40 archivos, el caso de onboarding queda peor que antes. Mitigación: la
   Bandeja ya acepta 50 archivos por tanda y encadena lotes; no se toca en este trabajo, pero hay
   que mirarla antes de declarar terminado el onboarding.
2. **Tocar la ficha legacy amplía el radio de impacto** a `DriverDetailPanel` y `VehicleDetailPanel`,
   que no son de Certificación. Es una decisión explícita del usuario, tomada para no dejar dos
   formas de subir el mismo documento.
3. **Cambiar `pendiente_predicate()` tiene radio de impacto ancho.** Lo comparten `/pending`, el
   embudo y el cajón — y el código ya lleva un comentario (`compliance.py:78-79`) sobre un bug
   pasado en exactamente esta zona: el embudo mandaba 8 empresas a "Hay que renovar" mientras el
   cajón de cada una decía "No le falta ningún documento". Agregar "por vencer" **tiene que mover
   las tres lecturas juntas**, o el defecto vuelve con otra cara.
4. **La migración de `has_expiration` no cambia comportamiento por sí sola.** Si negocio nunca mueve
   nada a `OPTIONAL`, el sistema queda igual de exigente que hoy — pero al menos deja de mentir
   sobre por qué.
