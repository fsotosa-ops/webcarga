# Rediseño del módulo Certificación — diseño

**Fecha:** 2026-08-15
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Reemplaza:** `2026-08-15-zoom-empresa-conductor-vehiculo.md` (plan revertido en la Ronda 109,
commit `addb278`). El marco del zoom-out sigue siendo correcto; lo que falló fue construirlo de a parches.

---

## 1. Para quién es y qué trabajo hace

El usuario es **quien recluta y certifica empresas de transporte**. Su trabajo tiene cuatro momentos:

1. Crear la empresa recién reclutada.
2. Saber qué documentación necesita.
3. Cargarla — casi siempre en tandas, no de a uno.
4. Renovar lo que vence.

No es alguien que vigila un tablero: es alguien que **mueve empresas por un embudo**, de recién creada a
certificada. Todo el diseño se ordena por eso.

## 2. La evidencia que ordenó el diseño

Medido contra producción (`viclzoftiudkepqnhekv`) el 2026-08-15:

| Dato | Valor | Qué implica |
|---|---|---|
| Empresas | 248 total · **39 activas** | El catálogo completo no puede ser la vista por defecto |
| Conductores / Vehículos | 80 / 118 | — |
| Conductores por empresa | **promedio 2, máximo 12** | Fijada la empresa, elegir sujeto es un clic |
| Vehículos por empresa | **promedio 3, máximo 25** | Igual |
| Requisitos en catálogo | 37 → 15 empresa, 12 conductor, 10 vehículo | — |
| Registros de cumplimiento | 4.990 · **4.895 en MISSING** | El sistema está vacío, no incompleto |
| Documentos cargados | **95 — un 1,9%** | Una barra de progreso no discrimina nada |
| Nivel legal | **33 de 37 son `LEGAL_MANDATORY`** | El nivel no sirve para priorizar |
| Con fecha de vencimiento | 31, 9 vencidos | La vigilancia de vencimientos es marginal hoy |
| Tipo de operación | **Equipo Completo 73 · Tractoreo 43** vehículos | Ambos poblados y usables |
| Empresas por gestión | **23 sólo Tractoreo · 12 sólo Equipo Completo · 1 mixta** | Es un atributo de empresa en la práctica |
| Viajes vinculados | 462 con empresa · **0 futuros** | No hay alerta anticipada, sólo actividad pasada |

**Consecuencia principal:** ordenar por "cuánto le falta a cada empresa" no informa. Las 39 activas tienen
el mismo denominador y entre 1 y 3 documentos cubiertos: la diferencia entre la primera fila y la
trigésima es un documento. Ese fue el error del diseño anterior.

## 3. Decisiones tomadas

| # | Decisión | Quién |
|---|---|---|
| D1 | La pantalla sirve al **régimen** (vigilar cumplimiento), no sólo al arranque | Usuario |
| D2 | Eje principal **por empresa**; por requisito es una agrupación secundaria | Usuario (A+C) |
| D3 | Los grupos son el **embudo de certificación**, no el riesgo operacional | Diseño |
| D4 | **Una sola puerta de carga**: todo entra a la cola de ingesta | Usuario |
| D5 | La bandeja se muestra **agrupada en pilas**, con lista plana disponible | Diseño |
| D6 | **Con historial de versiones** al renovar | Usuario |
| D7 | El **tipo de gestión** se elige al crear y condiciona la plantilla | Usuario |
| D8 | Los 2 condicionales de empresa quedan **pendientes de negocio** | Usuario |

---

## 4. Estructura del módulo

Una sola pantalla, `/dashboard/compliance`.

```
┌──────────────────────────────────────────────────────────────────┐
│ Agrupar por [Empresa][Conductor][Vehículo][Requisito]            │
│                              [Sin clasificar ⬤N] [Nueva empresa] │
├──────────────────────────────────────────────────────────────────┤
│ RECIÉN CREADAS · SIN DOCUMENTOS                        2         │
│  › Transportes Los Nogales   Tractoreo    ▁▁▁▁▁▁  0 de 15        │
│ EN PROCESO                                            36         │
│  › Transportes Charlotte     Tractoreo  ⬤38  ▓▁▁▁▁  3 de 93      │
│ HAY QUE RENOVAR                          6 docs · 3 empresas     │
│ ▸ CERTIFICADAS Y AL DÍA                                0         │
│ ▸ RESTO DEL CATÁLOGO                                 209         │
└──────────────────────────────────────────────────────────────────┘
```

**El control de agrupación no crea vistas nuevas.** Las cuatro opciones miran los mismos 4.895 requisitos
pendientes, agrupados distinto. No hay dos listas que sincronizar.

**La bandeja no es una quinta agrupación.** Son archivos que todavía no pertenecen a nada, así que vive
detrás de su propio botón, con contador.

### Los grupos del embudo (agrupación por empresa)

| Grupo | Criterio |
|---|---|
| Recién creadas · sin documentos | 0 documentos cubiertos |
| En proceso | Entre 1 documento y el total, sin vencidos |
| Hay que renovar | Tiene al menos un `expiration_date < current_date` |
| Certificadas y al día | Todos los requisitos cubiertos y ninguno vencido |
| Resto del catálogo | `operational_status <> 'ACTIVE'` — plegado por defecto |

Que una empresa esté operando **no la cambia de grupo**: se muestra como marca dentro de su grupo
(`14 viajes · 30 días`), porque hoy no hay viajes futuros vinculados y usarlo como criterio de orden
prometería una anticipación que los datos no tienen.

## 5. La gramática: una fila que se abre hacia abajo

Un solo gesto en todo el módulo. **No hay panel lateral, no hay modal, no hay página nueva.**

- Si la fila es una **empresa**, adentro está lo que le falta y lo que le llegó.
- Si la fila es una **pila** de la bandeja, adentro están sus archivos.
- En los dos casos, cada línea termina en **un destino**, y elegirlo es la única decisión que existe.

Razón: el panel lateral del intento anterior apretaba la lista a media pantalla y obligaba a elegir entre
ver el contexto o ver el detalle. El cajón no achica nada y nunca saca al usuario de donde estaba.

### Cajón de una empresa

Dos secciones, en este orden:

1. **Llegaron y esperan que los ubiques** — su porción de la bandeja, con "Confirmar los N propuestos".
2. **Lo que falta** — los requisitos pendientes, con `Subir` por línea, más su flota en renglones plegables.

Al final, la zona de arrastre de esa empresa.

## 6. Carga masiva: una puerta, tres antesalas

Los tres puntos de carga escriben en **la misma cola de ingesta**. Cambia sólo cuánto se sabe de antemano.

| Desde | Se sabe | Falta |
|---|---|---|
| El botón `Subir` de un requisito pendiente | Todo | Nada — queda confirmado al instante |
| El cajón de una empresa | El dueño | El sujeto exacto y el tipo |
| La bandeja global | Nada | Todo |

### La bandeja

**Una superficie, dos entradas:** global desde el botón, o filtrada por empresa dentro de su cajón.
Un solo componente que recibe o no un `carrier_id`.

**Estados obligatorios:**

- **Vacía** — la zona de arrastre *es* la pantalla. Acepta carpetas y ZIP. Dice explícitamente que nada
  queda certificado hasta confirmar. Es el estado real de hoy: 0 items.
- **Cargando** — barra, conteo, tiempo estimado, y las etapas separadas (recibidos → leyendo y agrupando
  → armando pilas). Debe decir que se puede cerrar la pestaña.
- **Con archivos** — la zona se encoge a una barra; toda la pantalla sigue aceptando que suelten encima.
- **Error** — un archivo que falló no detiene la tanda; se lista aparte con su motivo.

**Las pilas.** Dos secciones y nada más: *Listas para confirmar* y *Necesitan que decidas*. Se acabaron
los cuatro vocabularios de certeza del borrador anterior. Una pila se arma por **el atributo que sus
archivos de hecho comparten**, que cambia según la tanda: por empresa cuando comparten empresa, por tipo
cuando comparten tipo. Existe siempre "Ver como lista plana".

## 7. Lógica de asignación

### Dos coordenadas

Un documento se ubica con **de quién es** (la empresa, o uno de sus conductores o vehículos) y **qué
documento es** (uno de los requisitos de ese quién). Nada más.

En la interfaz esto es **una sola elección**, no tres desplegables encadenados: se elige el par, y el par
ya es una fila de `compliance_records`.

> **Nomenclatura:** internamente ese par se llama *slot*. En la interfaz **nunca** aparece la palabra
> "hueco" ni "slot". Los textos son: `Elegir a qué corresponde`, `A qué corresponde este documento`,
> `Lo que falta · 90 documentos`, `faltan 12`.

### Regla del lote

**En un lote, una coordenada se comparte y la otra tiene que ser distinta en cada archivo.**

- La carpeta de una empresa comparte el *quién* → cada archivo va a un requisito distinto.
- Las licencias sueltas comparten el *qué* → cada archivo va a un conductor distinto.

**Nunca se comparten las dos.** Marcar 31 licencias y asignarlas todas al mismo conductor debe ser
impedido: ese conductor tiene una sola ranura de Licencia de Conducir y 30 archivos se perderían.

### Mover una pila a una empresa encamina, no termina

El botón dice **"Mover a Transportes Charlotte"**, no "Asignar". Los archivos quedan con `carrier_id`
pero sin ubicar, salen de la bandeja global y aparecen en el cajón de esa empresa — que es donde se
puede terminar, porque ahí los candidatos son 2 conductores y 4 vehículos, no 80 y 118.

### Desambiguación entre los conductores y vehículos de una empresa

`app/services/document_matcher.py` **ya lo resuelve** y no hay que reescribirlo:

| Vía | Confianza | Nota |
|---|---|---|
| RUT de empresa en el nombre | 0,95 | Con validación de dígito verificador |
| Patente en el nombre | 0,95 | Busca cuál de las patentes **que existen** aparece — diccionario cerrado |
| RUT de conductor | 0,95 | — |
| Nombre de conductor, similitud por ventanas | 0,90 exacto, menos si es aproximado | Un typo siempre pasa por confirmación humana |

Cuatro estados ya definidos: `AUTO`, `SUGGESTED`, `AMBIGUOUS`, `UNMATCHED`. La regla escrita en el
código es la correcta y se conserva: *sólo se aplica solo lo que tiene identificador fuerte, un único
candidato y tipo resuelto; el resto lo confirma una persona y nada se descarta nunca*.

**Lo que falta no es el motor: es mostrar sus resultados agrupados por sujeto.** El cajón de una empresa
parte la pila en `De la empresa`, una sección por patente, una por conductor, y una final
`No se pudo saber de quién`.

Cuando hay dos candidatos parecidos **no propone: pregunta**, mostrando los 2 a 4 candidatos como
botones. Adivinar entre dos sería peor que preguntar — un contrato de trabajo en el conductor equivocado
no se nota nunca.

### Choques y renovaciones

Dos archivos al mismo destino se muestran como **choque explícito** y se resuelven a mano. **Nunca se
sobrescribe en silencio.**

Cuando el destino ya tiene documento, es una **renovación**: el nuevo pasa a vigente y el anterior queda
archivado y consultable.

> **Migración requerida (D6).** Hoy existe `compliance_records_entity_id_requirement_id_key`, un índice
> único **sin condición** sobre `(entity_id, requirement_id)`. Impide físicamente el historial: hay 4.990
> registros y **cero** con `is_current = false`. Hay que **eliminar ese índice** y conservar
> `idx_unique_current_compliance`, que es el parcial `WHERE is_current = true` y ya está preparado para
> esto. Sin ese cambio, cargar el F30 de agosto borra el de julio y no se puede demostrar qué estaba
> vigente el mes pasado.

### Operaciones en lote

Tres, sobre la selección: **Asignar a…**, **Marcar el tipo…**, **Descartar**. El selector se adapta a la
coordenada que falta.

**Dos reglas no negociables:**

1. **El botón nombra la cantidad exacta.** `Asignar los 3 a…`, nunca `Asignar seleccionados`. Con un
   filtro puesto, "todo" es ambiguo, y ahí es donde se asignan 2.000 archivos a la empresa equivocada.
2. **Ninguna operación en lote existe sin su deshacer en lote.** Hoy corregir es de a uno (HU-03) y eso
   no aguanta un error masivo. El aviso de deshacer permanece hasta la siguiente acción, y la operación
   queda registrada para revertirla después.

## 8. Tipo de gestión y plantilla de requisitos

**Dónde vive el dato:** `assets.webcarga_operation_type_id` → `app.status_taxonomies`. Sigue ahí, por
vehículo. **No se resucita `carrier_fleet_service_types`**, que fue eliminada.

La marca de la empresa se **deriva** de su flota. La única empresa mixta se muestra como
`Tractoreo + Equipo Completo`, no se esconde.

**Semántica confirmada contra los datos:**

| Gestión | Subtipos físicos que registra | Vehículos |
|---|---|---|
| Tractoreo | TRACTOCAMION únicamente | 43 |
| Equipo Completo | TRACTOCAMION 37 + Furgón Congelado 20, Furgón Seco 11, Sider 5 | 73 |

En tractoreo el transportista pone sólo el tracto; el remolque es del cliente.

**En el alta** se elige la gestión (Tractoreo / Equipo Completo / Las dos). Determina qué flota se va a
registrar y con eso qué requisitos aparecen. Se guarda la elección para que una empresa recién creada
—sin vehículos todavía— ya muestre su gestión y proponga el subtipo correcto al registrar el primero.
Se puede cambiar después.

**En la lista y el detalle** se muestra la marca de gestión de la empresa, y el subtipo físico junto a
cada patente.

### Condicionalidad de requisitos

El mecanismo existe: `requirement_level = 'CONDITIONAL_OPTIONAL'`, 4 requisitos. Nunca se siembran solos.

| Requisito | De | Regla |
|---|---|---|
| Mantención Cámara de Frío | Vehículo | **Supuesto a confirmar:** sólo Furgón Congelado/Refrigerado y Multitemperatura |
| Resolución Sanitaria | Vehículo | **Supuesto a confirmar:** sólo furgones que transportan alimentos |
| Seguro EETT | Empresa | **PENDIENTE DE NEGOCIO (D8)** |
| Seguro RC Empresa | Empresa | **PENDIENTE DE NEGOCIO (D8)** |

Los dos de empresa **no se siembran** hasta que exista la regla. No bloquean el resto del rediseño.

## 9. Sistema visual

Se usan los tokens existentes de `app/globals.css`. **No se introduce paleta nueva.**

`--accent #1cb9ec` · `--ink #192a3e` · `--border #dfe0eb` · `--bg-main #e5e5e5` · Mulish + Roboto.

| Rol | Tratamiento | Regla |
|---|---|---|
| Etapa / grupo | 10px, 600, versalitas, `letter-spacing .11em`, gris | Andamiaje. No compite |
| Sujeto (empresa, conductor, patente) | 13,5px, 600, tinta | **Lo más fuerte.** Es lo que se escanea |
| Archivo | 11px monoespaciada, gris | Un nombre de archivo parece un nombre de archivo |
| Acción | 11,5px, 600, `#0d7ea6` | El único azul de la fila. Si hay azul, se puede hacer clic |
| Te espera | Rojo sólido `#b00020` | **Un solo significado:** hay archivos esperando. Nada más |
| Resuelto | Verde `#12a150` | Sólo cuando algo quedó cerrado. Nunca para "va bien" |

**El principio:** el peso y la familia separan *qué es cada cosa*; el color separa *qué se puede hacer*.
Si todo tiene color, el color deja de avisar.

Íconos: `lucide-react` únicamente. **Cero emojis.** Textos en español neutral, sin voseo.

## 10. Qué falta en el backend

| Necesidad | Estado hoy | Qué hacer |
|---|---|---|
| Carga sin empresa | `POST /{carrier_id}/files` **exige empresa** | Endpoint de carga global. `document_ingest_batches.carrier_id` ya es nullable |
| Cola con sugerencias | `GET /items` filtra `match_status = 'UNMATCHED'` | Incluir `AUTO`, `SUGGESTED`, `AMBIGUOUS`; excluir `COMMITTED` y `DISCARDED` |
| Pilas | No existe | Agrupación por empresa o por requisito, con conteos |
| Historial de versiones | Índice único lo impide | Migración (§7) |
| Deshacer en lote | No existe | Revertir una operación completa |
| Empresa del alta | No se guarda la gestión | Persistir la elección |

Ya existen y se conservan: `classify`, `classify-batch`, `items/move`, `preview-url`,
`compliance-records/status?group=&carrier_id=`, `reassign`, y `document_matcher.py` completo.

## 11. Fuera de alcance

- Reconocimiento por **contenido** del archivo (OCR). El matcher lee el **nombre**. Ampliarlo es otro
  proyecto.
- Vincular certificación con viajes futuros. No hay datos que lo sostengan (0 viajes futuros vinculados).
- HU-05 (administración de requisitos) y HU-06 (Seguros proyectado a cumplimiento).
- Renombrar los valores de `?tab=` de la ficha de carrier.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Asignación masiva errónea | El botón nombra la cantidad; deshacer en lote obligatorio |
| La migración del índice toca producción | Verificar contra la base real antes de aplicar; hoy hay 0 filas con `is_current = false`, así que no hay datos que migrar |
| Las pilas agrupan mal y estorban | "Ver como lista plana" siempre disponible |
| Frente y reverso de un mismo documento | **Default, para no bloquear:** con el historial de D6, el segundo archivo entra como una versión más del mismo requisito. El vigente es el último y el anterior queda archivado y consultable, así que **no se pierde nada**. Es semánticamente imperfecto —no son versiones, son dos caras— pero es reversible. Si al usarlo resulta molesto, se decide entonces si un requisito admite varios archivos vigentes a la vez |

## 13. Orden sugerido para el plan

El alcance es grande y toca base de datos, backend y frontend. Se implementa en tres tramos, cada uno
entregable y verificable por sí solo. **El orden importa**: el tramo 1 desbloquea la entrada de los 2.000
documentos, que es el pendiente real del proyecto.

| Tramo | Qué entrega | Por qué va en ese orden |
|---|---|---|
| **1 · La puerta** | Carga global sin empresa, cola que devuelve todos los estados no confirmados, bandeja con sus cuatro estados, lista plana con selección múltiple, deshacer en lote | Es lo único que hoy impide meter los 2.000 documentos. Sale sin tocar el esquema |
| **2 · La lista** | Embudo de certificación, cajón que se abre hacia abajo, alta inline con tipo de gestión, sistema visual, agrupación por conductor/vehículo/requisito | Es el rediseño propiamente tal. Depende del tramo 1 sólo para el contador de la bandeja |
| **3 · Las pilas y el historial** | Agrupación en pilas con desambiguación por sujeto, migración del índice único, renovaciones con versiones | Lo más caro y lo que más se beneficia de haber visto datos reales entrando por el tramo 1 |

---

## Anexo · Mockups

`/.superpowers/brainstorm/23490-1786765434/content/` — `embudo-reclutamiento.html`,
`una-sola-decision.html`, `ensamblado.html`, `carga-masiva.html`, `contraste-y-lotes.html`,
`de-quien-es.html`, `gestion-y-plantilla.html`.
