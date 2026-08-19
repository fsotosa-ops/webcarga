# Conectar el clasificador de la Bandeja · Diseño

**Fecha:** 2026-08-19
**Estado:** propuesta, pendiente de revisión del usuario

## El problema, en una línea

El motor de clasificación está escrito, probado y **no lo llama nadie**, así que cargar los ~2.000
documentos que vienen significa clasificarlos uno por uno a mano.

## Lo que ya existe, medido

Esto no es un desarrollo desde cero. Es **poner un cable** entre piezas que ya están construidas.

| Pieza | Estado hoy |
|---|---|
| `app/services/document_matcher.py` | **307 líneas, 9 funciones, 12 tests que pasan** |
| `public.requirement_filename_aliases` | **79 alias**, cubriendo **37 de 37** requisitos (2,5 por requisito) |
| Columnas de destino en `document_ingest_items` | `entity_type`, `entity_id`, `requirement_id`, `confidence`, `match_evidence`, `candidates` — **las seis existen y las seis están en cero** |
| Quien lo llama | **nadie** |
| Lo que hace hoy `document_ingest.py:70` | inserta el literal `'UNMATCHED'` en cada archivo que entra |

**No hace falta migración.** El esquema se diseñó para esto y quedó esperando.

## Por qué ahora, y por qué solo

Tres razones, en orden:

1. **Es lo único que cambia el orden de magnitud.** Con la sugerencia puesta, el trabajo del operador
   pasa a ser *confirmar* en vez de *decidir*. Sin ella, 2.000 documentos son 2.000 decisiones.
2. **No depende de ninguna decisión pendiente.** No toca pantallas, no toca el modelo de datos, no
   necesita que se resuelva la estructura de navegación ni la ficha de empresa.
3. **Se mide sola.** No sabemos cómo vienen nombrados los ~2.000 documentos y no hay muestra
   disponible. Una vez conectado, **el reparto de `match_status` sobre los archivos reales ES la
   respuesta**: si predomina `AUTO`, los nombres son buenos; si predomina `UNMATCHED`, hacen falta
   el manifiesto o los nombres canónicos. Se obtiene la medición por el solo hecho de desplegar.

## Cómo decide el motor (resumen, no rediseño)

El motor ya está diseñado y **este trabajo no lo modifica**. Se resume acá porque el contrato del
cableado depende de entenderlo.

Son **dos decisiones independientes** desde el nombre del archivo:

**Quién — la entidad.** Cuatro vías, de más fuerte a más débil:

| Vía | Cómo | Confianza |
|---|---|---|
| Manifiesto | el operador declara el identificador | 1.0 (corta la cascada) |
| RUT | extrae RUTs y **valida el DV por módulo 11** | 0.95 |
| Patente | busca cuál de las patentes **que existen** aparece como token | 0.95 |
| Nombre del conductor | similitud difusa con ventana deslizante | 0.60 – 0.90 |

Dos propiedades que importan y que no hay que romper al cablear:

- **La patente no se reconoce por formato, se busca en un diccionario cerrado.** No puede proponer un
  vehículo que no está en la flota.
- **El match aproximado topa por debajo de 0.90 a propósito** (`_fuzzy_confidence`), así que un typo
  en un nombre **nunca** llega a auto-aplicarse.

**Qué — el tipo de documento.** `_match_requirement(nombre, catalogo, target_entity)` busca alias
**acotados por tipo de entidad**. Una vez que sabe que es un vehículo, sólo considera tipos de
documento de vehículo: "Licencia de Conducir" no se le puede asignar a un tracto. Entre alias que se
solapan gana el de mayor `priority` — `USO Y MANTENCION EPP` (100) le gana a `EPP` (10).

**La regla de aplicación:**

```
sin candidatos                       → UNMATCHED
dos candidatos a menos de 0.05       → AMBIGUOUS   (decide una persona)
≥ 0.90 y con tipo resuelto           → AUTO        (se aplica solo)
todo lo demás                        → SUGGESTED   (confirma una persona)
```

Y la línea que define el riesgo del cambio: *"solo se aplica solo lo que tiene identificador fuerte,
un único candidato y un tipo de documento resuelto. Todo lo demás lo confirma una persona, **y nada
se descarta nunca**"*.

## El diseño del cableado

### Dónde se llama

En `document_ingest.py`, **después** de subir el archivo a storage y **antes** del `INSERT` — de modo
que la fila nazca ya clasificada en vez de nacer `'UNMATCHED'` y actualizarse después. Un solo
`INSERT` en vez de insert + update: menos escrituras y ninguna ventana en la que la fila existe sin
su clasificación.

### Qué se carga, y una sola vez por lote

El motor es **puro**: recibe el catálogo y el universo ya cargados. Quien lo llama los lee.

Se leen **una vez por lote**, no una vez por archivo. Una carga de 200 documentos hace **2 consultas**
de catálogo y universo, no 400.

```python
async def _cargar_catalogo(conn) -> Catalog: ...
async def _cargar_universo(conn, carrier_id: str | None) -> EntityUniverse: ...
```

### El acotamiento por empresa es lo que más sube la precisión

`match_document` lo dice: *"El scope de empresa se aplica **ACOTANDO EL UNIVERSO** antes de llamar…
Así el scope no puede quedar desincronizado entre el filtro y el match."*

Consecuencia concreta:

| Endpoint | Universo |
|---|---|
| `POST /{carrier_id}/files` | **sólo las entidades de esa empresa** — 2 conductores y 3 vehículos en promedio |
| `POST /files` | todas: 34 empresas, 87 conductores, 124 vehículos |

Subir desde la ficha de una empresa no es comodidad: **es precisión**. Con el universo acotado, un
nombre ambiguo que cruzaría con tres conductores homónimos del sistema entero cruza con uno solo.

### Qué se persiste

Las seis columnas que ya existen:

| Columna | De dónde sale |
|---|---|
| `match_status` | `classify_match(candidatos)` |
| `entity_type`, `entity_id` | del candidato de mayor confianza |
| `requirement_id` | del candidato, `NULL` si el tipo no se resolvió |
| `confidence` | `candidatos[0].confidence` |
| `match_evidence` | `candidatos[0].evidence` — **el porqué**, para que la pantalla lo pueda mostrar |
| `candidates` | la lista completa, **para que `AMBIGUOUS` pueda ofrecer las dos opciones** |

`match_evidence` no es telemetría: es lo que permite que la interfaz diga *"Licencia · J. Pizarro"* y,
al preguntar, *"porque el nombre trae el RUT 12.345.678-9"*. Una sugerencia que no explica su razón
no se puede confirmar con confianza.

### Qué NO hace este trabajo

- **No auto-aplica nada más allá de lo que el motor ya define.** `AUTO` no crea el
  `compliance_record`: sólo deja la fila lista con su destino. Aplicarla sigue siendo
  `classify-batch`, con una persona.
- **No toca ninguna pantalla.** La columna de sugerencia en la Bandeja es trabajo aparte; sin ella
  el cableado igual sirve, porque `classify-batch` puede preseleccionar desde `entity_id` y
  `requirement_id`.
- **No modifica el motor.** Ni sus umbrales, ni sus vías, ni sus tests.
- **No agrega el manifiesto.** Sigue sin interfaz. Si los datos dicen que hace falta, es el trabajo
  siguiente.

## Cómo se sabe si funcionó

**El criterio de éxito no es "los tests pasan": es el reparto sobre archivos reales.**

```sql
SELECT match_status, count(*), round(avg(confidence), 3)
FROM public.document_ingest_items
WHERE created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;
```

Cómo se lee:

| Resultado | Qué significa | Qué se hace |
|---|---|---|
| `AUTO` + `SUGGESTED` dominan | los nombres traen señal | seguir con la columna de sugerencia en la pantalla |
| `AMBIGUOUS` alto | homónimos o universo demasiado ancho | empujar la carga por empresa |
| `UNMATCHED` domina | los nombres son opacos | **el manifiesto pasa a ser prioritario** |

Y el guardia de que no rompimos nada: **el flujo manual sigue idéntico**. Un archivo `UNMATCHED` se
comporta hoy exactamente como se comportaba antes del cambio.

## Riesgos, y qué los contiene

| Riesgo | Qué lo contiene |
|---|---|
| Una sugerencia equivocada se aplica sola | `AUTO` exige confianza ≥ 0.90 **y** candidato único **y** tipo resuelto. El match difuso topa por debajo de 0.90 a propósito |
| Clasificar demora la carga de un lote grande | El motor es puro y en memoria; catálogo y universo se leen una vez por lote. **Hay que medirlo igual** con un lote de 100+ |
| Un fallo del motor rompe la subida | El archivo YA está en storage cuando se clasifica. Si el motor falla, la fila entra `UNMATCHED` — que es exactamente lo de hoy. **Nunca se pierde un archivo por un error de clasificación** |
| Datos personales en `match_evidence` | La evidencia guarda el RUT o el nombre que matcheó. Ya están en la base, pero **no pueden salir en logs ni en reportes** |

## Fuera de alcance

- La columna de sugerencia en la pantalla de la Bandeja.
- El manifiesto y su interfaz.
- El nombre canónico derivado de la clasificación.
- La ficha de empresa y la estructura de dos entradas en el sidebar.
- Extraer la fecha de vencimiento del PDF.

Las tres primeras dependen de lo que el reparto de `match_status` revele. Las dos últimas son
trabajos independientes que ya están diseñados en el mockup
`https://claude.ai/code/artifact/8e7bd1f6-b812-4e01-b1e5-2cdcf2bf319e`.
